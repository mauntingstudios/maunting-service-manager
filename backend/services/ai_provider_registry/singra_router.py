"""Virtueller Anbieter fuer den eingebauten Singra KI-Router (Smart Model Routing).

Kein externer API-Endpunkt und kein eigener Schluessel: zur Laufzeit waehlt der
Router ein Modell aus bereits konfigurierten Providern und leitet die Anfrage
ueber deren Adapter und Zugangsdaten weiter.
"""

from __future__ import annotations

from services.ai_provider_registry.basis import Anbieter, Modell


ANBIETER = Anbieter(
    kind="singra_router",
    label="Singra Router (Smart Model Routing)",
    base_url="",
    catalog_url=None,
    key_url="",
    key_prefix=None,
    katalog_braucht_schluessel=False,
    schluessel_kopf="Authorization",
    schluessel_praefix="Bearer ",
    katalog_liste_feld=None,
    empfehlung=None,
    gehoer_wege=(),
    gehoer_form=None,
    anfrage_erweiterungen=frozenset(),
    protokoll_chat="chat_completions",
    sprachwege=(),
    adresse_eintragbar=False,
    virtuell=True,
)


def katalog_lesen(rohdaten: dict) -> Modell | None:
    """Virtueller Anbieter fuehrt keinen externen Modellkatalog."""
    return None
