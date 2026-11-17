"""Isolations- und Sandbox-Tests fuer KI-Coding-Projekte (`project_workspace`).

Prueft:
- `run_project_command` nutzt einen Container mit `network="none"`,
  `read_only_rootfs=True`, `tmpfs_paths=["/tmp"]` und Ressourcenlimits fuer Code/Tests.
- Reine Paket-Installationen (`npm install`, `pip install`) nutzen nur das vom
  Panel/LAN isolierte `msm-ephemeral-net` (sofern aktiviert).
- Gemischt verkettete Befehle (`npm install && python steal.py`) werden blockiert,
  damit niemals willkuerlicher Projektcode im Netzwerk-Container laeuft.
- Bei fehlendem Container-Runner wird nicht still auf den Backend-Host zurueckgefallen.
- `verify_project_sandbox`, `singra/release.py` und `ai_project_git.py` (ohne Git-Hooks /
  `file://`-Submodule) halten dieselben Grenzen ein.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from config import settings
from models import AiProject, Role, RolePermission, User
from services import ai_project_command, ai_project_git, docker_service
from services.ai_project_errors import AiProjectError
from services.auth_service import AuthService
from services.role_service import set_user_roles


def _coding_user(db: Session) -> User:
    name = f"dev-{uuid4().hex[:6]}"
    user = AuthService.create_user(db, name, f"{name}@test.de", "DevSandbox123!")
    user.email_verified = True
    role = Role(name=f"r-{name}", is_system=False)
    db.add(role)
    db.flush()
    for key in ("ai.chat.use", "ai.coding.use", "ai.projects.manage"):
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    set_user_roles(db, user, [role.id])
    db.refresh(user)
    return user


def _coding_project(db: Session, user: User, tmp_path: Path, monkeypatch) -> AiProject:
    monkeypatch.setattr(settings, "servers_dir", str(tmp_path))
    proj_id = str(uuid4())
    ws = tmp_path / "_ai_projects" / f"proj_{proj_id}"
    ws.mkdir(parents=True, exist_ok=True)
    proj = AiProject(
        id=proj_id,
        user_id=user.id,
        name="IsolatedSandboxApp",
        workspace_mode="sandbox",
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return proj


def test_run_project_command_executes_code_completely_offline_in_container(
    db: Session, tmp_path: Path, monkeypatch
) -> None:
    user = _coding_user(db)
    proj = _coding_project(db, user, tmp_path, monkeypatch)
    monkeypatch.setattr(settings, "coding_sandbox_allow_host_fallback", False)

    calls: list[dict] = []
    node_stub = SimpleNamespace(id=1, name="local-node", is_local=True)
    monkeypatch.setattr(docker_service, "resolve_sandbox_executor", lambda _db, node_id=None: (True, node_stub))

    def fake_run_ephemeral(**kwargs):
        calls.append(kwargs)
        return {"ok": True, "stdout": "3 passed\n", "stderr": ""}

    monkeypatch.setattr(docker_service, "run_ephemeral", fake_run_ephemeral)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("Darf bei aktivem Container nicht bare-metal ausfuehren"),
    )

    res = ai_project_command.run_project_command(db, user, proj.id, "pytest -q")

    assert res["ok"] is True
    assert res["network"] == "none"
    assert res["sandbox"] == "container"
    assert len(calls) == 1
    c = calls[0]
    assert c["network"] == "none"
    assert c["read_only_rootfs"] is True
    assert c["tmpfs_paths"] == ["/tmp"]
    assert c["workdir"] == "/workspace"
    assert c["node"] is node_stub
    assert c["pids_limit"] == settings.coding_sandbox_pids_limit


def test_run_project_command_allows_ephemeral_net_only_for_pure_package_installs(
    db: Session, tmp_path: Path, monkeypatch
) -> None:
    user = _coding_user(db)
    proj = _coding_project(db, user, tmp_path, monkeypatch)
    monkeypatch.setattr(settings, "coding_sandbox_allow_package_network", True)
    monkeypatch.setattr(docker_service, "resolve_sandbox_executor", lambda _db, node_id=None: (True, None))

    seen_nets: list[str | None] = []
    monkeypatch.setattr(
        docker_service,
        "run_ephemeral",
        lambda **kwargs: (seen_nets.append(kwargs.get("network")), {"ok": True, "stdout": "ok", "stderr": ""})[1],
    )

    res_npm = ai_project_command.run_project_command(db, user, proj.id, "npm ci")
    res_pip = ai_project_command.run_project_command(db, user, proj.id, "python -m pip install fastapi")
    assert res_npm["network"] == "msm-ephemeral-net"
    assert res_pip["network"] == "msm-ephemeral-net"
    assert seen_nets == ["msm-ephemeral-net", "msm-ephemeral-net"]

    # Gemischter Befehl (Install + beliebiger Code) muss blockiert werden
    with pytest.raises(AiProjectError, match="getrennt ausführen"):
        ai_project_command.run_project_command(db, user, proj.id, "npm install && python steal.py")

    # Wenn Paket-Netz deaktiviert ist, faellt auch Install auf 'none'
    monkeypatch.setattr(settings, "coding_sandbox_allow_package_network", False)
    res_offline_pip = ai_project_command.run_project_command(db, user, proj.id, "pip install pytest")
    assert res_offline_pip["network"] == "none"


def test_run_project_command_blocks_bare_metal_without_container_in_prod(
    db: Session, tmp_path: Path, monkeypatch
) -> None:
    user = _coding_user(db)
    proj = _coding_project(db, user, tmp_path, monkeypatch)
    monkeypatch.setattr(settings, "coding_sandbox_allow_host_fallback", False)
    monkeypatch.setattr(docker_service, "resolve_sandbox_executor", lambda _db, node_id=None: (False, None))
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("Bare-Metal-Fallback muss blockiert bleiben"),
    )

    with pytest.raises(AiProjectError, match="Bare-Metal-Ausführung ist deaktiviert"):
        ai_project_command.run_project_command(db, user, proj.id, "python -c 'print(1)'")


def test_verify_project_sandbox_uses_offline_container_for_node_check(
    db: Session, tmp_path: Path, monkeypatch
) -> None:
    from services import ai_project_service

    user = _coding_user(db)
    proj = _coding_project(db, user, tmp_path, monkeypatch)
    monkeypatch.setattr(settings, "coding_sandbox_allow_host_fallback", False)

    ai_project_service.write_project_file(db, user, proj.id, rel_path="index.html", content="<html><body>hi</body></html>")
    ai_project_service.write_project_file(db, user, proj.id, rel_path="app.js", content="const x = 1;")

    monkeypatch.setattr(docker_service, "resolve_sandbox_executor", lambda _db, node_id=None: (True, None))
    checked: list[dict] = []
    monkeypatch.setattr(
        docker_service,
        "run_ephemeral",
        lambda **kwargs: (checked.append(kwargs), {"ok": True, "stdout": "", "stderr": ""})[1],
    )
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("node --check darf bei aktivem Container nicht bare-metal laufen"),
    )

    res = ai_project_command.verify_project_sandbox(db, user, proj.id)
    assert res["preview_ready"] is True
    assert len(checked) == 1
    assert checked[0]["network"] == "none"
    assert checked[0]["command"] == ["node", "--check", "app.js"]


def test_release_python_backend_uses_isolated_ephemeral_container(tmp_path: Path, monkeypatch) -> None:
    from services.singra.release import SingraBuildError, build_release

    class DummyProject:
        id = "py-rel-1"

    monkeypatch.setattr(settings, "coding_sandbox_allow_host_fallback", False)
    monkeypatch.setattr(docker_service, "is_docker_available", lambda node=None: False)

    with pytest.raises(SingraBuildError, match="Container-Sandbox"):
        build_release(
            project=DummyProject(),
            files={"main.py": "print('ok')", "requirements.txt": "fastapi==0.115.0\n"},
            workspace_dir=tmp_path / "no_docker",
            environment="prod",
        )

    calls: list[dict] = []
    monkeypatch.setattr(docker_service, "is_docker_available", lambda node=None: True)
    monkeypatch.setattr(
        docker_service,
        "run_ephemeral",
        lambda **kwargs: (calls.append(kwargs), {"ok": True, "stdout": "", "stderr": ""})[1],
    )
    rel = build_release(
        project=DummyProject(),
        files={"main.py": "print('ok')", "requirements.txt": "fastapi==0.115.0\n"},
        workspace_dir=tmp_path / "with_docker",
        environment="prod",
    )
    assert rel.exists()
    assert len(calls) == 1
    assert calls[0]["read_only_rootfs"] is True
    assert calls[0]["network"] == "msm-ephemeral-net"


def test_git_runner_disables_hooks_file_protocol_and_submodules(monkeypatch, tmp_path: Path) -> None:
    seen_argv: list[list[str]] = []

    def fake_run(argv, **kwargs):
        seen_argv.append(list(argv))
        return SimpleNamespace(returncode=0, stdout="main\n", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    ai_project_git._run_git(["status", "--short"], cwd=tmp_path)
    assert len(seen_argv) == 1
    cmd = seen_argv[0]
    assert "core.hooksPath=/dev/null" in cmd
    assert "protocol.file.allow=never" in cmd
    assert "submodule.recurse=false" in cmd
