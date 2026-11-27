"""Whitelabel- und Branding-Verwaltung (Name, Tagline, KI-Identitaet, Logos).

Akzentfarben werden bewusst nicht ueberschrieben, weil das gesamte UI-System
und seine Kontrastregeln auf das Design-System abgestimmt sind.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from config import settings
from services.media_gallery_service import (
    MediaValidationError,
    read_scoped_file_bytes,
    resolve_scoped_dir,
    sanitize_and_compress_image,
    unlink_scoped_file,
)
from services.panel_settings_service import PanelSettingsService

DEFAULT_PANEL_BRAND_NAME = "Maunting Service Manager"
DEFAULT_AI_NAME = "Singra"
DEFAULT_AI_EMAIL = "singra@mauntingstudios.de"

BRAND_LOGO_SLOTS: tuple[str, ...] = ("default", "birthday", "halloween", "christmas")
BRAND_LOGO_MODES: tuple[str, ...] = ("default", "custom")
BRAND_SEASON_LOGO_MODES: tuple[str, ...] = ("default", "custom", "disabled")
BRAND_LOGO_MAX_WIDTH = 512
BRAND_LOGO_MAX_BYTES = 4 * 1024 * 1024


class BrandingValidationError(ValueError):
    """Ungueltige Branding-Eingabe oder Logo-Upload."""


def branding_dir() -> Path:
    return Path(settings.branding_dir)


def _validate_slot(slot: str) -> str:
    cleaned = (slot or "").strip().lower()
    if cleaned not in BRAND_LOGO_SLOTS:
        raise BrandingValidationError("Unbekannter Logo-Slot.")
    return cleaned


def _slot_filename(slot: str) -> str:
    return f"logo_{_validate_slot(slot)}.webp"


def _version_key(slot: str) -> str:
    return f"brand_logo_version_{_validate_slot(slot)}"


def _normalize_logo_mode(raw: str | None) -> str:
    cleaned = (raw or "").strip().lower()
    return cleaned if cleaned in BRAND_LOGO_MODES else "default"


def _normalize_season_logo_mode(raw: str | None) -> str:
    cleaned = (raw or "").strip().lower()
    return cleaned if cleaned in BRAND_SEASON_LOGO_MODES else "default"


def _logo_url(slot: str, version: str | None) -> str | None:
    if not version:
        return None
    return f"/api/settings/public/branding/logo/{slot}?v={version}"


def _slot_file_exists(slot: str) -> bool:
    try:
        target = resolve_scoped_dir(branding_dir(), _slot_filename(slot))
        return target.is_file()
    except (MediaValidationError, OSError):
        return False


def get_effective_ai_name(db: Session | None = None) -> str:
    return DEFAULT_AI_NAME


def get_effective_ai_email(db: Session | None = None) -> str:
    raw = PanelSettingsService.get("brand_ai_email", "", db=db).strip()
    return raw or DEFAULT_AI_EMAIL


def get_effective_brand_name(db: Session | None = None) -> str:
    raw = PanelSettingsService.get("brand_name", "", db=db).strip()
    return raw or DEFAULT_PANEL_BRAND_NAME


def get_effective_short_brand_name(db: Session | None = None) -> str:
    brand = get_effective_brand_name(db=db)
    return "MSM" if brand == DEFAULT_PANEL_BRAND_NAME else brand


_BRAND_PROMPT_MAX_LEN = 60
_FULL_NAME_RE = re.compile(r"Maunting Service Managers?(?:\s*\(MSM\))?")
_SHORT_NAME_RE = re.compile(r"\bMSM\b")


def apply_brand_name(text: str, db: Session | None = None) -> str:
    """Ersetzt „Maunting Service Manager (MSM)“, „Maunting Service Manager“ und „MSM“ im Text.

    Ohne eigenen Marken-/Produktnamen bleibt der Text unverändert. Der Name
    wird für den Prompt auf eine Zeile und 60 Zeichen begrenzt, damit er keine
    Anweisungen einschleusen kann.
    """
    try:
        raw = get_effective_brand_name(db=db)
    except Exception:
        return text
    if raw == DEFAULT_PANEL_BRAND_NAME:
        return text
    brand = " ".join(raw.split())[:_BRAND_PROMPT_MAX_LEN].strip()
    if not brand:
        return text
    text = _FULL_NAME_RE.sub(lambda _m: brand, text)
    return _SHORT_NAME_RE.sub(lambda _m: brand, text)


def get_branding_settings(all_db: dict[str, str] | None = None) -> dict[str, Any]:
    data = all_db if all_db is not None else PanelSettingsService.get_all()
    brand_name = data.get("brand_name", "")
    brand_tagline = data.get("brand_tagline", "")
    brand_ai_name = DEFAULT_AI_NAME
    brand_ai_email = data.get("brand_ai_email", "")
    brand_logo_mode = _normalize_logo_mode(data.get("brand_logo_mode"))
    brand_season_logo_mode = _normalize_season_logo_mode(data.get("brand_season_logo_mode"))

    logos: dict[str, dict[str, Any]] = {}
    for slot in BRAND_LOGO_SLOTS:
        exists = _slot_file_exists(slot)
        version = data.get(_version_key(slot), "").strip() or None if exists else None
        if exists and version is None:
            raw = read_scoped_file_bytes(branding_dir(), _slot_filename(slot))
            if raw is not None:
                version = hashlib.sha256(raw).hexdigest()[:12]
        logos[slot] = {
            "configured": bool(exists and version),
            "version": version,
            "url": _logo_url(slot, version),
        }

    return {
        "brand_name": brand_name,
        "brand_tagline": brand_tagline,
        "brand_ai_name": brand_ai_name,
        "brand_ai_email": brand_ai_email,
        "brand_logo_mode": brand_logo_mode,
        "brand_season_logo_mode": brand_season_logo_mode,
        "brand_logos": logos,
    }


def get_public_branding(all_db: dict[str, str] | None = None) -> dict[str, Any]:
    state = get_branding_settings(all_db)
    logos = state["brand_logos"]
    custom_name = state["brand_name"].strip()
    logo_mode = state["brand_logo_mode"]
    season_logo_mode = state["brand_season_logo_mode"]

    default_url = (
        logos["default"]["url"]
        if logo_mode == "custom" and logos["default"]["configured"]
        else None
    )
    season_urls: dict[str, str | None] = {}
    for season in ("birthday", "halloween", "christmas"):
        if season_logo_mode == "custom" and logos[season]["configured"]:
            season_urls[season] = logos[season]["url"]
        else:
            season_urls[season] = None

    return {
        "name": custom_name or DEFAULT_PANEL_BRAND_NAME,
        "custom_name": custom_name,
        "tagline": state["brand_tagline"].strip(),
        "ai_name": DEFAULT_AI_NAME,
        "logo_mode": logo_mode,
        "season_logo_mode": season_logo_mode,
        "logo_url": default_url,
        "season_logos": season_urls,
    }


def upload_branding_logo(db: Session, slot: str, raw_bytes: bytes) -> dict[str, Any]:
    validated_slot = _validate_slot(slot)
    try:
        webp_bytes = sanitize_and_compress_image(
            raw_bytes,
            max_width=BRAND_LOGO_MAX_WIDTH,
            max_bytes=BRAND_LOGO_MAX_BYTES,
        )
    except MediaValidationError as exc:
        raise BrandingValidationError(exc.message) from exc

    target_dir = branding_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = resolve_scoped_dir(target_dir, _slot_filename(validated_slot))
    target_file.write_bytes(webp_bytes)

    version = hashlib.sha256(webp_bytes).hexdigest()[:12]
    PanelSettingsService.set(_version_key(validated_slot), version, db=db)

    if validated_slot == "default":
        PanelSettingsService.set("brand_logo_mode", "custom", db=db)
    else:
        cur_season_mode = _normalize_season_logo_mode(
            PanelSettingsService.get("brand_season_logo_mode", "default", db=db)
        )
        if cur_season_mode == "default":
            PanelSettingsService.set("brand_season_logo_mode", "custom", db=db)

    db.commit()
    return {
        "slot": validated_slot,
        "configured": True,
        "version": version,
        "url": _logo_url(validated_slot, version),
    }


def delete_branding_logo(db: Session, slot: str) -> None:
    validated_slot = _validate_slot(slot)
    unlink_scoped_file(branding_dir(), _slot_filename(validated_slot))
    PanelSettingsService.delete(_version_key(validated_slot), db=db)

    if validated_slot == "default":
        PanelSettingsService.set("brand_logo_mode", "default", db=db)
    else:
        cur_season_mode = _normalize_season_logo_mode(
            PanelSettingsService.get("brand_season_logo_mode", "default", db=db)
        )
        if cur_season_mode == "custom" and not any(
            _slot_file_exists(s) for s in ("birthday", "halloween", "christmas")
        ):
            PanelSettingsService.set("brand_season_logo_mode", "default", db=db)

    db.commit()


def branding_logo_bytes(slot: str) -> tuple[bytes, str] | None:
    validated_slot = _validate_slot(slot)
    data = read_scoped_file_bytes(branding_dir(), _slot_filename(validated_slot))
    if data is None:
        return None
    version = (
        PanelSettingsService.get(_version_key(validated_slot), "").strip()
        or hashlib.sha256(data).hexdigest()[:12]
    )
    return data, version
