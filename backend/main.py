from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from limits import parse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from config import TAURI_ORIGINS, get_cors_origins, is_localhost_origin_allowed, settings
from database import engine, Base
from routers import (
    auth_router,
    admin_router,
    servers_router,
    backups_router,
    mods_router,
    system_router,
    steam_router,
    curseforge_router,
    panel_settings_router,
    files_router,
    roles_router,
    permissions_router,
    blueprints_router,
    oauth_router,
    databases_router,
    postgres_studio_router,
    sqlite_studio_router,
    panel_database_studio_router,
    webhooks_outbound_router,
    singra_webhook_router,
    frontend_webhook_router,
    backup_config_router,
    panel_backups_router,
    nodes_router,
    incidents_router,
    change_timeline_router,
    guardian_router,
    ai_settings_router,
    tasks_router,
    ai_providers_router,
    ai_chat_router,
    ai_voice_router,
    ai_actions_router,
    desktop_router,
    ai_approvals_router,
    ai_autonomy_router,
    ai_memory_router,
    ai_tasks_router,
    ai_skills_router,
    ai_attachments_router,
    ai_projects_router,
    ai_mcp_router,
    credentials_router,
    teams_router,
    hoster_admin_router,
    hoster_api_router,
    hoster_handoff_router,
    user_integrations_router,
    popups_router,
    calendar_router,
    notes_router,
    docs_router,
    docs_internal_router,
    vault_router,
    sync_events_router,
    sync_alias_router,
    social_router,
    social_calls_router,
    livekit_admin_router,
    browser_suche_router,
    browser_wetter_router,
    notification_channels_router,
)
from middleware.rate_limit import limiter, auth_rate_limit
from services.steam_service import close_steam_service
from services.scheduler_service import start_scheduler, stop_scheduler, init_server_schedules
from services.server_lifecycle_service import reconcile_orphaned_lifecycle_statuses


@asynccontextmanager
async def lifespan(app: FastAPI):
    import sys

    from services.lifespan_steps import (
        init_http_clients_and_ai_runtime,
        init_local_agent_and_background_jobs,
        reconcile_ai_runs_on_startup,
        recover_scheduler_and_cleanup_expired,
        seed_system_roles_and_migrate_legacy_permissions,
        shutdown_panel_services,
        subscribe_remote_backplane,
        sync_node_and_run_legacy_schema_bridges,
        verify_dis_and_upgrade_schema,
    )

    is_testing = os.getenv("MSM_TESTING") == "true" or "pytest" in sys.modules
    init_http_clients_and_ai_runtime(app, is_testing)
    verify_dis_and_upgrade_schema(engine, is_testing)
    # Erst **nach** den Migrationen: `migrations/env.py` ruft `fileConfig` mit
    # `alembic.ini` auf, und dort steht `[logger_root] level = WARN`.
    _protokoll_einrichten()
    sync_node_and_run_legacy_schema_bridges(engine, is_testing)
    seed_system_roles_and_migrate_legacy_permissions(engine)
    subscribe_remote_backplane(app, is_testing)
    init_local_agent_and_background_jobs(is_testing)
    recover_scheduler_and_cleanup_expired()
    await reconcile_ai_runs_on_startup()

    frontend_stop_event = None
    frontend_poller_task = None
    if not is_testing:
        import asyncio
        from services.frontend_poller import poller_loop

        frontend_stop_event = asyncio.Event()
        frontend_poller_task = asyncio.create_task(poller_loop(frontend_stop_event))

    yield

    if frontend_stop_event is not None:
        frontend_stop_event.set()
    if frontend_poller_task is not None:
        frontend_poller_task.cancel()
    await shutdown_panel_services(app, is_testing)


def _protokoll_einrichten() -> None:
    """Bringt die Protokolle der Anwendung in die Standardausgabe.

    uvicorn richtet nur seine eigenen Protokolle ein (`uvicorn`,
    `uvicorn.access`); die Wurzel bekommt keinen Handler und bleibt auf
    `WARNING`. Alles, was die Dienste mit `logger.info` schreiben — der Weg
    einer Nachricht, Zustellungen, Aufräumläufe —, war damit **unsichtbar**:
    im Log stand nur `POST /api/social/e2ee/relay 200`, und niemand konnte
    sagen, ob der Umschlag ankam, ins Konto ging oder in einer abonnierten
    Mailbox landete (bis 22.10.2026).

    Stufe aus `MSM_LOG_LEVEL` (CRITICAL/ERROR/WARNING/INFO/DEBUG), sonst
    `WARNING`. Der Dev-Stack setzt `INFO` (`docker-compose.dev.yml`,
    `start-dev.bat`), damit ein Nachrichtenweg nachvollziehbar ist; der
    Betrieb bleibt damit nicht von sich aus gesprächig.
    """
    import logging
    from middleware.request_id import JsonFormatter, RequestIDFilter

    stufen = {
        "CRITICAL": logging.CRITICAL,
        "ERROR": logging.ERROR,
        "WARNING": logging.WARNING,
        "INFO": logging.INFO,
        "DEBUG": logging.DEBUG,
    }
    gewaehlt = (os.getenv("MSM_LOG_LEVEL") or "").strip().upper()
    stufe = stufen.get(gewaehlt, logging.WARNING)
    log_format = (os.getenv("MSM_LOG_FORMAT") or "text").strip().lower()

    wurzel = logging.getLogger()
    if not wurzel.handlers:
        handler = logging.StreamHandler()
        wurzel.addHandler(handler)

    req_filter = RequestIDFilter()
    for h in wurzel.handlers:
        h.addFilter(req_filter)
        if log_format == "json":
            h.setFormatter(JsonFormatter())
        else:
            h.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))

    # Nie strenger machen als gewünscht: uvicorn hat hier nichts gesetzt, und
    # eine Test-/Debug-Stufe soll sich nicht an einer fremden 30 festhalten.
    if wurzel.level > stufe:
        wurzel.setLevel(stufe)

    # Optionales Sentry-Reporting (WP1.5)
    sentry_dsn = os.getenv("MSM_SENTRY_DSN")
    if sentry_dsn:
        try:
            import sentry_sdk
            from middleware.request_id import scrub_sensitive_data

            def _sentry_before_send(event, hint):
                event.pop("user", None)
                if "breadcrumbs" in event and isinstance(event.get("breadcrumbs"), dict):
                    for bc in event["breadcrumbs"].get("values", []):
                        if isinstance(bc, dict) and "data" in bc:
                            bc["data"] = "[FILTERED]"
                if "exception" in event and isinstance(event.get("exception"), dict):
                    for exc_val in event["exception"].get("values", []):
                        if isinstance(exc_val, dict) and "value" in exc_val:
                            exc_val["value"] = scrub_sensitive_data(str(exc_val["value"]))
                if "message" in event and isinstance(event.get("message"), str):
                    event["message"] = scrub_sensitive_data(event["message"])
                if "request" in event:
                    req = event["request"]
                    if "headers" in req and isinstance(req["headers"], dict):
                        for h_key in list(req["headers"].keys()):
                            if h_key.lower() in (
                                "authorization",
                                "cookie",
                                "x-csrf-token",
                                "x-mailbox-token",
                                "x-provider-api-key",
                            ):
                                req["headers"][h_key] = "[FILTERED]"
                    if "query_string" in req:
                        req["query_string"] = "[FILTERED]"
                    if "data" in req:
                        req["data"] = "[FILTERED]"
                return event

            sentry_sdk.init(
                dsn=sentry_dsn,
                before_send=_sentry_before_send,
                send_default_pii=False,
            )
        except Exception as exc:
            logging.getLogger(__name__).warning("Sentry-Initialisierung übersprungen: %s", exc)


# Die automatischen Doku-Routen sind bewusst abgeschaltet und werden weiter
# unten unter /api/* neu registriert. Zwei Gruende:
#
# 1. FastAPI registriert /docs bereits im Konstruktor, der SPA-Mount auf "/"
#    kommt erst am Dateiende. Starlette matcht in Registrierungsreihenfolge —
#    im Single-Host-Betrieb lieferte ein Aufruf von https://panel/docs deshalb
#    die Swagger-UI statt der Doku-Seite des Panels.
# 2. /openapi.json haette keinerlei Auth-Dependency und gaebe damit anonym das
#    vollstaendige Schema aller Endpunkte inklusive der Hoster-Verwaltung heraus.
app = FastAPI(
    title=settings.app_name,
    description="Maunting Service Manager — Universeller Game Server Manager",
    version="3.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

class DynamicCORSMiddleware(CORSMiddleware):
    def is_allowed_origin(self, origin: str) -> bool:
        if super().is_allowed_origin(origin):
            return True
        return is_localhost_origin_allowed(origin)


# ── Rate Limiting (slowapi) & Request-ID (WP1.1 & 1.3) ──
from fastapi.exceptions import RequestValidationError
from errors import status_to_error_code
from middleware.request_id import RequestIDMiddleware, get_request_id

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
# RequestIDMiddleware als Schicht unter CORS
app.add_middleware(RequestIDMiddleware)

# ── CORS: Äußerste Schicht für alle Requests und Fehlerantworten ──
_cors_origins = get_cors_origins()

app.add_middleware(
    DynamicCORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=[
        "X-CSRF-Token",
        "Content-Disposition",
        "Content-Type",
        "X-Conversation-ID",
        "X-MSM-Dump-Size",
        "X-MSM-Dump-SHA256",
        "X-MSM-Export-Truncated",
        "X-Request-ID",
    ],
    max_age=86400,
)


def _cors_headers_for_request(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin")
    if not origin:
        return {}
    if origin in _cors_origins or is_localhost_origin_allowed(origin):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Expose-Headers": "X-CSRF-Token, Content-Disposition, Content-Type, X-Conversation-ID, X-MSM-Dump-Size, X-Request-ID",
        }
    return {}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    req_id = getattr(request.state, "request_id", "") or get_request_id()
    import logging
    logging.getLogger("msm.error").exception(
        "Unerwarteter interner Fehler [%s]: %s", req_id, exc.__class__.__name__, exc_info=exc
    )
    headers = _cors_headers_for_request(request)
    if req_id:
        headers["X-Request-ID"] = req_id
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "code": "internal",
                "message": "Interner Fehler",
                "request_id": req_id,
            }
        },
        headers=headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    req_id = getattr(request.state, "request_id", "") or get_request_id()
    sanitized_errors = []
    for err in exc.errors():
        ctx = {}
        for k, v in (err.get("ctx") or {}).items():
            if isinstance(v, (int, float, str, bool)):
                ctx[k] = v
        entry = {
            "loc": [str(x) for x in err.get("loc", [])],
            "msg": err.get("msg", ""),
            "type": err.get("type", ""),
        }
        if ctx:
            entry["ctx"] = ctx
        sanitized_errors.append(entry)
    headers = _cors_headers_for_request(request)
    if req_id:
        headers["X-Request-ID"] = req_id
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": "validation_failed",
                "message": "Ungültige Eingabedaten",
                "errors": sanitized_errors,
            }
        },
        headers=headers,
    )


@app.exception_handler(RateLimitExceeded)
def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    req_id = getattr(request.state, "request_id", "") or get_request_id()
    response = JSONResponse(
        status_code=429,
        content={
            "detail": {
                "code": "rate_limited",
                "message": "Zu viele Anfragen",
            }
        },
        headers={"X-Request-ID": req_id} if req_id else None,
    )
    limiter = getattr(request.app.state, "limiter", None)
    if limiter:
        try:
            view_rate_limit = getattr(request.state, "view_rate_limit", None)
            response = limiter._inject_headers(response, view_rate_limit)
        except Exception:
            pass
    if "Retry-After" not in response.headers and "retry-after" not in response.headers:
        response.headers["Retry-After"] = "60"
    if req_id and "X-Request-ID" not in response.headers:
        response.headers["X-Request-ID"] = req_id
    return response


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    req_id = getattr(request.state, "request_id", "") or get_request_id()
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        content = {"detail": detail}
    elif isinstance(detail, dict):
        code = status_to_error_code(exc.status_code).value
        content = {"detail": {"code": code, **detail}}
    else:
        # String-Details (oder non-dict) bleiben unverändert erhalten,
        # damit der bisherige API-Vertrag (z. B. detail="Nicht da") nicht bricht.
        content = {"detail": detail}
    headers = dict(exc.headers or {})
    headers.update(_cors_headers_for_request(request))
    if req_id and "X-Request-ID" not in headers:
        headers["X-Request-ID"] = req_id
    return JSONResponse(
        status_code=exc.status_code,
        content=content,
        headers=headers,
    )


@app.exception_handler(HTTPException)
async def fastapi_http_exception_handler(request: Request, exc: HTTPException):
    return await starlette_http_exception_handler(request, exc)



# ── CSP + Security Headers Middleware ──
def _csp_connect_src() -> str:
    """connect-src: 'self' plus panel/CORS origins (split FE + API / Vercel)."""
    parts = ["'self'"]
    for origin in _cors_origins:
        # Desktop-Origins (Tauri) sind CORS-erlaubt, aber der Browser des
        # Panels verbindet sich nie dorthin — in der CSP waeren sie nur Rauschen.
        if origin in TAURI_ORIGINS:
            continue
        if origin and origin not in parts:
            parts.append(origin)
        # ws/wss counterpart for console streams when SPA is same CSP host
        if origin.startswith("https://"):
            parts.append("wss://" + origin[len("https://") :])
        elif origin.startswith("http://"):
            parts.append("ws://" + origin[len("http://") :])
    # Ein externer LiveKit liegt auf einer fremden Herkunft. Ohne diesen Eintrag
    # blockiert der Browser die Verbindung, und der Anruf endet wortlos, bevor er
    # beginnt. Im integrierten Modus faellt das weg: der Sidecar liegt hinter
    # Caddy auf derselben Herkunft und ist von 'self' gedeckt.
    try:
        from services.livekit_service import csp_origin as _livekit_csp_origin

        livekit = _livekit_csp_origin()
    except Exception:
        livekit = ""
    if livekit:
        parts.extend(teil for teil in livekit.split() if teil not in parts)
    return " ".join(parts)


# Die Swagger- und ReDoc-Oberflaechen laden ihre Assets von jsdelivr. Die
# Freigabe gilt ausschliesslich fuer diese beiden Pfade — jede andere Antwort
# behaelt die enge Standard-CSP. Ohne diese Ausnahme waere die Seite leer, und
# eine leere Seite haette man leicht fuer einen Serverfehler gehalten.
_API_DOCS_PATHS = frozenset({"/api/swagger", "/api/redoc"})
_DOCS_CDN = "https://cdn.jsdelivr.net"


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    docs_page = request.url.path in _API_DOCS_PATHS
    csp = (
        "default-src 'self'; "
        f"script-src 'self' 'wasm-unsafe-eval'{' ' + _DOCS_CDN if docs_page else ''} https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://singrabot.mauntingstudios.de https://client.crisp.chat https://embed.tawk.to; "
        f"style-src 'self' 'unsafe-inline'{' ' + _DOCS_CDN if docs_page else ''} https://hcaptcha.com https://*.hcaptcha.com https://singrabot.mauntingstudios.de; "
        f"img-src 'self' data: blob:{' ' + _DOCS_CDN if docs_page else ''} https://singrabot.mauntingstudios.de; "
        f"connect-src {_csp_connect_src()} https://singrabot.mauntingstudios.de https://client.crisp.chat wss://client.relay.crisp.chat https://va.tawk.to https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/; "
        "font-src 'self' data: https://singrabot.mauntingstudios.de; "
        "frame-src 'self' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://singrabot.mauntingstudios.de; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )
    response.headers["Content-Security-Policy"] = csp
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    # `setdefault` und nicht Zuweisung — wie zwei Zeilen tiefer bei
    # `Cache-Control`, und aus demselben Grund. Es gibt Endpunkte, deren Pfad
    # **selbst** das Geheimnis ist: der Hoster-Handoff und die KI-Freigabe
    # tragen ein Einmal-Token in der URL. Beide setzen deshalb ausdruecklich
    # `no-referrer`, damit das Token nicht im `Referer` jeder nachgeladenen
    # Ressource landet — und beide wurden hier bis eben wieder auf die
    # allgemeine, laxere Regel zurueckgesetzt. Der strengere Wert des Handlers
    # gewinnt jetzt; wo keiner gesetzt ist, gilt weiterhin die Vorgabe.
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")

    # ── Cache-Control ──
    # /api/* und jeder Fehler → `no-store`, sofern die Route nichts Eigenes
    # setzt (das Bild der Regionsanalyse etwa `private, max-age=900`). Bis
    # 09/2026 fiel beides unter die Tagesregel ganz unten: `/api/auth/me`, jede
    # 401 — und `public` erlaubt ausgerechnet geteilten Caches, die Antwort auf
    # eine angemeldete Anfrage anderen auszuliefern (RFC 9111 §3.5). `no-store`
    # statt `private, no-cache`: Die API liefert kein ETag, eine Nachfrage
    # spart also nichts, und so bleibt auch die Platte des Browsers leer.
    # /assets/* → 1 Jahr immutable (Vite hasht den Inhalt in den Namen). Ein
    # 404 dort nicht: Nach einem Zurückrollen gibt es den Chunk wieder.
    # HTML → kein Cache, erkannt auch am Inhaltstyp, damit ein SPA-Fallback
    # unter `/ai` genauso nachfragt wie `/`.
    # Alles andere (Icons, Fonts, etc.) → 1 Tag
    path = request.url.path
    html = (
        path == "/"
        or path.endswith(".html")
        or response.headers.get("content-type", "").startswith("text/html")
    )
    if path.startswith("/api/") or response.status_code >= 400:
        response.headers.setdefault("Cache-Control", "no-store")
    elif path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif html:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    else:
        response.headers.setdefault("Cache-Control", "public, max-age=86400")

    return response


# Router
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(servers_router)
app.include_router(backups_router)
app.include_router(mods_router)
app.include_router(system_router)
app.include_router(steam_router)
app.include_router(curseforge_router)
app.include_router(panel_settings_router)
app.include_router(nodes_router)
app.include_router(files_router)
app.include_router(roles_router)
app.include_router(permissions_router)
app.include_router(blueprints_router)
app.include_router(databases_router)
app.include_router(postgres_studio_router)
app.include_router(sqlite_studio_router)
app.include_router(panel_database_studio_router)
# Ausgehende Webhooks (MSM → Drittsystem wie Discord-Bot): per-Server
# Subscriptions mit Secret-Auth ueber X-Webhook-Secret-Header.
app.include_router(webhooks_outbound_router)
app.include_router(singra_webhook_router)
app.include_router(frontend_webhook_router)
# OAuth-Endpoints liegen absichtlich NICHT unter auth_rate_limit, weil das
# Rate-Limit pro IP und pro Minute gilt (10/min). Bei Shared-IPs (Unternehmen,
# Schulen, mobile Carrier) wuerde der Login-Flow sonst regelmaessig 429
# liefern. Stattdessen schuetzen die State-Cookie-Validierung + PKCE + 5-Min
# LoginChallenge gegen Brute-Force auf dem OAuth-Pfad.
app.include_router(oauth_router)
# Backup-Config (S3-Settings + Backup-Passwort). Admin-only (panel.settings.write),
# CSRF auf allen Write-Endpunkten. Credentials verschluesselt via DIS.
app.include_router(backup_config_router)
app.include_router(panel_backups_router)
app.include_router(incidents_router)
app.include_router(change_timeline_router)
app.include_router(guardian_router)
app.include_router(ai_settings_router)
app.include_router(ai_providers_router)
app.include_router(ai_chat_router)
app.include_router(ai_voice_router)
app.include_router(ai_actions_router)
app.include_router(desktop_router)
# Ohne Anmeldung, aber unter dem strengen Auth-Limit: das Token im Pfad ist
# die ganze Berechtigung, und ein Endpunkt, der Token gegen einen Bestand
# prueft, gehoert hinter dieselbe Drossel wie der Login.
app.include_router(ai_approvals_router, dependencies=[Depends(auth_rate_limit)])
app.include_router(ai_memory_router)
app.include_router(ai_tasks_router)
app.include_router(ai_autonomy_router)
app.include_router(ai_skills_router)
app.include_router(ai_attachments_router)
app.include_router(ai_projects_router)
app.include_router(ai_mcp_router)
app.include_router(tasks_router)
# Hoster-Anbindung (Phase 6). Panel-Verwaltung mit Cookie-Auth + CSRF,
# externe Shop-API ausschliesslich per API-Key, Handoff-Einloesung per
# Einmal-Token im Browser des Kunden.
app.include_router(hoster_admin_router)
app.include_router(hoster_api_router)
app.include_router(hoster_handoff_router)
# Zugangsdaten auf Benutzer- und Serverebene (Phase 7).
app.include_router(credentials_router)
app.include_router(teams_router)
app.include_router(user_integrations_router)
app.include_router(popups_router)
app.include_router(calendar_router)
app.include_router(notes_router)
# Dokumente: REST fuer Nutzer, /internal/docs nur fuer den Hocuspocus-Sidecar.
app.include_router(docs_router)
app.include_router(docs_internal_router)
# Zero-Knowledge-Tresor & Authenticator (strikt isoliert von KI-Endpunkten).
app.include_router(vault_router)
app.include_router(sync_events_router)
app.include_router(sync_alias_router)
# Dauerhafte Ausweise fuer den Hintergrundkanal eines Geraets.
app.include_router(notification_channels_router)
app.include_router(social_router)
app.include_router(social_calls_router)
app.include_router(livekit_admin_router)
app.include_router(browser_suche_router)
app.include_router(browser_wetter_router)
from routers.metrics import router as metrics_router
app.include_router(metrics_router)



# ── OpenAPI: unter /api/*, angemeldet und rechtegebunden ──
# Das Schema beschreibt jeden Endpunkt inklusive der Hoster-Verwaltung und der
# erwarteten Header. Das ist kein Geheimnis, aber auch nichts, was ohne Login
# herausgehen muss. `panel.settings.read` ist dasselbe Recht, das auch die
# Provider- und Integrationsansichten oeffnet.
from dependencies import require_global  # noqa: E402  (nach der App-Definition noetig)


@app.get("/api/openapi.json", include_in_schema=False)
def openapi_schema(_: object = Depends(require_global("panel.settings.read"))):
    return JSONResponse(app.openapi())


@app.get("/api/swagger", include_in_schema=False)
def swagger_ui(_: object = Depends(require_global("panel.settings.read"))):
    return get_swagger_ui_html(
        openapi_url="/api/openapi.json",
        title=f"{settings.app_name} — API",
    )


@app.get("/api/redoc", include_in_schema=False)
def redoc_ui(_: object = Depends(require_global("panel.settings.read"))):
    return get_redoc_html(
        openapi_url="/api/openapi.json",
        title=f"{settings.app_name} — API",
    )


@app.get("/api/version")
def app_version():
    return {"name": settings.app_name, "version": "6.1.0"}


from services.health_service import pruefe_gesundheit


@app.get("/api/health")
async def health(deep: bool = False):
    status_code, body = await pruefe_gesundheit(deep=deep)
    return JSONResponse(status_code=status_code, content=body)

# Static Frontend (Single-Host Produktion). Phase 4: abschaltbar fuer API-only.
# Wichtig: Mount NACH allen API-Routern und expliziten Routes hinzufügen,
# damit /api/* und Health nicht vom SPA-Static-Fallback geschluckt werden.
# /assets/* ohne html-Fallback: fehlende JS-Chunks liefern 404 (text/plain),
# nicht index.html — verhindert „MIME type text/html“ bei veralteten Lazy-Chunks.
_FRONTEND_DIST = "/opt/msm/frontend/dist"
#: Hier fällt nichts auf die Startseite zurück: ein fehlender Chunk muss ein
#: 404 bleiben (siehe unten), eine unbekannte API-Route auch.
_OHNE_RUECKFALL = frozenset({"api", "ws", "assets"})


class _OberflaecheMitRueckfall(StaticFiles):
    """Das gebaute Frontend, mit der index.html für jede Unterseite.

    Die Oberfläche routet im Browser (`BrowserRouter`): `/ai`, `/servers/12`
    oder der Freigabelink aus einer Mail sind keine Dateien. Hinter Caddy
    fängt `try_files {path} /index.html` das ab. Liefert das Panel die
    Oberfläche selbst aus (Kubernetes), endete ein Neuladen dort bis 09/2026
    in 404.

    Zurück fällt nur, was ein Browser als Seite anfragt (`Accept: text/html`).
    Ein fehlendes Bild, Skript oder Manifest bleibt 404 — HTML an seiner
    Stelle hielte der Browser für den Inhalt. Am Punkt im Pfad lässt sich das
    nicht ablesen: auch eine Unterseite darf einen tragen.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            erstes = path.replace(os.sep, "/").split("/", 1)[0]
            seite = "text/html" in Headers(scope=scope).get("accept", "")
            if exc.status_code != 404 or erstes in _OHNE_RUECKFALL or not seite:
                raise
        return await super().get_response("index.html", scope)


def _frontend_einhaengen(ziel: FastAPI, dist: str) -> None:
    """Hängt das gebaute Frontend ein. Eigene Funktion, damit die Tests genau
    diese Einhängung gegen ein eigenes `dist` prüfen können."""
    ziel.mount(
        "/assets",
        # Der Mount entfernt `/assets` vor der Dateisuche. Vite legt seine
        # Chunks aber in `dist/assets` ab; `dist` würde daher nach
        # `dist/<chunk>.js` statt nach `dist/assets/<chunk>.js` suchen.
        # Fehlende Chunks dürfen nie als SPA-HTML zurückkommen, weil das den
        # laufenden Client (unter anderem die Realtime-WebRTC-Sitzung) stoppt.
        StaticFiles(directory=f"{dist}/assets", html=False),
        name="frontend-assets",
    )
    ziel.mount("/", _OberflaecheMitRueckfall(directory=dist, html=True), name="frontend")


if settings.serve_frontend and os.path.exists(_FRONTEND_DIST):
    _frontend_einhaengen(app, _FRONTEND_DIST)
