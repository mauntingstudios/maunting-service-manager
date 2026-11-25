"""Betriebspruefungs-Export des Rechnungs-Ledgers als ZIP-Archiv.

Erzeugt ein selbsttragendes Archiv aus unveraenderlichen Beleg-Snapshots:
``index.csv``, ``manifest.json`` (Summen und SHA-256-Pruefsummen) sowie alle
PDF-Kopien und XRechnung-XML-Dateien.
"""

from __future__ import annotations

import csv
from datetime import datetime, timezone
import io
import json
import re
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy.orm import Session

from models import ShopInvoice
from services import audit_service


_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
_CSV_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _csv_safe(value: str | None) -> str:
    if value is None:
        return ""
    text = _CSV_CTRL_RE.sub("", str(value))
    stripped = text.lstrip(" \t\r\n")
    if (text and text[0] in _CSV_FORMULA_PREFIXES) or (
        stripped and stripped[0] in ("=", "+", "-", "@")
    ):
        return "'" + text
    return text


def _safe_filename(number: str) -> str:
    cleaned = _SAFE_FILENAME_RE.sub("_", (number or "").strip()).strip("._")
    return cleaned or "beleg"


def build_audit_export_zip(
    db: Session,
    *,
    actor_user_id: int,
    year: int | None = None,
) -> tuple[bytes, str]:
    """Packt alle Belege (optional nach Kalenderjahr) als ZIP fuer die Pruefung."""
    query = db.query(ShopInvoice)
    if year is not None:
        start = datetime(year, 1, 1, tzinfo=timezone.utc)
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        query = query.filter(
            ShopInvoice.issued_at >= start, ShopInvoice.issued_at < end
        )
    rechnungen = query.order_by(
        ShopInvoice.issued_at.asc(), ShopInvoice.id.asc()
    ).all()

    csv_buf = io.StringIO()
    writer = csv.writer(csv_buf, lineterminator="\n")
    writer.writerow(
        [
            "number",
            "type",
            "status",
            "issued_at",
            "due_date",
            "order_number",
            "buyer_name",
            "buyer_country",
            "currency",
            "net_cents",
            "tax_cents",
            "gross_cents",
            "reference_invoice_id",
            "reason",
            "pdf_sha256",
            "xml_sha256",
        ]
    )

    totals: dict[str, dict[str, int]] = {
        "invoice": {"count": 0, "net_cents": 0, "tax_cents": 0, "gross_cents": 0},
        "credit_note": {
            "count": 0,
            "net_cents": 0,
            "tax_cents": 0,
            "gross_cents": 0,
        },
    }
    dokumente: list[dict] = []
    vergebene_namen: set[str] = set()

    zip_buf = io.BytesIO()
    with ZipFile(zip_buf, mode="w", compression=ZIP_DEFLATED) as zf:
        for beleg in rechnungen:
            basis_name = _safe_filename(beleg.number)
            dateiname = basis_name
            if dateiname in vergebene_namen:
                dateiname = f"{basis_name}_{beleg.id}"
            suffix = 2
            while dateiname in vergebene_namen:
                dateiname = f"{basis_name}_{beleg.id}_{suffix}"
                suffix += 1
            vergebene_namen.add(dateiname)

            pdf_pfad = f"pdf/{dateiname}.pdf"
            xml_pfad = f"xml/{dateiname}.xml"
            zf.writestr(pdf_pfad, beleg.pdf_bytes)
            zf.writestr(xml_pfad, beleg.xml_text.encode("utf-8"))

            writer.writerow(
                [
                    _csv_safe(beleg.number),
                    _csv_safe(beleg.type),
                    _csv_safe(beleg.status),
                    beleg.issued_at.isoformat(),
                    beleg.due_date.isoformat(),
                    _csv_safe(beleg.buyer_reference),
                    _csv_safe(beleg.buyer_name),
                    _csv_safe(beleg.buyer_country),
                    _csv_safe(beleg.currency),
                    beleg.net_cents,
                    beleg.tax_cents,
                    beleg.gross_cents,
                    beleg.reference_invoice_id or "",
                    _csv_safe(beleg.reason),
                    beleg.pdf_sha256,
                    beleg.xml_sha256,
                ]
            )

            if beleg.type in totals:
                bucket = totals[beleg.type]
                bucket["count"] += 1
                bucket["net_cents"] += beleg.net_cents
                bucket["tax_cents"] += beleg.tax_cents
                bucket["gross_cents"] += beleg.gross_cents

            dokumente.append(
                {
                    "id": beleg.id,
                    "number": beleg.number,
                    "type": beleg.type,
                    "status": beleg.status,
                    "issued_at": beleg.issued_at.isoformat(),
                    "due_date": beleg.due_date.isoformat(),
                    "order_number": beleg.buyer_reference,
                    "currency": beleg.currency,
                    "net_cents": beleg.net_cents,
                    "tax_cents": beleg.tax_cents,
                    "gross_cents": beleg.gross_cents,
                    "reference_invoice_id": beleg.reference_invoice_id,
                    "pdf_file": pdf_pfad,
                    "pdf_sha256": beleg.pdf_sha256,
                    "xml_file": xml_pfad,
                    "xml_sha256": beleg.xml_sha256,
                }
            )

        manifest = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "year": year,
            "count": len(rechnungen),
            "totals": totals,
            "documents": dokumente,
        }
        zf.writestr("index.csv", csv_buf.getvalue().encode("utf-8"))
        zf.writestr(
            "manifest.json",
            json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"),
        )

    audit_service.record_privileged_action(
        db,
        user_id=actor_user_id,
        action="shop.invoices.exported",
        target_type="shop_invoice",
        target_id="export",
        details={"year": year, "count": len(rechnungen)},
    )
    db.commit()

    dateiname_zip = f"msm-shop-belege-{year if year is not None else 'alle'}.zip"
    return zip_buf.getvalue(), dateiname_zip
