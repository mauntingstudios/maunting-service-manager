"""Phase 8 Black-Box Verification Suite for Nordkapp Cloud & MSM Hoster API.

Run standalone + Stripe Sandbox tests:
    pytest -q

Run full live Black-Box lifecycle against a running MSM panel:
    MSM_PANEL_URL=http://127.0.0.1:18000 MSM_HOSTER_KEY=... pytest -q
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import pathlib
import time
import tomllib
from typing import Any

import pytest
import stripe
from fastapi.testclient import TestClient

from app import create_app
from hoster_client import MsmHosterClient, verify_msm_webhook
from store import ShopStore
from stripe_service import StripeSandboxService


def _load_stripe_test_key() -> str:
    env_key = os.getenv("STRIPE_SECRET_KEY", "")
    if env_key.startswith(("sk_test_", "rk_test_")):
        return env_key
    return ""


def test_doc_hmac_test_vector_matches_reference() -> None:
    """Exact test vector from docs/hoster-api.md & docs/de-docs/hoster-api.md."""
    secret = "whsec_msm_beispiel_nicht_verwenden"
    ts = "1786120930"
    raw_body = (
        b'{"event":"service.ready","external_service_id":"SVC-4711",'
        b'"desired_state":"active","status":"ready","status_code":null,'
        b'"server_id":42,"correlation_id":"6f6d9d1e-6b1e-4a51-9f0c-2b7a5d3e8c14",'
        b'"terminate_after":null,"updated_at":"2026-08-08T09:22:10+00:00"}'
    )
    sig = "sha256=c22272c50fb68bae6f99965c33f831b7e3197d9766c00b0fc216b6c5289a51b0"

    assert verify_msm_webhook(
        secret=secret,
        raw_body=raw_body,
        timestamp_header=ts,
        signature_header=sig,
        now_ts=1786120930.0,
    )
    # Expired (>300s) must be rejected
    assert not verify_msm_webhook(
        secret=secret,
        raw_body=raw_body,
        timestamp_header=ts,
        signature_header=sig,
        now_ts=1786121300.0,
    )


def test_msm_webhook_endpoint_enforces_raw_hmac_and_updates_store(tmp_path: pathlib.Path) -> None:
    secret = "whsec_phase8_local_test"
    store = ShopStore(tmp_path / "shop.db")
    store.upsert_contract(
        {
            "external_service_id": "NK-SVC-1",
            "external_subject": "CUST-1",
            "plan_id": 1,
            "product_key": "plan:1",
            "desired_state": "active",
            "msm_status": "provisioning",
        }
    )
    app = create_app(store=store, msm_webhook_secret=secret)
    client = TestClient(app)

    ts = str(int(time.time()))
    payload = {
        "event": "service.ready",
        "external_service_id": "NK-SVC-1",
        "desired_state": "active",
        "status": "ready",
        "status_code": None,
        "server_id": 77,
        "correlation_id": "corr-1",
        "terminate_after": None,
        "updated_at": "2026-11-23T01:00:00+00:00",
    }
    raw_body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    good_sig = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        f"{ts}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    # Invalid signature -> 401
    bad_resp = client.post(
        "/webhooks/msm",
        content=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-MSM-Timestamp": ts,
            "X-MSM-Signature": "sha256=deadbeef",
            "X-MSM-Event": "service.ready",
        },
    )
    assert bad_resp.status_code == 401

    # Valid signature -> 200 and updates contract
    ok_resp = client.post(
        "/webhooks/msm",
        content=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-MSM-Timestamp": ts,
            "X-MSM-Signature": good_sig,
            "X-MSM-Event": "service.ready",
        },
    )
    assert ok_resp.status_code == 200
    contract = store.get_contract("NK-SVC-1")
    assert contract is not None
    assert contract["msm_status"] == "ready"
    assert contract["msm_server_id"] == 77


def test_real_stripe_sandbox_checkout_and_payment_intent() -> None:
    """Connects to real Stripe Sandbox and verifies Checkout + PaymentIntent."""
    stripe_key = _load_stripe_test_key()
    if not stripe_key:
        pytest.skip("Kein Stripe Sandbox Key (sk_test_ / rk_test_) verfuegbar.")

    svc = StripeSandboxService(secret_key=stripe_key)
    session = svc.create_checkout_session(
        plan_name="Phase 8 Palworld Sandbox Plan",
        unit_amount_cents=990,
        currency="EUR",
        customer_email="phase8-sandbox@nordkapp.example",
        external_subject="NK-CUST-SANDBOX",
        external_service_id="NK-SVC-SANDBOX-1",
        success_url="http://127.0.0.1:8090/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url="http://127.0.0.1:8090/?checkout=cancelled",
        mode="subscription",
    )
    assert session["id"].startswith("cs_test_")
    assert session["url"].startswith("https://checkout.stripe.com/")

    retrieved = svc.retrieve_session(session["id"])
    assert retrieved["id"] == session["id"]
    assert retrieved["metadata"]["external_service_id"] == "NK-SVC-SANDBOX-1"

    # Real Stripe Sandbox PaymentIntent with test card pm_card_visa
    stripe.api_key = stripe_key
    pi = stripe.PaymentIntent.create(
        amount=990,
        currency="eur",
        payment_method="pm_card_visa",
        confirm=True,
        automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
        metadata={"phase": "8", "external_service_id": "NK-SVC-SANDBOX-1"},
    )
    assert pi.status == "succeeded"


@pytest.mark.anyio
async def test_live_msm_hoster_api_full_lifecycle(tmp_path: pathlib.Path) -> None:
    """Full Black-Box lifecycle against a live MSM backend when MSM_HOSTER_KEY is provided."""
    panel_url = os.getenv("MSM_PANEL_URL", "")
    hoster_key = os.getenv("MSM_HOSTER_KEY", "")
    if not panel_url or not hoster_key:
        pytest.skip("MSM_PANEL_URL / MSM_HOSTER_KEY fuer Live-Black-Box-Test nicht gesetzt.")

    store = ShopStore(tmp_path / "live_shop.db")
    hoster = MsmHosterClient(panel_url=panel_url, api_key=hoster_key, timeout=20.0)
    stripe_key = _load_stripe_test_key()
    stripe_svc = StripeSandboxService(
        secret_key=stripe_key,
        webhook_secret="whsec_test_stripe_live",
    )
    app = create_app(
        store=store,
        hoster_client=hoster,
        stripe_service=stripe_svc,
        msm_webhook_secret=os.getenv("MSM_WEBHOOK_SECRET", "whsec_phase8"),
    )
    client = TestClient(app)

    # 1. Health & Catalog
    health = await hoster.health()
    assert health["ok"] is True

    catalog = await hoster.get_catalog()
    plans = catalog.get("plans", [])
    assert len(plans) >= 1, "Mindestens ein aktiver Shop-Tarif fuer Phase 8 erforderlich."
    plan = plans[0]
    addons = catalog.get("addons", [])

    # 2. Stripe Sandbox Checkout Session via Shop API
    if stripe_svc.configured:
        checkout_resp = client.post(
            "/api/shop/checkout",
            json={
                "external_subject": "NK-LIVE-CUST-1",
                "email": "live-phase8@nordkapp.example",
                "plan_id": plan["plan_id"],
                "addon_slug": addons[0]["slug"] if addons else None,
                "mode": "subscription",
            },
        )
        assert checkout_resp.status_code == 200, checkout_resp.text
        checkout_data = checkout_resp.json()
        service_id = checkout_data["external_service_id"]
        assert checkout_data["session_id"].startswith("cs_test_")
    else:
        service_id = "NK-LIVE-SVC-1"
        store.upsert_contract(
            {
                "external_service_id": service_id,
                "external_subject": "NK-LIVE-CUST-1",
                "email": "live-phase8@nordkapp.example",
                "plan_id": plan["plan_id"],
                "product_key": plan["product_key"],
            }
        )

    # 3. Apply active (use standalone addon when no msm-agent is running; server when MSM_LIVE_AGENT=1)
    use_server = os.getenv("MSM_LIVE_AGENT") == "1" or not addons
    if not use_server:
        addon = addons[0]
        service_id = f"NK-LIVE-ADDON-{int(time.time())}"
        store.upsert_contract(
            {
                "external_service_id": service_id,
                "external_subject": "NK-LIVE-CUST-1",
                "email": "live-phase8@nordkapp.example",
                "item_kind": "addon",
                "addon_slug": addon["slug"],
            }
        )
        apply_item: dict[str, Any] = {
            "external_service_id": service_id,
            "kind": "addon",
            "addon_slug": addon["slug"],
        }
    else:
        apply_item = {
            "external_service_id": service_id,
            "kind": "server",
            "plan_id": plan["plan_id"],
        }

    apply_resp = await hoster.apply(
        external_subject="NK-LIVE-CUST-1",
        desired_state="active",
        email="live-phase8@nordkapp.example",
        items=[apply_item],
        idempotency_key=f"phase8-{service_id}-active",
    )
    assert apply_resp["items"][0]["ok"] is True
    store.apply_msm_state(apply_resp["items"][0])

    # 4. Status query + One-Click Handoff
    svc_state = await hoster.get_service(service_id)
    assert svc_state["external_service_id"] == service_id

    handoff = client.post(
        f"/api/shop/contracts/{service_id}/handoff",
        json={"target_path": "/servers"},
    )
    assert handoff.status_code == 200, handoff.text
    assert "/api/hoster/handoff/" in handoff.json()["url"]

    # 5. Upgrade / Resize (server only)
    if use_server:
        new_ram = int(plan.get("ram_max_mb") or plan.get("ram_included_mb") or 2048)
        up_resp = client.post(
            f"/api/shop/contracts/{service_id}/upgrade",
            json={"ram_mb": new_ram},
        )
        assert up_resp.status_code == 200, up_resp.text

    # 6. Suspend -> Reactivate
    susp_resp = client.post(
        f"/api/shop/contracts/{service_id}/state",
        json={"desired_state": "suspended"},
    )
    assert susp_resp.status_code == 200, susp_resp.text
    assert susp_resp.json()["desired_state"] == "suspended"

    react_resp = client.post(
        f"/api/shop/contracts/{service_id}/state",
        json={"desired_state": "active"},
    )
    assert react_resp.status_code == 200, react_resp.text
    assert react_resp.json()["desired_state"] == "active"

    # 7. Terminate (grace) & Terminate (purge_immediately)
    term_grace = client.post(
        f"/api/shop/contracts/{service_id}/state",
        json={"desired_state": "terminated", "purge_immediately": False},
    )
    assert term_grace.status_code == 200, term_grace.text
    assert term_grace.json()["desired_state"] == "terminated"

    term_now = client.post(
        f"/api/shop/contracts/{service_id}/state",
        json={"desired_state": "terminated", "purge_immediately": True},
    )
    assert term_now.status_code == 200, term_now.text
    assert term_now.json()["desired_state"] == "terminated"
