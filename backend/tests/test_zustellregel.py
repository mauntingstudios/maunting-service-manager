"""Wer zeigt eine Meldung — und wie oft.

Bis 10/2026 galt „irgendeine offene Verbindung unterdrückt den Push". Das war
in beide Richtungen falsch:

* Ein Fenster im Hintergrund verschluckte die Meldung ganz (nichts zeigte sie).
* Zwei offene Fenster oder MSS und Pontis auf demselben Gerät zeigten sie
  doppelt, weil jeder Client selbst meldete.
* `sende_an_konto` stellte an **alle** Adressen eines Kontos zu.

Die Regel seither: der Client sagt, ob er vorne, hinten oder ein Dienst ist
(`POST /api/events/presence`). Der Server wählt daraus je Konto einen
Vordergrund- und einen Dienst-Zusteller und schickt den Push nur, wenn keiner
die Meldung selbst zeigen kann. Jede Meldung trägt zusätzlich eine feste
Kennung (`msg:<mailbox>:<id>`), damit dieselbe Nachricht auf demselben Gerät
nicht zweimal erscheint.

Was hier festgehalten wird:

* **Höchstens zwei.** Ein Vordergrund-Client und ein Dienst. Zwei
  Vordergrund-Clients ergeben ein `melden: true`.
* **Der Dienst zählt mit.** Er meldet auch, wenn ein anderes Gerät vorne steht.
* **Keiner heisst Push.** Ohne Zusteller geht der Push hinaus.
* **Altverhalten bleibt.** Meldet kein Client etwas (ältere Fassung), gilt
  weiter „offene Verbindung genügt" — ein Update darf niemanden stummmachen.
* **Gruppen sind kein Konto.** An einer Mailbox hängen mehrere Menschen; dort
  wird je Konto einer gewählt, nicht einer für alle.
* **Fremde Verbindungen lassen sich nicht umstellen.**
"""

from __future__ import annotations

import base64

import pytest
from sqlalchemy.orm import Session

from models import User, UserFriend
from services import webpush_service
from services.social_service import SocialService
from services.sync_event_service import SyncEventService

UNABLEITBAR = "d" * 64
TOKEN = "e" * 64
PUNKT = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
ENDPUNKT = "https://fcm.googleapis.com/fcm/send/geraet-a"


def _umschlag(marke: str) -> str:
    roh = b"N" * 12 + marke.encode("utf-8") + b"T" * 16
    return "sv-e2ee-group-v1:00112233445566ff." + base64.b64encode(roh).decode("ascii")


@pytest.fixture(autouse=True)
def _leere_abonnenten():
    SyncEventService.clear_all_for_testing()
    yield
    SyncEventService.clear_all_for_testing()


@pytest.fixture
def versand(monkeypatch) -> list[tuple]:
    """Fängt ab, was in den Hintergrundfaden ginge. Gemessen wird davor."""
    aufrufe: list[tuple] = []
    monkeypatch.setattr(
        webpush_service._versender, "submit", lambda fn, *a, **k: aufrufe.append(a)
    )
    return aufrufe


def _verbinde(user_id: int, *, zustand: str | None = None, mailboxes: tuple[str, ...] = ()):
    conn_id, queue = SyncEventService.subscribe(user_id=user_id, team_ids=[], is_admin=False)
    if mailboxes:
        SyncEventService.set_mailboxes(conn_id, set(mailboxes), user_id=user_id)
    if zustand:
        assert SyncEventService.set_praesenz(conn_id, zustand, user_id=user_id) is True
    return conn_id, queue


# ── Die Wahl ────────────────────────────────────────────────────────────────


def test_vordergrund_ist_zusteller() -> None:
    conn, _ = _verbinde(1, zustand="vordergrund")

    assert SyncEventService.zustelllage(user_id=1) == ({conn}, True)


def test_hintergrunddienst_ist_zusteller_wenn_niemand_vorne_steht() -> None:
    """Der Dauerdienst zeigt selbst — sonst käme beim geschlossenen Fenster
    nichts an."""
    conn, _ = _verbinde(1, zustand="dienst")

    assert SyncEventService.zustelllage(user_id=1) == ({conn}, True)


def test_vordergrund_und_dienst_zeigen_beide() -> None:
    """Das Handy meldet auch, wenn der PC vorne steht."""
    dienst, _ = _verbinde(1, zustand="dienst")
    vorne, _ = _verbinde(1, zustand="vordergrund")

    assert SyncEventService.zustelllage(user_id=1) == ({vorne, dienst}, True)


def test_dienst_verdraengt_hintergrund_app() -> None:
    """Ohne Dienst zeigt ein Hintergrund-Fenster; mit Dienst nur der Dienst."""
    _verbinde(1, zustand="hintergrund")
    dienst, _ = _verbinde(1, zustand="dienst")

    assert SyncEventService.zustelllage(user_id=1)[0] == {dienst}


def test_vordergrund_und_hintergrund_app_ohne_dienst() -> None:
    """Gibt es keinen Dienst, bleibt der Hintergrund-App-Client als Zusteller."""
    hinten, _ = _verbinde(1, zustand="hintergrund")
    vorne, _ = _verbinde(1, zustand="vordergrund")

    assert SyncEventService.zustelllage(user_id=1)[0] == {vorne, hinten}


def test_zwei_dienste_waehlen_einen() -> None:
    _verbinde(1, zustand="dienst")
    zweiter, _ = _verbinde(1, zustand="dienst")

    assert SyncEventService.zustelllage(user_id=1)[0] == {zweiter}


def test_ohne_praesenz_gibt_es_keinen_zusteller_aber_altverhalten() -> None:
    """Ältere Fassungen melden nichts. `praesenz_bekannt=False` ist das Signal
    an den Aufrufer, weiter „offene Verbindung genügt" zu prüfen."""
    _verbinde(1)

    assert SyncEventService.zustelllage(user_id=1) == (set(), False)


def test_praesenz_einer_fremden_verbindung_wird_abgelehnt() -> None:
    conn, _ = _verbinde(1, zustand="vordergrund")

    assert SyncEventService.set_praesenz(conn, "hintergrund", user_id=2) is False
    assert SyncEventService.zustelllage(user_id=1)[1] is True


# ── Zwei Fenster, eine Meldung ──────────────────────────────────────────────


def test_zwei_fenster_zeigen_die_meldung_einmal() -> None:
    erst, erste_queue = _verbinde(1, zustand="vordergrund")
    zweit, zweite_queue = _verbinde(1, zustand="vordergrund")

    SyncEventService.publish(
        {"type": "e2ee_blind_message", "ereignis": "msg:mb:1"},
        user_id=1,
        zusteller=erst,
        melden_markieren=True,
    )

    assert erste_queue.get_nowait()["melden"] is True
    assert zweite_queue.get_nowait()["melden"] is False
    assert zweit != erst


def test_ohne_zusteller_zeigt_keiner() -> None:
    _conn, queue = _verbinde(1, zustand="hintergrund")

    SyncEventService.publish(
        {"type": "e2ee_blind_message"},
        user_id=1,
        zusteller=None,
        melden_markieren=True,
    )

    assert queue.get_nowait()["melden"] is False


def test_gruppenmailbox_waehlt_je_konto_einen() -> None:
    """An einer Gruppenmailbox hängen mehrere Menschen. Ein Zusteller für alle
    hiesse: der Rest der Gruppe schweigt."""
    a1, _ = _verbinde(1, zustand="vordergrund", mailboxes=(UNABLEITBAR,))
    a2, _ = _verbinde(1, zustand="vordergrund", mailboxes=(UNABLEITBAR,))
    b1, _ = _verbinde(2, zustand="vordergrund", mailboxes=(UNABLEITBAR,))

    gewaehlt, bekannt = SyncEventService.zusteller_je_mailbox(UNABLEITBAR)

    assert bekannt is True
    assert len(gewaehlt) == 2
    # Genau einer der beiden Clients von Konto 1, und der von Konto 2.
    assert len({a1, a2} & gewaehlt) == 1
    assert b1 in gewaehlt


# ── Der Weg durch den Nachrichtenkanal ─────────────────────────────────────


def test_eine_nachricht_erreicht_den_empfaenger_ueber_seine_verbindung(
    db: Session, owner_user: User, regular_user: User
) -> None:
    """Der Nachrichtenweg meldet ueber den Echtzeitkanal, nicht ueber einen
    zweiten Aufruf daneben. Beide Fenster des Empfaengers bekommen das
    Ereignis, der Absender seine eigene Kopie ebenfalls (der Client filtert
    sie anhand der Absenderkennung)."""
    from services.social.messages_service import send_message, store_chat_keys

    anfrage = SocialService.send_friend_request(db, owner_user.id, regular_user.username)
    SocialService.accept_friend_request(db, regular_user.id, anfrage["id"])
    chat = SocialService.ensure_direct_chat(db, owner_user.id, regular_user.id)
    store_chat_keys(
        db,
        owner_user,
        "direct",
        chat.id,
        1,
        [
            {"user_id": owner_user.id, "encrypted_chat_key": "chiffrat-a"},
            {"user_id": regular_user.id, "encrypted_chat_key": "chiffrat-b"},
        ],
    )
    _erst, erste_queue = _verbinde(regular_user.id, zustand="vordergrund")
    _zweit, zweite_queue = _verbinde(regular_user.id, zustand="hintergrund")

    send_message(db, owner_user, "direct", chat.id, "zustellregel-1", 1, "chiffrat")

    for queue in (erste_queue, zweite_queue):
        ereignis = queue.get_nowait()
        assert ereignis["type"] == "message_created"
        assert ereignis["message"]["client_uuid"] == "zustellregel-1"


def test_ein_fremder_bekommt_kein_ereignis(
    db: Session, owner_user: User, regular_user: User
) -> None:
    """Der Kanal filtert auf Mitglieder. Wer nicht dazugehoert, sieht nichts."""
    from services.social.messages_service import send_message, store_chat_keys

    anfrage = SocialService.send_friend_request(db, owner_user.id, regular_user.username)
    SocialService.accept_friend_request(db, regular_user.id, anfrage["id"])
    chat = SocialService.ensure_direct_chat(db, owner_user.id, regular_user.id)
    store_chat_keys(
        db,
        owner_user,
        "direct",
        chat.id,
        1,
        [
            {"user_id": owner_user.id, "encrypted_chat_key": "chiffrat-a"},
            {"user_id": regular_user.id, "encrypted_chat_key": "chiffrat-b"},
        ],
    )
    fremd, fremde_queue = _verbinde(regular_user.id + 1000, zustand="vordergrund")

    send_message(db, owner_user, "direct", chat.id, "zustellregel-2", 1, "chiffrat")

    assert fremde_queue.empty()
    assert fremd
