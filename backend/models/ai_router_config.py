"""Singleton-Konfiguration des Singra KI-Routers (Smart Model Routing)."""

from __future__ import annotations

from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class AiRouterConfig(Base):
    """Konfiguriert die vier Modellpools und Rechengewichtungen des Singra KI-Routers.

    Es gibt immer hoechstens eine aktive globale Router-Konfiguration (``id = 1``).
    Jeder Pool speichert eine geordnete Liste von ``{"provider_id": int, "model": str}``
    Eintraegen als JSON, die ausschliesslich aus bereits konfigurierten Providern
    stammen.
    """

    __tablename__ = "ai_router_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa.false(), nullable=False
    )
    eco_models_json: Mapped[str] = mapped_column(
        Text, default="[]", server_default="[]", nullable=False
    )
    standard_models_json: Mapped[str] = mapped_column(
        Text, default="[]", server_default="[]", nullable=False
    )
    flagship_models_json: Mapped[str] = mapped_column(
        Text, default="[]", server_default="[]", nullable=False
    )
    fallback_models_json: Mapped[str] = mapped_column(
        Text, default="[]", server_default="[]", nullable=False
    )
    eco_weight: Mapped[float] = mapped_column(
        Float, default=1.0, server_default="1.0", nullable=False
    )
    standard_weight: Mapped[float] = mapped_column(
        Float, default=1.0, server_default="1.0", nullable=False
    )
    flagship_weight: Mapped[float] = mapped_column(
        Float, default=1.0, server_default="1.0", nullable=False
    )
    fallback_weight: Mapped[float] = mapped_column(
        Float, default=1.0, server_default="1.0", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
