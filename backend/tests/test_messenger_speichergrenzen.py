"""Kein Konto fuellt die Platte ueber den Messenger.

Die frueheren Grenzen haengen am alten Umschlagweg und sind mit ihm entfallen.
Am Einheits-Transport bleiben dieselben drei Stoßrichtungen: eine Nachricht
hat eine feste Groesse (HTTP und WebSocket teilen den Dienst), Anhaenge haben
ein Kontingent je Konto, und Stories verfallen wirklich.
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import ChatMedia, ChatStory, E2eeChatKey, E2eeMessage, User
from services import chat_media_service, social_service
from services.social import messages_service
from services.auth_service import AuthService
from services.chat_media_service import ChatMediaService
from services.chat_media_validator import (
    MAX_STORY_MEDIA_URL_CHARS,
    ChatMediaSecurityError,
    validate_story_media_url,
)
from services.social_service import SocialService

_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _paar(db: Session, prefix: str) -> tuple[User, User, int]:
    a = AuthService.create_user(db, f"{prefix}_a", f"{prefix}_a@probe.example", "ProbePass123!")
    b = AuthService.create_user(db, f"{prefix}_b", f"{prefix}_b@probe.example", "ProbePass123!")
    a.social_privacy = b.social_privacy = "public"
    db.commit()
    chat = SocialService.ensure_direct_chat(db, a.id, b.id)
    for uid in (a.id, b.id):
        db.add(
            E2eeChatKey(
                chat_type="direct",
                chat_id=chat.id,
                user_id=uid,
                key_version=1,
                encrypted_chat_key="gepackt",
            )
        )
    db.commit()
    return a, b, chat.id


# ── Nachrichten ─────────────────────────────────────────────────────────────


def test_zu_grosse_nachricht_scheitert_am_dienst(db: Session, monkeypatch) -> None:
    a, _, chat_id = _paar(db, "gross")
    monkeypatch.setattr(messages_service, "MAX_PAYLOAD_CHARS", 100)

    with pytest.raises(HTTPException) as fehler:
        messages_service.send_message(
            db, a, "direct", chat_id, "zu-gross-1", 1, "A" * 101
        )
    assert fehler.value.status_code == 413

    # Knapp unter der Grenze geht es.
    gesendet = messages_service.send_message(
        db, a, "direct", chat_id, "passt-1", 1, "A" * 100
    )
    assert gesendet["id"]


def test_zu_grosse_nachricht_scheitert_auch_am_websocket_weg(
    client, db: Session, owner_user: User, owner_cookies: dict, monkeypatch
) -> None:
    """Der WebSocket reicht das rohe JSON an denselben Dienst.

    Ohne gemeinsame Pruefung waere er die nachsichtigere Tuer.
    """
    partner = AuthService.create_user(
        db, "ws-gross-partner", "ws-gross-partner@probe.example", "ProbePass123!"
    )
    partner.social_privacy = "public"
    owner_user.social_privacy = "public"
    db.commit()
    chat = SocialService.ensure_direct_chat(db, owner_user.id, partner.id)
    for uid in (owner_user.id, partner.id):
        db.add(
            E2eeChatKey(
                chat_type="direct",
                chat_id=chat.id,
                user_id=uid,
                key_version=1,
                encrypted_chat_key="gepackt",
            )
        )
    db.commit()
    monkeypatch.setattr(messages_service, "MAX_PAYLOAD_CHARS", 100)

    with client.websocket_connect(
        "/api/social/ws", cookies=owner_cookies, headers={"origin": "http://localhost:3000"}
    ) as ws:
        ws.send_json(
            {
                "type": "send_message",
                "chat_type": "direct",
                "chat_id": chat.id,
                "client_uuid": "ws-zu-gross-1",
                "key_version": 1,
                "encrypted_payload": "A" * 101,
            }
        )
        antwort = ws.receive_json()

    assert antwort["type"] == "error"
    assert antwort["status_code"] == 413
    assert db.query(E2eeMessage).filter_by(client_uuid="ws-zu-gross-1").count() == 0


# ── Stories ─────────────────────────────────────────────────────────────────


def test_story_bild_mit_fuellmaterial_wird_abgewiesen() -> None:
    bild = "data:image/png;base64," + base64.b64encode(_PNG).decode("ascii")
    assert validate_story_media_url(bild) == bild

    # b64decode überlas fremde Zeichen: ein kleines Bild trug so beliebig viel mit.
    with pytest.raises(ChatMediaSecurityError):
        validate_story_media_url(bild + "!" * 1000)
    with pytest.raises(ChatMediaSecurityError):
        validate_story_media_url("https://bilder.example/" + "a" * MAX_STORY_MEDIA_URL_CHARS)


def test_stories_je_konto_sind_begrenzt(db: Session, owner_user: User, monkeypatch) -> None:
    monkeypatch.setattr(social_service, "MAX_AKTIVE_STORIES", 2)
    SocialService.create_story(db, owner_user, "eins")
    SocialService.create_story(db, owner_user, "zwei")

    with pytest.raises(HTTPException) as fehler:
        SocialService.create_story(db, owner_user, "drei")
    assert fehler.value.status_code == 429


def test_abgelaufene_stories_werden_geloescht(db: Session, owner_user: User) -> None:
    jetzt = datetime.now(timezone.utc)
    db.add_all(
        [
            ChatStory(user_id=owner_user.id, content="alt", expires_at=jetzt - timedelta(minutes=1)),
            ChatStory(user_id=owner_user.id, content="frisch", expires_at=jetzt + timedelta(hours=1)),
        ]
    )
    db.commit()

    assert SocialService.cleanup_expired_stories(db) == 1
    assert [s.content for s in db.query(ChatStory).filter_by(user_id=owner_user.id)] == ["frisch"]


# ── Anhaenge ────────────────────────────────────────────────────────────────


def test_anhaenge_haben_ein_kontingent_je_konto(db: Session, monkeypatch) -> None:
    a, b, chat_id = _paar(db, "kontingent")
    blob = "sv-blob-v1:AES-GCM:iv=12345678:tag=87654321:ciphertext=EncryptedPayloadXYZ"
    monkeypatch.setattr(chat_media_service, "MEDIEN_KONTINGENT_BYTES", len(blob) * 2)

    for _ in range(2):
        ChatMediaService.upload_encrypted_media(
            db, uploader=a, chat_type="direct", chat_id=chat_id,
            ciphertext_blob=blob, file_name="bild.jpg",
        )
    with pytest.raises(HTTPException) as fehler:
        ChatMediaService.upload_encrypted_media(
            db, uploader=a, chat_type="direct", chat_id=chat_id,
            ciphertext_blob=blob, file_name="bild.jpg",
        )
    assert fehler.value.status_code == 413
    assert db.query(ChatMedia).filter_by(uploader_user_id=a.id).count() == 2
    # Das Kontingent gehoert dem Hochladenden, nicht dem Gespraech.
    assert ChatMediaService.upload_encrypted_media(
        db, uploader=b, chat_type="direct", chat_id=chat_id,
        ciphertext_blob=blob, file_name="bild.jpg",
    ).id
