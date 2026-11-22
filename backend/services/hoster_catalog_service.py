"""Einheitlicher Produktkatalog fuer externe Hoster-Integrationen.

Liest direkt dieselben `ShopPlan`- und `ShopAddon`-Eintraege wie der native
Shop, sodass Tarife nur einmal unter Einstellungen -> Shop gepflegt werden.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import RoleAiLimit, RoleAiProjectQuota, ShopAddon, ShopPlan
from schemas.hoster import (
    HosterCatalogAddonItem,
    HosterCatalogArtwork,
    HosterCatalogGalleryItem,
    HosterCatalogPlanItem,
    HosterCatalogResponse,
    HosterCatalogRoleQuota,
    HosterCatalogVariable,
    HosterCatalogVariableOption,
)
from services import shop_catalog_service, wallpaper_service


def _blueprint_variables(game_type: str) -> list[HosterCatalogVariable]:
    from games import get_plugin

    plugin = get_plugin(game_type)
    if plugin is None or not hasattr(plugin, "get_blueprint"):
        return []
    try:
        blueprint = plugin.get_blueprint()
    except Exception:
        return []

    items: list[HosterCatalogVariable] = []
    for var in getattr(blueprint, "variables", []) or []:
        items.append(
            HosterCatalogVariable(
                key=var.key,
                label=var.label,
                description=var.description,
                group=var.group,
                type=var.type.value if hasattr(var.type, "value") else str(var.type),
                default="" if str(getattr(var.type, "value", var.type)) == "secret" else var.default,
                options=[
                    HosterCatalogVariableOption(
                        value=opt.value,
                        label=opt.label,
                        badge=opt.badge,
                    )
                    for opt in (var.options or [])
                ],
                allow_custom=bool(var.allowCustom),
                placeholder=var.placeholder,
                required=bool(var.required),
                customer_editable=bool(var.customerEditable),
                min=var.min,
                max=var.max,
                pattern=var.pattern,
                requires_restart=bool(var.requiresRestart),
            )
        )
    return items


def _plan_gallery(db: Session, plan: ShopPlan) -> list[HosterCatalogGalleryItem]:
    if plan.artwork_mode == "none":
        return []
    try:
        descriptors = wallpaper_service.resolve_game_gallery(db, plan.game_type)
    except Exception:
        return []
    return [
        HosterCatalogGalleryItem(
            id=item.id,
            source=item.source,
            url=item.url,
            is_primary=bool(item.is_primary),
        )
        for item in descriptors
    ]


def build_hoster_catalog(db: Session) -> HosterCatalogResponse:
    """Baut den oeffentlichen Produkt- und Add-on-Katalog fuer Shop-APIs."""
    plans_rows = (
        db.query(ShopPlan)
        .filter(ShopPlan.active.is_(True))
        .order_by(ShopPlan.sort_order.asc(), ShopPlan.id.asc())
        .all()
    )
    addons_rows = (
        db.query(ShopAddon)
        .filter(ShopAddon.active.is_(True))
        .order_by(ShopAddon.sort_order.asc(), ShopAddon.id.asc())
        .all()
    )

    role_ids = {row.role_id for row in addons_rows if row.role_id is not None}
    project_quotas: dict[int, RoleAiProjectQuota] = {}
    ai_limits: dict[int, RoleAiLimit] = {}
    if role_ids:
        project_quotas = {
            q.role_id: q
            for q in db.query(RoleAiProjectQuota)
            .filter(RoleAiProjectQuota.role_id.in_(role_ids))
            .all()
        }
        ai_limits = {
            lim.role_id: lim
            for lim in db.query(RoleAiLimit)
            .filter(RoleAiLimit.role_id.in_(role_ids))
            .all()
        }

    plan_items: list[HosterCatalogPlanItem] = []
    for plan in plans_rows:
        cat = shop_catalog_service.catalog_plan(db, plan)
        plan_items.append(
            HosterCatalogPlanItem(
                plan_id=plan.id,
                product_key=f"plan:{plan.id}",
                game_type=cat.game_type,
                game_name=cat.game_name,
                game_description=cat.game_description,
                game_category=cat.game_category,
                name=cat.name,
                description=cat.description,
                price_cents=cat.price_cents,
                currency=cat.currency,
                billing_interval=cat.billing_interval,
                tax_rate_percent=cat.tax_rate_percent,
                ram_included_mb=cat.ram_included_mb,
                ram_max_mb=cat.ram_max_mb,
                ram_step_mb=cat.ram_step_mb,
                price_per_ram_step_cents=cat.price_per_ram_step_cents,
                cpu_included=cat.cpu_included,
                cpu_max=cat.cpu_max,
                cpu_step=cat.cpu_step,
                price_per_cpu_step_cents=cat.price_per_cpu_step_cents,
                slots_included=cat.slots_included,
                slots_max=cat.slots_max,
                slots_step=cat.slots_step,
                price_per_slot_step_cents=cat.price_per_slot_step_cents,
                supports_mods=cat.supports_mods,
                supports_workshop=cat.supports_workshop,
                supports_slots=cat.supports_slots,
                role_id=plan.role_id,
                available=cat.available,
                availability_reason=cat.availability_reason,
                max_available_ram_mb=cat.max_available_ram_mb,
                max_available_cpu=cat.max_available_cpu,
                artwork=HosterCatalogArtwork(
                    source=cat.artwork.source,
                    url=cat.artwork.url,
                    version=cat.artwork.version,
                ),
                gallery=_plan_gallery(db, plan),
                variables=_blueprint_variables(plan.game_type),
            )
        )

    addon_items: list[HosterCatalogAddonItem] = []
    for addon in addons_rows:
        role_quota: HosterCatalogRoleQuota | None = None
        if addon.role_id is not None:
            pq = project_quotas.get(addon.role_id)
            al = ai_limits.get(addon.role_id)
            if pq is not None or al is not None:
                role_quota = HosterCatalogRoleQuota(
                    max_projects=pq.max_projects if pq is not None else None,
                    max_storage_mb=pq.max_storage_mb if pq is not None else None,
                    ai_monthly_tokens=al.monthly_token_limit if al is not None else None,
                    ai_daily_tokens=al.daily_token_limit if al is not None else None,
                )
        addon_items.append(
            HosterCatalogAddonItem(
                id=addon.id,
                slug=addon.slug,
                name=addon.name,
                description=addon.description,
                category=addon.category,
                price_cents=addon.price_cents,
                currency=addon.currency,
                billing_interval=addon.billing_interval,
                tax_rate_percent=addon.tax_rate_percent,
                extra_slots=addon.extra_slots,
                extra_storage_mb=addon.extra_storage_mb,
                extra_backups=addon.extra_backups,
                extra_ai_tokens=addon.extra_ai_tokens,
                role_id=addon.role_id,
                role_quota=role_quota,
            )
        )

    return HosterCatalogResponse(plans=plan_items, addons=addon_items)
