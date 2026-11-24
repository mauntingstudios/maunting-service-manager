from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

NewsCategory = Literal[
    "announcement",
    "game_update",
    "infrastructure",
    "maintenance",
    "promo",
    "world_news",
]

NEWS_CATEGORIES: tuple[str, ...] = (
    "announcement",
    "game_update",
    "infrastructure",
    "maintenance",
    "promo",
    "world_news",
)

NEWS_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NEWS_GAME_TYPE_RE = re.compile(r"^[a-z0-9_-]{1,64}$")
MAX_NEWS_SOURCES = 10


def validate_https_source_url(value: str) -> str:
    raw = (value or "").strip()
    if not raw or len(raw) > 2048:
        raise ValueError("Quellen-URL fehlt oder ist zu lang (max. 2048 Zeichen)")
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise ValueError("Quellen-URL muss eine gültige https://-Adresse sein")
    return raw


class NewsSourceItem(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    url: str = Field(..., min_length=8, max_length=2048)

    @field_validator("title")
    @classmethod
    def _clean_title(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Quellentitel darf nicht leer sein")
        return clean

    @field_validator("url")
    @classmethod
    def _clean_url(cls, value: str) -> str:
        return validate_https_source_url(value)


class NewsPostCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=140)
    summary: str = Field(default="", max_length=400)
    content_markdown: str = Field(..., min_length=1, max_length=64000)
    category: NewsCategory = "announcement"
    related_game_type: str | None = Field(default=None, max_length=64)
    sources: list[NewsSourceItem] = Field(default_factory=list, max_length=MAX_NEWS_SOURCES)
    is_published: bool = False
    is_pinned: bool = False
    published_at: datetime | None = None
    author_display_name: str | None = Field(default=None, max_length=120)

    @field_validator("title", "content_markdown")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Feld darf nicht leer sein")
        return clean

    @field_validator("summary")
    @classmethod
    def _trim_summary(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip().lower()
        if not clean:
            return None
        if not NEWS_SLUG_RE.fullmatch(clean):
            raise ValueError("Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten")
        return clean

    @field_validator("related_game_type")
    @classmethod
    def _check_game_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip().lower()
        if not clean:
            return None
        if not NEWS_GAME_TYPE_RE.fullmatch(clean):
            raise ValueError("Ungültiges Spiel-Kürzel")
        return clean

    @field_validator("author_display_name")
    @classmethod
    def _trim_author(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class NewsPostUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=140)
    summary: str | None = Field(default=None, max_length=400)
    content_markdown: str | None = Field(default=None, min_length=1, max_length=64000)
    category: NewsCategory | None = None
    related_game_type: str | None = Field(default=None, max_length=64)
    sources: list[NewsSourceItem] | None = Field(default=None, max_length=MAX_NEWS_SOURCES)
    is_published: bool | None = None
    is_pinned: bool | None = None
    published_at: datetime | None = None
    author_display_name: str | None = Field(default=None, max_length=120)

    @field_validator("title", "content_markdown")
    @classmethod
    def _not_blank_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        if not clean:
            raise ValueError("Feld darf nicht leer sein")
        return clean

    @field_validator("summary")
    @classmethod
    def _trim_summary_optional(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("slug")
    @classmethod
    def _check_slug_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip().lower()
        if not clean:
            return None
        if not NEWS_SLUG_RE.fullmatch(clean):
            raise ValueError("Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten")
        return clean

    @field_validator("related_game_type")
    @classmethod
    def _check_game_type_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip().lower()
        if not clean:
            return None
        if not NEWS_GAME_TYPE_RE.fullmatch(clean):
            raise ValueError("Ungültiges Spiel-Kürzel")
        return clean

    @field_validator("author_display_name")
    @classmethod
    def _trim_author_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class NewsPostPublicResponse(BaseModel):
    slug: str
    title: str
    summary: str
    content_markdown: str
    category: str
    related_game_type: str | None = None
    sources: list[NewsSourceItem] = Field(default_factory=list)
    cover_url: str | None = None
    is_pinned: bool
    published_at: datetime | None = None
    author_display_name: str | None = None
    created_at: datetime
    updated_at: datetime


class NewsPostAdminResponse(NewsPostPublicResponse):
    id: int
    is_published: bool
    cover_version: str | None = None


class NewsListPublicResponse(BaseModel):
    items: list[NewsPostPublicResponse]
    total: int


class NewsSummaryResponse(BaseModel):
    published_count: int
    latest_published_at: datetime | None = None
