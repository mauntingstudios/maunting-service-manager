"""Server-Wallpapers: Resolver, Upload-Sanitisierung und Steam-Artwork-Cache.

KISS: ein Modul fuer alles. Der Resolver ist die einzige Autoritaet, welches
Bild ein Server zeigt — das Frontend rendert nur die gelieferte URL:

1. Custom (aktives Galeriebild pro ``game_type``) gewinnt immer.
2. Steam (``artworkAppId`` → ``workshopAppId`` → ``appId``, backend-gecacht).
3. Panorama (Frontend-Fallback, hier als ``source="panorama"`` ohne URL).

Custom-Bilder sind Laufzeitdaten pro Spiel, keine Blueprint-Aenderung.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from config import settings
from models.game_wallpaper import GameWallpaper
from services.media_gallery_service import (
    DEFAULT_MAX_WIDTH as MAX_WALLPAPER_WIDTH,
    GALLERY_RETENTION as GALLERY_RETENTION_PER_GAME,
    MAX_MEDIA_BYTES as MAX_WALLPAPER_BYTES,
    MIN_MEDIA_BYTES as MIN_WALLPAPER_BYTES,
    WEBP_QUALITY,
    MediaValidationError as WallpaperValidationError,
    apply_gallery_retention,
    read_scoped_file_bytes,
    sanitize_and_compress_image,
    unlink_scoped_file,
)

if TYPE_CHECKING:
    from models.server import Server

# Steam-Fetch: kurzes Timeout, kein Blockieren des Seitenaufbaus.
STEAM_FETCH_TIMEOUT_SECONDS = 5.0
# Negativ-Cache: Fehlschlaege nicht endlos erneut anfordern.
STEAM_NEGATIVE_CACHE_TTL_SECONDS = 6 * 3600
STEAM_STORE_SCREENSHOT_LIMIT = 6
STEAM_SCREENSHOT_MANIFEST_TTL_SECONDS = 7 * 24 * 3600

# De-facto Steam-CDN-Pattern (unbelegte Konvention, im Test verifiziert):
# https://cdn.<host>/steam/apps/{app_id}/library_hero.jpg
STEAM_CDN_HOSTS = (
    "cdn.cloudflare.steamstatic.com",
    "cdn.akamai.steamstatic.com",
)
STEAM_SCREENSHOT_CDN_HOSTS = frozenset({
    "shared.akamai.steamstatic.com",
    "cdn.akamai.steamstatic.com",
    "cdn.cloudflare.steamstatic.com",
    "shared.fastly.steamstatic.com",
    "steamcdn-a.akamaihd.net",
})

_GAME_TYPE_RE = re.compile(r"^[a-z0-9_]{1,64}$")
_APP_ID_RE = re.compile(r"^\d{1,12}$")
_CUSTOM_GALLERY_ID_RE = re.compile(r"^custom-(\d{1,12})$")
_STEAM_HERO_GALLERY_ID_RE = re.compile(r"^steam-(\d{1,12})-hero$")
_STEAM_SCREENSHOT_ID_RE = re.compile(r"^steam-(\d{1,12})-([0-5])$")


class GalleryItemDescriptor:
    """Ein Eintrag einer Spiel-Galerie fuer Shop-Ansicht und Bildauslieferung."""

    __slots__ = ("id", "source", "url", "is_primary", "wallpaper_id")

    def __init__(
        self,
        *,
        id: str,
        source: str,
        url: str,
        is_primary: bool,
        wallpaper_id: int | None = None,
    ) -> None:
        self.id = id
        self.source = source
        self.url = url
        self.is_primary = is_primary
        self.wallpaper_id = wallpaper_id


def _validate_gallery_game_type(game_type: str) -> str:
    if not _GAME_TYPE_RE.fullmatch(game_type):
        raise WallpaperValidationError("Ungueltiger Spieltyp.")
    return game_type


def _is_allowed_steam_cdn_url(raw_url: str) -> bool:
    """Prueft strikt gegen erlaubte Steam-CDN-Hosts (SSRF-Schutz)."""
    if not isinstance(raw_url, str) or not raw_url or len(raw_url) > 2048:
        return False
    from urllib.parse import urlparse

    parsed = urlparse(raw_url.strip())
    if parsed.scheme != "https":
        return False
    if parsed.username or parsed.password or parsed.port is not None:
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    if host not in STEAM_SCREENSHOT_CDN_HOSTS and not host.endswith(".steamstatic.com"):
        return False
    if ".." in parsed.path or not parsed.path.startswith("/"):
        return False
    return True


def _screenshots_cache_dir() -> Path:
    pfad = steam_cache_verzeichnis() / "screenshots"
    pfad.mkdir(parents=True, exist_ok=True)
    return pfad


def _screenshot_manifest_pfad(app_id: str) -> Path:
    if not _APP_ID_RE.fullmatch(app_id):
        raise WallpaperValidationError("Ungueltige Steam-App-ID.")
    return _screenshots_cache_dir() / f"{app_id}.json"


def _screenshot_webp_pfad(app_id: str, index: int) -> Path:
    if not _APP_ID_RE.fullmatch(app_id) or not (0 <= index < STEAM_STORE_SCREENSHOT_LIMIT):
        raise WallpaperValidationError("Ungueltiger Screenshot-Index.")
    return _screenshots_cache_dir() / f"{app_id}_{index}.webp"


def _write_screenshot_manifest(
    app_id: str, urls: list[str], *, negative: bool
) -> None:
    import json
    import time

    pfad = _screenshot_manifest_pfad(app_id)
    try:
        pfad.write_text(
            json.dumps(
                {
                    "fetched_at": time.time(),
                    "negative": negative,
                    "urls": urls[:STEAM_STORE_SCREENSHOT_LIMIT],
                }
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def fetch_steam_screenshots(app_id: str) -> list[str]:
    """Laedt bis zu 6 Steam-Store-Screenshot-URLs mit Manifest- und Negativ-Cache."""
    import json
    import time

    if not _APP_ID_RE.fullmatch(app_id):
        return []
    manifest_pfad = _screenshot_manifest_pfad(app_id)
    now = time.time()
    if manifest_pfad.is_file():
        try:
            cached = json.loads(manifest_pfad.read_text(encoding="utf-8"))
            fetched_at = float(cached.get("fetched_at", 0.0))
            negative = bool(cached.get("negative", False))
            ttl = (
                STEAM_NEGATIVE_CACHE_TTL_SECONDS
                if negative
                else STEAM_SCREENSHOT_MANIFEST_TTL_SECONDS
            )
            if now - fetched_at < ttl:
                urls = cached.get("urls", [])
                return [
                    u for u in urls if isinstance(u, str) and _is_allowed_steam_cdn_url(u)
                ][:STEAM_STORE_SCREENSHOT_LIMIT]
        except (OSError, ValueError, TypeError):
            pass

    url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&filters=screenshots"
    try:
        resp = httpx.get(url, timeout=STEAM_FETCH_TIMEOUT_SECONDS)
    except httpx.HTTPError:
        _write_screenshot_manifest(app_id, [], negative=True)
        return []

    if resp.status_code != 200:
        _write_screenshot_manifest(app_id, [], negative=True)
        return []

    try:
        payload = resp.json() if hasattr(resp, "json") else json.loads(resp.content)
        entry = payload.get(app_id) if isinstance(payload, dict) else None
        if not isinstance(entry, dict) or not entry.get("success"):
            _write_screenshot_manifest(app_id, [], negative=True)
            return []
        data = entry.get("data") or {}
        raw_shots = data.get("screenshots") or []
    except (ValueError, TypeError, AttributeError):
        _write_screenshot_manifest(app_id, [], negative=True)
        return []

    validated: list[str] = []
    if isinstance(raw_shots, list):
        for shot in raw_shots:
            if not isinstance(shot, dict):
                continue
            full_url = shot.get("path_full")
            if isinstance(full_url, str) and _is_allowed_steam_cdn_url(full_url):
                validated.append(full_url.strip())
                if len(validated) >= STEAM_STORE_SCREENSHOT_LIMIT:
                    break

    _write_screenshot_manifest(app_id, validated, negative=len(validated) == 0)
    return validated


def resolve_game_gallery(
    db: Session, game_type: str
) -> list[GalleryItemDescriptor]:
    """Loest alle Galerie-Bilder eines Spiels auf (Custom-Uploads + Steam-Screenshots)."""
    _validate_gallery_game_type(game_type)
    items: list[GalleryItemDescriptor] = []
    custom_rows = get_gallery(db, game_type)
    ordered_custom = [w for w in custom_rows if w.is_active] + [
        w for w in custom_rows if not w.is_active
    ]
    has_active_custom = False
    for row in ordered_custom:
        is_primary = bool(row.is_active)
        if is_primary:
            has_active_custom = True
        items.append(
            GalleryItemDescriptor(
                id=f"custom-{row.id}",
                source="custom",
                url=f"/api/shop/artwork/{game_type}/gallery/custom-{row.id}",
                is_primary=is_primary,
                wallpaper_id=row.id,
            )
        )

    app_id = artwork_app_id_for_blueprint(_blueprint_for_game_type(game_type))
    if app_id and _APP_ID_RE.fullmatch(app_id):
        hero_pfad = ensure_steam_cached(app_id)
        if hero_pfad is not None and hero_pfad.is_file():
            items.append(
                GalleryItemDescriptor(
                    id=f"steam-{app_id}-hero",
                    source="steam",
                    url=f"/api/shop/artwork/{game_type}/gallery/steam-{app_id}-hero",
                    is_primary=(not has_active_custom and len(items) == 0),
                    wallpaper_id=None,
                )
            )
        for idx, _shot_url in enumerate(fetch_steam_screenshots(app_id)):
            items.append(
                GalleryItemDescriptor(
                    id=f"steam-{app_id}-{idx}",
                    source="steam",
                    url=f"/api/shop/artwork/{game_type}/gallery/steam-{app_id}-{idx}",
                    is_primary=(not has_active_custom and len(items) == 0),
                    wallpaper_id=None,
                )
            )

    return items


def gallery_item_bytes(
    db: Session, game_type: str, item_id: str
) -> bytes | None:
    """Liefert gecachte WebP-Bytes fuer eine einzelne Galerie-ID eines Spiels."""
    _validate_gallery_game_type(game_type)
    custom_match = _CUSTOM_GALLERY_ID_RE.fullmatch(item_id)
    if custom_match:
        return gallery_image_bytes(db, game_type, int(custom_match.group(1)))

    app_id = artwork_app_id_for_blueprint(_blueprint_for_game_type(game_type))
    hero_match = _STEAM_HERO_GALLERY_ID_RE.fullmatch(item_id)
    if hero_match:
        if not app_id or hero_match.group(1) != app_id:
            return None
        pfad = ensure_steam_cached(app_id)
        return pfad.read_bytes() if pfad is not None and pfad.is_file() else None

    shot_match = _STEAM_SCREENSHOT_ID_RE.fullmatch(item_id)
    if shot_match:
        requested_app_id, idx_str = shot_match.group(1), shot_match.group(2)
        if not app_id or requested_app_id != app_id:
            return None
        idx = int(idx_str)
        webp_pfad = _screenshot_webp_pfad(app_id, idx)
        if webp_pfad.is_file():
            try:
                return webp_pfad.read_bytes()
            except OSError:
                return None
        urls = fetch_steam_screenshots(app_id)
        if idx >= len(urls):
            return None
        target_url = urls[idx]
        if not _is_allowed_steam_cdn_url(target_url):
            return None
        try:
            resp = httpx.get(target_url, timeout=STEAM_FETCH_TIMEOUT_SECONDS)
        except httpx.HTTPError:
            return None
        if resp.status_code != 200 or not resp.content:
            return None
        try:
            webp = sanitize_and_compress_wallpaper(resp.content)
        except MediaValidationError:
            return None
        try:
            webp_pfad.write_bytes(webp)
        except OSError:
            pass
        return webp

    raise WallpaperValidationError("Ungueltige Galerie-ID.")


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


# ── Pfade ────────────────────────────────────────────────────────────────


def wallpaper_verzeichnis() -> Path:
    return Path(settings.wallpaper_dir)


def steam_cache_verzeichnis() -> Path:
    return Path(settings.steam_wallpaper_cache_dir)


def _game_verzeichnis(game_type: str) -> Path:
    if not _GAME_TYPE_RE.fullmatch(game_type):
        raise WallpaperValidationError("Ungueltiger Spiel-Typ.")
    return wallpaper_verzeichnis() / game_type


# ── Sanitisierung (delegiert an zentrale Medien-Engine) ──────────────────


def sanitize_and_compress_wallpaper(raw_bytes: bytes) -> bytes:
    """Prueft, desinfiziert und komprimiert Upload-Bytes zu WebP."""
    return sanitize_and_compress_image(
        raw_bytes, max_width=MAX_WALLPAPER_WIDTH, quality=WEBP_QUALITY
    )


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
    apply_gallery_retention(
        db,
        rows=get_gallery(db, game_type),
        scope_dir=_game_verzeichnis(game_type),
        retention=GALLERY_RETENTION_PER_GAME,
    )


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
    return read_scoped_file_bytes(_game_verzeichnis(game_type), row.file_name)


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
    unlink_scoped_file(_game_verzeichnis(game_type), row.file_name)
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


def _negativ_cache_pfad(app_id: str, suffix: str = "") -> Path:
    return steam_cache_verzeichnis() / f"{app_id}{suffix}.neg"


def steam_cache_pfad(app_id: str) -> Path:
    return steam_cache_verzeichnis() / f"{app_id}.webp"


def steam_poster_cache_pfad(app_id: str) -> Path:
    return steam_cache_verzeichnis() / f"{app_id}_poster.webp"


def _negativ_gecacht(app_id: str, suffix: str = "") -> bool:
    pfad = _negativ_cache_pfad(app_id, suffix)
    try:
        stamp = float(pfad.read_text().strip())
    except (OSError, ValueError):
        return False
    return (time.time() - stamp) < STEAM_NEGATIVE_CACHE_TTL_SECONDS


def _negativ_merken(app_id: str, suffix: str = "") -> None:
    try:
        cache_dir = steam_cache_verzeichnis()
        cache_dir.mkdir(parents=True, exist_ok=True)
        _negativ_cache_pfad(app_id, suffix).write_text(str(time.time()))
    except OSError:
        pass


def _fetch_steam_candidates(app_id: str, paths: tuple[str, ...]) -> bytes | None:
    if not re.fullmatch(r"\d{1,10}", app_id or ""):
        return None
    for rel_path in paths:
        for host in STEAM_CDN_HOSTS:
            url = f"https://{host}/steam/apps/{app_id}/{rel_path}"
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


def fetch_steam_artwork(app_id: str) -> bytes | None:
    """Laedt library_hero.jpg vom Steam-CDN (sanitisiert) oder None."""
    return _fetch_steam_candidates(app_id, ("library_hero.jpg",))


def fetch_steam_poster_artwork(app_id: str) -> bytes | None:
    """Laedt vertikales Steam-DVD-Cover (library_600x900) oder None."""
    return _fetch_steam_candidates(app_id, ("library_600x900_2x.jpg", "library_600x900.jpg"))


def _ensure_steam_variant(
    app_id: str,
    *,
    pfad: Path,
    suffix: str,
    fetcher: Any,
) -> Path | None:
    if pfad.is_file():
        return pfad
    if _negativ_gecacht(app_id, suffix):
        return None
    webp = fetcher(app_id)
    if webp is None:
        _negativ_merken(app_id, suffix)
        return None
    try:
        pfad.parent.mkdir(parents=True, exist_ok=True)
        pfad.write_bytes(webp)
        _negativ_cache_pfad(app_id, suffix).unlink(missing_ok=True)
        return pfad
    except OSError:
        return None


def ensure_steam_cached(app_id: str) -> Path | None:
    """Stellt das gecachte Steam-Bild bereit (Pfad) oder None bei Fehler."""
    return _ensure_steam_variant(
        app_id,
        pfad=steam_cache_pfad(app_id),
        suffix="",
        fetcher=fetch_steam_artwork,
    )


def ensure_steam_poster_cached(app_id: str) -> Path | None:
    """Stellt das gecachte DVD-Poster (600x900) bereit, sonst Hero-Fallback."""
    poster = _ensure_steam_variant(
        app_id,
        pfad=steam_poster_cache_pfad(app_id),
        suffix="_poster",
        fetcher=fetch_steam_poster_artwork,
    )
    return poster if poster is not None else ensure_steam_cached(app_id)


# ── Resolver ─────────────────────────────────────────────────────────────


def _blueprint_for_game_type(game_type: str) -> Any | None:
    """Lazy-Lookup, damit wallpaper_service nicht an games/blueprints koppelt."""
    try:
        from games import get_plugin

        plugin = get_plugin(game_type)
    except Exception:
        return None
    return plugin.get_blueprint() if plugin is not None else None


def resolve_plan_artwork(
    db: Session, game_type: str, mode: str, *, base_url: str
) -> WallpaperDescriptor:
    """Artwork fuer einen Shop-Plan nach dessen Modus.

    ``steam`` ignoriert ein vorhandenes Custom-Bild bewusst; ``custom`` nutzt
    das aktive Galeriebild und faellt sonst auf Steam zurueck; ``none`` liefert
    absichtlich kein Bild. Die Bytes kommen aus derselben Galerie bzw. demselben
    Steam-Cache wie die Server-Titelbilder.
    """
    if mode == "none":
        return WallpaperDescriptor(source="none", url=None)

    if mode == "custom":
        active = get_active_wallpaper(db, game_type)
        if active is not None:
            version = f"custom-{active.id}"
            return WallpaperDescriptor(
                source="custom",
                url=f"{base_url}?v={version}",
                version=version,
            )

    app_id = artwork_app_id_for_blueprint(_blueprint_for_game_type(game_type))
    if app_id is not None:
        version = f"steam-{app_id}"
        return WallpaperDescriptor(
            source="steam",
            url=f"{base_url}?v={version}",
            app_id=app_id,
            version=version,
        )
    return WallpaperDescriptor(source="none", url=None)


def plan_artwork_bytes(
    db: Session, game_type: str, version: str | None, *, variant: str | None = None
) -> tuple[bytes, str] | None:
    """Loest eine Shop-Artwork-Version (``custom-{id}``/``steam-{app}``) auf."""
    use_poster = variant == "poster"
    loader = ensure_steam_poster_cached if use_poster else ensure_steam_cached
    etag_suffix = "-poster" if use_poster else ""

    if version:
        match = _VERSION_RE.fullmatch(version)
        if match is None:
            raise WallpaperValidationError("Ungueltige Bildversion.")
        art, kennung = match.group(1), match.group(2)
        if art == "custom":
            bild_id = int(kennung)
            bild = gallery_image_bytes(db, game_type, bild_id)
            if bild is None:
                return None
            return bild, f'"custom-{bild_id}"'
        blueprint = _blueprint_for_game_type(game_type)
        if artwork_app_id_for_blueprint(blueprint) != kennung:
            return None
        pfad = loader(kennung)
        if pfad is None:
            return None
        try:
            return pfad.read_bytes(), f'"steam-{kennung}{etag_suffix}"'
        except OSError:
            return None

    active = get_active_wallpaper(db, game_type)
    if active is not None:
        try:
            data = (_game_verzeichnis(game_type) / active.file_name).read_bytes()
        except OSError:
            data = b""
        if data:
            return data, f'"custom-{active.id}"'
    app_id = artwork_app_id_for_blueprint(_blueprint_for_game_type(game_type))
    if app_id is None:
        return None
    pfad = loader(app_id)
    if pfad is None:
        return None
    try:
        return pfad.read_bytes(), f'"steam-{app_id}{etag_suffix}"'
    except OSError:
        return None


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
