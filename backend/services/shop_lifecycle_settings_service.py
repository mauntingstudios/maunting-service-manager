"""Betreiber-Einstellungen fuer Loeschfristen und Zahlungs-Erinnerungsstufen."""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

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
    }


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
