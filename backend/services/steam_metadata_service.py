"""Gecachter Steam-Store-Metadaten-Dienst fuer Shop-Spielbeschreibungen und Genres.

Die oeffentliche Steam Store API (``store.steampowered.com/api/appdetails``) wird
niemals synchron im heissen Request-Pfad von ``GET /api/shop/catalog`` aufgerufen:
Katalog-Aufrufe lesen ausschliesslich aus ``game_store_metadata`` und stossen bei
fehlenden Eintraegen hoechstens einen deduplizierten Hintergrund-Sync an.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
import json
import logging
import os
import re
import threading
from typing import Any

import httpx
from sqlalchemy.orm import Session

from database import SessionLocal
from models.game_store_metadata import GameStoreMetadata

logger = logging.getLogger(__name__)

_APP_ID_RE = re.compile(r"^\d{1,10}$")
_STEAM_LANG_MAP: dict[str, str] = {
    "de": "german",
    "en": "english",
}

POSITIVE_TTL_SECONDS = 7 * 24 * 3600
NEGATIVE_TTL_SECONDS = 6 * 3600
STEAM_APPDETAILS_URL = "https://store.steampowered.com/api/appdetails"

_IN_FLIGHT_LOCK = threading.Lock()
_IN_FLIGHT_APP_IDS: set[str] = set()


class _PlainTextHtmlParser(HTMLParser):
    """Extrahiert reinen Fließtext und verwirft Script-/Style-Bloecke restlos."""

    _BLOCK_TAGS = frozenset({"p", "br", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4"})
    _SKIP_TAGS = frozenset({"script", "style", "noscript", "iframe", "svg"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        if tag_l in self._SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth == 0 and tag_l in self._BLOCK_TAGS:
            self._parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if self._skip_depth == 0 and tag_l in self._BLOCK_TAGS:
            self._parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data:
            self._parts.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(unescape(f"&{name};"))

    def handle_charref(self, name: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(unescape(f"&#{name};"))

    def text(self) -> str:
        return "".join(self._parts)


def strip_html_to_plain_text(raw: str | None, *, max_len: int = 2000) -> str | None:
    """Bereinigt Steam-Store-HTML sicher zu einem kompakten Klartext-Absatz."""
    if not raw or not isinstance(raw, str):
        return None
    parser = _PlainTextHtmlParser()
    try:
        parser.feed(raw)
        parser.close()
    except Exception:
        return None
    collapsed = re.sub(r"\s+", " ", unescape(parser.text())).strip()
    if not collapsed:
        return None
    if len(collapsed) > max_len:
        cut = collapsed[: max(1, max_len - 1)].rsplit(" ", 1)[0].rstrip(" ,;:-")
        collapsed = f"{cut}…" if cut else f"{collapsed[: max(1, max_len - 1)]}…"
    return collapsed


def _safe_json_str_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(x).strip() for x in parsed if isinstance(x, str) and str(x).strip()][:12]


def _row_is_fresh(row: GameStoreMetadata, now: datetime) -> bool:
    fetched = row.fetched_at
    if fetched is None:
        return False
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)
    ttl = POSITIVE_TTL_SECONDS if row.fetch_status == "ok" else NEGATIVE_TTL_SECONDS
    return (now - fetched) < timedelta(seconds=ttl)


def _serialize_row(row: GameStoreMetadata) -> dict[str, Any]:
    return {
        "steam_app_id": row.steam_app_id,
        "lang": row.lang,
        "short_description": row.short_description,
        "genres": _safe_json_str_list(row.genres_json),
        "developers": _safe_json_str_list(row.developers_json),
        "fetch_status": row.fetch_status,
    }


def get_cached_metadata(db: Session, steam_app_id: str | None) -> dict[str, dict[str, Any]]:
    """Liest gueltige gecachte Metadaten je Sprache (rein DB, kein Netz-I/O)."""
    if not steam_app_id or not _APP_ID_RE.fullmatch(steam_app_id):
        return {}
    rows = (
        db.query(GameStoreMetadata)
        .filter(
            GameStoreMetadata.steam_app_id == steam_app_id,
            GameStoreMetadata.fetch_status == "ok",
        )
        .all()
    )
    return {row.lang: _serialize_row(row) for row in rows if row.lang}


def _upsert_metadata_row(
    db: Session,
    *,
    steam_app_id: str,
    lang: str,
    short_description: str | None,
    genres: list[str],
    developers: list[str],
    fetch_status: str,
    now: datetime,
) -> GameStoreMetadata:
    row = (
        db.query(GameStoreMetadata)
        .filter(
            GameStoreMetadata.steam_app_id == steam_app_id,
            GameStoreMetadata.lang == lang,
        )
        .first()
    )
    if row is None:
        row = GameStoreMetadata(
            steam_app_id=steam_app_id,
            lang=lang,
            short_description=short_description,
            genres_json=json.dumps(genres, ensure_ascii=False),
            developers_json=json.dumps(developers, ensure_ascii=False),
            fetch_status=fetch_status,
            fetched_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        if fetch_status == "ok" or not row.short_description:
            row.short_description = short_description
        if fetch_status == "ok" or not _safe_json_str_list(row.genres_json):
            row.genres_json = json.dumps(genres, ensure_ascii=False)
        if fetch_status == "ok" or not _safe_json_str_list(row.developers_json):
            row.developers_json = json.dumps(developers, ensure_ascii=False)
        row.fetch_status = fetch_status
        row.fetched_at = now
        row.updated_at = now
    db.flush()
    return row


def refresh_steam_metadata(
    db: Session,
    steam_app_id: str,
    *,
    languages: tuple[str, ...] = ("de", "en"),
    force: bool = False,
    http_client: Any | None = None,
) -> dict[str, dict[str, Any]]:
    """Aktualisiert den Steam-Store-Cache fuer eine App-ID ohne bei Netz-Fehlern abzustuerzen."""
    if not steam_app_id or not _APP_ID_RE.fullmatch(steam_app_id):
        return {}

    now = datetime.now(timezone.utc)
    existing_rows = {
        row.lang: row
        for row in db.query(GameStoreMetadata)
        .filter(GameStoreMetadata.steam_app_id == steam_app_id)
        .all()
    }

    owns_client = http_client is None
    client = (
        http_client
        if http_client is not None
        else httpx.Client(follow_redirects=False, timeout=8.0)
    )
    results: dict[str, dict[str, Any]] = {}
    try:
        for lang in languages:
            steam_lang = _STEAM_LANG_MAP.get(lang)
            if steam_lang is None:
                continue
            existing = existing_rows.get(lang)
            if not force and existing is not None and _row_is_fresh(existing, now):
                if existing.fetch_status == "ok":
                    results[lang] = _serialize_row(existing)
                continue

            short_description: str | None = None
            genres: list[str] = []
            developers: list[str] = []
            status = "error"

            try:
                resp = client.get(
                    STEAM_APPDETAILS_URL,
                    params={"appids": steam_app_id, "l": steam_lang},
                    headers={"Accept": "application/json"},
                )
                if getattr(resp, "status_code", 0) == 200:
                    payload = resp.json()
                    entry = payload.get(steam_app_id) if isinstance(payload, dict) else None
                    if isinstance(entry, dict) and entry.get("success") is True:
                        data = entry.get("data") or {}
                        if isinstance(data, dict):
                            short_description = strip_html_to_plain_text(
                                data.get("short_description") or data.get("about_the_game"),
                                max_len=2000,
                            )
                            raw_genres = data.get("genres") or []
                            if isinstance(raw_genres, list):
                                genres = [
                                    str(g.get("description")).strip()
                                    for g in raw_genres
                                    if isinstance(g, dict) and g.get("description")
                                ][:8]
                            raw_devs = data.get("developers") or []
                            if isinstance(raw_devs, list):
                                developers = [
                                    str(d).strip() for d in raw_devs if isinstance(d, str) and d.strip()
                                ][:6]
                            status = "ok"
            except Exception as exc:
                logger.debug(
                    "Steam-Store-Abruf fuer App %s (%s) fehlgeschlagen: %s",
                    steam_app_id,
                    lang,
                    type(exc).__name__,
                )

            saved = _upsert_metadata_row(
                db,
                steam_app_id=steam_app_id,
                lang=lang,
                short_description=short_description,
                genres=genres,
                developers=developers,
                fetch_status=status,
                now=now,
            )
            if saved.fetch_status == "ok":
                results[lang] = _serialize_row(saved)
        db.commit()
    except Exception:
        db.rollback()
        logger.debug("Steam-Metadaten-Commit fehlgeschlagen (App %s)", steam_app_id)
    finally:
        if owns_client:
            try:
                client.close()
            except Exception:
                pass

    return results


def _background_worker(steam_app_id: str) -> None:
    db = SessionLocal()
    try:
        refresh_steam_metadata(db, steam_app_id, languages=("de", "en"), force=False)
    except Exception:
        pass
    finally:
        try:
            db.close()
        except Exception:
            pass
        with _IN_FLIGHT_LOCK:
            _IN_FLIGHT_APP_IDS.discard(steam_app_id)


def ensure_steam_metadata_background(steam_app_id: str | None) -> None:
    """Waermt fehlende Steam-Store-Metadaten asynchron und dedupliziert auf."""
    if not steam_app_id or not _APP_ID_RE.fullmatch(steam_app_id):
        return
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    with _IN_FLIGHT_LOCK:
        if steam_app_id in _IN_FLIGHT_APP_IDS:
            return
        _IN_FLIGHT_APP_IDS.add(steam_app_id)
    thread = threading.Thread(
        target=_background_worker,
        args=(steam_app_id,),
        name=f"steam-meta-{steam_app_id}",
        daemon=True,
    )
    thread.start()
