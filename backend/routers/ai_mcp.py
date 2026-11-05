"""API-Routen fuer MCP-Server (Model Context Protocol): Global, Team & Persoenlich."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from dependencies import require_global, verify_csrf
from models import AiMcpServer, TeamMember, User
from models.dis_text import vorab_entschluesselt
from services import permission_service

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
    enabled: bool = True


class AiMcpServerUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    transport: str | None = Field(default=None, pattern="^(http|sse|stdio)$")
    endpoint_url: str | None = Field(default=None, max_length=1024)
    command_json: str | None = Field(default=None, max_length=4000)
    auth_header: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None


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
    has_auth_header: bool = False
    enabled: bool
    tools_cache_json: str | None = None
    created_at: datetime
    updated_at: datetime


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
        command_json=row.command_json,
        has_auth_header=bool(row.auth_header),
        enabled=row.enabled,
        tools_cache_json=row.tools_cache_json,
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
    return row.user_id == user.id


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
    rows = vorab_entschluesselt(
        db,
        q,
        AiMcpServer.name,
        AiMcpServer.description,
        AiMcpServer.endpoint_url,
        AiMcpServer.command_json,
        AiMcpServer.auth_header,
        AiMcpServer.tools_cache_json,
    )
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

    if payload.transport in ("http", "sse") and not (payload.endpoint_url or "").strip():
        raise HTTPException(status_code=400, detail="Endpunkt-URL ist fuer HTTP/SSE MCP-Server erforderlich")
    if payload.transport == "stdio" and not (payload.command_json or "").strip():
        raise HTTPException(status_code=400, detail="Startbefehl ist fuer lokale Stdio-MCP-Server erforderlich")

    row = AiMcpServer(
        user_id=user.id if payload.scope == "user" else None,
        team_id=payload.team_id if payload.scope == "team" else None,
        scope=payload.scope,
        name=payload.name.strip()[:120],
        description=(payload.description or "").strip() or None,
        transport=payload.transport,
        endpoint_url=(payload.endpoint_url or "").strip() or None,
        command_json=(payload.command_json or "").strip() or None,
        auth_header=(payload.auth_header or "").strip() or None,
        enabled=payload.enabled,
        tools_cache_json="[]",
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
    if "command_json" in values:
        row.command_json = (values["command_json"] or "").strip() or None
    if "auth_header" in values:
        row.auth_header = (values["auth_header"] or "").strip() or None
    if "enabled" in values and values["enabled"] is not None:
        row.enabled = bool(values["enabled"])
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _to_response(row)


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
