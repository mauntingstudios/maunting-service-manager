"""Pro-Server-Konfiguration fuer Web-Frontends (Branch, Webhook, Domain, Env)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class FrontendSettings(Base):
    __tablename__ = "frontend_settings"

    server_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True
    )
    production_branch: Mapped[str] = mapped_column(String(255), nullable=False, default="main")
    auto_deploy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    previews_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    domain_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    domain_verify_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    webhook_url_token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    webhook_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_hook_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_webhook_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    env_production_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    env_preview_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
