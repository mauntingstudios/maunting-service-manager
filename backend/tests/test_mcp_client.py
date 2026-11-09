"""MCP-Client und Zielpruefung, ohne Datenbank und ohne Netz."""

from __future__ import annotations

import json

import httpx
import pytest

from services.mcp import sicherheit
from services.mcp.client import McpClient, McpFehler
from services.mcp.sicherheit import McpZielFehler, pruefe_endpunkt

@pytest.fixture(autouse=True)
def _oeffentliche_dns(monkeypatch):
    monkeypatch.setattr(
        sicherheit.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )


def _klient(handler, *, token: str | None = None) -> McpClient:
    return McpClient(
        "https://mcp.example/rpc",
        token=token,
        transport=httpx.MockTransport(handler),
    )


def test_initialize_schickt_protokoll_und_behaelt_die_sitzung() -> None:
    gesehen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        gesehen.append(request)
        paket = json.loads(request.content)
        if paket["method"] == "initialize":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": paket["id"], "result": {"protocolVersion": "2025-03-26"}},
                headers={"Mcp-Session-Id": "sitzung-1"},
            )
        return httpx.Response(202 if paket.get("id") is None else 200, json={"jsonrpc": "2.0", "id": paket.get("id"), "result": {}})

    with _klient(handler) as client:
        assert client.initialize()["protocolVersion"] == "2025-03-26"
        assert client.tools_list() == []

    erste = json.loads(gesehen[0].content)
    assert erste["method"] == "initialize"
    assert erste["params"]["clientInfo"]["name"] == "msm"
    assert gesehen[1].headers["Mcp-Session-Id"] == "sitzung-1"


def test_werkzeugliste_wird_begrenzt_und_liest_die_leseart() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        paket = json.loads(request.content)
        werkzeuge = [
            {
                "name": f"tool_{i}",
                "description": "x" * 3000,
                "inputSchema": {"type": "object", "properties": {}},
                "annotations": {"readOnlyHint": i == 0},
            }
            for i in range(12)
        ]
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": paket["id"], "result": {"tools": werkzeuge}})

    with _klient(handler) as client:
        liste = client.tools_list()
    assert len(liste) == 8
    assert liste[0]["nur_lesen"] is True
    assert liste[1]["nur_lesen"] is False
    assert len(liste[0]["beschreibung"]) == 2000


def test_werkzeugaufruf_schickt_namen_und_argumente() -> None:
    gesehen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paket = json.loads(request.content)
        gesehen.append(paket)
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": paket["id"], "result": {"content": [{"type": "text", "text": "ok"}]}},
        )

    with _klient(handler) as client:
        ergebnis = client.call_tool("suche", {"q": "abc"})

    assert ergebnis["content"][0]["text"] == "ok"
    assert gesehen[-1]["method"] == "tools/call"
    assert gesehen[-1]["params"] == {"name": "suche", "arguments": {"q": "abc"}}


def test_ein_rpc_fehler_wird_zu_mcp_fehler() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        paket = json.loads(request.content)
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": paket["id"], "error": {"code": -32602}},
        )

    with _klient(handler) as client, pytest.raises(McpFehler, match="rpc_fehler"):
        client.tools_list()


def test_eine_zu_grosse_antwort_wird_abgewiesen() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        paket = json.loads(request.content)
        return httpx.Response(
            200,
            content=b"x" * (sicherheit.MAX_ANTWORT_BYTES + 1),
            headers={"content-type": "application/json"},
        )

    with _klient(handler) as client, pytest.raises(McpFehler, match="antwort_zu_gross"):
        client.tools_list()


def test_eine_sse_antwort_wird_gelesen() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        paket = json.loads(request.content)
        daten = json.dumps({"jsonrpc": "2.0", "id": paket["id"], "result": {"tools": []}})
        return httpx.Response(
            200,
            text=f"event: message\ndata: {daten}\n\n",
            headers={"content-type": "text/event-stream"},
        )

    with _klient(handler) as client:
        assert client.tools_list() == []


def test_weiterleitung_und_serverfehler_werden_abgewiesen() -> None:
    for status in (302, 500):
        def handler(request: httpx.Request, status=status) -> httpx.Response:
            return httpx.Response(status, headers={"location": "https://anders.example"})

        with _klient(handler) as client, pytest.raises(McpFehler):
            client.tools_list()


def test_http_und_zugangsdaten_in_der_adresse_sind_verboten() -> None:
    with pytest.raises(McpZielFehler):
        pruefe_endpunkt("http://mcp.example/rpc")
    with pytest.raises(McpZielFehler):
        pruefe_endpunkt("https://nutzer:geheim@mcp.example/rpc")


def test_private_und_metadaten_adressen_sind_verboten(monkeypatch) -> None:
    for adresse in ("10.0.0.5", "127.0.0.1", "169.254.169.254", "100.64.0.1"):
        monkeypatch.setattr(
            sicherheit.socket,
            "getaddrinfo",
            lambda *args, adresse=adresse, **kwargs: [(2, 1, 6, "", (adresse, 443))],
        )
        with pytest.raises(McpZielFehler):
            pruefe_endpunkt("https://mcp.example/rpc")


def test_loopback_ist_nur_ausdruecklich_erlaubt(monkeypatch) -> None:
    monkeypatch.setattr(
        sicherheit.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("127.0.0.1", 8000))],
    )
    assert pruefe_endpunkt("http://127.0.0.1:8000/rpc", erlaube_loopback=True)
    with pytest.raises(McpZielFehler):
        pruefe_endpunkt("https://127.0.0.1/rpc")
