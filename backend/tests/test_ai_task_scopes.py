"""Tests fuer das Drei-Stufen-Sichtbarkeitssystem (personal, team, global) bei KI-Auftraegen."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    AiAutonomyGrant,
    AiTask,
    Role,
    RolePermission,
    Team,
    TeamMember,
    User,
)
from models.ai_task import SCOPES
from services import ai_action_service, ai_proposal_service, ai_run_service, ai_task_service
from services.ai_action_errors import AiActionValidationError
from services.auth_service import AuthService
from services.role_service import set_user_roles


BASIS = {
    "title": "Systempruefung",
    "instruction": "Pruefe den Status und fasse knapp zusammen.",
    "kind": "report",
    "plan_kind": "daily",
    "time_of_day": "08:00",
    "timezone": "Europe/Berlin",
    "channel": "chat",
}


def _benutzer(db: Session, name: str, *rechte: str) -> User:
    user = AuthService.create_user(db, name, f"{name}@test.de", "UserPass123!")
    user.email_verified = True
    user.email_notifications = True
    db.commit()
    rolle = Role(name=f"scope-{name}", description=None, is_system=False)
    db.add(rolle)
    db.flush()
    for key in rechte:
        db.add(RolePermission(role_id=rolle.id, permission_key=key))
    db.commit()
    set_user_roles(db, user, [rolle.id])
    db.refresh(user)
    return user


def _login(client: TestClient, username: str, password: str = "UserPass123!") -> tuple[dict, dict]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert resp.status_code == 200
    cookies = dict(resp.cookies)
    csrf = cookies.get("__Secure-csrf_token")
    headers = {"X-CSRF-Token": csrf} if csrf else {}
    return cookies, headers


def _team(
    db: Session,
    owner: User,
    name: str,
    *,
    members: tuple[User, ...] = (),
    personal_for: int | None = None,
) -> Team:
    team = Team(
        name=name,
        owner_user_id=owner.id,
        personal_for_user_id=personal_for,
    )
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="owner"))
    for mitglied in members:
        if mitglied.id != owner.id:
            db.add(TeamMember(team_id=team.id, user_id=mitglied.id, role="member"))
    db.commit()
    db.refresh(team)
    return team


def _katalog(name: str) -> dict:
    for eintrag in ai_action_service.provider_tool_definitions():
        if eintrag["function"]["name"] == name:
            return eintrag["function"]
    raise AssertionError(f"{name} fehlt im Katalog")


def test_katalog_scope_enum_entspricht_datenbank() -> None:
    schema = _katalog("propose_task_set")["parameters"]["properties"]["scope"]
    assert schema["enum"] == list(SCOPES)


def test_personal_aufgabe_standard_und_isolation(client: TestClient, db: Session) -> None:
    alice = _benutzer(db, "alice", "ai.tasks.manage")
    bob = _benutzer(db, "bob", "ai.tasks.manage")
    c_alice, h_alice = _login(client, "alice")
    c_bob, h_bob = _login(client, "bob")

    # Standard-Scope ohne Angabe ist personal
    resp = client.post("/api/ai/tasks", json=BASIS, cookies=c_alice, headers=h_alice)
    assert resp.status_code == 201
    eintrag = resp.json()
    assert eintrag["scope"] == "personal"
    assert eintrag["team_id"] is None
    assert eintrag["created_by"] == "alice"

    # team_id bei scope='personal' wird abgewiesen
    bad = client.post(
        "/api/ai/tasks",
        json={**BASIS, "scope": "personal", "team_id": 123},
        cookies=c_alice,
        headers=h_alice,
    )
    assert bad.status_code == 400

    # Bob sieht Alices persoenliche Aufgabe nicht und darf sie nicht aendern/loeschen
    assert client.get("/api/ai/tasks", cookies=c_bob).json() == []
    assert (
        client.patch(
            f"/api/ai/tasks/{eintrag['task_id']}",
            json={"enabled": False},
            cookies=c_bob,
            headers=h_bob,
        ).status_code
        == 400
    )
    assert (
        client.delete(
            f"/api/ai/tasks/{eintrag['task_id']}",
            cookies=c_bob,
            headers=h_bob,
        ).status_code
        == 400
    )


def test_team_aufgabe_multi_team_und_berechtigung(client: TestClient, db: Session) -> None:
    alice = _benutzer(db, "t_alice", "ai.tasks.manage")
    bob = _benutzer(db, "t_bob", "ai.tasks.manage")
    carol = _benutzer(db, "t_carol", "ai.tasks.manage")
    dave_ohne_recht = _benutzer(db, "t_dave", "ai.chat.use")

    team_a = _team(db, alice, "Team Alpha", members=(bob, dave_ohne_recht))
    team_b = _team(db, alice, "Team Beta", members=(carol,))
    personal_team = _team(db, alice, "Privat", personal_for=alice.id)

    c_alice, h_alice = _login(client, "t_alice")
    c_bob, h_bob = _login(client, "t_bob")
    c_carol, h_carol = _login(client, "t_carol")

    # Persoenliches Ein-Mann-Team oder fremdes Team darf kein scope='team' nutzen
    assert (
        client.post(
            "/api/ai/tasks",
            json={**BASIS, "scope": "team", "team_id": personal_team.id},
            cookies=c_alice,
            headers=h_alice,
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/ai/tasks",
            json={**BASIS, "scope": "team", "team_id": team_a.id},
            cookies=c_carol,
            headers={},
        ).status_code
        in (400, 403, 419)
    )

    # Carol ist Mitglied in Beta, nicht in Alpha -> CSRF gueltig, trotzdem 400
    assert (
        client.post(
            "/api/ai/tasks",
            json={**BASIS, "scope": "team", "team_id": team_a.id},
            cookies=c_carol,
            headers=h_carol,
        ).status_code
        == 400
    )

    # Alice legt Team-Alpha-Aufgabe und Team-Beta-Aufgabe an
    r_a = client.post(
        "/api/ai/tasks",
        json={**BASIS, "title": "Alpha Check", "scope": "team", "team_id": team_a.id},
        cookies=c_alice,
        headers=h_alice,
    )
    assert r_a.status_code == 201
    task_a = r_a.json()
    assert task_a["scope"] == "team"
    assert task_a["team_id"] == team_a.id
    assert task_a["team_name"] == "Team Alpha"
    assert task_a["created_by"] == "t_alice"

    r_b = client.post(
        "/api/ai/tasks",
        json={**BASIS, "title": "Beta Check", "scope": "team", "team_id": team_b.id},
        cookies=c_alice,
        headers=h_alice,
    )
    assert r_b.status_code == 201

    # Alice sieht beide Teams und kann gezielt filtern
    alle_alice = client.get("/api/ai/tasks", cookies=c_alice).json()
    assert {t["title"] for t in alle_alice} == {"Alpha Check", "Beta Check"}
    nur_alpha = client.get(
        f"/api/ai/tasks?scope=team&team_id={team_a.id}", cookies=c_alice
    ).json()
    assert [t["title"] for t in nur_alpha] == ["Alpha Check"]

    # Bob (Mitglied Alpha mit Recht) sieht Alpha, aber nicht Beta; Carol sieht nur Beta
    bob_liste = client.get("/api/ai/tasks", cookies=c_bob).json()
    assert [t["title"] for t in bob_liste] == ["Alpha Check"]
    carol_liste = client.get("/api/ai/tasks", cookies=c_carol).json()
    assert [t["title"] for t in carol_liste] == ["Beta Check"]

    # Bob darf Alpha bearbeiten -> updated_by wird aktualisiert, created_by bleibt Alice
    patch = client.patch(
        f"/api/ai/tasks/{task_a['task_id']}",
        json={"title": "Alpha Check Neu"},
        cookies=c_bob,
        headers=h_bob,
    )
    assert patch.status_code == 200
    updated = patch.json()
    assert updated["title"] == "Alpha Check Neu"
    assert updated["created_by"] == "t_alice"
    assert updated["updated_by"] == "t_bob"

    # Dave (Mitglied Alpha, aber OHNE ai.tasks.manage) sieht Team-Aufgabe auch via list_tasks-Dienst nicht
    assert ai_task_service.auflisten(db, user=dave_ohne_recht) == []


def test_global_aufgabe_nur_mit_recht_und_bestaetigungspflicht(
    client: TestClient, db: Session
) -> None:
    normal = _benutzer(db, "g_normal", "ai.tasks.manage")
    kurator = _benutzer(db, "g_kurator", "ai.tasks.manage", "ai.tasks.manage_global")
    betreiber = _benutzer(db, "g_betreiber", "ai.tasks.manage", "panel.settings.write")

    c_norm, h_norm = _login(client, "g_normal")
    c_kur, h_kur = _login(client, "g_kurator")
    c_op, _ = _login(client, "g_betreiber")

    # Ohne Global-Recht blockiert API und Chat-Vorschlag
    assert (
        client.post(
            "/api/ai/tasks",
            json={**BASIS, "scope": "global"},
            cookies=c_norm,
            headers=h_norm,
        ).status_code
        == 400
    )
    with pytest.raises(AiActionValidationError):
        ai_proposal_service._task_set_payload(db, normal, {**BASIS, "scope": "global"})

    # Mit ai.tasks.manage_global gelingt Anlage
    created = client.post(
        "/api/ai/tasks",
        json={**BASIS, "title": "Panel News", "scope": "global"},
        cookies=c_kur,
        headers=h_kur,
    )
    assert created.status_code == 201
    global_task = created.json()
    assert global_task["scope"] == "global"
    assert global_task["team_id"] is None

    # Normaler Benutzer sieht die globale Aufgabe nicht; Betreiber (panel.settings.write) sieht sie
    assert client.get("/api/ai/tasks", cookies=c_norm).json() == []
    assert client.get("/api/ai/tasks?scope=global", cookies=c_op).json()[0]["title"] == "Panel News"

    # Vorschlagspfad erzwingt always_confirm fuer scope='global' (Anlegen, Aendern, Loeschen)
    _, preview_create = ai_proposal_service._task_set_payload(
        db, kurator, {**BASIS, "scope": "global"}
    )
    assert preview_create["scope"] == "global"
    assert preview_create["always_confirm"] is True

    _, preview_update = ai_proposal_service._task_set_payload(
        db, betreiber, {"task_id": global_task["task_id"], "enabled": False}
    )
    assert preview_update["always_confirm"] is True

    _, preview_delete = ai_proposal_service._task_delete_payload(
        db, betreiber, {"task_id": global_task["task_id"]}
    )
    assert preview_delete["scope"] == "global"
    assert preview_delete["always_confirm"] is True

    # Gegenprobe: persoenlicher Vorschlag setzt kein always_confirm
    _, preview_personal = ai_proposal_service._task_set_payload(db, kurator, dict(BASIS))
    assert preview_personal["scope"] == "personal"
    assert preview_personal.get("always_confirm") is not True


def test_mengengrenze_pro_geltungsbereich_getrennt(db: Session) -> None:
    kurator = _benutzer(db, "quota_kurator", "ai.tasks.manage", "ai.tasks.manage_global")
    team = _team(db, kurator, "Quota Team")

    for idx in range(ai_task_service.MAX_AUFGABEN_JE_BENUTZER):
        ai_task_service.anlegen(
            db, user=kurator, felder={**BASIS, "title": f"Privat {idx}"}
        )
    db.commit()

    # 21. persoenliche Aufgabe scheitert, aber Team und Global bleiben frei
    with pytest.raises(AiActionValidationError):
        ai_task_service.anlegen(db, user=kurator, felder={**BASIS, "title": "Privat 21"})

    team_task = ai_task_service.anlegen(
        db,
        user=kurator,
        felder={**BASIS, "title": "Team frei", "scope": "team", "team_id": team.id},
    )
    global_task = ai_task_service.anlegen(
        db, user=kurator, felder={**BASIS, "title": "Global frei", "scope": "global"}
    )
    db.commit()
    assert db.query(AiTask).filter(AiTask.id == team_task.id).first() is not None
    assert db.query(AiTask).filter(AiTask.id == global_task.id).first() is not None


def test_laufzeit_legt_team_und_global_aufgaben_bei_entzug_still(
    db: Session, monkeypatch
) -> None:
    monkeypatch.setattr(ai_run_service, "http_client", lambda: object())
    alice = _benutzer(
        db, "lauf_alice", "ai.chat.use", "ai.tasks.manage", "ai.tasks.manage_global"
    )
    bob = _benutzer(db, "lauf_bob", "ai.chat.use", "ai.tasks.manage")
    db.add(AiAutonomyGrant(user_id=alice.id, server_id=None, enabled=True, max_actions_per_hour=10))
    db.add(AiAutonomyGrant(user_id=bob.id, server_id=None, enabled=True, max_actions_per_hour=10))
    db.commit()

    team = _team(db, alice, "Run Team", members=(bob,))

    team_task = ai_task_service.anlegen(
        db, user=bob, felder={**BASIS, "title": "Team Lauf", "scope": "team", "team_id": team.id}
    )
    global_task = ai_task_service.anlegen(
        db, user=alice, felder={**BASIS, "title": "Global Lauf", "scope": "global"}
    )
    db.commit()

    # Bob verliert Team-Mitgliedschaft -> Team-Aufgabe wird beim naechsten Takt stillgelegt
    db.query(TeamMember).filter(
        TeamMember.team_id == team.id, TeamMember.user_id == bob.id
    ).delete()
    db.commit()

    assert asyncio.run(ai_task_service.aufgabenlauf_starten(db, aufgabe=team_task)) is None
    db.refresh(team_task)
    assert team_task.enabled is False
    assert team_task.next_run_at is None

    # Alice verliert Global-Recht -> Global-Aufgabe wird beim naechsten Takt stillgelegt
    rolle_ohne_global = Role(name="nur-task", description=None, is_system=False)
    db.add(rolle_ohne_global)
    db.flush()
    for key in ("ai.chat.use", "ai.tasks.manage"):
        db.add(RolePermission(role_id=rolle_ohne_global.id, permission_key=key))
    db.commit()
    set_user_roles(db, alice, [rolle_ohne_global.id])
    db.commit()

    assert asyncio.run(ai_task_service.aufgabenlauf_starten(db, aufgabe=global_task)) is None
    db.refresh(global_task)
    assert global_task.enabled is False
    assert global_task.next_run_at is None
