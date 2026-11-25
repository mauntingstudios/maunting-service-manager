from datetime import datetime, timezone

from sqlalchemy import BigInteger, CheckConstraint, String, Integer, Boolean, DateTime, Float, Text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from database import Base


class Node(Base):
    __tablename__ = "nodes"
    __table_args__ = (
        CheckConstraint(
            "tls_fingerprint IS NULL OR (length(tls_fingerprint) = 64 "
            "AND tls_fingerprint = lower(tls_fingerprint) "
            "AND tls_fingerprint NOT LIKE '%:%')",
            name="ck_nodes_tls_fingerprint_normalized",
        ),
        CheckConstraint(
            "shop_surcharge_cents >= 0",
            name="ck_nodes_shop_surcharge_cents",
        ),
        CheckConstraint(
            "cpu_overcommit_factor >= 1.0 AND cpu_overcommit_factor <= 8.0",
            name="ck_nodes_cpu_overcommit_factor",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    # SHA-256 of agent TLS cert DER (hex, no colons). Required for remote HTTPS nodes.
    tls_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    is_local: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="unknown")
    cpu_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_overcommit_factor: Mapped[float] = mapped_column(
        Float, default=1.0, server_default="1.0", nullable=False
    )
    # Human-readable CPU model from agent inventory (e.g. "AMD EPYC 7763…").
    cpu_model: Mapped[str | None] = mapped_column(String(256), nullable=True)
    location_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ram_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    storage_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cpu_steal_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    public_ping_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ddos_provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ddos_profile: Mapped[str | None] = mapped_column(String(160), nullable=True)
    ddos_game_aware: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    shop_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true(), nullable=False
    )
    shop_show_cpu: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true(), nullable=False
    )
    hardware_tier_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    shop_surcharge_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    ram_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    disk_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cpu_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    ram_used: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    disk_used: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    agent_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    docker_connected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    container_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    servers: Mapped[list["Server"]] = relationship("Server", back_populates="node")
