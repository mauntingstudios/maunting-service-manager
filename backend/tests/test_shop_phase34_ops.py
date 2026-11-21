"""Tests fuer Phase 3.4: Gutscheine, Storefront-Promos, Stripe-Sync, manuelle Bestellungen, KPIs & granulare Shop-Rechte."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

import models  # noqa: F401
from config import settings
from database import Base
from models import Role, RolePermission, ShopCoupon, User
from services.auth_service import AuthService


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


def _create_addon(
    client: TestClient, owner_cookies: dict, csrf_token: str, **overrides
) -> dict:
    payload = {
        "slug": f"ai-quota-{uuid4().hex[:6]}",
        "name": "KI Kontingent Plus",
        "description": "Zusaetzliche KI-Tokens pro Monat",
        "category": "ai_quota",
        "price_cents": 500,
        "currency": "EUR",
        "billing_interval": "month",
        "tax_rate_percent": 19,
        "extra_ai_tokens": 250_000,
        "active": True,
        "sort_order": 0,
    }
    payload.update(overrides)
    res = client.post(
        "/api/shop/addons",
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
        "code": f"SAVE{uuid4().hex[:6].upper()}",
        "name": "Willkommensrabatt",
        "promo_text": "Sichere dir 20 % Rabatt auf deinen ersten Server!",
        "discount_type": "percent",
        "discount_value": 20,
        "currency": "EUR",
        "scope": "all",
        "target_plan_ids": [],
        "min_gross_cents": 0,
        "show_badge": True,
        "show_banner": True,
        "banner_cooldown_hours": 12,
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


def _staff_user_with_perms(
    client: TestClient, db: Session, *perm_keys: str
) -> tuple[User, dict, str]:
    suffix = uuid4().hex[:8]
    role = Role(name=f"ShopStaff-{suffix}", is_system=False)
    db.add(role)
    db.flush()
    for key in perm_keys:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    user = AuthService.create_user(
        db, f"staff_{suffix}", f"staff_{suffix}@test.de", "StaffPass123!"
    )
    user.email_verified = True
    user.role_id = role.id
    db.commit()
    db.refresh(user)
    login_res = client.post(
        "/api/auth/login",
        json={
            "username": user.username,
            "password": "StaffPass123!",
            "otp_code": None,
        },
    )
    assert login_res.status_code == 200, login_res.text
    cookies = dict(login_res.cookies)
    csrf = cookies.get("__Secure-csrf_token") or ""
    return user, cookies, csrf


class TestShopCouponsAndPromos:
    def test_coupon_crud_and_validation_negatives(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
    ):
        # Non-admin user gets 403
        forbidden = client.get("/api/shop/coupons", cookies=user_cookies)
        assert forbidden.status_code == 403

        # Missing CSRF gets 403
        no_csrf = client.post(
            "/api/shop/coupons",
            cookies=owner_cookies,
            json={
                "code": "NOCSRF10",
                "name": "No CSRF",
                "discount_type": "percent",
                "discount_value": 10,
            },
        )
        assert no_csrf.status_code == 403

        coupon = _create_coupon(
            client,
            owner_cookies,
            csrf_token,
            code="  winter30  ",
            discount_type="percent",
            discount_value=30,
        )
        assert coupon["code"] == "WINTER30"
        assert coupon["discount_value"] == 30

        # Duplicate code -> 422
        dup = client.post(
            "/api/shop/coupons",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "code": "WINTER30",
                "name": "Duplikat",
                "discount_type": "percent",
                "discount_value": 15,
            },
        )
        assert dup.status_code == 422

        # Percent > 99 -> 422
        bad_pct = client.post(
            "/api/shop/coupons",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "code": "TOO100",
                "name": "Zu hoch",
                "discount_type": "percent",
                "discount_value": 100,
            },
        )
        assert bad_pct.status_code == 422

        # Target plan on addons scope -> 422
        bad_scope = client.post(
            "/api/shop/coupons",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "code": "BADSCOPE",
                "name": "Scope Fehler",
                "discount_type": "percent",
                "discount_value": 10,
                "scope": "addons",
                "target_plan_ids": [999],
            },
        )
        assert bad_scope.status_code == 422

        # Valid window reversed -> 422
        now = datetime.now(timezone.utc)
        bad_dates = client.post(
            "/api/shop/coupons",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "code": "BADDATE",
                "name": "Zeitraum Fehler",
                "discount_type": "percent",
                "discount_value": 10,
                "valid_from": (now + timedelta(days=5)).isoformat(),
                "valid_until": (now + timedelta(days=1)).isoformat(),
            },
        )
        assert bad_dates.status_code == 422

        # Update & delete roundtrip
        patched = client.patch(
            f"/api/shop/coupons/{coupon['id']}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"discount_value": 25, "promo_text": "Jetzt 25 % sichern"},
        )
        assert patched.status_code == 200
        assert patched.json()["discount_value"] == 25
        assert patched.json()["promo_text"] == "Jetzt 25 % sichern"

        deleted = client.delete(
            f"/api/shop/coupons/{coupon['id']}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert deleted.status_code == 204

    def test_public_promos_and_coupon_preview(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
    ):
        plan_a = _create_plan(client, owner_cookies, csrf_token, price_cents=1200)
        plan_b = _create_plan(client, owner_cookies, csrf_token, price_cents=1200)

        global_promo = _create_coupon(
            client,
            owner_cookies,
            csrf_token,
            code="GLOBAL15",
            discount_type="percent",
            discount_value=15,
            scope="all",
            show_banner=True,
            show_badge=True,
            banner_cooldown_hours=6,
        )
        targeted_badge = _create_coupon(
            client,
            owner_cookies,
            csrf_token,
            code="PLANA30",
            discount_type="percent",
            discount_value=30,
            scope="plans",
            target_plan_ids=[plan_a["id"]],
            show_banner=False,
            show_badge=True,
        )
        # Expired coupon must not appear in public promos
        past = datetime.now(timezone.utc) - timedelta(days=2)
        _create_coupon(
            client,
            owner_cookies,
            csrf_token,
            code="EXPIRED50",
            discount_type="percent",
            discount_value=50,
            show_banner=True,
            show_badge=True,
            valid_until=past.isoformat(),
        )

        promos_res = client.get("/api/shop/promos")
        assert promos_res.status_code == 200
        promos = promos_res.json()
        assert promos["banner"] is not None
        assert promos["banner"]["code"] == global_promo["code"]
        assert promos["banner"]["cooldown_hours"] == 6

        badge_codes = {b["code"] for b in promos["badges"]}
        assert global_promo["code"] in badge_codes
        assert targeted_badge["code"] in badge_codes
        assert "EXPIRED50" not in badge_codes

        # Preview valid on plan_a with targeted coupon
        prev_ok = client.post(
            "/api/shop/coupons/preview",
            json={
                "code": "plana30",
                "kind": "plan",
                "plan_id": plan_a["id"],
                "gross_cents": 1000,
            },
        )
        assert prev_ok.status_code == 200
        data_ok = prev_ok.json()
        assert data_ok["valid"] is True
        assert data_ok["code"] == "PLANA30"
        assert data_ok["discount_cents"] == 300
        assert data_ok["final_gross_cents"] == 700

        # Preview rejected on plan_b for plan_a-targeted coupon
        prev_wrong_plan = client.post(
            "/api/shop/coupons/preview",
            json={
                "code": "PLANA30",
                "kind": "plan",
                "plan_id": plan_b["id"],
                "gross_cents": 1000,
            },
        )
        assert prev_wrong_plan.status_code == 200
        assert prev_wrong_plan.json()["valid"] is False
        assert "Tarif" in (prev_wrong_plan.json()["reason"] or "")

        # Preview rejected on addon for plans-scoped coupon
        prev_wrong_scope = client.post(
            "/api/shop/coupons/preview",
            json={
                "code": "PLANA30",
                "kind": "addon",
                "gross_cents": 500,
            },
        )
        assert prev_wrong_scope.status_code == 200
        assert prev_wrong_scope.json()["valid"] is False
        assert "Server-Tarife" in (prev_wrong_scope.json()["reason"] or "")

    def test_order_checkout_with_coupon_and_redemption_limit(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        addon = _create_addon(client, owner_cookies, csrf_token, price_cents=1000)
        coupon = _create_coupon(
            client,
            owner_cookies,
            csrf_token,
            code="ONCE25",
            discount_type="percent",
            discount_value=25,
            scope="addons",
            max_redemptions=1,
            min_gross_cents=500,
        )

        # Create order with coupon
        order_res = client.post(
            "/api/shop/orders",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={
                "addon_id": addon["id"],
                "months": 1,
                "coupon_code": "once25",
            },
        )
        assert order_res.status_code == 200, order_res.text
        order_data = order_res.json()
        assert order_data["coupon_code"] == "ONCE25"
        assert order_data["coupon_discount_cents"] == 250
        assert order_data["gross_cents"] == 750
        assert order_data["net_cents"] + order_data["tax_cents"] == 750

        # Paying consumes the 1 allowed redemption
        pay_res = client.post(
            f"/api/shop/orders/{order_data['id']}/demo-pay",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert pay_res.status_code == 200, pay_res.text

        db.expire_all()
        db_coupon = db.query(ShopCoupon).filter(ShopCoupon.id == coupon["id"]).first()
        assert db_coupon is not None
        assert db_coupon.redemption_count == 1

        # Second order with exhausted coupon -> 422
        second_res = client.post(
            "/api/shop/orders",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={
                "addon_id": addon["id"],
                "months": 1,
                "coupon_code": "ONCE25",
            },
        )
        assert second_res.status_code == 422

    def test_stripe_coupon_sync_unconfigured_and_mocked_success(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
    ):
        coupon = _create_coupon(
            client,
            owner_cookies,
            csrf_token,
            code="STRIPE20",
            discount_type="percent",
            discount_value=20,
        )

        # Without stripe_secret_key -> 409
        with patch("services.stripe_settings_service.resolve_secret_key", return_value=""):
            unconf = client.post(
                f"/api/shop/coupons/{coupon['id']}/stripe-sync",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert unconf.status_code == 409

        # With mocked Stripe API responses -> stores IDs on coupon
        def _fake_post_form(path: str, form: list[tuple[str, str]], secret_key: str) -> dict:
            assert secret_key == "sk_test_mocked"
            form_map = dict(form)
            if path == "/coupons":
                return {"id": "coup_test123"}
            if path == "/promotion_codes":
                assert form_map["coupon"] == "coup_test123"
                assert form_map["code"] == "STRIPE20"
                return {"id": "promo_test456"}
            raise AssertionError(f"Unexpected path {path}")

        with (
            patch(
                "services.stripe_settings_service.resolve_secret_key",
                return_value="sk_test_mocked",
            ),
            patch(
                "services.stripe_service._post_form",
                side_effect=_fake_post_form,
            ),
        ):
            synced = client.post(
                f"/api/shop/coupons/{coupon['id']}/stripe-sync",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert synced.status_code == 200, synced.text
            body = synced.json()
            assert body["stripe_coupon_id"] == "coup_test123"
            assert body["stripe_promotion_code_id"] == "promo_test456"


class TestShopAdminOpsAndGranularPermissions:
    def test_manual_admin_order_and_stats_kpi(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
    ):
        addon = _create_addon(client, owner_cookies, csrf_token, price_cents=800)
        coupon = _create_coupon(
            client,
            owner_cookies,
            csrf_token,
            code="ADMIN10",
            discount_type="percent",
            discount_value=10,
        )

        # Unknown user -> 404
        missing_user = client.post(
            "/api/shop/admin/orders",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "user_id": 999_999_999,
                "addon_id": addon["id"],
                "months": 1,
                "mark_paid": True,
            },
        )
        assert missing_user.status_code == 404

        # Both plan_id and addon_id -> 422
        both_targets = client.post(
            "/api/shop/admin/orders",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "user_id": regular_user.id,
                "plan_id": 1,
                "addon_id": addon["id"],
                "months": 1,
            },
        )
        assert both_targets.status_code == 422

        # Valid manual order with mark_paid=True and coupon (months=1)
        manual_res = client.post(
            "/api/shop/admin/orders",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "user_id": regular_user.id,
                "addon_id": addon["id"],
                "months": 1,
                "coupon_code": coupon["code"],
                "mark_paid": True,
                "note": "Kulanz-Bestellung",
            },
        )
        assert manual_res.status_code == 200, manual_res.text
        manual_order = manual_res.json()
        assert manual_order["status"] == "paid"
        assert manual_order["payment_provider"] == "manual"
        assert manual_order["coupon_code"] == "ADMIN10"
        assert manual_order["coupon_discount_cents"] == 80
        assert manual_order["gross_cents"] == 720

        stats_res = client.get("/api/shop/admin/stats", cookies=owner_cookies)
        assert stats_res.status_code == 200, stats_res.text
        stats = stats_res.json()
        assert stats["paid_orders"] >= 1
        assert stats["paid_gross_cents"] >= 720
        assert stats["active_addon_subscriptions"] >= 1
        assert stats["active_coupons"] >= 1
        assert stats["coupon_redemptions"] >= 1

    def test_granular_shop_permissions_without_panel_settings(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
    ):
        _create_coupon(client, owner_cookies, csrf_token, code="PERM10")

        # 1. Reader with only shop.read can read plans/addons/coupons, but cannot write or view orders
        _, read_cookies, read_csrf = _staff_user_with_perms(
            client, db, "shop.read"
        )
        assert client.get("/api/shop/plans", cookies=read_cookies).status_code == 200
        assert client.get("/api/shop/addons", cookies=read_cookies).status_code == 200
        assert client.get("/api/shop/coupons", cookies=read_cookies).status_code == 200
        assert (
            client.post(
                "/api/shop/coupons",
                cookies=read_cookies,
                headers={"X-CSRF-Token": read_csrf},
                json={
                    "code": "NOPE10",
                    "name": "Kein Schreibrecht",
                    "discount_type": "percent",
                    "discount_value": 10,
                },
            ).status_code
            == 403
        )

        # 2. Orders auditor with only shop.orders.read can read admin orders & stats, but cannot read invoices
        _, orders_cookies, _ = _staff_user_with_perms(
            client, db, "shop.orders.read"
        )
        assert (
            client.get("/api/shop/admin/orders", cookies=orders_cookies).status_code
            == 200
        )
        assert (
            client.get("/api/shop/admin/stats", cookies=orders_cookies).status_code
            == 200
        )
        assert (
            client.get("/api/shop/admin/invoices", cookies=orders_cookies).status_code
            == 403
        )

        # 3. Invoices auditor with only shop.invoices.read can read admin invoices
        _, inv_cookies, _ = _staff_user_with_perms(
            client, db, "shop.invoices.read"
        )
        assert (
            client.get("/api/shop/admin/invoices", cookies=inv_cookies).status_code
            == 200
        )

        # 4. Catalog manager with shop.write can create coupons without panel.settings.write
        _, write_cookies, write_csrf = _staff_user_with_perms(
            client, db, "shop.write"
        )
        created = client.post(
            "/api/shop/coupons",
            cookies=write_cookies,
            headers={"X-CSRF-Token": write_csrf},
            json={
                "code": "STAFF15",
                "name": "Staff Coupon",
                "discount_type": "percent",
                "discount_value": 15,
            },
        )
        assert created.status_code == 200, created.text
        assert created.json()["code"] == "STAFF15"


def test_migration_20261121_04_shop_coupons_roundtrip(pg_wegwerf) -> None:
    db_url = pg_wegwerf("shop_coupons")
    previous = settings.database_url
    settings.database_url = db_url
    backend_dir = Path(__file__).resolve().parent.parent
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    engine = create_engine(db_url)
    try:
        Base.metadata.create_all(engine)
        command.stamp(config, "head")

        command.downgrade(config, "20261121_03")
        insp = inspect(engine)
        assert "shop_coupons" not in set(insp.get_table_names())
        order_cols = {c["name"] for c in insp.get_columns("shop_orders")}
        assert "coupon_code" not in order_cols
        assert "coupon_discount_cents" not in order_cols

        command.upgrade(config, "20261121_04")
        insp = inspect(engine)
        assert "shop_coupons" in set(insp.get_table_names())
        order_cols = {c["name"] for c in insp.get_columns("shop_orders")}
        assert "coupon_code" in order_cols
        assert "coupon_discount_cents" in order_cols
    finally:
        engine.dispose()
        settings.database_url = previous
