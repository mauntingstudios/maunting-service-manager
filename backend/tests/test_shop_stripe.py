"""Stripe-Vorbereitung des Shops: Checkout, Signaturpruefung, Idempotenz."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import ShopEntitlement, ShopSubscription
from services import stripe_service, stripe_settings_service

WEBHOOK_SECRET = "whsec_test_secret_not_real"


def _plan(client: TestClient, owner_cookies: dict, csrf_token: str) -> dict:
    res = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "game_type": "palworld",
            "name": f"Palworld Stripe {uuid4().hex[:8]}",
            "price_cents": 699,
            "currency": "EUR",
            "billing_interval": "month",
            "tax_rate_percent": 19,
            "ram_included_mb": 8192,
            "ram_max_mb": 16384,
            "ram_step_mb": 1024,
            "price_per_ram_step_cents": 90,
            "cpu_included": 2,
            "cpu_max": 4,
            "cpu_step": 1,
            "price_per_cpu_step_cents": 150,
            "slots_included": 8,
            "slots_max": 32,
            "slots_step": 1,
            "price_per_slot_step_cents": 30,
            "artwork_mode": "steam",
            "active": True,
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def _order(
    client: TestClient,
    user_cookies: dict,
    user_csrf_token: str,
    plan_id: int,
    months: int = 1,
) -> dict:
    res = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan_id, "months": months},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _configure() -> None:
    stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
    stripe_settings_service.set_webhook_secret(WEBHOOK_SECRET)


def _sign(payload: bytes, stamp: int | None = None) -> str:
    t = stamp if stamp is not None else int(time.time())
    digest = hmac.new(
        WEBHOOK_SECRET.encode(), f"{t}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return f"t={t},v1={digest}"


def _event(
    order_id: int,
    event_id: str = "evt_test_1",
    typ: str = "checkout.session.completed",
    subscription: str | None = None,
) -> dict:
    session: dict = {
        "id": "cs_test_123",
        "metadata": {"order_id": str(order_id)},
    }
    if subscription:
        session["subscription"] = subscription
    return {"id": event_id, "type": typ, "data": {"object": session}}


def _invoice_event(
    order_id: int,
    subscription: str,
    *,
    event_id: str,
    typ: str = "invoice.paid",
    period_end: int | None = None,
) -> dict:
    return {
        "id": event_id,
        "type": typ,
        "data": {
            "object": {
                "subscription": subscription,
                "parent": {
                    "subscription_details": {
                        "subscription": subscription,
                        "metadata": {"order_id": str(order_id)},
                    }
                },
                "lines": {
                    "data": [
                        {
                            "period": {
                                "start": int(time.time()),
                                "end": period_end or int(time.time()) + 30 * 86400,
                            }
                        }
                    ]
                },
            }
        },
    }


def _subscription_event(
    subscription: str,
    *,
    event_id: str,
    typ: str,
    status: str,
    cancel_at_period_end: bool = False,
) -> dict:
    return {
        "id": event_id,
        "type": typ,
        "data": {
            "object": {
                "id": subscription,
                "status": status,
                "cancel_at_period_end": cancel_at_period_end,
                "current_period_end": int(time.time()) + 30 * 86400,
            }
        },
    }


def _post_webhook(client: TestClient, payload: bytes):
    return client.post(
        "/api/shop/stripe/webhook",
        content=payload,
        headers={"Stripe-Signature": _sign(payload)},
    )


class TestStripeCheckout:
    def test_checkout_without_keys_is_rejected(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"])
        res = client.post(
            f"/api/shop/orders/{order['id']}/checkout",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert res.status_code == 409

    def test_checkout_stores_session_and_redirects(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
        monkeypatch,
    ):
        _configure()
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"])

        aufrufe: list[list[tuple[str, str]]] = []

        def fake_post(path, data, secret):
            aufrufe.append(list(data))
            assert secret == "sk_test_placeholder_not_real"
            return {"id": "cs_test_999", "url": "https://checkout.stripe.test/999"}

        monkeypatch.setattr(stripe_service, "_post_form", fake_post)

        res = client.post(
            f"/api/shop/orders/{order['id']}/checkout",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert res.status_code == 200, res.text
        assert res.json()["checkout_url"] == "https://checkout.stripe.test/999"

        felder = dict(aufrufe[0])
        assert felder["line_items[0][price_data][unit_amount]"] == str(order["gross_cents"])
        assert felder["metadata[order_id]"] == str(order["id"])
        assert felder["mode"] == "subscription"

        gespeichert = client.get(
            f"/api/shop/orders/{order['id']}", cookies=user_cookies
        ).json()
        assert gespeichert["payment_provider"] == "stripe"
        assert gespeichert["payment_reference"] == "cs_test_999"

    def test_foreign_order_checkout_is_invisible(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _configure()
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"])
        res = client.post(
            f"/api/shop/orders/{order['id']}/checkout",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert res.status_code == 404


class TestStripeWebhook:
    def test_completed_session_marks_order_paid(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _configure()
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"])
        payload = json.dumps(_event(order["id"])).encode()

        res = client.post(
            "/api/shop/stripe/webhook",
            content=payload,
            headers={"Stripe-Signature": _sign(payload)},
        )
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "processed"

        gespeichert = client.get(
            f"/api/shop/orders/{order['id']}", cookies=user_cookies
        ).json()
        assert gespeichert["status"] == "paid"
        assert gespeichert["payment_provider"] == "stripe"
        assert gespeichert["payment_reference"] == "cs_test_123"
        assert len(client.get("/api/shop/subscriptions", cookies=user_cookies).json()) == 1
        assert len(client.get("/api/shop/entitlements", cookies=user_cookies).json()) == 1

        wieder = client.post(
            "/api/shop/stripe/webhook",
            content=payload,
            headers={"Stripe-Signature": _sign(payload)},
        )
        assert wieder.status_code == 200
        assert wieder.json()["status"] == "duplicate"
        assert len(client.get("/api/shop/subscriptions", cookies=user_cookies).json()) == 1

    def test_bad_signature_is_rejected_without_state_change(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _configure()
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"])
        payload = json.dumps(_event(order["id"])).encode()

        falsch = hmac.new(b"wrong", payload, hashlib.sha256).hexdigest()
        res = client.post(
            "/api/shop/stripe/webhook",
            content=payload,
            headers={"Stripe-Signature": f"t={int(time.time())},v1={falsch}"},
        )
        assert res.status_code == 400
        gespeichert = client.get(
            f"/api/shop/orders/{order['id']}", cookies=user_cookies
        ).json()
        assert gespeichert["status"] == "pending_payment"
        assert client.get("/api/shop/entitlements", cookies=user_cookies).json() == []

    def test_old_signature_is_rejected(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _configure()
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"])
        payload = json.dumps(_event(order["id"])).encode()
        alt = int(time.time()) - 3600
        res = client.post(
            "/api/shop/stripe/webhook",
            content=payload,
            headers={"Stripe-Signature": _sign(payload, stamp=alt)},
        )
        assert res.status_code == 400


class TestStripeKeys:
    def test_status_hides_secrets(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        res = client.put(
            "/api/shop/stripe/keys",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "secret_key": "sk_test_placeholder_not_real",
                "webhook_secret": WEBHOOK_SECRET,
                "publishable_key": "pk_test_public_not_real",
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["configured"] is True
        assert body["mode"] == "test"
        assert body["publishable_key"] == "pk_test_public_not_real"
        assert "secret_key" not in body
        assert "webhook_secret" not in body

        status = client.get("/api/shop/stripe/status", cookies=owner_cookies)
        assert status.status_code == 200
        assert status.json()["configured"] is True

    def test_regular_user_cannot_set_keys(
        self, client: TestClient, user_cookies: dict, user_csrf_token: str
    ):
        res = client.put(
            "/api/shop/stripe/keys",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"secret_key": "sk_test_placeholder_not_real"},
        )
        assert res.status_code == 403


class TestStripeBilling:
    def _ablauf(self, client, owner_cookies, csrf_token, user_cookies, user_csrf_token, monkeypatch, months: int = 1):
        _configure()
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"], months=months)
        aufrufe: list[list[tuple[str, str]]] = []

        def fake_post(path, data, secret):
            aufrufe.append(list(data))
            return {"id": "cs_test_999", "url": "https://checkout.stripe.test/999"}

        monkeypatch.setattr(stripe_service, "_post_form", fake_post)
        res = client.post(
            f"/api/shop/orders/{order['id']}/checkout",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert res.status_code == 200, res.text
        return order, dict(aufrufe[0])

    def test_monthly_order_uses_subscription_mode(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str, monkeypatch,
    ):
        order, felder = self._ablauf(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token, monkeypatch
        )
        assert felder["mode"] == "subscription"
        assert felder["line_items[0][price_data][recurring][interval]"] == "month"
        assert felder["line_items[0][price_data][unit_amount]"] == str(order["gross_cents"])
        assert felder["subscription_data[metadata][order_id]"] == str(order["id"])

    def test_prepaid_year_uses_single_payment(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str, monkeypatch,
    ):
        order, felder = self._ablauf(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token, monkeypatch, months=12
        )
        assert felder["mode"] == "payment"
        assert "line_items[0][price_data][recurring][interval]" not in felder
        assert felder["line_items[0][price_data][unit_amount]"] == str(order["gross_cents"])

    def _abo_starten(self, client, owner_cookies, csrf_token, user_cookies, user_csrf_token, db: Session, sub_id: str = "sub_test_1"):
        _configure()
        plan = _plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"])
        payload = json.dumps(
            _event(order["id"], subscription=sub_id)
        ).encode()
        assert _post_webhook(client, payload).status_code == 200
        return order

    def test_checkout_completed_attaches_stripe_subscription(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str, db: Session,
    ):
        self._abo_starten(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token, db
        )
        db.expire_all()
        abo = db.query(ShopSubscription).first()
        assert abo is not None
        assert abo.provider_reference == "sub_test_1"

    def test_invoice_paid_reactivates_and_extends(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str, db: Session,
    ):
        order = self._abo_starten(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token, db
        )
        db.expire_all()
        abo = db.query(ShopSubscription).first()
        abo.status = "past_due"
        db.query(ShopEntitlement).update({"status": "suspended"})
        db.commit()

        ende = int(time.time()) + 90 * 86400
        event = _invoice_event(order["id"], "sub_test_1", event_id="evt_inv_paid", period_end=ende)
        payload = json.dumps(event).encode()
        assert _post_webhook(client, payload).status_code == 200

        db.expire_all()
        abo = db.query(ShopSubscription).first()
        assert abo.status == "active"
        assert int(abo.current_period_end.timestamp()) >= ende - 5
        assert db.query(ShopEntitlement).first().status == "active"

    def test_payment_failed_keeps_grace(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str, db: Session,
    ):
        order = self._abo_starten(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token, db
        )
        event = _invoice_event(
            order["id"], "sub_test_1", event_id="evt_inv_failed", typ="invoice.payment_failed"
        )
        payload = json.dumps(event).encode()
        assert _post_webhook(client, payload).status_code == 200

        db.expire_all()
        assert db.query(ShopSubscription).first().status == "past_due"
        assert db.query(ShopEntitlement).first().status == "active"

    def test_unpaid_suspends_and_deleted_revokes(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str, db: Session,
    ):
        self._abo_starten(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token, db
        )
        unpaid = _subscription_event(
            "sub_test_1", event_id="evt_sub_unpaid",
            typ="customer.subscription.updated", status="unpaid",
        )
        assert _post_webhook(client, json.dumps(unpaid).encode()).status_code == 200
        db.expire_all()
        assert db.query(ShopSubscription).first().status == "past_due"
        assert db.query(ShopEntitlement).first().status == "suspended"

        geloescht = _subscription_event(
            "sub_test_1", event_id="evt_sub_deleted",
            typ="customer.subscription.deleted", status="canceled",
        )
        assert _post_webhook(client, json.dumps(geloescht).encode()).status_code == 200
        db.expire_all()
        assert db.query(ShopSubscription).first().status == "cancelled"
        assert db.query(ShopEntitlement).first().status == "revoked"
