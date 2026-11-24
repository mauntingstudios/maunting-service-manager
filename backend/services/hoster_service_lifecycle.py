"""Desired-State-Logik der Hoster-Anbindung.

Der Shop meldet nur, welchen Zustand ein Vertrag haben soll ("aktiv",
"gesperrt", "beendet"). Diese Schicht uebersetzt das in genau die Aufrufe, die
das Panel selbst auch verwendet:

- Servererstellung ausschliesslich ueber `server_provisioning_service.provision_server`
- Start/Stop ausschliesslich ueber `server_action_service.request_lifecycle_operation`

Es gibt hier bewusst keine eigene, vereinfachte Servererstellung. Kapazitaets-,
Port-, Blueprint- und Rechtepruefungen gelten fuer eine Shop-Bestellung damit
exakt so wie fuer einen Klick im Panel.

Idempotenz: `(integration, external_service_id)` ist eindeutig. Sendet der Shop
denselben Auftrag nach einem Netzwerkfehler erneut, wird derselbe Service
weitergefuehrt statt ein zweiter Server erzeugt.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import inspect
import logging
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    HosterIdentity,
    HosterIntegration,
    HosterProduct,
    HosterService,
    Role,
    Server,
    ShopAddon,
    ShopEntitlement,
    ShopPlan,
    User,
)
from schemas import ServerCreate
from schemas.hoster import HosterApplyRequest, HosterServiceResponse
from services import (
    audit_service,
    lifecycle_purge_service,
    permission_service,
    role_service,
    shop_lifecycle_settings_service,
)
from services.actor_context import ActorContext
from services.hoster_integration_service import (
    HosterConfigurationError,
    HosterRoleEscalation,
    ensure_role_is_delegatable,
    get_product,
    normalize_external_id,
    resolve_identity,
)


logger = logging.getLogger(__name__)

DESIRED_STATES = frozenset({"active", "suspended", "terminated"})

# Vollstaendiges Statusvokabular eines Vertrags. Jeder Wert wird als Webhook
# `service.<status>` an den Shop gemeldet und ist damit Teil des oeffentlichen
# Vertrags — nicht nur ein interner Merker. Deshalb steht er hier an einer
# Stelle statt verstreut in den Zuweisungen: `test_hoster_api_docs_contract`
# prueft gegen diese Liste, dass jeder Wert in `docs/hoster-api.md` erklaert
# ist. Ein neuer Status ohne Doku laesst den Test fehlschlagen.
SERVICE_STATUSES: tuple[str, ...] = (
    "pending",
    "provisioning",
    "ready",
    "suspended",
    "terminating",
    "terminated",
    "failed",
)

# Rechte, die ein Kunde auf seinem eigenen gemieteten Server erhaelt.
# Bewusst NICHT enthalten: Netzwerk- und Ressourcenverwaltung (die bestimmt das
# gebuchte Produkt), Reinstall und Datenbankadministration. `servers.delete`
# ist ohnehin global und damit fuer Kunden unerreichbar.
CUSTOMER_SERVER_PERMISSIONS = (
    "server.view",
    "server.start",
    "server.stop",
    "server.restart",
    "server.config.write",
    "server.console.read",
    "server.console.write",
    "server.files.read",
    "server.files.write",
    "server.files.delete",
    "server.backups.read",
    "server.backups.create",
    "server.backups.restore",
    "server.backups.delete",
    "server.mods.read",
    "server.mods.write",
    "server.mods.toggle",
    # Zielpunkt 17.3: ein Kunde muss die fuer seinen Server noetigen
    # Zugangsdaten selbst hinterlegen koennen, ohne beim Betreiber ein Ticket
    # aufzumachen. Das Recht erlaubt nur die Bindung eigener Credentials an
    # diesen Server — die Geheimnisse selbst bleiben unlesbar.
    "server.credentials.manage",
)

# Eigener Fehlercode fuer eine Produktrolle, die der Dienstbenutzer der
# Integration selbst nicht haelt. Bewusst getrennt von
# `hoster_configuration_error`: der Shop soll unterscheiden koennen zwischen
# "Produkt falsch konfiguriert" und "diese Integration darf diese Rolle nicht
# vergeben" — nur der zweite Fall ist ein Rechteproblem beim Betreiber.
ROLE_ESCALATION_CODE = "hoster_role_escalation"

# Erreichte Zustaende, in denen ein Vertrag seine Produktrolle traegt.
#
# `failed` fehlt bewusst, und das ist keine Feinheit: ein neu angelegter Vertrag
# wird mit `desired_state="active"` festgeschrieben, bevor die Aktivierung
# ueberhaupt versucht wird. Scheitert sie, bleibt genau diese Kombination stehen
# — gewuenscht aktiv, tatsaechlich fehlgeschlagen. Wer nur den Wunsch abfragt,
# haelt einen abgelehnten Vertrag fuer laufend und vergibt dessen Rolle beim
# naechsten Anlass doch noch.
#
# `pending` fehlt aus demselben Grund: gewuenscht, aber nichts erreicht.
ROLE_BEARING_STATUSES = frozenset({"provisioning", "ready"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _set_status(service: HosterService, status: str) -> None:
    """Setzt den Vertragsstatus und haelt ihn im dokumentierten Vokabular.

    Der Status verlaesst MSM als Webhook-Event `service.<status>`. Ein Tippfehler
    waere deshalb kein interner Schoenheitsfehler, sondern ein Ereignis, auf das
    der angebundene Shop nie reagieren wuerde.
    """
    if status not in SERVICE_STATUSES:
        raise HosterConfigurationError(f"Unbekannter Servicestatus: {status}")
    service.status = status


def _actor(db: Session, integration: HosterIntegration, correlation_id: str) -> ActorContext:
    """Baut den Auslöserkontext aus dem Dienstbenutzer der Integration.

    `origin="external"` macht im Audit und in den Tasks sichtbar, dass der
    Vorgang aus einem Shop stammt — bei identischer Fachlogik.
    """
    user = (
        db.query(User)
        .filter(User.id == integration.service_user_id, User.is_active.is_(True))
        .first()
    )
    if user is None:
        raise HosterConfigurationError(
            "Der Dienstbenutzer dieser Integration ist deaktiviert oder geloescht"
        )
    return ActorContext.for_user(user, origin="external", correlation_id=correlation_id)


def _server_name(external_service_id: str) -> str:
    """Stabiler, nicht erratbarer Anzeigename ohne Kundendaten."""
    return f"svc-{external_service_id}"[:128]


def service_response(row: HosterService) -> HosterServiceResponse:
    """Einheitliche Serialisierung eines HosterService ohne interne Details."""
    return HosterServiceResponse(
        external_service_id=row.external_service_id,
        item_kind=row.item_kind,  # type: ignore[arg-type]
        plan_id=row.shop_plan_id,
        addon_slug=row.addon.slug if row.addon is not None else None,
        desired_state=row.desired_state,
        status=row.status,
        status_code=row.status_code,
        server_id=row.server_id,
        task_id=row.task_id,
        correlation_id=row.correlation_id,
        terminate_after=row.terminate_after,
        updated_at=row.updated_at,
    )


def get_service(
    db: Session, integration: HosterIntegration, external_service_id: str
) -> HosterService | None:
    key = normalize_external_id(external_service_id, label="Service-Kennung")
    return (
        db.query(HosterService)
        .filter(
            HosterService.integration_id == integration.id,
            HosterService.external_service_id == key,
        )
        .first()
    )


def _record(
    db: Session,
    *,
    integration: HosterIntegration,
    service: HosterService,
    action: str,
    succeeded: bool,
    extra: dict | None = None,
) -> None:
    """Schreibt einen secret-freien Audit-Eintrag mit gemeinsamer Korrelations-ID."""
    audit_service.record_privileged_action(
        db,
        user_id=integration.service_user_id,
        action=action,
        target_type="server" if service.server_id else "hoster_service",
        target_id=service.server_id,
        details={
            "integration": integration.slug,
            "service_id": service.id,
            "desired_state": service.desired_state,
            "status": service.status,
            "succeeded": succeeded,
            **(extra or {}),
        },
        origin="external",
        correlation_id=service.correlation_id,
    )


def _grant_customer_permissions(db: Session, service: HosterService) -> None:
    """Gibt dem Kunden genau die Rechte auf genau seinem Server.

    Bewusst serverbezogen statt ueber eine globale Rolle: ein Kunde darf seinen
    eigenen Server verwalten, sieht fremde Server aber nicht einmal.
    """
    if service.server_id is None:
        return
    permission_service.set_user_server_permissions(
        db,
        service.identity.user_id,
        service.server_id,
        list(CUSTOMER_SERVER_PERMISSIONS),
        granted_by=None,
    )


def _borne_role(
    service: HosterService,
    product: HosterProduct | None,
    addon: ShopAddon | None = None,
    shop_plan: ShopPlan | None = None,
) -> int | None:
    """Welche Rolle dieser eine Vertrag gerade traegt — ``None``, wenn keine.

    `desired_state` allein reicht als Bedingung nicht. Ein neu angelegter
    Vertrag wird mit `desired_state="active"` festgeschrieben, *bevor* die
    Aktivierung ueberhaupt versucht wird (siehe `apply_desired_state`), und der
    Rollback eines Fehlschlags nimmt das nicht zurueck. Wer nur den Wunsch
    ansieht, haelt deshalb einen Vertrag fuer laufend, den MSM gerade abgelehnt
    hat — bei einer abgelehnten Rolle waere das die Rolle selbst, ueber den
    naechsten Vertrag desselben Kunden nachtraeglich doch vergeben. Deshalb
    zaehlt hier zusaetzlich der *erreichte* Zustand.

    Fehlt das Produkt bzw. Add-on, gilt weiter, was diesem Vertrag zuletzt
    zugestanden wurde: dass der Betreiber ein Produkt aufraeumt, darf einem
    zahlenden Kunden nicht sein Kontingent nehmen.
    """
    if service.desired_state != "active" or service.status not in ROLE_BEARING_STATUSES:
        return None
    if getattr(service, "item_kind", "server") == "addon":
        resolved_addon = addon if addon is not None else getattr(service, "addon", None)
        if resolved_addon is None:
            return service.granted_role_id
        return resolved_addon.role_id
    resolved_plan = shop_plan if shop_plan is not None else getattr(service, "shop_plan", None)
    if resolved_plan is not None:
        return resolved_plan.role_id
    if product is None:
        return service.granted_role_id
    return product.role_id


def _apply_customer_role(db: Session, service: HosterService) -> None:
    """Gleicht die globalen Rollen des Kunden an seine Vertraege an.

    Ueber globale Rollen laufen unter anderem die KI-Kontingente. Ein Tarif
    kann damit mehr KI-Budget mitbringen, ohne dass jemand von Hand Rollen
    pflegt. Vier Eigenschaften bestimmen die Form dieser Funktion:

    (a) Additiv: Basis ist die Ist-Menge aus `effective_user_role_ids`, nicht
        eine frisch berechnete Wunschmenge. Manuell vergebene Rollen ueberleben
        deshalb jede Vertragsaenderung — und `users.role_id` bleibt an genau
        einer Stelle kompatibel gepflegt, weil `set_user_roles` das uebernimmt.
    (b) Mehrere Vertraege: entzogen wird nur, was kein anderer laufender Vertrag
        desselben Kunden noch fordert. Wer zwei Server desselben Tarifs mietet
        und einen kuendigt, behaelt die Rolle.
    (c) Systemrollen nie: waehlt ein Betreiber "user" als Produktrolle, bleibt
        sie beim Entzug stehen. Ein Account ganz ohne Rolle waere unbenutzbar.
    (d) Zurueckgenommen wird, was *vergeben wurde* — nicht, was heute am Produkt
        steht. Die Kandidatenmenge kommt aus `granted_role_id` der Vertraege,
        nicht aus `hoster_products.role_id`. Ohne diesen Unterschied verliert
        ein Tarifwechsel die alte Rolle aus dem Blick (der Vertrag zeigt danach
        auf ein anderes Produkt), und ein geloeschtes oder geaendertes Produkt
        macht die Rolle unentziehbar — der Kunde behielte ein Kontingent ohne
        Vertrag, und keine spaetere Kuendigung holte es zurueck.

    Der Kunde wird ausdruecklich **ohne** `is_active`-Filter gesucht. Ein
    deaktivierter Account behaelt seine Rollen, und eine Kuendigung waehrend der
    Sperre muss ihm die Produktrolle trotzdem nehmen: sonst traegt er sie nach
    einer spaeteren Reaktivierung ohne jeden Vertrag weiter.
    """
    user = db.query(User).filter(User.id == service.identity.user_id).first()
    if user is None:
        return

    # Die Session laeuft ohne Autoflush; der frisch gesetzte Zustand dieses
    # Vertrags muss vor der Abfrage in der Transaktion stehen, sonst rechnet die
    # Soll-Menge noch mit dem alten.
    db.flush()

    # Serialisiert konkurrierende Vertragsaenderungen desselben Kunden. Ohne die
    # Sperre lesen zwei gleichzeitige Auftraege dieselbe Ist-Menge und schreiben
    # beide die volle Zielmenge zurueck — der spaetere Commit verwirft die Rolle
    # des frueheren. Dasselbe Mittel wie in `ai_usage_service.reserve_ai_usage`.
    db.query(User.id).filter(User.id == user.id).with_for_update().one()

    # Alle Vertraege dieses Kunden, integrationsuebergreifend: eine globale
    # Rolle gilt im ganzen Panel, nicht je Shop. `outerjoin` auf das Produkt,
    # damit ein Vertrag mit geloeschtem Produkt (`product_id` faellt auf NULL)
    # nicht aus der Betrachtung faellt und seine Rolle unentziehbar wird.
    zeilen = (
        db.query(HosterService, HosterProduct, ShopAddon, ShopPlan)
        .select_from(HosterService)
        .join(HosterIdentity, HosterIdentity.id == HosterService.identity_id)
        .outerjoin(HosterProduct, HosterProduct.id == HosterService.product_id)
        .outerjoin(ShopAddon, ShopAddon.id == HosterService.addon_id)
        .outerjoin(ShopPlan, ShopPlan.id == HosterService.shop_plan_id)
        .filter(HosterIdentity.user_id == user.id)
        .all()
    )

    soll: set[int] = set()
    kandidaten: set[int] = set()
    eigene_rolle: int | None = None
    for zeile, produkt, addon, plan in zeilen:
        getragen = _borne_role(zeile, produkt, addon, plan)
        if zeile.id == service.id:
            eigene_rolle = getragen
        if getragen is not None:
            soll.add(getragen)
        if zeile.granted_role_id is not None:
            kandidaten.add(zeile.granted_role_id)

    # Bidirektionale Koexistenz mit dem nativen Shop: laufende Shop-Entitlements
    # behalten ihre globale Rolle, selbst wenn ein Hoster-Vertrag gekuendigt wird.
    shop_role_rows = (
        db.query(ShopEntitlement.role_id)
        .filter(
            ShopEntitlement.user_id == user.id,
            ShopEntitlement.kind.in_(("role", "addon")),
            ShopEntitlement.status == "active",
            ShopEntitlement.role_id.isnot(None),
        )
        .all()
    )
    for (shop_role_id,) in shop_role_rows:
        if shop_role_id is not None:
            soll.add(shop_role_id)

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
        # `set_user_roles` ERSETZT die Zuordnung, bekommt hier also immer die
        # vollstaendige Zielmenge. `commit=False`, weil `apply_desired_state`
        # am Ende selbst committet — ein Commit mitten im Ablauf wuerde den
        # Rollback-Pfad der Fehlerbehandlung zerreissen.
        role_service.set_user_roles(db, user, sorted(ziel), commit=False)

    # Erst ganz zum Schluss: ab jetzt ist dies der Beleg, gegen den ein
    # spaeterer Entzug rechnet.
    service.granted_role_id = eigene_rolle


def _provision(
    db: Session,
    *,
    integration: HosterIntegration,
    service: HosterService,
    ram_mb: int | None = None,
    cpu_percent: int | None = None,
) -> None:
    """Erstellt den Server ueber den gemeinsamen Provisionierungsservice."""
    from services.server_provisioning_service import provision_server

    plan = service.shop_plan
    product = service.product
    if plan is not None:
        if not plan.active:
            raise HosterConfigurationError("Shop-Tarif ist unbekannt oder deaktiviert")
        from services.node_capacity import normalize_cpu_limit_percent

        game_type = plan.game_type
        eff_ram = ram_mb if ram_mb is not None else plan.ram_included_mb
        eff_cpu = (
            cpu_percent
            if cpu_percent is not None
            else normalize_cpu_limit_percent(plan.cpu_included)
        )
        eff_disk = None
        eff_node_id = plan.node_id
        backup_hours = None
    elif product is not None:
        if not product.enabled:
            raise HosterConfigurationError("Produkt ist unbekannt oder deaktiviert")
        game_type = product.game_type
        eff_ram = ram_mb if ram_mb is not None else product.ram_limit_mb
        eff_cpu = cpu_percent if cpu_percent is not None else product.cpu_limit_percent
        eff_disk = product.disk_limit_gb
        eff_node_id = product.node_id
        backup_hours = product.backup_interval_hours
    else:
        raise HosterConfigurationError("Produkt ist unbekannt oder deaktiviert")

    request = ServerCreate(
        name=_server_name(service.external_service_id),
        game_type=game_type,
        cpu_limit_percent=eff_cpu,
        ram_limit_mb=eff_ram,
        disk_limit_gb=eff_disk,
        node_id=eff_node_id,
    )
    _set_status(service, "provisioning")
    service.status_code = None
    db.flush()

    # Der Idempotency-Key bindet die Provisionierung an genau diesen Vertrag.
    # Ein wiederholter Shop-Aufruf trifft damit dieselbe Task und erzeugt keinen
    # zweiten Server — selbst wenn die Zeile hier gleichzeitig gelesen wird.
    prov_params = inspect.signature(provision_server).parameters
    prov_kwargs: dict[str, object] = {
        "idempotency_key": f"hoster-{integration.id}-{service.id}",
    }
    if "auto_place" in prov_params:
        prov_kwargs["auto_place"] = request.node_id is None
        prov_kwargs["strict_capacity"] = True
    if "shop_only" in prov_params:
        prov_kwargs["shop_only"] = True
    result = provision_server(
        db,
        request,
        _actor(db, integration, service.correlation_id),
        **prov_kwargs,
    )
    service.server_id = result.server.id
    service.task_id = result.task.id
    _set_status(service, "ready")
    service.status_code = None
    _grant_customer_permissions(db, service)
    if backup_hours:
        server = db.query(Server).filter(Server.id == result.server.id).first()
        if server is not None:
            server.backup_interval_hours = backup_hours
            from services.scheduler_service import schedule_backup

            schedule_backup(server.id, backup_hours)


def _lifecycle(
    db: Session, *, integration: HosterIntegration, service: HosterService, operation: str
) -> None:
    """Startet oder stoppt den Server ueber den gemeinsamen Lifecycle-Service."""
    from services.server_action_service import request_lifecycle_operation

    if service.server_id is None:
        return
    result = request_lifecycle_operation(
        db,
        server_id=service.server_id,
        operation=operation,
        actor=_actor(db, integration, service.correlation_id),
        idempotency_key=f"hoster-{integration.id}-{service.id}-{operation}-{uuid4()}",
    )
    service.task_id = result.get("task_id")


def _resolve_active_addon(db: Session, addon_slug: str) -> ShopAddon:
    slug = addon_slug.strip()
    if not slug:
        raise HosterConfigurationError("Add-on-Slug darf nicht leer sein")
    addon = (
        db.query(ShopAddon)
        .filter(ShopAddon.slug == slug, ShopAddon.active.is_(True))
        .first()
    )
    if addon is None:
        raise HosterConfigurationError("Add-on ist unbekannt oder deaktiviert")
    return addon


def _resolve_plan_and_product(
    db: Session,
    integration: HosterIntegration,
    *,
    plan_id: int | None,
    product_key: str | None,
) -> tuple[ShopPlan | None, HosterProduct | None]:
    if plan_id is not None:
        if product_key is not None:
            norm = normalize_external_id(product_key, label="Produktkennung")
            if norm != f"plan:{plan_id}":
                raise HosterConfigurationError("plan_id und product_key widersprechen sich")
        plan = (
            db.query(ShopPlan)
            .filter(ShopPlan.id == plan_id, ShopPlan.active.is_(True))
            .first()
        )
        if plan is None:
            raise HosterConfigurationError("Shop-Tarif ist unbekannt oder deaktiviert")
        return plan, None

    if product_key is not None:
        norm = normalize_external_id(product_key, label="Produktkennung")
        if norm.startswith("plan:"):
            raw_id = norm[5:]
            if not raw_id.isdigit() or int(raw_id) <= 0:
                raise HosterConfigurationError("Ungueltige Tarif-Kennung")
            plan = (
                db.query(ShopPlan)
                .filter(ShopPlan.id == int(raw_id), ShopPlan.active.is_(True))
                .first()
            )
            if plan is None:
                raise HosterConfigurationError("Shop-Tarif ist unbekannt oder deaktiviert")
            return plan, None
        return None, get_product(db, integration, norm)

    return None, None


def _validate_slots_for_game_type(game_type: str, slots: int) -> None:
    from services import shop_slot_service

    players = shop_slot_service.get_blueprint_players(game_type)
    if players is None:
        raise HosterConfigurationError(
            "Dieser Blueprint unterstuetzt keine konfigurierbaren Spieler-Slots"
        )
    if not (players.min <= slots <= players.max):
        raise HosterConfigurationError(
            f"Spieler-Slots muessen zwischen {players.min} und {players.max} liegen"
        )


def _validate_server_item_params(
    *,
    plan: ShopPlan | None,
    product: HosterProduct | None,
    ram_mb: int | None,
    cpu_percent: int | None,
    slots: int | None,
    variables: dict[str, str] | None,
) -> int | None:
    """Prueft Ressourcen- und Variablenparameter gegen Tarif/Produkt und Blueprint."""
    if plan is not None:
        game_type = plan.game_type
        if ram_mb is not None:
            if plan.ram_included_mb is not None and ram_mb < plan.ram_included_mb:
                raise HosterConfigurationError(
                    "Angeforderter RAM liegt unter dem enthaltenen Tarif-Wert"
                )
            max_ram = plan.ram_max_mb if plan.ram_max_mb is not None else plan.ram_included_mb
            if max_ram is not None and ram_mb > max_ram:
                raise HosterConfigurationError(
                    "Angeforderter RAM uebersteigt das Tarif-Maximum"
                )
        if cpu_percent is not None:
            from services.node_capacity import normalize_cpu_limit_percent

            min_cpu = normalize_cpu_limit_percent(plan.cpu_included)
            max_cpu = (
                normalize_cpu_limit_percent(plan.cpu_max)
                if plan.cpu_max is not None
                else min_cpu
            )
            if min_cpu is not None and cpu_percent < min_cpu:
                raise HosterConfigurationError(
                    "Angeforderte CPU liegt unter dem enthaltenen Tarif-Wert"
                )
            if max_cpu is not None and cpu_percent > max_cpu:
                raise HosterConfigurationError(
                    "Angeforderte CPU uebersteigt das Tarif-Maximum"
                )
        eff_slots = slots if slots is not None else plan.slots_included
        if eff_slots is not None:
            _validate_slots_for_game_type(game_type, eff_slots)
        if slots is not None:
            if plan.slots_included is not None and slots < plan.slots_included:
                raise HosterConfigurationError(
                    "Angeforderte Slots liegen unter dem enthaltenen Tarif-Wert"
                )
            max_slots = (
                plan.slots_max if plan.slots_max is not None else plan.slots_included
            )
            if max_slots is not None and slots > max_slots:
                raise HosterConfigurationError(
                    "Angeforderte Slots uebersteigen das Tarif-Maximum"
                )
    elif product is not None:
        game_type = product.game_type
        if ram_mb is not None and product.ram_limit_mb is not None and ram_mb > product.ram_limit_mb:
            raise HosterConfigurationError(
                "Angeforderter RAM uebersteigt das Produkt-Maximum"
            )
        if (
            cpu_percent is not None
            and product.cpu_limit_percent is not None
            and cpu_percent > product.cpu_limit_percent
        ):
            raise HosterConfigurationError(
                "Angeforderte CPU uebersteigt das Produkt-Maximum"
            )
        eff_slots = slots
        if eff_slots is not None:
            _validate_slots_for_game_type(game_type, eff_slots)
    else:
        if slots is not None:
            raise HosterConfigurationError(
                "Ohne aktives Produkt koennen keine Slots gesetzt werden"
            )
        if variables:
            raise HosterConfigurationError(
                "Ohne aktives Produkt koennen keine Variablen gesetzt werden"
            )
        return None

    if variables:
        from services import server_variables_service

        try:
            server_variables_service.validate_blueprint_variables(
                game_type, dict(variables), is_operator=False
            )
        except server_variables_service.ServerVariableValidationError as exc:
            raise HosterConfigurationError(str(exc)) from exc

    return eff_slots


def _apply_slots_on_server(db: Session, server_id: int | None, slots: int | None) -> None:
    if server_id is None or slots is None:
        return
    from services import shop_slot_service

    server = db.query(Server).filter(Server.id == server_id).first()
    if server is None:
        return
    try:
        shop_slot_service.apply_server_slots(db, server, slots, commit_env=False)
    except shop_slot_service.SlotConfigurationError as exc:
        raise HosterConfigurationError(str(exc)) from exc


def _apply_variables_on_server(
    db: Session, server_id: int | None, variables: dict[str, str] | None
) -> None:
    if server_id is None or not variables:
        return
    from services import server_variables_service

    server = db.query(Server).filter(Server.id == server_id).first()
    if server is None:
        return
    db.flush()
    try:
        server_variables_service.update_server_variables(
            db, server, dict(variables), is_operator=False
        )
    except server_variables_service.ServerVariableValidationError as exc:
        raise HosterConfigurationError(str(exc)) from exc


def apply_desired_state(
    db: Session,
    *,
    integration: HosterIntegration,
    external_service_id: str,
    desired_state: str,
    external_subject: str,
    product_key: str | None = None,
    plan_id: int | None = None,
    ram_mb: int | None = None,
    cpu_percent: int | None = None,
    slots: int | None = None,
    variables: dict[str, str] | None = None,
    email: str | None = None,
    correlation_id: str | None = None,
    purge_immediately: bool = False,
) -> HosterService:
    """Bringt einen Server-Vertrag in den vom Shop gewuenschten Zustand.

    Der Aufruf ist wiederholbar: derselbe `external_service_id` fuehrt immer
    denselben Vertrag weiter. Fehler werden am Vertrag festgehalten
    (`status="failed"` plus stabiler Fehlercode), damit der Shop sie abfragen
    kann, statt sie nur als HTTP-Fehler zu sehen.
    """
    if desired_state not in DESIRED_STATES:
        raise HosterConfigurationError("Unbekannter Zielzustand")
    key = normalize_external_id(external_service_id, label="Service-Kennung")

    service = get_service(db, integration, key)
    if service is not None and service.item_kind != "server":
        raise HosterConfigurationError(
            "Service-Kennung gehoert zu einem Add-on-Vertrag und kann nicht als Server genutzt werden"
        )

    eff_slots: int | None = slots
    if service is None:
        if desired_state == "terminated":
            # Eine Kuendigung fuer einen nie angelegten Vertrag ist kein Fehler:
            # der gewuenschte Endzustand ist bereits erreicht.
            raise HosterConfigurationError("Unbekannter Service")
        identity = resolve_identity(
            db, integration=integration, external_subject=external_subject, email=email
        )
        if plan_id is None and not product_key:
            raise HosterConfigurationError(
                "Fuer einen neuen Service wird plan_id oder product_key benoetigt"
            )
        plan, product = _resolve_plan_and_product(
            db, integration, plan_id=plan_id, product_key=product_key
        )
        if desired_state != "terminated":
            eff_slots = _validate_server_item_params(
                plan=plan,
                product=product,
                ram_mb=ram_mb,
                cpu_percent=cpu_percent,
                slots=slots,
                variables=variables,
            )
        service = HosterService(
            integration_id=integration.id,
            external_service_id=key,
            identity_id=identity.id,
            item_kind="server",
            product_id=product.id if product is not None else None,
            shop_plan_id=plan.id if plan is not None else None,
            desired_state=desired_state,
            status="pending",
            correlation_id=correlation_id or str(uuid4()),
        )
        db.add(service)
        try:
            db.flush()
        except IntegrityError as exc:
            # Zwei gleichzeitige Erstaufrufe fuer denselben Vertrag. Der
            # Verlierer uebernimmt den Gewinner statt einen zweiten Server
            # anzulegen — genau die Zusage aus Zielpunkt 15.2.
            db.rollback()
            existing = get_service(db, integration, key)
            if existing is None:
                raise HosterConfigurationError("Service konnte nicht angelegt werden") from exc
            service = existing
        else:
            # Der Vertrag wird festgeschrieben, BEVOR die eigentliche
            # Zustandsaenderung versucht wird. Scheitert die Provisionierung,
            # bleibt so ein abfragbarer Vertrag mit `status="failed"` zurueck —
            # sonst wuerde der Rollback ihn mit entfernen und der Shop haette
            # keinerlei Anhaltspunkt, was mit seiner Bestellung passiert ist.
            db.commit()
            db.refresh(service)
    elif plan_id is not None or product_key:
        # Tarifwechsel: das Produkt bzw. der Shop-Plan wird uebernommen.
        # Ressourcenaenderungen an einem bereits laufenden Server bleiben eine
        # bewusste Operator-Aktion, weil sie den Server neu starten muessen.
        plan, product = _resolve_plan_and_product(
            db, integration, plan_id=plan_id, product_key=product_key
        )
        if desired_state != "terminated":
            eff_slots = _validate_server_item_params(
                plan=plan,
                product=product,
                ram_mb=ram_mb,
                cpu_percent=cpu_percent,
                slots=slots,
                variables=variables,
            )
        new_product_id = product.id if product is not None else None
        new_plan_id = plan.id if plan is not None else None
        if service.product_id != new_product_id or service.shop_plan_id != new_plan_id:
            # Die Beziehungen setzen, nicht nur die Fremdschluessel (`lazy="joined"`).
            service.product = product
            service.shop_plan = plan
            service.status_code = "product_changed_manual_resize_required"
    elif desired_state != "terminated":
        eff_slots = _validate_server_item_params(
            plan=service.shop_plan,
            product=service.product,
            ram_mb=ram_mb,
            cpu_percent=cpu_percent,
            slots=slots,
            variables=variables,
        )

    service.desired_state = desired_state
    service.updated_at = _now()

    try:
        if desired_state == "active":
            # Ganz zu Beginn und vor jeder Aenderung: eine Produktrolle, die die
            # Integration gar nicht vergeben darf, ist eine Fehlkonfiguration —
            # und die darf keinen halb fertigen Server hinterlassen.
            role_to_check = (
                service.shop_plan.role_id
                if service.shop_plan
                else (service.product.role_id if service.product else None)
            )
            ensure_role_is_delegatable(
                db,
                integration=integration,
                role_id=role_to_check,
            )
            if service.server_id is None:
                _provision(
                    db,
                    integration=integration,
                    service=service,
                    ram_mb=ram_mb,
                    cpu_percent=cpu_percent,
                )
            else:
                _set_status(service, "ready")
                _grant_customer_permissions(db, service)
            service.terminate_after = None
            service.suspended_at = None
            service.purge_reason = None
            service.purge_cycle_token = None
            _apply_slots_on_server(db, service.server_id, eff_slots)
            _apply_variables_on_server(db, service.server_id, variables)
            _apply_customer_role(db, service)
        elif desired_state == "suspended":
            # Gesperrt heisst: Server aus, Kundenrechte entzogen, Daten bleiben
            # bis zum konfigurierten Zahlungsverzugs-Limit. Der Panelaccount
            # des Kunden bleibt ausdruecklich bestehen.
            current = _now()
            if service.server_id is not None:
                _lifecycle(db, integration=integration, service=service, operation="stop")
                permission_service.set_user_server_permissions(
                    db, service.identity.user_id, service.server_id, [], granted_by=None
                )
            _apply_customer_role(db, service)
            if service.suspended_at is None:
                service.suspended_at = current
            service.purge_reason = "unpaid"
            if not service.purge_cycle_token:
                service.purge_cycle_token = str(uuid4())
            unpaid_days = shop_lifecycle_settings_service.resolve_hoster_unpaid_delete_days(
                integration, db=db
            )
            if unpaid_days > 0:
                if service.terminate_after is None:
                    service.terminate_after = current + timedelta(days=unpaid_days)
            else:
                service.terminate_after = None
            _set_status(service, "suspended")
        else:
            # Kuendigung: sperren und Schonfrist setzen (oder sofort zum Loeschen
            # freigeben, wenn `purge_immediately` uebermittelt wurde).
            current = _now()
            if service.server_id is not None:
                _lifecycle(db, integration=integration, service=service, operation="stop")
                permission_service.set_user_server_permissions(
                    db, service.identity.user_id, service.server_id, [], granted_by=None
                )
            _apply_customer_role(db, service)
            service.purge_reason = "voluntary_cancel"
            if not service.purge_cycle_token:
                service.purge_cycle_token = str(uuid4())
            service.terminate_after = (
                current
                if purge_immediately
                else current + timedelta(days=integration.terminate_grace_days)
            )
            _set_status(
                service, "terminating" if service.server_id is not None else "terminated"
            )
    except HTTPException as exc:
        db.rollback()
        _fail(db, integration=integration, service_id=service.id, code=_error_code(exc))
        raise
    except HosterRoleEscalation:
        # Bewusst laut und mit eigenem Code: eine still ausgelassene Rolle waere
        # genau der Fehler, um den es hier geht. Der Kunde haette einen
        # laufenden Vertrag ohne das Kontingent, fuer das er bezahlt hat, und
        # niemand haette einen Anhaltspunkt, warum.
        db.rollback()
        _fail(db, integration=integration, service_id=service.id, code=ROLE_ESCALATION_CODE)
        raise
    except HosterConfigurationError:
        db.rollback()
        _fail(db, integration=integration, service_id=service.id, code="hoster_configuration_error")
        raise
    except Exception:
        db.rollback()
        logger.exception("Hoster-Desired-State fehlgeschlagen (integration=%s)", integration.slug)
        _fail(db, integration=integration, service_id=service.id, code="hoster_internal_error")
        raise HTTPException(
            status_code=503,
            detail={"code": "hoster_internal_error", "message": "errors.hoster_internal_error"},
        )

    _record(
        db,
        integration=integration,
        service=service,
        action="hoster.service.applied",
        succeeded=True,
        extra={"item_kind": service.item_kind},
    )
    db.commit()
    db.refresh(service)
    _notify(db, integration=integration, service=service)
    return service


def _ensure_addon_role_allowed(
    db: Session, *, integration: HosterIntegration, role_id: int | None
) -> None:
    if role_id is None:
        return
    ensure_role_is_delegatable(db, integration=integration, role_id=role_id)
    from services import shop_fulfillment_service

    try:
        shop_fulfillment_service.ensure_shop_role_allowed(db, role_id)
    except shop_fulfillment_service.ShopRoleEscalationError as exc:
        raise HosterRoleEscalation(str(exc)) from exc


def apply_addon_desired_state(
    db: Session,
    *,
    integration: HosterIntegration,
    external_service_id: str,
    desired_state: str,
    external_subject: str,
    addon_slug: str | None,
    email: str | None = None,
    correlation_id: str | None = None,
) -> HosterService:
    """Bringt einen eigenstaendigen Add-on-Vertrag ohne Server in den Zielzustand."""
    if desired_state not in DESIRED_STATES:
        raise HosterConfigurationError("Unbekannter Zielzustand")
    key = normalize_external_id(external_service_id, label="Service-Kennung")

    service = get_service(db, integration, key)
    if service is not None and service.item_kind != "addon":
        raise HosterConfigurationError(
            "Service-Kennung gehoert zu einem Server-Vertrag und kann nicht als Add-on genutzt werden"
        )

    if service is None:
        if desired_state == "terminated":
            raise HosterConfigurationError("Unbekannter Service")
        identity = resolve_identity(
            db, integration=integration, external_subject=external_subject, email=email
        )
        if not addon_slug:
            raise HosterConfigurationError(
                "Fuer ein neues Add-on wird ein addon_slug benoetigt"
            )
        addon = _resolve_active_addon(db, addon_slug)
        service = HosterService(
            integration_id=integration.id,
            external_service_id=key,
            identity_id=identity.id,
            item_kind="addon",
            addon_id=addon.id,
            addon=addon,
            desired_state=desired_state,
            status="pending",
            correlation_id=correlation_id or str(uuid4()),
        )
        db.add(service)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            existing = get_service(db, integration, key)
            if existing is None:
                raise HosterConfigurationError("Add-on-Service konnte nicht angelegt werden") from exc
            service = existing
        else:
            db.commit()
            db.refresh(service)
    elif addon_slug:
        addon = _resolve_active_addon(db, addon_slug)
        if service.addon_id != addon.id:
            service.addon_id = addon.id
            service.addon = addon

    service.desired_state = desired_state
    service.updated_at = _now()

    try:
        if desired_state == "active":
            _ensure_addon_role_allowed(
                db,
                integration=integration,
                role_id=service.addon.role_id if service.addon is not None else None,
            )
            _set_status(service, "ready")
            service.status_code = None
            service.terminate_after = None
            _apply_customer_role(db, service)
        elif desired_state == "suspended":
            _apply_customer_role(db, service)
            _set_status(service, "suspended")
        else:
            _apply_customer_role(db, service)
            service.terminate_after = _now() + timedelta(
                days=integration.terminate_grace_days
            )
            _set_status(service, "terminated")
    except HosterRoleEscalation:
        db.rollback()
        _fail(db, integration=integration, service_id=service.id, code=ROLE_ESCALATION_CODE)
        raise
    except HosterConfigurationError:
        db.rollback()
        _fail(db, integration=integration, service_id=service.id, code="hoster_configuration_error")
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Hoster-Add-on-Desired-State fehlgeschlagen (integration=%s)",
            integration.slug,
        )
        _fail(db, integration=integration, service_id=service.id, code="hoster_internal_error")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "hoster_internal_error",
                "message": "errors.hoster_internal_error",
            },
        )

    _record(
        db,
        integration=integration,
        service=service,
        action="hoster.service.applied",
        succeeded=True,
        extra={
            "item_kind": "addon",
            "addon_slug": service.addon.slug if service.addon is not None else None,
        },
    )
    db.commit()
    db.refresh(service)
    _notify(db, integration=integration, service=service)
    return service


def apply_batch(
    db: Session,
    *,
    integration: HosterIntegration,
    payload: HosterApplyRequest,
    idempotency_key: str | None = None,
) -> tuple[str, list[HosterService]]:
    """Pre-validiert und setzt einen Sammelauftrag aus Servern und Add-ons um."""
    batch_correlation_id = str(uuid4())
    _actor(db, integration, batch_correlation_id)

    for item in payload.items:
        key = normalize_external_id(item.external_service_id, label="Service-Kennung")
        effective_state = item.desired_state or payload.desired_state
        if effective_state not in DESIRED_STATES:
            raise HosterConfigurationError("Unbekannter Zielzustand")

        existing = get_service(db, integration, key)
        if existing is not None and existing.item_kind != item.kind:
            raise HosterConfigurationError(
                f"hoster_item_kind_mismatch: Service '{key}' ist bereits vom Typ '{existing.item_kind}'"
            )
        if existing is None and effective_state == "terminated":
            raise HosterConfigurationError("Unbekannter Service")

        if item.kind == "server":
            if item.plan_id is not None or item.product_key:
                plan, product = _resolve_plan_and_product(
                    db,
                    integration,
                    plan_id=item.plan_id,
                    product_key=item.product_key,
                )
            elif existing is not None:
                plan = existing.shop_plan
                product = existing.product
            else:
                raise HosterConfigurationError(
                    "Fuer einen neuen Service wird plan_id oder product_key benoetigt"
                )
            if effective_state != "terminated":
                _validate_server_item_params(
                    plan=plan,
                    product=product,
                    ram_mb=item.ram_mb,
                    cpu_percent=item.cpu_percent,
                    slots=item.slots,
                    variables=item.variables,
                )
        else:
            if item.addon_slug:
                _resolve_active_addon(db, item.addon_slug)
            elif existing is None:
                raise HosterConfigurationError(
                    "Fuer ein neues Add-on wird ein addon_slug benoetigt"
                )

    services: list[HosterService] = []
    for item in payload.items:
        effective_state = item.desired_state or payload.desired_state
        if item.kind == "server":
            svc = apply_desired_state(
                db,
                integration=integration,
                external_service_id=item.external_service_id,
                desired_state=effective_state,
                external_subject=payload.external_subject,
                product_key=item.product_key,
                plan_id=item.plan_id,
                ram_mb=item.ram_mb,
                cpu_percent=item.cpu_percent,
                email=payload.email,
                slots=item.slots,
                variables=item.variables,
                correlation_id=batch_correlation_id,
                purge_immediately=item.purge_immediately,
            )
        else:
            svc = apply_addon_desired_state(
                db,
                integration=integration,
                external_service_id=item.external_service_id,
                desired_state=effective_state,
                external_subject=payload.external_subject,
                addon_slug=item.addon_slug,
                email=payload.email,
                correlation_id=batch_correlation_id,
            )
        services.append(svc)

    if idempotency_key:
        audit_service.record_privileged_action(
            db,
            user_id=integration.service_user_id,
            action="hoster.batch.applied",
            target_type="hoster_integration",
            target_id=integration.id,
            details={
                "integration": integration.slug,
                "idempotency_key": idempotency_key[:128],
                "item_count": len(services),
            },
            origin="external",
            correlation_id=batch_correlation_id,
        )
        db.commit()

    return batch_correlation_id, services


def _error_code(exc: HTTPException) -> str:
    if isinstance(exc.detail, dict):
        code = exc.detail.get("code")
        if isinstance(code, str) and code:
            return code[:64]
    return f"http_{exc.status_code}"


def _fail(db: Session, *, integration: HosterIntegration, service_id: int, code: str) -> None:
    """Haelt einen Fehlschlag am Vertrag fest, ohne den urspruenglichen Fehler zu verlieren."""
    try:
        service = db.query(HosterService).filter(HosterService.id == service_id).first()
        if service is None:
            return
        _set_status(service, "failed")
        service.status_code = code
        service.updated_at = _now()
        _record(
            db,
            integration=integration,
            service=service,
            action="hoster.service.failed",
            succeeded=False,
            extra={"error_code": code},
        )
        db.commit()
        _notify(db, integration=integration, service=service)
    except Exception:
        db.rollback()
        logger.warning("Fehlerstatus des Hoster-Service konnte nicht gespeichert werden")


def _notify(db: Session, *, integration: HosterIntegration, service: HosterService) -> None:
    """Stellt eine Zustandsaenderung fuer den Shop-Webhook ein (best effort)."""
    try:
        from services.hoster_webhook_service import enqueue_service_event

        enqueue_service_event(db, integration=integration, service=service)
    except Exception:
        db.rollback()
        logger.warning("Hoster-Webhook konnte nicht eingestellt werden (service_id=%s)", service.id)


def purge_terminated_services(db: Session, *, now: datetime | None = None) -> int:
    """Loescht Server gekuendigter oder wegen Zahlungsverzug abgelaufener Vertraege.

    Bewusst als eigener Lauf: eine Kuendigung oder Zahlungssperre vernichtet
    nicht sofort alle Daten, sondern erst nach Ablauf von `terminate_after`.
    """
    from sqlalchemy import or_

    current = now or _now()
    due = (
        db.query(HosterService)
        .filter(
            or_(
                HosterService.status == "terminating",
                (HosterService.status == "suspended")
                & (HosterService.purge_reason == "unpaid"),
            ),
            HosterService.terminate_after.isnot(None),
            HosterService.terminate_after <= current,
        )
        .with_for_update(of=HosterService, skip_locked=True)
        .all()
    )
    purged = 0
    for service in due:
        integration = (
            db.query(HosterIntegration)
            .filter(HosterIntegration.id == service.integration_id)
            .first()
        )
        if integration is None:
            continue
        server_id = service.server_id
        try:
            if service.desired_state == "active":
                continue
            if (
                server_id is not None
                and lifecycle_purge_service.has_other_active_contract_for_server(
                    db, server_id, exclude_hoster_service_id=service.id
                )
            ):
                service.terminate_after = None
                db.commit()
                continue

            if server_id is not None:
                from services.server_deletion_service import delete_server_completely

                # Derselbe Loeschpfad wie im Panel — inklusive erneuter
                # Rechtepruefung gegen den Dienstbenutzer der Integration.
                delete_server_completely(
                    db,
                    server_id=server_id,
                    actor=_actor(db, integration, service.correlation_id),
                )
            service.server_id = None
            service.desired_state = "terminated"
            _set_status(service, "terminated")
            service.status_code = None
            service.terminate_after = None
            service.purged_at = current
            service.updated_at = current
            _apply_customer_role(db, service)
            _record(
                db,
                integration=integration,
                service=service,
                action="hoster.service.terminated",
                succeeded=True,
                extra={"reason": service.purge_reason or "voluntary_cancel"},
            )
            db.commit()
            _notify(db, integration=integration, service=service)
            purged += 1
        except Exception:
            db.rollback()
            logger.warning(
                "Abgelaufener Hoster-Service konnte nicht geloescht werden (service_id=%s)",
                service.id,
            )
    return purged
