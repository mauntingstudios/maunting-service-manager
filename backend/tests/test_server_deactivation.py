"""Tests fuer das Deaktivieren und Reaktivieren von Self-Hosted-Servern."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    HosterIdentity,
    HosterIntegration,
    HosterService,
    Node,
    Server,
    ServerPort,
    ShopEntitlement,
    ShopOrder,
    ShopOrderItem,
    ShopPlan,
    User,
)
from models.hoster import hash_token
from services import permission_service
from services.node_capacity import (
    allocated_cpu_by_node_ids,
    allocated_ram_by_node_ids,
    sum_allocated_cpu_percent,
    sum_allocated_disk_gb,
    sum_allocated_ram_mb,
)
from services.scheduler_service import _restart_server_task
from services.server_lifecycle_service import restart_server_with_updates


def _make_node(
    db: Session,
    *,
    ram_total_mb: int = 9216,
    cpu_total: float = 4.0,
    disk_total_gb: int = 200,
    status: str = "online",
) -> Node:
    node = Node(
        name=f"node-{uuid4().hex[:6]}",
        host="127.0.0.1",
        auth_token_enc="test-token",
        is_local=True,
        status=status,
        ram_total=ram_total_mb,
        cpu_total=cpu_total,
        disk_total=disk_total_gb * 1024,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


def _make_server(
    db: Session,
    node: Node,
    *,
    name: str | None = None,
    status: str = "stopped",
    ram_limit_mb: int | None = 4096,
    cpu_limit_percent: int | None = 200,
    disk_limit_gb: int | None = 25,
    game_port: int | None = 27015,
    is_deactivated: bool = False,
) -> Server:
    srv = Server(
        name=name or f"srv-{uuid4().hex[:6]}",
        game_type="minecraft",
        install_dir=f"/tmp/msm-test-{uuid4().hex[:8]}",
        node_id=node.id,
        status=status,
        desired_power_state="running" if status == "running" else "stopped",
        ram_limit_mb=ram_limit_mb,
        cpu_limit_percent=cpu_limit_percent,
        disk_limit_gb=disk_limit_gb,
        public_bind_ip="127.0.0.1",
        is_deactivated=is_deactivated,
    )
    if game_port is not None:
        srv.set_port("game", game_port, "udp")
    db.add(srv)
    db.commit()
    db.refresh(srv)
    return srv


def test_deactivate_frees_ram_and_cpu_while_preserving_disk_and_ports(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    csrf_token: str | None,
) -> None:
    node = _make_node(db, ram_total_mb=9216, cpu_total=4.0, disk_total_gb=100)
    srv_a = _make_server(db, node, ram_limit_mb=6144, cpu_limit_percent=300, disk_limit_gb=40, game_port=25565)
    srv_b = _make_server(db, node, ram_limit_mb=2048, cpu_limit_percent=100, disk_limit_gb=15, game_port=25566)

    assert sum_allocated_ram_mb(db, node.id) == 8192
    assert allocated_ram_by_node_ids(db, [node.id])[node.id] == 8192
    assert sum_allocated_cpu_percent(db, node.id) == 400
    assert allocated_cpu_by_node_ids(db, [node.id])[node.id] == 400
    assert sum_allocated_disk_gb(db, node.id) == 55

    resp = client.post(
        f"/api/servers/{srv_a.id}/deactivate",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_deactivated"] is True
    assert body["deactivated_at"] is not None

    # RAM & CPU von srv_a sind frei, Disk & Ports bleiben belegt bzw. reserviert.
    assert sum_allocated_ram_mb(db, node.id) == 2048
    assert allocated_ram_by_node_ids(db, [node.id])[node.id] == 2048
    assert sum_allocated_cpu_percent(db, node.id) == 100
    assert allocated_cpu_by_node_ids(db, [node.id])[node.id] == 100
    assert sum_allocated_disk_gb(db, node.id) == 55

    ports = db.query(ServerPort).filter(ServerPort.server_id == srv_a.id).all()
    assert [(p.role, p.port) for p in ports] == [("game", 25565)]


def test_deactivated_server_blocks_start_restart_and_auto_restart(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    csrf_token: str | None,
) -> None:
    node = _make_node(db)
    srv = _make_server(db, node, status="stopped", is_deactivated=True)

    start_resp = client.post(
        f"/api/servers/{srv.id}/start",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert start_resp.status_code == 409
    assert start_resp.json()["detail"]["code"] == "server_deactivated"

    restart_resp = client.post(
        f"/api/servers/{srv.id}/restart",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert restart_resp.status_code == 409
    assert restart_resp.json()["detail"]["code"] == "server_deactivated"

    with pytest.raises(HTTPException) as exc:
        asyncio.run(restart_server_with_updates(db, srv))
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "server_deactivated"

    # Scheduler-Auto-Restart ueberspringt still statt Fehler zu werfen
    srv.auto_restart = True
    srv.status = "running"
    db.commit()
    asyncio.run(_restart_server_task(srv.id))
    db.refresh(srv)
    assert srv.last_auto_restart_attempt_at is None


def test_running_server_cannot_be_deactivated(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    csrf_token: str | None,
) -> None:
    node = _make_node(db)
    srv = _make_server(db, node, status="running")

    resp = client.post(
        f"/api/servers/{srv.id}/deactivate",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "server_must_be_stopped_to_deactivate"


def test_customer_servers_cannot_be_deactivated(
    client: TestClient,
    db: Session,
    owner_user: User,
    regular_user: User,
    owner_cookies: dict,
    csrf_token: str | None,
) -> None:
    node = _make_node(db)
    shop_srv = _make_server(db, node, name="shop-srv")
    hoster_srv = _make_server(db, node, name="hoster-srv")

    plan = ShopPlan(
        game_type="minecraft",
        name=f"Tarif-{uuid4().hex[:6]}",
        price_cents=999,
        currency="EUR",
        tax_rate_percent=19,
        ram_included_mb=4096,
        active=True,
    )
    db.add(plan)
    db.flush()

    order = ShopOrder(
        number=f"MSM-2026-{uuid4().hex[:6]}",
        user_id=regular_user.id,
        status="paid",
        currency="EUR",
        months=1,
        net_cents=839,
        tax_cents=160,
        gross_cents=999,
        payment_provider="stripe",
    )
    db.add(order)
    db.flush()

    item = ShopOrderItem(
        order_id=order.id,
        kind="plan",
        plan_id=plan.id,
        game_type="minecraft",
        name=plan.name,
        quantity=1,
        unit_price_cents=839,
        tax_rate_percent=19,
        net_cents=839,
        tax_cents=160,
        gross_cents=999,
    )
    db.add(item)
    db.flush()

    ent = ShopEntitlement(
        user_id=regular_user.id,
        order_id=order.id,
        order_item_id=item.id,
        kind="server",
        label=plan.name,
        plan_id=plan.id,
        server_id=shop_srv.id,
        status="active",
        provisioning_status="ready",
    )
    integ = HosterIntegration(
        slug=f"hoster-{uuid4().hex[:6]}",
        name="Hoster Test",
        service_user_id=owner_user.id,
        api_key_hash=hash_token(uuid4().hex),
        enabled=True,
    )
    db.add_all([ent, integ])
    db.flush()

    ident = HosterIdentity(
        integration_id=integ.id,
        external_subject_hash=hash_token(f"{integ.id}:cust-1"),
        user_id=regular_user.id,
    )
    db.add(ident)
    db.flush()

    hs = HosterService(
        integration_id=integ.id,
        identity_id=ident.id,
        external_service_id=f"svc-{uuid4().hex[:6]}",
        server_id=hoster_srv.id,
        correlation_id=str(uuid4()),
        desired_state="active",
        status="ready",
    )
    db.add(hs)
    db.commit()

    for target_id in (shop_srv.id, hoster_srv.id):
        resp = client.post(
            f"/api/servers/{target_id}/deactivate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token or ""},
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "customer_server_cannot_be_deactivated"


def test_reactivate_requires_free_node_ram_and_cpu(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    csrf_token: str | None,
) -> None:
    # 9216 total - 1024 headroom = 8192 MB allocatable; 4.0 CPU -> 400%
    node = _make_node(db, ram_total_mb=9216, cpu_total=4.0, disk_total_gb=200)
    parked = _make_server(
        db,
        node,
        ram_limit_mb=6144,
        cpu_limit_percent=200,
        disk_limit_gb=50,
        is_deactivated=True,
    )
    other = _make_server(
        db,
        node,
        ram_limit_mb=4096,
        cpu_limit_percent=100,
        disk_limit_gb=50,
    )

    # Nur noch 4096 MB frei, parked braucht 6144 MB -> 409 insufficient_node_ram
    fail_ram = client.post(
        f"/api/servers/{parked.id}/reactivate",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert fail_ram.status_code == 409
    assert fail_ram.json()["detail"]["code"] == "insufficient_node_ram"
    db.refresh(parked)
    assert parked.is_deactivated is True

    # RAM freimachen, aber CPU durch other voll belegen (300% benutzt, 100% frei < 200% benoetigt)
    other.ram_limit_mb = 1024
    other.cpu_limit_percent = 300
    db.commit()

    fail_cpu = client.post(
        f"/api/servers/{parked.id}/reactivate",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert fail_cpu.status_code == 409
    assert fail_cpu.json()["detail"]["code"] == "insufficient_node_cpu"
    db.refresh(parked)
    assert parked.is_deactivated is True

    # Jetzt passt sowohl RAM (7168 <= 8192) als auch CPU (300 <= 400)
    other.cpu_limit_percent = 100
    db.commit()

    ok = client.post(
        f"/api/servers/{parked.id}/reactivate",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["is_deactivated"] is False
    assert ok.json()["deactivated_at"] is None
    assert sum_allocated_ram_mb(db, node.id) == 7168
    assert sum_allocated_cpu_percent(db, node.id) == 300


def test_deactivate_and_reactivate_require_permission(
    client: TestClient,
    db: Session,
    owner_user: User,
    regular_user: User,
    user_cookies: dict,
    user_csrf_token: str | None,
) -> None:
    node = _make_node(db)
    srv = _make_server(db, node)

    # Ohne server.view antwortet require_server_permission mit 404 (kein Server-Leak)
    r_hidden = client.post(
        f"/api/servers/{srv.id}/deactivate",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert r_hidden.status_code == 404

    # Mit server.view, aber ohne server.resources.manage -> 403
    permission_service.set_user_server_permissions(
        db, regular_user.id, srv.id, ["server.view"], granted_by=owner_user.id
    )
    db.commit()

    r1 = client.post(
        f"/api/servers/{srv.id}/deactivate",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert r1.status_code == 403

    r2 = client.post(
        f"/api/servers/{srv.id}/reactivate",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert r2.status_code == 403
