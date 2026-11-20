"""Nativer Shop: Katalog (oeffentlich) und Tarifverwaltung (Panel)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, require_global, verify_csrf
from models import ShopPlan, User
from schemas.shop import (
    ShopCatalogPlan,
    ShopEntitlementResponse,
    ShopOrderCreate,
    ShopOrderResponse,
    ShopPlanResponse,
    ShopPlanUpdate,
    ShopPlanWrite,
    ShopSubscriptionResponse,
)
from services import shop_catalog_service, shop_order_service, wallpaper_service
from services.media_gallery_service import build_webp_response


router = APIRouter(prefix="/api/shop", tags=["shop"])


def _plan_or_404(db: Session, plan_id: int) -> ShopPlan:
    plan = shop_catalog_service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Tarif nicht gefunden")
    return plan


def _shop_error(exc: shop_catalog_service.ShopConfigurationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


# ── Oeffentlich: Katalog und Artwork ─────────────────────────────────────


@router.get("/catalog", response_model=list[ShopCatalogPlan])
def get_catalog(db: Session = Depends(get_db)) -> list[ShopCatalogPlan]:
    """Aktive Tarife ohne Anmeldung. Keine Node-/Rollen-IDs."""
    return [
        shop_catalog_service.catalog_plan(db, plan)
        for plan in shop_catalog_service.list_plans(db, active_only=True)
    ]


@router.get("/artwork/{game_type}")
def get_artwork(
    game_type: str,
    db: Session = Depends(get_db),
    if_none_match: str | None = Header(default=None),
    v: str | None = Query(default=None),
) -> Response:
    """Liefert das aufgeloeste Spielbild (Custom oder Steam-Cache)."""
    try:
        gefunden = wallpaper_service.plan_artwork_bytes(db, game_type, v)
    except wallpaper_service.WallpaperValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message)
    if gefunden is None:
        raise HTTPException(status_code=404, detail="Kein Bild vorhanden")
    bild, etag = gefunden
    return build_webp_response(
        data=bild, etag=etag, if_none_match=if_none_match, versioned=bool(v)
    )


# ── Kundenbereich: Bestellungen, Abos, Freischaltungen ───────────────────


@router.get("/orders", response_model=list[ShopOrderResponse])
def list_my_orders(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ShopOrderResponse]:
    return [
        shop_order_service.order_response(db, order)
        for order in shop_order_service.list_orders(db, user.id)
    ]


@router.post("/orders", response_model=ShopOrderResponse)
def create_my_order(
    payload: ShopOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> ShopOrderResponse:
    """Legt eine Bestellung aus dem Tarif an; Preise berechnet der Server."""
    try:
        order = shop_order_service.create_order(db, user, payload)
    except shop_order_service.ShopOrderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return shop_order_service.order_response(db, order)


@router.get("/orders/{order_id}", response_model=ShopOrderResponse)
def get_my_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ShopOrderResponse:
    order = shop_order_service.get_order(db, user.id, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Bestellung nicht gefunden")
    return shop_order_service.order_response(db, order)


@router.post("/orders/{order_id}/demo-pay", response_model=ShopOrderResponse)
def pay_my_order_demo(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> ShopOrderResponse:
    """Lokaler Zahlungserfolg, bis Stripe angebunden ist."""
    order = shop_order_service.get_order(db, user.id, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Bestellung nicht gefunden")
    try:
        order = shop_order_service.mark_demo_paid(db, order)
    except shop_order_service.ShopOrderError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return shop_order_service.order_response(db, order)


@router.get("/subscriptions", response_model=list[ShopSubscriptionResponse])
def list_my_subscriptions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ShopSubscriptionResponse]:
    return [
        shop_order_service.subscription_response(row)
        for row in shop_order_service.list_subscriptions(db, user.id)
    ]


@router.get("/entitlements", response_model=list[ShopEntitlementResponse])
def list_my_entitlements(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ShopEntitlementResponse]:
    return [
        shop_order_service.entitlement_response(row)
        for row in shop_order_service.list_entitlements(db, user.id)
    ]


# ── Panel: Tarife verwalten ──────────────────────────────────────────────


@router.get("/plans", response_model=list[ShopPlanResponse])
def list_plans(
    db: Session = Depends(get_db),
    _: User = Depends(require_global("panel.settings.read")),
) -> list[ShopPlanResponse]:
    return [
        shop_catalog_service.plan_response(db, plan)
        for plan in shop_catalog_service.list_plans(db)
    ]


@router.post("/plans", response_model=ShopPlanResponse)
def create_plan(
    payload: ShopPlanWrite,
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopPlanResponse:
    try:
        plan = shop_catalog_service.create_plan(db, payload, actor_id=actor.id)
    except shop_catalog_service.ShopConfigurationError as exc:
        raise _shop_error(exc) from exc
    return shop_catalog_service.plan_response(db, plan)


@router.patch("/plans/{plan_id}", response_model=ShopPlanResponse)
def update_plan(
    plan_id: int,
    payload: ShopPlanUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopPlanResponse:
    plan = _plan_or_404(db, plan_id)
    try:
        aktualisiert = shop_catalog_service.update_plan(
            db, plan, payload, actor_id=actor.id
        )
    except shop_catalog_service.ShopConfigurationError as exc:
        raise _shop_error(exc) from exc
    return shop_catalog_service.plan_response(db, aktualisiert)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> Response:
    plan = _plan_or_404(db, plan_id)
    shop_catalog_service.delete_plan(db, plan, actor_id=actor.id)
    return Response(status_code=204)


@router.post("/plans/{plan_id}/artwork", response_model=ShopPlanResponse)
async def upload_plan_artwork(
    plan_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopPlanResponse:
    """Eigenes Spielbild: dieselbe Sanitisierung/Galerie wie Titelbilder."""
    plan = _plan_or_404(db, plan_id)
    roh = await file.read(wallpaper_service.MAX_WALLPAPER_BYTES + 1)
    try:
        plan = shop_catalog_service.upload_plan_artwork(
            db,
            plan,
            raw_bytes=roh,
            uploaded_by=actor.username,
            actor_id=actor.id,
        )
    except wallpaper_service.WallpaperValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return shop_catalog_service.plan_response(db, plan)


@router.delete("/plans/{plan_id}/artwork", response_model=ShopPlanResponse)
def reset_plan_artwork(
    plan_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopPlanResponse:
    plan = _plan_or_404(db, plan_id)
    plan = shop_catalog_service.reset_plan_artwork(db, plan, actor_id=actor.id)
    return shop_catalog_service.plan_response(db, plan)
