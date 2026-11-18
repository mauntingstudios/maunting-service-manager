"""Panel-weiter Cloudflare API Token."""

from __future__ import annotations

from typing import Literal, cast

from services.panel_settings_service import PanelEncryptedKeySetting

Source = Literal["env", "panel", "none"]

_store = PanelEncryptedKeySetting(
    enc_key="cloudflare_api_token_enc",
    legacy_key="cloudflare_api_token",
    aad="msm:settings:cloudflare_api_token",
    settings_attr="cloudflare_api_token",
    env_vars=("MSM_CLOUDFLARE_API_TOKEN",),
)

_env_key = _store.env_key
_panel_key = _store.panel_key
resolve_key = _store.resolve_key


def current_source() -> Source:
    return cast(Source, _store.current_source())


status = _store.status
set_panel_key = _store.set_panel_key
clear_panel_key = _store.clear_panel_key
