"""Tests fuer Phase 7: Live-Ping, Plattformen, Gamecloud, Server-Pause, Lifetime & 3-Ebenen-DDoS."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    Node,
    Server,
    ShopAddon,
    ShopEntitlement,
    ShopOrder,
    ShopOrderItem,
    ShopPlan,
    ShopSubscription,
    User,
)
from services import (
    lifecycle_purge_service,
    permission_service,
    server_lifecycle_service,
    shop_lifecycle_settings_service,
    shop_order_service,
)
from services.auth_service import AuthService


def _login(client: TestClient, username: str, password: str) -> tuple[dict, str]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert resp.status_code == 200
    cookies = dict(resp.cookies)
    return cookies, cookies.get("__Secure-csrf_token") or ""


def _create_user(db: Session, prefix: str = "cust7", *, is_owner: bool = False) -> tuple[User, str, str]:
    uname = f"{prefix}-{uuid4().hex[:6]}"
    pw = "Phase7Pass123!"
    user = AuthService.create_user(db, uname, f"{uname}@example.de", pw)
    user.is_owner = is_owner
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user, uname, pw


def _create_node(db: Session, *, is_local: bool = False, **kwargs) -> Node:
    node = Node(
        name=kwargs.pop("name", f"node7-{uuid4().hex[:4]}"),
        host=kwargs.pop("host", "local" if is_local else "https://198.51.100.77:9000"),
        auth_token_enc=kwargs.pop("auth_token_enc", "enc:top-secret-token"),
        tls_fingerprint=kwargs.pop("tls_fingerprint", None if is_local else "ab" * 32),
        is_local=is_local,
        status=kwargs.pop("status", "online"),
        cpu_total=kwargs.pop("cpu_total", 16.0),
        ram_total=kwargs.pop("ram_total", 65536),
        ram_type=kwargs.pop("ram_type", "DDR5"),
        storage_type=kwargs.pop("storage_type", "NVMe"),
        location_label=kwargs.pop("location_label", "Frankfurt, DE"),
        **kwargs,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


def _create_server(
    db: Session,
    node: Node,
    *,
    game_type: str = "palworld",
    ram_limit_mb: int = 8192,
    status: str = "stopped",
) -> Server:
    srv = Server(
        name=f"srv7-{uuid4().hex[:6]}",
        game_type=game_type,
        install_dir=f"/tmp/srv7-{uuid4().hex[:6]}",
        node_id=node.id,
        status=status,
        ram_limit_mb=ram_limit_mb,
        cpu_limit_percent=400,
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    return srv


def _create_plan(db: Session, *, game_type: str = "palworld", lifetime_price_cents: int | None = None, allow_game_switch: bool = True) -> ShopPlan:
    plan = ShopPlan(
        game_type=game_type,
        name=f"Plan7-{uuid4().hex[:4]}",
        price_cents=1000,
        currency="EUR",
        tax_rate_percent=19,
        ram_included_mb=4096,
        ram_step_mb=1024,
        ram_max_mb=16384,
        price_per_ram_step_cents=250,
        cpu_included=2,
        cpu_step=1,
        cpu_max=8,
        price_per_cpu_step_cents=200,
        slots_included=16,
        slots_step=4,
        slots_max=64,
        price_per_slot_step_cents=50,
        lifetime_price_cents=lifetime_price_cents,
        allow_game_switch=allow_game_switch,
        active=True,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def _seed_contract(db: Session, user: User, plan: ShopPlan, srv: Server, *, billing_mode: str = "prepaid", period_days: int = 30):
    now = datetime.now(timezone.utc)
    order = ShopOrder(
        number=f"MSM-2026-{uuid4().hex[:6]}",
        user_id=user.id,
        status="paid",
        currency="EUR",
        billing_interval="month",
        billing_mode=billing_mode,
        months=1,
        net_cents=840,
        tax_cents=160,
        gross_cents=1000,
        payment_provider="demo",
    )
    db.add(order)
    db.flush()
    item = ShopOrderItem(
        order_id=order.id,
        kind="plan",
        plan_id=plan.id,
        game_type=plan.game_type,
        name=plan.name,
        quantity=1,
        unit_price_cents=1000,
        tax_rate_percent=19,
        net_cents=840,
        tax_cents=160,
        gross_cents=1000,
    )
    db.add(item)
    db.flush()
    sub = ShopSubscription(
        user_id=user.id,
        order_id=order.id,
        order_item_id=item.id,
        plan_id=plan.id,
        game_type=plan.game_type,
        name=plan.name,
        status="active",
        billing_interval="month",
        billing_mode=billing_mode,
        monthly_gross_cents=0 if billing_mode == "lifetime" else 1000,
        tax_rate_percent=19,
        started_at=now,
        current_period_end=now + timedelta(days=period_days),
        cancel_at_period_end=(billing_mode == "prepaid"),
    )
    db.add(sub)
    ent = ShopEntitlement(
        user_id=user.id,
        order_id=order.id,
        order_item_id=item.id,
        kind="server",
        label=plan.name,
        plan_id=plan.id,
        status="active",
        server_id=srv.id,
        provisioning_status="ready",
    )
    db.add(ent)
    db.commit()
    db.refresh(sub)
    db.refresh(ent)
    return order, sub, ent


def test_node_status_ddos_and_public_ping_no_secret_leak(
    client: TestClient, db: Session
) -> None:
    local_node = _create_node(
        db,
        is_local=True,
        location_label="Falkenstein, DE",
        ddos_provider="Hetzner",
        ddos_profile="Basic L3/L4",
        ddos_game_aware=False,
    )
    remote_node = _create_node(
        db,
        is_local=False,
        host="https://198.51.100.88:9000",
        auth_token_enc="enc:never-expose-token",
        public_ping_url="https://ping.fra.example.de/health",
        ddos_provider="Path.net",
        ddos_profile="Game-Aware Anycast",
        ddos_game_aware=True,
    )

    status_resp = client.get("/api/shop/nodes/status")
    assert status_resp.status_code == 200
    assert "198.51.100.88" not in status_resp.text
    assert "never-expose-token" not in status_resp.text
    by_id = {row["id"]: row for row in status_resp.json()}
    assert by_id[remote_node.id]["public_ping_url"] == "https://ping.fra.example.de/health"
    assert by_id[remote_node.id]["ddos_provider"] == "Path.net"
    assert by_id[remote_node.id]["ddos_game_aware"] is True

    ping_local = client.get(f"/api/shop/nodes/{local_node.id}/ping")
    assert ping_local.status_code == 200
    assert ping_local.json()["server_agent_rtt_ms"] == 0.0

    class _FakeClient:
        def health(self):
            return {"ok": True}

    with patch("services.node_service.client_for_node", return_value=_FakeClient()):
        ping_remote = client.get(f"/api/shop/nodes/{remote_node.id}/ping")
    assert ping_remote.status_code == 200
    body = ping_remote.json()
    assert body["node_id"] == remote_node.id
    assert body["status"] == "online"
    assert isinstance(body["server_agent_rtt_ms"], (int, float))
    assert "198.51.100.88" not in ping_remote.text

    assert client.get("/api/shop/nodes/999999/ping").status_code == 404


def test_catalog_platforms_and_ddos_summary(client: TestClient, db: Session) -> None:
    _create_node(
        db,
        is_local=False,
        ddos_provider="Famesystems Game-DDoS",
        ddos_profile="Game-Filter",
        ddos_game_aware=True,
    )
    pal = _create_plan(db, game_type="palworld", lifetime_price_cents=19900)

    resp = client.get("/api/shop/catalog")
    assert resp.status_code == 200
    entry = next(p for p in resp.json() if p["id"] == pal.id)
    assert set(["pc", "ps5", "xbox", "crossplay"]).issubset(set(entry["platforms"]))
    assert entry["lifetime_price_cents"] == 19900
    assert entry["allow_game_switch"] is True
    assert entry["ddos_game_aware"] is True


def test_gamecloud_switch_blueprint_guards(db: Session) -> None:
    node = _create_node(db, is_local=True)
    cust, _, _ = _create_user(db, "gc7")
    srv = _create_server(db, node, game_type="palworld", ram_limit_mb=4096)
    plan = _create_plan(db, game_type="palworld", allow_game_switch=False)
    _seed_contract(db, cust, plan, srv)

    with pytest.raises(HTTPException) as exc_disabled:
        server_lifecycle_service.switch_server_blueprint(
            db, srv, "valheim", user_id=cust.id
        )
    assert exc_disabled.value.status_code == 403
    assert exc_disabled.value.detail["code"] == "game_switch_disabled"

    plan.allow_game_switch = True
    db.commit()

    # Non-game blueprint rejected even if game-switch is on
    with pytest.raises(HTTPException) as exc_cat:
        server_lifecycle_service.switch_server_blueprint(
            db, srv, "postgres", user_id=cust.id
        )
    assert exc_cat.value.status_code == 400

    # Plan for target requiring more RAM than server limit -> 400
    _ = ShopPlan(
        game_type="ark_ascended",
        name="ARK Heavy",
        price_cents=2000,
        ram_included_mb=12288,
        active=True,
    )
    db.add(_)
    db.commit()

    with pytest.raises(HTTPException) as exc_ram:
        server_lifecycle_service.switch_server_blueprint(
            db, srv, "ark_ascended", user_id=cust.id
        )
    assert exc_ram.value.status_code == 400
    assert exc_ram.value.detail["code"] == "game_switch_insufficient_ram"


def test_pause_and_resume_entitlement_standby_and_freeze_budget(
    client: TestClient, db: Session
) -> None:
    node = _create_node(db, is_local=True)
    cust, c_name, c_pw = _create_user(db, "pause7")
    other, o_name, o_pw = _create_user(db, "other7")
    srv = _create_server(db, node, status="running")
    plan = _create_plan(db)
    _, sub, ent = _seed_contract(db, cust, plan, srv, period_days=30)

    c_cookies, c_csrf = _login(client, c_name, c_pw)
    o_cookies, o_csrf = _login(client, o_name, o_pw)

    # Cross-user forbidden (404)
    assert (
        client.post(
            f"/api/shop/entitlements/{ent.id}/pause",
            cookies=o_cookies,
            headers={"X-CSRF-Token": o_csrf},
        ).status_code
        == 404
    )

    with (
        patch("services.shop_order_service._stop_server_for_pause", return_value=True),
        patch("services.shop_order_service._start_server_for_resume", return_value=True),
    ):
        # 1. Standby default (pause_freeze_max_days_per_90d = 0)
        p1 = client.post(
            f"/api/shop/entitlements/{ent.id}/pause",
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
        assert p1.status_code == 200
        assert p1.json()["paused_at"] is not None

        ent.paused_at = datetime.now(timezone.utc) - timedelta(days=5)
        old_end = sub.current_period_end
        db.commit()

        r1 = client.post(
            f"/api/shop/entitlements/{ent.id}/resume",
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
        assert r1.status_code == 200
        assert r1.json()["paused_at"] is None
        assert r1.json()["pause_days_used"] == 0
        db.refresh(sub)
        assert sub.current_period_end == old_end

        # 2. Freeze budget = 14 days
        shop_lifecycle_settings_service.update(
            {"pause_freeze_max_days_per_90d": 14}, db=db
        )
        p2 = client.post(
            f"/api/shop/entitlements/{ent.id}/pause",
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
        assert p2.status_code == 200
        ent.paused_at = datetime.now(timezone.utc) - timedelta(days=5)
        db.commit()

        r2 = client.post(
            f"/api/shop/entitlements/{ent.id}/resume",
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
        assert r2.status_code == 200
        assert r2.json()["pause_days_used"] == 5
        db.refresh(sub)
        assert (sub.current_period_end - old_end).days >= 4


def test_lifetime_order_grant_extend_block_and_purge_immunity(
    client: TestClient, db: Session
) -> None:
    node = _create_node(db, is_local=True, ram_total=65536, cpu_total=32.0)
    cust, c_name, c_pw = _create_user(db, "life7")
    c_cookies, c_csrf = _login(client, c_name, c_pw)

    no_life_plan = _create_plan(db, lifetime_price_cents=None)
    addon = ShopAddon(
        slug=f"slot-addon-{uuid4().hex[:4]}",
        name="Slot Addon",
        category="slots",
        price_cents=300,
        active=True,
    )
    db.add(addon)
    db.commit()

    # Plan without lifetime price -> 422
    resp_no = client.post(
        "/api/shop/orders",
        json={
            "plan_id": no_life_plan.id,
            "months": 1,
            "billing_mode": "lifetime",
        },
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert resp_no.status_code == 422

    # Addon with lifetime -> 422
    resp_addon = client.post(
        "/api/shop/orders",
        json={
            "addon_id": addon.id,
            "months": 1,
            "billing_mode": "lifetime",
        },
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert resp_addon.status_code == 422

    # Valid lifetime plan: 9900 base + (1 extra RAM step = 250 * 12 = 3000) = 12900
    life_plan = _create_plan(db, lifetime_price_cents=9900)
    resp_ok = client.post(
        "/api/shop/orders",
        json={
            "plan_id": life_plan.id,
            "ram_mb": 5120,
            "cpu": 2,
            "slots": 16,
            "months": 1,
            "billing_mode": "lifetime",
        },
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert resp_ok.status_code == 200
    order_data = resp_ok.json()
    assert order_data["billing_mode"] == "lifetime"
    assert order_data["gross_cents"] == 12900

    pay_resp = client.post(
        f"/api/shop/orders/{order_data['id']}/demo-pay",
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert pay_resp.status_code == 200

    sub = (
        db.query(ShopSubscription)
        .filter(ShopSubscription.order_id == order_data["id"])
        .first()
    )
    assert sub is not None
    assert sub.billing_mode == "lifetime"
    assert sub.monthly_gross_cents == 0
    assert sub.cancel_at_period_end is False
    assert (sub.current_period_end - datetime.now(timezone.utc)).days > 30000

    # Extend blocked on lifetime
    ext_resp = client.post(
        f"/api/shop/subscriptions/{sub.id}/extend",
        json={"months": 1},
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert ext_resp.status_code == 409

    # Active lifetime contract immune to purge/unpaid reminders
    srv = _create_server(db, node)
    ent = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id == order_data["id"])
        .first()
    )
    assert ent is not None
    ent.server_id = srv.id
    ent.status = "suspended"
    ent.purge_reason = "unpaid"
    ent.purge_after = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()

    purged = lifecycle_purge_service.purge_expired_shop_entitlements(db)
    assert purged == 0
    db.refresh(ent)
    assert ent.purge_after is None
    assert db.query(Server).filter(Server.id == srv.id).first() is not None


def test_server_config_files_endpoint_and_permissions(
    client: TestClient, db: Session
) -> None:
    node = _create_node(db, is_local=True)
    owner, o_name, o_pw = _create_user(db, "cf_own", is_owner=True)
    stranger, s_name, s_pw = _create_user(db, "cf_str")
    srv = _create_server(db, node, game_type="palworld")
    permission_service.set_user_server_permissions(
        db, owner.id, srv.id, ["server.files.read"], granted_by=None
    )

    o_cookies, _ = _login(client, o_name, o_pw)
    s_cookies, _ = _login(client, s_name, s_pw)

    assert (
        client.get(f"/api/servers/{srv.id}/config-files", cookies=s_cookies).status_code
        == 404
    )
    ok_resp = client.get(f"/api/servers/{srv.id}/config-files", cookies=o_cookies)
    assert ok_resp.status_code == 200
    data = ok_resp.json()
    assert data["server_id"] == srv.id
    assert data["game_type"] == "palworld"
    assert isinstance(data["files"], list)
    assert len(data["files"]) >= 1
    assert any("PalWorldSettings.ini" in item["path"] for item in data["files"])


def test_public_shop_rate_limit_returns_429(client: TestClient) -> None:
    with patch("middleware.rate_limit.limiter.limiter.hit", return_value=False):
        resp = client.get("/api/shop/nodes/status")
    assert resp.status_code == 429
    retry_after = int(resp.headers.get("Retry-After", "0"))
    assert 1 <= retry_after <= 60


def test_checkout_captcha_enforcement_when_enabled(
    client: TestClient, db: Session
) -> None:
    node = _create_node(db, is_local=True)
    cust, c_name, c_pw = _create_user(db, "cap7")
    plan = _create_plan(db)
    c_cookies, c_csrf = _login(client, c_name, c_pw)

    shop_lifecycle_settings_service.update(
        {"shop_checkout_captcha_enabled": True}, db=db
    )

    pol_resp = client.get("/api/shop/public-policy")
    assert pol_resp.status_code == 200
    assert pol_resp.json()["shop_checkout_captcha_enabled"] is True

    cfg_resp = client.get("/api/auth/captcha-config?scope=shop")
    assert cfg_resp.status_code == 200
    assert cfg_resp.json()["enabled"] is True

    # Missing token -> 400
    no_tok = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "months": 1, "billing_mode": "prepaid"},
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert no_tok.status_code == 400

    # Invalid ALTCHA token -> 400
    with patch("services.dis_client.DisClient.verify_altcha", return_value=False):
        bad_tok = client.post(
            "/api/shop/orders",
            json={
                "plan_id": plan.id,
                "months": 1,
                "billing_mode": "prepaid",
                "captcha_token": "invalid-pow",
            },
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
    assert bad_tok.status_code == 400

    # Valid ALTCHA token -> 200
    with patch("services.dis_client.DisClient.verify_altcha", return_value=True):
        ok_tok = client.post(
            "/api/shop/orders",
            json={
                "plan_id": plan.id,
                "months": 1,
                "billing_mode": "prepaid",
                "captcha_token": "valid-pow-token",
            },
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
    assert ok_tok.status_code == 200
