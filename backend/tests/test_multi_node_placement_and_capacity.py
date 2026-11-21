"""Tests fuer Multi-Node-Auto-Placement, CPU/RAM/Disk-Limits, Ausverkaufsschutz & Operator-Override."""

from __future__ import annotations

import itertools
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from config import settings
from models import Node, Role, RolePermission, Server, ShopPlan, User
from services import shop_catalog_service
from services.actor_context import ActorContext
from services.role_service import set_user_roles
from schemas import ServerCreate
from schemas.shop import ShopPlanWrite


def _csrf_headers(cookies: dict) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": token}


def _grant_panel_permissions(db: Session, user: User, keys: tuple[str, ...]) -> None:
    role = Role(name=f"shop-adm-{uuid4().hex[:6]}", is_system=False)
    db.add(role)
    db.flush()
    for key in keys:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    set_user_roles(db, user, [role.id])
    db.commit()


def _mk_node(
    db: Session,
    *,
    name: str,
    host: str,
    is_local: bool = False,
    status: str = "online",
    ram_total_mb: int = 16384,
    cpu_total: float = 4.0,
    disk_total_mb: int = 102_400,
) -> Node:
    node = Node(
        name=name,
        host=host,
        auth_token_enc="test-token",
        is_local=is_local,
        status=status,
        ram_total=ram_total_mb,
        cpu_total=cpu_total,
        disk_total=disk_total_mb,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


def _mk_plan(db: Session, actor: User, **overrides) -> ShopPlan:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld Tier {uuid4().hex[:6]}",
        "price_cents": 1299,
        "currency": "EUR",
        "billing_interval": "month",
        "tax_rate_percent": 19,
        "ram_included_mb": 4096,
        "ram_max_mb": 16384,
        "ram_step_mb": 1024,
        "price_per_ram_step_cents": 100,
        "cpu_included": 2,
        "cpu_max": 8,
        "cpu_step": 1,
        "price_per_cpu_step_cents": 200,
        "slots_included": 8,
        "slots_max": 32,
        "slots_step": 1,
        "price_per_slot_step_cents": 20,
        "node_id": None,
        "artwork_mode": "none",
        "active": True,
    }
    payload.update(overrides)
    return shop_catalog_service.create_plan(db, ShopPlanWrite(**payload), actor_id=actor.id)


def _patch_runtime_env(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(settings, "servers_dir", str(tmp_path))
    monkeypatch.setattr(settings, "strict_resource_capacity_guard", False)

    port_seq = itertools.count(30000, 10)

    def _fake_ports(*_args, **_kwargs):
        base = next(port_seq)
        return [("game", base, "udp"), ("query", base + 1, "udp"), ("rcon", base + 2, "tcp")]

    fake_client = MagicMock()
    fake_client.ports_available.return_value = {"available": True}
    fake_client.files_ensure_server_root.return_value = None
    fake_client.files_apply_quota.return_value = None
    fake_client.files_remove_quota.return_value = None

    monkeypatch.setattr("services.server_provisioning_service.allocate_ports", _fake_ports)
    monkeypatch.setattr(
        "services.server_provisioning_service.try_acquire_install_update_lock",
        lambda *_a, **_kw: True,
    )
    monkeypatch.setattr(
        "services.server_provisioning_service.release_install_update_lock",
        lambda *_a, **_kw: None,
    )
    monkeypatch.setattr(
        "services.node_client.NodeClient.from_node",
        lambda *_a, **_kw: fake_client,
    )
    fake_plugin = SimpleNamespace(
        get_blueprint=lambda: None,
        install=lambda _server: {"status": "installing"},
    )
    monkeypatch.setattr(
        "services.server_provisioning_service.get_plugin",
        lambda _game_type: fake_plugin,
    )


def test_multi_node_auto_placement_balances_across_nodes_and_enforces_sold_out(
    client: TestClient,
    db: Session,
    owner_user: User,
    regular_user: User,
    user_cookies: dict,
    monkeypatch,
    tmp_path: Path,
) -> None:
    _patch_runtime_env(monkeypatch, tmp_path)
    # 2 Nodes mit je 8192 MB frei nach Abzug der 1536 MB Host-Reserve (9728 MB total) & 2 CPU-Kernen.
    node_a = _mk_node(
        db, name="Node A", host="10.0.0.1", is_local=True, ram_total_mb=9728, cpu_total=2.0
    )
    node_b = _mk_node(
        db, name="Node B", host="10.0.0.2", is_local=False, ram_total_mb=9728, cpu_total=2.0
    )
    # Auf Node A liegt bereits ein Server (4 GB, 1 Kern); Node B ist komplett frei.
    db.add(
        Server(
            name="Existing on A",
            game_type="palworld",
            install_dir=str(tmp_path / "existing-a"),
            container_name="msm-existing-a",
            status="running",
            ram_limit_mb=4096,
            cpu_limit_percent=100,
            node_id=node_a.id,
        )
    )
    db.commit()

    plan = _mk_plan(db, owner_user, ram_included_mb=4096, ram_max_mb=8192, cpu_included=1, cpu_max=4)

    # 1. Shop-Bestellung: muss automatisch die freiere Node B waehlen.
    o1 = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 1, "slots": 8, "months": 1},
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert o1.status_code == 200
    p1 = client.post(
        f"/api/shop/orders/{o1.json()['id']}/demo-pay",
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert p1.status_code == 200

    # Noch eine Bestellung mit 8 GB (mehr als Rest auf A oder B nach Order 1) muss jetzt sofort blockieren,
    # waehrend eine 4-GB-Bestellung noch genau auf den verbleibenden Platz passt.
    avail_big = client.post(
        "/api/shop/availability",
        json={"plan_id": plan.id, "ram_mb": 8192, "cpu": 1},
    )
    assert avail_big.status_code == 200
    assert avail_big.json()["available"] is False
    assert avail_big.json()["reason"] == "insufficient_node_ram"

    o2 = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 1, "slots": 8, "months": 1},
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert o2.status_code == 200
    p2 = client.post(
        f"/api/shop/orders/{o2.json()['id']}/demo-pay",
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert p2.status_code == 200

    # Nun sind Node A (4+4=8 GB) und Node B (4 GB + 1 Kern) am Limit fuer eine weitere 8-GB-Bestellung,
    # aber ein weiterer 4-GB-Server passt noch exakt auf die noch freie Haelfte von Node B -> danach ausverkauft.
    o3 = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 1, "slots": 8, "months": 1},
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert o3.status_code == 200
    p3 = client.post(
        f"/api/shop/orders/{o3.json()['id']}/demo-pay",
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert p3.status_code == 200

    placed_servers = (
        db.query(Server)
        .filter(Server.name.like("shop-%"))
        .order_by(Server.id.asc())
        .all()
    )
    assert len(placed_servers) == 3
    # Zwei Server auf B (anfangs leer, 8 GB frei), einer auf A (hatte schon 4 GB).
    assert sum(1 for s in placed_servers if s.node_id == node_b.id) == 2
    assert sum(1 for s in placed_servers if s.node_id == node_a.id) == 1

    # 4. Bestellung darf gar nicht erst angelegt werden -> 409 shop_out_of_capacity & Katalog ausverkauft.
    blocked = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 1, "slots": 8, "months": 1},
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "shop_out_of_capacity"

    catalog = client.get("/api/shop/catalog")
    assert catalog.status_code == 200
    row = next(r for r in catalog.json() if r["id"] == plan.id)
    assert row["available"] is False


def test_cpu_limit_and_pinned_offline_node_block_shop_while_manual_operator_can_override(
    client: TestClient,
    db: Session,
    owner_user: User,
    user_cookies: dict,
    monkeypatch,
    tmp_path: Path,
) -> None:
    _patch_runtime_env(monkeypatch, tmp_path)
    offline_node = _mk_node(
        db, name="Offline", host="10.0.1.1", is_local=False, status="offline", ram_total_mb=32768, cpu_total=8.0
    )
    online_node = _mk_node(
        db, name="Online Tight CPU", host="10.0.1.2", is_local=True, status="online", ram_total_mb=32768, cpu_total=2.0
    )
    # 200 % CPU (= 2 Kerne) schon auf online_node gebucht -> 0 Kerne frei, viel RAM frei.
    db.add(
        Server(
            name="CPU Hog",
            game_type="palworld",
            install_dir=str(tmp_path / "cpu-hog"),
            container_name="msm-cpu-hog",
            status="running",
            ram_limit_mb=4096,
            cpu_limit_percent=200,
            node_id=online_node.id,
        )
    )
    db.commit()

    auto_plan = _mk_plan(db, owner_user, cpu_included=1, cpu_max=4)
    avail = client.post("/api/shop/availability", json={"plan_id": auto_plan.id, "ram_mb": 4096, "cpu": 1})
    assert avail.status_code == 200
    assert avail.json()["available"] is False
    assert avail.json()["reason"] == "insufficient_node_cpu"

    # Pinned auf Offline-Node darf NICHT auf eine andere Node ueberlaufen.
    pinned_plan = _mk_plan(db, owner_user, node_id=offline_node.id, cpu_included=1, cpu_max=4)
    avail_pinned = client.post("/api/shop/availability", json={"plan_id": pinned_plan.id})
    assert avail_pinned.status_code == 200
    assert avail_pinned.json()["available"] is False
    assert avail_pinned.json()["reason"] == "node_offline"

    # Manuelle Selfhoster-Erstellung im Panel (strict_capacity=False, auto_place=False) darf bewusst ueberbuchen.
    from services import server_provisioning_service

    res = server_provisioning_service.provision_server(
        db,
        ServerCreate(
            name="Manual Override Server",
            game_type="palworld",
            ram_limit_mb=4096,
            cpu_limit_percent=200,
            node_id=online_node.id,
        ),
        ActorContext.for_user(owner_user, origin="direct"),
        idempotency_key=f"manual-{uuid4().hex}",
    )
    assert res.server.id is not None
    assert res.server.node_id == online_node.id
