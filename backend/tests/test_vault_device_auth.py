"""Tests für das Smartcard Zero-Knowledge Device-Auth Session Relay."""

import pytest
from fastapi.testclient import TestClient
from dependencies import get_current_user, get_db, verify_csrf
from main import app

from models import User


@pytest.fixture
def test_users(db):
    session = db
    u1 = User(
        id=1,
        username="alice",
        email="alice@example.com",
        password_hash="hash",
        is_active=True,
    )
    u2 = User(
        id=2,
        username="bob",
        email="bob@example.com",
        password_hash="hash",
        is_active=True,
    )
    session.add_all([u1, u2])
    session.commit()
    session.refresh(u1)
    session.refresh(u2)
    return u1, u2


def test_device_auth_flow(db, test_users):
    u1, u2 = test_users

    # Authenticated client as Alice (Target device)
    app.dependency_overrides[get_current_user] = lambda: u1
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_csrf] = lambda: True

    client = TestClient(app)

    # 1. Desktop creates session
    resp = client.post(
        "/api/vault/device-auth/session",
        json={
            "public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0...",
            "purpose": "authorize",
            "device_info": "Desktop Windows 11",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "session_id" in data
    assert "session_token" in data
    session_id = data["session_id"]
    session_token = data["session_token"]

    # 2. Desktop checks status: pending
    resp_pending = client.get(
        f"/api/vault/device-auth/session/{session_id}?token={session_token}"
    )
    assert resp_pending.status_code == 200
    assert resp_pending.json()["status"] == "pending"

    # 3. Bob tries to resolve Alice's session -> Forbidden / Not found
    app.dependency_overrides[get_current_user] = lambda: u2
    bob_resolve = client.post(
        "/api/vault/device-auth/resolve",
        json={
            "session_id": session_id,
            "encrypted_payload": "evil-payload",
        },
    )
    assert bob_resolve.status_code == 404

    # 4. Alice's Phone resolves the session
    app.dependency_overrides[get_current_user] = lambda: u1
    alice_resolve = client.post(
        "/api/vault/device-auth/resolve",
        json={
            "session_id": session_id,
            "encrypted_payload": "e2ee-encrypted-token-data-12345",
        },
    )
    assert alice_resolve.status_code == 200
    assert alice_resolve.json() == {"success": True}

    # 5. Desktop polls and receives resolved status with ciphertext
    resp_resolved = client.get(
        f"/api/vault/device-auth/session/{session_id}?token={session_token}"
    )
    assert resp_resolved.status_code == 200
    res_data = resp_resolved.json()
    assert res_data["status"] == "resolved"
    assert res_data["encrypted_payload"] == "e2ee-encrypted-token-data-12345"
    assert res_data["purpose"] == "authorize"

    # 6. Single-use: polling again shows expired (consumed)
    resp_consumed = client.get(
        f"/api/vault/device-auth/session/{session_id}?token={session_token}"
    )
    assert resp_consumed.status_code == 200
    assert resp_consumed.json()["status"] == "expired"

    app.dependency_overrides.clear()
