"""Gutscheine, Aktionsbanner-Abfragen, Stripe-Sync und Shop-Umsatzstatistik."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import ShopCoupon, ShopOrder, ShopPlan, ShopSubscription
from schemas.shop import (
    ShopCouponPreviewResponse,
    ShopCouponResponse,
    ShopCouponUpdate,
    ShopCouponWrite,
    ShopPublicBadgePromo,
    ShopPublicBannerPromo,
    ShopPublicPromosResponse,
    ShopStatsResponse,
)
from services import audit_service, stripe_service
from services.shop_catalog_service import ShopConfigurationError


_CODE_RE = re.compile(r"^[A-Z0-9_-]{3,48}$")
_NULLABLE_FIELDS = frozenset(
    {
        "promo_text",
        "max_redemptions",
        "valid_from",
        "valid_until",
    }
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def normalize_coupon_code(raw: str) -> str:
    code = (raw or "").strip().upper()
    if not _CODE_RE.fullmatch(code):
        raise ShopConfigurationError(
            "Gutscheincode muss 3–48 Zeichen lang sein (A–Z, 0–9, _ oder -)"
        )
    return code


def _parse_plan_ids(raw: str | None) -> list[int]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return sorted({int(x) for x in data if int(x) > 0})
    except (ValueError, TypeError):
        pass
    return []


def _validate_coupon_values(
    db: Session,
    values: dict[str, Any],
    *,
    existing: ShopCoupon | None = None,
) -> None:
    if "code" in values:
        values["code"] = normalize_coupon_code(str(values["code"]))

    if "currency" in values and values["currency"] != "EUR":
        raise ShopConfigurationError("Aktuell wird nur EUR unterstuetzt")

    def _eff(field: str) -> Any:
        if field in values:
            return values[field]
        return getattr(existing, field, None) if existing is not None else None

    discount_type = _eff("discount_type")
    discount_value = int(_eff("discount_value") or 0)
    if discount_type == "percent" and not (1 <= discount_value <= 99):
        raise ShopConfigurationError("Prozent-Rabatt muss zwischen 1 und 99 liegen")
    if discount_type == "fixed_cents" and discount_value < 1:
        raise ShopConfigurationError("Fester Rabatt muss groesser als 0 Cent sein")

    valid_from = _as_utc(_eff("valid_from"))
    valid_until = _as_utc(_eff("valid_until"))
    if valid_from is not None and valid_until is not None and valid_until < valid_from:
        raise ShopConfigurationError("Endzeitpunkt darf nicht vor Startzeitpunkt liegen")

    if "valid_from" in values:
        values["valid_from"] = _as_utc(values["valid_from"])
    if "valid_until" in values:
        values["valid_until"] = _as_utc(values["valid_until"])

    scope = _eff("scope")
    if "target_plan_ids" in values:
        plan_ids = sorted({int(pid) for pid in values.pop("target_plan_ids") or []})
        if plan_ids:
            if scope != "plans":
                raise ShopConfigurationError(
                    "Ziel-Tarife koennen nur beim Geltungsbereich 'Tarife' gesetzt werden"
                )
            existing_ids = {
                row[0]
                for row in db.query(ShopPlan.id).filter(ShopPlan.id.in_(plan_ids)).all()
            }
            if len(existing_ids) != len(plan_ids):
                raise ShopConfigurationError("Mindestens ein ausgewaehlter Ziel-Tarif existiert nicht")
        values["target_plan_ids_json"] = json.dumps(plan_ids) if plan_ids else None
    elif "scope" in values and values["scope"] != "plans":
        values["target_plan_ids_json"] = None


def _is_coupon_currently_valid(coupon: ShopCoupon, now: datetime) -> bool:
    if not coupon.active:
        return False
    valid_from = _as_utc(coupon.valid_from)
    valid_until = _as_utc(coupon.valid_until)
    if valid_from is not None and now < valid_from:
        return False
    if valid_until is not None and now > valid_until:
        return False
    if (
        coupon.max_redemptions is not None
        and coupon.redemption_count >= coupon.max_redemptions
    ):
        return False
    return True


def calculate_discount_cents(coupon: ShopCoupon, gross_cents: int) -> int:
    if gross_cents <= 0:
        return 0
    if coupon.discount_type == "percent":
        return min(gross_cents, round(gross_cents * coupon.discount_value / 100))
    return min(gross_cents, coupon.discount_value)


def list_coupons(db: Session) -> list[ShopCoupon]:
    return (
        db.query(ShopCoupon)
        .order_by(ShopCoupon.active.desc(), ShopCoupon.id.desc())
        .all()
    )


def get_coupon(db: Session, coupon_id: int) -> ShopCoupon | None:
    return db.query(ShopCoupon).filter(ShopCoupon.id == coupon_id).first()


def create_coupon(
    db: Session, payload: ShopCouponWrite, *, actor_id: int
) -> ShopCoupon:
    values = payload.model_dump()
    values["name"] = values["name"].strip()
    if not values["name"]:
        raise ShopConfigurationError("Name darf nicht leer sein")
    _validate_coupon_values(db, values)
    coupon = ShopCoupon(**values)
    db.add(coupon)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError("Ein Gutschein mit diesem Code existiert bereits") from exc
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action="shop.coupon.created",
        target_type="shop_coupon",
        target_id=coupon.id,
        details={"code": coupon.code, "discount_type": coupon.discount_type, "discount_value": coupon.discount_value},
    )
    db.commit()
    db.refresh(coupon)
    return coupon


def update_coupon(
    db: Session, coupon: ShopCoupon, payload: ShopCouponUpdate, *, actor_id: int
) -> ShopCoupon:
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
    _validate_coupon_values(db, values, existing=coupon)
    for field, value in values.items():
        setattr(coupon, field, value)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError("Ein Gutschein mit diesem Code existiert bereits") from exc
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action="shop.coupon.updated",
        target_type="shop_coupon",
        target_id=coupon.id,
        details={"code": coupon.code, "active": coupon.active},
    )
    db.commit()
    db.refresh(coupon)
    return coupon


def delete_coupon(db: Session, coupon: ShopCoupon, *, actor_id: int) -> None:
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action="shop.coupon.deleted",
        target_type="shop_coupon",
        target_id=coupon.id,
        details={"code": coupon.code},
    )
    db.delete(coupon)
    db.commit()


def sync_coupon_to_stripe(
    db: Session, coupon: ShopCoupon, *, actor_id: int
) -> ShopCoupon:
    """Erstellt einen Coupon + Promotion-Code bei Stripe und speichert die IDs."""
    stripe_coupon_id, promo_id = stripe_service.create_coupon_and_promotion_code(
        coupon_id=coupon.id,
        code=coupon.code,
        name=coupon.name,
        discount_type=coupon.discount_type,
        discount_value=coupon.discount_value,
        currency=coupon.currency,
        max_redemptions=coupon.max_redemptions,
        active=coupon.active,
    )
    coupon.stripe_coupon_id = stripe_coupon_id
    coupon.stripe_promotion_code_id = promo_id
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action="shop.coupon.stripe_synced",
        target_type="shop_coupon",
        target_id=coupon.id,
        details={"code": coupon.code, "stripe_coupon_id": stripe_coupon_id},
    )
    db.commit()
    db.refresh(coupon)
    return coupon


def coupon_response(row: ShopCoupon) -> ShopCouponResponse:
    return ShopCouponResponse(
        id=row.id,
        code=row.code,
        name=row.name,
        promo_text=row.promo_text,
        discount_type=row.discount_type,  # type: ignore[arg-type]
        discount_value=row.discount_value,
        currency=row.currency,
        scope=row.scope,  # type: ignore[arg-type]
        target_plan_ids=_parse_plan_ids(row.target_plan_ids_json),
        min_gross_cents=row.min_gross_cents,
        max_redemptions=row.max_redemptions,
        redemption_count=row.redemption_count,
        valid_from=row.valid_from,
        valid_until=row.valid_until,
        show_badge=row.show_badge,
        show_banner=row.show_banner,
        banner_cooldown_hours=row.banner_cooldown_hours,
        stripe_coupon_id=row.stripe_coupon_id,
        stripe_promotion_code_id=row.stripe_promotion_code_id,
        active=row.active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def validate_coupon_for_order(
    db: Session,
    code: str,
    *,
    kind: str,
    plan_id: int | None,
    gross_before_coupon_cents: int,
) -> tuple[ShopCoupon, int]:
    """Prueft einen Gutschein gegen Geltungsbereich, Zeitfenster und Mindestbetrag."""
    clean_code = normalize_coupon_code(code)
    coupon = db.query(ShopCoupon).filter(ShopCoupon.code == clean_code).first()
    if coupon is None:
        raise ShopConfigurationError("Gutscheincode wurde nicht gefunden")
    if not _is_coupon_currently_valid(coupon, _now()):
        raise ShopConfigurationError("Gutscheincode ist abgelaufen, aufgebraucht oder inaktiv")
    if coupon.scope == "plans" and kind != "plan":
        raise ShopConfigurationError("Dieser Gutschein gilt nur fuer Server-Tarife")
    if coupon.scope == "addons" and kind != "addon":
        raise ShopConfigurationError("Dieser Gutschein gilt nur fuer Add-ons")
    target_ids = _parse_plan_ids(coupon.target_plan_ids_json)
    if target_ids and (kind != "plan" or plan_id not in target_ids):
        raise ShopConfigurationError("Dieser Gutschein gilt nicht fuer den gewaehlten Tarif")
    if gross_before_coupon_cents < coupon.min_gross_cents:
        raise ShopConfigurationError("Mindestbestellwert fuer diesen Gutschein nicht erreicht")
    return coupon, calculate_discount_cents(coupon, gross_before_coupon_cents)


def consume_coupon_redemption(db: Session, coupon_code: str) -> None:
    """Zaehlt eine Einloesung beim Zahlungseingang unter DB-Sperre hoch."""
    clean = coupon_code.strip().upper()
    if not clean:
        return
    coupon = (
        db.query(ShopCoupon)
        .filter(ShopCoupon.code == clean)
        .with_for_update()
        .first()
    )
    if coupon is None:
        return
    if (
        coupon.max_redemptions is not None
        and coupon.redemption_count >= coupon.max_redemptions
    ):
        raise ShopConfigurationError("Gutscheincode ist bereits erschoepft")
    coupon.redemption_count += 1


def preview_coupon(
    db: Session,
    *,
    code: str,
    kind: str,
    plan_id: int | None,
    gross_cents: int,
) -> ShopCouponPreviewResponse:
    try:
        coupon, discount_cents = validate_coupon_for_order(
            db,
            code,
            kind=kind,
            plan_id=plan_id,
            gross_before_coupon_cents=gross_cents,
        )
        return ShopCouponPreviewResponse(
            valid=True,
            code=coupon.code,
            discount_type=coupon.discount_type,  # type: ignore[arg-type]
            discount_value=coupon.discount_value,
            discount_cents=discount_cents,
            final_gross_cents=max(0, gross_cents - discount_cents),
        )
    except ShopConfigurationError as exc:
        return ShopCouponPreviewResponse(
            valid=False,
            code=(code or "").strip().upper(),
            discount_cents=0,
            final_gross_cents=max(0, gross_cents),
            reason=str(exc),
        )


def get_public_promos(db: Session) -> ShopPublicPromosResponse:
    now = _now()
    active_rows = (
        db.query(ShopCoupon)
        .filter(ShopCoupon.active.is_(True))
        .order_by(ShopCoupon.discount_value.desc(), ShopCoupon.id.desc())
        .all()
    )
    valid_rows = [row for row in active_rows if _is_coupon_currently_valid(row, now)]

    banner: ShopPublicBannerPromo | None = None
    badges: list[ShopPublicBadgePromo] = []
    for row in valid_rows:
        if row.show_banner and banner is None:
            banner = ShopPublicBannerPromo(
                code=row.code,
                name=row.name,
                promo_text=row.promo_text,
                discount_type=row.discount_type,  # type: ignore[arg-type]
                discount_value=row.discount_value,
                scope=row.scope,  # type: ignore[arg-type]
                cooldown_hours=row.banner_cooldown_hours,
                valid_until=row.valid_until,
            )
        if row.show_badge:
            badges.append(
                ShopPublicBadgePromo(
                    code=row.code,
                    name=row.name,
                    discount_type=row.discount_type,  # type: ignore[arg-type]
                    discount_value=row.discount_value,
                    scope=row.scope,  # type: ignore[arg-type]
                    target_plan_ids=_parse_plan_ids(row.target_plan_ids_json),
                )
            )
    return ShopPublicPromosResponse(banner=banner, badges=badges)


def get_shop_stats(db: Session) -> ShopStatsResponse:
    orders = db.query(ShopOrder).all()
    paid_orders = [o for o in orders if o.status == "paid"]
    pending_orders = [o for o in orders if o.status == "pending_payment"]
    refunded_orders = [o for o in orders if o.status == "refunded"]

    active_subs = (
        db.query(ShopSubscription)
        .filter(ShopSubscription.status == "active")
        .all()
    )
    active_addon_subs = sum(1 for s in active_subs if s.addon_id is not None)
    coupons = db.query(ShopCoupon).all()
    now = _now()

    return ShopStatsResponse(
        total_orders=len(orders),
        paid_orders=len(paid_orders),
        pending_orders=len(pending_orders),
        refunded_orders=len(refunded_orders),
        paid_gross_cents=sum(o.gross_cents for o in paid_orders),
        paid_net_cents=sum(o.net_cents for o in paid_orders),
        refunded_gross_cents=sum(o.gross_cents for o in refunded_orders),
        active_subscriptions=len(active_subs),
        active_addon_subscriptions=active_addon_subs,
        active_coupons=sum(1 for c in coupons if _is_coupon_currently_valid(c, now)),
        coupon_redemptions=sum(c.redemption_count for c in coupons),
    )
