"""Server-Wallpapers: Resolver, Upload-Sanitisierung und Steam-Artwork-Cache.

KISS: ein Modul fuer alles. Der Resolver ist die einzige Autoritaet, welches
Bild ein Server zeigt — das Frontend rendert nur die gelieferte URL:

1. Custom (aktives Galeriebild pro ``game_type``) gewinnt immer.
2. Steam (``artworkAppId`` → ``workshopAppId`` → ``appId``, backend-gecacht).
3. Panorama (Frontend-Fallback, hier als ``source="panorama"`` ohne URL).

Custom-Bilder sind Laufzeitdaten pro Spiel, keine Blueprint-Aenderung.
"""

from __future__ import annotations

import io
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
from fastapi import HTTPException
from PIL import Image
from sqlalchemy.orm import Session

from config import settings
from models.game_wallpaper import GameWallpaper

if TYPE_CHECKING:
    from models.server import Server

MAX_WALLPAPER_BYTES = 10 * 1024 * 1024  # 10 MB
MIN_WALLPAPER_BYTES = 32
MAX_WALLPAPER_WIDTH = 2560
WEBP_QUALITY = 85
# Galerie-Retention pro Spiel: darueber hinaus fliegen die aeltesten
# inaktiven Bilder (Datei + Zeile) automatisch raus.
GALLERY_RETENTION_PER_GAME = 10
# Steam-Fetch: kurzes Timeout, kein Blockieren des Seitenaufbaus.
STEAM_FETCH_TIMEOUT_SECONDS = 5.0
# Negativ-Cache: Fehlschlaege nicht endlos erneut anfordern.
STEAM_NEGATIVE_CACHE_TTL_SECONDS = 6 * 3600

# De-facto Steam-CDN-Pattern (unbelegte Konvention, im Test verifiziert):
# https://cdn.<host>/steam/apps/{app_id}/library_hero.jpg
STEAM_CDN_HOSTS = (
    "cdn.cloudflare.steamstatic.com",
    "cdn.akamai.steamstatic.com",
)

_GAME_TYPE_RE = re.compile(r"^[a-z0-9_]{1,64}$")


@dataclass(frozen=True)
class WallpaperDescriptor:
    """Resolver-Ergebnis: Quelle plus Ausliefer-URL (None = Panorama)."""

    source: str  # "custom" | "steam" | "panorama"
    url: str | None
    app_id: str | None = None
    # Inhalts-Version fuer die Bild-URL (`custom-{id}` / `steam-{app_id}`).
    # Neuer Inhalt = neue Version = neue URL — der Browser darf versionierte
    # URLs deshalb als immutable cachen und malt sie ohne jede Anfrage.
    version: str | None = None


class WallpaperValidationError(ValueError):
    """Upload verletzt eine Bildregel — Router mappt auf HTTP 400."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# ── Pfade ────────────────────────────────────────────────────────────────


def wallpaper_verzeichnis() -> Path:
    return Path(settings.wallpaper_dir)


def steam_cache_verzeichnis() -> Path:
    return Path(settings.steam_wallpaper_cache_dir)


def _game_verzeichnis(game_type: str) -> Path:
    if not _GAME_TYPE_RE.fullmatch(game_type):
        raise WallpaperValidationError("Ungueltiger Spiel-Typ.")
    return wallpaper_verzeichnis() / game_type


# ── Sanitisierung (reine Funktion: Bytes rein, WebP-Bytes raus) ──────────


def _magic_ok(raw: bytes) -> bool:
    if raw.startswith(b"\xff\xd8\xff"):  # JPEG
        return True
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):  # PNG
        return True
    # WebP: RIFF....WEBP (SVG hat keine Magic Bytes hier → verboten/XSS-safe)
    return (
        len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"
    )


def sanitize_and_compress_wallpaper(raw_bytes: bytes) -> bytes:
    """Prueft, desinfiziert und komprimiert Upload-Bytes zu WebP.

    1. Groessenlimit, 2. Magic-Bytes (kein SVG/XSS, keine MIME-Faelschung),
    3. Pillow-Dekodierung (killt EXIF, Polyglots, Schadcode), 4. Lanczos auf
    max. 2560 px Breite, 5. WebP-Neukodierung (~180–300 KB).
    """
    if len(raw_bytes) > MAX_WALLPAPER_BYTES or len(raw_bytes) < MIN_WALLPAPER_BYTES:
        raise WallpaperValidationError("Ungueltige Dateigroesse (max. 10 MB).")
    if not _magic_ok(raw_bytes):
        raise WallpaperValidationError(
            "Ungueltiges Bildformat. Nur JPEG, PNG und WebP erlaubt."
        )
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            img.verify()
        with Image.open(io.BytesIO(raw_bytes)) as img:
            rgb_img = img.convert("RGB")
            if rgb_img.width > MAX_WALLPAPER_WIDTH:
                new_height = max(
                    1, int((MAX_WALLPAPER_WIDTH / rgb_img.width) * rgb_img.height)
                )
                rgb_img = rgb_img.resize(
                    (MAX_WALLPAPER_WIDTH, new_height), Image.Resampling.LANCZOS
                )
            output = io.BytesIO()
            rgb_img.save(output, format="WEBP", quality=WEBP_QUALITY, method=6)
            return output.getvalue()
    except WallpaperValidationError:
        raise
    except Exception:
        raise WallpaperValidationError("Bilddatei beschaedigt oder nicht lesbar.")


# ── Galerie (pro Spiel) ──────────────────────────────────────────────────


def get_active_wallpaper(db: Session, game_type: str) -> GameWallpaper | None:
    return (
        db.query(GameWallpaper)
        .filter(
            GameWallpaper.game_type == game_type,
            GameWallpaper.is_active.is_(True),
        )
        .order_by(GameWallpaper.id.desc())
        .first()
    )


def get_gallery(db: Session, game_type: str) -> list[GameWallpaper]:
    return (
        db.query(GameWallpaper)
        .filter(GameWallpaper.game_type == game_type)
        .order_by(GameWallpaper.created_at.desc(), GameWallpaper.id.desc())
        .all()
    )


def _apply_retention(db: Session, game_type: str) -> None:
    rows = get_gallery(db, game_type)
    if len(rows) <= GALLERY_RETENTION_PER_GAME:
        return
    keep_active = next((r for r in rows if r.is_active), None)
    # rows ist neueste-zuerst — Opfer vom Ende (aelteste) nehmen.
    victims = [r for r in reversed(rows) if r is not keep_active][
        : len(rows) - GALLERY_RETENTION_PER_GAME
    ]
    game_dir = _game_verzeichnis(game_type)
    for row in victims:
        try:
            (game_dir / row.file_name).unlink(missing_ok=True)
        except OSError:
            pass
        db.delete(row)
    db.commit()


def store_wallpaper(
    db: Session, game_type: str, webp_bytes: bytes, uploaded_by: str
) -> GameWallpaper:
    """Speichert ein (bereits sanitisiertes) Bild als aktives Galeriebild."""
    game_dir = _game_verzeichnis(game_type)
    game_dir.mkdir(parents=True, exist_ok=True)
    row = GameWallpaper(
        game_type=game_type,
        file_name="",  # wird nach dem Flush mit der ID gesetzt
        uploaded_by=(uploaded_by or "system")[:128],
        is_active=False,
    )
    db.add(row)
    db.flush()
    row.file_name = f"wallpaper_{row.id}.webp"
    (game_dir / row.file_name).write_bytes(webp_bytes)
    set_active_wallpaper(db, game_type, row.id)
    _apply_retention(db, game_type)
    db.refresh(row)
    return row


def set_active_wallpaper(
    db: Session, game_type: str, wallpaper_id: int
) -> GameWallpaper:
    row = (
        db.query(GameWallpaper)
        .filter(
            GameWallpaper.game_type == game_type,
            GameWallpaper.id == wallpaper_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    (
        db.query(GameWallpaper)
        .filter(
            GameWallpaper.game_type == game_type,
            GameWallpaper.is_active.is_(True),
        )
        .update({"is_active": False})
    )
    row.is_active = True
    db.commit()
    db.refresh(row)
    return row


def gallery_image_bytes(
    db: Session, game_type: str, wallpaper_id: int
) -> bytes | None:
    """Bild-Bytes eines Galerieeintrags oder None."""
    row = (
        db.query(GameWallpaper)
        .filter(
            GameWallpaper.game_type == game_type,
            GameWallpaper.id == wallpaper_id,
        )
        .first()
    )
    if row is None:
        return None
    try:
        return (_game_verzeichnis(game_type) / row.file_name).read_bytes()
    except OSError:
        return None


def delete_wallpaper(db: Session, game_type: str, wallpaper_id: int) -> None:
    """Loescht ein Galeriebild endgueltig (Zeile + Datei).

    War es das aktive, faellt der Resolver automatisch auf Steam bzw. das
    Panorama zurueck — es gibt keinen Aktiv-Zeiger umzuhaengen.
    """
    row = (
        db.query(GameWallpaper)
        .filter(
            GameWallpaper.game_type == game_type,
            GameWallpaper.id == wallpaper_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    try:
        (_game_verzeichnis(game_type) / row.file_name).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(row)
    db.commit()


def reset_wallpaper(db: Session, game_type: str) -> None:
    """Hebt nur den Aktiv-Zeiger auf — Dateien bleiben in der Galerie."""
    (
        db.query(GameWallpaper)
        .filter(
            GameWallpaper.game_type == game_type,
            GameWallpaper.is_active.is_(True),
        )
        .update({"is_active": False})
    )
    db.commit()


# ── Steam-Artwork ────────────────────────────────────────────────────────


def artwork_app_id_for_blueprint(blueprint: Any) -> str | None:
    """Fallback-Kette: artworkAppId → workshopAppId → appId (nur Steam)."""
    if blueprint is None:
        return None
    source = getattr(blueprint, "source", None)
    if source is None or getattr(source.type, "value", source.type) != "steam":
        return None
    steam = getattr(source, "steam", None)
    if steam is None:
        return None
    if getattr(steam, "artworkAppId", None):
        return steam.artworkAppId
    mods = getattr(blueprint, "mods", None)
    if mods is not None and getattr(mods, "workshopAppId", None):
        return mods.workshopAppId
    return getattr(steam, "appId", None)


def _negativ_cache_pfad(app_id: str) -> Path:
    return steam_cache_verzeichnis() / f"{app_id}.neg"


def steam_cache_pfad(app_id: str) -> Path:
    return steam_cache_verzeichnis() / f"{app_id}.webp"


def _negativ_gecacht(app_id: str) -> bool:
    pfad = _negativ_cache_pfad(app_id)
    try:
        stamp = float(pfad.read_text().strip())
    except (OSError, ValueError):
        return False
    return (time.time() - stamp) < STEAM_NEGATIVE_CACHE_TTL_SECONDS


def _negativ_merken(app_id: str) -> None:
    try:
        cache_dir = steam_cache_verzeichnis()
        cache_dir.mkdir(parents=True, exist_ok=True)
        _negativ_cache_pfad(app_id).write_text(str(time.time()))
    except OSError:
        pass


def fetch_steam_artwork(app_id: str) -> bytes | None:
    """Laedt library_hero.jpg vom Steam-CDN (sanitisiert) oder None."""
    if not re.fullmatch(r"\d{1,10}", app_id or ""):
        return None
    for host in STEAM_CDN_HOSTS:
        url = f"https://{host}/steam/apps/{app_id}/library_hero.jpg"
        try:
            resp = httpx.get(url, timeout=STEAM_FETCH_TIMEOUT_SECONDS)
        except httpx.HTTPError:
            continue
        if resp.status_code != 200:
            continue
        content_type = (resp.headers.get("content-type") or "").lower()
        if "image" not in content_type:
            continue
        try:
            return sanitize_and_compress_wallpaper(resp.content)
        except WallpaperValidationError:
            continue
    return None


def ensure_steam_cached(app_id: str) -> Path | None:
    """Stellt das gecachte Steam-Bild bereit (Pfad) oder None bei Fehler."""
    pfad = steam_cache_pfad(app_id)
    if pfad.is_file():
        return pfad
    if _negativ_gecacht(app_id):
        return None
    webp = fetch_steam_artwork(app_id)
    if webp is None:
        _negativ_merken(app_id)
        return None
    try:
        pfad.parent.mkdir(parents=True, exist_ok=True)
        pfad.write_bytes(webp)
        _negativ_cache_pfad(app_id).unlink(missing_ok=True)
        return pfad
    except OSError:
        return None


# ── Resolver ─────────────────────────────────────────────────────────────


def resolve_wallpaper(db: Session, server: "Server") -> WallpaperDescriptor:
    """Ermittelt das aktive Wallpaper eines Servers (einzige Autoritaet)."""
    base_url = f"/api/servers/{server.id}/wallpaper"
    active = get_active_wallpaper(db, server.game_type)
    if active is not None:
        return WallpaperDescriptor(
            source="custom", url=base_url, version=f"custom-{active.id}"
        )
    try:
        from services.exec_service import load_blueprint_for_server

        blueprint = load_blueprint_for_server(server)
    except Exception:
        blueprint = None
    app_id = artwork_app_id_for_blueprint(blueprint)
    if app_id is not None:
        return WallpaperDescriptor(
            source="steam", url=base_url, app_id=app_id, version=f"steam-{app_id}"
        )
    return WallpaperDescriptor(source="panorama", url=None)


def wallpaper_bytes_for_server(
    db: Session, server: "Server"
) -> tuple[bytes, str] | None:
    """Liefert (Bild-Bytes, ETag) fuers Ausliefern oder None (= Panorama).

    Der ETag identifiziert den Inhalt (Custom-Bild-ID bzw. Steam-App-ID).
    Web und MSS schicken ihn bei jedem Aufruf mit und bekommen 304 ohne
    Bytes, solange sich nichts geaendert hat — so bleibt kein Client auf
    einem alten Bild sitzen.
    """
    active = get_active_wallpaper(db, server.game_type)
    if active is not None:
        try:
            data = (_game_verzeichnis(server.game_type) / active.file_name).read_bytes()
        except OSError:
            data = b""
        if data:
            return data, f'"custom-{active.id}"'
    try:
        from services.exec_service import load_blueprint_for_server

        blueprint = load_blueprint_for_server(server)
    except Exception:
        blueprint = None
    app_id = artwork_app_id_for_blueprint(blueprint)
    if app_id is None:
        return None
    pfad = ensure_steam_cached(app_id)
    if pfad is None:
        return None
    try:
        return pfad.read_bytes(), f'"steam-{app_id}"'
    except OSError:
        return None


_VERSION_RE = re.compile(r"^(custom|steam)-(\d{1,10})$")


def wallpaper_bytes_by_version(
    db: Session, server: "Server", version: str
) -> tuple[bytes, str] | None:
    """Loest eine versionierte Bild-URL inhaltsadressiert auf.

    `custom-{id}` liefert immer genau dieses Galeriebild (404 wenn geloescht),
    `steam-{app}` immer genau dieses Artwork — unabhaengig davon, was gerade
    aktiv ist. Darum darf der Router versionierte Antworten als immutable
    cachen: Die URL kann nie andere Bytes bekommen. Ungueltiges Format ist
    ein 400 (`WallpaperValidationError`), fehlender Inhalt ein 404 (None).
    """
    match = _VERSION_RE.fullmatch(version or "")
    if match is None:
        raise WallpaperValidationError("Ungueltige Bildversion.")
    art, kennung = match.group(1), match.group(2)
    if art == "custom":
        bild_id = int(kennung)
        bild = gallery_image_bytes(db, server.game_type, bild_id)
        if bild is None:
            return None
        return bild, f'"custom-{bild_id}"'
    try:
        from services.exec_service import load_blueprint_for_server

        blueprint = load_blueprint_for_server(server)
    except Exception:
        blueprint = None
    # Game-Scope: fremde App-IDs werden nicht ausgeliefert.
    if artwork_app_id_for_blueprint(blueprint) != kennung:
        return None
    pfad = ensure_steam_cached(kennung)
    if pfad is None:
        return None
    try:
        return pfad.read_bytes(), f'"steam-{kennung}"'
    except OSError:
        return None
