"""Transaktionale Patch-Logik für Server-Updates (`PATCH /api/servers/{id}`).

Ausgelagert aus ``routers/servers.py``, um Berechtigungsprüfung, Portvergabe,
Live-Ressourcen-Updates, Disk-Soft-Limit-Reevaluation und Post-Commit-Schritte
isoliert und wartbar zu halten. Patchbare Abhängigkeiten werden über
``routers.servers`` bezogen, damit bestehende Test-Mocks unverändert greifen.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import Server, User
from schemas import ServerResponse, ServerUpdate

_PORT_FIELDS = frozenset({"game_port", "query_port", "rcon_port", "ports", "port_protocols"})
_RESOURCE_FIELDS = frozenset({"cpu_limit_percent", "ram_limit_mb", "disk_limit_gb"})
_CONFIG_FIELDS = frozenset({
    "name",
    "auto_restart",
    "restart_interval_hours",
    "restart_time_utc",
    "restart_times_utc",
})
_RESTART_SCHEDULE_FIELDS = frozenset({
    "auto_restart",
    "restart_interval_hours",
    "restart_time_utc",
    "restart_times_utc",
})


@dataclass
class _UpdatePlan:
    """Abgeleitete Feldgruppen und Änderungs-Flags eines Server-PATCH."""

    payload: dict[str, Any]
    old_ports: list[tuple[int, str, str]]
    old_bind_ip: str | None
    changed_ports: set[str]
    network_field_present: bool
    network_change: bool
    guardian_network_changed: bool
    has_resource: bool
    has_config: bool
    cpu_changed: bool
    ram_changed: bool
    disk_changed: bool


def _analyze_update_payload(server: Server, req: ServerUpdate) -> _UpdatePlan:
    old_ports = [(p.port, p.protocol, p.role) for p in server.ports]
    old_bind_ip = server.public_bind_ip

    payload = req.model_dump(exclude_unset=True)
    payload_keys = set(payload.keys())
    changed_ports = set(_PORT_FIELDS) & payload_keys
    bind_ip_present = "public_bind_ip" in payload
    bind_ip_changed = bind_ip_present and payload["public_bind_ip"] != old_bind_ip

    # Presence-basiert für Berechtigungsprüfung und 409 bei gemischten Payloads,
    # wertbasiert für tatsächliches Netzwerk-Recreate nach Commit.
    network_field_present = bool(changed_ports) or bind_ip_present
    network_change = bool(changed_ports) or bind_ip_changed
    has_resource = bool(set(_RESOURCE_FIELDS) & payload_keys)
    has_config = bool(set(_CONFIG_FIELDS) & payload_keys)

    cpu_changed = (
        "cpu_limit_percent" in payload
        and payload["cpu_limit_percent"] != server.cpu_limit_percent
    )
    ram_changed = (
        "ram_limit_mb" in payload
        and payload["ram_limit_mb"] != server.ram_limit_mb
    )
    disk_changed = (
        "disk_limit_gb" in payload
        and payload["disk_limit_gb"] != server.disk_limit_gb
    )

    return _UpdatePlan(
        payload=payload,
        old_ports=old_ports,
        old_bind_ip=old_bind_ip,
        changed_ports=changed_ports,
        network_field_present=network_field_present,
        network_change=network_change,
        guardian_network_changed=bind_ip_changed,
        has_resource=has_resource,
        has_config=has_config,
        cpu_changed=cpu_changed,
        ram_changed=ram_changed,
        disk_changed=disk_changed,
    )


def _verify_update_permissions_and_preconditions(
    db: Session,
    user: User,
    server_id: int,
    server: Server,
    plan: _UpdatePlan,
    srv: Any,
) -> None:
    # Least-privilege: jede Feldgruppe verlangt genau ihr eigenes Recht vor jeder Mutation.
    if plan.has_resource:
        srv.require_server_permission(user, server_id, db, "server.resources.manage")
    if plan.network_field_present:
        srv.require_server_permission(user, server_id, db, "server.network.manage")
    if plan.has_config:
        srv.require_server_permission(user, server_id, db, "server.config.write")

    # Ressourcen- und Netzwerk-Seiteneffekte laufen an verschiedenen Transaktionsgrenzen.
    if plan.has_resource and plan.network_field_present:
        raise HTTPException(
            status_code=409,
            detail="Ressourcen- und Netzwerk-Aenderungen koennen nicht in einem gemeinsamen PATCH durchgefuehrt werden",
        )

    if plan.network_change:
        if server.status == "running" or srv.docker_service.is_running(
            srv.container_name_for(server.id), node=server.node
        ):
            raise HTTPException(
                status_code=409,
                detail="Netzwerkeinstellungen können nur geändert werden, wenn der Server gestoppt ist",
            )
        if srv.is_lifecycle_job_active(server_id):
            raise HTTPException(
                status_code=409,
                detail="Server Lifecycle-Aktion läuft, Netzwerkeinstellungen können nicht geändert werden",
            )

    # RAM-/Disk-Kapazitätsprüfung bei konkretem Zahlenwert (None = unbegrenzt).
    ram_target = plan.payload.get("ram_limit_mb") if plan.ram_changed else None
    disk_target = plan.payload.get("disk_limit_gb") if plan.disk_changed else None
    if ram_target is not None or disk_target is not None:
        from models import Node as NodeModel
        from services.node_capacity import ensure_ram_limit_fits, ensure_strict_capacity_fits

        guard_node = None
        if server.node_id is not None:
            guard_node = (
                db.query(NodeModel)
                .filter(NodeModel.id == server.node_id)
                .with_for_update()
                .first()
            )
        if ram_target is not None:
            ensure_ram_limit_fits(
                db,
                guard_node,
                new_ram_limit_mb=ram_target,
                exclude_server_id=server.id,
            )
        ensure_strict_capacity_fits(
            db,
            guard_node,
            new_ram_limit_mb=ram_target,
            new_disk_limit_gb=disk_target,
            exclude_server_id=server.id,
        )


def _apply_port_changes(
    db: Session,
    server: Server,
    req: ServerUpdate,
    plan: _UpdatePlan,
    srv: Any,
) -> bool:
    if not plan.changed_ports:
        return plan.guardian_network_changed

    port_requirements = srv._port_requirements_for_server(
        server,
        protocol_overrides=req.port_protocols,
    )

    current_ports = {p.role: p.port for p in server.ports}
    requested_ports = dict(req.ports or {})

    if req.game_port is not None:
        requested_ports["game"] = req.game_port
    if req.query_port is not None:
        requested_ports["query"] = req.query_port
    if req.rcon_port is not None:
        requested_ports["rcon"] = req.rcon_port

    for role, _ in port_requirements:
        if role not in requested_ports:
            requested_ports[role] = current_ports.get(role)

    bind_ip_for_check = plan.payload.get("public_bind_ip", plan.old_bind_ip) or "0.0.0.0"
    node = getattr(server, "node", None)
    node_id = getattr(server, "node_id", None)
    check_host = True if (node is None or getattr(node, "is_local", True)) else False
    if node_id is not None:
        from models import Node as NodeModel

        db.query(NodeModel).filter(NodeModel.id == node_id).with_for_update().one()
    try:
        allocated = srv.allocate_ports(
            db,
            exclude_server_id=server.id,
            bind_ip=bind_ip_for_check,
            port_requirements=port_requirements,
            requested_ports=requested_ports,
            node_id=node_id,
            check_host=check_host,
        )
    except srv.PortConflictError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    if (
        isinstance(allocated, tuple)
        and len(allocated) == 3
        and all(isinstance(x, int) for x in allocated)
    ):
        allocated = [
            ("game", allocated[0], "udp"),
            ("query", allocated[1], "udp"),
            ("rcon", allocated[2], "tcp"),
        ]
    srv._assert_remote_ports_available(node, allocated, bind_ip_for_check)

    normalized_old_ports = sorted(
        (int(port), str(protocol).lower(), str(role))
        for port, protocol, role in plan.old_ports
    )
    normalized_new_ports = sorted(
        (int(port_val), str(proto).lower(), str(role))
        for role, port_val, proto in allocated
    )
    guardian_network_changed = (
        plan.guardian_network_changed
        or normalized_new_ports != normalized_old_ports
    )

    from models.server_port import ServerPort

    db.query(ServerPort).filter(ServerPort.server_id == server.id).delete()
    for role, port_val, proto in allocated:
        db.add(ServerPort(server_id=server.id, role=role, port=port_val, protocol=proto))

    return guardian_network_changed


def _apply_live_resource_and_disk_updates(
    db: Session,
    server: Server,
    server_id: int,
    plan: _UpdatePlan,
    srv: Any,
) -> None:
    resource_live_change = (plan.cpu_changed or plan.ram_changed) and not plan.network_change
    disk_eval_needed = plan.disk_changed
    needs_lock = resource_live_change or (disk_eval_needed and server.status == "running")

    def _apply_disk_quota_and_soft_limit() -> None:
        from services.node_capacity import sync_node_disk_quota

        try:
            sync_node_disk_quota(
                server.node,
                server.id,
                server.disk_limit_gb,
                enforce=True,
                install_dir=server.install_dir,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail="Disk-Quota konnte auf dem Node nicht angewendet werden",
            ) from exc
        disk_result = srv.evaluate_disk_soft_limit(db, server)
        if not disk_result.get("ok"):
            raise HTTPException(
                status_code=503,
                detail="Disk-Limit konnte nicht neu bewertet werden",
            )

    if needs_lock:
        container_name = srv.container_name_for(server.id)
        if srv.is_lifecycle_job_active(server_id):
            raise HTTPException(
                status_code=409,
                detail="Server Lifecycle-Aktion laeuft, Ressourcen-Update nicht moeglich",
            )
        lock = srv.get_server_lifecycle_lock(server_id)
        if not lock.acquire(timeout=5):
            raise HTTPException(
                status_code=409,
                detail="Server Lifecycle-Aktion laeuft, Ressourcen-Update nicht moeglich",
            )
        try:
            if srv.is_lifecycle_job_active(server_id):
                raise HTTPException(
                    status_code=409,
                    detail="Server Lifecycle-Aktion laeuft, Ressourcen-Update nicht moeglich",
                )
            if resource_live_change:
                docker_running = srv.docker_service.is_running(container_name, node=server.node)
                if server.status == "running" and not docker_running:
                    raise HTTPException(
                        status_code=409,
                        detail="Server-Status nicht konsistent, Ressourcen-Update abgebrochen",
                    )
                if server.status != "running" and docker_running:
                    raise HTTPException(
                        status_code=409,
                        detail="Server-Status nicht konsistent, Ressourcen-Update abgebrochen",
                    )
                if docker_running:
                    docker_updates: dict[str, int | None] = {}
                    if plan.cpu_changed:
                        docker_updates["cpu_limit_percent"] = server.cpu_limit_percent
                    if plan.ram_changed:
                        docker_updates["ram_limit_mb"] = server.ram_limit_mb
                    result = srv.docker_service.update_container_resources(
                        container_name,
                        docker_updates,
                        node=server.node,
                    )
                    if not result.get("ok"):
                        if result.get("drift"):
                            raise HTTPException(
                                status_code=503,
                                detail=(
                                    "Ressourcen-Update fehlgeschlagen, "
                                    "manuelle Pruefung erforderlich"
                                ),
                            )
                        raise HTTPException(
                            status_code=503,
                            detail="Ressourcen-Update konnte nicht angewendet werden",
                        )
            if disk_eval_needed:
                _apply_disk_quota_and_soft_limit()
        finally:
            lock.release()
    elif disk_eval_needed:
        _apply_disk_quota_and_soft_limit()


def execute_server_update(
    server_id: int,
    req: ServerUpdate,
    db: Session,
    user: User,
) -> ServerResponse:
    """Führt ein transaktionales Server-Update inkl. Live- und Netzwerk-Seiteneffekten aus."""
    import routers.servers as _srv

    _srv.require_server_permission(user, server_id, db, "server.view")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    plan = _analyze_update_payload(server, req)
    _verify_update_permissions_and_preconditions(db, user, server_id, server, plan, _srv)

    guardian_network_changed = plan.guardian_network_changed
    try:
        guardian_network_changed = _apply_port_changes(db, server, req, plan, _srv)

        for key, val in plan.payload.items():
            if key not in _PORT_FIELDS:
                setattr(server, key, val)
        _srv._normalize_server_restart_mode(server)

        if _RESTART_SCHEDULE_FIELDS & set(plan.payload.keys()):
            from services.ai_task_service import ki_zeitplan_verwaltung_aufheben

            ki_zeitplan_verwaltung_aufheben(db, server, bereich="restart")

        _apply_live_resource_and_disk_updates(db, server, server_id, plan, _srv)

        if _RESTART_SCHEDULE_FIELDS & set(plan.payload.keys()):
            _srv.sync_server_restart_schedule(server)

        if guardian_network_changed:
            from services.guardian_state_service import mark_guardian_configuration_changed

            mark_guardian_configuration_changed(server)

        if plan.changed_ports:
            _srv.AchievementService.melde(db, user.id, "server_port_forwarder")
        if plan.payload.get("auto_restart"):
            _srv.AchievementService.melde(db, user.id, "server_auto_restart")

        db.commit()
        db.refresh(server)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        _srv.logger.warning(
            "Server-Aktualisierung fehlgeschlagen (server_id=%s): %s",
            server_id,
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail="Server-Aktualisierung fehlgeschlagen")

    if plan.network_change:
        from services.server_network_service import recreate_server_network

        recreate_server_network(server, plan.old_ports, plan.old_bind_ip)

    if guardian_network_changed:
        from services.server_lifecycle_service import sync_desired_state_to_agent

        sync_desired_state_to_agent(db, server)

    data = _srv._server_response(server)
    data.is_hoster_managed = _srv.permission_service.is_hoster_customer_server(db, server_id)
    return data
