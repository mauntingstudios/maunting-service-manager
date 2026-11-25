"""Tests fuer den Shop-Kapazitaets-Testmodus (``shop_allow_overbooking``)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Node, ShopPlan
from services import node_placement_service, shop_lifecycle_settings_service


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
