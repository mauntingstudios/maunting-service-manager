"""Groq — LPU-Inferenz mit offiziellem Free Tier und OpenAI-kompatibler API."""

from __future__ import annotations

from services.ai_provider_registry.basis import Anbieter, Modell, positive_zahl


ANBIETER = Anbieter(
    kind="groq",
    label="Groq",
    base_url="https://api.groq.com/openai/v1",
    catalog_url="https://api.groq.com/openai/v1/models",
    key_url="https://console.groq.com/keys",
    key_prefix="gsk_",
    katalog_braucht_schluessel=True,
    gehoer_wege=("endpunkt",),
    gehoer_form="multipart",
    anfrage_erweiterungen=frozenset(),
    protokoll_chat="chat_completions",
)


def katalog_lesen(rohdaten: dict) -> Modell | None:
    """Liest einen Katalogeintrag von Groq (`/openai/v1/models`)."""
    raw_id = rohdaten.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        return None
    if rohdaten.get("active") is False:
        return None

    model_id = raw_id.strip()
    return Modell(
        model_id=model_id,
        name=model_id,
        denkt=None,
        kontext_tokens=positive_zahl(rohdaten.get("context_window")),
        max_ausgabe_tokens=positive_zahl(rohdaten.get("max_completion_tokens")),
        sieht=None,
    )
