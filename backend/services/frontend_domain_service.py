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
_RESERVED_DOMAIN_SUFFIXES = (
    ".local",
    ".localhost",
    ".internal",
    ".localdomain",
    ".arpa",
    ".invalid",
    ".example",
)


def _panel_own_hostname() -> str | None:
    try:
        from urllib.parse import urlparse

        from config import settings

        raw = (PanelSettingsService.get("panel_url", "") or getattr(settings, "panel_url", "") or "").strip()
        if not raw:
            return None
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
        host = (parsed.hostname or "").strip().lower().rstrip(".")
        return host or None
    except Exception:
        return None


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
    if cleaned == "localhost" or any(cleaned.endswith(sfx) for sfx in _RESERVED_DOMAIN_SUFFIXES):
        raise HTTPException(status_code=400, detail="Lokale oder reservierte Domains sind nicht zulässig.")
    panel_host = _panel_own_hostname()
    if panel_host and cleaned == panel_host:
        raise HTTPException(status_code=400, detail="Die Panel-Domain kann nicht als Projekt-Domain verwendet werden.")
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
    ips: set[str] = set()
    try:
        infos = socket.getaddrinfo(domain, None, family=socket.AF_INET)
        ips.update(info[4][0] for info in infos)
    except OSError:
        pass
    if not ips:
        try:
            import dns.resolver

            answers = dns.resolver.resolve(domain, "A", lifetime=4.0)
            for rdata in answers:
                ips.add(rdata.to_text().strip())
        except Exception:
            pass
    return sorted(ips)


def _default_lookup_txt(name: str) -> list[str]:
    records: list[str] = []
    try:
        res = subprocess.run(
            ["dig", "+short", "TXT", name],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode == 0 and res.stdout.strip():
            for line in res.stdout.splitlines():
                cleaned = line.strip().strip('"').replace('" "', "")
                if cleaned:
                    records.append(cleaned)
    except Exception:
        pass
    if not records:
        try:
            import dns.resolver

            answers = dns.resolver.resolve(name, "TXT", lifetime=4.0)
            for rdata in answers:
                txt = "".join(
                    part.decode("utf-8", errors="replace") if isinstance(part, bytes) else str(part)
                    for part in getattr(rdata, "strings", ())
                ).strip()
                if txt:
                    records.append(txt)
        except Exception:
            pass
    return records


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
    txt_ok = any(rec.strip().strip('"') == expected_txt for rec in txt_records)

    a_records = a_fn(fs.domain)
    expected_ip = _expected_server_ip(server)
    a_ok = bool(expected_ip) and bool(a_records) and (expected_ip in a_records)

    if not txt_ok or not a_ok:
        fs.domain_verified = False
        db.flush()
        return {
            "verified": False,
            "txt_ok": txt_ok,
            "a_ok": a_ok,
            "actual_ips": a_records,
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
    if not apply_res:
        fs.domain_verified = False
        db.flush()
        return {
            "verified": False,
            "txt_ok": True,
            "a_ok": True,
            "actual_ips": a_records,
            "expected_ip": expected_ip,
            "caddy_applied": False,
            "caddy_error": apply_res.error,
        }
    db.flush()
    return {
        "verified": True,
        "txt_ok": True,
        "a_ok": True,
        "actual_ips": a_records,
        "expected_ip": expected_ip,
        "caddy_applied": True,
        "caddy_error": None,
    }
