"""Direktgespraeche: anlegen, pruefen und die Kennung liefern.

Die Route lag bis 10/2026 in `mailbox.py`, zusammen mit dem blinden Relais.
Das Relais ist entfernt; was bleibt, ist der Direktchat als Container fuer
`e2ee_messages`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, verify_csrf
from models import DirectChat, DirectChatMember, User
from routers.social.basis import _check_social_enabled
from schemas.social import CanMessageResponse, DirectChatResponse
from services.social_service import SocialService

router = APIRouter(dependencies=[Depends(_check_social_enabled)])


@router.get("/chat/can-message/{target_user_id}", response_model=CanMessageResponse)
def can_message(
    target_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    can, reason = SocialService.can_message_user(db, current_user.id, target_user_id)
    return {
        "can_message": can,
        "reason": reason,
        "blind_mailbox_id": None,
    }


@router.post(
    "/chat/start/{target_user_id}",
    response_model=DirectChatResponse,
    dependencies=[Depends(verify_csrf)],
)
def start_direct_chat(
    target_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    chat = SocialService.ensure_direct_chat(db, current_user.id, target_user_id)
    other = db.query(User).filter_by(id=target_user_id).first()
    if other is None:
        raise HTTPException(status_code=404, detail="Zielnutzer nicht gefunden")
    is_friend = SocialService.is_confirmed_friend(db, current_user.id, target_user_id)
    pres = SocialService.get_presence_for_viewer(db, current_user.id, other)
    return {
        "id": chat.id,
        "other_user_id": other.id,
        "other_username": other.username,
        "other_avatar_url": other.avatar_url,
        "blind_mailbox_id": chat.blind_mailbox_id,
        "is_friend": is_friend,
        "other_privacy": getattr(other, "social_privacy", "friends"),
        "presence": pres,
        "info": SocialService.info_fuer_viewer(
            db, current_user.id, other, ist_freund=is_friend
        ),
        "created_at": chat.created_at,
        "updated_at": chat.updated_at,
    }


@router.get(
    "/chat/conversations",
    response_model=list[DirectChatResponse],
)
def list_direct_chats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    my_memberships = (
        db.query(DirectChatMember.chat_id)
        .filter(DirectChatMember.user_id == current_user.id)
        .all()
    )
    chat_ids = [m[0] for m in my_memberships]
    if not chat_ids:
        return []

    other_members = (
        db.query(DirectChatMember.chat_id, DirectChatMember.user_id)
        .filter(
            DirectChatMember.chat_id.in_(chat_ids),
            DirectChatMember.user_id != current_user.id,
        )
        .all()
    )
    other_by_chat = {m[0]: m[1] for m in other_members}

    chats = db.query(DirectChat).filter(DirectChat.id.in_(chat_ids)).all()
    user_ids = list(other_by_chat.values())
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    results = []
    for chat in chats:
        other_id = other_by_chat.get(chat.id)
        if not other_id or other_id not in users:
            continue
        other = users[other_id]
        is_friend = SocialService.is_confirmed_friend(db, current_user.id, other.id)
        is_blocked = SocialService.is_blocked(db, current_user.id, other.id)
        pres = SocialService.get_presence_for_viewer(db, current_user.id, other)
        results.append({
            "id": chat.id,
            "other_user_id": other.id,
            "other_username": other.username,
            "other_avatar_url": other.avatar_url,
            "blind_mailbox_id": chat.blind_mailbox_id,
            "is_friend": is_friend,
            "is_blocked": is_blocked,
            "other_privacy": getattr(other, "social_privacy", "friends"),
            "presence": pres,
            "info": SocialService.info_fuer_viewer(
                db, current_user.id, other, ist_freund=is_friend
            ),
            "created_at": chat.created_at,
            "updated_at": chat.updated_at,
        })
    results.sort(key=lambda c: c["updated_at"], reverse=True)
    return results
