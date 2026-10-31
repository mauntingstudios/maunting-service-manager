"""Textgewinnung aus Anhaengen fuer den KI-Chat.

Bilder gehen als Bild an das Modell. Alles andere muss Text werden: PDF,
Office, Konfigurationsdateien und Code. Was sich nicht als Text lesen laesst,
wird nicht roh an einen Anbieter geschickt, sondern als benannter Hinweis
abgelegt. So bleibt die Zusage „kein 422 fuer unbekannte Binaerdateien“
erhalten, ohne dem Modell vorzugaukeln, es koenne beliebige Bytes verstehen.
"""

from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import PurePath

MAX_PDF_PAGES = 200
MAX_PDF_CHARS = 300_000
MAX_OFFICE_CHARS = 300_000
MAX_TEXT_CHARS = 300_000

TEXT_EXTENSIONS = {
    ".txt", ".log", ".md", ".markdown", ".rst", ".csv", ".tsv", ".json", ".jsonl",
    ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties",
    ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".sql",
    ".java", ".c", ".h", ".cpp", ".hpp", ".go", ".rs", ".rb", ".php", ".bat",
    ".cmd", ".ps1", ".env", ".gitignore", ".editorconfig",
}

TEXT_MIME = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
}

OFFICE_MIME = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation",
}

PDF_MIME = "application/pdf"


class ExtraktionError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class ExtrahierterText:
    text: str
    truncated: bool = False


def mime_fuer_text(suffix: str) -> str:
    return TEXT_MIME.get(suffix, "text/plain")


def ist_text_endung(suffix: str) -> bool:
    return suffix in TEXT_EXTENSIONS


def ist_office_endung(suffix: str) -> bool:
    return suffix in OFFICE_MIME


def dekodiere_text(data: bytes) -> str:
    if b"\x00" in data:
        raise ExtraktionError("AI_ATTACHMENT_CONTENT_INVALID")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("cp1252")
        except UnicodeDecodeError as exc:
            raise ExtraktionError("AI_ATTACHMENT_CONTENT_INVALID") from exc
    return _begrenze(text, MAX_TEXT_CHARS)


def _begrenze(text: str, grenze: int) -> ExtrahierterText:
    if len(text) <= grenze:
        return ExtrahierterText(text=text)
    return ExtrahierterText(
        text=text[:grenze] + f"\n[gekuerzt nach {grenze} von {len(text)} Zeichen]",
        truncated=True,
    )


def pdf_text(data: bytes) -> ExtrahierterText:
    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover - Pillow/pypdf sind Pflicht
        raise ExtraktionError("AI_ATTACHMENT_DOCUMENT_INVALID") from exc

    try:
        leser = PdfReader(io.BytesIO(data), strict=False)
        if getattr(leser, "is_encrypted", False):
            raise ExtraktionError("AI_ATTACHMENT_DOCUMENT_INVALID")
        seiten = list(leser.pages)[:MAX_PDF_PAGES]
        stuecke: list[str] = []
        for seite in seiten:
            try:
                stueck = seite.extract_text() or ""
            except Exception:
                stueck = ""
            if stueck.strip():
                stuecke.append(stueck.strip())
            if sum(len(s) for s in stuecke) >= MAX_PDF_CHARS:
                break
        text = "\n\n".join(stuecke)
        return _begrenze(text, MAX_PDF_CHARS)
    except ExtraktionError:
        raise
    except Exception as exc:
        raise ExtraktionError("AI_ATTACHMENT_DOCUMENT_INVALID") from exc


def office_text(data: bytes, suffix: str) -> ExtrahierterText:
    """Text aus OOXML/ODF, ohne Makros und ohne entpackte Bomben."""
    from services.chat_media_validator import (
        ZipBombDetectedError,
        inspect_archive_for_zip_bomb,
    )

    try:
        inspect_archive_for_zip_bomb(data)
    except ZipBombDetectedError as exc:
        raise ExtraktionError("AI_ATTACHMENT_ARCHIVE_BLOCKED") from exc

    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archiv:
            namen = {info.filename for info in archiv.infolist()}
            if any(name.lower().endswith("vbaproject.bin") for name in namen):
                raise ExtraktionError("AI_ATTACHMENT_ARCHIVE_BLOCKED")

            if suffix in {".docx"}:
                teile = _xml_texte(archiv, ["word/document.xml"], {"t"})
            elif suffix in {".pptx"}:
                slides = sorted(
                    (name for name in namen if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
                    key=_natuerliche_sortierung,
                )
                teile = _xml_texte(archiv, slides, {"t"})
            elif suffix in {".xlsx"}:
                teile = _xml_texte(
                    archiv,
                    ["xl/sharedStrings.xml"] + sorted(
                        name for name in namen if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)
                    ),
                    {"t", "v"},
                )
            elif suffix in {".odt", ".ods", ".odp"}:
                teile = _xml_texte(archiv, ["content.xml"], set())
            else:
                raise ExtraktionError("AI_ATTACHMENT_DOCUMENT_INVALID")
    except ExtraktionError:
        raise
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise ExtraktionError("AI_ATTACHMENT_DOCUMENT_INVALID") from exc

    text = "\n".join(stueck for stueck in teile if stueck.strip())
    return _begrenze(text, MAX_OFFICE_CHARS)


def _natuerliche_sortierung(name: str) -> int:
    treffer = re.search(r"(\d+)", name)
    return int(treffer.group(1)) if treffer else 0


def _xml_texte(archiv: zipfile.ZipFile, namen: list[str], tags: set[str]) -> list[str]:
    stuecke: list[str] = []
    for name in namen:
        if name not in archiv.namelist():
            continue
        try:
            roh = archiv.read(name)
        except KeyError:
            continue
        if len(roh) > 5 * 1024 * 1024:
            raise ExtraktionError("AI_ATTACHMENT_ARCHIVE_BLOCKED")
        # Keine DTDs und keine Entitaetsdeklarationen. ElementTree loest keine
        # externen Entitaeten auf, aber interne Expansion ist ein bekannter
        # Ressourcenpfad; OOXML/ODF brauchen beides nicht.
        oberflaeche = roh[:4096].upper()
        if b"<!DOCTYPE" in oberflaeche or b"<!ENTITY" in oberflaeche:
            raise ExtraktionError("AI_ATTACHMENT_DOCUMENT_INVALID")
        try:
            wurzel = ET.fromstring(roh)
        except ET.ParseError as exc:
            raise ExtraktionError("AI_ATTACHMENT_DOCUMENT_INVALID") from exc
        for element in wurzel.iter():
            if not isinstance(element.tag, str):
                continue
            lokal = element.tag.rsplit("}", 1)[-1]
            if tags and lokal not in tags:
                continue
            if element.text and element.text.strip():
                stuecke.append(element.text.strip())
    return stuecke


def binaer_hinweis(name: str, media_type: str) -> ExtrahierterText:
    return ExtrahierterText(
        text=(
            f"Der Anhang {name} hat den Typ {media_type or 'unbekannt'}. "
            "Sein Inhalt ist weder Text noch ein lesbares Bild und wurde nicht "
            "an den Anbieter uebergeben."
        )
    )


def endung(name: str) -> str:
    return PurePath(name or "").suffix.lower()
