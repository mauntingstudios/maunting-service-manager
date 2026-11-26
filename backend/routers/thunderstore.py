"""Thunderstore API Router.

Bietet Endpunkte fuer Mod-Suche, Popular-Listen, Abhaengigkeiten und
Metadaten-Batch-Abfragen ueber den oeffentlichen Thunderstore Community-Index
(kein API-Key erforderlich).
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, require_server_permission
from games import get_plugin
from models import Server, User
from services.thunderstore_service import (
    ThunderstoreApiUnavailable,
    ThunderstorePackageInfo,
    get_thunderstore_service,
    strip_thunderstore_prefix,
)

router = APIRouter(prefix="/api/thunderstore", tags=["thunderstore"])


def _thunderstore_api_error(exc: ThunderstoreApiUnavailable) -> HTTPException:
    code = exc.code or "thunderstore_api_unavailable"
    return HTTPException(
        status_code=503,
        detail={"code": code, "message": f"errors.{code}"},
    )


def _pkg_to_dict(pkg: ThunderstorePackageInfo) -> dict[str, Any]:
    return {
        "publishedfileid": pkg.publishedfileid,
        "title": pkg.name,
        "description": pkg.description,
        "creator": pkg.owner,
        "file_size": pkg.file_size,
        "file_size_mb": round(pkg.file_size / (1024 * 1024), 2) if pkg.file_size > 0 else 0,
        "created": pkg.created.isoformat(),
        "updated": pkg.updated.isoformat(),
        "subscriptions": pkg.downloads,
        "favorites": pkg.rating_score,
        "tags": pkg.categories,
        "preview_url": pkg.icon_url,
        "direct_url": pkg.package_url,
        "provider": "thunderstore",
        "is_modpack": pkg.is_modpack,
        "item_type": "modpack" if pkg.is_modpack else "mod",
        "version": pkg.latest_version,
        "dependencies_count": len(pkg.dependencies),
    }


def _resolve_thunderstore_server(
    server_id: int,
    user: User,
    db: Session,
    *,
    permission: str = "server.mods.read",
) -> tuple[Server, Any, dict[str, Any], str]:
    require_server_permission(user, server_id, db, permission)

    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Spiel unterstuetzt keine Mods")

    mod_support = plugin.get_mod_support()
    if not mod_support or not mod_support.get("supports_thunderstore") or not mod_support.get("thunderstore_community"):
        raise HTTPException(status_code=400, detail="Thunderstore fuer dieses Spiel nicht konfiguriert")

    return server, plugin, mod_support, str(mod_support["thunderstore_community"])


@router.get("/servers/{server_id}/search")
async def search_thunderstore_mods(
    server_id: int,
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(20, ge=1, le=50),
    category: Optional[str] = Query(None, max_length=64),
    sort: str = Query("downloads", max_length=32),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Durchsucht den Thunderstore-Index fuer die Community des Servers."""
    _server, _plugin, _mod_support, community = _resolve_thunderstore_server(server_id, user, db)
    svc = await get_thunderstore_service()

    try:
        packages, total = await svc.search_packages(
            community,
            query=q,
            category=category,
            sort=sort,
            page=page,
            per_page=per_page,
        )
    except ThunderstoreApiUnavailable as exc:
        raise _thunderstore_api_error(exc) from exc

    return {
        "mods": [_pkg_to_dict(p) for p in packages],
        "total": total,
        "page": page,
        "per_page": per_page,
        "query": q,
        "community": community,
    }


@router.get("/servers/{server_id}/popular")
async def get_popular_thunderstore_mods(
    server_id: int,
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(20, ge=1, le=50),
    category: Optional[str] = Query(None, max_length=64),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Liefert beliebte Thunderstore-Pakete fuer den Server."""
    _server, _plugin, _mod_support, community = _resolve_thunderstore_server(server_id, user, db)
    svc = await get_thunderstore_service()

    try:
        packages, total = await svc.search_packages(
            community,
            query="",
            category=category,
            sort="downloads",
            page=page,
            per_page=per_page,
        )
    except ThunderstoreApiUnavailable as exc:
        raise _thunderstore_api_error(exc) from exc

    return {
        "mods": [_pkg_to_dict(p) for p in packages],
        "total": total,
        "page": page,
        "per_page": per_page,
        "community": community,
    }


@router.get("/servers/{server_id}/mods/{pkg_id}/dependencies")
async def get_thunderstore_dependencies(
    server_id: int,
    pkg_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Loest Abhaengigkeiten eines Thunderstore-Pakets auf."""
    _server, _plugin, _mod_support, community = _resolve_thunderstore_server(server_id, user, db)
    svc = await get_thunderstore_service()

    try:
        deps = await svc.resolve_dependencies(community, pkg_id)
    except ThunderstoreApiUnavailable as exc:
        raise _thunderstore_api_error(exc) from exc

    return {
        "package_id": strip_thunderstore_prefix(pkg_id),
        "dependencies": [_pkg_to_dict(d) for d in deps],
    }


@router.get("/servers/{server_id}/metadata")
async def get_thunderstore_metadata(
    server_id: int,
    ids: str = Query(..., max_length=2000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch-Metadatenabfrage fuer Thunderstore-Pakete eines Servers."""
    _server, _plugin, _mod_support, community = _resolve_thunderstore_server(server_id, user, db)
    raw_ids = [item.strip() for item in ids.split(",") if item.strip()][:50]
    if not raw_ids:
        return {"mods": {}}

    svc = await get_thunderstore_service()
    try:
        packages = await svc.get_packages(community, raw_ids)
    except ThunderstoreApiUnavailable as exc:
        raise _thunderstore_api_error(exc) from exc

    result: dict[str, Any] = {}
    for p in packages:
        payload = _pkg_to_dict(p)
        result[p.publishedfileid] = payload
        result[p.full_name] = payload
    return {"mods": result}
