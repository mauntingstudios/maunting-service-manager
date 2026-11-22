"""Multi-Node-Platzierung und Pre-Checkout-Kapazitaetspruefung fuer Shop & Hoster."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from config import settings
from models import Node, ShopPlan
from services.node_capacity import (
    allocatable_cpu_percent,
    allocatable_disk_gb,
    normalize_cpu_limit_percent,
    normalize_ram_mb,
    ram_headroom_mb,
    sum_allocated_cpu_percent,
    sum_allocated_disk_gb,
    sum_allocated_ram_mb,
)

OFFLINE_NODE_STATUSES = frozenset(
    {"offline", "error", "unreachable", "maintenance", "draining"}
)


@dataclass(frozen=True)
class NodeCapacityCheck:
    node: Node
    fits: bool
    reason: str | None
    remaining_ram_mb: int | None
    remaining_cpu_percent: int | None
    remaining_disk_gb: int | None
    headroom_score: float


@dataclass(frozen=True)
class PlanAvailability:
    available: bool
    reason: str | None
    available_nodes: int
    max_ram_mb: int | None
    max_cpu: int | None


def _reserved_ram_mb() -> int:
    return max(
        ram_headroom_mb(),
        int(getattr(settings, "host_reserved_ram_mb", 0) or 0),
    )


def evaluate_node_capacity(
    db: Session,
    node: Node,
    *,
    ram_mb: int | None = None,
    cpu_percent: int | None = None,
    disk_gb: int | None = None,
    cpu_overcommit_factor: float = 1.0,
) -> NodeCapacityCheck:
    status = (node.status or "").strip().lower()
    if status in OFFLINE_NODE_STATUSES:
        return NodeCapacityCheck(
            node=node,
            fits=False,
            reason="node_offline",
            remaining_ram_mb=0,
            remaining_cpu_percent=0,
            remaining_disk_gb=0,
            headroom_score=0.0,
        )

    ratios: list[float] = []

    remaining_ram: int | None = None
    total_ram = normalize_ram_mb(node.ram_total)
    if total_ram is not None:
        max_allocatable_ram = max(0, total_ram - _reserved_ram_mb())
        used_ram = sum_allocated_ram_mb(db, node.id)
        remaining_ram = max(0, max_allocatable_ram - max(0, used_ram))
        if max_allocatable_ram > 0:
            ratios.append(remaining_ram / max_allocatable_ram)
        else:
            ratios.append(0.0)

    remaining_cpu: int | None = None
    if node.cpu_total is not None and float(node.cpu_total) > 0:
        used_cpu = sum_allocated_cpu_percent(db, node.id)
        remaining_cpu = allocatable_cpu_percent(
            node, used_cpu, overcommit_factor=cpu_overcommit_factor
        )
        cpu_budget = max(
            1, int(round(float(node.cpu_total) * 100.0 * max(0.1, cpu_overcommit_factor)))
        )
        if remaining_cpu is not None:
            ratios.append(remaining_cpu / cpu_budget)

    remaining_disk: int | None = None
    if node.disk_total is not None:
        used_disk = sum_allocated_disk_gb(db, node.id)
        remaining_disk = allocatable_disk_gb(node, used_disk)
        try:
            total_disk_gb = max(0, int(node.disk_total) // 1024)
        except (TypeError, ValueError):
            total_disk_gb = 0
        if remaining_disk is not None and total_disk_gb > 0:
            ratios.append(remaining_disk / total_disk_gb)

    reason: str | None = None
    fits = True
    if ram_mb is not None and int(ram_mb) > 0 and remaining_ram is not None and int(ram_mb) > remaining_ram:
        fits = False
        reason = "insufficient_node_ram"
    elif (
        cpu_percent is not None
        and int(cpu_percent) > 0
        and remaining_cpu is not None
        and int(cpu_percent) > remaining_cpu
    ):
        fits = False
        reason = "insufficient_node_cpu"
    elif disk_gb is not None and int(disk_gb) > 0 and remaining_disk is not None and int(disk_gb) > remaining_disk:
        fits = False
        reason = "insufficient_node_disk"

    headroom_score = (sum(ratios) / len(ratios)) if ratios else 0.5
    return NodeCapacityCheck(
        node=node,
        fits=fits,
        reason=reason,
        remaining_ram_mb=remaining_ram,
        remaining_cpu_percent=remaining_cpu,
        remaining_disk_gb=remaining_disk,
        headroom_score=headroom_score,
    )


def find_candidate_nodes(
    db: Session,
    *,
    ram_mb: int | None = None,
    cpu_percent: int | None = None,
    disk_gb: int | None = None,
    preferred_node_id: int | None = None,
    cpu_overcommit_factor: float = 1.0,
) -> tuple[list[Node], str | None]:
    """Liefert passende Nodes in optimaler Platzierungsreihenfolge (Least-Loaded zuerst).

    Rueckgabe: ``(kandidaten, fehlercode)``.
    Sind noch gar keine Nodes in der Datenbank registriert und keine Node gepinnt,
    liefert die Funktion ``([], None)`` als Signal fuer den Single-Host-Fallback.
    """
    if preferred_node_id is not None:
        node = db.query(Node).filter(Node.id == preferred_node_id).first()
        if node is None:
            return [], "node_not_found"
        check = evaluate_node_capacity(
            db,
            node,
            ram_mb=ram_mb,
            cpu_percent=cpu_percent,
            disk_gb=disk_gb,
            cpu_overcommit_factor=cpu_overcommit_factor,
        )
        return ([node], None) if check.fits else ([], check.reason or "no_node_capacity")

    nodes = db.query(Node).order_by(Node.id.asc()).all()
    if not nodes:
        return [], None

    checks = [
        evaluate_node_capacity(
            db,
            n,
            ram_mb=ram_mb,
            cpu_percent=cpu_percent,
            disk_gb=disk_gb,
            cpu_overcommit_factor=cpu_overcommit_factor,
        )
        for n in nodes
    ]
    fitting = [c for c in checks if c.fits]
    if fitting:
        fitting.sort(
            key=lambda c: (
                c.headroom_score,
                c.remaining_ram_mb if c.remaining_ram_mb is not None else 1_000_000_000,
                c.remaining_cpu_percent if c.remaining_cpu_percent is not None else 1_000_000,
                -c.node.id,
            ),
            reverse=True,
        )
        return [c.node for c in fitting], None

    # Aussagekraeftigster Engpassgrund (Ressourcenengpass vor Offline).
    priorities = ("insufficient_node_cpu", "insufficient_node_ram", "insufficient_node_disk", "node_offline")
    reasons = [c.reason for c in checks if c.reason]
    dominant = next((p for p in priorities if p in reasons), None)
    return [], dominant or "no_node_capacity"


def check_plan_availability(
    db: Session,
    plan: ShopPlan,
    *,
    ram_mb: int | None = None,
    cpu_cores: int | None = None,
    disk_gb: int | None = None,
) -> PlanAvailability:
    eff_ram = ram_mb if ram_mb is not None else plan.ram_included_mb
    eff_cpu_cores = cpu_cores if cpu_cores is not None else plan.cpu_included
    cpu_percent = normalize_cpu_limit_percent(
        int(eff_cpu_cores) if eff_cpu_cores is not None else None
    )

    if plan.node_id is None:
        nodes = db.query(Node).order_by(Node.id.asc()).all()
        if not nodes:
            return PlanAvailability(
                available=True,
                reason=None,
                available_nodes=0,
                max_ram_mb=plan.ram_max_mb,
                max_cpu=plan.cpu_max,
            )
    else:
        pinned = db.query(Node).filter(Node.id == plan.node_id).first()
        if pinned is None:
            return PlanAvailability(
                available=False,
                reason="node_not_found",
                available_nodes=0,
                max_ram_mb=0,
                max_cpu=0,
            )
        nodes = [pinned]

    checks = [
        evaluate_node_capacity(
            db,
            node,
            ram_mb=eff_ram,
            cpu_percent=cpu_percent,
            disk_gb=disk_gb,
        )
        for node in nodes
    ]
    fitting = [c for c in checks if c.fits]

    online_checks = [c for c in checks if c.reason != "node_offline"]
    ram_caps = [c.remaining_ram_mb for c in online_checks if c.remaining_ram_mb is not None]
    uses_percent_unit = (
        (plan.cpu_included is not None and int(plan.cpu_included) > 32)
        or (plan.cpu_max is not None and int(plan.cpu_max) > 32)
    )
    cpu_caps = [
        (c.remaining_cpu_percent if uses_percent_unit else c.remaining_cpu_percent // 100)
        for c in online_checks
        if c.remaining_cpu_percent is not None
    ]

    max_ram: int | None = max(ram_caps) if ram_caps else None
    if max_ram is not None and plan.ram_max_mb is not None:
        max_ram = min(max_ram, plan.ram_max_mb)
    max_cpu: int | None = max(cpu_caps) if cpu_caps else None
    if max_cpu is not None and plan.cpu_max is not None:
        max_cpu = min(max_cpu, plan.cpu_max)

    if fitting:
        return PlanAvailability(
            available=True,
            reason=None,
            available_nodes=len(fitting),
            max_ram_mb=max_ram,
            max_cpu=max_cpu,
        )

    priorities = ("insufficient_node_cpu", "insufficient_node_ram", "insufficient_node_disk", "node_offline")
    reasons = [c.reason for c in checks if c.reason]
    dominant = next((p for p in priorities if p in reasons), "no_node_capacity")
    return PlanAvailability(
        available=False,
        reason=dominant,
        available_nodes=0,
        max_ram_mb=max_ram,
        max_cpu=max_cpu,
    )
