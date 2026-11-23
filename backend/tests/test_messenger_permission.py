"""RBAC-Tests für das globale Recht `messenger.use` (HTTP, Calls & WebSocket)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from models import ChatGroup, Role, RolePermission, User
from services.panel_settings_service import PanelSettingsService
from services.permission_catalog import GLOBAL_KEYS
from services.role_service import get_role_by_name
from services.shop_fulfillment_service import SHOP_ALLOWED_ROLE_PERMISSIONS


def test_messenger_use_in_catalog_shop_whitelist_and_admin() -> None:
    assert "messenger.use" in GLOBAL_KEYS
    assert "messenger.use" in SHOP_ALLOWED_ROLE_PERMISSIONS


def test_messenger_routes_blocked_without_permission(
    client: TestClient,
    db,
    regular_user: User,
    user_cookies: dict,
    owner_user: User,
) -> None:
    PanelSettingsService.set("social_enabled", "true", db)
    group = ChatGroup(owner_user_id=owner_user.id, invite_code="pub-invite-123")
    db.add(group)
    db.commit()

    # Messenger-Endpunkte liefern 403 ohne `messenger.use`.
    for path in (
        "/api/social/friends",
        "/api/social/friends/requests",
        "/api/social/groups",
        "/api/social/stories",
        "/api/social/chat/can-message/1",
        "/api/social/presence/me",
        "/api/social/push/public-key",
        "/api/social/calls/active",
        "/api/social/e2ee/chat-keys?chat_type=direct&chat_id=1",
    ):
        resp = client.get(path, cookies=user_cookies)
        assert resp.status_code == 403, f"Erwartet 403 fuer {path}, bekam {resp.status_code}"

    # Geteilte E2EE-Konto-Infrastruktur (Kalender/Notizen/Team-Tresor) und
    # oeffentliche Gruppen-Vorschau bleiben erreichbar.
    csrf = user_cookies.get("__Secure-csrf_token", "")
    lookup = client.post(
        "/api/social/e2ee/account/lookup",
        json={"user_ids": [owner_user.id]},
        cookies=user_cookies,
        headers={"X-CSRF-Token": csrf},
    )
    assert lookup.status_code == 200

    invite = client.get("/api/social/groups/invite/pub-invite-123")
    assert invite.status_code == 200

    # WebSocket lehnt ohne `messenger.use` mit 4403 ab.
    with pytest.raises(WebSocketDisconnect) as ws_exc:
        with client.websocket_connect(
            "/api/social/ws",
            cookies=user_cookies,
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            ws.receive_json()
    assert ws_exc.value.code == 4403


def test_messenger_routes_allowed_with_permission(
    client: TestClient,
    db,
    regular_user: User,
    user_cookies: dict,
) -> None:
    PanelSettingsService.set("social_enabled", "true", db)
    role = Role(name="messenger_kunde")
    db.add(role)
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_key="messenger.use"))
    regular_user.role_id = role.id
    db.commit()

    admin_role = get_role_by_name(db, "admin")
    assert admin_role is not None
    admin_keys = {p.permission_key for p in admin_role.permissions}
    assert "messenger.use" in admin_keys

    for path in (
        "/api/social/friends",
        "/api/social/presence/me",
        "/api/social/calls/active",
    ):
        resp = client.get(path, cookies=user_cookies)
        assert resp.status_code == 200, f"Erwartet 200 fuer {path}, bekam {resp.status_code}"

    with client.websocket_connect(
        "/api/social/ws",
        cookies=user_cookies,
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
        ws.close()
