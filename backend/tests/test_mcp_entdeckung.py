"""MCP-Entdeckung: Cache und Stand, ohne Datenbank."""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from services.mcp import sicherheit
from services.mcp.client import McpFehler
from services.mcp.entdeckung import entdecke, pruefen_und_speichern


class _Db:
    def __init__(self) -> None:
        self.commits = 0

    def commit(self) -> None:
        self.commits += 1


@pytest.fixture(autouse=True)
def _oeffentliche_dns(monkeypatch):
    monkeypatch.setattr(
        sicherheit.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )


def _server(**felder):
    basis = dict(
        transport="http",
        endpoint_url="https://mcp.example/rpc",
        auth_token_encrypted="geheim",
        cached_tools_json=None,
        last_status=None,
        last_checked_at=None,
    )
    basis.update(felder)
    return SimpleNamespace(**basis)


def _transport(*, status: int = 200, werkzeuge=None, gesehen=None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if gesehen is not None:
            gesehen.append(request)
        if status >= 400:
            return httpx.Response(status)
        paket = json.loads(request.content)
        if paket["method"] == "initialize":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": paket["id"], "result": {"protocolVersion": "2025-03-26"}},
                headers={"Mcp-Session-Id": "s1"},
            )
        if paket["method"] == "tools/list":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": paket["id"], "result": {"tools": werkzeuge or []}},
            )
        return httpx.Response(202)

    return httpx.MockTransport(handler)


def test_entdeckung_liest_die_werkzeuge_mit_zugang() -> None:
    gesehen: list[httpx.Request] = []
    server = _server()
    werkzeuge = entdecke(
        server,
        transport=_transport(
            werkzeuge=[{"name": "query", "description": "Liest", "inputSchema": {"type": "object"}}],
            gesehen=gesehen,
        ),
    )
    assert [w["name"] for w in werkzeuge] == ["query"]
    assert gesehen[0].headers["Authorization"] == "Bearer geheim"


def test_pruefen_schreibt_cache_stand_und_zeitpunkt() -> None:
    db = _Db()
    server = _server()
    werkzeuge = pruefen_und_speichern(
        db,
        server,
        transport=_transport(werkzeuge=[{"name": "query", "description": "Liest"}]),
    )
    assert [w["name"] for w in werkzeuge] == ["query"]
    assert json.loads(server.cached_tools_json)[0]["name"] == "query"
    assert server.last_status == "ok"
    assert server.last_checked_at is not None
    assert db.commits == 1


def test_ein_fehler_loescht_den_cache_und_schreibt_den_grund() -> None:
    db = _Db()
    server = _server(cached_tools_json='[{"name":"alt"}]')
    werkzeuge = pruefen_und_speichern(db, server, transport=_transport(status=500))
    assert werkzeuge == []
    assert server.cached_tools_json is None
    assert server.last_status == "fehler:status_500"
    assert db.commits == 1


def test_stdio_wird_im_panel_abgelehnt() -> None:
    with pytest.raises(McpFehler, match="stdio_nur_desktop"):
        entdecke(_server(transport="stdio", endpoint_url=None))


def test_startbefehl_wird_in_programm_und_argumente_zerlegt() -> None:
    from routers.ai_mcp import _command_teile

    assert _command_teile('{"command": "npx", "args": ["-y", "server"]}') == (
        "npx",
        '["-y", "server"]',
    )
    assert _command_teile("node server.js") == ("node server.js", None)
    assert _command_teile("   ") == (None, None)


def test_gemeldete_werkzeuge_werden_geprueft_und_begrenzt() -> None:
    from services.mcp.entdeckung import normalisiere_werkzeuge

    werkzeuge = normalisiere_werkzeuge(
        [
            {"name": " query ", "beschreibung": "Liest", "nur_lesen": True, "schema": {"type": "object"}},
            {"name": "query", "schema": {"type": "object"}},
            {"name": "", "schema": {}},
            {"name": "gross", "schema": {"type": "object", "beschreibung": "x" * (70 * 1024)}},
            {"name": "böse/zeichen", "schema": "kein Objekt"},
        ]
    )
    namen = [eintrag["name"] for eintrag in werkzeuge]
    assert namen == ["query", "böse/zeichen"]
    assert werkzeuge[0]["nur_lesen"] is True
    assert werkzeuge[1]["schema"] == {"type": "object", "properties": {}}


def test_gemeldete_liste_schreibt_cache_und_stand() -> None:
    from services.mcp.entdeckung import normalisiere_werkzeuge, speichere_werkzeuge

    db = _Db()
    server = _server(transport="stdio", endpoint_url=None)
    werkzeuge = speichere_werkzeuge(
        db, server, normalisiere_werkzeuge([{"name": "echo", "nur_lesen": True}])
    )
    assert [w["name"] for w in werkzeuge] == ["echo"]
    assert json.loads(server.cached_tools_json)[0]["name"] == "echo"
    assert server.last_status == "ok"
    assert server.last_checked_at is not None
    assert db.commits == 1


def test_ein_lokales_programm_wird_nicht_als_panel_werkzeug_angeboten() -> None:
    from services.mcp.ausfuehrung import schemata_aus_server

    server = _server(
        transport="stdio",
        endpoint_url=None,
        cached_tools_json=json.dumps(
            [{"name": "echo", "beschreibung": "", "schema": {"type": "object"}, "nur_lesen": True}]
        ),
    )
    assert schemata_aus_server(server) == []
