"""Schemas fuer den nativen Shop-Katalog."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

ArtworkMode = Literal["steam", "custom", "none"]
BillingInterval = Literal["month"]
AddonCategory = Literal["ai_quota", "slots", "backups", "storage", "role"]
CouponDiscountType = Literal["percent", "fixed_cents"]
CouponScope = Literal["all", "plans", "addons"]


class ShopPlanWrite(BaseModel):
    game_type: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = Field(None, max_length=4096)
    price_cents: int = Field(..., ge=0, le=100_000_000)
    lifetime_price_cents: int | None = Field(None, ge=0, le=100_000_000)
    allow_game_switch: bool = True
    currency: str = Field("EUR", min_length=3, max_length=3)
    billing_interval: BillingInterval = "month"
    tax_rate_percent: int = Field(19, ge=0, le=100)

    ram_included_mb: int | None = Field(None, ge=0, le=4_194_304)
    ram_max_mb: int | None = Field(None, ge=0, le=4_194_304)
    ram_step_mb: int | None = Field(None, ge=1, le=1_048_576)
    price_per_ram_step_cents: int = Field(0, ge=0, le=100_000_000)

    cpu_included: int | None = Field(None, ge=0, le=10_000)
    cpu_max: int | None = Field(None, ge=0, le=10_000)
    cpu_step: int = Field(1, ge=1, le=10_000)
    price_per_cpu_step_cents: int = Field(0, ge=0, le=100_000_000)

    slots_included: int | None = Field(None, ge=0, le=100_000)
    slots_max: int | None = Field(None, ge=0, le=100_000)
    slots_step: int = Field(1, ge=1, le=100_000)
    price_per_slot_step_cents: int = Field(0, ge=0, le=100_000_000)

    node_id: int | None = Field(None, ge=1)
    role_id: int | None = Field(None, ge=1)

    artwork_mode: ArtworkMode = "steam"
    active: bool = True
    sort_order: int = Field(0, ge=-100_000, le=100_000)


class ShopPlanUpdate(BaseModel):
    game_type: str | None = Field(None, min_length=1, max_length=64)
    name: str | None = Field(None, min_length=1, max_length=128)
    description: str | None = Field(None, max_length=4096)
    price_cents: int | None = Field(None, ge=0, le=100_000_000)
    lifetime_price_cents: int | None = Field(None, ge=0, le=100_000_000)
    allow_game_switch: bool | None = None
    currency: str | None = Field(None, min_length=3, max_length=3)
    billing_interval: BillingInterval | None = None
    tax_rate_percent: int | None = Field(None, ge=0, le=100)

    ram_included_mb: int | None = Field(None, ge=0, le=4_194_304)
    ram_max_mb: int | None = Field(None, ge=0, le=4_194_304)
    ram_step_mb: int | None = Field(None, ge=1, le=1_048_576)
    price_per_ram_step_cents: int | None = Field(None, ge=0, le=100_000_000)

    cpu_included: int | None = Field(None, ge=0, le=10_000)
    cpu_max: int | None = Field(None, ge=0, le=10_000)
    cpu_step: int | None = Field(None, ge=1, le=10_000)
    price_per_cpu_step_cents: int | None = Field(None, ge=0, le=100_000_000)

    slots_included: int | None = Field(None, ge=0, le=100_000)
    slots_max: int | None = Field(None, ge=0, le=100_000)
    slots_step: int | None = Field(None, ge=1, le=100_000)
    price_per_slot_step_cents: int | None = Field(None, ge=0, le=100_000_000)

    node_id: int | None = Field(None, ge=1)
    role_id: int | None = Field(None, ge=1)

    artwork_mode: ArtworkMode | None = None
    active: bool | None = None
    sort_order: int | None = Field(None, ge=-100_000, le=100_000)


class ShopArtworkResponse(BaseModel):
    source: ArtworkMode | Literal["panorama"]
    url: str | None = None
    version: str | None = None


class ShopPlanResponse(BaseModel):
    id: int
    game_type: str
    name: str
    description: str | None
    price_cents: int
    lifetime_price_cents: int | None = None
    allow_game_switch: bool = True
    currency: str
    billing_interval: str
    tax_rate_percent: int
    ram_included_mb: int | None
    ram_max_mb: int | None
    ram_step_mb: int | None
    price_per_ram_step_cents: int
    cpu_included: int | None
    cpu_max: int | None
    cpu_step: int
    price_per_cpu_step_cents: int
    slots_included: int | None
    slots_max: int | None
    slots_step: int
    price_per_slot_step_cents: int
    node_id: int | None
    role_id: int | None
    artwork_mode: ArtworkMode
    active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
    artwork: ShopArtworkResponse


class ShopAddonWrite(BaseModel):
    slug: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = Field(None, max_length=4096)
    category: AddonCategory
    price_cents: int = Field(..., ge=0, le=100_000_000)
    currency: str = Field("EUR", min_length=3, max_length=3)
    billing_interval: BillingInterval = "month"
    tax_rate_percent: int = Field(19, ge=0, le=100)

    extra_slots: int | None = Field(None, ge=0, le=100_000)
    extra_storage_mb: int | None = Field(None, ge=0, le=100_000_000)
    extra_backups: int | None = Field(None, ge=0, le=10_000)
    extra_ai_tokens: int | None = Field(None, ge=0, le=1_000_000_000)
    role_id: int | None = Field(None, ge=1)

    active: bool = True
    sort_order: int = Field(0, ge=-100_000, le=100_000)


class ShopAddonUpdate(BaseModel):
    slug: str | None = Field(None, min_length=2, max_length=64)
    name: str | None = Field(None, min_length=1, max_length=128)
    description: str | None = Field(None, max_length=4096)
    category: AddonCategory | None = None
    price_cents: int | None = Field(None, ge=0, le=100_000_000)
    currency: str | None = Field(None, min_length=3, max_length=3)
    billing_interval: BillingInterval | None = None
    tax_rate_percent: int | None = Field(None, ge=0, le=100)

    extra_slots: int | None = Field(None, ge=0, le=100_000)
    extra_storage_mb: int | None = Field(None, ge=0, le=100_000_000)
    extra_backups: int | None = Field(None, ge=0, le=10_000)
    extra_ai_tokens: int | None = Field(None, ge=0, le=1_000_000_000)
    role_id: int | None = Field(None, ge=1)

    active: bool | None = None
    sort_order: int | None = Field(None, ge=-100_000, le=100_000)


class ShopRoleBenefits(BaseModel):
    role_name: str
    vault_quota_bytes: int | None = None
    ai_daily_tokens: int | None = None
    ai_weekly_tokens: int | None = None
    ai_monthly_tokens: int | None = None
    ai_realtime_minutes: int | None = None
    ai_dictation_minutes: int | None = None
    ai_model_count: int = 0


class ShopAddonResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None
    category: AddonCategory
    price_cents: int
    currency: str
    billing_interval: str
    tax_rate_percent: int
    extra_slots: int | None
    extra_storage_mb: int | None
    extra_backups: int | None
    extra_ai_tokens: int | None
    role_id: int | None
    role_benefits: ShopRoleBenefits | None = None
    active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ShopCatalogAddon(BaseModel):
    """Oeffentliche Sicht auf eigenstaendige Add-ons ohne interne Rollen-ID."""

    id: int
    slug: str
    name: str
    description: str | None
    category: AddonCategory
    price_cents: int
    currency: str
    billing_interval: str
    tax_rate_percent: int
    extra_slots: int | None
    extra_storage_mb: int | None
    extra_backups: int | None
    extra_ai_tokens: int | None
    grants_role: bool = False
    role_benefits: ShopRoleBenefits | None = None


class ShopAddonSwitchRequest(BaseModel):
    target_addon_id: int = Field(..., ge=1)


OrderMonths = Literal[1, 3, 12]
BillingMode = Literal["prepaid", "subscription", "lifetime"]
OrderStatus = Literal["pending_payment", "paid", "cancelled", "refunded", "failed"]
SubscriptionStatus = Literal["active", "past_due", "cancelled"]
EntitlementKind = Literal["server", "role", "addon"]
EntitlementStatus = Literal["active", "suspended", "revoked"]


class ShopOrderCreate(BaseModel):
    """Kaufwunsch: Tarif plus gewaehlte Ressourcen oder eigenstaendiges Add-on."""

    plan_id: int | None = Field(None, ge=1)
    addon_id: int | None = Field(None, ge=1)
    months: OrderMonths = 1
    billing_mode: BillingMode = "subscription"
    ram_mb: int | None = Field(None, ge=0, le=4_194_304)
    cpu: int | None = Field(None, ge=0, le=10_000)
    slots: int | None = Field(None, ge=0, le=100_000)
    coupon_code: str | None = Field(None, max_length=48)
    captcha_token: str | None = Field(None, max_length=4096)

    # Rechnungsanschrift; ohne sie wird keine Rechnung ausgestellt.
    buyer_name: str | None = Field(None, max_length=160)
    buyer_street: str | None = Field(None, max_length=160)
    buyer_postal_code: str | None = Field(None, max_length=16)
    buyer_city: str | None = Field(None, max_length=120)
    buyer_country: str | None = Field(None, pattern=r"^[A-Z]{2}$")
    buyer_email: str | None = Field(None, max_length=254)

    @model_validator(mode="after")
    def _validate_target(self) -> "ShopOrderCreate":
        if bool(self.plan_id is not None) == bool(self.addon_id is not None):
            raise ValueError("Genau plan_id oder addon_id muss angegeben sein")
        return self


class ShopAdminManualOrderCreate(BaseModel):
    """Manuelle Admin-Bestellung fuer einen Kunden (Gutschrift/Kulanz/Rechnung)."""

    user_id: int = Field(..., ge=1)
    plan_id: int | None = Field(None, ge=1)
    addon_id: int | None = Field(None, ge=1)
    months: OrderMonths = 1
    ram_mb: int | None = Field(None, ge=0, le=4_194_304)
    cpu: int | None = Field(None, ge=0, le=10_000)
    slots: int | None = Field(None, ge=0, le=100_000)
    coupon_code: str | None = Field(None, max_length=48)
    mark_paid: bool = True
    note: str | None = Field(None, max_length=300)

    buyer_name: str | None = Field(None, max_length=160)
    buyer_street: str | None = Field(None, max_length=160)
    buyer_postal_code: str | None = Field(None, max_length=16)
    buyer_city: str | None = Field(None, max_length=120)
    buyer_country: str | None = Field(None, pattern=r"^[A-Z]{2}$")
    buyer_email: str | None = Field(None, max_length=254)

    @model_validator(mode="after")
    def _validate_target(self) -> "ShopAdminManualOrderCreate":
        if bool(self.plan_id is not None) == bool(self.addon_id is not None):
            raise ValueError("Genau plan_id oder addon_id muss angegeben sein")
        return self


class ShopCouponWrite(BaseModel):
    code: str = Field(..., min_length=3, max_length=48)
    name: str = Field(..., min_length=1, max_length=128)
    promo_text: str | None = Field(None, max_length=240)
    discount_type: CouponDiscountType = "percent"
    discount_value: int = Field(..., ge=1, le=100_000_000)
    currency: str = Field("EUR", min_length=3, max_length=3)
    scope: CouponScope = "all"
    target_plan_ids: list[int] = Field(default_factory=list, max_length=200)
    min_gross_cents: int = Field(0, ge=0, le=100_000_000)
    max_redemptions: int | None = Field(None, ge=1, le=1_000_000)
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    show_badge: bool = False
    show_banner: bool = False
    banner_cooldown_hours: int = Field(6, ge=0, le=720)
    active: bool = True


class ShopCouponUpdate(BaseModel):
    code: str | None = Field(None, min_length=3, max_length=48)
    name: str | None = Field(None, min_length=1, max_length=128)
    promo_text: str | None = Field(None, max_length=240)
    discount_type: CouponDiscountType | None = None
    discount_value: int | None = Field(None, ge=1, le=100_000_000)
    currency: str | None = Field(None, min_length=3, max_length=3)
    scope: CouponScope | None = None
    target_plan_ids: list[int] | None = Field(None, max_length=200)
    min_gross_cents: int | None = Field(None, ge=0, le=100_000_000)
    max_redemptions: int | None = Field(None, ge=1, le=1_000_000)
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    show_badge: bool | None = None
    show_banner: bool | None = None
    banner_cooldown_hours: int | None = Field(None, ge=0, le=720)
    active: bool | None = None


class ShopCouponResponse(BaseModel):
    id: int
    code: str
    name: str
    promo_text: str | None
    discount_type: CouponDiscountType
    discount_value: int
    currency: str
    scope: CouponScope
    target_plan_ids: list[int]
    min_gross_cents: int
    max_redemptions: int | None
    redemption_count: int
    valid_from: datetime | None
    valid_until: datetime | None
    show_badge: bool
    show_banner: bool
    banner_cooldown_hours: int
    stripe_coupon_id: str | None
    stripe_promotion_code_id: str | None
    active: bool
    created_at: datetime
    updated_at: datetime


class ShopCouponPreviewRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=48)
    kind: Literal["plan", "addon"] = "plan"
    plan_id: int | None = Field(None, ge=1)
    gross_cents: int = Field(..., ge=0, le=100_000_000)


class ShopCouponPreviewResponse(BaseModel):
    valid: bool
    code: str
    discount_type: CouponDiscountType | None = None
    discount_value: int | None = None
    discount_cents: int = 0
    final_gross_cents: int
    reason: str | None = None


class ShopPublicBannerPromo(BaseModel):
    code: str
    name: str
    promo_text: str | None
    discount_type: CouponDiscountType
    discount_value: int
    scope: CouponScope
    cooldown_hours: int
    valid_until: datetime | None = None


class ShopPublicBadgePromo(BaseModel):
    code: str
    name: str
    discount_type: CouponDiscountType
    discount_value: int
    scope: CouponScope
    target_plan_ids: list[int]


class ShopPublicPromosResponse(BaseModel):
    banner: ShopPublicBannerPromo | None = None
    banners: list[ShopPublicBannerPromo] = Field(default_factory=list)
    badges: list[ShopPublicBadgePromo] = Field(default_factory=list)


class ShopStatsResponse(BaseModel):
    total_orders: int
    paid_orders: int
    pending_orders: int
    refunded_orders: int
    paid_gross_cents: int
    paid_net_cents: int
    refunded_gross_cents: int
    active_subscriptions: int
    active_addon_subscriptions: int
    active_coupons: int
    coupon_redemptions: int


class ShopOrderItemResponse(BaseModel):
    id: int
    kind: Literal["plan", "addon"]
    plan_id: int | None = None
    addon_id: int | None = None
    game_type: str
    name: str
    quantity: int
    unit_price_cents: int
    tax_rate_percent: int
    net_cents: int
    tax_cents: int
    gross_cents: int
    ram_mb: int | None
    cpu: int | None
    slots: int | None


class ShopOrderResponse(BaseModel):
    id: int
    number: str
    status: OrderStatus
    currency: str
    billing_interval: str
    billing_mode: BillingMode = "subscription"
    extend_subscription_id: int | None = None
    months: int
    discount_percent: int
    coupon_code: str | None = None
    coupon_discount_cents: int = 0
    net_cents: int
    tax_cents: int
    gross_cents: int
    payment_provider: str
    payment_reference: str | None
    created_at: datetime
    paid_at: datetime | None
    items: list[ShopOrderItemResponse]


class ShopSubscriptionResponse(BaseModel):
    id: int
    plan_id: int | None = None
    addon_id: int | None = None
    game_type: str
    name: str
    status: SubscriptionStatus
    billing_interval: str
    billing_mode: BillingMode = "subscription"
    monthly_gross_cents: int
    tax_rate_percent: int
    started_at: datetime
    current_period_end: datetime
    cancel_at_period_end: bool
    delete_server_on_end: bool = False
    server_entitlement_id: int | None = None
    server_name: str | None = None
    can_immediate_delete: bool = False


class ShopSubscriptionExtendRequest(BaseModel):
    months: OrderMonths = 1


class ShopSubscriptionCancelRequest(BaseModel):
    deletion_mode: Literal["grace_period", "end_of_period_immediate", "immediate"] = (
        "grace_period"
    )
    confirm_server_name: str | None = Field(None, max_length=128)


class ShopEntitlementPurgeRequest(BaseModel):
    confirm_server_name: str = Field(..., min_length=1, max_length=128)


class ShopGraceBackupItem(BaseModel):
    id: int
    name: str
    size_mb: float | None = None
    created_at: datetime
    encrypted: bool = False
    downloadable: bool = False


class ShopLifecycleSettingsPayload(BaseModel):
    cancel_grace_days: int = Field(7, ge=0, le=365)
    unpaid_auto_delete_enabled: bool = True
    unpaid_delete_days: int = Field(30, ge=1, le=365)
    allow_customer_immediate_delete: bool = True
    dunning_reminder_days: list[int] = Field(default_factory=lambda: [7, 4, 1], max_length=10)
    subscription_discount_percent: int = Field(0, ge=0, le=50)
    refund_guarantee_days: int = Field(0, ge=0, le=30)
    refund_policy_note: str = Field("", max_length=280)
    auto_subdomain_enabled: bool = False
    auto_subdomain_zone: str = Field("", max_length=128)
    pause_freeze_max_days_per_90d: int = Field(0, ge=0, le=90)
    shop_checkout_captcha_enabled: bool = False


class ShopLifecycleSettingsResponse(ShopLifecycleSettingsPayload):
    pass


class ShopPublicPolicyResponse(BaseModel):
    default_billing_mode: BillingMode = "prepaid"
    subscription_discount_percent: int = 0
    refund_guarantee_days: int = 0
    refund_policy_note: str = ""
    cancel_grace_days: int = 7
    auto_subdomain_enabled: bool = False
    auto_subdomain_zone: str = ""
    pause_freeze_max_days_per_90d: int = 0
    shop_checkout_captcha_enabled: bool = False


class ShopPublicNodeStatusResponse(BaseModel):
    """Oeffentliche, nicht-sensitive Kapazitaets- und Hardware-Uebersicht."""

    id: int
    name: str
    location_label: str | None = None
    status: str
    cpu_model: str | None = None
    ram_type: str | None = None
    storage_type: str | None = None
    ram_free_percent: int | None = None
    load_level: Literal["low", "medium", "high", "full", "offline"]
    accepting_orders: bool
    public_ping_url: str | None = None
    ddos_provider: str | None = None
    ddos_profile: str | None = None
    ddos_game_aware: bool = False


class ShopNodePingResponse(BaseModel):
    """Serverseitige Node-Agent-Latenzmessung ohne IP-/Token-Leak."""

    node_id: int
    status: str
    server_agent_rtt_ms: float | None = None
    timestamp_ms: int


class ShopCheckoutRequest(BaseModel):
    return_url: str | None = Field(None, max_length=512)
    cancel_url: str | None = Field(None, max_length=512)


class ShopCheckoutResponse(BaseModel):
    checkout_url: str


class ShopHandoffRequest(BaseModel):
    target: Literal["catalog", "game", "addon", "konto"] = "catalog"
    game_type: str | None = Field(None, max_length=64)
    addon_id: int | None = Field(None, ge=1)
    coupon_code: str | None = Field(None, max_length=48)
    app_return_url: str | None = Field(None, max_length=512)


class ShopHandoffResponse(BaseModel):
    url: str


class ShopStripeKeysUpdate(BaseModel):
    """Leere/fehlende Felder bleiben unveraendert; leere Strings loeschen."""

    secret_key: str | None = Field(None, max_length=200)
    webhook_secret: str | None = Field(None, max_length=200)
    publishable_key: str | None = Field(None, max_length=200)


class ShopStripeStatus(BaseModel):
    configured: bool
    mode: Literal["test", "live", "unknown"]
    secret_key_source: Literal["env", "panel", "none"]
    webhook_secret_source: Literal["env", "panel", "none"]
    publishable_key: str


class ShopSellerSettings(BaseModel):
    name: str = ""
    street: str = ""
    postal_code: str = ""
    city: str = ""
    country: str = "DE"
    email: str = ""
    phone: str = ""
    vat_id: str = ""
    tax_number: str = ""
    iban: str = ""
    bic: str = ""
    payment_terms_days: int = 14
    invoice_prefix: str = "RE"
    small_business: bool = False
    missing_fields: list[str] = Field(default_factory=list)


class ShopSellerSettingsUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    street: str | None = Field(None, max_length=200)
    postal_code: str | None = Field(None, max_length=16)
    city: str | None = Field(None, max_length=120)
    country: str | None = Field(None, pattern=r"^[A-Z]{2}$")
    email: str | None = Field(None, max_length=254)
    phone: str | None = Field(None, max_length=64)
    vat_id: str | None = Field(None, max_length=32)
    tax_number: str | None = Field(None, max_length=32)
    iban: str | None = Field(None, max_length=34)
    bic: str | None = Field(None, max_length=11)
    payment_terms_days: int | None = Field(None, ge=0, le=365)
    invoice_prefix: str | None = Field(None, pattern=r"^[A-Z0-9]{1,8}$")
    small_business: bool | None = None


class ShopInvoiceLineResponse(BaseModel):
    position: int
    description: str
    quantity: int
    unit_code: str
    unit_price_cents: int
    line_net_cents: int
    tax_rate_percent: int
    tax_category: Literal["S", "E"]


class ShopInvoiceSummaryResponse(BaseModel):
    id: int
    number: str
    order_id: int
    order_number: str
    type: Literal["invoice", "credit_note"]
    status: Literal["issued", "void"]
    issued_at: datetime
    due_date: date
    currency: str
    buyer_reference: str
    net_cents: int
    tax_cents: int
    gross_cents: int
    reference_invoice_id: int | None = None
    reason: str | None = None


class ShopCreditNoteCreate(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class ShopInvoiceResponse(ShopInvoiceSummaryResponse):
    seller_name: str
    seller_vat_id: str | None
    buyer_name: str
    buyer_email: str
    lines: list[ShopInvoiceLineResponse]


class ShopEntitlementResponse(BaseModel):
    id: int
    kind: EntitlementKind
    addon_id: int | None = None
    label: str
    status: EntitlementStatus
    server_id: int | None = None
    server_name: str | None = None
    provisioning_status: str | None = None
    provisioning_error: str | None = None
    purge_after: datetime | None = None
    purge_reason: str | None = None
    purged_at: datetime | None = None
    can_customer_purge_now: bool = False
    paused_at: datetime | None = None
    pause_days_used: int = 0
    created_at: datetime


class ShopAddonSwitchResponse(BaseModel):
    subscription: ShopSubscriptionResponse
    entitlement: ShopEntitlementResponse
    previous_addon_id: int | None = None
    new_addon_id: int
    role_changed: bool = False


class ShopRefundCreate(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class ShopRefundResponse(BaseModel):
    order: ShopOrderResponse
    credit_note_number: str | None = None


class ShopReconciliationResponse(BaseModel):
    orders_checked: int
    orders_marked_paid: int
    orders_expired: int
    invoices_issued: int
    entitlements_synced: int
    pending_orders_remaining: int
    failed_entitlements_remaining: int
    errors: list[str]


class ShopAdminOrderResponse(ShopOrderResponse):
    user_id: int
    username: str | None = None
    entitlements: list[ShopEntitlementResponse] = Field(default_factory=list)


class ShopPaymentEventResponse(BaseModel):
    id: int
    event_id: str
    event_type: str
    order_id: int | None = None
    status: str
    received_at: datetime


class ShopServerSubscriptionResponse(BaseModel):
    has_subscription: bool
    subscription: ShopSubscriptionResponse | None = None
    entitlement: ShopEntitlementResponse | None = None
    ram_mb: int | None = None
    cpu: int | None = None
    slots: int | None = None


class ShopEinvoiceToolchainStatusResponse(BaseModel):
    ghostscript: bool
    java: bool
    kosit_validator: bool
    kosit_config: bool
    verapdf: bool
    srgb_icc: bool
    pdfa3_ready: bool
    xrechnung_validation_ready: bool
    facturx_certified_ready: bool


class ShopXRechnungValidationResult(BaseModel):
    available: bool
    valid: bool
    errors: list[str] = Field(default_factory=list)


class ShopPdfa3ValidationResult(BaseModel):
    available: bool
    valid: bool
    flavour: str = "3b"
    errors: list[str] = Field(default_factory=list)


class ShopInvoiceValidationResponse(BaseModel):
    invoice_id: int
    invoice_number: str
    xrechnung: ShopXRechnungValidationResult
    pdfa3: ShopPdfa3ValidationResult


class ShopServerPlayersResponse(BaseModel):
    server_id: int
    protocol: str
    online: bool
    players: int | None = None
    max_players: int | None = None
    server_name: str | None = None
    booked_slots: int | None = None
    slot_exceeded: bool = False
    warning: str | None = None
    error: str | None = None


class ShopServerSlotsUpdate(BaseModel):
    slots: int = Field(..., ge=1, le=1000)


class ShopServerSlotsResponse(BaseModel):
    server_id: int
    slots: int
    previous_slots: int | None = None
    target_type: str
    downgrade_warning: bool = False
    restart_required: bool = False
    live_players: int | None = None


class ShopCatalogPlan(BaseModel):
    """Oeffentliche Sicht: keine Node-/Rollen-IDs, nur was der Shop braucht."""

    id: int
    game_type: str
    game_name: str
    game_description: str | None
    game_category: str
    supports_mods: bool
    supports_workshop: bool
    supports_slots: bool = False
    name: str
    description: str | None
    price_cents: int
    lifetime_price_cents: int | None = None
    allow_game_switch: bool = True
    currency: str
    billing_interval: str
    tax_rate_percent: int
    ram_included_mb: int | None
    ram_max_mb: int | None
    ram_step_mb: int | None
    price_per_ram_step_cents: int
    cpu_included: int | None
    cpu_max: int | None
    cpu_step: int
    price_per_cpu_step_cents: int
    slots_included: int | None
    slots_max: int | None
    slots_step: int
    price_per_slot_step_cents: int
    artwork: ShopArtworkResponse
    available: bool = True
    availability_reason: str | None = None
    max_available_ram_mb: int | None = None
    max_available_cpu: int | None = None
    hardware_cpu_model: str | None = None
    hardware_ram_type: str | None = None
    hardware_storage_type: str | None = None
    estimated_setup_seconds: int = 120
    platforms: list[str] = Field(default_factory=lambda: ["pc"])
    ddos_provider: str | None = None
    ddos_profile: str | None = None
    ddos_game_aware: bool = False


class ShopAvailabilityRequest(BaseModel):
    plan_id: int = Field(..., ge=1)
    ram_mb: int | None = Field(None, ge=0, le=4_194_304)
    cpu: int | None = Field(None, ge=0, le=10_000)


class ShopAvailabilityResponse(BaseModel):
    available: bool
    reason: str | None = None
    available_nodes: int = 0
    max_ram_mb: int | None = None
    max_cpu: int | None = None


class ShopGalleryItem(BaseModel):
    id: str
    source: Literal["custom", "steam"]
    url: str
    is_primary: bool
    wallpaper_id: int | None = None
