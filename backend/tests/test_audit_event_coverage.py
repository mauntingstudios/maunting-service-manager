"""Die fünf Luecken im zentralen Audit-Protokoll.

Bis 09.11.2026 sah ein Betreiber im Audit weder fehlgeschlagene Anmeldungen
noch gescheiterte KI-Laeufe, Server-Abstuerze, Dokument-Aktionen oder
Geraetekopplungen. Diese Datei haelt fest, dass jede dieser Aktionen jetzt eine
Zeile im Audit hinterlaesst — und dass dabei keine Geheimnisse (Passwort,
Kopplungscode) in den Details landen.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import AiConversation, AiRun, AuditLog, Server, Team, TeamMember, User
from services import guardian_incident_service
from services.ai_stream.lifecycle import _lauf_abschliessen
from services.docs_service import DocsService


def _audit(db: Session, action: str) -> list[AuditLog]:
    db.expire_all()
    return (
        db.query(AuditLog)
        .filter(AuditLog.action == action)
        .order_by(AuditLog.id.asc())
        .all()
    )


def _csrf(cookies: dict) -> dict:
    marke = cookies.get("__Secure-csrf_token")
    return {"X-CSRF-Token": marke} if marke else {}


# ── Anmeldung ─────────────────────────────────────────────────────────


def test_falsches_passwort_landet_mit_grund_im_audit(
    client: TestClient, db: Session, regular_user: User
) -> None:
    antwort = client.post(
        "/api/auth/login",
        json={"username": regular_user.username, "password": "falsches-Passwort"},
    )
    assert antwort.status_code == 401

    eintraege = _audit(db, "auth.login.failed")
    assert len(eintraege) == 1
    assert eintraege[0].user_id is None
    assert eintraege[0].target_type == "user"
    assert eintraege[0].target_id == str(regular_user.id)
    assert "bad_password" in (eintraege[0].details or "")
    # Das eingegebene Passwort und der Benutzername stehen nicht in den Details.
    assert "falsches-Passwort" not in (eintraege[0].details or "")
    assert regular_user.username not in (eintraege[0].details or "")


def test_inaktiver_account_landet_mit_grund_im_audit(
    client: TestClient, db: Session, inactive_user: User
) -> None:
    antwort = client.post(
        "/api/auth/login",
        json={"username": inactive_user.username, "password": "Inactive123!"},
    )
    assert antwort.status_code == 401

    eintraege = _audit(db, "auth.login.failed")
    assert len(eintraege) == 1
    assert eintraege[0].target_id == str(inactive_user.id)
    assert "inactive" in (eintraege[0].details or "")


def test_unbekannter_benutzer_wird_ohne_rateversuch_protokolliert(
    client: TestClient, db: Session
) -> None:
    antwort = client.post(
        "/api/auth/login",
        json={"username": "gibt-es-nicht-audit", "password": "egal"},
    )
    assert antwort.status_code == 401

    eintraege = _audit(db, "auth.login.failed")
    assert len(eintraege) == 1
    assert eintraege[0].target_type is None
    assert eintraege[0].target_id is None
    assert "unknown_user" in (eintraege[0].details or "")
    assert "gibt-es-nicht-audit" not in (eintraege[0].details or "")


# ── Geraetekopplung ──────────────────────────────────────────────────


def test_geraetekopplung_erzeugen_und_einloesen_im_audit(
    client: TestClient, db: Session, owner_user: User, owner_cookies: dict
) -> None:
    erzeugt = client.post(
        "/api/auth/devices/pairing",
        json={"label": "Audit-Test", "password": "OwnerPass123!"},
        cookies=owner_cookies,
        headers=_csrf(owner_cookies),
    )
    assert erzeugt.status_code == 200, erzeugt.text
    code = erzeugt.json()["code"]

    erzeugt_audit = _audit(db, "device.pairing.generated")
    assert len(erzeugt_audit) == 1
    assert erzeugt_audit[0].user_id == owner_user.id
    assert erzeugt_audit[0].target_type == "device_pairing"
    assert code not in (erzeugt_audit[0].details or "")

    eingeloest = client.post(
        "/api/auth/devices/redeem",
        json={"code": code, "label": "Laptop", "geraet": "desktop"},
    )
    assert eingeloest.status_code == 200, eingeloest.text
    eingeloest_audit = _audit(db, "device.pairing.redeemed")
    assert len(eingeloest_audit) == 1
    assert eingeloest_audit[0].user_id == owner_user.id
    assert "desktop" in (eingeloest_audit[0].details or "")
    assert code not in (eingeloest_audit[0].details or "")

    ungueltig = client.post(
        "/api/auth/devices/redeem", json={"code": "ZZZZ-ZZZZ-ZZZZ"}
    )
    assert ungueltig.status_code == 400
    fehlversuch = _audit(db, "device.pairing.failed")
    assert len(fehlversuch) == 1
    assert "invalid_or_expired" in (fehlversuch[0].details or "")
    assert "ZZZZ-ZZZZ-ZZZZ" not in (fehlversuch[0].details or "")


# ── KI-Lauf ──────────────────────────────────────────────────────────


def test_gescheiterter_ki_lauf_landet_mit_fehlercode_im_audit(
    db: Session, owner_user: User
) -> None:
    conversation = AiConversation(id=str(uuid4()), user_id=owner_user.id, title="Audit")
    db.add(conversation)
    db.commit()
    run = AiRun(
        id=str(uuid4()),
        conversation_id=conversation.id,
        user_id=owner_user.id,
        status="running",
    )
    db.add(run)
    db.commit()

    _lauf_abschliessen(run.id, status="failed", stop_reason="AI_RATE_LIMIT")

    eintraege = _audit(db, "ai.run.failed")
    assert len(eintraege) == 1
    assert eintraege[0].user_id == owner_user.id
    assert eintraege[0].target_type == "ai_run"
    assert eintraege[0].target_id == run.id
    assert "AI_RATE_LIMIT" in (eintraege[0].details or "")

    db.expire_all()
    assert db.get(AiRun, run.id).status == "failed"


# ── Server-Vorfall ───────────────────────────────────────────────────


def _server(db: Session, name: str = "Crash-Test") -> Server:
    server = Server(
        name=name,
        game_type="minecraft",
        install_dir=f"/tmp/{name}",
        status="running",
        container_name="msm-crash-audit",
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


def _incident(server: Server, incident_uuid: str, *, status: str = "open") -> dict:
    return {
        "uuid": incident_uuid,
        "server_id": server.id,
        "type": "linux-oom",
        "status": status,
        "fingerprint": f"guardian:{server.id}:linux-oom",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "payload": {
            "schema_version": 1,
            "message": "Guardian detected an unhealthy server state",
            "diagnostic": {"evidence": "verified OOM signature"},
            "attempts": [],
        },
    }


def test_server_vorfall_erkannt_wiederholt_und_behoben(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "services.guardian_incident_service._notify_guardian_incident",
        lambda *_args, **_kwargs: None,
    )
    server = _server(db)
    node_client = MagicMock()
    erster_uuid = str(uuid4())

    guardian_incident_service.ingest_incidents_and_ack(
        db, server, node_client, "msm-crash-audit", [_incident(server, erster_uuid)]
    )
    erkannt = _audit(db, "server.incident.detected")
    assert len(erkannt) == 1
    assert erkannt[0].target_type == "server"
    assert erkannt[0].target_id == str(server.id)
    assert "linux-oom" in (erkannt[0].details or "")
    assert "verified OOM signature" in (erkannt[0].details or "")

    zweiter_uuid = str(uuid4())
    guardian_incident_service.ingest_incidents_and_ack(
        db, server, node_client, "msm-crash-audit", [_incident(server, zweiter_uuid)]
    )
    wiederholt = _audit(db, "server.incident.recurred")
    assert len(wiederholt) == 1
    assert '"occurrences": 2' in (wiederholt[0].details or "")

    guardian_incident_service.ingest_incidents_and_ack(
        db, server, node_client, "msm-crash-audit", [_incident(server, erster_uuid, status="resolved")]
    )
    behoben = _audit(db, "server.incident.resolved")
    assert len(behoben) == 1
    assert behoben[0].target_id == str(server.id)


# ── Dokumente ────────────────────────────────────────────────────────


def _docs_team(db: Session, owner: User) -> Team:
    team = Team(name=f"Audit-Docs-{owner.id}", owner_user_id=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="owner", added_by=owner.id))
    db.commit()
    db.refresh(team)
    return team


def test_dokument_erstellen_papierkorb_wiederherstellen_duplizieren_loeschen(
    db: Session, owner_user: User
) -> None:
    team = _docs_team(db, owner_user)
    dokument = DocsService.create_document(db, owner_user, team_id=team.id, title="Audit")
    uid = dokument["uid"]

    assert len(_audit(db, "docs.document.created")) == 1

    DocsService.trash_document(db, owner_user, uid)
    assert len(_audit(db, "docs.document.trashed")) == 1

    DocsService.restore_document(db, owner_user, uid)
    assert len(_audit(db, "docs.document.restored")) == 1

    kopie = DocsService.duplicate_document(db, owner_user, uid)
    dupliziert = _audit(db, "docs.document.duplicated")
    assert len(dupliziert) == 1
    assert dupliziert[0].target_id == kopie["uid"]
    assert uid in (dupliziert[0].details or "")

    DocsService.delete_permanent(db, owner_user, uid)
    geloescht = _audit(db, "docs.document.deleted")
    assert len(geloescht) == 1
    assert geloescht[0].target_id == uid
    # Der Titel steht nicht im Audit.
    assert "Audit" not in (geloescht[0].details or "")


def test_verweigerter_dokumentzugriff_landet_im_audit(
    db: Session, owner_user: User, regular_user: User
) -> None:
    team = _docs_team(db, owner_user)
    db.add(
        TeamMember(
            team_id=team.id,
            user_id=regular_user.id,
            role="member",
            added_by=owner_user.id,
        )
    )
    db.commit()
    dokument = DocsService.create_document(db, owner_user, team_id=team.id)

    with pytest.raises(HTTPException) as verweigert:
        DocsService.trash_document(db, regular_user, dokument["uid"])
    assert verweigert.value.status_code == 403

    eintraege = _audit(db, "docs.access.denied")
    assert len(eintraege) == 1
    assert eintraege[0].user_id == regular_user.id
    assert eintraege[0].target_type == "document"
    assert eintraege[0].target_id == dokument["uid"]
    assert "manage" in (eintraege[0].details or "")

    # Ein Rechtefehler im Dokumente-Modul zaehlt in der Uebersicht als
    # sicherheitsrelevant, auch wenn seine Kategorie `docs` ist.
    from services import audit_service

    uebersicht = audit_service.audit_uebersicht(db, tage=1)
    assert uebersicht["current"]["security"] >= 1
