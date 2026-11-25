"""Tests for per-node CPU overcommit factor (Self-Hosted, Placement, Shop) with 1:1 RAM/Disk."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from config import settings
from models import Node, Server, ShopPlan, User
from services import node_capacity, node_placement_service, shop_catalog_service
from schemas.shop import ShopPlanWrite


def _csrf_headers(cookies: dict) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": token}


def _mk_node(
    db: Session,
    *,
    name: str,
    cpu_total: float = 8.0,
    ram_total_mb: int = 65536,
    disk_total_mb: int = 512_000,
    cpu_overcommit_factor: float = 1.0,
) -> Node:
    node = Node(
        name=name,
        host=f"https://{uuid4().hex[:8]}:9000",
        auth_token_enc="test-token",
        is_local=False,
        status="online",
        cpu_total=cpu_total,
        ram_total=ram_total_mb,
        disk_total=disk_total_mb,
        cpu_overcommit_factor=cpu_overcommit_factor,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


def _mk_server(
    db: Session,
    *,
    node: Node,
    name: str,
    cpu_limit_percent: int,
    ram_limit_mb: int = 2048,
    disk_limit_gb: int = 10,
) -> Server:
    srv = Server(
        name=name,
        game_type="minecraft",
        install_dir=f"/tmp/{uuid4().hex[:8]}",
        container_name=f"msm-{uuid4().hex[:8]}",
        status="running",
        node_id=node.id,
        cpu_limit_percent=cpu_limit_percent,
        ram_limit_mb=ram_limit_mb,
        disk_limit_gb=disk_limit_gb,
    )
    db.add(srv)
    db.commit()
    return srv


def test_update_node_cpu_overcommit_factor_validation_and_roundtrip(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
) -> None:
    node = _mk_node(db, name="pool-api-node", cpu_total=16.0)

    r_ok = client.put(
        f"/api/nodes/{node.id}",
        json={"cpu_overcommit_factor": 2.5},
        cookies=owner_cookies,
        headers=_csrf_headers(owner_cookies),
    )
    assert r_ok.status_code == 200, r_ok.text
    assert r_ok.json()["cpu_overcommit_factor"] == pytest.approx(2.5)

    db.refresh(node)
    assert node.cpu_overcommit_factor == pytest.approx(2.5)

    for bad in (0.5, 0.99, 8.1, 12.0):
        r_bad = client.put(
            f"/api/nodes/{node.id}",
            json={"cpu_overcommit_factor": bad},
            cookies=owner_cookies,
            headers=_csrf_headers(owner_cookies),
        )
        assert r_bad.status_code == 422, f"Expected 422 for {bad}, got {r_bad.status_code}"


def test_cpu_overcommit_factor_applies_to_strict_guard_placement_and_shop_while_ram_disk_stay_1_to_1(
    db: Session,
    owner_user: User,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "host_reserved_ram_mb", 1024)
    # 8 cores * 2.0 = 1600% CPU budget; 64 GB RAM & 500 GB disk stay strictly 1:1.
    node = _mk_node(
        db,
        name="overcommit-2x",
        cpu_total=8.0,
        ram_total_mb=65536,
        disk_total_mb=512_000,
        cpu_overcommit_factor=2.0,
    )

    # Book 4 servers * 400% = 1600% CPU (100% of 2x pool), only 8 GB RAM & 40 GB Disk.
    for idx in range(4):
        node_capacity.ensure_strict_capacity_fits(
            db,
            node,
            new_ram_limit_mb=2048,
            new_cpu_limit_percent=400,
            new_disk_limit_gb=10,
            force=True,
        )
        cands, err = node_placement_service.find_candidate_nodes(
            db,
            ram_mb=2048,
            cpu_percent=400,
            disk_gb=10,
            preferred_node_id=node.id,
        )
        assert err is None
        assert len(cands) == 1
        _mk_server(db, node=node, name=f"srv-{idx}", cpu_limit_percent=400)

    # 5th server (total 2000% > 1600%) must fail with insufficient_node_cpu in strict guard & placement.
    with pytest.raises(HTTPException) as exc_info:
        node_capacity.ensure_strict_capacity_fits(
            db,
            node,
            new_ram_limit_mb=2048,
            new_cpu_limit_percent=400,
            new_disk_limit_gb=10,
            force=True,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "insufficient_node_cpu"

    cands_full, err_full = node_placement_service.find_candidate_nodes(
        db,
        ram_mb=2048,
        cpu_percent=400,
        disk_gb=10,
        preferred_node_id=node.id,
    )
    assert cands_full == []
    assert err_full == "insufficient_node_cpu"

    # Shop availability sees the same 2.0x budget (1600% full -> unavailable; 3.0x -> 800% free).
    plan = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(
            game_type="minecraft",
            name=f"MC Pool {uuid4().hex[:6]}",
            price_cents=1000,
            currency="EUR",
            billing_interval="month",
            tax_rate_percent=19,
            ram_included_mb=2048,
            ram_max_mb=16384,
            ram_step_mb=1024,
            price_per_ram_step_cents=100,
            cpu_included=2,
            cpu_max=8,
            cpu_step=1,
            price_per_cpu_step_cents=100,
            disk_included_gb=10,
            disk_max_gb=100,
            disk_step_gb=10,
            price_per_disk_step_cents=50,
            slots_included=10,
            slots_max=50,
            slots_step=1,
            price_per_slot_step_cents=10,
            node_id=node.id,
            artwork_mode="none",
            active=True,
        ),
        actor_id=owner_user.id,
    )

    avail_full = node_placement_service.check_plan_availability(
        db, plan, ram_mb=2048, cpu_cores=4, disk_gb=10, preferred_node_id=node.id
    )
    assert avail_full.available is False
    assert avail_full.reason == "insufficient_node_cpu"

    # Raising node factor to 3.0 unlocks 800% remaining CPU, while RAM & Disk remain 1:1.
    node.cpu_overcommit_factor = 3.0
    db.commit()
    avail_3x = node_placement_service.check_plan_availability(
        db, plan, ram_mb=2048, cpu_cores=4, disk_gb=10, preferred_node_id=node.id
    )
    assert avail_3x.available is True
    assert avail_3x.max_cpu == 8

    # RAM (65536 - 1024 headroom - 8192 booked = 56320 MB) stays strictly 1:1.
    with pytest.raises(HTTPException) as ram_exc:
        node_capacity.ensure_strict_capacity_fits(
            db,
            node,
            new_ram_limit_mb=60000,
            new_cpu_limit_percent=100,
            new_disk_limit_gb=10,
            force=True,
        )
    assert ram_exc.value.detail["code"] == "insufficient_node_ram"

    # Disk (500 GB - 40 GB booked = 460 GB) stays strictly 1:1.
    with pytest.raises(HTTPException) as disk_exc:
        node_capacity.ensure_strict_capacity_fits(
            db,
            node,
            new_ram_limit_mb=2048,
            new_cpu_limit_percent=100,
            new_disk_limit_gb=470,
            force=True,
        )
    assert disk_exc.value.detail["code"] == "insufficient_node_disk"


def test_default_cpu_overcommit_factor_is_strict_1_to_1(db: Session) -> None:
    node = _mk_node(db, name="strict-1x", cpu_total=4.0, ram_total_mb=32768, disk_total_mb=204_800)
    assert node.cpu_overcommit_factor == pytest.approx(1.0)
    _mk_server(db, node=node, name="s1", cpu_limit_percent=400)

    cands, err = node_placement_service.find_candidate_nodes(
        db, ram_mb=2048, cpu_percent=100, disk_gb=10, preferred_node_id=node.id
    )
    assert cands == []
    assert err == "insufficient_node_cpu"
