"""Persistente Deployment-Historie für Singra-Projekte."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class SingraDeployment(Base):
    """Protokollierter Deployment-Lauf eines Singra-Projekts (Dev oder Produktion)."""

    __tablename__ = "singra_deployments"
    __table_args__ = (
        Index("ix_singra_deployments_project_id", "project_id"),
        Index("ix_singra_deployments_task_id", "task_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    environment: Mapped[str] = mapped_column(
        String(16), nullable=False, default="prod", server_default="prod"
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending", server_default="pending"
    )
    phase: Mapped[str] = mapped_column(
        String(32), nullable=False, default="snapshot", server_default="snapshot"
    )
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    diagnostics_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    release_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
