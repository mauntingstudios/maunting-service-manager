"""Modrinth API Router.

Bietet Endpunkte fuer Mod-, Plugin- und Modpack-Suche, Popular-Listen,
Abhaengigkeiten und Metadaten-Batch-Abfragen ueber die oeffentliche
Modrinth Labrinth v2 API (optional mit Personal Access Token).
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, require_server_permission
from games import get_plugin
from models import Server, User
from services.modrinth_service import (
    ModrinthApiUnavailable,
    ModrinthModInfo,
    extract_modrinth_url_query,
    get_modrinth_service,
    strip_modrinth_prefix,
)
from services.permission_service import has_global_permission, has_server_permission

router = APIRouter(prefix="/api/modrinth", tags=["modrinth"])


def _modrinth_api_error(exc: ModrinthApiUnavailable) -> HTTPException:
    code = exc.code or "modrinth_api_unavailable"
    return HTTPException(
        status_code=503,
        detail={"code": code, "message": f"errors.{code}"},
    )


def _mod_to_dict(mod: ModrinthModInfo) -> dict[str, Any]:
    is_modpack = mod.project_type == "modpack"
    return {
        "publishedfileid": mod.publishedfileid,
        "title": mod.title,
        "description": mod.description,
        "creator": mod.creator,
        "file_size": 0,
        "file_size_mb": 0,
        "created": mod.created.isoformat(),
        "updated": mod.updated.isoformat(),
        "subscriptions": mod.downloads,
        "favorites": mod.followers,
        "tags": mod.categories,
        "preview_url": mod.icon_url,
        "direct_url": mod.direct_url,
        "provider": "modrinth",
        "is_modpack": is_modpack,
        "item_type": mod.project_type or "mod",
        "dependencies_count": 0,
    }


def _resolve_modrinth_server(
    server_id: int,
    user: User,
    db: Session,
    *,
    permission: str = "server.mods.read",
) -> tuple[Server, Any, dict[str, Any]]:
    require_server_permission(user, server_id, db, permission)

    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Spiel unterstuetzt keine Mods")

    mod_support = plugin.get_mod_support()
    if not mod_support or not mod_support.get("supports_modrinth"):
        raise HTTPException(status_code=400, detail="Modrinth fuer dieses Spiel nicht konfiguriert")

    return server, plugin, mod_support


def _resolve_project_types(mod_support: dict[str, Any], requested: Optional[str]) -> list[str]:
    configured = list(mod_support.get("modrinth_project_types") or ["mod"])
    if not requested:
        return configured
    raw = requested.strip().lower()
    if raw in ("all", ""):
        return configured
    if raw in ("modpacks", "modpack", "packs"):
        return ["modpack"]
    if raw in ("mods", "mod"):
        return ["plugin"] if configured == ["plugin"] else ["mod"]
    if raw in ("plugins", "plugin"):
        return ["plugin"]
    if raw in ("datapacks", "datapack"):
        return ["datapack"]
    return configured


def _detect_game_version(plugin: Any) -> str | None:
    bp = getattr(plugin, "_blueprint", None)
    if bp and hasattr(bp, "runtime") and hasattr(bp.runtime, "env"):
        v = str(bp.runtime.env.get("VERSION", "")).strip()
        if v and v.upper() != "LATEST":
            return v
    return None


@router.get("/servers/{server_id}/search")
async def search_modrinth_mods(
    server_id: int,
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(20, ge=1, le=50),
    project_type: Optional[str] = Query(None, max_length=32),
    sort: str = Query("relevance", max_length=32),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Durchsucht Modrinth nach Mods, Plugins oder Modpacks fuer einen Server."""
    _server, plugin, mod_support = _resolve_modrinth_server(server_id, user, db)
    svc = await get_modrinth_service()

    query_clean = extract_modrinth_url_query(q)
    ptypes = _resolve_project_types(mod_support, project_type)
    loaders = list(mod_support.get("modrinth_loaders") or [])
    game_version = _detect_game_version(plugin)

    # Direkter Projekt-Lookup wenn URL/ID eingefuegt wurde
    if q.strip().lower().startswith(("https://modrinth.com/", "http://modrinth.com/", "modrinth:")):
        try:
            direct = await svc.get_project(query_clean)
        except ModrinthApiUnavailable as exc:
            raise _modrinth_api_error(exc) from exc
        if direct is not None:
            return {
                "mods": [_mod_to_dict(direct)],
                "total": 1,
                "page": 1,
                "per_page": per_page,
                "query": q,
            }

    try:
        mods, total = await svc.search_projects(
            query=query_clean,
            project_types=ptypes,
            loaders=loaders,
            game_version=game_version,
            sort=sort,
            page=page,
            per_page=per_page,
        )
    except ModrinthApiUnavailable as exc:
        raise _modrinth_api_error(exc) from exc

    return {
        "mods": [_mod_to_dict(m) for m in mods],
        "total": total,
        "page": page,
        "per_page": per_page,
        "query": q,
    }


@router.get("/servers/{server_id}/popular")
async def get_popular_modrinth_mods(
    server_id: int,
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(20, ge=1, le=50),
    project_type: Optional[str] = Query(None, max_length=32),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Liefert beliebte Modrinth-Projekte fuer den Server."""
    _server, plugin, mod_support = _resolve_modrinth_server(server_id, user, db)
    svc = await get_modrinth_service()
    ptypes = _resolve_project_types(mod_support, project_type)
    loaders = list(mod_support.get("modrinth_loaders") or [])
    game_version = _detect_game_version(plugin)

    try:
        mods, total = await svc.search_projects(
            query="",
            project_types=ptypes,
            loaders=loaders,
            game_version=game_version,
            sort="downloads",
            page=page,
            per_page=per_page,
        )
    except ModrinthApiUnavailable as exc:
        raise _modrinth_api_error(exc) from exc

    return {
        "mods": [_mod_to_dict(m) for m in mods],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/servers/{server_id}/mods/{project_id}/dependencies")
async def get_modrinth_dependencies(
    server_id: int,
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Loest Pflicht-Abhaengigkeiten eines Modrinth-Projekts auf."""
    _server, plugin, mod_support = _resolve_modrinth_server(server_id, user, db)
    svc = await get_modrinth_service()
    loaders = list(mod_support.get("modrinth_loaders") or [])
    game_version = _detect_game_version(plugin)

    try:
        deps = await svc.resolve_dependencies(
            project_id,
            loaders=loaders or None,
            game_versions=[game_version] if game_version else None,
        )
    except ModrinthApiUnavailable as exc:
        raise _modrinth_api_error(exc) from exc

    return {
        "project_id": strip_modrinth_prefix(project_id),
        "dependencies": [_mod_to_dict(d) for d in deps],
    }


@router.get("/mods/metadata")
async def get_modrinth_metadata(
    ids: str = Query(..., max_length=2000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch-Metadatenabfrage fuer Modrinth-Projekte (kommagetrennte IDs)."""
    if not has_global_permission(db, user, "server.mods.read"):
        server_ids = [row[0] for row in db.query(Server.id).all()]
        if not any(has_server_permission(db, user, sid, "server.mods.read") for sid in server_ids):
            raise HTTPException(status_code=403, detail="Keine Berechtigung")
    raw_ids = [item.strip() for item in ids.split(",") if item.strip()][:50]
    if not raw_ids:
        return {"mods": {}}

    svc = await get_modrinth_service()
    try:
        projects = await svc.get_projects(raw_ids)
    except ModrinthApiUnavailable as exc:
        raise _modrinth_api_error(exc) from exc

    result: dict[str, Any] = {}
    for p in projects:
        payload = _mod_to_dict(p)
        result[p.publishedfileid] = payload
        result[p.project_id] = payload
    return {"mods": result}
