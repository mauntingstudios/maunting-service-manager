"""Tests fuer Singra-Shop-Werkzeuge (`ai.shop.manage`)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models import (
    AiConversation,
    Role,
    RolePermission,
    ShopAddon,
    ShopCoupon,
    ShopPlan,
    User,
)
from services import ai_action_service, ai_proposal_service
from services.ai_action_errors import AiActionValidationError
from services.role_service import set_user_roles


def _conversation(db: Session, user: User) -> AiConversation:
    conv = AiConversation(
        id=str(uuid4()), user_id=user.id, server_id=None, title="Shop KI"
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def _grant_shop_manage(db: Session, user: User) -> User:
    role = Role(name=f"shop-ai-{uuid4().hex[:6]}", is_system=False)
    db.add(role)
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_key="ai.shop.manage"))
    db.commit()
    set_user_roles(db, user, [role.id])
    db.commit()
    db.refresh(user)
    return user


def test_shop_tools_require_ai_shop_manage_permission(
    db: Session, regular_user: User
) -> None:
    conv = _conversation(db, regular_user)

    with pytest.raises(AiActionValidationError, match="ai.shop.manage"):
        ai_action_service.execute_read_tool(
            db, user=regular_user, tool_name="read_shop_catalog", arguments={}
        )

    for tool_name, args in (
        (
            "propose_shop_plan_upsert",
            {
                "game_type": "dayz",
                "name": "Starter",
                "price_cents": 999,
                "reason": "Shop einrichten",
                "expected_effect": "Tarif wird erstellt",
            },
        ),
        (
            "propose_shop_coupon_upsert",
            {
                "code": "START20",
                "name": "Start-Rabatt",
                "discount_type": "percent",
                "discount_value": 20,
                "reason": "Aktion starten",
                "expected_effect": "Gutschein wird angelegt",
            },
        ),
        (
            "propose_shop_addon_upsert",
            {
                "name": "KI-Paket S",
                "category": "ai_quota",
                "price_cents": 499,
                "extra_ai_tokens": 100_000,
                "reason": "KI-Kontingent anbieten",
                "expected_effect": "Add-on wird angelegt",
            },
        ),
    ):
        with pytest.raises(AiActionValidationError):
            ai_proposal_service.create_proposal(
                db,
                user=regular_user,
                conversation=conv,
                tool_name=tool_name,
                arguments=args,
                correlation_id=str(uuid4()),
            )


def test_read_shop_catalog_filters_categories_and_reports_artwork_and_slots(
    db: Session, regular_user: User
) -> None:
    _grant_shop_manage(db, regular_user)

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="read_shop_catalog",
        arguments={"exclude_categories": ["frontend", "backend"]},
    )

    ids = {bp["id"]: bp for bp in result["blueprints"]}
    assert "palworld" in ids
    assert ids["palworld"]["has_steam_artwork"] is True
    assert ids["palworld"]["supports_slots"] is True

    assert "dayz" in ids
    assert ids["dayz"]["has_steam_artwork"] is True
    assert ids["dayz"]["supports_slots"] is False

    assert "minecraft_paper" in ids
    assert ids["minecraft_paper"]["has_steam_artwork"] is False

    assert "node_backend" not in ids
    assert "python_backend" not in ids
    assert "web_frontend_github" not in ids
    assert "web_static" not in ids
    assert "plans" in result and "coupons" in result and "addons" in result


def test_propose_and_execute_batch_plans_handles_artwork_slots_and_idempotency(
    db: Session, regular_user: User
) -> None:
    _grant_shop_manage(db, regular_user)
    conv = _conversation(db, regular_user)

    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conv,
        tool_name="propose_shop_plan_upsert",
        arguments={
            "plans": [
                {
                    # Steam + supports_slots=True
                    "game_type": "palworld",
                    "name": "Palworld Starter",
                    "price_cents": 1299,
                    "ram_included_mb": 8192,
                    "ram_max_mb": 32768,
                    "slots_included": 16,
                    "slots_max": 32,
                },
                {
                    # Steam + supports_slots=False (blueprint.players is None):
                    # must strip slots safely instead of failing _validate_plan_values.
                    "game_type": "dayz",
                    "name": "Survival Starter",
                    "price_cents": 1499,
                    "ram_included_mb": 4096,
                    "ram_max_mb": 16384,
                    "slots_included": 20,
                    "slots_max": 50,
                    "price_per_slot_step_cents": 50,
                },
                {
                    # Non-Steam: must fall back to artwork_mode="none".
                    "game_type": "minecraft_paper",
                    "name": "Paper Standard",
                    "price_cents": 899,
                    "ram_included_mb": 4096,
                    "ram_max_mb": 12288,
                },
            ],
            "reason": "Basis-Tarife einrichten",
            "expected_effect": "Drei aktive Shop-Tarife",
        },
        correlation_id=str(uuid4()),
    )
    assert proposal.tool_name == "propose_shop_plan_upsert"

    _, token = ai_proposal_service.confirm_proposal(
        db, proposal_id=proposal.id, user=regular_user
    )
    done, exec_result = ai_proposal_service.execute_proposal(
        db, proposal_id=proposal.id, user=regular_user, confirmation_token=token
    )
    assert done.status == "succeeded"
    assert exec_result["count"] == 3

    pal_plan = (
        db.query(ShopPlan)
        .filter(ShopPlan.game_type == "palworld", ShopPlan.name == "Palworld Starter")
        .one()
    )
    assert pal_plan.artwork_mode == "steam"
    assert pal_plan.slots_included == 16
    assert pal_plan.price_cents == 1299

    dayz_plan = (
        db.query(ShopPlan)
        .filter(ShopPlan.game_type == "dayz", ShopPlan.name == "Survival Starter")
        .one()
    )
    assert dayz_plan.artwork_mode == "steam"
    assert dayz_plan.slots_included is None
    assert dayz_plan.price_per_slot_step_cents == 0

    mc_plan = (
        db.query(ShopPlan)
        .filter(
            ShopPlan.game_type == "minecraft_paper",
            ShopPlan.name == "Paper Standard",
        )
        .one()
    )
    assert mc_plan.artwork_mode == "none"

    # Second call with same (game_type, name) updates instead of failing duplicate check.
    update_prop = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conv,
        tool_name="propose_shop_plan_upsert",
        arguments={
            "game_type": "palworld",
            "name": "Palworld Starter",
            "price_cents": 1599,
            "reason": "Preis anpassen",
            "expected_effect": "Tarifpreis steigt auf 15,99 EUR",
        },
        correlation_id=str(uuid4()),
    )
    _, tok2 = ai_proposal_service.confirm_proposal(
        db, proposal_id=update_prop.id, user=regular_user
    )
    done2, _ = ai_proposal_service.execute_proposal(
        db, proposal_id=update_prop.id, user=regular_user, confirmation_token=tok2
    )
    assert done2.status == "succeeded"
    db.refresh(pal_plan)
    assert pal_plan.price_cents == 1599
    assert db.query(ShopPlan).filter(ShopPlan.game_type == "palworld").count() == 1


def test_propose_and_execute_coupon_and_addon(
    db: Session, owner_user: User
) -> None:
    conv = _conversation(db, owner_user)
    until = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()

    coupon_prop = ai_proposal_service.create_proposal(
        db,
        user=owner_user,
        conversation=conv,
        tool_name="propose_shop_coupon_upsert",
        arguments={
            "code": "FLASH25",
            "name": "Wochenend-Flash-Sale",
            "promo_text": "25 % auf alle Gameserver bis Sonntag",
            "discount_type": "percent",
            "discount_value": 25,
            "scope": "plans",
            "valid_until": until,
            "show_badge": True,
            "show_banner": True,
            "banner_cooldown_hours": 4,
            "reason": "Flash-Sale aktivieren",
            "expected_effect": "Gutschein und Banner aktiv",
        },
        correlation_id=str(uuid4()),
    )
    _, ctok = ai_proposal_service.confirm_proposal(
        db, proposal_id=coupon_prop.id, user=owner_user
    )
    ai_proposal_service.execute_proposal(
        db, proposal_id=coupon_prop.id, user=owner_user, confirmation_token=ctok
    )

    coupon = db.query(ShopCoupon).filter(ShopCoupon.code == "FLASH25").one()
    assert coupon.discount_value == 25
    assert coupon.show_banner is True
    assert coupon.show_badge is True
    assert coupon.valid_until is not None

    addon_prop = ai_proposal_service.create_proposal(
        db,
        user=owner_user,
        conversation=conv,
        tool_name="propose_shop_addon_upsert",
        arguments={
            "name": "Singra KI Pro 500k",
            "category": "ai_quota",
            "price_cents": 799,
            "extra_ai_tokens": 500_000,
            "description": "500.000 zusaetzliche KI-Tokens pro Monat",
            "reason": "KI-Kontingent-Paket im Shop anbieten",
            "expected_effect": "Eigenstaendiges KI-Add-on verfuegbar",
        },
        correlation_id=str(uuid4()),
    )
    _, atok = ai_proposal_service.confirm_proposal(
        db, proposal_id=addon_prop.id, user=owner_user
    )
    ai_proposal_service.execute_proposal(
        db, proposal_id=addon_prop.id, user=owner_user, confirmation_token=atok
    )

    addon = db.query(ShopAddon).filter(ShopAddon.slug == "singra-ki-pro-500k").one()
    assert addon.category == "ai_quota"
    assert addon.extra_ai_tokens == 500_000
    assert addon.price_cents == 799
