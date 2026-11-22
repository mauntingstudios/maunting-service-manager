"""Stripe-Anbindung des Shops: Checkout-Session und Webhook-Pruefung.

Keine neue Abhaengigkeit: Stripe spricht HTTP-Formulare, die Pruefung der
Webhook-Signatur ist HMAC-SHA256 nach der dokumentierten Konstruktion
``t=<timestamp>,v1=<hex>`` ueber ``"<t>.<payload>"``.

Betraege gehen brutto an Stripe (deutsche B2C-Preise sind Brutto). Monatliche
Laufzeiten laufen als Stripe-Abo, vorausbezahlte 3/12 Monate als Einmalkauf.
Mahnwesen und Abo-Zustand kommen ueber Stripe-Ereignisse (invoice.*,
customer.subscription.*) zurueck; automatische Steuer bleibt offen.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from config import settings
from models import ShopOrder, ShopOrderItem
from services import stripe_settings_service

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_TIMEOUT_SECONDS = 8.0
SIGNATURE_TOLERANCE_SECONDS = 300
_STRIPE_ID_RE = re.compile(r"^[A-Za-z0-9_]+$")


class StripeError(RuntimeError):
    """Stripe hat die Anfrage abgelehnt oder nicht beantwortet."""


class StripeNotConfigured(StripeError):
    """Ohne Secret/Webhook-Secret ist kein echter Zahlungsfluss moeglich."""


class StripeSignatureError(StripeError):
    """Signatur fehlt, ist alt oder passt nicht zum Payload."""


def _validate_stripe_id(value: str, label: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned or len(cleaned) > 128 or not _STRIPE_ID_RE.fullmatch(cleaned):
        raise StripeError(f"{label} ist ungueltig")
    return cleaned


def _require_secret() -> str:
    secret = stripe_settings_service.resolve_secret_key()
    if not secret:
        raise StripeNotConfigured("Stripe ist nicht konfiguriert")
    return secret


def _post_form(
    path: str,
    data: list[tuple[str, str]],
    secret: str,
    *,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {secret}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    response = httpx.post(
        f"{STRIPE_API_BASE}{path}",
        data=data,
        headers=headers,
        timeout=STRIPE_TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        raise StripeError("Stripe hat die Zahlung nicht angenommen")
    return response.json()


def _get_json(path: str, secret: str) -> dict[str, Any]:
    response = httpx.get(
        f"{STRIPE_API_BASE}{path}",
        headers={"Authorization": f"Bearer {secret}"},
        timeout=STRIPE_TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        raise StripeError("Stripe-Abfrage fehlgeschlagen")
    return response.json()


def _delete_json(path: str, secret: str) -> dict[str, Any]:
    response = httpx.delete(
        f"{STRIPE_API_BASE}{path}",
        headers={"Authorization": f"Bearer {secret}"},
        timeout=STRIPE_TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        raise StripeError("Stripe-Kuendigung fehlgeschlagen")
    return response.json()


def _panel_base() -> str:
    return (settings.panel_url or "").rstrip("/")


def validate_redirect_url(
    url: str | None,
    *,
    allow_app_deep_link: bool = True,
) -> str | None:
    """Prueft Ruecksprung-URLs streng gegen Open-Redirect- und Script-Angriffe."""
    if url is None:
        return None
    cleaned = url.strip()
    if not cleaned:
        return None
    if len(cleaned) > 512 or any(ord(ch) < 32 or ch.isspace() for ch in cleaned):
        raise StripeError("Ungueltige Ruecksprung-Adresse")
    parsed = urlparse(cleaned)
    scheme = parsed.scheme.lower()
    if not scheme and not parsed.netloc:
        if not cleaned.startswith("/") or cleaned.startswith("//") or "\\" in cleaned:
            raise StripeError("Ungueltige Ruecksprung-Adresse")
        return cleaned
    if scheme in ("maunting", "msm"):
        if not allow_app_deep_link or (not parsed.netloc and not parsed.path):
            raise StripeError("Ungueltige Ruecksprung-Adresse")
        return cleaned
    if scheme in ("http", "https"):
        base = _panel_base()
        if not base or not parsed.netloc:
            raise StripeError("Ungueltige Ruecksprung-Adresse")
        base_parsed = urlparse(base)
        if (
            scheme != base_parsed.scheme.lower()
            or parsed.netloc.lower() != base_parsed.netloc.lower()
        ):
            raise StripeError("Ungueltige Ruecksprung-Adresse")
        return cleaned
    raise StripeError("Ungueltige Ruecksprung-Adresse")


def create_checkout_session(
    order: ShopOrder,
    item: ShopOrderItem,
    *,
    success_url: str | None = None,
    cancel_url: str | None = None,
    stripe_promotion_code_id: str | None = None,
) -> tuple[str, str]:
    """Legt eine Checkout-Session an und liefert (Session-ID, Weiterleitungs-URL)."""
    secret = _require_secret()

    base = _panel_base()

    def _resolve_url(candidate: str | None, fallback: str) -> str:
        valid = validate_redirect_url(candidate)
        if not valid:
            return fallback
        if valid.startswith("/"):
            return f"{base}{valid}"
        return valid

    resolved_success = _resolve_url(
        success_url,
        f"{base}/konto/bestellungen?checkout=erfolg&bestellung={order.id}",
    )
    resolved_cancel = _resolve_url(
        cancel_url,
        f"{base}/shop/{item.game_type}?checkout=abgebrochen",
    )

    # Monatliche Laufzeit wird ein echtes Stripe-Abo (Renewal-Ereignisse
    # treiben Abo und Dunning). Vorausbezahlte 3/12 Monate bleiben Einmalkauf.
    abo = order.months == 1
    if stripe_promotion_code_id:
        unit_amount = order.gross_cents + order.coupon_discount_cents
    elif order.coupon_discount_cents > 0 or not abo:
        unit_amount = order.gross_cents
    else:
        unit_amount = item.unit_price_cents

    data: list[tuple[str, str]] = [
        ("mode", "subscription" if abo else "payment"),
        ("client_reference_id", order.number),
        ("success_url", resolved_success),
        ("cancel_url", resolved_cancel),
        ("line_items[0][quantity]", "1"),
        ("line_items[0][price_data][currency]", order.currency.lower()),
        ("line_items[0][price_data][unit_amount]", str(unit_amount)),
        ("line_items[0][price_data][product_data][name]", item.name),
        ("metadata[order_id]", str(order.id)),
        ("metadata[order_number]", order.number),
    ]
    if stripe_promotion_code_id:
        promo_id = _validate_stripe_id(stripe_promotion_code_id, "Promotion-Code-ID")
        data.append(("discounts[0][promotion_code]", promo_id))
    elif order.coupon_discount_cents == 0:
        data.append(("allow_promotion_codes", "true"))
    if abo:
        data.extend(
            [
                ("line_items[0][price_data][recurring][interval]", "month"),
                ("subscription_data[metadata][order_id]", str(order.id)),
            ]
        )
    else:
        data.append(("payment_intent_data[metadata][order_id]", str(order.id)))
    antwort = _post_form("/checkout/sessions", data, secret)
    url = str(antwort.get("url") or "")
    session_id = str(antwort.get("id") or "")
    if not url or not session_id:
        raise StripeError("Stripe lieferte keine Zahlungsadresse")
    return session_id, url


def get_checkout_session(session_id: str) -> dict[str, Any]:
    """Liest den Zustand einer Checkout-Session (fuer Refunds & Reconciliation)."""
    secret = _require_secret()
    clean_id = _validate_stripe_id(session_id, "Checkout-Session-ID")
    return _get_json(f"/checkout/sessions/{clean_id}", secret)


def cancel_subscription_at_period_end(subscription_id: str) -> dict[str, Any]:
    """Merkt die Kuendigung eines Stripe-Abos zum Laufzeitende vor."""
    secret = _require_secret()
    clean_id = _validate_stripe_id(subscription_id, "Stripe-Abo-ID")
    return _post_form(
        f"/subscriptions/{clean_id}",
        [("cancel_at_period_end", "true")],
        secret,
    )


def cancel_subscription_immediately(subscription_id: str) -> dict[str, Any]:
    """Beendet ein Stripe-Abo sofort unwiderruflich."""
    secret = _require_secret()
    clean_id = _validate_stripe_id(subscription_id, "Stripe-Abo-ID")
    return _delete_json(f"/subscriptions/{clean_id}", secret)


def create_refund(
    payment_intent: str,
    *,
    idempotency_key: str | None = None,
    reason: str = "requested_by_customer",
) -> dict[str, Any]:
    """Erstellt eine volle Rueckerstattung ueber Stripe (idempotent)."""
    secret = _require_secret()
    clean_intent = _validate_stripe_id(payment_intent, "Payment-Intent-ID")
    data: list[tuple[str, str]] = [
        ("payment_intent", clean_intent),
        ("reason", reason),
    ]
    if idempotency_key:
        return _post_form(
            "/refunds", data, secret, idempotency_key=idempotency_key
        )
    return _post_form("/refunds", data, secret)


def create_coupon_and_promotion_code(
    *,
    coupon_id: int,
    code: str,
    name: str,
    discount_type: str,
    discount_value: int,
    currency: str = "EUR",
    max_redemptions: int | None = None,
    active: bool = True,
) -> tuple[str, str]:
    """Legt einen Stripe-Coupon plus Promotion-Code an."""
    secret = _require_secret()
    coupon_data: list[tuple[str, str]] = [
        ("name", name[:40]),
        ("duration", "once"),
        ("metadata[shop_coupon_id]", str(coupon_id)),
    ]
    if discount_type == "percent":
        coupon_data.append(("percent_off", str(int(discount_value))))
    else:
        coupon_data.append(("amount_off", str(int(discount_value))))
        coupon_data.append(("currency", currency.lower()))

    created_coupon = _post_form("/coupons", coupon_data, secret)
    stripe_coupon_id = str(created_coupon.get("id") or "")
    if not stripe_coupon_id:
        raise StripeError("Stripe lieferte keine Coupon-ID")

    promo_data: list[tuple[str, str]] = [
        ("coupon", stripe_coupon_id),
        ("code", code),
        ("active", "true" if active else "false"),
        ("metadata[shop_coupon_id]", str(coupon_id)),
    ]
    if max_redemptions is not None:
        promo_data.append(("max_redemptions", str(int(max_redemptions))))

    created_promo = _post_form("/promotion_codes", promo_data, secret)
    promo_id = str(created_promo.get("id") or "")
    if not promo_id:
        raise StripeError("Stripe lieferte keinen Promotion-Code")
    return stripe_coupon_id, promo_id


def deactivate_promotion_code(promo_code_id: str) -> dict[str, Any]:
    """Deaktiviert einen bestehenden Stripe-Promotion-Code."""
    secret = _require_secret()
    clean_id = _validate_stripe_id(promo_code_id, "Stripe-Promo-Code-ID")
    return _post_form(
        f"/promotion_codes/{clean_id}",
        [("active", "false")],
        secret,
    )


def _parse_signature_header(header: str) -> tuple[int, list[str]]:
    timestamp = ""
    signatures: list[str] = []
    for teil in (header or "").split(","):
        schluessel, _, wert = teil.strip().partition("=")
        if schluessel == "t":
            timestamp = wert
        elif schluessel == "v1":
            signatures.append(wert)
    if not timestamp or not signatures:
        raise StripeSignatureError("Signaturkopf unvollstaendig")
    try:
        stamp = int(timestamp)
    except ValueError as exc:
        raise StripeSignatureError("Signaturzeitstempel ungueltig") from exc
    return stamp, signatures


def verify_webhook(payload: bytes, signature_header: str) -> dict[str, Any]:
    """Prueft die Stripe-Signatur und gibt das Ereignis zurueck.

    Alte Zeitstempel werden verworfen (Replay-Schutz). Mehrere ``v1``-Werte
    sind waehrend einer Secret-Rotation zulaessig; einer muss passen.
    """
    secret = stripe_settings_service.resolve_webhook_secret()
    if not secret:
        raise StripeNotConfigured("Webhook-Secret fehlt")

    stamp, signatures = _parse_signature_header(signature_header)
    if abs(time.time() - stamp) > SIGNATURE_TOLERANCE_SECONDS:
        raise StripeSignatureError("Signatur ist zu alt")

    nachricht = f"{stamp}.".encode() + payload
    erwartet = hmac.new(secret.encode(), nachricht, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(erwartet, sig) for sig in signatures):
        raise StripeSignatureError("Signatur passt nicht")

    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StripeSignatureError("Payload ist kein gueltiges JSON") from exc
