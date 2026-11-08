"""Testläufe und E2E-Ergebnisse für Singra-Projekte."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class SingraTestRun(Base):
    """Dokumentiert einen Testlauf (Syntax, E2E, Playwright, Negative Testing) eines Projekts."""

    __tablename__ = "singra_test_runs"
    __table_args__ = (
        Index("ix_singra_test_runs_project_id", "project_id"),
        Index("ix_singra_test_runs_checksum", "release_checksum"),
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
        String(16), nullable=False, default="dev", server_default="dev"
    )
    release_checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str] = mapped_column(
        String(32), nullable=False, default="e2e", server_default="e2e"
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending", server_default="pending"
    )
    summary_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifacts_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
