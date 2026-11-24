from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, false, text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class NewsPost(Base):
    __tablename__ = "news_posts"
    __table_args__ = (
        CheckConstraint(
            "category IN ('announcement', 'game_update', 'infrastructure', 'maintenance', 'promo', 'world_news')",
            name="ck_news_posts_category",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(String(400), default="", server_default="", nullable=False)
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(
        String(32), default="announcement", server_default="announcement", index=True, nullable=False
    )
    related_game_type: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    sources_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_image_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cover_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_published: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), index=True, nullable=False
    )
    is_pinned: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )
    author_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
