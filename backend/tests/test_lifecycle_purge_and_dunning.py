"""Tests fuer Phase 5: Konfigurierbare Loeschfristen, idempotente Mahnstufen und Kunden-Sofortloeschung."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    AuditLog,
    HosterIdentity,
    HosterService,
    LifecycleDeletionNotice,
    Role,
    RolePermission,
    Server,
    ShopEntitlement,
    ShopOrder,
    ShopOrderItem,
    ShopPlan,
    ShopSubscription,
    User,
)
from services import (
    hoster_integration_service,
    hoster_service_lifecycle,
    lifecycle_purge_service,
    shop_lifecycle_settings_service,
    shop_order_service,
)
from services.auth_service import AuthService
from services.role_service import set_user_roles


def _login(client: TestClient, username: str, password: str) -> tuple[dict, str]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert resp.status_code == 200
    cookies = dict(resp.cookies)
    return cookies, cookies.get("__Secure-csrf_token") or ""


def _create_verified_user(db: Session, prefix: str = "cust") -> tuple[User, str, str]:
    uname = f"{prefix}-{uuid4().hex[:6]}"
    pw = "ShopCustPass123!"
    user = AuthService.create_user(db, uname, f"{uname}@example.de", pw)
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user, uname, pw


def _create_shop_server_bundle(
    db: Session,
    user: User,
    *,
    server_name: str,
    stripe_sub_id: str | None = None,
    sub_status: str = "active",
    ent_status: str = "active",
    cancel_at_period_end: bool = False,
) -> tuple[ShopOrder, ShopSubscription, ShopEntitlement, Server]:
    plan = ShopPlan(
        game_type="minecraft_paper",
        name=f"Tarif-{uuid4().hex[:4]}",
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
        user_id=user.id,
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
        game_type="minecraft_paper",
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

    now = datetime.now(timezone.utc)
    sub = ShopSubscription(
        user_id=user.id,
        order_id=order.id,
        order_item_id=item.id,
        plan_id=plan.id,
        game_type="minecraft_paper",
        name=plan.name,
        status=sub_status,
        billing_interval="month",
        monthly_gross_cents=999,
        tax_rate_percent=19,
        provider_reference=stripe_sub_id,
        started_at=now - timedelta(days=20),
        current_period_end=now + timedelta(days=10),
        cancel_at_period_end=cancel_at_period_end,
    )
    db.add(sub)
    db.flush()

    srv = Server(
        name=server_name,
        game_type="minecraft_paper",
        install_dir=f"/tmp/{server_name}-{uuid4().hex[:4]}",
        container_name=f"msm-{uuid4().hex[:8]}",
        status="stopped",
    )
    db.add(srv)
    db.flush()

    ent = ShopEntitlement(
        user_id=user.id,
        order_id=order.id,
        order_item_id=item.id,
        kind="server",
        label=plan.name,
        plan_id=plan.id,
        server_id=srv.id,
        status=ent_status,
        provisioning_status="ready" if ent_status == "active" else ent_status,
    )
    db.add(ent)
    db.commit()
    db.refresh(order)
    db.refresh(sub)
    db.refresh(ent)
    db.refresh(srv)
    return order, sub, ent, srv


def test_lifecycle_settings_admin_crud_and_validation(
    client: TestClient, owner_cookies: dict, csrf_token: str | None
):
    get_res = client.get("/api/shop/admin/lifecycle-settings", cookies=owner_cookies)
    assert get_res.status_code == 200
    assert get_res.json() == {
        "cancel_grace_days": 7,
        "unpaid_auto_delete_enabled": True,
        "unpaid_delete_days": 30,
        "allow_customer_immediate_delete": True,
        "dunning_reminder_days": [7, 4, 1],
    }

    headers = {"X-CSRF-Token": csrf_token or ""}
    bad_res = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers=headers,
        json={
            "cancel_grace_days": -1,
            "unpaid_auto_delete_enabled": True,
            "unpaid_delete_days": 30,
            "allow_customer_immediate_delete": True,
            "dunning_reminder_days": [7, 4, 1],
        },
    )
    assert bad_res.status_code == 422

    bad_days = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers=headers,
        json={
            "cancel_grace_days": 7,
            "unpaid_auto_delete_enabled": True,
            "unpaid_delete_days": 30,
            "allow_customer_immediate_delete": True,
            "dunning_reminder_days": [0, 5],
        },
    )
    assert bad_days.status_code == 422

    ok_res = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers=headers,
        json={
            "cancel_grace_days": 14,
            "unpaid_auto_delete_enabled": True,
            "unpaid_delete_days": 21,
            "allow_customer_immediate_delete": False,
            "dunning_reminder_days": [1, 7, 3, 7],
        },
    )
    assert ok_res.status_code == 200
    assert ok_res.json() == {
        "cancel_grace_days": 14,
        "unpaid_auto_delete_enabled": True,
        "unpaid_delete_days": 21,
        "allow_customer_immediate_delete": False,
        "dunning_reminder_days": [7, 3, 1],
    }


def test_customer_immediate_purge_ownership_guards_and_invoice_preservation(
    client: TestClient, db: Session, owner_user: User
):
    _ = owner_user
    user_a, uname_a, pw_a = _create_verified_user(db, "cust-a")
    user_b, uname_b, pw_b = _create_verified_user(db, "cust-b")

    order_a, sub_a, ent_a, srv_a = _create_shop_server_bundle(
        db, user_a, server_name="Alpha-Server", stripe_sub_id="sub_alpha_1"
    )
    _, _, ent_b, srv_b = _create_shop_server_bundle(
        db, user_b, server_name="Beta-Server", stripe_sub_id="sub_beta_1"
    )

    cookies_a, csrf_a = _login(client, uname_a, pw_a)
    cookies_b, csrf_b = _login(client, uname_b, pw_b)

    # 1. Fremder Kunde darf fremden Vertrag niemals loeschen -> 404
    foreign = client.post(
        f"/api/shop/entitlements/{ent_a.id}/purge-now",
        cookies=cookies_b,
        headers={"X-CSRF-Token": csrf_b},
        json={"confirm_server_name": "Alpha-Server"},
    )
    assert foreign.status_code == 404

    # 2. Aktiver (nicht gekuendigter) eigener Vertrag darf nicht ueber purge-now geloescht werden -> 403
    not_cancelled = client.post(
        f"/api/shop/entitlements/{ent_a.id}/purge-now",
        cookies=cookies_a,
        headers={"X-CSRF-Token": csrf_a},
        json={"confirm_server_name": "Alpha-Server"},
    )
    assert not_cancelled.status_code == 403

    # 3. Zahlungssperre (`suspended`) darf nicht ueber Kunden-Sofortloeschung umgangen werden -> 403
    ent_a.status = "suspended"
    ent_a.purge_reason = "unpaid"
    db.commit()
    suspended_try = client.post(
        f"/api/shop/entitlements/{ent_a.id}/purge-now",
        cookies=cookies_a,
        headers={"X-CSRF-Token": csrf_a},
        json={"confirm_server_name": "Alpha-Server"},
    )
    assert suspended_try.status_code == 403

    # Zurueck auf aktiv fuer regulaere Kuendigung
    ent_a.status = "active"
    ent_a.purge_reason = None
    db.commit()

    # 4. Falscher Servername bei immediate cancel -> 422 und Stripe wird NICHT gekuendigt
    with patch("services.stripe_service.cancel_subscription_immediately") as stripe_cancel, patch(
        "services.server_deletion_service.delete_server_completely"
    ) as del_mock:
        bad_name = client.post(
            f"/api/shop/subscriptions/{sub_a.id}/cancel",
            cookies=cookies_a,
            headers={"X-CSRF-Token": csrf_a},
            json={"deletion_mode": "immediate", "confirm_server_name": "FalscherName"},
        )
        assert bad_name.status_code == 422
        stripe_cancel.assert_not_called()
        del_mock.assert_not_called()

        # 5. Gueltige Sofortloeschung mit exaktem Servernamen loescht nur Alpha-Server
        ok_purge = client.post(
            f"/api/shop/subscriptions/{sub_a.id}/cancel",
            cookies=cookies_a,
            headers={"X-CSRF-Token": csrf_a},
            json={"deletion_mode": "immediate", "confirm_server_name": "Alpha-Server"},
        )
        assert ok_purge.status_code == 200
        assert ok_purge.json()["status"] == "cancelled"
        assert ok_purge.json()["delete_server_on_end"] is True
        stripe_cancel.assert_called_once_with("sub_alpha_1")
        del_mock.assert_called_once()
        assert del_mock.call_args.kwargs["server_id"] == srv_a.id

    db.refresh(ent_a)
    db.refresh(ent_b)
    assert ent_a.server_id is None
    assert ent_a.provisioning_status == "purged"
    assert ent_a.purged_at is not None
    # Bestell- und Betreff-Historie bleibt unberuehrt, fremder Server ebenfalls
    assert db.get(ShopOrder, order_a.id) is not None
    assert ent_b.server_id == srv_b.id
    assert (
        db.query(AuditLog)
        .filter(
            AuditLog.action == "shop.entitlement.customer_purged",
            AuditLog.target_id == str(ent_a.id),
        )
        .first()
        is not None
    )


def test_double_contract_protection_blocks_scheduler_deletion(db: Session, owner_user: User):
    _ = owner_user
    user, _, _ = _create_verified_user(db, "shared")
    _, _, ent1, srv = _create_shop_server_bundle(
        db, user, server_name="Shared-Srv", ent_status="revoked"
    )
    ent1.purge_after = datetime.now(timezone.utc) - timedelta(hours=1)
    ent1.purge_reason = "voluntary_cancel"

    # Zweiter aktiver Vertrag zeigt auf denselben Server
    ent2 = ShopEntitlement(
        user_id=user.id,
        order_id=ent1.order_id,
        order_item_id=ent1.order_item_id,
        kind="server",
        label="Zweitvertrag",
        server_id=srv.id,
        status="active",
        provisioning_status="ready",
    )
    db.add(ent2)
    db.commit()

    with patch("services.server_deletion_service.delete_server_completely") as del_mock:
        purged = lifecycle_purge_service.purge_expired_shop_entitlements(db)

    assert purged == 0
    del_mock.assert_not_called()
    db.refresh(ent1)
    assert ent1.server_id == srv.id
    assert ent1.purge_after is None


def test_staged_dunning_emails_idempotent_catchup_no_voluntary_spam_and_payment_rescue(
    db: Session, owner_user: User
):
    _ = owner_user
    shop_lifecycle_settings_service.update(
        {
            "cancel_grace_days": 7,
            "unpaid_auto_delete_enabled": True,
            "unpaid_delete_days": 30,
            "allow_customer_immediate_delete": True,
            "dunning_reminder_days": [7, 4, 1],
        },
        db=db,
    )
    user, _, _ = _create_verified_user(db, "dunning")
    t0 = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
    _, sub, ent, srv = _create_shop_server_bundle(db, user, server_name="Dunning-Srv")

    # Zahlungsverzug tritt ein -> 30-Tage-Frist
    ent.status = "suspended"
    lifecycle_purge_service.mark_entitlement_suspended(ent, now=t0, db=db)

    # Zweiter Server ist freiwillig gekuendigt -> darf NIE Zahlungsmahnung erhalten
    user_vol, _, _ = _create_verified_user(db, "vol")
    _, _, ent_vol, _ = _create_shop_server_bundle(
        db, user_vol, server_name="Voluntary-Srv", ent_status="revoked"
    )
    lifecycle_purge_service.mark_entitlement_revoked(
        ent_vol, reason="voluntary_cancel", now=t0, db=db
    )
    db.commit()

    deadline = ent.purge_after
    assert deadline is not None
    cycle1 = ent.purge_cycle_token
    assert cycle1 is not None

    with patch(
        "services.email_service.EmailService.send_server_deletion_warning_email",
        new_callable=AsyncMock,
        return_value=True,
    ) as mail_mock:
        # Tag -10: noch keine Mahnung faellig
        assert (
            lifecycle_purge_service.process_unpaid_deletion_reminders(
                db, now=deadline - timedelta(days=10)
            )
            == 0
        )
        mail_mock.assert_not_called()

        # Tag -7: erste Stufe feuert genau 1x, Mehrfachlauf erzeugt 0 Duplikate
        assert (
            lifecycle_purge_service.process_unpaid_deletion_reminders(
                db, now=deadline - timedelta(days=6, hours=12)
            )
            == 1
        )
        assert mail_mock.call_count == 1
        assert mail_mock.call_args.kwargs["days_remaining"] == 7
        assert mail_mock.call_args.kwargs["server_name"] == "Dunning-Srv"

        assert (
            lifecycle_purge_service.process_unpaid_deletion_reminders(
                db, now=deadline - timedelta(days=6, hours=11)
            )
            == 0
        )
        assert mail_mock.call_count == 1

        # Sprung direkt auf Tag -2 (Stufe 4 uebersprungen -> Catch-up: dringlichste Stufe 4 senden, keine Flut)
        # bzw. bei Tag -3 (3 <= 4, aber > 1): sendet nur Stufe 4
        assert (
            lifecycle_purge_service.process_unpaid_deletion_reminders(
                db, now=deadline - timedelta(days=2, hours=12)
            )
            == 1
        )
        assert mail_mock.call_count == 2
        assert mail_mock.call_args.kwargs["days_remaining"] == 3

        # Letzter Tag (-12h): "Morgen wird dein Server geloescht" (days_remaining == 1)
        assert (
            lifecycle_purge_service.process_unpaid_deletion_reminders(
                db, now=deadline - timedelta(hours=12)
            )
            == 1
        )
        assert mail_mock.call_count == 3
        assert mail_mock.call_args.kwargs["days_remaining"] == 1

        # Erneuter Lauf am selben Tag -> keine weitere Mail
        assert (
            lifecycle_purge_service.process_unpaid_deletion_reminders(
                db, now=deadline - timedelta(hours=2)
            )
            == 0
        )
        assert mail_mock.call_count == 3

        # Freiwillige Kuendigung hat keine einzige Mail erhalten
        for call in mail_mock.call_args_list:
            assert call.kwargs["server_name"] != "Voluntary-Srv"

    assert (
        db.query(LifecycleDeletionNotice)
        .filter(
            LifecycleDeletionNotice.target_kind == "shop_entitlement",
            LifecycleDeletionNotice.target_id == ent.id,
            LifecycleDeletionNotice.cycle_token == cycle1,
            LifecycleDeletionNotice.status == "sent",
        )
        .count()
        == 3
    )

    # Zahlungseingang rettet sofort und loescht Countdown
    shop_order_service._set_entitlements_status(db, sub, "active")
    db.commit()
    db.refresh(ent)
    assert ent.purge_after is None
    assert ent.suspended_at is None
    assert ent.purge_reason is None
    assert ent.purge_cycle_token is None

    # Spaeterer neuer Zahlungsverzug erzeugt frisches Cycle-Token
    ent.status = "suspended"
    lifecycle_purge_service.mark_entitlement_suspended(
        ent, now=t0 + timedelta(days=40), db=db
    )
    db.commit()
    assert ent.purge_cycle_token != cycle1


def test_expired_shop_and_hoster_services_auto_purge_after_deadline(
    db: Session, owner_user: User
):
    _ = owner_user
    t0 = datetime.now(timezone.utc)

    # 1. Shop-Server nach abgelaufenem Zahlungsverzug
    user, _, _ = _create_verified_user(db, "exp-shop")
    order, _, ent, srv_shop = _create_shop_server_bundle(
        db, user, server_name="Expired-Shop-Srv", sub_status="past_due", ent_status="suspended"
    )
    ent.purge_reason = "unpaid"
    ent.purge_after = t0 - timedelta(minutes=5)
    db.commit()

    # 2. Hoster-API-Server mit per-Integration unpaid_delete_days=14 + E-Mail-Warnung
    svc_role = Role(name=f"h-svc-{uuid4().hex[:6]}", is_system=False)
    db.add(svc_role)
    db.flush()
    for key in ("servers.create", "servers.delete", "server.stop", "server.start", "server.restart"):
        db.add(RolePermission(role_id=svc_role.id, permission_key=key))
    svc_user, _, _ = _create_verified_user(db, "hsvc")
    db.commit()
    set_user_roles(db, svc_user, [svc_role.id])

    integration, _ = hoster_integration_service.create_integration(
        db,
        name="HosterPurge",
        slug=f"hpurge-{uuid4().hex[:6]}",
        enabled=True,
        is_sandbox=False,
        service_user_id=svc_user.id,
        webhook_url=None,
        terminate_grace_days=7,
        unpaid_delete_days=14,
    )
    cust_hoster, _, _ = _create_verified_user(db, "hcust")
    ident = HosterIdentity(
        integration_id=integration.id,
        external_subject_hash=uuid4().hex * 2,
        external_subject_hint="CUST-H1",
        user_id=cust_hoster.id,
    )
    db.add(ident)
    srv_hoster = Server(
        name="Hoster-Unpaid-Srv",
        game_type="minecraft_paper",
        install_dir=f"/tmp/h-{uuid4().hex[:6]}",
        container_name=f"msm-h-{uuid4().hex[:6]}",
        status="stopped",
    )
    db.add(srv_hoster)
    db.flush()
    hs_unpaid = HosterService(
        integration_id=integration.id,
        external_service_id="SVC-UNPAID-14",
        identity_id=ident.id,
        item_kind="server",
        server_id=srv_hoster.id,
        desired_state="active",
        status="ready",
        correlation_id=str(uuid4()),
    )
    db.add(hs_unpaid)
    db.commit()

    # Hoster-Shop meldetZahlungssperre (`suspended`)
    with patch(
        "services.server_action_service.request_lifecycle_operation",
        return_value={"task_id": "t-stop-h"},
    ):
        hs_unpaid = hoster_service_lifecycle.apply_desired_state(
            db,
            integration=integration,
            external_service_id="SVC-UNPAID-14",
            desired_state="suspended",
            external_subject="CUST-H1",
        )
    assert hs_unpaid.status == "suspended"
    assert hs_unpaid.purge_reason == "unpaid"
    assert hs_unpaid.terminate_after is not None
    # Frist liegt bei ~14 Tagen statt globalen 30 Tagen
    delta_days = (hs_unpaid.terminate_after - datetime.now(timezone.utc)).total_seconds() / 86400
    assert 13.5 <= delta_days <= 14.1

    # E-Mail-Erinnerung feuert 1 Tag vor Fristende auch fuer Hoster-Service
    with patch(
        "services.email_service.EmailService.send_server_deletion_warning_email",
        new_callable=AsyncMock,
        return_value=True,
    ) as hoster_mail:
        sent = lifecycle_purge_service.process_unpaid_deletion_reminders(
            db, now=hs_unpaid.terminate_after - timedelta(hours=10)
        )
    assert sent == 1
    hoster_mail.assert_awaited_once()
    assert hoster_mail.call_args.kwargs["days_remaining"] == 1
    assert hoster_mail.call_args.kwargs["server_name"] == "Hoster-Unpaid-Srv"

    # Aufräumlauf nach Ablauf loescht sowohl Shop- als auch Hoster-Server
    with patch("services.server_deletion_service.delete_server_completely") as del_mock:
        purged_shop = lifecycle_purge_service.purge_expired_shop_entitlements(
            db, now=t0
        )
        purged_hoster = hoster_service_lifecycle.purge_terminated_services(
            db, now=hs_unpaid.terminate_after + timedelta(minutes=1)
        )

    assert purged_shop == 1
    assert purged_hoster == 1
    deleted_ids = {call.kwargs["server_id"] for call in del_mock.call_args_list}
    assert deleted_ids == {srv_shop.id, srv_hoster.id}

    db.refresh(ent)
    db.refresh(hs_unpaid)
    assert ent.server_id is None
    assert ent.provisioning_status == "purged"
    assert ent.purged_at is not None
    assert db.get(ShopOrder, order.id) is not None
    assert hs_unpaid.server_id is None
    assert hs_unpaid.status == "terminated"
    assert hs_unpaid.desired_state == "terminated"
    assert hs_unpaid.purged_at is not None
