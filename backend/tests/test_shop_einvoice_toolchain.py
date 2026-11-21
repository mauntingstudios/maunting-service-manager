"""Tests fuer Factur-X CII, PDF/A-3b, KoSIT-Validator & veraPDF-Toolchain."""

from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from models import ShopInvoice, ShopInvoiceLine
from scripts import fetch_einvoice_toolchain as downloader
from services import (
    shop_einvoice_toolchain_service as toolchain,
    shop_invoice_xml,
    shop_seller_settings_service,
)


def _sample_invoice(*, small_business: bool = False) -> ShopInvoice:
    return ShopInvoice(
        id=42,
        number="RE-2026-0042",
        order_id=9,
        user_id=7,
        type="invoice",
        status="issued",
        issued_at=datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc),
        due_date=date(2026, 12, 5),
        currency="EUR",
        buyer_reference="ORD-2026-0009",
        seller_name="Maunting Studios Test GmbH",
        seller_street="Teststrasse 1",
        seller_postal_code="12345",
        seller_city="Berlin",
        seller_country="DE",
        seller_email="billing@example.invalid",
        seller_phone="+49 30 123456",
        seller_vat_id="" if small_business else "DE123456789",
        seller_tax_number="12/345/67890" if small_business else "",
        seller_iban="DE02120300000000202051",
        seller_bic="BYLADEM1001",
        small_business=small_business,
        buyer_name="Max Musterkunde",
        buyer_street="Kundenweg 7",
        buyer_postal_code="54321",
        buyer_city="Hamburg",
        buyer_country="DE",
        buyer_email="kunde@example.invalid",
        net_cents=1000,
        tax_cents=0 if small_business else 190,
        gross_cents=1000 if small_business else 1190,
        xml_text="",
        xml_sha256="",
        pdf_bytes=b"",
        pdf_sha256="",
    )


def _sample_lines(*, small_business: bool = False) -> list[ShopInvoiceLine]:
    return [
        ShopInvoiceLine(
            position=1,
            description="Palworld 8 GB (1 Monat)",
            quantity=1,
            unit_code="C62",
            unit_price_cents=1000,
            line_net_cents=1000,
            tax_rate_percent=0 if small_business else 19,
            tax_category="E" if small_business else "S",
        )
    ]


def _setup_fake_tools(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    tools = tmp_path / "einvoice-tools"
    (tools / "kosit" / "config").mkdir(parents=True)
    (tools / "verapdf").mkdir(parents=True)
    (tools / "kosit" / downloader.KOSIT_VALIDATOR_FILENAME).write_bytes(b"jar")
    (tools / "kosit" / "config" / "scenarios.xml").write_text("<scenarios/>", encoding="utf-8")
    (tools / "verapdf" / "verapdf").write_text("#!/bin/sh\n", encoding="utf-8")
    (tools / "srgb.icc").write_bytes(b"fake-icc")
    (tools / ".toolchain-version").write_text(downloader.TARGET_MARKER + "\n", encoding="utf-8")
    monkeypatch.setenv("MSM_EINVOICE_TOOLS_DIR", str(tools))
    return tools


def _seller_configure() -> None:
    shop_seller_settings_service.update(
        {
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
    )


def _create_paid_order(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
) -> None:
    plan_res = client.post(
        "/api/shop/plans",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "game_type": "palworld",
            "name": f"Palworld Toolchain {uuid4().hex[:8]}",
            "price_cents": 999,
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
    assert plan_res.status_code == 200, plan_res.text
    order_res = client.post(
        "/api/shop/orders",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={
            "plan_id": plan_res.json()["id"],
            "months": 1,
            "buyer_name": "Max Testkunde",
            "buyer_street": "Kundenweg 7",
            "buyer_postal_code": "54321",
            "buyer_city": "Kundenstadt",
            "buyer_country": "DE",
            "buyer_email": "kunde@example.invalid",
        },
    )
    assert order_res.status_code == 200, order_res.text
    pay_res = client.post(
        f"/api/shop/orders/{order_res.json()['id']}/demo-pay",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
    )
    assert pay_res.status_code == 200, pay_res.text


class TestDownloaderPinningAndSafety:
    def test_verify_sha256_accepts_match_and_rejects_mismatch(self, tmp_path: Path) -> None:
        sample = tmp_path / "payload.bin"
        sample.write_bytes(b"kosit-verapdf-payload")
        expected = hashlib.sha256(b"kosit-verapdf-payload").hexdigest()

        downloader.verify_sha256(sample, expected)

        with pytest.raises(ValueError, match="SHA-256-Abweichung"):
            downloader.verify_sha256(sample, "0" * 64)

    def test_safe_extract_zip_allows_clean_archive_and_blocks_traversal_and_symlinks(
        self, tmp_path: Path
    ) -> None:
        clean_zip = tmp_path / "clean.zip"
        with zipfile.ZipFile(clean_zip, "w") as zf:
            zf.writestr("scenarios.xml", "<scenarios/>")
            zf.writestr("sub/rules.xsl", "<xsl/>")

        out = tmp_path / "out"
        downloader.safe_extract_zip(clean_zip, out)
        assert (out / "scenarios.xml").read_text(encoding="utf-8") == "<scenarios/>"
        assert (out / "sub" / "rules.xsl").read_text(encoding="utf-8") == "<xsl/>"

        for bad_name in ("../escape.txt", "/etc/passwd", "C:/windows/evil.txt"):
            bad_zip = tmp_path / "bad.zip"
            with zipfile.ZipFile(bad_zip, "w") as zf:
                zf.writestr(bad_name, "evil")
            with pytest.raises(ValueError):
                downloader.safe_extract_zip(bad_zip, tmp_path / "bad_out")

        symlink_zip = tmp_path / "symlink.zip"
        with zipfile.ZipFile(symlink_zip, "w") as zf:
            info = zipfile.ZipInfo("link.txt")
            info.external_attr = (0o120777) << 16
            zf.writestr(info, "/etc/passwd")
        with pytest.raises(ValueError, match="Symlink"):
            downloader.safe_extract_zip(symlink_zip, tmp_path / "sym_out")

    def test_is_complete_and_offline_fallback(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        tools = _setup_fake_tools(tmp_path, monkeypatch)
        assert downloader.is_complete(tools) is True

        (tools / ".toolchain-version").write_text("outdated\n", encoding="utf-8")
        assert downloader.is_complete(tools) is False

        (tools / ".toolchain-version").write_text(downloader.TARGET_MARKER + "\n", encoding="utf-8")
        (tools / "verapdf" / "verapdf").unlink()
        assert downloader.is_complete(tools) is False

        monkeypatch.setattr(shutil, "which", lambda _name: None)
        assert downloader.main() == 0


class TestFacturxCiiXml:
    def test_builds_invoice_and_credit_note_and_small_business_cii(self) -> None:
        ns = {
            "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
            "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
            "udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
        }

        inv = _sample_invoice(small_business=False)
        lines = _sample_lines(small_business=False)
        xml_inv = shop_invoice_xml.build_facturx_cii_xml(inv, lines)
        root_inv = ET.fromstring(xml_inv)
        assert (
            root_inv.findtext(
                "rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID",
                namespaces=ns,
            )
            == "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
        )
        assert root_inv.findtext("rsm:ExchangedDocument/ram:TypeCode", namespaces=ns) == "380"
        assert (
            root_inv.findtext(
                "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/"
                "ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount",
                namespaces=ns,
            )
            == "11.90"
        )

        xml_credit = shop_invoice_xml.build_facturx_cii_xml(
            inv, lines, original_number="RE-2026-0001"
        )
        root_credit = ET.fromstring(xml_credit)
        assert root_credit.findtext("rsm:ExchangedDocument/ram:TypeCode", namespaces=ns) == "381"
        assert (
            root_credit.findtext(
                "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/"
                "ram:InvoiceReferencedDocument/ram:IssuerAssignedID",
                namespaces=ns,
            )
            == "RE-2026-0001"
        )
        assert (
            root_credit.find(
                "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/"
                "ram:SpecifiedTradeSettlementPaymentMeans",
                ns,
            )
            is None
        )

        inv_sb = _sample_invoice(small_business=True)
        lines_sb = _sample_lines(small_business=True)
        xml_sb = shop_invoice_xml.build_facturx_cii_xml(inv_sb, lines_sb)
        root_sb = ET.fromstring(xml_sb)
        assert (
            root_sb.findtext(
                "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/"
                "ram:ApplicableTradeTax/ram:CategoryCode",
                namespaces=ns,
            )
            == "E"
        )
        assert "19 UStG" in (
            root_sb.findtext("rsm:ExchangedDocument/ram:IncludedNote/ram:Content", namespaces=ns)
            or ""
        )


class TestToolchainService:
    def test_missing_toolchain_never_claims_compliance(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("MSM_EINVOICE_TOOLS_DIR", str(tmp_path / "missing"))
        monkeypatch.setattr(toolchain, "find_ghostscript", lambda: None)
        monkeypatch.setattr(toolchain, "find_java", lambda: None)

        status = toolchain.toolchain_status()
        assert status["pdfa3_ready"] is False
        assert status["xrechnung_validation_ready"] is False
        assert status["facturx_certified_ready"] is False

        plain_pdf = b"%PDF-1.4\nplain"
        out_pdf, verified = toolchain.build_facturx_pdfa3(
            plain_pdf, "<CrossIndustryInvoice/>", title="RE-2026-1"
        )
        assert out_pdf == plain_pdf
        assert verified is False

        xr = toolchain.validate_xrechnung_xml("<Invoice/>")
        assert xr["available"] is False
        assert xr["valid"] is False

        pa = toolchain.validate_pdfa3(plain_pdf)
        assert pa["available"] is False
        assert pa["valid"] is False

    def test_build_facturx_requires_verapdf_certification(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _setup_fake_tools(tmp_path, monkeypatch)
        monkeypatch.setattr(toolchain, "find_ghostscript", lambda: "/usr/bin/gs")
        monkeypatch.setattr(toolchain, "find_java", lambda: "/usr/bin/java")

        captured_cmds: list[list[str]] = []

        def fake_gs_and_verapdf(
            compliant: bool, *, gs_rc: int = 0, timeout: bool = False
        ):
            def _runner(cmd, **_kwargs):
                captured_cmds.append(list(cmd))
                if cmd[0] == "/usr/bin/gs":
                    if timeout:
                        raise subprocess.TimeoutExpired(cmd=cmd, timeout=45)
                    if gs_rc != 0:
                        return SimpleNamespace(returncode=gs_rc, stdout=b"", stderr=b"gs err")
                    out_arg = next(a for a in cmd if a.startswith("-sOutputFile="))
                    Path(out_arg.split("=", 1)[1]).write_bytes(b"%PDF-1.4\npdfa3-candidate")
                    return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

                mrr_ok = (
                    '<report><jobs><job><validationReport isCompliant="true"/>'
                    "</job></jobs></report>"
                )
                mrr_fail = (
                    '<report><jobs><job><validationReport isCompliant="false">'
                    '<details><rule status="failed" clause="6.2.1" testNumber="1">'
                    "<description>Missing AFRelationship</description></rule></details>"
                    "</validationReport></job></jobs></report>"
                )
                return SimpleNamespace(
                    returncode=0 if compliant else 1,
                    stdout=mrr_ok if compliant else mrr_fail,
                    stderr="",
                )

            return _runner

        plain_pdf = b"%PDF-1.4\nplain"
        monkeypatch.setattr(subprocess, "run", fake_gs_and_verapdf(True))
        out_ok, verified_ok = toolchain.build_facturx_pdfa3(
            plain_pdf, "<CrossIndustryInvoice/>", title="RE-2026-42"
        )
        assert verified_ok is True
        assert out_ok == b"%PDF-1.4\npdfa3-candidate"
        assert "-dPDFA=3" in captured_cmds[0]

        # Negativ: Ghostscript erzeugt Output, veraPDF lehnt Konformitaet ab -> Fallback!
        monkeypatch.setattr(subprocess, "run", fake_gs_and_verapdf(False))
        out_reject, verified_reject = toolchain.build_facturx_pdfa3(
            plain_pdf, "<CrossIndustryInvoice/>", title="RE-2026-42"
        )
        assert verified_reject is False
        assert out_reject == plain_pdf

        # Negativ: Ghostscript Fehler / Timeout -> sauberer Fallback auf Plain-PDF
        monkeypatch.setattr(subprocess, "run", fake_gs_and_verapdf(True, gs_rc=2))
        assert toolchain.build_facturx_pdfa3(
            plain_pdf, "<CrossIndustryInvoice/>", title="RE-2026-42"
        ) == (plain_pdf, False)

        monkeypatch.setattr(subprocess, "run", fake_gs_and_verapdf(True, timeout=True))
        assert toolchain.build_facturx_pdfa3(
            plain_pdf, "<CrossIndustryInvoice/>", title="RE-2026-42"
        ) == (plain_pdf, False)

    def test_kosit_validator_accept_reject_and_timeout(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _setup_fake_tools(tmp_path, monkeypatch)
        monkeypatch.setattr(toolchain, "find_java", lambda: "/usr/bin/java")

        def run_kosit(report_xml: str, returncode: int):
            def _runner(cmd, **_kwargs):
                out_idx = cmd.index("-o") + 1
                Path(cmd[out_idx], "invoice-report.xml").write_text(
                    report_xml, encoding="utf-8"
                )
                return SimpleNamespace(returncode=returncode, stdout="", stderr="")

            return _runner

        accept_xml = (
            '<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1">'
            "<rep:assessment><rep:accept/></rep:assessment></rep:report>"
        )
        monkeypatch.setattr(subprocess, "run", run_kosit(accept_xml, 0))
        res_ok = toolchain.validate_xrechnung_xml("<Invoice/>")
        assert res_ok == {"available": True, "valid": True, "errors": []}

        reject_xml = (
            '<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1">'
            '<rep:assessment><rep:reject/></rep:assessment>'
            '<rep:message level="error" code="BR-DE-1">Fehlende Leitweg-ID</rep:message>'
            "</rep:report>"
        )
        monkeypatch.setattr(subprocess, "run", run_kosit(reject_xml, 1))
        res_bad = toolchain.validate_xrechnung_xml("<Invoice/>")
        assert res_bad["available"] is True
        assert res_bad["valid"] is False
        assert any("BR-DE-1" in msg for msg in res_bad["errors"])

        def _timeout(*_args, **_kwargs):
            raise subprocess.TimeoutExpired(cmd="java", timeout=45)

        monkeypatch.setattr(subprocess, "run", _timeout)
        res_timeout = toolchain.validate_xrechnung_xml("<Invoice/>")
        assert res_timeout["available"] is True
        assert res_timeout["valid"] is False
        assert "Timeout" in res_timeout["errors"][0]

        res_empty = toolchain.validate_xrechnung_xml("   ")
        assert res_empty["available"] is True
        assert res_empty["valid"] is False


class TestEinvoiceToolchainApi:
    def test_admin_toolchain_status_and_invoice_validation_endpoints(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _seller_configure()
        _create_paid_order(client, owner_cookies, csrf_token, user_cookies, user_csrf_token)

        invoices = client.get("/api/shop/invoices", cookies=user_cookies).json()
        assert len(invoices) == 1
        invoice_id = invoices[0]["id"]

        # Zugriffsschutz: normaler Kunde erhaelt 403
        assert (
            client.get("/api/shop/admin/einvoice-toolchain", cookies=user_cookies).status_code
            == 403
        )
        assert (
            client.post(
                f"/api/shop/admin/invoices/{invoice_id}/validate",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 403
        )

        monkeypatch.setattr(
            toolchain,
            "toolchain_status",
            lambda: {
                "ghostscript": True,
                "java": True,
                "kosit_validator": True,
                "kosit_config": True,
                "verapdf": True,
                "srgb_icc": True,
                "pdfa3_ready": True,
                "xrechnung_validation_ready": True,
                "facturx_certified_ready": True,
            },
        )
        status_res = client.get("/api/shop/admin/einvoice-toolchain", cookies=owner_cookies)
        assert status_res.status_code == 200
        assert status_res.json()["facturx_certified_ready"] is True

        monkeypatch.setattr(
            toolchain,
            "validate_xrechnung_xml",
            lambda _xml: {"available": True, "valid": True, "errors": []},
        )
        monkeypatch.setattr(
            toolchain,
            "validate_pdfa3",
            lambda _pdf: {"available": True, "valid": False, "flavour": "3b", "errors": ["Testfehler"]},
        )
        val_res = client.post(
            f"/api/shop/admin/invoices/{invoice_id}/validate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert val_res.status_code == 200
        body = val_res.json()
        assert body["invoice_id"] == invoice_id
        assert body["xrechnung"]["valid"] is True
        assert body["pdfa3"]["valid"] is False
        assert body["pdfa3"]["errors"] == ["Testfehler"]

        # Unbekannte Rechnungs-ID -> 404
        assert (
            client.post(
                "/api/shop/admin/invoices/999999/validate",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            ).status_code
            == 404
        )
