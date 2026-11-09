"""MCP-Client: JSON-RPC ueber HTTPS.

Nur der Transport und die Protokollschritte. Was die Werkzeuge tun duerfen,
entscheidet der Aufrufer; was ein Server liefern darf, begrenzt dieses Modul.
Kein `stdio` hier — das laeuft ausschliesslich in der Desktop-App.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from services.mcp.sicherheit import (
    MAX_ANTWORT_BYTES,
    MAX_SCHEMA_BYTES,
    MAX_WERKZEUGE_JE_SERVER,
    McpZielFehler,
    pruefe_endpunkt,
)

PROTOKOLL_VERSION = "2025-03-26"


class McpFehler(RuntimeError):
    """Ein Fehler im MCP-Weg. `grund` ist ein stabiler Code, nie ein Token."""

    def __init__(self, grund: str, detail: str = "") -> None:
        super().__init__(grund if not detail else f"{grund}: {detail}")
        self.grund = grund


def _lese_antwort(inhalt: bytes, content_type: str) -> dict[str, Any]:
    if not inhalt:
        raise McpFehler("leere_antwort")
    text = inhalt.decode("utf-8", errors="replace")
    if "text/event-stream" in content_type.lower():
        for zeile in text.splitlines():
            if not zeile.startswith("data:"):
                continue
            roh = zeile[5:].strip()
            if not roh:
                continue
            try:
                daten = json.loads(roh)
            except json.JSONDecodeError:
                continue
            if isinstance(daten, dict) and ("result" in daten or "error" in daten):
                return daten
        raise McpFehler("sse_ohne_antwort")
    try:
        daten = json.loads(text)
    except json.JSONDecodeError as exc:
        raise McpFehler("antwort_kein_json") from exc
    if not isinstance(daten, dict):
        raise McpFehler("antwort_kein_objekt")
    return daten


class McpClient:
    def __init__(
        self,
        endpunkt: str,
        *,
        token: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
        erlaube_loopback: bool = False,
    ) -> None:
        self._endpunkt = pruefe_endpunkt(endpunkt, erlaube_loopback=erlaube_loopback)
        self._token = token
        self._session: str | None = None
        self._naechste_id = 0
        self._client = httpx.Client(
            timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)),
            follow_redirects=False,
            transport=transport,
        )

    def __enter__(self) -> "McpClient":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _ruf(self, methode: str, params: dict | None = None, *, meldung: bool = False) -> Any:
        paket: dict[str, Any] = {"jsonrpc": "2.0", "method": methode}
        if params is not None:
            paket["params"] = params
        if not meldung:
            self._naechste_id += 1
            paket["id"] = self._naechste_id
        kopf = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if self._session:
            kopf["Mcp-Session-Id"] = self._session
        if self._token:
            kopf["Authorization"] = f"Bearer {self._token}"
        try:
            antwort = self._client.post(self._endpunkt, json=paket, headers=kopf)
        except httpx.TimeoutException as exc:
            raise McpFehler("zeitueberschreitung") from exc
        except httpx.HTTPError as exc:
            raise McpFehler("netzfehler", type(exc).__name__) from exc

        if antwort.headers.get("Mcp-Session-Id"):
            self._session = antwort.headers["Mcp-Session-Id"]
        if 300 <= antwort.status_code < 400:
            raise McpFehler("weiterleitung")
        if antwort.status_code >= 400:
            raise McpFehler(f"status_{antwort.status_code}")
        if meldung:
            return None
        if len(antwort.content) > MAX_ANTWORT_BYTES:
            raise McpFehler("antwort_zu_gross")
        daten = _lese_antwort(antwort.content, antwort.headers.get("content-type", ""))
        if "error" in daten:
            fehler = daten.get("error") or {}
            code = fehler.get("code") if isinstance(fehler, dict) else None
            raise McpFehler("rpc_fehler", str(code or "ohne_code"))
        return daten.get("result")

    def initialize(self) -> dict[str, Any]:
        ergebnis = self._ruf(
            "initialize",
            {
                "protocolVersion": PROTOKOLL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "msm", "version": "1"},
            },
        )
        self._ruf("notifications/initialized", meldung=True)
        return ergebnis if isinstance(ergebnis, dict) else {}

    def tools_list(self) -> list[dict[str, Any]]:
        ergebnis = self._ruf("tools/list")
        roh = ergebnis.get("tools", []) if isinstance(ergebnis, dict) else []
        werkzeuge: list[dict[str, Any]] = []
        for eintrag in roh[:MAX_WERKZEUGE_JE_SERVER]:
            if not isinstance(eintrag, dict) or not eintrag.get("name"):
                continue
            schema = eintrag.get("inputSchema") or {"type": "object", "properties": {}}
            if len(json.dumps(schema).encode()) > MAX_SCHEMA_BYTES:
                raise McpFehler("schema_zu_gross")
            werkzeuge.append(
                {
                    "name": str(eintrag["name"]),
                    "beschreibung": str(eintrag.get("description") or "")[:2000],
                    "schema": schema,
                    "nur_lesen": bool(
                        (eintrag.get("annotations") or {}).get("readOnlyHint", False)
                    ),
                }
            )
        return werkzeuge

    def call_tool(self, name: str, arguments: dict | None = None) -> dict[str, Any]:
        if not name.strip():
            raise McpFehler("werkzeugname_fehlt")
        ergebnis = self._ruf("tools/call", {"name": name, "arguments": arguments or {}})
        if not isinstance(ergebnis, dict):
            raise McpFehler("ergebnis_kein_objekt")
        return ergebnis


__all__ = ["McpClient", "McpFehler", "McpZielFehler", "PROTOKOLL_VERSION"]
