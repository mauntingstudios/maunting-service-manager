"""Singra-Werkzeuge fuer den nativen Shop (`ai.shop.manage`)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from models import User
from services import (
    permission_service,
    shop_addon_service,
    shop_catalog_service,
    shop_coupon_service,
    wallpaper_service,
)
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import spaet, spaet_vorschlag, werkzeug
from services.ai_tools.base import _RATIONALE_REQUIRED, _RATIONALE_SCHEMA, _function


def _lies_shop_catalog(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict[str, Any]:
    if not permission_service.has_global_permission(db, user, "ai.shop.manage") or not (
        permission_service.has_global_permission(db, user, "shop.read")
        or permission_service.has_global_permission(db, user, "panel.settings.read")
    ):
        raise AiActionValidationError(
            "Shop-Verwaltung ueber die KI erfordert ai.shop.manage sowie shop.read oder panel.settings.read"
        )

    raw_include = arguments.get("include")
    erlaubt = {"blueprints", "plans", "coupons", "addons"}
    if isinstance(raw_include, list) and raw_include:
        sections = [str(s) for s in raw_include if str(s) in erlaubt]
    else:
        sections = ["blueprints", "plans", "coupons", "addons"]

    raw_excl = arguments.get("exclude_categories")
    excluded_cats = (
        {str(c).strip() for c in raw_excl if str(c).strip()}
        if isinstance(raw_excl, list)
        else set()
    )

    out: dict[str, Any] = {}

    if "blueprints" in sections:
        from blueprints import get_registry

        seen: set[str] = set()
        bp_rows: list[dict[str, Any]] = []
        for entry in get_registry().list():
            bp = entry.blueprint
            if bp.meta.id in seen:
                continue
            seen.add(bp.meta.id)
            cat = bp.meta.category.value
            if cat in excluded_cats:
                continue
            app_id = wallpaper_service.artwork_app_id_for_blueprint(bp)
            players = getattr(bp, "players", None)
            bp_rows.append(
                {
                    "id": bp.meta.id,
                    "name": bp.meta.name,
                    "game": bp.meta.game,
                    "category": cat,
                    "has_steam_artwork": app_id is not None,
                    "steam_artwork_app_id": app_id,
                    "supports_slots": players is not None,
                    "players_min": players.min if players is not None else None,
                    "players_max": players.max if players is not None else None,
                    "source": entry.origin.value,
                }
            )
        out["blueprints"] = bp_rows

    if "plans" in sections:
        order_counts = shop_catalog_service.recent_paid_order_counts(db)
        out["plans"] = [
            {
                "id": p.id,
                "game_type": p.game_type,
                "name": redact_sensitive_text(p.name),
                "price_cents": p.price_cents,
                "lifetime_price_cents": getattr(p, "lifetime_price_cents", None),
                "allow_game_switch": bool(getattr(p, "allow_game_switch", True)),
                "allow_short_durations": bool(getattr(p, "allow_short_durations", True)),
                "tax_rate_percent": p.tax_rate_percent,
                "ram_included_mb": p.ram_included_mb,
                "ram_max_mb": p.ram_max_mb,
                "cpu_included": p.cpu_included,
                "cpu_max": p.cpu_max,
                "slots_included": p.slots_included,
                "slots_max": p.slots_max,
                "artwork_mode": p.artwork_mode,
                "active": bool(p.active),
                "sort_order": p.sort_order,
                "is_featured": bool(getattr(p, "is_featured", False)),
                "is_bestseller": bool(getattr(p, "is_bestseller", False)),
                "is_new": bool(getattr(p, "is_new", False)),
                "pinned_in_hero": bool(getattr(p, "pinned_in_hero", False)),
                "promo_highlight_text": (
                    redact_sensitive_text(getattr(p, "promo_highlight_text", None))
                    if getattr(p, "promo_highlight_text", None)
                    else None
                ),
                "recent_order_count": order_counts.get(p.id, 0),
            }
            for p in shop_catalog_service.list_plans(db)
        ]

    if "coupons" in sections:
        out["coupons"] = [
            {
                "id": c.id,
                "code": c.code,
                "name": redact_sensitive_text(c.name),
                "discount_type": c.discount_type,
                "discount_value": c.discount_value,
                "scope": c.scope,
                "target_plan_ids": shop_coupon_service._parse_plan_ids(c.target_plan_ids_json),
                "valid_from": c.valid_from.isoformat() if c.valid_from else None,
                "valid_until": c.valid_until.isoformat() if c.valid_until else None,
                "show_badge": bool(c.show_badge),
                "show_banner": bool(c.show_banner),
                "active": bool(c.active),
            }
            for c in shop_coupon_service.list_coupons(db)
        ]

    if "addons" in sections:
        out["addons"] = [
            {
                "id": a.id,
                "slug": a.slug,
                "name": redact_sensitive_text(a.name),
                "category": a.category,
                "price_cents": a.price_cents,
                "extra_ai_tokens": a.extra_ai_tokens,
                "extra_slots": a.extra_slots,
                "extra_backups": a.extra_backups,
                "extra_storage_mb": a.extra_storage_mb,
                "role_id": a.role_id,
                "active": bool(a.active),
            }
            for a in shop_addon_service.list_addons(db)
        ]

    return out


_PLAN_ITEM_PROPERTIES: dict[str, Any] = {
    "plan_id": {"type": ["integer", "null"], "minimum": 1},
    "game_type": {"type": "string", "maxLength": 64},
    "name": {"type": "string", "maxLength": 128},
    "description": {"type": ["string", "null"], "maxLength": 4096},
    "price_cents": {"type": "integer", "minimum": 0},
    "currency": {"type": "string", "enum": ["EUR"]},
    "billing_interval": {"type": "string", "enum": ["month"]},
    "tax_rate_percent": {"type": "integer", "minimum": 0, "maximum": 100},
    "ram_included_mb": {"type": ["integer", "null"], "minimum": 0},
    "ram_max_mb": {"type": ["integer", "null"], "minimum": 0},
    "ram_step_mb": {"type": ["integer", "null"], "minimum": 0},
    "price_per_ram_step_cents": {"type": "integer", "minimum": 0},
    "cpu_included": {"type": ["integer", "null"], "minimum": 0},
    "cpu_max": {"type": ["integer", "null"], "minimum": 0},
    "cpu_step": {"type": "integer", "minimum": 0},
    "price_per_cpu_step_cents": {"type": "integer", "minimum": 0},
    "slots_included": {"type": ["integer", "null"], "minimum": 0},
    "slots_max": {"type": ["integer", "null"], "minimum": 0},
    "slots_step": {"type": "integer", "minimum": 0},
    "price_per_slot_step_cents": {"type": "integer", "minimum": 0},
    "node_id": {"type": ["integer", "null"], "minimum": 1},
    "role_id": {"type": ["integer", "null"], "minimum": 1},
    "artwork_mode": {"type": "string", "enum": ["steam", "custom", "none"]},
    "active": {"type": "boolean"},
    "sort_order": {"type": "integer"},
    "lifetime_price_cents": {"type": ["integer", "null"], "minimum": 0},
    "allow_game_switch": {"type": "boolean"},
    "allow_short_durations": {"type": "boolean"},
    "is_featured": {"type": "boolean"},
    "is_bestseller": {"type": "boolean"},
    "is_new": {"type": "boolean"},
    "pinned_in_hero": {"type": "boolean"},
    "promo_highlight_text": {"type": ["string", "null"], "maxLength": 80},
}

_READ_SHOP_CATALOG = _function(
    "read_shop_catalog",
    "Liest verfuegbare Blueprints (inkl. Steam-Artwork und Slot-Support) sowie bestehende Shop-Tarife, Gutscheine und Add-ons.",
    {
        "include": {
            "type": "array",
            "items": {"type": "string", "enum": ["blueprints", "plans", "coupons", "addons"]},
        },
        "exclude_categories": {
            "type": "array",
            "items": {"type": "string", "maxLength": 64},
            "description": "Optionale Blueprint-Kategorien zum Auslassen, z. B. ['frontend', 'backend'].",
        },
    },
    [],
)

_PROPOSE_SHOP_PLAN_UPSERT = _function(
    "propose_shop_plan_upsert",
    "Schlaegt einen oder mehrere Shop-Tarife (per 'plans'-Liste oder Einzelfelder) zum Anlegen oder Aendern vor.",
    {
        "plans": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": {
                "type": "object",
                "properties": _PLAN_ITEM_PROPERTIES,
                "additionalProperties": False,
            },
        },
        **_PLAN_ITEM_PROPERTIES,
        **_RATIONALE_SCHEMA,
    },
    [*_RATIONALE_REQUIRED],
)

_PROPOSE_SHOP_COUPON_UPSERT = _function(
    "propose_shop_coupon_upsert",
    "Schlaegt einen Shop-Gutschein oder zeitgesteuerten Flash-Sale zum Anlegen oder Aendern vor.",
    {
        "coupon_id": {"type": ["integer", "null"], "minimum": 1},
        "code": {"type": "string", "maxLength": 48},
        "name": {"type": "string", "maxLength": 128},
        "promo_text": {"type": ["string", "null"], "maxLength": 240},
        "discount_type": {"type": "string", "enum": ["percent", "fixed_cents"]},
        "discount_value": {"type": "integer", "minimum": 1},
        "scope": {"type": "string", "enum": ["all", "plans", "addons"]},
        "target_plan_ids": {"type": "array", "items": {"type": "integer", "minimum": 1}},
        "min_gross_cents": {"type": "integer", "minimum": 0},
        "max_redemptions": {"type": ["integer", "null"], "minimum": 1},
        "valid_from": {"type": ["string", "null"], "maxLength": 64},
        "valid_until": {"type": ["string", "null"], "maxLength": 64},
        "show_badge": {"type": "boolean"},
        "show_banner": {"type": "boolean"},
        "banner_cooldown_hours": {"type": "integer", "minimum": 0, "maximum": 720},
        "active": {"type": "boolean"},
        **_RATIONALE_SCHEMA,
    },
    [*_RATIONALE_REQUIRED],
)

_PROPOSE_SHOP_ADDON_UPSERT = _function(
    "propose_shop_addon_upsert",
    "Schlaegt ein eigenstaendiges Shop-Add-on (KI-Kontingent, Slots, Backups, Speicher oder Rolle) vor.",
    {
        "addon_id": {"type": ["integer", "null"], "minimum": 1},
        "slug": {"type": "string", "maxLength": 64},
        "name": {"type": "string", "maxLength": 128},
        "description": {"type": ["string", "null"], "maxLength": 4096},
        "category": {"type": "string", "enum": ["ai_quota", "slots", "backups", "storage", "role"]},
        "price_cents": {"type": "integer", "minimum": 0},
        "tax_rate_percent": {"type": "integer", "minimum": 0, "maximum": 100},
        "extra_slots": {"type": ["integer", "null"], "minimum": 0},
        "extra_storage_mb": {"type": ["integer", "null"], "minimum": 0},
        "extra_backups": {"type": ["integer", "null"], "minimum": 0},
        "extra_ai_tokens": {"type": ["integer", "null"], "minimum": 0},
        "role_id": {"type": ["integer", "null"], "minimum": 1},
        "active": {"type": "boolean"},
        "sort_order": {"type": "integer"},
        **_RATIONALE_SCHEMA,
    },
    [*_RATIONALE_REQUIRED],
)

DEFINITIONEN = [
    _READ_SHOP_CATALOG,
    _PROPOSE_SHOP_PLAN_UPSERT,
    _PROPOSE_SHOP_COUPON_UPSERT,
    _PROPOSE_SHOP_ADDON_UPSERT,
]

werkzeug(
    _READ_SHOP_CATALOG,
    art="global_read",
    gruppe="shop",
    angebot=("ai.shop.manage",),
    hinweis="Liest Blueprints und aktuellen Shop-Katalog.",
    global_handler=_lies_shop_catalog,
)
werkzeug(
    _PROPOSE_SHOP_PLAN_UPSERT,
    art="global_write",
    gruppe="shop",
    recht="ai.shop.manage",
    recht_global=True,
    immer_bestaetigen=True,
    hinweis="Legt Shop-Tarife an oder aktualisiert bestehende.",
    vorschlag=spaet_vorschlag(
        "services.ai_proposals.shop_proposals._shop_plan_upsert_payload"
    ),
    ausfuehren=spaet(
        "services.ai_proposals.shop_proposals._ausfuehren_shop_plan_upsert"
    ),
)
werkzeug(
    _PROPOSE_SHOP_COUPON_UPSERT,
    art="global_write",
    gruppe="shop",
    recht="ai.shop.manage",
    recht_global=True,
    immer_bestaetigen=True,
    hinweis="Legt einen Gutschein oder Flash-Sale an oder aendert ihn.",
    vorschlag=spaet_vorschlag(
        "services.ai_proposals.shop_proposals._shop_coupon_upsert_payload"
    ),
    ausfuehren=spaet(
        "services.ai_proposals.shop_proposals._ausfuehren_shop_coupon_upsert"
    ),
)
werkzeug(
    _PROPOSE_SHOP_ADDON_UPSERT,
    art="global_write",
    gruppe="shop",
    recht="ai.shop.manage",
    recht_global=True,
    immer_bestaetigen=True,
    hinweis="Legt ein Shop-Add-on an oder aendert es.",
    vorschlag=spaet_vorschlag(
        "services.ai_proposals.shop_proposals._shop_addon_upsert_payload"
    ),
    ausfuehren=spaet(
        "services.ai_proposals.shop_proposals._ausfuehren_shop_addon_upsert"
    ),
)
