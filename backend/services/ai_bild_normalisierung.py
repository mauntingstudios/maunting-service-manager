"""Bildnormalisierung fuer KI-Anhaenge.

Der Anbieter soll ein Bild sehen, das keine Metadaten, keine unnoetig grosse
Aufloesung und kein exotisches Format mehr traegt. Gleichzeitig darf ein
präpariertes Bild nicht den Server ausbremsen. Deshalb laufen alle Formate
durch dieselbe Fassade: Pillow oeffnet, prueft Groesse und Pixelzahl, dreht
nach EXIF, entfernt die Metadaten durch Neu-Encoding und verkleinert.

HEIC/HEIF kommt ueber `pillow-heif` dazu. Fehlt die optionale Bibliothek,
bleiben JPEG/PNG/WebP/GIF nutzbar; die anderen Formate werden mit einem
benannten Fehler abgewiesen, nicht stillschweigend veraendert.
"""

from __future__ import annotations

import io
from typing import Final

MAX_IMAGE_DIMENSION: Final = 4096
MAX_IMAGE_PIXELS: Final = 16_000_000
TARGET_IMAGE_DIMENSION: Final = 3072
TARGET_IMAGE_BYTES: Final = 2 * 1024 * 1024

_IMAGE_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
    "HEIF": "image/heic",
    "AVIF": "image/avif",
    "BMP": "image/bmp",
    "TIFF": "image/tiff",
}

try:
    from PIL import Image, ImageOps, UnidentifiedImageError

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    _PIL_READY = True
except Exception:  # pragma: no cover - nur ohne Pillow
    Image = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]
    UnidentifiedImageError = Exception  # type: ignore[assignment]
    _PIL_READY = False

try:  # optionale Erweiterung, weich importiert
    import pillow_heif

    pillow_heif.register_heif_opener()
    _HEIF_READY = True
except Exception:  # pragma: no cover - nur ohne pillow-heif
    _HEIF_READY = False


class BildNormalisierungError(ValueError):
    """Ein Bild, das nicht sicher oder nicht lesbar ist."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _encode(img: "Image.Image", fmt: str) -> bytes:
    """Kodiert und verkleinert so lange, bis das Zielbudget passt."""
    aktuell = img
    for _ in range(6):
        puffer = io.BytesIO()
        if fmt == "JPEG":
            aktuell.save(puffer, format="JPEG", quality=86, optimize=True, progressive=True)
        else:
            aktuell.save(puffer, format="PNG", optimize=True)
        daten = puffer.getvalue()
        if len(daten) <= TARGET_IMAGE_BYTES:
            return daten
        breite, hoehe = aktuell.size
        if max(breite, hoehe) <= 512:
            break
        aktuell = aktuell.resize(
            (max(1, int(breite * 0.82)), max(1, int(hoehe * 0.82))),
            Image.Resampling.LANCZOS,
        )
    # Transparente Riesenbilder: PNG kann trotz Verkleinerung zu gross bleiben.
    # Ein JPEG ohne Alpha ist besser als eine Ablehnung; der sichtbare Inhalt
    # bleibt erhalten, nur die Transparenz geht verloren.
    if fmt == "PNG":
        flach = Image.new("RGB", aktuell.size, (255, 255, 255))
        flach.paste(aktuell.convert("RGBA"), mask=aktuell.convert("RGBA").getchannel("A"))
        return _encode(flach, "JPEG")
    raise BildNormalisierungError("AI_ATTACHMENT_IMAGE_TOO_LARGE")


def normalisiere_bild(data: bytes, *, suffix: str = "", declared_type: str = "") -> tuple[bytes, str]:
    """Gibt normalisierte Bildbytes und den kanonischen MIME-Typ zurueck."""
    if not _PIL_READY:
        if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            return data, _fallback_mime(suffix, declared_type)
        raise BildNormalisierungError("AI_ATTACHMENT_IMAGE_FORMAT_UNSUPPORTED")

    try:
        with Image.open(io.BytesIO(data)) as roh:
            roh.seek(0)
            breite, hoehe = roh.size
            if (
                breite <= 0
                or hoehe <= 0
                or breite > MAX_IMAGE_DIMENSION
                or hoehe > MAX_IMAGE_DIMENSION
                or breite * hoehe > MAX_IMAGE_PIXELS
            ):
                raise BildNormalisierungError("AI_ATTACHMENT_IMAGE_TOO_LARGE")

            bild = ImageOps.exif_transpose(roh)
            hat_alpha = bild.mode in ("RGBA", "LA") or (
                bild.mode == "P" and "transparency" in bild.info
            )
            if hat_alpha:
                bild = bild.convert("RGBA")
                ziel_format = "PNG"
            else:
                bild = bild.convert("RGB")
                ziel_format = "JPEG"

            bild.thumbnail((TARGET_IMAGE_DIMENSION, TARGET_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
            daten = _encode(bild, ziel_format)
            return daten, ("image/png" if ziel_format == "PNG" else "image/jpeg")
    except BildNormalisierungError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise BildNormalisierungError("AI_ATTACHMENT_CONTENT_INVALID") from exc
    except Exception as exc:  # DecompressionBombError und Formate ohne Decoder
        if exc.__class__.__name__ == "DecompressionBombError":
            raise BildNormalisierungError("AI_ATTACHMENT_IMAGE_TOO_LARGE") from exc
        if suffix in {".heic", ".heif"} and not _HEIF_READY:
            raise BildNormalisierungError("AI_ATTACHMENT_IMAGE_FORMAT_UNSUPPORTED") from exc
        raise BildNormalisierungError("AI_ATTACHMENT_CONTENT_INVALID") from exc


def _fallback_mime(suffix: str, declared_type: str) -> str:
    declared = (declared_type or "").split(";")[0].strip().lower()
    if declared.startswith("image/"):
        return declared
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(suffix, "application/octet-stream")
