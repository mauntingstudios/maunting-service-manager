"""Das Tippsignal geht nur an Mitglieder des genannten Gespraechs.

Der fruehere HTTP-Weg (`/e2ee/typing` mit blinder Mailbox) ist mit dem
Einheits-Transport entfallen. Tippen laeuft jetzt ueber den WebSocket und
nennt `chat_type` und `chat_id`. Der Server prueft die Mitgliedschaft in
derselben Sitzung, in der er zustellt; ein Fremder erreicht niemanden, und
eine erfundene Kennung legt kein Gespraech an.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import DirectChat, User
from services.social_service import SocialService
from services.sync_event_service import SyncEventService

HERKUNFT = {"origin": "http://localhost:3000"}


@pytest.fixture(autouse=True)
def _leere_abonnenten():
    SyncEventService.clear_all_for_testing()
    yield
    SyncEventService.clear_all_for_testing()


def _abonniere(user_id: int) -> str:
    conn_id, _ = SyncEventService.subscribe(user_id=user_id)
    return conn_id


def _tippsignale(conn_id: str) -> list[dict]:
    sub = SyncEventService._subscribers.get(conn_id)
    if sub is None:
        return []
    raus = []
    while not sub.queue.empty():
        raus.append(sub.queue.get_nowait())
    return [e for e in raus if e.get("type") == "typing"]


def _tippe(
    client: TestClient,
    kekse: dict,
    *,
    chat_type: str,
    chat_id: int,
) -> None:
    with client.websocket_connect("/api/social/ws", cookies=kekse, headers=HERKUNFT) as ws:
        ws.send_json(
            {
                "type": "typing",
                "chat_type": chat_type,
                "chat_id": chat_id,
                "status": "typing",
            }
        )
        # Der Empfangsteil arbeitet Rahmen fuer Rahmen ab. Kommt das Pong, ist
        # das Tippsignal bereits verarbeitet.
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


# ── Fremde bleiben draussen ─────────────────────────────────────────────────


def test_fremder_tippt_nicht_in_eine_fremde_gruppe(
    client: TestClient, db: Session, owner_user: User, regular_user: User, owner_cookies: dict
) -> None:
    gruppe = SocialService.create_group(db, regular_user)
    zuhoerer = _abonniere(owner_user.id)

    _tippe(client, owner_cookies, chat_type="group", chat_id=gruppe.id)

    assert _tippsignale(zuhoerer) == []


def test_erfundene_kennung_erreicht_niemanden_und_legt_kein_gespraech_an(
    client: TestClient, db: Session, owner_user: User, regular_user: User, owner_cookies: dict
) -> None:
    zuhoerer = _abonniere(regular_user.id)
    vorher = db.query(DirectChat).count()

    _tippe(client, owner_cookies, chat_type="direct", chat_id=999_999)

    assert _tippsignale(zuhoerer) == []
    assert db.query(DirectChat).count() == vorher


# ── Wer dazugehoert, tippt weiter ───────────────────────────────────────────


def test_mitglied_tippt_in_seiner_gruppe(
    client: TestClient, db: Session, owner_user: User, regular_user: User, owner_cookies: dict
) -> None:
    gruppe = SocialService.create_group(db, owner_user)
    SocialService.join_group_by_invite_code(db, regular_user, gruppe.invite_code)
    zuhoerer = _abonniere(regular_user.id)

    _tippe(client, owner_cookies, chat_type="group", chat_id=gruppe.id)

    signale = _tippsignale(zuhoerer)
    assert len(signale) == 1
    assert signale[0]["sender_id"] == owner_user.id
    assert signale[0]["chat_id"] == gruppe.id


def test_freund_tippt_im_direktchat(
    client: TestClient, db: Session, owner_user: User, regular_user: User, owner_cookies: dict
) -> None:
    regular_user.social_privacy = "public"
    db.commit()
    chat = SocialService.ensure_direct_chat(db, owner_user.id, regular_user.id)
    zuhoerer = _abonniere(regular_user.id)

    _tippe(client, owner_cookies, chat_type="direct", chat_id=chat.id)

    assert len(_tippsignale(zuhoerer)) == 1


def test_der_absender_bekommt_sein_eigenes_tippsignal_nicht(
    client: TestClient, db: Session, owner_user: User, regular_user: User, owner_cookies: dict
) -> None:
    regular_user.social_privacy = "public"
    db.commit()
    chat = SocialService.ensure_direct_chat(db, owner_user.id, regular_user.id)
    eigener = _abonniere(owner_user.id)

    _tippe(client, owner_cookies, chat_type="direct", chat_id=chat.id)

    assert _tippsignale(eigener) == []
