"""Die zentrale Argumentpruefung: Schema, Meldung, Rollout.

Ohne Datenbank. Geprueft wird die Grenze selbst, nicht ein Handler.
"""

from __future__ import annotations

import pytest
from jsonschema import Draft202012Validator

from services import ai_tool_registry  # noqa: F401  (fuellt ALLE)
from services.ai_action_errors import AiActionValidationError
from services.ai_tool_spec import ALLE
from services.ai_tools.validierung import pruefe_argumente


def test_ein_gueltiger_aufruf_geht_durch() -> None:
    pruefe_argumente("email_search", {"query": "rechnung", "limit": 5})


def test_ein_falscher_typ_nennt_feld_und_erwartung_aber_nicht_den_wert() -> None:
    with pytest.raises(AiActionValidationError) as fehler:
        pruefe_argumente("email_search", {"limit": "viele"})

    text = str(fehler.value)
    assert "limit" in text
    assert "falscher Typ" in text
    assert "viele" not in text, "Der eingegangene Wert gehoert nicht in die Meldung"


def test_ein_zusaetzliches_feld_wird_abgelehnt_ohne_seinen_wert_zu_nennen() -> None:
    with pytest.raises(AiActionValidationError, match="unerlaubtes Feld") as fehler:
        pruefe_argumente("email_search", {"query": "x", "geheim": "SECRET"})

    assert "SECRET" not in str(fehler.value)


def test_ein_fehlendes_pflichtfeld_wird_genannt() -> None:
    with pytest.raises(AiActionValidationError, match="Pflichtfeld fehlt: message_id"):
        pruefe_argumente("email_read", {})


def test_die_kanonische_begruendung_bleibt_die_alte_schreibweise_faellt_weg() -> None:
    """`grund` ist ein Alias des Vorschlagspfads, kein Schemafeld."""
    pruefe_argumente(
        "propose_note_create",
        {"title": "T", "reason": "r", "expected_effect": "e", "grund": "alias"},
        aliase=frozenset({"grund", "begruendung", "reason", "expected_effect"}),
    )


def test_ohne_kanonische_begruendung_bleibt_das_pflichtfeld_offen() -> None:
    with pytest.raises(AiActionValidationError, match="Pflichtfeld fehlt"):
        pruefe_argumente(
            "propose_note_create",
            {"title": "T", "grund": "alias"},
            aliase=frozenset({"grund"}),
        )


def test_der_logmodus_wirft_nicht(monkeypatch, caplog) -> None:
    monkeypatch.setenv("MSM_AI_ARG_VALIDATION", "loggen")
    with caplog.at_level("WARNING"):
        pruefe_argumente("email_read", {})
    assert "Ungueltige Argumente fuer email_read" in caplog.text


def test_ein_unbekanntes_werkzeug_wird_uebergangen() -> None:
    pruefe_argumente("gibt_es_nicht", {"x": 1})


def test_jedes_schema_ist_ein_gueltiges_json_schema() -> None:
    for spec in ALLE.values():
        Draft202012Validator.check_schema(spec.funktion["function"]["parameters"])
