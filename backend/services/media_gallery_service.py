"""Zentrale Bild-Sanitisierung, Galerie-Retention und Cache-Auslieferung.

Geteilte Kernlogik fuer isolierte Mediendomänen (Server-Wallpapers und
Team-Profilbilder/-Banner). Jeder Konsument verwaltet seinen eigenen
Speicherpfad und seine eigene Datenbanktabelle, teilt sich aber dieselbe
sichere Upload-Pipeline und HTTP-Cache-Semantik.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from fastapi import Response
from PIL import Image
from sqlalchemy.orm import Session

MAX_MEDIA_BYTES = 10 * 1024 * 1024  # 10 MB
MIN_MEDIA_BYTES = 32
DEFAULT_MAX_WIDTH = 2560
AVATAR_MAX_WIDTH = 1024
WEBP_QUALITY = 85
GALLERY_RETENTION = 10


class MediaValidationError(ValueError):
    """Upload verletzt eine Bildregel — Router mappt auf HTTP 400."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def magic_ok(raw: bytes, *, allow_gif: bool = False) -> bool:
    """Prueft echte Datei-Header (JPEG, PNG, WebP sowie optional GIF)."""
    if raw.startswith(b"\xff\xd8\xff"):
        return True
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if allow_gif and (raw.startswith(b"GIF87a") or raw.startswith(b"GIF89a")):
        return True
    return len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"


def resolve_scoped_dir(base_dir: Path, *parts: str) -> Path:
    """Loest ein Unterverzeichnis strikt innerhalb von `base_dir` auf."""
    root = base_dir.resolve()
    target = root.joinpath(*parts).resolve()
    if target != root and not target.is_relative_to(root):
        raise MediaValidationError("Ungueltiger Speicherpfad.")
    return target


def read_scoped_file_bytes(scope_dir: Path, file_name: str) -> bytes | None:
    """Liest eine sicher innerhalb von `scope_dir` aufgeloeste Datei oder gibt None zurueck."""
    try:
        return resolve_scoped_dir(scope_dir, file_name).read_bytes()
    except (MediaValidationError, OSError):
        return None


def unlink_scoped_file(scope_dir: Path, file_name: str) -> None:
    """Entfernt eine sicher innerhalb von `scope_dir` aufgeloeste Datei ohne Absturz."""
    try:
        resolve_scoped_dir(scope_dir, file_name).unlink(missing_ok=True)
    except (MediaValidationError, OSError):
        pass


def sanitize_and_compress_image(
    raw_bytes: bytes,
    *,
    max_width: int = DEFAULT_MAX_WIDTH,
    quality: int = WEBP_QUALITY,
    max_bytes: int = MAX_MEDIA_BYTES,
    allow_gif: bool = False,
) -> bytes:
    """Prueft, desinfiziert und komprimiert Upload-Bytes sicher zu WebP.

    1. Groessenlimit (32 B bis `max_bytes`)
    2. Magic-Bytes (kein SVG/XSS, keine MIME-Faelschung)
    3. Pillow-Verifizierung & Dekodierung (entfernt EXIF, Polyglots, Payloads)
    4. Lanczos-Verkleinerung auf `max_width`
    5. WebP-Neukodierung
    """
    if len(raw_bytes) > max_bytes or len(raw_bytes) < MIN_MEDIA_BYTES:
        max_mb = max(1, max_bytes // (1024 * 1024))
        raise MediaValidationError(f"Ungueltige Dateigroesse (max. {max_mb} MB).")
    if not magic_ok(raw_bytes, allow_gif=allow_gif):
        allowed = "JPEG, PNG, WebP und GIF" if allow_gif else "JPEG, PNG und WebP"
        raise MediaValidationError(f"Ungueltiges Bildformat. Nur {allowed} erlaubt.")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            img.verify()
        with Image.open(io.BytesIO(raw_bytes)) as img:
            mode = "RGBA" if ("A" in img.getbands()) else "RGB"
            converted = img.convert(mode)
            if converted.width > max_width:
                new_height = max(1, int((max_width / converted.width) * converted.height))
                converted = converted.resize(
                    (max_width, new_height), Image.Resampling.LANCZOS
                )
            output = io.BytesIO()
            converted.save(output, format="WEBP", quality=quality, method=6)
            return output.getvalue()
    except MediaValidationError:
        raise
    except Exception:
        raise MediaValidationError("Bilddatei beschaedigt oder nicht lesbar.")


def apply_gallery_retention(
    db: Session,
    *,
    rows: list[Any],
    scope_dir: Path,
    retention: int = GALLERY_RETENTION,
) -> None:
    """Behaelt hoechstens `retention` Galerie-Eintraege und schont das aktive Bild."""
    if len(rows) <= retention:
        return
    keep_active = next((r for r in rows if getattr(r, "is_active", False)), None)
    victims = [r for r in reversed(rows) if r is not keep_active][
        : len(rows) - retention
    ]
    for row in victims:
        try:
            resolve_scoped_dir(scope_dir, row.file_name).unlink(missing_ok=True)
        except (MediaValidationError, OSError):
            pass
        db.delete(row)
    db.commit()


def build_webp_response(
    *,
    data: bytes,
    etag: str | None = None,
    if_none_match: str | None = None,
    versioned: bool = False,
    gallery_thumb: bool = False,
) -> Response:
    """Baut eine konsistente, sichere HTTP-Antwort fuer ausgelieferte WebP-Bilder."""
    if etag and if_none_match in (etag, f"W/{etag}"):
        return Response(status_code=304)

    if versioned:
        cache_control = "private, max-age=31536000, immutable"
    elif gallery_thumb:
        cache_control = "private, max-age=86400"
    else:
        cache_control = "private, no-cache"

    headers: dict[str, str] = {
        "Cache-Control": cache_control,
        "X-Content-Type-Options": "nosniff",
    }
    if etag:
        headers["ETag"] = etag

    return Response(content=data, media_type="image/webp", headers=headers)
