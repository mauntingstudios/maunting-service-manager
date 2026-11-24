"""Katalog und Tarifverwaltung des nativen Shops."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from models import User


def _payload(name: str | None = None) -> dict:
    return {
        "game_type": "palworld",
        "name": name or f"Palworld Test {uuid4().hex[:8]}",
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


def _create(client: TestClient, owner_cookies: dict, csrf_token: str, payload: dict | None = None):
    return client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=payload or _payload(),
    )


class TestShopPlanAdmin:
    def test_owner_can_create_and_read_plan(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        res = _create(client, owner_cookies, csrf_token)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["price_cents"] == 699
        assert body["artwork"]["source"] == "steam"
        assert "/api/shop/artwork/palworld" in body["artwork"]["url"]

        listed = client.get("/api/shop/plans", cookies=owner_cookies)
        assert listed.status_code == 200
        assert any(plan["id"] == body["id"] for plan in listed.json())

    def test_create_requires_csrf_and_permission(
        self,
        client: TestClient,
        owner_cookies: dict,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        ohne_csrf = client.post(
            "/api/shop/plans", cookies=owner_cookies, json=_payload()
        )
        assert ohne_csrf.status_code == 403

        ohne_recht = client.post(
            "/api/shop/plans",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json=_payload(),
        )
        assert ohne_recht.status_code == 403

    def test_unknown_game_is_rejected(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        payload = _payload()
        payload["game_type"] = "gibtesnicht"
        res = _create(client, owner_cookies, csrf_token, payload)
        assert res.status_code == 422

    def test_update_price_and_deactivate(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        created = _create(client, owner_cookies, csrf_token).json()
        res = client.patch(
            f"/api/shop/plans/{created['id']}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"price_cents": 899, "active": False},
        )
        assert res.status_code == 200, res.text
        assert res.json()["price_cents"] == 899
        assert res.json()["active"] is False

    def test_delete_plan(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        created = _create(client, owner_cookies, csrf_token).json()
        res = client.delete(
            f"/api/shop/plans/{created['id']}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert res.status_code == 204
        verbleibend = client.get("/api/shop/plans", cookies=owner_cookies).json()
        assert all(plan["id"] != created["id"] for plan in verbleibend)


class TestShopCatalog:
    def test_catalog_is_public_and_hides_internal_fields(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        created = _create(client, owner_cookies, csrf_token).json()
        catalog = client.get("/api/shop/catalog")
        assert catalog.status_code == 200
        eintrag = next(plan for plan in catalog.json() if plan["id"] == created["id"])
        assert eintrag["price_cents"] == 699
        assert eintrag["game_name"] == "Palworld"
        assert eintrag["game_category"] == "steam_game"
        assert "node_id" not in eintrag
        assert "role_id" not in eintrag
        assert eintrag["artwork"]["source"] == "steam"

    def test_inactive_plan_is_not_in_catalog(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        created = _create(
            client,
            owner_cookies,
            csrf_token,
            {**_payload(), "active": False},
        ).json()
        catalog = client.get("/api/shop/catalog")
        assert all(plan["id"] != created["id"] for plan in catalog.json())

    def test_curation_flags_and_recent_order_counts(
        self,
        client: TestClient,
        owner_user: User,
        owner_cookies: dict,
        csrf_token: str,
        db,
    ):
        from models import ShopOrder, ShopOrderItem

        created = _create(
            client,
            owner_cookies,
            csrf_token,
            {**_payload(), "is_featured": True, "is_bestseller": True, "is_new": False},
        ).json()
        plan_id = created["id"]

        paid_order = ShopOrder(
            number=f"MSM-CUR-{uuid4().hex[:6]}",
            user_id=owner_user.id,
            status="paid",
            currency="EUR",
            months=1,
            net_cents=587,
            tax_cents=112,
            gross_cents=699,
            payment_provider="demo",
        )
        cancelled_order = ShopOrder(
            number=f"MSM-CAN-{uuid4().hex[:6]}",
            user_id=owner_user.id,
            status="cancelled",
            currency="EUR",
            months=1,
            net_cents=587,
            tax_cents=112,
            gross_cents=699,
            payment_provider="demo",
        )
        db.add_all([paid_order, cancelled_order])
        db.flush()
        db.add_all(
            [
                ShopOrderItem(
                    order_id=paid_order.id,
                    kind="plan",
                    plan_id=plan_id,
                    game_type="palworld",
                    name=created["name"],
                    quantity=2,
                    unit_price_cents=699,
                    tax_rate_percent=19,
                    net_cents=1174,
                    tax_cents=224,
                    gross_cents=1398,
                ),
                ShopOrderItem(
                    order_id=cancelled_order.id,
                    kind="plan",
                    plan_id=plan_id,
                    game_type="palworld",
                    name=created["name"],
                    quantity=5,
                    unit_price_cents=699,
                    tax_rate_percent=19,
                    net_cents=2937,
                    tax_cents=558,
                    gross_cents=3495,
                ),
            ]
        )
        db.commit()

        catalog = client.get("/api/shop/catalog")
        assert catalog.status_code == 200
        eintrag = next(plan for plan in catalog.json() if plan["id"] == plan_id)
        assert eintrag["is_featured"] is True
        assert eintrag["is_bestseller"] is True
        assert eintrag["is_new"] is False
        assert eintrag["recent_order_count"] == 2

        upd = client.patch(
            f"/api/shop/plans/{plan_id}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"is_new": True, "is_featured": False},
        )
        assert upd.status_code == 200
        assert upd.json()["is_new"] is True
        assert upd.json()["is_featured"] is False


class TestShopTrustSettings:
    def test_trustpilot_and_discord_validation_and_public_policy(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        headers = {"X-CSRF-Token": csrf_token}
        base = client.get("/api/shop/admin/lifecycle-settings", cookies=owner_cookies)
        assert base.status_code == 200
        cfg = base.json()

        # Aktiviertes Trustpilot ohne URL muss 422 liefern
        missing_url = client.put(
            "/api/shop/admin/lifecycle-settings",
            cookies=owner_cookies,
            headers=headers,
            json={**cfg, "shop_trustpilot_enabled": True, "shop_trustpilot_url": ""},
        )
        assert missing_url.status_code == 422

        # Phishing- oder HTTP-URLs werden strikt abgelehnt
        for bad_tp in (
            "http://www.trustpilot.com/review/example.de",
            "https://evil-trustpilot.com/review/example.de",
            "https://www.trustpilot.com/users/123",
            "javascript:alert(1)",
        ):
            bad_resp = client.put(
                "/api/shop/admin/lifecycle-settings",
                cookies=owner_cookies,
                headers=headers,
                json={**cfg, "shop_trustpilot_enabled": True, "shop_trustpilot_url": bad_tp},
            )
            assert bad_resp.status_code == 422

        for bad_dc in ("http://discord.gg/abc", "https://evil.example/invite/abc"):
            bad_dc_resp = client.put(
                "/api/shop/admin/lifecycle-settings",
                cookies=owner_cookies,
                headers=headers,
                json={**cfg, "shop_discord_invite_url": bad_dc},
            )
            assert bad_dc_resp.status_code == 422

        ok_resp = client.put(
            "/api/shop/admin/lifecycle-settings",
            cookies=owner_cookies,
            headers=headers,
            json={
                **cfg,
                "shop_trustpilot_enabled": True,
                "shop_trustpilot_url": "https://www.trustpilot.com/review/example.de",
                "shop_discord_invite_url": "https://discord.gg/maunting",
            },
        )
        assert ok_resp.status_code == 200
        public = client.get("/api/shop/public-policy")
        assert public.status_code == 200
        assert public.json()["shop_trustpilot_enabled"] is True
        assert public.json()["shop_trustpilot_url"] == "https://www.trustpilot.com/review/example.de"
        assert public.json()["shop_discord_invite_url"] == "https://discord.gg/maunting"

        # Zustand wieder sauber zuruecksetzen
        reset_resp = client.put(
            "/api/shop/admin/lifecycle-settings",
            cookies=owner_cookies,
            headers=headers,
            json={
                **cfg,
                "shop_trustpilot_enabled": False,
                "shop_trustpilot_url": "",
                "shop_discord_invite_url": "",
            },
        )
        assert reset_resp.status_code == 200
