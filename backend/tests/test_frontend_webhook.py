"""Tests fuer den Echtzeit-GitHub-Webhook fuer Frontend-Deployments."""

from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import FrontendDeployment, Server
from services import frontend_deploy_service


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def _setup_frontend(db: Session, tmp_path: Path):
    srv = Server(
        name="WebApp",
        game_type="web_frontend_github",
        install_dir=str(tmp_path / "srv-wh"),
        status="running",
        desired_power_state="running",
        game_port=28080,
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    fs = frontend_deploy_service.get_or_create_settings(db, srv)
    db.commit()
    secret = frontend_deploy_service.decrypt_webhook_secret(fs)
    assert secret is not None
    return srv, fs, secret


def test_webhook_rejects_invalid_signature_and_unknown_token(
    client: TestClient, db: Session, tmp_path: Path
) -> None:
    _, fs, _ = _setup_frontend(db, tmp_path)
    body = json.dumps({"ref": "refs/heads/main"}).encode("utf-8")

    assert (
        client.post(
            "/api/webhooks/github/unknown-token",
            content=body,
            headers={"X-Hub-Signature-256": "sha256=deadbeef"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/webhooks/github/{fs.webhook_url_token}",
            content=body,
            headers={"X-Hub-Signature-256": "sha256=deadbeef", "X-GitHub-Event": "push"},
        ).status_code
        == 401
    )


def test_webhook_push_dedupes_and_delete_cleans_preview(
    client: TestClient, db: Session, tmp_path: Path
) -> None:
    srv, fs, secret = _setup_frontend(db, tmp_path)
    push_body = json.dumps({
        "ref": "refs/heads/feature/login",
        "after": "deadbeef1234",
        "head_commit": {
            "id": "deadbeef1234",
            "message": "feat: add login",
            "author": {"name": "Maik"},
        },
    }).encode("utf-8")

    with patch("services.frontend_deploy_service.trigger_async_build") as mock_trigger:
        r1 = client.post(
            f"/api/webhooks/github/{fs.webhook_url_token}",
            content=push_body,
            headers={
                "X-Hub-Signature-256": _sign(secret, push_body),
                "X-GitHub-Event": "push",
                "X-GitHub-Delivery": "deliv-1",
            },
        )
        assert r1.status_code == 200
        assert r1.json()["kind"] == "preview"
        assert mock_trigger.call_count == 1

        # Gleiche Delivery-ID wird dedupliziert
        r_dup = client.post(
            f"/api/webhooks/github/{fs.webhook_url_token}",
            content=push_body,
            headers={
                "X-Hub-Signature-256": _sign(secret, push_body),
                "X-GitHub-Event": "push",
                "X-GitHub-Delivery": "deliv-1",
            },
        )
        assert r_dup.status_code == 200
        assert r_dup.json()["deduped"] is True
        assert mock_trigger.call_count == 1

    dep = db.query(FrontendDeployment).filter(FrontendDeployment.server_id == srv.id).first()
    assert dep is not None
    dep.is_live = True
    dep.status = "ready"
    db.commit()

    del_body = json.dumps({"ref": "feature/login", "ref_type": "branch"}).encode("utf-8")
    r_del = client.post(
        f"/api/webhooks/github/{fs.webhook_url_token}",
        content=del_body,
        headers={
            "X-Hub-Signature-256": _sign(secret, del_body),
            "X-GitHub-Event": "delete",
            "X-GitHub-Delivery": "deliv-2",
        },
    )
    assert r_del.status_code == 200
    assert r_del.json()["deleted_previews"] == 1
    db.refresh(dep)
    assert dep.is_live is False
