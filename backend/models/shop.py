"""Nativer Shop: Tarife (Plaene) mit Preis- und Ressourcenregeln.

Der Blueprint bleibt die Quelle fuer das Spiel. Ein Plan verweist nur auf
``game_type`` und beschreibt, was der Kunde bucht: Grundpreis, enthaltene
Ressourcen, Aufpreise je Stufe und optional Node/Rolle. Bilder werden nicht
am Plan gespeichert, sondern ueber den bestehenden Wallpaper-Resolver pro
Spiel aufgeloest (``artwork_mode`` steuert nur die Auswahl).
"""

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
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ShopPlan(Base):
    """Ein verkaufbarer Tarif fuer genau einen Blueprint (``game_type``)."""

    __tablename__ = "shop_plans"
    __table_args__ = (
        UniqueConstraint("game_type", "name", name="uq_shop_plans_game_name"),
        CheckConstraint("price_cents >= 0", name="ck_shop_plans_price"),
        CheckConstraint(
            "tax_rate_percent >= 0 AND tax_rate_percent <= 100",
            name="ck_shop_plans_tax",
        ),
        CheckConstraint(
            "billing_interval IN ('month')", name="ck_shop_plans_interval"
        ),
        CheckConstraint(
            "artwork_mode IN ('steam', 'custom', 'none')",
            name="ck_shop_plans_artwork",
        ),
        Index("ix_shop_plans_game_active", "game_type", "active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    game_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Preise in Cent. Waehrung und Intervall sind fuer Phase 2 auf EUR/Monat
    # begrenzt; weitere Intervalle brauchen eine bewusste Erweiterung.
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    billing_interval: Mapped[str] = mapped_column(
        String(16), default="month", nullable=False
    )
    tax_rate_percent: Mapped[int] = mapped_column(
        Integer, default=19, nullable=False
    )

    # Enthaltene Ressourcen und Aufpreis je zusaetzlicher Stufe.
    ram_included_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ram_max_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ram_step_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_per_ram_step_cents: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    cpu_included: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_step: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price_per_cpu_step_cents: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    slots_included: Mapped[int | None] = mapped_column(Integer, nullable=True)
    slots_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    slots_step: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price_per_slot_step_cents: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    # Optionale Bindung an eine Node bzw. eine globale Rolle (z. B. KI-Kontingent).
    node_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True
    )
    role_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )

    # "steam": automatisch aus dem Blueprint; "custom": aktives Galeriebild;
    # "none": bewusst kein Bild (Frontend nutzt Gradient).
    artwork_mode: Mapped[str] = mapped_column(
        String(16), default="steam", nullable=False
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
