"""Drift-Test: ein Werkzeug ist an jeder Stelle dasselbe.

Der Umbau auf `ToolSpec` verschiebt Verantwortung. Dieser Test haelt fest, was
dabei nicht brechen darf, und zwar ueber alle Achsen zugleich:

* Katalog und Registry nennen dieselben Werkzeuge, jedes Schema ist ein
  wohlgeformtes Objekt.
* Jedes Recht steht im Berechtigungskatalog.
* Jede Schreibfaehigkeit hat einen Payload-Bauer und einen Ausfuehrer.
* Der Chat hat fuer jedes Werkzeug einen Text, in beiden Sprachen.
* Das Frontend kennt dieselben Schreibwerkzeuge.
* Sprachmodus und Werkzeugauswahl nennen keine erfundenen Namen.

Ersetzt `test_ai_tool_label_contract.py`. Die Erreichbarkeit der Handler prueft
weiterhin `test_ai_tool_handler_contract.py`, bis der Dispatch auf den Spec
umgestellt ist.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from services import ai_tool_registry as registry
from services.ai_proposals.lifecycle import _AUSFUEHRUNGEN, _GLOBALE_PAYLOADS
from services.ai_tools import server_tools
from services.ai_tools.geo_tools import voice_control_tool_definitions
from services.permission_catalog import ALL_KEYS

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend" / "src"
LOCALES = FRONTEND / "locales"
SPRACHEN = ("de", "en")


@pytest.fixture(scope="module")
def katalog() -> dict[str, dict]:
    """Alle 123 Definitionen, unabhaengig von der Betreiberkonfiguration."""
    import services.ai_learning_policy as learning_policy
    import services.ai_web_search_service as web_search
    import services.cloudflare_service as cloudflare_service

    alt = (
        web_search.is_configured,
        cloudflare_service.is_configured,
        learning_policy.policy,
    )
    web_search.is_configured = lambda: True
    cloudflare_service.is_configured = lambda: True
    learning_policy.policy = lambda: "review"
    try:
        defs = [*server_tools.provider_tool_definitions(), *voice_control_tool_definitions()]
    finally:
        (
            web_search.is_configured,
            cloudflare_service.is_configured,
            learning_policy.policy,
        ) = alt
    return {d["function"]["name"]: d["function"] for d in defs}


def _texte(sprache: str) -> dict:
    pfad = LOCALES / f"{sprache}.json"
    assert pfad.is_file(), f"Locale-Datei nicht gefunden: {pfad}"
    return json.loads(pfad.read_text(encoding="utf-8"))


def _abschnitt(sprache: str, pfad: str) -> dict:
    knoten: object = _texte(sprache)
    for teil in pfad.split("."):
        assert isinstance(knoten, dict), f"{pfad} ist in {sprache}.json kein Objekt"
        knoten = knoten.get(teil, {})
    assert isinstance(knoten, dict)
    return knoten


def _zwischen(pfad: Path, anfang: str, ende: str) -> str:
    text = pfad.read_text(encoding="utf-8")
    start = text.index(anfang) + len(anfang)
    return text[start : text.index(ende, start)]


def _ts_liste(pfad: Path, anfang: str, ende: str) -> set[str]:
    return set(re.findall(r"'([^']+)'", _zwischen(pfad, anfang, ende)))


def test_katalog_und_registry_nennen_dieselben_werkzeuge(katalog: dict[str, dict]) -> None:
    assert len(katalog) == len(registry.WERKZEUGE) == 123
    assert set(katalog) == set(registry.WERKZEUGE)


def test_jedes_schema_ist_ein_wohlgeformtes_objekt(katalog: dict[str, dict]) -> None:
    for name, funktion in katalog.items():
        parameter = funktion.get("parameters")
        assert isinstance(parameter, dict), f"{name}: parameters fehlt"
        assert parameter.get("type") == "object", f"{name}: type ist nicht object"
        assert isinstance(parameter.get("properties"), dict), f"{name}: properties fehlt"
        assert parameter.get("additionalProperties") is False, (
            f"{name}: additionalProperties ist nicht false"
        )
        pflicht = parameter.get("required", [])
        assert isinstance(pflicht, list), f"{name}: required ist keine Liste"
        fehlend = [feld for feld in pflicht if feld not in parameter["properties"]]
        assert not fehlend, f"{name}: required nennt unbekannte Felder {fehlend}"
        assert funktion.get("description", "").strip(), f"{name}: Beschreibung fehlt"


def test_jedes_recht_steht_im_berechtigungskatalog() -> None:
    for name, werkzeug in registry.WERKZEUGE.items():
        rechte = set(werkzeug.angebot)
        if werkzeug.recht:
            rechte.add(werkzeug.recht)
        unbekannt = rechte - set(ALL_KEYS)
        assert not unbekannt, f"{name} nennt unbekannte Rechte: {sorted(unbekannt)}"


def test_jede_schreibfaehigkeit_hat_bauer_und_ausfuehrer() -> None:
    assert set(registry.WRITE_TOOLS) <= set(_AUSFUEHRUNGEN)
    globale = {
        name
        for name, werkzeug in registry.WERKZEUGE.items()
        if werkzeug.art == "global_write"
    }
    assert globale <= set(_GLOBALE_PAYLOADS)


@pytest.mark.parametrize("sprache", SPRACHEN)
def test_jedes_lesewerkzeug_hat_einen_namen(sprache: str) -> None:
    texte = _abschnitt(sprache, "ai.tools")
    fehlend = sorted(
        name
        for name in registry.WERKZEUGE
        if name not in registry.WRITE_TOOLS and not texte.get(name)
    )
    assert not fehlend, f"Ohne Text in {sprache}.json unter ai.tools: {fehlend}"


@pytest.mark.parametrize("sprache", SPRACHEN)
def test_jedes_schreibwerkzeug_hat_namen_und_bestaetigung(sprache: str) -> None:
    namen = _abschnitt(sprache, "ai.actions.tools")
    saetze = _abschnitt(sprache, "ai.actions.confirm")
    ohne_namen = sorted(name for name in registry.WRITE_TOOLS if not namen.get(name))
    ohne_satz = sorted(
        name for name in registry.WRITE_TOOLS if not str(saetze.get(name, "")).strip()
    )
    assert not ohne_namen, f"Ohne Text in {sprache}.json unter ai.actions.tools: {ohne_namen}"
    assert not ohne_satz, f"Ohne Text in {sprache}.json unter ai.actions.confirm: {ohne_satz}"


@pytest.mark.parametrize("sprache", SPRACHEN)
def test_jedes_werkzeug_hat_einen_verlaufssatz(sprache: str) -> None:
    texte = _abschnitt(sprache, "ai.toolsRunning")
    fehlend = sorted(name for name in registry.WERKZEUGE if not texte.get(name))
    assert not fehlend, f"Ohne Text in {sprache}.json unter ai.toolsRunning: {fehlend}"


def test_de_und_en_haben_dieselben_schluessel() -> None:
    for pfad in (
        "ai.tools",
        "ai.toolsRunning",
        "ai.actions.tools",
        "ai.actions.confirm",
    ):
        de = set(_abschnitt("de", pfad))
        en = set(_abschnitt("en", pfad))
        assert de == en, (
            f"{pfad}: nur deutsch {sorted(de - en)}, nur englisch {sorted(en - de)}"
        )


def test_das_frontend_kennt_dieselben_schreibwerkzeuge() -> None:
    frontend = _ts_liste(
        FRONTEND / "api" / "ai.ts",
        "export const SCHREIBWERKZEUGE = [",
        "] as const",
    )
    assert frontend == set(registry.WRITE_TOOLS)


def test_unumkehrbar_ist_immer_eine_schreibfaehigkeit() -> None:
    rot = _ts_liste(
        FRONTEND / "components" / "ai" / "AiActionProposalCard.tsx",
        "const UNUMKEHRBAR: readonly string[] = [",
        "\n]",
    )
    assert rot <= set(registry.WRITE_TOOLS)
    assert rot, "Die Liste der unumkehrbaren Werkzeuge ist leer geworden"


def test_die_symbole_nennen_nur_bekannte_werkzeuge() -> None:
    block = _zwischen(
        FRONTEND / "components" / "ai" / "AiActionProposalCard.tsx",
        "const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {",
        "\n  }\n  const Icon",
    )
    namen = set(re.findall(r"(?m)^\s+([a-z0-9_]+):", block))
    assert namen <= set(registry.WERKZEUGE)
    assert namen, "Die Symboltabelle ist leer geworden"


def test_die_sprachlisten_nennen_nur_bekannte_werkzeuge() -> None:
    from services.ai_voice.realtime_session import REALTIME_SCHWER
    from services.tool_selection_port import DOMAIN_PACKS, HOTSET

    block = _zwischen(
        ROOT / "backend" / "services" / "ai_voice" / "realtime_session.py",
        "realtime_static_extra = {",
        "\n    }",
    )
    statisch = set(re.findall(r'"([a-z0-9_]+)"', block))

    bekannt = set(registry.WERKZEUGE)
    assert set(REALTIME_SCHWER) <= bekannt, sorted(set(REALTIME_SCHWER) - bekannt)
    assert statisch <= bekannt, sorted(statisch - bekannt)
    assert set(HOTSET) <= bekannt, sorted(set(HOTSET) - bekannt)
    for pack, namen in DOMAIN_PACKS.items():
        assert set(namen) <= bekannt, f"{pack}: {sorted(set(namen) - bekannt)}"
