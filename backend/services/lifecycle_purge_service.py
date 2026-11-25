"""Lifecycle-Bereinigung, E-Mail-Mahnstufen und sichere Selbstloeschung.

Dieses Modul ist die einzige Wahrheitsquelle fuer Fristen, idempotente
Zahlungserinnerungen und endgueltige Server-Loeschungen bei Kuendigung oder
Zahlungsverzug — gemeinsam fuer den nativen Shop (`ShopEntitlement`) und die
Hoster-API (`HosterService`).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import math
import threading
from uuid import uuid4

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from models import (
    HosterService,
    LifecycleDeletionNotice,
    Server,
    ShopEntitlement,
    ShopSubscription,
    User,
)
from services import audit_service, shop_lifecycle_settings_service
from services.panel_settings_service import PanelSettingsService

logger = logging.getLogger("msm.lifecycle_purge")


class LifecyclePurgeError(ValueError):
    """Domänenfehler mit sauberem HTTP-Status fuer den API-Rand."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _run_coro_sync(coro) -> bool:
    """Fuehrt eine Coroutine auch innerhalb aktiver Event-Loops thread-sicher aus."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return bool(asyncio.run(coro))

    result_box: list[bool] = []
    exc_box: list[BaseException] = []

    def _runner() -> None:
        try:
            result_box.append(bool(asyncio.run(coro)))
        except BaseException as exc:  # pragma: no cover - Schutz gegen Thread-Ausnahmen
            exc_box.append(exc)

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    thread.join(timeout=30)
    if exc_box:
        raise exc_box[0]
    return result_box[0] if result_box else False


def mark_entitlement_suspended(
    ent: ShopEntitlement,
    *,
    now: datetime | None = None,
    db: Session | None = None,
) -> None:
    """Startet bei Zahlungsverzug den Betreiber-Countdown ohne Frist-Reset bei Retries."""
    current = _as_utc(now) or _now()
    if ent.suspended_at is None:
        ent.suspended_at = current
    ent.purge_reason = "unpaid"
    if not ent.purge_cycle_token:
        ent.purge_cycle_token = str(uuid4())
    if ent.purge_after is None:
        if shop_lifecycle_settings_service.unpaid_auto_delete_enabled(db=db):
            days = shop_lifecycle_settings_service.unpaid_delete_days(db=db)
            ent.purge_after = current + timedelta(days=days)
        else:
            ent.purge_after = None


def mark_entitlement_revoked(
    ent: ShopEntitlement,
    *,
    reason: str,
    now: datetime | None = None,
    immediate: bool = False,
    db: Session | None = None,
) -> None:
    """Setzt die Loeschfrist fuer ein beendetes Entitlement (ohne laufende Fristen zu verlaengern)."""
    current = _as_utc(now) or _now()
    ent.purge_reason = reason
    if not ent.purge_cycle_token:
        ent.purge_cycle_token = str(uuid4())

    if immediate:
        ent.purge_after = current
        return

    grace_days = shop_lifecycle_settings_service.cancel_grace_days(db=db)
    candidate = current + timedelta(days=grace_days)
    existing = _as_utc(ent.purge_after)
    if existing is not None and existing < candidate:
        ent.purge_after = existing
    else:
        ent.purge_after = candidate


def clear_entitlement_purge(ent: ShopEntitlement) -> None:
    """Loescht Countdown und Mahnzyklus bei erfolgreicher Reaktivierung/Zahlung."""
    ent.suspended_at = None
    ent.purge_after = None
    ent.purge_reason = None
    ent.purge_cycle_token = None


def has_other_active_contract_for_server(
    db: Session,
    server_id: int,
    *,
    exclude_entitlement_id: int | None = None,
    exclude_hoster_service_id: int | None = None,
) -> bool:
    """Schutz-Invariante: niemals loeschen, solange ein anderer aktiver Vertrag existiert."""
    ent_q = db.query(ShopEntitlement.id).filter(
        ShopEntitlement.server_id == server_id,
        ShopEntitlement.status == "active",
    )
    if exclude_entitlement_id is not None:
        ent_q = ent_q.filter(ShopEntitlement.id != exclude_entitlement_id)
    if ent_q.first() is not None:
        return True

    hs_q = db.query(HosterService.id).filter(
        HosterService.server_id == server_id,
        HosterService.desired_state == "active",
        HosterService.status != "terminated",
    )
    if exclude_hoster_service_id is not None:
        hs_q = hs_q.filter(HosterService.id != exclude_hoster_service_id)
    return hs_q.first() is not None


def _linked_subscription(db: Session, ent: ShopEntitlement) -> ShopSubscription | None:
    return (
        db.query(ShopSubscription)
        .filter(ShopSubscription.order_item_id == ent.order_item_id)
        .order_by(ShopSubscription.id.desc())
        .first()
    )


def can_customer_purge_entitlement(db: Session, ent: ShopEntitlement) -> bool:
    """Prueft, ob der Kunde diesen eigenen gekuendigten Server sofort loeschen darf."""
    if not shop_lifecycle_settings_service.allow_customer_immediate_delete(db=db):
        return False
    if ent.kind != "server" or ent.server_id is None or ent.provisioning_status == "purged":
        return False
    if ent.status == "suspended":
        return False
    if ent.status == "revoked":
        return ent.purge_reason == "voluntary_cancel"
    if ent.status == "active":
        abo = _linked_subscription(db, ent)
        return bool(abo is not None and abo.cancel_at_period_end)
    return False


def _shop_system_actor(db: Session, *, origin: str, correlation_id: str):
    from services import shop_fulfillment_service

    return shop_fulfillment_service._shop_actor(  # type: ignore[arg-type]
        db, origin=origin, correlation_id=correlation_id
    )


def customer_purge_own_server(
    db: Session,
    *,
    user: User,
    entitlement_id: int,
    confirm_server_name: str,
    origin: str = "direct",
) -> ShopEntitlement:
    """Ermoeglicht dem Kunden die sofortige Loeschung SEINES eigenen gekuendigten Servers.

    Verteidigung in der Tiefe:
    - Filtert zwingend auf ``ShopEntitlement.user_id == user.id`` (404 bei Fremdzugriff)
    - Kein globales ``servers.delete`` noetig / keine Rechte-Eskalation
    - Erlaubt ausschliesslich freiwillige Kuendigungen (nie bei ``suspended``/offener Zahlung)
    - Prueft exakten Servernamen + Abwesenheit anderer aktiver Vertraege
    """
    from services import server_deletion_service, shop_fulfillment_service, stripe_service

    if not shop_lifecycle_settings_service.allow_customer_immediate_delete(db=db):
        raise LifecyclePurgeError(
            "Sofortloeschung durch Kunden ist vom Betreiber deaktiviert",
            status_code=403,
        )

    ent = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.id == entitlement_id,
            ShopEntitlement.user_id == user.id,
        )
        .with_for_update(of=ShopEntitlement)
        .first()
    )
    if ent is None:
        raise LifecyclePurgeError("Vertrag nicht gefunden", status_code=404)

    if ent.kind != "server" or ent.server_id is None or ent.provisioning_status == "purged":
        raise LifecyclePurgeError("Kein aktiver Server zum Loeschen vorhanden", status_code=409)

    abo = _linked_subscription(db, ent)
    is_voluntary = (
        (ent.status == "revoked" and ent.purge_reason == "voluntary_cancel")
        or (ent.status == "active" and abo is not None and abo.cancel_at_period_end)
    )
    if not is_voluntary:
        raise LifecyclePurgeError(
            "Nur freiwillig gekuendigte Server koennen sofort geloescht werden",
            status_code=403,
        )

    if has_other_active_contract_for_server(db, ent.server_id, exclude_entitlement_id=ent.id):
        raise LifecyclePurgeError(
            "Server ist noch mit einem anderen aktiven Vertrag verknuepft",
            status_code=409,
        )

    srv = db.query(Server).filter(Server.id == ent.server_id).first()
    if srv is None:
        raise LifecyclePurgeError("Zugehoeriger Server existiert nicht mehr", status_code=409)

    if (confirm_server_name or "").strip() != srv.name.strip():
        raise LifecyclePurgeError(
            "Der eingegebene Servername stimmt nicht ueberein",
            status_code=422,
        )

    current = _now()
    if abo is not None and abo.status != "cancelled":
        if abo.provider_reference:
            stripe_service.cancel_subscription_immediately(abo.provider_reference)
        abo.status = "cancelled"
        abo.cancel_at_period_end = True
        abo.delete_server_on_end = True

    order_ents = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_item_id == ent.order_item_id)
        .all()
    )
    for sib in order_ents:
        if sib.status != "revoked":
            sib.status = "revoked"
            sib.revoked_at = sib.revoked_at or current
        sib.purge_reason = "voluntary_cancel"

    corr_id = str(uuid4())
    actor = _shop_system_actor(db, origin=origin, correlation_id=corr_id)
    target_server_id = srv.id
    target_server_name = srv.name

    server_deletion_service.delete_server_completely(
        db, server_id=target_server_id, actor=actor
    )

    ent.server_id = None
    ent.provisioning_status = "purged"
    ent.provisioning_error = None
    ent.purge_after = None
    ent.purge_reason = "voluntary_cancel"
    ent.purged_at = current

    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="shop.entitlement.customer_purged",
        target_type="shop_entitlement",
        target_id=ent.id,
        details={
            "order_id": ent.order_id,
            "server_id": target_server_id,
            "server_name": target_server_name,
            "requested_by_user_id": user.id,
        },
        origin=origin,
        correlation_id=corr_id,
    )
    db.flush()
    shop_fulfillment_service._sync_customer_roles(  # type: ignore[arg-type]
        db,
        user.id,
        actor_user_id=user.id,
        correlation_id=corr_id,
        origin=origin,
    )
    db.commit()
    db.refresh(ent)
    return ent


def _upsert_notice(
    db: Session,
    *,
    target_kind: str,
    target_id: int,
    cycle_token: str,
    stage_days: int,
    status: str,
    sent_at: datetime | None = None,
) -> None:
    row = (
        db.query(LifecycleDeletionNotice)
        .filter(
            LifecycleDeletionNotice.target_kind == target_kind,
            LifecycleDeletionNotice.target_id == target_id,
            LifecycleDeletionNotice.cycle_token == cycle_token,
            LifecycleDeletionNotice.stage_days == stage_days,
        )
        .first()
    )
    if row is None:
        db.add(
            LifecycleDeletionNotice(
                target_kind=target_kind,
                target_id=target_id,
                cycle_token=cycle_token,
                stage_days=stage_days,
                status=status,
                attempts=1,
                sent_at=sent_at,
            )
        )
    else:
        row.status = status
        row.attempts = int(row.attempts or 0) + 1
        if sent_at is not None:
            row.sent_at = sent_at


def _process_notice_candidate(
    db: Session,
    *,
    target_kind: str,
    target_id: int,
    user_id: int,
    server_id: int,
    deadline: datetime,
    cycle_token: str,
    reminder_days: list[int],
    payment_url: str | None,
    now: datetime,
) -> bool:
    """Prueft und verschickt genau die dringlichste faellige Mahnstufe fuer einen Vertrag."""
    from services.email_service import EmailService

    deadline_utc = _as_utc(deadline)
    if deadline_utc is None or deadline_utc <= now:
        return False

    days_remaining = max(1, math.ceil((deadline_utc - now).total_seconds() / 86400))
    due_stages = [d for d in reminder_days if d >= days_remaining]
    if not due_stages:
        return False

    existing = (
        db.query(LifecycleDeletionNotice)
        .filter(
            LifecycleDeletionNotice.target_kind == target_kind,
            LifecycleDeletionNotice.target_id == target_id,
            LifecycleDeletionNotice.cycle_token == cycle_token,
        )
        .all()
    )
    done_stages = {
        row.stage_days
        for row in existing
        if row.status in ("sent", "skipped") or (row.status == "failed" and row.attempts >= 3)
    }
    pending_due = sorted([d for d in due_stages if d not in done_stages])
    if not pending_due:
        return False

    urgent_stage = pending_due[0]
    skipped_stages = pending_due[1:]

    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    srv = db.query(Server).filter(Server.id == server_id).first()
    if user is None or srv is None:
        return False

    try:
        recipient_email = user.email
    except Exception:
        logger.warning(
            "Loesch-Erinnerung uebersprungen: E-Mail unlesbar (kind=%s, id=%s)",
            target_kind,
            target_id,
        )
        return False
    if not recipient_email:
        return False

    for old_stage in skipped_stages:
        _upsert_notice(
            db,
            target_kind=target_kind,
            target_id=target_id,
            cycle_token=cycle_token,
            stage_days=old_stage,
            status="skipped",
        )

    sent_ok = False
    try:
        sent_ok = _run_coro_sync(
            EmailService.send_server_deletion_warning_email(
                to=recipient_email,
                customer_name=user.username,
                server_name=srv.name,
                days_remaining=days_remaining,
                purge_at=deadline_utc,
                payment_url=payment_url,
            )
        )
    except Exception as exc:
        logger.warning(
            "Loesch-Erinnerungs-Mail fehlgeschlagen (kind=%s, id=%s, stage=%s, err=%s)",
            target_kind,
            target_id,
            urgent_stage,
            type(exc).__name__,
        )
        sent_ok = False

    if sent_ok:
        _upsert_notice(
            db,
            target_kind=target_kind,
            target_id=target_id,
            cycle_token=cycle_token,
            stage_days=urgent_stage,
            status="sent",
            sent_at=now,
        )
        db.commit()
        return True

    _upsert_notice(
        db,
        target_kind=target_kind,
        target_id=target_id,
        cycle_token=cycle_token,
        stage_days=urgent_stage,
        status="failed",
    )
    db.commit()
    return False


def process_unpaid_deletion_reminders(
    db: Session, *, now: datetime | None = None
) -> int:
    """Verschickt gestaffelte Mahnstufen fuer gesperrte Server (Shop & Hoster-API)."""
    from config import settings

    current = now or _now()
    reminder_days = shop_lifecycle_settings_service.dunning_reminder_days(db=db)
    if not reminder_days:
        return 0

    base = (
        PanelSettingsService.get("panel_url", "") or settings.panel_url or ""
    ).rstrip("/")
    shop_payment_url = f"{base}/konto/abos" if base else None
    external_shop = PanelSettingsService.get("external_shop_url", "").strip()
    hoster_payment_url = external_shop or shop_payment_url

    sent_count = 0

    shop_rows = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.kind == "server",
            ShopEntitlement.status == "suspended",
            ShopEntitlement.purge_reason == "unpaid",
            ShopEntitlement.server_id.isnot(None),
            ShopEntitlement.purge_after.isnot(None),
            ShopEntitlement.purge_after > current,
        )
        .order_by(ShopEntitlement.purge_after.asc())
        .all()
    )
    for ent in shop_rows:
        abo = _linked_subscription(db, ent)
        if (
            abo is not None
            and getattr(abo, "billing_mode", "subscription") == "lifetime"
            and abo.status == "active"
        ):
            ent.purge_after = None
            ent.purge_reason = None
            db.commit()
            continue
        if not ent.purge_cycle_token:
            ent.purge_cycle_token = str(uuid4())
            db.commit()
        if ent.server_id is None or ent.purge_after is None:
            continue
        if _process_notice_candidate(
            db,
            target_kind="shop_entitlement",
            target_id=ent.id,
            user_id=ent.user_id,
            server_id=ent.server_id,
            deadline=ent.purge_after,
            cycle_token=ent.purge_cycle_token,
            reminder_days=reminder_days,
            payment_url=shop_payment_url,
            now=current,
        ):
            sent_count += 1

    hoster_rows = (
        db.query(HosterService)
        .filter(
            HosterService.item_kind == "server",
            HosterService.status == "suspended",
            HosterService.purge_reason == "unpaid",
            HosterService.server_id.isnot(None),
            HosterService.terminate_after.isnot(None),
            HosterService.terminate_after > current,
        )
        .order_by(HosterService.terminate_after.asc())
        .all()
    )
    for hs in hoster_rows:
        if not hs.purge_cycle_token:
            hs.purge_cycle_token = str(uuid4())
            db.commit()
        if hs.server_id is None or hs.terminate_after is None or hs.identity is None:
            continue
        if _process_notice_candidate(
            db,
            target_kind="hoster_service",
            target_id=hs.id,
            user_id=hs.identity.user_id,
            server_id=hs.server_id,
            deadline=hs.terminate_after,
            cycle_token=hs.purge_cycle_token,
            reminder_days=reminder_days,
            payment_url=hoster_payment_url,
            now=current,
        ):
            sent_count += 1

    return sent_count


def expire_due_prepaid_subscriptions(
    db: Session, *, now: datetime | None = None
) -> int:
    """Sperrt oder widerruft abgelaufene Prepaid- und gekuendigte lokale Abos."""
    from services import shop_fulfillment_service

    current = _as_utc(now) or _now()
    due_ids = [
        row[0]
        for row in db.query(ShopSubscription.id)
        .filter(
            ShopSubscription.status == "active",
            ShopSubscription.current_period_end <= current,
            or_(
                ShopSubscription.billing_mode == "prepaid",
                and_(
                    ShopSubscription.billing_mode == "subscription",
                    ShopSubscription.cancel_at_period_end.is_(True),
                    ShopSubscription.provider_reference.is_(None),
                ),
            ),
        )
        .order_by(ShopSubscription.current_period_end.asc())
        .all()
    ]

    expired = 0
    for sub_id in due_ids:
        try:
            sub = (
                db.query(ShopSubscription)
                .filter(ShopSubscription.id == sub_id)
                .with_for_update(of=ShopSubscription, skip_locked=True)
                .first()
            )
            if sub is None or sub.status != "active" or sub.billing_mode == "lifetime":
                continue
            period_end = _as_utc(sub.current_period_end)
            if period_end is None or period_end > current:
                continue

            sub.status = "cancelled"
            sub.cancel_at_period_end = True

            ents = (
                db.query(ShopEntitlement)
                .filter(ShopEntitlement.order_item_id == sub.order_item_id)
                .with_for_update(of=ShopEntitlement)
                .all()
            )
            for ent in ents:
                if ent.status == "revoked":
                    continue
                if sub.delete_server_on_end or sub.billing_mode != "prepaid":
                    ent.status = "revoked"
                    ent.revoked_at = ent.revoked_at or current
                    mark_entitlement_revoked(
                        ent,
                        reason="voluntary_cancel",
                        now=current,
                        db=db,
                    )
                else:
                    ent.status = "suspended"
                    mark_entitlement_suspended(ent, now=current, db=db)

            db.flush()
            shop_fulfillment_service.sync_order_entitlements(
                db, sub.order_id, origin="system"
            )
            db.commit()
            expired += 1
        except Exception as exc:
            db.rollback()
            logger.warning(
                "Prepaid-Abo konnte nicht beendet werden (subscription_id=%s, err=%s)",
                sub_id,
                type(exc).__name__,
            )
    return expired


def purge_expired_shop_entitlements(
    db: Session, *, now: datetime | None = None
) -> int:
    """Loescht abgelaufene Shop-Server endgueltig von der Platte (`FOR UPDATE SKIP LOCKED`)."""
    from services import server_deletion_service, shop_fulfillment_service

    current = _as_utc(now) or _now()
    due_ids = [
        row[0]
        for row in db.query(ShopEntitlement.id)
        .filter(
            ShopEntitlement.kind == "server",
            ShopEntitlement.status.in_(("suspended", "revoked")),
            ShopEntitlement.server_id.isnot(None),
            ShopEntitlement.purge_after.isnot(None),
            ShopEntitlement.purge_after <= current,
        )
        .order_by(ShopEntitlement.purge_after.asc())
        .all()
    ]

    purged = 0
    for ent_id in due_ids:
        try:
            ent = (
                db.query(ShopEntitlement)
                .filter(ShopEntitlement.id == ent_id)
                .with_for_update(of=ShopEntitlement, skip_locked=True)
                .first()
            )
            if ent is None:
                continue
            # Re-Verifikation nach Lock: aktiver Vertrag rettet immer.
            if ent.status == "active" or ent.server_id is None:
                continue
            purge_deadline = _as_utc(ent.purge_after)
            if purge_deadline is None or purge_deadline > current:
                continue

            if has_other_active_contract_for_server(
                db, ent.server_id, exclude_entitlement_id=ent.id
            ):
                ent.purge_after = None
                db.commit()
                continue

            abo_check = _linked_subscription(db, ent)
            if (
                abo_check is not None
                and getattr(abo_check, "billing_mode", "subscription") == "lifetime"
                and abo_check.status == "active"
            ):
                ent.purge_after = None
                ent.purge_reason = None
                db.commit()
                continue

            srv_id = ent.server_id
            reason = ent.purge_reason or "voluntary_cancel"
            corr_id = str(uuid4())
            actor = _shop_system_actor(db, origin="system", correlation_id=corr_id)

            srv = db.query(Server).filter(Server.id == srv_id).first()
            if srv is not None:
                server_deletion_service.delete_server_completely(
                    db, server_id=srv_id, actor=actor
                )

            ent = db.query(ShopEntitlement).filter(ShopEntitlement.id == ent_id).first()
            if ent is None:
                continue

            order_ents = (
                db.query(ShopEntitlement)
                .filter(ShopEntitlement.order_item_id == ent.order_item_id)
                .all()
            )
            for sib in order_ents:
                if sib.status != "revoked":
                    sib.status = "revoked"
                    sib.revoked_at = sib.revoked_at or current

            ent.server_id = None
            ent.provisioning_status = "purged"
            ent.provisioning_error = None
            ent.purge_after = None
            ent.purge_reason = reason
            ent.purged_at = current

            abo = _linked_subscription(db, ent)
            if abo is not None and abo.status != "cancelled":
                abo.status = "cancelled"
                abo.cancel_at_period_end = True

            audit_service.record_privileged_action(
                db,
                user_id=actor.user.id,
                action="shop.entitlement.purged",
                target_type="shop_entitlement",
                target_id=ent.id,
                details={
                    "order_id": ent.order_id,
                    "server_id": srv_id,
                    "reason": reason,
                },
                origin="system",
                correlation_id=corr_id,
            )
            db.flush()
            shop_fulfillment_service._sync_customer_roles(  # type: ignore[arg-type]
                db,
                ent.user_id,
                actor_user_id=actor.user.id,
                correlation_id=corr_id,
                origin="system",
            )
            db.commit()
            purged += 1
        except Exception as exc:
            db.rollback()
            logger.warning(
                "Abgelaufener Shop-Server konnte nicht geloescht werden (entitlement_id=%s, err=%s)",
                ent_id,
                type(exc).__name__,
            )
    return purged
