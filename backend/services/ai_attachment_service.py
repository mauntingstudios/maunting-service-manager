"""Kleine Quarantaene fuer begrenzte Text-, Bild- und Dokumentanhaenge.

Die Datei ist die einzige Stelle, an der ein KI-Anhang angenommen wird. Sie
entscheidet anhand von Magic Bytes, Endung und deklariertem Typ, was daraus
wird: ein Bild, redigierter Text oder ein benannter Hinweis. Der Rohinhalt
verlaesst den Prozess nie im Klartext, und was nicht lesbar ist, wird auch
nicht als lesbar ausgegeben.
"""

from __future__ import annotations

import base64
import hashlib
import io
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import PurePath
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import AiAttachment, AiConversation, User
from services import ai_attachment_extract, audit_service
from services.ai_bild_normalisierung import BildNormalisierungError, normalisiere_bild
from services.ai_chat_service import get_owned_conversation
from services.ai_redaction import redact_and_count
from services.chat_media_validator import (
    ExecutableBlockedError,
    detect_mime_from_magic_bytes,
)
from services.dis_client import DisClient


#: Das Router-Limit ist die harte Obergrenze fuer den Request. Die fachlichen
#: Grenzen darunter sind je Typ enger; ein 20-MiB-Foto wird nicht deshalb
#: angenommen, weil der Request es traegt.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
#: Alter Name fuer Aufrufer und Tests. Bedeutet seit 10/2026 dieselbe
#: Request-Grenze, nicht mehr die alte 256-KiB-Grenze.
MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES
MAX_TEXT_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_OFFICE_BYTES = 10 * 1024 * 1024
MAX_BINARY_BYTES = 10 * 1024 * 1024
#: Nur ungebundene Anhaenge zaehlen. Frueher zaehlte jede Zeile der einen
#: Unterhaltung, und nach zehn Uploads war der KI-Chat dauerhaft blockiert.
MAX_ATTACHMENTS_PER_CONVERSATION = 10
MAX_ATTACHMENTS_PER_DAY = 200
MAX_ATTACHMENT_BYTES_PER_DAY = 200 * 1024 * 1024
MAX_PROVIDER_TEXT_CHARS = 24_000
MAX_PROVIDER_ATTACHMENTS = 5
UNBOUND_TTL_HOURS = 24

IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif",
    ".avif", ".bmp", ".tif", ".tiff",
}
TEXT_NAMES = {
    ".env", ".gitignore", ".editorconfig", "dockerfile", "makefile",
    "procfile", "license", "readme", "changelog",
}
BLOCKED_ARCHIVE_MIMES = {
    "application/zip", "application/gzip", "application/x-7z-compressed",
    "application/vnd.rar", "application/x-bzip2", "application/x-xz",
    "application/x-tar",
}

#: Fuer Aufrufer, die die alte Tabelle noch lesen. Die Entscheidung faellt
#: nicht mehr hier, sondern in `ai_attachment_extract`.
TEXT_TYPES = {
    suffix: ai_attachment_extract.mime_fuer_text(suffix)
    for suffix in sorted(ai_attachment_extract.TEXT_EXTENSIONS)
}
IMAGE_TYPES = {suffix: "image/*" for suffix in sorted(IMAGE_EXTENSIONS)}


class AttachmentRejected(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _aad(attachment_id: str, kind: str) -> str:
    return f"msm:ai:attachment:{attachment_id}:{kind}"


def _normalisiere_mime(declared: str | None) -> str:
    return (declared or "").split(";")[0].strip().lower()


def _safe_name(value: str | None) -> str:
    """Ein Anzeigename, kein Pfad.

    Android liefert gelegentlich ``content://…`` oder ``blob``. Der letzte
    Pfadteil ist der Name; ein echter Pfad mit ``..`` ist ein Angriff und wird
    abgewiesen.
    """
    roh = (value or "").strip().replace("\\", "/")
    if not roh:
        raise AttachmentRejected("AI_ATTACHMENT_NAME_INVALID")
    # Windows-WebViews und Android senden haeufig einen vollen Pfad
    # (`C:\fakepath\bild.jpg`, `content://…`). Der letzte Pfadteil ist der
    # Name; ein `..` bleibt ein Angriff und wird weiter abgewiesen.
    teile = [teil for teil in roh.split("/") if teil not in {"", "."}]
    if not teile or any(teil == ".." for teil in teile):
        raise AttachmentRejected("AI_ATTACHMENT_NAME_INVALID")
    roh = teile[-1]
    if (
        roh in {".", ".."}
        or len(roh) > 128
        or any(ord(char) < 32 for char in roh)
        or PurePath(roh).name != roh
    ):
        raise AttachmentRejected("AI_ATTACHMENT_NAME_INVALID")
    return roh


def _ist_text_name(name: str, suffix: str) -> bool:
    return suffix in ai_attachment_extract.TEXT_EXTENSIONS or name.lower() in TEXT_NAMES


def _ist_bild(suffix: str, declared: str, detected: str) -> bool:
    return (
        suffix in IMAGE_EXTENSIONS
        or declared.startswith("image/")
        or detected.startswith("image/")
    )


def _office_suffix_aus_zip(data: bytes) -> str:
    if not data.startswith((b"PK\x03\x04", b"PK\x05\x06")):
        return ""
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archiv:
            namen = {name.lower() for name in archiv.namelist()}
            if "word/document.xml" in namen:
                return ".docx"
            if any(name.startswith("xl/worksheets/") for name in namen):
                return ".xlsx"
            if any(name.startswith("ppt/slides/") for name in namen):
                return ".pptx"
            if "mimetype" in namen:
                mimetype = archiv.read("mimetype").decode("utf-8", "ignore").strip()
                return {
                    "application/vnd.oasis.opendocument.text": ".odt",
                    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
                    "application/vnd.oasis.opendocument.presentation": ".odp",
                }.get(mimetype, "")
    except (zipfile.BadZipFile, OSError, RuntimeError):
        return ""
    return ""


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


def _pruefe_groesse(data: bytes, grenze: int) -> None:
    if len(data) > grenze:
        raise AttachmentRejected("AI_ATTACHMENT_SIZE_INVALID")


def _klassifiziere(
    data: bytes, name: str, declared: str
) -> tuple[str, str, bytes, str | None, int]:
    """Gibt (Art, MIME, zu speichernder Inhalt, Text, redigierte Stellen) zurueck."""
    suffix = ai_attachment_extract.endung(name)

    # Skripte mit Shebang sind Text, kein ausfuehrbarer Blob. Der Server fuehrt
    # sie nie aus; er liest sie nur. Binaere Executables bleiben gesperrt.
    if data.startswith(b"#!") and _ist_text_name(name, suffix):
        detected = "text/plain"
    else:
        try:
            detected = detect_mime_from_magic_bytes(data)
        except ExecutableBlockedError as exc:
            raise AttachmentRejected("AI_ATTACHMENT_TYPE_BLOCKED") from exc
        except Exception:
            detected = "application/octet-stream"

    if detected == "image/svg+xml" or suffix == ".svg":
        raise AttachmentRejected("AI_ATTACHMENT_TYPE_BLOCKED")

    office_suffix = suffix if ai_attachment_extract.ist_office_endung(suffix) else _office_suffix_aus_zip(data)
    if office_suffix:
        _pruefe_groesse(data, MAX_OFFICE_BYTES)
        try:
            roh = ai_attachment_extract.office_text(data, office_suffix).text
        except ai_attachment_extract.ExtraktionError as exc:
            raise AttachmentRejected(exc.code) from exc
        text, redigiert = redact_and_count(roh)
        if not text.strip():
            text = "Der Office-Anhang enthaelt keinen auslesbaren Text."
        return "office", ai_attachment_extract.OFFICE_MIME[office_suffix], text.encode(), text, redigiert

    if detected == "application/pdf" or suffix == ".pdf" or declared == "application/pdf":
        if not data.startswith(b"%PDF"):
            raise AttachmentRejected("AI_ATTACHMENT_CONTENT_INVALID")
        _pruefe_groesse(data, MAX_PDF_BYTES)
        try:
            roh = ai_attachment_extract.pdf_text(data).text
        except ai_attachment_extract.ExtraktionError as exc:
            raise AttachmentRejected(exc.code) from exc
        text, redigiert = redact_and_count(roh)
        if not text.strip():
            text = (
                "Der PDF-Anhang enthaelt keinen maschinenlesbaren Text "
                "(moeglicherweise ein Scan)."
            )
        # Bewusst nur der redigierte Text, nicht das Roh-PDF: ein Roh-PDF
        # wuerde die Redaction umgehen und Geheimnisse doch zum Anbieter
        # tragen. Fuer native PDF-Bloecke gibt es spaeter einen eigenen Weg.
        return "pdf", "application/pdf", text.encode(), text, redigiert

    if _ist_bild(suffix, declared, detected):
        _pruefe_groesse(data, MAX_IMAGE_BYTES)
        try:
            normalisiert, media_type = normalisiere_bild(
                data, suffix=suffix, declared_type=declared
            )
        except BildNormalisierungError as exc:
            raise AttachmentRejected(exc.code) from exc
        return "image", media_type, normalisiert, None, 0

    # Vor dem Textzweig: ein als `.txt` getarntes ZIP ist ein Archiv, kein
    # Text. Der Textzweig haette es sonst wegen der Endung angenommen.
    if detected in BLOCKED_ARCHIVE_MIMES:
        raise AttachmentRejected("AI_ATTACHMENT_ARCHIVE_BLOCKED")

    if _ist_text_name(name, suffix) or declared.startswith("text/") or detected in {
        "text/plain", "application/json"
    }:
        _pruefe_groesse(data, MAX_TEXT_BYTES)
        try:
            roh = ai_attachment_extract.dekodiere_text(data).text
        except ai_attachment_extract.ExtraktionError as exc:
            raise AttachmentRejected(exc.code) from exc
        text, redigiert = redact_and_count(roh)
        media_type = (
            ai_attachment_extract.mime_fuer_text(suffix)
            if suffix
            else ("application/json" if detected == "application/json" else "text/plain")
        )
        return "text", media_type, text.encode(), text, redigiert

    _pruefe_groesse(data, MAX_BINARY_BYTES)
    hinweis = ai_attachment_extract.binaer_hinweis(name, declared or detected).text
    text, redigiert = redact_and_count(hinweis)
    return "binary", declared or detected or "application/octet-stream", text.encode(), text, redigiert


def create_attachment(
    db: Session, *, user: User, conversation: AiConversation, filename: str | None,
    declared_type: str | None, data: bytes,
) -> AiAttachment:
    if len(data) == 0 or len(data) > MAX_UPLOAD_BYTES:
        raise AttachmentRejected("AI_ATTACHMENT_SIZE_INVALID")

    safe_name = _safe_name(filename)
    declared = _normalisiere_mime(declared_type)

    _pruefe_tagesquote(db, user, len(data))
    _raeume_alte_ungebundene(db, conversation, user)
    offen = db.query(AiAttachment).filter(
        AiAttachment.conversation_id == conversation.id,
        AiAttachment.user_id == user.id,
        AiAttachment.message_id.is_(None),
        AiAttachment.status.in_(["quarantined", "ready"]),
    ).count()
    if offen >= MAX_ATTACHMENTS_PER_CONVERSATION:
        raise AttachmentRejected("AI_ATTACHMENT_LIMIT_REACHED")

    art, media_type, inhalt, text, redigiert = _klassifiziere(data, safe_name, declared)
    attachment_id = str(uuid4())
    row = AiAttachment(
        id=attachment_id,
        conversation_id=conversation.id,
        user_id=user.id,
        original_name=safe_name,
        media_type=media_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        # Bilder liegen normalisiert hier; alles andere als redigierter Text
        # oder als benannter Hinweis. Der Rohinhalt wird nie abgelegt, wenn er
        # Geheimnisse tragen koennte.
        content_encrypted=DisClient.encrypt(
            base64.b64encode(inhalt).decode("ascii"),
            aad=_aad(attachment_id, "content"),
        ),
        extracted_text_encrypted=(
            DisClient.encrypt(text, aad=_aad(attachment_id, "text"))
            if text is not None else None
        ),
        redacted_spans=redigiert or None,
        status="ready",
    )
    db.add(row)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="ai.attachment.accepted", target_type="ai_attachment",
        target_id=row.id,
        details={
            "media_type": media_type,
            "kind": art,
            "size_bytes": len(data),
            **({"redacted_spans": redigiert} if redigiert else {}),
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
    rows = db.query(AiAttachment).filter(
        AiAttachment.conversation_id == conversation_id,
        AiAttachment.user_id == user_id,
        AiAttachment.message_id.is_(None),
        AiAttachment.status == "ready",
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
    return media_type.lower().startswith("image/")


def provider_attachment_messages(
    db: Session, conversation_id: str, user_id: int,
    message_ids: list[str] | None = None,
    modell_sieht: bool | None = None,
) -> list[dict]:
    """Die Anhaenge, die in diese Anfrage gehoeren.

    ``message_ids`` sind die Nachrichten im Kontextfenster. Ist der Wert
    gesetzt, gehen genau deren Anhaenge mit — plus die noch ungebundenen, denn
    die gehoeren zur Nachricht, die gerade entsteht.

    Text-, PDF-, Office- und Binaeranhaenge gehen als redigierter Text mit.
    Bilder gehen als Bild mit; ein Modell, das laut Katalog keine Bilder liest,
    bekommt stattdessen einen benannten Hinweis. Nichts wird still weggelassen.
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
    # Nur die neuesten plus ein Namensfenster laden. Eine jahrealte
    # Unterhaltung soll nicht den ganzen Anhangsbestand in den Speicher holen,
    # nur um „weitere Anhaenge“ zu benennen.
    rows = (
        abfrage.order_by(AiAttachment.created_at.desc())
        .limit(MAX_PROVIDER_ATTACHMENTS + 25)
        .all()
    )
    ausgewaehlt = rows[:MAX_PROVIDER_ATTACHMENTS]
    ausgelassen = rows[MAX_PROVIDER_ATTACHMENTS:]

    messages: list[dict] = []
    remaining_text_chars = MAX_PROVIDER_TEXT_CHARS
    for row in reversed(ausgewaehlt):
        if row.extracted_text_encrypted is not None:
            if remaining_text_chars <= 0:
                continue
            text = DisClient.decrypt(row.extracted_text_encrypted, aad=_aad(row.id, "text"))
            if len(text) > remaining_text_chars:
                text = (
                    text[:remaining_text_chars]
                    + f"\n[gekuerzt nach {remaining_text_chars} von {len(text)} Zeichen]"
                )
            remaining_text_chars -= len(text)
            # Bewusst role="user": ein Anhang ist Benutzerdaten, keine
            # Systemanweisung. Mit role="system" haette hochgeladener Text
            # dieselbe Autoritaet wie der MSM-Systemprompt und waere damit ein
            # direkter Prompt-Injection-Pfad.
            messages.append({
                "role": "user",
                "content": f"Unvertrauenswuerdiger Anhang {row.original_name}:\n{text}",
            })
            continue

        if _ist_bild_media(row.media_type):
            if modell_sieht is False:
                messages.append({
                    "role": "user",
                    "content": (
                        f"Das gewaehlte Modell kann keine Bilder lesen. "
                        f"Der Bildanhang {row.original_name} wurde nicht ausgewertet."
                    ),
                })
                continue
            encoded = DisClient.decrypt(row.content_encrypted, aad=_aad(row.id, "content"))
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Unvertrauenswuerdiger Bildanhang: {row.original_name}"},
                    {"type": "image_url", "image_url": {
                        "url": f"data:{row.media_type};base64,{encoded}"
                    }},
                ],
            })

    if ausgelassen:
        namen = ", ".join(row.original_name for row in reversed(ausgelassen))
        messages.append({
            "role": "user",
            "content": f"Weitere Anhaenge wurden aus Platzgruenden nicht mitgeschickt: {namen}",
        })
    return messages
