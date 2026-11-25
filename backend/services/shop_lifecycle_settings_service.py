"""Betreiber-Einstellungen fuer Loeschfristen und Zahlungs-Erinnerungsstufen."""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from services.panel_settings_service import PanelSettingsService

if TYPE_CHECKING:
    from models.hoster import HosterIntegration

DEFAULT_CANCEL_GRACE_DAYS = 7
DEFAULT_UNPAID_AUTO_DELETE_ENABLED = True
DEFAULT_UNPAID_DELETE_DAYS = 30
DEFAULT_ALLOW_CUSTOMER_IMMEDIATE_DELETE = True
DEFAULT_DUNNING_REMINDER_DAYS: list[int] = [7, 4, 1]
DEFAULT_SUBSCRIPTION_DISCOUNT_PERCENT = 0
DEFAULT_REFUND_GUARANTEE_DAYS = 0
DEFAULT_REFUND_POLICY_NOTE = ""
DEFAULT_AUTO_SUBDOMAIN_ENABLED = False
DEFAULT_AUTO_SUBDOMAIN_ZONE = ""
DEFAULT_PAUSE_FREEZE_MAX_DAYS_PER_90D = 0
DEFAULT_SHOP_CHECKOUT_CAPTCHA_ENABLED = False
DEFAULT_SHOP_ALLOW_OVERBOOKING = False
DEFAULT_SHOP_TRUSTPILOT_ENABLED = False
DEFAULT_SHOP_TRUSTPILOT_URL = ""
DEFAULT_SHOP_DISCORD_INVITE_URL = ""
DEFAULT_SHOP_HERO_MODE = "auto_paid"
_ALLOWED_HERO_MODES = frozenset({"auto_paid", "manual"})
DEFAULT_SHOP_SHORT_DURATIONS_ENABLED = False
_SHORT_DURATION_DEFAULTS: dict[int, tuple[bool, int, int]] = {
    3: (True, 25, 199),
    7: (True, 40, 299),
    14: (True, 65, 499),
}
DEFAULT_SHOP_GAME_SWITCH_COOLDOWN_HOURS = 24
DEFAULT_SHOP_GAME_SWITCH_MAX_PER_30D = 4
DEFAULT_SHOP_GAME_SWITCH_ALLOW_HIGHER_PRICE_PLAN = False

_K_CANCEL_GRACE = "shop_lifecycle_cancel_grace_days"
_K_UNPAID_ENABLED = "shop_lifecycle_unpaid_auto_delete_enabled"
_K_UNPAID_DAYS = "shop_lifecycle_unpaid_delete_days"
_K_ALLOW_IMMEDIATE = "shop_lifecycle_allow_customer_immediate_delete"
_K_REMINDERS = "shop_lifecycle_dunning_reminder_days"
_K_SUB_DISCOUNT = "shop_policy_subscription_discount_percent"
_K_REFUND_DAYS = "shop_policy_refund_guarantee_days"
_K_REFUND_NOTE = "shop_policy_refund_policy_note"
_K_AUTO_SUBDOMAIN_ENABLED = "shop_policy_auto_subdomain_enabled"
_K_AUTO_SUBDOMAIN_ZONE = "shop_policy_auto_subdomain_zone"
_K_PAUSE_FREEZE_DAYS = "shop_policy_pause_freeze_max_days_per_90d"
_K_CHECKOUT_CAPTCHA = "shop_policy_checkout_captcha_enabled"
_K_ALLOW_OVERBOOKING = "shop_policy_allow_overbooking"
_K_TRUSTPILOT_ENABLED = "shop_policy_trustpilot_enabled"
_K_TRUSTPILOT_URL = "shop_policy_trustpilot_url"
_K_DISCORD_INVITE_URL = "shop_policy_discord_invite_url"
_K_HERO_MODE = "shop_policy_hero_mode"
_K_SHORT_DURATIONS_ENABLED = "shop_policy_short_durations_enabled"
_K_SHORT_DURATION_TIERS = "shop_policy_short_duration_tiers"
_K_GAME_SWITCH_COOLDOWN_HOURS = "shop_policy_game_switch_cooldown_hours"
_K_GAME_SWITCH_MAX_PER_30D = "shop_policy_game_switch_max_per_30d"
_K_GAME_SWITCH_ALLOW_HIGHER_PRICE = "shop_policy_game_switch_allow_higher_price_plan"


class LifecycleSettingsError(ValueError):
    """Ungueltige Frist- oder Erinnerungskonfiguration (HTTP 422)."""


def _parse_int(raw: str, default: int, *, min_v: int, max_v: int) -> int:
    try:
        val = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    if val < min_v or val > max_v:
        return default
    return val


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None or raw == "":
        return default
    return str(raw).strip().lower() == "true"


_DOMAIN_ZONE_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")


def _has_control_or_space(raw: str) -> bool:
    return any(ch.isspace() or ord(ch) < 32 for ch in raw)


def _validate_trustpilot_url(raw: object) -> str:
    cleaned = str(raw or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) > 512 or _has_control_or_space(cleaned):
        raise LifecycleSettingsError(
            "Trustpilot-URL darf keine Leer- oder Steuerzeichen enthalten"
        )
    parsed = urlparse(cleaned)
    host = (parsed.hostname or "").lower()
    if parsed.scheme.lower() != "https" or not (
        host == "trustpilot.com" or host.endswith(".trustpilot.com")
    ):
        raise LifecycleSettingsError(
            "Trustpilot-URL muss mit https:// auf trustpilot.com zeigen"
        )
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2 or parts[0].lower() != "review" or not parts[1]:
        raise LifecycleSettingsError(
            "Trustpilot-URL muss auf einen /review/<domain>-Pfad zeigen"
        )
    return cleaned


def _validate_discord_invite_url(raw: object) -> str:
    cleaned = str(raw or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) > 512 or _has_control_or_space(cleaned):
        raise LifecycleSettingsError(
            "Discord-Link darf keine Leer- oder Steuerzeichen enthalten"
        )
    parsed = urlparse(cleaned)
    host = (parsed.hostname or "").lower()
    parts = [p for p in parsed.path.split("/") if p]
    valid_gg = host == "discord.gg" and len(parts) >= 1 and bool(parts[0])
    valid_invite = (
        host in {"discord.com", "www.discord.com"}
        and len(parts) >= 2
        and parts[0].lower() == "invite"
        and bool(parts[1])
    )
    if parsed.scheme.lower() != "https" or not (valid_gg or valid_invite):
        raise LifecycleSettingsError(
            "Discord-Link muss mit https://discord.gg/... oder https://discord.com/invite/... beginnen"
        )
    return cleaned


def _normalize_hero_mode(raw: object, default: str = DEFAULT_SHOP_HERO_MODE) -> str:
    val = str(raw or "").strip().lower()
    if val in _ALLOWED_HERO_MODES:
        return val
    return default


def default_short_duration_tiers() -> list[dict[str, object]]:
    return [
        {
            "days": days,
            "enabled": enabled,
            "price_factor_percent": factor,
            "min_price_cents": min_cents,
        }
        for days, (enabled, factor, min_cents) in _SHORT_DURATION_DEFAULTS.items()
    ]


def _normalize_short_duration_tiers(raw: object) -> list[dict[str, object]]:
    if not isinstance(raw, list):
        raise LifecycleSettingsError("Kurzzeit-Stufen muessen als Liste angegeben werden")
    by_days: dict[int, dict[str, object]] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            raise LifecycleSettingsError("Ungueltiger Eintrag in Kurzzeit-Stufen")
        days = _validate_int_field(entry.get("days"), label="Kurzzeit-Tage", min_v=1, max_v=30)
        if days not in _SHORT_DURATION_DEFAULTS:
            raise LifecycleSettingsError("Unterstuetzt werden nur die Stufen 3, 7 oder 14 Tage")
        if days in by_days:
            raise LifecycleSettingsError(f"Doppelte Kurzzeit-Stufe fuer {days} Tage")
        enabled_raw = entry.get("enabled", True)
        if not isinstance(enabled_raw, bool):
            raise LifecycleSettingsError("Aktiv-Status der Kurzzeit-Stufe muss boolesch sein")
        factor = _validate_int_field(
            entry.get("price_factor_percent"),
            label=f"Preisfaktor ({days} Tage)",
            min_v=5,
            max_v=100,
        )
        min_cents = _validate_int_field(
            entry.get("min_price_cents"),
            label=f"Mindestpreis ({days} Tage)",
            min_v=100,
            max_v=100_000,
        )
        by_days[days] = {
            "days": days,
            "enabled": enabled_raw,
            "price_factor_percent": factor,
            "min_price_cents": min_cents,
        }
    if set(by_days.keys()) != set(_SHORT_DURATION_DEFAULTS.keys()):
        raise LifecycleSettingsError("Alle drei Kurzzeit-Stufen (3, 7, 14 Tage) muessen enthalten sein")
    return [by_days[d] for d in (3, 7, 14)]


def _parse_short_duration_tiers(raw: str | None) -> list[dict[str, object]]:
    if not raw or not str(raw).strip():
        return default_short_duration_tiers()
    try:
        parsed = json.loads(raw)
        return _normalize_short_duration_tiers(parsed)
    except Exception:
        return default_short_duration_tiers()


def _normalize_zone(raw: object) -> str:
    cleaned = str(raw or "").strip().lower().lstrip(".")
    return cleaned[:128]


def _parse_reminders(raw: str | None) -> list[int]:
    if not raw or not str(raw).strip():
        return list(DEFAULT_DUNNING_REMINDER_DAYS)
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            return list(DEFAULT_DUNNING_REMINDER_DAYS)
        cleaned = sorted(
            {
                int(x)
                for x in parsed
                if isinstance(x, (int, float)) and not isinstance(x, bool) and 1 <= int(x) <= 365
            },
            reverse=True,
        )
        return cleaned[:10]
    except Exception:
        return list(DEFAULT_DUNNING_REMINDER_DAYS)


def read(db: Session | None = None) -> dict[str, object]:
    """Liest alle Lifecycle-Fristen und Mahnstufen mit sicheren Standardwerten."""
    return {
        "cancel_grace_days": _parse_int(
            PanelSettingsService.get(_K_CANCEL_GRACE, str(DEFAULT_CANCEL_GRACE_DAYS), db=db),
            DEFAULT_CANCEL_GRACE_DAYS,
            min_v=0,
            max_v=365,
        ),
        "unpaid_auto_delete_enabled": _parse_bool(
            PanelSettingsService.get(
                _K_UNPAID_ENABLED,
                "true" if DEFAULT_UNPAID_AUTO_DELETE_ENABLED else "false",
                db=db,
            ),
            DEFAULT_UNPAID_AUTO_DELETE_ENABLED,
        ),
        "unpaid_delete_days": _parse_int(
            PanelSettingsService.get(_K_UNPAID_DAYS, str(DEFAULT_UNPAID_DELETE_DAYS), db=db),
            DEFAULT_UNPAID_DELETE_DAYS,
            min_v=1,
            max_v=365,
        ),
        "allow_customer_immediate_delete": _parse_bool(
            PanelSettingsService.get(
                _K_ALLOW_IMMEDIATE,
                "true" if DEFAULT_ALLOW_CUSTOMER_IMMEDIATE_DELETE else "false",
                db=db,
            ),
            DEFAULT_ALLOW_CUSTOMER_IMMEDIATE_DELETE,
        ),
        "dunning_reminder_days": _parse_reminders(
            PanelSettingsService.get(
                _K_REMINDERS, json.dumps(DEFAULT_DUNNING_REMINDER_DAYS), db=db
            )
        ),
        "subscription_discount_percent": _parse_int(
            PanelSettingsService.get(
                _K_SUB_DISCOUNT, str(DEFAULT_SUBSCRIPTION_DISCOUNT_PERCENT), db=db
            ),
            DEFAULT_SUBSCRIPTION_DISCOUNT_PERCENT,
            min_v=0,
            max_v=50,
        ),
        "refund_guarantee_days": _parse_int(
            PanelSettingsService.get(
                _K_REFUND_DAYS, str(DEFAULT_REFUND_GUARANTEE_DAYS), db=db
            ),
            DEFAULT_REFUND_GUARANTEE_DAYS,
            min_v=0,
            max_v=30,
        ),
        "refund_policy_note": (
            PanelSettingsService.get(_K_REFUND_NOTE, DEFAULT_REFUND_POLICY_NOTE, db=db)
            or ""
        )[:280],
        "auto_subdomain_enabled": _parse_bool(
            PanelSettingsService.get(
                _K_AUTO_SUBDOMAIN_ENABLED,
                "true" if DEFAULT_AUTO_SUBDOMAIN_ENABLED else "false",
                db=db,
            ),
            DEFAULT_AUTO_SUBDOMAIN_ENABLED,
        ),
        "auto_subdomain_zone": _normalize_zone(
            PanelSettingsService.get(_K_AUTO_SUBDOMAIN_ZONE, DEFAULT_AUTO_SUBDOMAIN_ZONE, db=db)
        ),
        "pause_freeze_max_days_per_90d": _parse_int(
            PanelSettingsService.get(
                _K_PAUSE_FREEZE_DAYS, str(DEFAULT_PAUSE_FREEZE_MAX_DAYS_PER_90D), db=db
            ),
            DEFAULT_PAUSE_FREEZE_MAX_DAYS_PER_90D,
            min_v=0,
            max_v=90,
        ),
        "shop_checkout_captcha_enabled": _parse_bool(
            PanelSettingsService.get(
                _K_CHECKOUT_CAPTCHA,
                "true" if DEFAULT_SHOP_CHECKOUT_CAPTCHA_ENABLED else "false",
                db=db,
            ),
            DEFAULT_SHOP_CHECKOUT_CAPTCHA_ENABLED,
        ),
        "shop_allow_overbooking": _parse_bool(
            PanelSettingsService.get(
                _K_ALLOW_OVERBOOKING,
                "true" if DEFAULT_SHOP_ALLOW_OVERBOOKING else "false",
                db=db,
            ),
            DEFAULT_SHOP_ALLOW_OVERBOOKING,
        ),
        "shop_trustpilot_enabled": _parse_bool(
            PanelSettingsService.get(
                _K_TRUSTPILOT_ENABLED,
                "true" if DEFAULT_SHOP_TRUSTPILOT_ENABLED else "false",
                db=db,
            ),
            DEFAULT_SHOP_TRUSTPILOT_ENABLED,
        ),
        "shop_trustpilot_url": (
            PanelSettingsService.get(
                _K_TRUSTPILOT_URL, DEFAULT_SHOP_TRUSTPILOT_URL, db=db
            )
            or ""
        ).strip()[:512],
        "shop_discord_invite_url": (
            PanelSettingsService.get(
                _K_DISCORD_INVITE_URL, DEFAULT_SHOP_DISCORD_INVITE_URL, db=db
            )
            or ""
        ).strip()[:512],
        "shop_hero_mode": _normalize_hero_mode(
            PanelSettingsService.get(_K_HERO_MODE, DEFAULT_SHOP_HERO_MODE, db=db)
        ),
        "shop_short_durations_enabled": _parse_bool(
            PanelSettingsService.get(
                _K_SHORT_DURATIONS_ENABLED,
                "true" if DEFAULT_SHOP_SHORT_DURATIONS_ENABLED else "false",
                db=db,
            ),
            DEFAULT_SHOP_SHORT_DURATIONS_ENABLED,
        ),
        "shop_short_duration_tiers": _parse_short_duration_tiers(
            PanelSettingsService.get(_K_SHORT_DURATION_TIERS, None, db=db)
        ),
        "shop_game_switch_cooldown_hours": _parse_int(
            PanelSettingsService.get(
                _K_GAME_SWITCH_COOLDOWN_HOURS,
                str(DEFAULT_SHOP_GAME_SWITCH_COOLDOWN_HOURS),
                db=db,
            ),
            DEFAULT_SHOP_GAME_SWITCH_COOLDOWN_HOURS,
            min_v=0,
            max_v=720,
        ),
        "shop_game_switch_max_per_30d": _parse_int(
            PanelSettingsService.get(
                _K_GAME_SWITCH_MAX_PER_30D,
                str(DEFAULT_SHOP_GAME_SWITCH_MAX_PER_30D),
                db=db,
            ),
            DEFAULT_SHOP_GAME_SWITCH_MAX_PER_30D,
            min_v=0,
            max_v=100,
        ),
        "shop_game_switch_allow_higher_price_plan": _parse_bool(
            PanelSettingsService.get(
                _K_GAME_SWITCH_ALLOW_HIGHER_PRICE,
                "true" if DEFAULT_SHOP_GAME_SWITCH_ALLOW_HIGHER_PRICE_PLAN else "false",
                db=db,
            ),
            DEFAULT_SHOP_GAME_SWITCH_ALLOW_HIGHER_PRICE_PLAN,
        ),
    }


def _validate_int_field(val: object, *, label: str, min_v: int, max_v: int) -> int:
    if isinstance(val, bool):
        raise LifecycleSettingsError(f"{label} muss eine ganze Zahl sein")
    try:
        num = int(val)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise LifecycleSettingsError(f"{label} muss eine ganze Zahl sein") from exc
    if num < min_v or num > max_v:
        raise LifecycleSettingsError(f"{label} muss zwischen {min_v} und {max_v} liegen")
    return num


def _validate_reminders(raw: object) -> list[int]:
    if not isinstance(raw, list):
        raise LifecycleSettingsError("Erinnerungsstufen muessen als Liste angegeben werden")
    seen: set[int] = set()
    cleaned: list[int] = []
    for item in raw:
        day = _validate_int_field(item, label="Erinnerungsstufe", min_v=1, max_v=365)
        if day not in seen:
            seen.add(day)
            cleaned.append(day)
    if len(cleaned) > 10:
        raise LifecycleSettingsError("Maximal 10 Erinnerungsstufen erlaubt")
    cleaned.sort(reverse=True)
    return cleaned


def update(values: dict[str, object], db: Session | None = None) -> dict[str, object]:
    """Validiert und speichert die Betreiber-Einstellungen."""
    current = read(db=db)
    next_grace = (
        _validate_int_field(
            values["cancel_grace_days"],
            label="Kündigungs-Schonfrist",
            min_v=0,
            max_v=365,
        )
        if "cancel_grace_days" in values and values["cancel_grace_days"] is not None
        else int(current["cancel_grace_days"])  # type: ignore[arg-type]
    )
    next_unpaid_days = (
        _validate_int_field(
            values["unpaid_delete_days"],
            label="Zahlungsverzug-Löschfrist",
            min_v=1,
            max_v=365,
        )
        if "unpaid_delete_days" in values and values["unpaid_delete_days"] is not None
        else int(current["unpaid_delete_days"])  # type: ignore[arg-type]
    )
    next_unpaid_enabled = (
        bool(values["unpaid_auto_delete_enabled"])
        if "unpaid_auto_delete_enabled" in values and values["unpaid_auto_delete_enabled"] is not None
        else bool(current["unpaid_auto_delete_enabled"])
    )
    next_immediate = (
        bool(values["allow_customer_immediate_delete"])
        if "allow_customer_immediate_delete" in values and values["allow_customer_immediate_delete"] is not None
        else bool(current["allow_customer_immediate_delete"])
    )
    next_reminders = (
        _validate_reminders(values["dunning_reminder_days"])
        if "dunning_reminder_days" in values and values["dunning_reminder_days"] is not None
        else list(current["dunning_reminder_days"])  # type: ignore[arg-type]
    )
    next_sub_discount = (
        _validate_int_field(
            values["subscription_discount_percent"],
            label="Abo-Rabatt (%)",
            min_v=0,
            max_v=50,
        )
        if "subscription_discount_percent" in values and values["subscription_discount_percent"] is not None
        else int(current["subscription_discount_percent"])  # type: ignore[arg-type]
    )
    next_refund_days = (
        _validate_int_field(
            values["refund_guarantee_days"],
            label="Geld-zurück-Frist (Tage)",
            min_v=0,
            max_v=30,
        )
        if "refund_guarantee_days" in values and values["refund_guarantee_days"] is not None
        else int(current["refund_guarantee_days"])  # type: ignore[arg-type]
    )
    next_refund_note = (
        str(values["refund_policy_note"]).strip()[:280]
        if "refund_policy_note" in values and values["refund_policy_note"] is not None
        else str(current["refund_policy_note"] or "")
    )
    next_subdomain_enabled = (
        bool(values["auto_subdomain_enabled"])
        if "auto_subdomain_enabled" in values and values["auto_subdomain_enabled"] is not None
        else bool(current["auto_subdomain_enabled"])
    )
    next_subdomain_zone = (
        _normalize_zone(values["auto_subdomain_zone"])
        if "auto_subdomain_zone" in values and values["auto_subdomain_zone"] is not None
        else str(current["auto_subdomain_zone"] or "")
    )
    if next_subdomain_zone and not _DOMAIN_ZONE_RE.fullmatch(next_subdomain_zone):
        raise LifecycleSettingsError("Subdomain-Zone muss ein gueltiger Domainname sein (z. B. host.deinedomain.de)")
    next_pause_freeze_days = (
        _validate_int_field(
            values["pause_freeze_max_days_per_90d"],
            label="Max. Pausentage (90 Tage)",
            min_v=0,
            max_v=90,
        )
        if "pause_freeze_max_days_per_90d" in values and values["pause_freeze_max_days_per_90d"] is not None
        else int(current["pause_freeze_max_days_per_90d"])  # type: ignore[arg-type]
    )
    next_checkout_captcha = (
        bool(values["shop_checkout_captcha_enabled"])
        if "shop_checkout_captcha_enabled" in values and values["shop_checkout_captcha_enabled"] is not None
        else bool(current["shop_checkout_captcha_enabled"])
    )
    next_allow_overbooking = (
        bool(values["shop_allow_overbooking"])
        if "shop_allow_overbooking" in values and values["shop_allow_overbooking"] is not None
        else bool(current["shop_allow_overbooking"])
    )
    next_trustpilot_enabled = (
        bool(values["shop_trustpilot_enabled"])
        if "shop_trustpilot_enabled" in values and values["shop_trustpilot_enabled"] is not None
        else bool(current["shop_trustpilot_enabled"])
    )
    next_trustpilot_url = (
        _validate_trustpilot_url(values["shop_trustpilot_url"])
        if "shop_trustpilot_url" in values and values["shop_trustpilot_url"] is not None
        else _validate_trustpilot_url(current["shop_trustpilot_url"])
    )
    if next_trustpilot_enabled and not next_trustpilot_url:
        raise LifecycleSettingsError(
            "Bei aktiviertem Trustpilot muss eine gueltige Trustpilot-Profil-URL hinterlegt werden"
        )
    next_discord_invite_url = (
        _validate_discord_invite_url(values["shop_discord_invite_url"])
        if "shop_discord_invite_url" in values and values["shop_discord_invite_url"] is not None
        else _validate_discord_invite_url(current["shop_discord_invite_url"])
    )
    if "shop_hero_mode" in values and values["shop_hero_mode"] is not None:
        raw_hero_mode = str(values["shop_hero_mode"]).strip().lower()
        if raw_hero_mode not in _ALLOWED_HERO_MODES:
            raise LifecycleSettingsError(
                "Hero-Modus muss 'auto_paid' oder 'manual' sein"
            )
        next_hero_mode = raw_hero_mode
    else:
        next_hero_mode = _normalize_hero_mode(current.get("shop_hero_mode"))
    next_short_enabled = (
        bool(values["shop_short_durations_enabled"])
        if "shop_short_durations_enabled" in values
        and values["shop_short_durations_enabled"] is not None
        else bool(current["shop_short_durations_enabled"])
    )
    next_short_tiers = (
        _normalize_short_duration_tiers(values["shop_short_duration_tiers"])
        if "shop_short_duration_tiers" in values
        and values["shop_short_duration_tiers"] is not None
        else list(current["shop_short_duration_tiers"])  # type: ignore[arg-type]
    )
    next_switch_cooldown = (
        _validate_int_field(
            values["shop_game_switch_cooldown_hours"],
            label="Spielwechsel-Cooldown (Stunden)",
            min_v=0,
            max_v=720,
        )
        if "shop_game_switch_cooldown_hours" in values
        and values["shop_game_switch_cooldown_hours"] is not None
        else int(current["shop_game_switch_cooldown_hours"])  # type: ignore[arg-type]
    )
    next_switch_max_30d = (
        _validate_int_field(
            values["shop_game_switch_max_per_30d"],
            label="Max. Spielwechsel je 30 Tage",
            min_v=0,
            max_v=100,
        )
        if "shop_game_switch_max_per_30d" in values
        and values["shop_game_switch_max_per_30d"] is not None
        else int(current["shop_game_switch_max_per_30d"])  # type: ignore[arg-type]
    )
    next_switch_higher_price = (
        bool(values["shop_game_switch_allow_higher_price_plan"])
        if "shop_game_switch_allow_higher_price_plan" in values
        and values["shop_game_switch_allow_higher_price_plan"] is not None
        else bool(current["shop_game_switch_allow_higher_price_plan"])
    )

    PanelSettingsService.set(_K_CANCEL_GRACE, str(next_grace))
    PanelSettingsService.set(_K_UNPAID_ENABLED, "true" if next_unpaid_enabled else "false")
    PanelSettingsService.set(_K_UNPAID_DAYS, str(next_unpaid_days))
    PanelSettingsService.set(_K_ALLOW_IMMEDIATE, "true" if next_immediate else "false")
    PanelSettingsService.set(_K_REMINDERS, json.dumps(next_reminders))
    PanelSettingsService.set(_K_SUB_DISCOUNT, str(next_sub_discount))
    PanelSettingsService.set(_K_REFUND_DAYS, str(next_refund_days))
    PanelSettingsService.set(_K_REFUND_NOTE, next_refund_note)
    PanelSettingsService.set(_K_AUTO_SUBDOMAIN_ENABLED, "true" if next_subdomain_enabled else "false")
    PanelSettingsService.set(_K_AUTO_SUBDOMAIN_ZONE, next_subdomain_zone)
    PanelSettingsService.set(_K_PAUSE_FREEZE_DAYS, str(next_pause_freeze_days))
    PanelSettingsService.set(
        _K_CHECKOUT_CAPTCHA, "true" if next_checkout_captcha else "false"
    )
    PanelSettingsService.set(
        _K_ALLOW_OVERBOOKING, "true" if next_allow_overbooking else "false"
    )
    PanelSettingsService.set(
        _K_TRUSTPILOT_ENABLED, "true" if next_trustpilot_enabled else "false"
    )
    PanelSettingsService.set(_K_TRUSTPILOT_URL, next_trustpilot_url)
    PanelSettingsService.set(_K_DISCORD_INVITE_URL, next_discord_invite_url)
    PanelSettingsService.set(_K_HERO_MODE, next_hero_mode)
    PanelSettingsService.set(
        _K_SHORT_DURATIONS_ENABLED, "true" if next_short_enabled else "false"
    )
    PanelSettingsService.set(_K_SHORT_DURATION_TIERS, json.dumps(next_short_tiers))
    PanelSettingsService.set(_K_GAME_SWITCH_COOLDOWN_HOURS, str(next_switch_cooldown))
    PanelSettingsService.set(_K_GAME_SWITCH_MAX_PER_30D, str(next_switch_max_30d))
    PanelSettingsService.set(
        _K_GAME_SWITCH_ALLOW_HIGHER_PRICE,
        "true" if next_switch_higher_price else "false",
    )
    return read(db=db)


def subscription_discount_percent(db: Session | None = None) -> int:
    return int(read(db=db)["subscription_discount_percent"])  # type: ignore[arg-type]


def public_policy(db: Session | None = None) -> dict[str, object]:
    cfg = read(db=db)
    return {
        "default_billing_mode": "prepaid",
        "subscription_discount_percent": cfg["subscription_discount_percent"],
        "refund_guarantee_days": cfg["refund_guarantee_days"],
        "refund_policy_note": cfg["refund_policy_note"],
        "cancel_grace_days": cfg["cancel_grace_days"],
        "auto_subdomain_enabled": cfg["auto_subdomain_enabled"],
        "auto_subdomain_zone": cfg["auto_subdomain_zone"],
        "pause_freeze_max_days_per_90d": cfg["pause_freeze_max_days_per_90d"],
        "shop_checkout_captcha_enabled": cfg["shop_checkout_captcha_enabled"],
        "shop_trustpilot_enabled": cfg["shop_trustpilot_enabled"],
        "shop_trustpilot_url": cfg["shop_trustpilot_url"],
        "shop_discord_invite_url": cfg["shop_discord_invite_url"],
        "shop_hero_mode": cfg["shop_hero_mode"],
        "shop_short_durations_enabled": cfg["shop_short_durations_enabled"],
        "shop_short_duration_tiers": cfg["shop_short_duration_tiers"],
        "shop_game_switch_cooldown_hours": cfg["shop_game_switch_cooldown_hours"],
        "shop_game_switch_max_per_30d": cfg["shop_game_switch_max_per_30d"],
        "shop_game_switch_allow_higher_price_plan": cfg["shop_game_switch_allow_higher_price_plan"],
    }


def game_switch_cooldown_hours(db: Session | None = None) -> int:
    return int(read(db=db)["shop_game_switch_cooldown_hours"])  # type: ignore[arg-type]


def game_switch_max_per_30d(db: Session | None = None) -> int:
    return int(read(db=db)["shop_game_switch_max_per_30d"])  # type: ignore[arg-type]


def game_switch_allow_higher_price_plan(db: Session | None = None) -> bool:
    return bool(read(db=db)["shop_game_switch_allow_higher_price_plan"])


def active_short_duration_tier(
    days: int, *, db: Session | None = None
) -> dict[str, object] | None:
    cfg = read(db=db)
    if not bool(cfg.get("shop_short_durations_enabled")):
        return None
    for entry in cfg.get("shop_short_duration_tiers") or []:  # type: ignore[union-attr]
        if int(entry["days"]) == int(days) and bool(entry.get("enabled")):
            return entry
    return None


def pause_freeze_max_days_per_90d(db: Session | None = None) -> int:
    return int(read(db=db)["pause_freeze_max_days_per_90d"])  # type: ignore[arg-type]


def checkout_captcha_enabled(db: Session | None = None) -> bool:
    return bool(read(db=db)["shop_checkout_captcha_enabled"])


def is_shop_overbooking_allowed(db: Session | None = None) -> bool:
    return bool(read(db=db)["shop_allow_overbooking"])


def cancel_grace_days(db: Session | None = None) -> int:
    return int(read(db=db)["cancel_grace_days"])  # type: ignore[arg-type]


def unpaid_auto_delete_enabled(db: Session | None = None) -> bool:
    return bool(read(db=db)["unpaid_auto_delete_enabled"])


def unpaid_delete_days(db: Session | None = None) -> int:
    return int(read(db=db)["unpaid_delete_days"])  # type: ignore[arg-type]


def allow_customer_immediate_delete(db: Session | None = None) -> bool:
    return bool(read(db=db)["allow_customer_immediate_delete"])


def dunning_reminder_days(db: Session | None = None) -> list[int]:
    return list(read(db=db)["dunning_reminder_days"])  # type: ignore[arg-type]


def resolve_hoster_unpaid_delete_days(
    integration: "HosterIntegration", db: Session | None = None
) -> int:
    """Effektive Loeschfrist (in Tagen) fuer eine Hoster-Integration; 0 = deaktiviert."""
    override = getattr(integration, "unpaid_delete_days", None)
    if override is not None:
        return max(0, min(365, int(override)))
    if not unpaid_auto_delete_enabled(db=db):
        return 0
    return unpaid_delete_days(db=db)
