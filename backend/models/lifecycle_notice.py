"""Idempotente Tracking-Tabelle fuer gestaffelte Loesch-Erinnerungs-Mails."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LifecycleDeletionNotice(Base):
    """Protokolliert genau eine Benachrichtigungsstufe je Vertrag und Sperrzyklus.

    Das Unique-Constraint stellt auf DB-Ebene sicher, dass selbst bei
    parallelen Scheduler-Laeufen oder Retries niemals dieselbe Warnstufe
    zweimal verschickt wird.
    """

    __tablename__ = "lifecycle_deletion_notices"
    __table_args__ = (
        CheckConstraint(
            "target_kind IN ('shop_entitlement', 'hoster_service')",
            name="ck_lifecycle_notices_target_kind",
        ),
        CheckConstraint(
            "status IN ('sent', 'skipped', 'failed')",
            name="ck_lifecycle_notices_status",
        ),
        CheckConstraint(
            "stage_days > 0",
            name="ck_lifecycle_notices_stage_days",
        ),
        UniqueConstraint(
            "target_kind",
            "target_id",
            "cycle_token",
            "stage_days",
            name="uq_lifecycle_notice_stage",
        ),
        Index(
            "ix_lifecycle_notices_target",
            "target_kind",
            "target_id",
            "cycle_token",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    target_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    cycle_token: Mapped[str] = mapped_column(String(36), nullable=False)
    stage_days: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
