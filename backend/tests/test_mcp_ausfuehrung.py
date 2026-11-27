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


def test_die_semantische_auswahl_steht_vorn_und_wird_aufgefuellt() -> None:
    from services.mcp.ausfuehrung import waehle_je_turn

    werkzeuge = [
        {"type": "function", "function": {"name": f"mcp_3_tool_{i:02d}", "description": "egal"}}
        for i in range(12)
    ]
    gewaehlt = waehle_je_turn(
        werkzeuge, "irgendwas", semantisch=["mcp_3_tool_09", "unbekannt"]
    )
    assert gewaehlt[0] == "mcp_3_tool_09"
    assert len(gewaehlt) == 8
    assert len(set(gewaehlt)) == 8


def test_der_semantische_router_findet_das_passende_werkzeug() -> None:
    from services.mcp.ausfuehrung import semantisch_waehlen

    werkzeuge = [
        {
            "type": "function",
            "function": {
                "name": f"mcp_4_werkzeug_{i:02d}",
                "description": "Erstellt ein Backup der Datenbank" if i == 4 else "Etwas anderes",
            },
        }
        for i in range(10)
    ]
    gewaehlt = semantisch_waehlen(werkzeuge, "Bitte ein Datenbank-Backup erstellen", 8)
    assert gewaehlt, "Der Router hat nichts ausgewaehlt"
    assert gewaehlt[0] == "mcp_4_werkzeug_04", gewaehlt


def test_stdio_wird_nur_fuer_desktop_angeboten_und_baut_auftrag(monkeypatch) -> None:
    from services.mcp import ausfuehrung

    row = _server(
        [
            _werkzeug(name="read_channels", nur_lesen=True),
            _werkzeug(name="send_msg", nur_lesen=False),
        ],
        id=11,
        name="Discord Bot",
        transport="stdio",
        endpoint_url=None,
        command="npx",
        args_json=json.dumps(["-y", "@discord/mcp-server"]),
        auth_token_encrypted="Bot secret-123",
    )
    assert schemata_aus_server(row, desktop=False) == []
    assert len(schemata_aus_server(row, desktop=True)) == 1

    monkeypatch.setattr(ausfuehrung.permission_service, "has_global_permission", lambda *_a: True)
    monkeypatch.setattr(ausfuehrung, "sichtbare_server", lambda *_a: [row])
    monkeypatch.setattr(ausfuehrung, "_server_fuer", lambda *_a: row)

    panel_tools, panel_write = ausfuehrung.katalog(None, SimpleNamespace(id=1), herkunft="panel")
    assert panel_tools == []
    assert panel_write == frozenset()

    desk_tools, desk_write = ausfuehrung.katalog(None, SimpleNamespace(id=1), herkunft="desktop")
    assert len(desk_tools) == 2
    assert "mcp_11_send_msg" in desk_write

    read_job = ausfuehrung.stdio_auftrag_fuer_aufruf(
        None, SimpleNamespace(id=1), "mcp_11_read_channels", {"q": "general"}
    )
    assert read_job is not None
    assert read_job["command"] == "npx"
    assert read_job["args"] == ["-y", "@discord/mcp-server"]
    assert read_job["env"] == {"MCP_AUTH_HEADER": "Bot secret-123", "MCP_AUTH_TOKEN": "secret-123"}
    assert read_job["autonom"] is True

    write_job = ausfuehrung.stdio_auftrag_fuer_aufruf(
        None, SimpleNamespace(id=1), "mcp_11_send_msg", {"q": "hi"}
    )
    assert write_job is not None
    assert write_job["autonom"] is False

    with pytest.raises(AiActionValidationError, match="Ungueltige Argumente"):
        ausfuehrung.stdio_auftrag_fuer_aufruf(
            None, SimpleNamespace(id=1), "mcp_11_read_channels", {"q": 123}
        )


def test_kontext_block_filtert_stdio_und_ungepruefte_server(db) -> None:
    from models import AiMcpServer, User
    from services.ai_context_service import _mcp_servers_block

    user = User(username="mcp_ctx_user", email="mcp_ctx@example.com", password_hash="x")
    db.add(user)
    db.flush()

    db.add_all(
        [
            AiMcpServer(
                user_id=user.id,
                scope="user",
                name="Discord Stdio",
                transport="stdio",
                command="npx",
                args_json='["-y","@discord/mcp-server"]',
                cached_tools_json=json.dumps([{"name": "list_channels"}]),
                enabled=True,
            ),
            AiMcpServer(
                user_id=user.id,
                scope="user",
                name="Leerer HTTP",
                transport="http",
                endpoint_url="https://mcp.example/empty",
                cached_tools_json="[]",
                enabled=True,
            ),
            AiMcpServer(
                user_id=user.id,
                scope="user",
                name="Aktiver HTTP",
                transport="http",
                endpoint_url="https://mcp.example/ok",
                cached_tools_json=json.dumps([{"name": "get_status"}]),
                enabled=True,
            ),
        ]
    )
    db.flush()

    panel_block = _mcp_servers_block(db, user, herkunft="panel")
    assert "Aktiver HTTP" in panel_block
    assert "Discord Stdio" not in panel_block
    assert "Leerer HTTP" not in panel_block

    desktop_block = _mcp_servers_block(db, user, herkunft="desktop")
    assert "Aktiver HTTP" in desktop_block
    assert "Discord Stdio" in desktop_block
    assert "Leerer HTTP" not in desktop_block
