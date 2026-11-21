"""Schemas der Hoster-Anbindung.

Alle Lese-Antworten sind bewusst secret-frei: API-Key und Webhook-Secret
erscheinen ausschliesslich als `*_configured`-Flag und als nicht umkehrbarer
Hinweis auf die letzten vier Zeichen.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


# ── Panel-Verwaltung ───────────────────────────────────────────────────────


class HosterIntegrationWrite(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    slug: str = Field(..., min_length=1, max_length=64)
    enabled: bool = True
    is_sandbox: bool = False
    service_user_id: int = Field(..., ge=1)
    webhook_url: str | None = Field(None, max_length=2048)
    terminate_grace_days: int = Field(7, ge=0, le=365)


class HosterIntegrationUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    enabled: bool | None = None
    is_sandbox: bool | None = None
    service_user_id: int | None = Field(None, ge=1)
    webhook_url: str | None = Field(None, max_length=2048)
    terminate_grace_days: int | None = Field(None, ge=0, le=365)


class HosterIntegrationResponse(BaseModel):
    id: int
    name: str
    slug: str
    enabled: bool
    is_sandbox: bool
    service_user_id: int
    webhook_url: str | None
    terminate_grace_days: int
    api_key_hint: str | None
    webhook_secret_configured: bool
    webhook_secret_hint: str | None
    created_at: datetime
    updated_at: datetime


class HosterSecretResponse(BaseModel):
    """Einmalige Ausgabe eines frisch erzeugten Geheimnisses."""

    value: str
    hint: str


class HosterProductWrite(BaseModel):
    external_product_key: str = Field(..., min_length=1, max_length=128)
    game_type: str = Field(..., min_length=1, max_length=64)
    ram_limit_mb: int | None = Field(None, ge=512, le=4_194_304)
    cpu_limit_percent: int | None = Field(None, ge=10, le=3_200)
    disk_limit_gb: int | None = Field(None, ge=1, le=1_048_576)
    node_id: int | None = Field(None, ge=1)
    backup_interval_hours: int | None = Field(None, ge=1, le=8_760)
    role_id: int | None = Field(None, ge=1)
    enabled: bool = True


class HosterProductResponse(BaseModel):
    id: int
    integration_id: int
    external_product_key: str
    game_type: str
    ram_limit_mb: int | None
    cpu_limit_percent: int | None
    disk_limit_gb: int | None
    node_id: int | None
    backup_interval_hours: int | None
    role_id: int | None
    enabled: bool


class HosterServiceResponse(BaseModel):
    """Vertragszustand — ohne Node, Ports, Pfade oder Kundendaten."""

    external_service_id: str
    item_kind: Literal["server", "addon"] = "server"
    addon_slug: str | None = None
    desired_state: str
    status: str
    status_code: str | None
    server_id: int | None
    task_id: str | None
    correlation_id: str
    terminate_after: datetime | None
    updated_at: datetime


class HosterDeliveryResponse(BaseModel):
    id: int
    event_type: str
    status: str
    attempt: int
    response_code: int | None
    error: str | None
    correlation_id: str
    created_at: datetime
    sent_at: datetime | None


# ── Externe API ────────────────────────────────────────────────────────────


class HosterDesiredStateRequest(BaseModel):
    """Der gewuenschte Zustand eines Vertrags.

    Der Shop uebermittelt bewusst keine internen MSM-Details: keine Node-ID,
    keine Ports, keine Pfade. MSM loest das technische Ziel selbst auf.
    """

    desired_state: str = Field(..., pattern=r"^(active|suspended|terminated)$")
    external_subject: str = Field(..., min_length=1, max_length=128)
    product_key: str | None = Field(None, min_length=1, max_length=128)
    email: str | None = Field(None, max_length=255)


class HosterHandoffRequest(BaseModel):
    external_service_id: str = Field(..., min_length=1, max_length=128)
    target_path: str | None = Field(None, max_length=128)


class HosterHandoffResponse(BaseModel):
    """Der Klartext-Token wird genau einmal ausgegeben und nie gespeichert."""

    url: str
    expires_at: datetime


class HosterApplyItem(BaseModel):
    """Einzelposition im Hoster-API-v2-Batch (`server` oder eigenstaendiges `addon`)."""

    external_service_id: str = Field(..., min_length=1, max_length=128)
    kind: Literal["server", "addon"] = "server"
    product_key: str | None = Field(None, min_length=1, max_length=128)
    addon_slug: str | None = Field(None, min_length=1, max_length=64)
    slots: int | None = Field(None, ge=1, le=1000)
    desired_state: Literal["active", "suspended", "terminated"] | None = None

    @model_validator(mode="after")
    def _validate_item_fields(self) -> "HosterApplyItem":
        if not self.external_service_id.strip():
            raise ValueError("external_service_id darf nicht leer sein")
        if self.kind == "server":
            if self.addon_slug is not None:
                raise ValueError("Server-Positionen akzeptieren kein addon_slug")
        else:
            if self.product_key is not None or self.slots is not None:
                raise ValueError(
                    "Add-on-Positionen akzeptieren weder product_key noch slots"
                )
        return self


class HosterApplyRequest(BaseModel):
    """Deklarativer Sammelauftrag der Hoster-API v2 (`POST /api/hoster/v1/apply`)."""

    external_subject: str = Field(..., min_length=1, max_length=128)
    desired_state: Literal["active", "suspended", "terminated"]
    email: str | None = Field(None, max_length=255)
    items: list[HosterApplyItem] = Field(..., min_length=1, max_length=50)

    @model_validator(mode="after")
    def _validate_unique_items(self) -> "HosterApplyRequest":
        seen: set[str] = set()
        for item in self.items:
            key = item.external_service_id.strip()
            if key in seen:
                raise ValueError(f"Doppelte external_service_id im Batch: {key}")
            seen.add(key)
        return self


class HosterApplyItemResult(HosterServiceResponse):
    ok: bool = True
    error_code: str | None = None


class HosterApplyResponse(BaseModel):
    external_subject: str
    desired_state: Literal["active", "suspended", "terminated"]
    sandbox: bool
    correlation_id: str
    items: list[HosterApplyItemResult]


# ── Simulator ──────────────────────────────────────────────────────────────


class HosterSimulationRequest(BaseModel):
    action: str = Field(..., pattern=r"^(order|suspend|reactivate|terminate|test_webhook)$")
    product_key: str | None = Field(None, max_length=128)
    external_service_id: str | None = Field(None, max_length=128)
    email: str | None = Field(None, max_length=255)


class HosterSimulationResponse(BaseModel):
    ok: bool
    action: str
    message: str
    service: HosterServiceResponse | None = None
    handoff_url: str | None = None
    webhook_status: str | None = None

