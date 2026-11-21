"""Betriebspruefungs-Export, Panel-Admin-Endpunkte und Server-Abo-Zuordnung."""

from __future__ import annotations

import csv
import hashlib
import io
import json
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Server, ShopEntitlement
from services import shop_seller_settings_service
from services.operation_task_service import TASK_SERVER_PROVISION, create_or_reuse_task
from services.server_provisioning_service import ProvisioningResult


SELLER = {
    "name": "Maunting Studios Test",
    "street": "Teststrasse 1",
    "postal_code": "12345",
    "city": "Teststadt",
    "country": "DE",
    "email": "rechnung@example.invalid",
    "phone": "+49 123 456",
    "vat_id": "DE123456789",
    "tax_number": "",
    "iban": "DE02120300000000202051",
    "bic": "BYLADEM1001",
    "payment_terms_days": 14,
    "invoice_prefix": "RE",
    "small_business": False,
}

BUYER = {
    "buyer_name": "=SUM(1,2)",
    "buyer_street": "Kundenweg 7",
    "buyer_postal_code": "54321",
    "buyer_city": "Kundenstadt",
    "buyer_country": "DE",
    "buyer_email": "kunde@example.invalid",
}


def _fake_provision():
    def _provision(
        session: Session,
        request,
        actor,
        *,
        idempotency_key: str | None = None,
        retry_of_id: str | None = None,
    ) -> ProvisioningResult:
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


def _create_paid_order(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
) -> dict:
    plan = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "game_type": "palworld",
            "name": f"Palworld Export {uuid4().hex[:8]}",
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
        },
    )
    assert plan.status_code == 200, plan.text
    order = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan.json()["id"], "months": 1, **BUYER},
    )
    assert order.status_code == 200, order.text
    with patch(
        "services.server_provisioning_service.provision_server",
        _fake_provision(),
    ):
        paid = client.post(
            f"/api/shop/orders/{order.json()['id']}/demo-pay",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
    assert paid.status_code == 200, paid.text
    return paid.json()


class TestAuditExport:
    def test_audit_export_zip_contains_csv_manifest_pdfs_xml_and_protects_csv_injection(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        shop_seller_settings_service.update(SELLER)
        order = _create_paid_order(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )
        with patch(
            "services.server_action_service.request_lifecycle_operation",
            return_value={"status": "queued", "operation": "stop", "task_id": "t-exp"},
        ):
            assert (
                client.post(
                    f"/api/shop/orders/{order['id']}/refund",
                    cookies=owner_cookies,
                    headers={"X-CSRF-Token": csrf_token},
                    json={"reason": "Pruefung Gutschrift"},
                ).status_code
                == 200
            )

        res = client.get("/api/shop/invoices/export", cookies=owner_cookies)
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/zip")

        with ZipFile(io.BytesIO(res.content)) as zf:
            names = set(zf.namelist())
            assert "index.csv" in names
            assert "manifest.json" in names

            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            assert manifest["count"] == 2
            assert manifest["totals"]["invoice"]["count"] == 1
            assert manifest["totals"]["credit_note"]["count"] == 1

            for doc in manifest["documents"]:
                assert doc["pdf_file"] in names
                assert doc["xml_file"] in names
                assert (
                    hashlib.sha256(zf.read(doc["pdf_file"])).hexdigest()
                    == doc["pdf_sha256"]
                )
                assert (
                    hashlib.sha256(zf.read(doc["xml_file"])).hexdigest()
                    == doc["xml_sha256"]
                )

            rows = list(csv.DictReader(io.StringIO(zf.read("index.csv").decode("utf-8"))))
            assert len(rows) == 2
            # CSV-Formula-Injection-Schutz greift auf =SUM(1,2).
            assert rows[0]["buyer_name"] == "'=SUM(1,2)"

        # Jahresfilter: vergangenes Jahr ohne Belege liefert leeres gueltiges Archiv.
        leer = client.get("/api/shop/invoices/export?year=2020", cookies=owner_cookies)
        assert leer.status_code == 200
        with ZipFile(io.BytesIO(leer.content)) as zf_leer:
            manifest_leer = json.loads(zf_leer.read("manifest.json").decode("utf-8"))
            assert manifest_leer["count"] == 0

    def test_audit_export_negative_cases(
        self,
        client: TestClient,
        owner_cookies: dict,
        user_cookies: dict,
    ):
        assert (
            client.get("/api/shop/invoices/export", cookies=user_cookies).status_code
            == 403
        )
        assert (
            client.get(
                "/api/shop/invoices/export?year=1800", cookies=owner_cookies
            ).status_code
            == 422
        )


class TestShopAdminViewsAndServerCard:
    def test_admin_endpoints_list_orders_invoices_webhooks_and_block_regular_users(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
    ):
        shop_seller_settings_service.update(SELLER)
        order = _create_paid_order(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )

        # Unberechtigte Zugriffe -> 403.
        for path in (
            "/api/shop/admin/orders",
            "/api/shop/admin/invoices",
            "/api/shop/admin/webhooks",
        ):
            assert client.get(path, cookies=user_cookies).status_code == 403

        admin_orders = client.get("/api/shop/admin/orders", cookies=owner_cookies)
        assert admin_orders.status_code == 200
        assert len(admin_orders.json()) == 1
        assert admin_orders.json()[0]["id"] == order["id"]
        assert admin_orders.json()[0]["username"] == "user1"
        assert len(admin_orders.json()[0]["entitlements"]) == 1

        admin_invoices = client.get("/api/shop/admin/invoices", cookies=owner_cookies)
        assert admin_invoices.status_code == 200
        assert len(admin_invoices.json()) == 1
        inv_id = admin_invoices.json()[0]["id"]

        assert (
            client.get(
                f"/api/shop/admin/invoices/{inv_id}/pdf", cookies=owner_cookies
            ).status_code
            == 200
        )
        assert (
            client.get(
                f"/api/shop/admin/invoices/{inv_id}/xml", cookies=owner_cookies
            ).status_code
            == 200
        )
        assert (
            client.get(
                "/api/shop/admin/invoices/999999/pdf", cookies=owner_cookies
            ).status_code
            == 404
        )
        assert (
            client.get(
                "/api/shop/admin/invoices/999999/xml", cookies=owner_cookies
            ).status_code
            == 404
        )
        assert (
            client.get(
                f"/api/shop/admin/invoices/{inv_id}/pdf", cookies=user_cookies
            ).status_code
            == 403
        )

        webhooks = client.get("/api/shop/admin/webhooks", cookies=owner_cookies)
        assert webhooks.status_code == 200
        assert webhooks.json() == []

    def test_server_subscription_endpoint_positive_and_negative(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        test_server: Server,
    ):
        order = _create_paid_order(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )
        ent = (
            db.query(ShopEntitlement)
            .filter(
                ShopEntitlement.order_id == order["id"],
                ShopEntitlement.kind == "server",
            )
            .one()
        )
        assert ent.server_id is not None

        # Kunde sieht seinen Shop-Server samt Abo & Ressourcen.
        res = client.get(
            f"/api/shop/servers/{ent.server_id}/subscription", cookies=user_cookies
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["has_subscription"] is True
        assert body["subscription"]["status"] == "active"
        assert body["ram_mb"] == 8192
        assert body["slots"] == 8

        # Manueller Server ohne Shop-Abo -> has_subscription=False fuer Owner.
        manuell = client.get(
            f"/api/shop/servers/{test_server.id}/subscription", cookies=owner_cookies
        )
        assert manuell.status_code == 200
        assert manuell.json()["has_subscription"] is False

        # Fremder User ohne server.view -> 404 gegen ID-Enumeration.
        assert (
            client.get(
                f"/api/shop/servers/{test_server.id}/subscription", cookies=user_cookies
            ).status_code
            == 404
        )
