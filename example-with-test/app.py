"""Standalone External Test Shop (Phase 8 Black-Box Verification).

Uses ONLY the public MSM Hoster API contract (`docs/hoster-api.md` &
`docs/de-docs/hoster-api.md`) plus Stripe Sandbox (`stripe` Python SDK).
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from hoster_client import HosterApiError, MsmHosterClient, verify_msm_webhook
from store import ShopStore
from stripe_service import StripeSandboxService

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


class CheckoutRequest(BaseModel):
    external_subject: str = Field(..., min_length=1, max_length=128)
    email: str = Field(..., min_length=3, max_length=255)
    plan_id: int | None = None
    product_key: str | None = None
    ram_mb: int | None = None
    cpu_percent: int | None = None
    slots: int | None = None
    variables: dict[str, str] = Field(default_factory=dict)
    addon_slug: str | None = None
    mode: str = "subscription"  # "subscription" or "payment"


class UpgradeRequest(BaseModel):
    plan_id: int | None = None
    product_key: str | None = None
    ram_mb: int | None = None
    cpu_percent: int | None = None
    slots: int | None = None


class StateChangeRequest(BaseModel):
    desired_state: str  # active | suspended | terminated
    purge_immediately: bool = False


class HandoffRequest(BaseModel):
    target_path: str | None = None


def create_app(
    *,
    store: ShopStore | None = None,
    hoster_client: MsmHosterClient | None = None,
    stripe_service: StripeSandboxService | None = None,
    msm_webhook_secret: str | None = None,
    shop_public_url: str | None = None,
) -> FastAPI:
    app = FastAPI(title="Nordkapp Cloud — External Hoster API Test Shop")

    db = store or ShopStore(BASE_DIR / "data" / "testshop.db")
    hoster = hoster_client or MsmHosterClient(
        panel_url=os.getenv("MSM_PANEL_URL", "http://127.0.0.1:8000"),
        api_key=os.getenv("MSM_HOSTER_KEY", ""),
    )
    stripe_svc = stripe_service or StripeSandboxService(
        secret_key=os.getenv("STRIPE_SECRET_KEY", ""),
        webhook_secret=os.getenv("STRIPE_WEBHOOK_SECRET", ""),
    )
    webhook_secret = (
        msm_webhook_secret
        if msm_webhook_secret is not None
        else os.getenv("MSM_WEBHOOK_SECRET", "")
    )
    public_url = (shop_public_url or os.getenv("SHOP_PUBLIC_URL", "http://127.0.0.1:8090")).rstrip("/")

    static_dir = BASE_DIR / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    @app.get("/api/shop/status")
    async def shop_status() -> dict[str, Any]:
        msm_health: dict[str, Any] = {"ok": False, "integration": None, "error": None}
        if not hoster.api_key or hoster.api_key.startswith("replace_"):
            msm_health["error"] = "MSM_HOSTER_KEY fehlt in .env"
        else:
            try:
                res = await hoster.health()
                msm_health["ok"] = bool(res.get("ok"))
                msm_health["integration"] = res.get("integration")
            except Exception as exc:  # noqa: BLE001
                msm_health["error"] = str(exc)

        return {
            "msm": msm_health,
            "msm_panel_url": hoster.base_url,
            "stripe_configured": stripe_svc.configured,
            "stripe_webhook_configured": bool(stripe_svc.webhook_secret and not stripe_svc.webhook_secret.startswith("whsec_replace")),
            "msm_webhook_configured": bool(webhook_secret and not webhook_secret.startswith("replace_")),
        }

    @app.get("/api/shop/catalog")
    async def get_catalog() -> dict[str, Any]:
        try:
            return await hoster.get_catalog()
        except HosterApiError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    async def _provision_session_contracts(
        session_id: str,
        *,
        stripe_customer: str | None = None,
        stripe_subscription: str | None = None,
        stripe_payment_intent: str | None = None,
    ) -> dict[str, Any] | None:
        contracts = db.find_by_stripe_session(session_id)
        if not contracts:
            return None

        primary = contracts[0]
        items: list[dict[str, Any]] = []
        for c in contracts:
            db.upsert_contract(
                {
                    "external_service_id": c["external_service_id"],
                    "external_subject": c["external_subject"],
                    "payment_status": "paid",
                    "stripe_customer_id": stripe_customer,
                    "stripe_subscription_id": stripe_subscription,
                    "stripe_payment_intent_id": stripe_payment_intent,
                }
            )
            if c["item_kind"] == "addon":
                items.append(
                    {
                        "external_service_id": c["external_service_id"],
                        "kind": "addon",
                        "addon_slug": c["addon_slug"],
                    }
                )
            else:
                server_item: dict[str, Any] = {
                    "external_service_id": c["external_service_id"],
                    "kind": "server",
                }
                if c.get("plan_id") is not None:
                    server_item["plan_id"] = c["plan_id"]
                elif c.get("product_key"):
                    server_item["product_key"] = c["product_key"]
                if c.get("ram_mb") is not None:
                    server_item["ram_mb"] = c["ram_mb"]
                if c.get("cpu_percent") is not None:
                    server_item["cpu_percent"] = c["cpu_percent"]
                if c.get("slots") is not None:
                    server_item["slots"] = c["slots"]
                if c.get("variables"):
                    server_item["variables"] = c["variables"]
                items.append(server_item)

        batch_resp = await hoster.apply(
            external_subject=primary["external_subject"],
            desired_state="active",
            email=primary.get("email"),
            items=items,
            idempotency_key=f"stripe-session-{session_id}",
        )
        for item_res in batch_resp.get("items", []):
            db.apply_msm_state(item_res)
        return batch_resp

    @app.post("/api/shop/checkout")
    async def create_checkout(req: CheckoutRequest) -> dict[str, Any]:
        if req.plan_id is None and not req.product_key:
            raise HTTPException(status_code=422, detail="plan_id oder product_key erforderlich.")

        try:
            catalog = await hoster.get_catalog()
        except HosterApiError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        plans = catalog.get("plans", [])
        selected_plan = next(
            (
                p
                for p in plans
                if (req.plan_id is not None and p.get("plan_id") == req.plan_id)
                or (req.product_key and p.get("product_key") == req.product_key)
            ),
            None,
        )
        if not selected_plan:
            raise HTTPException(status_code=422, detail="Tarif im MSM-Katalog nicht gefunden.")

        addon_obj = None
        if req.addon_slug:
            addon_obj = next(
                (a for a in catalog.get("addons", []) if a.get("slug") == req.addon_slug),
                None,
            )
            if not addon_obj:
                raise HTTPException(status_code=422, detail="Add-on im MSM-Katalog nicht gefunden.")

        service_id = f"NK-SVC-{uuid.uuid4().hex[:8].upper()}"
        addon_service_id = f"NK-ADD-{uuid.uuid4().hex[:8].upper()}" if addon_obj else None

        unit_price = int(selected_plan.get("price_cents") or 499)
        currency = str(selected_plan.get("currency") or "EUR")
        addon_price = int(addon_obj.get("price_cents") or 0) if addon_obj else 0

        try:
            session = stripe_svc.create_checkout_session(
                plan_name=str(selected_plan.get("name") or f"Plan {selected_plan.get('plan_id')}"),
                unit_amount_cents=unit_price,
                currency=currency,
                customer_email=req.email,
                external_subject=req.external_subject,
                external_service_id=service_id,
                success_url=f"{public_url}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{public_url}/?checkout=cancelled",
                mode="payment" if req.mode == "payment" else "subscription",
                addon_name=str(addon_obj.get("name")) if addon_obj else None,
                addon_amount_cents=addon_price,
                addon_service_id=addon_service_id,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Stripe Checkout Fehler: {exc}") from exc

        db.upsert_contract(
            {
                "external_service_id": service_id,
                "external_subject": req.external_subject,
                "email": req.email,
                "item_kind": "server",
                "plan_id": selected_plan.get("plan_id"),
                "product_key": selected_plan.get("product_key"),
                "ram_mb": req.ram_mb,
                "cpu_percent": req.cpu_percent,
                "slots": req.slots,
                "variables": req.variables,
                "stripe_checkout_session_id": session["id"],
                "payment_status": "checkout_open",
                "desired_state": "active",
                "msm_status": "pending",
            }
        )
        if addon_obj and addon_service_id:
            db.upsert_contract(
                {
                    "external_service_id": addon_service_id,
                    "external_subject": req.external_subject,
                    "email": req.email,
                    "item_kind": "addon",
                    "addon_slug": addon_obj["slug"],
                    "stripe_checkout_session_id": session["id"],
                    "payment_status": "checkout_open",
                    "desired_state": "active",
                    "msm_status": "pending",
                }
            )

        return {
            "session_id": session["id"],
            "checkout_url": session["url"],
            "external_service_id": service_id,
            "addon_service_id": addon_service_id,
        }

    @app.get("/checkout/success")
    async def checkout_success(session_id: str) -> RedirectResponse:
        try:
            session = stripe_svc.retrieve_session(session_id)
            if session.get("payment_status") == "paid" or session.get("status") == "complete":
                await _provision_session_contracts(
                    session_id,
                    stripe_customer=session.get("customer"),
                    stripe_subscription=session.get("subscription"),
                    stripe_payment_intent=session.get("payment_intent"),
                )
        except Exception as exc:  # noqa: BLE001
            return RedirectResponse(url=f"/?checkout=error&reason={exc}", status_code=303)
        return RedirectResponse(url=f"/?checkout=success&session_id={session_id}", status_code=303)

    @app.post("/webhooks/stripe")
    async def stripe_webhook(request: Request) -> JSONResponse:
        raw_body = await request.body()
        sig_header = request.headers.get("Stripe-Signature", "")
        try:
            event = stripe_svc.construct_webhook_event(raw_body, sig_header)
        except Exception as exc:  # noqa: BLE001
            try:
                parsed = json.loads(raw_body.decode("utf-8"))
            except Exception:
                parsed = {"raw": raw_body.decode("utf-8", errors="replace")}
            db.log_webhook(
                source="stripe",
                event_type=str(parsed.get("type", "invalid")),
                signature_valid=False,
                payload=parsed,
            )
            raise HTTPException(status_code=400, detail=f"Stripe-Signatur ungueltig: {exc}") from exc

        event_type = str(event.get("type", ""))
        obj = (event.get("data") or {}).get("object") or {}
        db.log_webhook(
            source="stripe",
            event_type=event_type,
            signature_valid=True,
            payload=event,
        )

        if event_type == "checkout.session.completed":
            session_id = str(obj.get("id") or "")
            if session_id:
                await _provision_session_contracts(
                    session_id,
                    stripe_customer=obj.get("customer"),
                    stripe_subscription=obj.get("subscription"),
                    stripe_payment_intent=obj.get("payment_intent"),
                )
        elif event_type in ("invoice.payment_failed", "invoice.paid", "customer.subscription.deleted"):
            sub_id = str(obj.get("subscription") or obj.get("id") or "")
            contracts = db.find_by_stripe_subscription(sub_id) if sub_id else []
            if contracts:
                target_state = (
                    "active"
                    if event_type == "invoice.paid"
                    else "suspended"
                    if event_type == "invoice.payment_failed"
                    else "terminated"
                )
                pay_status = (
                    "paid"
                    if event_type == "invoice.paid"
                    else "past_due"
                    if event_type == "invoice.payment_failed"
                    else "cancelled"
                )
                items = []
                for c in contracts:
                    db.upsert_contract(
                        {
                            "external_service_id": c["external_service_id"],
                            "external_subject": c["external_subject"],
                            "payment_status": pay_status,
                            "desired_state": target_state,
                        }
                    )
                    items.append(
                        {
                            "external_service_id": c["external_service_id"],
                            "kind": c["item_kind"],
                        }
                    )
                batch_resp = await hoster.apply(
                    external_subject=contracts[0]["external_subject"],
                    desired_state=target_state,
                    items=items,
                    idempotency_key=f"stripe-evt-{event.get('id')}",
                )
                for item_res in batch_resp.get("items", []):
                    db.apply_msm_state(item_res)

        return JSONResponse({"received": True})

    @app.post("/webhooks/msm")
    async def msm_webhook(request: Request) -> JSONResponse:
        raw_body = await request.body()
        timestamp = request.headers.get("X-MSM-Timestamp", "")
        signature = request.headers.get("X-MSM-Signature", "")
        event_name = request.headers.get("X-MSM-Event", "")

        try:
            parsed = json.loads(raw_body.decode("utf-8"))
        except Exception:
            parsed = {"raw": raw_body.decode("utf-8", errors="replace")}

        valid = verify_msm_webhook(
            secret=webhook_secret,
            raw_body=raw_body,
            timestamp_header=timestamp,
            signature_header=signature,
        )
        db.log_webhook(
            source="msm",
            event_type=event_name or str(parsed.get("event", "unknown")),
            signature_valid=valid,
            payload=parsed,
            external_service_id=parsed.get("external_service_id"),
            correlation_id=parsed.get("correlation_id"),
        )
        if not valid:
            # Docs: 4xx tells MSM not to retry; only reject when signature/timestamp fails.
            return JSONResponse({"ok": False, "error": "invalid_signature"}, status_code=401)

        db.apply_msm_state(parsed)
        return JSONResponse({"ok": True})

    @app.get("/api/shop/contracts")
    async def list_contracts() -> list[dict[str, Any]]:
        return db.list_contracts()

    @app.post("/api/shop/contracts/{external_service_id}/refresh")
    async def refresh_contract(external_service_id: str) -> dict[str, Any]:
        try:
            msm_data = await hoster.get_service(external_service_id)
        except HosterApiError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        updated = db.apply_msm_state(msm_data)
        return updated or msm_data

    @app.post("/api/shop/contracts/{external_service_id}/upgrade")
    async def upgrade_contract(external_service_id: str, req: UpgradeRequest) -> dict[str, Any]:
        contract = db.get_contract(external_service_id)
        if not contract:
            raise HTTPException(status_code=404, detail="Vertrag nicht gefunden.")
        try:
            msm_data = await hoster.put_service(
                external_service_id,
                desired_state="active",
                external_subject=contract["external_subject"],
                plan_id=req.plan_id,
                product_key=req.product_key,
                ram_mb=req.ram_mb,
                cpu_percent=req.cpu_percent,
                slots=req.slots,
            )
        except HosterApiError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        db.upsert_contract(
            {
                "external_service_id": external_service_id,
                "external_subject": contract["external_subject"],
                "plan_id": msm_data.get("plan_id") or req.plan_id,
                "product_key": req.product_key or contract.get("product_key"),
                "ram_mb": req.ram_mb if req.ram_mb is not None else contract.get("ram_mb"),
                "cpu_percent": req.cpu_percent if req.cpu_percent is not None else contract.get("cpu_percent"),
                "slots": req.slots if req.slots is not None else contract.get("slots"),
            }
        )
        return db.apply_msm_state(msm_data) or msm_data

    @app.post("/api/shop/contracts/{external_service_id}/state")
    async def change_contract_state(
        external_service_id: str,
        req: StateChangeRequest,
    ) -> dict[str, Any]:
        contract = db.get_contract(external_service_id)
        if not contract:
            raise HTTPException(status_code=404, detail="Vertrag nicht gefunden.")
        if req.desired_state not in ("active", "suspended", "terminated"):
            raise HTTPException(status_code=422, detail="Ungueltiger desired_state.")

        try:
            # Use PUT /services/{id} when purge_immediately is requested (documented on PUT).
            if req.desired_state == "terminated" and req.purge_immediately:
                msm_data = await hoster.put_service(
                    external_service_id,
                    desired_state="terminated",
                    external_subject=contract["external_subject"],
                    purge_immediately=True,
                )
            else:
                batch_resp = await hoster.apply(
                    external_subject=contract["external_subject"],
                    desired_state=req.desired_state,
                    items=[
                        {
                            "external_service_id": external_service_id,
                            "kind": contract["item_kind"],
                        }
                    ],
                )
                msm_data = (batch_resp.get("items") or [{}])[0]
        except HosterApiError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        return db.apply_msm_state(msm_data) or msm_data

    @app.post("/api/shop/contracts/{external_service_id}/handoff")
    async def create_handoff(
        external_service_id: str,
        req: HandoffRequest | None = None,
    ) -> dict[str, Any]:
        contract = db.get_contract(external_service_id)
        if not contract:
            raise HTTPException(status_code=404, detail="Vertrag nicht gefunden.")
        target = (req.target_path if req else None) or (
            f"/servers/{contract['msm_server_id']}"
            if contract.get("msm_server_id")
            else "/servers"
        )
        try:
            return await hoster.create_handoff(
                external_service_id=external_service_id,
                target_path=target,
            )
        except HosterApiError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.get("/api/shop/webhooks")
    async def list_webhooks() -> list[dict[str, Any]]:
        return db.list_webhooks()

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=int(os.getenv("SHOP_PORT", "8090")),
        reload=False,
    )
