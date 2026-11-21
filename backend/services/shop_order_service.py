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
    ShopInvoice,
    ShopOrder,
    ShopOrderItem,
    ShopPaymentEvent,
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
        buyer_name=payload.buyer_name,
        buyer_street=payload.buyer_street,
        buyer_postal_code=payload.buyer_postal_code,
        buyer_city=payload.buyer_city,
        buyer_country=payload.buyer_country,
        buyer_email=payload.buyer_email,
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


def apply_payment(
    db: Session,
    order: ShopOrder,
    *,
    provider: str,
    reference: str,
    origin: str = "direct",
) -> ShopOrder:
    """Bucht einen Zahlungseingang: Abo und Entitlements entstehen genau einmal.

    Committet nicht selbst — der Aufrufer entscheidet ueber die Transaktion
    (Demo-Route oder Webhook). Eine bereits bezahlte Order bleibt unveraendert.
    """
    if order.status == "paid":
        return order
    if order.status != "pending_payment":
        raise ShopOrderError("Bestellung ist nicht zahlbar")

    jetzt = _now()
    order.status = "paid"
    order.paid_at = jetzt
    order.payment_provider = provider
    order.payment_reference = reference
    _grant_entitlements(db, order, jetzt)
    # Die Test- und Produktions-Session laeuft ohne Autoflush; der Webhook
    # braucht die frischen Abo-/Entitlement-Zeilen fuer seine Zuordnung.
    db.flush()
    from services import shop_invoice_service

    # Ohne vollstaendige Verkaeufer- und Kaeuferdaten entsteht bewusst keine
    # Rechnung; der Zahlungseingang bleibt davon unberuehrt.
    shop_invoice_service.ensure_invoice_for_order(db, order)
    db.flush()
    audit_service.record_privileged_action(
        db,
        user_id=order.user_id,
        action="shop.order.paid",
        target_type="shop_order",
        target_id=order.id,
        details={
            "number": order.number,
            "gross_cents": order.gross_cents,
            "provider": provider,
        },
        origin=origin,
    )
    return order


def mark_demo_paid(db: Session, order: ShopOrder) -> ShopOrder:
    """Lokaler Zahlungserfolg ohne Zahlungsdienst."""
    order = apply_payment(
        db, order, provider="demo", reference=f"demo-{order.number}"
    )
    db.commit()
    from services import shop_fulfillment_service

    shop_fulfillment_service.sync_order_entitlements(
        db, order.id, origin="system"
    )
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


def _order_id_from_metadata(metadata: object) -> int | None:
    if not isinstance(metadata, dict):
        return None
    try:
        return int(metadata.get("order_id"))
    except (TypeError, ValueError):
        return None


def _invoice_subscription_id(invoice: dict) -> str | None:
    """Stripe-Abo-ID aus einer Rechnung, ueber alte und neue API-Struktur."""
    direkt = invoice.get("subscription")
    if isinstance(direkt, str) and direkt:
        return direkt
    eltern = (invoice.get("parent") or {}).get("subscription_details") or {}
    wert = eltern.get("subscription")
    if isinstance(wert, str) and wert:
        return wert
    for zeile in (invoice.get("lines") or {}).get("data") or []:
        details = ((zeile.get("parent") or {}).get("subscription_item_details") or {})
        wert = details.get("subscription")
        if isinstance(wert, str) and wert:
            return wert
    return None


def _invoice_order_id(invoice: dict) -> int | None:
    eltern = (invoice.get("parent") or {}).get("subscription_details") or {}
    return _order_id_from_metadata(eltern.get("metadata"))


def _timestamp_utc(value: object) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), timezone.utc)  # type: ignore[arg-type]
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _invoice_period_end(invoice: dict) -> datetime | None:
    for zeile in (invoice.get("lines") or {}).get("data") or []:
        ende = (zeile.get("period") or {}).get("end")
        zeitpunkt = _timestamp_utc(ende)
        if zeitpunkt is not None:
            return zeitpunkt
    return None


def _subscription_by_provider(db: Session, reference: str) -> ShopSubscription | None:
    return (
        db.query(ShopSubscription)
        .filter(ShopSubscription.provider_reference == reference)
        .first()
    )


def _subscription_for_invoice(
    db: Session, invoice: dict
) -> ShopSubscription | None:
    referenz = _invoice_subscription_id(invoice)
    if referenz:
        abo = _subscription_by_provider(db, referenz)
        if abo is not None:
            return abo
    order_id = _invoice_order_id(invoice)
    if order_id is not None:
        return (
            db.query(ShopSubscription)
            .filter(ShopSubscription.order_id == order_id)
            .order_by(ShopSubscription.id.desc())
            .first()
        )
    return None


def _set_entitlements_status(
    db: Session, subscription: ShopSubscription, status: str
) -> None:
    jetzt = _now()
    zeilen = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_item_id == subscription.order_item_id)
        .all()
    )
    for zeile in zeilen:
        zeile.status = status
        zeile.revoked_at = jetzt if status == "revoked" else None


def _map_subscription_status(value: object) -> str | None:
    if value in ("active", "trialing"):
        return "active"
    if value in ("past_due", "unpaid", "incomplete", "incomplete_expired"):
        return "past_due"
    if value == "canceled":
        return "cancelled"
    return None


def _handle_checkout_completed(db: Session, event_id: str, session: dict) -> int | None:
    order_id = _order_id_from_metadata(session.get("metadata"))
    if order_id is None:
        return None
    order = db.query(ShopOrder).filter(ShopOrder.id == order_id).first()
    if order is None:
        return None
    apply_payment(
        db,
        order,
        provider="stripe",
        reference=str(session.get("id") or event_id),
        origin="external",
    )
    referenz = session.get("subscription")
    if isinstance(referenz, str) and referenz:
        abo = (
            db.query(ShopSubscription)
            .filter(ShopSubscription.order_id == order.id)
            .order_by(ShopSubscription.id.desc())
            .first()
        )
        if abo is not None and not abo.provider_reference:
            abo.provider_reference = referenz
    return order.id


def _handle_invoice_paid(db: Session, invoice: dict) -> int | None:
    abo = _subscription_for_invoice(db, invoice)
    if abo is None:
        return None
    abo.status = "active"
    ende = _invoice_period_end(invoice)
    if ende is not None and ende > abo.current_period_end:
        abo.current_period_end = ende
    _set_entitlements_status(db, abo, "active")
    return abo.order_id


def _handle_invoice_failed(db: Session, invoice: dict) -> int | None:
    abo = _subscription_for_invoice(db, invoice)
    if abo is None:
        return None
    # Kulanz: Der Anspruch bleibt, bis Stripe das Abo auf unpaid/canceled setzt.
    abo.status = "past_due"
    return abo.order_id


def _handle_subscription_changed(db: Session, obj: dict, deleted: bool) -> int | None:
    referenz = str(obj.get("id") or "")
    if not referenz:
        return None
    abo = _subscription_by_provider(db, referenz)
    if abo is None:
        return None

    if deleted:
        abo.status = "cancelled"
    else:
        neu = _map_subscription_status(obj.get("status"))
        if neu is not None:
            abo.status = neu
        if "cancel_at_period_end" in obj:
            abo.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
        ende = _timestamp_utc(obj.get("current_period_end"))
        if ende is not None and ende > abo.current_period_end:
            abo.current_period_end = ende

    if abo.status == "cancelled":
        _set_entitlements_status(db, abo, "revoked")
    elif abo.status == "past_due" and obj.get("status") == "unpaid":
        _set_entitlements_status(db, abo, "suspended")
    elif abo.status == "active":
        _set_entitlements_status(db, abo, "active")
    return abo.order_id


def _handle_charge_refunded(db: Session, charge: dict) -> int | None:
    amount = charge.get("amount")
    amount_refunded = charge.get("amount_refunded")
    voll_erstattet = bool(charge.get("refunded")) or (
        isinstance(amount, int)
        and isinstance(amount_refunded, int)
        and amount > 0
        and amount_refunded >= amount
    )
    if not voll_erstattet:
        return None

    order: ShopOrder | None = None
    order_id = _order_id_from_metadata(charge.get("metadata"))
    if order_id is not None:
        order = db.query(ShopOrder).filter(ShopOrder.id == order_id).first()
    if order is None:
        pi = charge.get("payment_intent")
        if isinstance(pi, str) and pi:
            order = (
                db.query(ShopOrder)
                .filter(ShopOrder.payment_reference == pi)
                .first()
            )
    if order is None:
        return None
    if order.status == "paid":
        refund_order(
            db,
            order,
            reason="Stripe-Rueckerstattung",
            actor_user_id=order.user_id,
            call_stripe=False,
            origin="external",
        )
    return order.id


def handle_payment_event(db: Session, event: dict) -> tuple[str, int | None]:
    """Verarbeitet ein signaturgeprueftes Stripe-Ereignis, idempotent.

    Committet nicht selbst. Liefert ("processed"|"duplicate", order_id).
    Unbekannte Ereignistypen werden nur festgehalten, damit Retries sauber
    als Duplikat erkannt werden.
    """
    event_id = str(event.get("id") or "").strip()
    if not event_id:
        raise ShopOrderError("Ereignis ohne ID")
    vorhanden = (
        db.query(ShopPaymentEvent)
        .filter(ShopPaymentEvent.event_id == event_id)
        .first()
    )
    if vorhanden is not None:
        return "duplicate", vorhanden.order_id

    typ = str(event.get("type") or "")
    obj = (event.get("data") or {}).get("object") or {}
    order_id: int | None = None
    if typ == "checkout.session.completed":
        order_id = _handle_checkout_completed(db, event_id, obj)
    elif typ == "invoice.paid":
        order_id = _handle_invoice_paid(db, obj)
    elif typ == "invoice.payment_failed":
        order_id = _handle_invoice_failed(db, obj)
    elif typ == "customer.subscription.updated":
        order_id = _handle_subscription_changed(db, obj, deleted=False)
    elif typ == "customer.subscription.deleted":
        order_id = _handle_subscription_changed(db, obj, deleted=True)
    elif typ == "charge.refunded":
        order_id = _handle_charge_refunded(db, obj)

    db.add(
        ShopPaymentEvent(
            event_id=event_id,
            event_type=typ[:64],
            order_id=order_id,
            status="processed",
        )
    )
    return "processed", order_id


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


def get_subscription(
    db: Session, user_id: int, subscription_id: int
) -> ShopSubscription | None:
    return (
        db.query(ShopSubscription)
        .filter(
            ShopSubscription.id == subscription_id,
            ShopSubscription.user_id == user_id,
        )
        .first()
    )


def cancel_subscription(
    db: Session, subscription: ShopSubscription, *, actor_user_id: int
) -> ShopSubscription:
    """Merkt ein Abo zum Laufzeitende als gekuendigt vor (inkl. Stripe)."""
    if subscription.status == "cancelled":
        raise ShopOrderError("Abo ist bereits gekuendigt")
    if subscription.cancel_at_period_end:
        return subscription
    if subscription.provider_reference:
        from services import stripe_service

        stripe_service.cancel_subscription_at_period_end(
            subscription.provider_reference
        )
    subscription.cancel_at_period_end = True
    audit_service.record_privileged_action(
        db,
        user_id=actor_user_id,
        action="shop.subscription.cancel_requested",
        target_type="shop_subscription",
        target_id=subscription.id,
        details={
            "order_id": subscription.order_id,
            "provider_reference": subscription.provider_reference,
        },
    )
    db.commit()
    db.refresh(subscription)
    return subscription


def refund_order(
    db: Session,
    order: ShopOrder,
    *,
    reason: str,
    actor_user_id: int,
    call_stripe: bool = True,
    origin: str = "direct",
) -> ShopInvoice | None:
    """Erstattet eine bezahlte Bestellung, storniert Abos und widerruft Ansprueche.

    Committet nicht selbst; der Aufrufer entscheidet ueber Transaktion und
    anschliessendes Fulfillment-Sync.
    """
    if order.status == "refunded":
        raise ShopOrderError("Bestellung wurde bereits erstattet")
    if order.status != "paid":
        raise ShopOrderError("Nur bezahlte Bestellungen koennen erstattet werden")

    abos = (
        db.query(ShopSubscription)
        .filter(ShopSubscription.order_id == order.id)
        .all()
    )

    if call_stripe and order.payment_provider == "stripe" and order.payment_reference:
        from services import stripe_service

        payment_intent: str | None = None
        if order.payment_reference.startswith("pi_"):
            payment_intent = order.payment_reference
        elif order.payment_reference.startswith("cs_"):
            session_obj = stripe_service.get_checkout_session(order.payment_reference)
            raw_pi = session_obj.get("payment_intent")
            if isinstance(raw_pi, str) and raw_pi:
                payment_intent = raw_pi

        if payment_intent:
            stripe_service.create_refund(
                payment_intent,
                idempotency_key=f"shop-refund-order-{order.id}",
            )
        for abo in abos:
            if abo.provider_reference and abo.status != "cancelled":
                try:
                    stripe_service.cancel_subscription_at_period_end(
                        abo.provider_reference
                    )
                except stripe_service.StripeError:
                    if not payment_intent:
                        raise

    jetzt = _now()
    order.status = "refunded"
    for abo in abos:
        abo.status = "cancelled"
        abo.cancel_at_period_end = True

    entitlements = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id == order.id)
        .all()
    )
    for ent in entitlements:
        ent.status = "revoked"
        ent.revoked_at = jetzt

    from services import shop_invoice_service

    rechnung = (
        db.query(ShopInvoice)
        .filter(
            ShopInvoice.order_id == order.id,
            ShopInvoice.type == "invoice",
            ShopInvoice.status == "issued",
        )
        .first()
    )
    gutschrift: ShopInvoice | None = None
    if rechnung is not None:
        gutschrift = shop_invoice_service.credit_invoice(db, rechnung, reason)

    audit_service.record_privileged_action(
        db,
        user_id=actor_user_id,
        action="shop.order.refunded",
        target_type="shop_order",
        target_id=order.id,
        details={
            "number": order.number,
            "gross_cents": order.gross_cents,
            "reason": reason[:200],
            **({"credit_note": gutschrift.number} if gutschrift is not None else {}),
        },
        origin=origin,
    )
    return gutschrift


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
        server_id=row.server_id,
        provisioning_status=row.provisioning_status,
        provisioning_error=row.provisioning_error,
        created_at=row.created_at,
    )
