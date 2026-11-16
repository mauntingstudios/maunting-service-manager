"""Frontend-Build-Ressourcenkontingente je globaler Rolle (analog zu RoleVaultQuota)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class RoleFrontendBuildQuota(Base):
    __tablename__ = "role_frontend_build_quotas"

    role_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("roles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    max_cpu_cores: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    max_memory_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=2048)
    build_timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=900)
    max_concurrent_builds: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    max_previews_per_server: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
