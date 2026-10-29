from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


from services.chat_media_validator import MAX_MEDIA_BYTES


class ChatMediaUploadRequest(BaseModel):
    chat_type: str = Field(..., pattern="^(direct|group)$")
    chat_id: int = Field(..., gt=0)
    ciphertext_blob: str = Field(..., min_length=1, max_length=MAX_MEDIA_BYTES + 4096)
    file_name: str = Field(..., min_length=1, max_length=256)
    media_type: str = Field(default="application/octet-stream", max_length=64)
    #: Nur bei verschwindenden Nachrichten. Normale Anhaenge bleiben bestehen.
    expires_at: datetime | None = None


class ChatMediaUploadResponse(BaseModel):
    id: str
    chat_type: str
    chat_id: int
    file_name: str
    media_type: str
    size_bytes: int
    sha256: str
    created_at: datetime


class ChatMediaSignedUrlResponse(BaseModel):
    media_id: str
    signed_url: str
    expires_at: datetime
