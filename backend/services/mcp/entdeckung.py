"""Werkzeuge eines MCP-Servers entdecken und den Stand festhalten.

Die Werkzeugliste eines entfernten Servers ist eine Angabe des Gegenuebers.
Sie wird begrenzt gelesen (Name, Beschreibung, Schema, Leseart), im Feld
`cached_tools_json` abgelegt und von dort in den Prompt uebernommen — bis zur
naechsten Pruefung. Der Zugang wird nie mitgeschrieben.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models import AiMcpServer
from services.mcp.client import McpClient, McpFehler
from services.mcp.sicherheit import McpZielFehler


def entdecke(
    server: AiMcpServer,
    *,
    transport=None,
    erlaube_loopback: bool = False,
    timeout: float = 30.0,
) -> list[dict]:
    """Holt die Werkzeugliste ueber HTTP/SSE. `stdio` gehoert der Desktop-App."""
    if (server.transport or "http") not in {"http", "sse"}:
        raise McpFehler("stdio_nur_desktop")
    if not server.endpoint_url:
        raise McpFehler("endpunkt_fehlt")
    with McpClient(
        server.endpoint_url,
        token=server.auth_token_encrypted or None,
        transport=transport,
        timeout=timeout,
        erlaube_loopback=erlaube_loopback,
    ) as client:
        client.initialize()
        return client.tools_list()


MAX_WERKZEUGE = 128
MAX_BESCHREIBUNG = 2000
MAX_SCHEMA_BYTES = 64 * 1024


def normalisiere_werkzeuge(roh: list[dict]) -> list[dict]:
    """Prueft eine von der Desktop-App gemeldete Werkzeugliste.

    Die Liste kommt aus einem lokalen Programm und ist damit eine Angabe des
    Gegenuebers — dieselben Grenzen wie beim HTTP-Weg, nur hier statt im
    Client. Namen muessen eindeutig sein, das Schema bleibt ein Objekt.
    """
    werkzeuge: list[dict] = []
    gesehen: set[str] = set()
    for eintrag in roh[:MAX_WERKZEUGE]:
        if not isinstance(eintrag, dict):
            continue
        name = str(eintrag.get("name") or "").strip()
        if not name or len(name) > 128 or name in gesehen:
            continue
        schema = eintrag.get("schema")
        if not isinstance(schema, dict):
            schema = {"type": "object", "properties": {}}
        if len(json.dumps(schema).encode()) > MAX_SCHEMA_BYTES:
            continue
        gesehen.add(name)
        werkzeuge.append(
            {
                "name": name,
                "beschreibung": str(eintrag.get("beschreibung") or "")[:MAX_BESCHREIBUNG],
                "schema": schema,
                "nur_lesen": bool(eintrag.get("nur_lesen")),
            }
        )
    return werkzeuge


def speichere_werkzeuge(db: Session, server: AiMcpServer, werkzeuge: list[dict]) -> list[dict]:
    """Schreibt eine bereits geprüfte Werkzeugliste und den Stand, committet einmal."""
    server.cached_tools_json = json.dumps(werkzeuge, ensure_ascii=False) if werkzeuge else None
    server.last_status = "ok" if werkzeuge else "fehler:keine_werkzeuge"
    server.last_checked_at = datetime.now(timezone.utc)
    db.commit()
    return werkzeuge


def pruefen_und_speichern(
    db: Session,
    server: AiMcpServer,
    *,
    transport=None,
    erlaube_loopback: bool = False,
) -> list[dict]:
    """Prueft die Verbindung, schreibt Cache und Stand, committet einmal."""
    werkzeuge: list[dict] = []
    try:
        werkzeuge = entdecke(server, transport=transport, erlaube_loopback=erlaube_loopback)
        server.cached_tools_json = json.dumps(werkzeuge, ensure_ascii=False)
        server.last_status = "ok"
    except (McpFehler, McpZielFehler) as exc:
        grund = getattr(exc, "grund", None) or "ziel_abgelehnt"
        server.cached_tools_json = None
        server.last_status = f"fehler:{grund}"[:32]
    finally:
        server.last_checked_at = datetime.now(timezone.utc)
        db.commit()
    return werkzeuge
