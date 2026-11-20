"""Bestellungen, Abos und Freischaltungen des nativen Shops.

Preise werden ausschliesslich hier aus dem gespeicherten Tarif berechnet.
Der Client schickt nur, was er buchen will (Tarif, Ressourcen, Laufzeit);
Betraege aus dem Browser werden nie uebernommen.

Die Zahlung ist bis zur Stripe-Anbindung ein lokaler Probelauf: Die Order
wechselt erst durch ``mark_demo_paid`` in ``paid`` und erzeugt dabei Abo und
Entitlements. Rollenvergabe und Server-Anlage lesen spaeter aus den
Entitlements und bleiben eigene Schritte.
"""

from __future__ import annotations

import calendar
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models import (
    ShopEntitlement,
    ShopOrder,
    ShopOrderItem,
    ShopPlan,
    ShopSubscription,
    User,
)
from schemas.shop import (
    ShopEntitlementResponse,
    ShopOrderCreate,
    ShopOrderItemResponse,
    ShopOrderResponse,
    ShopSubscriptionResponse,
)
from services import audit_service


# Laufzeitrabatt in Prozent; muss zur Preisanzeige im Frontend passen.
DURATION_DISCOUNTS: dict[int, int] = {1: 0, 3: 5, 12: 20}


class ShopOrderError(ValueError):
    """Bestellung ist nicht moeglich; wird am Rand zu 422."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _game_name(game_type: str) -> str:
    from games import get_plugin

    plugin = get_plugin(game_type)
    if plugin is None:
        return game_type
    return plugin.get_blueprint().meta.name


def _check_resource(
    value: int | None,
    included: int | None,
    maximum: int | None,
    step: int | None,
    label: str,
) -> int | None:
    if included is None:
        return value
    wert = included if value is None else value
    if wert < included:
        raise ShopOrderError(f"{label} darf nicht unter {included} liegen")
    if maximum is not None and wert > maximum:
        raise ShopOrderError(f"{label} darf hoechstens {maximum} betragen")
    schritt = step or 1
    if (wert - included) % schritt != 0:
        raise ShopOrderError(f"{label} muss in Schritten von {schritt} wachsen")
    return wert


def _monthly_gross(
    plan: ShopPlan, ram_mb: int | None, cpu: int | None, slots: int | None
) -> int:
    gesamt = plan.price_cents
    if plan.ram_included_mb is not None and ram_mb is not None:
        gesamt += (
            (ram_mb - plan.ram_included_mb) // (plan.ram_step_mb or 1)
        ) * plan.price_per_ram_step_cents
    if plan.cpu_included is not None and cpu is not None:
        gesamt += (
            (cpu - plan.cpu_included) // (plan.cpu_step or 1)
        ) * plan.price_per_cpu_step_cents
    if plan.slots_included is not None and slots is not None:
        gesamt += (
            (slots - plan.slots_included) // (plan.slots_step or 1)
        ) * plan.price_per_slot_step_cents
    return gesamt


def _item_label(plan: ShopPlan, ram_mb: int | None, slots: int | None) -> str:
    teile = [_game_name(plan.game_type), plan.name]
    if ram_mb is not None:
        teile.append(f"{round(ram_mb / 1024)} GB")
    if slots is not None:
        teile.append(f"{slots} Slots")
    return " · ".join(teile)


def create_order(db: Session, user: User, payload: ShopOrderCreate) -> ShopOrder:
    plan = (
        db.query(ShopPlan)
        .filter(ShopPlan.id == payload.plan_id, ShopPlan.active.is_(True))
        .first()
    )
    if plan is None:
        raise ShopOrderError("Tarif ist nicht verfuegbar")

    ram_mb = _check_resource(
        payload.ram_mb, plan.ram_included_mb, plan.ram_max_mb, plan.ram_step_mb, "RAM"
    )
    cpu = _check_resource(
        payload.cpu, plan.cpu_included, plan.cpu_max, plan.cpu_step, "CPU"
    )
    slots = _check_resource(
        payload.slots, plan.slots_included, plan.slots_max, plan.slots_step, "Slots"
    )

    discount = DURATION_DISCOUNTS[payload.months]
    monatlich = _monthly_gross(plan, ram_mb, cpu, slots)
    brutto = round(monatlich * payload.months * (1 - discount / 100))
    netto = round(brutto * 100 / (100 + plan.tax_rate_percent))
    steuer = brutto - netto

    order = ShopOrder(
        number="",  # wird nach dem Flush aus der ID gesetzt
        user_id=user.id,
        status="pending_payment",
        currency=plan.currency,
        billing_interval=plan.billing_interval,
        months=payload.months,
        discount_percent=discount,
        net_cents=netto,
        tax_cents=steuer,
        gross_cents=brutto,
        payment_provider="demo",
    )
    db.add(order)
    db.flush()
    order.number = f"MSM-{_now().year}-{order.id:06d}"

    db.add(
        ShopOrderItem(
            order_id=order.id,
            kind="plan",
            plan_id=plan.id,
            game_type=plan.game_type,
            name=_item_label(plan, ram_mb, slots),
            quantity=1,
            unit_price_cents=monatlich,
            tax_rate_percent=plan.tax_rate_percent,
            net_cents=netto,
            tax_cents=steuer,
            gross_cents=brutto,
            ram_mb=ram_mb,
            cpu=cpu,
            slots=slots,
        )
    )
    db.commit()
    db.refresh(order)
    return order


def mark_demo_paid(db: Session, order: ShopOrder) -> ShopOrder:
    """Lokaler Zahlungserfolg: Abo und Entitlements entstehen genau einmal."""
    if order.status == "paid":
        return order
    if order.status != "pending_payment":
        raise ShopOrderError("Bestellung ist nicht zahlbar")

    jetzt = _now()
    order.status = "paid"
    order.paid_at = jetzt
    order.payment_provider = "demo"
    order.payment_reference = f"demo-{order.number}"
    _grant_entitlements(db, order, jetzt)
    audit_service.record_privileged_action(
        db,
        user_id=order.user_id,
        action="shop.order.paid",
        target_type="shop_order",
        target_id=order.id,
        details={"number": order.number, "gross_cents": order.gross_cents},
    )
    db.commit()
    db.refresh(order)
    return order


def _grant_entitlements(db: Session, order: ShopOrder, jetzt: datetime) -> None:
    items = (
        db.query(ShopOrderItem)
        .filter(ShopOrderItem.order_id == order.id)
        .order_by(ShopOrderItem.id.asc())
        .all()
    )
    for item in items:
        vorhanden = (
            db.query(ShopSubscription)
            .filter(ShopSubscription.order_item_id == item.id)
            .first()
        )
        if vorhanden is None:
            db.add(
                ShopSubscription(
                    user_id=order.user_id,
                    order_id=order.id,
                    order_item_id=item.id,
                    plan_id=item.plan_id,
                    game_type=item.game_type,
                    name=item.name,
                    status="active",
                    billing_interval=order.billing_interval,
                    monthly_gross_cents=max(1, round(item.gross_cents / order.months)),
                    tax_rate_percent=item.tax_rate_percent,
                    started_at=jetzt,
                    current_period_end=_add_months(jetzt, order.months),
                )
            )

        server_frei = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_item_id == item.id,
                ShopEntitlement.kind == "server",
            )
            .first()
        )
        if server_frei is None:
            db.add(
                ShopEntitlement(
                    user_id=order.user_id,
                    order_id=order.id,
                    order_item_id=item.id,
                    kind="server",
                    label=item.name,
                    plan_id=item.plan_id,
                    ram_mb=item.ram_mb,
                    cpu=item.cpu,
                    slots=item.slots,
                )
            )

        plan = (
            db.query(ShopPlan).filter(ShopPlan.id == item.plan_id).first()
            if item.plan_id is not None
            else None
        )
        if plan is not None and plan.role_id is not None:
            rollen_frei = (
                db.query(ShopEntitlement)
                .filter(
                    ShopEntitlement.order_item_id == item.id,
                    ShopEntitlement.kind == "role",
                )
                .first()
            )
            if rollen_frei is None:
                db.add(
                    ShopEntitlement(
                        user_id=order.user_id,
                        order_id=order.id,
                        order_item_id=item.id,
                        kind="role",
                        label=plan.name,
                        plan_id=plan.id,
                        role_id=plan.role_id,
                    )
                )


def list_orders(db: Session, user_id: int) -> list[ShopOrder]:
    return (
        db.query(ShopOrder)
        .filter(ShopOrder.user_id == user_id)
        .order_by(ShopOrder.created_at.desc(), ShopOrder.id.desc())
        .all()
    )


def get_order(db: Session, user_id: int, order_id: int) -> ShopOrder | None:
    return (
        db.query(ShopOrder)
        .filter(ShopOrder.id == order_id, ShopOrder.user_id == user_id)
        .first()
    )


def list_subscriptions(db: Session, user_id: int) -> list[ShopSubscription]:
    return (
        db.query(ShopSubscription)
        .filter(ShopSubscription.user_id == user_id)
        .order_by(ShopSubscription.created_at.desc(), ShopSubscription.id.desc())
        .all()
    )


def list_entitlements(db: Session, user_id: int) -> list[ShopEntitlement]:
    return (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.user_id == user_id)
        .order_by(ShopEntitlement.created_at.desc(), ShopEntitlement.id.desc())
        .all()
    )


def order_items(db: Session, order_id: int) -> list[ShopOrderItem]:
    return (
        db.query(ShopOrderItem)
        .filter(ShopOrderItem.order_id == order_id)
        .order_by(ShopOrderItem.id.asc())
        .all()
    )


def order_response(db: Session, order: ShopOrder) -> ShopOrderResponse:
    return ShopOrderResponse(
        id=order.id,
        number=order.number,
        status=order.status,
        currency=order.currency,
        billing_interval=order.billing_interval,
        months=order.months,
        discount_percent=order.discount_percent,
        net_cents=order.net_cents,
        tax_cents=order.tax_cents,
        gross_cents=order.gross_cents,
        payment_provider=order.payment_provider,
        payment_reference=order.payment_reference,
        created_at=order.created_at,
        paid_at=order.paid_at,
        items=[
            ShopOrderItemResponse(
                id=item.id,
                kind=item.kind,
                game_type=item.game_type,
                name=item.name,
                quantity=item.quantity,
                unit_price_cents=item.unit_price_cents,
                tax_rate_percent=item.tax_rate_percent,
                net_cents=item.net_cents,
                tax_cents=item.tax_cents,
                gross_cents=item.gross_cents,
                ram_mb=item.ram_mb,
                cpu=item.cpu,
                slots=item.slots,
            )
            for item in order_items(db, order.id)
        ],
    )


def subscription_response(row: ShopSubscription) -> ShopSubscriptionResponse:
    return ShopSubscriptionResponse(
        id=row.id,
        game_type=row.game_type,
        name=row.name,
        status=row.status,
        billing_interval=row.billing_interval,
        monthly_gross_cents=row.monthly_gross_cents,
        tax_rate_percent=row.tax_rate_percent,
        started_at=row.started_at,
        current_period_end=row.current_period_end,
        cancel_at_period_end=row.cancel_at_period_end,
    )


def entitlement_response(row: ShopEntitlement) -> ShopEntitlementResponse:
    return ShopEntitlementResponse(
        id=row.id,
        kind=row.kind,
        label=row.label,
        status=row.status,
        created_at=row.created_at,
    )
