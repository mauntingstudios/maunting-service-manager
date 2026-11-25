from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

from services.tls_pinning import normalize_fingerprint


class NodeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    host: str = Field(..., min_length=1, max_length=255)
    # Plaintext agent token — encrypted before DB store; never returned in responses
    auth_token: str = Field(..., min_length=16, max_length=512)
    # SHA-256 cert fingerprint (hex). Required for remote https:// agents.
    tls_fingerprint: str | None = Field(default=None, max_length=128)

    @field_validator("name", mode="before")
    @classmethod
    def _trim_name(cls, value: object) -> str:
        name = str(value).strip()
        if not name:
            raise ValueError("name darf nicht leer sein")
        return name

    @field_validator("tls_fingerprint", mode="before")
    @classmethod
    def _norm_fp(cls, v: object) -> str | None:
        if v is None or v == "":
            return None
        fp = normalize_fingerprint(str(v))
        if fp and (len(fp) != 64 or any(c not in "0123456789abcdef" for c in fp)):
            raise ValueError("tls_fingerprint must be SHA-256 hex (64 chars)")
        return fp or None


class NodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    host: str | None = Field(default=None, min_length=1, max_length=255)
    auth_token: str | None = Field(default=None, min_length=16, max_length=512)
    tls_fingerprint: str | None = Field(default=None, max_length=128)
    location_label: str | None = Field(default=None, max_length=120)
    ram_type: str | None = Field(default=None, max_length=32)
    storage_type: str | None = Field(default=None, max_length=64)
    public_ping_url: str | None = Field(default=None, max_length=255)
    ddos_provider: str | None = Field(default=None, max_length=100)
    ddos_profile: str | None = Field(default=None, max_length=160)
    ddos_game_aware: bool | None = Field(default=None)
    shop_enabled: bool | None = Field(default=None)
    shop_show_cpu: bool | None = Field(default=None)
    hardware_tier_label: str | None = Field(default=None, max_length=64)
    shop_surcharge_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    cpu_overcommit_factor: float | None = Field(default=None, ge=1.0, le=8.0)

    @field_validator("name", mode="before")
    @classmethod
    def _trim_optional_name(cls, value: object) -> str | None:
        if value is None:
            return None
        name = str(value).strip()
        if not name:
            raise ValueError("name darf nicht leer sein")
        return name

    @field_validator("location_label", "ram_type", "storage_type", "ddos_provider", "ddos_profile", "hardware_tier_label", mode="before")
    @classmethod
    def _trim_optional_metadata(cls, value: object) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @field_validator("public_ping_url", mode="before")
    @classmethod
    def _validate_public_ping_url(cls, value: object) -> str | None:
        if value is None:
            return None
        raw = str(value).strip()
        if not raw:
            return None
        if any(ch.isspace() for ch in raw):
            raise ValueError("public_ping_url darf keine Leerzeichen enthalten")
        parsed = urlparse(raw)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("public_ping_url muss eine gueltige https://-URL ohne Zugangsdaten sein")
        return raw.rstrip("/")

    @field_validator("tls_fingerprint", mode="before")
    @classmethod
    def _norm_fp(cls, v: object) -> str | None:
        if v is None:
            return None
        if v == "":
            return None
        fp = normalize_fingerprint(str(v))
        if fp and (len(fp) != 64 or any(c not in "0123456789abcdef" for c in fp)):
            raise ValueError("tls_fingerprint must be SHA-256 hex (64 chars)")
        return fp or None


class NodeOut(BaseModel):
    id: int
    name: str
    host: str
    is_local: bool
    status: str
    tls_fingerprint: str | None = None
    cpu_total: float | None = None
    cpu_overcommit_factor: float = 1.0
    cpu_model: str | None = None
    location_label: str | None = None
    ram_type: str | None = None
    storage_type: str | None = None
    cpu_steal_percent: float | None = None
    public_ping_url: str | None = None
    ddos_provider: str | None = None
    ddos_profile: str | None = None
    ddos_game_aware: bool = False
    shop_enabled: bool = True
    shop_show_cpu: bool = True
    hardware_tier_label: str | None = None
    shop_surcharge_cents: int = 0
    ram_total: int | None = None
    disk_total: int | None = None
    disk_used: int | None = None
    last_heartbeat: datetime | None = None
    server_count: int = 0
    # Sum of server.ram_limit_mb on this node (null limits excluded). Panel-side only.
    ram_allocated_mb: int | None = None
    # Remaining bookable RAM (total − headroom − allocated); null if host total unknown.
    ram_allocatable_mb: int | None = None
    # Sum of server.disk_limit_gb on this node.
    disk_allocated_gb: int = 0
    # Remaining bookable disk limit in GB.
    disk_allocatable_gb: int | None = None
    # Actual storage used by panel servers + databases on this node (in MB).
    disk_panel_used_mb: int = 0
    # Optional live metrics from agent (GET /api/nodes/{id})
    metrics: dict | None = None

    class Config:
        from_attributes = True


class NodePickerOut(BaseModel):
    """Minimal node identity exposed to users that may only create servers."""

    id: int
    name: str
    status: str
    # Optional capacity hints for create-server labels (no host/secrets).
    cpu_total: float | None = None
    ram_total: int | None = None
    ram_allocated_mb: int | None = None
    ram_allocatable_mb: int | None = None
    disk_total: int | None = None
    disk_allocated_gb: int = 0
    disk_allocatable_gb: int | None = None


class NodeCapacityItem(BaseModel):
    """One row for dashboard Top-N node capacity."""

    id: int
    name: str
    status: str
    cpu_model: str | None = None
    cpu_total: float | None = None
    cpu_percent: float | None = None
    ram_total_mb: int | None = None
    ram_used_mb: int | None = None
    ram_allocated_mb: int = 0
    ram_allocatable_mb: int | None = None
    disk_total_mb: int | None = None
    disk_used_mb: int | None = None
    disk_allocated_gb: int = 0
    disk_allocatable_gb: int | None = None
    disk_panel_used_mb: int = 0
    server_count: int = 0


class NodeCapacitySummary(BaseModel):
    online: int
    total: int
    items: list[NodeCapacityItem]

