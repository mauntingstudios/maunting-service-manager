"""Preview-Zugriffssteuerung per Panel-Login, Team-Recht und Caddy forward_auth."""

from __future__ import annotations

import hashlib
import hmac
import html
import time
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import FrontendDeployment, FrontendSettings, Server, User
from services.auth_service import AuthService
from services.permission_service import has_server_permission

router = APIRouter(prefix="/api/frontend-previews", tags=["frontend-previews"])

PREVIEW_COOKIE_NAME = "msm_preview_session"
PREVIEW_TTL_SECONDS = 1800
PREVIEW_PERMISSION = "server.frontend.preview"


def _sign_preview_token(user_id: int, server_id: int, exp: int) -> str:
    payload = f"{user_id}:{server_id}:{exp}"
    sig = hmac.new(
        settings.secret_key.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}:{sig}"


def _verify_preview_token(token: str | None, expected_server_id: int) -> int | None:
    if not token:
        return None
    parts = token.split(":")
    if len(parts) != 4:
        return None
    try:
        uid = int(parts[0])
        sid = int(parts[1])
        exp = int(parts[2])
    except ValueError:
        return None
    if sid != expected_server_id or exp < int(time.time()):
        return None
    expected = _sign_preview_token(uid, sid, exp)
    if not hmac.compare_digest(expected, token):
        return None
    return uid


def _resolve_server_from_forwarded_host(db: Session, forwarded_host: str | None) -> Server | None:
    if not forwarded_host:
        return None
    host = forwarded_host.split(",")[0].strip().lower()
    if ":" in host:
        port_part = host.rsplit(":", 1)[-1]
        if port_part.isdigit():
            port_num = int(port_part)
            dep = (
                db.query(FrontendDeployment)
                .filter(
                    FrontendDeployment.kind == "preview",
                    FrontendDeployment.port == port_num,
                    FrontendDeployment.is_live.is_(True),
                )
                .first()
            )
            if dep is not None:
                return db.get(Server, dep.server_id)
    dep_url = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.kind == "preview",
            FrontendDeployment.is_live.is_(True),
            FrontendDeployment.url.ilike(f"%{host}%"),
        )
        .first()
    )
    if dep_url is not None:
        return db.get(Server, dep_url.server_id)
    return None


def _current_user_from_panel_cookie(request: Request, db: Session) -> User | None:
    for cookie_name in ("__Secure-access_token", "access_token"):
        raw = request.cookies.get(cookie_name)
        if not raw:
            continue
        payload = AuthService.decode_token(raw)
        if not payload:
            continue
        uid = payload.get("user_id")
        if not uid:
            continue
        user = db.get(User, int(uid))
        if user is not None and getattr(user, "is_active", True):
            return user
    return None


def _denied_html(title: str, message: str, status_code: int = 403) -> HTMLResponse:
    body = (
        "<!doctype html><html lang='de'><head><meta charset='utf-8'>"
        f"<title>{html.escape(title)}</title></head>"
        "<body style='font-family:system-ui,sans-serif;padding:2.5rem;max-width:34rem;margin:auto'>"
        f"<h1>{html.escape(title)}</h1><p>{html.escape(message)}</p>"
        "</body></html>"
    )
    return HTMLResponse(content=body, status_code=status_code)


@router.get("/authorize")
def authorize_preview(
    request: Request,
    server_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Wird von Caddy forward_auth vor jeder Preview-Auslieferung aufgerufen."""
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    forwarded_proto = request.headers.get("x-forwarded-proto") or "http"
    forwarded_uri = request.headers.get("x-forwarded-uri") or "/"

    server = db.get(Server, server_id) if server_id is not None else _resolve_server_from_forwarded_host(db, forwarded_host)
    if server is None:
        return _denied_html("Vorschau nicht gefunden", "Für diese Adresse ist keine aktive Vorschau hinterlegt.", 404)

    fs = db.get(FrontendSettings, server.id)
    if fs is not None and not fs.online:
        return _denied_html("Vorschau offline", "Dieses Frontend ist aktuell offline geschaltet.", 503)

    user: User | None = _current_user_from_panel_cookie(request, db)
    if user is None:
        pv_uid = _verify_preview_token(request.cookies.get(PREVIEW_COOKIE_NAME), server.id)
        if pv_uid is not None:
            user = db.get(User, pv_uid)

    if user is None:
        panel_base = (getattr(settings, "panel_url", "") or "").rstrip("/")
        if panel_base and forwarded_host:
            target = f"{forwarded_proto}://{forwarded_host.split(',')[0].strip()}{forwarded_uri}"
            sso_url = f"{panel_base}/api/frontend-previews/sso?server_id={server.id}&target={quote(target, safe='')}"
            return RedirectResponse(url=sso_url, status_code=302)
        return _denied_html(
            "Anmeldung erforderlich",
            "Bitte melde dich zuerst im MSM-Panel an, um diese Vorschau zu öffnen.",
            401,
        )

    if not has_server_permission(db, user, server.id, PREVIEW_PERMISSION):
        return _denied_html(
            "Keine Berechtigung",
            "Du bist angemeldet, hast aber keine Freigabe für diese Frontend-Vorschau. Bitte den Team-Maintainer um das Recht „Frontend-Vorschau aufrufen“.",
            403,
        )

    resp = HTMLResponse(content="OK", status_code=200)
    resp.headers["X-MSM-Preview-User"] = user.username
    return resp


@router.get("/sso")
def sso_preview_bounce(
    request: Request,
    server_id: int = Query(...),
    target: str = Query(...),
    db: Session = Depends(get_db),
):
    """Prueft auf der Panel-Origin die Session + Team-Freigabe und setzt das Preview-Cookie."""
    parsed = urlparse(target)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Ungültiges Ziel")

    target_host = parsed.netloc.lower()
    active_preview = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server_id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.is_live.is_(True),
        )
        .all()
    )
    allowed_hosts = set()
    for row in active_preview:
        if row.port:
            allowed_hosts.add(f"{parsed.hostname}:{row.port}".lower())
        if row.url:
            u = urlparse(row.url)
            if u.netloc:
                allowed_hosts.add(u.netloc.lower())
    if target_host not in allowed_hosts:
        raise HTTPException(status_code=403, detail="Ziel gehört zu keiner aktiven Vorschau")

    user = _current_user_from_panel_cookie(request, db)
    if user is None:
        next_url = quote(str(request.url), safe="")
        return RedirectResponse(url=f"/login?next={next_url}", status_code=302)

    if not has_server_permission(db, user, server_id, PREVIEW_PERMISSION):
        return _denied_html(
            "Keine Berechtigung",
            "Du hast keine Freigabe für diese Frontend-Vorschau.",
            403,
        )

    exp = int(time.time()) + PREVIEW_TTL_SECONDS
    token = _sign_preview_token(user.id, server_id, exp)
    resp = RedirectResponse(url=target, status_code=302)
    resp.set_cookie(
        key=PREVIEW_COOKIE_NAME,
        value=token,
        max_age=PREVIEW_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=parsed.scheme == "https",
    )
    return resp
