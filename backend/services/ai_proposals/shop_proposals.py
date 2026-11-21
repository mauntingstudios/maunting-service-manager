"""Proposal-Bauer und Ausfuehrung fuer Singra-Shop-Werkzeuge (`ai.shop.manage`)."""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from models import ShopAddon, ShopCoupon, ShopPlan, User
from schemas.shop import (
    ShopAddonUpdate,
    ShopAddonWrite,
    ShopCouponUpdate,
    ShopCouponWrite,
    ShopPlanUpdate,
    ShopPlanWrite,
)
from services import (
    permission_service,
    shop_addon_service,
    shop_catalog_service,
    shop_coupon_service,
    wallpaper_service,
)
from services.ai_action_errors import AiActionValidationError
from services.ai_proposals.base import _Ausgefuehrt, _AusfuehrungsRahmen
from services.ai_redaction import redact_sensitive_text
from services.shop_catalog_service import ShopConfigurationError


_MAX_BATCH_PLANS = 100
_SLUG_CLEAN_RE = re.compile(r"[^a-z0-9]+")

_PLAN_ITEM_FELDER = frozenset(
    {
        "plan_id",
        "game_type",
        "name",
        "description",
        "price_cents",
        "currency",
        "billing_interval",
        "tax_rate_percent",
        "ram_included_mb",
        "ram_max_mb",
        "ram_step_mb",
        "price_per_ram_step_cents",
        "cpu_included",
        "cpu_max",
        "cpu_step",
        "price_per_cpu_step_cents",
        "slots_included",
        "slots_max",
        "slots_step",
        "price_per_slot_step_cents",
        "node_id",
        "role_id",
        "artwork_mode",
        "active",
        "sort_order",
    }
)

_COUPON_FELDER = frozenset(
    {
        "coupon_id",
        "code",
        "name",
        "promo_text",
        "discount_type",
        "discount_value",
        "scope",
        "target_plan_ids",
        "min_gross_cents",
        "max_redemptions",
        "valid_from",
        "valid_until",
        "show_badge",
        "show_banner",
        "banner_cooldown_hours",
        "active",
    }
)

_ADDON_FELDER = frozenset(
    {
        "addon_id",
        "slug",
        "name",
        "description",
        "category",
        "price_cents",
        "tax_rate_percent",
        "extra_slots",
        "extra_storage_mb",
        "extra_backups",
        "extra_ai_tokens",
        "role_id",
        "active",
        "sort_order",
    }
)


def _require_shop_manage(db: Session, user: User) -> None:
    if not permission_service.has_global_permission(db, user, "ai.shop.manage"):
        raise AiActionValidationError(
            "Shop-Verwaltung ueber die KI erfordert die Berechtigung ai.shop.manage"
        )


def _int_oder_none(wert: object, *, feld: str) -> int | None:
    if wert is None or (isinstance(wert, str) and not wert.strip()):
        return None
    if isinstance(wert, bool):
        raise AiActionValidationError(f"'{feld}' darf kein Wahrheitswert sein")
    try:
        return int(wert)
    except (TypeError, ValueError):
        raise AiActionValidationError(f"'{feld}' muss eine ganze Zahl sein") from None


def _iso_oder_none(wert: object, *, feld: str) -> datetime | None:
    if wert is None or (isinstance(wert, str) and not wert.strip()):
        return None
    try:
        parsed = datetime.fromisoformat(str(wert).strip().replace("Z", "+00:00"))
    except ValueError:
        raise AiActionValidationError(
            f"'{feld}' ist kein gueltiger ISO-8601-Zeitpunkt"
        ) from None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def _slugify_name(name: str) -> str:
    slug = _SLUG_CLEAN_RE.sub("-", name.strip().lower()).strip("-")[:64]
    if len(slug) < 2:
        raise AiActionValidationError(
            "Bitte einen gueltigen Slug (mindestens 2 Zeichen) angeben"
        )
    return slug


def _validation_error_text(exc: ValidationError) -> str:
    first = exc.errors()[0] if exc.errors() else None
    if not first:
        return "Ungueltige Shop-Argumente"
    loc = ".".join(str(p) for p in first.get("loc", ()))
    msg = first.get("msg", "ungueltig")
    return f"{loc}: {msg}" if loc else str(msg)


def _clamp_slots(val: int | None, *, minimum: int, maximum: int, feld: str) -> int | None:
    if val is None:
        return None
    if val < 0:
        raise AiActionValidationError(f"'{feld}' darf nicht negativ sein")
    return max(minimum, min(maximum, val))


def _normalize_single_plan(db: Session, raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    from games import get_plugin

    unknown = set(raw) - _PLAN_ITEM_FELDER
    if unknown:
        raise AiActionValidationError(
            f"Unbekannte Tarif-Felder: {', '.join(sorted(unknown))}"
        )

    plan_id = _int_oder_none(raw.get("plan_id"), feld="plan_id")
    existing: ShopPlan | None = None
    if plan_id is not None:
        existing = shop_catalog_service.get_plan(db, plan_id)
        if existing is None:
            raise AiActionValidationError(f"Tarif {plan_id} existiert nicht")

    game_type = (
        str(raw["game_type"]).strip()
        if raw.get("game_type") is not None
        else (existing.game_type if existing is not None else "")
    )
    if not game_type:
        raise AiActionValidationError("Jeder Tarif benoetigt game_type")

    plugin = get_plugin(game_type)
    if plugin is None:
        raise AiActionValidationError(f"Unbekannter Blueprint/Spieltyp: '{game_type}'")
    blueprint = plugin.get_blueprint()
    has_steam_artwork = wallpaper_service.artwork_app_id_for_blueprint(blueprint) is not None
    players = getattr(blueprint, "players", None)

    if "name" in raw:
        if raw["name"] is None or not str(raw["name"]).strip():
            raise AiActionValidationError("Der Tarifname darf nicht leer sein")
        name = redact_sensitive_text(str(raw["name"]).strip())[:128]
    elif existing is not None:
        name = existing.name
    else:
        raise AiActionValidationError("Ein neuer Tarif benoetigt einen Namen")

    if existing is None:
        matched = (
            db.query(ShopPlan)
            .filter(ShopPlan.game_type == game_type, ShopPlan.name == name)
            .first()
        )
        if matched is not None:
            existing = matched
            plan_id = matched.id

    fields: dict[str, Any] = {}
    if plan_id is None or "game_type" in raw:
        fields["game_type"] = game_type
    if plan_id is None or "name" in raw:
        fields["name"] = name

    if "description" in raw:
        desc = str(raw["description"]).strip() if raw["description"] is not None else None
        fields["description"] = redact_sensitive_text(desc)[:4096] if desc else None

    if "price_cents" in raw:
        price = _int_oder_none(raw["price_cents"], feld="price_cents")
        if price is None or price < 0:
            raise AiActionValidationError("price_cents muss >= 0 sein")
        fields["price_cents"] = price
    elif existing is None:
        raise AiActionValidationError("Ein neuer Tarif benoetigt price_cents")

    int_fields = (
        "tax_rate_percent",
        "ram_included_mb",
        "ram_max_mb",
        "ram_step_mb",
        "price_per_ram_step_cents",
        "cpu_included",
        "cpu_max",
        "cpu_step",
        "price_per_cpu_step_cents",
        "slots_step",
        "price_per_slot_step_cents",
        "node_id",
        "role_id",
        "sort_order",
    )
    for key in int_fields:
        if key in raw:
            val = _int_oder_none(raw[key], feld=key)
            if key == "ram_step_mb" and val == 0:
                val = None
            elif key in ("cpu_step", "slots_step") and val == 0:
                val = 1
            if val is not None or key in shop_catalog_service._NULLABLE_FIELDS:
                fields[key] = val

    if "currency" in raw and raw["currency"] is not None:
        currency = str(raw["currency"]).strip().upper()
        if currency != "EUR":
            raise AiActionValidationError("Aktuell wird nur EUR unterstuetzt")
        fields["currency"] = currency
    if "billing_interval" in raw and raw["billing_interval"] is not None:
        interval = str(raw["billing_interval"]).strip()
        if interval != "month":
            raise AiActionValidationError("billing_interval muss 'month' sein")
        fields["billing_interval"] = interval

    # Artwork: automatisch Steam waehlen, wenn der Blueprint eine Steam-AppID liefert.
    if "artwork_mode" in raw and raw["artwork_mode"] is not None:
        requested_art = str(raw["artwork_mode"]).strip()
        if requested_art not in ("steam", "custom", "none"):
            raise AiActionValidationError("artwork_mode muss steam, custom oder none sein")
        if requested_art == "steam" and not has_steam_artwork:
            fields["artwork_mode"] = "none"
        else:
            fields["artwork_mode"] = requested_art
    elif existing is None:
        fields["artwork_mode"] = "steam" if has_steam_artwork else "none"

    # Spieler-Slots sicher gegen den Blueprint abgleichen.
    if players is None:
        for slot_field in ("slots_included", "slots_max"):
            if slot_field in raw or (existing is not None and getattr(existing, slot_field) is not None):
                fields[slot_field] = None
        if "price_per_slot_step_cents" in fields or existing is None:
            fields["price_per_slot_step_cents"] = 0
    else:
        for slot_field in ("slots_included", "slots_max"):
            if slot_field in raw:
                parsed = _int_oder_none(raw[slot_field], feld=slot_field)
                fields[slot_field] = _clamp_slots(
                    parsed, minimum=players.min, maximum=players.max, feld=slot_field
                )
        eff_inc = fields.get(
            "slots_included", existing.slots_included if existing is not None else None
        )
        eff_max = fields.get(
            "slots_max", existing.slots_max if existing is not None else None
        )
        if eff_inc is not None and eff_max is not None and eff_max < eff_inc:
            fields["slots_max"] = eff_inc

    if "active" in raw and raw["active"] is not None:
        fields["active"] = bool(raw["active"])

    # Pydantic- & Katalog-Vorabpruefung vor Erzeugung der Vorschlagskarte.
    try:
        if existing is None:
            schema_obj = ShopPlanWrite(**fields)
            validated_values = schema_obj.model_dump()
        else:
            schema_obj = ShopPlanUpdate(**fields)
            validated_values = {
                k: v
                for k, v in schema_obj.model_dump(exclude_unset=True).items()
                if v is not None or k in shop_catalog_service._NULLABLE_FIELDS
            }
        shop_catalog_service._validate_plan_values(db, validated_values, existing_plan=existing)
    except ValidationError as exc:
        raise AiActionValidationError(_validation_error_text(exc)) from None
    except ShopConfigurationError as exc:
        raise AiActionValidationError(str(exc)) from None

    norm_item = {
        "op": "update" if existing is not None else "create",
        "plan_id": existing.id if existing is not None else None,
        "fields": fields,
    }
    preview_item = {
        "op": norm_item["op"],
        "plan_id": norm_item["plan_id"],
        "game_type": game_type,
        "name": name,
        "price_cents": fields.get(
            "price_cents", existing.price_cents if existing is not None else 0
        ),
        "artwork_mode": fields.get(
            "artwork_mode",
            existing.artwork_mode if existing is not None else ("steam" if has_steam_artwork else "none"),
        ),
    }
    return norm_item, preview_item


def _shop_plan_upsert_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    _require_shop_manage(db, user)

    if "plans" in rest:
        andere = set(rest) - {"plans"}
        if andere:
            raise AiActionValidationError(
                "Bei Verwendung von 'plans' duerfen keine Einzeltarif-Felder auf oberster Ebene stehen"
            )
        raw_list = rest["plans"]
        if not isinstance(raw_list, list) or not (1 <= len(raw_list) <= _MAX_BATCH_PLANS):
            raise AiActionValidationError(
                f"'plans' muss zwischen 1 und {_MAX_BATCH_PLANS} Tarife enthalten"
            )
    else:
        if not rest:
            raise AiActionValidationError("Mindestens ein Tarif oder 'plans' muss angegeben werden")
        raw_list = [rest]

    items: list[dict[str, Any]] = []
    preview_items: list[dict[str, Any]] = []
    seen_targets: set[tuple[str, str]] = set()

    for idx, entry in enumerate(raw_list):
        if not isinstance(entry, dict):
            raise AiActionValidationError(f"Tarif #{idx + 1} muss ein Objekt sein")
        norm, prev = _normalize_single_plan(db, entry)
        target_key = (prev["game_type"], prev["name"].lower())
        if target_key in seen_targets:
            raise AiActionValidationError(
                f"Doppelter Tarif im Vorschlag: {prev['game_type']} / {prev['name']}"
            )
        seen_targets.add(target_key)
        items.append(norm)
        preview_items.append(prev)

    if len(preview_items) == 1:
        p0 = preview_items[0]
        aktion = "aktualisieren" if p0["op"] == "update" else "anlegen"
        summary = f"Shop-Tarif „{p0['name']}“ ({p0['game_type']}) {aktion} ({p0['price_cents'] / 100:.2f} €)"
    else:
        summary = f"{len(preview_items)} Shop-Tarife anlegen bzw. aktualisieren"

    return (
        {"items": items},
        {
            "operation": "shop_plan_upsert",
            "summary": summary,
            "count": len(preview_items),
            "items": preview_items,
        },
    )


def _ausfuehren_shop_plan_upsert(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    _require_shop_manage(db, rahmen.active_user)
    items = rahmen.payload.get("items") or []
    if not isinstance(items, list) or not items:
        raise AiActionValidationError("Leere Tarif-Nutzlast")

    ergebnisse: list[dict[str, Any]] = []
    try:
        for eintrag in items:
            plan_id = eintrag.get("plan_id")
            fields = dict(eintrag.get("fields") or {})
            if plan_id is not None:
                plan = shop_catalog_service.get_plan(db, int(plan_id))
                if plan is None:
                    raise AiActionValidationError(
                        f"Tarif {plan_id} wurde zwischenzeitlich geloescht"
                    )
                saved = shop_catalog_service.update_plan(
                    db,
                    plan,
                    ShopPlanUpdate(**fields),
                    actor_id=rahmen.active_user.id,
                )
                op = "updated"
            else:
                saved = shop_catalog_service.create_plan(
                    db,
                    ShopPlanWrite(**fields),
                    actor_id=rahmen.active_user.id,
                )
                op = "created"
            ergebnisse.append(
                {
                    "op": op,
                    "plan_id": saved.id,
                    "game_type": saved.game_type,
                    "name": saved.name,
                    "price_cents": saved.price_cents,
                    "artwork_mode": saved.artwork_mode,
                    "active": saved.active,
                }
            )
    except (ValidationError, ShopConfigurationError) as exc:
        raise AiActionValidationError(str(exc)) from None

    return _Ausgefuehrt(result={"count": len(ergebnisse), "plans": ergebnisse})


def _shop_coupon_upsert_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    _require_shop_manage(db, user)
    unknown = set(rest) - _COUPON_FELDER
    if unknown:
        raise AiActionValidationError(
            f"Unbekannte Gutschein-Felder: {', '.join(sorted(unknown))}"
        )

    coupon_id = _int_oder_none(rest.get("coupon_id"), feld="coupon_id")
    existing: ShopCoupon | None = None
    if coupon_id is not None:
        existing = shop_coupon_service.get_coupon(db, coupon_id)
        if existing is None:
            raise AiActionValidationError(f"Gutschein {coupon_id} existiert nicht")

    fields: dict[str, Any] = {}
    if "code" in rest and rest["code"] is not None:
        try:
            normalized_code = shop_coupon_service.normalize_coupon_code(str(rest["code"]))
        except ShopConfigurationError as exc:
            raise AiActionValidationError(str(exc)) from None
        fields["code"] = normalized_code
        if existing is None:
            matched = db.query(ShopCoupon).filter(ShopCoupon.code == normalized_code).first()
            if matched is not None:
                existing = matched
                coupon_id = matched.id
    elif existing is None:
        raise AiActionValidationError("Ein neuer Gutschein benoetigt einen code")

    if "name" in rest:
        if rest["name"] is None or not str(rest["name"]).strip():
            raise AiActionValidationError("Bezeichnung (name) darf nicht leer sein")
        fields["name"] = redact_sensitive_text(str(rest["name"]).strip())[:128]
    elif existing is None:
        raise AiActionValidationError("Ein neuer Gutschein benoetigt name")

    if "promo_text" in rest:
        txt = str(rest["promo_text"]).strip() if rest["promo_text"] is not None else None
        fields["promo_text"] = redact_sensitive_text(txt)[:240] if txt else None

    if "discount_type" in rest and rest["discount_type"] is not None:
        fields["discount_type"] = str(rest["discount_type"]).strip()
    if "discount_value" in rest:
        val = _int_oder_none(rest["discount_value"], feld="discount_value")
        if val is None or val < 1:
            raise AiActionValidationError("discount_value muss >= 1 sein")
        fields["discount_value"] = val
    elif existing is None:
        raise AiActionValidationError("Ein neuer Gutschein benoetigt discount_value")

    if "scope" in rest and rest["scope"] is not None:
        fields["scope"] = str(rest["scope"]).strip()
    if "target_plan_ids" in rest:
        raw_ids = rest["target_plan_ids"]
        if raw_ids is not None:
            if not isinstance(raw_ids, list):
                raise AiActionValidationError("target_plan_ids muss eine Liste sein")
            fields["target_plan_ids"] = [
                int(pid) for pid in raw_ids if _int_oder_none(pid, feld="target_plan_ids") is not None
            ]

    for key in ("min_gross_cents", "max_redemptions", "banner_cooldown_hours"):
        if key in rest:
            val = _int_oder_none(rest[key], feld=key)
            if val is not None or key == "max_redemptions":
                fields[key] = val

    for dt_field in ("valid_from", "valid_until"):
        if dt_field in rest:
            parsed = _iso_oder_none(rest[dt_field], feld=dt_field)
            fields[dt_field] = parsed.isoformat() if parsed is not None else None

    for bool_field in ("show_badge", "show_banner", "active"):
        if bool_field in rest and rest[bool_field] is not None:
            fields[bool_field] = bool(rest[bool_field])

    if existing is not None and not fields:
        raise AiActionValidationError("Es wurde kein zu aenderndes Feld genannt")

    try:
        if existing is None:
            schema_obj = ShopCouponWrite(**fields)
            val_dict = schema_obj.model_dump()
        else:
            schema_obj = ShopCouponUpdate(**fields)
            val_dict = {
                k: v
                for k, v in schema_obj.model_dump(exclude_unset=True).items()
                if v is not None or k in shop_coupon_service._NULLABLE_FIELDS
            }
        shop_coupon_service._validate_coupon_values(db, val_dict, existing=existing)
    except ValidationError as exc:
        raise AiActionValidationError(_validation_error_text(exc)) from None
    except ShopConfigurationError as exc:
        raise AiActionValidationError(str(exc)) from None

    eff_code = fields.get("code", existing.code if existing is not None else "")
    eff_type = fields.get("discount_type", existing.discount_type if existing is not None else "percent")
    eff_val = fields.get("discount_value", existing.discount_value if existing is not None else 0)
    rabatt_str = f"-{eff_val} %" if eff_type == "percent" else f"-{eff_val / 100:.2f} €"
    op = "update" if existing is not None else "create"
    aktion = "aktualisieren" if op == "update" else "anlegen"

    return (
        {"coupon_id": existing.id if existing is not None else None, "fields": fields},
        {
            "operation": "shop_coupon_upsert",
            "op": op,
            "coupon_id": existing.id if existing is not None else None,
            "code": eff_code,
            "discount": rabatt_str,
            "summary": f"Gutschein {eff_code} ({rabatt_str}) {aktion}",
        },
    )


def _ausfuehren_shop_coupon_upsert(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    _require_shop_manage(db, rahmen.active_user)
    coupon_id = rahmen.payload.get("coupon_id")
    fields = dict(rahmen.payload.get("fields") or {})
    try:
        if coupon_id is not None:
            coupon = shop_coupon_service.get_coupon(db, int(coupon_id))
            if coupon is None:
                raise AiActionValidationError(
                    f"Gutschein {coupon_id} wurde zwischenzeitlich geloescht"
                )
            saved = shop_coupon_service.update_coupon(
                db,
                coupon,
                ShopCouponUpdate(**fields),
                actor_id=rahmen.active_user.id,
            )
            op = "updated"
        else:
            saved = shop_coupon_service.create_coupon(
                db,
                ShopCouponWrite(**fields),
                actor_id=rahmen.active_user.id,
            )
            op = "created"
    except (ValidationError, ShopConfigurationError) as exc:
        raise AiActionValidationError(str(exc)) from None

    return _Ausgefuehrt(
        result={
            "op": op,
            "coupon_id": saved.id,
            "code": saved.code,
            "discount_type": saved.discount_type,
            "discount_value": saved.discount_value,
            "active": saved.active,
        }
    )


def _shop_addon_upsert_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    _require_shop_manage(db, user)
    unknown = set(rest) - _ADDON_FELDER
    if unknown:
        raise AiActionValidationError(
            f"Unbekannte Add-on-Felder: {', '.join(sorted(unknown))}"
        )

    addon_id = _int_oder_none(rest.get("addon_id"), feld="addon_id")
    existing: ShopAddon | None = None
    if addon_id is not None:
        existing = shop_addon_service.get_addon(db, addon_id)
        if existing is None:
            raise AiActionValidationError(f"Add-on {addon_id} existiert nicht")

    fields: dict[str, Any] = {}
    if "name" in rest:
        if rest["name"] is None or not str(rest["name"]).strip():
            raise AiActionValidationError("Add-on-Name darf nicht leer sein")
        fields["name"] = redact_sensitive_text(str(rest["name"]).strip())[:128]
    elif existing is None:
        raise AiActionValidationError("Ein neues Add-on benoetigt einen Namen")

    if "slug" in rest and rest["slug"] is not None:
        fields["slug"] = str(rest["slug"]).strip().lower()
    elif existing is None:
        fields["slug"] = _slugify_name(fields["name"])

    if existing is None and "slug" in fields:
        matched = db.query(ShopAddon).filter(ShopAddon.slug == fields["slug"]).first()
        if matched is not None:
            existing = matched
            addon_id = matched.id

    if "description" in rest:
        desc = str(rest["description"]).strip() if rest["description"] is not None else None
        fields["description"] = redact_sensitive_text(desc)[:4096] if desc else None

    if "category" in rest and rest["category"] is not None:
        fields["category"] = str(rest["category"]).strip()
    elif existing is None:
        raise AiActionValidationError("Ein neues Add-on benoetigt category")

    if "price_cents" in rest:
        price = _int_oder_none(rest["price_cents"], feld="price_cents")
        if price is None or price < 0:
            raise AiActionValidationError("price_cents muss >= 0 sein")
        fields["price_cents"] = price
    elif existing is None:
        raise AiActionValidationError("Ein neues Add-on benoetigt price_cents")

    for key in (
        "tax_rate_percent",
        "extra_slots",
        "extra_storage_mb",
        "extra_backups",
        "extra_ai_tokens",
        "role_id",
        "sort_order",
    ):
        if key in rest:
            val = _int_oder_none(rest[key], feld=key)
            if val is not None or key in shop_addon_service._NULLABLE_FIELDS:
                fields[key] = val

    if "active" in rest and rest["active"] is not None:
        fields["active"] = bool(rest["active"])

    if existing is not None and not fields:
        raise AiActionValidationError("Es wurde kein zu aenderndes Feld genannt")

    try:
        if existing is None:
            schema_obj = ShopAddonWrite(**fields)
            val_dict = schema_obj.model_dump()
        else:
            schema_obj = ShopAddonUpdate(**fields)
            val_dict = {
                k: v
                for k, v in schema_obj.model_dump(exclude_unset=True).items()
                if v is not None or k in shop_addon_service._NULLABLE_FIELDS
            }
        shop_addon_service._validate_addon_values(db, val_dict, existing_addon=existing)
    except ValidationError as exc:
        raise AiActionValidationError(_validation_error_text(exc)) from None
    except ShopConfigurationError as exc:
        raise AiActionValidationError(str(exc)) from None

    eff_name = fields.get("name", existing.name if existing is not None else "")
    eff_price = fields.get("price_cents", existing.price_cents if existing is not None else 0)
    op = "update" if existing is not None else "create"
    aktion = "aktualisieren" if op == "update" else "anlegen"

    return (
        {"addon_id": existing.id if existing is not None else None, "fields": fields},
        {
            "operation": "shop_addon_upsert",
            "op": op,
            "addon_id": existing.id if existing is not None else None,
            "slug": fields.get("slug", existing.slug if existing is not None else ""),
            "name": eff_name,
            "price_cents": eff_price,
            "summary": f"Add-on „{eff_name}“ {aktion} ({eff_price / 100:.2f} €)",
        },
    )


def _ausfuehren_shop_addon_upsert(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    _require_shop_manage(db, rahmen.active_user)
    addon_id = rahmen.payload.get("addon_id")
    fields = dict(rahmen.payload.get("fields") or {})
    try:
        if addon_id is not None:
            addon = shop_addon_service.get_addon(db, int(addon_id))
            if addon is None:
                raise AiActionValidationError(
                    f"Add-on {addon_id} wurde zwischenzeitlich geloescht"
                )
            saved = shop_addon_service.update_addon(
                db,
                addon,
                ShopAddonUpdate(**fields),
                actor_id=rahmen.active_user.id,
            )
            op = "updated"
        else:
            saved = shop_addon_service.create_addon(
                db,
                ShopAddonWrite(**fields),
                actor_id=rahmen.active_user.id,
            )
            op = "created"
    except (ValidationError, ShopConfigurationError) as exc:
        raise AiActionValidationError(str(exc)) from None

    return _Ausgefuehrt(
        result={
            "op": op,
            "addon_id": saved.id,
            "slug": saved.slug,
            "name": saved.name,
            "category": saved.category,
            "price_cents": saved.price_cents,
            "active": saved.active,
        }
    )
