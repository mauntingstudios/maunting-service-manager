"""Tests fuer separate KI-Projekt-Kontingente (`RoleAiProjectQuota`) und Durchsetzung."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Role, RoleAiProjectQuota, RolePermission
from services import ai_project_quota_service, ai_project_service, role_service
from services.auth_service import AuthService


def _login(client: TestClient, username: str, password: str) -> tuple[dict, str]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert resp.status_code == 200
    cookies = dict(resp.cookies)
    return cookies, cookies.get("__Secure-csrf_token") or ""


def test_role_ai_project_quota_crud_and_multi_role_resolution(
    client: TestClient, db: Session, owner_cookies: dict, csrf_token: str | None
):
    role_a = Role(name=f"qa-{uuid4().hex[:6]}", is_system=False)
    role_b = Role(name=f"qb-{uuid4().hex[:6]}", is_system=False)
    db.add_all([role_a, role_b])
    db.commit()

    headers = {"X-CSRF-Token": csrf_token or ""}
    put_a = client.put(
        f"/api/roles/{role_a.id}/ai-project-quota",
        cookies=owner_cookies,
        headers=headers,
        json={"max_projects": 2, "max_storage_mb": 64},
    )
    assert put_a.status_code == 200
    assert put_a.json() == {"max_projects": 2, "max_storage_mb": 64}

    get_a = client.get(f"/api/roles/{role_a.id}/ai-project-quota", cookies=owner_cookies)
    assert get_a.status_code == 200
    assert get_a.json() == {"max_projects": 2, "max_storage_mb": 64}

    # Zweite Rolle mit 0 (= unbegrenzt) gewinnt bei Mehrfachrollen
    db.add(RoleAiProjectQuota(role_id=role_b.id, max_projects=0, max_storage_mb=512))
    db.commit()

    user = AuthService.create_user(
        db, f"qu-{uuid4().hex[:6]}", f"qu-{uuid4().hex[:6]}@test.de", "QuotaPass123!"
    )
    role_service.set_user_roles(db, user, [role_a.id])
    eff1 = ai_project_quota_service.get_effective_user_quota(db, user)
    assert eff1["max_projects"] == 2
    assert eff1["max_storage_mb"] == 64

    role_service.set_user_roles(db, user, [role_a.id, role_b.id])
    eff2 = ai_project_quota_service.get_effective_user_quota(db, user)
    assert eff2["max_projects"] == 0
    assert eff2["unlimited_projects"] is True
    assert eff2["max_storage_mb"] == 512


def test_ai_project_count_and_storage_quota_enforcement(
    client: TestClient, db: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))
    uname = f"qlim-{uuid4().hex[:6]}"
    pw = "QuotaLim123!"
    user = AuthService.create_user(db, uname, f"{uname}@test.de", pw)
    user.email_verified = True
    role = Role(name=f"ql-{uuid4().hex[:6]}", is_system=False)
    db.add(role)
    db.flush()
    for key in ("ai.projects.manage", "ai.coding.use"):
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.add(RoleAiProjectQuota(role_id=role.id, max_projects=1, max_storage_mb=1))
    db.commit()
    role_service.set_user_roles(db, user, [role.id])

    cookies, csrf = _login(client, uname, pw)
    headers = {"X-CSRF-Token": csrf}

    # 1. Projekt darf angelegt werden
    p1 = client.post(
        "/api/ai/projects",
        cookies=cookies,
        headers=headers,
        json={"name": "Erstes Projekt", "project_kind": "coding"},
    )
    assert p1.status_code == 201
    proj_id = p1.json()["id"]

    # 2. Projekt wird durch max_projects=1 blockiert -> 403 project_count_limit_reached
    p2 = client.post(
        "/api/ai/projects",
        cookies=cookies,
        headers=headers,
        json={"name": "Zweites Projekt", "project_kind": "coding"},
    )
    assert p2.status_code == 403
    assert p2.json()["detail"]["code"] == "project_count_limit_reached"

    # Speicher-Limit (1 MB): Drei Schreibvorgaenge a 450 KB -> dritter ueberschreitet 1 MB
    big_chunk = "x" * (450 * 1024)
    w1 = client.post(
        f"/api/ai/projects/{proj_id}/files",
        cookies=cookies,
        headers=headers,
        json={"path": "a.txt", "content": big_chunk},
    )
    assert w1.status_code == 200
    w2 = client.post(
        f"/api/ai/projects/{proj_id}/files",
        cookies=cookies,
        headers=headers,
        json={"path": "b.txt", "content": big_chunk},
    )
    assert w2.status_code == 200
    w3 = client.post(
        f"/api/ai/projects/{proj_id}/files",
        cookies=cookies,
        headers=headers,
        json={"path": "c.txt", "content": big_chunk},
    )
    assert w3.status_code == 403
    assert w3.json()["detail"]["code"] == "project_storage_limit_reached"

    # Quota-Endpunkt meldet aktuelle Nutzung sauber
    summary = client.get("/api/ai/projects/quota", cookies=cookies)
    assert summary.status_code == 200
    sjson = summary.json()
    assert sjson["project_count"] == 1
    assert sjson["max_projects"] == 1
    assert sjson["max_storage_mb"] == 1
    assert sjson["used_bytes"] >= 900 * 1024

    # Datei loeschen bzw. schrumpfen bleibt moeglich; Owner bleibt unbegrenzt
    ai_project_service.delete_project_file(db, user, proj_id, "b.txt")
    quota_after = client.get("/api/ai/projects/quota", cookies=cookies).json()
    assert quota_after["used_bytes"] < 500 * 1024
