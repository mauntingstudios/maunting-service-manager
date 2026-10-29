"""Der eine E2EE-Transport: Senden, Laden, Bearbeiten, Quittieren.

Alle Nachrichten liegen in ``e2ee_messages``. Der Server prueft Zugehoerigkeit,
Groesse und die wenigen Rechte, die er kennen kann. Den Inhalt sieht er nie:
``encrypted_payload`` ist ein AES-256-GCM-Chiffrat unter dem ``chat_key`` des
Gespraechs.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    ChatGroup,
    ChatGroupMember,
    DirectChat,
    DirectChatMember,
    E2eeChatKey,
    E2eeChatState,
    E2eeMessage,
    E2eeMessageReaction,
    User,
    UserFriend,
)
from services.sync_event_service import SyncEventService
from services.social.messages_push import push_message
from services.social.messages_reaktionen import reaktionen_fuer

MAX_PAYLOAD_CHARS = 4 * 1024 * 1024
MAX_PAGE = 100
MAX_CHAT_KEYS = 64


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_chat_type(chat_type: str) -> str:
    value = (chat_type or "").strip().lower()
    if value not in ("direct", "group"):
        raise HTTPException(status_code=400, detail="Ungueltiger chat_type.")
    return value


def _chat_row(db: Session, chat_type: str, chat_id: int) -> DirectChat | ChatGroup:
    if chat_id <= 0:
        raise HTTPException(status_code=400, detail="Ungueltige chat_id.")
    if chat_type == "direct":
        row = db.query(DirectChat).filter_by(id=chat_id).first()
    else:
        row = db.query(ChatGroup).filter_by(id=chat_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Gespraech nicht gefunden.")
    return row


def _members(db: Session, chat_type: str, chat_id: int) -> set[int]:
    if chat_type == "direct":
        rows = (
            db.query(DirectChatMember.user_id)
            .filter(DirectChatMember.chat_id == chat_id)
            .all()
        )
    else:
        rows = (
            db.query(ChatGroupMember.user_id)
            .filter(ChatGroupMember.group_id == chat_id)
            .all()
        )
    return {int(r[0]) for r in rows}


def assert_member(db: Session, user_id: int, chat_type: str, chat_id: int) -> set[int]:
    _chat_row(db, chat_type, chat_id)
    mitglieder = _members(db, chat_type, chat_id)
    if user_id not in mitglieder:
        raise HTTPException(status_code=403, detail="Kein Mitglied dieses Gespraechs.")
    return mitglieder


def _blockiert(db: Session, user_a: int, user_b: int) -> bool:
    return (
        db.query(UserFriend)
        .filter(
            or_(
                and_(UserFriend.user_id == user_a, UserFriend.friend_id == user_b),
                and_(UserFriend.user_id == user_b, UserFriend.friend_id == user_a),
            ),
            UserFriend.status == "blocked",
        )
        .first()
        is not None
    )


def _assert_send(db: Session, user_id: int, chat_type: str, chat_id: int, mitglieder: set[int]) -> None:
    if chat_type == "direct":
        for other in mitglieder:
            if other != user_id and _blockiert(db, user_id, other):
                raise HTTPException(status_code=403, detail="Kommunikation nicht moeglich.")
        return
    from services.social_service import SocialService

    if not SocialService.has_group_permission(db, chat_id, user_id, "send_messages"):
        raise HTTPException(status_code=403, detail="Kein Recht, in dieser Gruppe zu schreiben.")


def _assert_group_permission(db: Session, user_id: int, group_id: int, recht: str) -> None:
    from services.social_service import SocialService

    if not SocialService.has_group_permission(db, group_id, user_id, recht):
        raise HTTPException(status_code=403, detail="Kein Recht fuer diese Aktion.")


def _assert_can_manage_ephemeral(db: Session, chat_type: str, chat_id: int, user_id: int, row: Any) -> None:
    if chat_type == "direct":
        if user_id not in _members(db, chat_type, chat_id):
            raise HTTPException(status_code=403, detail="Kein Mitglied dieses Gespraechs.")
        return
    if int(getattr(row, "owner_user_id", 0) or 0) == user_id:
        return
    mitglied = (
        db.query(ChatGroupMember)
        .filter_by(group_id=chat_id, user_id=user_id)
        .first()
    )
    if mitglied is not None and mitglied.role in ("owner", "admin"):
        return
    _assert_group_permission(db, user_id, chat_id, "set_disappearing_messages")


def _message_dict(message: E2eeMessage, reactions: Iterable[E2eeMessageReaction] = ()) -> dict[str, Any]:
    return {
        "id": int(message.id),
        "client_uuid": message.client_uuid,
        "chat_type": message.chat_type,
        "chat_id": int(message.chat_id),
        "sender_user_id": int(message.sender_user_id),
        "key_version": int(message.key_version),
        "encrypted_payload": "" if message.is_deleted else message.encrypted_payload,
        "is_deleted": bool(message.is_deleted),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "deleted_at": message.deleted_at.isoformat() if message.deleted_at else None,
        "expires_at": message.expires_at.isoformat() if message.expires_at else None,
        "is_pinned": bool(message.is_pinned),
        "pinned_at": message.pinned_at.isoformat() if message.pinned_at else None,
        "pinned_by_user_id": int(message.pinned_by_user_id) if message.pinned_by_user_id else None,
        "created_at": message.created_at.isoformat(),
        "reactions": [
            {
                "user_id": int(r.user_id),
                "encrypted_reaction": r.encrypted_reaction,
                "created_at": r.created_at.isoformat(),
            }
            for r in reactions
        ],
    }


def _publish_message(db: Session, message: E2eeMessage, typ: str = "message_created") -> None:
    mitglieder = _members(db, message.chat_type, message.chat_id)
    payload = {
        "type": typ,
        "message": _message_dict(message, reaktionen_fuer(db, [int(message.id)]).get(int(message.id), [])),
        # Flache Felder fuer Benachrichtigung und den Android-Dienst. Der
        # Datensatz bleibt unter `message` fuer die direkte Anwendung im Chat.
        "chat_type": message.chat_type,
        "chat_id": int(message.chat_id),
        "sender_user_id": int(message.sender_user_id),
        "client_uuid": message.client_uuid,
        "is_group": message.chat_type == "group",
        "sender_name": (
            db.query(User.username).filter(User.id == message.sender_user_id).scalar() or ""
        ),
    }
    if typ == "message_created":
        # Je Konto höchstens zwei Zusteller: ein Vordergrund-Client und der
        # eigene Dienst. Alle anderen bekommen `melden: false`; der Push geht
        # nur hinaus, wenn niemand die Meldung selbst zeigen kann. Der Absender
        # steht nicht darunter: seine eigene Nachricht meldet kein Gerät, auch
        # nicht das, auf dem gerade kein Fenster offen ist.
        empfaenger = [uid for uid in mitglieder if uid != message.sender_user_id]
        erlaubt = {
            uid
            for (uid,) in db.query(User.id)
            .filter(User.id.in_(empfaenger), User.device_notifications.is_(True))
            .all()
        } if empfaenger else set()
        zusteller: set[str] = set()
        for uid in empfaenger:
            if uid not in erlaubt:
                continue
            ziele, _ = SyncEventService.zustelllage(user_id=uid)
            zusteller |= ziele
        SyncEventService.publish(
            payload,
            user_ids=mitglieder,
            zusteller=zusteller,
            melden_markieren=True,
        )
        push_message(db, message, mitglieder)
    else:
        SyncEventService.publish(payload, user_ids=mitglieder)


def _state(db: Session, chat_type: str, chat_id: int, user_id: int, *, lock: bool = False) -> E2eeChatState:
    query = db.query(E2eeChatState).filter_by(
        chat_type=chat_type, chat_id=chat_id, user_id=user_id
    )
    if lock:
        query = query.with_for_update()
    state = query.first()
    if state is not None:
        return state
    state = E2eeChatState(
        chat_type=chat_type,
        chat_id=chat_id,
        user_id=user_id,
        last_delivered_message_id=0,
        last_read_message_id=0,
    )
    db.add(state)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        state = (
            db.query(E2eeChatState)
            .filter_by(chat_type=chat_type, chat_id=chat_id, user_id=user_id)
            .one()
        )
    return state


def ensure_direct_members(db: Session, chat: DirectChat, user_a: int, user_b: int) -> None:
    for uid in {int(user_a), int(user_b)}:
        exists = (
            db.query(DirectChatMember)
            .filter_by(chat_id=chat.id, user_id=uid)
            .first()
        )
        if exists is None:
            db.add(DirectChatMember(chat_id=chat.id, user_id=uid))
    db.flush()


def store_chat_keys(
    db: Session,
    user: User,
    chat_type: str,
    chat_id: int,
    key_version: int,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    chat_type = _clean_chat_type(chat_type)
    if key_version <= 0 or key_version > 1_000_000:
        raise HTTPException(status_code=400, detail="Ungueltige key_version.")
    if not rows or len(rows) > MAX_CHAT_KEYS:
        raise HTTPException(status_code=400, detail="Ungueltige Schluesselliste.")

    # Die Chat-Zeile sperren: zwei Clients duerfen nicht gleichzeitig zwei
    # verschiedene Schluessel fuer dieselbe Version anlegen.
    if chat_type == "direct":
        db.query(DirectChat.id).filter(DirectChat.id == chat_id).with_for_update().one()
    else:
        db.query(ChatGroup.id).filter(ChatGroup.id == chat_id).with_for_update().one()

    mitglieder = assert_member(db, user.id, chat_type, chat_id)
    ziele = [int(r.get("user_id") or 0) for r in rows]
    if len(set(ziele)) != len(ziele) or set(ziele) != mitglieder:
        raise HTTPException(status_code=403, detail="Schluessel muessen alle Mitglieder genau einmal nennen.")
    if chat_type == "group" and key_version > 1:
        mitglied = (
            db.query(ChatGroupMember)
            .filter_by(group_id=chat_id, user_id=user.id)
            .first()
        )
        if mitglied is None or mitglied.role not in ("owner", "admin"):
            _assert_group_permission(db, user.id, chat_id, "manage_roles")

    vorhanden = (
        db.query(E2eeChatKey)
        .filter_by(chat_type=chat_type, chat_id=chat_id, key_version=key_version)
        .count()
    )
    if vorhanden:
        raise HTTPException(status_code=409, detail="Diese Schluesselversion existiert bereits.")

    for row in rows:
        encrypted = str(row.get("encrypted_chat_key") or "").strip()
        if not encrypted or len(encrypted) > MAX_PAYLOAD_CHARS:
            raise HTTPException(status_code=400, detail="Ungueltiger Chat-Schluessel.")
        db.add(
            E2eeChatKey(
                chat_type=chat_type,
                chat_id=chat_id,
                user_id=int(row["user_id"]),
                key_version=key_version,
                encrypted_chat_key=encrypted,
            )
        )
    db.commit()
    return list_chat_keys(db, user.id, chat_type, chat_id)


def latest_chat_key_version(db: Session, chat_type: str, chat_id: int) -> int:
    value = (
        db.query(E2eeChatKey.key_version)
        .filter_by(chat_type=chat_type, chat_id=chat_id)
        .order_by(E2eeChatKey.key_version.desc())
        .limit(1)
        .scalar()
    )
    return int(value or 0)


def list_chat_keys(db: Session, user_id: int, chat_type: str, chat_id: int) -> list[dict[str, Any]]:
    chat_type = _clean_chat_type(chat_type)
    assert_member(db, user_id, chat_type, chat_id)
    rows = (
        db.query(E2eeChatKey)
        .filter_by(chat_type=chat_type, chat_id=chat_id, user_id=user_id)
        .order_by(E2eeChatKey.key_version.asc())
        .all()
    )
    return [
        {
            "chat_type": row.chat_type,
            "chat_id": int(row.chat_id),
            "key_version": int(row.key_version),
            "encrypted_chat_key": row.encrypted_chat_key,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


def _has_chat_key(db: Session, user_id: int, chat_type: str, chat_id: int, key_version: int) -> bool:
    return (
        db.query(E2eeChatKey.id)
        .filter_by(
            chat_type=chat_type,
            chat_id=chat_id,
            user_id=user_id,
            key_version=key_version,
        )
        .first()
        is not None
    )


def _assert_key_shared_by_members(
    db: Session,
    chat_type: str,
    chat_id: int,
    key_version: int,
    mitglieder: set[int],
) -> None:
    """Eine neue Nachricht darf nur eine Version nennen, die alle Mitglieder haben.

    Die neueste Version ist nicht Pflicht: eine offline eingereihte Nachricht
    unter einer aelteren Version bleibt sendbar, solange die Mitgliedschaft
    dieselbe ist. Kommt ein Mitglied hinzu, fehlt ihm die alte Version, und der
    Absender muss zuerst rotieren.
    """
    halter = {
        int(row[0])
        for row in db.query(E2eeChatKey.user_id)
        .filter_by(
            chat_type=chat_type,
            chat_id=chat_id,
            key_version=key_version,
        )
        .all()
    }
    fehlend = {int(uid) for uid in mitglieder} - halter
    if fehlend:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "key_version_not_shared",
                "message": "Diese Schluesselversion fehlt mindestens einem Mitglied.",
            },
        )


def send_message(
    db: Session,
    user: User,
    chat_type: str,
    chat_id: int,
    client_uuid: str,
    key_version: int,
    encrypted_payload: str,
) -> dict[str, Any]:
    chat_type = _clean_chat_type(chat_type)
    clean_uuid = (client_uuid or "").strip()
    if not clean_uuid or len(clean_uuid) > 64:
        raise HTTPException(status_code=400, detail="Ungueltige client_uuid.")
    payload = str(encrypted_payload or "")
    if not payload:
        raise HTTPException(status_code=400, detail="Leere Nutzlast.")
    if len(payload) > MAX_PAYLOAD_CHARS:
        raise HTTPException(status_code=413, detail="Nachricht ist zu gross.")
    if key_version <= 0:
        raise HTTPException(status_code=400, detail="Ungueltige key_version.")

    mitglieder = assert_member(db, user.id, chat_type, chat_id)
    _assert_send(db, user.id, chat_type, chat_id, mitglieder)

    # Die UUID ist global eindeutig. Ein Treffer in einem anderen Chat ist
    # deshalb keine Wiederholung, sondern ein Konflikt.
    bestand = db.query(E2eeMessage).filter_by(client_uuid=clean_uuid).first()
    if bestand is not None:
        if int(bestand.sender_user_id) != user.id:
            raise HTTPException(status_code=409, detail="client_uuid gehoert einer anderen Nachricht.")
        if bestand.chat_type != chat_type or int(bestand.chat_id) != int(chat_id):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "client_uuid_other_chat",
                    "message": "Diese client_uuid gehoert zu einem anderen Gespraech.",
                },
            )
        return _message_dict(bestand)

    if not _has_chat_key(db, user.id, chat_type, chat_id, key_version):
        raise HTTPException(status_code=409, detail="Chat-Schluessel fehlt oder ist nicht freigegeben.")
    _assert_key_shared_by_members(db, chat_type, chat_id, key_version, mitglieder)

    chat = _chat_row(db, chat_type, chat_id)
    ttl = getattr(chat, "ephemeral_ttl_seconds", None)
    expires_at = _now() + timedelta(seconds=int(ttl)) if ttl else None
    message = E2eeMessage(
        client_uuid=clean_uuid,
        chat_type=chat_type,
        chat_id=chat_id,
        sender_user_id=user.id,
        key_version=key_version,
        encrypted_payload=payload,
        created_at=_now(),
        expires_at=expires_at,
    )
    db.add(message)
    from services.achievement_service import AchievementService

    # Die erste E2EE-Nachricht ist der Weg zu "Kryptographischer Pakt". Der
    # Savepoint von `melde` traegt die Zeile mit dem Commit dieser Nachricht.
    AchievementService.melde(db, user.id, "social_zero_knowledge")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        bestand = db.query(E2eeMessage).filter_by(client_uuid=clean_uuid).first()
        if bestand is None:
            raise
        return _message_dict(bestand)
    db.refresh(message)
    _publish_message(db, message)
    return _message_dict(message)


def list_messages(
    db: Session,
    user: User,
    chat_type: str,
    chat_id: int,
    limit: int = 50,
    before_id: int | None = None,
    after_id: int | None = None,
) -> dict[str, Any]:
    chat_type = _clean_chat_type(chat_type)
    mitglieder = assert_member(db, user.id, chat_type, chat_id)
    limit = max(1, min(int(limit or 50), MAX_PAGE))
    query = db.query(E2eeMessage).filter_by(chat_type=chat_type, chat_id=chat_id)
    if after_id and after_id > 0:
        query = query.filter(E2eeMessage.id > after_id).order_by(E2eeMessage.id.asc())
    else:
        if before_id and before_id > 0:
            query = query.filter(E2eeMessage.id < before_id)
        query = query.order_by(E2eeMessage.id.desc())
    rows = query.limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows.reverse()
    reaktionen = reaktionen_fuer(db, [int(r.id) for r in rows])
    messages = [
        _message_dict(row, reaktionen.get(int(row.id), []))
        for row in rows
    ]

    meine = _state(db, chat_type, chat_id, user.id)
    partner_delivered = 0
    partner_read = 0
    if chat_type == "direct":
        for other in mitglieder:
            if other == user.id:
                continue
            fremd = (
                db.query(E2eeChatState)
                .filter_by(chat_type=chat_type, chat_id=chat_id, user_id=other)
                .first()
            )
            if fremd is not None:
                partner_delivered = int(fremd.last_delivered_message_id)
                partner_read = int(fremd.last_read_message_id)
            break

    chat = _chat_row(db, chat_type, chat_id)
    angeheftet = (
        db.query(E2eeMessage)
        .filter_by(chat_type=chat_type, chat_id=chat_id, is_pinned=True, is_deleted=False)
        .order_by(E2eeMessage.pinned_at.desc(), E2eeMessage.id.desc())
        .first()
    )
    return {
        "messages": messages,
        "pinned_message": (
            _message_dict(
                angeheftet,
                reaktionen_fuer(db, [int(angeheftet.id)]).get(int(angeheftet.id), []),
            )
            if angeheftet is not None
            else None
        ),
        "has_more": has_more,
        "my_last_delivered_id": int(meine.last_delivered_message_id),
        "my_last_read_id": int(meine.last_read_message_id),
        "partner_last_delivered_id": partner_delivered,
        "partner_last_read_id": partner_read,
        "ephemeral_ttl_seconds": int(getattr(chat, "ephemeral_ttl_seconds", 0) or 0),
        "ephemeral_enabled_by_user_id": getattr(chat, "ephemeral_enabled_by_user_id", None),
    }


def update_message(
    db: Session, user: User, client_uuid: str, encrypted_payload: str, key_version: int | None = None
) -> dict[str, Any]:
    payload = str(encrypted_payload or "")
    if not payload or len(payload) > MAX_PAYLOAD_CHARS:
        raise HTTPException(status_code=400, detail="Ungueltige Nutzlast.")
    message = db.query(E2eeMessage).filter_by(client_uuid=client_uuid).first()
    if message is None:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden.")
    assert_member(db, user.id, message.chat_type, message.chat_id)
    if int(message.sender_user_id) != user.id:
        raise HTTPException(status_code=403, detail="Nur der Absender darf bearbeiten.")
    if message.is_deleted:
        raise HTTPException(status_code=410, detail="Nachricht ist geloescht.")
    if key_version is not None and int(key_version) != int(message.key_version):
        raise HTTPException(status_code=409, detail="Schluesselversion passt nicht.")
    message.encrypted_payload = payload
    message.edited_at = _now()
    db.commit()
    db.refresh(message)
    _publish_message(db, message, "message_updated")
    return _message_dict(message, reaktionen_fuer(db, [int(message.id)]).get(int(message.id), []))


def delete_message(db: Session, user: User, client_uuid: str) -> dict[str, Any]:
    message = db.query(E2eeMessage).filter_by(client_uuid=client_uuid).first()
    if message is None:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden.")
    mitglieder = assert_member(db, user.id, message.chat_type, message.chat_id)
    if int(message.sender_user_id) != user.id:
        if message.chat_type != "group":
            raise HTTPException(status_code=403, detail="Nur der Absender darf loeschen.")
        _assert_group_permission(db, user.id, message.chat_id, "delete_messages")
    if not message.is_deleted:
        message.is_deleted = True
        message.encrypted_payload = ""
        message.deleted_at = _now()
        db.query(E2eeMessageReaction).filter_by(message_id=message.id).delete()
        db.commit()
        db.refresh(message)
        _publish_message(db, message, "message_deleted")
    return _message_dict(message)


def set_reaction(db: Session, user: User, client_uuid: str, encrypted_reaction: str | None) -> dict[str, Any]:
    message = db.query(E2eeMessage).filter_by(client_uuid=client_uuid).first()
    if message is None:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden.")
    assert_member(db, user.id, message.chat_type, message.chat_id)
    if message.is_deleted:
        raise HTTPException(status_code=410, detail="Nachricht ist geloescht.")
    bestand = db.query(E2eeMessageReaction).filter_by(message_id=message.id, user_id=user.id).first()
    if not encrypted_reaction:
        if bestand is not None:
            db.delete(bestand)
            db.commit()
    else:
        if len(encrypted_reaction) > 4096:
            raise HTTPException(status_code=413, detail="Reaktion ist zu gross.")
        if bestand is None:
            db.add(
                E2eeMessageReaction(
                    message_id=message.id,
                    user_id=user.id,
                    encrypted_reaction=encrypted_reaction,
                )
            )
        else:
            bestand.encrypted_reaction = encrypted_reaction
        db.commit()
    db.refresh(message)
    _publish_message(db, message, "message_updated")
    return _message_dict(message, reaktionen_fuer(db, [int(message.id)]).get(int(message.id), []))


def set_pinned(db: Session, user: User, client_uuid: str, pinned: bool) -> dict[str, Any]:
    message = db.query(E2eeMessage).filter_by(client_uuid=client_uuid).first()
    if message is None:
        raise HTTPException(status_code=404, detail="Nachricht nicht gefunden.")
    assert_member(db, user.id, message.chat_type, message.chat_id)
    if message.chat_type == "group":
        _assert_group_permission(db, user.id, message.chat_id, "pin_messages")
    message.is_pinned = bool(pinned)
    message.pinned_at = _now() if pinned else None
    message.pinned_by_user_id = user.id if pinned else None
    db.commit()
    db.refresh(message)
    _publish_message(db, message, "message_updated")
    return _message_dict(message, reaktionen_fuer(db, [int(message.id)]).get(int(message.id), []))


def ack_messages(db: Session, user: User, chat_type: str, chat_id: int, up_to_id: int) -> dict[str, Any]:
    chat_type = _clean_chat_type(chat_type)
    mitglieder = assert_member(db, user.id, chat_type, chat_id)
    if up_to_id <= 0:
        return {"ok": True, "last_delivered_message_id": 0}
    # Eine Nachricht, die es in diesem Chat nicht gibt, darf den Stand nicht
    # vorspulen.
    hoechste = (
        db.query(E2eeMessage.id)
        .filter_by(chat_type=chat_type, chat_id=chat_id)
        .order_by(E2eeMessage.id.desc())
        .limit(1)
        .scalar()
    )
    if hoechste is None:
        return {"ok": True, "last_delivered_message_id": 0}
    ziel = min(int(up_to_id), int(hoechste))
    state = _state(db, chat_type, chat_id, user.id, lock=True)
    if ziel > int(state.last_delivered_message_id):
        state.last_delivered_message_id = ziel
        db.commit()
    SyncEventService.publish(
        {
            "type": "chat_state",
            "chat_type": chat_type,
            "chat_id": chat_id,
            "user_id": user.id,
            "last_delivered_message_id": int(state.last_delivered_message_id),
            "last_read_message_id": int(state.last_read_message_id),
        },
        user_id=user.id,
    )
    if chat_type == "direct":
        for other in mitglieder:
            if other != user.id:
                SyncEventService.publish(
                    {
                        "type": "delivery_receipt",
                        "chat_type": chat_type,
                        "chat_id": chat_id,
                        "user_id": user.id,
                        "up_to_id": int(state.last_delivered_message_id),
                    },
                    user_id=other,
                )
    return {"ok": True, "last_delivered_message_id": int(state.last_delivered_message_id)}


def mark_read(db: Session, user: User, chat_type: str, chat_id: int, up_to_id: int) -> dict[str, Any]:
    chat_type = _clean_chat_type(chat_type)
    mitglieder = assert_member(db, user.id, chat_type, chat_id)
    if up_to_id <= 0:
        return {"ok": True, "last_read_message_id": 0}
    hoechste = (
        db.query(E2eeMessage.id)
        .filter_by(chat_type=chat_type, chat_id=chat_id)
        .order_by(E2eeMessage.id.desc())
        .limit(1)
        .scalar()
    )
    if hoechste is None:
        return {"ok": True, "last_read_message_id": 0}
    ziel = min(int(up_to_id), int(hoechste))
    state = _state(db, chat_type, chat_id, user.id, lock=True)
    state.last_read_message_id = max(int(state.last_read_message_id), ziel)
    state.last_delivered_message_id = max(int(state.last_delivered_message_id), ziel)
    db.commit()
    SyncEventService.publish(
        {
            "type": "chat_state",
            "chat_type": chat_type,
            "chat_id": chat_id,
            "user_id": user.id,
            "last_delivered_message_id": int(state.last_delivered_message_id),
            "last_read_message_id": int(state.last_read_message_id),
        },
        user_id=user.id,
    )
    if chat_type == "direct":
        for other in mitglieder:
            if other != user.id:
                SyncEventService.publish(
                    {
                        "type": "read_receipt",
                        "chat_type": chat_type,
                        "chat_id": chat_id,
                        "user_id": user.id,
                        "up_to_id": int(state.last_read_message_id),
                    },
                    user_id=other,
                )
    return {"ok": True, "last_read_message_id": int(state.last_read_message_id)}


def get_ephemeral(db: Session, user: User, chat_type: str, chat_id: int) -> dict[str, Any]:
    chat_type = _clean_chat_type(chat_type)
    assert_member(db, user.id, chat_type, chat_id)
    chat = _chat_row(db, chat_type, chat_id)
    return {
        "chat_type": chat_type,
        "chat_id": chat_id,
        "ephemeral_ttl_seconds": int(getattr(chat, "ephemeral_ttl_seconds", 0) or 0),
        "ephemeral_enabled_by_user_id": getattr(chat, "ephemeral_enabled_by_user_id", None),
    }


def set_ephemeral(
    db: Session, user: User, chat_type: str, chat_id: int, ttl_seconds: int
) -> dict[str, Any]:
    chat_type = _clean_chat_type(chat_type)
    assert_member(db, user.id, chat_type, chat_id)
    chat = _chat_row(db, chat_type, chat_id)
    if ttl_seconds < 0 or ttl_seconds > 90 * 24 * 3600:
        raise HTTPException(status_code=400, detail="Ungueltige Frist.")
    aktuell_ttl = int(getattr(chat, "ephemeral_ttl_seconds", 0) or 0)
    aktiviert_von = int(getattr(chat, "ephemeral_enabled_by_user_id", 0) or 0)

    # Dieselbe Frist noch einmal zu setzen ist keine Aenderung. Sonst wuerde
    # ein zweiter Klick den Aktivator ueberschreiben und dessen Recht aushebeln.
    if ttl_seconds == aktuell_ttl:
        return get_ephemeral(db, user, chat_type, chat_id)

    if aktiviert_von and aktiviert_von != user.id:
        if chat_type == "direct":
            raise HTTPException(
                status_code=403,
                detail="Nur wer die verschwindenden Nachrichten eingeschaltet hat, darf sie aendern.",
            )
        if int(getattr(chat, "owner_user_id", 0) or 0) != user.id:
            _assert_group_permission(db, user.id, chat_id, "set_disappearing_messages")
    elif chat_type == "group" and ttl_seconds > 0:
        # Auch das erste Einschalten in einer Gruppe braucht das Recht.
        _assert_can_manage_ephemeral(db, chat_type, chat_id, user.id, chat)

    if ttl_seconds == 0:
        chat.ephemeral_ttl_seconds = None
        chat.ephemeral_enabled_by_user_id = None
    else:
        chat.ephemeral_ttl_seconds = int(ttl_seconds)
        chat.ephemeral_enabled_by_user_id = user.id
    db.commit()
    SyncEventService.publish(
        {
            "type": "chat_ephemeral",
            "chat_type": chat_type,
            "chat_id": chat_id,
            "ephemeral_ttl_seconds": int(chat.ephemeral_ttl_seconds or 0),
            "ephemeral_enabled_by_user_id": chat.ephemeral_enabled_by_user_id,
        },
        user_ids=_members(db, chat_type, chat_id),
    )
    return get_ephemeral(db, user, chat_type, chat_id)


def cleanup_expired(db: Session) -> int:
    """Loescht nur, was ausdruecklich eine Frist hat. Normale Nachrichten bleiben."""
    jetzt = _now()
    rows = (
        db.query(E2eeMessage)
        .filter(E2eeMessage.expires_at.is_not(None), E2eeMessage.expires_at <= jetzt)
        .all()
    )
    for row in rows:
        db.delete(row)
    if rows:
        from services.chat_media_service import ChatMediaService

        ChatMediaService.cleanup_expired_media(db)
        db.commit()
    return len(rows)
