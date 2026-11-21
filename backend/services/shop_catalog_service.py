"""Katalog-Dienst des nativen Shops: Plaene, Preise und Artwork.

Der Dienst validiert gegen Blueprint-Registry, Nodes und Rollen. Bilder werden
nicht kopiert: Der bestehende ``wallpaper_service`` bleibt die einzige Quelle
fuer Custom-Galerie und Steam-Artwork.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import Node, Role, ShopPlan
from schemas.shop import (
    ShopArtworkResponse,
    ShopCatalogPlan,
    ShopPlanResponse,
    ShopPlanUpdate,
    ShopPlanWrite,
)
from services import audit_service, wallpaper_service


_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


class ShopConfigurationError(ValueError):
    """Ungueltige Tarif-Konfiguration; wird am Rand zu 422."""


def _validate_plan_values(
    db: Session, values: dict[str, Any], *, existing_plan: ShopPlan | None = None
) -> None:
    game_type = values.get("game_type")
    if game_type is None and existing_plan is not None:
        game_type = existing_plan.game_type

    blueprint = None
    if game_type is not None:
        from games import get_plugin

        plugin = get_plugin(game_type)
        if plugin is None:
            raise ShopConfigurationError("Unbekannter Blueprint bzw. Spieltyp")
        blueprint = plugin.get_blueprint()

    currency = values.get("currency")
    if currency is not None:
        if not _CURRENCY_RE.fullmatch(currency):
            raise ShopConfigurationError("Waehrung muss ein dreistelliger ISO-Code sein")
        if currency != "EUR":
            raise ShopConfigurationError("Aktuell wird nur EUR unterstuetzt")

    node_id = values.get("node_id")
    if node_id is not None and db.query(Node).filter(Node.id == node_id).first() is None:
        raise ShopConfigurationError("Zugeordnete Node existiert nicht")

    role_id = values.get("role_id")
    if role_id is not None:
        from services import shop_fulfillment_service

        try:
            shop_fulfillment_service.ensure_shop_role_allowed(db, role_id)
        except shop_fulfillment_service.ShopRoleEscalationError as exc:
            raise ShopConfigurationError(str(exc)) from exc

    def _eff(feld: str) -> Any:
        if feld in values:
            return values[feld]
        return getattr(existing_plan, feld, None) if existing_plan is not None else None

    for included_key, max_key, label in (
        ("ram_included_mb", "ram_max_mb", "RAM"),
        ("cpu_included", "cpu_max", "CPU"),
        ("slots_included", "slots_max", "Slots"),
    ):
        included = _eff(included_key)
        maximum = _eff(max_key)
        if included is not None and maximum is not None and maximum < included:
            raise ShopConfigurationError(
                f"Das Maximum fuer {label} darf nicht unter dem enthaltenen Wert liegen"
            )

    if blueprint is not None:
        slots_included = _eff("slots_included")
        slots_max = _eff("slots_max")
        slot_step_price = _eff("price_per_slot_step_cents") or 0
        players = getattr(blueprint, "players", None)
        if players is None:
            if slot_step_price > 0 or slots_included is not None or slots_max is not None:
                raise ShopConfigurationError(
                    "Dieser Blueprint unterstuetzt keine konfigurierbaren Spieler-Slots"
                )
        else:
            for val in (slots_included, slots_max):
                if val is not None and not (players.min <= int(val) <= players.max):
                    raise ShopConfigurationError(
                        f"Spieler-Slots muessen zwischen {players.min} und {players.max} liegen"
                    )


def _apply(plan: ShopPlan, values: dict[str, Any]) -> None:
    for feld, wert in values.items():
        setattr(plan, feld, wert)


def _audit(db: Session, actor_id: int, action: str, plan: ShopPlan, extra: dict | None = None) -> None:
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action=action,
        target_type="shop_plan",
        target_id=plan.id,
        details={
            "game_type": plan.game_type,
            "name": plan.name,
            "price_cents": plan.price_cents,
            "active": plan.active,
            **(extra or {}),
        },
    )


def list_plans(db: Session, *, active_only: bool = False) -> list[ShopPlan]:
    query = db.query(ShopPlan)
    if active_only:
        query = query.filter(ShopPlan.active.is_(True))
    return query.order_by(ShopPlan.sort_order.asc(), ShopPlan.name.asc()).all()


def get_plan(db: Session, plan_id: int) -> ShopPlan | None:
    return db.query(ShopPlan).filter(ShopPlan.id == plan_id).first()


def create_plan(db: Session, payload: ShopPlanWrite, *, actor_id: int) -> ShopPlan:
    values = payload.model_dump()
    _validate_plan_values(db, values)
    plan = ShopPlan(**values)
    db.add(plan)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError(
            "Ein Tarif mit diesem Namen existiert fuer dieses Spiel bereits"
        ) from exc
    _audit(db, actor_id, "shop.plan.created", plan)
    db.commit()
    db.refresh(plan)
    return plan


_NULLABLE_FIELDS = {
    "description",
    "ram_included_mb",
    "ram_max_mb",
    "ram_step_mb",
    "cpu_included",
    "cpu_max",
    "slots_included",
    "slots_max",
    "node_id",
    "role_id",
}


def update_plan(
    db: Session, plan: ShopPlan, payload: ShopPlanUpdate, *, actor_id: int
) -> ShopPlan:
    rohe = payload.model_dump(exclude_unset=True)
    # Explizites JSON-null darf nur nullable Felder leeren; ein null fuer
    # price_cents/active/... waere sonst ein Datenbankfehler statt einer Absage.
    values = {
        feld: wert
        for feld, wert in rohe.items()
        if wert is not None or feld in _NULLABLE_FIELDS
    }
    _validate_plan_values(db, values, existing_plan=plan)
    _apply(plan, values)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError(
            "Ein Tarif mit diesem Namen existiert fuer dieses Spiel bereits"
        ) from exc
    _audit(db, actor_id, "shop.plan.updated", plan)
    db.commit()
    db.refresh(plan)
    return plan


def delete_plan(db: Session, plan: ShopPlan, *, actor_id: int) -> None:
    _audit(db, actor_id, "shop.plan.deleted", plan)
    db.delete(plan)
    db.commit()


def upload_plan_artwork(
    db: Session,
    plan: ShopPlan,
    *,
    raw_bytes: bytes,
    uploaded_by: str,
    actor_id: int,
) -> ShopPlan:
    """Nimmt ein eigenes Spielbild auf und setzt den Plan auf ``custom``.

    Die Bytes laufen durch dieselbe Sanitisierung und Galerie wie die
    Server-Titelbilder. Es entsteht keine zweite Upload-Ablage.
    """
    webp = wallpaper_service.sanitize_and_compress_wallpaper(raw_bytes)
    zeile = wallpaper_service.store_wallpaper(
        db, plan.game_type, webp, uploaded_by
    )
    plan.artwork_mode = "custom"
    _audit(
        db,
        actor_id,
        "shop.plan.artwork.uploaded",
        plan,
        {"wallpaper_id": zeile.id},
    )
    db.commit()
    db.refresh(plan)
    return plan


def reset_plan_artwork(db: Session, plan: ShopPlan, *, actor_id: int) -> ShopPlan:
    wallpaper_service.reset_wallpaper(db, plan.game_type)
    plan.artwork_mode = "steam"
    _audit(db, actor_id, "shop.plan.artwork.reset", plan)
    db.commit()
    db.refresh(plan)
    return plan


def _artwork(db: Session, plan: ShopPlan) -> ShopArtworkResponse:
    descriptor = wallpaper_service.resolve_plan_artwork(
        db,
        plan.game_type,
        plan.artwork_mode,
        base_url=f"/api/shop/artwork/{plan.game_type}",
    )
    return ShopArtworkResponse(
        source=descriptor.source, url=descriptor.url, version=descriptor.version
    )


def plan_response(db: Session, plan: ShopPlan) -> ShopPlanResponse:
    return ShopPlanResponse(
        id=plan.id,
        game_type=plan.game_type,
        name=plan.name,
        description=plan.description,
        price_cents=plan.price_cents,
        currency=plan.currency,
        billing_interval=plan.billing_interval,
        tax_rate_percent=plan.tax_rate_percent,
        ram_included_mb=plan.ram_included_mb,
        ram_max_mb=plan.ram_max_mb,
        ram_step_mb=plan.ram_step_mb,
        price_per_ram_step_cents=plan.price_per_ram_step_cents,
        cpu_included=plan.cpu_included,
        cpu_max=plan.cpu_max,
        cpu_step=plan.cpu_step,
        price_per_cpu_step_cents=plan.price_per_cpu_step_cents,
        slots_included=plan.slots_included,
        slots_max=plan.slots_max,
        slots_step=plan.slots_step,
        price_per_slot_step_cents=plan.price_per_slot_step_cents,
        node_id=plan.node_id,
        role_id=plan.role_id,
        artwork_mode=plan.artwork_mode,
        active=plan.active,
        sort_order=plan.sort_order,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        artwork=_artwork(db, plan),
    )


def _game_meta(game_type: str) -> dict[str, Any]:
    from games import get_plugin

    plugin = get_plugin(game_type)
    if plugin is None:
        return {}
    blueprint = plugin.get_blueprint()
    mods = blueprint.effective_mods()
    return {
        "game_name": blueprint.meta.name,
        "game_description": blueprint.meta.description,
        "game_category": blueprint.meta.category.value,
        "supports_mods": bool(mods.supportsMods),
        "supports_workshop": bool(mods.supportsSteamWorkshop),
        "supports_slots": getattr(blueprint, "players", None) is not None,
    }


def catalog_plan(db: Session, plan: ShopPlan) -> ShopCatalogPlan:
    meta = _game_meta(plan.game_type)
    return ShopCatalogPlan(
        id=plan.id,
        game_type=plan.game_type,
        game_name=meta.get("game_name") or plan.game_type,
        game_description=meta.get("game_description"),
        game_category=meta.get("game_category") or "",
        supports_mods=bool(meta.get("supports_mods")),
        supports_workshop=bool(meta.get("supports_workshop")),
        supports_slots=bool(meta.get("supports_slots")),
        name=plan.name,
        description=plan.description,
        price_cents=plan.price_cents,
        currency=plan.currency,
        billing_interval=plan.billing_interval,
        tax_rate_percent=plan.tax_rate_percent,
        ram_included_mb=plan.ram_included_mb,
        ram_max_mb=plan.ram_max_mb,
        ram_step_mb=plan.ram_step_mb,
        price_per_ram_step_cents=plan.price_per_ram_step_cents,
        cpu_included=plan.cpu_included,
        cpu_max=plan.cpu_max,
        cpu_step=plan.cpu_step,
        price_per_cpu_step_cents=plan.price_per_cpu_step_cents,
        slots_included=plan.slots_included,
        slots_max=plan.slots_max,
        slots_step=plan.slots_step,
        price_per_slot_step_cents=plan.price_per_slot_step_cents,
        artwork=_artwork(db, plan),
    )
