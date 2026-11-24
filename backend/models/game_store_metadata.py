"""Gecachte Steam-Store-Metadaten (Spiel-Story, Genres, Entwickler) je App-ID und Sprache."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GameStoreMetadata(Base):
    __tablename__ = "game_store_metadata"
    __table_args__ = (
        UniqueConstraint("steam_app_id", "lang", name="uq_game_store_metadata_app_lang"),
        Index("ix_game_store_metadata_app_lang", "steam_app_id", "lang"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    steam_app_id: Mapped[str] = mapped_column(String(16), nullable=False)
    lang: Mapped[str] = mapped_column(String(8), nullable=False)
    short_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    genres_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default="[]"
    )
    developers_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]", server_default="[]"
    )
    fetch_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="ok", server_default="ok"
    )
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
