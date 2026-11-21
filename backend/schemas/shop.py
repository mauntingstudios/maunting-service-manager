"""Schemas fuer den nativen Shop-Katalog."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ArtworkMode = Literal["steam", "custom", "none"]
BillingInterval = Literal["month"]


class ShopPlanWrite(BaseModel):
    game_type: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = Field(None, max_length=4096)
    price_cents: int = Field(..., ge=0, le=100_000_000)
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


OrderMonths = Literal[1, 3, 12]
OrderStatus = Literal["pending_payment", "paid", "cancelled", "refunded", "failed"]
SubscriptionStatus = Literal["active", "past_due", "cancelled"]
EntitlementKind = Literal["server", "role", "addon"]
EntitlementStatus = Literal["active", "suspended", "revoked"]


class ShopOrderCreate(BaseModel):
    """Kaufwunsch: Tarif plus gewaehlte Ressourcen. Preise kommen vom Server."""

    plan_id: int = Field(..., ge=1)
    months: OrderMonths = 1
    ram_mb: int | None = Field(None, ge=0, le=4_194_304)
    cpu: int | None = Field(None, ge=0, le=10_000)
    slots: int | None = Field(None, ge=0, le=100_000)

    # Rechnungsanschrift; ohne sie wird keine Rechnung ausgestellt.
    buyer_name: str | None = Field(None, max_length=160)
    buyer_street: str | None = Field(None, max_length=160)
    buyer_postal_code: str | None = Field(None, max_length=16)
    buyer_city: str | None = Field(None, max_length=120)
    buyer_country: str | None = Field(None, pattern=r"^[A-Z]{2}$")
    buyer_email: str | None = Field(None, max_length=254)


class ShopOrderItemResponse(BaseModel):
    id: int
    kind: Literal["plan", "addon"]
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
    months: int
    discount_percent: int
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
    game_type: str
    name: str
    status: SubscriptionStatus
    billing_interval: str
    monthly_gross_cents: int
    tax_rate_percent: int
    started_at: datetime
    current_period_end: datetime
    cancel_at_period_end: bool


class ShopCheckoutResponse(BaseModel):
    checkout_url: str


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
    label: str
    status: EntitlementStatus
    server_id: int | None = None
    provisioning_status: str | None = None
    provisioning_error: str | None = None
    created_at: datetime


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


class ShopCatalogPlan(BaseModel):
    """Oeffentliche Sicht: keine Node-/Rollen-IDs, nur was der Shop braucht."""

    id: int
    game_type: str
    game_name: str
    game_description: str | None
    game_category: str
    supports_mods: bool
    supports_workshop: bool
    name: str
    description: str | None
    price_cents: int
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
