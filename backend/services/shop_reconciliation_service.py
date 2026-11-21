"""Abgleich-Dienst (Reconciliation) fuer Bestellungen, Rechnungen und Entitlements.

Schliesst Luecken nach verpassten Webhooks, nachtraeglich gepflegten
Verkaeuferdaten oder voruebergehenden Bereitstellungsfehlern.
"""

from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import ShopEntitlement, ShopInvoice, ShopOrder, ShopSubscription
from services import (
    audit_service,
    shop_fulfillment_service,
    shop_invoice_service,
    shop_order_service,
    stripe_service,
    stripe_settings_service,
)


def reconcile_shop(
    db: Session,
    *,
    actor_user_id: int,
    check_stripe: bool = True,
    retry_failed_entitlements: bool = True,
) -> dict:
    """Fuehrt einen idempotenten Abgleich ueber offene und bezahlte Orders aus."""
    orders_marked_paid = 0
    orders_expired = 0
    invoices_issued = 0
    entitlements_synced = 0
    errors: list[str] = []
    synced_order_ids: set[int] = set()

    offene_stripe = (
        db.query(ShopOrder)
        .filter(
            ShopOrder.status == "pending_payment",
            ShopOrder.payment_provider == "stripe",
            ShopOrder.payment_reference.isnot(None),
            ShopOrder.payment_reference.like("cs_%"),
        )
        .order_by(ShopOrder.id.asc())
        .all()
    )
    orders_checked = len(offene_stripe)

    if check_stripe and stripe_settings_service.resolve_secret_key():
        for order in offene_stripe:
            ref = order.payment_reference or ""
            try:
                session_obj = stripe_service.get_checkout_session(ref)
                if session_obj.get("payment_status") == "paid":
                    shop_order_service.apply_payment(
                        db,
                        order,
                        provider="stripe",
                        reference=ref,
                        origin="system",
                    )
                    sub_ref = session_obj.get("subscription")
                    if isinstance(sub_ref, str) and sub_ref:
                        abo = (
                            db.query(ShopSubscription)
                            .filter(ShopSubscription.order_id == order.id)
                            .order_by(ShopSubscription.id.desc())
                            .first()
                        )
                        if abo is not None and not abo.provider_reference:
                            abo.provider_reference = sub_ref
                    db.commit()
                    shop_fulfillment_service.sync_order_entitlements(
                        db, order.id, origin="system"
                    )
                    synced_order_ids.add(order.id)
                    orders_marked_paid += 1
                elif session_obj.get("status") == "expired":
                    order.status = "cancelled"
                    db.commit()
                    orders_expired += 1
            except (stripe_service.StripeError, shop_order_service.ShopOrderError):
                db.rollback()
                errors.append(f"order:{order.id}:stripe_reconcile_failed")

    bezahlte_ohne_rechnung = (
        db.query(ShopOrder)
        .filter(
            ShopOrder.status == "paid",
            ~db.query(ShopInvoice.id)
            .filter(
                ShopInvoice.order_id == ShopOrder.id,
                ShopInvoice.type == "invoice",
            )
            .exists(),
        )
        .order_by(ShopOrder.id.asc())
        .all()
    )
    for order in bezahlte_ohne_rechnung:
        beleg = shop_invoice_service.ensure_invoice_for_order(db, order)
        if beleg is not None:
            db.commit()
            invoices_issued += 1

    # Bezahlte Bestellungen ohne Entitlements nachziehen.
    bezahlte_ohne_entitlements = (
        db.query(ShopOrder)
        .filter(
            ShopOrder.status == "paid",
            ~db.query(ShopEntitlement.id)
            .filter(ShopEntitlement.order_id == ShopOrder.id)
            .exists(),
        )
        .order_by(ShopOrder.id.asc())
        .all()
    )
    for order in bezahlte_ohne_entitlements:
        shop_order_service._grant_entitlements(
            db, order, order.paid_at or shop_order_service._now()
        )
        db.commit()

    # Unsynchronisierte bzw. fehlgeschlagene Entitlements abgleichen.
    aktiver_filter = [
        ShopEntitlement.provisioning_status.is_(None),
        ShopEntitlement.provisioning_status == "pending",
    ]
    if retry_failed_entitlements:
        aktiver_filter.append(ShopEntitlement.provisioning_status == "failed")

    zu_syncen = (
        db.query(ShopEntitlement.order_id)
        .filter(
            or_(
                (ShopEntitlement.status == "active") & or_(*aktiver_filter),
                ShopEntitlement.status.in_(("suspended", "revoked"))
                & (
                    ShopEntitlement.provisioning_status.is_(None)
                    | (ShopEntitlement.provisioning_status != ShopEntitlement.status)
                ),
            )
        )
        .distinct()
        .order_by(ShopEntitlement.order_id.asc())
        .all()
    )
    for (order_id,) in zu_syncen:
        if order_id in synced_order_ids:
            continue
        shop_fulfillment_service.sync_order_entitlements(
            db, order_id, origin="system"
        )
        synced_order_ids.add(order_id)
        entitlements_synced += 1

    pending_orders_remaining = (
        db.query(ShopOrder)
        .filter(ShopOrder.status == "pending_payment")
        .count()
    )
    failed_entitlements_remaining = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.status == "active",
            ShopEntitlement.provisioning_status == "failed",
        )
        .count()
    )

    report = {
        "orders_checked": orders_checked,
        "orders_marked_paid": orders_marked_paid,
        "orders_expired": orders_expired,
        "invoices_issued": invoices_issued,
        "entitlements_synced": entitlements_synced,
        "pending_orders_remaining": pending_orders_remaining,
        "failed_entitlements_remaining": failed_entitlements_remaining,
        "errors": errors,
    }
    audit_service.record_privileged_action(
        db,
        user_id=actor_user_id,
        action="shop.reconcile.completed",
        target_type="shop",
        target_id="reconciliation",
        details={k: v for k, v in report.items() if k != "errors"}
        | {"error_count": len(errors)},
    )
    db.commit()
    return report
