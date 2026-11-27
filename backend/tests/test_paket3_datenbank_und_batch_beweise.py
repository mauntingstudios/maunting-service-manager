"""Wirksamkeitsbeweise für Paket 3 (P0/P1): DB-Indizes, EXPLAIN, Batch-Settings, N+1-Eliminierung."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import subprocess
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

from config import settings
import database as db_module
from games.base import ServerStatus
from models import Incident, JwtBlacklist, RefreshToken, Server, ServerPort, User, UserPasskey
from services.auth_service import AuthService
from services.dis_client import DisClient
from services.panel_settings_service import PanelSettingsService


def _alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option(
        "script_location",
        str(Path(__file__).resolve().parent.parent / "migrations"),
    )
    return cfg


def test_alembic_upgrade_downgrade_and_explain_indexes(pg_wegwerf) -> None:
    """3A: Migration 20261127_01 upgradet, downgradet und liefert Index-Scans in EXPLAIN (ANALYZE, BUFFERS)."""
    db_url = pg_wegwerf("paket3_idx")
    previous = settings.database_url
    settings.database_url = db_url
    cfg = _alembic_config()
    eng = create_engine(db_url)
    try:
        from database import Base
        import models  # noqa: F401

        Base.metadata.create_all(eng)
        command.stamp(cfg, "20261126_07")

        # Indizes ggf. aus create_all entfernen, um Migration upgrade() echt zu testen
        with eng.begin() as conn:
            for idx_name in (
                "ix_server_ports_server_id",
                "ix_refresh_tokens_expires_at",
                "ix_refresh_tokens_family_active",
                "ix_incidents_server_open_created",
                "ix_jwt_blacklist_expires_at",
            ):
                conn.execute(text(f"DROP INDEX IF EXISTS {idx_name}"))

        command.upgrade(cfg, "head")
        command.downgrade(cfg, "-1")
        command.upgrade(cfg, "head")

        with Session(eng) as sess:
            idx_user = User(
                username="idx_user",
                email_encrypted="enc",
                email_hash="h_idx",
                password_hash="pw",
            )
            sess.add(idx_user)
            sess.flush()

            servers = [
                Server(
                    name=f"srv-{i}",
                    game_type="minecraft",
                    install_dir="/tmp/s",
                    status="stopped",
                )
                for i in range(500)
            ]
            sess.add_all(servers)
            sess.flush()
            sid_target = servers[42].id

            now = datetime.now(timezone.utc)
            sess.add_all(
                [
                    ServerPort(server_id=srv.id, role="game", port=27000 + i, protocol="udp")
                    for i, srv in enumerate(servers)
                ]
            )
            sess.add_all(
                [
                    RefreshToken(
                        user_id=idx_user.id,
                        token_hash=f"th-{i:04d}",
                        family=f"fam-{i:04d}",
                        expires_at=now + timedelta(days=1),
                        revoked_at=None if i == 42 else now,
                    )
                    for i in range(len(servers))
                ]
            )
            sess.add_all(
                [
                    Incident(
                        uuid=str(uuid4()),
                        server_id=srv.id,
                        title="Crash",
                        description="desc",
                        type="crash",
                        status="open" if i == 42 else "resolved",
                        fingerprint="fp",
                        occurrences=1,
                    )
                    for i, srv in enumerate(servers)
                ]
            )
            sess.add_all(
                [
                    JwtBlacklist(
                        jti=f"jti-{i}",
                        user_id=idx_user.id,
                        expires_at=now + timedelta(days=i - 250),
                    )
                    for i in range(len(servers))
                ]
            )
            sess.commit()

        with eng.begin() as conn:
            conn.execute(text("ANALYZE server_ports"))
            conn.execute(text("ANALYZE refresh_tokens"))
            conn.execute(text("ANALYZE incidents"))
            conn.execute(text("ANALYZE jwt_blacklist"))

            plans = {
                "server_ports": "\n".join(
                    r[0]
                    for r in conn.execute(
                        text("EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM server_ports WHERE server_id = :sid"),
                        {"sid": sid_target},
                    ).fetchall()
                ),
                "refresh_tokens_family": "\n".join(
                    r[0]
                    for r in conn.execute(
                        text("EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM refresh_tokens WHERE family = 'fam-0042' AND revoked_at IS NULL")
                    ).fetchall()
                ),
                "incidents": "\n".join(
                    r[0]
                    for r in conn.execute(
                        text("EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM incidents WHERE server_id = :sid AND status <> 'resolved' ORDER BY created_at DESC"),
                        {"sid": sid_target},
                    ).fetchall()
                ),
                "jwt_blacklist": "\n".join(
                    r[0]
                    for r in conn.execute(
                        text("EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM jwt_blacklist WHERE expires_at < now() - interval '240 days'")
                    ).fetchall()
                ),
            }
            for label, plan_text in plans.items():
                assert ("Index Scan" in plan_text or "Bitmap Index Scan" in plan_text or "Index Only Scan" in plan_text), (
                    f"Erwartet Index-Scan für {label}, erhalten:\n{plan_text}"
                )
    finally:
        eng.dispose()
        settings.database_url = previous


def test_cleanup_expired_refresh_tokens_preserves_active_and_recent(
    db: Session,
    owner_user: User,
) -> None:
    """3A Cleanup: löscht abgelaufene & >30d widerrufene Tokens, behält aktive & kürzlich widerrufene."""
    now = datetime.now(timezone.utc)
    t_active = RefreshToken(
        user_id=owner_user.id,
        token_hash="h-active",
        family="fam-keep-1",
        expires_at=now + timedelta(days=7),
    )
    t_recent_revoked = RefreshToken(
        user_id=owner_user.id,
        token_hash="h-recent-rev",
        family="fam-keep-2",
        expires_at=now + timedelta(days=7),
        revoked_at=now - timedelta(days=5),
    )
    t_expired = RefreshToken(
        user_id=owner_user.id,
        token_hash="h-expired",
        family="fam-del-1",
        expires_at=now - timedelta(days=2),
    )
    t_old_revoked = RefreshToken(
        user_id=owner_user.id,
        token_hash="h-old-rev",
        family="fam-del-2",
        expires_at=now + timedelta(days=7),
        revoked_at=now - timedelta(days=31),
    )
    db.add_all([t_active, t_recent_revoked, t_expired, t_old_revoked])
    db.commit()

    deleted = AuthService.cleanup_expired_refresh_tokens(db)
    assert deleted == 2

    remaining_hashes = {r.token_hash for r in db.query(RefreshToken).all()}
    assert remaining_hashes == {"h-active", "h-recent-rev"}


def test_post_settings_single_batch_transaction(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """3C: POST /api/settings mit 15 Keys führt max. 1 Batch-SELECT, 1 Commit und 1 Redis-Bump aus."""
    bump_calls = 0
    orig_bump = PanelSettingsService._bump_remote_version

    def count_bump() -> None:
        nonlocal bump_calls
        bump_calls += 1
        orig_bump()

    monkeypatch.setattr(PanelSettingsService, "_bump_remote_version", staticmethod(count_bump))

    panel_selects: list[str] = []
    commits = 0

    def on_execute(_conn, _cursor, statement, _params, _ctx, _executemany):
        low = statement.lower()
        if "from panel_settings" in low and low.lstrip().startswith("select"):
            panel_selects.append(statement)

    def on_commit(_session):
        nonlocal commits
        commits += 1

    from sqlalchemy.orm import Session as OrmSession

    event.listen(db_module.engine, "before_cursor_execute", on_execute)
    event.listen(OrmSession, "after_commit", on_commit)
    try:
        payload = {
            "time_format": "12h",
            "imprint_enabled": True,
            "imprint_url": "https://example.invalid/impressum",
            "support_widget_enabled": False,
            "updates_automatic": True,
            "calendar_enabled": True,
            "notes_enabled": True,
            "docs_enabled": True,
            "vault_enabled": True,
            "social_enabled": True,
            "shop_enabled": False,
            "seasonal_enabled": True,
            "desktop_app_download_enabled": True,
            "browser_download_enabled": True,
            "story_fable_download_enabled": False,
        }
        resp = client.post(
            "/api/settings",
            json=payload,
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 200, resp.text
    finally:
        event.remove(db_module.engine, "before_cursor_execute", on_execute)
        event.remove(OrmSession, "after_commit", on_commit)

    # Höchstens 1 initiales Cache-Laden + 1 Batch-SELECT IN (...)
    assert len(panel_selects) <= 2, f"Zu viele panel_settings-SELECTs: {len(panel_selects)}"
    assert commits == 1, f"Erwartet genau 1 Commit, war {commits}"
    assert bump_calls == 1, f"Erwartet genau 1 _bump_remote_version(), war {bump_calls}"


def _count_queries(fn) -> int:
    count = 0

    def before_exec(*_args):
        nonlocal count
        count += 1

    event.listen(db_module.engine, "before_cursor_execute", before_exec)
    try:
        fn()
    finally:
        event.remove(db_module.engine, "before_cursor_execute", before_exec)
    return count


def test_list_servers_constant_queries_and_status_zero_writes(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """3D: GET /api/servers skaliert mit O(1) Queries; unveränderter /status erzeugt 0 UPDATE/COMMIT."""
    def _seed_servers(n: int) -> list[Server]:
        created = []
        for i in range(n):
            s = Server(
                name=f"BatchSrv-{i}-{uuid4().hex[:6]}",
                game_type="minecraft" if i % 2 == 0 else "dayz",
                install_dir=f"/tmp/srv-{i}",
                container_name=f"msm-batch-{i}",
                status="stopped",
            )
            db.add(s)
            db.flush()
            db.add(ServerPort(server_id=s.id, role="game", port=28000 + i, protocol="udp"))
            created.append(s)
        db.commit()
        return created

    _seed_servers(2)
    q_2 = _count_queries(lambda: assert_ok(client.get("/api/servers", cookies=owner_cookies)))

    _seed_servers(18)  # jetzt 20 Server
    q_20 = _count_queries(lambda: assert_ok(client.get("/api/servers", cookies=owner_cookies)))

    assert q_2 == q_20, f"N+1 erkannt: 2 Server = {q_2} Queries, 20 Server = {q_20} Queries"

    # Unveränderter Status -> 0 UPDATEs / 0 COMMITs
    target_srv = db.query(Server).first()
    fake_plugin = SimpleNamespace(
        get_status=lambda _srv: ServerStatus(status="stopped", message=""),
        get_blueprint=lambda: None,
    )
    monkeypatch.setattr("routers.servers.get_plugin", lambda _gt: fake_plugin)

    updates: list[str] = []
    commits = 0

    def on_exec(_conn, _cursor, stmt, *_rest):
        if stmt.lstrip().lower().startswith("update"):
            updates.append(stmt)

    def on_commit(_sess):
        nonlocal commits
        commits += 1

    from sqlalchemy.orm import Session as OrmSession

    event.listen(db_module.engine, "before_cursor_execute", on_exec)
    event.listen(OrmSession, "after_commit", on_commit)
    try:
        r = client.get(f"/api/servers/{target_srv.id}/status", cookies=owner_cookies)
        assert r.status_code == 200
    finally:
        event.remove(db_module.engine, "before_cursor_execute", on_exec)
        event.remove(OrmSession, "after_commit", on_commit)

    assert updates == [], f"Unerwartete UPDATEs bei unverändertem Status: {updates}"
    assert commits == 0, f"Unerwarteter Commit bei unverändertem Status: {commits}"


def assert_ok(resp) -> None:
    assert resp.status_code == 200, resp.text


def test_system_health_caches_caddy_and_admin_users_batches_decrypt(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """3D: /api/system/health cacht caddy version; /api/admin/users nutzt decrypt_many statt N Einzelcalls."""
    from routers import system as system_router

    system_router.reset_caddy_cache_for_tests()
    caddy_calls = 0

    def fake_run(cmd, **_kwargs):
        nonlocal caddy_calls
        if cmd[:2] == ["caddy", "version"]:
            caddy_calls += 1
            return SimpleNamespace(returncode=0, stdout="v2.8.4", stderr="")
        return SimpleNamespace(returncode=0, stdout="27.0.0", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    for _ in range(3):
        res = client.get("/api/system/health", cookies=owner_cookies)
        assert res.status_code == 200
        assert res.json()["services"]["caddy"]["detail"] == "v2.8.4"
    assert caddy_calls == 1, f"caddy version wurde {caddy_calls}x statt 1x aufgerufen"

    for i in range(4):
        u = AuthService.create_user(db, f"batchu_{i}", f"batchu_{i}@example.invalid", "StrongPass123!")
        db.add(
            UserPasskey(
                user_id=u.id,
                credential_id=f"cred-{i}",
                public_key="pk",
                algorithm=-7,
                rp_id="localhost",
                name="Key",
            )
        )
    db.commit()

    single_decrypts = 0
    batch_decrypts = 0
    orig_decrypt = DisClient.decrypt
    orig_decrypt_many = DisClient.decrypt_many

    def tracked_decrypt(ct, aad=None):
        nonlocal single_decrypts
        single_decrypts += 1
        return orig_decrypt(ct, aad=aad)

    def tracked_decrypt_many(items):
        nonlocal batch_decrypts
        batch_decrypts += 1
        return orig_decrypt_many(items)

    monkeypatch.setattr(DisClient, "decrypt", staticmethod(tracked_decrypt))
    monkeypatch.setattr(DisClient, "decrypt_many", staticmethod(tracked_decrypt_many))

    users_resp = client.get("/api/admin/users", cookies=owner_cookies)
    assert users_resp.status_code == 200
    assert len(users_resp.json()) >= 5
    assert batch_decrypts == 1
    assert single_decrypts == 0
