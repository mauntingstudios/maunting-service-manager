"""Tests fuer Graceful Drain (`drain_service`, API-Gates) und schonendes `update.sh`."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import AiConversation, AiProvider, AiRun, FrontendDeployment, Role, RolePermission, Server, User
from services import drain_service

ROOT = Path(__file__).resolve().parents[2]


def _grant(db: Session, user: User, *keys: str) -> None:
    role = Role(name=f"DrainRole-{uuid.uuid4().hex[:6]}", description=None, is_system=False)
    db.add(role)
    db.flush()
    for key in keys:
        db.add(RolePermission(role_id=role.id, permission_key=key))
    user.role_id = role.id
    db.commit()


def test_drain_service_enable_disable_and_ttl_expiry(tmp_path: Path, monkeypatch):
    flag_file = tmp_path / ".msm-draining.json"
    monkeypatch.setenv("MSM_DRAIN_FLAG_FILE", str(flag_file))

    assert drain_service.is_draining() is False
    assert drain_service.read_drain_state() is None

    state = drain_service.enable_drain(reason="panel_update", ttl_seconds=60)
    assert state["draining"] is True
    assert state["reason"] == "panel_update"
    assert flag_file.is_file()
    assert drain_service.is_draining() is True

    with pytest.raises(HTTPException) as exc_info:
        drain_service.require_not_draining()
    assert exc_info.value.status_code == 503
    assert exc_info.value.headers == {"Retry-After": "5"}
    assert exc_info.value.detail == {
        "code": "panel_draining",
        "message": "errors.panel_draining",
    }

    # Abgelaufenes Flag wird automatisch als stale erkannt (fail-open ohne Unlink-Rennen)
    expired = json.loads(flag_file.read_text(encoding="utf-8"))
    expired["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    flag_file.write_text(json.dumps(expired), encoding="utf-8")
    assert drain_service.is_draining() is False

    # Beschaedigte / unvollstaendige / explizit deaktivierte Flags bleiben fail-open
    flag_file.write_text("{kaputt", encoding="utf-8")
    assert drain_service.read_drain_state() is None

    flag_file.write_text(
        json.dumps({"draining": False, "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()}),
        encoding="utf-8",
    )
    assert drain_service.read_drain_state() is None

    flag_file.write_text(
        json.dumps(
            {
                "draining": True,
                "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat(),
                "ttl_seconds": "bad",
            }
        ),
        encoding="utf-8",
    )
    assert drain_service.read_drain_state() is None

    drain_service.enable_drain(reason="manual", ttl_seconds=60)
    assert drain_service.disable_drain() == {"draining": False}
    assert not flag_file.exists()


def test_drain_status_counts_active_ai_and_sandbox_workloads(
    db: Session, regular_user: User, tmp_path: Path, monkeypatch
):
    flag_file = tmp_path / ".msm-draining.json"
    monkeypatch.setenv("MSM_DRAIN_FLAG_FILE", str(flag_file))

    conv = AiConversation(
        id=str(uuid.uuid4()),
        user_id=regular_user.id,
        kind="primary",
        title="Test",
    )
    db.add(conv)
    srv = Server(
        name="DrainSandbox",
        game_type="frontend_node",
        install_dir=str(tmp_path / "srv"),
        status="stopped",
    )
    db.add(srv)
    db.flush()

    db.add(
        AiRun(
            id=str(uuid.uuid4()),
            user_id=regular_user.id,
            conversation_id=conv.id,
            status="running",
        )
    )
    db.add(
        AiRun(
            id=str(uuid.uuid4()),
            user_id=regular_user.id,
            conversation_id=conv.id,
            status="completed",
        )
    )
    db.add(
        FrontendDeployment(
            server_id=srv.id,
            kind="production",
            branch="main",
            branch_slug="main",
            source="manual",
            status="building",
        )
    )
    db.add(
        FrontendDeployment(
            server_id=srv.id,
            kind="production",
            branch="main",
            branch_slug="main",
            source="manual",
            status="ready",
        )
    )
    db.commit()

    status_before = drain_service.get_drain_status(db)
    assert status_before["draining"] is False
    assert status_before["active_ai_runs"] >= 1
    assert status_before["active_frontend_builds"] >= 1
    assert status_before["active_total"] == (
        status_before["active_ai_runs"] + status_before["active_frontend_builds"]
    )


def test_drain_endpoints_health_and_workload_gates(
    db: Session,
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    regular_user: User,
    user_cookies: dict,
    user_csrf_token: str,
    tmp_path: Path,
    monkeypatch,
):
    flag_file = tmp_path / ".msm-draining.json"
    monkeypatch.setenv("MSM_DRAIN_FLAG_FILE", str(flag_file))

    # Ohne CSRF -> 403
    no_csrf = client.post("/api/system/drain", cookies=owner_cookies, json={})
    assert no_csrf.status_code == 403

    # Normaler User ohne panel.settings.write -> 403
    _grant(db, regular_user, "ai.chat.use", "server.restart", "panel.settings.read")
    forbidden = client.post(
        "/api/system/drain",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={},
    )
    assert forbidden.status_code == 403

    # Owner aktiviert Drain
    enabled = client.post(
        "/api/system/drain",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"reason": "panel_update", "ttl_seconds": 120},
    )
    assert enabled.status_code == 200
    assert enabled.json()["draining"] is True

    # Health bleibt HTTP 200 und signalisiert draining=True
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "draining": True}

    status_res = client.get("/api/system/drain-status", cookies=user_cookies)
    assert status_res.status_code == 200
    assert status_res.json()["draining"] is True

    # Neue Frontend-/Sandbox-Builds werden mit 503 + Retry-After geblockt
    srv = Server(
        name="BuildGateServer",
        game_type="frontend_node",
        install_dir=str(tmp_path / "fe"),
        status="stopped",
    )
    db.add(srv)
    provider = AiProvider(
        name="TestProvider",
        provider_kind="custom",
        custom_base_url="http://127.0.0.1:11434/v1",
        default_model="gpt-4o-mini",
        enabled=True,
        requires_api_key=False,
    )
    db.add(provider)
    db.commit()

    build_res = client.post(
        f"/api/servers/{srv.id}/frontend/deployments",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"branch": "main"},
    )
    assert build_res.status_code == 503
    assert build_res.headers.get("retry-after") == "5"
    assert build_res.json()["detail"]["code"] == "panel_draining"

    # Neuer KI-Chat-Lauf wird mit 503 + Retry-After geblockt
    chat_res = client.post(
        "/api/ai/conversation/messages/stream",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "provider_id": provider.id,
            "content": "Hallo",
            "request_id": str(uuid.uuid4()),
        },
    )
    assert chat_res.status_code == 503
    assert chat_res.headers.get("retry-after") == "5"
    assert chat_res.json()["detail"]["code"] == "panel_draining"

    # Drain wieder beenden
    disabled = client.delete(
        "/api/system/drain",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert disabled.status_code == 200
    assert disabled.json() == {"draining": False}
    assert client.get("/api/health").json() == {"status": "ok"}


def test_update_sh_and_service_template_graceful_drain_contract():
    updater_bytes = (ROOT / "update.sh").read_bytes()
    installer_bytes = (ROOT / "install.sh").read_bytes()
    template_bytes = (ROOT / "msm.service.template").read_bytes()

    # Keine CRLF-Zeilenenden auf Byte-Ebene
    assert b"\r" not in updater_bytes
    assert b"\r" not in installer_bytes
    assert b"\r" not in template_bytes

    updater = updater_bytes.decode("utf-8")
    installer = installer_bytes.decode("utf-8")
    template = template_bytes.decode("utf-8")

    # Laufendes Frontend und Panel werden waehrend des Builds nicht hart abgeschossen
    assert "rm -rf frontend/dist 2>/dev/null || true" not in updater
    assert 'log "Nehme Panel für das Schema-Upgrade kurz in Wartung..."' not in updater
    assert "npx vite build --outDir dist.next" in updater
    assert "swap_frontend_dist" in updater
    assert "drain_backend_workloads" in updater
    assert "git diff --name-only" in updater
    assert "systemctl reload caddy" in updater

    # Worker-Unit muss Variables expandieren (<<EOF statt <<'EOF'), und Drain laeuft vor Sidecar-Neustart
    assert "cat > /etc/systemd/system/msm-worker.service <<EOF" in updater
    assert "cat > /etc/systemd/system/msm-worker.service <<'EOF'" not in updater
    assert "cat > /etc/systemd/system/msm-worker.service <<EOF" in installer
    assert "cat > /etc/systemd/system/msm-worker.service <<'EOF'" not in installer
    assert "MSM_DRAIN_FLAG_FILE=" in installer
    assert "DRAIN_ENABLED_BY_UPDATER" in updater
    restart_section = updater.split("# ── Service neustarten", 1)[1]
    assert restart_section.index("drain_backend_workloads\n") < restart_section.index(
        "systemctl restart msm-dis-sidecar.service"
    )

    # Systemd & Uvicorn Graceful Shutdown >= 30s + gemeinsames Drain-Flag
    assert "--timeout-graceful-shutdown 30" in updater
    assert "--timeout-graceful-shutdown 30" in installer
    assert "--timeout-graceful-shutdown 30" in template
    assert "TimeoutStopSec=45" in updater
    assert "TimeoutStopSec=45" in installer
    assert "TimeoutStopSec=45" in template
    assert "MSM_DRAIN_FLAG_FILE=" in updater
    assert "MSM_DRAIN_FLAG_FILE=" in template
