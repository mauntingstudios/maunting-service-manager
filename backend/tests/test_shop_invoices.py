"""Rechnungs-Ledger: Nummernkreis, XRechnung-XML, PDF und Sichtbarkeit."""

from __future__ import annotations

import hashlib
import io
from datetime import datetime, timezone
from uuid import uuid4
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
from pypdf import PdfReader
from sqlalchemy.orm import Session

from services import shop_seller_settings_service

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
    "buyer_name": "Max Testkunde",
    "buyer_street": "Kundenweg 7",
    "buyer_postal_code": "54321",
    "buyer_city": "Kundenstadt",
    "buyer_country": "DE",
    "buyer_email": "kunde@example.invalid",
}


def _configure_seller(**overrides) -> None:
    shop_seller_settings_service.update({**SELLER, **overrides})


def _plan(client: TestClient, owner_cookies: dict, csrf_token: str, **overrides) -> dict:
    payload = {
        "game_type": "palworld",
        "name": f"Palworld Rechnung {uuid4().hex[:8]}",
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


def _buy_and_pay(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
    **buyer,
) -> dict:
    plan = _plan(client, owner_cookies, csrf_token)
    order = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"plan_id": plan["id"], "months": 1, **BUYER, **buyer},
    )
    assert order.status_code == 200, order.text
    bezahlt = client.post(
        f"/api/shop/orders/{order.json()['id']}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert bezahlt.status_code == 200, bezahlt.text
    return order.json()


class TestInvoiceLedger:
    def test_payment_creates_xrechnung_and_pdf(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str, db: Session,
    ):
        _configure_seller()
        order = _buy_and_pay(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )

        liste = client.get("/api/shop/invoices", cookies=user_cookies)
        assert liste.status_code == 200, liste.text
        assert len(liste.json()) == 1
        rechnung = liste.json()[0]
        assert rechnung["number"] == f"RE-{datetime.now(timezone.utc).year}-0001"
        assert rechnung["order_number"] == order["number"]
        assert rechnung["gross_cents"] == order["gross_cents"]
        assert rechnung["status"] == "issued"

        detail = client.get(
            f"/api/shop/invoices/{rechnung['id']}", cookies=user_cookies
        )
        assert detail.status_code == 200
        assert detail.json()["buyer_name"] == BUYER["buyer_name"]
        assert detail.json()["seller_vat_id"] == SELLER["vat_id"]
        assert len(detail.json()["lines"]) == 1

        xml_res = client.get(
            f"/api/shop/invoices/{rechnung['id']}/xml", cookies=user_cookies
        )
        assert xml_res.status_code == 200
        assert xml_res.headers["content-type"].startswith("application/xml")
        xml_text = xml_res.text
        assert "urn:xeinkauf.de:kosit:xrechnung_3.0" in xml_text
        wurzel = ET.fromstring(xml_text)
        ns = {
            "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
            "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        }
        assert wurzel.findtext("cbc:ID", namespaces=ns) == rechnung["number"]
        assert wurzel.findtext("cbc:BuyerReference", namespaces=ns) == order["number"]
        assert wurzel.findtext("cbc:InvoiceTypeCode", namespaces=ns) == "380"
        assert wurzel.findtext("cbc:DocumentCurrencyCode", namespaces=ns) == "EUR"
        payable = wurzel.find("cac:LegalMonetaryTotal/cbc:PayableAmount", ns)
        assert payable is not None and payable.text == f"{order['gross_cents'] / 100:.2f}"

        pdf_res = client.get(
            f"/api/shop/invoices/{rechnung['id']}/pdf", cookies=user_cookies
        )
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF-1.4")
        text = PdfReader(io.BytesIO(pdf_res.content)).pages[0].extract_text()
        assert rechnung["number"] in text
        assert "Rechnung" in text

        gespeichert = client.get(
            f"/api/shop/invoices/{rechnung['id']}", cookies=user_cookies
        ).json()
        assert gespeichert["id"] == rechnung["id"]
        assert hashlib.sha256(xml_text.encode("utf-8")).hexdigest()

    def test_numbers_are_sequential(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _configure_seller()
        _buy_and_pay(client, owner_cookies, csrf_token, user_cookies, user_csrf_token)
        _buy_and_pay(client, owner_cookies, csrf_token, user_cookies, user_csrf_token)

        nummern = [
            eintrag["number"]
            for eintrag in client.get("/api/shop/invoices", cookies=user_cookies).json()
        ]
        jahr = datetime.now(timezone.utc).year
        assert sorted(nummern) == [f"RE-{jahr}-0001", f"RE-{jahr}-0002"]

    def test_missing_seller_data_creates_no_invoice(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _buy_and_pay(client, owner_cookies, csrf_token, user_cookies, user_csrf_token)
        assert client.get("/api/shop/invoices", cookies=user_cookies).json() == []

    def test_missing_buyer_address_creates_no_invoice(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _configure_seller()
        _buy_and_pay(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token,
            buyer_street="",
        )
        assert client.get("/api/shop/invoices", cookies=user_cookies).json() == []

    def test_foreign_invoice_is_invisible(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        _configure_seller()
        _buy_and_pay(client, owner_cookies, csrf_token, user_cookies, user_csrf_token)
        rechnung = client.get("/api/shop/invoices", cookies=user_cookies).json()[0]

        assert (
            client.get(f"/api/shop/invoices/{rechnung['id']}", cookies=owner_cookies).status_code
            == 404
        )
        assert (
            client.get(
                f"/api/shop/invoices/{rechnung['id']}/pdf", cookies=owner_cookies
            ).status_code
            == 404
        )


class TestSellerSettings:
    def test_owner_sets_and_reads_seller_data(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ):
        leer = client.get("/api/shop/seller", cookies=owner_cookies).json()
        assert "name" in leer["missing_fields"]

        res = client.put(
            "/api/shop/seller",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json=SELLER,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["missing_fields"] == []
        assert body["vat_id"] == "DE123456789"
        assert body["country"] == "DE"

    def test_regular_user_cannot_change_seller_data(
        self, client: TestClient, user_cookies: dict, user_csrf_token: str
    ):
        res = client.put(
            "/api/shop/seller",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json=SELLER,
        )
        assert res.status_code == 403


class TestCreditNote:
    def _rechnung(
        self, client, owner_cookies, csrf_token, user_cookies, user_csrf_token
    ) -> dict:
        _configure_seller()
        _buy_and_pay(client, owner_cookies, csrf_token, user_cookies, user_csrf_token)
        return client.get("/api/shop/invoices", cookies=user_cookies).json()[0]

    def test_credit_note_voids_invoice_and_references_it(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        rechnung = self._rechnung(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )
        res = client.post(
            f"/api/shop/invoices/{rechnung['id']}/credit",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"reason": "Kulanz nach Supportfall"},
        )
        assert res.status_code == 200, res.text
        gutschrift = res.json()
        assert gutschrift["type"] == "credit_note"
        assert gutschrift["reference_invoice_id"] == rechnung["id"]
        assert gutschrift["reason"] == "Kulanz nach Supportfall"
        jahr = datetime.now(timezone.utc).year
        assert gutschrift["number"] == f"GS-{jahr}-0001"

        original = client.get(
            f"/api/shop/invoices/{rechnung['id']}", cookies=user_cookies
        ).json()
        assert original["status"] == "void"

        liste = client.get("/api/shop/invoices", cookies=user_cookies).json()
        assert {eintrag["type"] for eintrag in liste} == {"invoice", "credit_note"}

        xml_res = client.get(
            f"/api/shop/invoices/{gutschrift['id']}/xml", cookies=user_cookies
        )
        assert xml_res.status_code == 200
        xml_text = xml_res.text
        assert "CreditNote-2" in xml_text
        wurzel = ET.fromstring(xml_text)
        ns = {
            "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
            "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        }
        assert wurzel.tag.endswith("CreditNote")
        assert wurzel.findtext("cbc:CreditNoteTypeCode", namespaces=ns) == "381"
        assert wurzel.findtext("cac:Delivery/cbc:ActualDeliveryDate", namespaces=ns) is not None
        bezug = wurzel.find(
            "cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID", ns
        )
        assert bezug is not None and bezug.text == rechnung["number"]

        pdf_res = client.get(
            f"/api/shop/invoices/{gutschrift['id']}/pdf", cookies=user_cookies
        )
        assert pdf_res.status_code == 200
        text = PdfReader(io.BytesIO(pdf_res.content)).pages[0].extract_text()
        assert "Gutschrift" in text
        assert "Leistungsdatum:" in text
        assert rechnung["number"] in text

    def test_second_credit_is_rejected(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        rechnung = self._rechnung(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )
        erste = client.post(
            f"/api/shop/invoices/{rechnung['id']}/credit",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"reason": "Erste Gutschrift"},
        )
        assert erste.status_code == 200
        zweite = client.post(
            f"/api/shop/invoices/{rechnung['id']}/credit",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"reason": "Zweite Gutschrift"},
        )
        assert zweite.status_code == 409

    def test_regular_user_cannot_credit(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        rechnung = self._rechnung(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )
        res = client.post(
            f"/api/shop/invoices/{rechnung['id']}/credit",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"reason": "Unbefugt"},
        )
        assert res.status_code == 403

    def test_credit_requires_reason(
        self, client: TestClient, owner_cookies: dict, csrf_token: str,
        user_cookies: dict, user_csrf_token: str,
    ):
        rechnung = self._rechnung(
            client, owner_cookies, csrf_token, user_cookies, user_csrf_token
        )
        res = client.post(
            f"/api/shop/invoices/{rechnung['id']}/credit",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"reason": "x"},
        )
        assert res.status_code == 422
