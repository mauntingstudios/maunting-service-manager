"""Nativer Shop: Katalog (oeffentlich) und Tarifverwaltung (Panel)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db
from dependencies import require_global, verify_csrf
from models import ShopPlan, User
from schemas.shop import (
    ShopCatalogPlan,
    ShopPlanResponse,
    ShopPlanUpdate,
    ShopPlanWrite,
)
from services import shop_catalog_service, wallpaper_service
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
