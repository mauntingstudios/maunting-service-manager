"""Der eine E2EE-Nachrichtenweg.

Senden, Laden, Bearbeiten, Loeschen, Quittieren. Alles andere (blinde Mailbox,
Geraete-Queue, Delivery-Inbox) ist entfernt.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, verify_csrf
from models import User
from routers.social.basis import _check_social_enabled
from services.social.messages_service import (
    ack_messages,
    delete_message,
    get_ephemeral,
    list_messages,
    mark_read,
    send_message,
    set_ephemeral,
    set_pinned,
    set_reaction,
    update_message,
)

router = APIRouter(dependencies=[Depends(_check_social_enabled)])

ChatType = Annotated[str, Field(pattern="^(direct|group)$")]


class SendMessageRequest(BaseModel):
    chat_type: ChatType
    chat_id: int = Field(..., gt=0)
    client_uuid: str = Field(..., min_length=1, max_length=64)
    key_version: int = Field(1, ge=1)
    encrypted_payload: str = Field(..., min_length=1)


class UpdateMessageRequest(BaseModel):
    encrypted_payload: str = Field(..., min_length=1)
    key_version: int | None = Field(None, ge=1)


class ReactionRequest(BaseModel):
    encrypted_reaction: str | None = Field(None, max_length=4096)


class PinRequest(BaseModel):
    pinned: bool


class ChatStateRequest(BaseModel):
    chat_type: ChatType
    chat_id: int = Field(..., gt=0)
    up_to_id: int = Field(..., ge=0)


class EphemeralRequest(BaseModel):
    chat_type: ChatType
    chat_id: int = Field(..., gt=0)
    ttl_seconds: int = Field(..., ge=0, le=90 * 24 * 3600)


@router.post("/messages/send", dependencies=[Depends(verify_csrf)])
def send_chat_message(
    req: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return send_message(
        db,
        current_user,
        req.chat_type,
        req.chat_id,
        req.client_uuid,
        req.key_version,
        req.encrypted_payload,
    )


@router.get("/messages")
def get_chat_messages(
    chat_type: str = Query(..., pattern="^(direct|group)$"),
    chat_id: int = Query(..., gt=0),
    limit: int = Query(50, ge=1, le=100),
    before_id: int | None = Query(None, ge=1),
    after_id: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return list_messages(
        db,
        current_user,
        chat_type,
        chat_id,
        limit=limit,
        before_id=before_id,
        after_id=after_id,
    )


@router.get("/messages/ephemeral")
def get_chat_ephemeral(
    chat_type: str = Query(..., pattern="^(direct|group)$"),
    chat_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return get_ephemeral(db, current_user, chat_type, chat_id)


@router.put("/messages/ephemeral", dependencies=[Depends(verify_csrf)])
def set_chat_ephemeral(
    req: EphemeralRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return set_ephemeral(db, current_user, req.chat_type, req.chat_id, req.ttl_seconds)


@router.put("/messages/{client_uuid}", dependencies=[Depends(verify_csrf)])
def update_chat_message(
    client_uuid: str,
    req: UpdateMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return update_message(
        db, current_user, client_uuid, req.encrypted_payload, req.key_version
    )


@router.delete("/messages/{client_uuid}", dependencies=[Depends(verify_csrf)])
def delete_chat_message(
    client_uuid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return delete_message(db, current_user, client_uuid)


@router.post("/messages/{client_uuid}/reaction", dependencies=[Depends(verify_csrf)])
def react_to_chat_message(
    client_uuid: str,
    req: ReactionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return set_reaction(db, current_user, client_uuid, req.encrypted_reaction)


@router.post("/messages/{client_uuid}/pin", dependencies=[Depends(verify_csrf)])
def pin_chat_message(
    client_uuid: str,
    req: PinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return set_pinned(db, current_user, client_uuid, req.pinned)


@router.post("/messages/ack", dependencies=[Depends(verify_csrf)])
def acknowledge_chat_messages(
    req: ChatStateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return ack_messages(db, current_user, req.chat_type, req.chat_id, req.up_to_id)


@router.post("/messages/read", dependencies=[Depends(verify_csrf)])
def read_chat_messages(
    req: ChatStateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return mark_read(db, current_user, req.chat_type, req.chat_id, req.up_to_id)
