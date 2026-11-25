"""XRechnung-XML (EN 16931 / XRechnung-CIUS) fuer Rechnungen und Gutschriften.

Der Beleg wird einmal beim Ausstellen erzeugt und als Snapshot gespeichert.
Das XML ist die rechtlich maschinenlesbare E-Rechnung; das PDF ist die
lesbare Kopie. Rechnungen laufen als UBL-Invoice (380), Gutschriften als
UBL-CreditNote (381) mit Bezug auf die Ursprungsrechnung.
"""

from __future__ import annotations

import re
import threading
from xml.etree import ElementTree as ET

from models import ShopInvoice, ShopInvoiceLine

_XML_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
_XRECHNUNG_30_CUSTOMIZATION_ID = (
    "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
)

_INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
_CREDIT_NS = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"

_CII_RSM = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
_CII_RAM = "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
_CII_QDT = "urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
_CII_UDT = "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"

_NS_LOCK = threading.Lock()

_CAC_TAGS = {
    "AccountingSupplierParty", "AccountingCustomerParty", "Party", "PartyName",
    "PostalAddress", "Country", "PartyTaxScheme", "TaxScheme", "PartyLegalEntity",
    "Contact", "PaymentMeans", "PayeeFinancialAccount", "FinancialInstitutionBranch",
    "PaymentTerms", "TaxTotal", "TaxSubtotal", "TaxCategory", "LegalMonetaryTotal",
    "InvoiceLine", "Item", "Price", "OrderReference", "ClassifiedTaxCategory",
    "BillingReference", "InvoiceDocumentReference", "CreditNoteLine", "Delivery",
}


def _q(tag: str) -> str:
    namespace = _CAC if tag in _CAC_TAGS else _CBC
    return f"{{{namespace}}}{tag}"


def _amount(cents: int) -> str:
    return f"{cents / 100:.2f}"


def _xml_safe(text: str) -> str:
    return _XML_CTRL_RE.sub("", text)


def _sub(parent: ET.Element, tag: str, text: str | None = None, **attrs: str) -> ET.Element:
    element = ET.SubElement(parent, _q(tag))
    for name, wert in attrs.items():
        element.set(name, _xml_safe(wert))
    if text is not None:
        element.text = _xml_safe(text)
    return element


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
            _XRECHNUNG_30_CUSTOMIZATION_ID,
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

        lieferung = ET.SubElement(root, _q("Delivery"))
        _sub(lieferung, "ActualDeliveryDate", invoice.issued_at.date().isoformat())

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

        steuersumme = ET.SubElement(root, _q("TaxTotal"))
        _sub(steuersumme, "TaxAmount", _amount(invoice.tax_cents), currencyID=invoice.currency)
        for satz, kategorie, netto, steuer in _tax_breakdown(lines, invoice.tax_cents):
            zwischen = ET.SubElement(steuersumme, _q("TaxSubtotal"))
            _sub(zwischen, "TaxableAmount", _amount(netto), currencyID=invoice.currency)
            _sub(
                zwischen,
                "TaxAmount",
                _amount(steuer),
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


def _tax_breakdown(
    lines: list[ShopInvoiceLine], tax_total: int
) -> list[tuple[int, str, int, int]]:
    """Aggregiert Netto- und Steuerbetraege exakt je Steuersatz und -kategorie."""
    gruppen: dict[tuple[int, str], int] = {}
    for line in lines:
        key = (line.tax_rate_percent, line.tax_category)
        gruppen[key] = gruppen.get(key, 0) + line.line_net_cents
    steuer = {key: round(netto * key[0] / 100) for key, netto in gruppen.items()}
    differenz = tax_total - sum(steuer.values())
    if differenz and steuer:
        groesste = max(steuer, key=lambda key: gruppen[key])
        steuer[groesste] += differenz
    return [
        (satz, kategorie, gruppen[(satz, kategorie)], steuer[(satz, kategorie)])
        for (satz, kategorie) in gruppen
    ]


def _cii_el(
    parent: ET.Element,
    ns: str,
    tag: str,
    text: str | None = None,
    **attrs: str,
) -> ET.Element:
    element = ET.SubElement(parent, f"{{{ns}}}{tag}")
    for name, wert in attrs.items():
        element.set(name, _xml_safe(wert))
    if text is not None:
        element.text = _xml_safe(text)
    return element


def build_facturx_cii_xml(
    invoice: ShopInvoice,
    lines: list[ShopInvoiceLine],
    *,
    original_number: str | None = None,
) -> str:
    """Erzeugt UN/CEFACT CrossIndustryInvoice (CII D16B) fuer Factur-X / XRechnung 3.0."""
    with _NS_LOCK:
        ET.register_namespace("rsm", _CII_RSM)
        ET.register_namespace("ram", _CII_RAM)
        ET.register_namespace("qdt", _CII_QDT)
        ET.register_namespace("udt", _CII_UDT)

        root = ET.Element(f"{{{_CII_RSM}}}CrossIndustryInvoice")

        ctx = _cii_el(root, _CII_RSM, "ExchangedDocumentContext")
        bp = _cii_el(ctx, _CII_RAM, "BusinessProcessSpecifiedDocumentContextParameter")
        _cii_el(bp, _CII_RAM, "ID", "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0")
        gl = _cii_el(ctx, _CII_RAM, "GuidelineSpecifiedDocumentContextParameter")
        _cii_el(
            gl,
            _CII_RAM,
            "ID",
            _XRECHNUNG_30_CUSTOMIZATION_ID,
        )

        doc = _cii_el(root, _CII_RSM, "ExchangedDocument")
        _cii_el(doc, _CII_RAM, "ID", invoice.number)
        _cii_el(doc, _CII_RAM, "TypeCode", "381" if original_number else "380")
        issue_dt = _cii_el(doc, _CII_RAM, "IssueDateTime")
        _cii_el(
            issue_dt,
            _CII_UDT,
            "DateTimeString",
            invoice.issued_at.date().strftime("%Y%m%d"),
            format="102",
        )
        if invoice.small_business:
            note = _cii_el(doc, _CII_RAM, "IncludedNote")
            _cii_el(
                note,
                _CII_RAM,
                "Content",
                "Kleinunternehmerregelung nach § 19 UStG: Es wird keine Umsatzsteuer berechnet.",
            )

        tx = _cii_el(root, _CII_RSM, "SupplyChainTradeTransaction")

        for line in lines:
            item_el = _cii_el(tx, _CII_RAM, "IncludedSupplyChainTradeLineItem")
            ldoc = _cii_el(item_el, _CII_RAM, "AssociatedDocumentLineDocument")
            _cii_el(ldoc, _CII_RAM, "LineID", str(line.position))

            prod = _cii_el(item_el, _CII_RAM, "SpecifiedTradeProduct")
            _cii_el(prod, _CII_RAM, "Name", line.description)

            lag = _cii_el(item_el, _CII_RAM, "SpecifiedLineTradeAgreement")
            net_price = _cii_el(lag, _CII_RAM, "NetPriceProductTradePrice")
            _cii_el(net_price, _CII_RAM, "ChargeAmount", _amount(line.unit_price_cents))

            ldel = _cii_el(item_el, _CII_RAM, "SpecifiedLineTradeDelivery")
            _cii_el(
                ldel,
                _CII_RAM,
                "BilledQuantity",
                str(line.quantity),
                unitCode=line.unit_code,
            )

            lset = _cii_el(item_el, _CII_RAM, "SpecifiedLineTradeSettlement")
            ltax = _cii_el(lset, _CII_RAM, "ApplicableTradeTax")
            _cii_el(ltax, _CII_RAM, "TypeCode", "VAT")
            _cii_el(ltax, _CII_RAM, "CategoryCode", line.tax_category)
            _cii_el(ltax, _CII_RAM, "RateApplicablePercent", f"{line.tax_rate_percent:.2f}")
            lsum = _cii_el(lset, _CII_RAM, "SpecifiedTradeSettlementLineMonetarySummation")
            _cii_el(lsum, _CII_RAM, "LineTotalAmount", _amount(line.line_net_cents))

        hag = _cii_el(tx, _CII_RAM, "ApplicableHeaderTradeAgreement")
        _cii_el(hag, _CII_RAM, "BuyerReference", invoice.buyer_reference)

        seller = _cii_el(hag, _CII_RAM, "SellerTradeParty")
        _cii_el(seller, _CII_RAM, "Name", invoice.seller_name)
        s_legal = _cii_el(seller, _CII_RAM, "SpecifiedLegalOrganization")
        _cii_el(s_legal, _CII_RAM, "TradingBusinessName", invoice.seller_name)
        s_contact = _cii_el(seller, _CII_RAM, "DefinedTradeContact")
        _cii_el(s_contact, _CII_RAM, "PersonName", invoice.seller_name)
        if invoice.seller_phone:
            s_tel = _cii_el(s_contact, _CII_RAM, "TelephoneUniversalCommunication")
            _cii_el(s_tel, _CII_RAM, "CompleteNumber", invoice.seller_phone)
        s_mail = _cii_el(s_contact, _CII_RAM, "EmailURIUniversalCommunication")
        _cii_el(s_mail, _CII_RAM, "URIID", invoice.seller_email)
        s_addr = _cii_el(seller, _CII_RAM, "PostalTradeAddress")
        _cii_el(s_addr, _CII_RAM, "PostcodeCode", invoice.seller_postal_code)
        _cii_el(s_addr, _CII_RAM, "LineOne", invoice.seller_street)
        _cii_el(s_addr, _CII_RAM, "CityName", invoice.seller_city)
        _cii_el(s_addr, _CII_RAM, "CountryID", invoice.seller_country)
        s_uri = _cii_el(seller, _CII_RAM, "URIUniversalCommunication")
        _cii_el(s_uri, _CII_RAM, "URIID", invoice.seller_email, schemeID="EM")
        s_tax = _cii_el(seller, _CII_RAM, "SpecifiedTaxRegistration")
        _cii_el(
            s_tax,
            _CII_RAM,
            "ID",
            invoice.seller_vat_id or invoice.seller_tax_number or "",
            schemeID="VA" if invoice.seller_vat_id else "FC",
        )

        buyer = _cii_el(hag, _CII_RAM, "BuyerTradeParty")
        _cii_el(buyer, _CII_RAM, "Name", invoice.buyer_name)
        b_addr = _cii_el(buyer, _CII_RAM, "PostalTradeAddress")
        _cii_el(b_addr, _CII_RAM, "PostcodeCode", invoice.buyer_postal_code)
        _cii_el(b_addr, _CII_RAM, "LineOne", invoice.buyer_street)
        _cii_el(b_addr, _CII_RAM, "CityName", invoice.buyer_city)
        _cii_el(b_addr, _CII_RAM, "CountryID", invoice.buyer_country)
        b_uri = _cii_el(buyer, _CII_RAM, "URIUniversalCommunication")
        _cii_el(b_uri, _CII_RAM, "URIID", invoice.buyer_email, schemeID="EM")
        if invoice.buyer_vat_id:
            b_tax = _cii_el(buyer, _CII_RAM, "SpecifiedTaxRegistration")
            _cii_el(b_tax, _CII_RAM, "ID", invoice.buyer_vat_id, schemeID="VA")

        hdel = _cii_el(tx, _CII_RAM, "ApplicableHeaderTradeDelivery")
        ev = _cii_el(hdel, _CII_RAM, "ActualDeliverySupplyChainEvent")
        ev_dt = _cii_el(ev, _CII_RAM, "OccurrenceDateTime")
        _cii_el(
            ev_dt,
            _CII_UDT,
            "DateTimeString",
            invoice.issued_at.date().strftime("%Y%m%d"),
            format="102",
        )

        hset = _cii_el(tx, _CII_RAM, "ApplicableHeaderTradeSettlement")
        _cii_el(hset, _CII_RAM, "InvoiceCurrencyCode", invoice.currency)

        if not original_number:
            pm = _cii_el(hset, _CII_RAM, "SpecifiedTradeSettlementPaymentMeans")
            _cii_el(pm, _CII_RAM, "TypeCode", "58" if invoice.seller_iban else "30")
            if invoice.seller_iban:
                acc = _cii_el(pm, _CII_RAM, "PayeePartyCreditorFinancialAccount")
                _cii_el(acc, _CII_RAM, "IBANID", invoice.seller_iban)
                if invoice.seller_bic:
                    inst = _cii_el(pm, _CII_RAM, "PayeeSpecifiedCreditorFinancialInstitution")
                    _cii_el(inst, _CII_RAM, "BICID", invoice.seller_bic)

        for satz, kategorie, netto_cents, steuer_cents in _tax_breakdown(
            lines, invoice.tax_cents
        ):
            htax = _cii_el(hset, _CII_RAM, "ApplicableTradeTax")
            _cii_el(htax, _CII_RAM, "CalculatedAmount", _amount(steuer_cents))
            _cii_el(htax, _CII_RAM, "TypeCode", "VAT")
            if kategorie == "E":
                _cii_el(
                    htax,
                    _CII_RAM,
                    "ExemptionReason",
                    "Kleinunternehmerregelung nach § 19 UStG",
                )
            _cii_el(htax, _CII_RAM, "BasisAmount", _amount(netto_cents))
            _cii_el(htax, _CII_RAM, "CategoryCode", kategorie)
            _cii_el(htax, _CII_RAM, "RateApplicablePercent", f"{satz:.2f}")

        if not original_number:
            terms = _cii_el(hset, _CII_RAM, "SpecifiedTradePaymentTerms")
            tage = max(0, (invoice.due_date - invoice.issued_at.date()).days)
            _cii_el(terms, _CII_RAM, "Description", f"Zahlbar innerhalb von {tage} Tagen")
            due_dt = _cii_el(terms, _CII_RAM, "DueDateDateTime")
            _cii_el(
                due_dt,
                _CII_UDT,
                "DateTimeString",
                invoice.due_date.strftime("%Y%m%d"),
                format="102",
            )

        hsum = _cii_el(hset, _CII_RAM, "SpecifiedTradeSettlementHeaderMonetarySummation")
        _cii_el(hsum, _CII_RAM, "LineTotalAmount", _amount(invoice.net_cents))
        _cii_el(hsum, _CII_RAM, "TaxBasisTotalAmount", _amount(invoice.net_cents))
        _cii_el(
            hsum,
            _CII_RAM,
            "TaxTotalAmount",
            _amount(invoice.tax_cents),
            currencyID=invoice.currency,
        )
        _cii_el(hsum, _CII_RAM, "GrandTotalAmount", _amount(invoice.gross_cents))
        _cii_el(hsum, _CII_RAM, "DuePayableAmount", _amount(invoice.gross_cents))

        if original_number:
            ref = _cii_el(hset, _CII_RAM, "InvoiceReferencedDocument")
            _cii_el(ref, _CII_RAM, "IssuerAssignedID", original_number)

        ET.indent(root, space="  ")
        return ET.tostring(root, encoding="unicode", xml_declaration=True)
