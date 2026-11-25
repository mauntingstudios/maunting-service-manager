"""Tests fuer generische/Steam-Diagnose, State-4-Stub-Schutz und Shop-Disk-Limits."""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from games.install_diagnostics import classify_generic_install_failure
from games.steamcmd_runner import (
    _force_clean_manifest_after_0x2xx,
    classify_steamcmd_failure,
)
from models import Node, Server, ShopEntitlement, ShopPlan, User
from schemas.shop import ShopPlanWrite
from services import shop_catalog_service, shop_fulfillment_service


def _csrf_headers(cookies: dict) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": token}


def test_classify_generic_install_failure_covers_common_causes() -> None:
    disk = classify_generic_install_failure("tar: write error: No space left on device")
    assert disk is not None
    assert disk["error_code"] == "install_disk_full"

    oom = classify_generic_install_failure("container terminated (exit 137 / OOMKilled)")
    assert oom is not None
    assert oom["error_code"] == "install_oom"

    perm = classify_generic_install_failure("bash: ./start.sh: Permission denied")
    assert perm is not None
    assert perm["error_code"] == "install_permission_denied"

    port = classify_generic_install_failure("listen tcp 0.0.0.0:26900: address already in use")
    assert port is not None
    assert port["error_code"] == "server_port_conflict"


def test_classify_steamcmd_failure_detects_verified_disk_quota_evidence() -> None:
    output = (
        "Error! App '294420' state is 0x202 after update job.\n"
        "[MSM-DIAG] disk_avail_mb=5120 disk_total_mb=40960\n"
        '[MSM-DIAG] AppID 294420 update canceled : Failed to preallocate (Not enough disk quota) "16.58 GB"\n'
    )
    res = classify_steamcmd_failure(output)
    assert res is not None
    assert res["error_code"] == "steamcmd_disk_quota_exceeded"
    assert "16.58 GB" in res["error"]
    assert "5.0 GB" in res["error"]


def test_force_clean_manifest_skips_stub_when_no_prior_build_exists(tmp_path) -> None:
    steamapps = tmp_path / "steamapps"
    steamapps.mkdir(parents=True)
    manifest = steamapps / "appmanifest_294420.acf"

    # Ohne vorhandenes Manifest darf kein leerer State-4-Stub geschrieben werden.
    _force_clean_manifest_after_0x2xx(
        server_id=1,
        install_dir=str(tmp_path),
        app_id="294420",
        result={"error": "state is 0x202"},
        live_output=[],
        node=None,
    )
    assert not manifest.exists()

    # Mit buildid "0" (unvollstaendige Erstinstallation) ebenfalls kein Stub.
    manifest.write_text('"AppState"\n{\n\t"appid"\t\t"294420"\n\t"buildid"\t\t"0"\n}\n')
    _force_clean_manifest_after_0x2xx(
        server_id=1,
        install_dir=str(tmp_path),
        app_id="294420",
        result={"error": "state is 0x202"},
        live_output=[],
        node=None,
    )
    assert "post-fail" not in "".join(p.name for p in steamapps.iterdir())

    # Bei echtem installiertem Build (buildid != 0) greift das Best-Effort-Backup + State 4.
    manifest.write_text('"AppState"\n{\n\t"appid"\t\t"294420"\n\t"buildid"\t\t"123456"\n}\n')
    _force_clean_manifest_after_0x2xx(
        server_id=1,
        install_dir=str(tmp_path),
        app_id="294420",
        result={"error": "state is 0x202"},
        live_output=[],
        node=None,
    )
    assert '"StateFlags"\t\t"4"' in manifest.read_text()


def test_shop_disk_limit_pricing_and_server_provisioning(
    client: TestClient,
    db: Session,
    owner_user: User,
    user_cookies: dict,
    monkeypatch,
    tmp_path,
) -> None:
    node = Node(
        name="Disk-Node",
        host="10.20.0.1",
        auth_token_enc="dummy",
        is_local=True,
        status="online",
        ram_total=32768,
        cpu_total=8.0,
        disk_total=204_800,
        shop_enabled=True,
    )
    db.add(node)
    db.commit()
    db.refresh(node)

    plan = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(
            game_type="seven_days_to_die",
            name=f"7D2D Disk Plan {uuid4().hex[:6]}",
            price_cents=1000,
            currency="EUR",
            billing_interval="month",
            tax_rate_percent=19,
            ram_included_mb=4096,
            ram_max_mb=16384,
            ram_step_mb=1024,
            price_per_ram_step_cents=100,
            cpu_included=2,
            cpu_max=6,
            cpu_step=1,
            price_per_cpu_step_cents=150,
            slots_included=8,
            slots_max=32,
            slots_step=1,
            price_per_slot_step_cents=25,
            disk_included_gb=25,
            disk_max_gb=65,
            disk_step_gb=10,
            price_per_disk_step_cents=150,
            node_id=node.id,
            artwork_mode="none",
            active=True,
        ),
        actor_id=owner_user.id,
    )

    # 45 GB = 25 GB enthalten + 2 * 10 GB-Schritte -> +300 Cent -> 1300 Cent brutto.
    order_res = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 2, "slots": 8, "disk_gb": 45, "months": 1},
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert order_res.status_code == 200, order_res.text
    order_data = order_res.json()
    assert order_data["gross_cents"] == 1300
    assert order_data["items"][0]["disk_gb"] == 45

    captured_requests: list = []

    def _fake_provision(session, req, actor, **_kwargs):
        from services.operation_task_service import TASK_SERVER_PROVISION, create_or_reuse_task
        from services.server_provisioning_service import ProvisioningResult

        captured_requests.append(req)
        srv = Server(
            name=req.name,
            game_type=req.game_type,
            install_dir=str(tmp_path / f"srv-{uuid4().hex[:6]}"),
            container_name=f"msm-test-{uuid4().hex[:6]}",
            status="stopped",
            ram_limit_mb=req.ram_limit_mb,
            cpu_limit_percent=req.cpu_limit_percent,
            disk_limit_gb=req.disk_limit_gb,
            node_id=node.id,
        )
        session.add(srv)
        session.flush()
        task, _ = create_or_reuse_task(
            session,
            actor=actor,
            task_type=TASK_SERVER_PROVISION,
            request_hash="a" * 64,
            idempotency_key=f"disk-{uuid4().hex}",
        )
        task.server_id = srv.id
        task.status = "succeeded"
        session.commit()
        return ProvisioningResult(server=srv, task=task, postgres_credentials=[])

    monkeypatch.setattr("services.server_provisioning_service.provision_server", _fake_provision)
    pay_res = client.post(
        f"/api/shop/orders/{order_data['id']}/demo-pay",
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert pay_res.status_code == 200, pay_res.text
    assert len(captured_requests) == 1
    assert captured_requests[0].disk_limit_gb == 45

    ent = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id == order_data["id"], ShopEntitlement.kind == "server")
        .one()
    )
    assert ent.disk_gb == 45
    srv = db.query(Server).filter(Server.id == ent.server_id).one()
    assert srv.disk_limit_gb == 45
