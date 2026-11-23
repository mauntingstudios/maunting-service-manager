"""Tests für die HTTP-Body-Limit-Middleware (H1)."""

from __future__ import annotations

import asyncio
from fastapi.testclient import TestClient

from main import app
from middleware.body_limit import (
    AI_ATTACHMENT_BODY_LIMIT_BYTES,
    BodyLimitMiddleware,
    DEFAULT_BODY_LIMIT_BYTES,
    FILE_CHUNK_BODY_LIMIT_BYTES,
    FILE_UPLOAD_BODY_LIMIT_BYTES,
    MEDIA_UPLOAD_BODY_LIMIT_BYTES,
    VAULT_BLIND_CHECK_BODY_LIMIT_BYTES,
    VAULT_BLIND_SYNC_BODY_LIMIT_BYTES,
    WEBHOOK_BODY_LIMIT_BYTES,
    resolve_body_limit,
)


def test_resolve_body_limit_routen_mapping() -> None:
    assert resolve_body_limit("/api/vault/blind-check") == VAULT_BLIND_CHECK_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/vault/blind-sync") == VAULT_BLIND_SYNC_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/shop/stripe/webhook") == WEBHOOK_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/webhooks/github/abc") == WEBHOOK_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/singra-webhook") == WEBHOOK_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/files/srv-1/upload") == FILE_UPLOAD_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/files/srv-1/upload/up-1/chunk") == FILE_CHUNK_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/social/media/upload") == MEDIA_UPLOAD_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/servers/srv-1/wallpaper") == MEDIA_UPLOAD_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/shop/plans/p-1/artwork") == MEDIA_UPLOAD_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/ai/attachments") == AI_ATTACHMENT_BODY_LIMIT_BYTES
    assert resolve_body_limit("/api/auth/login") == DEFAULT_BODY_LIMIT_BYTES


def test_content_length_ueber_limit_gibt_413_ohne_body_lesen() -> None:
    with TestClient(app) as client:
        resp = client.post(
            "/api/vault/blind-check",
            content=b"{}",
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(VAULT_BLIND_CHECK_BODY_LIMIT_BYTES + 1),
            },
        )
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "payload_too_large"


def test_ungueltiger_content_length_gibt_400() -> None:
    async def _run() -> list[dict]:
        async def dummy_app(scope, receive, send):
            raise AssertionError("App darf bei ungültigem Content-Length nicht aufgerufen werden")

        mw = BodyLimitMiddleware(dummy_app)
        sent: list[dict] = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(msg):
            sent.append(msg)

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/vault/blind-check",
            "headers": [(b"content-length", b"-5")],
        }
        await mw(scope, receive, send)
        return sent

    messages = asyncio.run(_run())
    assert messages[0]["status"] == 400


def test_chunked_stream_ohne_content_length_ueber_limit_gibt_413() -> None:
    async def _run() -> list[dict]:
        async def echo_app(scope, receive, send):
            while True:
                msg = await receive()
                if not msg.get("more_body", False):
                    break
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok", "more_body": False})

        mw = BodyLimitMiddleware(echo_app)
        sent: list[dict] = []
        chunks = [
            b"x" * (32 * 1024),
            b"y" * (32 * 1024),
            b"z" * 1024,  # 65 KiB > 64 KiB Limit für blind-check
        ]
        idx = 0

        async def receive():
            nonlocal idx
            if idx < len(chunks):
                chunk = chunks[idx]
                idx += 1
                return {"type": "http.request", "body": chunk, "more_body": idx < len(chunks)}
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(msg):
            sent.append(msg)

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/vault/blind-check",
            "headers": [],  # Kein Content-Length (Chunked-Simulation)
        }
        await mw(scope, receive, send)
        return sent

    messages = asyncio.run(_run())
    assert messages[0]["status"] == 413


def test_kleiner_unauth_endpoint_ueber_cap_und_unter_cap() -> None:
    with TestClient(app) as client:
        # 70 KiB > 64 KiB für /api/vault/blind-check -> 413 vor Pydantic
        oversized = b'{"bucket_id":"' + b"a" * 70_000 + b'"}'
        resp_over = client.post(
            "/api/vault/blind-check",
            content=oversized,
            headers={"Content-Type": "application/json"},
        )
        assert resp_over.status_code == 413

        # 10 MiB > 9 MiB für /api/vault/blind-sync -> 413 vor FastAPI/Pydantic
        resp_sync_over = client.post(
            "/api/vault/blind-sync",
            content=b"x" * (VAULT_BLIND_SYNC_BODY_LIMIT_BYTES + 1),
            headers={"Content-Type": "application/json"},
        )
        assert resp_sync_over.status_code == 413


def test_allowlist_route_laesst_grossen_body_durch_middleware() -> None:
    async def _run() -> list[dict]:
        async def ok_app(scope, receive, send):
            while True:
                msg = await receive()
                if not msg.get("more_body", False):
                    break
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok", "more_body": False})

        mw = BodyLimitMiddleware(ok_app)
        sent: list[dict] = []

        async def receive():
            return {"type": "http.request", "body": b"a" * (20 * 1024 * 1024), "more_body": False}

        async def send(msg):
            sent.append(msg)

        # 20 MiB > Default 16 MiB, aber < 112 MiB Allowlist für /api/files/.../upload
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/files/srv-1/upload",
            "headers": [(b"content-length", str(20 * 1024 * 1024).encode("ascii"))],
        }
        await mw(scope, receive, send)
        return sent

    messages = asyncio.run(_run())
    assert messages[0]["status"] == 200


def test_default_route_unter_limit_passiert_middleware() -> None:
    with TestClient(app) as client:
        # Kleiner Body auf Default-Route wird nicht von BodyLimitMiddleware blockiert (422 durch FastAPI)
        resp = client.post("/api/vault/blind-check", json={})
    assert resp.status_code == 422
