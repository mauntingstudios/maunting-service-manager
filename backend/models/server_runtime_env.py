"""Verschlüsselte Runtime-Umgebungsvariablen für Server-Container."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ServerRuntimeEnv(Base):
    """Verschlüsselt hinterlegte Laufzeit-Umgebungsvariablen für Docker-Container.

    Wird beim Container-Start über blueprint_plugin.build_container_env() eingemischt,
    sodass keine sensitiven Klartext-.env-Dateien im Server-Dateisystem verbleiben.
    """

    __tablename__ = "server_runtime_env"

    server_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("servers.id", ondelete="CASCADE"),
        primary_key=True,
    )
    env_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    probe_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    managed_by: Mapped[str | None] = mapped_column(
        String(64), nullable=True, default="singra", server_default="singra"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
