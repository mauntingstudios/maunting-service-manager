"""Team-, Teamrollen- und Servergrant-Werkzeuge fuer die KI + Batch-Sync-API.

Prueft den gesamten Lebenszyklus ueber den echten Proposal- und Ausfuehrungspfad:
- `list_teams` und `read_team_overview`: Mitglieder, Praesenz ("was macht das Team gerade"),
  Team-Rollen, Server-Grants, delegierbare Server, Kataloge und unscharfe Namensaufloesung.
- Autonomer Modus: Anlegen, Bearbeiten, Rollenzuweisung, Einladen und Server-Freigaben
  laufen mit aktiver Freigabe sofort (`autonomous=True`, `requires_confirmation=False`);
  Loeschen (`propose_team_role_delete`) und Entfernen (`propose_team_member_remove`)
  verlangen **immer** eine Bestaetigungskarte.
- Decke & Isolation: Nichtmitglieder und fehlende Teamrechte werden vor dem Payload-Bau
  abgewiesen; niemand vergibt mehr Serverrechte als er (und der Gruender) direkt haelt;
  Revisionskonflikte zwischen Vorschlag und Ausfuehrung brechen sicher ab.
- Batch-Endpoint `PUT /api/teams/{id}/servers/batch` & Router-Gruppentrennung (`teams` vs `users`).
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    AiConversation,
    Role,
    RolePermission,
    Server,
    ServerPermission,
    Team,
    TeamMember,
    TeamRole,
    User,
)
from services import (
    ai_autonomy_service,
    ai_proposal_service,
    ai_tool_registry,
    team_service,
)
from services.ai_action_errors import AiActionStateError, AiActionValidationError
from services.ai_tools import team_tools
from services.auth_service import AuthService
from services.role_service import set_user_roles
from services.social_service import SocialService


def _server(db: Session, name: str) -> Server:
    srv = Server(
        name=name,
        game_type="dayz",
        install_dir=f"/tmp/{name}-{uuid4().hex[:6]}",
        status="stopped",
        container_name=f"msm-{name}-{uuid4().hex[:6]}",
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    return srv


def _konto(db: Session, name: str, *global_keys: str, autonom: bool = False) -> User:
    user = AuthService.create_user(db, name, f"{name}@test.de", "TeamAiPass123!")
    user.email_verified = True
    rechte = ["ai.chat.use", *global_keys]
    if autonom:
        rechte.append("ai.autonomous.use")
    rolle = Role(name=f"r-{name}-{uuid4().hex[:6]}", is_system=False)
    db.add(rolle)
    db.flush()
    for key in rechte:
        db.add(RolePermission(role_id=rolle.id, permission_key=key))
    db.commit()
    set_user_roles(db, user, [rolle.id])
    if autonom:
        ai_autonomy_service.set_grant(
            db,
            user=user,
            server_id=None,
            enabled=True,
            max_actions_per_hour=50,
            granted_by=user.id,
        )
    db.refresh(user)
    return user


def _allow(db: Session, user: User, server: Server, *keys: str) -> None:
    for key in keys:
        db.add(ServerPermission(user_id=user.id, server_id=server.id, permission_key=key))
    db.commit()


def _conv(db: Session, user: User) -> AiConversation:
    c = AiConversation(id=str(uuid4()), user_id=user.id, server_id=None, title="Teams KI")
    db.add(c)
    db.commit()
    return c


def _confirm_and_execute(db: Session, proposal_id: str, actor: User):
    prop, token = ai_proposal_service.confirm_proposal(db, proposal_id=proposal_id, user=actor)
    return ai_proposal_service.execute_proposal(
        db, proposal_id=prop.id, user=actor, confirmation_token=token
    )


def test_team_read_tools_presence_and_fuzzy_resolution(db: Session) -> None:
    founder = _konto(db, "alice", "teams.create", autonom=True)
    member = _konto(db, "bobby")
    srv_mc = _server(db, "Minecraft-Survival")
    srv_vh = _server(db, "Valheim-Prod")
    _allow(db, founder, srv_mc, "server.view", "server.console.read", "server.start")
    _allow(db, founder, srv_vh, "server.view", "server.stop")

    team = team_service.create_team(db, user=founder, name="AlphaOps")
    team_service.invite_member(
        db,
        team=team,
        user=founder,
        new_user_id=member.id,
        can_manage_skills=False,
        can_manage_memory=False,
    )
    team_service.accept_invitation(db, user=member, team_id=team.id)
    SocialService.upsert_session(
        db,
        member.id,
        geraet="web-1",
        client="web",
        plattform="web",
        zustand="away",
        activity_key="chat",
        vorn=True,
    )

    listed = team_tools._execute_list_teams(db, founder, {})
    assert any(t["team_id"] == team.id and t["name"] == "AlphaOps" for t in listed["teams"])

    overview = team_tools._execute_read_team_overview(
        db,
        founder,
        {
            "team": "alpha",
            "member_queries": ["bob"],
            "server_queries": ["mine"],
            "role_queries": ["mitg"],
        },
    )
    assert overview["team_id"] == team.id
    members_by_id = {m["user_id"]: m for m in overview["members"]}
    assert members_by_id[member.id]["presence"] is not None
    assert members_by_id[member.id]["presence"]["status"] == "away"

    assert overview["resolved"]["members"][0]["status"] in {"exact", "unique"}
    assert overview["resolved"]["members"][0]["match"]["user_id"] == member.id
    assert overview["resolved"]["servers"][0]["match"]["server_id"] == srv_mc.id
    assert overview["resolved"]["roles"][0]["match"]["name"] == "Mitglied"
    assert "server_permissions" in overview and "team_permissions" in overview


def test_team_autonomous_create_role_all_servers_and_assign_member(db: Session) -> None:
    founder = _konto(db, "founder", "teams.create", autonom=True)
    mate = _konto(db, "mate")
    srv_a = _server(db, "Server-A")
    srv_b = _server(db, "Server-B")
    _allow(db, founder, srv_a, "server.view", "server.console.read", "server.start")
    _allow(db, founder, srv_b, "server.view", "server.stop")
    conv = _conv(db, founder)

    # 1. Team autonom anlegen
    create_prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_create",
        arguments={
            "name": "RaidCrew",
            "reason": "Neues Team fuer Raid-Abende anlegen",
            "expected_effect": "Team RaidCrew entsteht",
        },
        correlation_id=str(uuid4()),
    )
    assert create_prop.autonomous is True
    assert create_prop.requires_confirmation is False
    exec_create, created_res = ai_proposal_service.execute_autonomously(
        db, proposal_id=create_prop.id, user=founder
    )
    assert exec_create.status == "succeeded"
    team_id = created_res["team_id"]
    team = db.get(Team, team_id)
    assert team is not None

    team_service.invite_member(
        db, team=team, user=founder, new_user_id=mate.id,
        can_manage_skills=False, can_manage_memory=False,
    )
    team_service.accept_invitation(db, user=mate, team_id=team.id)

    # 2. Team-Rolle autonom ueber alle delegierbaren Server erstellen
    role_prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_role_set",
        arguments={
            "team_id": team.id,
            "name": "Beobachter",
            "team_permissions": ["team.members.invite"],
            "all_servers_permissions": ["server.view", "server.console.read"],
            "mode": "replace",
            "reason": "Lese-Rolle fuer Logs auf allen Servern anlegen",
            "expected_effect": "Rolle Beobachter entsteht mit passenden Serverrechten",
        },
        correlation_id=str(uuid4()),
    )
    assert role_prop.autonomous is True
    assert role_prop.requires_confirmation is False
    exec_role, role_res = ai_proposal_service.execute_autonomously(
        db, proposal_id=role_prop.id, user=founder
    )
    assert exec_role.status == "succeeded"
    role_id = role_res["role_id"]

    db.expire_all()
    role = db.get(TeamRole, role_id)
    assert role is not None
    grants_by_srv: dict[int, set[str]] = {}
    for g in role.server_grants:
        grants_by_srv.setdefault(g.server_id, set()).add(g.permission_key)
    # Server-A erlaubt server.console.read (+ automatisches server.view), Server-B hat nur server.view
    assert grants_by_srv[srv_a.id] == {"server.view", "server.console.read"}
    assert grants_by_srv[srv_b.id] == {"server.view"}

    # 3. Mitglied die neue Rolle autonom zuweisen
    assign_prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_member_roles",
        arguments={
            "team_id": team.id,
            "user_id": mate.id,
            "role_ids": [role_id],
            "mode": "replace",
            "reason": "Mitglied der Beobachter-Rolle zuordnen",
            "expected_effect": "mate traegt nur noch Rolle Beobachter",
        },
        correlation_id=str(uuid4()),
    )
    assert assign_prop.autonomous is True
    assert assign_prop.requires_confirmation is False
    exec_assign, _ = ai_proposal_service.execute_autonomously(
        db, proposal_id=assign_prop.id, user=founder
    )
    assert exec_assign.status == "succeeded"
    member_row = db.query(TeamMember).filter_by(team_id=team.id, user_id=mate.id).first()
    assert member_row is not None
    assert team_service.get_member_role_ids(db, member_row.id, member_row.team_role_id) == [role_id]


def test_team_deletions_always_confirm_even_in_autonomous_mode(db: Session) -> None:
    founder = _konto(db, "owner_del", "teams.create", autonom=True)
    mate = _konto(db, "mate_del")
    conv = _conv(db, founder)

    team = team_service.create_team(db, user=founder, name="CleanTeam")
    role = team_service.create_team_role(db, team=team, user=founder, name="TempRolle")
    team_service.invite_member(
        db, team=team, user=founder, new_user_id=mate.id,
        can_manage_skills=False, can_manage_memory=False,
    )
    team_service.accept_invitation(db, user=mate, team_id=team.id)

    # Rolle loeschen: muss trotz autonomem Modus fragen
    del_role_prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_role_delete",
        arguments={
            "team_id": team.id,
            "role_id": role.id,
            "reason": "Nicht mehr benoetigte Rolle entfernen",
            "expected_effect": "Rolle TempRolle wird geloescht",
        },
        correlation_id=str(uuid4()),
    )
    assert del_role_prop.status == "proposed"
    assert del_role_prop.requires_confirmation is True
    assert del_role_prop.autonomous is False
    exec_role, _ = _confirm_and_execute(db, del_role_prop.id, founder)
    assert exec_role.status == "succeeded"
    assert db.get(TeamRole, role.id) is None

    # Mitglied entfernen: muss trotz autonomem Modus fragen
    del_member_prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_member_remove",
        arguments={
            "team_id": team.id,
            "user_id": mate.id,
            "reason": "Mitglied hat das Projekt verlassen",
            "expected_effect": "mate wird aus CleanTeam entfernt",
        },
        correlation_id=str(uuid4()),
    )
    assert del_member_prop.status == "proposed"
    assert del_member_prop.requires_confirmation is True
    assert del_member_prop.autonomous is False
    exec_member, _ = _confirm_and_execute(db, del_member_prop.id, founder)
    assert exec_member.status == "succeeded"
    assert db.query(TeamMember).filter_by(team_id=team.id, user_id=mate.id).first() is None


def test_team_autonomy_off_invite_and_server_grants_flow(db: Session) -> None:
    founder = _konto(db, "manual_owner", "teams.create", autonom=False)
    invitee = _konto(db, "invitee")
    srv_1 = _server(db, "Manual-1")
    srv_2 = _server(db, "Manual-2")
    _allow(db, founder, srv_1, "server.view", "server.start")
    _allow(db, founder, srv_2, "server.view", "server.start")
    conv = _conv(db, founder)
    team = team_service.create_team(db, user=founder, name="ManualOps")

    invite_prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_member_invite",
        arguments={
            "team_id": team.id,
            "user_id": invitee.id,
            "reason": "Neues Mitglied einladen",
            "expected_effect": "Einladung an invitee geht raus",
        },
        correlation_id=str(uuid4()),
    )
    assert invite_prop.status == "proposed"
    assert invite_prop.requires_confirmation is True
    exec_inv, _ = _confirm_and_execute(db, invite_prop.id, founder)
    assert exec_inv.status == "succeeded"

    grants_prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_server_grants",
        arguments={
            "team_id": team.id,
            "all_servers": True,
            "permissions": ["server.start"],
            "mode": "replace",
            "server_roles_active": True,
            "reason": "Alle delegierbaren Server auf Start-Recht setzen und Rollenmodus aktivieren",
            "expected_effect": "Beide Server freigegeben und Rollenmodus aktiv",
        },
        correlation_id=str(uuid4()),
    )
    assert grants_prop.status == "proposed"
    assert grants_prop.requires_confirmation is True
    exec_grants, _ = _confirm_and_execute(db, grants_prop.id, founder)
    assert exec_grants.status == "succeeded"

    db.expire_all()
    refreshed = db.get(Team, team.id)
    assert refreshed is not None and refreshed.server_roles_active is True
    assert set(team_service.team_server_keys(db, team.id, srv_1.id)) == {"server.view", "server.start"}
    assert set(team_service.team_server_keys(db, team.id, srv_2.id)) == {"server.view", "server.start"}


def test_team_security_isolation_ceiling_and_revision_conflict(db: Session) -> None:
    founder = _konto(db, "sec_owner", "teams.create", autonom=False)
    outsider = _konto(db, "outsider")
    plain_member = _konto(db, "plain")
    srv = _server(db, "Guarded")
    _allow(db, founder, srv, "server.view")
    team = team_service.create_team(db, user=founder, name="GuardedTeam")
    team_service.invite_member(
        db, team=team, user=founder, new_user_id=plain_member.id,
        can_manage_skills=False, can_manage_memory=False,
    )
    team_service.accept_invitation(db, user=plain_member, team_id=team.id)

    # Nichtmitglied darf Team nicht lesen oder Vorschlag bauen
    with pytest.raises(AiActionValidationError):
        team_tools._execute_read_team_overview(db, outsider, {"team_id": team.id})
    with pytest.raises(AiActionValidationError):
        ai_proposal_service.create_proposal(
            db,
            user=outsider,
            conversation=_conv(db, outsider),
            tool_name="propose_team_role_set",
            arguments={
                "team_id": team.id,
                "name": "Hacker",
                "reason": "Unbefugter Test",
                "expected_effect": "Muss scheitern",
            },
            correlation_id=str(uuid4()),
        )

    # Mitglied ohne team.roles.manage darf keine Rolle vorschlagen
    with pytest.raises(AiActionValidationError):
        ai_proposal_service.create_proposal(
            db,
            user=plain_member,
            conversation=_conv(db, plain_member),
            tool_name="propose_team_role_set",
            arguments={
                "team_id": team.id,
                "name": "OhneRecht",
                "reason": "Test ohne Rollenverwaltungsrecht",
                "expected_effect": "Muss scheitern",
            },
            correlation_id=str(uuid4()),
        )

    # Gruender darf kein Serverrecht vergeben, das er selbst nicht haelt
    conv = _conv(db, founder)
    with pytest.raises(AiActionValidationError):
        ai_proposal_service.create_proposal(
            db,
            user=founder,
            conversation=conv,
            tool_name="propose_team_role_set",
            arguments={
                "team_id": team.id,
                "name": "Ueberzogen",
                "server_grants": [{"server_id": srv.id, "permissions": ["server.console.exec"]}],
                "reason": "Rechteeskalation pruefen",
                "expected_effect": "Muss scheitern",
            },
            correlation_id=str(uuid4()),
        )

    # Revisionskonflikt greift, wenn eine Rolle zwischen Vorschlag und Klick geaendert wird
    role = team_service.create_team_role(db, team=team, user=founder, name="KonfliktRolle")
    prop = ai_proposal_service.create_proposal(
        db,
        user=founder,
        conversation=conv,
        tool_name="propose_team_role_set",
        arguments={
            "team_id": team.id,
            "role_id": role.id,
            "description": "Neuer Text",
            "reason": "Revisionsschutz pruefen",
            "expected_effect": "Schlaegt bei Zwischenaenderung fehl",
        },
        correlation_id=str(uuid4()),
    )
    team_service.update_team_role(db, team=team, user=founder, role_id=role.id, name="ZwischendurchGeaendert")
    with pytest.raises(AiActionStateError) as exc_info:
        _confirm_and_execute(db, prop.id, founder)
    assert exc_info.value.code == "AI_ACTION_REVISION_CONFLICT"


def test_team_batch_grants_endpoint_and_tool_group_separation(
    db: Session, client: TestClient, owner_user: User, owner_cookies: dict
) -> None:
    srv1 = _server(db, "Batch-One")
    srv2 = _server(db, "Batch-Two")
    team = team_service.create_team(db, user=owner_user, name="BatchTeam")

    resp = client.put(
        f"/api/teams/{team.id}/servers/batch",
        json={
            "grants": [
                {"server_id": srv1.id, "permission_keys": ["server.view", "server.start"]},
                {"server_id": srv2.id, "permission_keys": ["server.view"]},
            ]
        },
        headers={"X-CSRF-Token": owner_cookies.get("__Secure-csrf_token", "")},
        cookies=owner_cookies,
    )
    assert resp.status_code == 200, resp.text
    by_sid = {s["server_id"]: set(s["permission_keys"]) for s in resp.json()["servers"]}
    assert by_sid[srv1.id] == {"server.view", "server.start"}
    assert by_sid[srv2.id] == {"server.view"}

    # Werkzeug-Gruppen sauber von globalen Panel-Rollen getrennt
    for name in (
        "list_teams",
        "read_team_overview",
        "propose_team_create",
        "propose_team_role_set",
        "propose_team_role_delete",
        "propose_team_member_roles",
        "propose_team_member_invite",
        "propose_team_member_remove",
        "propose_team_server_grants",
    ):
        assert ai_tool_registry.WERKZEUGE[name].gruppe == "teams"
    for panel_name in ("list_roles", "propose_role_set", "propose_user_roles", "propose_role_delete"):
        assert ai_tool_registry.WERKZEUGE[panel_name].gruppe == "users"
