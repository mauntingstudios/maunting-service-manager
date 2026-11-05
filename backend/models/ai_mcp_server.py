"""Konfigurierbare MCP-Server (Model Context Protocol) fuer Betreiber, Teams und Benutzer."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.dis_text import ai_text


MCP_TRANSPORTS = ("http", "sse", "stdio")
MCP_SCOPES = ("global", "team", "user")


class AiMcpServer(Base):
    """Ein registrierter MCP-Server (Remote HTTP/SSE oder lokal Stdio in der Desktop-App)."""

    __tablename__ = "ai_mcp_servers"
    __table_args__ = (
        CheckConstraint(
            "transport IN ('http', 'sse', 'stdio')",
            name="ck_ai_mcp_servers_transport",
        ),
        CheckConstraint(
            "scope IN ('global', 'team', 'user')",
            name="ck_ai_mcp_servers_scope",
        ),
        Index("ix_ai_mcp_servers_scope_user", "scope", "user_id"),
        Index("ix_ai_mcp_servers_scope_team", "scope", "team_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    scope: Mapped[str] = mapped_column(
        String(16), nullable=False, default="user", server_default="user"
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    team_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=True, index=True
    )
    transport: Mapped[str] = mapped_column(
        String(16), nullable=False, default="http", server_default="http"
    )
    # Fuer http / sse
    endpoint_url: Mapped[str | None] = mapped_column(
        ai_text("ai_mcp_servers.endpoint_url"), nullable=True
    )
    # Fuer stdio (nur in der Tauri Desktop-App)
    command: Mapped[str | None] = mapped_column(
        ai_text("ai_mcp_servers.command"), nullable=True
    )
    args_json: Mapped[str | None] = mapped_column(
        ai_text("ai_mcp_servers.args_json"), nullable=True
    )
    # Optionale Authentifizierung (Bearer-Token / Header, DIS-verschluesselt)
    auth_token_encrypted: Mapped[str | None] = mapped_column(
        ai_text("ai_mcp_servers.auth_token"), nullable=True
    )
    auth_token_hint: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Zuletzt entdeckte Werkzeuge als JSON-Liste [{"name": ..., "description": ..., "inputSchema": ...}]
    cached_tools_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
