"""XRechnung-XML (EN 16931 / XRechnung-CIUS) fuer Rechnungen und Gutschriften.

Der Beleg wird einmal beim Ausstellen erzeugt und als Snapshot gespeichert.
Das XML ist die rechtlich maschinenlesbare E-Rechnung; das PDF ist die
lesbare Kopie. Rechnungen laufen als UBL-Invoice (380), Gutschriften als
UBL-CreditNote (381) mit Bezug auf die Ursprungsrechnung.
"""

from __future__ import annotations

import threading
from xml.etree import ElementTree as ET

from models import ShopInvoice, ShopInvoiceLine

_INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
_CREDIT_NS = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"

_NS_LOCK = threading.Lock()

_CAC_TAGS = {
    "AccountingSupplierParty", "AccountingCustomerParty", "Party", "PartyName",
    "PostalAddress", "Country", "PartyTaxScheme", "TaxScheme", "PartyLegalEntity",
    "Contact", "PaymentMeans", "PayeeFinancialAccount", "FinancialInstitutionBranch",
    "PaymentTerms", "TaxTotal", "TaxSubtotal", "TaxCategory", "LegalMonetaryTotal",
    "InvoiceLine", "Item", "Price", "OrderReference", "ClassifiedTaxCategory",
    "BillingReference", "InvoiceDocumentReference", "CreditNoteLine",
}


def _q(tag: str) -> str:
    namespace = _CAC if tag in _CAC_TAGS else _CBC
    return f"{{{namespace}}}{tag}"


def _amount(cents: int) -> str:
    return f"{cents / 100:.2f}"


def _sub(parent: ET.Element, tag: str, text: str | None = None, **attrs: str) -> ET.Element:
    element = ET.SubElement(parent, _q(tag))
    for name, wert in attrs.items():
        element.set(name, wert)
    if text is not None:
        element.text = text
    return element


def _tax_groups(lines: list[ShopInvoiceLine], tax_total: int) -> dict[tuple[int, str], int]:
    gruppen: dict[tuple[int, str], int] = {}
    for line in lines:
        key = (line.tax_rate_percent, line.tax_category)
        gruppen[key] = gruppen.get(key, 0) + line.line_net_cents
    steuer = {key: round(netto * key[0] / 100) for key, netto in gruppen.items()}
    differenz = tax_total - sum(steuer.values())
    if differenz and steuer:
        groesste = max(steuer, key=lambda key: gruppen[key])
        steuer[groesste] += differenz
    return {key: steuer[key] for key in gruppen}


def _build(
    *,
    namespace: str,
    root_tag: str,
    type_code_tag: str,
    type_code: str,
    invoice: ShopInvoice,
    lines: list[ShopInvoiceLine],
    original_number: str | None,
) -> str:
    with _NS_LOCK:
        ET.register_namespace("", namespace)
        ET.register_namespace("cac", _CAC)
        ET.register_namespace("cbc", _CBC)

        root = ET.Element(f"{{{namespace}}}{root_tag}")
        _sub(
            root,
            "CustomizationID",
            "urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0",
        )
        _sub(root, "ProfileID", "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0")
        _sub(root, "ID", invoice.number)
        _sub(root, "IssueDate", invoice.issued_at.date().isoformat())
        _sub(root, "DueDate", invoice.due_date.isoformat())
        _sub(root, type_code_tag, type_code)
        _sub(root, "DocumentCurrencyCode", invoice.currency)
        _sub(root, "BuyerReference", invoice.buyer_reference)
        if invoice.small_business:
            _sub(
                root,
                "Note",
                "Kleinunternehmerregelung nach § 19 UStG: Es wird keine Umsatzsteuer berechnet.",
            )

        if original_number:
            verweis = ET.SubElement(root, _q("BillingReference"))
            referenz = ET.SubElement(verweis, _q("InvoiceDocumentReference"))
            _sub(referenz, "ID", original_number)
        else:
            bestellung = ET.SubElement(root, _q("OrderReference"))
            _sub(bestellung, "ID", invoice.buyer_reference)

        lieferant = ET.SubElement(root, _q("AccountingSupplierParty"))
        partei = ET.SubElement(lieferant, _q("Party"))
        _sub(partei, "EndpointID", invoice.seller_email, schemeID="EM")
        name = ET.SubElement(partei, _q("PartyName"))
        _sub(name, "Name", invoice.seller_name)
        anschrift = ET.SubElement(partei, _q("PostalAddress"))
        _sub(anschrift, "StreetName", invoice.seller_street)
        _sub(anschrift, "CityName", invoice.seller_city)
        _sub(anschrift, "PostalZone", invoice.seller_postal_code)
        land = ET.SubElement(anschrift, _q("Country"))
        _sub(land, "IdentificationCode", invoice.seller_country)
        steuer = ET.SubElement(partei, _q("PartyTaxScheme"))
        _sub(steuer, "CompanyID", invoice.seller_vat_id or invoice.seller_tax_number or "")
        schema = ET.SubElement(steuer, _q("TaxScheme"))
        _sub(schema, "ID", "VAT" if invoice.seller_vat_id else "FC")
        recht = ET.SubElement(partei, _q("PartyLegalEntity"))
        _sub(recht, "RegistrationName", invoice.seller_name)
        kontakt = ET.SubElement(partei, _q("Contact"))
        _sub(kontakt, "Name", invoice.seller_name)
        if invoice.seller_phone:
            _sub(kontakt, "Telephone", invoice.seller_phone)
        _sub(kontakt, "ElectronicMail", invoice.seller_email)

        kunde = ET.SubElement(root, _q("AccountingCustomerParty"))
        kpartei = ET.SubElement(kunde, _q("Party"))
        _sub(kpartei, "EndpointID", invoice.buyer_email, schemeID="EM")
        kname = ET.SubElement(kpartei, _q("PartyName"))
        _sub(kname, "Name", invoice.buyer_name)
        kadresse = ET.SubElement(kpartei, _q("PostalAddress"))
        _sub(kadresse, "StreetName", invoice.buyer_street)
        _sub(kadresse, "CityName", invoice.buyer_city)
        _sub(kadresse, "PostalZone", invoice.buyer_postal_code)
        kland = ET.SubElement(kadresse, _q("Country"))
        _sub(kland, "IdentificationCode", invoice.buyer_country)
        if invoice.buyer_vat_id:
            ksteuer = ET.SubElement(kpartei, _q("PartyTaxScheme"))
            _sub(ksteuer, "CompanyID", invoice.buyer_vat_id)
            kschema = ET.SubElement(ksteuer, _q("TaxScheme"))
            _sub(kschema, "ID", "VAT")

        # Eine Gutschrift fordert keine Zahlung an; Zahlungsangaben entfallen.
        if not original_number:
            zahlung = ET.SubElement(root, _q("PaymentMeans"))
            _sub(zahlung, "PaymentMeansCode", "58" if invoice.seller_iban else "30")
            if invoice.seller_iban:
                konto = ET.SubElement(zahlung, _q("PayeeFinancialAccount"))
                _sub(konto, "ID", invoice.seller_iban)
                if invoice.seller_bic:
                    bank = ET.SubElement(konto, _q("FinancialInstitutionBranch"))
                    _sub(bank, "ID", invoice.seller_bic)
            bedingungen = ET.SubElement(root, _q("PaymentTerms"))
            tage = max(0, (invoice.due_date - invoice.issued_at.date()).days)
            _sub(bedingungen, "Note", f"Zahlbar innerhalb von {tage} Tagen")

        gruppen = _tax_groups(lines, invoice.tax_cents)
        steuersumme = ET.SubElement(root, _q("TaxTotal"))
        _sub(steuersumme, "TaxAmount", _amount(invoice.tax_cents), currencyID=invoice.currency)
        for (satz, kategorie), netto in gruppen.items():
            zwischen = ET.SubElement(steuersumme, _q("TaxSubtotal"))
            _sub(zwischen, "TaxableAmount", _amount(netto), currencyID=invoice.currency)
            _sub(
                zwischen,
                "TaxAmount",
                _amount(round(netto * satz / 100)),
                currencyID=invoice.currency,
            )
            kategorie_element = ET.SubElement(zwischen, _q("TaxCategory"))
            _sub(kategorie_element, "ID", kategorie)
            _sub(kategorie_element, "Percent", f"{satz:.2f}")
            if kategorie == "E":
                _sub(
                    kategorie_element,
                    "TaxExemptionReason",
                    "Kleinunternehmerregelung nach § 19 UStG",
                )
            tschema = ET.SubElement(kategorie_element, _q("TaxScheme"))
            _sub(tschema, "ID", "VAT")

        summen = ET.SubElement(root, _q("LegalMonetaryTotal"))
        _sub(summen, "LineExtensionAmount", _amount(invoice.net_cents), currencyID=invoice.currency)
        _sub(summen, "TaxExclusiveAmount", _amount(invoice.net_cents), currencyID=invoice.currency)
        _sub(summen, "TaxInclusiveAmount", _amount(invoice.gross_cents), currencyID=invoice.currency)
        _sub(summen, "PayableAmount", _amount(invoice.gross_cents), currencyID=invoice.currency)

        line_tag = "CreditNoteLine" if original_number else "InvoiceLine"
        quantity_tag = "CreditedQuantity" if original_number else "InvoicedQuantity"
        for line in lines:
            zeile = ET.SubElement(root, _q(line_tag))
            _sub(zeile, "ID", str(line.position))
            _sub(zeile, quantity_tag, str(line.quantity), unitCode=line.unit_code)
            _sub(zeile, "LineExtensionAmount", _amount(line.line_net_cents), currencyID=invoice.currency)
            artikel = ET.SubElement(zeile, _q("Item"))
            _sub(artikel, "Name", line.description)
            klasse = ET.SubElement(artikel, _q("ClassifiedTaxCategory"))
            _sub(klasse, "ID", line.tax_category)
            _sub(klasse, "Percent", f"{line.tax_rate_percent:.2f}")
            ks = ET.SubElement(klasse, _q("TaxScheme"))
            _sub(ks, "ID", "VAT")
            preis = ET.SubElement(zeile, _q("Price"))
            _sub(preis, "PriceAmount", _amount(line.unit_price_cents), currencyID=invoice.currency)

        ET.indent(root, space="  ")
        return ET.tostring(root, encoding="unicode", xml_declaration=True)


def build_xrechnung_xml(invoice: ShopInvoice, lines: list[ShopInvoiceLine]) -> str:
    return _build(
        namespace=_INVOICE_NS,
        root_tag="Invoice",
        type_code_tag="InvoiceTypeCode",
        type_code="380",
        invoice=invoice,
        lines=lines,
        original_number=None,
    )


def build_xrechnung_credit_note(
    invoice: ShopInvoice,
    lines: list[ShopInvoiceLine],
    original_number: str,
) -> str:
    return _build(
        namespace=_CREDIT_NS,
        root_tag="CreditNote",
        type_code_tag="CreditNoteTypeCode",
        type_code="381",
        invoice=invoice,
        lines=lines,
        original_number=original_number,
    )
