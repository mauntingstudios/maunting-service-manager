"""Tests fuer den Shop-Kapazitaets-Testmodus (``shop_allow_overbooking``)."""

from __future__ import annotations

import itertools
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from config import settings
from models import Node, Server, ShopEntitlement, ShopPlan, User
from services import (
    node_placement_service,
    shop_catalog_service,
    shop_fulfillment_service,
    shop_lifecycle_settings_service,
)
from schemas.shop import ShopPlanWrite


def _csrf_headers(cookies: dict) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": token}


def _patch_provisioning_runtime(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(settings, "servers_dir", str(tmp_path))
    monkeypatch.setattr(settings, "strict_resource_capacity_guard", True)

    port_seq = itertools.count(32000, 10)

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


def test_shop_allow_overbooking_toggles_plan_availability(db: Session) -> None:
    """Ohne Ueberbuchung sperrt fehlende Shop-Node-Kapazitaet; mit Schalter bleibt Checkout testbar."""
    node = Node(
        name="voller-node",
        host="198.51.100.10:8443",
        auth_token_enc="dummy",
        status="online",
        shop_enabled=False,
    )
    plan = ShopPlan(
        name="Valheim Starter",
        game_type="valheim",
        ram_included_mb=4096,
        ram_max_mb=16384,
        cpu_included=2,
        cpu_max=6,
        slots_included=10,
        slots_max=40,
        price_cents=1299,
        currency="EUR",
        billing_interval="month",
        tax_rate_percent=19,
        active=True,
    )
    db.add_all([node, plan])
    db.commit()

    # Standardmaessig deaktiviert -> kein Shop-Node verfuegbar.
    assert shop_lifecycle_settings_service.is_shop_overbooking_allowed(db) is False
    ohne = node_placement_service.check_plan_availability(db, plan, shop_only=True)
    assert ohne.available is False

    # Nach Aktivierung des Testmodus -> Tarif fuer Checkout-Tests freigegeben.
    aktualisiert = shop_lifecycle_settings_service.update(
        {"shop_allow_overbooking": True}, db=db
    )
    assert aktualisiert["shop_allow_overbooking"] is True
    assert shop_lifecycle_settings_service.is_shop_overbooking_allowed(db) is True

    mit = node_placement_service.check_plan_availability(db, plan, shop_only=True)
    assert mit.available is True
    assert mit.reason is None
    assert mit.max_ram_mb == plan.ram_max_mb
    assert mit.max_cpu == plan.cpu_max
    assert mit.available_nodes >= 1


def test_find_candidate_nodes_respects_allow_overbooking_and_blocks_offline(db: Session) -> None:
    """find_candidate_nodes erlaubt bei Ueberbuchung volle/nicht-Shop-Nodes, aber niemals Offline-Nodes."""
    full_node = Node(
        name="voller-online-node",
        host="198.51.100.20:8443",
        auth_token_enc="dummy",
        status="online",
        ram_total=2048,
        cpu_total=1.0,
        shop_enabled=True,
    )
    non_shop_node = Node(
        name="nicht-shop-node",
        host="198.51.100.21:8443",
        auth_token_enc="dummy",
        status="online",
        ram_total=2048,
        cpu_total=1.0,
        shop_enabled=False,
    )
    offline_node = Node(
        name="offline-node",
        host="198.51.100.22:8443",
        auth_token_enc="dummy",
        status="offline",
        ram_total=65536,
        cpu_total=16.0,
        shop_enabled=True,
    )
    db.add_all([full_node, non_shop_node, offline_node])
    db.commit()

    # Ohne Ueberbuchung blockiert fehlender RAM auf dem einzigen Shop-Online-Node.
    cands_off, err_off = node_placement_service.find_candidate_nodes(
        db, ram_mb=4096, cpu_percent=100, shop_only=True, allow_overbooking=False
    )
    assert cands_off == []
    assert err_off == "insufficient_node_ram"

    # Mit Ueberbuchung wird der volle Online-Node gewaehlt, aber niemals der Offline-Node.
    cands_on, err_on = node_placement_service.find_candidate_nodes(
        db, ram_mb=4096, cpu_percent=100, shop_only=True, allow_overbooking=True
    )
    assert err_on is None
    assert [n.id for n in cands_on] == [full_node.id]

    # Auch wenn alle Nodes shop_enabled=False haben, greift im Testmodus der Online-Fallback.
    full_node.shop_enabled = False
    offline_node.shop_enabled = False
    db.commit()

    cands_no_shop, err_no_shop = node_placement_service.find_candidate_nodes(
        db, ram_mb=4096, cpu_percent=100, shop_only=True, allow_overbooking=False
    )
    assert cands_no_shop == []
    assert err_no_shop == "node_not_available_for_shop"

    cands_fallback, err_fallback = node_placement_service.find_candidate_nodes(
        db, ram_mb=4096, cpu_percent=100, shop_only=True, allow_overbooking=True
    )
    assert err_fallback is None
    assert {n.id for n in cands_fallback} == {full_node.id, non_shop_node.id}
    assert offline_node.id not in {n.id for n in cands_fallback}

    # Explizit gepinnter Offline-Node bleibt auch bei Ueberbuchung gesperrt.
    cands_pinned_off, err_pinned_off = node_placement_service.find_candidate_nodes(
        db,
        ram_mb=1024,
        preferred_node_id=offline_node.id,
        shop_only=True,
        allow_overbooking=True,
    )
    assert cands_pinned_off == []
    assert err_pinned_off == "node_offline"


def test_sync_order_entitlements_provisions_server_with_overbooking_enabled(
    client: TestClient,
    db: Session,
    owner_user: User,
    user_cookies: dict,
    monkeypatch,
    tmp_path: Path,
    caplog,
) -> None:
    """Ohne Ueberbuchung scheitert volle Node mit Warn-Log; mit Ueberbuchung wird der Server zugewiesen."""
    _patch_provisioning_runtime(monkeypatch, tmp_path)

    full_node = Node(
        name="Overbook-Test-Node",
        host="10.10.0.1",
        auth_token_enc="dummy-token",
        is_local=True,
        status="online",
        ram_total=2048,
        cpu_total=1.0,
        shop_enabled=False,
    )
    db.add(full_node)
    db.commit()
    db.refresh(full_node)

    plan = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(
            game_type="palworld",
            name=f"Overbook Plan {uuid4().hex[:6]}",
            price_cents=999,
            currency="EUR",
            billing_interval="month",
            tax_rate_percent=19,
            ram_included_mb=4096,
            ram_max_mb=8192,
            ram_step_mb=1024,
            price_per_ram_step_cents=100,
            cpu_included=2,
            cpu_max=4,
            cpu_step=1,
            price_per_cpu_step_cents=100,
            slots_included=8,
            slots_max=32,
            slots_step=1,
            price_per_slot_step_cents=20,
            node_id=None,
            artwork_mode="none",
            active=True,
        ),
        actor_id=owner_user.id,
    )

    # Checkout mit aktivierter Ueberbuchung durchfuehren.
    shop_lifecycle_settings_service.update({"shop_allow_overbooking": True}, db=db)
    order_res = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 2, "slots": 8, "months": 1},
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert order_res.status_code == 200, order_res.text
    order_id = order_res.json()["id"]

    # Vor Fulfillment Ueberbuchung abschalten -> muss sauber fehlschlagen + Warnung loggen.
    shop_lifecycle_settings_service.update({"shop_allow_overbooking": False}, db=db)
    caplog.set_level(logging.WARNING, logger="services.shop_fulfillment_service")
    pay_res = client.post(
        f"/api/shop/orders/{order_id}/demo-pay",
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert pay_res.status_code == 200, pay_res.text

    ent = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id == order_id, ShopEntitlement.kind == "server")
        .one()
    )
    assert ent.provisioning_status == "failed"
    assert ent.provisioning_error == "node_not_available_for_shop"
    assert ent.server_id is None
    assert any(
        "Shop-Server-Provisionierung fehlgeschlagen" in rec.message
        and "node_not_available_for_shop" in rec.message
        for rec in caplog.records
    )

    # Ueberbuchung wieder einschalten und erneut synchronisieren -> Server wird zugewiesen.
    shop_lifecycle_settings_service.update({"shop_allow_overbooking": True}, db=db)
    synced = shop_fulfillment_service.sync_order_entitlements(db, order_id)
    assert len(synced) == 1
    db.refresh(ent)
    assert ent.provisioning_status == "ready"
    assert ent.provisioning_error is None
    assert ent.server_id is not None

    server = db.query(Server).filter(Server.id == ent.server_id).one()
    assert server.node_id == full_node.id
