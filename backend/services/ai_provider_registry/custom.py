"""Custom / Self-Hosted Anbieter — Ollama, LM Studio, llama.cpp, vLLM, Whisper STT.

Dieser Anbieter bringt keine programmfeste Zieladresse mit. Basis-URL,
Chat-Protokoll, Reasoning-Dialekt sowie optionale manuelle Grenzen (Kontext,
Ausgabetokens, Vision) werden am jeweiligen `AiProvider`-Datensatz gepflegt und
ueber `ai_custom_ssrf` beim Speichern wie vor jedem Request geprueft und auf
ihre aufgeloeste IP gepinnt.

Realtime / Live-Voice ist bewusst nicht enthalten (`sprachwege=()`), da fuer
lokale bzw. selbst gehostete Server im Jahr 2026 kein herstelleruebergreifender
Offener Realtime-Standard existiert. Standardisiertes Whisper-STT ueber
``POST /audio/transcriptions`` (`multipart/form-data`) wird vollstaendig
unterstuetzt.
"""

from __future__ import annotations

from services.ai_provider_registry.basis import Anbieter, Modell, positive_zahl


ANBIETER = Anbieter(
    kind="custom",
    label="Custom / Lokal (Ollama, vLLM, LM Studio, Whisper)",
    base_url="",
    catalog_url="",
    key_url="",
    key_prefix=None,
    katalog_braucht_schluessel=False,
    schluessel_kopf="Authorization",
    schluessel_praefix="Bearer ",
    katalog_liste_feld="data",
    empfehlung=None,
    gehoer_wege=("endpunkt",),
    gehoer_form="multipart",
    anfrage_erweiterungen=frozenset(),
    protokoll_chat="chat_completions",
    sprachwege=(),
    adresse_eintragbar=True,
)


def _kontext_aus_rohdaten(rohdaten: dict) -> int | None:
    meta = rohdaten.get("meta")
    meta_dict = meta if isinstance(meta, dict) else {}
    top = rohdaten.get("top_provider")
    top_dict = top if isinstance(top, dict) else {}
    for kandidat in (
        rohdaten.get("max_model_len"),          # vLLM / SGLang
        rohdaten.get("max_context_length"),     # LM Studio
        rohdaten.get("context_length"),         # OpenRouter / llama.cpp / LM Studio
        rohdaten.get("context_window"),
        rohdaten.get("n_ctx_train"),            # llama.cpp
        meta_dict.get("n_ctx_train"),           # llama.cpp meta
        top_dict.get("context_length"),
        rohdaten.get("input_token_limit"),
        rohdaten.get("inputTokenLimit"),
    ):
        wert = positive_zahl(kandidat)
        if wert is not None:
            return wert
    return None


def _ausgabe_aus_rohdaten(rohdaten: dict) -> int | None:
    top = rohdaten.get("top_provider")
    top_dict = top if isinstance(top, dict) else {}
    for kandidat in (
        rohdaten.get("max_output_tokens"),
        rohdaten.get("max_completion_tokens"),
        rohdaten.get("max_tokens"),
        top_dict.get("max_completion_tokens"),
        rohdaten.get("output_token_limit"),
        rohdaten.get("outputTokenLimit"),
    ):
        wert = positive_zahl(kandidat)
        if wert is not None:
            return wert
    return None


def _sieht_aus_rohdaten(rohdaten: dict) -> bool | None:
    capabilities = rohdaten.get("capabilities")
    if isinstance(capabilities, list):
        lowered = {str(item).strip().lower() for item in capabilities if isinstance(item, str)}
        if "vision" in lowered or "image" in lowered:
            return True

    arch = rohdaten.get("architecture")
    if isinstance(arch, dict) and isinstance(arch.get("input_modalities"), list):
        modalities = {str(m).strip().lower() for m in arch["input_modalities"] if isinstance(m, str)}
        return "image" in modalities

    top_modalities = rohdaten.get("input_modalities")
    if isinstance(top_modalities, list):
        modalities = {str(m).strip().lower() for m in top_modalities if isinstance(m, str)}
        return "image" in modalities

    if isinstance(rohdaten.get("vision"), bool):
        return bool(rohdaten["vision"])

    model_type = rohdaten.get("type")
    if isinstance(model_type, str) and model_type.strip().lower() == "vlm":
        return True

    return None


def _denken_aus_rohdaten(rohdaten: dict) -> tuple[bool | None, tuple[str, ...], str | None, bool]:
    capabilities = rohdaten.get("capabilities")
    if isinstance(capabilities, list):
        lowered = {str(item).strip().lower() for item in capabilities if isinstance(item, str)}
        if "thinking" in lowered or "reasoning" in lowered:
            return True, (), None, False

    reasoning = rohdaten.get("reasoning")
    if isinstance(reasoning, bool):
        return reasoning, (), None, False
    if isinstance(reasoning, dict):
        raw_efforts = reasoning.get("supported_efforts")
        efforts = (
            tuple(item for item in raw_efforts if isinstance(item, str) and item)
            if isinstance(raw_efforts, list)
            else ()
        )
        default_effort = reasoning.get("default_effort")
        return (
            True,
            efforts,
            default_effort if isinstance(default_effort, str) and default_effort else None,
            bool(reasoning.get("mandatory")),
        )

    if isinstance(rohdaten.get("thinking"), bool):
        return bool(rohdaten["thinking"]), (), None, False

    params = rohdaten.get("supported_parameters")
    if isinstance(params, list):
        p_set = {str(p).strip().lower() for p in params if isinstance(p, str)}
        if p_set & {"reasoning", "reasoning_effort", "include_reasoning"}:
            return True, (), None, False

    return None, (), None, False


def katalog_lesen(rohdaten: dict) -> Modell | None:
    """Liest einen Katalogeintrag aus OpenAI-/Ollama-/vLLM-/LM-Studio-/Anthropic-Endpunkten."""
    raw_id = rohdaten.get("id") or rohdaten.get("model") or rohdaten.get("name")
    if not isinstance(raw_id, str) or not raw_id.strip():
        return None
    model_id = raw_id.strip()

    raw_name = rohdaten.get("display_name") or rohdaten.get("name") or model_id
    name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else model_id

    denkt, stufen, standard_stufe, zwingend = _denken_aus_rohdaten(rohdaten)
    return Modell(
        model_id=model_id,
        name=name,
        denkt=denkt,
        stufen=stufen,
        standard_stufe=standard_stufe,
        zwingend=zwingend,
        kontext_tokens=_kontext_aus_rohdaten(rohdaten),
        max_ausgabe_tokens=_ausgabe_aus_rohdaten(rohdaten),
        sieht=_sieht_aus_rohdaten(rohdaten),
    )
