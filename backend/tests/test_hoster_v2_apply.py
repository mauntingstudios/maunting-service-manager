"""Tests fuer Hoster-API v2 (`POST /api/hoster/v1/apply`) und gemeinsame Rechtebasis."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
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
    HosterIntegration,
    HosterService,
    Role,
    RolePermission,
    Server,
    ShopAddon,
    ShopEntitlement,
    ShopOrder,
    ShopOrderItem,
    User,
)
from services import (
    hoster_integration_service,
    permission_service,
    server_config_wishes,
    shop_fulfillment_service,
)
from services.auth_service import AuthService
from services.operation_task_service import TASK_SERVER_PROVISION, create_or_reuse_task
from services.role_service import effective_user_role_ids, set_user_roles
from services.server_provisioning_service import ProvisioningResult


API_KEY_HEADER = hoster_integration_service.API_KEY_HEADER


def _role(db: Session, name: str, *, keys: tuple[str, ...] = ()) -> Role:
    role = Role(name=name, is_system=False)
    db.add(role)
    db.flush()
    for key in keys:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    db.refresh(role)
    return role


def _service_user(db: Session, *, extra_keys: tuple[str, ...] = ()) -> User:
    user = AuthService.create_user(
        db, f"svc-{uuid4().hex[:6]}", f"svc-{uuid4().hex[:6]}@test.de", "ShopPass123!"
    )
    role = _role(
        db,
        f"hoster-svc-{uuid4().hex[:6]}",
        keys=("servers.create", "servers.delete", *extra_keys),
    )
    set_user_roles(db, user, [role.id])
    db.refresh(user)
    return user


def _integration(
    db: Session, service_user: User, *, is_sandbox: bool = False
) -> tuple[HosterIntegration, str]:
    integration, api_key = hoster_integration_service.create_integration(
        db,
        name=f"Shop-{uuid4().hex[:6]}",
        slug=f"shop-{uuid4().hex[:6]}",
        enabled=True,
        is_sandbox=is_sandbox,
        service_user_id=service_user.id,
        webhook_url=None,
        terminate_grace_days=7,
    )
    db.commit()
    db.refresh(integration)
    return integration, api_key


def _product(
    db: Session,
    integration: HosterIntegration,
    *,
    key: str = "pw-8gb",
    game_type: str = "palworld",
    role_id: int | None = None,
) -> None:
    hoster_integration_service.upsert_product(
        db,
        integration=integration,
        external_product_key=key,
        game_type=game_type,
        ram_limit_mb=8192,
        cpu_limit_percent=200,
        disk_limit_gb=50,
        node_id=None,
        backup_interval_hours=None,
        role_id=role_id,
        enabled=True,
    )
    db.commit()


def _addon(
    db: Session,
    *,
    slug: str,
    name: str | None = None,
    category: str = "ai_quota",
    role_id: int | None = None,
    extra_ai_tokens: int | None = 100_000,
    extra_storage_mb: int | None = None,
    active: bool = True,
) -> ShopAddon:
    row = ShopAddon(
        slug=slug,
        name=name or slug,
        category=category,
        price_cents=499,
        currency="EUR",
        billing_interval="month",
        tax_rate_percent=19,
        extra_ai_tokens=extra_ai_tokens,
        extra_storage_mb=extra_storage_mb,
        role_id=role_id,
        active=active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _fake_provision():
    def _provision(session: Session, request, actor, *, idempotency_key=None, retry_of_id=None):
        task, created = create_or_reuse_task(
            session,
            actor=actor,
            task_type=TASK_SERVER_PROVISION,
            request_hash=hashlib.sha256(
                json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()
            ).hexdigest(),
            idempotency_key=idempotency_key,
        )
        if not created and task.server_id is not None:
            server = session.query(Server).filter(Server.id == task.server_id).first()
            return ProvisioningResult(
                server=server, task=task, postgres_credentials=[], reused=True
            )
        server = Server(
            name=request.name,
            game_type=request.game_type,
            install_dir=f"/tmp/hoster-v2-{uuid4().hex[:8]}",
            container_name=f"msm-hv2-{uuid4().hex[:8]}",
            status="stopped",
            ram_limit_mb=request.ram_limit_mb,
            cpu_limit_percent=request.cpu_limit_percent,
            disk_limit_gb=request.disk_limit_gb,
        )
        session.add(server)
        session.flush()
        task.server_id = server.id
        task.status = "succeeded"
        task.phase = "completed"
        session.commit()
        return ProvisioningResult(server=server, task=task, postgres_credentials=[])

    return _provision


def _customer_roles_for_service(db: Session, integration_id: int, ext_id: str) -> set[int]:
    db.expire_all()
    svc = (
        db.query(HosterService)
        .filter(
            HosterService.integration_id == integration_id,
            HosterService.external_service_id == ext_id,
        )
        .one()
    )
    customer = db.query(User).filter(User.id == svc.identity.user_id).one()
    return set(effective_user_role_ids(db, customer))


class TestHosterV2Apply:
    def test_mixed_server_with_slots_and_addon_batch_is_idempotent(
        self, client: TestClient, db: Session
    ):
        svc_user = _service_user(db, extra_keys=("ai.chat.use",))
        integration, api_key = _integration(db, svc_user)
        plan_role = _role(db, f"HosterPlan-{uuid4().hex[:6]}")
        addon_role = _role(db, f"HosterAddon-{uuid4().hex[:6]}", keys=("ai.chat.use",))
        _product(db, integration, key="pw-8gb", game_type="palworld", role_id=plan_role.id)
        _addon(db, slug="ai-pro", name="KI Pro", role_id=addon_role.id)

        payload = {
            "external_subject": "CUST-V2-1",
            "desired_state": "active",
            "email": "v2kunde@example.de",
            "items": [
                {
                    "external_service_id": "SRV-1",
                    "kind": "server",
                    "product_key": "pw-8gb",
                    "slots": 16,
                },
                {
                    "external_service_id": "ADD-1",
                    "kind": "addon",
                    "addon_slug": "ai-pro",
                },
            ],
        }

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            res1 = client.post(
                "/api/hoster/v1/apply",
                json=payload,
                headers={
                    API_KEY_HEADER: api_key,
                    "Idempotency-Key": "batch-9001",
                },
            )
            res2 = client.post(
                "/api/hoster/v1/apply",
                json=payload,
                headers={
                    API_KEY_HEADER: api_key,
                    "Idempotency-Key": "batch-9001",
                },
            )

            assert res1.status_code == 200, res1.text
            assert res2.status_code == 200, res2.text
            body = res1.json()
            assert body["sandbox"] is False
            assert body["external_subject"] == "CUST-V2-1"
            assert len(body["items"]) == 2

            srv_item, add_item = body["items"]
            assert srv_item["item_kind"] == "server"
            assert srv_item["status"] == "ready"
            assert srv_item["server_id"] is not None
            assert srv_item["ok"] is True

            assert add_item["item_kind"] == "addon"
            assert add_item["addon_slug"] == "ai-pro"
            assert add_item["status"] == "ready"
            assert add_item["server_id"] is None
            assert add_item["ok"] is True

            # Idempotenz: genau 1 Server und genau 2 HosterService-Zeilen
            assert db.query(Server).count() == 1
            assert db.query(HosterService).count() == 2
            assert res2.json()["items"][0]["server_id"] == srv_item["server_id"]

            # Slot-Wunsch wurde an Palworld-INI uebernommen
            server = db.query(Server).filter(Server.id == srv_item["server_id"]).one()
            wishes = server_config_wishes.lese(server.config_wishes_json)
            assert any(w.schluessel == "ServerPlayerMaxNum" and w.wert == "16" for w in wishes)
            from services import shop_slot_service

            assert shop_slot_service.read_configured_slots(db, server) == 16

            # Beide Rollen additiv vergeben
            roles = _customer_roles_for_service(db, integration.id, "ADD-1")
            assert {plan_role.id, addon_role.id} <= roles

            # v1 GET zeigt addon/server sauber inkl. neuer Felder; v1 PUT bleibt Server-Alias
            get_addon = client.get(
                "/api/hoster/v1/services/ADD-1",
                headers={API_KEY_HEADER: api_key},
            )
            assert get_addon.status_code == 200
            assert get_addon.json()["item_kind"] == "addon"
            assert get_addon.json()["addon_slug"] == "ai-pro"

            v1_alias = client.put(
                "/api/hoster/v1/services/SRV-V1",
                json={
                    "desired_state": "active",
                    "external_subject": "CUST-V2-1",
                    "product_key": "pw-8gb",
                },
                headers={API_KEY_HEADER: api_key},
            )
            assert v1_alias.status_code == 200
            assert v1_alias.json()["item_kind"] == "server"

    def test_addon_upgrade_downgrade_per_item_suspend_and_terminate(
        self, client: TestClient, db: Session
    ):
        svc_user = _service_user(db)
        integration, api_key = _integration(db, svc_user)
        plan_role = _role(db, f"SrvRole-{uuid4().hex[:6]}")
        role_a = _role(db, f"AddonRoleA-{uuid4().hex[:6]}")
        role_b = _role(db, f"AddonRoleB-{uuid4().hex[:6]}")
        _product(db, integration, key="pw-8gb", role_id=plan_role.id)
        _addon(db, slug="ai-a", role_id=role_a.id)
        _addon(db, slug="ai-b", role_id=role_b.id)
        _addon(
            db,
            slug="storage-20g",
            category="storage",
            extra_ai_tokens=None,
            extra_storage_mb=20480,
            role_id=None,
        )

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            init = client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "CUST-UPG",
                    "desired_state": "active",
                    "items": [
                        {"external_service_id": "S-1", "kind": "server", "product_key": "pw-8gb"},
                        {"external_service_id": "A-1", "kind": "addon", "addon_slug": "ai-a"},
                    ],
                },
            )
            assert init.status_code == 200, init.text
            assert {plan_role.id, role_a.id} <= _customer_roles_for_service(
                db, integration.id, "A-1"
            )

            # Add-on Upgrade -> role_a weg, role_b + plan_role aktiv, Server unberuehrt
            upg = client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "CUST-UPG",
                    "desired_state": "active",
                    "items": [
                        {"external_service_id": "A-1", "kind": "addon", "addon_slug": "ai-b"},
                    ],
                },
            )
            assert upg.status_code == 200
            roles_upg = _customer_roles_for_service(db, integration.id, "A-1")
            assert plan_role.id in roles_upg
            assert role_a.id not in roles_upg
            assert role_b.id in roles_upg

            # Per-Item Suspend auf A-1 while S-1 stays active
            susp = client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "CUST-UPG",
                    "desired_state": "active",
                    "items": [
                        {"external_service_id": "S-1", "kind": "server"},
                        {
                            "external_service_id": "A-1",
                            "kind": "addon",
                            "desired_state": "suspended",
                        },
                    ],
                },
            )
            assert susp.status_code == 200
            assert susp.json()["items"][0]["status"] == "ready"
            assert susp.json()["items"][1]["status"] == "suspended"
            roles_susp = _customer_roles_for_service(db, integration.id, "A-1")
            assert plan_role.id in roles_susp
            assert role_b.id not in roles_susp

            # Downgrade auf rollenloses Storage-Add-on -> wieder active + ready ohne Rolle
            storage_res = client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "CUST-UPG",
                    "desired_state": "active",
                    "items": [
                        {"external_service_id": "A-1", "kind": "addon", "addon_slug": "storage-20g"},
                    ],
                },
            )
            assert storage_res.status_code == 200
            assert storage_res.json()["items"][0]["status"] == "ready"
            assert storage_res.json()["items"][0]["addon_slug"] == "storage-20g"

            # Unabhaengige Kuendigung des Add-ons
            term = client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "CUST-UPG",
                    "desired_state": "terminated",
                    "items": [{"external_service_id": "A-1", "kind": "addon"}],
                },
            )
            assert term.status_code == 200
            assert term.json()["items"][0]["status"] == "terminated"
            assert term.json()["items"][0]["terminate_after"] is not None
            srv_check = client.get("/api/hoster/v1/services/S-1", headers={API_KEY_HEADER: api_key})
            assert srv_check.json()["status"] == "ready"

    def test_bidirectional_coexistence_between_hoster_v2_and_native_shop(
        self, client: TestClient, db: Session
    ):
        svc_user = _service_user(db)
        integration, api_key = _integration(db, svc_user)
        shared_role = _role(db, f"SharedVIP-{uuid4().hex[:6]}")
        addon = _addon(db, slug="vip-shared", role_id=shared_role.id)

        # Hoster-API v2 aktiviert Add-on fuer CUST-MIX
        res = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "CUST-MIX",
                "desired_state": "active",
                "email": "mix@example.de",
                "items": [{"external_service_id": "H-ADD-1", "kind": "addon", "addon_slug": "vip-shared"}],
            },
        )
        assert res.status_code == 200
        svc = (
            db.query(HosterService)
            .filter(
                HosterService.integration_id == integration.id,
                HosterService.external_service_id == "H-ADD-1",
            )
            .one()
        )
        user_id = svc.identity.user_id

        # Native Shop-Entitlement fuer denselben User mit derselben Rolle anlegen
        order = ShopOrder(
            number=f"MSM-MIX-{uuid4().hex[:6]}",
            user_id=user_id,
            status="paid",
            currency="EUR",
            billing_interval="month",
            months=1,
            discount_percent=0,
            net_cents=419,
            tax_cents=80,
            gross_cents=499,
            payment_provider="demo",
            paid_at=datetime.now(timezone.utc),
        )
        db.add(order)
        db.flush()
        order_item = ShopOrderItem(
            order_id=order.id,
            kind="addon",
            addon_id=addon.id,
            game_type="addon:ai_quota",
            name=addon.name,
            quantity=1,
            unit_price_cents=499,
            tax_rate_percent=19,
            net_cents=419,
            tax_cents=80,
            gross_cents=499,
        )
        db.add(order_item)
        db.flush()
        ent = ShopEntitlement(
            user_id=user_id,
            order_id=order.id,
            order_item_id=order_item.id,
            kind="addon",
            label=addon.name,
            addon_id=addon.id,
            role_id=shared_role.id,
            status="active",
        )
        db.add(ent)
        db.commit()
        shop_fulfillment_service.sync_entitlement(db, ent.id)

        # Richtung 1: Hoster-API kuendigt -> native Shop-Entitlement haelt Rolle aktiv
        term = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "CUST-MIX",
                "desired_state": "terminated",
                "items": [{"external_service_id": "H-ADD-1", "kind": "addon"}],
            },
        )
        assert term.status_code == 200
        assert shared_role.id in _customer_roles_for_service(
            db, integration.id, "H-ADD-1"
        )

        # Richtung 2: Hoster wieder aktivieren, dann native Shop-Entitlement entziehen -> Hoster haelt Rolle
        assert (
            client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "CUST-MIX",
                    "desired_state": "active",
                    "items": [{"external_service_id": "H-ADD-1", "kind": "addon"}],
                },
            ).status_code
            == 200
        )
        ent_row = db.query(ShopEntitlement).filter(ShopEntitlement.id == ent.id).one()
        ent_row.status = "revoked"
        db.commit()
        shop_fulfillment_service.sync_entitlement(db, ent.id)
        assert shared_role.id in _customer_roles_for_service(
            db, integration.id, "H-ADD-1"
        )

    def test_sandbox_flag_and_reset(
        self, client: TestClient, db: Session, owner_cookies: dict, csrf_token: str
    ):
        svc_user = _service_user(db)
        integration, api_key = _integration(db, svc_user, is_sandbox=True)
        _addon(db, slug="sbx-addon", category="backups", extra_ai_tokens=None)
        # extra_backups direkt setzen
        row = db.query(ShopAddon).filter(ShopAddon.slug == "sbx-addon").one()
        row.extra_backups = 3
        db.commit()

        res = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "SBX-USER",
                "desired_state": "active",
                "items": [{"external_service_id": "SBX-A1", "kind": "addon", "addon_slug": "sbx-addon"}],
            },
        )
        assert res.status_code == 200, res.text
        assert res.json()["sandbox"] is True

        cleaned = client.delete(
            f"/api/hoster/integrations/{integration.id}/sandbox-data",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert cleaned.status_code == 200
        assert db.query(HosterService).filter(HosterService.integration_id == integration.id).count() == 0

    def test_negative_validation_auth_prevalidation_and_role_escalation(
        self, client: TestClient, db: Session, owner_cookies: dict
    ):
        svc_user = _service_user(db)
        integration, api_key = _integration(db, svc_user)
        _product(db, integration, key="pw-ok", game_type="palworld")
        _product(db, integration, key="val-noslots", game_type="valheim")
        _addon(db, slug="ok-addon", role_id=None)
        _addon(db, slug="inactive-addon", role_id=None, active=False)

        # Ungueltiger API-Key & Browser-Cookies ohne Key -> 401
        sample = {
            "external_subject": "NEG-1",
            "desired_state": "active",
            "items": [{"external_service_id": "X-1", "kind": "addon", "addon_slug": "ok-addon"}],
        }
        assert client.post("/api/hoster/v1/apply", json=sample).status_code == 401
        assert (
            client.post("/api/hoster/v1/apply", json=sample, cookies=owner_cookies).status_code
            == 401
        )

        # Cross-kind Felder & Duplikate -> 422
        assert (
            client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "NEG-1",
                    "desired_state": "active",
                    "items": [{"external_service_id": "S-1", "kind": "server", "addon_slug": "ok-addon"}],
                },
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "NEG-1",
                    "desired_state": "active",
                    "items": [{"external_service_id": "A-1", "kind": "addon", "product_key": "pw-ok"}],
                },
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "NEG-1",
                    "desired_state": "active",
                    "items": [
                        {"external_service_id": "DUP-1", "kind": "addon", "addon_slug": "ok-addon"},
                        {"external_service_id": "DUP-1", "kind": "addon", "addon_slug": "ok-addon"},
                    ],
                },
            ).status_code
            == 422
        )

        # Pre-Validation Atomizitaet: gueltiger Server + fehlerhaftes Add-on / ungueltige Slots -> KEIN Server angelegt
        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            bad_batch = client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "NEG-ATOMIC",
                    "desired_state": "active",
                    "items": [
                        {"external_service_id": "GOOD-SRV", "kind": "server", "product_key": "pw-ok"},
                        {"external_service_id": "BAD-ADD", "kind": "addon", "addon_slug": "inactive-addon"},
                    ],
                },
            )
            assert bad_batch.status_code == 422
            assert db.query(Server).count() == 0
            assert db.query(HosterService).count() == 0

            bad_slots = client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "NEG-SLOTS",
                    "desired_state": "active",
                    "items": [
                        {
                            "external_service_id": "VAL-1",
                            "kind": "server",
                            "product_key": "val-noslots",
                            "slots": 12,
                        }
                    ],
                },
            )
            assert bad_slots.status_code == 422
            assert db.query(Server).count() == 0

        # Item-Kind-Mismatch zwischen Add-on und Server (sowohl v2 /apply als auch v1 PUT)
        assert (
            client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "KIND-1",
                    "desired_state": "active",
                    "items": [{"external_service_id": "KEEP-ADD", "kind": "addon", "addon_slug": "ok-addon"}],
                },
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/api/hoster/v1/apply",
                headers={API_KEY_HEADER: api_key},
                json={
                    "external_subject": "KIND-1",
                    "desired_state": "active",
                    "items": [{"external_service_id": "KEEP-ADD", "kind": "server", "product_key": "pw-ok"}],
                },
            ).status_code
            == 422
        )
        assert (
            client.put(
                "/api/hoster/v1/services/KEEP-ADD",
                headers={API_KEY_HEADER: api_key},
                json={
                    "desired_state": "active",
                    "external_subject": "KIND-1",
                    "product_key": "pw-ok",
                },
            ).status_code
            == 422
        )
        assert (
            client.get("/api/hoster/v1/services/KEEP-ADD", headers={API_KEY_HEADER: api_key}).json()[
                "status"
            ]
            == "ready"
        )

        # Role Escalation 1: Dienstbenutzer darf Rolle nicht delegieren
        undel_role = _role(db, f"Undel-{uuid4().hex[:6]}", keys=("ai.chat.use",))
        _addon(db, slug="esc-deleg", role_id=undel_role.id)
        esc1 = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "ESC-USER",
                "desired_state": "active",
                "items": [{"external_service_id": "ESC-1", "kind": "addon", "addon_slug": "esc-deleg"}],
            },
        )
        assert esc1.status_code == 422
        esc1_state = client.get(
            "/api/hoster/v1/services/ESC-1", headers={API_KEY_HEADER: api_key}
        ).json()
        assert esc1_state["status"] == "failed"
        assert esc1_state["status_code"] == "hoster_role_escalation"
        assert undel_role.id not in _customer_roles_for_service(db, integration.id, "ESC-1")

        # Role Escalation 2: Rolle ausserhalb Shop-Allowlist (selbst wenn svc_user Recht hat)
        admin_svc_user = _service_user(db, extra_keys=("users.manage",))
        int2, key2 = _integration(db, admin_svc_user)
        disallowed_role = _role(db, f"Disallow-{uuid4().hex[:6]}", keys=("users.manage",))
        _addon(db, slug="esc-allowlist", role_id=disallowed_role.id)
        esc2 = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: key2},
            json={
                "external_subject": "ESC-USER-2",
                "desired_state": "active",
                "items": [{"external_service_id": "ESC-2", "kind": "addon", "addon_slug": "esc-allowlist"}],
            },
        )
        assert esc2.status_code == 422
        esc2_state = client.get("/api/hoster/v1/services/ESC-2", headers={API_KEY_HEADER: key2}).json()
        assert esc2_state["status"] == "failed"
        assert esc2_state["status_code"] == "hoster_role_escalation"
        assert disallowed_role.id not in _customer_roles_for_service(db, int2.id, "ESC-2")


def test_migration_20261121_03_hoster_v2_apply_roundtrip(pg_wegwerf) -> None:
    db_url = pg_wegwerf("hoster_v2")
    previous = settings.database_url
    settings.database_url = db_url
    backend_dir = Path(__file__).resolve().parent.parent
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    engine = create_engine(db_url)
    try:
        Base.metadata.create_all(engine)
        command.stamp(config, "head")

        command.downgrade(config, "20261121_02")
        insp = inspect(engine)
        cols = {c["name"] for c in insp.get_columns("hoster_services")}
        assert "item_kind" not in cols
        assert "addon_id" not in cols

        command.upgrade(config, "20261121_03")
        insp = inspect(engine)
        cols = {c["name"] for c in insp.get_columns("hoster_services")}
        assert "item_kind" in cols
        assert "addon_id" in cols
        ck_names = {c["name"] for c in insp.get_check_constraints("hoster_services")}
        fk_names = {f["name"] for f in insp.get_foreign_keys("hoster_services")}
        assert "ck_hoster_services_item_kind" in ck_names
        assert "fk_hoster_services_addon" in fk_names
    finally:
        engine.dispose()
        settings.database_url = previous
