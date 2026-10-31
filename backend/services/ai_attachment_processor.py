"""Dateien einlesen, pruefen und in Text oder Bild verwandeln.

Die eine Stelle, an der ein KI-Anhang **inhaltlich** klassifiziert wird. Der
Service darueber kuemmert sich um Quota, Verschluesselung und Bindung an eine
Nachricht; hier steht nur die Frage: Was ist diese Datei, und was davon darf
als Text oder Bild an das Modell?

Zwei Regeln bestimmen die Entscheidung:

1. **Text wird extrahiert, nicht blockiert.** Markdown, JSON, Code, Logs,
   `.env`, SVG und unbekannte UTF-8-Dateien sind Text. Der Server fuehrt sie
   nie aus, er liest sie. Eine Endung oder ein `<?php` am Dateianfang ist
   deshalb kein Sicherheitsrisiko, sondern Inhalt.
2. **Nur was wirklich nicht lesbar ist, wird abgewiesen.** Ausfuehrbare
   Binaerdateien und Archive ohne Text-Extraktor bleiben gesperrt; alles
   andere wird entweder zu Text oder zu einem benannten Hinweis.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import PurePath
import zipfile

from services import ai_attachment_extract
from services.ai_bild_normalisierung import BildNormalisierungError, normalisiere_bild
from services.ai_redaction import redact_and_count
from services.chat_media_validator import (
    BLOCKED_EXECUTABLE_SIGNATURES,
    ExecutableBlockedError,
    detect_mime_from_magic_bytes,
)


#: Harte Obergrenze fuer den HTTP-Request. Kein fachliches Limit fuer Text:
#: eine 8-MB-Logdatei wird angenommen und beim Modell auf das Kontextbudget
#: gekuerzt. Die Grenze schuetzt nur davor, dass ein einzelner Request den
#: Server oder den Arbeitsspeicher sprengt.
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
#: Alter Name fuer Aufrufer und Tests. Seit 10/2026 dieselbe Request-Grenze.
MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES
MAX_TEXT_BYTES = MAX_UPLOAD_BYTES
MAX_IMAGE_BYTES = MAX_UPLOAD_BYTES
MAX_PDF_BYTES = MAX_UPLOAD_BYTES
MAX_OFFICE_BYTES = MAX_UPLOAD_BYTES

IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif",
    ".avif", ".bmp", ".tif", ".tiff",
}

#: Namen ohne Endung, die Text sind. Der Picker liefert sie haeufig so, und
#: eine Datei namens ``Dockerfile`` ist kein Binaerblob.
TEXT_NAMES = {
    ".env", ".gitignore", ".editorconfig", "dockerfile", "makefile",
    "procfile", "license", "readme", "changelog",
}

#: Endungen, bei denen der Inhalt nie ausgefuehrt wird. Der Server liest sie
#: ausschliesslich; deshalb sind auch Batch- und Skriptdateien hier Text.
EXTRA_TEXT_EXTENSIONS = {
    ".bat", ".cmd", ".ps1", ".php", ".svg", ".kt", ".kts", ".swift", ".lua",
    ".pl", ".r", ".scala", ".cs", ".fs", ".vb", ".asm", ".m", ".mm",
    ".gradle", ".lock",
}

#: Diese Endungen sind nie Text, auch wenn der Inhalt zufaellig dekodierbar
#: waere. Die Signaturpruefung faengt den Rest der Binaerdateien.
EXECUTABLE_EXTENSIONS = {
    ".exe", ".dll", ".msi", ".com", ".scr", ".pif", ".jar", ".class",
    ".apk", ".deb", ".rpm", ".dmg", ".iso",
}

BLOCKED_ARCHIVE_MIMES = {
    "application/zip", "application/gzip", "application/x-7z-compressed",
    "application/vnd.rar", "application/x-bzip2", "application/x-xz",
    "application/x-tar",
}

#: Echte Binaerprogramme. Ein Shebang (`#!`) gehoert **nicht** hierher: ein
#: Shellskript ist Text, den der Server liest und nie startet.
BINARY_EXECUTABLE_SIGNATURES = tuple(
    signatur for signatur in BLOCKED_EXECUTABLE_SIGNATURES if signatur != b"#!"
)

TEXT_EXTENSIONS = ai_attachment_extract.TEXT_EXTENSIONS | EXTRA_TEXT_EXTENSIONS


class AttachmentRejected(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class PreparedContent:
    """Was aus der Datei geworden ist — vor jeder Speicherung.

    ``content`` ist das, was verschluesselt abgelegt wird: normalisierte
    Bildbytes, redigierter Text oder der benannte Hinweis. Der Rohinhalt
    verlaesst diese Funktion bewusst nicht.
    """

    kind: str
    media_type: str
    content: bytes
    text: str | None
    redacted_spans: int


def safe_name(value: str | None) -> str:
    """Ein Anzeigename, kein Pfad.

    Windows-WebViews schicken ``C:\\fakepath\\bild.jpg``, Android
    ``content://…``. Der letzte Pfadteil ist der Name; ``..`` bleibt ein
    Angriff und wird abgewiesen.
    """
    roh = (value or "").strip().replace("\\", "/")
    if not roh:
        raise AttachmentRejected("AI_ATTACHMENT_NAME_INVALID")
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


def _normalisiere_mime(declared: str | None) -> str:
    return (declared or "").split(";")[0].strip().lower()


def _endung(name: str) -> str:
    return ai_attachment_extract.endung(name)


def _ist_text_name(name: str, suffix: str) -> bool:
    return suffix in TEXT_EXTENSIONS or name.lower() in TEXT_NAMES


def _ist_bild(suffix: str, declared: str, detected: str) -> bool:
    if suffix == ".svg" or declared == "image/svg+xml" or detected == "image/svg+xml":
        return False
    return (
        suffix in IMAGE_EXTENSIONS
        or declared.startswith("image/")
        or detected.startswith("image/")
    )


def _sieht_aus_wie_text(data: bytes) -> bool:
    """Eine billige Vorpruefung fuer unbekannte Endungen.

    Geprueft wird nur der Anfang: ein Binaerblob mit einem Textkopf soll nicht
    schon deshalb als Text gelten. Die vollstaendige Dekodierung passiert im
    Textzweig; scheitert sie, wird die Datei zum benannten Hinweis.
    """
    kopf = data[:4096]
    if kopf.startswith((b"\xff\xfe", b"\xfe\xff")):
        return True
    if b"\x00" in kopf:
        return False
    for kodierung in ("utf-8", "cp1252"):
        try:
            kopf.decode(kodierung)
            return True
        except UnicodeDecodeError:
            continue
    return False


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


def _pruefe_groesse(data: bytes, grenze: int = MAX_UPLOAD_BYTES) -> None:
    if len(data) > grenze:
        raise AttachmentRejected("AI_ATTACHMENT_SIZE_INVALID")


def _text_aus(data: bytes) -> tuple[str, int]:
    try:
        roh = ai_attachment_extract.dekodiere_text(data).text
    except ai_attachment_extract.ExtraktionError as exc:
        raise AttachmentRejected(exc.code) from exc
    text, redigiert = redact_and_count(roh)
    return text, redigiert


def _text_media_type(suffix: str, detected: str) -> str:
    if suffix:
        return ai_attachment_extract.mime_fuer_text(suffix)
    return "application/json" if detected == "application/json" else "text/plain"


def prepare_attachment(
    data: bytes, *, filename: str, declared_type: str | None,
) -> PreparedContent:
    """Klassifiziert und normalisiert eine Datei.

    Wirft ``AttachmentRejected`` nur, wenn daraus weder lesbarer Text noch ein
    darstellbares Bild noch ein benannter Hinweis werden kann.
    """
    if len(data) == 0 or len(data) > MAX_UPLOAD_BYTES:
        raise AttachmentRejected("AI_ATTACHMENT_SIZE_INVALID")

    name = safe_name(filename)
    suffix = _endung(name)
    declared = _normalisiere_mime(declared_type)

    # Die Magic-Byte-Erkennung aus dem Messenger blockt Skripte und
    # ausfuehrbare Signaturen. Fuer den KI-Chat ist ein Skript Text; nur ein
    # echtes Binaerprogramm bleibt gesperrt. Deshalb wird die Ausnahme hier
    # aufgefangen und erst unten entschieden.
    executable_signature = False
    try:
        detected = detect_mime_from_magic_bytes(data)
    except ExecutableBlockedError:
        detected = "application/octet-stream"
        executable_signature = True
    except Exception:
        detected = "application/octet-stream"

    if suffix in EXECUTABLE_EXTENSIONS:
        raise AttachmentRejected("AI_ATTACHMENT_TYPE_BLOCKED")
    # Eine ELF-/PE-Signatur bleibt eine Binaerdatei, auch wenn die ersten
    # Bytes zufaellig als UTF-8 lesbar sind. Nur eine Textendung darf sie
    # retten — dann ist es Text, der zufaellig mit „MZ“ beginnt.
    if (
        not _ist_text_name(name, suffix)
        and any(data.startswith(sig) for sig in BINARY_EXECUTABLE_SIGNATURES)
    ):
        raise AttachmentRejected("AI_ATTACHMENT_TYPE_BLOCKED")
    if executable_signature and not (
        _ist_text_name(name, suffix) or _sieht_aus_wie_text(data)
    ):
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
        return PreparedContent(
            kind="office",
            media_type=ai_attachment_extract.OFFICE_MIME[office_suffix],
            content=text.encode(),
            text=text,
            redacted_spans=redigiert,
        )

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
        # Nur der redigierte Text wird gespeichert. Ein Roh-PDF wuerde die
        # Redaction umgehen und Geheimnisse doch zum Anbieter tragen.
        return PreparedContent(
            kind="pdf",
            media_type="application/pdf",
            content=text.encode(),
            text=text,
            redacted_spans=redigiert,
        )

    # SVG ist XML und damit Text. Es wird nie gerendert; die Endung ist kein
    # Grund, die Datei abzuweisen.
    if suffix == ".svg" or detected == "image/svg+xml":
        _pruefe_groesse(data, MAX_TEXT_BYTES)
        text, redigiert = _text_aus(data)
        return PreparedContent(
            kind="text",
            media_type="image/svg+xml",
            content=text.encode(),
            text=text,
            redacted_spans=redigiert,
        )

    if _ist_bild(suffix, declared, detected):
        _pruefe_groesse(data, MAX_IMAGE_BYTES)
        try:
            normalisiert, media_type = normalisiere_bild(
                data, suffix=suffix, declared_type=declared
            )
        except BildNormalisierungError as exc:
            raise AttachmentRejected(exc.code) from exc
        return PreparedContent(
            kind="image",
            media_type=media_type,
            content=normalisiert,
            text=None,
            redacted_spans=0,
        )

    # Vor dem Textzweig: ein als `.txt` getarntes Archiv ist ein Archiv, kein
    # Text. ZIP-basierte Office-Dateien wurden oben bereits extrahiert.
    if detected in BLOCKED_ARCHIVE_MIMES:
        raise AttachmentRejected("AI_ATTACHMENT_ARCHIVE_BLOCKED")

    if (
        _ist_text_name(name, suffix)
        or declared.startswith("text/")
        or detected in {"text/plain", "application/json"}
        or _sieht_aus_wie_text(data)
    ):
        _pruefe_groesse(data, MAX_TEXT_BYTES)
        text, redigiert = _text_aus(data)
        return PreparedContent(
            kind="text",
            media_type=_text_media_type(suffix, detected),
            content=text.encode(),
            text=text,
            redacted_spans=redigiert,
        )

    text, redigiert = redact_and_count(
        ai_attachment_extract.binaer_hinweis(name, declared or detected).text
    )
    return PreparedContent(
        kind="binary",
        media_type=declared or detected or "application/octet-stream",
        content=text.encode(),
        text=text,
        redacted_spans=redigiert,
    )
