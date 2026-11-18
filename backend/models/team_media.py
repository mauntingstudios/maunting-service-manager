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
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TeamMedia(Base):
    """Custom-Profilbilder und -Banner eines Teams (streng team- und typ-isoliert).

    Speichert Galerieeintraege fuer ``kind in ('avatar', 'banner')``. Hoechstens
    ein Eintrag je ``(team_id, kind)`` ist aktiv (``is_active``).
    """

    __tablename__ = "team_media"
    __table_args__ = (
        CheckConstraint("kind IN ('avatar', 'banner')", name="ck_team_media_kind"),
        Index("ix_team_media_scope_active", "team_id", "kind", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    file_name: Mapped[str] = mapped_column(String(128), nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(128), nullable=False, default="system")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    team = relationship("Team", back_populates="media_items")
