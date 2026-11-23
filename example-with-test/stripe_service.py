"""Real Stripe Sandbox integration for the Phase 8 external test shop."""

from __future__ import annotations

from typing import Any

import stripe


class StripeSandboxService:
    """Creates Stripe Sandbox Checkout Sessions and verifies Stripe webhook events."""

    def __init__(self, secret_key: str, webhook_secret: str = "") -> None:
        self.secret_key = secret_key
        self.webhook_secret = webhook_secret
        stripe.api_key = secret_key

    @property
    def configured(self) -> bool:
        return bool(self.secret_key and self.secret_key.startswith("sk_test_"))

    def create_checkout_session(
        self,
        *,
        plan_name: str,
        unit_amount_cents: int,
        currency: str,
        customer_email: str,
        external_subject: str,
        external_service_id: str,
        success_url: str,
        cancel_url: str,
        mode: str = "subscription",
        addon_name: str | None = None,
        addon_amount_cents: int = 0,
        addon_service_id: str | None = None,
    ) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("STRIPE_SECRET_KEY (sk_test_...) ist nicht konfiguriert.")

        recurring = {"interval": "month"} if mode == "subscription" else None

        line_items: list[dict[str, Any]] = [
            {
                "price_data": {
                    "currency": currency.lower(),
                    "unit_amount": max(50, int(unit_amount_cents)),
                    "product_data": {
                        "name": plan_name,
                        "metadata": {"external_service_id": external_service_id},
                    },
                    **({"recurring": recurring} if recurring else {}),
                },
                "quantity": 1,
            }
        ]
        if addon_name and addon_amount_cents > 0:
            line_items.append(
                {
                    "price_data": {
                        "currency": currency.lower(),
                        "unit_amount": max(50, int(addon_amount_cents)),
                        "product_data": {
                            "name": addon_name,
                            "metadata": {"external_service_id": addon_service_id or ""},
                        },
                        **({"recurring": recurring} if recurring else {}),
                    },
                    "quantity": 1,
                }
            )

        metadata = {
            "external_subject": external_subject,
            "external_service_id": external_service_id,
            "addon_service_id": addon_service_id or "",
        }
        session_kwargs: dict[str, Any] = {
            "mode": mode,
            "customer_email": customer_email,
            "line_items": line_items,
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": metadata,
        }
        if mode == "subscription":
            session_kwargs["subscription_data"] = {"metadata": metadata}

        session = stripe.checkout.Session.create(**session_kwargs)
        return {
            "id": session.id,
            "url": session.url,
            "payment_status": session.payment_status,
            "status": session.status,
            "customer": session.customer,
            "subscription": session.subscription,
            "payment_intent": session.payment_intent,
            "metadata": dict(session.metadata or {}),
        }

    def retrieve_session(self, session_id: str) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("STRIPE_SECRET_KEY (sk_test_...) ist nicht konfiguriert.")
        session = stripe.checkout.Session.retrieve(session_id)
        return {
            "id": session.id,
            "payment_status": session.payment_status,
            "status": session.status,
            "customer": session.customer,
            "subscription": session.subscription,
            "payment_intent": session.payment_intent,
            "metadata": dict(session.metadata or {}),
        }

    def construct_webhook_event(self, payload: bytes, sig_header: str) -> dict[str, Any]:
        if not self.webhook_secret:
            raise RuntimeError("STRIPE_WEBHOOK_SECRET ist nicht konfiguriert.")
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=self.webhook_secret,
        )
        return dict(event)
