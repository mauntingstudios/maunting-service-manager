"""Loeschen einer Nachricht: Inhalt raus, Reaktionen raus, und nur fuer Befugte.

Bis 09/2026 war „fuer alle loeschen" eine reine Anzeigesache: Der Client schickte
einen Steuerumschlag, die Gegenseite blendete die Zeile aus, und Chiffretext wie
Anhang blieben liegen. Ein neu eingerichtetes Geraet holte die Mailbox von vorn
und bekam die geloeschte Nachricht zurueck.

Seit dem einheitlichen Transport liegt die Nachricht genau einmal in
`e2ee_messages`. Der Server setzt beim Loeschen `is_deleted`, leert die
Nutzlast, entfernt die Reaktionen und meldet das Ereignis — und er laesst nur
den Absender (im Direktgespraech) beziehungsweise ein Mitglied mit
`delete_messages` (in der Gruppe) heran.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import ChatGroupMember, E2eeMessage, E2eeMessageReaction, User
from services.social.messages_service import delete_message
from services.social_service import SocialService


def _nachricht(
    db: Session,
    chat_type: str,
    chat_id: int,
    sender: User,
    client_uuid: str,
) -> E2eeMessage:
    message = E2eeMessage(
        client_uuid=client_uuid,
        chat_type=chat_type,
        chat_id=chat_id,
        sender_user_id=sender.id,
        key_version=1,
        encrypted_payload="chiffrat",
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def _direktchat(db: Session, a: User, b: User) -> int:
    anfrage = SocialService.send_friend_request(db, a.id, b.username)
    SocialService.accept_friend_request(db, b.id, anfrage["id"])
    return SocialService.ensure_direct_chat(db, a.id, b.id).id


def test_der_absender_loescht_seine_nachricht(
    db: Session, owner_user: User, regular_user: User
):
    chat_id = _direktchat(db, owner_user, regular_user)
    nachricht = _nachricht(db, "direct", chat_id, owner_user, "loeschen-1")
    db.add(
        E2eeMessageReaction(
            message_id=nachricht.id,
            user_id=regular_user.id,
            encrypted_reaction="chiffrat-reaktion",
        )
    )
    db.commit()

    ergebnis = delete_message(db, owner_user, "loeschen-1")

    assert ergebnis["is_deleted"] is True
    assert ergebnis["encrypted_payload"] == ""
    assert ergebnis["deleted_at"] is not None
    db.expire_all()
    gespeichert = db.query(E2eeMessage).filter_by(client_uuid="loeschen-1").one()
    assert gespeichert.encrypted_payload == ""
    assert (
        db.query(E2eeMessageReaction).filter_by(message_id=nachricht.id).count() == 0
    )


def test_ein_fremder_loescht_im_direktchat_nichts(
    db: Session, owner_user: User, regular_user: User
):
    chat_id = _direktchat(db, owner_user, regular_user)
    _nachricht(db, "direct", chat_id, owner_user, "loeschen-2")

    with pytest.raises(HTTPException) as fehler:
        delete_message(db, regular_user, "loeschen-2")

    assert fehler.value.status_code == 403
    db.expire_all()
    assert db.query(E2eeMessage).filter_by(client_uuid="loeschen-2").one().is_deleted is False


def test_unbekannte_kennung_wird_nicht_erfunden(db: Session, owner_user: User):
    with pytest.raises(HTTPException) as fehler:
        delete_message(db, owner_user, "gibt-es-nicht")

    assert fehler.value.status_code == 404


def test_in_der_gruppe_loescht_ein_mitglied_mit_recht_auch_fremde_nachrichten(
    db: Session, owner_user: User, regular_user: User
):
    gruppe = SocialService.create_group(db, owner_user)
    SocialService.join_group_by_invite_code(db, regular_user, gruppe.invite_code)
    mitglied = (
        db.query(ChatGroupMember)
        .filter_by(group_id=gruppe.id, user_id=regular_user.id)
        .one()
    )
    mitglied.permissions = "delete_messages"
    db.commit()
    _nachricht(db, "group", gruppe.id, owner_user, "loeschen-3")

    ergebnis = delete_message(db, regular_user, "loeschen-3")

    assert ergebnis["is_deleted"] is True


def test_ohne_recht_loescht_ein_mitglied_keine_fremde_nachricht(
    db: Session, owner_user: User, regular_user: User
):
    gruppe = SocialService.create_group(db, owner_user)
    SocialService.join_group_by_invite_code(db, regular_user, gruppe.invite_code)
    _nachricht(db, "group", gruppe.id, owner_user, "loeschen-4")

    with pytest.raises(HTTPException) as fehler:
        delete_message(db, regular_user, "loeschen-4")

    assert fehler.value.status_code == 403
    db.expire_all()
    assert db.query(E2eeMessage).filter_by(client_uuid="loeschen-4").one().is_deleted is False
