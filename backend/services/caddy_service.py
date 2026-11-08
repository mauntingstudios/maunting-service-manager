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
from typing import TYPE_CHECKING, Any, NamedTuple

from config import settings

if TYPE_CHECKING:
    from models import Node, Server

logger = logging.getLogger(__name__)

# Standard-Verzeichnisse für modulare Caddy-Sites und Staging
DEFAULT_CADDY_CONF_DIR = Path("/etc/caddy/conf.d")
DEFAULT_CADDY_STAGING_DIR = Path("/opt/msm/caddy-staging")
DEFAULT_CADDY_LOG_DIR = Path("/var/log/caddy")
DEFAULT_MSM_CADDY_BIN = Path("/usr/local/sbin/msm-caddy")


class ApplyVhostResult(NamedTuple):
    """Ergebnis des VHost-Schreibvorgangs mit boolescher Rückwärtskompatibilität."""

    success: bool
    error: str = ""

    def __bool__(self) -> bool:
        return self.success

    def __eq__(self, other: object) -> bool:
        if isinstance(other, bool):
            return self.success is other
        return tuple(self) == other


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


def _resolve_staging_dir() -> Path:
    """Ermittelt das Staging-Verzeichnis für den atomaren msm-caddy-Schreibweg."""
    custom = getattr(settings, "caddy_staging_dir", None)
    if custom:
        p = Path(custom)
        p.mkdir(parents=True, exist_ok=True)
        return p

    if DEFAULT_CADDY_STAGING_DIR.exists() or os.name == "posix":
        try:
            DEFAULT_CADDY_STAGING_DIR.mkdir(parents=True, exist_ok=True)
            return DEFAULT_CADDY_STAGING_DIR
        except (PermissionError, OSError):
            pass

    fallback = Path(settings.servers_dir).resolve().parent / "caddy_staging"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _resolve_log_dir() -> Path:
    """Ermittelt das Log-Verzeichnis für Caddy-Server-Logs."""
    custom = getattr(settings, "caddy_log_dir", None)
    if custom:
        p = Path(custom)
        p.mkdir(parents=True, exist_ok=True)
        return p

    if DEFAULT_CADDY_LOG_DIR.exists() or os.name == "posix":
        try:
            DEFAULT_CADDY_LOG_DIR.mkdir(parents=True, exist_ok=True)
            return DEFAULT_CADDY_LOG_DIR
        except (PermissionError, OSError):
            pass

    fallback = Path(settings.servers_dir).resolve().parent / "caddy_logs"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def get_vhost_path(server_id: int) -> Path:
    """Pfad zur Caddyfile-Konfiguration eines Servers."""
    conf_dir = _resolve_conf_dir()
    return conf_dir / f"app_{server_id}.conf"


def get_staging_path(server_id: int) -> Path:
    """Pfad zur vorbereiteten Caddyfile-Staging-Datei eines Servers."""
    staging_dir = _resolve_staging_dir()
    return staging_dir / f"app_{server_id}.conf"


def get_caddy_log_path(server_id: int) -> Path:
    """Pfad zur Caddy-Logdatei eines Servers."""
    log_dir = _resolve_log_dir()
    return log_dir / f"app_{server_id}.log"


def _get_msm_caddy_bin() -> Path:
    custom = getattr(settings, "msm_caddy_path", None)
    if custom:
        return Path(custom)
    return DEFAULT_MSM_CADDY_BIN


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
    log_posix = get_caddy_log_path(server_id).as_posix()

    return f"""# Managed by MSM: Server #{server_id}{name_comment}
{target_header} {{
    root * {root_posix}
    encode gzip
    log {{
        output file {log_posix}
    }}

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
) -> ApplyVhostResult:
    """Schreibt die Caddy-Konfiguration und triggert einen Caddy-Reload.

    Verwendet vorrangig den Root-Helfer msm-caddy über sudo -n, um /etc/caddy/conf.d
    atomar zu aktualisieren und caddy validate auszuführen.
    """
    if node is not None and not node.is_local:
        logger.warning("Remote-Node Caddy-Konfiguration fuer Server %s abgelehnt: caddy_agent_unsupported.", server_id)
        return ApplyVhostResult(False, "caddy_agent_unsupported")

    msm_caddy_bin = _get_msm_caddy_bin()
    if msm_caddy_bin.exists():
        staging_file = get_staging_path(server_id)
        try:
            staging_file.parent.mkdir(parents=True, exist_ok=True)
            staging_file.write_text(config_text, encoding="utf-8")
        except OSError as exc:
            err = f"Konnte Caddy-Staging-Datei fuer Server {server_id} nicht schreiben: {exc}"
            logger.error(err)
            return ApplyVhostResult(False, err)

        cmd = ["sudo", "-n", str(msm_caddy_bin), "apply", str(server_id)]
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=15,
            )
            if res.returncode != 0:
                err = res.stderr.strip() or f"msm-caddy exit code {res.returncode}"
                logger.error("msm-caddy apply fehlgeschlagen fuer Server %s: %s", server_id, err)
                return ApplyVhostResult(False, err)
            logger.info("Caddy-VHost fuer Server %s via msm-caddy erfolgreich angewendet.", server_id)
            return ApplyVhostResult(True, "")
        except Exception as exc:
            err = f"Fehler beim Aufruf von msm-caddy apply: {exc}"
            logger.error(err)
            return ApplyVhostResult(False, err)

    # Fallback fuer Test- und Entwicklungsumgebungen ohne sudo/msm-caddy
    target_path = get_vhost_path(server_id)
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(config_text, encoding="utf-8")
    except OSError as exc:
        err = f"Konnte Caddy-VHost fuer Server {server_id} nicht schreiben: {exc}"
        logger.error(err)
        return ApplyVhostResult(False, err)

    if not is_caddy_available():
        logger.info("Caddy ist nicht lokal installiert; VHost-Datei fuer Server %s wurde gespeichert.", server_id)
        return ApplyVhostResult(True, "")

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
                return ApplyVhostResult(True, "")

        reload_res = subprocess.run(
            ["caddy", "reload"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if reload_res.returncode == 0:
            logger.info("Caddy erfolgreich neu geladen.")
            return ApplyVhostResult(True, "")
        logger.warning("caddy reload ergab Returncode %s: %s", reload_res.returncode, reload_res.stderr.strip()[:150])
    except Exception as exc:
        logger.warning("Caddy konnte nicht neu geladen werden: %s", exc)

    return ApplyVhostResult(True, "")


def remove_vhost(server_id: int, *, node: Node | None = None) -> bool:
    """Entfernt die Caddy-Konfiguration eines gelöschten oder gestoppten Web-Servers."""
    if node is not None and not node.is_local:
        logger.warning("Remote-Node Caddy-Entfernung fuer Server %s nicht unterstuetzt.", server_id)
        return False

    msm_caddy_bin = _get_msm_caddy_bin()
    if msm_caddy_bin.exists():
        cmd = ["sudo", "-n", str(msm_caddy_bin), "remove", str(server_id)]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if res.returncode != 0:
                logger.warning("msm-caddy remove Server %s ergab Returncode %s: %s", server_id, res.returncode, res.stderr.strip()[:150])
                return False
            return True
        except Exception as exc:
            logger.warning("Fehler beim Aufruf von msm-caddy remove: %s", exc)
            return False

    # Lokaler Fallback
    target_path = get_vhost_path(server_id)
    if target_path.exists():
        try:
            target_path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Konnte Caddy-VHost %s nicht loeschen: %s", target_path, exc)
            return False

    staging_path = get_staging_path(server_id)
    if staging_path.exists():
        try:
            staging_path.unlink(missing_ok=True)
        except OSError:
            pass

    if is_caddy_available():
        try:
            if shutil.which("systemctl"):
                subprocess.run(["systemctl", "reload", "caddy"], capture_output=True, timeout=5)
            else:
                subprocess.run(["caddy", "reload"], capture_output=True, timeout=5)
        except Exception:
            pass

    return True
