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
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from models import (
    Node,
    Server,
    ShopAddon,
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
    ShopAdminManualOrderCreate,
    ShopEntitlementResponse,
    ShopOrderCreate,
    ShopOrderItemResponse,
    ShopOrderResponse,
    ShopSubscriptionResponse,
)
from services import audit_service, lifecycle_purge_service, shop_lifecycle_settings_service


# Laufzeitrabatt in Prozent; muss zur Preisanzeige im Frontend passen.
DURATION_DISCOUNTS: dict[int, int] = {1: 0, 3: 5, 12: 20}


class ShopOrderError(ValueError):
    """Bestellung ist nicht moeglich; wird am Rand zu 422."""


class ShopNotFoundError(ShopOrderError):
    """Gesuchter Shop-Datensatz existiert nicht fuer diesen Benutzer (HTTP 404)."""


class ShopCapacityError(ShopOrderError):
    """Keine freie Node-Kapazitaet mehr vorhanden (Ausverkaufsschutz, HTTP 409)."""


class ShopDurationValidationError(ShopOrderError):
    """Ungueltige oder nicht freigeschaltete Kurzzeit-Laufzeit (HTTP 422)."""


def calc_short_duration_gross_cents(
    monthly_cents: int, *, price_factor_percent: int, min_price_cents: int
) -> int:
    """Berechnet den Kurzzeit-Bruttopreis mit Half-Up-Rundung und Mindestpreis."""
    anteil = (int(monthly_cents) * int(price_factor_percent) + 50) // 100
    return max(int(min_price_cents), anteil)


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


def _resolve_plan_spec(
    db: Session,
    payload: ShopOrderCreate,
    *,
    check_capacity: bool = True,
) -> dict[str, object]:
    plan = (
        db.query(ShopPlan)
        .filter(ShopPlan.id == payload.plan_id, ShopPlan.active.is_(True))
        .first()
    )
    if plan is None:
        raise ShopOrderError("Tarif ist nicht verfuegbar")

    preferred_node_id = getattr(payload, "preferred_node_id", None)
    node_surcharge_cents = 0
    if preferred_node_id is not None:
        node = db.query(Node).filter(Node.id == preferred_node_id).first()
        if node is None or not bool(getattr(node, "shop_enabled", True)):
            raise ShopOrderError("Gewaehlter Standort ist im Shop nicht verfuegbar")
        if plan.node_id is not None and plan.node_id != preferred_node_id:
            raise ShopOrderError("Gewaehlter Standort ist fuer diesen Tarif nicht zulaessig")
        node_surcharge_cents = max(0, int(getattr(node, "shop_surcharge_cents", 0) or 0))
    elif plan.node_id is not None:
        pinned = db.query(Node).filter(Node.id == plan.node_id).first()
        if pinned is not None and not bool(getattr(pinned, "shop_enabled", True)):
            raise ShopOrderError("Tarif-Standort ist im Shop nicht freigegeben")

    ram_mb = _check_resource(
        payload.ram_mb, plan.ram_included_mb, plan.ram_max_mb, plan.ram_step_mb, "RAM"
    )
    cpu = _check_resource(
        payload.cpu, plan.cpu_included, plan.cpu_max, plan.cpu_step, "CPU"
    )
    slots = _check_resource(
        payload.slots, plan.slots_included, plan.slots_max, plan.slots_step, "Slots"
    )
    monatlich = _monthly_gross(plan, ram_mb, cpu, slots) + node_surcharge_cents
    billing_mode = getattr(payload, "billing_mode", "subscription")
    if billing_mode == "lifetime":
        lifetime_base = getattr(plan, "lifetime_price_cents", None)
        if lifetime_base is None or lifetime_base <= 0:
            raise ShopOrderError(
                "Lifetime-Tarif ist fuer dieses Paket nicht freigeschaltet"
            )
        unit_price_cents = int(lifetime_base) + max(0, monatlich - plan.price_cents) * 12
    else:
        unit_price_cents = monatlich
    if check_capacity:
        from services import node_placement_service

        availability = node_placement_service.check_plan_availability(
            db,
            plan,
            ram_mb=ram_mb,
            cpu_cores=cpu,
            preferred_node_id=preferred_node_id,
            shop_only=True,
        )
        if not availability.available:
            raise ShopCapacityError(
                "Derzeit ist fuer diese Konfiguration keine ausreichende Server-Kapazitaet frei"
            )
    return {
        "kind": "plan",
        "plan_id": plan.id,
        "addon_id": None,
        "game_type": plan.game_type,
        "name": _item_label(plan, ram_mb, slots),
        "currency": plan.currency,
        "billing_interval": plan.billing_interval,
        "tax_rate_percent": plan.tax_rate_percent,
        "monatlich": unit_price_cents,
        "ram_mb": ram_mb,
        "cpu": cpu,
        "slots": slots,
        "preferred_node_id": preferred_node_id,
        "node_surcharge_cents": node_surcharge_cents,
        "allow_short_durations": bool(getattr(plan, "allow_short_durations", True)),
    }


def _resolve_addon_spec(db: Session, payload: ShopOrderCreate) -> dict[str, object]:
    if getattr(payload, "billing_mode", "subscription") == "lifetime":
        raise ShopOrderError("Add-ons unterstuetzen keinen Lifetime-Tarif")
    if getattr(payload, "preferred_node_id", None) is not None:
        raise ShopOrderError("Add-on-Bestellungen nehmen keinen Standort entgegen")
    if (
        payload.ram_mb is not None
        or payload.cpu is not None
        or payload.slots is not None
    ):
        raise ShopOrderError(
            "Add-on-Bestellungen nehmen keine Server-Ressourcen entgegen"
        )
    addon = (
        db.query(ShopAddon)
        .filter(ShopAddon.id == payload.addon_id, ShopAddon.active.is_(True))
        .first()
    )
    if addon is None:
        raise ShopOrderError("Add-on ist nicht verfuegbar")
    return {
        "kind": "addon",
        "plan_id": None,
        "addon_id": addon.id,
        "game_type": f"addon:{addon.category}",
        "name": addon.name,
        "currency": addon.currency,
        "billing_interval": addon.billing_interval,
        "tax_rate_percent": addon.tax_rate_percent,
        "monatlich": addon.price_cents,
        "ram_mb": None,
        "cpu": None,
        "slots": addon.extra_slots,
        "preferred_node_id": None,
        "node_surcharge_cents": 0,
    }


def create_order(
    db: Session,
    user: User,
    payload: ShopOrderCreate,
    *,
    check_capacity: bool = True,
) -> ShopOrder:
    spec = (
        _resolve_plan_spec(db, payload, check_capacity=check_capacity)
        if payload.plan_id is not None
        else _resolve_addon_spec(db, payload)
    )

    raw_mode = getattr(payload, "billing_mode", "subscription")
    billing_mode = (
        raw_mode
        if raw_mode in ("prepaid", "subscription", "lifetime")
        else "subscription"
    )
    duration_days = getattr(payload, "duration_days", None)
    short_tier: dict[str, object] | None = None
    if duration_days is not None:
        if spec["kind"] != "plan" or billing_mode != "prepaid":
            raise ShopOrderError(
                "Kurzzeit-Laufzeiten stehen nur im Prepaid-Modus fuer Server-Tarife bereit"
            )
        if not bool(spec.get("allow_short_durations", True)):
            raise ShopOrderError(
                "Kurzzeit-Laufzeiten sind fuer diesen Tarif deaktiviert"
            )
        short_tier = shop_lifecycle_settings_service.active_short_duration_tier(
            duration_days, db=db
        )
        if short_tier is None:
            raise ShopOrderError("Diese Kurzzeit-Laufzeit ist derzeit nicht aktiviert")

    months = 1 if (billing_mode == "lifetime" or duration_days is not None) else payload.months
    discount = (
        0
        if (billing_mode == "lifetime" or duration_days is not None)
        else DURATION_DISCOUNTS[months]
    )
    if billing_mode == "subscription" and months == 1:
        sub_disc = shop_lifecycle_settings_service.subscription_discount_percent(db=db)
        if sub_disc > 0:
            discount = min(50, discount + sub_disc)
    monatlich = int(spec["monatlich"])  # type: ignore[arg-type]
    tax_rate_percent = int(spec["tax_rate_percent"])  # type: ignore[arg-type]
    if short_tier is not None and duration_days is not None:
        brutto_vor_gutschein = calc_short_duration_gross_cents(
            monatlich,
            price_factor_percent=int(short_tier["price_factor_percent"]),  # type: ignore[arg-type]
            min_price_cents=int(short_tier["min_price_cents"]),  # type: ignore[arg-type]
        )
    else:
        brutto_vor_gutschein = (
            monatlich
            if billing_mode == "lifetime"
            else round(monatlich * months * (1 - discount / 100))
        )
    coupon_code: str | None = None
    coupon_discount_cents = 0
    if payload.coupon_code and payload.coupon_code.strip():
        from services import shop_coupon_service
        from services.shop_catalog_service import ShopConfigurationError

        try:
            coupon, coupon_discount_cents = shop_coupon_service.validate_coupon_for_order(
                db,
                payload.coupon_code,
                kind=str(spec["kind"]),
                plan_id=spec["plan_id"],  # type: ignore[arg-type]
                gross_before_coupon_cents=brutto_vor_gutschein,
            )
            coupon_code = coupon.code
        except ShopConfigurationError as exc:
            raise ShopOrderError(str(exc)) from exc

    brutto = max(0, brutto_vor_gutschein - coupon_discount_cents)
    netto = round(brutto * 100 / (100 + tax_rate_percent))
    steuer = brutto - netto

    order = ShopOrder(
        number="",  # wird nach dem Flush aus der ID gesetzt
        user_id=user.id,
        status="pending_payment",
        currency=str(spec["currency"]),
        billing_interval=str(spec["billing_interval"]),
        billing_mode=billing_mode,
        months=months,
        duration_days=duration_days,
        discount_percent=discount,
        coupon_code=coupon_code,
        coupon_discount_cents=coupon_discount_cents,
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

    item_name = (
        f"{spec['name']} · {duration_days} Tage Prepaid"
        if duration_days is not None
        else str(spec["name"])
    )
    db.add(
        ShopOrderItem(
            order_id=order.id,
            kind=str(spec["kind"]),
            plan_id=spec["plan_id"],  # type: ignore[arg-type]
            addon_id=spec["addon_id"],  # type: ignore[arg-type]
            game_type=str(spec["game_type"]),
            name=item_name,
            quantity=1,
            unit_price_cents=monatlich,
            tax_rate_percent=tax_rate_percent,
            net_cents=netto,
            tax_cents=steuer,
            gross_cents=brutto,
            ram_mb=spec["ram_mb"],  # type: ignore[arg-type]
            cpu=spec["cpu"],  # type: ignore[arg-type]
            slots=spec["slots"],  # type: ignore[arg-type]
            preferred_node_id=spec.get("preferred_node_id"),  # type: ignore[arg-type]
            node_surcharge_cents=int(spec.get("node_surcharge_cents") or 0),  # type: ignore[arg-type]
            duration_days=duration_days,
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

    if order.coupon_code:
        from services import shop_coupon_service
        from services.shop_catalog_service import ShopConfigurationError

        try:
            shop_coupon_service.consume_coupon_redemption(db, order.coupon_code)
        except ShopConfigurationError as exc:
            raise ShopOrderError(str(exc)) from exc

    jetzt = _now()
    order.status = "paid"
    order.paid_at = jetzt
    order.payment_provider = provider
    order.payment_reference = reference
    if getattr(order, "extend_subscription_id", None) is not None:
        _apply_subscription_extension(db, order, jetzt)
    else:
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


def _apply_subscription_extension(
    db: Session, order: ShopOrder, jetzt: datetime
) -> None:
    target_sub = (
        db.query(ShopSubscription)
        .filter(
            ShopSubscription.id == order.extend_subscription_id,
            ShopSubscription.user_id == order.user_id,
        )
        .first()
    )
    if target_sub is None:
        raise ShopOrderError("Ziel-Abo zur Verlaengerung nicht gefunden")

    ents = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_item_id == target_sub.order_item_id)
        .all()
    )
    if any(getattr(ent, "provisioning_status", None) == "purged" for ent in ents):
        raise ShopOrderError(
            "Server wurde bereits endgueltig geloescht und kann nicht verlaengert werden"
        )

    end = target_sub.current_period_end
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    base = end if end > jetzt else jetzt
    order_days = getattr(order, "duration_days", None)
    if order_days is not None and int(order_days) > 0:
        target_sub.current_period_end = base + timedelta(days=int(order_days))
    else:
        target_sub.current_period_end = _add_months(base, order.months)
    target_sub.status = "active"
    target_sub.cancel_at_period_end = (
        getattr(target_sub, "billing_mode", "subscription") == "prepaid"
    )
    target_sub.delete_server_on_end = False
    _set_entitlements_status(db, target_sub, "active")


def _grant_entitlements(db: Session, order: ShopOrder, jetzt: datetime) -> None:
    items = (
        db.query(ShopOrderItem)
        .filter(ShopOrderItem.order_id == order.id)
        .order_by(ShopOrderItem.id.asc())
        .all()
    )
    billing_mode = getattr(order, "billing_mode", "subscription")
    order_days = getattr(order, "duration_days", None)
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
                    addon_id=item.addon_id,
                    game_type=item.game_type,
                    name=item.name,
                    status="active",
                    billing_interval=order.billing_interval,
                    billing_mode=billing_mode,
                    monthly_gross_cents=(
                        0
                        if billing_mode == "lifetime"
                        else (
                            item.unit_price_cents
                            if order_days is not None
                            else (
                                max(1, round(item.gross_cents / order.months))
                                if item.gross_cents > 0
                                else 0
                            )
                        )
                    ),
                    tax_rate_percent=item.tax_rate_percent,
                    started_at=jetzt,
                    current_period_end=(
                        jetzt + timedelta(days=36500)
                        if billing_mode == "lifetime"
                        else (
                            jetzt + timedelta(days=int(order_days))
                            if order_days is not None and int(order_days) > 0
                            else _add_months(jetzt, order.months)
                        )
                    ),
                    cancel_at_period_end=(billing_mode == "prepaid"),
                )
            )

        if item.kind == "addon":
            addon = (
                db.query(ShopAddon).filter(ShopAddon.id == item.addon_id).first()
                if item.addon_id is not None
                else None
            )
            addon_frei = (
                db.query(ShopEntitlement)
                .filter(
                    ShopEntitlement.order_item_id == item.id,
                    ShopEntitlement.kind == "addon",
                )
                .first()
            )
            if addon_frei is None:
                db.add(
                    ShopEntitlement(
                        user_id=order.user_id,
                        order_id=order.id,
                        order_item_id=item.id,
                        kind="addon",
                        label=item.name,
                        addon_id=item.addon_id,
                        role_id=addon.role_id if addon is not None else None,
                        slots=item.slots,
                    )
                )
            continue

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
                    preferred_node_id=getattr(item, "preferred_node_id", None),
                    duration_days=order_days,
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
    db: Session,
    subscription: ShopSubscription,
    status: str,
    *,
    reason: str | None = None,
) -> None:
    jetzt = _now()
    zeilen = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_item_id == subscription.order_item_id)
        .all()
    )
    for zeile in zeilen:
        zeile.status = status
        if status == "revoked":
            zeile.revoked_at = zeile.revoked_at or jetzt
            eff_reason = reason or (
                "voluntary_cancel" if subscription.cancel_at_period_end else "unpaid"
            )
            lifecycle_purge_service.mark_entitlement_revoked(
                zeile,
                reason=eff_reason,
                now=jetzt,
                immediate=bool(subscription.delete_server_on_end and eff_reason == "voluntary_cancel"),
                db=db,
            )
        elif status == "suspended":
            zeile.revoked_at = None
            lifecycle_purge_service.mark_entitlement_suspended(zeile, now=jetzt, db=db)
        else:
            zeile.revoked_at = None
            lifecycle_purge_service.clear_entitlement_purge(zeile)


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
        grund = "voluntary_cancel" if abo.cancel_at_period_end else "unpaid"
        _set_entitlements_status(db, abo, "revoked", reason=grund)
    elif abo.status == "past_due" and obj.get("status") == "unpaid":
        _set_entitlements_status(db, abo, "suspended", reason="unpaid")
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
    db: Session,
    subscription: ShopSubscription,
    *,
    actor_user_id: int,
    deletion_mode: str = "grace_period",
    confirm_server_name: str | None = None,
) -> ShopSubscription:
    """Kuendigt ein Abo zum Laufzeitende oder loescht verknuepfte Server sofort.

    ``deletion_mode`` steuert das Server-Schicksal bei freiwilliger Kuendigung:
    - ``grace_period``: Server bleibt nach Laufzeitende waehrend der Betreiber-Schonfrist.
    - ``end_of_period_immediate``: Server wird am Laufzeitende ohne Schonfrist geloescht.
    - ``immediate``: Abo und eigener Server werden sofort nach Namensbestaetigung geloescht.
    """
    from services import stripe_service

    if deletion_mode not in ("grace_period", "end_of_period_immediate", "immediate"):
        raise ShopOrderError("Unbekannter Loeschmodus")

    if deletion_mode == "immediate":
        if not shop_lifecycle_settings_service.allow_customer_immediate_delete(db=db):
            raise ShopOrderError("Sofortloeschung durch Kunden ist vom Betreiber deaktiviert")

        server_ent = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_item_id == subscription.order_item_id,
                ShopEntitlement.user_id == subscription.user_id,
                ShopEntitlement.kind == "server",
                ShopEntitlement.server_id.isnot(None),
                ShopEntitlement.provisioning_status != "purged",
            )
            .first()
        )
        if server_ent is not None:
            user = db.query(User).filter(User.id == subscription.user_id).first()
            if user is None:
                raise ShopOrderError("Kunde nicht gefunden")
            if subscription.status == "cancelled":
                raise ShopOrderError("Abo ist bereits gekuendigt")
            subscription.cancel_at_period_end = True
            subscription.delete_server_on_end = True
            db.flush()
            lifecycle_purge_service.customer_purge_own_server(
                db,
                user=user,
                entitlement_id=server_ent.id,
                confirm_server_name=confirm_server_name or "",
                origin="direct",
            )
            db.refresh(subscription)
            return subscription

        # Reines Add-on / Rollen-Abo ohne Server
        if subscription.status == "cancelled":
            raise ShopOrderError("Abo ist bereits gekuendigt")
        if subscription.provider_reference:
            stripe_service.cancel_subscription_immediately(
                subscription.provider_reference
            )
        subscription.status = "cancelled"
        subscription.cancel_at_period_end = True
        subscription.delete_server_on_end = True
        _set_entitlements_status(db, subscription, "revoked", reason="voluntary_cancel")
        audit_service.record_privileged_action(
            db,
            user_id=actor_user_id,
            action="shop.subscription.cancelled_immediately",
            target_type="shop_subscription",
            target_id=subscription.id,
            details={
                "order_id": subscription.order_id,
                "provider_reference": subscription.provider_reference,
            },
        )
        db.commit()
        from services import shop_fulfillment_service

        shop_fulfillment_service.sync_user_roles(
            db, subscription.user_id, actor_user_id=actor_user_id, origin="direct"
        )
        db.refresh(subscription)
        return subscription

    if subscription.status == "cancelled":
        raise ShopOrderError("Abo ist bereits gekuendigt")

    want_delete_on_end = deletion_mode == "end_of_period_immediate"
    if not subscription.cancel_at_period_end and subscription.provider_reference:
        stripe_service.cancel_subscription_at_period_end(
            subscription.provider_reference
        )
    subscription.cancel_at_period_end = True
    subscription.delete_server_on_end = want_delete_on_end
    audit_service.record_privileged_action(
        db,
        user_id=actor_user_id,
        action="shop.subscription.cancel_requested",
        target_type="shop_subscription",
        target_id=subscription.id,
        details={
            "order_id": subscription.order_id,
            "provider_reference": subscription.provider_reference,
            "deletion_mode": deletion_mode,
        },
    )
    db.commit()
    db.refresh(subscription)
    return subscription


def extend_subscription(
    db: Session,
    user: User,
    subscription: ShopSubscription,
    *,
    months: int = 1,
    duration_days: int | None = None,
) -> ShopOrder:
    """Erstellt eine Prepaid-Verlaengerungsbestellung ohne Datenverlust."""
    short_tier: dict[str, object] | None = None
    if duration_days is not None:
        if subscription.addon_id is not None:
            raise ShopDurationValidationError(
                "Kurzzeit-Verlaengerungen sind fuer Add-ons nicht verfuegbar"
            )
        if subscription.plan_id is not None:
            plan = db.query(ShopPlan).filter(ShopPlan.id == subscription.plan_id).first()
            if plan is not None and not bool(getattr(plan, "allow_short_durations", True)):
                raise ShopDurationValidationError(
                    "Kurzzeit-Laufzeiten sind fuer diesen Tarif deaktiviert"
                )
        short_tier = shop_lifecycle_settings_service.active_short_duration_tier(
            duration_days, db=db
        )
        if short_tier is None:
            raise ShopDurationValidationError("Diese Kurzzeit-Laufzeit ist nicht aktiv")
    elif months not in DURATION_DISCOUNTS:
        raise ShopOrderError("Ungueltige Laufzeit fuer die Verlaengerung")

    ents = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_item_id == subscription.order_item_id)
        .all()
    )
    if any(getattr(ent, "provisioning_status", None) == "purged" for ent in ents):
        raise ShopOrderError(
            "Server wurde bereits endgueltig geloescht und kann nicht verlaengert werden"
        )

    has_suspended_or_revoked = any(
        ent.status in ("suspended", "revoked") for ent in ents
    )
    if getattr(subscription, "billing_mode", "subscription") == "lifetime":
        raise ShopOrderError("Ein Lifetime-Vertrag laeuft zeitlich unbegrenzt")
    if (
        getattr(subscription, "billing_mode", "subscription") == "subscription"
        and subscription.status == "active"
        and not subscription.cancel_at_period_end
        and not has_suspended_or_revoked
    ):
        raise ShopOrderError("Aktives wiederkehrendes Abo verlaengert sich automatisch")

    orig_item = (
        db.query(ShopOrderItem)
        .filter(ShopOrderItem.id == subscription.order_item_id)
        .first()
    )
    orig_order = (
        db.query(ShopOrder).filter(ShopOrder.id == subscription.order_id).first()
    )

    monatlich = (
        int(orig_item.unit_price_cents)
        if orig_item is not None
        else int(subscription.monthly_gross_cents)
    )
    tax_rate = (
        int(orig_item.tax_rate_percent)
        if orig_item is not None
        else int(subscription.tax_rate_percent)
    )
    if short_tier is not None and duration_days is not None:
        eff_months = 1
        discount = 0
        brutto = calc_short_duration_gross_cents(
            monatlich,
            price_factor_percent=int(short_tier["price_factor_percent"]),  # type: ignore[arg-type]
            min_price_cents=int(short_tier["min_price_cents"]),  # type: ignore[arg-type]
        )
        verlaengerung_name = f"{subscription.name} (+{duration_days} Tage Prepaid)"
    else:
        eff_months = months
        discount = DURATION_DISCOUNTS[eff_months]
        brutto = max(0, round(monatlich * eff_months * (1 - discount / 100)))
        verlaengerung_name = f"{subscription.name} (+{eff_months} Mon.)"
    netto = round(brutto * 100 / (100 + tax_rate))
    steuer = brutto - netto

    order = ShopOrder(
        number="",
        user_id=user.id,
        status="pending_payment",
        currency=orig_order.currency if orig_order is not None else "EUR",
        billing_interval=subscription.billing_interval,
        billing_mode="prepaid",
        extend_subscription_id=subscription.id,
        months=eff_months,
        duration_days=duration_days,
        discount_percent=discount,
        coupon_code=None,
        coupon_discount_cents=0,
        buyer_name=orig_order.buyer_name if orig_order is not None else None,
        buyer_street=orig_order.buyer_street if orig_order is not None else None,
        buyer_postal_code=(
            orig_order.buyer_postal_code if orig_order is not None else None
        ),
        buyer_city=orig_order.buyer_city if orig_order is not None else None,
        buyer_country=orig_order.buyer_country if orig_order is not None else None,
        buyer_email=orig_order.buyer_email if orig_order is not None else None,
        net_cents=netto,
        tax_cents=steuer,
        gross_cents=brutto,
        payment_provider="demo",
    )
    db.add(order)
    db.flush()
    order.number = f"MSM-{_now().year}-{order.id:06d}"

    item_kind = orig_item.kind if orig_item is not None else ("addon" if subscription.addon_id else "plan")
    db.add(
        ShopOrderItem(
            order_id=order.id,
            kind=item_kind,
            plan_id=subscription.plan_id,
            addon_id=subscription.addon_id,
            game_type=subscription.game_type,
            name=verlaengerung_name,
            quantity=1,
            unit_price_cents=monatlich,
            tax_rate_percent=tax_rate,
            net_cents=netto,
            tax_cents=steuer,
            gross_cents=brutto,
            ram_mb=orig_item.ram_mb if orig_item is not None else None,
            cpu=orig_item.cpu if orig_item is not None else None,
            slots=orig_item.slots if orig_item is not None else None,
            duration_days=duration_days,
        )
    )
    db.commit()
    db.refresh(order)
    return order


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
        lifecycle_purge_service.mark_entitlement_revoked(
            ent, reason="refund", now=jetzt
        )

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


def create_manual_order(
    db: Session,
    payload: ShopAdminManualOrderCreate,
    *,
    actor_user_id: int,
) -> ShopOrder:
    """Erstellt eine Bestellung durch einen Operator fuer einen Kunden."""
    target_user = db.query(User).filter(User.id == payload.user_id).first()
    if target_user is None:
        raise ShopOrderError("Kunde nicht gefunden")

    order = create_order(
        db,
        target_user,
        ShopOrderCreate(
            plan_id=payload.plan_id,
            addon_id=payload.addon_id,
            months=payload.months,
            ram_mb=payload.ram_mb,
            cpu=payload.cpu,
            slots=payload.slots,
            preferred_node_id=getattr(payload, "preferred_node_id", None),
            coupon_code=payload.coupon_code,
            buyer_name=payload.buyer_name,
            buyer_street=payload.buyer_street,
            buyer_postal_code=payload.buyer_postal_code,
            buyer_city=payload.buyer_city,
            buyer_country=payload.buyer_country,
            buyer_email=payload.buyer_email,
        ),
    )
    order.payment_provider = "manual"
    if payload.mark_paid:
        apply_payment(
            db,
            order,
            provider="manual",
            reference=f"manual-{order.number}",
            origin="direct",
        )
    audit_service.record_privileged_action(
        db,
        user_id=actor_user_id,
        action="shop.order.manual_created",
        target_type="shop_order",
        target_id=order.id,
        details={
            "number": order.number,
            "target_user_id": target_user.id,
            "mark_paid": payload.mark_paid,
            "note": (payload.note or "").strip()[:200],
        },
        origin="direct",
    )
    db.commit()
    if payload.mark_paid:
        from services import shop_fulfillment_service

        shop_fulfillment_service.sync_order_entitlements(
            db, order.id, origin="direct"
        )
    db.refresh(order)
    return order


def order_response(db: Session, order: ShopOrder) -> ShopOrderResponse:
    return ShopOrderResponse(
        id=order.id,
        number=order.number,
        status=order.status,
        currency=order.currency,
        billing_interval=order.billing_interval,
        billing_mode=getattr(order, "billing_mode", "subscription"),
        extend_subscription_id=getattr(order, "extend_subscription_id", None),
        months=order.months,
        duration_days=getattr(order, "duration_days", None),
        discount_percent=order.discount_percent,
        coupon_code=order.coupon_code,
        coupon_discount_cents=order.coupon_discount_cents,
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
                plan_id=item.plan_id,
                addon_id=item.addon_id,
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
                preferred_node_id=getattr(item, "preferred_node_id", None),
                node_surcharge_cents=max(
                    0, int(getattr(item, "node_surcharge_cents", 0) or 0)
                ),
                duration_days=getattr(item, "duration_days", None),
            )
            for item in order_items(db, order.id)
        ],
    )


def subscription_response(
    row: ShopSubscription, db: Session | None = None
) -> ShopSubscriptionResponse:
    server_ent_id: int | None = None
    server_name: str | None = None
    can_immediate = False
    if db is not None:
        server_ent = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_item_id == row.order_item_id,
                ShopEntitlement.kind == "server",
                ShopEntitlement.server_id.isnot(None),
                ShopEntitlement.provisioning_status != "purged",
            )
            .first()
        )
        if server_ent is not None and server_ent.server_id is not None:
            server_ent_id = server_ent.id
            srv = db.query(Server).filter(Server.id == server_ent.server_id).first()
            if srv is not None:
                server_name = srv.name
            can_immediate = (
                shop_lifecycle_settings_service.allow_customer_immediate_delete(db=db)
                and server_ent.status != "suspended"
            )
    return ShopSubscriptionResponse(
        id=row.id,
        plan_id=row.plan_id,
        addon_id=row.addon_id,
        game_type=row.game_type,
        name=row.name,
        status=row.status,
        billing_interval=row.billing_interval,
        billing_mode=getattr(row, "billing_mode", "subscription"),
        monthly_gross_cents=row.monthly_gross_cents,
        tax_rate_percent=row.tax_rate_percent,
        started_at=row.started_at,
        current_period_end=row.current_period_end,
        cancel_at_period_end=row.cancel_at_period_end,
        delete_server_on_end=bool(getattr(row, "delete_server_on_end", False)),
        server_entitlement_id=server_ent_id,
        server_name=server_name,
        can_immediate_delete=can_immediate,
    )


def entitlement_response(
    row: ShopEntitlement, db: Session | None = None
) -> ShopEntitlementResponse:
    server_name: str | None = None
    can_purge_now = False
    if db is not None and row.server_id is not None:
        srv = db.query(Server).filter(Server.id == row.server_id).first()
        if srv is not None:
            server_name = srv.name
        can_purge_now = lifecycle_purge_service.can_customer_purge_entitlement(db, row)
    return ShopEntitlementResponse(
        id=row.id,
        kind=row.kind,
        addon_id=row.addon_id,
        label=row.label,
        status=row.status,
        server_id=row.server_id,
        server_name=server_name,
        provisioning_status=row.provisioning_status,
        provisioning_error=row.provisioning_error,
        purge_after=getattr(row, "purge_after", None),
        purge_reason=getattr(row, "purge_reason", None),
        purged_at=getattr(row, "purged_at", None),
        can_customer_purge_now=can_purge_now,
        paused_at=getattr(row, "paused_at", None),
        pause_days_used=int(getattr(row, "pause_days_used", 0) or 0),
        created_at=row.created_at,
    )


def _stop_server_for_pause(db: Session, *, server: Server, user: User) -> bool:
    if getattr(server, "status", None) in ("stopped", "offline"):
        return False
    from services import server_action_service
    from services.actor_context import ActorContext

    server_action_service.request_lifecycle_operation(
        db,
        server_id=server.id,
        operation="stop",
        actor=ActorContext.for_user(user),
        idempotency_key=f"shop-pause-{server.id}-{uuid4()}",
    )
    return True


def _start_server_for_resume(db: Session, *, server: Server, user: User) -> bool:
    if getattr(server, "status", None) in ("running", "starting"):
        return False
    from services import server_action_service
    from services.actor_context import ActorContext

    server_action_service.request_lifecycle_operation(
        db,
        server_id=server.id,
        operation="start",
        actor=ActorContext.for_user(user),
        idempotency_key=f"shop-resume-{server.id}-{uuid4()}",
    )
    return True


def pause_entitlement(
    db: Session, *, user: User, entitlement_id: int
) -> ShopEntitlement:
    """Stoppt den eigenen Server in Ressourcen-Standby ohne Datenverlust."""
    ent = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.id == entitlement_id,
            ShopEntitlement.user_id == user.id,
        )
        .first()
    )
    if ent is None:
        raise ShopNotFoundError("Vertrag nicht gefunden")
    if (
        ent.kind != "server"
        or ent.server_id is None
        or ent.provisioning_status == "purged"
    ):
        raise ShopOrderError("Nur ein bereitgestellter Server kann pausiert werden")
    if ent.status != "active":
        raise ShopOrderError("Nur aktive Server-Vertraege koennen pausiert werden")
    if getattr(ent, "paused_at", None) is not None:
        raise ShopOrderError("Server ist bereits pausiert")

    srv = db.query(Server).filter(Server.id == ent.server_id).first()
    if srv is None:
        raise ShopOrderError("Zugehoeriger Server existiert nicht mehr")

    _stop_server_for_pause(db, server=srv, user=user)
    ent.paused_at = _now()
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="shop.entitlement.paused",
        target_type="shop_entitlement",
        target_id=ent.id,
        details={"server_id": srv.id},
    )
    db.commit()
    db.refresh(ent)
    return ent


def resume_entitlement(
    db: Session, *, user: User, entitlement_id: int
) -> ShopEntitlement:
    """Setzt einen pausierten Server fort und schreibt ggf. Pause-Kontingent gut."""
    ent = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.id == entitlement_id,
            ShopEntitlement.user_id == user.id,
        )
        .first()
    )
    if ent is None:
        raise ShopNotFoundError("Vertrag nicht gefunden")
    if (
        ent.kind != "server"
        or ent.server_id is None
        or ent.provisioning_status == "purged"
    ):
        raise ShopOrderError("Kein aktiver Server vorhanden")
    if ent.status != "active":
        raise ShopOrderError(
            "Gesperrte oder widerrufene Vertraege koennen nicht fortgesetzt werden"
        )
    paused_at = getattr(ent, "paused_at", None)
    if paused_at is None:
        raise ShopOrderError("Server ist derzeit nicht pausiert")

    srv = db.query(Server).filter(Server.id == ent.server_id).first()
    if srv is None:
        raise ShopOrderError("Zugehoeriger Server existiert nicht mehr")

    _start_server_for_resume(db, server=srv, user=user)

    if paused_at.tzinfo is None:
        paused_at = paused_at.replace(tzinfo=timezone.utc)
    now = _now()
    elapsed_days = max(0, (now - paused_at).days)
    max_freeze = shop_lifecycle_settings_service.pause_freeze_max_days_per_90d(db=db)
    used_days = int(getattr(ent, "pause_days_used", 0) or 0)
    remaining_budget = max(0, max_freeze - used_days)
    credit_days = min(elapsed_days, remaining_budget)
    if credit_days > 0:
        sub = (
            db.query(ShopSubscription)
            .filter(ShopSubscription.order_item_id == ent.order_item_id)
            .order_by(ShopSubscription.id.desc())
            .first()
        )
        if (
            sub is not None
            and sub.status != "cancelled"
            and getattr(sub, "billing_mode", "subscription") != "lifetime"
        ):
            sub_end = sub.current_period_end
            if sub_end.tzinfo is None:
                sub_end = sub_end.replace(tzinfo=timezone.utc)
            sub.current_period_end = max(sub_end, now) + timedelta(days=credit_days)
            ent.pause_days_used = used_days + credit_days

    ent.paused_at = None
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="shop.entitlement.resumed",
        target_type="shop_entitlement",
        target_id=ent.id,
        details={"server_id": srv.id, "credit_days": credit_days},
    )
    db.commit()
    db.refresh(ent)
    return ent
