"""Freundschaftsanfragen: senden ist kein Einverstaendnis.

Die alte Sonderregel nahm eine Gegenanfrage stillschweigend an. Diese Datei
haelt den neuen Weg fest: eine Anfrage bleibt `pending`, bis der Empfaenger
annimmt oder ablehnt; die Meldung geht an genau einen Client je Konto und als
Push nur, wenn niemand offen ist.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import User, UserFriend
from services import webpush_service
from services.social_service import SocialService
from services.sync_event_service import SyncEventService


@pytest.fixture(autouse=True)
def _leere_abonnenten():
    SyncEventService.clear_all_for_testing()
    yield
    SyncEventService.clear_all_for_testing()


def _abonnieren(user: User) -> tuple[str, list[dict]]:
    conn_id, _ = SyncEventService.subscribe(user_id=user.id)
    SyncEventService.set_praesenz(conn_id, "vordergrund", user_id=user.id)
    sub = SyncEventService._subscribers[conn_id]
    return conn_id, sub.queue


def _leeren(queue) -> list[dict]:
    raus = []
    while not queue.empty():
        raus.append(queue.get_nowait())
    return raus


def _vom_typ(ereignisse: list[dict], typ: str) -> list[dict]:
    return [e for e in ereignisse if e.get("type") == typ]


def _anfrage(db: Session, a: User, b: User) -> dict:
    return SocialService.send_friend_request(db, a.id, b.username)


def test_gegenanfrage_nimmt_nicht_automatisch_an(
    db: Session, owner_user: User, regular_user: User
) -> None:
    _anfrage(db, owner_user, regular_user)

    with pytest.raises(HTTPException) as fehler:
        _anfrage(db, regular_user, owner_user)

    assert fehler.value.status_code == 409
    zeilen = db.query(UserFriend).all()
    assert [(z.user_id, z.friend_id, z.status) for z in zeilen] == [
        (owner_user.id, regular_user.id, "pending")
    ]
    assert SocialService.is_confirmed_friend(db, owner_user.id, regular_user.id) is False


def test_annahme_geht_an_beide_seiten_mit_richtigem_gegenueber(
    db: Session, owner_user: User, regular_user: User
) -> None:
    anfrage = _anfrage(db, owner_user, regular_user)
    req = SocialService.get_requests(db, regular_user.id)["incoming"][0]
    assert req["id"] == anfrage["request_id"]

    conn_a, queue_a = _abonnieren(owner_user)
    conn_b, queue_b = _abonnieren(regular_user)
    try:
        SocialService.accept_friend_request(db, regular_user.id, req["id"])
        ereignisse_a = _leeren(queue_a)
        ereignisse_b = _leeren(queue_b)
    finally:
        SyncEventService.unsubscribe(conn_a)
        SyncEventService.unsubscribe(conn_b)

    angenommen_a = _vom_typ(ereignisse_a, "friend_request_accepted")
    angenommen_b = _vom_typ(ereignisse_b, "friend_request_accepted")
    assert len(angenommen_a) == 1
    assert angenommen_a[0]["friend_id"] == regular_user.id
    assert angenommen_a[0]["accepted_by"] == regular_user.id
    assert angenommen_a[0]["melden"] is True

    assert len(angenommen_b) == 1
    assert angenommen_b[0]["friend_id"] == owner_user.id
    assert angenommen_b[0]["melden"] is False

    assert SocialService.is_confirmed_friend(db, owner_user.id, regular_user.id) is True
    assert db.query(UserFriend).filter_by(status="pending").count() == 0


def test_ablehnung_loescht_und_meldet_ohne_freundschaft(
    db: Session, owner_user: User, regular_user: User
) -> None:
    _anfrage(db, owner_user, regular_user)
    req = SocialService.get_requests(db, regular_user.id)["incoming"][0]

    conn_a, queue_a = _abonnieren(owner_user)
    conn_b, queue_b = _abonnieren(regular_user)
    try:
        SocialService.decline_or_cancel_request(db, regular_user.id, req["id"])
        ereignisse_a = _leeren(queue_a)
        ereignisse_b = _leeren(queue_b)
    finally:
        SyncEventService.unsubscribe(conn_a)
        SyncEventService.unsubscribe(conn_b)

    assert db.query(UserFriend).count() == 0
    assert SocialService.is_confirmed_friend(db, owner_user.id, regular_user.id) is False
    for ereignisse in (ereignisse_a, ereignisse_b):
        abgelehnt = _vom_typ(ereignisse, "friend_request_declined")
        assert len(abgelehnt) == 1
        assert abgelehnt[0]["melden"] is False


def test_anfrage_ohne_offenen_client_geht_als_push_raus(
    db: Session, owner_user: User, regular_user: User, monkeypatch
) -> None:
    aufrufe: list[dict] = []
    monkeypatch.setattr(
        webpush_service,
        "sende_an_konto",
        lambda _db, user_id, nutzlast: aufrufe.append({"user_id": user_id, **nutzlast}),
    )

    _anfrage(db, owner_user, regular_user)

    assert len(aufrufe) == 1
    assert aufrufe[0]["user_id"] == regular_user.id
    assert aufrufe[0]["type"] == "friend_request"
    assert aufrufe[0]["url"] == "/chat"
    assert aufrufe[0]["ereignis"].startswith("friend-request:")


def test_offener_client_zeigt_selbst_und_ersetzt_den_push(
    db: Session, owner_user: User, regular_user: User, monkeypatch
) -> None:
    aufrufe: list[dict] = []
    monkeypatch.setattr(
        webpush_service,
        "sende_an_konto",
        lambda _db, user_id, nutzlast: aufrufe.append({"user_id": user_id, **nutzlast}),
    )
    conn, queue = _abonnieren(regular_user)
    try:
        _anfrage(db, owner_user, regular_user)
        ereignisse = _leeren(queue)
    finally:
        SyncEventService.unsubscribe(conn)

    assert aufrufe == []
    empfangen = _vom_typ(ereignisse, "friend_request_received")
    assert len(empfangen) == 1
    assert empfangen[0]["melden"] is True
    assert empfangen[0]["from_user_id"] == owner_user.id
    assert empfangen[0]["request_id"]


def test_http_anfrage_bleibt_pending_bis_zur_annahme(
    client,
    owner_user: User,
    regular_user: User,
    owner_cookies: dict,
    user_cookies: dict,
    user_csrf_token: str | None,
) -> None:
    """Der Beweis am alten Stand: A sendet, B sendet zurueck, niemand ist Freund."""
    erste = client.post(
        "/api/social/friends/request",
        json={"username": regular_user.username},
        cookies=owner_cookies,
        headers={"X-CSRF-Token": owner_cookies.get("__Secure-csrf_token", "")},
    )
    assert erste.status_code == 200, erste.text
    assert erste.json()["status"] == "pending"

    assert client.get("/api/social/friends", cookies=owner_cookies).json() == []
    assert client.get("/api/social/friends", cookies=user_cookies).json() == []

    gegen = client.post(
        "/api/social/friends/request",
        json={"username": owner_user.username},
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert gegen.status_code == 409, gegen.text
    assert client.get("/api/social/friends", cookies=user_cookies).json() == []

    anfragen = client.get("/api/social/friends/requests", cookies=user_cookies).json()
    assert len(anfragen["incoming"]) == 1
    request_id = anfragen["incoming"][0]["id"]

    angenommen = client.post(
        f"/api/social/friends/{request_id}/accept",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert angenommen.status_code == 200, angenommen.text

    freunde_a = client.get("/api/social/friends", cookies=owner_cookies).json()
    freunde_b = client.get("/api/social/friends", cookies=user_cookies).json()
    assert [f["user_id"] for f in freunde_a] == [regular_user.id]
    assert [f["user_id"] for f in freunde_b] == [owner_user.id]
