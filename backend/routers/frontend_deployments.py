"""API-Endpunkte fuer Frontend-Deployments, Einstellungen, Domains und Online-Status."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, require_server_permission, verify_csrf
from models import FrontendDeployment, Server, User
from services import frontend_deploy_service, frontend_domain_service, github_hook_service
from services.frontend_caddy_config import slugify_branch

router = APIRouter(prefix="/api/servers/{server_id}/frontend", tags=["frontend"])


def _get_frontend_server(server_id: int, db: Session) -> Server:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    return server


def _deployment_url(row: FrontendDeployment, server: Server | None = None, fs=None) -> str | None:
    if row.url:
        return row.url
    if not row.is_live or server is None:
        return None
    if row.kind == "production" and fs is not None:
        return _production_url(server, fs)
    if row.kind == "preview" and row.port is not None:
        preview_host = frontend_domain_service.build_preview_subdomain(server, row.branch_slug)
        if preview_host:
            return f"https://{preview_host}"
        ip = server.public_bind_ip or (server.node.public_ip if server.node else None) or "127.0.0.1"
        return f"http://{ip}:{int(row.port)}"
    return None


def _serialize_deployment(row: FrontendDeployment, *, server: Server | None = None, fs=None) -> dict[str, Any]:
    return {
        "id": row.id,
        "server_id": row.server_id,
        "kind": row.kind,
        "branch": row.branch,
        "branch_slug": row.branch_slug,
        "commit_sha": row.commit_sha,
        "commit_message": row.commit_message,
        "commit_author": row.commit_author,
        "source": row.source,
        "status": row.status,
        "is_live": row.is_live,
        "port": row.port,
        "url": _deployment_url(row, server=server, fs=fs),
        "error_summary": row.error_summary,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }


def _production_url(server: Server, fs) -> str | None:
    if fs.domain and fs.domain_verified:
        return f"https://{fs.domain}"
    ip = server.public_bind_ip or (server.node.public_ip if server.node else None) or "127.0.0.1"
    port = frontend_deploy_service._server_web_port(server)
    return f"http://{ip}:{port}"


class FrontendSettingsUpdate(BaseModel):
    production_branch: str | None = Field(default=None, min_length=1, max_length=255)
    auto_deploy: bool | None = None
    previews_enabled: bool | None = None
    domain: str | None = Field(default=None, max_length=255)
    env_production: dict[str, str] | None = None
    env_preview: dict[str, str] | None = None


class TriggerBuildRequest(BaseModel):
    branch: str | None = Field(default=None, max_length=255)


class OnlineToggleRequest(BaseModel):
    online: bool


@router.get("")
def get_frontend_overview(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.view")
    server = _get_frontend_server(server_id, db)
    fs = frontend_deploy_service.get_or_create_settings(db, server)
    db.commit()

    previews = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.is_live.is_(True),
        )
        .order_by(FrontendDeployment.created_at.desc())
        .all()
    )
    prod_live = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "production",
            FrontendDeployment.is_live.is_(True),
        )
        .first()
    )

    return {
        "server_id": server.id,
        "production_branch": fs.production_branch,
        "auto_deploy": fs.auto_deploy,
        "previews_enabled": fs.previews_enabled,
        "online": fs.online,
        "production_url": _production_url(server, fs),
        "production_deployment": _serialize_deployment(prod_live, server=server, fs=fs) if prod_live else None,
        "previews": [_serialize_deployment(p, server=server, fs=fs) for p in previews],
        "domain": fs.domain,
        "domain_verified": fs.domain_verified,
        "domain_verify_txt_host": f"_msm-verify.{fs.domain}" if fs.domain else None,
        "domain_verify_txt_value": f"msm-verify={fs.domain_verify_token}" if fs.domain and fs.domain_verify_token else None,
        "webhook_registered": bool(fs.github_hook_id),
        "env_production": frontend_deploy_service.get_env_vars(db, server.id, "production"),
        "env_preview": frontend_deploy_service.get_env_vars(db, server.id, "preview"),
    }


@router.patch("")
def update_frontend_settings(
    server_id: int,
    req: FrontendSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.config.write")
    server = _get_frontend_server(server_id, db)
    fs = frontend_deploy_service.get_or_create_settings(db, server)

    if req.production_branch is not None:
        fs.production_branch = req.production_branch.strip()
    if req.auto_deploy is not None:
        fs.auto_deploy = bool(req.auto_deploy)
    if req.previews_enabled is not None:
        fs.previews_enabled = bool(req.previews_enabled)
    if "domain" in req.model_fields_set:
        frontend_domain_service.set_custom_domain(db, server, req.domain)
    if req.env_production is not None:
        frontend_deploy_service.set_env_vars(db, server, "production", req.env_production)
    if req.env_preview is not None:
        frontend_deploy_service.set_env_vars(db, server, "preview", req.env_preview)

    hook_result = None
    if req.auto_deploy is True:
        hook_result = github_hook_service.register_webhook(db, server)
    elif req.auto_deploy is False and fs.github_hook_id:
        github_hook_service.remove_webhook(db, server)

    db.commit()
    overview = get_frontend_overview(server_id, db=db, user=user)
    if hook_result is not None:
        overview["webhook_sync_reason"] = hook_result.reason
    return overview


@router.post("/domain/verify")
def verify_domain(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.config.write")
    server = _get_frontend_server(server_id, db)
    res = frontend_domain_service.verify_custom_domain(db, server)
    db.commit()
    return res


@router.post("/online")
def toggle_online(
    server_id: int,
    req: OnlineToggleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.restart")
    server = _get_frontend_server(server_id, db)
    fs = frontend_deploy_service.set_online(db, server, req.online)
    db.commit()
    return {"online": fs.online}


@router.get("/deployments")
def list_deployments(
    server_id: int,
    branch: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    require_server_permission(user, server_id, db, "server.view")
    server = _get_frontend_server(server_id, db)
    fs = db.get(frontend_deploy_service.FrontendSettings, server.id)
    q = db.query(FrontendDeployment).filter(FrontendDeployment.server_id == server_id)
    if branch:
        q = q.filter(FrontendDeployment.branch == branch)
    if kind:
        q = q.filter(FrontendDeployment.kind == kind)
    rows = q.order_by(FrontendDeployment.created_at.desc()).limit(50).all()
    return [_serialize_deployment(r, server=server, fs=fs) for r in rows]


@router.get("/deployments/{dep_id}/log")
def get_deployment_log(
    server_id: int,
    dep_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.view")
    server = _get_frontend_server(server_id, db)
    dep = db.get(FrontendDeployment, dep_id)
    if dep is None or dep.server_id != server_id:
        raise HTTPException(status_code=404, detail="Deployment nicht gefunden")
    content = frontend_deploy_service.strip_ansi(frontend_deploy_service.read_build_log(server, dep))
    return {"id": dep.id, "status": dep.status, "log": content}


@router.post("/deployments/{dep_id}/cancel")
def cancel_deployment(
    server_id: int,
    dep_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.restart")
    server = _get_frontend_server(server_id, db)
    dep = db.get(FrontendDeployment, dep_id)
    if dep is None or dep.server_id != server_id:
        raise HTTPException(status_code=404, detail="Deployment nicht gefunden")
    canceled = frontend_deploy_service.cancel_deployment(db, server, dep)
    db.commit()
    return _serialize_deployment(canceled)


@router.post("/cache/clear")
def clear_cache(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.restart")
    server = _get_frontend_server(server_id, db)
    frontend_deploy_service.clear_build_cache(server)
    return {"cleared": True}


@router.post("/deployments", status_code=201)
def trigger_deployment(
    server_id: int,
    req: TriggerBuildRequest = TriggerBuildRequest(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.restart")
    server = _get_frontend_server(server_id, db)
    fs = frontend_deploy_service.get_or_create_settings(db, server)
    branch = (req.branch or fs.production_branch).strip()
    dep = frontend_deploy_service.enqueue(
        db,
        server,
        branch=branch,
        source="manual",
        actor_user_id=user.id,
    )
    db.commit()
    frontend_deploy_service.trigger_async_build(dep.id, actor_user_id=user.id)
    return _serialize_deployment(dep)


@router.post("/deployments/{dep_id}/promote")
def promote_deployment(
    server_id: int,
    dep_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.restart")
    dep = db.get(FrontendDeployment, dep_id)
    if dep is None or dep.server_id != server_id:
        raise HTTPException(status_code=404, detail="Deployment nicht gefunden")
    promoted = frontend_deploy_service.promote(db, dep_id)
    db.commit()
    return _serialize_deployment(promoted)


@router.post("/deployments/{dep_id}/rollback")
def rollback_deployment(
    server_id: int,
    dep_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.restart")
    dep = db.get(FrontendDeployment, dep_id)
    if dep is None or dep.server_id != server_id:
        raise HTTPException(status_code=404, detail="Deployment nicht gefunden")
    rolled = frontend_deploy_service.rollback(db, dep_id)
    db.commit()
    return _serialize_deployment(rolled)


@router.delete("/previews/{branch_slug}")
def remove_preview(
    server_id: int,
    branch_slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    require_server_permission(user, server_id, db, "server.restart")
    server = _get_frontend_server(server_id, db)
    clean_slug = slugify_branch(branch_slug)
    row = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.branch_slug == clean_slug,
        )
        .first()
    )
    branch_name = row.branch if row else clean_slug
    removed = frontend_deploy_service.delete_preview(db, server, branch_name)
    db.commit()
    return {"deleted": removed}
