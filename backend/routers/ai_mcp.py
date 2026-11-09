"""API-Routen fuer MCP-Server (Model Context Protocol): Global, Team & Persoenlich."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from dependencies import require_global, verify_csrf
from models import AiMcpServer, TeamMember, User
from models.dis_text import vorab_entschluesselt
from services import permission_service
from services.mcp.entdeckung import (
    normalisiere_werkzeuge,
    pruefen_und_speichern,
    speichere_werkzeuge,
)

router = APIRouter(prefix="/api/ai/mcp", tags=["ai-mcp"])


class AiMcpServerCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    scope: str = Field(default="user", pattern="^(global|team|user)$")
    team_id: int | None = None
    transport: str = Field(default="http", pattern="^(http|sse|stdio)$")
    endpoint_url: str | None = Field(default=None, max_length=1024)
    command_json: str | None = Field(default=None, max_length=4000)
    auth_header: str | None = Field(default=None, max_length=2000)
    command: str | None = Field(default=None, max_length=4000)
    args: list[str] | None = None
    is_global: bool | None = None
    enabled: bool = True


class AiMcpServerUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    transport: str | None = Field(default=None, pattern="^(http|sse|stdio)$")
    endpoint_url: str | None = Field(default=None, max_length=1024)
    command_json: str | None = Field(default=None, max_length=4000)
    auth_header: str | None = Field(default=None, max_length=2000)
    command: str | None = Field(default=None, max_length=4000)
    args: list[str] | None = None
    is_global: bool | None = None
    enabled: bool | None = None


class AiMcpPruefungResponse(BaseModel):
    tools: list[dict] = Field(default_factory=list)
    status: str


class AiMcpWerkzeugEintrag(BaseModel):
    # `schema` ist ein reservierter Name in Pydantic; nach außen bleibt er
    # trotzdem `schema`, weil die Desktop-App die MCP-Form schickt.
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=128)
    beschreibung: str | None = Field(default=None, max_length=2000)
    nur_lesen: bool = False
    schema_definition: dict | None = Field(default=None, alias="schema")


class AiMcpWerkzeugePayload(BaseModel):
    tools: list[AiMcpWerkzeugEintrag] = Field(default_factory=list, max_length=128)


class AiMcpServerResponse(BaseModel):
    id: int
    user_id: int | None = None
    team_id: int | None = None
    scope: str
    name: str
    description: str | None = None
    transport: str
    endpoint_url: str | None = None
    command_json: str | None = None
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    is_global: bool = False
    has_auth_header: bool = False
    auth_header_configured: bool = False
    enabled: bool
    tools_cache_json: str | None = None
    created_at: datetime
    updated_at: datetime


def _command_teile(roh: str | None) -> tuple[str | None, str | None]:
    """Zerlegt den Startbefehl in Programm und Argumente.

    Die Oberflaeche schickt ein JSON-Objekt `{command, args}`; ein blosser
    Text ist das Programm ohne Argumente.
    """
    text = (roh or "").strip()
    if not text:
        return None, None
    try:
        daten = json.loads(text)
    except json.JSONDecodeError:
        return text, None
    if isinstance(daten, dict):
        programm = str(daten.get("command") or "").strip() or None
        args = daten.get("args")
        return programm, json.dumps(args, ensure_ascii=False) if isinstance(args, list) else None
    return text, None


def _command_json(row: AiMcpServer) -> str | None:
    if not row.command:
        return None
    try:
        args = json.loads(row.args_json) if row.args_json else []
    except json.JSONDecodeError:
        args = []
    return json.dumps({"command": row.command, "args": args}, ensure_ascii=False)


def _command_args(row: AiMcpServer) -> list[str]:
    try:
        werte = json.loads(row.args_json) if row.args_json else []
    except json.JSONDecodeError:
        return []
    return [str(w) for w in werte] if isinstance(werte, list) else []


def _to_response(row: AiMcpServer) -> AiMcpServerResponse:
    return AiMcpServerResponse(
        id=row.id,
        user_id=row.user_id,
        team_id=row.team_id,
        scope=row.scope,
        name=row.name,
        description=row.description,
        transport=row.transport,
        endpoint_url=row.endpoint_url,
        command_json=_command_json(row),
        command=row.command,
        args=_command_args(row),
        is_global=row.scope == "global",
        has_auth_header=bool(row.auth_token_hint),
        auth_header_configured=bool(row.auth_token_hint),
        enabled=row.enabled,
        tools_cache_json=row.cached_tools_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _can_manage_mcp(db: Session, user: User, row: AiMcpServer) -> bool:
    if row.scope == "global":
        return permission_service.has_global_permission(db, user, "panel.settings.write")
    if row.scope == "team" and row.team_id is not None:
        member = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == row.team_id, TeamMember.user_id == user.id)
            .first()
        )
        return member is not None
    return row.user_id == user.id and permission_service.has_global_permission(db, user, "ai.mcp.manage")


@router.get("", response_model=list[AiMcpServerResponse])
def list_mcp_servers(
    team_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> list[AiMcpServerResponse]:
    team_ids = [
        r.team_id
        for r in db.query(TeamMember).filter(TeamMember.user_id == user.id).all()
    ]
    filters = [
        AiMcpServer.scope == "global",
        (AiMcpServer.scope == "user") & (AiMcpServer.user_id == user.id),
    ]
    if team_id is not None and team_id in team_ids:
        filters.append((AiMcpServer.scope == "team") & (AiMcpServer.team_id == team_id))
    elif team_ids:
        filters.append((AiMcpServer.scope == "team") & (AiMcpServer.team_id.in_(team_ids)))

    q = (
        db.query(AiMcpServer)
        .filter(or_(*filters))
        .order_by(AiMcpServer.scope.asc(), AiMcpServer.id.asc())
    )
    with vorab_entschluesselt(
        db,
        q,
        AiMcpServer.name,
        AiMcpServer.description,
        AiMcpServer.endpoint_url,
        AiMcpServer.command_json,
        AiMcpServer.auth_header,
        AiMcpServer.tools_cache_json,
    ):
        rows = q.all()
    return [_to_response(r) for r in rows]


@router.post("", response_model=AiMcpServerResponse, status_code=status.HTTP_201_CREATED)
def create_mcp_server(
    payload: AiMcpServerCreatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> AiMcpServerResponse:
    if payload.scope == "global":
        if not permission_service.has_global_permission(db, user, "panel.settings.write"):
            raise HTTPException(status_code=403, detail="Nur Administratoren koennen globale MCP-Server anlegen")
    elif payload.scope == "team":
        if not payload.team_id:
            raise HTTPException(status_code=400, detail="Team-ID erforderlich fuer Team-MCP-Server")
        member = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == payload.team_id, TeamMember.user_id == user.id)
            .first()
        )
        if member is None:
            raise HTTPException(status_code=403, detail="Kein Zugriff auf dieses Team")
    elif payload.scope == "user":
        if not permission_service.has_global_permission(db, user, "ai.mcp.manage"):
            raise HTTPException(status_code=403, detail="Keine Berechtigung zum Verwalten von MCP-Servern (ai.mcp.manage)")

    scope = payload.scope
    if payload.is_global is True:
        scope = "global"
    elif payload.team_id is not None and payload.scope == "user":
        scope = "team"
    befehl = payload.command_json
    if not befehl and payload.command:
        befehl = json.dumps({"command": payload.command, "args": payload.args or []}, ensure_ascii=False)

    if payload.transport in ("http", "sse") and not (payload.endpoint_url or "").strip():
        raise HTTPException(status_code=400, detail="Endpunkt-URL ist fuer HTTP/SSE MCP-Server erforderlich")
    if payload.transport == "stdio" and not (payload.command_json or "").strip():
        raise HTTPException(status_code=400, detail="Startbefehl ist fuer lokale Stdio-MCP-Server erforderlich")

    row = AiMcpServer(
        user_id=user.id if scope == "user" else None,
        team_id=payload.team_id if scope == "team" else None,
        scope=scope,
        name=payload.name.strip()[:120],
        description=(payload.description or "").strip() or None,
        transport=payload.transport,
        endpoint_url=(payload.endpoint_url or "").strip() or None,
        command=_command_teile(befehl)[0],
        args_json=_command_teile(befehl)[1],
        auth_token_encrypted=(payload.auth_header or "").strip() or None,
        auth_token_hint=((payload.auth_header or "").strip()[-4:] or None),
        enabled=payload.enabled,
        cached_tools_json="[]",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.patch("/{server_id}", response_model=AiMcpServerResponse)
def update_mcp_server(
    server_id: int,
    payload: AiMcpServerUpdatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> AiMcpServerResponse:
    row = db.get(AiMcpServer, server_id)
    if row is None or not _can_manage_mcp(db, user, row):
        raise HTTPException(status_code=404, detail="MCP-Server nicht gefunden oder keine Berechtigung")
    values = payload.model_dump(exclude_unset=True)
    if "name" in values and values["name"] is not None:
        row.name = values["name"].strip()[:120]
    if "description" in values:
        row.description = (values["description"] or "").strip() or None
    if "transport" in values and values["transport"] is not None:
        row.transport = values["transport"]
    if "endpoint_url" in values:
        row.endpoint_url = (values["endpoint_url"] or "").strip() or None
    if values.get("is_global") is True:
        row.scope = "global"
        row.user_id = None
    elif values.get("is_global") is False and row.scope == "global":
        row.scope = "team" if row.team_id is not None else "user"
    befehl = values.get("command_json")
    if not befehl and values.get("command"):
        befehl = json.dumps({"command": values["command"], "args": values.get("args") or []}, ensure_ascii=False)
    if befehl is not None:
        programm, args = _command_teile(befehl)
        row.command = programm
        row.args_json = args
    if "auth_header" in values:
        geheim = (values["auth_header"] or "").strip()
        row.auth_token_encrypted = geheim or None
        row.auth_token_hint = geheim[-4:] if geheim else None
    if "enabled" in values and values["enabled"] is not None:
        row.enabled = bool(values["enabled"])
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.post("/{server_id}/pruefen", response_model=AiMcpPruefungResponse)
def pruefe_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> AiMcpPruefungResponse:
    """Verbindung pruefen, Werkzeugliste holen und den Stand festhalten."""
    row = db.get(AiMcpServer, server_id)
    if row is None or not _can_manage_mcp(db, user, row):
        raise HTTPException(status_code=404, detail="MCP-Server nicht gefunden oder keine Berechtigung")
    if (row.transport or "http") == "stdio":
        raise HTTPException(status_code=400, detail="stdio laeuft nur in der Desktop-App")
    werkzeuge = pruefen_und_speichern(db, row)
    return AiMcpPruefungResponse(tools=werkzeuge, status=row.last_status or "unbekannt")


@router.post("/{server_id}/werkzeuge", response_model=AiMcpPruefungResponse)
def melde_mcp_werkzeuge(
    server_id: int,
    payload: AiMcpWerkzeugePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> AiMcpPruefungResponse:
    """Werkzeugliste eines lokalen Programms aus der Desktop-App uebernehmen.

    Nur `stdio`-Server: ihr Prozess laeuft am Rechner des Benutzers, das Panel
    kann ihn nicht starten. Der Aufrufer verwaltet den Server ohnehin; die
    Liste wird trotzdem begrenzt und geprueft wie die des HTTP-Wegs.
    """
    row = db.get(AiMcpServer, server_id)
    if row is None or not _can_manage_mcp(db, user, row):
        raise HTTPException(status_code=404, detail="MCP-Server nicht gefunden oder keine Berechtigung")
    if (row.transport or "http") != "stdio":
        raise HTTPException(status_code=400, detail="Nur lokale Programme melden ihre Werkzeuge selbst")
    werkzeuge = speichere_werkzeuge(
        db,
        row,
        normalisiere_werkzeuge(
            [
                {
                    "name": eintrag.name,
                    "beschreibung": eintrag.beschreibung,
                    "nur_lesen": eintrag.nur_lesen,
                    "schema": eintrag.schema_definition,
                }
                for eintrag in payload.tools
            ]
        ),
    )
    return AiMcpPruefungResponse(tools=werkzeuge, status=row.last_status or "unbekannt")


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> Response:
    row = db.get(AiMcpServer, server_id)
    if row is None or not _can_manage_mcp(db, user, row):
        raise HTTPException(status_code=404, detail="MCP-Server nicht gefunden oder keine Berechtigung")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
