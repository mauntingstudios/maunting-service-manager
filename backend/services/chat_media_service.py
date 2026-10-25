"""Sichere Chat-Medien: verschluesselte Blobs, Mitgliedschaft, signierte URLs.

Der neue Transport kennt nur noch ``chat_type`` und ``chat_id``. Die alten
Mailbox-Kennungen bleiben als Ablagefeld erhalten, tragen aber nur noch
``direct:<id>`` beziehungsweise ``group:<id>``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import uuid
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from models import (
    ChatGroup,
    ChatGroupMember,
    ChatMedia,
    DirectChat,
    DirectChatMember,
    User,
    UserFriend,
)
from services.chat_media_validator import (
    MAX_MEDIA_BYTES,
    validate_encrypted_blob_payload,
    sanitize_attachment_filename,
)
from services.social_service import SocialService


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _signing_secret() -> str:
    secret = getattr(settings, "secret_key", None)
    if not secret:
        raise RuntimeError("MSM_SECRET_KEY ist nicht konfiguriert.")
    return secret


def _blockiert(db: Session, user_a_id: int, user_b_id: int) -> bool:
    return SocialService.is_blocked(db, user_a_id, user_b_id)


MEDIEN_KONTINGENT_BYTES = 2 * 1024 * 1024 * 1024


def _chat_key(chat_type: str, chat_id: int) -> str:
    return f"{chat_type}:{int(chat_id)}"


class ChatMediaService:
    """Zentrale Geschaeftslogik fuer Chat-Medienanhaenge und signierte URLs."""

    @classmethod
    def assert_chat_membership(cls, db: Session, user_id: int, media: ChatMedia) -> None:
        if media.group_id is not None:
            group = db.query(ChatGroup).filter(ChatGroup.id == media.group_id).first()
            if not group:
                raise HTTPException(status_code=404, detail="Chat-Gruppe existiert nicht mehr.")
            is_member = (
                db.query(ChatGroupMember)
                .filter(
                    ChatGroupMember.group_id == media.group_id,
                    ChatGroupMember.user_id == user_id,
                )
                .first()
            ) is not None
            if not is_member:
                raise HTTPException(status_code=403, detail="Keine Mitgliedschaft in dieser Gruppe.")
            return

        if media.direct_chat_id is not None:
            is_member = (
                db.query(DirectChatMember)
                .filter(
                    DirectChatMember.chat_id == media.direct_chat_id,
                    DirectChatMember.user_id == user_id,
                )
                .first()
            ) is not None
            if not is_member:
                raise HTTPException(status_code=403, detail="Keine Mitgliedschaft in diesem Chat.")
            other = (
                db.query(DirectChatMember.user_id)
                .filter(
                    DirectChatMember.chat_id == media.direct_chat_id,
                    DirectChatMember.user_id != user_id,
                )
                .first()
            )
            if other and _blockiert(db, user_id, int(other[0])):
                raise HTTPException(status_code=403, detail="Kommunikation blockiert.")
            return

        # Altbestand ohne direkte Zuordnung: nur der Uploader selbst.
        if media.uploader_user_id != user_id:
            raise HTTPException(status_code=403, detail="Keine Berechtigung fuer diesen Anhang.")

    @classmethod
    def upload_encrypted_media(
        cls,
        db: Session,
        uploader: User,
        chat_type: str,
        chat_id: int,
        ciphertext_blob: str,
        file_name: str,
        media_type: str = "application/octet-stream",
        expires_at: datetime | None = None,
    ) -> ChatMedia:
        SocialService.assert_social_enabled(db)
        if chat_type not in ("direct", "group") or chat_id <= 0:
            raise HTTPException(status_code=400, detail="Ungueltiges Gespraech.")
        clean_name = sanitize_attachment_filename(file_name)

        direct_chat_id = None
        target_group_id = None
        if chat_type == "group":
            member = (
                db.query(ChatGroupMember)
                .filter(
                    ChatGroupMember.group_id == chat_id,
                    ChatGroupMember.user_id == uploader.id,
                )
                .first()
            )
            if not member:
                raise HTTPException(status_code=403, detail="Keine Mitgliedschaft in dieser Chat-Gruppe.")
            if not SocialService.has_group_permission(db, chat_id, uploader.id, "attach_media"):
                raise HTTPException(status_code=403, detail="Kein Recht fuer Anhaenge in dieser Gruppe.")
            target_group_id = chat_id
        else:
            members = {
                int(r[0])
                for r in db.query(DirectChatMember.user_id)
                .filter(DirectChatMember.chat_id == chat_id)
                .all()
            }
            if uploader.id not in members:
                raise HTTPException(status_code=403, detail="Kein Mitglied dieses Chats.")
            for other in members - {uploader.id}:
                if _blockiert(db, uploader.id, other):
                    raise HTTPException(status_code=403, detail="Kommunikation blockiert.")
            direct_chat_id = chat_id

        validate_encrypted_blob_payload(ciphertext_blob, max_bytes=MAX_MEDIA_BYTES)
        blob_bytes = ciphertext_blob.encode("utf-8")

        # Die Kontingentpruefung und der Insert laufen unter der Kontosperre;
        # parallele Uploads koennen die 2-GiB-Grenze nicht ueberschreiten.
        db.query(User.id).filter(User.id == uploader.id).with_for_update().one()
        belegt = (
            db.query(func.coalesce(func.sum(ChatMedia.size_bytes), 0))
            .filter(ChatMedia.uploader_user_id == uploader.id)
            .scalar()
        )
        if belegt + len(blob_bytes) > MEDIEN_KONTINGENT_BYTES:
            raise HTTPException(status_code=413, detail="Speicher fuer Anhaenge voll (2 GB).")

        media = ChatMedia(
            id=str(uuid.uuid4()),
            blind_mailbox_id=_chat_key(chat_type, chat_id),
            direct_chat_id=direct_chat_id,
            group_id=target_group_id,
            uploader_user_id=uploader.id,
            ciphertext_blob=ciphertext_blob,
            media_type=media_type[:64],
            file_name=clean_name,
            size_bytes=len(blob_bytes),
            sha256=hashlib.sha256(blob_bytes).hexdigest(),
            created_at=_now(),
            expires_at=expires_at,
        )
        db.add(media)
        db.commit()
        db.refresh(media)
        return media

    @classmethod
    def generate_signed_url(
        cls, db: Session, user: User, media_id: str, ttl_seconds: int = 900
    ) -> tuple[str, datetime]:
        SocialService.assert_social_enabled(db)
        media = db.query(ChatMedia).filter(ChatMedia.id == media_id).first()
        if not media:
            raise HTTPException(status_code=404, detail="Medienanhang nicht gefunden.")
        cls.assert_chat_membership(db, user.id, media)
        expires_at = _now() + timedelta(seconds=max(60, min(ttl_seconds, 86400)))
        expires_ts = int(expires_at.timestamp())
        secret = _signing_secret()
        msg = f"msm:chat-media:{media.id}:{user.id}:{expires_ts}".encode("utf-8")
        signature = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
        return (
            f"/api/social/media/{media.id}/download?token={signature}&expires={expires_ts}&user_id={user.id}",
            expires_at,
        )

    @classmethod
    def delete_media(cls, db: Session, user: User, media_id: str) -> bool:
        SocialService.assert_social_enabled(db)
        media = db.query(ChatMedia).filter(ChatMedia.id == media_id).first()
        if not media:
            return False
        if media.uploader_user_id != user.id:
            raise HTTPException(status_code=403, detail="Nur der Absender kann einen Anhang loeschen.")
        db.delete(media)
        db.commit()
        return True

    @classmethod
    def cleanup_expired_media(cls, db: Session) -> int:
        getroffen = (
            db.query(ChatMedia)
            .filter(ChatMedia.expires_at.isnot(None), ChatMedia.expires_at < _now())
            .delete(synchronize_session=False)
        )
        db.commit()
        return int(getroffen)

    @classmethod
    def get_media_by_signed_url(
        cls, db: Session, media_id: str, token: str, expires: int, user_id: int
    ) -> ChatMedia:
        now_ts = int(_now().timestamp())
        if now_ts > expires:
            raise HTTPException(status_code=403, detail="Signierte Medien-URL ist abgelaufen.")
        secret = _signing_secret()
        expected_msg = f"msm:chat-media:{media_id}:{user_id}:{expires}".encode("utf-8")
        expected_token = hmac.new(secret.encode("utf-8"), expected_msg, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_token, token):
            raise HTTPException(status_code=403, detail="Ungueltige Signatur fuer signierte Medien-URL.")
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=403, detail="Benutzerkonto inaktiv oder nicht autorisiert.")
        media = db.query(ChatMedia).filter(ChatMedia.id == media_id).first()
        if not media:
            raise HTTPException(status_code=404, detail="Medienanhang nicht gefunden.")
        if media.expires_at and _now() > _utc(media.expires_at):
            raise HTTPException(status_code=410, detail="Medienanhang ist abgelaufen.")
        cls.assert_chat_membership(db, user.id, media)
        return media
