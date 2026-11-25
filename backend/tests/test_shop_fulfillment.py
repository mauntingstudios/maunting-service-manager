"""Fulfillment von Shop-Entitlements: Provisionierung, Rollen, Isolation & Lifecycle."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    HosterIdentity,
    HosterIntegration,
    HosterProduct,
    HosterService,
    Role,
    RolePermission,
    Server,
    ServerPermission,
    ShopEntitlement,
    User,
)
from services import (
    hoster_integration_service,
    permission_service,
    role_service,
    stripe_settings_service,
)
from services.auth_service import AuthService
from services.hoster_service_lifecycle import CUSTOMER_SERVER_PERMISSIONS
from services.operation_task_service import TASK_SERVER_PROVISION, create_or_reuse_task
from services.permission_catalog import SYSTEM_ROLE_ADMIN, SYSTEM_ROLE_USER
from services.server_provisioning_service import ProvisioningResult


WEBHOOK_SECRET = "whsec_fulfillment_test_not_real"


def _fake_provision(calls: list[dict] | None = None):
    """Minimale Serverzeile statt echtem Docker-/SteamCMD-Lauf im Test."""

    def _provision(
        session: Session,
        request,
        actor,
        *,
        idempotency_key: str | None = None,
        retry_of_id: str | None = None,
    ) -> ProvisioningResult:
        if calls is not None:
            calls.append(
                {
                    "request": request,
                    "actor_id": actor.user.id,
                    "origin": actor.origin,
                    "idempotency_key": idempotency_key,
                    "retry_of_id": retry_of_id,
                }
            )
        if not permission_service.has_global_permission(
            session, actor.user, "servers.create"
        ):
            raise HTTPException(status_code=403, detail="Keine Berechtigung")
        task, created = create_or_reuse_task(
            session,
            actor=actor,
            task_type=TASK_SERVER_PROVISION,
            request_hash=hashlib.sha256(
                json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()
            ).hexdigest(),
            idempotency_key=idempotency_key,
            retry_of_id=retry_of_id,
        )
        if not created:
            if task.status == "failed":
                raise HTTPException(
                    status_code=409,
                    detail={"code": task.error_code or "task_failed", "task_id": task.id},
                )
            server = session.query(Server).filter(Server.id == task.server_id).first()
            return ProvisioningResult(
                server=server, task=task, postgres_credentials=[], reused=True
            )
        server = Server(
            name=request.name,
            game_type=request.game_type or "palworld",
            install_dir=f"/tmp/shop-{uuid4().hex[:8]}",
            container_name=f"msm-shop-{uuid4().hex[:8]}",
            status="stopped",
            cpu_limit_percent=request.cpu_limit_percent,
            ram_limit_mb=request.ram_limit_mb,
            node_id=request.node_id,
        )
        session.add(server)
        session.flush()
        task.server_id = server.id
        task.status = "succeeded"
        task.phase = "completed"
        session.commit()
        session.refresh(server)
        session.refresh(task)
        return ProvisioningResult(
            server=server, task=task, postgres_credentials=[]
        )

    return _provision


def _role(db: Session, name: str, *, keys: tuple[str, ...] = ()) -> Role:
    role = Role(name=name, is_system=False)
    db.add(role)
    db.flush()
    for key in keys:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    db.refresh(role)
    return role


def _create_plan(
    client: TestClient, owner_cookies: dict, csrf_token: str, **overrides
) -> dict:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld {uuid4().hex[:8]}",
        "price_cents": 699,
        "currency": "EUR",
        "billing_interval": "month",
        "tax_rate_percent": 19,
        "ram_included_mb": 8192,
        "ram_max_mb": 16384,
        "ram_step_mb": 1024,
        "price_per_ram_step_cents": 90,
        "cpu_included": 2,
        "cpu_max": 4,
        "cpu_step": 1,
        "price_per_cpu_step_cents": 150,
        "slots_included": 8,
        "slots_max": 32,
        "slots_step": 1,
        "price_per_slot_step_cents": 30,
        "artwork_mode": "steam",
        "active": True,
    }
    payload.update(overrides)
    res = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=payload,
    )
    assert res.status_code == 200, res.text
    return res.json()


def _create_order(
    client: TestClient, user_cookies: dict, user_csrf_token: str, plan_id: int
) -> dict:
    res = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan_id, "months": 1},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _sign_stripe(payload: bytes) -> str:
    t = int(time.time())
    digest = hmac.new(
        WEBHOOK_SECRET.encode(), f"{t}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return f"t={t},v1={digest}"


def _login(client: TestClient, username: str, password: str) -> dict:
    res = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert res.status_code == 200, res.text
    return dict(res.cookies)


class TestShopProvisioningAndIsolation:
    def test_demo_pay_provisions_server_and_grants_customer_permissions(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])
        calls: list[dict] = []

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(calls),
        ):
            paid = client.post(
                f"/api/shop/orders/{order['id']}/demo-pay",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            )
            assert paid.status_code == 200, paid.text
            # Idempotenz: zweiter Aufruf darf keinen zweiten Server anlegen.
            again = client.post(
                f"/api/shop/orders/{order['id']}/demo-pay",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            )
            assert again.status_code == 200

        assert len(calls) == 1
        req = calls[0]["request"]
        assert req.game_type == "palworld"
        assert req.ram_limit_mb == 8192
        assert req.cpu_limit_percent == 200
        assert calls[0]["origin"] == "system"
        assert calls[0]["idempotency_key"].startswith("shop-entitlement-")

        ents = client.get("/api/shop/entitlements", cookies=user_cookies).json()
        assert len(ents) == 1
        assert ents[0]["provisioning_status"] == "ready"
        server_id = ents[0]["server_id"]
        assert server_id is not None

        perms = {
            row.permission_key
            for row in db.query(ServerPermission)
            .filter(
                ServerPermission.user_id == regular_user.id,
                ServerPermission.server_id == server_id,
            )
            .all()
        }
        assert perms == set(CUSTOMER_SERVER_PERMISSIONS)

        # Kunde darf seinen eigenen Server sehen.
        eigen = client.get(f"/api/servers/{server_id}", cookies=user_cookies)
        assert eigen.status_code == 200

        # Fremder Benutzer ohne Rechte wird abgewiesen (404 gegen ID-Enumeration).
        fremd_user = AuthService.create_user(
            db, "other-customer", "other@test.de", "OtherPass123!"
        )
        fremd_user.email_verified = True
        db.commit()
        fremd_cookies = _login(client, "other-customer", "OtherPass123!")
        assert client.get(f"/api/servers/{server_id}", cookies=fremd_cookies).status_code in (403, 404)

        # Mitarbeiter mit pauschalem server.view (ohne servers.hoster_customers.view)
        # darf den Shop-Kundenserver ebenfalls weder listen noch oeffnen.
        staff_role = _role(db, f"staff-{uuid4().hex[:6]}", keys=("server.view",))
        staff = AuthService.create_user(
            db, "staff-no-cust", "staff@test.de", "StaffPass123!"
        )
        staff.email_verified = True
        db.commit()
        role_service.set_user_roles(db, staff, [staff_role.id])
        staff_cookies = _login(client, "staff-no-cust", "StaffPass123!")
        assert client.get(f"/api/servers/{server_id}", cookies=staff_cookies).status_code in (403, 404)
        listed_ids = {s["id"] for s in client.get("/api/servers", cookies=staff_cookies).json()}
        assert server_id not in listed_ids

        # Mit servers.hoster_customers.view greift das pauschale Recht wieder.
        sup_role = _role(
            db,
            f"sup-{uuid4().hex[:6]}",
            keys=("server.view", "servers.hoster_customers.view"),
        )
        role_service.set_user_roles(db, staff, [sup_role.id])
        assert client.get(f"/api/servers/{server_id}", cookies=staff_cookies).status_code == 200


class TestShopRolesAndEscalation:
    def test_plan_rejects_system_or_admin_roles(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
    ):
        admin_role = role_service.get_role_by_name(db, SYSTEM_ROLE_ADMIN)
        user_role = role_service.get_role_by_name(db, SYSTEM_ROLE_USER)
        priv_role = _role(db, f"priv-{uuid4().hex[:6]}", keys=("users.manage",))
        assert admin_role is not None and user_role is not None

        for forbidden_id in (admin_role.id, user_role.id, priv_role.id):
            res = client.post(
                "/api/shop/plans",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "game_type": "palworld",
                    "name": f"Bad {uuid4().hex[:8]}",
                    "price_cents": 699,
                    "currency": "EUR",
                    "billing_interval": "month",
                    "tax_rate_percent": 19,
                    "role_id": forbidden_id,
                    "artwork_mode": "steam",
                    "active": True,
                },
            )
            assert res.status_code == 422, res.text

    def test_role_entitlement_is_additive_and_respects_coexistence(
        self,
        client: TestClient,
        db: Session,
        owner_user: User,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        manual_role = _role(db, f"manual-{uuid4().hex[:6]}", keys=("notes.use",))
        ai_role = _role(
            db,
            f"ki-pro-{uuid4().hex[:6]}",
            keys=("ai.chat.use", "ai.attachments.use"),
        )
        user_sys = role_service.get_role_by_name(db, SYSTEM_ROLE_USER)
        assert user_sys is not None
        role_service.set_user_roles(db, regular_user, [user_sys.id, manual_role.id])

        plan = _create_plan(
            client, owner_cookies, csrf_token, role_id=ai_role.id
        )
        order1 = _create_order(client, user_cookies, user_csrf_token, plan["id"])
        order2 = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            assert (
                client.post(
                    f"/api/shop/orders/{order1['id']}/demo-pay",
                    cookies=user_cookies,
                    headers={"X-CSRF-Token": user_csrf_token},
                ).status_code
                == 200
            )
            assert (
                client.post(
                    f"/api/shop/orders/{order2['id']}/demo-pay",
                    cookies=user_cookies,
                    headers={"X-CSRF-Token": user_csrf_token},
                ).status_code
                == 200
            )

        db.expire_all()
        db.refresh(regular_user)
        assert set(role_service.effective_user_role_ids(db, regular_user)) == {
            user_sys.id,
            manual_role.id,
            ai_role.id,
        }

        # Erstes Entitlement widerrufen -> zweites haelt die Rolle weiter.
        ent1 = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_id == order1["id"],
                ShopEntitlement.kind == "role",
            )
            .one()
        )
        ent1.status = "revoked"
        db.commit()
        sync1 = client.post(
            f"/api/shop/entitlements/{ent1.id}/sync",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert sync1.status_code == 200
        db.expire_all()
        db.refresh(regular_user)
        assert ai_role.id in role_service.effective_user_role_ids(db, regular_user)

        # Zweites Entitlement widerrufen -> Produktrolle faellt, manuelle & user bleiben.
        ent2 = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_id == order2["id"],
                ShopEntitlement.kind == "role",
            )
            .one()
        )
        ent2.status = "revoked"
        db.commit()
        sync2 = client.post(
            f"/api/shop/entitlements/{ent2.id}/sync",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert sync2.status_code == 200
        db.expire_all()
        db.refresh(regular_user)
        assert set(role_service.effective_user_role_ids(db, regular_user)) == {
            user_sys.id,
            manual_role.id,
        }

    def test_escalated_role_is_blocked_during_fulfillment(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        ai_role = _role(db, f"ki-esk-{uuid4().hex[:6]}", keys=("ai.chat.use",))
        plan = _create_plan(
            client, owner_cookies, csrf_token, role_id=ai_role.id
        )
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        # Nachtraegliche Rechte-Eskalation der Rolle in der DB.
        db.add(RolePermission(role_id=ai_role.id, permission_key="servers.delete"))
        db.commit()

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ):
            paid = client.post(
                f"/api/shop/orders/{order['id']}/demo-pay",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            )
            assert paid.status_code == 200

        db.expire_all()
        db.refresh(regular_user)
        assert ai_role.id not in role_service.effective_user_role_ids(db, regular_user)
        role_ent = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_id == order["id"],
                ShopEntitlement.kind == "role",
            )
            .one()
        )
        assert role_ent.provisioning_status == "failed"
        assert role_ent.provisioning_error == "shop_role_escalation"


class TestShopStripeLifecycleAndRetry:
    def test_stripe_lifecycle_suspends_reactivates_and_revokes(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        stripe_settings_service.set_secret_key("sk_test_placeholder_not_real")
        stripe_settings_service.set_webhook_secret(WEBHOOK_SECRET)
        ai_role = _role(db, f"ki-sub-{uuid4().hex[:6]}", keys=("ai.chat.use",))
        plan = _create_plan(
            client, owner_cookies, csrf_token, role_id=ai_role.id
        )
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        checkout_evt = json.dumps(
            {
                "id": "evt_life_checkout",
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_life_1",
                        "subscription": "sub_life_1",
                        "payment_status": "paid",
                        "metadata": {"order_id": str(order["id"])},
                    }
                },
            }
        ).encode()

        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(),
        ), patch(
            "services.server_action_service.request_lifecycle_operation",
            return_value={"status": "queued", "operation": "stop", "task_id": "t-1"},
        ) as mock_stop:
            res = client.post(
                "/api/shop/stripe/webhook",
                content=checkout_evt,
                headers={"Stripe-Signature": _sign_stripe(checkout_evt)},
            )
            assert res.status_code == 200, res.text

            db.expire_all()
            srv_ent = (
                db.query(ShopEntitlement)
                .filter(
                    ShopEntitlement.order_id == order["id"],
                    ShopEntitlement.kind == "server",
                )
                .one()
            )
            server_id = srv_ent.server_id
            assert server_id is not None
            assert srv_ent.provisioning_status == "ready"
            assert ai_role.id in role_service.effective_user_role_ids(db, regular_user)

            # unpaid -> Server stoppen, Rechte & Rolle entziehen, Server bleibt.
            unpaid_evt = json.dumps(
                {
                    "id": "evt_life_unpaid",
                    "type": "customer.subscription.updated",
                    "data": {
                        "object": {
                            "id": "sub_life_1",
                            "status": "unpaid",
                            "current_period_end": int(time.time()) + 86400,
                        }
                    },
                }
            ).encode()
            assert (
                client.post(
                    "/api/shop/stripe/webhook",
                    content=unpaid_evt,
                    headers={"Stripe-Signature": _sign_stripe(unpaid_evt)},
                ).status_code
                == 200
            )
            db.expire_all()
            db.refresh(srv_ent)
            assert srv_ent.provisioning_status == "suspended"
            assert mock_stop.call_count == 1
            assert (
                db.query(ServerPermission)
                .filter(
                    ServerPermission.user_id == regular_user.id,
                    ServerPermission.server_id == server_id,
                )
                .count()
                == 0
            )
            assert ai_role.id not in role_service.effective_user_role_ids(db, regular_user)
            assert db.query(Server).filter(Server.id == server_id).first() is not None

            # invoice.paid -> reaktiviert ohne zweiten Server.
            paid_evt = json.dumps(
                {
                    "id": "evt_life_paid",
                    "type": "invoice.paid",
                    "data": {
                        "object": {
                            "subscription": "sub_life_1",
                            "lines": {
                                "data": [
                                    {
                                        "period": {
                                            "start": int(time.time()),
                                            "end": int(time.time()) + 60 * 86400,
                                        }
                                    }
                                ]
                            },
                        }
                    },
                }
            ).encode()
            assert (
                client.post(
                    "/api/shop/stripe/webhook",
                    content=paid_evt,
                    headers={"Stripe-Signature": _sign_stripe(paid_evt)},
                ).status_code
                == 200
            )
            db.expire_all()
            db.refresh(srv_ent)
            assert srv_ent.provisioning_status == "ready"
            assert srv_ent.server_id == server_id
            assert db.query(Server).filter(Server.id == server_id).first() is not None
            assert (
                db.query(ServerPermission)
                .filter(
                    ServerPermission.user_id == regular_user.id,
                    ServerPermission.server_id == server_id,
                )
                .count()
                == len(CUSTOMER_SERVER_PERMISSIONS)
            )
            assert ai_role.id in role_service.effective_user_role_ids(db, regular_user)

            # subscription.deleted -> revoked, Rechte/Rolle entzogen, Server bleibt.
            del_evt = json.dumps(
                {
                    "id": "evt_life_deleted",
                    "type": "customer.subscription.deleted",
                    "data": {
                        "object": {
                            "id": "sub_life_1",
                            "status": "canceled",
                            "current_period_end": int(time.time()),
                        }
                    },
                }
            ).encode()
            assert (
                client.post(
                    "/api/shop/stripe/webhook",
                    content=del_evt,
                    headers={"Stripe-Signature": _sign_stripe(del_evt)},
                ).status_code
                == 200
            )
            db.expire_all()
            db.refresh(srv_ent)
            assert srv_ent.provisioning_status == "revoked"
            assert mock_stop.call_count == 2
            assert db.query(Server).filter(Server.id == server_id).first() is not None
            assert ai_role.id not in role_service.effective_user_role_ids(db, regular_user)

    def test_failed_provisioning_does_not_lose_payment_and_retries_via_admin(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        plan = _create_plan(client, owner_cookies, csrf_token)
        order = _create_order(client, user_cookies, user_csrf_token, plan["id"])

        def failing_provision(
            session: Session,
            request,
            actor,
            *,
            idempotency_key: str | None = None,
            retry_of_id: str | None = None,
        ):
            task, _ = create_or_reuse_task(
                session,
                actor=actor,
                task_type=TASK_SERVER_PROVISION,
                request_hash=hashlib.sha256(
                    json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()
                ).hexdigest(),
                idempotency_key=idempotency_key,
                retry_of_id=retry_of_id,
            )
            task.status = "failed"
            task.error_code = "port_conflict"
            session.commit()
            raise HTTPException(
                status_code=400,
                detail={"code": "port_conflict", "message": "errors.port_conflict"},
            )

        with patch(
            "services.server_provisioning_service.provision_server",
            failing_provision,
        ):
            paid = client.post(
                f"/api/shop/orders/{order['id']}/demo-pay",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            )
            assert paid.status_code == 200
            assert paid.json()["status"] == "paid"

        ents = client.get("/api/shop/entitlements", cookies=user_cookies).json()
        assert ents[0]["provisioning_status"] == "failed"
        assert ents[0]["provisioning_error"] == "port_conflict"
        assert ents[0]["server_id"] is None
        ent_id = ents[0]["id"]

        # Unberechtigte User und fehlendes CSRF werden abgewiesen.
        assert (
            client.post(
                f"/api/shop/entitlements/{ent_id}/sync",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"/api/shop/entitlements/{ent_id}/sync",
                cookies=owner_cookies,
            ).status_code
            == 403
        )

        # Admin-Retry nach behobener Stoerung.
        calls: list[dict] = []
        with patch(
            "services.server_provisioning_service.provision_server",
            _fake_provision(calls),
        ):
            retried = client.post(
                f"/api/shop/entitlements/{ent_id}/sync",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert retried.status_code == 200, retried.text
            body = retried.json()
            assert body["provisioning_status"] == "ready"
            assert body["provisioning_error"] is None
            assert body["server_id"] is not None

        assert len(calls) == 1
        assert calls[0]["retry_of_id"] is not None

        # Unbekannte ID liefert 404.
        assert (
            client.post(
                "/api/shop/entitlements/999999/sync",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            ).status_code
            == 404
        )
