"""Tests fuer einheitlichen Hoster-Katalog (`GET /api/hoster/v1/catalog`), `plan_id`/`variables` Apply und Simulator."""

from __future__ import annotations

import hashlib
import json
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    HosterIdentity,
    HosterService,
    Role,
    RoleAiProjectQuota,
    RolePermission,
    Server,
    ShopAddon,
    ShopPlan,
    User,
)
from services import hoster_integration_service, hoster_simulator_service, shop_slot_service
from services.auth_service import AuthService
from services.operation_task_service import TASK_SERVER_PROVISION, create_or_reuse_task
from services.role_service import effective_user_role_ids, set_user_roles
from services.server_provisioning_service import ProvisioningResult
from services.server_runtime_env import get_runtime_env
from schemas.hoster import HosterSimulationRequest


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
        keys=("servers.create", "servers.delete", "server.stop", *extra_keys),
    )
    set_user_roles(db, user, [role.id])
    db.refresh(user)
    return user


def _fake_provision():
    def _provision(
        session: Session,
        request,
        actor,
        *,
        idempotency_key=None,
        retry_of_id=None,
        auto_place: bool = False,
        strict_capacity: bool = False,
    ):
        _ = auto_place, strict_capacity
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
        if not created and task.server_id is not None:
            server = session.query(Server).filter(Server.id == task.server_id).first()
            return ProvisioningResult(
                server=server, task=task, postgres_credentials=[], reused=True
            )
        server = Server(
            name=request.name,
            game_type=request.game_type,
            install_dir=f"/tmp/hoster-cat-{uuid4().hex[:8]}",
            container_name=f"msm-hcat-{uuid4().hex[:8]}",
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
        session.flush()
        return ProvisioningResult(
            server=server, task=task, postgres_credentials=[], reused=False
        )

    return _provision


def test_hoster_catalog_exposes_shop_plans_gallery_variables_and_addon_quotas(
    client: TestClient, db: Session
):
    svc = _service_user(db)
    _integration, api_key = hoster_integration_service.create_integration(
        db,
        name="ExtShop",
        slug=f"ext-{uuid4().hex[:6]}",
        enabled=True,
        is_sandbox=False,
        service_user_id=svc.id,
        webhook_url=None,
        terminate_grace_days=7,
    )
    dev_role = _role(db, f"dev-{uuid4().hex[:6]}", keys=("ai.projects.manage", "ai.projects.preview"))
    db.add(RoleAiProjectQuota(role_id=dev_role.id, max_projects=12, max_storage_mb=2048))

    active_plan = ShopPlan(
        game_type="minecraft_paper",
        name="Paper Pro",
        description="Schneller Paper-Tarif",
        price_cents=1299,
        currency="EUR",
        billing_interval="month",
        tax_rate_percent=19,
        ram_included_mb=4096,
        ram_max_mb=16384,
        ram_step_mb=1024,
        cpu_included=2,
        cpu_max=6,
        slots_included=10,
        slots_max=100,
        role_id=dev_role.id,
        artwork_mode="steam",
        active=True,
        sort_order=1,
    )
    inactive_plan = ShopPlan(
        game_type="minecraft_paper",
        name="Archiv-Tarif",
        price_cents=999,
        active=False,
    )
    addon = ShopAddon(
        slug=f"proj-pro-{uuid4().hex[:6]}",
        name="Projekt Pro Add-on",
        category="role",
        price_cents=499,
        role_id=dev_role.id,
        active=True,
    )
    db.add_all([active_plan, inactive_plan, addon])
    db.commit()

    # Ohne Key -> 401
    unauth = client.get("/api/hoster/v1/catalog")
    assert unauth.status_code == 401

    resp = client.get("/api/hoster/v1/catalog", headers={API_KEY_HEADER: api_key})
    assert resp.status_code == 200
    body = resp.json()

    plans = [p for p in body["plans"] if p["plan_id"] == active_plan.id]
    assert len(plans) == 1
    assert plans[0]["product_key"] == f"plan:{active_plan.id}"
    assert plans[0]["ram_included_mb"] == 4096
    assert any(v["key"] == "VERSION" for v in plans[0]["variables"])
    assert not any(p["plan_id"] == inactive_plan.id for p in body["plans"])

    found_addons = [a for a in body["addons"] if a["slug"] == addon.slug]
    assert len(found_addons) == 1
    assert found_addons[0]["role_quota"]["max_projects"] == 12
    assert found_addons[0]["role_quota"]["max_storage_mb"] == 2048


def test_apply_via_shop_plan_id_validates_bounds_sets_variables_and_syncs_roles(
    client: TestClient, db: Session
):
    plan_role = _role(db, f"planrole-{uuid4().hex[:6]}", keys=("ai.chat.use",))
    svc = _service_user(db, extra_keys=("ai.chat.use",))
    _integration, api_key = hoster_integration_service.create_integration(
        db,
        name="ShopApply",
        slug=f"apply-{uuid4().hex[:6]}",
        enabled=True,
        is_sandbox=False,
        service_user_id=svc.id,
        webhook_url=None,
        terminate_grace_days=7,
    )
    plan = ShopPlan(
        game_type="minecraft_paper",
        name=f"Paper-{uuid4().hex[:4]}",
        price_cents=1499,
        ram_included_mb=4096,
        ram_max_mb=8192,
        cpu_included=2,
        cpu_max=4,
        slots_included=10,
        slots_max=50,
        role_id=plan_role.id,
        active=True,
    )
    db.add(plan)
    db.commit()

    with patch(
        "services.server_provisioning_service.provision_server",
        side_effect=_fake_provision(),
    ):
        # Ungueltige RAM-Ueberschreitung -> 422
        too_much = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "CUST-BOUNDS-1",
                "desired_state": "active",
                "items": [
                    {
                        "external_service_id": "SVC-OOB",
                        "kind": "server",
                        "plan_id": plan.id,
                        "ram_mb": 32768,
                    }
                ],
            },
        )
        assert too_much.status_code == 422

        # Ungueltige Variable -> 422
        bad_var = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "CUST-BOUNDS-1",
                "desired_state": "active",
                "items": [
                    {
                        "external_service_id": "SVC-BAD-VAR",
                        "kind": "server",
                        "plan_id": plan.id,
                        "variables": {"DIFFICULTY": "impossible"},
                    }
                ],
            },
        )
        assert bad_var.status_code == 422

        # Gueltiger Batch via product_key="plan:<id>" + Variablen + RAM-Override innerhalb Tarif
        ok_resp = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "CUST-PLAN-1",
                "desired_state": "active",
                "email": "plan@kunde.de",
                "items": [
                    {
                        "external_service_id": "SVC-PLAN-OK",
                        "kind": "server",
                        "product_key": f"plan:{plan.id}",
                        "ram_mb": 6144,
                        "slots": 25,
                        "variables": {"VERSION": "1.21.4", "DIFFICULTY": "hard"},
                    }
                ],
            },
        )
        assert ok_resp.status_code == 200
        item = ok_resp.json()["items"][0]
        assert item["plan_id"] == plan.id
        assert item["status"] == "ready"
        server_id = item["server_id"]

    srv = db.get(Server, server_id)
    assert srv is not None
    assert srv.ram_limit_mb == 6144
    assert srv.cpu_limit_percent == 200
    assert shop_slot_service.read_configured_slots(db, srv) == 25

    env = get_runtime_env(server_id, db=db)
    assert env["VERSION"] == "1.21.4"
    assert env["DIFFICULTY"] == "hard"

    # Rolle vom Plan vergeben und bei Kuendigung wieder entzogen
    hs = db.query(HosterService).filter(HosterService.external_service_id == "SVC-PLAN-OK").first()
    assert hs is not None
    ident = db.get(HosterIdentity, hs.identity_id)
    assert ident is not None
    cust = db.get(User, ident.user_id)
    assert cust is not None
    assert plan_role.id in effective_user_role_ids(db, cust)

    with patch(
        "services.server_action_service.request_lifecycle_operation",
        return_value={"task_id": "t-stop"},
    ):
        term = client.post(
            "/api/hoster/v1/apply",
            headers={API_KEY_HEADER: api_key},
            json={
                "external_subject": "CUST-PLAN-1",
                "desired_state": "terminated",
                "items": [{"external_service_id": "SVC-PLAN-OK", "kind": "server"}],
            },
        )
    assert term.status_code == 200
    assert plan_role.id not in effective_user_role_ids(db, cust)


def test_simulator_orders_from_shop_plan_without_legacy_product(db: Session):
    svc = _service_user(db)
    integration, _ = hoster_integration_service.create_integration(
        db,
        name="SimShop",
        slug=f"sim-{uuid4().hex[:6]}",
        enabled=True,
        is_sandbox=True,
        service_user_id=svc.id,
        webhook_url=None,
        terminate_grace_days=7,
    )
    plan = ShopPlan(
        game_type="minecraft_paper",
        name=f"SimTarif-{uuid4().hex[:4]}",
        price_cents=799,
        ram_included_mb=2048,
        cpu_included=1,
        active=True,
    )
    db.add(plan)
    db.commit()

    with patch(
        "services.server_provisioning_service.provision_server",
        side_effect=_fake_provision(),
    ):
        sim = hoster_simulator_service.simulate_event(
            db,
            integration=integration,
            req=HosterSimulationRequest(action="order", plan_id=plan.id),
        )
    assert sim.ok is True
    assert sim.service is not None
    assert sim.service.plan_id == plan.id
    assert sim.service.status == "ready"
