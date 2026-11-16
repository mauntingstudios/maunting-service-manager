"""Node RAM capacity accounting (booked limits vs host total).

KISS: pure functions + SQL SUM. No manager classes, no agent round-trips.
CPU overcommit is intentional and not guarded here.
"""

from __future__ import annotations

import os

from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from models import Node, Server

# Reserved for OS / agent / docker when checking allocatable RAM.
# Overridable via MSM_NODE_RAM_HEADROOM_MB.
DEFAULT_RAM_HEADROOM_MB = 1024


def ram_headroom_mb() -> int:
    raw = getattr(settings, "node_ram_headroom_mb", DEFAULT_RAM_HEADROOM_MB)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_RAM_HEADROOM_MB
    return max(0, value)


def sum_allocated_ram_mb(
    db: Session,
    node_id: int,
    *,
    exclude_server_id: int | None = None,
) -> int:
    """Sum of non-null server.ram_limit_mb on the node (booked RAM)."""
    query = db.query(func.coalesce(func.sum(Server.ram_limit_mb), 0)).filter(
        Server.node_id == node_id,
        Server.ram_limit_mb.isnot(None),
    )
    if exclude_server_id is not None:
        query = query.filter(Server.id != exclude_server_id)
    total = query.scalar()
    try:
        return int(total or 0)
    except (TypeError, ValueError):
        return 0


def allocated_ram_by_node_ids(db: Session, node_ids: list[int]) -> dict[int, int]:
    """Batch SUM(ram_limit_mb) grouped by node_id."""
    if not node_ids:
        return {}
    rows = (
        db.query(Server.node_id, func.coalesce(func.sum(Server.ram_limit_mb), 0))
        .filter(
            Server.node_id.in_(node_ids),
            Server.ram_limit_mb.isnot(None),
        )
        .group_by(Server.node_id)
        .all()
    )
    out: dict[int, int] = {nid: 0 for nid in node_ids}
    for node_id, total in rows:
        if node_id is None:
            continue
        try:
            out[int(node_id)] = int(total or 0)
        except (TypeError, ValueError):
            out[int(node_id)] = 0
    return out


def normalize_ram_mb(val: int | float | None) -> int | None:
    """Normalizes RAM values to Megabytes (handles both MB and raw bytes)."""
    if val is None:
        return None
    try:
        v = int(val)
    except (TypeError, ValueError):
        return None
    if v > 100_000_000:
        return v // (1024 * 1024)
    return v


def allocatable_ram_mb(node: Node, allocated_mb: int) -> int | None:
    """Remaining bookable RAM after headroom, or None if host total unknown."""
    if node.ram_total is None:
        return None
    total = normalize_ram_mb(node.ram_total)
    if total is None:
        return None
    budget = max(0, total - ram_headroom_mb())
    return max(0, budget - max(0, int(allocated_mb)))


def ensure_ram_limit_fits(
    db: Session,
    node: Node | None,
    *,
    new_ram_limit_mb: int | None,
    exclude_server_id: int | None = None,
) -> None:
    """RAM overcommit is allowed by default. Soft accounting check.

    Skip blocking so users can assign RAM limits even if total booked limits
    exceed host capacity (overcommit is handled via UI warning modal).
    """
    return


# ── Disk capacity accounting ───────────────────────────────────────────────


def sum_allocated_disk_gb(
    db: Session,
    node_id: int,
    *,
    exclude_server_id: int | None = None,
) -> int:
    """Sum of non-null server.disk_limit_gb on the node (booked disk limit in GB)."""
    query = db.query(func.coalesce(func.sum(Server.disk_limit_gb), 0)).filter(
        Server.node_id == node_id,
        Server.disk_limit_gb.isnot(None),
    )
    if exclude_server_id is not None:
        query = query.filter(Server.id != exclude_server_id)
    total = query.scalar()
    try:
        return int(total or 0)
    except (TypeError, ValueError):
        return 0


def allocated_disk_by_node_ids(db: Session, node_ids: list[int]) -> dict[int, int]:
    """Batch SUM(disk_limit_gb) grouped by node_id."""
    if not node_ids:
        return {}
    rows = (
        db.query(Server.node_id, func.coalesce(func.sum(Server.disk_limit_gb), 0))
        .filter(
            Server.node_id.in_(node_ids),
            Server.disk_limit_gb.isnot(None),
        )
        .group_by(Server.node_id)
        .all()
    )
    out: dict[int, int] = {nid: 0 for nid in node_ids}
    for node_id, total in rows:
        if node_id is None:
            continue
        try:
            out[int(node_id)] = int(total or 0)
        except (TypeError, ValueError):
            out[int(node_id)] = 0
    return out


def sum_panel_disk_used_mb(db: Session, node_id: int) -> int:
    """Sum of server.disk_usage_mb on the node (actual storage used by panel servers + DBs)."""
    total = (
        db.query(func.coalesce(func.sum(Server.disk_usage_mb), 0))
        .filter(
            Server.node_id == node_id,
            Server.disk_usage_mb.isnot(None),
        )
        .scalar()
    )
    try:
        return int(total or 0)
    except (TypeError, ValueError):
        return 0


def panel_disk_used_by_node_ids(db: Session, node_ids: list[int]) -> dict[int, int]:
    """Batch SUM(disk_usage_mb) grouped by node_id."""
    if not node_ids:
        return {}
    rows = (
        db.query(Server.node_id, func.coalesce(func.sum(Server.disk_usage_mb), 0))
        .filter(
            Server.node_id.in_(node_ids),
            Server.disk_usage_mb.isnot(None),
        )
        .group_by(Server.node_id)
        .all()
    )
    out: dict[int, int] = {nid: 0 for nid in node_ids}
    for node_id, total in rows:
        if node_id is None:
            continue
        try:
            out[int(node_id)] = int(total or 0)
        except (TypeError, ValueError):
            out[int(node_id)] = 0
    return out


def allocatable_disk_gb(node: Node, allocated_gb: int) -> int | None:
    """Remaining bookable disk limit (in GB), or None if host total unknown."""
    if node.disk_total is None:
        return None
    try:
        total_gb = int(node.disk_total) // 1024
    except (TypeError, ValueError):
        return None
    return max(0, total_gb - max(0, int(allocated_gb)))




# Status, in denen ein Server tatsaechlich Arbeitsspeicher belegt.
#
# Der Unterschied ist der Kern einer wiederkehrenden Fehlauskunft: `ram_limit_mb`
# ist eine *Buchung*, keine Messung. Vier gestoppte Server zu je 8 GB buchen
# 32 GB und belegen null. Wer nur die Buchung sieht, meldet "kein RAM frei",
# obwohl die Node leer laeuft — genau das ist im Betrieb passiert.
#
# `starting` und `restarting` zaehlen mit: dort laeuft der Container bereits.
RAM_CONSUMING_STATUSES = frozenset({"running", "starting", "restarting"})


def sum_running_ram_mb(db: Session, node_id: int) -> int:
    """Gebuchter Arbeitsspeicher der Server, die gerade wirklich laufen."""
    total = (
        db.query(func.coalesce(func.sum(Server.ram_limit_mb), 0))
        .filter(
            Server.node_id == node_id,
            Server.ram_limit_mb.isnot(None),
            Server.status.in_(tuple(RAM_CONSUMING_STATUSES)),
        )
        .scalar()
    )
    try:
        return int(total or 0)
    except (TypeError, ValueError):
        return 0


def ensure_strict_capacity_fits(
    db: Session,
    node: Node | None,
    *,
    new_ram_limit_mb: int | None = None,
    new_disk_limit_gb: int | None = None,
    exclude_server_id: int | None = None,
) -> None:
    """Enforce hard node RAM & disk ceilings when strict capacity guard is enabled."""
    if not bool(getattr(settings, "strict_resource_capacity_guard", False)) or node is None:
        return

    from fastapi import HTTPException

    if new_ram_limit_mb is not None and node.ram_total is not None:
        try:
            total_ram = int(node.ram_total)
        except (TypeError, ValueError):
            total_ram = 0
        reserved = max(ram_headroom_mb(), int(getattr(settings, "host_reserved_ram_mb", 0) or 0))
        used_ram = sum_allocated_ram_mb(db, node.id, exclude_server_id=exclude_server_id)
        max_allocatable_ram = max(0, total_ram - reserved)
        if used_ram + int(new_ram_limit_mb) > max_allocatable_ram:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "insufficient_node_ram",
                    "message": "errors.insufficient_node_ram",
                },
            )

    if new_disk_limit_gb is not None and node.disk_total is not None:
        used_disk = sum_allocated_disk_gb(db, node.id, exclude_server_id=exclude_server_id)
        remaining_disk = allocatable_disk_gb(node, used_disk)
        if remaining_disk is not None and int(new_disk_limit_gb) > remaining_disk:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "insufficient_node_disk",
                    "message": "errors.insufficient_node_disk",
                },
            )


def should_delegate_node_fs_to_agent(node: Node | None) -> bool:
    """Return True when server root & disk quota operations must go through msm-agent."""
    if node is None:
        return False
    if not getattr(node, "is_local", False):
        return True
    return bool(getattr(settings, "local_agent_required", False))


def agent_server_key(server_id: int | str, install_dir: str | None = None) -> str:
    """Resolve the directory key under the agent's servers root for a server."""
    install = (install_dir or "").strip()
    if install:
        base = os.path.basename(os.path.normpath(install))
        if (
            base
            and base not in {".", ".."}
            and "/" not in base
            and "\\" not in base
            and ".." not in base
        ):
            return base
    return str(server_id)


def sync_node_disk_quota(
    node: Node | None,
    server_id: int,
    disk_limit_gb: int | None,
    *,
    enforce: bool = False,
    install_dir: str | None = None,
) -> None:
    """Apply or remove physical OS quota on the node agent when agent-delegated."""
    if not should_delegate_node_fs_to_agent(node):
        return
    try:
        from services.node_client import NodeClient

        target_key: int | str = agent_server_key(server_id, install_dir) if install_dir else server_id
        client = NodeClient.from_node(node)
        if disk_limit_gb is not None and int(disk_limit_gb) >= 1:
            client.files_apply_quota(target_key, int(disk_limit_gb))
        else:
            client.files_remove_quota(target_key)
    except Exception:
        if enforce:
            raise


def remove_node_disk_quota(
    node: Node | None,
    server_id: int,
    *,
    install_dir: str | None = None,
) -> None:
    """Best-effort cleanup of OS disk quota during server teardown or rollback."""
    if not should_delegate_node_fs_to_agent(node):
        return
    try:
        from services.node_client import NodeClient

        target_key: int | str = agent_server_key(server_id, install_dir) if install_dir else server_id
        NodeClient.from_node(node).files_remove_quota(target_key)
    except Exception:
        pass
