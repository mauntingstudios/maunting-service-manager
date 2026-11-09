"""Werkzeugverzeichnis im Systemprompt: vollstaendig, begrenzt, deterministisch."""

from __future__ import annotations

import re

from services import ai_tool_registry as registry
from services.ai_prompt import WERKZEUG_INDEX_BUDGET, werkzeug_index


def _namen(index: str) -> list[str]:
    return re.findall(r"^- ([a-z0-9_]+)(?: — .*)?$", index, flags=re.MULTILINE)


def test_das_verzeichnis_haelt_das_budget_und_traegt_jedes_schreibwerkzeug() -> None:
    index = werkzeug_index(registry.WERKZEUGE)
    assert len(index) <= WERKZEUG_INDEX_BUDGET
    namen = _namen(index)
    assert len(namen) == len(set(namen)), "ein Werkzeug steht doppelt im Verzeichnis"
    fehlend = sorted(registry.WRITE_TOOLS - set(namen))
    assert not fehlend, f"Schreibwerkzeuge fehlen im Verzeichnis: {fehlend}"
    assert set(namen) <= set(registry.WERKZEUGE), "Verzeichnis nennt ein unbekanntes Werkzeug"
    assert index.startswith("Werkzeugverzeichnis")


def test_nur_die_angebotenen_werkzeuge_stehen_drin() -> None:
    index = werkzeug_index({"ask_user", "email_read", "unbekannt"})
    assert set(_namen(index)) == {"ask_user", "email_read"}


def test_die_reihenfolge_haengt_nicht_von_der_eingabe_ab() -> None:
    a = werkzeug_index(["email_read", "read_memory", "ask_user"])
    b = werkzeug_index(["ask_user", "email_read", "read_memory"])
    assert a == b


def test_ohne_werkzeuge_gibt_es_kein_verzeichnis() -> None:
    assert werkzeug_index(set()) == ""
    assert werkzeug_index({"unbekannt"}) == ""


def test_gruppen_mit_schreibwerkzeugen_stehen_vorn() -> None:
    index = werkzeug_index(registry.WERKZEUGE)
    vorne = index.split("[", 1)[1].split("]", 1)[0]
    assert any(
        registry.WERKZEUGE[name].gruppe == vorne for name in registry.WRITE_TOOLS
    ), f"Die erste Gruppe {vorne!r} traegt kein Schreibwerkzeug"
