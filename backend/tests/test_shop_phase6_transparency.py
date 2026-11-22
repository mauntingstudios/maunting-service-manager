"""Tests fuer Phase 6: Node-Transparenz, Prepaid vs. Abo, Cloudflare-Subdomains, Update-Pinning & Welt-Export."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    Backup,
    Mod,
    Node,
    Role,
    RolePermission,
    Server,
    ServerPort,
    ShopEntitlement,
    ShopOrder,
    ShopOrderItem,
    ShopPlan,
    ShopSubscription,
    User,
)
from services import (
    cloudflare_service,
    permission_service,
    server_dns_service,
    shop_lifecycle_settings_service,
    shop_order_service,
    stripe_service,
)
from services.auth_service import AuthService
from services.role_service import set_user_roles
from services.scheduler_service import _background_update_check_task


def _login(client: TestClient, username: str, password: str) -> tuple[dict, str]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert resp.status_code == 200
    cookies = dict(resp.cookies)
    return cookies, cookies.get("__Secure-csrf_token") or ""


def _create_owner(db: Session) -> tuple[User, str, str]:
    uname = f"owner6-{uuid4().hex[:6]}"
    pw = "OwnerPass123!"
    user = AuthService.create_user(db, uname, f"{uname}@example.de", pw)
    user.is_owner = True
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user, uname, pw


def _create_verified_user(db: Session, prefix: str = "cust6") -> tuple[User, str, str]:
    uname = f"{prefix}-{uuid4().hex[:6]}"
    pw = "ShopCustPass123!"
    user = AuthService.create_user(db, uname, f"{uname}@example.de", pw)
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user, uname, pw


def test_public_node_status_honest_hardware_and_no_secrets(
    client: TestClient, db: Session
) -> None:
    node_ddr5 = Node(
        name=f"fra-node-{uuid4().hex[:4]}",
        host="https://198.51.100.42:9000",
        auth_token_enc="enc:super-secret-token",
        tls_fingerprint="ab" * 32,
        is_local=False,
        status="online",
        cpu_total=16.0,
        cpu_model="AMD Ryzen 9 7950X3D",
        location_label="Frankfurt, DE",
        ram_type="DDR5",
        storage_type="NVMe SSD",
        cpu_steal_percent=0.4,
        ram_total=65536,
    )
    node_unknown = Node(
        name=f"unk-node-{uuid4().hex[:4]}",
        host="https://198.51.100.43:9000",
        auth_token_enc="enc:other-secret",
        tls_fingerprint="cd" * 32,
        is_local=False,
        status="online",
        cpu_total=8.0,
        ram_type=None,
        ram_total=16384,
    )
    db.add_all([node_ddr5, node_unknown])
    db.flush()

    plan_ddr5 = ShopPlan(
        game_type="minecraft_paper",
        name=f"Tarif-FRA-{uuid4().hex[:4]}",
        price_cents=1000,
        ram_included_mb=4096,
        node_id=node_ddr5.id,
        active=True,
    )
    plan_pool = ShopPlan(
        game_type="postgres",
        name=f"Tarif-Pool-{uuid4().hex[:4]}",
        price_cents=800,
        ram_included_mb=2048,
        node_id=None,
        active=True,
    )
    db.add_all([plan_ddr5, plan_pool])
    db.commit()

    resp = client.get("/api/shop/nodes/status")
    assert resp.status_code == 200
    body_text = resp.text
    assert "198.51.100.42" not in body_text
    assert "super-secret-token" not in body_text
    assert "ab" * 16 not in body_text

    rows = {r["id"]: r for r in resp.json()}
    assert rows[node_ddr5.id]["ram_type"] == "DDR5"
    assert rows[node_ddr5.id]["location_label"] == "Frankfurt, DE"
    assert rows[node_ddr5.id]["storage_type"] == "NVMe SSD"
    assert rows[node_ddr5.id]["accepting_orders"] is True
    # Node without configured RAM type must NOT fabricate DDR5.
    assert rows[node_unknown.id]["ram_type"] is None

    cat_resp = client.get("/api/shop/catalog")
    assert cat_resp.status_code == 200
    by_id = {c["id"]: c for c in cat_resp.json()}
    assert by_id[plan_ddr5.id]["hardware_ram_type"] == "DDR5"
    assert by_id[plan_ddr5.id]["hardware_cpu_model"] == "AMD Ryzen 9 7950X3D"
    # Mixed / partially-unknown pool must stay None instead of faking DDR5.
    assert by_id[plan_pool.id]["hardware_ram_type"] is None
    assert by_id[plan_pool.id]["estimated_setup_seconds"] == 20


def test_prepaid_vs_subscription_discount_stripe_mode_and_extend(
    client: TestClient, db: Session, monkeypatch
) -> None:
    _, owner_name, owner_pw = _create_owner(db)
    o_cookies, o_csrf = _login(client, owner_name, owner_pw)

    cust, cust_name, cust_pw = _create_verified_user(db)
    c_cookies, c_csrf = _login(client, cust_name, cust_pw)

    put_resp = client.put(
        "/api/shop/admin/lifecycle-settings",
        json={
            "cancel_grace_days": 7,
            "unpaid_auto_delete_enabled": True,
            "unpaid_delete_days": 30,
            "allow_customer_immediate_delete": True,
            "dunning_reminder_days": [7, 4, 1],
            "subscription_discount_percent": 12,
            "refund_guarantee_days": 7,
            "refund_policy_note": "Erstattung auf die urspruengliche Zahlungsmethode",
            "auto_subdomain_enabled": True,
            "auto_subdomain_zone": "play.example.de",
        },
        cookies=o_cookies,
        headers={"X-CSRF-Token": o_csrf},
    )
    assert put_resp.status_code == 200

    pol = client.get("/api/shop/public-policy")
    assert pol.status_code == 200
    assert pol.json()["default_billing_mode"] == "prepaid"
    assert pol.json()["subscription_discount_percent"] == 12
    assert pol.json()["refund_guarantee_days"] == 7
    assert pol.json()["auto_subdomain_zone"] == "play.example.de"

    plan = ShopPlan(
        game_type="minecraft_paper",
        name=f"PrepaidPlan-{uuid4().hex[:4]}",
        price_cents=1000,
        ram_included_mb=2048,
        active=True,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    # 1) Prepaid 1 month: no subscription discount, Stripe Checkout runs in payment mode,
    # and resulting subscription does not auto-renew (cancel_at_period_end=True).
    prepaid_resp = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "months": 1, "billing_mode": "prepaid"},
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert prepaid_resp.status_code == 200
    prepaid_order_data = prepaid_resp.json()
    assert prepaid_order_data["billing_mode"] == "prepaid"
    assert prepaid_order_data["discount_percent"] == 0
    assert prepaid_order_data["gross_cents"] == 1000

    prepaid_order = db.query(ShopOrder).filter(ShopOrder.id == prepaid_order_data["id"]).first()
    prepaid_item = (
        db.query(ShopOrderItem).filter(ShopOrderItem.order_id == prepaid_order.id).first()
    )
    captured_modes: list[str] = []

    def _fake_post_form(path: str, data: list[tuple[str, str]], secret: str, **_kwargs):
        data_dict = dict(data)
        captured_modes.append(data_dict.get("mode", ""))
        return {"id": "cs_test_123", "url": "https://checkout.stripe.com/pay/cs_test_123"}

    monkeypatch.setattr(stripe_service, "_require_secret", lambda: "sk_test_dummy")
    monkeypatch.setattr(stripe_service, "_post_form", _fake_post_form)
    stripe_service.create_checkout_session(prepaid_order, prepaid_item)
    assert captured_modes[-1] == "payment"

    # Pay prepaid order -> subscription starts with cancel_at_period_end=True
    with patch("services.shop_fulfillment_service.sync_order_entitlements", return_value=[]):
        pay_resp = client.post(
            f"/api/shop/orders/{prepaid_order.id}/demo-pay",
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
    assert pay_resp.status_code == 200
    sub = (
        db.query(ShopSubscription)
        .filter(ShopSubscription.order_id == prepaid_order.id)
        .first()
    )
    assert sub is not None
    assert sub.billing_mode == "prepaid"
    assert sub.cancel_at_period_end is True
    orig_end = sub.current_period_end

    # 2) Extend prepaid subscription without duplicating servers; also test reactivation from suspended.
    ent = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_item_id == sub.order_item_id, ShopEntitlement.kind == "server")
        .first()
    )
    assert ent is not None
    ent.status = "suspended"
    ent.purge_after = datetime.now(timezone.utc) + timedelta(days=10)
    db.commit()

    ext_resp = client.post(
        f"/api/shop/subscriptions/{sub.id}/extend",
        json={"months": 3},
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert ext_resp.status_code == 200
    ext_data = ext_resp.json()
    assert ext_data["extend_subscription_id"] == sub.id
    assert ext_data["billing_mode"] == "prepaid"
    assert ext_data["discount_percent"] == 5

    with patch("services.shop_fulfillment_service.sync_order_entitlements", return_value=[]):
        ext_pay = client.post(
            f"/api/shop/orders/{ext_data['id']}/demo-pay",
            cookies=c_cookies,
            headers={"X-CSRF-Token": c_csrf},
        )
    assert ext_pay.status_code == 200
    db.refresh(sub)
    db.refresh(ent)
    assert sub.current_period_end > orig_end + timedelta(days=75)
    assert ent.status == "active"
    assert ent.purge_after is None
    assert (
        db.query(ShopSubscription).filter(ShopSubscription.user_id == cust.id).count()
        == 1
    )

    # 3) Active Subscription order receives server-side 12% discount and uses mode="subscription".
    sub_resp = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "months": 1, "billing_mode": "subscription"},
        cookies=c_cookies,
        headers={"X-CSRF-Token": c_csrf},
    )
    assert sub_resp.status_code == 200
    assert sub_resp.json()["discount_percent"] == 12
    assert sub_resp.json()["gross_cents"] == 880
    sub_order = db.query(ShopOrder).filter(ShopOrder.id == sub_resp.json()["id"]).first()
    sub_item = db.query(ShopOrderItem).filter(ShopOrderItem.order_id == sub_order.id).first()
    stripe_service.create_checkout_session(sub_order, sub_item)
    assert captured_modes[-1] == "subscription"

    # Non-owner cannot extend someone else's subscription.
    other, other_name, other_pw = _create_verified_user(db, prefix="other6")
    other_cookies, other_csrf = _login(client, other_name, other_pw)
    forbid_resp = client.post(
        f"/api/shop/subscriptions/{sub.id}/extend",
        json={"months": 1},
        cookies=other_cookies,
        headers={"X-CSRF-Token": other_csrf},
    )
    assert forbid_resp.status_code == 404


def test_cloudflare_subdomain_lifecycle_and_best_effort(db: Session, monkeypatch) -> None:
    shop_lifecycle_settings_service.update(
        {
            "auto_subdomain_enabled": True,
            "auto_subdomain_zone": "games.example.de",
        },
        db=db,
    )
    node1 = Node(
        name="n1",
        host="https://203.0.113.10:9000",
        auth_token_enc="enc:tok",
        tls_fingerprint="11" * 32,
        status="online",
    )
    node2 = Node(
        name="n2",
        host="https://203.0.113.20:9000",
        auth_token_enc="enc:tok",
        tls_fingerprint="22" * 32,
        status="online",
    )
    db.add_all([node1, node2])
    db.flush()

    srv = Server(
        name="Alpha World",
        game_type="minecraft_paper",
        install_dir="/opt/msm/servers/alpha",
        node_id=node1.id,
        public_bind_ip="203.0.113.10",
    )
    srv.ports = [ServerPort(role="game", port=25587, protocol="udp")]
    db.add(srv)
    db.commit()
    db.refresh(srv)

    created_calls: list[dict] = []
    deleted_calls: list[tuple[str | None, str]] = []

    async def _fake_resolve_zone(zone):
        return "zone_123"

    async def _fake_create_record(zone_id, name, rtype, content="", proxied=False, ttl=1, priority=None, data=None):
        rec_id = f"{rtype.lower()}_{len(created_calls) + 1}"
        created_calls.append(
            {"zone_id": zone_id, "name": name, "rtype": rtype, "content": content, "proxied": proxied, "data": data}
        )
        return {"id": rec_id}

    async def _fake_delete_record(zone_id, record_id):
        deleted_calls.append((zone_id, record_id))
        return True

    monkeypatch.setattr(cloudflare_service, "is_configured", lambda: True)
    monkeypatch.setattr(cloudflare_service, "_resolve_zone_id", _fake_resolve_zone)
    monkeypatch.setattr(cloudflare_service, "create_dns_record", _fake_create_record)
    monkeypatch.setattr(cloudflare_service, "delete_dns_record", _fake_delete_record)

    hostname = server_dns_service.provision_server_subdomain(db, srv)
    assert hostname == f"alpha-world-{srv.id}.games.example.de"
    assert srv.cloudflare_a_record_id == "a_1"
    assert srv.cloudflare_srv_record_id == "srv_2"
    assert created_calls[0]["rtype"] == "A"
    assert created_calls[0]["content"] == "203.0.113.10"
    assert created_calls[0]["proxied"] is False
    assert created_calls[1]["rtype"] == "SRV"
    assert created_calls[1]["data"]["service"] == "_minecraft"
    assert created_calls[1]["data"]["port"] == 25587

    # Simulate migration to node2: deletes old records and re-creates same hostname with node2 IP.
    srv.node = node2
    srv.node_id = node2.id
    srv.public_bind_ip = "203.0.113.20"
    migrated_host = server_dns_service.sync_server_subdomain_on_migration(db, srv)
    assert migrated_host == hostname
    assert ("zone_123", "srv_2") in deleted_calls
    assert ("zone_123", "a_1") in deleted_calls
    assert created_calls[2]["content"] == "203.0.113.20"

    # Cleanup deletes current records cleanly.
    server_dns_service.cleanup_server_subdomain(db, srv)
    assert ("zone_123", "a_3") in deleted_calls
    assert ("zone_123", "srv_4") in deleted_calls


def test_update_pinning_patch_and_scheduler_skip(
    client: TestClient, db: Session, monkeypatch
) -> None:
    cust, cust_name, cust_pw = _create_verified_user(db, prefix="pin6")
    srv = Server(
        name=f"ModdedSrv-{uuid4().hex[:4]}",
        game_type="minecraft_paper",
        install_dir="/opt/msm/servers/modded",
        status="stopped",
        auto_update_paused=False,
    )
    db.add(srv)
    db.flush()
    permission_service.set_user_server_permissions(
        db, cust.id, srv.id, ["server.view", "server.config.write"], granted_by=None
    )
    mod = Mod(
        server_id=srv.id,
        workshop_id="999",
        name="Pinned Mod",
        load_order=0,
        auto_update=True,
        enabled=True,
        install_status="installed",
    )
    db.add(mod)
    db.commit()

    cookies, csrf = _login(client, cust_name, cust_pw)
    patch_resp = client.patch(
        f"/api/servers/{srv.id}",
        json={"auto_update_paused": True},
        cookies=cookies,
        headers={"X-CSRF-Token": csrf},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["auto_update_paused"] is True

    calls: list[bool] = []

    class _Plugin:
        def check_for_mod_updates(self, _srv):
            return [{"workshop_id": "999", "name": "Pinned Mod", "action": "update"}]

        def perform_workshop_mod_updates(self, _srv, *, only_auto_update: bool = False):
            calls.append(only_auto_update)
            return {"ok": True}

        def check_for_server_file_update(self, _srv):
            return {"action": "none"}

    monkeypatch.setattr("services.scheduler_service.get_plugin", lambda _g: _Plugin())
    monkeypatch.setattr("services.scheduler_service._append_console_log", lambda *_a, **_k: None)
    monkeypatch.setattr("services.email_service.EmailService.is_configured", staticmethod(lambda: False))

    asyncio.run(_background_update_check_task())
    assert calls == []


def test_grace_period_backup_export_security_and_download(
    client: TestClient, db: Session, tmp_path: Path
) -> None:
    cust, cust_name, cust_pw = _create_verified_user(db, prefix="exp6")
    other, other_name, other_pw = _create_verified_user(db, prefix="intr6")

    srv = Server(
        name=f"GraceWorld-{uuid4().hex[:4]}",
        game_type="minecraft_paper",
        install_dir=str(tmp_path / "srv"),
        status="stopped",
    )
    db.add(srv)
    db.flush()

    archive_file = tmp_path / "world-backup.tar.gz"
    archive_bytes = b"\x1f\x8b\x08\x00dummy-world-archive"
    archive_file.write_bytes(archive_bytes)

    backup = Backup(
        server_id=srv.id,
        name="Pre-Cancel Backup",
        filename=str(archive_file),
        size_mb=1.0,
        encrypted=False,
    )
    db.add(backup)

    plan = ShopPlan(
        game_type="minecraft_paper",
        name=f"PlanExp-{uuid4().hex[:4]}",
        price_cents=500,
        ram_included_mb=2048,
        active=True,
    )
    db.add(plan)
    db.flush()

    order = ShopOrder(
        number=f"MSM-2026-{uuid4().hex[:6]}",
        user_id=cust.id,
        status="paid",
        currency="EUR",
        months=1,
        net_cents=420,
        tax_cents=80,
        gross_cents=500,
        payment_provider="demo",
    )
    db.add(order)
    db.flush()
    item = ShopOrderItem(
        order_id=order.id,
        kind="plan",
        plan_id=plan.id,
        game_type="minecraft_paper",
        name=plan.name,
        quantity=1,
        unit_price_cents=500,
        tax_rate_percent=19,
        net_cents=420,
        tax_cents=80,
        gross_cents=500,
    )
    db.add(item)
    db.flush()

    ent = ShopEntitlement(
        user_id=cust.id,
        order_id=order.id,
        order_item_id=item.id,
        kind="server",
        label=plan.name,
        status="revoked",
        server_id=srv.id,
        provisioning_status="revoked",
        purge_reason="voluntary_cancel",
        purge_after=datetime.now(timezone.utc) + timedelta(days=5),
    )
    db.add(ent)
    db.commit()

    c_cookies, _ = _login(client, cust_name, cust_pw)
    o_cookies, _ = _login(client, other_name, other_pw)

    list_resp = client.get(f"/api/shop/entitlements/{ent.id}/backups", cookies=c_cookies)
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0]["downloadable"] is True
    assert str(tmp_path) not in list_resp.text

    dl_resp = client.get(
        f"/api/shop/entitlements/{ent.id}/backups/{backup.id}/download",
        cookies=c_cookies,
    )
    assert dl_resp.status_code == 200
    assert dl_resp.content == archive_bytes

    # Non-owner gets 404.
    assert (
        client.get(f"/api/shop/entitlements/{ent.id}/backups", cookies=o_cookies).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/shop/entitlements/{ent.id}/backups/{backup.id}/download",
            cookies=o_cookies,
        ).status_code
        == 404
    )
