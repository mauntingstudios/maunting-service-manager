"""Tests fuer Paket 9: Kurzzeit-Laufzeiten (3, 7, 14 Tage), Mindestpreis, Verlaengerung und Rechnung."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from models import ShopAddon, ShopInvoice, ShopSubscription
from services import shop_lifecycle_settings_service, shop_order_service, shop_seller_settings_service


def _plan_payload(**overrides) -> dict:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld Kurzzeit {uuid4().hex[:6]}",
        "description": "Kurzzeit-Testtarif",
        "price_cents": 1000,
        "currency": "EUR",
        "billing_interval": "month",
        "tax_rate_percent": 19,
        "ram_included_mb": 4096,
        "ram_max_mb": 16384,
        "ram_step_mb": 1024,
        "price_per_ram_step_cents": 100,
        "cpu_included": 2,
        "cpu_max": 4,
        "cpu_step": 1,
        "price_per_cpu_step_cents": 150,
        "slots_included": 8,
        "slots_max": 32,
        "slots_step": 1,
        "price_per_slot_step_cents": 30,
        "lifetime_price_cents": 19900,
        "artwork_mode": "steam",
        "active": True,
        "sort_order": 0,
    }
    payload.update(overrides)
    return payload


def _enable_short_durations(
    client: TestClient, owner_cookies: dict, csrf_token: str, db, *, tiers=None
) -> dict:
    current = shop_lifecycle_settings_service.read(db=db)
    current["shop_short_durations_enabled"] = True
    if tiers is not None:
        current["shop_short_duration_tiers"] = tiers
    res = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=current,
    )
    assert res.status_code == 200, res.text
    return res.json()


def _create_plan(client: TestClient, owner_cookies: dict, csrf_token: str, **overrides) -> dict:
    res = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=_plan_payload(**overrides),
    )
    assert res.status_code == 200, res.text
    return res.json()


def _set_seller() -> None:
    shop_seller_settings_service.update(
        {
            "name": "Maunting Hosting GmbH",
            "street": "Musterstrasse 1",
            "postal_code": "10115",
            "city": "Berlin",
            "country": "DE",
            "email": "billing@maunting.example",
            "tax_number": "12/345/67890",
            "invoice_prefix": "RE",
            "payment_terms_days": 14,
            "small_business": False,
        }
    )


def test_short_duration_settings_validation_and_public_policy(
    client: TestClient, owner_cookies: dict, csrf_token: str, db
) -> None:
    pub_default = client.get("/api/shop/public-policy")
    assert pub_default.status_code == 200
    assert pub_default.json()["shop_short_durations_enabled"] is False
    assert [t["days"] for t in pub_default.json()["shop_short_duration_tiers"]] == [3, 7, 14]

    saved = _enable_short_durations(client, owner_cookies, csrf_token, db)
    assert saved["shop_short_durations_enabled"] is True

    pub_after = client.get("/api/shop/public-policy")
    assert pub_after.status_code == 200
    assert pub_after.json()["shop_short_durations_enabled"] is True

    bad = dict(saved)
    bad["shop_short_duration_tiers"] = [
        {"days": 3, "enabled": True, "price_factor_percent": 25, "min_price_cents": 50},
        {"days": 7, "enabled": True, "price_factor_percent": 40, "min_price_cents": 299},
        {"days": 14, "enabled": True, "price_factor_percent": 65, "min_price_cents": 499},
    ]
    bad_res = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=bad,
    )
    assert bad_res.status_code == 422


def test_short_duration_orders_floor_billing_modes_and_invoice(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
    db,
) -> None:
    _set_seller()
    plan_cheap = _create_plan(client, owner_cookies, csrf_token, price_cents=500)
    plan_disabled = _create_plan(
        client, owner_cookies, csrf_token, price_cents=1000, allow_short_durations=False
    )

    # Deaktiviert im Shop -> 422
    off_res = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan_cheap["id"], "billing_mode": "prepaid", "duration_days": 3},
    )
    assert off_res.status_code == 422

    _enable_short_durations(
        client,
        owner_cookies,
        csrf_token,
        db,
        tiers=[
            {"days": 3, "enabled": True, "price_factor_percent": 25, "min_price_cents": 199},
            {"days": 7, "enabled": True, "price_factor_percent": 40, "min_price_cents": 299},
            {"days": 14, "enabled": False, "price_factor_percent": 65, "min_price_cents": 499},
        ],
    )

    # 25% von 500 Cent = 125 Cent -> greift Mindestpreis 199 Cent
    res_floor = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={
            "plan_id": plan_cheap["id"],
            "billing_mode": "prepaid",
            "duration_days": 3,
            "buyer_name": "Erika Mustermann",
            "buyer_street": "Testweg 4",
            "buyer_postal_code": "10115",
            "buyer_city": "Berlin",
            "buyer_country": "DE",
            "buyer_email": "erika@example.com",
        },
    )
    assert res_floor.status_code == 200, res_floor.text
    order_data = res_floor.json()
    assert order_data["duration_days"] == 3
    assert order_data["gross_cents"] == 199
    assert order_data["items"][0]["duration_days"] == 3
    assert "3 Tage Prepaid" in order_data["items"][0]["name"]

    # Subscription, Lifetime, deaktivierte Stufe 14 Tage und allow_short_durations=False -> 422
    for bad_payload in (
        {"plan_id": plan_cheap["id"], "billing_mode": "subscription", "duration_days": 3},
        {"plan_id": plan_cheap["id"], "billing_mode": "lifetime", "duration_days": 3},
        {"plan_id": plan_cheap["id"], "billing_mode": "prepaid", "duration_days": 14},
        {"plan_id": plan_disabled["id"], "billing_mode": "prepaid", "duration_days": 7},
    ):
        bad_res = client.post(
            "/api/shop/orders",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json=bad_payload,
        )
        assert bad_res.status_code == 422, f"Expected 422 for {bad_payload}, got {bad_res.status_code}"

    # Demo-Pay -> Subscription-Period +3 Tage & Rechnung mit "3 Tage Prepaid"
    paid_res = client.post(
        f"/api/shop/orders/{order_data['id']}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert paid_res.status_code == 200, paid_res.text

    sub = db.query(ShopSubscription).filter(ShopSubscription.order_id == order_data["id"]).first()
    assert sub is not None
    assert sub.monthly_gross_cents == 500
    delta_hours = abs((sub.current_period_end - sub.started_at - timedelta(days=3)).total_seconds()) / 3600
    assert delta_hours < 0.1

    invoice = db.query(ShopInvoice).filter(ShopInvoice.order_id == order_data["id"]).first()
    assert invoice is not None
    assert "3 Tage Prepaid" in invoice.xml_text


def test_short_duration_extension_adds_exact_days_and_blocks_addons(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
    db,
) -> None:
    _enable_short_durations(client, owner_cookies, csrf_token, db)
    plan = _create_plan(client, owner_cookies, csrf_token, price_cents=1000)

    create_res = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan["id"], "billing_mode": "prepaid", "duration_days": 3},
    )
    assert create_res.status_code == 200, create_res.text
    order_id = create_res.json()["id"]

    pay_res = client.post(
        f"/api/shop/orders/{order_id}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert pay_res.status_code == 200

    sub = db.query(ShopSubscription).filter(ShopSubscription.order_id == order_id).first()
    assert sub is not None
    before_end = sub.current_period_end
    if before_end.tzinfo is None:
        before_end = before_end.replace(tzinfo=timezone.utc)

    # Extend um 7 Tage: 40% von 1000 Cent = 400 Cent (> 299 min_price_cents)
    ext_res = client.post(
        f"/api/shop/subscriptions/{sub.id}/extend",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"months": 1, "duration_days": 7},
    )
    assert ext_res.status_code == 200, ext_res.text
    ext_order = ext_res.json()
    assert ext_order["duration_days"] == 7
    assert ext_order["gross_cents"] == 400

    ext_pay = client.post(
        f"/api/shop/orders/{ext_order['id']}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert ext_pay.status_code == 200

    db.refresh(sub)
    after_end = sub.current_period_end
    if after_end.tzinfo is None:
        after_end = after_end.replace(tzinfo=timezone.utc)
    diff_days = (after_end - before_end).total_seconds() / 86400
    assert abs(diff_days - 7.0) < 0.01

    # Add-on-Sub darf keine Kurzzeit-Verlaengerung nutzen (422)
    addon = ShopAddon(
        slug=f"addon-{uuid4().hex[:6]}",
        name="Extra Slots",
        category="slots",
        price_cents=400,
        currency="EUR",
        billing_interval="month",
        tax_rate_percent=19,
        extra_slots=10,
        active=True,
    )
    db.add(addon)
    db.commit()
    db.refresh(addon)

    addon_order = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"addon_id": addon.id, "months": 1, "billing_mode": "prepaid"},
    )
    assert addon_order.status_code == 200, addon_order.text
    addon_pay = client.post(
        f"/api/shop/orders/{addon_order.json()['id']}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert addon_pay.status_code == 200
    addon_sub = (
        db.query(ShopSubscription)
        .filter(ShopSubscription.order_id == addon_order.json()["id"])
        .first()
    )
    assert addon_sub is not None

    bad_ext = client.post(
        f"/api/shop/subscriptions/{addon_sub.id}/extend",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"months": 1, "duration_days": 3},
    )
    assert bad_ext.status_code == 422

    # Rechenparitaet explizit pruefen
    assert shop_order_service.calc_short_duration_gross_cents(
        999, price_factor_percent=25, min_price_cents=199
    ) == 250
    assert isinstance(datetime.now(timezone.utc), datetime)
