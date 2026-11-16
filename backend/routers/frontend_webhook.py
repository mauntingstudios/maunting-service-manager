"""Echtzeit-GitHub-Webhook fuer Frontend-Deployments."""

from __future__ import annotations

import hashlib
import hmac
import json
from collections import OrderedDict
from datetime import datetime, timezone
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from middleware.rate_limit import limiter
from models import FrontendSettings, Server
from services import frontend_deploy_service

router = APIRouter(prefix="/api/webhooks/github", tags=["frontend-webhooks"])

_MAX_DELIVERIES = 2048
_DELIVERY_CACHE: OrderedDict[str, None] = OrderedDict()
_DELIVERY_LOCK = Lock()


def _is_duplicate_delivery(delivery_id: str | None) -> bool:
    if not delivery_id:
        return False
    with _DELIVERY_LOCK:
        if delivery_id in _DELIVERY_CACHE:
            return True
        _DELIVERY_CACHE[delivery_id] = None
        while len(_DELIVERY_CACHE) > _MAX_DELIVERIES:
            _DELIVERY_CACHE.popitem(last=False)
    return False


def _verify_signature(raw_body: bytes, secret: str, header_sig: str | None) -> bool:
    if not header_sig or not header_sig.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header_sig.strip())


@router.post("/{webhook_url_token}")
@limiter.limit("60/minute")
async def github_frontend_webhook(
    webhook_url_token: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    raw = await request.body()
    fs = (
        db.query(FrontendSettings)
        .filter(FrontendSettings.webhook_url_token == webhook_url_token)
        .first()
    )
    if fs is None:
        raise HTTPException(status_code=404, detail="Webhook nicht gefunden")

    secret = frontend_deploy_service.decrypt_webhook_secret(fs)
    sig = request.headers.get("x-hub-signature-256")
    if not secret or not _verify_signature(raw, secret, sig):
        raise HTTPException(status_code=401, detail="Ungueltige Webhook-Signatur")

    delivery_id = request.headers.get("x-github-delivery")
    if _is_duplicate_delivery(delivery_id):
        return {"ok": True, "deduped": True}

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Ungueltiges JSON") from exc

    fs.last_webhook_at = datetime.now(timezone.utc)
    server = db.get(Server, fs.server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    event = (request.headers.get("x-github-event") or "").strip().lower()
    if event == "ping":
        db.commit()
        return {"ok": True, "pong": True}

    if event == "delete":
        if payload.get("ref_type") == "branch" and payload.get("ref"):
            removed = frontend_deploy_service.delete_preview(db, server, str(payload["ref"]))
            db.commit()
            return {"ok": True, "deleted_previews": removed}
        db.commit()
        return {"ok": True, "ignored": True}

    if event != "push":
        db.commit()
        return {"ok": True, "ignored": True}

    ref = str(payload.get("ref") or "")
    if not ref.startswith("refs/heads/") or payload.get("deleted") is True:
        db.commit()
        return {"ok": True, "ignored": True}

    branch = ref[len("refs/heads/") :]
    is_prod = branch == fs.production_branch
    if not fs.auto_deploy or (not is_prod and not fs.previews_enabled):
        db.commit()
        return {"ok": True, "ignored": True}

    head_commit = payload.get("head_commit") or {}
    commit_sha = str(head_commit.get("id") or payload.get("after") or "") or None
    commit_msg = str(head_commit.get("message") or "").splitlines()[0] if head_commit.get("message") else None
    author = (head_commit.get("author") or {}).get("name")

    dep = frontend_deploy_service.enqueue(
        db,
        server,
        branch=branch,
        commit_sha=commit_sha,
        commit_message=commit_msg,
        commit_author=str(author) if author else None,
        source="push",
    )
    db.commit()
    frontend_deploy_service.trigger_async_build(dep.id)
    return {"ok": True, "deployment_id": dep.id, "kind": dep.kind}
