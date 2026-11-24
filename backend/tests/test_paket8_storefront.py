"""Tests fuer Paket 8: Hero-Pinning, Promo-Hinweis, Hero-Modus und Multi-Node-DDoS."""

from __future__ import annotations

from fastapi.testclient import TestClient

from models import Node, User
from schemas.shop import ShopPlanUpdate, ShopPlanWrite
from services import shop_catalog_service, shop_lifecycle_settings_service


def test_shop_plan_pinning_and_promo_highlight(db) -> None:
    admin = db.query(User).filter(User.id == 1).first()
    if admin is None:
        db.add(
            User(
                id=1,
                username="admin_p8",
                email="admin_p8@example.com",
                password_hash="x",
                is_owner=True,
            )
        )
        db.commit()

    plan = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(
            game_type="palworld",
            name="Palworld Promo",
            price_cents=899,
            pinned_in_hero=True,
            promo_highlight_text="  Grosses Sakurajima-Update  ",
        ),
        actor_id=1,
    )
    assert plan.pinned_in_hero is True
    assert plan.promo_highlight_text == "Grosses Sakurajima-Update"

    cat = shop_catalog_service.catalog_plan(db, plan)
    assert cat.pinned_in_hero is True
    assert cat.promo_highlight_text == "Grosses Sakurajima-Update"

    updated = shop_catalog_service.update_plan(
        db,
        plan,
        ShopPlanUpdate(pinned_in_hero=False, promo_highlight_text="   "),
        actor_id=1,
    )
    assert updated.pinned_in_hero is False
    assert updated.promo_highlight_text is None


def test_hero_mode_settings_and_public_policy(
    client: TestClient, owner_cookies: dict, csrf_token: str, db
) -> None:
    res = client.get("/api/shop/public-policy")
    assert res.status_code == 200
    assert res.json()["shop_hero_mode"] == "auto_paid"

    current = shop_lifecycle_settings_service.read(db=db)
    current["shop_hero_mode"] = "manual"
    put_res = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=current,
    )
    assert put_res.status_code == 200, put_res.text
    assert put_res.json()["shop_hero_mode"] == "manual"

    pub_after = client.get("/api/shop/public-policy")
    assert pub_after.status_code == 200
    assert pub_after.json()["shop_hero_mode"] == "manual"

    bad = dict(current)
    bad["shop_hero_mode"] = "invalid_mode"
    bad_res = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=bad,
    )
    assert bad_res.status_code == 422


def test_public_node_statuses_expose_distinct_ddos_providers(db) -> None:
    db.add_all(
        [
            Node(
                name="node-a",
                host="https://10.0.1.1:9000",
                auth_token_enc="tok-a",
                location_label="Frankfurt DE",
                status="online",
                shop_enabled=True,
                ddos_provider="Path.net",
                ddos_game_aware=True,
            ),
            Node(
                name="node-b",
                host="https://10.0.1.2:9000",
                auth_token_enc="tok-b",
                location_label="New York US",
                status="online",
                shop_enabled=True,
                ddos_provider="CosmicGuard",
                ddos_game_aware=False,
            ),
        ]
    )
    db.commit()

    statuses = shop_catalog_service.public_node_statuses(db)
    by_name = {row.name: row for row in statuses}
    assert by_name["node-a"].ddos_provider == "Path.net"
    assert by_name["node-a"].ddos_game_aware is True
    assert by_name["node-b"].ddos_provider == "CosmicGuard"
    assert by_name["node-b"].ddos_game_aware is False
