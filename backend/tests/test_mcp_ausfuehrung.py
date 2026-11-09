"""MCP-Ausfuehrung: Katalog, Aufruf, Grenzen. Ohne Datenbank."""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from services.ai_action_errors import AiActionValidationError
from services.mcp import sicherheit
from services.mcp.ausfuehrung import (
    aufrufen,
    schemata_aus_server,
    server_id_aus_name,
    werkzeug_name,
)
from services.mcp.client import McpFehler


@pytest.fixture(autouse=True)
def _oeffentliche_dns(monkeypatch):
    monkeypatch.setattr(
        sicherheit.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )


def _server(werkzeuge: list[dict], **felder):
    basis = dict(
        id=7,
        name="Testserver",
        endpoint_url="https://mcp.example/rpc",
        auth_token_encrypted=None,
        cached_tools_json=json.dumps(werkzeuge),
        enabled=True,
        scope="user",
        user_id=1,
        team_id=None,
    )
    basis.update(felder)
    return SimpleNamespace(**basis)


def _werkzeug(**felder):
    basis = {
        "name": "query",
        "beschreibung": "Liest Daten",
        "schema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
        "nur_lesen": True,
    }
    basis.update(felder)
    return basis


def _transport(ergebnis_text: str = "Antwort", *, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        paket = json.loads(request.content)
        if status >= 400:
            return httpx.Response(status)
        if paket["method"] == "initialize":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": paket["id"], "result": {}})
        if paket["method"] == "tools/call":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": paket["id"],
                    "result": {"content": [{"type": "text", "text": ergebnis_text}]},
                },
            )
        return httpx.Response(202)

    return httpx.MockTransport(handler)


def test_name_traegt_serverkennung_und_ist_lesbar() -> None:
    name = werkzeug_name(7, "query/items")
    assert name.startswith("mcp_7_")
    assert server_id_aus_name(name) == 7
    assert server_id_aus_name("kein_mcp") is None


def test_nur_lesende_werkzeuge_werden_angeboten() -> None:
    row = _server([_werkzeug(), _werkzeug(name="schreiben", nur_lesen=False)])
    eintraege = schemata_aus_server(row)
    assert len(eintraege) == 1
    assert eintraege[0]["function"]["name"].startswith("mcp_7_")
    assert "Testserver" in eintraege[0]["function"]["description"]


def test_aufruf_liefert_den_text_des_servers() -> None:
    row = _server([_werkzeug()])
    ergebnis = aufrufen(row, _werkzeug(), {"q": "abc"}, transport=_transport("gefunden"))
    assert ergebnis["content"] == "gefunden"
    assert ergebnis["tool"] == "query"
    assert "fehler" not in ergebnis


def test_schreibwerkzeug_wird_nicht_ausgefuehrt() -> None:
    with pytest.raises(AiActionValidationError, match="noch nicht freigegeben"):
        aufrufen(_server([]), _werkzeug(nur_lesen=False), {})


def test_ungueltige_argumente_werden_vor_dem_aufruf_abgewiesen() -> None:
    with pytest.raises(AiActionValidationError, match="Ungueltige Argumente"):
        aufrufen(_server([]), _werkzeug(), {"q": 5}, transport=_transport())


def test_ein_serverfehler_wird_zu_einer_meldung_ohne_zugang() -> None:
    with pytest.raises(AiActionValidationError, match="MCP-Aufruf fehlgeschlagen"):
        aufrufen(_server([]), _werkzeug(), {"q": "abc"}, transport=_transport(status=500))


def test_lesewerkzeug_laeuft_ueber_den_lesepfad(monkeypatch) -> None:
    from services.ai_tools import server_tools

    gesehen = {}

    def fake_rufe(db, user, tool_name, arguments):
        gesehen.update(tool_name=tool_name, arguments=arguments)
        return {"content": "ok"}

    monkeypatch.setattr("services.mcp.ausfuehrung.rufe", fake_rufe)
    ergebnis = server_tools.execute_read_tool(
        None,
        user=SimpleNamespace(id=1),
        tool_name="mcp_7_query",
        arguments={"q": "abc"},
    )
    assert ergebnis == {"content": "ok"}
    assert gesehen == {"tool_name": "mcp_7_query", "arguments": {"q": "abc"}}


def test_schreibvorschlag_traegt_immer_bestaetigung() -> None:
    from services.mcp.ausfuehrung import vorschlag_aus

    payload, preview = vorschlag_aus(_server([]), _werkzeug(nur_lesen=False), {"q": "abc"})
    assert preview["always_confirm"] is True
    assert preview["operation"] == "mcp_call"
    assert payload["tool"] == "query"
    assert payload["arguments"] == {"q": "abc"}


def test_ein_lesewerkzeug_wird_kein_vorschlag() -> None:
    from services.mcp.ausfuehrung import vorschlag_aus

    with pytest.raises(AiActionValidationError, match="nicht ueber den Vorschlagspfad"):
        vorschlag_aus(_server([]), _werkzeug(), {"q": "abc"})


def test_schreibaufruf_braucht_die_ausdrueckliche_erlaubnis() -> None:
    row = _server([_werkzeug(nur_lesen=False)])
    with pytest.raises(AiActionValidationError, match="noch nicht freigegeben"):
        aufrufen(row, _werkzeug(nur_lesen=False), {"q": "abc"}, transport=_transport())
    ergebnis = aufrufen(
        row,
        _werkzeug(nur_lesen=False),
        {"q": "abc"},
        transport=_transport("geschrieben"),
        schreiben_erlaubt=True,
    )
    assert ergebnis["content"] == "geschrieben"


def test_hoechstens_acht_mcp_werkzeuge_je_turn() -> None:
    from services.mcp.ausfuehrung import MAX_JE_TURN, waehle_je_turn

    werkzeuge = [
        {
            "type": "function",
            "function": {
                "name": f"mcp_1_tool_{i:02d}",
                "description": "Backup erstellen" if i == 7 else "Etwas anderes",
            },
        }
        for i in range(12)
    ]
    gewaehlt = waehle_je_turn(werkzeuge, "Bitte ein Backup erstellen")
    assert len(gewaehlt) == MAX_JE_TURN == 8
    assert gewaehlt[0] == "mcp_1_tool_07", gewaehlt
    assert gewaehlt == waehle_je_turn(list(reversed(werkzeuge)), "Bitte ein Backup erstellen")


def test_ohne_frage_bleiben_die_ersten_acht_in_namensreihenfolge() -> None:
    from services.mcp.ausfuehrung import waehle_je_turn

    werkzeuge = [
        {"type": "function", "function": {"name": f"mcp_2_werkzeug_{i:02d}"}}
        for i in range(10)
    ]
    assert waehle_je_turn(werkzeuge, "") == [
        f"mcp_2_werkzeug_{i:02d}" for i in range(8)
    ]
