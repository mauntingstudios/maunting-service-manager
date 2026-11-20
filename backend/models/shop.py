"""Nativer Shop: Tarife, Bestellungen, Abos und Freischaltungen.

Der Blueprint bleibt die Quelle fuer das Spiel. Ein Plan verweist nur auf
``game_type`` und beschreibt, was der Kunde bucht: Grundpreis, enthaltene
Ressourcen, Aufpreise je Stufe und optional Node/Rolle. Bilder werden nicht
am Plan gespeichert, sondern ueber den bestehenden Wallpaper-Resolver pro
Spiel aufgeloest (``artwork_mode`` steuert nur die Auswahl).

Bestellungen tragen Preis- und Konfigurations-Snapshots: Spaetere
Tarifaenderungen duerfen alte Belege nicht rueckwirkend veraendern. Abos und
Entitlements haengen an der bezahlten Bestellung, nicht am aktuellen Plan.
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


class ShopOrder(Base):
    """Kauf eines oder mehrerer Shop-Tarife durch genau einen Benutzer."""

    __tablename__ = "shop_orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending_payment', 'paid', 'cancelled', 'refunded', 'failed')",
            name="ck_shop_orders_status",
        ),
        CheckConstraint("months > 0", name="ck_shop_orders_months"),
        CheckConstraint(
            "discount_percent >= 0 AND discount_percent <= 100",
            name="ck_shop_orders_discount",
        ),
        CheckConstraint(
            "net_cents >= 0 AND tax_cents >= 0 AND gross_cents >= 0",
            name="ck_shop_orders_cents",
        ),
        Index("ix_shop_orders_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    number: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(24), default="pending_payment", nullable=False, index=True
    )
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    billing_interval: Mapped[str] = mapped_column(
        String(16), default="month", nullable=False
    )
    months: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_percent: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    net_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    gross_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # "demo" ist der lokale Probelauf ohne Zahlungsdienst; Stripe folgt.
    payment_provider: Mapped[str] = mapped_column(
        String(24), default="demo", nullable=False
    )
    payment_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ShopOrderItem(Base):
    """Preis- und Konfigurations-Snapshot einer Bestellposition."""

    __tablename__ = "shop_order_items"
    __table_args__ = (
        CheckConstraint("kind IN ('plan', 'addon')", name="ck_shop_order_items_kind"),
        CheckConstraint("quantity > 0", name="ck_shop_order_items_quantity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shop_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), default="plan", nullable=False)
    plan_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shop_plans.id", ondelete="SET NULL"), nullable=True
    )
    game_type: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # Brutto je Monat, Steuersatz und die daraus berechneten Zeilensummen.
    unit_price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_rate_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    net_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    gross_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    ram_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu: Mapped[int | None] = mapped_column(Integer, nullable=True)
    slots: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ShopSubscription(Base):
    """Monatliches Abo, das aus einer bezahlten Bestellung entsteht."""

    __tablename__ = "shop_subscriptions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'past_due', 'cancelled')",
            name="ck_shop_subscriptions_status",
        ),
        CheckConstraint(
            "billing_interval IN ('month')",
            name="ck_shop_subscriptions_interval",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shop_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shop_order_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shop_plans.id", ondelete="SET NULL"), nullable=True
    )
    game_type: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), default="active", nullable=False, index=True
    )
    billing_interval: Mapped[str] = mapped_column(
        String(16), default="month", nullable=False
    )
    monthly_gross_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_rate_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    # Stripe-Abo-Kennung (nur bei monatlicher Laufzeit); Renewal-Ereignisse
    # werden darueber der lokalen Zeile zugeordnet.
    provider_reference: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    current_period_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class ShopPaymentEvent(Base):
    """Verarbeitete Webhook-Ereignisse (Idempotenz fuer Stripe-Wiederholungen)."""

    __tablename__ = "shop_payment_events"
    __table_args__ = (
        Index("ix_shop_payment_events_type_received", "event_type", "received_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_id: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shop_orders.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(16), default="processed", nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class ShopEntitlement(Base):
    """Freischaltung aus einer bezahlten Bestellung (Server-Spec oder Rolle).

    Eine Zeile ist die Quelle der Wahrheit; Rollenvergabe und Server-Anlage
    lesen daraus. Bis Provisionierung und Rollenvergabe gebaut sind, existiert
    nur der Anspruch, keine Wirkung.
    """

    __tablename__ = "shop_entitlements"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('server', 'role', 'addon')", name="ck_shop_entitlements_kind"
        ),
        CheckConstraint(
            "status IN ('active', 'suspended', 'revoked')",
            name="ck_shop_entitlements_status",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shop_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shop_order_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shop_plans.id", ondelete="SET NULL"), nullable=True
    )
    role_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(16), default="active", nullable=False, index=True
    )
    ram_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu: Mapped[int | None] = mapped_column(Integer, nullable=True)
    slots: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
