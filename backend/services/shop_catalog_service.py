"""Katalog-Dienst des nativen Shops: Plaene, Preise und Artwork.

Der Dienst validiert gegen Blueprint-Registry, Nodes und Rollen. Bilder werden
nicht kopiert: Der bestehende ``wallpaper_service`` bleibt die einzige Quelle
fuer Custom-Galerie und Steam-Artwork.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
import time
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import Node, Role, ShopOrder, ShopOrderItem, ShopPlan
from schemas.shop import (
    ShopArtworkResponse,
    ShopCatalogPlan,
    ShopNodePingResponse,
    ShopPlanResponse,
    ShopPlanUpdate,
    ShopPlanWrite,
    ShopPublicNodeStatusResponse,
    ShopSteamBranchInfo,
)
from services import audit_service, steam_metadata_service, wallpaper_service


_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


class ShopConfigurationError(ValueError):
    """Ungueltige Tarif-Konfiguration; wird am Rand zu 422."""


def _validate_plan_values(
    db: Session, values: dict[str, Any], *, existing_plan: ShopPlan | None = None
) -> None:
    game_type = values.get("game_type")
    if game_type is None and existing_plan is not None:
        game_type = existing_plan.game_type

    blueprint = None
    if game_type is not None:
        from games import get_plugin

        plugin = get_plugin(game_type)
        if plugin is None:
            raise ShopConfigurationError("Unbekannter Blueprint bzw. Spieltyp")
        blueprint = plugin.get_blueprint()

    currency = values.get("currency")
    if currency is not None:
        if not _CURRENCY_RE.fullmatch(currency):
            raise ShopConfigurationError("Waehrung muss ein dreistelliger ISO-Code sein")
        if currency != "EUR":
            raise ShopConfigurationError("Aktuell wird nur EUR unterstuetzt")

    node_id = values.get("node_id")
    if node_id is not None and db.query(Node).filter(Node.id == node_id).first() is None:
        raise ShopConfigurationError("Zugeordnete Node existiert nicht")

    role_id = values.get("role_id")
    if role_id is not None:
        from services import shop_fulfillment_service

        try:
            shop_fulfillment_service.ensure_shop_role_allowed(db, role_id)
        except shop_fulfillment_service.ShopRoleEscalationError as exc:
            raise ShopConfigurationError(str(exc)) from exc

    def _eff(feld: str) -> Any:
        if feld in values:
            return values[feld]
        return getattr(existing_plan, feld, None) if existing_plan is not None else None

    for included_key, max_key, label in (
        ("ram_included_mb", "ram_max_mb", "RAM"),
        ("cpu_included", "cpu_max", "CPU"),
        ("slots_included", "slots_max", "Slots"),
        ("disk_included_gb", "disk_max_gb", "Speicher"),
    ):
        included = _eff(included_key)
        maximum = _eff(max_key)
        if included is not None and maximum is not None and maximum < included:
            raise ShopConfigurationError(
                f"Das Maximum fuer {label} darf nicht unter dem enthaltenen Wert liegen"
            )

    if blueprint is not None:
        slots_included = _eff("slots_included")
        slots_max = _eff("slots_max")
        slot_step_price = _eff("price_per_slot_step_cents") or 0
        players = getattr(blueprint, "players", None)
        if players is None:
            if slot_step_price > 0 or slots_included is not None or slots_max is not None:
                raise ShopConfigurationError(
                    "Dieser Blueprint unterstuetzt keine konfigurierbaren Spieler-Slots"
                )
        else:
            for val in (slots_included, slots_max):
                if val is not None and not (players.min <= int(val) <= players.max):
                    raise ShopConfigurationError(
                        f"Spieler-Slots muessen zwischen {players.min} und {players.max} liegen"
                    )


def _apply(plan: ShopPlan, values: dict[str, Any]) -> None:
    for feld, wert in values.items():
        if feld == "promo_highlight_text" and isinstance(wert, str):
            wert = wert.strip()[:80] or None
        setattr(plan, feld, wert)


def _audit(db: Session, actor_id: int, action: str, plan: ShopPlan, extra: dict | None = None) -> None:
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action=action,
        target_type="shop_plan",
        target_id=plan.id,
        details={
            "game_type": plan.game_type,
            "name": plan.name,
            "price_cents": plan.price_cents,
            "active": plan.active,
            **(extra or {}),
        },
    )


def list_plans(db: Session, *, active_only: bool = False) -> list[ShopPlan]:
    query = db.query(ShopPlan)
    if active_only:
        query = query.filter(ShopPlan.active.is_(True))
    return query.order_by(ShopPlan.sort_order.asc(), ShopPlan.name.asc()).all()


def get_plan(db: Session, plan_id: int) -> ShopPlan | None:
    return db.query(ShopPlan).filter(ShopPlan.id == plan_id).first()


def create_plan(db: Session, payload: ShopPlanWrite, *, actor_id: int) -> ShopPlan:
    values = payload.model_dump()
    if isinstance(values.get("promo_highlight_text"), str):
        values["promo_highlight_text"] = values["promo_highlight_text"].strip()[:80] or None
    _validate_plan_values(db, values)
    plan = ShopPlan(**values)
    db.add(plan)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError(
            "Ein Tarif mit diesem Namen existiert fuer dieses Spiel bereits"
        ) from exc
    _audit(db, actor_id, "shop.plan.created", plan)
    db.commit()
    db.refresh(plan)
    steam_metadata_service.ensure_steam_metadata_background(
        _game_meta(plan.game_type).get("steam_app_id")
    )
    return plan


_NULLABLE_FIELDS = {
    "description",
    "lifetime_price_cents",
    "ram_included_mb",
    "ram_max_mb",
    "ram_step_mb",
    "cpu_included",
    "cpu_max",
    "slots_included",
    "slots_max",
    "disk_included_gb",
    "disk_max_gb",
    "node_id",
    "role_id",
    "promo_highlight_text",
}


def update_plan(
    db: Session, plan: ShopPlan, payload: ShopPlanUpdate, *, actor_id: int
) -> ShopPlan:
    rohe = payload.model_dump(exclude_unset=True)
    # Explizites JSON-null darf nur nullable Felder leeren; ein null fuer
    # price_cents/active/... waere sonst ein Datenbankfehler statt einer Absage.
    values = {
        feld: wert
        for feld, wert in rohe.items()
        if wert is not None or feld in _NULLABLE_FIELDS
    }
    _validate_plan_values(db, values, existing_plan=plan)
    _apply(plan, values)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ShopConfigurationError(
            "Ein Tarif mit diesem Namen existiert fuer dieses Spiel bereits"
        ) from exc
    _audit(db, actor_id, "shop.plan.updated", plan)
    db.commit()
    db.refresh(plan)
    steam_metadata_service.ensure_steam_metadata_background(
        _game_meta(plan.game_type).get("steam_app_id")
    )
    return plan


def delete_plan(db: Session, plan: ShopPlan, *, actor_id: int) -> None:
    _audit(db, actor_id, "shop.plan.deleted", plan)
    db.delete(plan)
    db.commit()


def upload_plan_artwork(
    db: Session,
    plan: ShopPlan,
    *,
    raw_bytes: bytes,
    uploaded_by: str,
    actor_id: int,
) -> ShopPlan:
    """Nimmt ein eigenes Spielbild auf und setzt den Plan auf ``custom``.

    Die Bytes laufen durch dieselbe Sanitisierung und Galerie wie die
    Server-Titelbilder. Es entsteht keine zweite Upload-Ablage.
    """
    webp = wallpaper_service.sanitize_and_compress_wallpaper(raw_bytes)
    zeile = wallpaper_service.store_wallpaper(
        db, plan.game_type, webp, uploaded_by
    )
    plan.artwork_mode = "custom"
    _audit(
        db,
        actor_id,
        "shop.plan.artwork.uploaded",
        plan,
        {"wallpaper_id": zeile.id},
    )
    db.commit()
    db.refresh(plan)
    return plan


def reset_plan_artwork(db: Session, plan: ShopPlan, *, actor_id: int) -> ShopPlan:
    wallpaper_service.reset_wallpaper(db, plan.game_type)
    plan.artwork_mode = "steam"
    _audit(db, actor_id, "shop.plan.artwork.reset", plan)
    db.commit()
    db.refresh(plan)
    return plan


def delete_plan_gallery_item(
    db: Session, plan: ShopPlan, wallpaper_id: int, *, actor_id: int
) -> ShopPlan:
    """Entfernt ein einzelnes hochgeladenes Galeriebild eines Tarif-Spiels."""
    items = wallpaper_service.get_gallery(db, plan.game_type)
    if not any(item.id == wallpaper_id for item in items):
        raise ShopConfigurationError("Galeriebild fuer dieses Spiel nicht gefunden")
    wallpaper_service.delete_wallpaper(db, plan.game_type, wallpaper_id)
    remaining = wallpaper_service.get_gallery(db, plan.game_type)
    if remaining and not any(item.is_active for item in remaining) and plan.artwork_mode == "custom":
        wallpaper_service.set_active_wallpaper(db, plan.game_type, remaining[0].id)
    elif not remaining and plan.artwork_mode == "custom":
        has_steam = (
            wallpaper_service.artwork_app_id_for_blueprint(
                wallpaper_service._blueprint_for_game_type(plan.game_type)
            )
            is not None
        )
        plan.artwork_mode = "steam" if has_steam else "none"
    _audit(
        db,
        actor_id,
        "shop.plan.artwork.deleted",
        plan,
        {"wallpaper_id": wallpaper_id},
    )
    db.commit()
    db.refresh(plan)
    return plan


def activate_plan_gallery_item(
    db: Session, plan: ShopPlan, wallpaper_id: int, *, actor_id: int
) -> ShopPlan:
    """Markiert ein vorhandenes Galeriebild als primaeres Tarif-Cover."""
    items = wallpaper_service.get_gallery(db, plan.game_type)
    if not any(item.id == wallpaper_id for item in items):
        raise ShopConfigurationError("Galeriebild fuer dieses Spiel nicht gefunden")
    wallpaper_service.set_active_wallpaper(db, plan.game_type, wallpaper_id)
    plan.artwork_mode = "custom"
    _audit(
        db,
        actor_id,
        "shop.plan.artwork.activated",
        plan,
        {"wallpaper_id": wallpaper_id},
    )
    db.commit()
    db.refresh(plan)
    return plan


def _artwork(db: Session, plan: ShopPlan) -> ShopArtworkResponse:
    descriptor = wallpaper_service.resolve_plan_artwork(
        db,
        plan.game_type,
        plan.artwork_mode,
        base_url=f"/api/shop/artwork/{plan.game_type}",
    )
    return ShopArtworkResponse(
        source=descriptor.source, url=descriptor.url, version=descriptor.version
    )


def plan_response(
    db: Session, plan: ShopPlan, *, recent_order_count: int = 0
) -> ShopPlanResponse:
    return ShopPlanResponse(
        id=plan.id,
        game_type=plan.game_type,
        name=plan.name,
        description=plan.description,
        price_cents=plan.price_cents,
        lifetime_price_cents=getattr(plan, "lifetime_price_cents", None),
        allow_game_switch=bool(getattr(plan, "allow_game_switch", True)),
        allow_short_durations=bool(getattr(plan, "allow_short_durations", True)),
        currency=plan.currency,
        billing_interval=plan.billing_interval,
        tax_rate_percent=plan.tax_rate_percent,
        ram_included_mb=plan.ram_included_mb,
        ram_max_mb=plan.ram_max_mb,
        ram_step_mb=plan.ram_step_mb,
        price_per_ram_step_cents=plan.price_per_ram_step_cents,
        cpu_included=plan.cpu_included,
        cpu_max=plan.cpu_max,
        cpu_step=plan.cpu_step,
        price_per_cpu_step_cents=plan.price_per_cpu_step_cents,
        slots_included=plan.slots_included,
        slots_max=plan.slots_max,
        slots_step=plan.slots_step,
        price_per_slot_step_cents=plan.price_per_slot_step_cents,
        disk_included_gb=getattr(plan, "disk_included_gb", None),
        disk_max_gb=getattr(plan, "disk_max_gb", None),
        disk_step_gb=int(getattr(plan, "disk_step_gb", 10) or 10),
        price_per_disk_step_cents=int(getattr(plan, "price_per_disk_step_cents", 0) or 0),
        node_id=plan.node_id,
        role_id=plan.role_id,
        artwork_mode=plan.artwork_mode,
        active=plan.active,
        sort_order=plan.sort_order,
        is_featured=bool(getattr(plan, "is_featured", False)),
        is_bestseller=bool(getattr(plan, "is_bestseller", False)),
        is_new=bool(getattr(plan, "is_new", False)),
        pinned_in_hero=bool(getattr(plan, "pinned_in_hero", False)),
        promo_highlight_text=(getattr(plan, "promo_highlight_text", None) or None),
        recent_order_count=max(0, int(recent_order_count)),
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        artwork=_artwork(db, plan),
    )


def _estimate_setup_seconds(blueprint: Any) -> int:
    category = str(getattr(getattr(blueprint, "meta", None), "category", "") or "").lower()
    src_type = str(getattr(getattr(blueprint, "source", None), "type", "") or "").lower()
    if "database" in category or "dockeronly" in src_type:
        return 20
    if "voice" in category:
        return 30
    if "http" in src_type or "github" in src_type:
        return 60
    if "steam" in src_type or "steam" in category:
        return 180
    return 120


def _game_meta(game_type: str) -> dict[str, Any]:
    from games import get_plugin

    plugin = get_plugin(game_type)
    if plugin is None:
        return {}
    blueprint = plugin.get_blueprint()
    mods = blueprint.effective_mods()
    steam_src = getattr(getattr(blueprint, "source", None), "steam", None)
    steam_app_id = wallpaper_service.artwork_app_id_for_blueprint(blueprint)
    available_branches = (
        [
            ShopSteamBranchInfo(
                id=branch.id,
                label=branch.label,
                description=branch.description,
                requires_password=branch.requiresPassword,
            )
            for branch in steam_src.effective_branches()
        ]
        if steam_src is not None
        else []
    )
    return {
        "game_name": blueprint.meta.name,
        "game_description": blueprint.meta.description,
        "game_tagline": getattr(blueprint.meta, "shopTagline", None),
        "shop_story": getattr(blueprint.meta, "shopStory", None),
        "steam_app_id": steam_app_id,
        "available_branches": available_branches,
        "game_category": blueprint.meta.category.value,
        "supports_mods": bool(mods.supportsMods),
        "supports_workshop": bool(mods.supportsSteamWorkshop),
        "supports_slots": getattr(blueprint, "players", None) is not None,
        "estimated_setup_seconds": _estimate_setup_seconds(blueprint),
        "platforms": [str(p) for p in (getattr(blueprint.meta, "platforms", None) or ["pc"])],
    }


def _plan_hardware_summary(db: Session, plan: ShopPlan) -> tuple[str | None, str | None, str | None]:
    from services.node_placement_service import OFFLINE_NODE_STATUSES

    if plan.node_id is not None:
        node = (
            db.query(Node)
            .filter(Node.id == plan.node_id, Node.shop_enabled.is_(True))
            .first()
        )
        if node is None:
            return None, None, None
        cpu = (
            getattr(node, "cpu_model", None) or None
            if bool(getattr(node, "shop_show_cpu", True))
            else None
        )
        return (
            cpu,
            getattr(node, "ram_type", None) or None,
            getattr(node, "storage_type", None) or None,
        )

    nodes = [
        n
        for n in db.query(Node)
        .filter(Node.shop_enabled.is_(True))
        .order_by(Node.id.asc())
        .all()
        if (n.status or "").strip().lower() not in OFFLINE_NODE_STATUSES
    ]
    if not nodes:
        return None, None, None

    def _unanimous(attr: str) -> str | None:
        vals = {
            str(getattr(n, attr, None) or "").strip() or None
            for n in nodes
        }
        vals.discard(None)
        if len(vals) == 1 and all((str(getattr(n, attr, None) or "").strip() or None) is not None for n in nodes):
            return next(iter(vals))
        return None

    show_cpu_all = all(bool(getattr(n, "shop_show_cpu", True)) for n in nodes)
    return (
        _unanimous("cpu_model") if show_cpu_all else None,
        _unanimous("ram_type"),
        _unanimous("storage_type"),
    )


def _plan_ddos_summary(db: Session, plan: ShopPlan) -> tuple[str | None, str | None, bool]:
    from services.node_placement_service import OFFLINE_NODE_STATUSES

    if plan.node_id is not None:
        node = (
            db.query(Node)
            .filter(Node.id == plan.node_id, Node.shop_enabled.is_(True))
            .first()
        )
        if node is None:
            return None, None, False
        return (
            getattr(node, "ddos_provider", None) or None,
            getattr(node, "ddos_profile", None) or None,
            bool(getattr(node, "ddos_game_aware", False)),
        )

    nodes = [
        n
        for n in db.query(Node)
        .filter(Node.shop_enabled.is_(True))
        .order_by(Node.id.asc())
        .all()
        if (n.status or "").strip().lower() not in OFFLINE_NODE_STATUSES
    ]
    if not nodes:
        return None, None, False

    game_aware = all(bool(getattr(n, "ddos_game_aware", False)) for n in nodes)

    def _unanimous(attr: str) -> str | None:
        vals = {str(getattr(n, attr, None) or "").strip() or None for n in nodes}
        vals.discard(None)
        if len(vals) == 1 and all((str(getattr(n, attr, None) or "").strip() or None) is not None for n in nodes):
            return next(iter(vals))
        return None

    return _unanimous("ddos_provider"), _unanimous("ddos_profile"), game_aware


def public_node_statuses(db: Session) -> list[ShopPublicNodeStatusResponse]:
    """Oeffentliche Node-Kapazitaets- & Hardware-Statusliste ohne IPs/Secrets."""
    from services.node_capacity import normalize_ram_mb
    from services.node_placement_service import OFFLINE_NODE_STATUSES, evaluate_node_capacity, _reserved_ram_mb

    nodes = (
        db.query(Node)
        .filter(Node.shop_enabled.is_(True))
        .order_by(Node.id.asc())
        .all()
    )
    out: list[ShopPublicNodeStatusResponse] = []
    for node in nodes:
        status_norm = (node.status or "unknown").strip().lower()
        check = evaluate_node_capacity(db, node)

        ram_free_pct: int | None = None
        total_ram = normalize_ram_mb(node.ram_total)
        if total_ram is not None and check.remaining_ram_mb is not None:
            alloc_budget = max(0, total_ram - _reserved_ram_mb())
            if alloc_budget > 0:
                ram_free_pct = max(0, min(100, round(check.remaining_ram_mb * 100 / alloc_budget)))
            else:
                ram_free_pct = 0

        if status_norm in OFFLINE_NODE_STATUSES:
            load_level = "offline"
            accepting = False
        elif not check.fits or (ram_free_pct is not None and ram_free_pct < 5):
            load_level = "full"
            accepting = False
        elif ram_free_pct is not None and ram_free_pct < 25:
            load_level = "high"
            accepting = True
        elif ram_free_pct is not None and ram_free_pct < 60:
            load_level = "medium"
            accepting = True
        else:
            load_level = "low"
            accepting = True

        show_cpu = bool(getattr(node, "shop_show_cpu", True))
        surcharge_cents = max(0, int(getattr(node, "shop_surcharge_cents", 0) or 0))
        out.append(
            ShopPublicNodeStatusResponse(
                id=node.id,
                name=node.name,
                location_label=getattr(node, "location_label", None) or None,
                status=node.status or "unknown",
                cpu_model=(getattr(node, "cpu_model", None) or None) if show_cpu else None,
                ram_type=getattr(node, "ram_type", None) or None,
                storage_type=getattr(node, "storage_type", None) or None,
                hardware_tier_label=getattr(node, "hardware_tier_label", None) or None,
                shop_surcharge_cents=surcharge_cents,
                ram_free_percent=ram_free_pct,
                load_level=load_level,  # type: ignore[arg-type]
                accepting_orders=accepting,
                public_ping_url=getattr(node, "public_ping_url", None) or None,
                ddos_provider=getattr(node, "ddos_provider", None) or None,
                ddos_profile=getattr(node, "ddos_profile", None) or None,
                ddos_game_aware=bool(getattr(node, "ddos_game_aware", False)),
            )
        )
    return out


def ping_public_node(db: Session, node_id: int) -> ShopNodePingResponse | None:
    """Misst die serverseitige RTT zum Node-Agenten, ohne interne URLs offenzulegen."""
    from services import node_service
    from services.node_placement_service import OFFLINE_NODE_STATUSES

    node = (
        db.query(Node)
        .filter(Node.id == node_id, Node.shop_enabled.is_(True))
        .first()
    )
    if node is None:
        return None
    now_ms = int(time.time() * 1000)
    status_norm = (node.status or "unknown").strip().lower()
    if status_norm in OFFLINE_NODE_STATUSES:
        return ShopNodePingResponse(
            node_id=node.id,
            status=node.status or "offline",
            server_agent_rtt_ms=None,
            timestamp_ms=now_ms,
        )
    if node.is_local:
        return ShopNodePingResponse(
            node_id=node.id,
            status=node.status or "online",
            server_agent_rtt_ms=0.0,
            timestamp_ms=now_ms,
        )

    client = node_service.client_for_node(node)
    if client is None:
        return ShopNodePingResponse(
            node_id=node.id,
            status="unreachable",
            server_agent_rtt_ms=None,
            timestamp_ms=now_ms,
        )
    started = time.perf_counter()
    try:
        client.health()
        rtt_ms = round((time.perf_counter() - started) * 1000.0, 1)
        return ShopNodePingResponse(
            node_id=node.id,
            status="online",
            server_agent_rtt_ms=rtt_ms,
            timestamp_ms=now_ms,
        )
    except Exception:
        return ShopNodePingResponse(
            node_id=node.id,
            status="unreachable",
            server_agent_rtt_ms=None,
            timestamp_ms=now_ms,
        )


def recent_paid_order_counts(db: Session, *, days: int = 90) -> dict[int, int]:
    """Zaehlt bezahlte Plan-Bestellungen je plan_id innerhalb der letzten N Tage."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    rows = (
        db.query(
            ShopOrderItem.plan_id,
            func.coalesce(func.sum(ShopOrderItem.quantity), 0),
        )
        .join(ShopOrder, ShopOrderItem.order_id == ShopOrder.id)
        .filter(
            ShopOrder.status == "paid",
            ShopOrderItem.kind == "plan",
            ShopOrderItem.plan_id.is_not(None),
            func.coalesce(ShopOrder.paid_at, ShopOrder.created_at) >= cutoff,
        )
        .group_by(ShopOrderItem.plan_id)
        .all()
    )
    return {
        int(plan_id): int(total)
        for plan_id, total in rows
        if plan_id is not None and int(total or 0) > 0
    }


def catalog_plan(
    db: Session, plan: ShopPlan, *, recent_order_count: int = 0
) -> ShopCatalogPlan:
    from services import node_placement_service

    meta = _game_meta(plan.game_type)
    steam_app_id = meta.get("steam_app_id")
    cached_steam = (
        steam_metadata_service.get_cached_metadata(db, steam_app_id)
        if steam_app_id
        else {}
    )
    if steam_app_id and not cached_steam:
        steam_metadata_service.ensure_steam_metadata_background(steam_app_id)

    plan_override = (plan.description or "").strip() or None
    bp_story = meta.get("shop_story")
    bp_desc = meta.get("game_description")
    steam_de = (cached_steam.get("de") or {}).get("short_description")
    steam_en = (cached_steam.get("en") or {}).get("short_description")
    game_story_de = plan_override or bp_story or steam_de or steam_en or bp_desc
    game_story_en = plan_override or bp_story or steam_en or steam_de or bp_desc
    genres = list(
        (cached_steam.get("de") or {}).get("genres")
        or (cached_steam.get("en") or {}).get("genres")
        or []
    )

    availability = node_placement_service.check_plan_availability(
        db, plan, shop_only=True
    )
    is_available = availability.available or any(
        n.available for n in availability.nodes
    )
    cpu_model, ram_type, storage_type = _plan_hardware_summary(db, plan)
    ddos_provider, ddos_profile, ddos_game_aware = _plan_ddos_summary(db, plan)
    return ShopCatalogPlan(
        id=plan.id,
        game_type=plan.game_type,
        game_name=meta.get("game_name") or plan.game_type,
        game_description=bp_desc,
        game_tagline=meta.get("game_tagline"),
        game_story_de=game_story_de,
        game_story_en=game_story_en,
        genres=genres,
        steam_app_id=steam_app_id,
        available_branches=list(meta.get("available_branches") or []),
        game_category=meta.get("game_category") or "",
        supports_mods=bool(meta.get("supports_mods")),
        supports_workshop=bool(meta.get("supports_workshop")),
        supports_slots=bool(meta.get("supports_slots")),
        name=plan.name,
        description=plan.description,
        price_cents=plan.price_cents,
        lifetime_price_cents=getattr(plan, "lifetime_price_cents", None),
        allow_game_switch=bool(getattr(plan, "allow_game_switch", True)),
        allow_short_durations=bool(getattr(plan, "allow_short_durations", True)),
        currency=plan.currency,
        billing_interval=plan.billing_interval,
        tax_rate_percent=plan.tax_rate_percent,
        ram_included_mb=plan.ram_included_mb,
        ram_max_mb=plan.ram_max_mb,
        ram_step_mb=plan.ram_step_mb,
        price_per_ram_step_cents=plan.price_per_ram_step_cents,
        cpu_included=plan.cpu_included,
        cpu_max=plan.cpu_max,
        cpu_step=plan.cpu_step,
        price_per_cpu_step_cents=plan.price_per_cpu_step_cents,
        slots_included=plan.slots_included,
        slots_max=plan.slots_max,
        slots_step=plan.slots_step,
        price_per_slot_step_cents=plan.price_per_slot_step_cents,
        disk_included_gb=getattr(plan, "disk_included_gb", None),
        disk_max_gb=getattr(plan, "disk_max_gb", None),
        disk_step_gb=int(getattr(plan, "disk_step_gb", 10) or 10),
        price_per_disk_step_cents=int(getattr(plan, "price_per_disk_step_cents", 0) or 0),
        artwork=_artwork(db, plan),
        available=is_available,
        availability_reason=None if is_available else availability.reason,
        max_available_ram_mb=availability.max_ram_mb,
        max_available_cpu=availability.max_cpu,
        hardware_cpu_model=cpu_model,
        hardware_ram_type=ram_type,
        hardware_storage_type=storage_type,
        estimated_setup_seconds=int(meta.get("estimated_setup_seconds") or 120),
        platforms=list(meta.get("platforms") or ["pc"]),
        ddos_provider=ddos_provider,
        ddos_profile=ddos_profile,
        ddos_game_aware=ddos_game_aware,
        is_featured=bool(getattr(plan, "is_featured", False)),
        is_bestseller=bool(getattr(plan, "is_bestseller", False)),
        is_new=bool(getattr(plan, "is_new", False)),
        pinned_in_hero=bool(getattr(plan, "pinned_in_hero", False)),
        promo_highlight_text=(getattr(plan, "promo_highlight_text", None) or None),
        recent_order_count=max(0, int(recent_order_count)),
    )
