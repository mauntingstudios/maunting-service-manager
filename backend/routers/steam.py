"""
Steam Workshop API Router

Provides endpoints for mod search and details without requiring Steam API key.
Uses public Steam Community endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from database import get_db
from models import Server, User
from dependencies import get_current_user, require_server_permission
from services.steam_service import SteamApiUnavailable, get_steam_service, SteamModInfo
from games import get_plugin

router = APIRouter(prefix="/api/steam", tags=["steam"])


def _steam_api_error(exc: SteamApiUnavailable) -> HTTPException:
    code = exc.code or "steam_api_unavailable"
    return HTTPException(
        status_code=503,
        detail={"code": code, "message": f"errors.{code}"},
    )





def _resolve_steam_workshop_context(server_id: int, user: User, db: Session) -> tuple[str, list[str]]:
    """Verify permission and resolve Steam Workshop App ID + required tags."""
    require_server_permission(user, server_id, db, "server.mods.read")

    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Spiel unterstützt keine Mods")

    mod_support = plugin.get_mod_support()
    if not mod_support:
        raise HTTPException(status_code=400, detail="Mod-Informationen nicht verfügbar")

    return str(mod_support["workshop_id"]), list(mod_support.get("required_tags", []))


def _content_type_to_filetype(content_type: str) -> int:
    """Map API content_type string ('mods' | 'collections') to Steam filetype int."""
    return 1 if content_type.strip().lower() in ("collections", "collection") else 0


def _merge_tags(base_tags: list[str], extra_tags: Optional[str]) -> Optional[list[str]]:
    merged: list[str] = [t.strip() for t in base_tags if t and t.strip()]
    seen = {t.lower() for t in merged}
    if extra_tags:
        for raw in extra_tags.split(","):
            clean = raw.strip()
            if clean and clean.lower() not in seen:
                seen.add(clean.lower())
                merged.append(clean)
    return merged or None


@router.get("/workshop/filters")
async def get_workshop_filters(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Return game-specific Steam Workshop tags for the server's game."""
    workshop_id, _ = _resolve_steam_workshop_context(server_id, user, db)
    try:
        steam_service = await get_steam_service()
        return await steam_service.get_workshop_filters(workshop_id)
    except SteamApiUnavailable as e:
        raise _steam_api_error(e)
    except Exception:
        return {"appid": workshop_id, "tags": [], "source": "none"}


@router.get("/workshop/search")
async def search_workshop_mods(
    server_id: int,
    query: str = Query("", description="Suchbegriff"),
    page: int = Query(1, ge=1, description="Seitennummer"),
    per_page: int = Query(20, ge=1, le=50, description="Ergebnisse pro Seite"),
    content_type: str = Query("mods", description="Inhaltstyp: mods | collections"),
    tags: Optional[str] = Query(None, description="Kommagetrennte zusätzliche Workshop-Tags"),
    sort: Optional[str] = Query(None, description="Optionale Sortierung: trending | popular | newest | updated"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
) -> List[dict]:
    """Search workshop mods or collections for server's game."""
    workshop_id, required_tags = _resolve_steam_workshop_context(server_id, user, db)
    filetype = _content_type_to_filetype(content_type)
    merged_tags = _merge_tags(required_tags, tags)
    clean_sort = sort if sort in ("trending", "popular", "newest", "updated") else None

    try:
        steam_service = await get_steam_service()
        mods = await steam_service.search_workshop_mods(
            appid=workshop_id,
            query=query,
            page=page,
            per_page=per_page,
            required_tags=merged_tags,
            filetype=filetype,
            sort=clean_sort,
        )

        return [_mod_to_dict(mod) for mod in mods]

    except SteamApiUnavailable as e:
        raise _steam_api_error(e)
    except Exception:
        raise HTTPException(status_code=500, detail="errors.steam_search_failed")


@router.get("/workshop/popular")
async def get_popular_mods(
    server_id: int,
    limit: int = Query(20, ge=1, le=50, description="Anzahl der Mods"),
    page: int = Query(1, ge=1, description="Seitennummer (Pagination)"),
    sort: str = Query("trending", description="Sortierung: trending | popular | newest | updated"),
    content_type: str = Query("mods", description="Inhaltstyp: mods | collections"),
    tags: Optional[str] = Query(None, description="Kommagetrennte zusätzliche Workshop-Tags"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
) -> List[dict]:
    """Get workshop mods or collections for server's game, sorted by the given criteria."""
    workshop_id, required_tags = _resolve_steam_workshop_context(server_id, user, db)
    filetype = _content_type_to_filetype(content_type)
    merged_tags = _merge_tags(required_tags, tags)

    if sort not in ("trending", "popular", "newest", "updated"):
        sort = "trending"

    try:
        steam_service = await get_steam_service()
        mods = await steam_service.get_popular_mods(
            appid=workshop_id,
            limit=limit,
            required_tags=merged_tags,
            sort=sort,
            page=page,
            filetype=filetype,
        )

        return [_mod_to_dict(mod) for mod in mods]

    except SteamApiUnavailable as e:
        raise _steam_api_error(e)
    except Exception:
        raise HTTPException(status_code=500, detail="errors.steam_load_failed")


@router.get("/workshop/mod/{publishedfileid}")
async def get_mod_details(
    server_id: int,
    publishedfileid: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
) -> dict:
    """Get detailed information for a specific workshop mod."""
    workshop_id, _ = _resolve_steam_workshop_context(server_id, user, db)

    try:
        steam_service = await get_steam_service()
        mod = await steam_service.get_mod_details(
            appid=workshop_id,
            publishedfileid=publishedfileid
        )

        if not mod:
            raise HTTPException(status_code=404, detail="Mod nicht gefunden")

        return _mod_to_dict(mod)

    except HTTPException:
        raise
    except SteamApiUnavailable as e:
        raise _steam_api_error(e)
    except Exception:
        raise HTTPException(status_code=500, detail="errors.steam_load_failed")


@router.get("/workshop/mod/{publishedfileid}/dependencies")
async def get_mod_dependencies(
    publishedfileid: str,
    server_id: int = Query(..., description="Server-ID zur Ermittlung der Steam App-ID"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Resolve required Steam Workshop dependencies (Required Items) for a mod."""
    clean_id = publishedfileid.strip()
    if not clean_id.isdigit() or len(clean_id) > 20:
        raise HTTPException(status_code=400, detail="Ungültige Workshop-ID")

    workshop_id, _ = _resolve_steam_workshop_context(server_id, user, db)

    try:
        steam_service = await get_steam_service()
        deps_data = await steam_service.get_mod_dependencies(
            appid=workshop_id,
            publishedfileid=clean_id,
        )
        if not deps_data:
            raise HTTPException(status_code=404, detail="Mod nicht gefunden")

        return {
            "mod": _mod_to_dict(deps_data["mod"]),
            "dependencies": [_mod_to_dict(dep) for dep in deps_data["dependencies"]],
            "unavailable_ids": deps_data["unavailable_ids"],
        }
    except HTTPException:
        raise
    except SteamApiUnavailable as e:
        raise _steam_api_error(e)
    except Exception:
        raise HTTPException(status_code=500, detail="errors.steam_load_failed")


@router.get("/workshop/collection/{publishedfileid}")
async def get_collection_details(
    publishedfileid: str,
    server_id: int = Query(..., description="Server-ID zur Ermittlung der Steam App-ID"),
    max_items: int = Query(500, ge=1, le=500, description="Maximale Anzahl aufgeloestem Mods"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Resolve a Steam Workshop Collection and its contained mods in order."""
    clean_id = publishedfileid.strip()
    if not clean_id.isdigit() or len(clean_id) > 20:
        raise HTTPException(status_code=400, detail="Ungültige Collection-ID")

    workshop_id, _ = _resolve_steam_workshop_context(server_id, user, db)

    try:
        steam_service = await get_steam_service()
        details = await steam_service.get_collection_details(
            appid=workshop_id,
            collection_id=clean_id,
            max_items=max_items,
        )
        if not details:
            raise HTTPException(status_code=404, detail="Collection nicht gefunden")

        return {
            "collection": _mod_to_dict(details["collection"]),
            "items": [_mod_to_dict(item) for item in details["items"]],
            "unavailable_ids": details["unavailable_ids"],
            "item_count": len(details["items"]),
            "total_children": details["total_children"],
        }
    except HTTPException:
        raise
    except SteamApiUnavailable as e:
        raise _steam_api_error(e)
    except Exception:
        raise HTTPException(status_code=500, detail="errors.steam_load_failed")


def _mod_to_dict(mod: SteamModInfo) -> dict:
    """Convert SteamModInfo to dict for JSON response."""
    return {
        "publishedfileid": mod.publishedfileid,
        "title": mod.title,
        "description": mod.description,
        "creator": mod.creator,
        "file_size": mod.file_size,
        "file_size_mb": round(mod.file_size / (1024 * 1024), 2) if mod.file_size > 0 else 0,
        "created": mod.created.isoformat(),
        "updated": mod.updated.isoformat(),
        "subscriptions": mod.subscriptions,
        "favorites": mod.favorites,
        "tags": mod.tags,
        "preview_url": mod.preview_url,
        "direct_url": mod.direct_url,
        "item_type": getattr(mod, "item_type", "mod"),
        "children_count": getattr(mod, "children_count", 0),
        "dependencies_count": getattr(mod, "children_count", 0)
        if getattr(mod, "item_type", "mod") != "collection"
        else 0,
        "child_ids": list(getattr(mod, "child_ids", []) or []),
    }
