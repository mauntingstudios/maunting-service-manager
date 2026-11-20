"""Stripe-Konfiguration des nativen Shops.

Zwei Geheimnisse liegen DIS-verschluesselt im Panel (`stripe_*_enc`), mit
ENV-Fallback wie bei den anderen API-Keys. Der Publishable Key ist oeffentlich
und steht unverschluesselt daneben. Nach aussen (Status-Endpunkt) gehen nur
Ja/Nein und Test/Live — niemals Schluesselwerte.
"""

from __future__ import annotations

from typing import Literal

from services.panel_settings_service import (
    PanelEncryptedKeySetting,
    PanelSettingsService,
)

StripeMode = Literal["test", "live", "unknown"]

_secret = PanelEncryptedKeySetting(
    enc_key="shop_stripe_secret_key_enc",
    legacy_key="shop_stripe_secret_key",
    aad="msm:shop:stripe_secret",
    settings_attr="stripe_secret_key",
    env_vars=("MSM_STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY"),
)

_webhook = PanelEncryptedKeySetting(
    enc_key="shop_stripe_webhook_secret_enc",
    legacy_key="shop_stripe_webhook_secret",
    aad="msm:shop:stripe_webhook",
    settings_attr="stripe_webhook_secret",
    env_vars=("MSM_STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET"),
)

resolve_secret_key = _secret.resolve_key
resolve_webhook_secret = _webhook.resolve_key

_PUBLISHABLE_KEY = "shop_stripe_publishable_key"


def publishable_key() -> str:
    return PanelSettingsService.get(_PUBLISHABLE_KEY, "").strip()


def mode() -> StripeMode:
    """Test/Live aus dem Prefix des Secret Keys; nie aus Klientendaten."""
    secret = resolve_secret_key()
    if secret.startswith("sk_live_") or secret.startswith("rk_live_"):
        return "live"
    if secret.startswith("sk_test_") or secret.startswith("rk_test_"):
        return "test"
    return "unknown" if secret else "unknown"


def configured() -> bool:
    return bool(resolve_secret_key() and resolve_webhook_secret())


def set_secret_key(value: str) -> None:
    _secret.set_panel_key(value)


def set_webhook_secret(value: str) -> None:
    _webhook.set_panel_key(value)


def set_publishable_key(value: str) -> None:
    clean = (value or "").strip()
    if clean:
        PanelSettingsService.set(_PUBLISHABLE_KEY, clean)
    else:
        PanelSettingsService.delete(_PUBLISHABLE_KEY)


def status() -> dict[str, str | bool]:
    return {
        "configured": configured(),
        "mode": mode(),
        "secret_key_source": _secret.current_source(),
        "webhook_secret_source": _webhook.current_source(),
        "publishable_key": publishable_key(),
    }
