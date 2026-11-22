"""Tests fuer `ai.projects.preview` und den Hoster-Publish-Guard (`rented_server`)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Role, RolePermission, Server, ServerPermission, User
from services import ai_project_service, role_service, shop_fulfillment_service
from services.auth_service import AuthService


def _login(client: TestClient, username: str, password: str) -> tuple[dict, str]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert resp.status_code == 200
    cookies = dict(resp.cookies)
    return cookies, cookies.get("__Secure-csrf_token") or ""


def _create_customer(db: Session, *, extra_perms: tuple[str, ...] = ()) -> tuple[User, dict, str]:
    uname = f"cust-{uuid4().hex[:6]}"
    pw = "CustPass123!"
    user = AuthService.create_user(db, uname, f"{uname}@test.de", pw)
    user.email_verified = True
    role = Role(name=f"role-{uuid4().hex[:6]}", is_system=False)
    db.add(role)
    db.flush()
    for key in ("ai.projects.manage", "ai.coding.use", *extra_perms):
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    role_service.set_user_roles(db, user, [role.id])
    db.refresh(user)
    return user, uname, pw


def test_ai_projects_preview_permission_is_shop_allowed_and_gates_dev_start(
    client: TestClient, db: Session, tmp_path: Path, monkeypatch
):
    assert "ai.projects.preview" in shop_fulfillment_service.SHOP_ALLOWED_ROLE_PERMISSIONS
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))

    user_no_prev, uname1, pw1 = _create_customer(db)
    cookies1, csrf1 = _login(client, uname1, pw1)
    proj = ai_project_service.create_project(db, user_no_prev, name="NoPreview")

    blocked = client.post(
        f"/api/ai/projects/{proj.id}/dev/start",
        cookies=cookies1,
        headers={"X-CSRF-Token": csrf1},
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "preview_permission_required"

    user_prev, uname2, pw2 = _create_customer(db, extra_perms=("ai.projects.preview",))
    cookies2, csrf2 = _login(client, uname2, pw2)
    proj2 = ai_project_service.create_project(db, user_prev, name="WithPreview")

    with patch(
        "services.singra.dev_env.start_dev_environment",
        return_value={"ok": True, "status": "running", "dev_web_url": "http://127.0.0.1:4100"},
    ):
        allowed = client.post(
            f"/api/ai/projects/{proj2.id}/dev/start",
            cookies=cookies2,
            headers={"X-CSRF-Token": csrf2},
        )
    assert allowed.status_code == 200
    assert allowed.json()["status"] == "running"


def test_customer_without_servers_create_publishes_only_to_rented_server(
    client: TestClient, db: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))
    customer, uname, pw = _login_tuple = _create_customer(db)
    _ = _login_tuple
    cookies, csrf = _login(client, uname, pw)

    proj = ai_project_service.create_project(db, customer, name="WebApp")
    ai_project_service.write_project_file(
        db, customer, proj.id, rel_path="index.html", content="<h1>Hallo Shop</h1>"
    )

    # Kompatibler Webserver + nicht kompatibler Game-Server + fremder Webserver
    web_dir = tmp_path / "srv-web"
    web_srv = Server(
        name="Mein Webhosting",
        game_type="web_static",
        install_dir=str(web_dir),
        container_name=f"msm-web-{uuid4().hex[:6]}",
        status="stopped",
    )
    game_srv = Server(
        name="Mein Minecraft",
        game_type="minecraft_paper",
        install_dir=str(tmp_path / "srv-mc"),
        container_name=f"msm-mc-{uuid4().hex[:6]}",
        status="stopped",
    )
    foreign_web = Server(
        name="Fremder Webserver",
        game_type="web_static",
        install_dir=str(tmp_path / "srv-foreign"),
        container_name=f"msm-for-{uuid4().hex[:6]}",
        status="stopped",
    )
    db.add_all([web_srv, game_srv, foreign_web])
    db.flush()

    for key in ("server.view", "server.files.write", "server.restart"):
        db.add(ServerPermission(user_id=customer.id, server_id=web_srv.id, permission_key=key))
        db.add(ServerPermission(user_id=customer.id, server_id=game_srv.id, permission_key=key))
    db.commit()

    # publish-options darf keine Nodes / Host-IPs / Cloudflare-Zonen preisgeben
    opts_res = client.get(f"/api/ai/projects/{proj.id}/publish-options", cookies=cookies)
    assert opts_res.status_code == 200
    opts = opts_res.json()
    assert opts["mode"] == "rented_server"
    assert opts["nodes"] == []
    assert opts["public_ips"] == []
    assert opts["cloudflare_zones"] == []
    assert [t["id"] for t in opts["target_servers"]] == [web_srv.id]

    headers = {"X-CSRF-Token": csrf}

    # Ohne target_server_id -> 403 rented_server_required
    missing = client.post(
        f"/api/ai/projects/{proj.id}/publish",
        cookies=cookies,
        headers=headers,
        json={"mode": "frontend"},
    )
    assert missing.status_code == 403
    assert missing.json()["detail"]["code"] == "rented_server_required"

    # Inkompatibler Game-Server -> 403 rented_server_incompatible
    incompat = client.post(
        f"/api/ai/projects/{proj.id}/publish",
        cookies=cookies,
        headers=headers,
        json={"target_server_id": game_srv.id},
    )
    assert incompat.status_code == 403
    assert incompat.json()["detail"]["code"] == "rented_server_incompatible"

    # Fremder Webserver ohne Rechte -> 403 rented_server_forbidden
    forbidden = client.post(
        f"/api/ai/projects/{proj.id}/publish",
        cookies=cookies,
        headers=headers,
        json={"target_server_id": foreign_web.id},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"]["code"] == "rented_server_forbidden"

    # Gueltiger gemieteter Server -> schreibt Dateien & triggert Restart ohne neuen Server anzulegen
    server_count_before = db.query(Server).count()
    with patch(
        "services.server_action_service.request_lifecycle_operation",
        return_value={"task_id": "task-restart-1"},
    ) as restart_mock:
        pub = client.post(
            f"/api/ai/projects/{proj.id}/publish",
            cookies=cookies,
            headers=headers,
            json={"target_server_id": web_srv.id, "release_notes": "v1 live"},
        )
    assert pub.status_code == 200
    body = pub.json()
    assert body["mode"] == "rented_server"
    assert body["deployed_servers"][0]["server_id"] == web_srv.id
    assert (web_dir / "index.html").read_text(encoding="utf-8") == "<h1>Hallo Shop</h1>"
    assert db.query(Server).count() == server_count_before
    restart_mock.assert_called_once()
