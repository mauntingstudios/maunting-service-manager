"""Wirksamkeitsbeweis für Paket 4A: CalendarService.get_due_reminders ohne JOINs/N+1 und ohne Klartext-Recurrence."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

import database as db_module
from models import Server, Team, User
from models.calendar_event import CalendarEvent
from models.team import TeamMember
from services.calendar_service import CalendarService
from services.dis_client import DisClient


def test_due_reminders_no_joins_no_single_decrypt_and_encrypted_recurrence(
    db: Session,
    owner_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cal = CalendarService.get_or_create_native_calendar(db, owner_user)
    team = Team(name="KalTeam", owner_user_id=owner_user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner_user.id, role="owner"))
    srv = Server(name="KalSrv", game_type="minecraft", install_dir="/tmp/kal", status="stopped")
    db.add(srv)
    db.flush()

    now = datetime.now(timezone.utc)
    # 12 Termine in den nächsten Jahren + 2 fällige Termine (in 4h und 30h)
    for i in range(12):
        CalendarService.create_event(
            db,
            owner_user,
            title=f"Später-{i}",
            start_time=(now + timedelta(days=20 + i)).isoformat(),
            end_time=(now + timedelta(days=20 + i, hours=1)).isoformat(),
            description=f"Riesige Beschreibung {i} " * 20,
            location=f"Ort-{i}",
            calendar_id=cal.id,
        )
    ev_soon = CalendarService.create_event(
        db,
        owner_user,
        title="Wartung Bald",
        start_time=(now + timedelta(hours=4)).isoformat(),
        end_time=(now + timedelta(hours=5)).isoformat(),
        description="Geheime Beschreibung nicht für Reminder",
        location="RZ-1",
        calendar_id=cal.id,
        event_type="team",
        team_id=team.id,
    )
    CalendarService.create_event(
        db,
        owner_user,
        title="Server Check",
        start_time=(now + timedelta(hours=30)).isoformat(),
        end_time=(now + timedelta(hours=31)).isoformat(),
        description="Server-Notiz",
        location="RZ-2",
        calendar_id=cal.id,
        event_type="server",
        server_id=srv.id,
    )

    # DB-Invariante prüfen: recurrence bleibt verschlüsselt
    raw_row = db.query(CalendarEvent).filter(CalendarEvent.event_uid == ev_soon["event_id"]).one()
    assert raw_row.recurrence and not raw_row.recurrence.startswith("{")

    sql_statements: list[str] = []
    single_decrypts = 0
    batch_decrypts = 0
    batch_item_counts: list[int] = []
    orig_decrypt = DisClient.decrypt
    orig_decrypt_many = DisClient.decrypt_many

    def on_exec(_conn, _cursor, stmt, *_rest):
        if "from calendar_events" in stmt.lower():
            sql_statements.append(stmt.lower())

    def tracked_decrypt(ct, aad=None):
        nonlocal single_decrypts
        single_decrypts += 1
        return orig_decrypt(ct, aad=aad)

    def tracked_decrypt_many(items):
        nonlocal batch_decrypts
        batch_decrypts += 1
        batch_item_counts.append(len(items))
        return orig_decrypt_many(items)

    monkeypatch.setattr(DisClient, "decrypt", staticmethod(tracked_decrypt))
    monkeypatch.setattr(DisClient, "decrypt_many", staticmethod(tracked_decrypt_many))
    event.listen(db_module.engine, "before_cursor_execute", on_exec)
    try:
        reminders = CalendarService.get_due_reminders(db, owner_user)
    finally:
        event.remove(db_module.engine, "before_cursor_execute", on_exec)

    assert len(reminders) == 2
    assert {r["title"] for r in reminders} == {"Wartung Bald", "Server Check"}
    assert len(sql_statements) == 1
    assert "join teams" not in sql_statements[0]
    assert "join servers" not in sql_statements[0]
    assert "join user_calendars" not in sql_statements[0]
    assert "calendar_events.description" not in sql_statements[0]
    assert single_decrypts == 0
    assert batch_decrypts == 2
    # 1. Batch = 14x recurrence; 2. Batch = nur 2 fällige Events x 2 Spalten (title+location, ohne description)
    assert batch_item_counts == [14, 4]
