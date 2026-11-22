"""Nativer Shop: Katalog (oeffentlich) und Tarifverwaltung (Panel)."""

from __future__ import annotations

import re
from urllib.parse import urlencode

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings

from database import get_db
from dependencies import get_current_user, verify_csrf
from models import (
    Server,
    ShopAddon,
    ShopCoupon,
    ShopEntitlement,
    ShopInvoice,
    ShopOrder,
    ShopPaymentEvent,
    ShopPlan,
    ShopSubscription,
    User,
)
from schemas.shop import (
    ShopAddonResponse,
    ShopAddonSwitchRequest,
    ShopAddonSwitchResponse,
    ShopAddonUpdate,
    ShopAddonWrite,
    ShopAdminManualOrderCreate,
    ShopAdminOrderResponse,
    ShopAvailabilityRequest,
    ShopAvailabilityResponse,
    ShopCatalogAddon,
    ShopCatalogPlan,
    ShopCheckoutRequest,
    ShopCheckoutResponse,
    ShopCouponPreviewRequest,
    ShopCouponPreviewResponse,
    ShopCouponResponse,
    ShopCouponUpdate,
    ShopCouponWrite,
    ShopCreditNoteCreate,
    ShopEinvoiceToolchainStatusResponse,
    ShopEntitlementResponse,
    ShopHandoffRequest,
    ShopHandoffResponse,
    ShopInvoiceResponse,
    ShopInvoiceSummaryResponse,
    ShopInvoiceValidationResponse,
    ShopOrderCreate,
    ShopOrderResponse,
    ShopPaymentEventResponse,
    ShopPdfa3ValidationResult,
    ShopPlanResponse,
    ShopPlanUpdate,
    ShopPlanWrite,
    ShopPublicPromosResponse,
    ShopReconciliationResponse,
    ShopRefundCreate,
    ShopRefundResponse,
    ShopSellerSettings,
    ShopSellerSettingsUpdate,
    ShopServerPlayersResponse,
    ShopServerSlotsResponse,
    ShopServerSlotsUpdate,
    ShopServerSubscriptionResponse,
    ShopStatsResponse,
    ShopStripeKeysUpdate,
    ShopStripeStatus,
    ShopSubscriptionResponse,
    ShopXRechnungValidationResult,
)
from services import (
    audit_service,
    permission_service,
    player_query_service,
    shop_addon_service,
    shop_catalog_service,
    shop_coupon_service,
    shop_einvoice_toolchain_service,
    shop_fulfillment_service,
    shop_invoice_export_service,
    shop_invoice_service,
    shop_order_service,
    node_placement_service,
    shop_reconciliation_service,
    shop_seller_settings_service,
    shop_slot_service,
    stripe_service,
    stripe_settings_service,
    wallpaper_service,
)
from services.media_gallery_service import build_webp_response


router = APIRouter(prefix="/api/shop", tags=["shop"])


def _require_shop_perm(*keys: str):
    """Laesst Owner sowie Inhaber einer der erlaubten Shop-/Settings-Rechte durch."""

    def _dep(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if any(permission_service.has_global_permission(db, user, key) for key in keys):
            return user
        raise HTTPException(status_code=403, detail="Keine Berechtigung")

    return _dep


def _plan_or_404(db: Session, plan_id: int) -> ShopPlan:
    plan = shop_catalog_service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Tarif nicht gefunden")
    return plan


def _addon_or_404(db: Session, addon_id: int) -> ShopAddon:
    addon = shop_addon_service.get_addon(db, addon_id)
    if addon is None:
        raise HTTPException(status_code=404, detail="Add-on nicht gefunden")
    return addon


def _coupon_or_404(db: Session, coupon_id: int) -> ShopCoupon:
    coupon = shop_coupon_service.get_coupon(db, coupon_id)
    if coupon is None:
        raise HTTPException(status_code=404, detail="Gutschein nicht gefunden")
    return coupon


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


@router.post("/availability", response_model=ShopAvailabilityResponse)
def check_shop_availability(
    payload: ShopAvailabilityRequest,
    db: Session = Depends(get_db),
) -> ShopAvailabilityResponse:
    """Prueft live vor dem Checkout, ob RAM/CPU/Disk auf einer Node frei sind."""
    plan = shop_catalog_service.get_plan(db, payload.plan_id)
    if plan is None or not plan.active:
        raise HTTPException(status_code=404, detail="Tarif ist nicht verfuegbar")
    result = node_placement_service.check_plan_availability(
        db,
        plan,
        ram_mb=payload.ram_mb,
        cpu_cores=payload.cpu,
    )
    return ShopAvailabilityResponse(
        available=result.available,
        reason=result.reason,
        available_nodes=result.available_nodes,
        max_ram_mb=result.max_ram_mb,
        max_cpu=result.max_cpu,
    )


@router.get("/catalog/addons", response_model=list[ShopCatalogAddon])
def get_catalog_addons(
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ShopCatalogAddon]:
    """Aktive Add-ons ohne Anmeldung. Keine interne Rollen-ID."""
    return [
        shop_addon_service.catalog_addon(addon, db)
        for addon in shop_addon_service.list_addons(
            db, active_only=True, category=category
        )
    ]


@router.get("/promos", response_model=ShopPublicPromosResponse)
def get_public_promos(db: Session = Depends(get_db)) -> ShopPublicPromosResponse:
    """Aktive Gutschein-Banner und Produkt-Rabatt-Badges fuer die Storefront."""
    return shop_coupon_service.get_public_promos(db)


@router.post("/coupons/preview", response_model=ShopCouponPreviewResponse)
def preview_coupon_public(
    payload: ShopCouponPreviewRequest,
    db: Session = Depends(get_db),
) -> ShopCouponPreviewResponse:
    """Prueft einen Gutscheincode unverbindlich fuer den Checkout."""
    return shop_coupon_service.preview_coupon(
        db,
        code=payload.code,
        kind=payload.kind,
        plan_id=payload.plan_id,
        gross_cents=payload.gross_cents,
    )


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
    except shop_order_service.ShopCapacityError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "shop_out_of_capacity", "message": str(exc)},
        ) from exc
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


@router.post("/orders/{order_id}/checkout", response_model=ShopCheckoutResponse)
def start_my_order_checkout(
    order_id: int,
    body: ShopCheckoutRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> ShopCheckoutResponse:
    """Startet die Stripe-Zahlung; 409, solange Stripe nicht konfiguriert ist."""
    order = shop_order_service.get_order(db, user.id, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Bestellung nicht gefunden")
    if order.status != "pending_payment":
        raise HTTPException(status_code=409, detail="Bestellung ist nicht zahlbar")
    artikel = shop_order_service.order_items(db, order.id)
    if not artikel:
        raise HTTPException(status_code=422, detail="Bestellung ohne Position")
    item0 = artikel[0]
    if item0.kind == "plan" and item0.plan_id is not None:
        plan = shop_catalog_service.get_plan(db, item0.plan_id)
        if plan is not None and plan.active:
            avail = node_placement_service.check_plan_availability(
                db, plan, ram_mb=item0.ram_mb, cpu_cores=item0.cpu
            )
            if not avail.available:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "shop_out_of_capacity",
                        "message": "Derzeit ist fuer diese Konfiguration keine ausreichende Server-Kapazitaet frei",
                    },
                )

    success_url: str | None = None
    cancel_url: str | None = None
    if body is not None:
        try:
            success_url = stripe_service.validate_redirect_url(body.return_url)
            cancel_url = stripe_service.validate_redirect_url(body.cancel_url)
        except stripe_service.StripeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    stripe_promo_id: str | None = None
    if order.coupon_code:
        coupon = (
            db.query(ShopCoupon)
            .filter(ShopCoupon.code == order.coupon_code)
            .first()
        )
        if coupon is not None and coupon.stripe_promotion_code_id:
            stripe_promo_id = coupon.stripe_promotion_code_id

    try:
        session_id, url = stripe_service.create_checkout_session(
            order,
            artikel[0],
            success_url=success_url,
            cancel_url=cancel_url,
            stripe_promotion_code_id=stripe_promo_id,
        )
    except stripe_service.StripeNotConfigured as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except stripe_service.StripeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    order.payment_provider = "stripe"
    order.payment_reference = session_id
    db.commit()
    return ShopCheckoutResponse(checkout_url=url)


_HANDOFF_GAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


@router.post("/handoff", response_model=ShopHandoffResponse)
def create_shop_handoff(
    body: ShopHandoffRequest,
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> ShopHandoffResponse:
    """Erzeugt eine sichere Webshop-Zieladresse fuer gekoppelte MSS-App-Clients."""
    app_return: str | None = None
    if body.app_return_url:
        try:
            app_return = stripe_service.validate_redirect_url(body.app_return_url)
        except stripe_service.StripeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    base = (settings.panel_url or "").rstrip("/")
    if body.target == "catalog":
        path = "/"
    elif body.target == "konto":
        path = "/konto/bestellungen"
    elif body.target == "game":
        slug = (body.game_type or "").strip()
        if not _HANDOFF_GAME_RE.fullmatch(slug):
            raise HTTPException(status_code=422, detail="Ungueltige Spiel-Kennung")
        path = f"/shop/{slug}"
    else:
        if body.addon_id is None or body.addon_id < 1:
            raise HTTPException(status_code=422, detail="addon_id fehlt oder ungueltig")
        path = f"/shop/addon/{body.addon_id}/kasse"

    query_params: dict[str, str] = {}
    if body.coupon_code and body.coupon_code.strip():
        query_params["coupon"] = body.coupon_code.strip().upper()
    if app_return:
        query_params["app_return"] = app_return
    query = f"?{urlencode(query_params)}" if query_params else ""
    return ShopHandoffResponse(url=f"{base}{path}{query}")


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    """Signaturgepruefter Stripe-Webhook; wiederholte Ereignisse sind harmlos."""
    roh = await request.body()
    try:
        ereignis = stripe_service.verify_webhook(
            roh, request.headers.get("stripe-signature", "")
        )
    except stripe_service.StripeNotConfigured as exc:
        raise HTTPException(status_code=503, detail="Webhook ist nicht konfiguriert") from exc
    except stripe_service.StripeSignatureError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        status, order_id = shop_order_service.handle_payment_event(db, ereignis)
        db.commit()
    except shop_order_service.ShopOrderError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError:
        db.rollback()
        status = "duplicate"
        order_id = None
    if status == "processed" and order_id is not None:
        shop_fulfillment_service.sync_order_entitlements(
            db, order_id, origin="external"
        )
    return {"status": status}


def _invoice_file_response(rechnung: ShopInvoice, endung: str) -> Response:
    if endung == "xml":
        return Response(
            content=rechnung.xml_text.encode("utf-8"),
            media_type="application/xml",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{shop_invoice_service.download_name(rechnung, "xml")}"'
                )
            },
        )
    return Response(
        content=rechnung.pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{shop_invoice_service.download_name(rechnung, "pdf")}"'
            )
        },
    )


@router.get("/invoices", response_model=list[ShopInvoiceSummaryResponse])
def list_my_invoices(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ShopInvoiceSummaryResponse]:
    return [
        shop_invoice_service.summary_response(db, rechnung)
        for rechnung in shop_invoice_service.list_invoices(db, user.id)
    ]


@router.get("/invoices/export")
def export_invoices_admin(
    year: int | None = Query(default=None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    actor: User = Depends(
        _require_shop_perm("shop.invoices.read", "shop.read", "panel.settings.read")
    ),
) -> Response:
    """Exportiert alle Belege als Betriebspruefungs-ZIP (CSV, JSON, PDF, XML)."""
    daten, dateiname = shop_invoice_export_service.build_audit_export_zip(
        db, actor_user_id=actor.id, year=year
    )
    return Response(
        content=daten,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{dateiname}"'
        },
    )


@router.get("/invoices/{invoice_id}", response_model=ShopInvoiceResponse)
def get_my_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ShopInvoiceResponse:
    rechnung = shop_invoice_service.get_invoice(db, user.id, invoice_id)
    if rechnung is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    return shop_invoice_service.detail_response(db, rechnung)


@router.get("/invoices/{invoice_id}/xml")
def download_my_invoice_xml(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    rechnung = shop_invoice_service.get_invoice(db, user.id, invoice_id)
    if rechnung is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    return _invoice_file_response(rechnung, "xml")


@router.get("/invoices/{invoice_id}/pdf")
def download_my_invoice_pdf(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    rechnung = shop_invoice_service.get_invoice(db, user.id, invoice_id)
    if rechnung is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    return _invoice_file_response(rechnung, "pdf")


@router.post("/invoices/{invoice_id}/credit", response_model=ShopInvoiceResponse)
def credit_invoice_admin(
    invoice_id: int,
    payload: ShopCreditNoteCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(
        _require_shop_perm("shop.refunds.write", "shop.write", "panel.settings.write")
    ),
    _: None = Depends(verify_csrf),
) -> ShopInvoiceResponse:
    """Storno per Gutschrift; die Originalrechnung bleibt als `void` im Ledger."""
    rechnung = db.query(ShopInvoice).filter(ShopInvoice.id == invoice_id).first()
    if rechnung is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    try:
        gutschrift = shop_invoice_service.credit_invoice(
            db, rechnung, payload.reason.strip()
        )
    except shop_invoice_service.InvoiceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    audit_service.record_privileged_action(
        db,
        user_id=actor.id,
        action="shop.invoice.credited",
        target_type="shop_invoice",
        target_id=rechnung.id,
        details={
            "invoice": rechnung.number,
            "credit_note": gutschrift.number,
            "reason": payload.reason.strip()[:200],
        },
    )
    db.commit()
    return shop_invoice_service.detail_response(db, gutschrift)


@router.get("/seller", response_model=ShopSellerSettings)
def get_seller_settings(
    _: User = Depends(_require_shop_perm("shop.read", "panel.settings.read")),
) -> dict:
    daten = shop_seller_settings_service.read()
    daten["missing_fields"] = shop_seller_settings_service.missing_fields()
    return daten


@router.put("/seller", response_model=ShopSellerSettings)
def set_seller_settings(
    payload: ShopSellerSettingsUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> dict:
    try:
        shop_seller_settings_service.update(payload.model_dump(exclude_unset=True))
    except shop_seller_settings_service.SellerSettingsError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    daten = shop_seller_settings_service.read()
    daten["missing_fields"] = shop_seller_settings_service.missing_fields()
    audit_service.record_privileged_action(
        db,
        user_id=actor.id,
        action="shop.seller.updated",
        target_type="shop_settings",
        target_id="seller",
        details={"complete": not daten["missing_fields"]},
    )
    db.commit()
    return daten


@router.get("/stripe/status", response_model=ShopStripeStatus)
def get_stripe_status(
    _: User = Depends(_require_shop_perm("shop.read", "panel.settings.read")),
) -> dict:
    return stripe_settings_service.status()


@router.put("/stripe/keys", response_model=ShopStripeStatus)
def set_stripe_keys(
    payload: ShopStripeKeysUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> dict:
    """Setzt Stripe-Schluessel; Werte gehen nie zurueck, nur der Status."""
    gesetzt = payload.model_fields_set
    if "secret_key" in gesetzt and payload.secret_key is not None:
        stripe_settings_service.set_secret_key(payload.secret_key)
    if "webhook_secret" in gesetzt and payload.webhook_secret is not None:
        stripe_settings_service.set_webhook_secret(payload.webhook_secret)
    if "publishable_key" in gesetzt and payload.publishable_key is not None:
        stripe_settings_service.set_publishable_key(payload.publishable_key)
    status = stripe_settings_service.status()
    audit_service.record_privileged_action(
        db,
        user_id=actor.id,
        action="shop.stripe.keys_updated",
        target_type="shop_settings",
        target_id="stripe",
        details={
            "secret_key_source": status["secret_key_source"],
            "webhook_secret_source": status["webhook_secret_source"],
            "configured": status["configured"],
        },
    )
    db.commit()
    return status


@router.get("/subscriptions", response_model=list[ShopSubscriptionResponse])
def list_my_subscriptions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ShopSubscriptionResponse]:
    return [
        shop_order_service.subscription_response(row)
        for row in shop_order_service.list_subscriptions(db, user.id)
    ]


@router.post(
    "/subscriptions/{subscription_id}/addon-switch",
    response_model=ShopAddonSwitchResponse,
)
def switch_my_addon_subscription(
    subscription_id: int,
    payload: ShopAddonSwitchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> ShopAddonSwitchResponse:
    """Wechselt ein aktives Add-on-Abo auf ein anderes aktives Add-on."""
    try:
        return shop_addon_service.switch_addon_subscription(
            db, user, subscription_id, payload.target_addon_id
        )
    except shop_addon_service.ShopAddonNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except shop_addon_service.ShopAddonSwitchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/subscriptions/{subscription_id}/cancel",
    response_model=ShopSubscriptionResponse,
)
def cancel_my_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> ShopSubscriptionResponse:
    """Merkt ein eigenes Abo zum Laufzeitende als gekuendigt vor."""
    abo = shop_order_service.get_subscription(db, user.id, subscription_id)
    if abo is None:
        raise HTTPException(status_code=404, detail="Abo nicht gefunden")
    try:
        abo = shop_order_service.cancel_subscription(
            db, abo, actor_user_id=user.id
        )
    except (
        shop_order_service.ShopOrderError,
        stripe_service.StripeNotConfigured,
    ) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except stripe_service.StripeError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return shop_order_service.subscription_response(abo)


@router.post("/orders/{order_id}/refund", response_model=ShopRefundResponse)
def refund_order_admin(
    order_id: int,
    payload: ShopRefundCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(
        _require_shop_perm("shop.refunds.write", "shop.write", "panel.settings.write")
    ),
    _: None = Depends(verify_csrf),
) -> ShopRefundResponse:
    """Erstattet eine Bestellung (inkl. Stripe-Refund, Gutschrift & Entzug)."""
    clean_reason = payload.reason.strip()
    if len(clean_reason) < 3:
        raise HTTPException(
            status_code=422,
            detail="Begruendung muss mindestens 3 Zeichen enthalten",
        )
    order = db.query(ShopOrder).filter(ShopOrder.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Bestellung nicht gefunden")
    try:
        gutschrift = shop_order_service.refund_order(
            db,
            order,
            reason=clean_reason,
            actor_user_id=actor.id,
            call_stripe=True,
            origin="direct",
        )
    except (
        shop_order_service.ShopOrderError,
        shop_invoice_service.InvoiceError,
        stripe_service.StripeNotConfigured,
    ) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except stripe_service.StripeError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    db.commit()
    shop_fulfillment_service.sync_order_entitlements(
        db, order.id, origin="direct"
    )
    db.refresh(order)
    return ShopRefundResponse(
        order=shop_order_service.order_response(db, order),
        credit_note_number=gutschrift.number if gutschrift is not None else None,
    )


@router.post("/reconcile", response_model=ShopReconciliationResponse)
def reconcile_shop_admin(
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopReconciliationResponse:
    """Abgleich offener Stripe-Sessions, fehlender Rechnungen & Entitlements."""
    bericht = shop_reconciliation_service.reconcile_shop(
        db, actor_user_id=actor.id
    )
    return ShopReconciliationResponse(**bericht)


@router.get("/entitlements", response_model=list[ShopEntitlementResponse])
def list_my_entitlements(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ShopEntitlementResponse]:
    return [
        shop_order_service.entitlement_response(row)
        for row in shop_order_service.list_entitlements(db, user.id)
    ]


@router.post(
    "/entitlements/{entitlement_id}/sync",
    response_model=ShopEntitlementResponse,
)
def sync_entitlement_admin(
    entitlement_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    __: None = Depends(verify_csrf),
) -> ShopEntitlementResponse:
    """Synchronisiert ein Entitlement (z. B. Retry nach behobenem Fehler)."""
    entitlement = shop_fulfillment_service.sync_entitlement(
        db, entitlement_id, origin="direct"
    )
    if entitlement is None:
        raise HTTPException(status_code=404, detail="Entitlement nicht gefunden")
    return shop_order_service.entitlement_response(entitlement)


# ── Panel: Tarife verwalten ──────────────────────────────────────────────


@router.get("/plans", response_model=list[ShopPlanResponse])
def list_plans(
    db: Session = Depends(get_db),
    _: User = Depends(_require_shop_perm("shop.read", "panel.settings.read")),
) -> list[ShopPlanResponse]:
    return [
        shop_catalog_service.plan_response(db, plan)
        for plan in shop_catalog_service.list_plans(db)
    ]


@router.post("/plans", response_model=ShopPlanResponse)
def create_plan(
    payload: ShopPlanWrite,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
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
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
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
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> Response:
    plan = _plan_or_404(db, plan_id)
    shop_catalog_service.delete_plan(db, plan, actor_id=actor.id)
    return Response(status_code=204)


# ── Panel: Eigenstaendige Add-ons verwalten ──────────────────────────────


@router.get("/addons", response_model=list[ShopAddonResponse])
def list_addons(
    db: Session = Depends(get_db),
    _: User = Depends(_require_shop_perm("shop.read", "panel.settings.read")),
) -> list[ShopAddonResponse]:
    return [
        shop_addon_service.addon_response(addon, db)
        for addon in shop_addon_service.list_addons(db)
    ]


@router.post("/addons", response_model=ShopAddonResponse)
def create_addon(
    payload: ShopAddonWrite,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopAddonResponse:
    try:
        addon = shop_addon_service.create_addon(db, payload, actor_id=actor.id)
    except shop_catalog_service.ShopConfigurationError as exc:
        raise _shop_error(exc) from exc
    return shop_addon_service.addon_response(addon, db)


@router.patch("/addons/{addon_id}", response_model=ShopAddonResponse)
def update_addon(
    addon_id: int,
    payload: ShopAddonUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopAddonResponse:
    addon = _addon_or_404(db, addon_id)
    try:
        updated = shop_addon_service.update_addon(db, addon, payload, actor_id=actor.id)
    except shop_catalog_service.ShopConfigurationError as exc:
        raise _shop_error(exc) from exc
    return shop_addon_service.addon_response(updated, db)


@router.delete("/addons/{addon_id}", status_code=204)
def delete_addon(
    addon_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> Response:
    addon = _addon_or_404(db, addon_id)
    shop_addon_service.delete_addon(db, addon, actor_id=actor.id)
    return Response(status_code=204)


# ── Panel: Gutscheine & Storefront-Aktionen ──────────────────────────────


@router.get("/coupons", response_model=list[ShopCouponResponse])
def list_coupons(
    db: Session = Depends(get_db),
    _: User = Depends(_require_shop_perm("shop.read", "panel.settings.read")),
) -> list[ShopCouponResponse]:
    return [
        shop_coupon_service.coupon_response(row)
        for row in shop_coupon_service.list_coupons(db)
    ]


@router.post("/coupons", response_model=ShopCouponResponse)
def create_coupon(
    payload: ShopCouponWrite,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopCouponResponse:
    try:
        row = shop_coupon_service.create_coupon(db, payload, actor_id=actor.id)
    except shop_catalog_service.ShopConfigurationError as exc:
        raise _shop_error(exc) from exc
    return shop_coupon_service.coupon_response(row)


@router.patch("/coupons/{coupon_id}", response_model=ShopCouponResponse)
def update_coupon(
    coupon_id: int,
    payload: ShopCouponUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopCouponResponse:
    row = _coupon_or_404(db, coupon_id)
    try:
        updated = shop_coupon_service.update_coupon(db, row, payload, actor_id=actor.id)
    except shop_catalog_service.ShopConfigurationError as exc:
        raise _shop_error(exc) from exc
    return shop_coupon_service.coupon_response(updated)


@router.delete("/coupons/{coupon_id}", status_code=204)
def delete_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> Response:
    row = _coupon_or_404(db, coupon_id)
    shop_coupon_service.delete_coupon(db, row, actor_id=actor.id)
    return Response(status_code=204)


@router.post("/coupons/{coupon_id}/stripe-sync", response_model=ShopCouponResponse)
def sync_coupon_stripe(
    coupon_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopCouponResponse:
    row = _coupon_or_404(db, coupon_id)
    try:
        synced = shop_coupon_service.sync_coupon_to_stripe(db, row, actor_id=actor.id)
    except stripe_service.StripeNotConfigured as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except stripe_service.StripeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return shop_coupon_service.coupon_response(synced)


@router.post("/plans/{plan_id}/artwork", response_model=ShopPlanResponse)
async def upload_plan_artwork(
    plan_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
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
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopPlanResponse:
    plan = _plan_or_404(db, plan_id)
    plan = shop_catalog_service.reset_plan_artwork(db, plan, actor_id=actor.id)
    return shop_catalog_service.plan_response(db, plan)


# ── Server-Abo-Zuordnung & Panel-Betriebsansichten ───────────────────────


@router.get(
    "/servers/{server_id}/subscription",
    response_model=ShopServerSubscriptionResponse,
)
def get_server_subscription(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ShopServerSubscriptionResponse:
    """Liefert Tarif- und Abo-Informationen zu einem Server fuer berechtigte Nutzer."""
    if not permission_service.has_server_permission(
        db, user, server_id, "server.view"
    ):
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    entitlement = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.server_id == server_id,
            ShopEntitlement.kind == "server",
        )
        .order_by(ShopEntitlement.id.desc())
        .first()
    )
    if entitlement is None:
        return ShopServerSubscriptionResponse(has_subscription=False)
    abo = (
        db.query(ShopSubscription)
        .filter(ShopSubscription.order_item_id == entitlement.order_item_id)
        .first()
    )
    return ShopServerSubscriptionResponse(
        has_subscription=True,
        subscription=(
            shop_order_service.subscription_response(abo)
            if abo is not None
            else None
        ),
        entitlement=shop_order_service.entitlement_response(entitlement),
        ram_mb=entitlement.ram_mb,
        cpu=entitlement.cpu,
        slots=entitlement.slots,
    )


@router.get(
    "/servers/{server_id}/players",
    response_model=ShopServerPlayersResponse,
)
def get_server_players(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ShopServerPlayersResponse:
    """Liest Live-Spielerzahl und prueft gegen gebuchte Slots."""
    can_view = permission_service.has_server_permission(
        db, user, server_id, "server.view"
    ) or permission_service.has_global_permission(db, user, "panel.settings.read")
    if not can_view:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    server = db.query(Server).filter(Server.id == server_id).first()
    if server is None:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    res = player_query_service.query_server_players(db, server)
    return ShopServerPlayersResponse(
        server_id=server.id,
        protocol=res.protocol,
        online=res.online,
        players=res.players,
        max_players=res.max_players,
        server_name=res.server_name,
        booked_slots=res.booked_slots,
        slot_exceeded=res.slot_exceeded,
        warning=res.warning,
        error=res.error,
    )


@router.post(
    "/servers/{server_id}/slots",
    response_model=ShopServerSlotsResponse,
)
def update_server_slots(
    server_id: int,
    payload: ShopServerSlotsUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(_require_shop_perm("shop.write", "panel.settings.write")),
    _: None = Depends(verify_csrf),
) -> ShopServerSlotsResponse:
    """Setzt Spieler-Slots ueber Blueprint-Ziel (`config_wishes` / Runtime-Env)."""
    server = db.query(Server).filter(Server.id == server_id).first()
    if server is None:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    try:
        result = shop_slot_service.apply_server_slots(db, server, payload.slots)
    except shop_slot_service.SlotConfigurationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    live = player_query_service.query_server_players(db, server)
    downgrade_warning = bool(result["downgrade_warning"]) or bool(
        live.online and live.players is not None and payload.slots < live.players
    )
    audit_service.record_privileged_action(
        db,
        user_id=actor.id,
        action="shop.server.slots_updated",
        target_type="server",
        target_id=server.id,
        details={
            "slots": payload.slots,
            "previous_slots": result["previous_slots"],
            "target_type": result["target_type"],
            "downgrade_warning": downgrade_warning,
        },
    )
    db.commit()
    return ShopServerSlotsResponse(
        server_id=server.id,
        slots=int(result["slots"]),
        previous_slots=result["previous_slots"],
        target_type=str(result["target_type"]),
        downgrade_warning=downgrade_warning,
        restart_required=bool(result["restart_required"]),
        live_players=live.players if live.online else None,
    )


def _admin_orders_response(db: Session, orders: list[ShopOrder]) -> list[ShopAdminOrderResponse]:
    if not orders:
        return []
    user_ids = {order.user_id for order in orders}
    users_by_id = {
        row.id: row.username
        for row in db.query(User.id, User.username)
        .filter(User.id.in_(user_ids))
        .all()
    }
    order_ids = [order.id for order in orders]
    ents_by_order: dict[int, list[ShopEntitlementResponse]] = {}
    for ent in (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id.in_(order_ids))
        .order_by(ShopEntitlement.id.asc())
        .all()
    ):
        ents_by_order.setdefault(ent.order_id, []).append(
            shop_order_service.entitlement_response(ent)
        )
    ergebnis: list[ShopAdminOrderResponse] = []
    for order in orders:
        basis = shop_order_service.order_response(db, order)
        ergebnis.append(
            ShopAdminOrderResponse(
                **basis.model_dump(),
                user_id=order.user_id,
                username=users_by_id.get(order.user_id),
                entitlements=ents_by_order.get(order.id, []),
            )
        )
    return ergebnis


@router.get("/admin/stats", response_model=ShopStatsResponse)
def get_admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(
        _require_shop_perm("shop.orders.read", "shop.read", "panel.settings.read")
    ),
) -> ShopStatsResponse:
    return shop_coupon_service.get_shop_stats(db)


@router.get("/admin/orders", response_model=list[ShopAdminOrderResponse])
def list_admin_orders(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(
        _require_shop_perm("shop.orders.read", "shop.read", "panel.settings.read")
    ),
) -> list[ShopAdminOrderResponse]:
    orders = (
        db.query(ShopOrder)
        .order_by(ShopOrder.created_at.desc(), ShopOrder.id.desc())
        .limit(limit)
        .all()
    )
    return _admin_orders_response(db, orders)


@router.post("/admin/orders", response_model=ShopAdminOrderResponse)
def create_manual_order_admin(
    payload: ShopAdminManualOrderCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(
        _require_shop_perm("shop.refunds.write", "shop.write", "panel.settings.write")
    ),
    _: None = Depends(verify_csrf),
) -> ShopAdminOrderResponse:
    """Legt eine manuelle Bestellung fuer einen Kunden an."""
    try:
        order = shop_order_service.create_manual_order(
            db, payload, actor_user_id=actor.id
        )
    except shop_order_service.ShopOrderError as exc:
        status_code = 404 if "nicht gefunden" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return _admin_orders_response(db, [order])[0]


@router.get("/admin/invoices", response_model=list[ShopInvoiceSummaryResponse])
def list_admin_invoices(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(
        _require_shop_perm("shop.invoices.read", "shop.read", "panel.settings.read")
    ),
) -> list[ShopInvoiceSummaryResponse]:
    rechnungen = (
        db.query(ShopInvoice)
        .order_by(ShopInvoice.issued_at.desc(), ShopInvoice.id.desc())
        .limit(limit)
        .all()
    )
    return [
        shop_invoice_service.summary_response(db, rechnung)
        for rechnung in rechnungen
    ]


@router.get("/admin/invoices/{invoice_id}/pdf")
def download_admin_invoice_pdf(
    invoice_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(
        _require_shop_perm("shop.invoices.read", "shop.read", "panel.settings.read")
    ),
) -> Response:
    rechnung = db.query(ShopInvoice).filter(ShopInvoice.id == invoice_id).first()
    if rechnung is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    return _invoice_file_response(rechnung, "pdf")


@router.get("/admin/invoices/{invoice_id}/xml")
def download_admin_invoice_xml(
    invoice_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(
        _require_shop_perm("shop.invoices.read", "shop.read", "panel.settings.read")
    ),
) -> Response:
    rechnung = db.query(ShopInvoice).filter(ShopInvoice.id == invoice_id).first()
    if rechnung is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    return _invoice_file_response(rechnung, "xml")


@router.get("/admin/webhooks", response_model=list[ShopPaymentEventResponse])
def list_admin_webhooks(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(_require_shop_perm("shop.read", "panel.settings.read")),
) -> list[ShopPaymentEventResponse]:
    events = (
        db.query(ShopPaymentEvent)
        .order_by(ShopPaymentEvent.received_at.desc(), ShopPaymentEvent.id.desc())
        .limit(limit)
        .all()
    )
    return [
        ShopPaymentEventResponse(
            id=evt.id,
            event_id=evt.event_id,
            event_type=evt.event_type,
            order_id=evt.order_id,
            status=evt.status,
            received_at=evt.received_at,
        )
        for evt in events
    ]


@router.get(
    "/admin/einvoice-toolchain",
    response_model=ShopEinvoiceToolchainStatusResponse,
)
def get_einvoice_toolchain_status(
    _: User = Depends(
        _require_shop_perm("shop.invoices.read", "shop.read", "panel.settings.read")
    ),
) -> ShopEinvoiceToolchainStatusResponse:
    """Meldet den Status der installierten E-Rechnungs-Toolchain."""
    return ShopEinvoiceToolchainStatusResponse(
        **shop_einvoice_toolchain_service.toolchain_status()
    )


@router.post(
    "/admin/invoices/{invoice_id}/validate",
    response_model=ShopInvoiceValidationResponse,
)
def validate_admin_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(
        _require_shop_perm("shop.invoices.read", "shop.read", "panel.settings.read")
    ),
    __: None = Depends(verify_csrf),
) -> ShopInvoiceValidationResponse:
    """Prueft gespeichertes XML via KoSIT-Validator und PDF via veraPDF."""
    rechnung = db.query(ShopInvoice).filter(ShopInvoice.id == invoice_id).first()
    if rechnung is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")

    xrechnung = shop_einvoice_toolchain_service.validate_xrechnung_xml(rechnung.xml_text)
    pdfa3 = shop_einvoice_toolchain_service.validate_pdfa3(rechnung.pdf_bytes)
    return ShopInvoiceValidationResponse(
        invoice_id=rechnung.id,
        invoice_number=rechnung.number,
        xrechnung=ShopXRechnungValidationResult(**xrechnung),
        pdfa3=ShopPdfa3ValidationResult(**pdfa3),
    )
