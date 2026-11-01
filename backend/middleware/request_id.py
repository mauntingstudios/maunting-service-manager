"""Request-ID Middleware und strukturierte Logs (Hardening WP1.1 & 1.2).

Reine ASGI-Middleware:
- Liest X-Request-ID oder generiert 16-stellige hex UUID.
- Setzt scope["state"]["request_id"] und eine ContextVar.
- Schreibt X-Request-ID in die Response-Header.
- Schreibt genau eine Zugriffszeile mit Dauer und Status.
- Filter und JsonFormatter zur Protokollierung ohne externe Abhängigkeiten.
"""

from contextvars import ContextVar
from datetime import datetime, timezone
import json
import logging
import re
import time
from typing import Any, Dict, Optional
import uuid

from starlette.types import ASGIApp, Receive, Scope, Send

_SAFE_REQUEST_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")

request_id_ctx: ContextVar[str] = ContextVar("request_id_ctx", default="")
request_context_ctx: ContextVar[Dict[str, Any]] = ContextVar("request_context_ctx", default={})

access_logger = logging.getLogger("msm.access")


def get_request_id() -> str:
    """Liefert die Request-ID der aktuellen asynchronen Anfrage oder einen leeren String."""
    return request_id_ctx.get()


class RequestIDFilter(logging.Filter):
    """Logging-Filter, der Kontextdaten des aktuellen Requests an LogRecords anhängt."""

    def filter(self, record: logging.LogRecord) -> bool:
        ctx = request_context_ctx.get()
        req_id = getattr(record, "request_id", None) or ctx.get("request_id", "") or request_id_ctx.get()
        record.request_id = req_id
        record.method = getattr(record, "method", None) or ctx.get("method", "")
        record.path = getattr(record, "path", None) or ctx.get("path", "")
        record.status = getattr(record, "status", None) or ctx.get("status", "")
        record.duration_ms = getattr(record, "duration_ms", None) or ctx.get("duration_ms", "")
        record.user_id = getattr(record, "user_id", None) or ctx.get("user_id", "")
        return True


def scrub_sensitive_data(text: str) -> str:
    """Entfernt sensitive Tokens, Passwörter und Datenbank-Credentials aus Text/Stacktraces."""
    if not text:
        return ""
    # Bearer tokens
    text = re.sub(r"(Bearer\s+)[A-Za-z0-9._~+/-]+=*", r"\1[REDACTED]", text, flags=re.I)
    # Passwörter / Secrets / Tokens im Query- oder Key-Value-Format
    text = re.sub(r"(password|secret|token|api[_-]?key)=([^\s&'\"]+)", r"\1=[REDACTED]", text, flags=re.I)
    # PostgreSQL / DB-URLs mit Credentials: postgresql://user:pass@host:port/db
    text = re.sub(r"(postgres(?:ql)?://)([^:@/]+):([^@/]+)@", r"\1\2:[REDACTED]@", text, flags=re.I)
    return text


class JsonFormatter(logging.Formatter):
    """Schreibt Logs als einzeilige JSON-Objekte (stdlib-only)."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": scrub_sensitive_data(record.getMessage()),
            "request_id": getattr(record, "request_id", "") or "",
            "method": getattr(record, "method", "") or "",
            "path": getattr(record, "path", "") or "",
            "status": getattr(record, "status", "") or "",
            "duration_ms": getattr(record, "duration_ms", "") or "",
            "user_id": getattr(record, "user_id", "") or "",
        }
        if record.exc_info:
            log_entry["exc"] = scrub_sensitive_data(self.formatException(record.exc_info))
        return json.dumps(log_entry, ensure_ascii=False)


class RequestIDMiddleware:
    """ASGI-Middleware für Request-ID und Zugriffslogging."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # 1. Request-ID ermitteln
        headers = dict(scope.get("headers", []))
        incoming_id = headers.get(b"x-request-id", b"").decode("latin1").strip()
        request_id = (
            incoming_id
            if (incoming_id and _SAFE_REQUEST_ID_RE.match(incoming_id))
            else uuid.uuid4().hex[:16]
        )

        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = request_id

        token_req = request_id_ctx.set(request_id)

        method = scope.get("method", "")
        # Pfad ohne Query-Parameter (Datenschutz: keine Tokens im Query-String)
        raw_path = scope.get("path", "")

        ctx_dict: Dict[str, Any] = {
            "request_id": request_id,
            "method": method,
            "path": raw_path,
            "status": "",
            "duration_ms": 0.0,
            "user_id": "",
        }
        token_ctx = request_context_ctx.set(ctx_dict)

        start_time = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Dict[str, Any]) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 200)
                msg_headers = list(message.get("headers", []))
                # Header X-Request-ID anhängen
                has_req_id = any(k.lower() == b"x-request-id" for k, _ in msg_headers)
                if not has_req_id:
                    msg_headers.append((b"x-request-id", request_id.encode("latin1")))
                    message["headers"] = msg_headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_s = time.perf_counter() - start_time
            duration = round(duration_s * 1000, 2)
            ctx_dict["status"] = status_code
            ctx_dict["duration_ms"] = duration

            try:
                from routers.metrics import record_request_metrics
                record_request_metrics(method, raw_path, status_code, duration_s)
            except Exception:
                pass

            access_logger.info(
                "%s %s -> %s in %sms [%s]",
                method,
                raw_path,
                status_code,
                duration,
                request_id,
                extra=ctx_dict,
            )

            request_id_ctx.reset(token_req)
            request_context_ctx.reset(token_ctx)
