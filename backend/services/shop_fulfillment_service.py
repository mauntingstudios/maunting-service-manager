"""Umsetzung von Shop-Entitlements in echte Server und globale Rollen.

Zahlung und Provisionierung bleiben getrennt: erst nach dem Commit von
Zahlung, Abo und Entitlements erzeugt dieser Dienst den Server ueber den
zentralen Provisionierungspfad (`server_provisioning_service.provision_server`)
und gleicht globale Produktrollen additiv sowie eskalationsgeschuetzt ab.
"""

from __future__ import annotations

import inspect
import logging
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import (
    HosterIdentity,
    HosterProduct,
    HosterService,
    OperationTask,
    Role,
    ShopAddon,
    ShopEntitlement,
    ShopOrder,
    ShopOrderItem,
    ShopPlan,
    User,
)
from schemas import ServerCreate
from services import audit_service, permission_service, role_service
from services.actor_context import ActorContext, ActorOrigin
from services.node_capacity import normalize_cpu_limit_percent
from services.hoster_service_lifecycle import (
    CUSTOMER_SERVER_PERMISSIONS,
    _borne_role,
)
from services.operation_task_service import (
    TASK_SERVER_PROVISION,
    _hash_idempotency_key,
)


logger = logging.getLogger(__name__)

# Produktrollen im Shop duerfen ausschliesslich Kunden- und Kontingentrechte
# tragen. Admin-, Panel-, System-, Node- oder globale Serverrechte bleiben
# gesperrt, damit ein gekaufter Tarif niemals Privilegien eskaliert.
SHOP_ALLOWED_ROLE_PERMISSIONS: frozenset[str] = frozenset(
    {
        "teams.create",
        "calendar.use",
        "notes.use",
        "docs.use",
        "ai.chat.use",
        "ai.attachments.use",
        "ai.memory.use",
        "ai.skills.use",
        "ai.web_search.use",
        "ai.satellite.use",
        "ai.autonomous.use",
        "ai.tasks.manage",
        "ai.background.use",
        "ai.voice.use",
        "ai.desktop.use",
        "ai.desktop.install",
        "ai.mailbox.use",
        "ai.calendar.use",
        "ai.notes.use",
        "ai.coding.use",
        "ai.projects.manage",
        "ai.projects.preview",
        "ai.mcp.manage",
        "ai.docs.use",
    }
)


class ShopRoleEscalationError(ValueError):
    """Eine Produktrolle traegt System- oder nicht erlaubte Panelrechte."""


def ensure_shop_role_allowed(db: Session, role_id: int | None) -> Role | None:
    """Prueft, ob eine Rolle sicher ueber den Shop vergeben werden darf."""
    if role_id is None:
        return None
    role = role_service.get_role(db, role_id)
    if role is None:
        raise ShopRoleEscalationError("Zugeordnete Rolle existiert nicht")
    if role.is_system:
        raise ShopRoleEscalationError(
            "Systemrollen duerfen nicht als Shop-Produktrolle vergeben werden"
        )
    keys = set(role_service.role_permission_keys(db, role.id))
    if not (keys <= SHOP_ALLOWED_ROLE_PERMISSIONS):
        raise ShopRoleEscalationError(
            "Rolle enthaelt Berechtigungen ausserhalb der Shop-Freigabe"
        )
    return role


def _active_owner(db: Session) -> User | None:
    return (
        db.query(User)
        .filter(User.is_owner.is_(True), User.is_active.is_(True))
        .order_by(User.id.asc())
        .first()
    )


def _shop_actor(
    db: Session, *, origin: ActorOrigin, correlation_id: str
) -> ActorContext:
    owner = _active_owner(db)
    if owner is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "shop_no_operator",
                "message": "errors.shop_no_operator",
            },
        )
    return ActorContext.for_user(
        owner, origin=origin, correlation_id=correlation_id
    )


def _error_code(exc: Exception) -> str:
    if isinstance(exc, HTTPException) and isinstance(exc.detail, dict):
        code = exc.detail.get("code")
        if isinstance(code, str) and code:
            return code[:64]
    if isinstance(exc, HTTPException):
        return f"http_{exc.status_code}"
    return "shop_provisioning_failed"


def _provisioning_keys(
    db: Session, *, actor_user_id: int, entitlement_id: int
) -> tuple[str, str | None]:
    """Ermittelt Idempotenzschluessel und optionalen Retry-Vorgaenger."""
    base_key = f"shop-entitlement-{entitlement_id}"
    latest = (
        db.query(OperationTask)
        .filter(
            OperationTask.actor_user_id == actor_user_id,
            OperationTask.task_type == TASK_SERVER_PROVISION,
            OperationTask.idempotency_key_hash.isnot(None),
        )
        .order_by(OperationTask.created_at.desc())
    )
    # Erst pruefen, ob bereits eine Aufgabe fuer den Basisschluessel existiert.
    base_hash = _hash_idempotency_key(base_key)
    base_task = latest.filter(
        OperationTask.idempotency_key_hash == base_hash
    ).first()
    if base_task is None or base_task.status != "failed":
        return base_key, None

    # Fuer Wiederholungsversuche den letzten fehlgeschlagenen Versuch verketten,
    # falls bereits ein frueherer Retry gescheitert ist.
    vorher = base_task
    while True:
        naechster_key = f"{base_key}-retry-{vorher.attempt + 1}"
        naechster_hash = _hash_idempotency_key(naechster_key)
        gefunden = (
            db.query(OperationTask)
            .filter(
                OperationTask.actor_user_id == actor_user_id,
                OperationTask.task_type == TASK_SERVER_PROVISION,
                OperationTask.idempotency_key_hash == naechster_hash,
            )
            .first()
        )
        if gefunden is None:
            return naechster_key, vorher.id
        if gefunden.status != "failed":
            return naechster_key, None
        vorher = gefunden


def _sync_customer_roles(
    db: Session,
    user_id: int,
    *,
    actor_user_id: int | None,
    correlation_id: str,
    origin: ActorOrigin,
) -> None:
    """Gleicht globale Shop-Produktrollen des Kunden additiv und geschuetzt ab."""
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        return

    # Ohne Autoflush wuerden frisch gesetzte Statuswechsel noch nicht sichtbar sein.
    db.flush()
    db.query(User.id).filter(User.id == user.id).with_for_update().one()

    audit_user_id = actor_user_id if actor_user_id is not None else user.id
    role_entitlements = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.user_id == user.id,
            ShopEntitlement.kind.in_(("role", "addon")),
        )
        .order_by(ShopEntitlement.id.asc())
        .all()
    )

    soll: set[int] = set()
    kandidaten: set[int] = set()

    # Koexistenz mit der Hoster-API: laufende Vertraege behalten ihre Rollen.
    hoster_rows = (
        db.query(HosterService, HosterProduct, ShopAddon)
        .select_from(HosterService)
        .join(HosterIdentity, HosterIdentity.id == HosterService.identity_id)
        .outerjoin(HosterProduct, HosterProduct.id == HosterService.product_id)
        .outerjoin(ShopAddon, ShopAddon.id == HosterService.addon_id)
        .filter(HosterIdentity.user_id == user.id)
        .all()
    )
    for hoster_service, hoster_product, hoster_addon in hoster_rows:
        getragen = _borne_role(hoster_service, hoster_product, hoster_addon)
        if getragen is not None:
            soll.add(getragen)

    for ent in role_entitlements:
        if ent.status == "active":
            if ent.role_id is None:
                if ent.granted_role_id is not None:
                    kandidaten.add(ent.granted_role_id)
                    ent.granted_role_id = None
                if ent.kind == "addon":
                    ent.provisioning_status = "ready"
                    ent.provisioning_error = None
                else:
                    ent.provisioning_status = "failed"
                    ent.provisioning_error = "shop_role_missing"
                continue
            try:
                ensure_shop_role_allowed(db, ent.role_id)
            except ShopRoleEscalationError:
                if ent.granted_role_id is not None:
                    kandidaten.add(ent.granted_role_id)
                    ent.granted_role_id = None
                ent.provisioning_status = "failed"
                ent.provisioning_error = "shop_role_escalation"
                audit_service.record_privileged_action(
                    db,
                    user_id=audit_user_id,
                    action="shop.entitlement.failed",
                    target_type="shop_entitlement",
                    target_id=ent.id,
                    details={
                        "order_id": ent.order_id,
                        "kind": ent.kind,
                        "error_code": "shop_role_escalation",
                    },
                    origin=origin,
                    correlation_id=correlation_id,
                )
            else:
                soll.add(ent.role_id)
                if ent.granted_role_id is not None and ent.granted_role_id != ent.role_id:
                    kandidaten.add(ent.granted_role_id)
                ent.granted_role_id = ent.role_id
                ent.provisioning_status = "ready"
                ent.provisioning_error = None
        else:
            if ent.granted_role_id is not None:
                kandidaten.add(ent.granted_role_id)
                ent.granted_role_id = None
            ent.provisioning_status = ent.status
            ent.provisioning_error = None

    kandidaten |= soll
    aktuell = set(role_service.effective_user_role_ids(db, user))
    ueberzaehlig = kandidaten - soll
    entziehbar: set[int] = set()
    if ueberzaehlig:
        entziehbar = {
            row[0]
            for row in db.query(Role.id)
            .filter(Role.id.in_(ueberzaehlig), Role.is_system.is_(False))
            .all()
        }
    ziel = (aktuell | soll) - entziehbar
    if ziel != aktuell:
        role_service.set_user_roles(db, user, sorted(ziel), commit=False)
        audit_service.record_privileged_action(
            db,
            user_id=audit_user_id,
            action="shop.role.synced",
            target_type="user",
            target_id=user.id,
            details={
                "added": sorted(ziel - aktuell),
                "removed": sorted(aktuell - ziel),
            },
            origin=origin,
            correlation_id=correlation_id,
        )


def _mark_server_failed(
    db: Session,
    *,
    entitlement_id: int,
    actor_user_id: int | None,
    code: str,
    origin: ActorOrigin,
    correlation_id: str,
) -> None:
    try:
        ent = (
            db.query(ShopEntitlement)
            .filter(ShopEntitlement.id == entitlement_id)
            .first()
        )
        if ent is None:
            return
        ent.provisioning_status = "failed"
        ent.provisioning_error = code[:64]
        audit_service.record_privileged_action(
            db,
            user_id=actor_user_id if actor_user_id is not None else ent.user_id,
            action="shop.entitlement.failed",
            target_type="shop_entitlement",
            target_id=ent.id,
            details={
                "order_id": ent.order_id,
                "kind": ent.kind,
                "error_code": code[:64],
            },
            origin=origin,
            correlation_id=correlation_id,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning(
            "Fehlerstatus des Shop-Entitlements konnte nicht gespeichert werden (entitlement_id=%s)",
            entitlement_id,
        )


def _sync_server_entitlement(
    db: Session,
    ent: ShopEntitlement,
    *,
    origin: ActorOrigin,
    correlation_id: str,
) -> None:
    from services import server_action_service, server_provisioning_service

    ent_id = ent.id
    owner = _active_owner(db)
    actor_user_id = owner.id if owner is not None else None

    if ent.status == "active":
        if ent.server_id is None:
            order = (
                db.query(ShopOrder)
                .filter(ShopOrder.id == ent.order_id)
                .first()
            )
            item = (
                db.query(ShopOrderItem)
                .filter(ShopOrderItem.id == ent.order_item_id)
                .first()
            )
            if order is None or item is None:
                _mark_server_failed(
                    db,
                    entitlement_id=ent_id,
                    actor_user_id=actor_user_id,
                    code="shop_order_item_missing",
                    origin=origin,
                    correlation_id=correlation_id,
                )
                return

            plan = (
                db.query(ShopPlan)
                .filter(ShopPlan.id == ent.plan_id)
                .first()
                if ent.plan_id is not None
                else None
            )
            ram_limit = ent.ram_mb if ent.ram_mb and ent.ram_mb >= 512 else None
            raw_cpu_pct = normalize_cpu_limit_percent(ent.cpu)
            cpu_limit = min(6400, max(10, raw_cpu_pct)) if raw_cpu_pct else None
            req = ServerCreate(
                name=f"shop-{order.number}-{ent.id}"[:128],
                game_type=item.game_type,
                ram_limit_mb=ram_limit,
                cpu_limit_percent=cpu_limit,
                node_id=plan.node_id if plan is not None else None,
            )

            try:
                actor = _shop_actor(
                    db, origin=origin, correlation_id=correlation_id
                )
                idempotency_key, retry_of_id = _provisioning_keys(
                    db, actor_user_id=actor.user.id, entitlement_id=ent.id
                )
                ent.provisioning_status = "provisioning"
                ent.provisioning_error = None
                db.flush()

                prov_fn = server_provisioning_service.provision_server
                prov_kwargs: dict[str, object] = {
                    "idempotency_key": idempotency_key,
                    "retry_of_id": retry_of_id,
                }
                if "auto_place" in inspect.signature(prov_fn).parameters:
                    prov_kwargs["auto_place"] = req.node_id is None
                    prov_kwargs["strict_capacity"] = True
                result = prov_fn(db, req, actor, **prov_kwargs)
                permission_service.set_user_server_permissions(
                    db,
                    ent.user_id,
                    result.server.id,
                    list(CUSTOMER_SERVER_PERMISSIONS),
                    granted_by=None,
                )
                ent = (
                    db.query(ShopEntitlement)
                    .filter(ShopEntitlement.id == ent_id)
                    .first()
                )
                if ent is not None:
                    ent.server_id = result.server.id
                    ent.provisioning_status = "ready"
                    ent.provisioning_error = None
                    if (
                        ent.slots is not None
                        and result.server is not None
                    ):
                        from services import shop_slot_service

                        if shop_slot_service.get_blueprint_players(item.game_type) is not None:
                            try:
                                shop_slot_service.apply_server_slots(
                                    db, result.server, ent.slots, commit_env=False
                                )
                            except shop_slot_service.SlotConfigurationError:
                                logger.warning(
                                    "Konnte gebuchte Slots (%s) fuer Server %s nicht setzen",
                                    ent.slots,
                                    result.server.id,
                                )
                    audit_service.record_privileged_action(
                        db,
                        user_id=actor.user.id,
                        action="shop.entitlement.provisioned",
                        target_type="shop_entitlement",
                        target_id=ent.id,
                        details={
                            "order_id": ent.order_id,
                            "server_id": result.server.id,
                        },
                        origin=origin,
                        correlation_id=correlation_id,
                    )
                    db.commit()
            except HTTPException as exc:
                db.rollback()
                _mark_server_failed(
                    db,
                    entitlement_id=ent_id,
                    actor_user_id=actor_user_id,
                    code=_error_code(exc),
                    origin=origin,
                    correlation_id=correlation_id,
                )
            except Exception:
                db.rollback()
                logger.exception(
                    "Shop-Server-Provisionierung fehlgeschlagen (entitlement_id=%s)",
                    ent_id,
                )
                _mark_server_failed(
                    db,
                    entitlement_id=ent_id,
                    actor_user_id=actor_user_id,
                    code="shop_provisioning_failed",
                    origin=origin,
                    correlation_id=correlation_id,
                )
        elif ent.provisioning_status != "ready":
            try:
                actor = _shop_actor(
                    db, origin=origin, correlation_id=correlation_id
                )
                permission_service.set_user_server_permissions(
                    db,
                    ent.user_id,
                    ent.server_id,
                    list(CUSTOMER_SERVER_PERMISSIONS),
                    granted_by=None,
                )
                ent = (
                    db.query(ShopEntitlement)
                    .filter(ShopEntitlement.id == ent_id)
                    .first()
                )
                if ent is not None:
                    ent.provisioning_status = "ready"
                    ent.provisioning_error = None
                    audit_service.record_privileged_action(
                        db,
                        user_id=actor.user.id,
                        action="shop.entitlement.reactivated",
                        target_type="shop_entitlement",
                        target_id=ent.id,
                        details={
                            "order_id": ent.order_id,
                            "server_id": ent.server_id,
                        },
                        origin=origin,
                        correlation_id=correlation_id,
                    )
                    db.commit()
            except HTTPException as exc:
                db.rollback()
                _mark_server_failed(
                    db,
                    entitlement_id=ent_id,
                    actor_user_id=actor_user_id,
                    code=_error_code(exc),
                    origin=origin,
                    correlation_id=correlation_id,
                )
    else:
        # suspended oder revoked: Server best-effort stoppen, Kundenrechte entziehen,
        # Serverdaten aber bewusst auf dem Host belassen.
        if ent.provisioning_status == ent.status:
            return
        server_id = ent.server_id
        user_id = ent.user_id
        ziel_status = ent.status
        if server_id is not None:
            try:
                actor = _shop_actor(
                    db, origin=origin, correlation_id=correlation_id
                )
                server_action_service.request_lifecycle_operation(
                    db,
                    server_id=server_id,
                    operation="stop",
                    actor=actor,
                    idempotency_key=f"shop-entitlement-{ent_id}-{ziel_status}-{uuid4()}",
                )
            except HTTPException:
                logger.warning(
                    "Shop-Server konnte beim Statuswechsel auf %s nicht gestoppt werden (entitlement_id=%s, server_id=%s)",
                    ziel_status,
                    ent_id,
                    server_id,
                )
            except Exception:
                db.rollback()
                logger.exception(
                    "Unerwarteter Fehler beim Stoppen des Shop-Servers (entitlement_id=%s, server_id=%s)",
                    ent_id,
                    server_id,
                )

            permission_service.set_user_server_permissions(
                db, user_id, server_id, [], granted_by=None
            )

        ent = (
            db.query(ShopEntitlement)
            .filter(ShopEntitlement.id == ent_id)
            .first()
        )
        if ent is not None:
            ent.provisioning_status = ziel_status
            ent.provisioning_error = None
            audit_service.record_privileged_action(
                db,
                user_id=actor_user_id if actor_user_id is not None else ent.user_id,
                action=f"shop.entitlement.{ziel_status}",
                target_type="shop_entitlement",
                target_id=ent.id,
                details={"order_id": ent.order_id, "server_id": ent.server_id},
                origin=origin,
                correlation_id=correlation_id,
            )
            db.commit()


def sync_order_entitlements(
    db: Session, order_id: int, *, origin: ActorOrigin = "system"
) -> list[ShopEntitlement]:
    """Synchronisiert alle Server- und Rollen-Entitlements einer Bestellung."""
    correlation_id = str(uuid4())
    entitlements = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id == order_id)
        .order_by(ShopEntitlement.id.asc())
        .all()
    )
    if not entitlements:
        return []

    server_ids = [ent.id for ent in entitlements if ent.kind == "server"]
    user_ids = sorted(
        {ent.user_id for ent in entitlements if ent.kind in ("role", "addon")}
    )

    for ent_id in server_ids:
        ent = (
            db.query(ShopEntitlement)
            .filter(ShopEntitlement.id == ent_id)
            .first()
        )
        if ent is not None:
            _sync_server_entitlement(
                db, ent, origin=origin, correlation_id=correlation_id
            )

    if user_ids:
        owner = _active_owner(db)
        actor_user_id = owner.id if owner is not None else None
        for uid in user_ids:
            _sync_customer_roles(
                db,
                uid,
                actor_user_id=actor_user_id,
                correlation_id=correlation_id,
                origin=origin,
            )
        db.commit()

    return (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id == order_id)
        .order_by(ShopEntitlement.id.asc())
        .all()
    )


def sync_user_roles(
    db: Session,
    user_id: int,
    *,
    actor_user_id: int | None = None,
    origin: ActorOrigin = "direct",
) -> None:
    """Gleicht alle Rollen- und Add-on-Entitlements eines Nutzers additiv ab."""
    owner = _active_owner(db) if actor_user_id is None else None
    _sync_customer_roles(
        db,
        user_id,
        actor_user_id=actor_user_id if actor_user_id is not None else (owner.id if owner is not None else None),
        correlation_id=str(uuid4()),
        origin=origin,
    )
    db.commit()


def sync_entitlement(
    db: Session, entitlement_id: int, *, origin: ActorOrigin = "direct"
) -> ShopEntitlement | None:
    """Synchronisiert genau ein Entitlement (z. B. nach Fehlerbehebung)."""
    ent = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.id == entitlement_id)
        .first()
    )
    if ent is None:
        return None

    correlation_id = str(uuid4())
    if ent.kind == "server":
        _sync_server_entitlement(
            db, ent, origin=origin, correlation_id=correlation_id
        )
    elif ent.kind in ("role", "addon"):
        sync_user_roles(db, ent.user_id, origin=origin)

    return (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.id == entitlement_id)
        .first()
    )
