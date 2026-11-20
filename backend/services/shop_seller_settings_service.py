"""Verkaeuferdaten fuer Rechnungen (Pflichtangaben nach §14 UStG).

Keine Geheimnisse: Name, Anschrift, Steuernummern, Bankverbindung und
Zahlungsziel liegen als normale Panel-Einstellungen. Ohne diese Angaben
wird keine Rechnung ausgestellt, damit kein unvollstaendiger Beleg entsteht.
"""

from __future__ import annotations

import re

from services.panel_settings_service import PanelSettingsService

_LAND = re.compile(r"^[A-Z]{2}$")
_PRAEFIX = re.compile(r"^[A-Z0-9]{1,8}$")

_FELDER = {
    "name": "shop_seller_name",
    "street": "shop_seller_street",
    "postal_code": "shop_seller_postal_code",
    "city": "shop_seller_city",
    "country": "shop_seller_country",
    "email": "shop_seller_email",
    "phone": "shop_seller_phone",
    "vat_id": "shop_seller_vat_id",
    "tax_number": "shop_seller_tax_number",
    "iban": "shop_seller_iban",
    "bic": "shop_seller_bic",
    "invoice_prefix": "shop_seller_invoice_prefix",
}

_PFLICHT = ("name", "street", "postal_code", "city", "country", "email")


class SellerSettingsError(ValueError):
    """Ungueltige Verkaeuferangabe; wird am Rand zu 422."""


def _get(feld: str) -> str:
    return PanelSettingsService.get(_FELDER[feld], "").strip()


def read() -> dict[str, object]:
    return {
        **{feld: _get(feld) for feld in _FELDER},
        "payment_terms_days": int(
            PanelSettingsService.get("shop_seller_payment_terms_days", "14") or "14"
        ),
        "invoice_prefix": PanelSettingsService.get(
            "shop_seller_invoice_prefix", "RE"
        )
        or "RE",
        "small_business": PanelSettingsService.get(
            "shop_seller_small_business", "false"
        )
        == "true",
    }


def missing_fields() -> list[str]:
    fehlend = [feld for feld in _PFLICHT if not _get(feld)]
    if not _get("vat_id") and not _get("tax_number"):
        fehlend.append("vat_id/tax_number")
    return fehlend


def is_complete() -> bool:
    return not missing_fields()


def _clean_text(values: dict[str, object], feld: str, *, upper: bool = False) -> None:
    wert = str(values.get(feld, "") or "").strip()
    if upper:
        wert = wert.upper()
    PanelSettingsService.set(_FELDER[feld], wert)


def update(values: dict[str, object]) -> None:
    land = values.get("country")
    if land is not None and not _LAND.fullmatch(str(land).strip().upper()):
        raise SellerSettingsError("Laenderkennung muss aus zwei Grossbuchstaben bestehen")
    praefix = values.get("invoice_prefix")
    if praefix is not None and not _PRAEFIX.fullmatch(str(praefix).strip().upper()):
        raise SellerSettingsError(
            "Rechnungs-Praefix: 1 bis 8 Zeichen, nur Grossbuchstaben und Ziffern"
        )

    for feld in ("name", "street", "postal_code", "city", "email", "phone", "vat_id", "tax_number"):
        if feld in values:
            _clean_text(values, feld)
    for feld in ("country", "iban", "bic", "invoice_prefix"):
        if feld in values:
            _clean_text(values, feld, upper=True)

    if "payment_terms_days" in values and values["payment_terms_days"] is not None:
        PanelSettingsService.set(
            "shop_seller_payment_terms_days", str(int(values["payment_terms_days"]))
        )
    if "small_business" in values:
        PanelSettingsService.set(
            "shop_seller_small_business",
            "true" if values["small_business"] else "false",
        )


def invoice_prefix() -> str:
    return str(read()["invoice_prefix"])
