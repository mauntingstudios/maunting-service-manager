"""Caddy-Reverse-Proxy- und Static-Site-Service für Web-Apps und getrennte Fullstack-Server.

Verwaltet dynamische vhost-Konfigurationen unter /etc/caddy/conf.d/*.conf,
die von der Haupt-Caddyfile automatisch importiert werden.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING, Any

from config import settings

if TYPE_CHECKING:
    from models import Node, Server

logger = logging.getLogger(__name__)

# Standard-Verzeichnis für modulare Caddy-Sites
DEFAULT_CADDY_CONF_DIR = Path("/etc/caddy/conf.d")


def _resolve_conf_dir() -> Path:
    """Ermittelt das Zielverzeichnis für Caddy-VHost-Dateien."""
    custom = getattr(settings, "caddy_conf_dir", None)
    if custom:
        p = Path(custom)
        p.mkdir(parents=True, exist_ok=True)
        return p

    if DEFAULT_CADDY_CONF_DIR.exists() or os.name == "posix":
        try:
            DEFAULT_CADDY_CONF_DIR.mkdir(parents=True, exist_ok=True)
            return DEFAULT_CADDY_CONF_DIR
        except (PermissionError, OSError):
            pass

    # Lokaler Fallback (z. B. auf Windows oder in unprivilegierten Testumgebungen)
    fallback = Path(settings.servers_dir).resolve().parent / "caddy_conf.d"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def get_vhost_path(server_id: int) -> Path:
    """Pfad zur Caddyfile-Konfiguration eines Servers."""
    conf_dir = _resolve_conf_dir()
    return conf_dir / f"app_{server_id}.conf"


def normalize_api_path(path: str | None) -> str:
    """Normalisiert den Pfad für den Reverse-Proxy (z. B. '/api/*' oder '/graphql')."""
    clean = (path or "/api/*").strip()
    if not clean.startswith("/"):
        clean = "/" + clean
    if not clean.endswith("*") and not clean.endswith("/"):
        clean = clean + "/*"
    return clean


def normalize_backend_target(url: str | None, default_port: int | None = None) -> str | None:
    """Bereitet das Ziel für reverse_proxy vor (entfernt überflüssige Schemata falls Port/Host)."""
    if not url and default_port:
        return f"127.0.0.1:{default_port}"
    if not url:
        return None
    cleaned = url.strip()
    # http://127.0.0.1:8000 -> 127.0.0.1:8000 für caddy reverse_proxy
    if cleaned.startswith("http://"):
        return cleaned[len("http://") :]
    if cleaned.startswith("https://"):
        return cleaned
    return cleaned


def generate_caddy_config(
    server_id: int,
    root_dir: str,
    *,
    server_name: str | None = None,
    domain: str | None = None,
    port: int | None = None,
    backend_proxy_url: str | None = None,
    api_path: str = "/api/*",
) -> str:
    """Erzeugt einen sauberen Caddy-Site-Block für Frontends und Reverse-Proxies."""
    clean_domain = (domain or "").strip()
    target_header = clean_domain if clean_domain else f":{port or 8080}"
    name_comment = f" - {server_name}" if server_name else ""
    norm_api_path = normalize_api_path(api_path)
    backend_target = normalize_backend_target(backend_proxy_url)

    proxy_snippet = ""
    if backend_target:
        proxy_snippet = f"""    # Backend Reverse-Proxy ({norm_api_path} -> {backend_target})
    handle {norm_api_path} {{
        reverse_proxy {backend_target}
    }}
"""

    root_posix = Path(root_dir).as_posix()

    return f"""# Managed by MSM: Server #{server_id}{name_comment}
{target_header} {{
    root * {root_posix}
    encode gzip

{proxy_snippet}    # Statische Assets mit Langzeit-Cache
    handle /assets/* {{
        @exists file
        header @exists Cache-Control "public, max-age=31536000, immutable"
        file_server
    }}

    # SPA-Fallback fuer Client-seitiges Routing
    handle {{
        try_files {{path}} /index.html
        file_server
    }}
}}
"""


def is_caddy_available() -> bool:
    """Prüft, ob Caddy auf dem lokalen Host als Befehl oder systemd-Dienst verfügbar ist."""
    return shutil.which("caddy") is not None


def apply_vhost(
    server_id: int,
    config_text: str,
    *,
    node: Node | None = None,
) -> bool:
    """Schreibt die Caddy-Konfiguration und triggert einen Caddy-Reload."""
    target_path = get_vhost_path(server_id)
    try:
        target_path.write_text(config_text, encoding="utf-8")
    except OSError as exc:
        logger.error("Konnte Caddy-VHost fuer Server %s nicht schreiben: %s", server_id, exc)
        return False

    # Auf Remote-Nodes könnte künftig der Node-Agent Caddy steuern; lokal direkt Caddy reloaden
    if node is not None and not node.is_local:
        logger.info("Remote-Node Caddy-Konfiguration fuer Server %s abgelegt.", server_id)
        return True

    if not is_caddy_available():
        logger.info("Caddy ist nicht lokal installiert; VHost-Datei fuer Server %s wurde gespeichert.", server_id)
        return True

    # 1. Konfiguration validieren
    try:
        val_res = subprocess.run(
            ["caddy", "validate", "--adapter", "caddyfile", "--config", str(target_path)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if val_res.returncode != 0:
            logger.warning("Caddyfile-Validierung meldet Warnung/Fehler: %s", val_res.stderr.strip()[:200])
    except Exception as exc:
        logger.debug("Caddy-Validierungspruefung uebersprungen: %s", exc)

    # 2. Caddy neuladen (systemctl reload caddy oder caddy reload)
    try:
        if shutil.which("systemctl"):
            reload_res = subprocess.run(
                ["systemctl", "reload", "caddy"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if reload_res.returncode == 0:
                logger.info("Caddy via systemctl erfolgreich neu geladen.")
                return True

        reload_res = subprocess.run(
            ["caddy", "reload"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if reload_res.returncode == 0:
            logger.info("Caddy erfolgreich neu geladen.")
            return True
        logger.warning("caddy reload ergab Returncode %s: %s", reload_res.returncode, reload_res.stderr.strip()[:150])
    except Exception as exc:
        logger.warning("Caddy konnte nicht neu geladen werden: %s", exc)

    return True


def remove_vhost(server_id: int, *, node: Node | None = None) -> bool:
    """Entfernt die Caddy-Konfiguration eines gelöschten oder gestoppten Web-Servers."""
    target_path = get_vhost_path(server_id)
    if target_path.exists():
        try:
            target_path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Konnte Caddy-VHost %s nicht loeschen: %s", target_path, exc)
            return False

    if is_caddy_available() and (node is None or node.is_local):
        try:
            if shutil.which("systemctl"):
                subprocess.run(["systemctl", "reload", "caddy"], capture_output=True, timeout=5)
            else:
                subprocess.run(["caddy", "reload"], capture_output=True, timeout=5)
        except Exception:
            pass

    return True
