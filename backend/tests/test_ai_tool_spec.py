"""Der Weg vom Spec zum Handler, ohne Datenbank.

Die uebrigen Werkzeugtests brauchen PostgreSQL. Dieser hier prueft nur die
Verdrahtung: findet `_execute_global_read_tool` den Spec-Handler, und zeigt
jede deklarierte Schreibfaehigkeit auf denselben Bauer und Ausfuehrer, den die
Vorschlagstabellen tragen.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_proposals.lifecycle import _AUSFUEHRUNGEN, _GLOBALE_PAYLOADS
from services.ai_tool_spec import ALLE
from services.ai_tools import server_tools


def _benutzer() -> SimpleNamespace:
    return SimpleNamespace(id=7, username="test")


def test_ein_umgestelltes_lesewerkzeug_laeuft_ueber_seinen_spec_handler(monkeypatch) -> None:
    monkeypatch.setattr(
        permission_service,
        "has_global_permission",
        lambda db, user, recht: True,
    )
    import services.mailbox_service as mailbox

    monkeypatch.setattr(
        mailbox.MailboxService,
        "search_messages",
        staticmethod(lambda db, **kwargs: [{"id": 1}]),
    )

    ergebnis = server_tools._execute_global_read_tool(
        None,
        user=_benutzer(),
        tool_name="email_search",
        arguments={"query": "rechnung"},
    )

    assert ergebnis == {"messages": [{"id": 1}], "count": 1}


def test_der_spec_handler_prueft_das_recht_selbst(monkeypatch) -> None:
    monkeypatch.setattr(
        permission_service,
        "has_global_permission",
        lambda db, user, recht: False,
    )

    with pytest.raises(AiActionValidationError, match="Postfach-Einsicht"):
        server_tools._execute_global_read_tool(
            None,
            user=_benutzer(),
            tool_name="email_read",
            arguments={"message_id": "abc"},
        )


def test_jede_spec_zeigt_auf_denselben_bauer_und_ausfuehrer() -> None:
    for name, spec in ALLE.items():
        # Server-Writes bauen ueber `server_vorschlag`, nicht ueber die
        # globale Payload-Tabelle: dort haengen Serveraufloesung und
        # Guardian-Bindung.
        if spec.vorschlag is not None and spec.art != "server_write":
            assert _GLOBALE_PAYLOADS[name] is spec.vorschlag, name
        if spec.ausfuehren is not None:
            assert name in _AUSFUEHRUNGEN, name
            assert callable(spec.ausfuehren), name
        if spec.global_handler is not None:
            assert callable(spec.global_handler), name


def test_jede_spec_hat_einen_hinweis_und_ein_schema() -> None:
    for name, spec in ALLE.items():
        assert spec.hinweis.strip(), name
        assert spec.funktion["function"]["name"] == name
        assert spec.funktion["function"]["parameters"]["type"] == "object"
