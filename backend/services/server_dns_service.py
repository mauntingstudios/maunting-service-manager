"""Automatische Subdomain- & SRV-Verwaltung ueber Cloudflare fuer Shop-Server.

Nutzt den bestehenden ``cloudflare_service`` und faellt bei fehlender
Konfiguration oder API-Fehlern immer sauber (best-effort) zurueck, sodass
Server-Provisionierung, Migration und Loeschung niemals blockiert werden.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from models import Node, Server
from services import cloudflare_service, shop_lifecycle_settings_service

logger = logging.getLogger(__name__)

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _run_coro(coro: Any) -> Any:
    """Fuehrt eine async Cloudflare-Coroutine sicher aus synchronem Kontext aus."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result(timeout=20.0)


def _slugify_hostname(server_name: str, server_id: int, zone: str) -> str:
    raw = _NON_ALNUM_RE.sub("-", (server_name or "srv").lower()).strip("-")
    if not raw:
        raw = "srv"
    suffix = f"-{server_id}"
    max_prefix = max(1, 63 - len(suffix))
    label = f"{raw[:max_prefix].rstrip('-')}{suffix}"
    return f"{label}.{zone}".lower()


def _resolve_public_ip(db: Session, server: Server) -> tuple[str | None, str]:
    """Liefert (ip_str, record_type 'A'|'AAAA') oder (None, 'A')."""
    candidates: list[str] = []
    if getattr(server, "public_bind_ip", None):
        candidates.append(str(server.public_bind_ip).strip())
    node = getattr(server, "node", None)
    if node is None and getattr(server, "node_id", None) is not None:
        node = db.query(Node).filter(Node.id == server.node_id).first()
    if node is not None and getattr(node, "host", None):
        raw_host = str(node.host).strip()
        parsed = urlparse(raw_host if "://" in raw_host else f"https://{raw_host}")
        if parsed.hostname:
            candidates.append(parsed.hostname.strip("[]"))

    for cand in candidates:
        try:
            ip = ipaddress.ip_address(cand)
        except ValueError:
            continue
        if ip.is_unspecified or ip.is_loopback or ip.is_multicast:
            continue
        return ip.compressed, ("AAAA" if ip.version == 6 else "A")
    return None, "A"


def _srv_spec(game_type: str, server: Server) -> tuple[str, str, int] | None:
    port = getattr(server, "game_port", None)
    if not port:
        return None
    gt = (game_type or "").strip().lower()
    if gt.startswith("minecraft"):
        return ("_minecraft", "_tcp", int(port))
    if gt.startswith("teamspeak") or gt == "ts3":
        return ("_ts3", "_udp", int(port))
    return None


def _delete_existing_records(server: Server) -> None:
    zone = getattr(server, "cloudflare_zone_id", None)
    for attr in ("cloudflare_srv_record_id", "cloudflare_a_record_id"):
        rec_id = getattr(server, attr, None)
        if not rec_id:
            continue
        try:
            _run_coro(cloudflare_service.delete_dns_record(zone, str(rec_id)))
        except Exception as exc:
            logger.warning(
                "Cloudflare-Record konnte nicht entfernt werden (server_id=%s, field=%s, error=%s)",
                server.id,
                attr,
                type(exc).__name__,
            )
        setattr(server, attr, None)


def provision_server_subdomain(
    db: Session, server: Server, *, preserve_hostname: bool = True
) -> str | None:
    """Legt Best-Effort A/AAAA- und ggf. SRV-Eintrag fuer den Server an."""
    cfg = shop_lifecycle_settings_service.read(db=db)
    enabled = bool(cfg.get("auto_subdomain_enabled"))
    zone = str(cfg.get("auto_subdomain_zone") or "").strip().lower()
    if not enabled or not zone:
        return None
    if not cloudflare_service.is_configured():
        return None

    ip_addr, rtype = _resolve_public_ip(db, server)
    if not ip_addr:
        return None

    hostname = (
        str(server.public_hostname).strip().lower()
        if preserve_hostname and getattr(server, "public_hostname", None)
        else _slugify_hostname(server.name, server.id, zone)
    )
    if not hostname.endswith(f".{zone}") and hostname != zone:
        hostname = _slugify_hostname(server.name, server.id, zone)

    try:
        resolved_zone = str(_run_coro(cloudflare_service._resolve_zone_id(zone)))
        a_res = _run_coro(
            cloudflare_service.create_dns_record(
                resolved_zone,
                hostname,
                rtype,
                ip_addr,
                proxied=False,
                ttl=120,
            )
        )
        server.public_hostname = hostname
        server.cloudflare_zone_id = resolved_zone
        server.cloudflare_a_record_id = str((a_res or {}).get("id") or "") or None

        srv = _srv_spec(server.game_type, server)
        if srv is not None:
            service, proto, port = srv
            srv_name = f"{service}.{proto}.{hostname}"
            srv_res = _run_coro(
                cloudflare_service.create_dns_record(
                    resolved_zone,
                    srv_name,
                    "SRV",
                    content=f"0 5 {port} {hostname}",
                    proxied=False,
                    ttl=120,
                    data={
                        "service": service,
                        "proto": proto,
                        "name": hostname,
                        "priority": 0,
                        "weight": 5,
                        "port": port,
                        "target": hostname,
                    },
                )
            )
            server.cloudflare_srv_record_id = (
                str((srv_res or {}).get("id") or "") or None
            )
        db.commit()
        return server.public_hostname
    except Exception as exc:
        logger.warning(
            "Cloudflare-Subdomain konnte nicht angelegt werden (server_id=%s, error=%s)",
            server.id,
            type(exc).__name__,
        )
        return None


def sync_server_subdomain_on_migration(db: Session, server: Server) -> str | None:
    """Aktualisiert vorhandene Cloudflare-Subdomain nach erfolgreicher Node-Migration."""
    if not (
        getattr(server, "public_hostname", None)
        or getattr(server, "cloudflare_a_record_id", None)
        or getattr(server, "cloudflare_srv_record_id", None)
    ):
        return None
    _delete_existing_records(server)
    db.flush()
    return provision_server_subdomain(db, server, preserve_hostname=True)


def cleanup_server_subdomain(db: Session, server: Server) -> None:
    """Entfernt vorhandene Cloudflare-DNS-Eintraege vor dem Server-Delete (Best-Effort)."""
    if not (
        getattr(server, "cloudflare_a_record_id", None)
        or getattr(server, "cloudflare_srv_record_id", None)
    ):
        return
    if not cloudflare_service.is_configured():
        return
    _delete_existing_records(server)
