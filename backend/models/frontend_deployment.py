"""Datenbankmodell fuer Frontend-Deployments (Produktion & Previews)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class FrontendDeployment(Base):
    __tablename__ = "frontend_deployments"
    __table_args__ = (
        Index("ix_frontend_deployments_server_created", "server_id", "created_at"),
        Index("ix_frontend_deployments_server_branch", "server_id", "branch_slug", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    server_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="production")
    branch: Mapped[str] = mapped_column(String(255), nullable=False)
    branch_slug: Mapped[str] = mapped_column(String(64), nullable=False)
    commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    commit_message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    commit_author: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source: Mapped[str] = mapped_column(String(24), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    is_live: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    log_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
