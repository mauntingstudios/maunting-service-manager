"""Tests fuer Phase 4: Rechnungs-Mail mit PDF-Anhang, Banner-Rotation, Stripe-Promocodes & MSS-App Handoff."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import ShopOrder
from services import shop_invoice_service, shop_seller_settings_service


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


def _create_plan(
    client: TestClient, owner_cookies: dict, csrf_token: str, **overrides
) -> dict:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld {uuid4().hex[:6]}",
        "price_cents": 1000,
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


def _create_coupon(
    client: TestClient, owner_cookies: dict, csrf_token: str, **overrides
) -> dict:
    payload = {
        "code": f"P4{uuid4().hex[:6].upper()}",
        "name": "Phase4 Promo",
        "promo_text": "Sonderaktion",
        "discount_type": "percent",
        "discount_value": 15,
        "currency": "EUR",
        "scope": "all",
        "target_plan_ids": [],
        "min_gross_cents": 0,
        "show_badge": True,
        "show_banner": True,
        "banner_cooldown_hours": 4,
        "active": True,
    }
    payload.update(overrides)
    res = client.post(
        "/api/shop/coupons",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=payload,
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_promos_returns_sorted_banners_with_flash_sale_first(
    client: TestClient, owner_cookies: dict, csrf_token: str
):
    now = datetime.now(timezone.utc)
    _create_coupon(
        client,
        owner_cookies,
        csrf_token,
        code="EVERGREEN50",
        discount_value=50,
        valid_until=None,
    )
    _create_coupon(
        client,
        owner_cookies,
        csrf_token,
        code="FLASHLATER",
        discount_value=25,
        valid_until=(now + timedelta(hours=12)).isoformat(),
    )
    _create_coupon(
        client,
        owner_cookies,
        csrf_token,
        code="FLASHSOON",
        discount_value=10,
        valid_until=(now + timedelta(hours=2)).isoformat(),
    )

    res = client.get("/api/shop/promos")
    assert res.status_code == 200, res.text
    body = res.json()
    codes = [b["code"] for b in body["banners"]]
    assert codes == ["FLASHSOON", "FLASHLATER", "EVERGREEN50"]
    assert body["banner"]["code"] == "FLASHSOON"


def test_checkout_stripe_promotion_code_and_redirect_validation(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
):
    plan = _create_plan(client, owner_cookies, csrf_token, price_cents=2000)
    synced_coupon = _create_coupon(
        client,
        owner_cookies,
        csrf_token,
        code="STRIPESYNC20",
        discount_type="percent",
        discount_value=20,
    )

    # 1) Sync coupon to Stripe so stripe_promotion_code_id is stored
    def _fake_post_form_sync(path: str, form: list[tuple[str, str]], secret_key: str) -> dict:
        if path == "/coupons":
            return {"id": "coup_p4"}
        if path == "/promotion_codes":
            return {"id": "promo_p4"}
        raise AssertionError(f"Unexpected path {path}")

    with (
        patch("services.stripe_settings_service.resolve_secret_key", return_value="sk_test_p4"),
        patch("services.stripe_service._post_form", side_effect=_fake_post_form_sync),
    ):
        sync_res = client.post(
            f"/api/shop/coupons/{synced_coupon['id']}/stripe-sync",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert sync_res.status_code == 200, sync_res.text

    # Order WITH synced coupon
    order_with_coupon = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan["id"], "months": 3, "coupon_code": "STRIPESYNC20", **BUYER},
    )
    assert order_with_coupon.status_code == 200, order_with_coupon.text
    order_c = order_with_coupon.json()
    assert order_c["coupon_discount_cents"] > 0

    captured_with_coupon: list[tuple[str, str]] = []

    def _capture_checkout(path: str, form: list[tuple[str, str]], secret_key: str) -> dict:
        captured_with_coupon.clear()
        captured_with_coupon.extend(form)
        return {"id": "cs_p4_coupon", "url": "https://checkout.stripe.test/c"}

    with (
        patch("services.stripe_settings_service.resolve_secret_key", return_value="sk_test_p4"),
        patch("services.stripe_service._post_form", side_effect=_capture_checkout),
    ):
        # Negative: external redirect host & script scheme rejected with 422
        bad1 = client.post(
            f"/api/shop/orders/{order_c['id']}/checkout",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"return_url": "https://evil.example/steal"},
        )
        assert bad1.status_code == 422

        bad2 = client.post(
            f"/api/shop/orders/{order_c['id']}/checkout",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"cancel_url": "javascript:alert(1)"},
        )
        assert bad2.status_code == 422

        # Positive: app deep-link accepted and Stripe receives pre-coupon amount + discounts[0][promotion_code]
        ok = client.post(
            f"/api/shop/orders/{order_c['id']}/checkout",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"return_url": "maunting://checkout/done"},
        )
        assert ok.status_code == 200, ok.text
        form_map = dict(captured_with_coupon)
        assert form_map["success_url"] == "maunting://checkout/done"
        assert form_map["discounts[0][promotion_code]"] == "promo_p4"
        assert "allow_promotion_codes" not in form_map
        assert int(form_map["line_items[0][price_data][unit_amount]"]) == (
            order_c["gross_cents"] + order_c["coupon_discount_cents"]
        )

    # Order WITHOUT coupon -> passes allow_promotion_codes=true
    order_plain = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan["id"], "months": 1, **BUYER},
    ).json()

    with (
        patch("services.stripe_settings_service.resolve_secret_key", return_value="sk_test_p4"),
        patch("services.stripe_service._post_form", side_effect=_capture_checkout),
    ):
        ok_plain = client.post(
            f"/api/shop/orders/{order_plain['id']}/checkout",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert ok_plain.status_code == 200, ok_plain.text
        plain_map = dict(captured_with_coupon)
        assert "allow_promotion_codes" not in plain_map
        assert "discounts[0][promotion_code]" not in plain_map


def test_shop_handoff_endpoint_validation_and_urls(
    client: TestClient,
    user_cookies: dict,
    user_csrf_token: str,
):
    # Requires authentication
    unauth = client.post("/api/shop/handoff", json={"target": "catalog"})
    assert unauth.status_code == 401

    # Invalid return url -> 422
    bad_url = client.post(
        "/api/shop/handoff",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"target": "catalog", "app_return_url": "https://evil.example/x"},
    )
    assert bad_url.status_code == 422

    # Invalid game slug -> 422
    bad_slug = client.post(
        "/api/shop/handoff",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"target": "game", "game_type": "../etc/passwd"},
    )
    assert bad_slug.status_code == 422

    # Missing addon_id -> 422
    bad_addon = client.post(
        "/api/shop/handoff",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"target": "addon"},
    )
    assert bad_addon.status_code == 422

    # Valid game handoff with coupon & deep-link
    ok_game = client.post(
        "/api/shop/handoff",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={
            "target": "game",
            "game_type": "palworld",
            "coupon_code": "flash20",
            "app_return_url": "maunting://shop/done",
        },
    )
    assert ok_game.status_code == 200, ok_game.text
    url = ok_game.json()["url"]
    assert "/shop/palworld?" in url
    assert "coupon=FLASH20" in url
    assert "app_return=maunting%3A%2F%2Fshop%2Fdone" in url


def test_invoice_email_dispatched_once_with_pdf(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
):
    shop_seller_settings_service.update(SELLER)
    plan = _create_plan(client, owner_cookies, csrf_token, price_cents=999)
    order = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan["id"], "months": 1, **BUYER},
    ).json()

    send_mock = AsyncMock(return_value=True)
    with patch("services.email_service.EmailService.send_shop_invoice_email", send_mock):
        pay = client.post(
            f"/api/shop/orders/{order['id']}/demo-pay",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert pay.status_code == 200, pay.text
        assert send_mock.call_count == 1
        call_kwargs = send_mock.call_args.kwargs
        assert call_kwargs["to"] == BUYER["buyer_email"]
        assert call_kwargs["order_number"] == order["number"]
        assert call_kwargs["pdf_bytes"].startswith(b"%PDF")

        # Calling ensure_invoice_for_order again must NOT resend email
        db.expire_all()
        order_row = db.query(ShopOrder).filter(ShopOrder.id == order["id"]).one()
        shop_invoice_service.ensure_invoice_for_order(db, order_row)
        assert send_mock.call_count == 1
