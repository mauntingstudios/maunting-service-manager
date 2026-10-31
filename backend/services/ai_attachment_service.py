"""Speicherung, Quota und Kontext fuer KI-Anhaenge.

Die inhaltliche Arbeit — Datei erkennen, Text extrahieren, Bild normalisieren
— liegt in `ai_attachment_processor`; die Blockform fuer OpenAI und Anthropic
in `ai_attachment_provider`. Hier bleibt, was nur mit Datenbank zu tun hat:
Quote, Verschluesselung, Bindung an eine Nachricht und die Auswahl der
Anhaenge, die in die naechste Anfrage gehoeren.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import AiAttachment, AiConversation, User
from services import audit_service
from services.ai_attachment_processor import (
    MAX_ATTACHMENT_BYTES,
    MAX_OFFICE_BYTES,
    MAX_PDF_BYTES,
    MAX_TEXT_BYTES,
    MAX_UPLOAD_BYTES,
    AttachmentRejected,
    PreparedContent,
    prepare_attachment,
    safe_name,
)
from services.ai_attachment_provider import PreparedAttachment, attachment_message
from services.ai_chat_service import get_owned_conversation
from services.dis_client import DisClient


#: Wie viele noch nicht gesendete Anhaenge ein Chat gleichzeitig halten darf.
MAX_ATTACHMENTS_PER_CONVERSATION = 10
MAX_ATTACHMENTS_PER_DAY = 200
MAX_ATTACHMENT_BYTES_PER_DAY = 200 * 1024 * 1024
#: Rueckfall, wenn das Kontextfenster unbekannt ist. Bei bekanntem Fenster
#: waechst das Budget in `ai_context_service` mit.
MAX_PROVIDER_TEXT_CHARS = 24_000
MAX_PROVIDER_TEXT_CHARS_OBEN = 160_000
#: Zehn Anhaenge passen zu `MAX_ATTACHMENTS_PER_CONVERSATION`. Bilder werden
#: vorher auf rund 2 MB normalisiert; Text zaehlt gegen das Textbudget.
MAX_PROVIDER_ATTACHMENTS = 10
UNBOUND_TTL_HOURS = 24

__all__ = [
    "AttachmentRejected",
    "MAX_ATTACHMENT_BYTES",
    "MAX_ATTACHMENTS_PER_CONVERSATION",
    "MAX_OFFICE_BYTES",
    "MAX_PDF_BYTES",
    "MAX_PROVIDER_ATTACHMENTS",
    "MAX_PROVIDER_TEXT_CHARS",
    "MAX_PROVIDER_TEXT_CHARS_OBEN",
    "MAX_TEXT_BYTES",
    "MAX_UPLOAD_BYTES",
    "bind_to_message",
    "count_unbound",
    "create_attachment",
    "delete_owned",
    "drop_for_messages",
    "has_unbound",
    "list_owned",
    "provider_attachment_messages",
    "unbind_for_message",
]


def _aad(attachment_id: str, kind: str) -> str:
    return f"msm:ai:attachment:{attachment_id}:{kind}"


def _pruefe_tagesquote(db: Session, user: User, groesse: int) -> None:
    seit = datetime.now(timezone.utc) - timedelta(days=1)
    anzahl, gesamt = (
        db.query(func.count(AiAttachment.id), func.coalesce(func.sum(AiAttachment.size_bytes), 0))
        .filter(AiAttachment.user_id == user.id, AiAttachment.created_at >= seit)
        .one()
    )
    if int(anzahl) >= MAX_ATTACHMENTS_PER_DAY or int(gesamt) + groesse > MAX_ATTACHMENT_BYTES_PER_DAY:
        raise AttachmentRejected("AI_ATTACHMENT_LIMIT_REACHED")


def _raeume_alte_ungebundene(db: Session, conversation: AiConversation, user: User) -> None:
    grenze = datetime.now(timezone.utc) - timedelta(hours=UNBOUND_TTL_HOURS)
    db.query(AiAttachment).filter(
        AiAttachment.conversation_id == conversation.id,
        AiAttachment.user_id == user.id,
        AiAttachment.message_id.is_(None),
        AiAttachment.created_at < grenze,
    ).delete(synchronize_session=False)


def _ungebunden_abfrage(db: Session, conversation_id: str, user_id: int):
    return db.query(AiAttachment).filter(
        AiAttachment.conversation_id == conversation_id,
        AiAttachment.user_id == user_id,
        AiAttachment.message_id.is_(None),
        AiAttachment.status.in_(["quarantined", "ready"]),
    )


def count_unbound(db: Session, conversation_id: str, user_id: int) -> int:
    return int(_ungebunden_abfrage(db, conversation_id, user_id).count())


def has_unbound(db: Session, conversation_id: str, user_id: int) -> bool:
    return count_unbound(db, conversation_id, user_id) > 0


def _speichere(row_inhalt: PreparedContent) -> tuple[str, str | None]:
    """Gibt den zu verschluesselnden Inhalt und den Text zurueck."""
    return (
        base64.b64encode(row_inhalt.content).decode("ascii"),
        row_inhalt.text,
    )


def create_attachment(
    db: Session, *, user: User, conversation: AiConversation, filename: str | None,
    declared_type: str | None, data: bytes,
) -> AiAttachment:
    if len(data) == 0 or len(data) > MAX_UPLOAD_BYTES:
        raise AttachmentRejected("AI_ATTACHMENT_SIZE_INVALID")

    name = safe_name(filename)
    _pruefe_tagesquote(db, user, len(data))
    _raeume_alte_ungebundene(db, conversation, user)
    if count_unbound(db, conversation.id, user.id) >= MAX_ATTACHMENTS_PER_CONVERSATION:
        raise AttachmentRejected("AI_ATTACHMENT_LIMIT_REACHED")

    vorbereitet = prepare_attachment(
        data, filename=name, declared_type=declared_type
    )
    inhalt_b64, text = _speichere(vorbereitet)
    attachment_id = str(uuid4())
    row = AiAttachment(
        id=attachment_id,
        conversation_id=conversation.id,
        user_id=user.id,
        original_name=name,
        media_type=vorbereitet.media_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        # Bilder liegen normalisiert hier; alles andere als redigierter Text
        # oder als benannter Hinweis. Der Rohinhalt wird nie abgelegt, wenn er
        # Geheimnisse tragen koennte.
        content_encrypted=DisClient.encrypt(
            inhalt_b64, aad=_aad(attachment_id, "content")
        ),
        extracted_text_encrypted=(
            DisClient.encrypt(text, aad=_aad(attachment_id, "text"))
            if text is not None else None
        ),
        redacted_spans=vorbereitet.redacted_spans or None,
        status="ready",
    )
    db.add(row)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="ai.attachment.accepted", target_type="ai_attachment",
        target_id=row.id,
        details={
            "media_type": vorbereitet.media_type,
            "kind": vorbereitet.kind,
            "size_bytes": len(data),
            **({"redacted_spans": vorbereitet.redacted_spans}
               if vorbereitet.redacted_spans else {}),
        },
        origin="direct",
    )
    db.commit()
    db.refresh(row)
    return row


def list_owned(db: Session, user: User, conversation_id: str) -> list[AiAttachment]:
    conversation = get_owned_conversation(db, conversation_id, user)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    return db.query(AiAttachment).filter(
        AiAttachment.conversation_id == conversation.id, AiAttachment.user_id == user.id
    ).order_by(AiAttachment.created_at).all()


def delete_owned(db: Session, user: User, attachment_id: str) -> None:
    try:
        canonical = str(UUID(attachment_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Anhang nicht gefunden") from exc
    row = db.query(AiAttachment).filter(
        AiAttachment.id == canonical, AiAttachment.user_id == user.id
    ).first()
    if row is None or get_owned_conversation(db, row.conversation_id, user) is None:
        raise HTTPException(status_code=404, detail="Anhang nicht gefunden")
    db.delete(row)
    db.commit()


def bind_to_message(db: Session, *, conversation_id: str, user_id: int, message_id: str) -> int:
    """Haengt alle noch nicht gesendeten Anhaenge an diese Nachricht."""
    rows = _ungebunden_abfrage(db, conversation_id, user_id).filter(
        AiAttachment.status == "ready"
    ).order_by(AiAttachment.created_at).all()
    for row in rows:
        row.message_id = message_id
    return len(rows)


def unbind_for_message(db: Session, message_id: str) -> int:
    """Gibt die Anhaenge einer bearbeiteten Nachricht wieder frei.

    Sie bleiben als Chips ueber dem Eingabefeld stehen und binden sich beim
    naechsten Senden an die neue Fassung. Loeschen waere der Verlust, den der
    Benutzer gerade nicht wollte.
    """
    return int(
        db.query(AiAttachment)
        .filter(AiAttachment.message_id == message_id)
        .update({AiAttachment.message_id: None}, synchronize_session=False)
    )


def drop_for_messages(db: Session, message_ids: list[str]) -> int:
    """Entfernt die Anhaenge weggeschnittener Nachrichten."""
    if not message_ids:
        return 0
    return int(
        db.query(AiAttachment)
        .filter(AiAttachment.message_id.in_(message_ids))
        .delete(synchronize_session=False)
    )


def _ist_bild_media(media_type: str) -> bool:
    # SVG ist Text und wird als Text extrahiert; es darf nie als Bildblock
    # an einen Anbieter gehen.
    typ = media_type.lower()
    return typ.startswith("image/") and typ != "image/svg+xml"


def provider_attachment_messages(
    db: Session, conversation_id: str, user_id: int,
    message_ids: list[str] | None = None,
    modell_sieht: bool | None = None,
    *,
    protokoll: str | None = None,
    text_budget: int = MAX_PROVIDER_TEXT_CHARS,
) -> list[dict]:
    """Die Anhaenge, die in diese Anfrage gehoeren — als **eine** Nachricht.

    ``message_ids`` sind die Nachrichten im Kontextfenster. Ist der Wert
    gesetzt, gehen genau deren Anhaenge mit — plus die noch ungebundenen, denn
    die gehoeren zur Nachricht, die gerade entsteht.

    Text-, PDF-, Office- und Binaeranhaenge gehen als redigierter Text mit.
    Bilder gehen als Bild mit; ein Modell, das laut Katalog keine Bilder liest,
    bekommt stattdessen einen benannten Hinweis. Nichts wird still weggelassen.

    ``protokoll`` waehlt die Blockform (`anthropic_messages` oder OpenAI).
    ``text_budget`` kommt aus dem Kontextfenster des gewaehlten Modells.
    """
    abfrage = db.query(AiAttachment).filter(
        AiAttachment.conversation_id == conversation_id,
        AiAttachment.user_id == user_id,
        AiAttachment.status == "ready",
    )
    if message_ids is not None:
        abfrage = abfrage.filter(
            (AiAttachment.message_id.is_(None))
            | (AiAttachment.message_id.in_(message_ids))
        )
    # Nur die neuesten laden. Eine jahrealte Unterhaltung soll nicht den
    # ganzen Anhangsbestand in den Speicher holen, nur um weitere zu benennen.
    rows = (
        abfrage.order_by(AiAttachment.created_at.desc())
        .limit(MAX_PROVIDER_ATTACHMENTS + 25)
        .all()
    )
    ausgewaehlt = rows[:MAX_PROVIDER_ATTACHMENTS]
    ausgelassen = rows[MAX_PROVIDER_ATTACHMENTS:]

    # In der Reihenfolge, in der der Benutzer sie ausgewaehlt hat. Text und
    # Bild bleiben gemischt; die Anbieter lesen beides in einer Nachricht.
    anhaenge: list[PreparedAttachment] = []
    blinde_bilder: list[str] = []
    text_ausgelassen: list[str] = []
    rest_text = max(0, text_budget)
    for row in reversed(ausgewaehlt):
        if row.extracted_text_encrypted is not None:
            if rest_text <= 0:
                text_ausgelassen.append(row.original_name)
                continue
            text = DisClient.decrypt(
                row.extracted_text_encrypted, aad=_aad(row.id, "text")
            )
            if len(text) > rest_text:
                original = len(text)
                text = (
                    text[:rest_text]
                    + f"\n[gekuerzt nach {rest_text} von {original} Zeichen]"
                )
            rest_text -= len(text)
            anhaenge.append(PreparedAttachment(
                kind="text",
                filename=row.original_name,
                text=text,
            ))
            continue
        if not _ist_bild_media(row.media_type):
            continue
        if modell_sieht is False:
            blinde_bilder.append(row.original_name)
            continue
        encoded = DisClient.decrypt(
            row.content_encrypted, aad=_aad(row.id, "content")
        )
        anhaenge.append(PreparedAttachment(
            kind="image",
            filename=row.original_name,
            image_base64=encoded,
            media_type=row.media_type,
        ))

    hinweise: list[str] = []
    if blinde_bilder:
        hinweise.append(
            "Das gewaehlte Modell kann keine Bilder lesen. "
            "Nicht ausgewertet: " + ", ".join(blinde_bilder) + "."
        )
    if text_ausgelassen:
        hinweise.append(
            "Wegen des Textbudgets nicht mitgeschickt: "
            + ", ".join(text_ausgelassen) + "."
        )
    if ausgelassen:
        hinweise.append(
            "Weitere Anhaenge wurden aus Platzgruenden nicht mitgeschickt: "
            + ", ".join(row.original_name for row in reversed(ausgelassen)) + "."
        )

    nachricht = attachment_message(
        anhaenge,
        protokoll=protokoll,
        hinweis="\n".join(hinweise) or None,
    )
    return [nachricht] if nachricht is not None else []
