"""MCP-Werkzeuge anbieten und aufrufen.

Nur Werkzeuge mit `readOnlyHint` werden angeboten; Schreibwerkzeuge folgen,
sobald sie denselben Bestaetigungspfad haben wie die uebrigen Vorschlaege.
Der Name traegt die Serverkennung (`mcp_<id>_<name>`), damit der Aufruf ohne
zweite Zuordnungstabelle auskommt.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from typing import Any

from jsonschema import Draft202012Validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import AiMcpServer, TeamMember, User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.mcp.client import McpClient, McpFehler
from services.mcp.sicherheit import McpZielFehler

logger = logging.getLogger(__name__)

PRAEFIX = "mcp_"
MAX_AUSGABE = 16_000
#: So viele MCP-Werkzeuge gehen hoechstens in einen Turn. Bei einem Konto mit
#: vielen Servern waere der ganze Katalog sonst groesser als der Verlauf.
MAX_JE_TURN = 8
_SICHTBARE_SCOPES = {"global", "team", "user"}


def _saeuber(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:48]


def werkzeug_name(server_id: int, werkzeug: str) -> str:
    return f"{PRAEFIX}{server_id}_{_saeuber(werkzeug)}"


def server_id_aus_name(tool_name: str) -> int | None:
    if not tool_name.startswith(PRAEFIX):
        return None
    rest = tool_name[len(PRAEFIX):]
    kennung, _, _ = rest.partition("_")
    return int(kennung) if kennung.isdigit() else None


def _werkzeuge_aus_cache(row: AiMcpServer) -> list[dict]:
    try:
        daten = json.loads(row.cached_tools_json or "[]")
    except json.JSONDecodeError:
        return []
    return [eintrag for eintrag in daten if isinstance(eintrag, dict) and eintrag.get("name")]


def _schema_aus_tool(row: AiMcpServer, tool: dict) -> dict:
    schema = tool.get("schema")
    parameter = schema if isinstance(schema, dict) else {"type": "object", "properties": {}}
    return {
        "type": "function",
        "function": {
            "name": werkzeug_name(int(row.id), str(tool["name"])),
            "description": f"[MCP {row.name}] {tool.get('beschreibung') or tool['name']}"[:1024],
            "parameters": parameter,
        },
    }


def _ist_entfernt(row: AiMcpServer) -> bool:
    """Nur HTTP/SSE ist vom Panel aus aufrufbar.

    Ein lokales Programm (`stdio`) laeuft am Rechner des Benutzers; sein
    Aufruf braucht den Weg ueber die Desktop-App. Solange der nicht steht,
    wird es nicht angeboten — ein Katalogeintrag, den jeder Aufruf mit
    "kein Endpunkt" quittiert, waere eine Zusage ohne Deckung.
    """
    return (getattr(row, "transport", None) or "http") in {"http", "sse"}


def schemata_aus_server(row: AiMcpServer) -> list[dict]:
    """Katalogeintraege eines Servers — nur lesende, vom Panel aufrufbare Werkzeuge."""
    if not _ist_entfernt(row):
        return []
    return [_schema_aus_tool(row, tool) for tool in _werkzeuge_aus_cache(row) if tool.get("nur_lesen")]


def katalog(db: Session, user: User) -> tuple[list[dict], frozenset[str]]:
    """Alle MCP-Werkzeuge des Benutzers und die Namen der schreibenden.

    Die Namen der Schreibwerkzeuge braucht die Stream-Schleife: ohne sie
    landeten sie im Lesepfad, und der kennt keine Vorschlagskarte.
    """
    if not permission_service.has_global_permission(db, user, "ai.mcp.use"):
        return [], frozenset()
    schemas: list[dict] = []
    schreibend: set[str] = set()
    for row in sichtbare_server(db, user):
        if not _ist_entfernt(row):
            continue
        for tool in _werkzeuge_aus_cache(row):
            schema = _schema_aus_tool(row, tool)
            schemas.append(schema)
            if not tool.get("nur_lesen"):
                schreibend.add(schema["function"]["name"])
    return schemas, frozenset(schreibend)


def schemata(db: Session, user: User) -> list[dict]:
    """Alle angebotenen MCP-Lesewerkzeuge des Benutzers."""
    if not permission_service.has_global_permission(db, user, "ai.mcp.use"):
        return []
    return [eintrag for row in sichtbare_server(db, user) for eintrag in schemata_aus_server(row)]


def sichtbare_server(db: Session, user: User) -> list[AiMcpServer]:
    team_ids = [
        r.team_id for r in db.query(TeamMember).filter(TeamMember.user_id == user.id).all()
    ]
    bedingungen = [
        AiMcpServer.enabled.is_(True),
        or_(
            AiMcpServer.scope == "global",
            (AiMcpServer.scope == "user") & (AiMcpServer.user_id == user.id),
            (AiMcpServer.scope == "team") & (AiMcpServer.team_id.in_(team_ids)),
        ),
    ]
    return db.query(AiMcpServer).filter(*bedingungen).all()


def _server_fuer(db: Session, user: User, server_id: int) -> AiMcpServer | None:
    row = db.get(AiMcpServer, server_id)
    if row is None or not row.enabled or row.scope not in _SICHTBARE_SCOPES:
        return None
    if row.scope == "global":
        return row
    if row.scope == "team" and row.team_id is not None:
        member = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == row.team_id, TeamMember.user_id == user.id)
            .first()
        )
        return row if member is not None else None
    if row.scope == "user" and row.user_id == user.id:
        return row
    return None


def _pruefe_argumente(tool: dict, arguments: dict) -> None:
    schema = tool.get("schema")
    if not isinstance(schema, dict):
        return
    fehler = next(Draft202012Validator(schema).iter_errors(arguments), None)
    if fehler is None:
        return
    pfad = "/".join(str(teil) for teil in fehler.absolute_path) or "(root)"
    raise AiActionValidationError(
        f"Ungueltige Argumente fuer {tool['name']}: {pfad}: {fehler.validator}"[:200]
    )


def _ausgabe(ergebnis: dict) -> tuple[str, bool]:
    fehler = bool(ergebnis.get("isError"))
    teile: list[str] = []
    for eintrag in ergebnis.get("content") or []:
        if isinstance(eintrag, dict) and eintrag.get("type") == "text":
            teile.append(str(eintrag.get("text") or ""))
    text = redact_sensitive_text("\n".join(teile))[:MAX_AUSGABE]
    return text, fehler


def aufrufen(
    row: AiMcpServer,
    tool: dict,
    arguments: dict,
    *,
    transport=None,
    erlaube_loopback: bool = False,
    schreiben_erlaubt: bool = False,
) -> dict[str, Any]:
    """Ruft ein einzelnes MCP-Werkzeug auf. Ohne Datenbank, fuer Tests."""
    if not tool.get("nur_lesen") and not schreiben_erlaubt:
        raise AiActionValidationError("MCP-Schreibwerkzeug ist noch nicht freigegeben")
    if not row.endpoint_url:
        raise AiActionValidationError("MCP-Server hat keinen Endpunkt")
    _pruefe_argumente(tool, arguments)
    begonnen = time.monotonic()
    try:
        with McpClient(
            row.endpoint_url,
            token=row.auth_token_encrypted or None,
            transport=transport,
            erlaube_loopback=erlaube_loopback,
        ) as client:
            client.initialize()
            ergebnis = client.call_tool(str(tool["name"]), arguments)
    except (McpFehler, McpZielFehler) as exc:
        grund = getattr(exc, "grund", None) or "ziel_abgelehnt"
        logger.info(
            "mcp_aufruf server=%s tool=%s ms=%d status=fehler:%s",
            row.id,
            tool["name"],
            int((time.monotonic() - begonnen) * 1000),
            grund,
        )
        raise AiActionValidationError(f"MCP-Aufruf fehlgeschlagen: {grund}") from exc

    text, fehler = _ausgabe(ergebnis)
    logger.info(
        "mcp_aufruf server=%s tool=%s ms=%d status=%s",
        row.id,
        tool["name"],
        int((time.monotonic() - begonnen) * 1000),
        "fehler" if fehler else "ok",
    )
    return {
        "mcp_server": row.name,
        "tool": tool["name"],
        "content": text,
        **({"fehler": True} if fehler else {}),
    }


def rufe(db: Session, user: User, tool_name: str, arguments: dict) -> dict[str, Any]:
    server_id = server_id_aus_name(tool_name)
    if server_id is None:
        raise AiActionValidationError("MCP-Werkzeugname ist ungueltig")
    if not permission_service.has_global_permission(db, user, "ai.mcp.use"):
        raise AiActionValidationError("MCP-Nutzung ist nicht erlaubt")
    row = _server_fuer(db, user, server_id)
    if row is None:
        raise AiActionValidationError("MCP-Server nicht gefunden oder nicht freigegeben")
    gesucht = tool_name[len(PRAEFIX) + len(str(server_id)) + 1 :]
    treffer = next(
        (t for t in _werkzeuge_aus_cache(row) if _saeuber(str(t["name"])) == gesucht),
        None,
    )
    if treffer is None:
        raise AiActionValidationError("MCP-Werkzeug nicht gefunden")
    return aufrufen(row, treffer, arguments)


__all__ = [
    "PRAEFIX",
    "ausfuehren",
    "katalog",
    "vorschlag",
    "aufrufen",
    "rufe",
    "schemata",
    "schemata_aus_server",
    "sichtbare_server",
    "werkzeug_name",
]


def _schreib_tool(db: Session, user: User, tool_name: str) -> tuple[AiMcpServer, dict]:
    server_id = server_id_aus_name(tool_name)
    if server_id is None:
        raise AiActionValidationError("MCP-Werkzeugname ist ungueltig")
    row = _server_fuer(db, user, server_id)
    if row is None:
        raise AiActionValidationError("MCP-Server nicht gefunden oder nicht freigegeben")
    gesucht = tool_name[len(PRAEFIX) + len(str(server_id)) + 1 :]
    tool = next(
        (t for t in _werkzeuge_aus_cache(row) if _saeuber(str(t["name"])) == gesucht),
        None,
    )
    if tool is None:
        raise AiActionValidationError("MCP-Werkzeug nicht gefunden")
    if tool.get("nur_lesen"):
        raise AiActionValidationError("MCP-Lesewerkzeug laeuft nicht ueber den Vorschlagspfad")
    return row, tool


def vorschlag_aus(row: AiMcpServer, tool: dict, arguments: dict) -> tuple[dict, dict]:
    """Nutzlast und Vorschau fuer die Bestaetigungskarte."""
    if tool.get("nur_lesen"):
        raise AiActionValidationError("MCP-Lesewerkzeug laeuft nicht ueber den Vorschlagspfad")
    _pruefe_argumente(tool, arguments)
    payload = {
        "mcp_server_id": int(row.id),
        "mcp_server": row.name,
        "tool": tool["name"],
        "arguments": arguments,
    }
    preview = {
        "operation": "mcp_call",
        "title": f"{row.name}: {tool['name']}"[:120],
        "server": row.name,
        "tool": tool["name"],
        "arguments": redact_sensitive_text(
            json.dumps(arguments, ensure_ascii=False, separators=(",", ":"))
        )[:400],
        # Ein fremdes Schreibwerkzeug fragt immer, auch im autonomen Modus.
        "always_confirm": True,
    }
    return payload, preview


def vorschlag(db: Session, user: User, tool_name: str, arguments: dict) -> tuple[dict, dict]:
    if not permission_service.has_global_permission(db, user, "ai.mcp.use"):
        raise AiActionValidationError("MCP-Nutzung ist nicht erlaubt")
    row, tool = _schreib_tool(db, user, tool_name)
    return vorschlag_aus(row, tool, arguments)


def ausfuehren(db: Session, rahmen: Any) -> Any:
    """Fuehrt einen bestaetigten MCP-Schreibvorschlag aus."""
    from services.ai_proposals.base import _Ausgefuehrt

    payload = getattr(rahmen, "payload", None) or {}
    server_id = payload.get("mcp_server_id")
    if not isinstance(server_id, int):
        raise AiActionValidationError("MCP-Vorschlag ohne Server")
    row = db.get(AiMcpServer, server_id)
    if row is None or not row.enabled:
        raise AiActionValidationError("MCP-Server nicht gefunden oder abgeschaltet")
    tool = next(
        (t for t in _werkzeuge_aus_cache(row) if t.get("name") == payload.get("tool")),
        None,
    )
    if tool is None:
        raise AiActionValidationError("MCP-Werkzeug nicht mehr vorhanden")
    arguments = payload.get("arguments")
    ergebnis = aufrufen(
        row,
        tool,
        arguments if isinstance(arguments, dict) else {},
        schreiben_erlaubt=True,
    )
    return _Ausgefuehrt(result=ergebnis)


def _stichworte(text: str) -> set[str]:
    return {teil for teil in re.split(r"[^0-9a-zäöüß]+", (text or "").lower()) if len(teil) > 2}


_ROUTER_LOCK = threading.Lock()
_ROUTER: tuple[str, Any] | None = None


def _router_fuer(schemas: dict[str, dict]) -> Any:
    """Ein Router je Werkzeugstand, nicht je Segment.

    Die Vektoren der Beschreibungen zu rechnen kostet Zeit; derselbe Katalog
    kommt in jedem Segment wieder. Aendert sich eine Beschreibung oder kommt
    ein Server dazu, aendert sich die Kennung und der Router wird neu gebaut.
    """
    global _ROUTER
    signatur = hashlib.sha256(
        json.dumps(sorted(schemas.items()), ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    with _ROUTER_LOCK:
        if _ROUTER is None or _ROUTER[0] != signatur:
            from services.semantic_tool_router_adapter import SemanticToolRouterAdapter

            _ROUTER = (signatur, SemanticToolRouterAdapter(schemas))
        return _ROUTER[1]


def semantisch_waehlen(
    werkzeuge: list[dict], query: str, hoechstens: int = MAX_JE_TURN
) -> list[str]:
    """Waehlt MCP-Werkzeuge ueber den semantischen Router.

    Derselbe Adapter wie fuer die eingebauten Werkzeuge (BM25 plus Embeddings,
    wenn ein Modell bereitsteht), aber nur ueber die MCP-Eintraege: die
    Beschreibungen sind Angaben des Gegenuebers, und der Router soll die
    eingebauten fuenf Treffer nicht verdraengen. Gibt ``[]`` zurueck, wenn
    nichts passt oder der Router nicht verfuegbar ist; der Aufrufer faellt
    dann auf `waehle_je_turn` zurueck.
    """
    schemas: dict[str, dict] = {}
    for eintrag in werkzeuge:
        funktion = eintrag.get("function") if isinstance(eintrag, dict) else None
        if isinstance(funktion, dict) and isinstance(funktion.get("name"), str):
            schemas[str(funktion["name"])] = eintrag
    if not schemas or not query.strip():
        return []
    try:
        router = _router_fuer(schemas)
        erlaubt = frozenset(schemas)
        # Unter der Sperre, weil `warm` den Index fortschreibt; nach dem
        # ersten Warmlauf ist beides nur noch Lesen und Rechnen.
        with _ROUTER_LOCK:
            router.warm(erlaubt)
            return router.select(query, erlaubt, hoechstens)
    except Exception as exc:  # Router ist eine Verbesserung, keine Bedingung
        logger.debug("MCP-Routing uebersprungen: %s", type(exc).__name__)
        return []


def waehle_je_turn(
    werkzeuge: list[dict],
    query: str,
    *,
    hoechstens: int = MAX_JE_TURN,
    semantisch: list[str] | None = None,
) -> list[str]:
    """Waehlt die zur Frage passendsten MCP-Werkzeuge, deterministisch.

    Zuerst die semantische Auswahl (falls vorhanden), dann Stichworte aus Name
    und Beschreibung. Reicht beides nicht, bleiben die ersten Eintraege in
    Namensreihenfolge — lieber acht angebotene als gar keine.
    """
    bekannte: set[str] = set()
    for eintrag in werkzeuge:
        funktion = eintrag.get("function") if isinstance(eintrag, dict) else None
        if isinstance(funktion, dict) and funktion.get("name"):
            bekannte.add(str(funktion["name"]))

    gewaehlt = [name for name in (semantisch or []) if name in bekannte]
    gesehen = set(gewaehlt)
    begriffe = _stichworte(query)
    bewertet: list[tuple[int, str]] = []
    for eintrag in werkzeuge:
        funktion = eintrag.get("function") if isinstance(eintrag, dict) else None
        if not isinstance(funktion, dict):
            continue
        name = str(funktion.get("name") or "")
        if not name or name in gesehen:
            continue
        text = f"{name} {funktion.get('description') or ''}".lower()
        im_namen = sum(1 for begriff in begriffe if begriff in name.lower())
        im_text = sum(1 for begriff in begriffe if begriff in text)
        bewertet.append((-(im_namen * 3 + im_text), name))
    bewertet.sort(key=lambda teil: (teil[0], teil[1]))
    gewaehlt.extend(name for _, name in bewertet[: max(0, hoechstens - len(gewaehlt))])
    return gewaehlt[:hoechstens]
