"""Speicherung und Entfernung von Benutzer-Avataren ueber die zentrale Medien-Pipeline."""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

from config import settings
from services.media_gallery_service import (
    AVATAR_MAX_WIDTH,
    WEBP_QUALITY,
    MediaValidationError,
    resolve_scoped_dir,
    sanitize_and_compress_image,
    unlink_scoped_file,
)

MAX_BILD_BYTES = 5 * 1024 * 1024  # 5 MB
ERLAUBTE_BILDTYPEN = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}

# Dateinamen, die wir selbst vergeben. Alles andere wird beim Ausliefern und
# beim Loeschen abgewiesen — ein Pfad aus einem gespeicherten Feld darf nie
# ungeprueft an `os.path.join` gehen.
DATEINAME_MUSTER = re.compile(r"^[a-zA-Z0-9_\-\.]+$")


def bilder_verzeichnis() -> str:
    basis = settings.panel_config_dir if settings.panel_config_dir else "."
    verzeichnis = os.path.join(basis, "data", "avatars")
    os.makedirs(verzeichnis, exist_ok=True)
    return verzeichnis


def sanitisiere_und_speichere_bild(inhalt: bytes, praefix: str, kennung: int) -> str:
    """Prueft, desinfiziert und speichert ein Profilbild als WebP (EXIF-frei)."""
    webp_bytes = sanitize_and_compress_image(
        inhalt,
        max_width=AVATAR_MAX_WIDTH,
        quality=WEBP_QUALITY,
        max_bytes=MAX_BILD_BYTES,
        allow_gif=True,
    )
    dateiname = f"{praefix}_{kennung}_{uuid.uuid4().hex[:12]}.webp"
    ziel = resolve_scoped_dir(Path(bilder_verzeichnis()), dateiname)
    ziel.write_bytes(webp_bytes)
    return dateiname


def loesche_bild(url: str | None) -> None:
    """Entfernt eine zuvor abgelegte Datei. Stille Nachsicht bei Fehlern."""
    if not url:
        return
    dateiname = url.split("/")[-1]
    if not dateiname or not DATEINAME_MUSTER.match(dateiname):
        return
    unlink_scoped_file(Path(bilder_verzeichnis()), dateiname)
