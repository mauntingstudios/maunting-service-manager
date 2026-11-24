from __future__ import annotations

from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


PopupAudience = Literal["all", "shop", "panel"]
PopupTone = Literal["info", "promo", "maintenance"]
POPUP_CONTENT_MAX_LENGTH = 600


def _validate_popup_button_url(value: object) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if any(ch.isspace() or ord(ch) < 32 for ch in raw):
        raise ValueError("button_url darf keine Leerzeichen oder Steuerzeichen enthalten")
    if raw.startswith("//"):
        raise ValueError("Protokoll-relative URLs sind fuer button_url nicht erlaubt")
    if raw.startswith("/"):
        return raw
    parsed = urlparse(raw)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise ValueError("button_url muss mit '/', 'https://' oder 'http://' beginnen")
    return raw


class PanelPopupResponse(BaseModel):
    id: int
    title: str
    content_markdown: str
    audience: PopupAudience = "all"
    tone: PopupTone = "info"
    is_active: bool
    start_at: datetime | None = None
    end_at: datetime | None = None
    button_text: str | None = None
    button_url: str | None = None
    created_at: datetime
    updated_at: datetime


class PanelPopupCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content_markdown: str = Field(..., min_length=1, max_length=POPUP_CONTENT_MAX_LENGTH)
    audience: PopupAudience = "all"
    tone: PopupTone = "info"
    is_active: bool = True
    start_at: datetime | None = None
    end_at: datetime | None = None
    button_text: str | None = Field(None, max_length=100)
    button_url: str | None = Field(None, max_length=2048)

    @field_validator("button_url", mode="before")
    @classmethod
    def _validate_url(cls, value: object) -> str | None:
        return _validate_popup_button_url(value)


class PanelPopupUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    content_markdown: str | None = Field(None, min_length=1, max_length=POPUP_CONTENT_MAX_LENGTH)
    audience: PopupAudience | None = None
    tone: PopupTone | None = None
    is_active: bool | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    button_text: str | None = Field(None, max_length=100)
    button_url: str | None = Field(None, max_length=2048)

    @field_validator("button_url", mode="before")
    @classmethod
    def _validate_url(cls, value: object) -> str | None:
        return _validate_popup_button_url(value)


class PopupDismissRequest(BaseModel):
    mode: str = Field("snooze", pattern="^(snooze|permanent)$")
