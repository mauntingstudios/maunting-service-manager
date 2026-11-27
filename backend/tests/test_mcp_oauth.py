"""Tests fuer generisches MCP-OAuth-2.1 (Discovery, DCR, PKCE, Callback, Refresh)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from models import AiMcpServer, User
from services.mcp import sicherheit
from services.mcp.client import McpFehler
from services.mcp.oauth import (
    complete_oauth_callback,
    discover_oauth_metadata,
    ensure_fresh_access_token,
    start_oauth_flow,
)
from services.mcp.sicherheit import McpZielFehler


@pytest.fixture(autouse=True)
def _oeffentliche_dns(monkeypatch):
    monkeypatch.setattr(
        sicherheit.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )


def _mock_oauth_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == "https://mcp.example/mcp" and request.method == "POST":
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"'
                },
            )
        if url == "https://mcp.example/.well-known/oauth-protected-resource":
            return httpx.Response(
                200,
                json={
                    "resource": "https://mcp.example/mcp",
                    "authorization_servers": ["https://auth.example"],
                    "scopes_supported": ["read", "write"],
                },
            )
        if url == "https://auth.example/.well-known/oauth-authorization-server":
            return httpx.Response(
                200,
                json={
                    "issuer": "https://auth.example",
                    "authorization_endpoint": "https://auth.example/authorize",
                    "token_endpoint": "https://auth.example/token",
                    "registration_endpoint": "https://auth.example/register",
                },
            )
        if url == "https://auth.example/register" and request.method == "POST":
            body = json.loads(request.content)
            assert body["token_endpoint_auth_method"] == "none"
            return httpx.Response(201, json={"client_id": "dcr-client-123"})
        if url == "https://auth.example/token" and request.method == "POST":
            form = parse_qs(request.content.decode())
            if form.get("grant_type") == ["authorization_code"]:
                assert form.get("client_id") == ["dcr-client-123"]
                assert form.get("code") == ["auth-code-1"]
                return httpx.Response(
                    200,
                    json={
                        "access_token": "tok-access-1",
                        "refresh_token": "tok-refresh-1",
                        "token_type": "Bearer",
                        "expires_in": 3600,
                    },
                )
            if form.get("grant_type") == ["refresh_token"]:
                assert form.get("refresh_token") == ["tok-refresh-1"]
                return httpx.Response(
                    200,
                    json={
                        "access_token": "tok-access-2",
                        "refresh_token": "tok-refresh-2",
                        "token_type": "Bearer",
                        "expires_in": 3600,
                    },
                )
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def test_discovery_liest_resource_und_as_metadata() -> None:
    meta = discover_oauth_metadata(
        "https://mcp.example/mcp",
        transport=_mock_oauth_transport(),
    )
    assert meta.authorization_endpoint == "https://auth.example/authorize"
    assert meta.token_endpoint == "https://auth.example/token"
    assert meta.registration_endpoint == "https://auth.example/register"
    assert meta.scopes_supported == ("read", "write")


def test_discovery_blockiert_private_ziele(monkeypatch) -> None:
    monkeypatch.setattr(
        sicherheit.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(McpZielFehler):
        discover_oauth_metadata("https://internal.example/mcp")


def test_start_callback_und_refresh_durchlauf(db) -> None:
    user = User(username="mcp_oauth_user", email="mcp_oauth@example.com", password_hash="x")
    db.add(user)
    db.flush()

    server = AiMcpServer(
        user_id=user.id,
        scope="user",
        name="Supabase Cloud",
        transport="http",
        endpoint_url="https://mcp.example/mcp",
        auth_mode="oauth",
        enabled=True,
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    transport = _mock_oauth_transport()
    auth_url, cookie = start_oauth_flow(
        server,
        user,
        "https://panel.example/api/ai/mcp/oauth/callback",
        transport=transport,
    )
    qs = parse_qs(urlsplit(auth_url).query)
    assert qs["client_id"] == ["dcr-client-123"]
    assert qs["code_challenge_method"] == ["S256"]
    assert qs["scope"] == ["read write"]
    state = qs["state"][0]

    # Falscher State wird abgewiesen
    with pytest.raises(McpFehler, match="oauth_state_mismatch"):
        complete_oauth_callback(
            db,
            code="auth-code-1",
            state="falsch",
            packed_cookie=cookie,
            transport=transport,
        )

    updated = complete_oauth_callback(
        db,
        code="auth-code-1",
        state=state,
        packed_cookie=cookie,
        transport=transport,
    )
    assert updated.auth_mode == "oauth"
    assert updated.auth_token_encrypted == "Bearer tok-access-1"
    assert updated.oauth_refresh_token_encrypted == "tok-refresh-1"
    assert updated.oauth_client_id == "dcr-client-123"
    assert updated.oauth_token_endpoint == "https://auth.example/token"

    # Gueltiges Token wird nicht erneuert
    assert (
        ensure_fresh_access_token(db, updated, transport=transport)
        == "Bearer tok-access-1"
    )

    # Abgelaufenes Token wird automatisch per Refresh-Token erneuert
    updated.oauth_expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)
    db.commit()
    refreshed = ensure_fresh_access_token(db, updated, transport=transport)
    assert refreshed == "Bearer tok-access-2"
    assert updated.oauth_refresh_token_encrypted == "tok-refresh-2"
