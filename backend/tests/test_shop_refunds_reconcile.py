"""Kundenkuendigung, Refunds/Gutschriften und Reconciliation des nativen Shops."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    Role,
    RolePermission,
    Server,
    ServerPermission,
    ShopEntitlement,
    ShopInvoice,
    ShopOrder,
    ShopSubscription,
    User,
)
from services import (
    permission_service,
    role_service,
    shop_seller_settings_service,
    stripe_service,
    stripe_settings_service,
)
from services.auth_service import AuthService
from services.operation_task_service import TASK_SERVER_PROVISION, create_or_reuse_task
from services.server_provisioning_service import ProvisioningResult


WEBHOOK_SECRET = "whsec_refund_test_not_real"

SELLER = {
    "name": "Maunting Studios Test",
    "street": "Teststrasse 1",
    "postal_code": "12345",
    "city": "Teststadt",
    "country": "DE",
    "email": "rechnung@example.invalid",
    "phone": "+49 123 456",
    "vat_id": "DE123456789",
    "tax_number": "",
    "iban": "DE02120300000000202051",
    "bic": "BYLADEM1001",
    "payment_terms_days": 14,
    "invoice_prefix": "RE",
    "small_business": False,
}

BUYER = {
    "buyer_name": "Max Testkunde",
    "buyer_street": "Kundenweg 7",
    "buyer_postal_code": "54321",
    "buyer_city": "Kundenstadt",
    "buyer_country": "DE",
    "buyer_email": "kunde@example.invalid",
}


def _fake_provision():
    def _provision(
        session: Session,
        request,
        actor,
        *,
        idempotency_key: str | None = None,
        retry_of_id: str | None = None,
    ) -> ProvisioningResult:
        task, created = create_or_reuse_task(
            session,
            actor=actor,
            task_type=TASK_SERVER_PROVISION,
            request_hash=hashlib.sha256(
                json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()
            ).hexdigest(),
            idempotency_key=idempotency_key,
            retry_of_id=retry_of_id,
        )
        if not created:
            server = session.query(Server).filter(Server.id == task.server_id).first()
            return ProvisioningResult(
                server=server, task=task, postgres_credentials=[], reused=True
            )
        server = Server(
            name=request.name,
            game_type=request.game_type or "palworld",
            install_dir=f"/tmp/shop-{uuid4().hex[:8]}",
            container_name=f"msm-shop-{uuid4().hex[:8]}",
            status="stopped",
            cpu_limit_percent=request.cpu_limit_percent,
            ram_limit_mb=request.ram_limit_mb,
            node_id=request.node_id,
        )
        session.add(server)
        session.flush()
        task.server_id = server.id
        task.status = "succeeded"
        task.phase = "completed"
        session.commit()
        session.refresh(server)
        session.refresh(task)
        return ProvisioningResult(
            server=server, task=task, postgres_credentials=[]
        )

    return _provision


def _role(db: Session, name: str, *, keys: tuple[str, ...] = ()) -> Role:
    role = Role(name=name, is_system=False)
    db.add(role)
    db.flush()
    for key in keys:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    db.refresh(role)
    return role


def _create_plan(
    client: TestClient, owner_cookies: dict, csrf_token: str, **overrides
) -> dict:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld {uuid4().hex[:8]}",
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
    }
    payload.update(overrides)
    res = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=payload,
    )
    assert res.status_code == 200, res.text
    return res.json()


def _create_order(
    client: TestClient,
    user_cookies: dict,
    user_csrf_token: str,
    plan_id: int,
    *,
    months: int = 1,
    with_buyer: bool = True,
) -> dict:
    extra = BUYER if with_buyer else {}
    res = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan_id, "months": months, **extra},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _sign_stripe(payload: bytes) -> str:
    t = int(time.time())
    digest = hmac.new(
        WEBHOOK_SECRET.encode(), f"{t}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return f"t={t},v1={digest}"


def _login(client: TestClient, username: str, password: str) -> dict:
    res = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert res.status_code == 200, res.text
    return dict(res.cookies)


class TestShopSubscriptionCancel:
    def test_customer_can_cancel_demo_subscription_idempotently(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])
        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            assert (
                client.post(
                    f"/api/shop/orders/{order['id']}/demo-pay",
                    cookies=user_cookies,
                    headers={"X-CSRF-Token": user_csrf_token},
                ).status_code
                == 200
            )

        abos = client.get("/api/shop/subscriptions", cookies=user_cookies).json()
        assert len(abos) == 1
        assert abos[0]["cancel_at_period_end"] is False
        sub_id = abos[0]["id"]

        res = client.post(
            f"/api/shop/subscriptions/{sub_id}/cancel",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert res.status_code == 200, res.text
        assert res.json()["cancel_at_period_end"] is True
        assert res.json()["status"] == "active"

        # Idempotent bei wiederholtem Klick.
        again = client.post(
            f"/api/shop/subscriptions/{sub_id}/cancel",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert again.status_code == 200
        assert again.json()["cancel_at_period_end"] is True

    def test_customer_can_cancel_stripe_subscription(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        monkeypatch,
    ):
        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
        stripe_settings_service.set_webhook_secret(WEBHOOK_SECRET)
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        evt = json.dumps(
            {
                "id": "evt_cancel_setup",
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_cancel_1",
                        "subscription": "sub_cancel_1",
                        "metadata": {"order_id": str(order["id"])},
                    }
                },
            }
        ).encode()

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            assert (
                client.post(
                    "/api/shop/stripe/webhook",
                    content=evt,
                    headers={"Stripe-Signature": _sign_stripe(evt)},
                ).status_code
                == 200
            )

        aufrufe: list[tuple[str, list[tuple[str, str]]]] = []

        def fake_post(path, data, secret, **kwargs):
            aufrufe.append((path, list(data)))
            return {"id": "sub_cancel_1", "cancel_at_period_end": True}

        monkeypatch.setattr(stripe_service, "_post_form", fake_post)
        abo_id = client.get("/api/shop/subscriptions", cookies=user_cookies).json()[0]["id"]
        res = client.post(
            f"/api/shop/subscriptions/{abo_id}/cancel",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert res.status_code == 200, res.text
        assert res.json()["cancel_at_period_end"] is True
        assert aufrufe == [
            ("/subscriptions/sub_cancel_1", [("cancel_at_period_end", "true")])
        ]

    def test_cancel_negative_cases(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        monkeypatch,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])
        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            assert (
                client.post(
                    f"/api/shop/orders/{order['id']}/demo-pay",
                    cookies=user_cookies,
                    headers={"X-CSRF-Token": user_csrf_token},
                ).status_code
                == 200
            )
        abo_id = client.get("/api/shop/subscriptions", cookies=user_cookies).json()[0]["id"]

        # Ohne CSRF -> 403.
        assert (
            client.post(
                f"/api/shop/subscriptions/{abo_id}/cancel",
                cookies=user_cookies,
            ).status_code
            == 403
        )

        # Fremdes Abo -> 404.
        other = AuthService.create_user(
            db, "other-sub-user", "othersub@test.de", "OtherPass123!"
        )
        other.email_verified = True
        db.commit()
        other_cookies = _login(client, "other-sub-user", "OtherPass123!")
        other_csrf = other_cookies.get("__Secure-csrf_token", "")
        assert (
            client.post(
                f"/api/shop/subscriptions/{abo_id}/cancel",
                cookies=other_cookies,
                headers={"X-CSRF-Token": other_csrf},
            ).status_code
            == 404
        )

        # Stripe-Abo ohne Stripe-Key -> 409, DB bleibt unveraendert.
        stripe_settings_service.set_secret_key("")
        abo = db.query(ShopSubscription).filter(ShopSubscription.id == abo_id).one()
        abo.provider_reference = "sub_no_key"
        db.commit()
        assert (
            client.post(
                f"/api/shop/subscriptions/{abo_id}/cancel",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 409
        )
        db.refresh(abo)
        assert abo.cancel_at_period_end is False

        # Stripe-API-Fehler -> 502, DB bleibt unveraendert.
        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")

        def failing_post(path, data, secret, **kwargs):
            raise stripe_service.StripeError("upstream error")

        monkeypatch.setattr(stripe_service, "_post_form", failing_post)
        assert (
            client.post(
                f"/api/shop/subscriptions/{abo_id}/cancel",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 502
        )
        db.refresh(abo)
        assert abo.cancel_at_period_end is False

        # Bereits gekuendigtes Abo -> 409.
        abo.status = "cancelled"
        db.commit()
        assert (
            client.post(
                f"/api/shop/subscriptions/{abo_id}/cancel",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 409
        )


class TestShopRefunds:
    def test_admin_refund_demo_order_credits_invoice_and_revokes_entitlements(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        shop_seller_settings_service.update(SELLER)
        ai_role = _role(db, f"ki-ref-{uuid4().hex[:6]}", keys=("ai.chat.use",))
        plan = _create_plan(client, owner_cookies, csrf_token, role_id=ai_role.id)
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ), patch(
            "services.server_action_service.request_lifecycle_operation",
            return_value={"status": "queued", "operation": "stop", "task_id": "t-ref"},
        ) as mock_stop:
            assert (
                client.post(
                    f"/api/shop/orders/{order['id']}/demo-pay",
                    cookies=user_cookies,
                    headers={"X-CSRF-Token": user_csrf_token},
                ).status_code
                == 200
            )
            srv_ent = (
                db.query(ShopEntitlement)
                .filter(
                    ShopEntitlement.order_id == order["id"],
                    ShopEntitlement.kind == "server",
                )
                .one()
            )
            server_id = srv_ent.server_id
            assert server_id is not None

            refunded = client.post(
                f"/api/shop/orders/{order['id']}/refund",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"reason": "Widerruf innerhalb 14 Tagen"},
            )
            assert refunded.status_code == 200, refunded.text
            body = refunded.json()
            assert body["order"]["status"] == "refunded"
            assert body["credit_note_number"].startswith("GS-")

        assert mock_stop.call_count == 1
        db.expire_all()
        rechnungen = (
            db.query(ShopInvoice)
            .filter(ShopInvoice.order_id == order["id"])
            .order_by(ShopInvoice.id.asc())
            .all()
        )
        assert [r.type for r in rechnungen] == ["invoice", "credit_note"]
        assert rechnungen[0].status == "void"
        assert rechnungen[1].number == body["credit_note_number"]

        abo = (
            db.query(ShopSubscription)
            .filter(ShopSubscription.order_id == order["id"])
            .one()
        )
        assert abo.status == "cancelled"
        assert abo.cancel_at_period_end is True

        for ent in (
            db.query(ShopEntitlement)
            .filter(ShopEntitlement.order_id == order["id"])
            .all()
        ):
            assert ent.status == "revoked"
            assert ent.provisioning_status == "revoked"

        assert (
            db.query(ServerPermission)
            .filter(
                ServerPermission.user_id == regular_user.id,
                ServerPermission.server_id == server_id,
            )
            .count()
            == 0
        )
        assert ai_role.id not in role_service.effective_user_role_ids(db, regular_user)

    def test_admin_refund_stripe_order_calls_stripe_with_idempotency_key(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        monkeypatch,
    ):
        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
        stripe_settings_service.set_webhook_secret(WEBHOOK_SECRET)
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        evt = json.dumps(
            {
                "id": "evt_stripe_ref_setup",
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_ref_1",
                        "subscription": "sub_ref_1",
                        "metadata": {"order_id": str(order["id"])},
                    }
                },
            }
        ).encode()

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            assert (
                client.post(
                    "/api/shop/stripe/webhook",
                    content=evt,
                    headers={"Stripe-Signature": _sign_stripe(evt)},
                ).status_code
                == 200
            )

        get_calls: list[str] = []
        post_calls: list[tuple[str, dict, str | None]] = []

        def fake_get(path, secret):
            get_calls.append(path)
            return {"id": "cs_ref_1", "payment_intent": "pi_ref_1"}

        def fake_post(path, data, secret, **kwargs):
            post_calls.append((path, dict(data), kwargs.get("idempotency_key")))
            return {"id": "re_test_1"}

        monkeypatch.setattr(stripe_service, "_get_json", fake_get)
        monkeypatch.setattr(stripe_service, "_post_form", fake_post)

        with patch(
            "services.server_action_service.request_lifecycle_operation",
            return_value={"status": "queued", "operation": "stop", "task_id": "t-2"},
        ):
            res = client.post(
                f"/api/shop/orders/{order['id']}/refund",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"reason": "Kundenwunsch Stripe"},
            )
        assert res.status_code == 200, res.text
        assert res.json()["order"]["status"] == "refunded"
        assert get_calls == ["/checkout/sessions/cs_ref_1"]
        assert post_calls[0] == (
            "/refunds",
            {"payment_intent": "pi_ref_1", "reason": "requested_by_customer"},
            f"shop-refund-order-{order['id']}",
        )
        assert post_calls[1] == (
            "/subscriptions/sub_ref_1",
            {"cancel_at_period_end": "true"},
            None,
        )

    def test_stripe_charge_refunded_webhook_credits_and_ignores_partial(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        shop_seller_settings_service.update(SELLER)
        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
        stripe_settings_service.set_webhook_secret(WEBHOOK_SECRET)
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _create_order(
            client, user_cookies, user_csrf_token, plan["id"], months=3
        )

        paid_evt = json.dumps(
            {
                "id": "evt_ch_paid",
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_ch_1",
                        "metadata": {"order_id": str(order["id"])},
                    }
                },
            }
        ).encode()

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ), patch(
            "services.server_action_service.request_lifecycle_operation",
            return_value={"status": "queued", "operation": "stop", "task_id": "t-3"},
        ):
            assert (
                client.post(
                    "/api/shop/stripe/webhook",
                    content=paid_evt,
                    headers={"Stripe-Signature": _sign_stripe(paid_evt)},
                ).status_code
                == 200
            )

            # Teil-Refund darf die Order noch nicht widerrufen.
            partial = json.dumps(
                {
                    "id": "evt_ch_partial",
                    "type": "charge.refunded",
                    "data": {
                        "object": {
                            "id": "ch_1",
                            "refunded": False,
                            "amount": 1000,
                            "amount_refunded": 300,
                            "metadata": {"order_id": str(order["id"])},
                        }
                    },
                }
            ).encode()
            assert (
                client.post(
                    "/api/shop/stripe/webhook",
                    content=partial,
                    headers={"Stripe-Signature": _sign_stripe(partial)},
                ).status_code
                == 200
            )
            db.expire_all()
            assert (
                db.query(ShopOrder).filter(ShopOrder.id == order["id"]).one().status
                == "paid"
            )

            # Voller Refund erstattet Order, storniert Rechnung & entzieht Entitlements.
            full = json.dumps(
                {
                    "id": "evt_ch_full",
                    "type": "charge.refunded",
                    "data": {
                        "object": {
                            "id": "ch_1",
                            "refunded": True,
                            "amount": 1000,
                            "amount_refunded": 1000,
                            "metadata": {"order_id": str(order["id"])},
                        }
                    },
                }
            ).encode()
            res = client.post(
                "/api/shop/stripe/webhook",
                content=full,
                headers={"Stripe-Signature": _sign_stripe(full)},
            )
            assert res.status_code == 200
            assert res.json()["status"] == "processed"

            # Wiederholung -> duplicate.
            dup = client.post(
                "/api/shop/stripe/webhook",
                content=full,
                headers={"Stripe-Signature": _sign_stripe(full)},
            )
            assert dup.status_code == 200
            assert dup.json()["status"] == "duplicate"

        db.expire_all()
        assert (
            db.query(ShopOrder).filter(ShopOrder.id == order["id"]).one().status
            == "refunded"
        )
        assert (
            db.query(ShopInvoice)
            .filter(
                ShopInvoice.order_id == order["id"],
                ShopInvoice.type == "credit_note",
            )
            .count()
            == 1
        )
        assert (
            db.query(ShopEntitlement)
            .filter(ShopEntitlement.order_id == order["id"])
            .one()
            .provisioning_status
            == "revoked"
        )

    def test_refund_negative_cases(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        monkeypatch,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        unpaid = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        # Normaler User -> 403.
        assert (
            client.post(
                f"/api/shop/orders/{unpaid['id']}/refund",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"reason": "Unbefugter Refund"},
            ).status_code
            == 403
        )

        # Fehlendes CSRF -> 403.
        assert (
            client.post(
                f"/api/shop/orders/{unpaid['id']}/refund",
                cookies=owner_cookies,
                json={"reason": "Kein CSRF Token"},
            ).status_code
            == 403
        )

        # Unbekannte Order -> 404.
        assert (
            client.post(
                "/api/shop/orders/999999/refund",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"reason": "Unbekannt"},
            ).status_code
            == 404
        )

        # Zu kurzer / leerer Grund -> 422.
        assert (
            client.post(
                f"/api/shop/orders/{unpaid['id']}/refund",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"reason": "   "},
            ).status_code
            == 422
        )

        # Unbezahlte Order -> 409.
        assert (
            client.post(
                f"/api/shop/orders/{unpaid['id']}/refund",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"reason": "Nicht bezahlt"},
            ).status_code
            == 409
        )

        # Stripe-Fehler waehrend Refund darf lokalen Zustand nicht veraendern.
        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
        order = db.query(ShopOrder).filter(ShopOrder.id == unpaid["id"]).one()
        order.status = "paid"
        order.payment_provider = "stripe"
        order.payment_reference = "pi_fail_1"
        db.commit()

        def failing_post(path, data, secret, **kwargs):
            raise stripe_service.StripeError("refund declined")

        monkeypatch.setattr(stripe_service, "_post_form", failing_post)
        res = client.post(
            f"/api/shop/orders/{unpaid['id']}/refund",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"reason": "Fehlerhafter Stripe Refund"},
        )
        assert res.status_code == 502
        db.refresh(order)
        assert order.status == "paid"

        # Bereits erstattete Demo-Order -> 409 beim zweiten Versuch.
        order.payment_provider = "demo"
        order.payment_reference = "demo-x"
        db.commit()
        assert (
            client.post(
                f"/api/shop/orders/{unpaid['id']}/refund",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"reason": "Erster Refund"},
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/api/shop/orders/{unpaid['id']}/refund",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"reason": "Zweiter Refund"},
            ).status_code
            == 409
        )


class TestShopReconciliation:
    def test_reconcile_recovers_paid_expired_invoices_and_failed_entitlements(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        monkeypatch,
    ):
        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
        plan = _create_plan(client, owner_cookies, csrf_token)

        # 1) Offene Stripe-Order, auf Stripe bereits bezahlt.
        o_paid = _create_order(client, user_cookies, user_csrf_token, plan["id"])
        row_paid = db.query(ShopOrder).filter(ShopOrder.id == o_paid["id"]).one()
        row_paid.payment_provider = "stripe"
        row_paid.payment_reference = "cs_rec_paid"

        # 2) Offene Stripe-Order, Checkout abgelaufen.
        o_exp = _create_order(client, user_cookies, user_csrf_token, plan["id"])
        row_exp = db.query(ShopOrder).filter(ShopOrder.id == o_exp["id"]).one()
        row_exp.payment_provider = "stripe"
        row_exp.payment_reference = "cs_rec_exp"
        db.commit()

        # 3) Demo-Order bezahlt, bevor Verkaeuferdaten da waren und mit Provisionierungsfehler.
        o_fix = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        def fail_once(
            session: Session,
            request,
            actor,
            *,
            idempotency_key: str | None = None,
            retry_of_id: str | None = None,
        ):
            task, _ = create_or_reuse_task(
                session,
                actor=actor,
                task_type=TASK_SERVER_PROVISION,
                request_hash=hashlib.sha256(
                    json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()
                ).hexdigest(),
                idempotency_key=idempotency_key,
                retry_of_id=retry_of_id,
            )
            task.status = "failed"
            task.error_code = "port_conflict"
            session.commit()
            raise HTTPException(
                status_code=400,
                detail={"code": "port_conflict", "message": "errors.port_conflict"},
            )

        with patch(
            "services.server_provisioning_service.provision_server", fail_once
        ):
            assert (
                client.post(
                    f"/api/shop/orders/{o_fix['id']}/demo-pay",
                    cookies=user_cookies,
                    headers={"X-CSRF-Token": user_csrf_token},
                ).status_code
                == 200
            )

        # Verkaeuferdaten nachpflegen, Stripe-Session-Antworten simulieren.
        shop_seller_settings_service.update(SELLER)

        def fake_get(path, secret):
            if path.endswith("/cs_rec_paid"):
                return {
                    "id": "cs_rec_paid",
                    "status": "complete",
                    "payment_status": "paid",
                    "subscription": "sub_rec_1",
                }
            if path.endswith("/cs_rec_exp"):
                return {
                    "id": "cs_rec_exp",
                    "status": "expired",
                    "payment_status": "unpaid",
                }
            raise AssertionError(f"Unerwarteter Pfad: {path}")

        monkeypatch.setattr(stripe_service, "_get_json", fake_get)

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            res = client.post(
                "/api/shop/reconcile",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
        assert res.status_code == 200, res.text
        report = res.json()
        assert report["orders_checked"] == 2
        assert report["orders_marked_paid"] == 1
        assert report["orders_expired"] == 1
        assert report["invoices_issued"] == 1
        assert report["entitlements_synced"] >= 1
        assert report["pending_orders_remaining"] == 0
        assert report["failed_entitlements_remaining"] == 0
        assert report["errors"] == []

        db.expire_all()
        assert db.query(ShopOrder).filter(ShopOrder.id == o_paid["id"]).one().status == "paid"
        assert db.query(ShopOrder).filter(ShopOrder.id == o_exp["id"]).one().status == "cancelled"
        assert (
            db.query(ShopEntitlement)
            .filter(ShopEntitlement.order_id == o_fix["id"])
            .one()
            .provisioning_status
            == "ready"
        )
        assert (
            db.query(ShopInvoice)
            .filter(ShopInvoice.order_id == o_paid["id"], ShopInvoice.type == "invoice")
            .count()
            == 1
        )
        assert (
            db.query(ShopInvoice)
            .filter(ShopInvoice.order_id == o_fix["id"], ShopInvoice.type == "invoice")
            .count()
            == 1
        )

    def test_reconcile_negative_permissions_and_partial_stripe_error(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        monkeypatch,
    ):
        # Normaler User -> 403; fehlendes CSRF -> 403.
        assert (
            client.post(
                "/api/shop/reconcile",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 403
        )
        assert (
            client.post("/api/shop/reconcile", cookies=owner_cookies).status_code == 403
        )

        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
        plan = _create_plan(client, owner_cookies, csrf_token)
        o_err = _create_order(client, user_cookies, user_csrf_token, plan["id"])
        o_ok = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        row_err = db.query(ShopOrder).filter(ShopOrder.id == o_err["id"]).one()
        row_err.payment_provider = "stripe"
        row_err.payment_reference = "cs_err_1"
        row_ok = db.query(ShopOrder).filter(ShopOrder.id == o_ok["id"]).one()
        row_ok.payment_provider = "stripe"
        row_ok.payment_reference = "cs_ok_1"
        db.commit()

        def fake_get(path, secret):
            if path.endswith("/cs_err_1"):
                raise stripe_service.StripeError("secret_never_leaked_in_report")
            return {
                "id": "cs_ok_1",
                "status": "complete",
                "payment_status": "paid",
            }

        monkeypatch.setattr(stripe_service, "_get_json", fake_get)
        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            res = client.post(
                "/api/shop/reconcile",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
        assert res.status_code == 200, res.text
        report = res.json()
        assert report["orders_checked"] == 2
        assert report["orders_marked_paid"] == 1
        assert report["pending_orders_remaining"] == 1
        assert report["errors"] == [f"order:{o_err['id']}:stripe_reconcile_failed"]
