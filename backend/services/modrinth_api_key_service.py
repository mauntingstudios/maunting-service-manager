"""Optionaler panel-weiter Modrinth API Token (fuer hoehere Rate-Limits / private Projekte)."""

from __future__ import annotations

from typing import Literal, cast

from services.panel_settings_service import PanelEncryptedKeySetting

Source = Literal["env", "panel", "none"]

_store = PanelEncryptedKeySetting(
    enc_key="modrinth_api_key_enc",
    legacy_key="modrinth_api_key",
    aad="msm:modrinth:api_key",
    settings_attr="modrinth_api_key",
    env_vars=("MSM_MODRINTH_API_KEY", "MODRINTH_API_KEY"),
)

_env_key = _store.env_key
_panel_key = _store.panel_key
resolve_key = _store.resolve_key


def current_source() -> Source:
    return cast(Source, _store.current_source())


status = _store.status
set_panel_key = _store.set_panel_key
clear_panel_key = _store.clear_panel_key
