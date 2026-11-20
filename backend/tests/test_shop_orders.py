"""Bestellungen, Abos und Freischaltungen des nativen Shops."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient


def _plan_payload(**overrides) -> dict:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld Order {uuid4().hex[:8]}",
        "description": "Testtarif",
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
        "sort_order": 0,
    }
    payload.update(overrides)
    return payload


def _create_plan(client: TestClient, owner_cookies: dict, csrf_token: str, **overrides) -> dict:
    res = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=_plan_payload(**overrides),
    )
    assert res.status_code == 200, res.text
    return res.json()


def _order(
    client: TestClient,
    user_cookies: dict,
    user_csrf_token: str,
    plan_id: int,
    **payload,
):
    return client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan_id, "months": 1, **payload},
    )


class TestShopOrders:
    def test_order_requires_login(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        res = client.post("/api/shop/orders", json={"plan_id": plan["id"]})
        assert res.status_code in (401, 403)

    def test_order_prices_come_from_plan_not_client(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        # 2 GB RAM-Aufpreis + 1 CPU + 2 Slots: 699 + 180 + 150 + 60 = 1089.
        res = _order(
            client,
            user_cookies,
            user_csrf_token,
            plan["id"],
            ram_mb=10240,
            cpu=3,
            slots=10,
            price_cents=1,
            gross_cents=1,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "pending_payment"
        assert body["number"].startswith("MSM-")
        assert body["gross_cents"] == 1089
        assert body["net_cents"] + body["tax_cents"] == body["gross_cents"]
        assert body["items"][0]["unit_price_cents"] == 1089
        assert "Palworld" in body["items"][0]["name"]
        assert body["items"][0]["ram_mb"] == 10240

    def test_year_discount_is_applied(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        res = _order(
            client, user_cookies, user_csrf_token, plan["id"], months=12
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["discount_percent"] == 20
        # 699 * 12 * 0,8 = 6710,4 -> 6710 brutto.
        assert body["gross_cents"] == 6710

    def test_invalid_resources_are_rejected(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        schief = _order(
            client, user_cookies, user_csrf_token, plan["id"], ram_mb=9000
        )
        assert schief.status_code == 422

        zu_gross = _order(
            client, user_cookies, user_csrf_token, plan["id"], ram_mb=32768
        )
        assert zu_gross.status_code == 422

        unter_inklusive = _order(
            client, user_cookies, user_csrf_token, plan["id"], slots=4
        )
        assert unter_inklusive.status_code == 422

    def test_inactive_plan_cannot_be_ordered(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token, active=False)
        res = _order(client, user_cookies, user_csrf_token, plan["id"])
        assert res.status_code == 422

    def test_demo_payment_grants_subscription_and_entitlements_once(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"]).json()

        paid = client.post(
            f"/api/shop/orders/{order['id']}/demo-pay",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert paid.status_code == 200, paid.text
        assert paid.json()["status"] == "paid"
        assert paid.json()["payment_reference"].startswith("demo-MSM-")

        abos = client.get("/api/shop/subscriptions", cookies=user_cookies)
        assert abos.status_code == 200
        assert len(abos.json()) == 1
        assert abos.json()[0]["status"] == "active"
        assert abos.json()[0]["monthly_gross_cents"] == 699

        frei = client.get("/api/shop/entitlements", cookies=user_cookies)
        assert frei.status_code == 200
        assert [eintrag["kind"] for eintrag in frei.json()] == ["server"]

        # Zweiter Aufruf darf nichts doppelt anlegen.
        wieder = client.post(
            f"/api/shop/orders/{order['id']}/demo-pay",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert wieder.status_code == 200
        assert len(client.get("/api/shop/subscriptions", cookies=user_cookies).json()) == 1
        assert len(client.get("/api/shop/entitlements", cookies=user_cookies).json()) == 1

    def test_foreign_order_is_invisible(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _order(client, user_cookies, user_csrf_token, plan["id"]).json()

        fremd = client.get(f"/api/shop/orders/{order['id']}", cookies=owner_cookies)
        assert fremd.status_code == 404

        eigen = client.get(f"/api/shop/orders/{order['id']}", cookies=user_cookies)
        assert eigen.status_code == 200

    def test_list_shows_only_own_orders(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        erste = _order(client, user_cookies, user_csrf_token, plan["id"]).json()
        zweite = _order(client, user_cookies, user_csrf_token, plan["id"]).json()

        eigene = client.get("/api/shop/orders", cookies=user_cookies).json()
        assert {eintrag["id"] for eintrag in eigene} == {erste["id"], zweite["id"]}

        fremde = client.get("/api/shop/orders", cookies=owner_cookies).json()
        assert fremde == []
