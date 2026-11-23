"""ASGI-Middleware zur Begrenzung der HTTP-Request-Body-Größe (H1).

Prüft sowohl den ``Content-Length``-Header vorab als auch die tatsächlich
gestreamten Bytes über ``receive``, damit übergroße Requests (inklusive
Chunked-Encoding ohne ``Content-Length``) vor dem FastAPI-/Pydantic-Buffering
mit HTTP 413 abgewiesen werden.
"""

from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from errors import ErrorCode
from schemas.vault import MAX_MUTATION_PAYLOAD_BYTES

MIB = 1024 * 1024
KIB = 1024

DEFAULT_BODY_LIMIT_BYTES = 16 * MIB

# Abgeleitet aus bestehenden Service-/Router-Konstanten zzgl. Multipart-/JSON-Overhead:
# - files.py:62 MAX_UPLOAD_SIZE = 100 MiB -> 112 MiB
# - files.py:791 Resumable Chunk = 64 MiB -> 72 MiB
# - chat_media.py / social/media.py (~60 MB) & wallpaper/artwork -> 64 MiB
# - ai_attachment_processor.py:40 MAX_UPLOAD_BYTES = 32 MiB -> 40 MiB
# - schemas/vault.py:22 MAX_MUTATION_PAYLOAD_BYTES = 8 MiB -> 9 MiB
FILE_UPLOAD_BODY_LIMIT_BYTES = 112 * MIB
FILE_CHUNK_BODY_LIMIT_BYTES = 72 * MIB
MEDIA_UPLOAD_BODY_LIMIT_BYTES = 64 * MIB
AI_ATTACHMENT_BODY_LIMIT_BYTES = 40 * MIB
VAULT_BLIND_SYNC_BODY_LIMIT_BYTES = MAX_MUTATION_PAYLOAD_BYTES + 1 * MIB  # 9 MiB
VAULT_BLIND_CHECK_BODY_LIMIT_BYTES = 64 * KIB
WEBHOOK_BODY_LIMIT_BYTES = 1 * MIB

_FILES_UPLOAD_RE = re.compile(r"^/api/files/[^/]+/upload$")
_FILES_CHUNK_RE = re.compile(r"^/api/files/[^/]+/upload/[^/]+/chunk$")
_WALLPAPER_RE = re.compile(r"^/api/servers/[^/]+/wallpaper")
_SHOP_ARTWORK_RE = re.compile(r"^/api/shop/plans/[^/]+/artwork$")


class _BodyTooLargeError(BaseException):
    """Interner Kontrollfluss-Abbruch (BaseException, um FastAPI-500-Handler zu umgehen)."""


def resolve_body_limit(path: str) -> int:
    """Bestimmt das maximale Request-Body-Limit in Bytes anhand des URL-Pfads."""
    if path == "/api/vault/blind-check":
        return VAULT_BLIND_CHECK_BODY_LIMIT_BYTES
    if path == "/api/vault/blind-sync":
        return VAULT_BLIND_SYNC_BODY_LIMIT_BYTES
    if (
        path == "/api/shop/stripe/webhook"
        or path == "/api/singra-webhook"
        or path.startswith("/api/webhooks/github/")
    ):
        return WEBHOOK_BODY_LIMIT_BYTES
    if _FILES_UPLOAD_RE.match(path):
        return FILE_UPLOAD_BODY_LIMIT_BYTES
    if _FILES_CHUNK_RE.match(path):
        return FILE_CHUNK_BODY_LIMIT_BYTES
    if (
        path.startswith("/api/social/media/upload")
        or _WALLPAPER_RE.match(path)
        or _SHOP_ARTWORK_RE.match(path)
    ):
        return MEDIA_UPLOAD_BODY_LIMIT_BYTES
    if path.startswith("/api/ai/attachments"):
        return AI_ATTACHMENT_BODY_LIMIT_BYTES
    return DEFAULT_BODY_LIMIT_BYTES


async def _send_json_error(send: Send, status_code: int, code: str, message: str) -> None:
    body = json.dumps({"detail": {"code": code, "message": message}}, ensure_ascii=False).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body, "more_body": False})


class BodyLimitMiddleware:
    """Reine ASGI-Middleware für routenabhängige HTTP-Body-Limits."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        max_bytes = resolve_body_limit(path)

        content_length_raw: bytes | None = None
        for key, value in scope.get("headers", []):
            if key.lower() == b"content-length":
                content_length_raw = value
                break

        if content_length_raw is not None:
            try:
                content_length = int(content_length_raw.decode("ascii").strip())
            except (UnicodeDecodeError, ValueError):
                await _send_json_error(
                    send,
                    400,
                    ErrorCode.VALIDATION_FAILED.value,
                    "Ungültiger Content-Length-Header.",
                )
                return
            if content_length < 0:
                await _send_json_error(
                    send,
                    400,
                    ErrorCode.VALIDATION_FAILED.value,
                    "Ungültiger Content-Length-Header.",
                )
                return
            if content_length > max_bytes:
                await _send_json_error(
                    send,
                    413,
                    ErrorCode.PAYLOAD_TOO_LARGE.value,
                    f"Request-Body überschreitet das zulässige Limit ({max_bytes} Bytes).",
                )
                return

        received_bytes = 0
        response_started = False

        async def wrapped_receive() -> Message:
            nonlocal received_bytes
            message = await receive()
            if message.get("type") == "http.request":
                chunk = message.get("body", b"")
                received_bytes += len(chunk)
                if received_bytes > max_bytes:
                    raise _BodyTooLargeError()
            return message

        async def wrapped_send(message: Message) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, wrapped_receive, wrapped_send)
        except _BodyTooLargeError:
            if not response_started:
                await _send_json_error(
                    send,
                    413,
                    ErrorCode.PAYLOAD_TOO_LARGE.value,
                    f"Request-Body überschreitet das zulässige Limit ({max_bytes} Bytes).",
                )
