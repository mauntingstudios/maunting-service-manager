"""Registrierung und Entfernung von GitHub-Repo-Webhooks fuer Frontend-Server."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from blueprints.registry import get_registry
from blueprints.schema import BlueprintCategory
from config import is_local_origin, settings
from models import KIND_GITHUB_TOKEN, Server
from services import credential_service, frontend_deploy_service

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HookSyncResult:
    registered: bool
    hook_id: int | None = None
    reason: str | None = None


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "msm-panel",
    }


def _repo_for_server(server: Server) -> str | None:
    entry = get_registry().get(server.game_type)
    if entry is None:
        return None
    bp = entry.blueprint
    if bp.meta.category != BlueprintCategory.FRONTEND or bp.source.github is None:
        return None
    return bp.source.github.repo


def register_webhook(db: Session, server: Server) -> HookSyncResult:
    repo = _repo_for_server(server)
    if not repo:
        return HookSyncResult(False, reason="no_github_repo")

    panel_url = (getattr(settings, "panel_url", "") or "").strip().rstrip("/")
    if not panel_url or is_local_origin(panel_url):
        return HookSyncResult(False, reason="panel_not_public")

    cred = credential_service.resolve_for_server(db, server.id, KIND_GITHUB_TOKEN)
    if cred is None or not cred.secret:
        return HookSyncResult(False, reason="missing_github_token")

    fs = frontend_deploy_service.get_or_create_settings(db, server)
    secret = frontend_deploy_service.decrypt_webhook_secret(fs)
    if not secret:
        return HookSyncResult(False, reason="missing_webhook_secret")

    if fs.github_hook_id:
        return HookSyncResult(True, hook_id=fs.github_hook_id)

    hook_url = f"{panel_url}/api/webhooks/github/{fs.webhook_url_token}"
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                f"https://api.github.com/repos/{repo}/hooks",
                headers=_github_headers(cred.secret),
                json={
                    "name": "web",
                    "active": True,
                    "events": ["push", "delete"],
                    "config": {
                        "url": hook_url,
                        "content_type": "json",
                        "secret": secret,
                        "insecure_ssl": "0",
                    },
                },
            )
        if resp.status_code in (200, 201):
            hook_id = int((resp.json() or {}).get("id") or 0) or None
            fs.github_hook_id = hook_id
            db.flush()
            return HookSyncResult(True, hook_id=hook_id)
        if resp.status_code in (401, 403, 404):
            return HookSyncResult(False, reason="missing_hook_permission")
        return HookSyncResult(False, reason=f"github_http_{resp.status_code}")
    except Exception as exc:
        logger.warning("GitHub-Webhook-Registrierung fuer Server %s fehlgeschlagen: %s", server.id, exc)
        return HookSyncResult(False, reason="network_error")


def remove_webhook(db: Session, server: Server) -> bool:
    repo = _repo_for_server(server)
    fs = frontend_deploy_service.get_or_create_settings(db, server)
    hook_id = fs.github_hook_id
    if not repo or not hook_id:
        fs.github_hook_id = None
        return False

    cred = credential_service.resolve_for_server(db, server.id, KIND_GITHUB_TOKEN)
    if cred is None or not cred.secret:
        fs.github_hook_id = None
        return False

    try:
        with httpx.Client(timeout=10.0) as client:
            client.delete(
                f"https://api.github.com/repos/{repo}/hooks/{hook_id}",
                headers=_github_headers(cred.secret),
            )
    except Exception as exc:
        logger.debug("GitHub-Webhook entfernen fuer Server %s: %s", server.id, exc)
    fs.github_hook_id = None
    db.flush()
    return True
