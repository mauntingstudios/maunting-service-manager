"""Tests fuer Frontend-Deployments, Build-Quotas, Env-Verschluesselung und Read-Only-Schutz."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from config import settings
from database import Base
from models import (
    KIND_GITHUB_TOKEN,
    FrontendDeployment,
    FrontendSettings,
    Role,
    RoleFrontendBuildQuota,
    Server,
    User,
    UserRole,
)
from services import credential_service, frontend_deploy_service
from services.frontend_build_runner import FrontendBuildResult


def _make_server(db: Session, tmp_path: Path, *, game_type: str = "web_frontend_github") -> Server:
    install_dir = tmp_path / "srv-1"
    install_dir.mkdir(parents=True, exist_ok=True)
    srv = Server(
        name="WebApp",
        game_type=game_type,
        install_dir=str(install_dir),
        status="running",
        desired_power_state="running",
        game_port=28080,
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    return srv


def test_migration_20261116_02_upgrade_and_downgrade(pg_wegwerf) -> None:
    db_url = pg_wegwerf("frontend-deploy-mig")
    prev = settings.database_url
    settings.database_url = db_url
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    engine = create_engine(db_url)
    try:
        Base.metadata.create_all(engine)
        command.stamp(cfg, "20261116_02")
        command.downgrade(cfg, "20261116_01")
        tables_after_down = set(inspect(engine).get_table_names())
        assert "frontend_deployments" not in tables_after_down
        assert "frontend_settings" not in tables_after_down
        assert "role_frontend_build_quotas" not in tables_after_down

        command.upgrade(cfg, "20261116_02")
        tables_after_up = set(inspect(engine).get_table_names())
        assert {
            "frontend_deployments",
            "frontend_settings",
            "role_frontend_build_quotas",
        } <= tables_after_up
    finally:
        engine.dispose()
        settings.database_url = prev


def test_role_build_quota_picks_highest_across_roles(db: Session, regular_user: User) -> None:
    r1 = Role(name="Basic", is_system=False)
    r2 = Role(name="Pro", is_system=False)
    db.add_all([r1, r2])
    db.flush()
    db.add(RoleFrontendBuildQuota(role_id=r1.id, max_cpu_cores=1, max_memory_mb=1024, max_previews_per_server=2))
    db.add(RoleFrontendBuildQuota(role_id=r2.id, max_cpu_cores=4, max_memory_mb=4096, max_previews_per_server=10))
    db.add_all([UserRole(user_id=regular_user.id, role_id=r1.id), UserRole(user_id=regular_user.id, role_id=r2.id)])
    db.commit()

    quota = frontend_deploy_service.resolve_build_quota(db, regular_user.id)
    assert quota.max_cpu_cores == 4
    assert quota.max_memory_mb == 4096
    assert quota.max_previews_per_server == 10


def test_role_frontend_quota_endpoints(
    client: TestClient, owner_cookies: dict, csrf_token: str, db: Session
) -> None:
    role = Role(name="FrontendDev", is_system=False)
    db.add(role)
    db.commit()

    res = client.put(
        f"/api/roles/{role.id}/frontend-quota",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "max_cpu_cores": 4,
            "max_memory_mb": 4096,
            "build_timeout_seconds": 600,
            "max_concurrent_builds": 2,
            "max_previews_per_server": 8,
        },
    )
    assert res.status_code == 200
    assert res.json()["max_cpu_cores"] == 4

    get_res = client.get(f"/api/roles/{role.id}/frontend-quota", cookies=owner_cookies)
    assert get_res.status_code == 200
    assert get_res.json()["max_previews_per_server"] == 8


def test_env_vars_encrypted_in_db(db: Session, tmp_path: Path) -> None:
    srv = _make_server(db, tmp_path)
    frontend_deploy_service.set_env_vars(db, srv, "production", {"VITE_API_URL": "https://api.example.com"})
    frontend_deploy_service.set_env_vars(db, srv, "preview", {"VITE_API_URL": "https://staging.example.com"})
    db.commit()

    row = db.get(FrontendSettings, srv.id)
    assert row is not None
    assert "https://api.example.com" not in (row.env_production_enc or "")
    assert frontend_deploy_service.get_env_vars(db, srv.id, "production") == {
        "VITE_API_URL": "https://api.example.com"
    }
    assert frontend_deploy_service.get_env_vars(db, srv.id, "preview") == {
        "VITE_API_URL": "https://staging.example.com"
    }


def test_enqueue_supersedes_older_queued_build(db: Session, tmp_path: Path) -> None:
    srv = _make_server(db, tmp_path)
    d1 = frontend_deploy_service.enqueue(db, srv, branch="main", commit_sha="111", source="push")
    d2 = frontend_deploy_service.enqueue(db, srv, branch="main", commit_sha="222", source="push")
    db.commit()
    db.refresh(d1)
    db.refresh(d2)
    assert d1.status == "superseded"
    assert d2.status == "queued"


def test_run_build_success_failure_keeps_live_and_masks_tokens(
    db: Session, regular_user: User, tmp_path: Path
) -> None:
    srv = _make_server(db, tmp_path)
    cred = credential_service.upsert_user_credential(
        db, user_id=regular_user.id, kind=KIND_GITHUB_TOKEN, label="gh", secret="ghp_supersecret123456"
    )
    credential_service.set_binding(
        db, server_id=srv.id, kind=KIND_GITHUB_TOKEN, credential_id=cred.id, actor=regular_user
    )
    db.commit()

    d_ok = frontend_deploy_service.enqueue(db, srv, branch="main", source="push")
    db.commit()

    def _fake_clone(*, repo, branch, dest: Path, token):
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "dist").mkdir(exist_ok=True)
        (dest / "dist" / "index.html").write_text("<h1>v1</h1>", encoding="utf-8")
        return "abc1234", f"cloned with {token or 'none'}"

    def _fake_build(project_dir: Path, **_kwargs):
        return FrontendBuildResult(ok=True, output_dir=project_dir / "dist", log_output="build ok")

    with patch("services.frontend_deploy_service._clone_repo", side_effect=_fake_clone), patch(
        "services.frontend_deploy_service.run_node_frontend_build", side_effect=_fake_build
    ):
        res1 = frontend_deploy_service.run_build(db, d_ok.id, actor_user_id=regular_user.id)
        db.commit()

    assert res1.status == "ready"
    assert res1.is_live is True
    assert (Path(srv.install_dir) / "current" / "index.html").read_text(encoding="utf-8") == "<h1>v1</h1>"
    assert "ghp_supersecret123456" not in Path(res1.log_path).read_text(encoding="utf-8")

    # Zweiter Build schlaegt fehl -> alte Produktion bleibt live!
    d_fail = frontend_deploy_service.enqueue(db, srv, branch="main", source="push")
    db.commit()
    with patch("services.frontend_deploy_service._clone_repo", side_effect=_fake_clone), patch(
        "services.frontend_deploy_service.run_node_frontend_build",
        return_value=FrontendBuildResult(ok=False, output_dir=None, log_output="npm ERR!"),
    ):
        res2 = frontend_deploy_service.run_build(db, d_fail.id, actor_user_id=regular_user.id)
        db.commit()

    db.refresh(res1)
    assert res2.status == "failed"
    assert res2.is_live is False
    assert res1.is_live is True
    assert (Path(srv.install_dir) / "current" / "index.html").read_text(encoding="utf-8") == "<h1>v1</h1>"


def test_github_frontend_output_is_readonly_via_files_api(
    client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
) -> None:
    gh_srv = _make_server(db, tmp_path / "gh", game_type="web_frontend_github")
    static_srv = _make_server(db, tmp_path / "st", game_type="web_static")

    res_blocked = client.put(
        f"/api/files/{gh_srv.id}/write?path=current/index.html",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"content": "<h1>hacked</h1>"},
    )
    assert res_blocked.status_code == 403

    res_allowed = client.put(
        f"/api/files/{static_srv.id}/write?path=index.html",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"content": "<h1>ok</h1>"},
    )
    assert res_allowed.status_code == 200


def test_frontend_blueprint_install_skips_game_github_clone(db: Session, tmp_path: Path) -> None:
    from games import get_plugin

    srv = _make_server(db, tmp_path / "gh_init", game_type="web_frontend_github")
    plugin = get_plugin("web_frontend_github")
    assert plugin is not None

    with patch("games.blueprint_plugin.finish_install") as mock_finish:
        res = plugin.install(srv)
    assert "error" not in res
    mock_finish.assert_called_once_with(srv.id, {"ok": True})
    assert not (Path(srv.install_dir) / ".git").exists()


def test_run_build_writes_initial_log_immediately(
    db: Session, tmp_path: Path, regular_user
) -> None:
    srv = _make_server(db, tmp_path / "live_log")
    dep = frontend_deploy_service.enqueue(db, srv, branch="main", source="manual")
    db.commit()

    observed_during_clone: dict[str, object] = {}

    def _clone_and_inspect(*, repo, branch, dest, token=None):
        observed_during_clone["log_exists"] = (
            Path(srv.install_dir) / "build-logs" / f"deploy-{dep.id}.log"
        ).exists()
        observed_during_clone["log_text"] = (
            Path(srv.install_dir) / "build-logs" / f"deploy-{dep.id}.log"
        ).read_text(encoding="utf-8")
        dest.mkdir(parents=True, exist_ok=True)
        return "abc1234", "cloned"

    with patch("services.frontend_deploy_service._clone_repo", side_effect=_clone_and_inspect), patch(
        "services.frontend_deploy_service.run_node_frontend_build",
        return_value=FrontendBuildResult(ok=False, output_dir=None, log_output="err"),
    ):
        res = frontend_deploy_service.run_build(db, dep.id, actor_user_id=regular_user.id)
        db.commit()

    assert observed_during_clone.get("log_exists") is True
    assert f"Build #{dep.id} gestartet" in str(observed_during_clone.get("log_text", ""))
    assert res.status == "failed"


def test_run_build_delegates_to_agent_when_node_fs_delegated(
    db: Session, tmp_path: Path, regular_user
) -> None:
    """Auf Produktion (msm-panel ohne POSIX-Rechte auf /opt/msm/servers/<id>)
    muessen Logs, Caddyfile, Clone, Build und Symlinks ueber NodeClient +
    docker_service.run_ephemeral laufen.
    """
    import shutil
    from unittest.mock import MagicMock

    srv = _make_server(db, tmp_path / "agent_mode")
    # Entferne das Verzeichnis lokal, damit jeder direkte Path()-Zugriff sofort scheitern wuerde
    shutil.rmtree(srv.install_dir, ignore_errors=True)

    dep = frontend_deploy_service.enqueue(db, srv, branch="main", source="manual")
    db.commit()

    written_files: dict[str, str] = {}
    ephemeral_calls: list[dict] = []

    mock_client = MagicMock()
    mock_client.files_write.side_effect = lambda key, rel, content: written_files.__setitem__(rel, content)
    mock_client.files_read.side_effect = lambda key, rel: written_files.get(rel, "")

    def _fake_ephemeral(**kwargs):
        ephemeral_calls.append(kwargs)
        if "alpine/git" in kwargs.get("image", ""):
            return {"ok": True, "stdout": "Cloning...\nMSM_COMMIT_SHA=deadbeef1234\n", "stderr": ""}
        return {"ok": True, "stdout": "built dist/index.html\n", "stderr": ""}

    with patch("services.frontend_deploy_service._use_agent_fs", return_value=True), patch(
        "services.node_client.NodeClient.from_node", return_value=mock_client
    ), patch("services.docker_service.run_ephemeral", side_effect=_fake_ephemeral):
        res = frontend_deploy_service.run_build(db, dep.id, actor_user_id=regular_user.id)
        db.commit()
        read_back = frontend_deploy_service.read_build_log(srv, res)

    assert res.status == "ready"
    assert res.is_live is True
    assert res.commit_sha == "deadbeef1234"
    assert "Caddyfile" in written_files
    assert f"build-logs/deploy-{dep.id}.log" in written_files
    assert any("alpine/git" in c.get("image", "") for c in ephemeral_calls)
    git_call = next(c for c in ephemeral_calls if "alpine/git" in c.get("image", ""))
    assert git_call["env"]["GIT_REPO_URL"].startswith("https://github.com/")
    assert any("node:" in c.get("image", "") for c in ephemeral_calls)
    assert read_back.startswith(f"[MSM] Build #{dep.id} gestartet")
    node_call = next(c for c in ephemeral_calls if "node:" in c.get("image", ""))
    assert "NODE_ENV=development" in " ".join(node_call["command"])
    assert "tee -a" in " ".join(node_call["command"])
    alpine_calls = [c for c in ephemeral_calls if c.get("image") == "alpine:3.20"]
    assert alpine_calls
    assert "-d \"/srv/current\" ] && [ ! -L \"/srv/current\"" in " ".join(alpine_calls[-1]["command"])


def test_agent_build_preserves_full_log_on_failure_and_promotes_with_cp_r(
    db: Session, tmp_path: Path, regular_user
) -> None:
    from unittest.mock import MagicMock

    srv = _make_server(db, tmp_path / "agent_fail_and_promote")
    dep = frontend_deploy_service.enqueue(db, srv, branch="main", source="manual")
    db.commit()

    written_files: dict[str, str] = {}
    mock_client = MagicMock()
    mock_client.files_write.side_effect = lambda key, rel, content: written_files.__setitem__(rel, content)
    mock_client.files_read.side_effect = lambda key, rel: written_files.get(rel, "")

    long_prefix = "VERBOSE_NPM_LINE_123456\n" * 60

    def _fail_ephemeral(**kwargs):
        if "alpine/git" in kwargs.get("image", ""):
            return {"ok": True, "stdout": "MSM_COMMIT_SHA=cafe1234\n", "stderr": ""}
        return {
            "ok": False,
            "stdout": long_prefix + "tsc failed on src/App.tsx\n",
            "stderr": "ERR_BUILD_FAILED\n",
        }

    with patch("services.frontend_deploy_service._use_agent_fs", return_value=True), patch(
        "services.node_client.NodeClient.from_node", return_value=mock_client
    ), patch("services.docker_service.run_ephemeral", side_effect=_fail_ephemeral):
        res = frontend_deploy_service.run_build(db, dep.id, actor_user_id=regular_user.id)
        db.commit()
        full_log = frontend_deploy_service.read_build_log(srv, res)

    assert res.status == "failed"
    assert res.is_live is False
    assert "VERBOSE_NPM_LINE_123456" in full_log
    assert "ERR_BUILD_FAILED" in full_log

    # Promote muss cp -r statt cp -a verwenden (rootless ACLs)
    prev_dep = frontend_deploy_service.enqueue(db, srv, branch="feat/ui", source="push")
    prev_dep.status = "ready"
    db.commit()

    promote_scripts: list[str] = []

    def _capture_alpine(**kwargs):
        promote_scripts.append(" ".join(kwargs.get("command") or []))
        return {"ok": True, "stdout": "", "stderr": ""}

    with patch("services.frontend_deploy_service._use_agent_fs", return_value=True), patch(
        "services.docker_service.run_ephemeral", side_effect=_capture_alpine
    ), patch("services.frontend_deploy_service._write_server_text"):
        promoted = frontend_deploy_service.promote(db, prev_dep.id)
        db.commit()

    assert promoted.is_live is True
    assert any("cp -r " in s and "cp -a " not in s for s in promote_scripts)


def test_atomic_symlink_replaces_existing_directory_and_provisioning_initializes_frontend(
    db: Session, tmp_path: Path, regular_user
) -> None:
    from unittest.mock import MagicMock
    from games import get_plugin
    from services.server_provisioning_service import _initialize_and_start_frontend_server

    srv = _make_server(db, tmp_path / "dir_replace")
    current_dir = Path(srv.install_dir) / "current"
    current_dir.mkdir(parents=True, exist_ok=True)
    (current_dir / "index.html").write_text("placeholder", encoding="utf-8")

    rel = Path(srv.install_dir) / "deployments" / "42"
    rel.mkdir(parents=True, exist_ok=True)
    (rel / "index.html").write_text("built", encoding="utf-8")

    frontend_deploy_service._atomic_symlink(rel, current_dir)
    assert (current_dir / "index.html").read_text(encoding="utf-8") == "built"

    # Provisioning-Init darf keinen TypeError wegen falscher Signaturen werfen
    bp = get_plugin("web_frontend_github").get_blueprint()
    srv2 = _make_server(db, tmp_path / "prov_init")
    with patch("services.server_lifecycle_service.queue_lifecycle_operation") as mock_q, patch(
        "services.frontend_deploy_service.trigger_async_build"
    ) as mock_build:
        _initialize_and_start_frontend_server(db, srv2, bp, regular_user.id)

    mock_q.assert_called_once()
    mock_build.assert_called_once()


def test_frontend_online_sync_with_lifecycle_and_static_repo_build(
    db: Session, tmp_path: Path
) -> None:
    from services.frontend_build_runner import detect_output_dir, run_node_frontend_build

    srv = _make_server(db, tmp_path / "sync_srv")
    fs = frontend_deploy_service.get_or_create_settings(db, srv)
    assert fs.online is True

    frontend_deploy_service.sync_frontend_online_from_lifecycle(db, srv, False)
    db.refresh(fs)
    assert fs.online is False

    frontend_deploy_service.sync_frontend_online_from_lifecycle(db, srv, True)
    db.refresh(fs)
    assert fs.online is True

    # Reines Static-HTML-Repo ohne package.json baut ohne npm-Fehler
    static_proj = tmp_path / "static_repo"
    static_proj.mkdir()
    (static_proj / "index.html").write_text("<h1>Hallo</h1>", encoding="utf-8")
    res = run_node_frontend_build(static_proj)
    assert res.ok is True
    assert res.output_dir == static_proj

    # Angular-Ausgabeordner dist/my-app/browser wird erkannt
    ng_proj = tmp_path / "ng_repo"
    (ng_proj / "dist" / "my-app" / "browser").mkdir(parents=True)
    (ng_proj / "dist" / "my-app" / "browser" / "index.html").write_text("<h1>ng</h1>", encoding="utf-8")
    assert detect_output_dir(ng_proj) == ng_proj / "dist" / "my-app" / "browser"


def test_reconcile_orphaned_builds_cancel_and_build_cache(db: Session, tmp_path: Path) -> None:
    srv = _make_server(db, tmp_path / "reconcile_srv")
    dep_stuck = frontend_deploy_service.enqueue(db, srv, branch="main", source="manual")
    dep_stuck.status = "building"
    dep_active = frontend_deploy_service.enqueue(db, srv, branch="dev", source="manual")
    dep_active.status = "building"
    db.commit()

    frontend_deploy_service._mark_build_active(dep_active.id)
    try:
        cleaned = frontend_deploy_service.reconcile_orphaned_frontend_deployments(db, max_age_hours=0)
        assert cleaned == 1
        db.refresh(dep_stuck)
        db.refresh(dep_active)
        assert dep_stuck.status == "failed"
        assert "unterbrochen" in (dep_stuck.error_summary or "")
        assert dep_active.status == "building"

        active_map = frontend_deploy_service.get_active_frontend_builds_map(db, [srv.id])
        assert srv.id in active_map
        assert active_map[srv.id]["id"] == dep_active.id
        assert active_map[srv.id]["branch"] == "dev"

        canceled = frontend_deploy_service.cancel_deployment(db, srv, dep_active)
        db.commit()
        assert canceled.status == "canceled"
    finally:
        frontend_deploy_service._mark_build_done(dep_active.id)

    # Isolierter Build-Cache pro Server
    cache_npm = Path(srv.install_dir) / "_build_cache" / "npm"
    cache_npm.mkdir(parents=True, exist_ok=True)
    (cache_npm / "pkg.tgz").write_text("cached", encoding="utf-8")
    with patch("services.frontend_deploy_service._use_agent_fs", return_value=False):
        frontend_deploy_service.clear_build_cache(srv)
    assert not (Path(srv.install_dir) / "_build_cache").exists()
