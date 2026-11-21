"""Tests fuer eigenstaendige Shop-Add-ons ohne Serverbindung."""

from __future__ import annotations

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
from models import (
    Role,
    RolePermission,
    Server,
    ShopEntitlement,
    ShopOrder,
    ShopSubscription,
    User,
)
from services import permission_service, role_service
from services.auth_service import AuthService
from services.permission_catalog import SYSTEM_ROLE_ADMIN, SYSTEM_ROLE_USER
from tests.test_shop_fulfillment import _fake_provision


def _harmless_role(
    db: Session, name: str, *, keys: tuple[str, ...] = ("ai.chat.use",)
) -> Role:
    role = Role(name=name, is_system=False)
    db.add(role)
    db.flush()
    for key in keys:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    db.refresh(role)
    return role


def _addon_payload(**overrides) -> dict:
    payload = {
        "slug": f"ai-quota-{uuid4().hex[:6]}",
        "name": "KI Kontingent Plus",
        "description": "Zusaetzliche KI-Tokens pro Monat",
        "category": "ai_quota",
        "price_cents": 499,
        "currency": "EUR",
        "billing_interval": "month",
        "tax_rate_percent": 19,
        "extra_ai_tokens": 250_000,
        "active": True,
        "sort_order": 0,
    }
    payload.update(overrides)
    return payload


def _create_addon(
    client: TestClient, owner_cookies: dict, csrf_token: str, **overrides
) -> dict:
    res = client.post(
        "/api/shop/addons",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=_addon_payload(**overrides),
    )
    assert res.status_code == 200, res.text
    return res.json()


def _create_plan(
    client: TestClient, owner_cookies: dict, csrf_token: str, **overrides
) -> dict:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld {uuid4().hex[:6]}",
        "price_cents": 899,
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


class TestShopAddonAdminAndCatalog:
    def test_admin_crud_roundtrip_and_public_catalog(
        self, client: TestClient, db: Session, owner_cookies: dict, csrf_token: str
    ):
        role = _harmless_role(db, f"VIP-{uuid4().hex[:6]}")
        created = _create_addon(
            client,
            owner_cookies,
            csrf_token,
            slug="supporter-vip",
            name="VIP Rolle",
            category="role",
            extra_ai_tokens=None,
            role_id=role.id,
        )
        assert created["role_id"] == role.id

        inactive = _create_addon(
            client,
            owner_cookies,
            csrf_token,
            slug="storage-hidden",
            name="Versteckter Speicher",
            category="storage",
            extra_ai_tokens=None,
            extra_storage_mb=10240,
            active=False,
        )

        admin_list = client.get("/api/shop/addons", cookies=owner_cookies)
        assert admin_list.status_code == 200
        assert {item["id"] for item in admin_list.json()} >= {
            created["id"],
            inactive["id"],
        }

        updated = client.patch(
            f"/api/shop/addons/{created['id']}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"price_cents": 799},
        )
        assert updated.status_code == 200
        assert updated.json()["price_cents"] == 799

        public = client.get("/api/shop/catalog/addons")
        assert public.status_code == 200
        public_ids = {item["id"] for item in public.json()}
        assert created["id"] in public_ids
        assert inactive["id"] not in public_ids

        entry = next(item for item in public.json() if item["id"] == created["id"])
        assert "role_id" not in entry
        assert entry["grants_role"] is True

        filtered = client.get("/api/shop/catalog/addons?category=role")
        assert filtered.status_code == 200
        assert all(item["category"] == "role" for item in filtered.json())

        deleted = client.delete(
            f"/api/shop/addons/{inactive['id']}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert deleted.status_code == 204

    def test_negative_validation_security_and_permissions(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                json=_addon_payload(),
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/shop/addons",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json=_addon_payload(),
            ).status_code
            == 403
        )
        assert (
            client.get("/api/shop/addons", cookies=user_cookies).status_code == 403
        )

        # Ungueltiger Slug / doppelter Slug
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json=_addon_payload(slug="Bad Slug!"),
            ).status_code
            == 422
        )
        _create_addon(client, owner_cookies, csrf_token, slug="unique-addon")
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json=_addon_payload(slug="unique-addon"),
            ).status_code
            == 422
        )

        # Keine Effekte oder fehlendes Kategorie-Kontingent
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json=_addon_payload(extra_ai_tokens=0),
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json=_addon_payload(category="role", extra_ai_tokens=None, role_id=None),
            ).status_code
            == 422
        )

        # Nicht-EUR Waehrung
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json=_addon_payload(currency="USD"),
            ).status_code
            == 422
        )

        # System- und Eskalationsrollen abweisen
        sys_role = (
            db.query(Role).filter(Role.name == SYSTEM_ROLE_ADMIN).first()
            or db.query(Role).filter(Role.name == SYSTEM_ROLE_USER).first()
        )
        assert sys_role is not None
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json=_addon_payload(
                    category="role", extra_ai_tokens=None, role_id=sys_role.id
                ),
            ).status_code
            == 422
        )

        escalated_role = _harmless_role(
            db, f"Esc-{uuid4().hex[:6]}", keys=("users.manage",)
        )
        assert (
            client.post(
                "/api/shop/addons",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json=_addon_payload(
                    category="role", extra_ai_tokens=None, role_id=escalated_role.id
                ),
            ).status_code
            == 422
        )


class TestStandaloneAddonLifecycleAndRoles:
    def test_order_and_pay_quota_addon_without_server(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        addon = _create_addon(
            client,
            owner_cookies,
            csrf_token,
            slug="backups-extra",
            name="Backup Tresor",
            category="backups",
            extra_ai_tokens=None,
            extra_backups=5,
        )
        server_count_before = db.query(Server).count()

        with patch(
            "services.server_provisioning_service.provision_server",
            side_effect=AssertionError("Add-on darf keinen Server provisionieren"),
        ):
            order_res = client.post(
                "/api/shop/orders",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"addon_id": addon["id"], "months": 1},
            )
            assert order_res.status_code == 200, order_res.text
            order = order_res.json()
            assert order["items"][0]["kind"] == "addon"
            assert order["items"][0]["addon_id"] == addon["id"]

            paid_res = client.post(
                f"/api/shop/orders/{order['id']}/demo-pay",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            )
            assert paid_res.status_code == 200, paid_res.text

        assert db.query(Server).count() == server_count_before
        entitlements = client.get("/api/shop/entitlements", cookies=user_cookies).json()
        assert len(entitlements) == 1
        assert entitlements[0]["kind"] == "addon"
        assert entitlements[0]["addon_id"] == addon["id"]
        assert entitlements[0]["server_id"] is None
        assert entitlements[0]["provisioning_status"] == "ready"
        assert entitlements[0]["provisioning_error"] is None

    def test_negative_order_validation_for_addons(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        addon = _create_addon(client, owner_cookies, csrf_token)
        inactive = _create_addon(
            client, owner_cookies, csrf_token, slug="inactive-addon", active=False
        )

        # Weder plan_id noch addon_id
        assert (
            client.post(
                "/api/shop/orders",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"months": 1},
            ).status_code
            == 422
        )
        # Beide gesetzt
        assert (
            client.post(
                "/api/shop/orders",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"plan_id": plan["id"], "addon_id": addon["id"], "months": 1},
            ).status_code
            == 422
        )
        # Server-Ressourcen auf Add-on-Order
        assert (
            client.post(
                "/api/shop/orders",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"addon_id": addon["id"], "months": 1, "ram_mb": 4096},
            ).status_code
            == 422
        )
        # Inaktives Add-on
        assert (
            client.post(
                "/api/shop/orders",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"addon_id": inactive["id"], "months": 1},
            ).status_code
            == 422
        )

    def test_addon_coexists_with_server_cancel_refund_and_switch(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        plan_role = _harmless_role(db, f"PlanVIP-{uuid4().hex[:6]}")
        addon_role_a = _harmless_role(db, f"AddonA-{uuid4().hex[:6]}")
        addon_role_b = _harmless_role(db, f"AddonB-{uuid4().hex[:6]}")

        plan = _create_plan(client, owner_cookies, csrf_token, role_id=plan_role.id)
        addon_a = _create_addon(
            client,
            owner_cookies,
            csrf_token,
            slug="ai-starter",
            name="KI Starter",
            category="ai_quota",
            price_cents=499,
            extra_ai_tokens=100_000,
            role_id=addon_role_a.id,
        )
        addon_b = _create_addon(
            client,
            owner_cookies,
            csrf_token,
            slug="ai-pro",
            name="KI Pro",
            category="ai_quota",
            price_cents=1299,
            extra_ai_tokens=500_000,
            role_id=addon_role_b.id,
        )
        addon_storage = _create_addon(
            client,
            owner_cookies,
            csrf_token,
            slug="storage-20g",
            name="Speicher 20 GB",
            category="storage",
            price_cents=399,
            extra_ai_tokens=None,
            extra_storage_mb=20480,
            role_id=None,
        )
        inactive_addon = _create_addon(
            client,
            owner_cookies,
            csrf_token,
            slug="ai-legacy",
            name="KI Alt",
            active=False,
        )

        # 1. Server-Tarif bestellen + bezahlen -> Server + plan_role aktiv
        with patch(
            "services.server_provisioning_service.provision_server",
            side_effect=_fake_provision(),
        ):
            plan_order = client.post(
                "/api/shop/orders",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"plan_id": plan["id"], "months": 1},
            ).json()
            assert (
                client.post(
                    f"/api/shop/orders/{plan_order['id']}/demo-pay",
                    cookies=user_cookies,
                    headers={"X-CSRF-Token": user_csrf_token},
                ).status_code
                == 200
            )

        server_ent = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_id == plan_order["id"],
                ShopEntitlement.kind == "server",
            )
            .first()
        )
        assert server_ent is not None and server_ent.server_id is not None

        # 2. Eigenstaendiges Add-on bestellen -> additiver Rollen-Grant ohne zweiten Server
        addon_order = client.post(
            "/api/shop/orders",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"addon_id": addon_a["id"], "months": 1},
        ).json()
        assert (
            client.post(
                f"/api/shop/orders/{addon_order['id']}/demo-pay",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 200
        )

        db.expire_all()
        user_refreshed = db.query(User).filter(User.id == regular_user.id).first()
        assert user_refreshed is not None
        roles_after_buy = set(role_service.effective_user_role_ids(db, user_refreshed))
        assert plan_role.id in roles_after_buy
        assert addon_role_a.id in roles_after_buy

        subs = client.get("/api/shop/subscriptions", cookies=user_cookies).json()
        plan_sub = next(s for s in subs if s["plan_id"] == plan["id"])
        addon_sub = next(s for s in subs if s["addon_id"] == addon_a["id"])

        # 3. Add-on Upgrade auf KI Pro -> addon_role_a weg, addon_role_b + plan_role aktiv
        switch_res = client.post(
            f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"target_addon_id": addon_b["id"]},
        )
        assert switch_res.status_code == 200, switch_res.text
        switched = switch_res.json()
        assert switched["previous_addon_id"] == addon_a["id"]
        assert switched["new_addon_id"] == addon_b["id"]
        assert switched["role_changed"] is True
        assert switched["subscription"]["monthly_gross_cents"] == 1299

        db.expire_all()
        user_refreshed = db.query(User).filter(User.id == regular_user.id).first()
        roles_after_upgrade = set(
            role_service.effective_user_role_ids(db, user_refreshed)
        )
        assert plan_role.id in roles_after_upgrade
        assert addon_role_a.id not in roles_after_upgrade
        assert addon_role_b.id in roles_after_upgrade

        # 4. Wechsel auf rollenloses Add-on -> addon_role_b wird sauber entfernt, Status ready
        switch_storage = client.post(
            f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"target_addon_id": addon_storage["id"]},
        )
        assert switch_storage.status_code == 200
        assert switch_storage.json()["entitlement"]["provisioning_status"] == "ready"
        db.expire_all()
        user_refreshed = db.query(User).filter(User.id == regular_user.id).first()
        roles_after_storage = set(
            role_service.effective_user_role_ids(db, user_refreshed)
        )
        assert plan_role.id in roles_after_storage
        assert addon_role_b.id not in roles_after_storage

        # Negativfaelle fuer addon-switch
        assert (
            client.post(
                f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"target_addon_id": addon_storage["id"]},
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"target_addon_id": inactive_addon["id"]},
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"target_addon_id": 999999},
            ).status_code
            == 404
        )
        assert (
            client.post(
                f"/api/shop/subscriptions/{plan_sub['id']}/addon-switch",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"target_addon_id": addon_a["id"]},
            ).status_code
            == 422
        )
        # Fremdes Abo
        assert (
            client.post(
                f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"target_addon_id": addon_a["id"]},
            ).status_code
            == 404
        )

        # Zurueck auf addon_a schalten, dann kuendigen & erstatten -> Server bleibt aktiv
        assert (
            client.post(
                f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"target_addon_id": addon_a["id"]},
            ).status_code
            == 200
        )

        cancel_res = client.post(
            f"/api/shop/subscriptions/{addon_sub['id']}/cancel",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert cancel_res.status_code == 200
        assert cancel_res.json()["cancel_at_period_end"] is True
        # Nach vorgemerkter Kuendigung darf nicht mehr gewechselt werden
        assert (
            client.post(
                f"/api/shop/subscriptions/{addon_sub['id']}/addon-switch",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"target_addon_id": addon_b["id"]},
            ).status_code
            == 422
        )

        refund_res = client.post(
            f"/api/shop/orders/{addon_order['id']}/refund",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"reason": "Add-on gekuendigt"},
        )
        assert refund_res.status_code == 200, refund_res.text

        db.expire_all()
        user_final = db.query(User).filter(User.id == regular_user.id).first()
        final_roles = set(role_service.effective_user_role_ids(db, user_final))
        assert plan_role.id in final_roles
        assert addon_role_a.id not in final_roles

        db.refresh(server_ent)
        assert server_ent.status == "active"
        assert (
            db.query(ShopOrder).filter(ShopOrder.id == plan_order["id"]).first().status
            == "paid"
        )
        assert (
            db.query(ShopSubscription)
            .filter(ShopSubscription.id == plan_sub["id"])
            .first()
            .status
            == "active"
        )
        assert (
            db.query(ShopSubscription)
            .filter(ShopSubscription.id == addon_sub["id"])
            .first()
            .status
            == "cancelled"
        )


def test_migration_20261121_02_shop_addons_roundtrip(pg_wegwerf) -> None:
    db_url = pg_wegwerf("shop_addons")
    previous = settings.database_url
    settings.database_url = db_url
    backend_dir = Path(__file__).resolve().parent.parent
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    engine = create_engine(db_url)
    try:
        Base.metadata.create_all(engine)
        command.stamp(config, "head")

        command.downgrade(config, "20261121_01")
        insp = inspect(engine)
        assert "shop_addons" not in set(insp.get_table_names())
        for table in ("shop_order_items", "shop_subscriptions", "shop_entitlements"):
            cols = {c["name"] for c in insp.get_columns(table)}
            assert "addon_id" not in cols

        command.upgrade(config, "20261121_02")
        insp = inspect(engine)
        assert "shop_addons" in set(insp.get_table_names())
        for table in ("shop_order_items", "shop_subscriptions", "shop_entitlements"):
            cols = {c["name"] for c in insp.get_columns(table)}
            assert "addon_id" in cols
    finally:
        engine.dispose()
        settings.database_url = previous
