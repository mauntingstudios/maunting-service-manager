"""Domain-Verwaltung, Operator-Preview-Subdomains und TXT/A-Besitznachweis."""

from __future__ import annotations

import logging
import re
import secrets
import socket
import subprocess
from typing import Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import FrontendSettings, Server
from services import caddy_service, frontend_deploy_service
from services.frontend_caddy_config import slugify_branch
from services.panel_settings_service import PanelSettingsService

logger = logging.getLogger(__name__)

_DOMAIN_RE = re.compile(
    r"^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)


def resolve_operator_preview_base_domain() -> str | None:
    """Optionale Betreiber-Preview-Domain mit Fallback auf cloudflare_default_zone."""
    custom = (PanelSettingsService.get("frontend_preview_domain", "") or "").strip().lower()
    if custom and _DOMAIN_RE.match(custom):
        return custom
    zone = (PanelSettingsService.get("cloudflare_default_zone", "") or "").strip().lower()
    if zone and _DOMAIN_RE.match(zone):
        return zone
    return None


def build_preview_subdomain(server: Server, branch_slug: str) -> str | None:
    base = resolve_operator_preview_base_domain()
    if not base:
        return None
    proj_slug = slugify_branch(server.name, max_length=24)
    return f"{branch_slug}--{proj_slug}.{base}"


def normalize_domain(raw: str | None) -> str | None:
    if raw is None:
        return None
    cleaned = raw.strip().lower().rstrip(".")
    if not cleaned:
        return None
    if not _DOMAIN_RE.match(cleaned):
        raise HTTPException(status_code=400, detail="Ungültiger Domainname (nur Hostname ohne http:// oder Port).")
    return cleaned


def set_custom_domain(db: Session, server: Server, raw_domain: str | None) -> FrontendSettings:
    fs = frontend_deploy_service.get_or_create_settings(db, server)
    domain = normalize_domain(raw_domain)
    if domain is None:
        fs.domain = None
        fs.domain_verified = False
        fs.domain_verify_token = None
        caddy_service.remove_vhost(server.id)
        db.flush()
        return fs

    collision = (
        db.query(FrontendSettings)
        .filter(
            FrontendSettings.domain == domain,
            FrontendSettings.server_id != server.id,
        )
        .first()
    )
    if collision is not None:
        raise HTTPException(status_code=409, detail="Diese Domain wird bereits von einem anderen Server verwendet.")

    if fs.domain != domain:
        fs.domain = domain
        fs.domain_verified = False
        fs.domain_verify_token = secrets.token_urlsafe(18)
    elif not fs.domain_verify_token:
        fs.domain_verify_token = secrets.token_urlsafe(18)
    db.flush()
    return fs


def _default_lookup_a(domain: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(domain, None, family=socket.AF_INET)
        return sorted({info[4][0] for info in infos})
    except OSError:
        return []


def _default_lookup_txt(name: str) -> list[str]:
    try:
        res = subprocess.run(
            ["dig", "+short", "TXT", name],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode == 0 and res.stdout.strip():
            return [line.strip().strip('"') for line in res.stdout.splitlines() if line.strip()]
    except Exception:
        pass
    return []


def _expected_server_ip(server: Server) -> str | None:
    if server.public_bind_ip and server.public_bind_ip not in ("0.0.0.0", "127.0.0.1"):
        return server.public_bind_ip
    if server.node is not None and getattr(server.node, "public_ip", None):
        return server.node.public_ip
    return None


def verify_custom_domain(
    db: Session,
    server: Server,
    *,
    lookup_txt: Callable[[str], list[str]] | None = None,
    lookup_a: Callable[[str], list[str]] | None = None,
) -> dict:
    fs = frontend_deploy_service.get_or_create_settings(db, server)
    if not fs.domain or not fs.domain_verify_token:
        raise HTTPException(status_code=400, detail="Keine Domain konfiguriert.")

    txt_fn = lookup_txt or _default_lookup_txt
    a_fn = lookup_a or _default_lookup_a

    expected_txt = f"msm-verify={fs.domain_verify_token}"
    txt_records = txt_fn(f"_msm-verify.{fs.domain}")
    txt_ok = any(expected_txt in rec for rec in txt_records)

    a_records = a_fn(fs.domain)
    expected_ip = _expected_server_ip(server)
    a_ok = bool(a_records) and (expected_ip is None or expected_ip in a_records)

    if not txt_ok or not a_ok:
        fs.domain_verified = False
        db.flush()
        return {
            "verified": False,
            "txt_ok": txt_ok,
            "a_ok": a_ok,
            "expected_txt_host": f"_msm-verify.{fs.domain}",
            "expected_txt_value": expected_txt,
            "expected_ip": expected_ip,
        }

    fs.domain_verified = True
    web_port = frontend_deploy_service._server_web_port(server)
    vhost_cfg = caddy_service.generate_proxy_vhost(
        server.id,
        fs.domain,
        web_port,
        server_name=server.name,
    )
    apply_res = caddy_service.apply_vhost(server.id, vhost_cfg, node=server.node)
    db.flush()
    return {
        "verified": True,
        "txt_ok": True,
        "a_ok": True,
        "caddy_applied": bool(apply_res),
        "caddy_error": None if apply_res else apply_res.error,
    }
