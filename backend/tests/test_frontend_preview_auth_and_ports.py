"""Tests fuer Team-Preview-Zugriffssteuerung, dynamische Ports und Firewall."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    FrontendDeployment,
    Server,
    ServerPort,
    Team,
    TeamMember,
    TeamMemberRole,
    TeamRole,
    TeamRolePermission,
    TeamRoleServerGrant,
    TeamServerGrant,
    User,
)
from services import frontend_deploy_service


def _create_frontend_with_preview(db: Session, owner: User, tmp_path: Path) -> tuple[Server, FrontendDeployment]:
    srv = Server(
        name="TeamPreviewApp",
        game_type="web_frontend_github",
        install_dir=str(tmp_path / "srv-pv"),
        status="running",
        desired_power_state="running",
        game_port=28080,
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    frontend_deploy_service.get_or_create_settings(db, srv)
    dep = FrontendDeployment(
        server_id=srv.id,
        kind="preview",
        branch="feature/login",
        branch_slug="feature-login",
        status="ready",
        is_live=True,
        port=28101,
        url="http://127.0.0.1:28101",
    )
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return srv, dep


def test_preview_authorize_team_role_plus_server_share_without_server_view(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    regular_user: User,
    user_cookies: dict,
    tmp_path: Path,
) -> None:
    srv, dep = _create_frontend_with_preview(db, owner_user, tmp_path)

    # 1. Nicht angemeldet -> 401 oder 302 Redirect auf Panel-SSO (je nach panel_url)
    r_anon = client.get(
        "/api/frontend-previews/authorize",
        headers={"X-Forwarded-Host": f"127.0.0.1:{dep.port}"},
        follow_redirects=False,
    )
    assert r_anon.status_code in (302, 401)

    # 2. Angemeldet, aber nicht im Team / keine Freigabe -> 403
    r_denied = client.get(
        "/api/frontend-previews/authorize",
        cookies=user_cookies,
        headers={"X-Forwarded-Host": f"127.0.0.1:{dep.port}"},
    )
    assert r_denied.status_code == 403

    # 3. Team + Rolle + Server-Freigabe NUR fuer server.frontend.preview (ohne server.view)
    team = Team(name="Frontend QA", owner_user_id=owner_user.id)
    db.add(team)
    db.flush()
    trole = TeamRole(team_id=team.id, name="Tester")
    db.add(trole)
    db.flush()
    db.add(TeamRolePermission(role_id=trole.id, permission_key="server.frontend.preview"))
    db.add(TeamRoleServerGrant(role_id=trole.id, server_id=srv.id, permission_key="server.frontend.preview"))
    db.add(TeamServerGrant(team_id=team.id, server_id=srv.id, permission_key="server.frontend.preview", granted_by=owner_user.id))
    member = TeamMember(team_id=team.id, user_id=regular_user.id, role="member", team_role_id=trole.id)
    db.add(member)
    db.flush()
    db.add(TeamMemberRole(team_member_id=member.id, team_role_id=trole.id))
    db.commit()

    r_ok = client.get(
        "/api/frontend-previews/authorize",
        cookies=user_cookies,
        headers={"X-Forwarded-Host": f"127.0.0.1:{dep.port}"},
    )
    assert r_ok.status_code == 200
    assert r_ok.headers.get("X-MSM-Preview-User") == regular_user.username

    # 4. Eigentuemer darf immer
    r_owner = client.get(
        "/api/frontend-previews/authorize",
        cookies=owner_cookies,
        headers={"X-Forwarded-Host": f"127.0.0.1:{dep.port}"},
    )
    assert r_owner.status_code == 200

    # 5. Offline-Schalten blockiert auch Vorschau mit 503 und schliesst Ports
    with patch("services.frontend_deploy_service.close_ports") as mock_close:
        frontend_deploy_service.set_online(db, srv, False)
        db.commit()
        assert mock_close.call_count == 1
    r_offline = client.get(
        "/api/frontend-previews/authorize",
        cookies=owner_cookies,
        headers={"X-Forwarded-Host": f"127.0.0.1:{dep.port}"},
    )
    assert r_offline.status_code == 503


def test_preview_port_allocation_limit_evicts_oldest_and_closes_firewall(
    db: Session, tmp_path: Path
) -> None:
    srv = Server(
        name="QuotaPreviewApp",
        game_type="web_frontend_github",
        install_dir=str(tmp_path / "srv-lim"),
        status="running",
        desired_power_state="running",
        game_port=28080,
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)

    # 5 aktive Previews anlegen (Blueprint-Default maxPreviews=5)
    allocated_ports = iter([( "preview", 28201, "tcp"), ("preview", 28202, "tcp"), ("preview", 28203, "tcp"), ("preview", 28204, "tcp"), ("preview", 28205, "tcp"), ("preview", 28206, "tcp")])
    with patch(
        "services.port_allocation_service.allocate_ports",
        side_effect=lambda *_a, **_kw: [next(allocated_ports)],
    ), patch("services.frontend_deploy_service.close_ports") as mock_close:
        deps = []
        for idx in range(5):
            d = frontend_deploy_service.enqueue(db, srv, branch=f"feat/b{idx}", source="push")
            d.status = "ready"
            d.is_live = True
            db.commit()
            deps.append(d)

        # 6. Preview verdraengt die aelteste (feat/b0) und schliesst deren Port
        d6 = frontend_deploy_service.enqueue(db, srv, branch="feat/b5", source="push")
        db.commit()
        assert d6.port == 28206
        db.refresh(deps[0])
        assert deps[0].is_live is False
        assert mock_close.call_count >= 1
        assert (
            db.query(ServerPort)
            .filter(ServerPort.server_id == srv.id, ServerPort.port == 28201)
            .count()
            == 0
        )
