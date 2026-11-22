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
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
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
            "coupon_discount_cents >= 0",
            name="ck_shop_orders_coupon_discount",
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
    coupon_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    coupon_discount_cents: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    # Rechnungsanschrift zum Kaufzeitpunkt. Pflicht fuer eine Rechnung,
    # optional am Datensatz, damit alte Bestellungen ladbar bleiben.
    buyer_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    buyer_street: Mapped[str | None] = mapped_column(String(160), nullable=True)
    buyer_postal_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    buyer_city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    buyer_country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    buyer_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
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


class ShopAddon(Base):
    """Eigenstaendiges Shop-Add-on ohne Pflicht zu einem Spielserver.

    Jede Zeile definiert entweder ein Kontingent (KI-Tokens, Slots, Backups,
    Speicher) oder eine kundengebundene Rolle. Preise und Kategorien bleiben
    unter ``shop_addons``, sodass sie unabhaengig von Server-Tarifen gekauft,
    gewechselt und gekuendigt werden koennen.
    """

    __tablename__ = "shop_addons"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_shop_addons_slug"),
        CheckConstraint(
            "category IN ('ai_quota', 'slots', 'backups', 'storage', 'role')",
            name="ck_shop_addons_category",
        ),
        CheckConstraint("price_cents >= 0", name="ck_shop_addons_price"),
        CheckConstraint(
            "billing_interval IN ('month')", name="ck_shop_addons_interval"
        ),
        CheckConstraint(
            "tax_rate_percent >= 0 AND tax_rate_percent <= 100",
            name="ck_shop_addons_tax",
        ),
        CheckConstraint(
            "extra_slots IS NULL OR extra_slots >= 0",
            name="ck_shop_addons_extra_slots",
        ),
        CheckConstraint(
            "extra_storage_mb IS NULL OR extra_storage_mb >= 0",
            name="ck_shop_addons_extra_storage",
        ),
        CheckConstraint(
            "extra_backups IS NULL OR extra_backups >= 0",
            name="ck_shop_addons_extra_backups",
        ),
        CheckConstraint(
            "extra_ai_tokens IS NULL OR extra_ai_tokens >= 0",
            name="ck_shop_addons_extra_ai",
        ),
        Index("ix_shop_addons_cat_active", "category", "active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    billing_interval: Mapped[str] = mapped_column(
        String(16), default="month", nullable=False
    )
    tax_rate_percent: Mapped[int] = mapped_column(Integer, default=19, nullable=False)

    extra_slots: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extra_storage_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extra_backups: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extra_ai_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    role_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )

    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )


class ShopCoupon(Base):
    """Gutscheine und Storefront-Aktionsrabatte mit optionalem Stripe-Sync."""

    __tablename__ = "shop_coupons"
    __table_args__ = (
        UniqueConstraint("code", name="uq_shop_coupons_code"),
        CheckConstraint(
            "discount_type IN ('percent', 'fixed_cents')",
            name="ck_shop_coupons_type",
        ),
        CheckConstraint("discount_value > 0", name="ck_shop_coupons_value"),
        CheckConstraint(
            "scope IN ('all', 'plans', 'addons')",
            name="ck_shop_coupons_scope",
        ),
        CheckConstraint("min_gross_cents >= 0", name="ck_shop_coupons_min_gross"),
        CheckConstraint(
            "max_redemptions IS NULL OR max_redemptions > 0",
            name="ck_shop_coupons_max_redemptions",
        ),
        CheckConstraint(
            "redemption_count >= 0", name="ck_shop_coupons_redemption_count"
        ),
        CheckConstraint(
            "banner_cooldown_hours >= 0", name="ck_shop_coupons_cooldown"
        ),
        Index("ix_shop_coupons_active", "active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    promo_text: Mapped[str | None] = mapped_column(String(240), nullable=True)
    discount_type: Mapped[str] = mapped_column(String(16), nullable=False)
    discount_value: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    scope: Mapped[str] = mapped_column(String(16), default="all", nullable=False)
    target_plan_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    min_gross_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_redemptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    redemption_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    valid_from: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    valid_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    show_badge: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    show_banner: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    banner_cooldown_hours: Mapped[int] = mapped_column(
        Integer, default=6, nullable=False
    )
    stripe_coupon_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stripe_promotion_code_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
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
    addon_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shop_addons.id", ondelete="SET NULL"), nullable=True
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
    addon_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shop_addons.id", ondelete="SET NULL"), nullable=True
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
    delete_server_on_end: Mapped[bool] = mapped_column(
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
    lesen daraus und halten ihren erreichten Stand hier fest.
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
        CheckConstraint(
            "provisioning_status IS NULL OR provisioning_status IN "
            "('pending', 'provisioning', 'ready', 'suspended', 'revoked', 'failed', 'purged')",
            name="ck_shop_entitlements_provisioning_status",
        ),
        CheckConstraint(
            "purge_reason IS NULL OR purge_reason IN ('voluntary_cancel', 'unpaid', 'refund')",
            name="ck_shop_entitlements_purge_reason",
        ),
        Index("ix_shop_entitlements_purge_after", "status", "purge_after"),
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
    addon_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shop_addons.id", ondelete="SET NULL"), nullable=True
    )
    role_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
    server_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("servers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    granted_role_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(16), default="active", nullable=False, index=True
    )
    provisioning_status: Mapped[str | None] = mapped_column(
        String(24), nullable=True
    )
    provisioning_error: Mapped[str | None] = mapped_column(
        String(64), nullable=True
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
    suspended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    purge_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    purge_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    purge_cycle_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    purged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ShopInvoiceSequence(Base):
    """Fortlaufender Rechnungsnummernkreis je Jahr (lueckenlos, gesperrt)."""

    __tablename__ = "shop_invoice_sequences"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ShopInvoice(Base):
    """Unveraenderlicher Rechnungs-Snapshot mit XRechnung-XML und PDF.

    Es gibt bewusst keinen Update-/Delete-Pfad: Korrekturen laufen spaeter
    ueber Storno- oder Gutschriftsbelege. Verkaeufer- und Kaeuferdaten stehen
    als Kopie am Beleg, nicht als Verweis auf veraenderliche Stammdaten.
    """

    __tablename__ = "shop_invoices"
    __table_args__ = (
        UniqueConstraint("number", name="uq_shop_invoices_number"),
        CheckConstraint(
            "type IN ('invoice', 'credit_note')", name="ck_shop_invoices_type"
        ),
        CheckConstraint(
            "status IN ('issued', 'void')", name="ck_shop_invoices_status"
        ),
        CheckConstraint(
            "net_cents >= 0 AND tax_cents >= 0 AND gross_cents >= 0",
            name="ck_shop_invoices_cents",
        ),
        Index("ix_shop_invoices_user_issued", "user_id", "issued_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shop_orders.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(16), default="invoice", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="issued", nullable=False)
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    due_date: Mapped[datetime] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    buyer_reference: Mapped[str] = mapped_column(String(64), nullable=False)

    seller_name: Mapped[str] = mapped_column(String(200), nullable=False)
    seller_street: Mapped[str] = mapped_column(String(200), nullable=False)
    seller_postal_code: Mapped[str] = mapped_column(String(16), nullable=False)
    seller_city: Mapped[str] = mapped_column(String(120), nullable=False)
    seller_country: Mapped[str] = mapped_column(String(2), nullable=False)
    seller_email: Mapped[str] = mapped_column(String(254), nullable=False)
    seller_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    seller_vat_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    seller_tax_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    seller_iban: Mapped[str | None] = mapped_column(String(34), nullable=True)
    seller_bic: Mapped[str | None] = mapped_column(String(11), nullable=True)
    small_business: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    buyer_name: Mapped[str] = mapped_column(String(160), nullable=False)
    buyer_street: Mapped[str] = mapped_column(String(160), nullable=False)
    buyer_postal_code: Mapped[str] = mapped_column(String(16), nullable=False)
    buyer_city: Mapped[str] = mapped_column(String(120), nullable=False)
    buyer_country: Mapped[str] = mapped_column(String(2), nullable=False)
    buyer_email: Mapped[str] = mapped_column(String(254), nullable=False)
    buyer_vat_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    net_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    gross_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    xml_text: Mapped[str] = mapped_column(Text, nullable=False)
    xml_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pdf_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    pdf_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Nur bei Gutschriften: Ursprungsrechnung und Grund.
    reference_invoice_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("shop_invoices.id", ondelete="SET NULL"),
        nullable=True,
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class ShopCreditNoteSequence(Base):
    """Eigener Nummernkreis fuer Gutschriften je Jahr."""

    __tablename__ = "shop_credit_note_sequences"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ShopInvoiceLine(Base):
    """Rechnungsposition als Snapshot; Betraege netto in Cent."""

    __tablename__ = "shop_invoice_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_shop_invoice_lines_quantity"),
        UniqueConstraint("invoice_id", "position", name="uq_shop_invoice_lines_pos"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    invoice_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shop_invoices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_code: Mapped[str] = mapped_column(String(8), default="C62", nullable=False)
    unit_price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    line_net_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_rate_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_category: Mapped[str] = mapped_column(String(4), default="S", nullable=False)
