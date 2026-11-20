"""Schemas fuer den nativen Shop-Katalog."""

from __future__ import annotations

from datetime import datetime
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
