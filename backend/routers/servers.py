import os
import shutil
import threading
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile, WebSocket
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import SessionLocal
from database import get_db
from models import Server, User
from schemas import (
    ServerCreate,
    ServerCreateResponse,
    ServerResponse,
    ServerUpdate,
    ServerStatusResponse,
    ServerVariablesResponse,
    ServerVariablesUpdateRequest,
    ServerVariablesUpdateResponse,
    WallpaperGalleryItem,
)
from schemas.postgres import PostgresOneTimeCredential
from dependencies import (
    get_current_user,
    get_current_user_for_ws,
    require_server_permission,
    verify_csrf,
    ws_origin_erlaubt,
)
from services import audit_service, permission_service, postgres_service, server_variables_service, wallpaper_service
from services.media_gallery_service import build_webp_response
from games import get_plugin
from games.base import container_name_for, _console_log_path, _append_console_log
from services import EmailService, docker_service
from services import exec_service
from services.achievement_service import AchievementService
from services.docker_iptables_service import accept_server as iptables_accept_server
from services.docker_iptables_service import revoke_server as iptables_revoke_server
from services.firewall_service import close_ports, open_ports
from services.port_allocation_service import PortConflictError, allocate_ports
from services.port_role_service import blueprint_port_requirements, normalize_port_protocol
from services.scheduler_service import sync_server_restart_schedule, evaluate_disk_soft_limit
from services.server_lifecycle_service import (
    get_server_lifecycle_lock,
    is_lifecycle_job_active,
    should_preserve_lifecycle_status,
)
from services.console_stream_service import DeclaredLogConfig, connect as ws_connect
from services.install_update_lock_service import (
    release_install_update_lock,
    force_release_install_update_lock,
    try_acquire_install_update_lock,
)
from services.actor_context import ActorContext
from services.server_provisioning_service import (
    assert_remote_ports_available as _assert_remote_ports_available,
    install_update_busy_error as _install_update_busy_error,
    normalize_server_restart_mode as _normalize_server_restart_mode,
    provision_server,
)
from services.server_action_service import request_lifecycle_operation

import logging
logger = logging.getLogger(__name__)


# ── Leichtergewichtiger, passiver Cache für Update-Checks im Status-Endpoint ──
# Zweck: Frontend-Badge (Update-Verfügbarkeit) ohne teure Calls (Workshop/Steam)
# bei jedem Poll. KISS + defensiv: TTL-basiert, nie status kaputt machen.
# TTL 5min reicht für Badge (Updates sind nicht sekündlich).
_UPDATE_CACHE: dict[int, dict] = {}
_UPDATE_CACHE_LOCK = threading.Lock()
_UPDATE_CACHE_TTL_SECONDS = 300

# _SERVER_OPERATION_LOCKS entfernt: alle destruktiven Lifecycle-Ops (start/stop/restart)
# verwenden nun EINHEITLICH get_server_lifecycle_lock aus server_lifecycle_service.
# Verhindert TOCTOU auf Firewall/iptables (Security-Finding). KISS + zentrale Serialisierung.


router = APIRouter(prefix="/api/servers", tags=["servers"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _server_restart_status_fields(server: Server) -> dict:
    return {
        "started_at": server.last_started_at,
        "last_auto_restart_attempt_at": server.last_auto_restart_attempt_at,
        "last_auto_restart_completed_at": server.last_auto_restart_completed_at,
        "last_auto_restart_status": server.last_auto_restart_status,
        "next_auto_restart_at": server.next_auto_restart_at,
    }


def _port_requirements_for_server(server: Server, protocol_overrides: dict[str, str] | None = None) -> list[tuple[str, str]]:
    plugin = get_plugin(server.game_type)
    bp = plugin.get_blueprint() if plugin else None
    if bp:
        requirements = blueprint_port_requirements(bp.ports)
    else:
        requirements = [
            ("game", "udp"),
            ("query", "udp"),
            ("rcon", "tcp"),
        ]

    current_protocols = {
        p.role: normalize_port_protocol(p.protocol)
        for p in getattr(server, "ports", []) or []
    }
    overrides = {
        role: normalize_port_protocol(protocol)
        for role, protocol in (protocol_overrides or {}).items()
    }

    return [
        (role, overrides.get(role, current_protocols.get(role, proto)))
        for role, proto in requirements
    ]


@router.post("", response_model=ServerCreateResponse, status_code=201)
async def create_server(
    req: ServerCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    retry_of_id: str | None = Header(None, alias="X-Task-Retry-Of"),
) -> ServerCreateResponse:
    """Dünner HTTP-Adapter; RBAC und Provisionierung liegen im gemeinsamen Service.

    `provision_server` ist durchgehend synchron und macht dabei echtes I/O:
    Socket-Binds, HTTP-Aufrufe an die Node mit zehn Sekunden Zeitlimit,
    Verzeichnisse anlegen, Datenbanken einrichten. Auf dem Event-Loop
    ausgeführt legt eine einzige Serveranlage das ganze Panel still — keine
    andere Anfrage, kein WebSocket-Frame. Deshalb der Threadpool. Die Route
    bleibt `async`, weil die Mailbenachrichtigung darunter awaited wird.
    """
    result = await run_in_threadpool(
        provision_server,
        db,
        req,
        ActorContext.for_user(user),
        idempotency_key=idempotency_key,
        retry_of_id=retry_of_id,
    )
    if not result.reused and EmailService.is_configured() and user.email_notifications:
        await EmailService.send_server_installed_notification(
            user.email,
            user.username,
            result.server.name,
        )

    response = _server_response(result.server, db)
    create_resp = ServerCreateResponse.model_validate(response.model_dump())
    create_resp.postgres_credentials = [
        PostgresOneTimeCredential.model_validate(item)
        for item in result.postgres_credentials
    ]
    create_resp.task_id = result.task.id
    return create_resp


def _is_guardian_enabled(server: Server) -> bool:
    try:
        from services.guardian_runtime_compiler import is_guardian_enabled

        plugin = get_plugin(server.game_type)
        bp = plugin.get_blueprint() if hasattr(plugin, "get_blueprint") else getattr(plugin, "blueprint", None)
        if bp is not None:
            return is_guardian_enabled(bp)
    except Exception:
        pass
    return False


def _server_response(server: Server, db: Session | None = None) -> ServerResponse:
    """Serialize server including safe node label (never auth tokens)."""
    from services.node_service import effective_server_runtime_status, is_node_offline

    data = ServerResponse.model_validate(server)
    if db is not None:
        desk = wallpaper_service.resolve_wallpaper(db, server)
        data.has_custom_wallpaper = desk.source == "custom"
        data.wallpaper_url = desk.url
        data.wallpaper_source = desk.source
        data.wallpaper_version = desk.version
    data.guardian_enabled = _is_guardian_enabled(server)
    # The persisted clear intent remains pending across offline/unknown/stale
    # observations. Reconciliation removes it only after the Agent accepts the
    # generation and reports that quarantine is gone.
    data.guardian_quarantine_clear_pending = bool(
        server.guardian_quarantine_control
    )
    node = getattr(server, "node", None)
    if node is not None:
        data.node_id = node.id
        data.node_name = node.name
        # Graceful degradation: keep server visible; surface node_unreachable
        if is_node_offline(node):
            data.status = effective_server_runtime_status(server, node)
            data.status_message = "Node offline — Aktionen deaktiviert"
    else:
        data.node_id = getattr(server, "node_id", None)
        data.node_name = None
    return data


@router.get("", response_model=list[ServerResponse])
def list_servers(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[ServerResponse]:
    from services.frontend_deploy_service import get_active_frontend_builds_map

    servers = permission_service.list_visible_servers(db, user)
    # Ein Batch-Query fuer alle Kundenserver — kein Lookup je Server, die
    # Liste wird alle fuenf Sekunden abgefragt.
    hoster_ids = permission_service.hoster_customer_server_ids(db)
    active_builds = get_active_frontend_builds_map(db, [s.id for s in servers])
    responses = []
    for s in servers:
        data = _server_response(s, db)
        data.is_hoster_managed = s.id in hoster_ids
        if s.id in active_builds:
            from schemas.server import FrontendBuildBadge

            data.active_frontend_build = FrontendBuildBadge(**active_builds[s.id])
        responses.append(data)
    return responses


@router.get("/{server_id}", response_model=ServerResponse)
def get_server(server_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ServerResponse:
    from services.frontend_deploy_service import get_active_frontend_builds_map

    require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    data = _server_response(server, db)
    data.is_hoster_managed = permission_service.is_hoster_customer_server(db, server_id)
    active_builds = get_active_frontend_builds_map(db, [server_id])
    if server_id in active_builds:
        from schemas.server import FrontendBuildBadge

        data.active_frontend_build = FrontendBuildBadge(**active_builds[server_id])
    return data


@router.patch("/{server_id}", response_model=ServerResponse)
def update_server(server_id: int, req: ServerUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user), _: None = Depends(verify_csrf)) -> Server:
    from services.server_update_service import execute_server_update

    return execute_server_update(server_id, req, db, user)


@router.delete("/{server_id}")
def delete_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """HTTP-Rand der gemeinsamen Server-Loeschung.

    Die eigentliche Reihenfolge, Fehlerbehandlung und Rechtepruefung liegt in
    `services.server_deletion_service`, damit Panel und Hoster-Anbindung exakt
    denselben Weg verwenden (Zielpunkt 10).
    """
    from services.server_deletion_service import delete_server_completely

    return delete_server_completely(
        db, server_id=server_id, actor=ActorContext.for_user(user)
    )


@router.post("/{server_id}/start")
def start_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    retry_of_id: str | None = Header(None, alias="X-Task-Retry-Of"),
) -> dict:
    from services.server_lifecycle_service import LifecycleNotification

    return request_lifecycle_operation(
        db,
        server_id=server_id,
        operation="start",
        actor=ActorContext.for_user(user),
        notification=LifecycleNotification(user.email, user.username, user.email_notifications),
        idempotency_key=idempotency_key,
        retry_of_id=retry_of_id,
    )


@router.post("/{server_id}/stop")
def stop_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    retry_of_id: str | None = Header(None, alias="X-Task-Retry-Of"),
) -> dict:
    from services.server_lifecycle_service import LifecycleNotification

    return request_lifecycle_operation(
        db,
        server_id=server_id,
        operation="stop",
        actor=ActorContext.for_user(user),
        notification=LifecycleNotification(user.email, user.username, user.email_notifications),
        idempotency_key=idempotency_key,
        retry_of_id=retry_of_id,
    )


@router.post("/{server_id}/restart")
def restart_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    retry_of_id: str | None = Header(None, alias="X-Task-Retry-Of"),
) -> dict:
    from services.server_lifecycle_service import LifecycleNotification

    return request_lifecycle_operation(
        db,
        server_id=server_id,
        operation="restart",
        actor=ActorContext.for_user(user),
        notification=LifecycleNotification(user.email, user.username, user.email_notifications),
        idempotency_key=idempotency_key,
        retry_of_id=retry_of_id,
    )


@router.post("/{server_id}/auth-setup/cancel")
def cancel_auth_setup(server_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user), _: None = Depends(verify_csrf)) -> dict:
    """Bricht einen laufenden Auth-Setup-Recovery-Vorgang ab.

    ``def`` wie ``kill_server``: ``docker_service.stop`` wartet bis zu 10 s an
    der Node und hielt bis 27.09.2026 dabei die Ereignisschleife an.

    Wird aufgerufen, wenn der User den interaktiven Auth-Flow manuell abbrechen
    will (z.B. weil er das Spiel doch nicht neu authentifizieren moechte oder
    lieber die Credentials manuell austauscht).

    Setzt ``auth_required=False``, ruft ``docker_service.stop`` auf den wartenden
    Container, und loggt eine MSM-Message in die Konsole. Der eigentliche
    Recovery-Thread prueft ``auth_required`` via on_status bei seinen naechsten
    Status-Updates und beendet sich selbst.
    """
    require_server_permission(user, server_id, db, "server.start")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    if not server.auth_required:
        raise HTTPException(status_code=409, detail="Server ist nicht im Auth-Setup-Modus")

    from services import docker_service
    container_name = container_name_for(server.id)
    server.auth_required = False
    server.status_message = "Auth-Setup vom User abgebrochen"
    db.commit()
    stop_result = docker_service.stop(container_name, timeout=10, node=server.node)
    _append_console_log(server.id, "[MSM] Auth-Setup vom User abgebrochen.\n")
    return {
        "message": "Auth-Setup abgebrochen",
        "container_stopped": stop_result.get("ok", False),
    }


@router.post("/{server_id}/kill")
def kill_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    retry_of_id: str | None = Header(None, alias="X-Task-Retry-Of"),
) -> dict:
    """Erzwungenes Beenden (Docker force remove). Als Notfall auch während start/restart nutzbar (emergency override des Job-Locks).
    Permission "server.kill" (Naming analog zu server.stop, nicht server.power.* für Code-Konsistenz mit bestehenden server.* Keys).

    Bewusst `def` statt `async def`: die Route wartet auf `docker_service.remove`
    an der Node (30 s Zeitlimit). Auf dem Event-Loop hätte ein Kill gegen eine
    nicht erreichbare Node das ganze Panel bis zum Zeitlimit eingefroren. Der
    Kill-Zweig setzt `server.status` direkt statt über `_set_status` und hängt
    an keinem laufenden Loop — der Wechsel in den Threadpool ändert also
    nichts am Verhalten. Für start/stop/restart gilt das **nicht**: dort
    verschickt `_set_status` den Webhook nur bei laufendem Loop.
    """
    return request_lifecycle_operation(
        db,
        server_id=server_id,
        operation="kill",
        actor=ActorContext.for_user(user),
        idempotency_key=idempotency_key,
        retry_of_id=retry_of_id,
    )


def _disk_free_mb(path: str) -> int | None:
    """Liefert freien Speicher auf dem Filesystem von `path` in MB.

    Wir nutzen os.statvfs (Linux/Unix). Bei Fehler None - der Frontend zeigt
    dann '-' an, statt zu crashen.
    """
    try:
        if not path:
            return None
        if not hasattr(os, "statvfs"):
            return None
        # Falls install_dir noch nicht existiert, das Eltern-Verzeichnis nehmen
        target = path if os.path.exists(path) else os.path.dirname(path) or "/"
        st = os.statvfs(target)
        return int((st.f_bavail * st.f_frsize) // (1024 * 1024))
    except (AttributeError, OSError):
        return None


def _get_cached_update_availability(server, plugin, *, force: bool = False) -> dict:
    """Leichtgewichtige Ermittlung der Server-Datei-Update-Verfügbarkeit.

    Ruft plugin.check_for_server_file_update nur bei TTL-Miss (5min) oder force=True.
    Mod-Updates sind kein Server-Update-Badge (eigener Mod-Manager-Check).
    """
    empty = {
        "server_file_update_available": False,
        "server_file_update_reason": None,
        "mod_updates_available": [],
    }
    if not plugin or not getattr(server, "id", None):
        return empty

    sid = server.id
    now = time.time()
    if not force:
        with _UPDATE_CACHE_LOCK:
            cached = _UPDATE_CACHE.get(sid)
        if cached and (now - cached.get("ts", 0) < _UPDATE_CACHE_TTL_SECONDS):
            return cached["data"]
        from services import redis_backplane

        remote_cached = redis_backplane.cache_get_json("update_check", str(sid))
        if isinstance(remote_cached, dict):
            with _UPDATE_CACHE_LOCK:
                _UPDATE_CACHE[sid] = {"ts": now, "data": remote_cached}
            return remote_cached

    from services import redis_backplane

    try:
        check_server = getattr(plugin, "check_for_server_file_update", None)
        server_update = check_server(server) if check_server else {}
        if not isinstance(server_update, dict):
            server_update = {}
        server_file_available = server_update.get("action") == "update"
        server_file_reason = server_update.get("reason") if server_file_available else None

        data = {
            "server_file_update_available": bool(server_file_available),
            "server_file_update_reason": server_file_reason,
            "mod_updates_available": [],
        }
        with _UPDATE_CACHE_LOCK:
            _UPDATE_CACHE[sid] = {"ts": now, "data": data}
        redis_backplane.cache_set_json("update_check", str(sid), data, _UPDATE_CACHE_TTL_SECONDS)
        return data
    except Exception as exc:
        logger.warning(
            "Passive update check failed for server %s (non-fatal): %s",
            sid, exc
        )
        fallback = dict(empty)
        with _UPDATE_CACHE_LOCK:
            _UPDATE_CACHE[sid] = {"ts": now, "data": fallback}
        redis_backplane.cache_set_json("update_check", str(sid), fallback, _UPDATE_CACHE_TTL_SECONDS)
        return fallback


class ServerFileUpdateCheckResponse(BaseModel):
    server_file_update_available: bool = False
    server_file_update_reason: str | None = None


@router.get("/{server_id}/status", response_model=ServerStatusResponse)
def server_status(server_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    disk_used = server.disk_usage_mb
    from services.node_capacity import agent_server_key, should_delegate_node_fs_to_agent

    if should_delegate_node_fs_to_agent(server.node):
        try:
            from services.node_client import NodeClient

            disk_data = NodeClient.from_node(server.node).files_disk_info(
                agent_server_key(server.id, server.install_dir)
            )
            disk_free = int(disk_data["free_bytes"]) // (1024 * 1024)
            if not disk_used and disk_data.get("used_bytes") is not None:
                disk_used = int(disk_data["used_bytes"]) // (1024 * 1024)
        except Exception:
            disk_free = None
    else:
        disk_free = _disk_free_mb(server.install_dir) if server.install_dir else None

    # Update-Info leichtgewichtig + cached (nicht bei jedem Status-Call teuer).
    # Ergebnisse von check_for_server_file_update + check_for_mod_updates.
    update_info = _get_cached_update_availability(server, plugin)

    if not plugin:
        return {
            "id": server.id,
            "status": server.status,
            "status_message": server.status_message,
            "cpu_percent": None,
            "ram_mb": None,
            "disk_mb": disk_used,
            "uptime_seconds": server.uptime_seconds,
            "cpu_limit_percent": server.cpu_limit_percent,
            "ram_limit_mb": server.ram_limit_mb,
            "disk_limit_gb": server.disk_limit_gb,
            "disk_used_mb": disk_used,
            "disk_free_mb": disk_free,
            "node_cpu_steal_percent": getattr(getattr(server, "node", None), "cpu_steal_percent", None),
            "server_file_update_available": update_info["server_file_update_available"],
            "server_file_update_reason": update_info["server_file_update_reason"],
            "mod_updates_available": update_info["mod_updates_available"],
            **_server_restart_status_fields(server),
        }
    plugin_status = plugin.get_status(server)
    # installing/updating/error/failed nicht ueberschreiben. Laufende Lifecycle-
    # Jobs behalten ihre transienten Stati, bis der Background-Worker finalisiert.
    if server.status not in ("installing", "updating", "error", "failed") and not should_preserve_lifecycle_status(server.id, server.status):
        server.status = plugin_status.status
        server.status_message = plugin_status.message or ""
        if plugin_status.status == "running" and plugin_status.started_at is not None:
            server.last_started_at = plugin_status.started_at
        elif plugin_status.status != "running":
            server.last_started_at = None
    db.commit()
    return {
        "id": server.id,
        "status": server.status,
        "status_message": server.status_message,
        "cpu_percent": plugin_status.cpu_percent,
        "ram_mb": plugin_status.ram_mb,
        # Disk-MB im Status: auf den DB-Wert zurueckfallen, damit auch ohne
        # gesetztes disk_limit ein Used-Wert angezeigt wird.
        "disk_mb": plugin_status.disk_mb if plugin_status.disk_mb is not None else disk_used,
        "uptime_seconds": plugin_status.uptime_seconds,
        "cpu_limit_percent": server.cpu_limit_percent,
        "ram_limit_mb": server.ram_limit_mb,
        "disk_limit_gb": server.disk_limit_gb,
        "disk_used_mb": disk_used,
        "disk_free_mb": disk_free,
        "node_cpu_steal_percent": getattr(getattr(server, "node", None), "cpu_steal_percent", None),
        "server_file_update_available": update_info["server_file_update_available"],
        "server_file_update_reason": update_info["server_file_update_reason"],
        "mod_updates_available": update_info["mod_updates_available"],
        **_server_restart_status_fields(server),
    }


@router.post(
    "/{server_id}/check-server-file-updates",
    response_model=ServerFileUpdateCheckResponse,
)
def check_server_file_updates(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Manueller Spiel-/Server-Datei-Update-Check (wie Workshop „Updates prüfen“).

    Umgeht den 5-Minuten-Status-Cache und aktualisiert die Badge-Daten.
    """
    require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    info = _get_cached_update_availability(server, plugin, force=True)
    return {
        "server_file_update_available": info["server_file_update_available"],
        "server_file_update_reason": info["server_file_update_reason"],
    }


@router.post("/{server_id}/install")
def install_server(server_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user), _: None = Depends(verify_csrf)) -> dict:
    require_server_permission(user, server_id, db, "server.install")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    if not plugin:
        raise HTTPException(status_code=400, detail="Spiel-Typ nicht unterstützt")
    if not try_acquire_install_update_lock(server.id, "install", node_id=server.node_id):
        raise _install_update_busy_error()
    # Der Status vor der Installation wird gemerkt, damit ein Fehlstart ihn
    # wiederherstellen kann. Ohne das blieb der Server dauerhaft auf
    # "installing": weder die Statusaktualisierung noch die
    # Lifecycle-Reconciliation korrigieren diesen Zustand, der Server war im
    # Panel also nicht mehr bedienbar.
    previous_status = server.status
    previous_status_message = server.status_message

    def _restore_status() -> None:
        try:
            db.rollback()
            server.status = previous_status
            server.status_message = previous_status_message
            db.commit()
        except Exception:
            db.rollback()
            logger.warning(
                "Serverstatus konnte nach fehlgeschlagenem Installationsstart nicht "
                "zurueckgesetzt werden (server_id=%s)",
                server_id,
            )

    try:
        server.status = "installing"
        server.status_message = "Installation gestartet"
        db.commit()
        result = plugin.install(server)
    except Exception:
        release_install_update_lock(server.id)
        _restore_status()
        raise HTTPException(status_code=500, detail="Installation konnte nicht gestartet werden")
    if "error" in result:
        release_install_update_lock(server.id)
        # plugin.install() hat den Server bereits selbst auf "error" gesetzt,
        # wenn es die Installation gar nicht erst starten konnte. In dem Fall
        # bleibt dieser Status stehen; nur ein noch auf "installing" stehender
        # Server wird zurueckgesetzt.
        db.refresh(server)
        if server.status == "installing":
            _restore_status()
        raise HTTPException(status_code=500, detail=result["error"])
    return {"message": "Installation gestartet", **result}


@router.post("/{server_id}/unlock")
def unlock_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Manuelle Freigabe hängender/blockierter Installation-Locks für einen Server."""
    require_server_permission(user, server_id, db, "server.install")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    released = force_release_install_update_lock(server.id)

    if server.status == "installing":
        server.status = "stopped"
        server.status_message = "Manuell entsperrt"
        db.commit()

    return {
        "message": "Installation-Lock freigegeben",
        "released": released,
    }


# ── Erlaubte Origins fuer WebSocket-Upgrades ───────────────────────────────
# Dieselbe Allowlist wie CORS (panel_url + MSM_CORS_ALLOWED_ORIGINS + Dev).


def _ws_origin_allowed(origin: str | None) -> bool:
    """Prueft den Origin-Header des WS-Upgrade-Requests. SameSite-Cookie + Origin-Check
    ersetzen die fehlende CSRF-Pruefung (WS sind keine 'simple requests').

    Die Konsole verlangt die Herkunft auch beim Bearer-Weg; die Pruefung selbst
    steht in `dependencies.ws_origin_erlaubt`.
    """
    return ws_origin_erlaubt(origin)


@router.websocket("/{server_id}/console/ws")
async def server_console_ws(websocket: WebSocket, server_id: int) -> None:
    """Live-Stream der Server-Konsole als WebSocket.

    Auth: Cookie-Auth im WS-Handshake (genauso wie beim HTTP-Pfad), danach
    Server-Permission ``server.console.read``. Origin-Check ersetzt den CSRF-Schutz
    fuer WS-Upgrades.

    Optional ``?last_id=<n>`` Query-Param: Replay-Resume nach Reconnect — der
    Server spult nur Zeilen mit id > last_id aus dem Ring-Buffer ab und macht
    dann mit Live-Stream weiter. Ohne last_id wird der volle Backlog gesendet.

    Frame-Format: JSON ``{"id": int, "ts": iso, "source": "msm"|"docker", "text": str}``.
    Eingehende Frames: vorerst nur Heartbeat ``{"action": "ping"}`` -> ``{"action": "pong"}``.
    Stdin laeuft weiterhin ueber ``POST /api/servers/{id}/console/input``.
    """
    origin = websocket.headers.get("origin")
    if not _ws_origin_allowed(origin):
        await websocket.close(code=1008)  # 1008 = "policy violation"
        return

    db = SessionLocal()
    node = None
    declared_logs = None
    try:
        try:
            user = get_current_user_for_ws(websocket, db)
            server = db.query(Server).filter(Server.id == server_id).first()
            if not server:
                await websocket.close(code=1008)
                return
            require_server_permission(user, server_id, db, "server.console.read")
            # Ein Eintrag je Verbindungsaufbau (10-min-Dedupe im Helfer) —
            # nicht je Frame: der Stream liefe sonst als Schreiblast weiter.
            audit_service.record_read_access(
                db, user_id=user.id, server_id=server_id, action="server.console.read"
            )
            # Eager-load node before session closes (avoid DetachedInstanceError)
            node = server.node
            if node is not None:
                # Touch attributes while session is open
                _ = (node.id, node.host, node.is_local, node.auth_token_enc)
            plugin = get_plugin(server.game_type)
            blueprint = plugin.get_blueprint() if plugin and hasattr(plugin, "get_blueprint") else None
            logs = getattr(blueprint, "logs", None)
            if logs is not None:
                declared_logs = DeclaredLogConfig(
                    root=server.install_dir,
                    sources=tuple(logs.sources),
                    redactors=tuple(logs.redact),
                    max_tail_bytes=logs.max_tail_bytes,
                )
        except HTTPException:
            await websocket.close(code=1008)
            return
        finally:
            db.close()

        container = getattr(server, "container_name", None) or container_name_for(server.id)
        server_status = getattr(server, "status", None)
        log_path = _console_log_path(server.id)
        last_id_raw = websocket.query_params.get("last_id")
        last_id: int | None = None
        if last_id_raw is not None:
            try:
                last_id = int(last_id_raw)
            except ValueError:
                last_id = None

        await ws_connect(
            websocket,
            server_id=server_id,
            container=container,
            log_path=log_path,
            last_id=last_id,
            node=node,
            declared_logs=declared_logs,
            server_status=server_status,
        )
    finally:
        if db.is_active:
            db.close()


class ConsoleInputBody(BaseModel):
    """Eingabezeile fuer die Konsole.

    Limit von 1 KiB pro POST schuetzt vor Missbrauch (z. B. Riesen-Payloads via
    XSS). Server-Spiele schicken in der Praxis Befehlszeilen << 1 KiB.
    """
    line: str = Field(..., min_length=0, max_length=1024)


@router.post("/{server_id}/console/input")
def server_console_input(
    server_id: int,
    body: ConsoleInputBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Schreibt ``body.line`` in den stdin des Container-Prozesses.

    Auth: Cookie + CSRF + ``server.console.write``. Die Eingabe selbst wird
    NICHT geloggt - sie kann sensibel sein (OAuth-Codes, RCON-Tokens, etc.).
    """
    require_server_permission(user, server_id, db, "server.console.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    container = container_name_for(server.id)
    if not docker_service.is_running(container, node=server.node):
        raise HTTPException(status_code=409, detail="Container läuft nicht")
    # Newline erzwingen - die meisten Game-Server lesen zeilenweise.
    data = body.line if body.line.endswith("\n") else body.line + "\n"
    result = docker_service.send_stdin(container, data, node=server.node)
    if not result["ok"]:
        # Generische Fehlermeldung - keine Container-Internas leaken.
        raise HTTPException(status_code=500, detail="Eingabe konnte nicht zugestellt werden")
    AchievementService.melde(db, user.id, "terminal_commander", commit=True)
    return {"ok": True}


# ── Exec-Tab (v1.4.7+) ─────────────────────────────────────────────────────
#
# Oneshot-Befehl im MSM-Container des Servers. Sicherheit:
# - Auth: Cookie + CSRF + neue Permission ``server.console.exec``.
# - Blueprint-Gate: ``runtime.enableExec=true`` im Server-Blueprint.
#   Wer die Permission hat, aber im Blueprint des Servers ist Exec aus,
#   bekommt 403 -- so bleibt ein "neuer Exec-User pro Server"-Workflow
#   sauber (Server-Owner aktivieren Exec pro Blueprint).
# - argv-Liste, kein Shell-String. Wir bauen NIE ``["sh", "-c", userstring]``,
#   also kann ein User mit ``server.console.exec`` keine Shell-Metazeichen
#   eskalieren. ``container.exec_run(argv)`` fuehrt die args als exec-Args
#   des Zielprozesses aus, ohne Shell dazwischen.
# - Container-Name kommt ausschliesslich aus ``container_name_for(server.id)``;
#   es gibt KEIN Feld im Request, mit dem der User den Container beeinflussen
#   koennte. Damit ist "Host-Exec" oder "Container eines anderen Servers"
#   strukturell ausgeschlossen.
# - Output gedeckelt (256 KiB) im Service, Timeout (1..600s) aus Blueprint.
# - Audit-Log (server_id, user_id, argv) im Service -- Output wird NICHT
#   geloggt (kann Secrets enthalten).
class ExecCommandBody(BaseModel):
    """Body fuer POST /api/servers/{id}/exec.

    Args als argv-Liste, nicht als String. Pydantic validiert:
    - 1..32 Elemente (sonst 422)
    - jedes Element: max 4096 Zeichen (sonst 422)
    """

    command: list[str] = Field(..., min_length=1, max_length=32)

    @field_validator("command")
    @classmethod
    def _check_each_arg(cls, v: list[str]) -> list[str]:
        for i, arg in enumerate(v):
            if not isinstance(arg, str):
                raise ValueError(f"command[{i}] muss ein String sein")
            if len(arg) > 4096:
                raise ValueError(
                    f"command[{i}] zu lang ({len(arg)} > 4096 Zeichen)"
                )
        return v


@router.post("/{server_id}/exec")
def server_exec(
    server_id: int,
    body: ExecCommandBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Fuehrt ``body.command`` (argv) im Container von ``server_id`` aus.

    Auth: Cookie + CSRF + ``server.console.exec``.
    Blueprint-Gate: ``runtime.enableExec=true``.
    Output gedeckelt; bei Fehler generische Statuscodes (500/504),
    keine internen Pfade/Stacktraces im Response.
    """
    require_server_permission(user, server_id, db, "server.console.exec")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    # Blueprint-Gate: per-Blueprint-Opt-in. Default ist False.
    blueprint = exec_service.load_blueprint_for_server(server)
    if blueprint is None or not getattr(
        blueprint.runtime, "enableExec", False
    ):
        raise HTTPException(
            status_code=403,
            detail="Exec ist im Blueprint dieses Servers deaktiviert",
        )

    timeout = int(getattr(blueprint.runtime, "execTimeoutSeconds", 60))

    result = exec_service.run_in_container(
        server_id=server_id,
        command=body.command,
        timeout=timeout,
        user_id=user.id,
        node=server.node,
    )

    if not result["ok"]:
        err = (result.get("error") or "").lower()
        if "timeout" in err:
            raise HTTPException(
                status_code=504, detail="Exec-Timeout ueberschritten"
            )
        # Generische Fehlermeldung -- keine Container-Internas leaken.
        raise HTTPException(status_code=500, detail="Exec fehlgeschlagen")

    AchievementService.melde(db, user.id, "terminal_commander", commit=True)
    return {
        "ok": True,
        "stdout": result["stdout"],
        "stderr": result["stderr"],
    }


@router.get("/{server_id}/logs")
def server_logs(server_id: int, lines: int = 100, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    require_server_permission(user, server_id, db, "server.console.read")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    audit_service.record_read_access(
        db, user_id=user.id, server_id=server_id, action="server.logs.read"
    )
    plugin = get_plugin(server.game_type)
    if plugin:
        logs = plugin.get_logs(server, lines=lines)
        return {"logs": logs, "path": "plugin-provided"}
    # Fallback: generische Log-Pfade
    fallback_paths = [
        os.path.join(server.install_dir, "logs", "latest.log"),
        os.path.join(server.install_dir, "log_1.txt"),
        os.path.join(server.install_dir, "log", "script_1.log"),
    ]
    for path in fallback_paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    all_lines = f.readlines()
                return {"logs": "".join(all_lines[-lines:]), "path": path}
            except Exception:
                continue
    return {"logs": "", "path": "none"}


class SwitchBlueprintRequest(BaseModel):
    new_blueprint_id: str


@router.post("/{server_id}/switch-blueprint")
def switch_server_blueprint_endpoint(
    server_id: int,
    body: SwitchBlueprintRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Wechselt das Spiel / den Blueprint eines gestoppten Servers.
    Erzeugt AUSNAHMSLOS ein Pflicht-Pre-Switch-Backup ueber das zentrale Backup-System.
    """
    require_server_permission(user, server_id, db, "server.config.write")

    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    from services.server_lifecycle_service import switch_server_blueprint
    return switch_server_blueprint(db, server, body.new_blueprint_id, user_id=user.id)


# ── Server-Wallpaper (Titelbild pro Spiel) ───────────────────────────────
# Die Wirkung ist game-scoped: Wer hier hochlaedt, aendert das Bild fuer
# alle Server desselben Spiels — daher der eigene Key server.wallpaper.manage.


@router.get("/{server_id}/wallpaper")
def get_server_wallpaper(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    if_none_match: str | None = Header(default=None),
    v: str | None = Query(default=None),
) -> Response:
    """Liefert das aufgeloeste Titelbild (Custom oder Steam-Cache).

    404 heisst "kein Bild" — das Frontend faellt dann aufs Panorama zurueck.
    Mit `?v=` (Inhalts-Version aus der Server-Antwort) wird inhaltsadressiert
    aufgeloest und immutable gecacht: Die Antwort malt der Browser ohne jede
    weitere Anfrage. Ohne `?v=` gilt no-cache + ETag wie bisher.
    """
    require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    if v is not None:
        try:
            gefunden = wallpaper_service.wallpaper_bytes_by_version(db, server, v)
        except wallpaper_service.WallpaperValidationError as exc:
            raise HTTPException(status_code=400, detail=exc.message)
        if gefunden is None:
            raise HTTPException(status_code=404, detail="Bild nicht gefunden")
        bild, etag = gefunden
        return build_webp_response(
            data=bild, etag=etag, if_none_match=if_none_match, versioned=True
        )
    gefunden = wallpaper_service.wallpaper_bytes_for_server(db, server)
    if gefunden is None:
        raise HTTPException(status_code=404, detail="Kein Titelbild vorhanden")
    bild, etag = gefunden
    return build_webp_response(
        data=bild, etag=etag, if_none_match=if_none_match, versioned=False
    )


@router.post("/{server_id}/wallpaper")
async def upload_server_wallpaper(
    server_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Laedt ein Titelbild fuer das Spiel dieses Servers hoch (wird aktiv)."""
    require_server_permission(user, server_id, db, "server.wallpaper.manage")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    roh = await file.read(wallpaper_service.MAX_WALLPAPER_BYTES + 1)
    try:
        webp = wallpaper_service.sanitize_and_compress_wallpaper(roh)
    except wallpaper_service.WallpaperValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message)
    zeile = wallpaper_service.store_wallpaper(db, server.game_type, webp, user.username)
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="server.wallpaper.upload",
        target_type="server",
        target_id=server_id,
        details={"game_type": server.game_type, "wallpaper_id": zeile.id},
        commit=True,
    )
    return {"id": zeile.id, "game_type": zeile.game_type, "is_active": True}


@router.delete("/{server_id}/wallpaper")
def reset_server_wallpaper(
    server_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user), _: None = Depends(verify_csrf)
) -> dict:
    """Setzt aufs Standardbild zurueck (Custom-Zeiger aufheben, Galerie bleibt)."""
    require_server_permission(user, server_id, db, "server.wallpaper.manage")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    wallpaper_service.reset_wallpaper(db, server.game_type)
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="server.wallpaper.reset",
        target_type="server",
        target_id=server_id,
        details={"game_type": server.game_type},
        commit=True,
    )
    return {"reset": True}


@router.get("/{server_id}/wallpaper/gallery", response_model=list[WallpaperGalleryItem])
def get_wallpaper_gallery(
    server_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[WallpaperGalleryItem]:
    """Galerie-Verlauf des Spiels (neueste zuerst)."""
    require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    return [
        WallpaperGalleryItem(
            id=z.id,
            game_type=z.game_type,
            uploaded_by=z.uploaded_by,
            created_at=z.created_at,
            is_active=z.is_active,
        )
        for z in wallpaper_service.get_gallery(db, server.game_type)
    ]


@router.get("/{server_id}/wallpaper/gallery/{wallpaper_id}/image")
def get_wallpaper_gallery_image(
    server_id: int,
    wallpaper_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Einzelbild aus der Galerie (Miniatur im Dialog)."""
    require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    bild = wallpaper_service.gallery_image_bytes(db, server.game_type, wallpaper_id)
    if bild is None:
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    return build_webp_response(data=bild, gallery_thumb=True)


@router.post("/{server_id}/wallpaper/{wallpaper_id}/activate")
def activate_server_wallpaper(
    server_id: int,
    wallpaper_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Reaktiviert ein Galeriebild des Spiels (wird aktiv)."""
    require_server_permission(user, server_id, db, "server.wallpaper.manage")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    zeile = wallpaper_service.set_active_wallpaper(db, server.game_type, wallpaper_id)
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="server.wallpaper.reactivate",
        target_type="server",
        target_id=server_id,
        details={"game_type": server.game_type, "wallpaper_id": zeile.id},
        commit=True,
    )
    return {"id": zeile.id, "game_type": zeile.game_type, "is_active": True}


@router.delete("/{server_id}/wallpaper/gallery/{wallpaper_id}")
def delete_server_wallpaper(
    server_id: int,
    wallpaper_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Loescht ein Galeriebild des Spiels endgueltig (Datei + Zeile)."""
    require_server_permission(user, server_id, db, "server.wallpaper.manage")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    wallpaper_service.delete_wallpaper(db, server.game_type, wallpaper_id)
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="server.wallpaper.delete",
        target_type="server",
        target_id=server_id,
        details={"game_type": server.game_type, "wallpaper_id": wallpaper_id},
        commit=True,
    )
    return {"deleted": True}


@router.get("/{server_id}/variables", response_model=ServerVariablesResponse)
def get_server_variables(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ServerVariablesResponse:
    """Liefert Blueprint-Variablen und aktuelle Overrides (Secrets immer maskiert)."""
    require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    return server_variables_service.get_server_variables(db, server)


@router.put("/{server_id}/variables", response_model=ServerVariablesUpdateResponse)
def update_server_variables(
    server_id: int,
    payload: ServerVariablesUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> ServerVariablesUpdateResponse:
    """Speichert erlaubte Server-Variablen DIS-verschluesselt in ServerRuntimeEnv."""
    require_server_permission(user, server_id, db, "server.config.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    is_operator = (
        permission_service.has_global_permission(db, user, "panel.settings.write")
        or permission_service.has_global_permission(db, user, "blueprints.write")
    )
    try:
        result = server_variables_service.update_server_variables(
            db, server, payload.values, is_operator=is_operator
        )
    except server_variables_service.ServerVariableValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    if result.changed_keys:
        audit_service.record_privileged_action(
            db,
            user_id=user.id,
            action="server.variables.updated",
            target_type="server",
            target_id=server_id,
            details={"changed_keys": result.changed_keys},
            commit=True,
        )
    return result
