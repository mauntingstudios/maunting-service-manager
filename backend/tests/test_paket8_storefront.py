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


def test_private_node_never_leaks_ddos_and_five_mixed_nodes_avoid_false_uniform_claim(
    client: TestClient, owner_user, db
) -> None:
    from unittest.mock import patch

    db.add(
        Node(
            name="private-home-node",
            host="https://10.9.9.1:9000",
            auth_token_enc="tok-priv",
            location_label="Privat Keller",
            status="online",
            shop_enabled=False,
            ddos_provider="PrivateShield",
            ddos_game_aware=True,
        )
    )
    for idx in range(4):
        db.add(
            Node(
                name=f"eu-pub-{idx}",
                host=f"https://10.1.0.{idx + 1}:9000",
                auth_token_enc=f"tok-pub-{idx}",
                location_label=f"Frankfurt {idx + 1}",
                status="online",
                shop_enabled=True,
                ddos_provider="Path.net",
                ddos_game_aware=True,
            )
        )
    db.add(
        Node(
            name="us-pub-5",
            host="https://10.1.0.99:9000",
            auth_token_enc="tok-pub-5",
            location_label="New York",
            status="online",
            shop_enabled=True,
            ddos_provider="Voxility",
            ddos_game_aware=False,
        )
    )
    shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(game_type="palworld", name="Palworld Multi-Node", price_cents=799),
        actor_id=owner_user.id,
    )
    db.commit()

    # 1. Private node never appears in public node statuses
    nodes_res = client.get("/api/shop/nodes/status")
    assert nodes_res.status_code == 200
    names = [n["name"] for n in nodes_res.json()]
    assert "private-home-node" not in names
    assert "PrivateShield" not in nodes_res.text
    by_name = {n["name"]: n for n in nodes_res.json()}
    assert by_name["eu-pub-0"]["ddos_provider"] == "Path.net"
    assert by_name["us-pub-5"]["ddos_provider"] == "Voxility"

    # 2. Catalog never claims a single uniform DDoS provider when 5 public nodes differ
    cat_res = client.get("/api/shop/catalog")
    assert cat_res.status_code == 200
    pal_plans = [p for p in cat_res.json() if p["game_type"] == "palworld"]
    assert len(pal_plans) >= 1
    assert pal_plans[0]["ddos_provider"] is None
    assert pal_plans[0]["ddos_game_aware"] is False

    # 3. Artwork endpoint forwards variant="poster" only when valid
    with patch(
        "services.wallpaper_service.plan_artwork_bytes",
        return_value=(b"webp-poster", '"steam-1-poster"'),
    ) as m_art:
        art_res = client.get("/api/shop/artwork/palworld?variant=poster")
        assert art_res.status_code == 200
        assert m_art.call_args.kwargs.get("variant") == "poster"

        client.get("/api/shop/artwork/palworld?variant=bogus")
        assert m_art.call_args.kwargs.get("variant") is None


def test_admin_plans_recent_orders_ai_fields_and_coupon_auto_stripe_sync(
    client: TestClient, owner_cookies: dict, db
) -> None:
    from unittest.mock import patch

    from models import ShopOrder, ShopOrderItem
    from schemas.shop import ShopCouponWrite
    from services import shop_coupon_service, stripe_service
    from services.ai_proposals import shop_proposals
    from services.ai_tools import shop_tools

    admin = db.query(User).filter(User.id == 1).first()
    if admin is None:
        db.add(
            User(
                id=1,
                username="admin_p8_extra",
                email="admin_p8_extra@example.com",
                password_hash="x",
                is_owner=True,
            )
        )
        db.commit()

    plan = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(
            game_type="palworld",
            name="Palworld KI & Stats",
            price_cents=1200,
            lifetime_price_cents=19900,
            allow_game_switch=False,
            allow_short_durations=True,
            is_featured=True,
            is_bestseller=True,
            is_new=True,
            pinned_in_hero=True,
            promo_highlight_text="Herbst-Patch",
        ),
        actor_id=1,
    )
    order = ShopOrder(
        number="MSM-TEST-STATS-1",
        user_id=1,
        status="paid",
        currency="EUR",
        months=1,
        billing_mode="prepaid",
        net_cents=1008,
        tax_cents=192,
        gross_cents=1200,
    )
    db.add(order)
    db.flush()
    db.add(
        ShopOrderItem(
            order_id=order.id,
            kind="plan",
            plan_id=plan.id,
            game_type="palworld",
            name=plan.name,
            quantity=1,
            unit_price_cents=1200,
            tax_rate_percent=19,
            net_cents=1008,
            tax_cents=192,
            gross_cents=1200,
        )
    )
    db.commit()

    # 1. Admin plans endpoint liefert recent_order_count
    admin_res = client.get("/api/shop/plans", cookies=owner_cookies)
    assert admin_res.status_code == 200
    found = next(p for p in admin_res.json() if p["id"] == plan.id)
    assert found["recent_order_count"] == 1

    # 2. Singra AI Tool liest und validiert alle neuen Tarif-Felder
    owner_user = db.query(User).filter(User.is_owner.is_(True)).first()
    assert owner_user is not None
    catalog_data = shop_tools._lies_shop_catalog(
        db, user=owner_user, arguments={"include": ["plans"]}
    )
    ai_plan = next(p for p in catalog_data["plans"] if p["id"] == plan.id)
    assert ai_plan["lifetime_price_cents"] == 19900
    assert ai_plan["allow_game_switch"] is False
    assert ai_plan["allow_short_durations"] is True
    assert ai_plan["is_bestseller"] is True
    assert ai_plan["pinned_in_hero"] is True
    assert ai_plan["promo_highlight_text"] == "Herbst-Patch"
    assert ai_plan["recent_order_count"] == 1

    norm, _preview = shop_proposals._normalize_single_plan(
        db,
        {
            "game_type": "palworld",
            "name": "Singra Neu",
            "price_cents": 999,
            "lifetime_price_cents": 15900,
            "allow_game_switch": True,
            "allow_short_durations": False,
            "is_bestseller": True,
            "promo_highlight_text": "Neu via KI",
        },
    )
    assert norm["fields"]["lifetime_price_cents"] == 15900
    assert norm["fields"]["allow_short_durations"] is False
    assert norm["fields"]["is_bestseller"] is True
    assert norm["fields"]["promo_highlight_text"] == "Neu via KI"

    # 3. Gutschein-Erstellung synct automatisch zu Stripe wenn konfiguriert
    with (
        patch("services.stripe_settings_service.resolve_secret_key", return_value="sk_test_123"),
        patch(
            "services.stripe_service.create_coupon_and_promotion_code",
            return_value=("cpn_auto_1", "promo_auto_1"),
        ),
    ):
        synced_coupon = shop_coupon_service.create_coupon(
            db,
            ShopCouponWrite(
                code="AUTOSTRIPE10",
                name="Auto Stripe",
                discount_type="percent",
                discount_value=10,
            ),
            actor_id=1,
        )
        assert synced_coupon.stripe_coupon_id == "cpn_auto_1"
        assert synced_coupon.stripe_promotion_code_id == "promo_auto_1"

    # Und bricht bei Stripe-Fehler das Anlegen nicht ab
    with (
        patch("services.stripe_settings_service.resolve_secret_key", return_value="sk_test_123"),
        patch(
            "services.stripe_service.create_coupon_and_promotion_code",
            side_effect=stripe_service.StripeError("API timeout"),
        ),
    ):
        fallback_coupon = shop_coupon_service.create_coupon(
            db,
            ShopCouponWrite(
                code="FALLBACK20",
                name="Fallback Rabatt",
                discount_type="percent",
                discount_value=20,
            ),
            actor_id=1,
        )
        assert fallback_coupon.stripe_coupon_id is None
        assert fallback_coupon.code == "FALLBACK20"
