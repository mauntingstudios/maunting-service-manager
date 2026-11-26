"""Mistral AI — europäischer KI-Anbieter mit Experiment-/Free-Tier und OpenAI-kompatibler API."""

from __future__ import annotations

from services.ai_provider_registry.basis import Anbieter, Modell, iso_datum, positive_zahl


ANBIETER = Anbieter(
    kind="mistral",
    label="Mistral AI",
    base_url="https://api.mistral.ai/v1",
    catalog_url="https://api.mistral.ai/v1/models",
    key_url="https://console.mistral.ai/api-keys",
    key_prefix=None,
    katalog_braucht_schluessel=True,
    gehoer_wege=(),
    anfrage_erweiterungen=frozenset(),
    protokoll_chat="chat_completions",
)


def katalog_lesen(rohdaten: dict) -> Modell | None:
    """Liest einen Katalogeintrag von Mistral AI (`/v1/models`)."""
    raw_id = rohdaten.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        return None

    model_id = raw_id.strip()
    raw_name = rohdaten.get("name")
    name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else model_id

    capabilities = rohdaten.get("capabilities")
    sieht: bool | None = None
    if isinstance(capabilities, dict) and isinstance(capabilities.get("vision"), bool):
        sieht = capabilities["vision"]

    dep = rohdaten.get("deprecation")
    abschaltung = iso_datum(dep[:10]) if isinstance(dep, str) and len(dep) >= 10 else None

    return Modell(
        model_id=model_id,
        name=name,
        denkt=None,
        kontext_tokens=positive_zahl(rohdaten.get("max_context_length")),
        sieht=sieht,
        abschaltung=abschaltung,
    )
