"""Lesbares Rechnungs-PDF ohne externe Bibliothek.

Die rechtlich maschinenlesbare E-Rechnung ist das XRechnung-XML; dieses PDF
ist die menschliche Kopie. Erzeugt wird ein schlichtes PDF 1.4 mit den
Standardfonts Helvetica/Helvetica-Bold (WinAnsi, deckt Umlaute und Euro ab).
Kein PDF/A-3-Container mit eingebettetem Factur-X: dafuer braeuchte es eine
eigene Konvertierung und eine gepruefte Bibliothek.
"""

from __future__ import annotations

import re

from models import ShopInvoice, ShopInvoiceLine

_SEITENBREITE = 595
_SEITENHOEHE = 842
_RAND = 50
_PDF_CTRL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _esc(text: str) -> str:
    cleaned = _PDF_CTRL_RE.sub(" ", text or "")
    return cleaned.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _money(cents: int) -> str:
    wert = f"{cents / 100:,.2f}"
    return wert.replace(",", "X").replace(".", ",").replace("X", ".") + " €"


def _wrap(text: str, breite: int = 62) -> list[str]:
    woerter = text.split()
    zeilen: list[str] = []
    aktuell = ""
    for wort in woerter:
        if not aktuell:
            aktuell = wort
        elif len(aktuell) + 1 + len(wort) <= breite:
            aktuell += " " + wort
        else:
            zeilen.append(aktuell)
            aktuell = wort
    if aktuell:
        zeilen.append(aktuell)
    return zeilen or [""]


class _Zeichner:
    def __init__(self) -> None:
        self.befehle: list[str] = []

    def text(self, x: float, y: float, groesse: int, inhalt: str, bold: bool = False) -> None:
        font = "F2" if bold else "F1"
        self.befehle.append(
            f"BT /{font} {groesse} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm ({_esc(inhalt)}) Tj ET"
        )

    def rechts(self, x_rechts: float, y: float, groesse: int, inhalt: str, bold: bool = False) -> None:
        breite = len(inhalt) * groesse * 0.5
        self.text(x_rechts - breite, y, groesse, inhalt, bold)

    def linie(self, x1: float, y1: float, x2: float, y2: float) -> None:
        self.befehle.append(f"0.6 w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")


def _stream(inhalt: str) -> bytes:
    daten = inhalt.encode("cp1252", "replace")
    return b"<< /Length " + str(len(daten)).encode() + b" >>\nstream\n" + daten + b"\nendstream"


def _zusammenbauen(stream: bytes) -> bytes:
    objekte = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {_SEITENBREITE} {_SEITENHOEHE}] "
            "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>"
        ).encode(),
        stream,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]

    ausgabe = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    versatz: list[int] = []
    for nummer, objekt in enumerate(objekte, start=1):
        versatz.append(len(ausgabe))
        ausgabe += f"{nummer} 0 obj\n".encode() + objekt + b"\nendobj\n"
    xref = len(ausgabe)
    ausgabe += f"xref\n0 {len(objekte) + 1}\n0000000000 65535 f \n".encode()
    for position in versatz:
        ausgabe += f"{position:010d} 00000 n \n".encode()
    ausgabe += (
        f"trailer\n<< /Size {len(objekte) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(ausgabe)


def build_invoice_pdf(
    invoice: ShopInvoice,
    lines: list[ShopInvoiceLine],
    *,
    titel: str = "Rechnung",
    referenz: str | None = None,
) -> bytes:
    z = _Zeichner()
    x_links = _RAND
    x_rechts = _SEITENBREITE - _RAND
    y = _SEITENHOEHE - 70

    z.text(x_links, y, 15, invoice.seller_name, bold=True)
    y -= 16
    for wert in (invoice.seller_street, f"{invoice.seller_postal_code} {invoice.seller_city}", invoice.seller_country):
        z.text(x_links, y, 9, wert)
        y -= 12
    if invoice.seller_vat_id:
        z.text(x_links, y, 9, f"USt-IdNr.: {invoice.seller_vat_id}")
        y -= 12
    if invoice.seller_tax_number and not invoice.seller_vat_id:
        z.text(x_links, y, 9, f"Steuernummer: {invoice.seller_tax_number}")
        y -= 12

    y_kopf = _SEITENHOEHE - 70
    z.rechts(x_rechts, y_kopf, 18, titel, bold=True)
    z.rechts(x_rechts, y_kopf - 20, 10, f"Nr. {invoice.number}")
    z.rechts(x_rechts, y_kopf - 34, 9, f"Datum: {invoice.issued_at.date().isoformat()}")
    y_kopf -= 46
    if referenz:
        z.rechts(x_rechts, y_kopf, 9, f"Bezug: {referenz}")
    else:
        z.rechts(x_rechts, y_kopf, 9, f"Faellig: {invoice.due_date.isoformat()}")
    y_kopf -= 12
    z.rechts(x_rechts, y_kopf, 9, f"Bestellung: {invoice.buyer_reference}")

    y = min(y, _SEITENHOEHE - 150) - 26
    z.text(x_links, y, 10, "Rechnung an", bold=True)
    y -= 14
    for wert in (
        invoice.buyer_name,
        invoice.buyer_street,
        f"{invoice.buyer_postal_code} {invoice.buyer_city}",
        invoice.buyer_country,
        invoice.buyer_email,
    ):
        z.text(x_links, y, 9, wert)
        y -= 12

    y -= 16
    z.text(x_links, y, 9, "Pos", bold=True)
    z.text(x_links + 30, y, 9, "Beschreibung", bold=True)
    z.rechts(x_rechts - 150, y, 9, "Menge", bold=True)
    z.rechts(x_rechts - 60, y, 9, "Einzel netto", bold=True)
    z.rechts(x_rechts, y, 9, "Netto", bold=True)
    y -= 6
    z.linie(x_links, y, x_rechts, y)
    y -= 14

    for line in lines:
        zeilen = _wrap(line.description, 48)
        z.text(x_links, y, 9, str(line.position))
        z.text(x_links + 30, y, 9, zeilen[0])
        z.rechts(x_rechts - 150, y, 9, str(line.quantity))
        z.rechts(x_rechts - 60, y, 9, _money(line.unit_price_cents))
        z.rechts(x_rechts, y, 9, _money(line.line_net_cents))
        y -= 12
        for extra in zeilen[1:]:
            z.text(x_links + 30, y, 9, extra)
            y -= 12

    y -= 6
    z.linie(x_links + 300, y, x_rechts, y)
    y -= 16
    z.rechts(x_rechts - 120, y, 9, "Netto")
    z.rechts(x_rechts, y, 9, _money(invoice.net_cents))
    y -= 13
    z.rechts(x_rechts - 120, y, 9, "Umsatzsteuer")
    z.rechts(x_rechts, y, 9, _money(invoice.tax_cents))
    y -= 13
    z.rechts(x_rechts - 120, y, 9, "Gesamt", bold=True)
    z.rechts(x_rechts, y, 9, _money(invoice.gross_cents), bold=True)
    y -= 24

    saetze = sorted({f"{line.tax_rate_percent} %" for line in lines})
    z.text(x_links, y, 9, f"Steuersaetze: {', '.join(saetze)}")
    y -= 12
    if invoice.small_business:
        z.text(x_links, y, 8, "Kleinunternehmerregelung nach § 19 UStG, keine Umsatzsteuer.")
        y -= 12
    if invoice.seller_iban and not referenz:
        z.text(x_links, y, 9, f"Zahlung auf IBAN {invoice.seller_iban}"
              + (f", BIC {invoice.seller_bic}" if invoice.seller_bic else ""))
        y -= 12
    z.text(
        x_links,
        y,
        8,
        "E-Rechnung: XRechnung-XML (EN 16931) als separater Download. Dieses PDF ist die lesbare Kopie.",
    )
    y -= 12
    z.text(x_links, y, 8, f"SHA-256 XML: {invoice.xml_sha256}")

    return _zusammenbauen(_stream("\n".join(z.befehle)))
