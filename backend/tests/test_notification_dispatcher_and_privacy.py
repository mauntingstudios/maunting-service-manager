"""Die Regeln, wer benachrichtigt werden darf — nicht, dass jemand sie bekommt.

Geprüft werden reine Funktionen: Echo-Erkennung, Empfängerfilter,
Steuersignal-Ausschluss und die Bereinigung des Payloads. Sie beantworten die
Frage „darf hier überhaupt etwas hinausgehen, und was davon".

Die Zustellung selbst steht in `test_webpush_service.py` — Verschlüsselung
gegen die Testvektoren des RFC, SSRF-Schranke, Übernahme einer Adresse bei
Kontowechsel. Die Aufteilung folgt der des Codes: `notification_service`
entscheidet, `webpush_service` stellt zu.

Der Vordergrundweg — offener Tab, Sync-Ereignis, Meldung des Betriebssystems —
läuft im Browser und kommt in keiner der beiden Dateien vor.
"""

from __future__ import annotations

import base64
import json
from uuid import uuid4
import pytest
from sqlalchemy.orm import Session

from models import User, UserFriend, ChatGroup, ChatGroupMember, AiConversation
from services.notification_service import NotificationService
from services.social_service import SocialService
from services.sync_event_service import SyncEventService
from services import ai_proposal_service
from services.ai_proposals.lifecycle import create_proposal


# Die Schlüsselkennung im Kopf eines Gruppenumschlags: seit 09/2026 trägt
# `sv-e2ee-group-v1:` sie vor dem Chiffretext, weil ein Gerät mehrere
# Schlüsselgenerationen hält. Ein Umschlag ohne sie stammt aus der Zeit, als
# sich der Gruppenschlüssel aus der Gruppenkennung ableiten ließ, und wird
# beim Schreiben abgewiesen.
_GRUPPEN_KEY = "00112233445566ff."


def _create_user(db: Session, username: str, privacy: str = "friends") -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="test_hash",
        is_active=True,
        social_privacy=privacy,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ============================================================================
# 1. Outgoing Echo Bug: Sender-ID strikt von Alerts & Badges ausnehmen
# ============================================================================

def test_sender_id_strictly_excluded_from_direct_alerts():
    """Stellt sicher, dass der Sender einer Nachricht NIEMALS eine Notification
    oder einen Unread-Count für seine eigenen Aktionen erhält.
    """
    sender_id = 42
    recipient_id = 99

    # 1. Direkte Prüfung: Sender als current_user -> IMMER False
    assert NotificationService.should_notify(
        recipient_id=recipient_id,
        current_user_id=sender_id,
        sender_user_id=sender_id,
        is_read=False,
    ) is False

    # Typensicherheit (String-IDs)
    assert NotificationService.should_notify(
        recipient_id=str(recipient_id),
        current_user_id=str(sender_id),
        sender_user_id=str(sender_id),
        is_read=False,
    ) is False

    # is_outgoing_echo Helfer
    assert NotificationService.is_outgoing_echo(
        sender_user_id=sender_id, current_user_id=sender_id
    ) is True
    assert NotificationService.is_outgoing_echo(
        sender_user_id=sender_id, current_user_id=recipient_id
    ) is False

    # Push-Dispatch Plan für Sender muss None sein
    push_plan = NotificationService.prepare_push_dispatch(
        target_user_id=sender_id,
        sender_user_id=sender_id,
        title="Test",
        body="Nachricht",
    )
    assert push_plan is None

    # Für den tatsächlichen Empfänger muss es True / validierter Plan sein
    assert NotificationService.should_notify(
        recipient_id=recipient_id,
        current_user_id=recipient_id,
        sender_user_id=sender_id,
        is_read=False,
    ) is True

    recipient_push = NotificationService.prepare_push_dispatch(
        target_user_id=recipient_id,
        sender_user_id=sender_id,
        title="Neue Nachricht",
        body="Geheimer Text",
        is_e2ee=True,
    )
    assert recipient_push is not None
    assert recipient_push["target_user_id"] == recipient_id


def test_sender_id_strictly_excluded_from_group_alerts():
    """In Gruppen darf der Sender trotz Gruppenmitgliedschaft niemals benachrichtigt werden."""
    sender_id = 10
    member_ids = [10, 20, 30]

    # Sender ist Mitglied -> trotzdem False (Outgoing Echo Prevention)
    assert NotificationService.should_notify_group(
        group_member_ids=member_ids,
        current_user_id=sender_id,
        sender_user_id=sender_id,
        is_read=False,
    ) is False

    # Andere Mitglieder -> True
    assert NotificationService.should_notify_group(
        group_member_ids=member_ids,
        current_user_id=20,
        sender_user_id=sender_id,
        is_read=False,
    ) is True

    # Nicht-Mitglied -> False
    assert NotificationService.should_notify_group(
        group_member_ids=member_ids,
        current_user_id=99,
        sender_user_id=sender_id,
        is_read=False,
    ) is False


def test_eigene_nachricht_erzeugt_keine_eigene_benachrichtigung(db: Session, owner_user: User):
    """Wer selbst sendet, bekommt dafuer kein Abzeichen und keinen Ton.

    Der Umschlag kommt fertig vom Client; geprueft wird die Echo-Unterdrueckung
    des Absenders am Ereignis des Nachrichtenwegs.
    """
    from services.social.messages_service import send_message, store_chat_keys

    user_sender = owner_user
    user_recipient = _create_user(db, "recipient_ai_user")

    db.add(UserFriend(user_id=user_sender.id, friend_id=user_recipient.id, status="accepted"))
    db.commit()
    chat = SocialService.ensure_direct_chat(db, user_sender.id, user_recipient.id)
    store_chat_keys(
        db,
        user_sender,
        "direct",
        chat.id,
        1,
        [
            {"user_id": user_sender.id, "encrypted_chat_key": "chiffrat-a"},
            {"user_id": user_recipient.id, "encrypted_chat_key": "chiffrat-b"},
        ],
    )

    published: list[dict] = []
    orig_pub = SyncEventService.publish

    def mock_pub(ev, **kwargs):
        published.append(dict(ev))
        return orig_pub(ev, **kwargs)

    SyncEventService.publish = mock_pub
    try:
        send_message(
            db,
            user_sender,
            "direct",
            chat.id,
            "echo-unterdrueckung",
            1,
            "vom-client-verschluesselt",
        )
    finally:
        SyncEventService.publish = orig_pub

    msg_ev = next(e for e in published if e.get("type") == "message_created")
    assert msg_ev["message"]["sender_user_id"] == user_sender.id
    assert msg_ev["message"]["chat_id"] == chat.id

    # Sender darf KEINE Benachrichtigung / Unread-Badge erhalten.
    assert NotificationService.should_notify(
        recipient_id=user_sender.id,
        current_user_id=user_sender.id,
        sender_user_id=msg_ev["message"]["sender_user_id"],
        is_read=False,
    ) is False

    # Empfänger MUSS benachrichtigt werden.
    assert NotificationService.should_notify(
        recipient_id=user_recipient.id,
        current_user_id=user_recipient.id,
        sender_user_id=msg_ev["message"]["sender_user_id"],
        is_read=False,
    ) is True


def test_group_message_reaches_members_only_no_leak_to_strangers(db: Session):
    """Eine Gruppennachricht geht an die Mitglieder, an Unbeteiligte nicht.

    Der Kanal filtert auf die Mitgliederliste; ein Fremder kann weder lesen
    noch schreiben.
    """
    from fastapi import HTTPException
    from services.social.messages_service import send_message, store_chat_keys

    alice = _create_user(db, "group_alice")
    bob = _create_user(db, "group_bob")
    charlie_stranger = _create_user(db, "group_charlie_stranger")

    group = SocialService.create_group(db, alice)
    SocialService.join_group_by_invite_code(db, bob, group.invite_code)
    mitglieder = [
        int(row[0])
        for row in db.query(ChatGroupMember.user_id).filter_by(group_id=group.id).all()
    ]
    store_chat_keys(
        db,
        alice,
        "group",
        group.id,
        1,
        [{"user_id": uid, "encrypted_chat_key": f"chiffrat-{uid}"} for uid in mitglieder],
    )

    conn_alice, q_alice = SyncEventService.subscribe(user_id=alice.id)
    conn_bob, q_bob = SyncEventService.subscribe(user_id=bob.id)
    conn_stranger, q_stranger = SyncEventService.subscribe(user_id=charlie_stranger.id)
    try:
        send_message(db, alice, "group", group.id, "gruppen-nachricht-1", 1, "chiffrat")

        # Alice (Absenderin) erhaelt das Ereignis fuer ihre uebrigen Geraete.
        assert not q_alice.empty()
        assert q_alice.get_nowait()["type"] == "message_created"

        # Bob (Mitglied) erhaelt es.
        assert not q_bob.empty()
        ev_b = q_bob.get_nowait()
        assert ev_b["message"]["chat_id"] == group.id

        # Charlie (Fremder) darf absolut NICHTS erhalten.
        assert q_stranger.empty()

        # Ein Fremder darf nicht in die Gruppe senden.
        with pytest.raises(HTTPException) as exc:
            send_message(db, charlie_stranger, "group", group.id, "illegal", 1, "chiffrat")
        assert exc.value.status_code == 403
    finally:
        SyncEventService.unsubscribe(conn_alice)
        SyncEventService.unsubscribe(conn_bob)
        SyncEventService.unsubscribe(conn_stranger)


# ============================================================================
# 6. Integrationstests: Strikter Sender-Ausschluss (KI/Worker, UUIDs, Multi-Device)
# ============================================================================

def test_sender_id_strictly_excluded_with_worker_and_string_formats():
    """Stellt sicher, dass auch mit Worker/AI-Präfixen oder String-IDs der Sender
    striktestens von Alerts, Badges und Dispatch-Aufträgen ausgenommen ist.
    """
    user_id = 42

    for sender_variant in [
        user_id,
        str(user_id),
        f"worker:{user_id}",
        f"ai:{user_id}",
        f"actor:{user_id}",
        f"user:{user_id}",
    ]:
        # Echo-Erkennung muss True sein
        assert NotificationService.is_outgoing_echo(
            sender_user_id=sender_variant, current_user_id=user_id
        ) is True

        # should_notify für den Absender muss IMMER False sein
        assert NotificationService.should_notify(
            recipient_id=99,
            current_user_id=user_id,
            sender_user_id=sender_variant,
            is_read=False,
        ) is False

        # Gruppen-Notify für den Absender muss IMMER False sein
        assert NotificationService.should_notify_group(
            group_member_ids=[user_id, 99],
            current_user_id=user_id,
            sender_user_id=sender_variant,
            is_read=False,
        ) is False

        # Push-Dispatch Plan für den Absender muss None sein
        assert NotificationService.prepare_push_dispatch(
            target_user_id=user_id,
            sender_user_id=sender_variant,
            title="Neue Nachricht",
        ) is None


def test_notification_dispatcher_active_foreground_suppression():
    """Verifiziert, dass bei aktiver Foreground-Verbindung kein doppelter OS-Push gedispatcht wird."""
    SyncEventService.clear_all_for_testing()

    alice_id = 101
    bob_id = 102

    # Bob verbindet sich via SSE (aktive Verbindung im Vordergrund)
    conn_bob, _ = SyncEventService.subscribe(user_id=bob_id)
    try:
        assert SyncEventService.has_active_subscribers(bob_id) is True
        assert SyncEventService.has_active_subscribers(alice_id) is False

        # Push-Dispatch für Bob (online im Vordergrund) -> MUSS unterdrückt werden (None)
        push_bob = NotificationService.prepare_push_dispatch(
            target_user_id=bob_id,
            sender_user_id=alice_id,
            title="Nachricht an Bob",
            has_active_foreground_connection=SyncEventService.has_active_subscribers(bob_id),
        )
        assert push_bob is None

        # Push-Dispatch für Alice (offline / Hintergrund) -> MUSS gedispatcht werden
        push_alice = NotificationService.prepare_push_dispatch(
            target_user_id=alice_id,
            sender_user_id=bob_id,
            title="Nachricht an Alice",
            has_active_foreground_connection=SyncEventService.has_active_subscribers(alice_id),
        )
        assert push_alice is not None
        assert push_alice["target_user_id"] == alice_id
    finally:
        SyncEventService.unsubscribe(conn_bob)
        SyncEventService.clear_all_for_testing()


def test_multi_device_chat_focus_and_unread_counter_invariants():
    """Verifiziert das Verhalten bei Chat-Fokus vs. Hintergrund."""
    recipient_id = 55
    sender_id = 12

    # 1. Chat im Fokus (is_read=True) -> KEIN Alert / Badge
    assert NotificationService.should_notify(
        recipient_id=recipient_id,
        current_user_id=recipient_id,
        sender_user_id=sender_id,
        is_read=True,
    ) is False

    # 2. Chat im Hintergrund / nicht im Fokus (is_read=False) -> Alert / Badge erlaubt
    assert NotificationService.should_notify(
        recipient_id=recipient_id,
        current_user_id=recipient_id,
        sender_user_id=sender_id,
        is_read=False,
    ) is True


def test_strict_privacy_payload_all_leak_keys_and_title_sanitization():
    """Stellt sicher, dass alle potenziellen Klartext- und Secret-Schlüssel restlos gestrippt werden."""
    sensitive_payload = {
        "title": "Geheime Botschaft: 42 ist die Antwort",
        "body": "Vertraulicher Text",
        "plaintext": "Top Secret Cleartext",
        "msg": "Hallo Welt",
        "message": "Geheimnis",
        "private_key": "privkey_bytes",
        "secret_key": "secretkey_bytes",
        "channel_key": "channel_bytes",
        "auth_tag": "tag_bytes",
        "iv": "iv_bytes",
        "salt": "salt_bytes",
        "sender_name": "Agent007",
    }

    clean = NotificationService.sanitize_push_payload(sensitive_payload, is_e2ee=True)

    for leaked in [
        "plaintext", "msg", "message", "private_key", "secret_key",
        "channel_key", "auth_tag", "iv", "salt"
    ]:
        assert leaked not in clean

    assert "42" not in clean["title"]
    assert clean["title"] == "Neue Nachricht: Agent007"
    assert clean["body"] == "Du hast eine neue verschlüsselte Nachricht erhalten."

