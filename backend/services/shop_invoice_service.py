"""Rechnungs-Ledger des Shops: Nummernkreis, XRechnung-XML, PDF, Snapshot.

Eine Rechnung entsteht genau einmal pro bezahlter Bestellung und ist danach
unveraenderlich. Fehlen Verkaeuferdaten oder die Kaeuferanschrift, wird
bewusst keine Rechnung ausgestellt; der Zahlungsvorgang laeuft trotzdem
weiter, im Panel steht dann ein Hinweis auf die fehlenden Angaben.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import (
    ShopCreditNoteSequence,
    ShopInvoice,
    ShopInvoiceLine,
    ShopInvoiceSequence,
    ShopOrder,
    ShopOrderItem,
)
from schemas.shop import (
    ShopInvoiceLineResponse,
    ShopInvoiceResponse,
    ShopInvoiceSummaryResponse,
)
from services import (
    shop_einvoice_toolchain_service,
    shop_invoice_pdf,
    shop_invoice_xml,
    shop_seller_settings_service,
)


class InvoiceError(ValueError):
    """Rechnung kann nicht ausgestellt werden."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _naechste_nummer(db: Session, jahr: int, praefix: str) -> str:
    db.execute(
        text(
            "INSERT INTO shop_invoice_sequences (year, last_number) VALUES (:jahr, 0) "
            "ON CONFLICT (year) DO NOTHING"
        ),
        {"jahr": jahr},
    )
    reihe = (
        db.query(ShopInvoiceSequence)
        .filter(ShopInvoiceSequence.year == jahr)
        .with_for_update()
        .first()
    )
    if reihe is None:
        raise InvoiceError("Nummernkreis konnte nicht gesperrt werden")
    reihe.last_number += 1
    db.flush()
    return f"{praefix}-{jahr}-{reihe.last_number:04d}"


def _naechste_gutschrift_nummer(db: Session, jahr: int) -> str:
    db.execute(
        text(
            "INSERT INTO shop_credit_note_sequences (year, last_number) VALUES (:jahr, 0) "
            "ON CONFLICT (year) DO NOTHING"
        ),
        {"jahr": jahr},
    )
    reihe = (
        db.query(ShopCreditNoteSequence)
        .filter(ShopCreditNoteSequence.year == jahr)
        .with_for_update()
        .first()
    )
    if reihe is None:
        raise InvoiceError("Gutschrift-Nummernkreis konnte nicht gesperrt werden")
    reihe.last_number += 1
    db.flush()
    return f"GS-{jahr}-{reihe.last_number:04d}"


def _buyer_complete(order: ShopOrder) -> bool:
    return all(
        wert
        for wert in (
            order.buyer_name,
            order.buyer_street,
            order.buyer_postal_code,
            order.buyer_city,
            order.buyer_country,
            order.buyer_email,
        )
    )


def _lines_from_order(db: Session, order: ShopOrder) -> list[ShopInvoiceLine]:
    artikel = (
        db.query(ShopOrderItem)
        .filter(ShopOrderItem.order_id == order.id)
        .order_by(ShopOrderItem.id.asc())
        .all()
    )
    zeilen: list[ShopInvoiceLine] = []
    for position, item in enumerate(artikel, start=1):
        satz = item.tax_rate_percent
        netto = (
            round(item.gross_cents * 100 / (100 + satz)) if satz else item.gross_cents
        )
        zeilen.append(
            ShopInvoiceLine(
                position=position,
                description=item.name,
                quantity=item.quantity,
                unit_code="C62",
                unit_price_cents=round(netto / item.quantity),
                line_net_cents=netto,
                tax_rate_percent=satz,
                tax_category="E" if satz == 0 else "S",
            )
        )
    summe = sum(zeile.line_net_cents for zeile in zeilen)
    if zeilen and summe != order.net_cents:
        # Rundungsrest dem letzten Posten zuordnen, damit die Belegsumme
        # exakt dem belasteten Betrag entspricht.
        letzte = zeilen[-1]
        letzte.line_net_cents += order.net_cents - summe
    return zeilen


def ensure_invoice_for_order(db: Session, order: ShopOrder) -> ShopInvoice | None:
    """Stellt die Rechnung einmalig aus; None, wenn Angaben fehlen."""
    vorhanden = (
        db.query(ShopInvoice).filter(ShopInvoice.order_id == order.id).first()
    )
    if vorhanden is not None:
        return vorhanden
    if not shop_seller_settings_service.is_complete():
        return None
    if not _buyer_complete(order):
        return None

    seller = shop_seller_settings_service.read()
    jetzt = _now()
    tage = int(seller["payment_terms_days"])
    nummer = _naechste_nummer(db, jetzt.year, str(seller["invoice_prefix"]))

    rechnung = ShopInvoice(
        number=nummer,
        order_id=order.id,
        user_id=order.user_id,
        type="invoice",
        status="issued",
        issued_at=jetzt,
        due_date=(jetzt + timedelta(days=tage)).date(),
        currency=order.currency,
        buyer_reference=order.number,
        seller_name=str(seller["name"]),
        seller_street=str(seller["street"]),
        seller_postal_code=str(seller["postal_code"]),
        seller_city=str(seller["city"]),
        seller_country=str(seller["country"]),
        seller_email=str(seller["email"]),
        seller_phone=str(seller["phone"]) or None,
        seller_vat_id=str(seller["vat_id"]) or None,
        seller_tax_number=str(seller["tax_number"]) or None,
        seller_iban=str(seller["iban"]) or None,
        seller_bic=str(seller["bic"]) or None,
        small_business=bool(seller["small_business"]),
        buyer_name=order.buyer_name or "",
        buyer_street=order.buyer_street or "",
        buyer_postal_code=order.buyer_postal_code or "",
        buyer_city=order.buyer_city or "",
        buyer_country=order.buyer_country or "",
        buyer_email=order.buyer_email or "",
        net_cents=order.net_cents,
        tax_cents=order.tax_cents,
        gross_cents=order.gross_cents,
        xml_text="",
        xml_sha256="",
        pdf_bytes=b"",
        pdf_sha256="",
    )

    zeilen = _lines_from_order(db, order)

    xml_text = shop_invoice_xml.build_xrechnung_xml(rechnung, zeilen)
    rechnung.xml_text = xml_text
    rechnung.xml_sha256 = _hash(xml_text.encode("utf-8"))

    pdf = _finalize_invoice_pdf(rechnung, zeilen, titel=f"Rechnung {rechnung.number}")
    rechnung.pdf_bytes = pdf
    rechnung.pdf_sha256 = _hash(pdf)

    db.add(rechnung)
    db.flush()
    for zeile in zeilen:
        zeile.invoice_id = rechnung.id
        db.add(zeile)
    db.flush()
    return rechnung


def _hash(daten: bytes) -> str:
    return hashlib.sha256(daten).hexdigest()


def _finalize_invoice_pdf(
    invoice: ShopInvoice,
    lines: list[ShopInvoiceLine],
    *,
    titel: str,
    pdf_titel: str = "Rechnung",
    referenz: str | None = None,
    original_number: str | None = None,
) -> bytes:
    """Erzeugt das PDF und bettet Factur-X CII ein, wenn die Toolchain bereit ist."""
    plain_pdf = shop_invoice_pdf.build_invoice_pdf(
        invoice, lines, titel=pdf_titel, referenz=referenz
    )
    facturx_xml = shop_invoice_xml.build_facturx_cii_xml(
        invoice, lines, original_number=original_number
    )
    final_pdf, _pdfa3_ok = shop_einvoice_toolchain_service.build_facturx_pdfa3(
        plain_pdf,
        facturx_xml,
        title=titel,
        document_type="INVOICE",
    )
    return final_pdf


def credit_invoice(db: Session, invoice: ShopInvoice, reason: str) -> ShopInvoice:
    """Storniert eine Rechnung ueber eine Gutschrift mit Ursprungsbezug.

    Die Rechnung bleibt im Ledger (Status `void`), die Gutschrift traegt einen
    eigenen Nummernkreis. Rueckerstattung und Entzug von Anspruechen sind
    eigene Schritte und werden hier bewusst nicht automatisch ausgeloest.
    """
    if invoice.type != "invoice":
        raise InvoiceError("Nur Rechnungen koennen gutgeschrieben werden")
    if invoice.status == "void":
        raise InvoiceError("Rechnung ist bereits storniert")
    vorhanden = (
        db.query(ShopInvoice)
        .filter(
            ShopInvoice.reference_invoice_id == invoice.id,
            ShopInvoice.type == "credit_note",
        )
        .first()
    )
    if vorhanden is not None:
        raise InvoiceError("Gutschrift existiert bereits")

    jetzt = _now()
    gutschrift = ShopInvoice(
        number=_naechste_gutschrift_nummer(db, jetzt.year),
        order_id=invoice.order_id,
        user_id=invoice.user_id,
        type="credit_note",
        status="issued",
        issued_at=jetzt,
        due_date=jetzt.date(),
        currency=invoice.currency,
        buyer_reference=invoice.buyer_reference,
        seller_name=invoice.seller_name,
        seller_street=invoice.seller_street,
        seller_postal_code=invoice.seller_postal_code,
        seller_city=invoice.seller_city,
        seller_country=invoice.seller_country,
        seller_email=invoice.seller_email,
        seller_phone=invoice.seller_phone,
        seller_vat_id=invoice.seller_vat_id,
        seller_tax_number=invoice.seller_tax_number,
        seller_iban=invoice.seller_iban,
        seller_bic=invoice.seller_bic,
        small_business=invoice.small_business,
        buyer_name=invoice.buyer_name,
        buyer_street=invoice.buyer_street,
        buyer_postal_code=invoice.buyer_postal_code,
        buyer_city=invoice.buyer_city,
        buyer_country=invoice.buyer_country,
        buyer_email=invoice.buyer_email,
        buyer_vat_id=invoice.buyer_vat_id,
        net_cents=invoice.net_cents,
        tax_cents=invoice.tax_cents,
        gross_cents=invoice.gross_cents,
        reference_invoice_id=invoice.id,
        reason=reason,
        xml_text="",
        xml_sha256="",
        pdf_bytes=b"",
        pdf_sha256="",
    )

    original_zeilen = invoice_lines(db, invoice.id)
    kopien = [
        ShopInvoiceLine(
            position=zeile.position,
            description=zeile.description,
            quantity=zeile.quantity,
            unit_code=zeile.unit_code,
            unit_price_cents=zeile.unit_price_cents,
            line_net_cents=zeile.line_net_cents,
            tax_rate_percent=zeile.tax_rate_percent,
            tax_category=zeile.tax_category,
        )
        for zeile in original_zeilen
    ]

    xml_text = shop_invoice_xml.build_xrechnung_credit_note(
        gutschrift, kopien, invoice.number
    )
    gutschrift.xml_text = xml_text
    gutschrift.xml_sha256 = _hash(xml_text.encode("utf-8"))
    pdf = _finalize_invoice_pdf(
        gutschrift,
        kopien,
        titel=f"Gutschrift {gutschrift.number}",
        pdf_titel="Gutschrift",
        referenz=invoice.number,
        original_number=invoice.number,
    )
    gutschrift.pdf_bytes = pdf
    gutschrift.pdf_sha256 = _hash(pdf)

    invoice.status = "void"
    db.add(gutschrift)
    db.flush()
    for zeile in kopien:
        zeile.invoice_id = gutschrift.id
        db.add(zeile)
    db.flush()
    return gutschrift


def list_invoices(db: Session, user_id: int) -> list[ShopInvoice]:
    return (
        db.query(ShopInvoice)
        .filter(ShopInvoice.user_id == user_id)
        .order_by(ShopInvoice.issued_at.desc(), ShopInvoice.id.desc())
        .all()
    )


def get_invoice(db: Session, user_id: int, invoice_id: int) -> ShopInvoice | None:
    return (
        db.query(ShopInvoice)
        .filter(ShopInvoice.id == invoice_id, ShopInvoice.user_id == user_id)
        .first()
    )


def invoice_lines(db: Session, invoice_id: int) -> list[ShopInvoiceLine]:
    return (
        db.query(ShopInvoiceLine)
        .filter(ShopInvoiceLine.invoice_id == invoice_id)
        .order_by(ShopInvoiceLine.position.asc())
        .all()
    )


def _order_number(db: Session, order_id: int) -> str:
    order = db.query(ShopOrder).filter(ShopOrder.id == order_id).first()
    return order.number if order is not None else ""


def summary_response(db: Session, invoice: ShopInvoice) -> ShopInvoiceSummaryResponse:
    return ShopInvoiceSummaryResponse(
        id=invoice.id,
        number=invoice.number,
        order_id=invoice.order_id,
        order_number=_order_number(db, invoice.order_id),
        type=invoice.type,
        status=invoice.status,
        issued_at=invoice.issued_at,
        due_date=invoice.due_date,
        currency=invoice.currency,
        buyer_reference=invoice.buyer_reference,
        net_cents=invoice.net_cents,
        tax_cents=invoice.tax_cents,
        gross_cents=invoice.gross_cents,
        reference_invoice_id=invoice.reference_invoice_id,
        reason=invoice.reason,
    )


def detail_response(db: Session, invoice: ShopInvoice) -> ShopInvoiceResponse:
    basis = summary_response(db, invoice)
    return ShopInvoiceResponse(
        **basis.model_dump(),
        seller_name=invoice.seller_name,
        seller_vat_id=invoice.seller_vat_id,
        buyer_name=invoice.buyer_name,
        buyer_email=invoice.buyer_email,
        lines=[
            ShopInvoiceLineResponse(
                position=zeile.position,
                description=zeile.description,
                quantity=zeile.quantity,
                unit_code=zeile.unit_code,
                unit_price_cents=zeile.unit_price_cents,
                line_net_cents=zeile.line_net_cents,
                tax_rate_percent=zeile.tax_rate_percent,
                tax_category=zeile.tax_category,
            )
            for zeile in invoice_lines(db, invoice.id)
        ],
    )


def download_name(invoice: ShopInvoice, endung: str) -> str:
    return f"{invoice.number}.{endung}"
