"""Anthropic direkt (Claude API) — nativer Zugang über api.anthropic.com.

Spricht die native Messages API (``POST /v1/messages``) mit
``x-api-key`` und ``anthropic-version: 2023-06-01`` und holt aktuelle
Modelle live über ``GET /v1/models?limit=1000``.
"""

from __future__ import annotations

from services.ai_provider_registry.basis import Anbieter, Modell, iso_datum, positive_zahl


_EFFORT_STUFEN = ("max", "xhigh", "high", "medium", "low")


ANBIETER = Anbieter(
    kind="anthropic",
    label="Anthropic (Claude)",
    base_url="https://api.anthropic.com",
    catalog_url="https://api.anthropic.com/v1/models?limit=1000",
    key_url="https://platform.claude.com/settings/keys",
    key_prefix="sk-ant-",
    katalog_braucht_schluessel=True,
    schluessel_kopf="x-api-key",
    schluessel_praefix="",
    katalog_extra_headers=(("anthropic-version", "2023-06-01"),),
    faehigkeiten_aus="openrouter",
    faehigkeiten_praefix="anthropic/",
    anfrage_erweiterungen=frozenset({"cache_control", "tool_search"}),
    protokoll_chat="anthropic_messages",
    gehoer_wege=(),
    empfehlung=None,
)


def _stufen_aus_capabilities(effort_cap: object) -> tuple[str, ...]:
    if not isinstance(effort_cap, dict) or effort_cap.get("supported") is not True:
        return ()
    gefunden: list[str] = []
    for stufe in _EFFORT_STUFEN:
        eintrag = effort_cap.get(stufe)
        if isinstance(eintrag, dict) and eintrag.get("supported") is True:
            gefunden.append(stufe)
    return tuple(gefunden)


def katalog_lesen(rohdaten: dict) -> Modell | None:
    """Liest einen ``ModelInfo``-Eintrag aus Anthropics ``GET /v1/models``."""
    model_id = rohdaten.get("id")
    if not isinstance(model_id, str) or not model_id.strip():
        return None
    if rohdaten.get("lifecycle") == "retired":
        return None

    disp = rohdaten.get("display_name") or rohdaten.get("displayName")
    name = disp.strip() if isinstance(disp, str) and disp.strip() else model_id

    kontext_tokens = positive_zahl(
        rohdaten.get("max_input_tokens")
        if "max_input_tokens" in rohdaten
        else rohdaten.get("maxInputTokens")
    )
    max_ausgabe_tokens = positive_zahl(
        rohdaten.get("max_tokens")
        if "max_tokens" in rohdaten
        else rohdaten.get("maxTokens")
    )

    retires = rohdaten.get("retires_at") or rohdaten.get("retiresAt")
    abschaltung = (
        iso_datum(retires[:10])
        if isinstance(retires, str) and len(retires) >= 10
        else None
    )

    denkt: bool | None = None
    stufen: tuple[str, ...] = ()
    sieht: bool | None = None

    capabilities = rohdaten.get("capabilities")
    if isinstance(capabilities, dict):
        image_cap = capabilities.get("image_input")
        if isinstance(image_cap, dict) and isinstance(image_cap.get("supported"), bool):
            sieht = image_cap["supported"]

        thinking_cap = capabilities.get("thinking")
        if isinstance(thinking_cap, dict):
            if thinking_cap.get("supported") is False:
                denkt = False
            elif thinking_cap.get("supported") is True:
                stufen = _stufen_aus_capabilities(capabilities.get("effort"))
                if stufen:
                    denkt = True

    return Modell(
        model_id=model_id,
        name=name,
        denkt=denkt,
        stufen=stufen,
        kontext_tokens=kontext_tokens,
        max_ausgabe_tokens=max_ausgabe_tokens,
        cache_marke_noetig=True,
        sieht=sieht,
        abschaltung=abschaltung,
    )
