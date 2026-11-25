"""Globales API-Rate-Limit (slowapi Limiter).

Das Default-Limit pro IP kommt dynamisch aus panel_settings
(rate_limit_global), Default 300/minute. Auth-spezifische Limits
liegen separat in auth_rate_limit. Enrollment- und Webhook-Limits
bleiben fest in den jeweiligen Routern.
"""
from __future__ import annotations

import ipaddress
import math
import os
import time
from typing import Any

from fastapi import HTTPException, Request
from limits import parse
from slowapi import Limiter
from slowapi.middleware import _should_exempt, async_check_limits
from starlette.datastructures import MutableHeaders
from starlette.routing import Match
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from config import settings
from services.rate_limit_settings import (
    current_auth_limit_from_settings,
    current_global_limit_from_settings,
    dynamic_global_limit_provider,
)

# FastAPI >= 0.160 speichert Router als _IncludedRouter in app.routes.
# slowapi 0.1.10 _find_route_handler sucht nur nach route.endpoint,
# wodurch alle Endpunkte in eingebundenen Routern None lieferten und
# key_style="endpoint" das Rate-Limit umging.
import slowapi.middleware

_orig_find_route_handler = slowapi.middleware._find_route_handler


def _compatible_find_route_handler(routes, scope):
    handler = _orig_find_route_handler(routes, scope)
    if handler is not None:
        return handler
    for route in routes:
        if hasattr(route, "_match"):
            try:
                m, _, matched_route, ctx = route._match(scope)
                if m == Match.FULL:
                    endpoint = getattr(ctx, "endpoint", None) or getattr(matched_route, "endpoint", None)
                    if endpoint is not None:
                        return endpoint
            except Exception:
                pass
    return None


slowapi.middleware._find_route_handler = _compatible_find_route_handler


_TRUSTED_PROXY_NETWORKS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)


def _is_trusted_proxy_addr(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return any(addr in net for net in _TRUSTED_PROXY_NETWORKS)


def _is_trusted_proxy(ip: str) -> bool:
    if not ip:
        return False
    if settings.debug and ip == "testclient":
        return True
    try:
        return _is_trusted_proxy_addr(ipaddress.ip_address(ip))
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    """Ermittelt die echte Client-IP hinter einem vertrauenswürdigen Reverse-Proxy.

    Hinter Caddy laufen alle Requests lokal über 127.0.0.1:8000 ein. Ohne
    Auswertung von X-Forwarded-For / X-Real-IP teilen sich alle Nutzer
    denselben Rate-Limit-Zähler. Gegen Header-Spoofing wird X-Forwarded-For
    nur akzeptiert, wenn die direkte Verbindung von einem vertrauenswürdigen
    Proxy kommt, und von rechts nach links bis zur ersten Nicht-Proxy-IP
    ausgewertet.
    """
    direct = request.client.host if request.client else ""
    if _is_trusted_proxy(direct):
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            valid_addrs: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
            for part in xff.split(","):
                candidate = part.strip()
                if not candidate:
                    continue
                try:
                    valid_addrs.append(ipaddress.ip_address(candidate))
                except ValueError:
                    continue
            if valid_addrs:
                for addr in reversed(valid_addrs):
                    if not _is_trusted_proxy_addr(addr):
                        return addr.compressed
                return valid_addrs[0].compressed

        x_real_ip = request.headers.get("x-real-ip", "").strip()
        if x_real_ip:
            try:
                return ipaddress.ip_address(x_real_ip).compressed
            except ValueError:
                pass

    if direct:
        try:
            return ipaddress.ip_address(direct).compressed
        except ValueError:
            return direct
    return "127.0.0.1"


def _retry_after_seconds(limit_item: Any, *keys: str) -> str:
    """Berechnet die restliche Fensterzeit in Sekunden (1–60 s)."""
    try:
        stats = limiter.limiter.get_window_stats(limit_item, *keys)
        reset_time = getattr(stats, "reset_time", None)
        if isinstance(reset_time, (int, float)):
            remaining = math.ceil(reset_time - time.time())
            return str(max(1, min(60, remaining)))
    except Exception:
        pass
    return "5"


class MsmRateLimitMiddleware:
    """Reine ASGI-Rate-Limit-Middleware ohne BaseHTTPMiddleware-Overhead.

    Vermeidet außerdem slowapis _ASGIMiddlewareResponder-Bug bei
    StreamingResponse (SSE), da Start-Header nicht erneut pro Chunk gesendet
    werden. OPTIONS-Preflights und Nicht-API-Pfade verbrauchen kein Budget.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = (scope.get("method") or "GET").upper()
        path = scope.get("path") or ""
        if method == "OPTIONS" or not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return

        _app = scope["app"]
        app_limiter: Limiter = _app.state.limiter
        if not app_limiter.enabled:
            await self.app(scope, receive, send)
            return

        handler = _compatible_find_route_handler(_app.routes, scope)
        request = Request(scope, receive=receive, send=send)
        if _should_exempt(app_limiter, handler):
            await self.app(scope, receive, send)
            return

        error_response, should_inject_headers = await async_check_limits(
            app_limiter, request, handler, _app
        )
        if error_response is not None:
            await error_response(scope, receive, send)
            return

        if not should_inject_headers:
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                view_rate_limit = getattr(request.state, "view_rate_limit", None)
                if view_rate_limit is not None:
                    headers = MutableHeaders(raw=message["headers"])
                    app_limiter._inject_asgi_headers(headers, view_rate_limit)
            await send(message)

        await self.app(scope, receive, send_with_headers)


# Im Testlauf zaehlt jeder Prozess fuer sich. Ein gemeinsamer Redis-Zaehler
# teilte sich sonst zwischen xdist-Workern, und `limiter.reset()` des einen
# loeschte die Zaehler, waehrend der andere gerade ein Limit prueft — die
# Grenze griff dann scheinbar nicht. In Produktion bleibt Redis der Speicher.
_storage_uri = None if os.getenv("MSM_TESTING") else (settings.redis_url or None)

# default_limits als Callable: slowapi wertet den String pro Request neu aus,
# sodass gespeicherte Admin-Werte ohne Restart greifen. Bei Lesefehler/ungültig
# liefert dynamic_global_limit_provider den Default 300 (fail-closed).
# key_style="endpoint" zählt pro Routenfunktion statt pro URL-Pfad. Ohne das
# bekommt jeder parametrisierte Pfad (/api/servers/{id}/status) einen eigenen
# Zähler, und das Limit lässt sich durch Variieren der ID beliebig umgehen.
limiter = Limiter(
    key_func=get_client_ip,
    default_limits=[dynamic_global_limit_provider],
    storage_uri=_storage_uri,
    in_memory_fallback_enabled=True,
    key_style="endpoint",
)


def auth_rate_limit(request: Request) -> None:
    """Strenges Rate-Limit für Login/2FA/Passwort-Reset/Setup pro IP.

    Liest rate_limit_auth aus den Panel-Settings (3–120, Default 10).
    Bei ungültigen/fehlenden Werten fail-closed auf Default — nie unlimitiert.
    """
    key = get_client_ip(request)
    try:
        per_minute = current_auth_limit_from_settings()
    except Exception:
        # DB/Cache-Fehler dürfen Auth nie ungeschützt lassen
        per_minute = 10
    limit_item = parse(f"{per_minute}/minute")
    if not limiter.limiter.hit(limit_item, key):
        raise HTTPException(
            status_code=429,
            detail="Zu viele Anfragen. Bitte warten Sie einen Moment.",
            headers={"Retry-After": _retry_after_seconds(limit_item, key)},
        )


def shop_public_rate_limit(request: Request) -> None:
    """Schuetzt oeffentliche Shop-, News- und Popup-Endpunkte vor Scraping.

    Skaliert mit rate_limit_global (mindestens 120/minute), damit Erhoehungen in
    den Panel-Settings auch Storefront- und News-Ladevorgaenge abdecken.
    """
    key = f"shop_public:{request.url.path}:{get_client_ip(request)}"
    per_minute = max(120, current_global_limit_from_settings())
    limit_item = parse(f"{per_minute}/minute")
    if not limiter.limiter.hit(limit_item, key):
        raise HTTPException(
            status_code=429,
            detail="Zu viele Anfragen. Bitte warte einen Moment.",
            headers={"Retry-After": _retry_after_seconds(limit_item, key)},
        )


def shop_coupon_rate_limit(request: Request) -> None:
    """Strenges Limit (60/min) speziell gegen Gutschein-Brute-Force."""
    key = f"shop_coupon:{get_client_ip(request)}"
    limit_item = parse("60/minute")
    if not limiter.limiter.hit(limit_item, key):
        raise HTTPException(
            status_code=429,
            detail="Zu viele Anfragen. Bitte warte einen Moment.",
            headers={"Retry-After": _retry_after_seconds(limit_item, key)},
        )

