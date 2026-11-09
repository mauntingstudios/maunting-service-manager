"""Audit-Suche, Kennzahlen und die beiden KI-Werkzeuge.

Prueft drei Zusagen, die zusammen die neue Oberflaeche tragen:

* Filter und Gesamtzahl beschreiben dieselbe Menge (nicht die Seite allein),
* die Anzeige bekommt Benutzer- und Zielnamen statt nur Kennungen,
* die KI kommt nur mit `system.audit.read` an das Protokoll und sieht keine
  Secrets.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Server, User
from services import ai_action_service, ai_tool_spec, audit_service
from services.ai_action_errors import AiActionValidationError
from services.ai_tools.server_tools import angebotene_werkzeuge
from services.tool_selection_port import DOMAIN_PACKS


def _server(db: Session, name: str = "DayZ – Namalsk") -> Server:
    server = Server(
        name=name,
        game_type="dayz",
        install_dir=f"/tmp/{name}",
        status="stopped",
        container_name="msm-dayz",
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


def _eintrag(
    db: Session,
    user: User,
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | int | None = None,
    details: dict | None = None,
    when: datetime | None = None,
):
    entry = audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
        commit=True,
    )
    if when is not None:
        entry.created_at = when
        db.commit()
        db.refresh(entry)
    return entry


def test_neue_sicherheitsereignisse_werden_eingeordnet() -> None:
    assert audit_service.audit_kategorie("auth.login.failed") == "security"
    assert audit_service.audit_kategorie("device.pairing.generated") == "security"
    assert audit_service.audit_kategorie("docs.access.denied") == "docs"
    assert audit_service.audit_sicherheitsrelevant("docs.access.denied") is True
    assert audit_service.audit_ergebnis("docs.access.denied", None) == "failed"
    assert audit_service.audit_ergebnis("device.pairing.failed", None) == "failed"
    assert audit_service.audit_ergebnis("server.incident.detected", None) == "success"


def test_filter_und_gesamtzahl_beschreiben_dieselbe_menge(
    client: TestClient, db: Session, owner_user: User, owner_cookies: dict
) -> None:
    server = _server(db)
    jetzt = datetime.now(timezone.utc)
    _eintrag(
        db,
        owner_user,
        "server.lifecycle.completed",
        target_type="server",
        target_id=server.id,
        details={"task_id": 42, "operation": "restart"},
        when=jetzt,
    )
    _eintrag(
        db,
        owner_user,
        "server.lifecycle.failed",
        target_type="server",
        target_id=server.id,
        details={"task_id": 43, "operation": "restart", "error_code": "timeout"},
        when=jetzt - timedelta(hours=1),
    )
    _eintrag(
        db,
        owner_user,
        "auth.password.change",
        when=jetzt - timedelta(days=30),
    )

    antwort = client.get(
        "/api/admin/audit-logs?days=7&limit=10&search=Namalsk",
        cookies=owner_cookies,
    )
    assert antwort.status_code == 200, antwort.text
    daten = antwort.json()
    assert daten["total"] == 2
    assert len(daten["items"]) == 2
    assert {eintrag["result"] for eintrag in daten["items"]} == {"success", "failed"}
    assert all(eintrag["username"] == owner_user.username for eintrag in daten["items"])
    assert all(eintrag["target_label"] == server.name for eintrag in daten["items"])
    assert all(eintrag["category"] == "server" for eintrag in daten["items"])

    nach_benutzer = client.get(
        "/api/admin/audit-logs?days=7&search=owner",
        cookies=owner_cookies,
    ).json()
    assert nach_benutzer["total"] == 2

    nur_fehler = client.get(
        "/api/admin/audit-logs?days=7&result=failed&search=Namalsk",
        cookies=owner_cookies,
    ).json()
    assert nur_fehler["total"] == 1
    assert nur_fehler["items"][0]["action"] == "server.lifecycle.failed"

    aktionen = client.get(
        "/api/admin/audit-logs?days=7&category=security",
        cookies=owner_cookies,
    ).json()
    assert aktionen["total"] == 0

    rollen_alt = client.get(
        "/api/admin/audit-logs?days=40&category=security",
        cookies=owner_cookies,
    ).json()
    assert rollen_alt["total"] == 1
    assert rollen_alt["items"][0]["action"] == "auth.password.change"

    seite_zwei = client.get(
        "/api/admin/audit-logs?days=7&limit=1&offset=1",
        cookies=owner_cookies,
    ).json()
    assert seite_zwei["total"] == 2
    assert len(seite_zwei["items"]) == 1


def test_kennzahlen_vergleichen_mit_dem_zeitraum_davor(
    client: TestClient, db: Session, owner_user: User, owner_cookies: dict
) -> None:
    jetzt = datetime.now(timezone.utc)
    _eintrag(db, owner_user, "server.lifecycle.completed", when=jetzt)
    _eintrag(db, owner_user, "server.lifecycle.failed", when=jetzt)
    _eintrag(db, owner_user, "roles.update", when=jetzt)
    _eintrag(db, owner_user, "auth.password.change", when=jetzt - timedelta(days=10))
    _eintrag(db, owner_user, "server.deleted", when=jetzt - timedelta(days=30))

    antwort = client.get("/api/admin/audit-logs/summary?days=7", cookies=owner_cookies)
    assert antwort.status_code == 200, antwort.text
    daten = antwort.json()
    assert daten["current"] == {"total": 3, "users": 1, "security": 1, "failed": 1}
    assert daten["previous"] == {"total": 1, "users": 1, "security": 1, "failed": 0}
    assert {eintrag["category"] for eintrag in daten["by_category"]} >= {"server", "role"}
    assert daten["top_actions"][0]["count"] >= 1


def test_ohne_auditrecht_bleibt_die_liste_zu(client: TestClient, user_cookies: dict) -> None:
    antwort = client.get("/api/admin/audit-logs", cookies=user_cookies)
    assert antwort.status_code == 403
    assert client.get("/api/admin/audit-logs/summary", cookies=user_cookies).status_code == 403


def test_secrets_stehen_auch_nach_dem_lesen_nicht_in_der_antwort(
    client: TestClient, db: Session, owner_user: User, owner_cookies: dict
) -> None:
    _eintrag(
        db,
        owner_user,
        "credential.saved",
        details={"password": "super-secret-value", "token": "abc123"},
    )
    antwort = client.get("/api/admin/audit-logs?days=7", cookies=owner_cookies)
    assert antwort.status_code == 200
    text = antwort.text.lower()
    assert "super-secret-value" not in text
    assert "abc123" not in text
    assert "[redacted]" in text


def test_ki_werkzeuge_lesen_nur_mit_recht(
    db: Session, owner_user: User, regular_user: User
) -> None:
    _eintrag(
        db,
        owner_user,
        "server.lifecycle.failed",
        details={"operation": "start", "error_code": "timeout"},
    )
    assert "read_audit_summary" in ai_tool_spec.ALLE
    assert "search_audit_log" in ai_tool_spec.ALLE
    # Ein Serverproblem zieht das Protokoll mit in die Werkzeugauswahl.
    assert {"read_audit_summary", "search_audit_log"} <= DOMAIN_PACKS["server_ops"]

    # Zwei Schranken, nicht eine: der Katalog bietet die Werkzeuge ohne
    # `system.audit.read` gar nicht an — und der Handler weist den Aufruf
    # trotzdem ab, falls ein Modell den Namen aus einer anderen Quelle kennt.
    assert {"read_audit_summary", "search_audit_log"} <= angebotene_werkzeuge(db, owner_user)
    assert {"read_audit_summary", "search_audit_log"}.isdisjoint(
        angebotene_werkzeuge(db, regular_user)
    )

    uebersicht = ai_action_service._execute_global_read_tool(
        db,
        user=owner_user,
        tool_name="read_audit_summary",
        arguments={"days": 7},
    )
    assert uebersicht["current"]["total"] == 1
    assert uebersicht["current"]["failed"] == 1

    treffer = ai_action_service._execute_global_read_tool(
        db,
        user=owner_user,
        tool_name="search_audit_log",
        arguments={"days": 7, "result": "failed", "limit": 10},
    )
    assert treffer["total"] == 1
    assert treffer["entries"][0]["action"] == "server.lifecycle.failed"
    assert treffer["entries"][0]["category"] == "server"

    for werkzeug in ("read_audit_summary", "search_audit_log"):
        with pytest.raises(AiActionValidationError, match="Audit-Einsicht"):
            ai_action_service._execute_global_read_tool(
                db,
                user=regular_user,
                tool_name=werkzeug,
                arguments={"days": 7},
            )
