"""Dienst fuer eigenstaendige Shop-Add-ons ohne Serverbindung."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import ShopAddon, ShopEntitlement, ShopOrderItem, ShopSubscription, User
from schemas.shop import (
    ShopAddonResponse,
    ShopAddonSwitchResponse,
    ShopAddonUpdate,
    ShopAddonWrite,
    ShopCatalogAddon,
)
from services import audit_service, shop_fulfillment_service, shop_order_service
from services.shop_catalog_service import ShopConfigurationError


_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_NULLABLE_FIELDS = frozenset(
    {
        "description",
        "extra_slots",
        "extra_storage_mb",
        "extra_backups",
        "extra_ai_tokens",
        "role_id",
    }
)


class ShopAddonNotFoundError(LookupError):
    """Add-on oder Abo existiert nicht (wird am Rand zu 404)."""


class ShopAddonSwitchError(ValueError):
    """Abo-Wechsel nicht erlaubt oder fachlich ungueltig (wird zu 422/409)."""


def _validate_addon_values(
    db: Session,
    values: dict[str, Any],
    *,
    existing_addon: ShopAddon | None = None,
) -> None:
    slug = values.get("slug")
    if slug is not None:
        normalized = slug.strip()
        if not _SLUG_RE.fullmatch(normalized):
            raise ShopConfigurationError(
                "Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten"
            )
        values["slug"] = normalized

    currency = values.get("currency")
    if currency is not None:
        if not _CURRENCY_RE.fullmatch(currency):
            raise ShopConfigurationError("Waehrung muss ein dreistelliger ISO-Code sein")
        if currency != "EUR":
            raise ShopConfigurationError("Aktuell wird nur EUR unterstuetzt")

    role_id = values.get("role_id")
    if role_id is not None:
        try:
            shop_fulfillment_service.ensure_shop_role_allowed(db, role_id)
        except shop_fulfillment_service.ShopRoleEscalationError as exc:
            raise ShopConfigurationError(str(exc)) from exc

    def _eff(field: str) -> Any:
        if field in values:
            return values[field]
        return getattr(existing_addon, field, None) if existing_addon is not None else None

    category = _eff("category")
    extra_slots = _eff("extra_slots") or 0
    extra_storage_mb = _eff("extra_storage_mb") or 0
    extra_backups = _eff("extra_backups") or 0
    extra_ai_tokens = _eff("extra_ai_tokens") or 0
    effective_role_id = _eff("role_id")

    has_any_effect = any(
        (
            extra_slots > 0,
            extra_storage_mb > 0,
            extra_backups > 0,
            extra_ai_tokens > 0,
            effective_role_id is not None,
        )
    )
    if not has_any_effect:
        raise ShopConfigurationError(
            "Add-on muss mindestens ein Kontingent oder eine Rolle vergeben"
        )

    category_checks = (
        ("ai_quota", extra_ai_tokens > 0, "KI-Kontingent muss groesser als 0 sein"),
        ("slots", extra_slots > 0, "Extra-Slots muessen groesser als 0 sein"),
        ("backups", extra_backups > 0, "Extra-Backups muessen groesser als 0 sein"),
        ("storage", extra_storage_mb > 0, "Extra-Speicher muss groesser als 0 sein"),
        ("role", effective_role_id is not None, "Rollen-Add-on benoetigt eine gueltige Rolle"),
    )
    for cat_key, ok, message in category_checks:
        if category == cat_key and not ok:
            raise ShopConfigurationError(message)


def _apply(addon: ShopAddon, values: dict[str, Any]) -> None:
    for field, value in values.items():
        setattr(addon, field, value)


def _audit(
    db: Session,
    actor_id: int,
    action: str,
    addon: ShopAddon,
    extra: dict[str, Any] | None = None,
) -> None:
    details: dict[str, Any] = {
        "addon_id": addon.id,
        "slug": addon.slug,
        "category": addon.category,
        "price_cents": addon.price_cents,
        "active": addon.active,
    }
    if extra:
        details.update(extra)
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action=action,
        target_type="shop_addon",
        target_id=addon.id,
        details=details,
    )


def list_addons(
    db: Session, *, active_only: bool = False, category: str | None = None
) -> list[ShopAddon]:
    query = db.query(ShopAddon)
    if active_only:
        query = query.filter(ShopAddon.active.is_(True))
    if category:
        query = query.filter(ShopAddon.category == category)
    return query.order_by(ShopAddon.sort_order.asc(), ShopAddon.name.asc()).all()


def get_addon(db: Session, addon_id: int) -> ShopAddon | None:
    return db.query(ShopAddon).filter(ShopAddon.id == addon_id).first()


def create_addon(
    db: Session, payload: ShopAddonWrite, *, actor_id: int
) -> ShopAddon:
    values = payload.model_dump()
    values["name"] = values["name"].strip()
    if not values["name"]:
        raise ShopConfigurationError("Name darf nicht leer sein")
    _validate_addon_values(db, values)
    addon = ShopAddon(**values)
    db.add(addon)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError("Ein Add-on mit diesem Slug existiert bereits") from exc
    _audit(db, actor_id, "shop.addon.created", addon)
    db.commit()
    db.refresh(addon)
    return addon


def update_addon(
    db: Session, addon: ShopAddon, payload: ShopAddonUpdate, *, actor_id: int
) -> ShopAddon:
    raw = payload.model_dump(exclude_unset=True)
    values = {
        field: value
        for field, value in raw.items()
        if value is not None or field in _NULLABLE_FIELDS
    }
    if "name" in values:
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise ShopConfigurationError("Name darf nicht leer sein")
    _validate_addon_values(db, values, existing_addon=addon)
    _apply(addon, values)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError("Ein Add-on mit diesem Slug existiert bereits") from exc
    _audit(db, actor_id, "shop.addon.updated", addon)
    db.commit()
    db.refresh(addon)
    return addon


def delete_addon(db: Session, addon: ShopAddon, *, actor_id: int) -> None:
    _audit(db, actor_id, "shop.addon.deleted", addon)
    db.delete(addon)
    db.commit()


def addon_response(addon: ShopAddon) -> ShopAddonResponse:
    return ShopAddonResponse(
        id=addon.id,
        slug=addon.slug,
        name=addon.name,
        description=addon.description,
        category=addon.category,  # type: ignore[arg-type]
        price_cents=addon.price_cents,
        currency=addon.currency,
        billing_interval=addon.billing_interval,
        tax_rate_percent=addon.tax_rate_percent,
        extra_slots=addon.extra_slots,
        extra_storage_mb=addon.extra_storage_mb,
        extra_backups=addon.extra_backups,
        extra_ai_tokens=addon.extra_ai_tokens,
        role_id=addon.role_id,
        active=addon.active,
        sort_order=addon.sort_order,
        created_at=addon.created_at,
        updated_at=addon.updated_at,
    )


def catalog_addon(addon: ShopAddon) -> ShopCatalogAddon:
    return ShopCatalogAddon(
        id=addon.id,
        slug=addon.slug,
        name=addon.name,
        description=addon.description,
        category=addon.category,  # type: ignore[arg-type]
        price_cents=addon.price_cents,
        currency=addon.currency,
        billing_interval=addon.billing_interval,
        tax_rate_percent=addon.tax_rate_percent,
        extra_slots=addon.extra_slots,
        extra_storage_mb=addon.extra_storage_mb,
        extra_backups=addon.extra_backups,
        extra_ai_tokens=addon.extra_ai_tokens,
        grants_role=addon.role_id is not None,
    )


def switch_addon_subscription(
    db: Session,
    user: User,
    subscription_id: int,
    target_addon_id: int,
) -> ShopAddonSwitchResponse:
    """Wechselt ein aktives Add-on-Abo auf ein anderes Add-on ohne Server-Aenderung."""
    sub = (
        db.query(ShopSubscription)
        .filter(
            ShopSubscription.id == subscription_id,
            ShopSubscription.user_id == user.id,
        )
        .first()
    )
    if sub is None:
        raise ShopAddonNotFoundError("Abo nicht gefunden")

    if sub.status != "active":
        raise ShopAddonSwitchError("Nur aktive Abos koennen gewechselt werden")
    if sub.cancel_at_period_end:
        raise ShopAddonSwitchError(
            "Zum Laufzeitende gekuendigtes Abo kann nicht mehr gewechselt werden"
        )

    item = (
        db.query(ShopOrderItem)
        .filter(ShopOrderItem.id == sub.order_item_id)
        .first()
    )
    if item is None or item.kind != "addon" or sub.plan_id is not None:
        raise ShopAddonSwitchError(
            "Nur eigenstaendige Add-on-Abos koennen ueber addon-switch gewechselt werden"
        )

    current_addon_id = sub.addon_id if sub.addon_id is not None else item.addon_id
    target = get_addon(db, target_addon_id)
    if target is None:
        raise ShopAddonNotFoundError("Ziel-Add-on nicht gefunden")
    if not target.active:
        raise ShopAddonSwitchError("Ziel-Add-on ist nicht aktiv")
    if current_addon_id == target.id:
        raise ShopAddonSwitchError("Abo verwendet dieses Add-on bereits")

    if target.role_id is not None:
        try:
            shop_fulfillment_service.ensure_shop_role_allowed(db, target.role_id)
        except shop_fulfillment_service.ShopRoleEscalationError as exc:
            raise ShopAddonSwitchError(str(exc)) from exc

    ent = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.order_item_id == sub.order_item_id,
            ShopEntitlement.kind == "addon",
        )
        .order_by(ShopEntitlement.id.asc())
        .first()
    )
    if ent is None or ent.status != "active":
        raise ShopAddonSwitchError("Aktive Add-on-Freischaltung fehlt")

    old_role_id = ent.role_id
    sub.addon_id = target.id
    sub.game_type = f"addon:{target.category}"
    sub.name = target.name
    sub.monthly_gross_cents = target.price_cents
    sub.tax_rate_percent = target.tax_rate_percent

    ent.addon_id = target.id
    ent.label = target.name
    ent.role_id = target.role_id
    ent.slots = target.extra_slots
    ent.provisioning_status = "pending"
    ent.provisioning_error = None

    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="shop.addon.switched",
        target_type="shop_subscription",
        target_id=sub.id,
        details={
            "previous_addon_id": current_addon_id,
            "new_addon_id": target.id,
            "old_role_id": old_role_id,
            "new_role_id": target.role_id,
        },
    )
    db.commit()

    shop_fulfillment_service.sync_user_roles(db, user.id, origin="direct")
    db.refresh(sub)
    db.refresh(ent)

    return ShopAddonSwitchResponse(
        subscription=shop_order_service.subscription_response(sub),
        entitlement=shop_order_service.entitlement_response(ent),
        previous_addon_id=current_addon_id,
        new_addon_id=target.id,
        role_changed=old_role_id != target.role_id,
    )
