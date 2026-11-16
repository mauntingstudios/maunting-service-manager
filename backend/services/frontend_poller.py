"""30-Sekunden-Fallback-Poller fuer Frontend-Repos ohne aktiven Webhook."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from blueprints.github_source import remote_branch_sha
from blueprints.registry import get_registry
from blueprints.schema import BlueprintCategory
from models import KIND_GITHUB_TOKEN, FrontendDeployment, FrontendSettings, Server
from services import credential_service, frontend_deploy_service

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30
WEBHOOK_GRACE_WINDOW = timedelta(minutes=10)


def poll_once(db: Session) -> int:
    """Prueft aktive Frontend-Server ohne frischen Webhook auf neue Commits."""
    now = datetime.now(timezone.utc)
    cutoff = now - WEBHOOK_GRACE_WINDOW
    settings_rows = (
        db.query(FrontendSettings)
        .filter(FrontendSettings.auto_deploy.is_(True))
        .all()
    )
    triggered = 0
    for fs in settings_rows:
        if fs.last_webhook_at is not None and fs.last_webhook_at > cutoff:
            continue
        server = db.get(Server, fs.server_id)
        if server is None:
            continue
        entry = get_registry().get(server.game_type)
        if entry is None:
            continue
        bp = entry.blueprint
        if bp.meta.category != BlueprintCategory.FRONTEND or bp.source.github is None:
            continue

        cred = credential_service.resolve_for_server(db, server.id, KIND_GITHUB_TOKEN)
        token = cred.secret if cred is not None else None
        branches = [fs.production_branch]
        if fs.previews_enabled:
            active_previews = (
                db.query(FrontendDeployment.branch)
                .filter(
                    FrontendDeployment.server_id == server.id,
                    FrontendDeployment.kind == "preview",
                    FrontendDeployment.is_live.is_(True),
                )
                .distinct()
                .all()
            )
            for (b,) in active_previews:
                if b not in branches:
                    branches.append(b)

        for branch in branches:
            remote_sha = remote_branch_sha(bp.source.github.repo, branch, token=token)
            if not remote_sha:
                continue
            latest = (
                db.query(FrontendDeployment)
                .filter(
                    FrontendDeployment.server_id == server.id,
                    FrontendDeployment.branch == branch,
                    FrontendDeployment.status.in_(("queued", "building", "ready")),
                )
                .order_by(FrontendDeployment.created_at.desc())
                .first()
            )
            if latest is not None and latest.commit_sha == remote_sha:
                continue
            dep = frontend_deploy_service.enqueue(
                db,
                server,
                branch=branch,
                commit_sha=remote_sha,
                source="poll",
            )
            db.commit()
            frontend_deploy_service.trigger_async_build(dep.id)
            triggered += 1
    return triggered


async def poller_loop(stop_event: asyncio.Event) -> None:
    from database import SessionLocal

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SECONDS)
            break
        except asyncio.TimeoutError:
            pass

        def _tick() -> None:
            db = SessionLocal()
            try:
                poll_once(db)
            finally:
                db.close()

        try:
            await asyncio.to_thread(_tick)
        except Exception as exc:
            logger.debug("Frontend-Poller-Durchlauf fehlgeschlagen: %s", exc)
