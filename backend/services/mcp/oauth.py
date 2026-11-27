"""Generischer OAuth-2.1-Flow (Discovery + Dynamic Client Registration + PKCE + Refresh) fuer Remote-MCP-Server.

Nutzt die bestehende DIS-Verschluesselung und die PKCE-/State-Helfer aus
`services.oauth_service` sowie die SSRF-Pruefung aus `services.mcp.sicherheit`.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode, urljoin, urlsplit

import httpx
from sqlalchemy.orm import Session

from models import AiMcpServer, User
from services import oauth_service
from services.mcp.client import McpFehler
from services.mcp.sicherheit import McpZielFehler, pruefe_endpunkt

MCP_OAUTH_STATE_COOKIE = "mcp_oauth_state"


@dataclass(frozen=True)
class McpOAuthMetadata:
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None = None
    scopes_supported: tuple[str, ...] = ()


def _origin(url: str) -> str:
    teile = urlsplit(url)
    return f"{teile.scheme}://{teile.netloc}"


def _extract_resource_metadata_url(www_auth: str | None) -> str | None:
    if not www_auth:
        return None
    m = re.search(r'resource_metadata="([^"]+)"', www_auth)
    return m.group(1).strip() if m else None


def _get_json(
    client: httpx.Client,
    url: str,
    *,
    erlaube_loopback: bool = False,
) -> dict[str, Any]:
    sicher_url = pruefe_endpunkt(url, erlaube_loopback=erlaube_loopback)
    resp = client.get(sicher_url, headers={"Accept": "application/json"})
    if resp.status_code >= 400:
        raise McpFehler(f"oauth_metadata_{resp.status_code}")
    daten = resp.json()
    if not isinstance(daten, dict):
        raise McpFehler("oauth_metadata_kein_objekt")
    return daten


def discover_oauth_metadata(
    endpoint_url: str,
    *,
    transport: httpx.BaseTransport | None = None,
    erlaube_loopback: bool = False,
    timeout: float = 15.0,
) -> McpOAuthMetadata:
    """Ermittelt OAuth-Endpunkte ueber RFC 9728 (Protected Resource) & RFC 8414 (AS Metadata)."""
    sicher_endpoint = pruefe_endpunkt(endpoint_url, erlaube_loopback=erlaube_loopback)
    basis = _origin(sicher_endpoint)

    with httpx.Client(
        timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)),
        follow_redirects=False,
        transport=transport,
    ) as client:
        # 1. MCP-Endpunkt anfragen, um ggf. WWW-Authenticate resource_metadata zu erhalten
        resource_meta_url: str | None = None
        try:
            probe = client.post(
                sicher_endpoint,
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
                headers={"Accept": "application/json, text/event-stream"},
            )
            resource_meta_url = _extract_resource_metadata_url(
                probe.headers.get("WWW-Authenticate")
            )
        except httpx.HTTPError:
            pass

        # 2. Protected Resource Metadata (RFC 9728)
        auth_server_origin = basis
        resource_scopes: tuple[str, ...] = ()
        kandidaten = (
            [urljoin(basis, resource_meta_url)]
            if resource_meta_url
            else [f"{basis}/.well-known/oauth-protected-resource"]
        )
        for url in kandidaten:
            try:
                prm = _get_json(client, url, erlaube_loopback=erlaube_loopback)
                servers = prm.get("authorization_servers")
                if isinstance(servers, list) and servers and isinstance(servers[0], str):
                    auth_server_origin = servers[0].rstrip("/")
                scopes = prm.get("scopes_supported")
                if isinstance(scopes, list):
                    resource_scopes = tuple(str(s) for s in scopes if isinstance(s, str))
                break
            except (McpFehler, McpZielFehler, httpx.HTTPError, ValueError):
                continue

        # 3. Authorization Server Metadata (RFC 8414 / OIDC Discovery)
        as_meta: dict[str, Any] | None = None
        for suffix in (
            "/.well-known/oauth-authorization-server",
            "/.well-known/openid-configuration",
        ):
            try:
                as_meta = _get_json(
                    client,
                    f"{auth_server_origin}{suffix}",
                    erlaube_loopback=erlaube_loopback,
                )
                break
            except (McpFehler, McpZielFehler, httpx.HTTPError, ValueError):
                continue

        if not as_meta:
            raise McpFehler("oauth_discovery_fehlgeschlagen")

        auth_ep = str(as_meta.get("authorization_endpoint") or "").strip()
        token_ep = str(as_meta.get("token_endpoint") or "").strip()
        reg_ep = str(as_meta.get("registration_endpoint") or "").strip() or None
        if not auth_ep or not token_ep:
            raise McpFehler("oauth_endpunkte_unvollstaendig")

        pruefe_endpunkt(auth_ep, erlaube_loopback=erlaube_loopback)
        pruefe_endpunkt(token_ep, erlaube_loopback=erlaube_loopback)
        if reg_ep:
            pruefe_endpunkt(reg_ep, erlaube_loopback=erlaube_loopback)

        as_scopes = as_meta.get("scopes_supported")
        scopes = resource_scopes or (
            tuple(str(s) for s in as_scopes if isinstance(s, str))
            if isinstance(as_scopes, list)
            else ()
        )
        return McpOAuthMetadata(
            authorization_endpoint=auth_ep,
            token_endpoint=token_ep,
            registration_endpoint=reg_ep,
            scopes_supported=scopes,
        )


def register_public_client(
    registration_endpoint: str,
    redirect_uri: str,
    *,
    transport: httpx.BaseTransport | None = None,
    erlaube_loopback: bool = False,
    timeout: float = 15.0,
) -> str:
    """RFC 7591 Dynamic Client Registration fuer einen oeffentlichen PKCE-Client."""
    sicher_url = pruefe_endpunkt(registration_endpoint, erlaube_loopback=erlaube_loopback)
    payload = {
        "client_name": "Maunting Service Manager",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    with httpx.Client(
        timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)),
        follow_redirects=False,
        transport=transport,
    ) as client:
        resp = client.post(
            sicher_url,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
    if resp.status_code >= 400:
        raise McpFehler(f"oauth_dcr_{resp.status_code}")
    daten = resp.json()
    client_id = str((daten or {}).get("client_id") or "").strip() if isinstance(daten, dict) else ""
    if not client_id:
        raise McpFehler("oauth_dcr_ohne_client_id")
    return client_id


def start_oauth_flow(
    server: AiMcpServer,
    user: User,
    redirect_uri: str,
    *,
    transport: httpx.BaseTransport | None = None,
    erlaube_loopback: bool = False,
) -> tuple[str, str]:
    """Startet den generischen MCP-OAuth-2.1-Flow. Gibt ``(authorize_url, state_cookie)`` zurueck."""
    if not server.endpoint_url or (server.transport or "http") not in {"http", "sse"}:
        raise McpFehler("oauth_nur_http_sse")

    meta = discover_oauth_metadata(
        server.endpoint_url,
        transport=transport,
        erlaube_loopback=erlaube_loopback,
    )
    client_id = (server.oauth_client_id or "").strip()
    if not client_id:
        if not meta.registration_endpoint:
            raise McpFehler("oauth_client_id_fehlt")
        client_id = register_public_client(
            meta.registration_endpoint,
            redirect_uri,
            transport=transport,
            erlaube_loopback=erlaube_loopback,
        )

    state, code_verifier = oauth_service._new_pkce_pair()
    challenge = oauth_service._code_challenge_s256(code_verifier)
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": server.endpoint_url,
    }
    if meta.scopes_supported:
        params["scope"] = " ".join(meta.scopes_supported[:12])

    authorize_url = f"{meta.authorization_endpoint}?{urlencode(params)}"
    cookie_value = oauth_service.pack_state_cookie(
        {
            "kind": "mcp",
            "server_id": int(server.id),
            "user_id": int(user.id),
            "state": state,
            "code_verifier": code_verifier,
            "client_id": client_id,
            "token_endpoint": meta.token_endpoint,
            "redirect_uri": redirect_uri,
            "iat": int(time.time()),
        }
    )
    return authorize_url, cookie_value


def _exchange_token(
    token_endpoint: str,
    data: dict[str, str],
    *,
    transport: httpx.BaseTransport | None = None,
    erlaube_loopback: bool = False,
    timeout: float = 15.0,
) -> dict[str, Any]:
    sicher_url = pruefe_endpunkt(token_endpoint, erlaube_loopback=erlaube_loopback)
    with httpx.Client(
        timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)),
        follow_redirects=False,
        transport=transport,
    ) as client:
        resp = client.post(
            sicher_url,
            data=data,
            headers={"Accept": "application/json"},
        )
    if resp.status_code >= 400:
        raise McpFehler(f"oauth_token_{resp.status_code}")
    daten = resp.json()
    if not isinstance(daten, dict) or not daten.get("access_token"):
        raise McpFehler("oauth_token_ungueltig")
    return daten


def _apply_token_response(
    server: AiMcpServer,
    daten: dict[str, Any],
    *,
    client_id: str | None = None,
    token_endpoint: str | None = None,
) -> None:
    access_token = str(daten["access_token"]).strip()
    token_type = str(daten.get("token_type") or "Bearer").strip() or "Bearer"
    header_val = f"{token_type} {access_token}" if " " not in access_token else access_token
    server.auth_token_encrypted = header_val
    server.auth_token_hint = access_token[-4:] if len(access_token) >= 4 else "****"
    server.auth_mode = "oauth"
    if daten.get("refresh_token"):
        server.oauth_refresh_token_encrypted = str(daten["refresh_token"]).strip()
    expires_in = daten.get("expires_in")
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        server.oauth_expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    if client_id:
        server.oauth_client_id = client_id
    if token_endpoint:
        server.oauth_token_endpoint = token_endpoint


def complete_oauth_callback(
    db: Session,
    *,
    code: str,
    state: str,
    packed_cookie: str | None,
    transport: httpx.BaseTransport | None = None,
    erlaube_loopback: bool = False,
) -> AiMcpServer:
    """Validiert Callback-State, tauscht Code gegen Tokens und speichert sie am `AiMcpServer`."""
    payload = oauth_service.unpack_state_cookie(packed_cookie)
    if not payload or payload.get("kind") != "mcp":
        raise McpFehler("oauth_state_ungueltig")
    if not state or payload.get("state") != state:
        raise McpFehler("oauth_state_mismatch")
    iat = int(payload.get("iat") or 0)
    if int(time.time()) - iat > oauth_service.STATE_TTL_SECONDS:
        raise McpFehler("oauth_state_abgelaufen")

    server = db.get(AiMcpServer, int(payload["server_id"]))
    if server is None:
        raise McpFehler("oauth_server_nicht_gefunden")

    daten = _exchange_token(
        str(payload["token_endpoint"]),
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": str(payload["redirect_uri"]),
            "client_id": str(payload["client_id"]),
            "code_verifier": str(payload["code_verifier"]),
        },
        transport=transport,
        erlaube_loopback=erlaube_loopback,
    )
    _apply_token_response(
        server,
        daten,
        client_id=str(payload["client_id"]),
        token_endpoint=str(payload["token_endpoint"]),
    )
    server.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(server)
    return server


def ensure_fresh_access_token(
    db: Session | None,
    server: AiMcpServer,
    *,
    transport: httpx.BaseTransport | None = None,
    erlaube_loopback: bool = False,
) -> str | None:
    """Erneuert abgelaufene OAuth-Access-Tokens automatisch per Refresh-Token."""
    if getattr(server, "auth_mode", "token") != "oauth":
        return getattr(server, "auth_token_encrypted", None) or None

    expires_at = getattr(server, "oauth_expires_at", None)
    refresh_token = getattr(server, "oauth_refresh_token_encrypted", None)
    token_ep = getattr(server, "oauth_token_endpoint", None)
    client_id = getattr(server, "oauth_client_id", None)

    jetzt = datetime.now(timezone.utc)
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    laeuft_ab = expires_at is not None and expires_at <= jetzt + timedelta(seconds=60)
    if laeuft_ab and refresh_token and token_ep and client_id:
        daten = _exchange_token(
            token_ep,
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
            },
            transport=transport,
            erlaube_loopback=erlaube_loopback,
        )
        _apply_token_response(server, daten)
        server.updated_at = datetime.now(timezone.utc)
        if db is not None:
            db.commit()
    return getattr(server, "auth_token_encrypted", None) or None
