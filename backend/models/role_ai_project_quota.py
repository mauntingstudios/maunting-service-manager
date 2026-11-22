"""KI-Projekt-Kontingente je globaler Rolle (Anzahl Projekte und Speicher)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class RoleAiProjectQuota(Base):
    """Separat konfigurierbares KI-Projekt- und Speicherlimit pro Rolle.

    `0` bedeutet jeweils unbegrenzt.
    """

    __tablename__ = "role_ai_project_quotas"

    role_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("roles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    max_projects: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    max_storage_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=256)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
