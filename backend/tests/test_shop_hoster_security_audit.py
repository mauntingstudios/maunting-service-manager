"""Security-, Pentest- und Integritaetstests fuer Shop- und Hoster-API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from config import settings
from models import (
    Role,
    RolePermission,
    ShopEntitlement,
    ShopInvoice,
    ShopInvoiceLine,
    ShopOrder,
    ShopOrderItem,
    ShopSubscription,
    User,
)
from services import (
    hoster_integration_service,
    lifecycle_purge_service,
    rechtevergabe_service,
    shop_invoice_xml,
    stripe_settings_service,
)
from services.auth_service import AuthService
from services.rechtevergabe_service import RechteFehler
from services.role_service import set_user_roles
from tests.test_shop_fulfillment import _fake_provision


WEBHOOK_SECRET = "whsec_sec_audit_test"


def _csrf(cookies: dict) -> dict[str, str]:
    return {"X-CSRF-Token": cookies.get("__Secure-csrf_token", "")}


def _clear_stripe() -> None:
    stripe_settings_service.set_secret_key("")
    stripe_settings_service.set_webhook_secret("")


def _sign_stripe(payload: bytes) -> str:
    ts = int(time.time())
    sig = hmac.new(
        WEBHOOK_SECRET.encode(), f"{ts}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return f"t={ts},v1={sig}"


def _role_with_perms(db: Session, name: str, *perms: str) -> Role:
    role = Role(name=name, is_system=False)
    db.add(role)
    db.flush()
    for key in perms:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    db.refresh(role)
    return role


def _create_verified_user(db: Session, username: str, email: str, password: str) -> User:
    user = AuthService.create_user(db, username, email, password)
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user


def _create_plan(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    *,
    role_id: int | None = None,
) -> dict:
    res = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "game_type": "palworld",
            "name": f"SecPlan-{uuid4().hex[:6]}",
            "price_cents": 1000,
            "currency": "EUR",
            "billing_interval": "month",
            "tax_rate_percent": 19,
            "ram_included_mb": 4096,
            "cpu_included": 2,
            "slots_included": 8,
            "role_id": role_id,
            "active": True,
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_demo_pay_disabled_in_prod_and_when_stripe_configured(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
    monkeypatch,
) -> None:
    _clear_stripe()
    plan = _create_plan(client, owner_cookies, csrf_token)
    order = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan["id"], "months": 1},
    ).json()

    checkout_unconf = client.post(
        f"/api/shop/orders/{order['id']}/checkout",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert checkout_unconf.status_code == 409
    assert checkout_unconf.json()["detail"]["code"] == "stripe_not_configured"

    stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
    stripe_settings_service.set_webhook_secret(WEBHOOK_SECRET)
    res_stripe = client.post(
        f"/api/shop/orders/{order['id']}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert res_stripe.status_code == 409
    assert res_stripe.json()["detail"]["code"] == "stripe_configured"

    _clear_stripe()
    monkeypatch.setattr(settings, "debug", False)
    res_prod = client.post(
        f"/api/shop/orders/{order['id']}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert res_prod.status_code == 403
    assert res_prod.json()["detail"]["code"] == "shop_demo_pay_disabled"


def test_seller_and_stripe_keys_require_panel_settings_write(
    client: TestClient, db: Session
) -> None:
    shop_admin = _create_verified_user(
        db, "shop-only-admin", "shop-only@test.de", "StrongPass123!"
    )
    role = _role_with_perms(
        db,
        f"shop-only-{uuid4().hex[:6]}",
        "shop.read",
        "shop.write",
        "panel.settings.read",
    )
    set_user_roles(db, shop_admin, [role.id])
    db.commit()

    login = client.post(
        "/api/auth/login",
        json={"username": "shop-only-admin", "password": "StrongPass123!"},
    )
    assert login.status_code == 200
    login_cookies = dict(login.cookies)
    assert login_cookies.get("__Secure-access_token")
    headers = _csrf(login_cookies)

    assert (
        client.put(
            "/api/shop/seller",
            cookies=login_cookies,
            headers=headers,
            json={
                "name": "Evil Co",
                "street": "Str 1",
                "postal_code": "12345",
                "city": "Stadt",
                "country": "DE",
                "email": "evil@example.com",
            },
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/shop/stripe/keys",
            cookies=login_cookies,
            headers=headers,
            json={"secret_key": "sk_test_123456"},
        ).status_code
        == 403
    )


def test_webhook_rejects_unpaid_currency_amount_and_handles_dispute(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
) -> None:
    stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
    stripe_settings_service.set_webhook_secret(WEBHOOK_SECRET)
    plan = _create_plan(client, owner_cookies, csrf_token)
    order = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan["id"], "months": 1},
    ).json()

    unpaid_payload = json.dumps(
        {
            "id": "evt_bad_unpaid",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_bad_unpaid",
                    "payment_status": "unpaid",
                    "currency": "eur",
                    "amount_total": order["gross_cents"],
                    "metadata": {"order_id": str(order["id"])},
                }
            },
        }
    ).encode()
    res_unpaid = client.post(
        "/api/shop/stripe/webhook",
        content=unpaid_payload,
        headers={"Stripe-Signature": _sign_stripe(unpaid_payload)},
    )
    assert res_unpaid.status_code == 200
    db.expire_all()
    assert db.query(ShopOrder).filter(ShopOrder.id == order["id"]).one().status == "pending_payment"

    for idx, overrides in enumerate(
        (
            {"payment_status": "paid", "currency": "usd", "amount_total": order["gross_cents"]},
            {"payment_status": "paid", "currency": "eur", "amount_total": order["gross_cents"] - 1},
        )
    ):
        bad_payload = json.dumps(
            {
                "id": f"evt_bad_{idx}",
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": f"cs_bad_{idx}",
                        "metadata": {"order_id": str(order["id"])},
                        **overrides,
                    }
                },
            }
        ).encode()
        res = client.post(
            "/api/shop/stripe/webhook",
            content=bad_payload,
            headers={"Stripe-Signature": _sign_stripe(bad_payload)},
        )
        assert res.status_code == 400

    ok_payload = json.dumps(
        {
            "id": "evt_ok_dispute_setup",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_ok_disp",
                    "payment_intent": "pi_disp_1",
                    "payment_status": "paid",
                    "currency": "eur",
                    "amount_total": order["gross_cents"],
                    "metadata": {"order_id": str(order["id"])},
                }
            },
        }
    ).encode()
    with patch(
        "services.server_provisioning_service.provision_server",
        _fake_provision(),
    ), patch("services.server_dns_service.provision_server_subdomain"):
        assert (
            client.post(
                "/api/shop/stripe/webhook",
                content=ok_payload,
                headers={"Stripe-Signature": _sign_stripe(ok_payload)},
            ).status_code
            == 200
        )

    disp_open = json.dumps(
        {
            "id": "evt_disp_open",
            "type": "charge.dispute.created",
            "data": {"object": {"id": "dp_1", "payment_intent": "pi_disp_1"}},
        }
    ).encode()
    with patch(
        "services.server_action_service.request_lifecycle_operation",
        return_value={"status": "queued", "operation": "stop", "task_id": "t-stop"},
    ):
        assert (
            client.post(
                "/api/shop/stripe/webhook",
                content=disp_open,
                headers={"Stripe-Signature": _sign_stripe(disp_open)},
            ).status_code
            == 200
        )
    db.expire_all()
    ent = db.query(ShopEntitlement).filter(ShopEntitlement.order_id == order["id"]).one()
    assert ent.status == "suspended"

    disp_won = json.dumps(
        {
            "id": "evt_disp_won",
            "type": "charge.dispute.closed",
            "data": {"object": {"id": "dp_1", "payment_intent": "pi_disp_1", "status": "won"}},
        }
    ).encode()
    assert (
        client.post(
            "/api/shop/stripe/webhook",
            content=disp_won,
            headers={"Stripe-Signature": _sign_stripe(disp_won)},
        ).status_code
        == 200
    )
    db.expire_all()
    ent = db.query(ShopEntitlement).filter(ShopEntitlement.order_id == order["id"]).one()
    assert ent.status == "active"


def test_update_role_blocks_shop_role_escalation(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    csrf_token: str,
) -> None:
    harmless = _role_with_perms(db, f"PlanHarmless-{uuid4().hex[:6]}", "ai.chat.use")
    _create_plan(client, owner_cookies, csrf_token, role_id=harmless.id)

    with pytest.raises(RechteFehler) as exc_info:
        rechtevergabe_service.update_role(
            db,
            actor=owner_user,
            role_id=harmless.id,
            name=None,
            description=None,
            keys=["servers.delete"],
        )
    assert exc_info.value.status_code == 422


def test_hoster_security_ssrf_subject_hijack_sandbox_and_service_user_escalation(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str,
) -> None:
    for bad_url in (
        "http://127.0.0.1:8080/hook",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/hook",
        "http://localhost/hook",
        "ftp://example.com/hook",
    ):
        with pytest.raises(hoster_integration_service.HosterConfigurationError):
            hoster_integration_service.validate_webhook_url(bad_url)

    bot_priv = _create_verified_user(db, "hoster-bot-priv", "bot@priv.de", "StrongPass123!")
    bot_role = _role_with_perms(db, "bot-role-priv", "servers.create", "servers.delete")
    set_user_roles(db, bot_priv, [bot_role.id])

    limited_admin = _create_verified_user(db, "hoster-subadmin", "sub@admin.de", "StrongPass123!")
    admin_role = _role_with_perms(
        db, "subadmin-role", "panel.hoster.read", "panel.hoster.write", "servers.create"
    )
    set_user_roles(db, limited_admin, [admin_role.id])
    db.commit()

    sub_login = client.post(
        "/api/auth/login",
        json={"username": "hoster-subadmin", "password": "StrongPass123!"},
    )
    assert sub_login.status_code == 200
    sub_cookies = dict(sub_login.cookies)
    assert sub_cookies.get("__Secure-access_token")
    assert (
        client.post(
            "/api/hoster/integrations",
            cookies=sub_cookies,
            headers=_csrf(sub_cookies),
            json={
                "name": "Esc",
                "slug": "esc-int",
                "enabled": True,
                "is_sandbox": True,
                "service_user_id": bot_priv.id,
            },
        ).status_code
        == 403
    )

    plan = _create_plan(client, owner_cookies, csrf_token)
    slug = f"secshop-{uuid4().hex[:6]}"
    created = client.post(
        "/api/hoster/integrations",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "name": "SecShop",
            "slug": slug,
            "enabled": True,
            "is_sandbox": True,
            "service_user_id": bot_priv.id,
        },
    )
    assert created.status_code == 201, created.text
    api_key = created.json()["value"]
    rows = client.get("/api/hoster/integrations", cookies=owner_cookies).json()
    integration_id = next(r["id"] for r in rows if r["slug"] == slug)

    with patch(
        "services.server_provisioning_service.provision_server",
        _fake_provision(),
    ):
        ok_apply = client.post(
            "/api/hoster/v1/apply",
            headers={"X-MSM-Hoster-Key": api_key},
            json={
                "external_subject": "VICTIM-1",
                "desired_state": "active",
                "items": [{"external_service_id": "SVC-VICTIM-1", "kind": "server", "plan_id": plan["id"]}],
            },
        )
        assert ok_apply.status_code == 200, ok_apply.text
        assert ok_apply.json()["items"][0]["ok"] is True

    hijack = client.post(
        "/api/hoster/v1/apply",
        headers={"X-MSM-Hoster-Key": api_key},
        json={
            "external_subject": "ATTACKER-2",
            "desired_state": "terminated",
            "items": [{"external_service_id": "SVC-VICTIM-1", "kind": "server"}],
        },
    )
    assert hijack.status_code == 422

    toggle_sandbox = client.patch(
        f"/api/hoster/integrations/{integration_id}",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"is_sandbox": False},
    )
    assert toggle_sandbox.status_code == 409


def test_xrechnung_taxable_amount_uses_net_and_strips_control_chars() -> None:
    now = datetime.now(timezone.utc)
    inv = ShopInvoice(
        id=1,
        number="RE-2026-0001",
        order_id=1,
        user_id=1,
        type="invoice",
        status="issued",
        issued_at=now,
        due_date=now.date(),
        currency="EUR",
        buyer_reference="ORD-1",
        seller_name="Seller",
        seller_street="Street 1",
        seller_postal_code="12345",
        seller_city="City",
        seller_country="DE",
        seller_email="s@example.com",
        buyer_name="Buyer",
        buyer_street="Street 2",
        buyer_postal_code="54321",
        buyer_city="Town",
        buyer_country="DE",
        buyer_email="b@example.com",
        net_cents=1000,
        tax_cents=190,
        gross_cents=1190,
        xml_text="",
        xml_sha256="",
        pdf_bytes=b"",
        pdf_sha256="",
    )
    lines = [
        ShopInvoiceLine(
            id=1,
            invoice_id=1,
            position=1,
            description="Palworld\x01 Server",
            quantity=1,
            unit_code="MON",
            unit_price_cents=1000,
            line_net_cents=1000,
            tax_rate_percent=19,
            tax_category="S",
        )
    ]
    xml_out = shop_invoice_xml.build_xrechnung_xml(inv, lines)
    assert "\x01" not in xml_out
    root = ET.fromstring(xml_out)
    ns = {
        "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
        "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    }
    assert root.findtext("cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount", namespaces=ns) == "10.00"
    assert root.findtext("cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount", namespaces=ns) == "1.90"


def test_expire_due_prepaid_subscriptions_expires_prepaid_only(db: Session) -> None:
    user = AuthService.create_user(db, "prepaid-exp", "prepaid@test.de", "StrongPass123!")
    now = datetime.now(timezone.utc)
    past = now - timedelta(hours=2)

    pre_order = ShopOrder(
        number=f"PRE-{uuid4().hex[:6]}",
        user_id=user.id,
        status="paid",
        billing_mode="prepaid",
        months=1,
        net_cents=1000,
        tax_cents=190,
        gross_cents=1190,
    )
    life_order = ShopOrder(
        number=f"LIFE-{uuid4().hex[:6]}",
        user_id=user.id,
        status="paid",
        billing_mode="lifetime",
        months=1,
        net_cents=5000,
        tax_cents=950,
        gross_cents=5950,
    )
    db.add_all([pre_order, life_order])
    db.flush()

    pre_item = ShopOrderItem(
        order_id=pre_order.id,
        kind="plan",
        game_type="palworld",
        name="Prepaid",
        unit_price_cents=1000,
        tax_rate_percent=19,
        net_cents=1000,
        tax_cents=190,
        gross_cents=1190,
    )
    life_item = ShopOrderItem(
        order_id=life_order.id,
        kind="plan",
        game_type="palworld",
        name="Lifetime",
        unit_price_cents=5000,
        tax_rate_percent=19,
        net_cents=5000,
        tax_cents=950,
        gross_cents=5950,
    )
    db.add_all([pre_item, life_item])
    db.flush()

    pre_sub = ShopSubscription(
        user_id=user.id,
        order_id=pre_order.id,
        order_item_id=pre_item.id,
        game_type="palworld",
        name="Prepaid",
        status="active",
        billing_mode="prepaid",
        monthly_gross_cents=1190,
        tax_rate_percent=19,
        current_period_end=past,
    )
    life_sub = ShopSubscription(
        user_id=user.id,
        order_id=life_order.id,
        order_item_id=life_item.id,
        game_type="palworld",
        name="Lifetime",
        status="active",
        billing_mode="lifetime",
        monthly_gross_cents=5950,
        tax_rate_percent=19,
        current_period_end=past,
    )
    pre_ent = ShopEntitlement(
        user_id=user.id,
        order_id=pre_order.id,
        order_item_id=pre_item.id,
        kind="server",
        label="Prepaid Server",
        status="active",
        provisioning_status="ready",
    )
    life_ent = ShopEntitlement(
        user_id=user.id,
        order_id=life_order.id,
        order_item_id=life_item.id,
        kind="server",
        label="Lifetime Server",
        status="active",
        provisioning_status="ready",
    )
    db.add_all([pre_sub, life_sub, pre_ent, life_ent])
    db.commit()

    count = lifecycle_purge_service.expire_due_prepaid_subscriptions(db, now=now)
    assert count == 1
    db.expire_all()
    assert db.query(ShopSubscription).filter(ShopSubscription.id == pre_sub.id).one().status == "cancelled"
    assert db.query(ShopEntitlement).filter(ShopEntitlement.id == pre_ent.id).one().status == "suspended"
    assert db.query(ShopSubscription).filter(ShopSubscription.id == life_sub.id).one().status == "active"
    assert db.query(ShopEntitlement).filter(ShopEntitlement.id == life_ent.id).one().status == "active"
