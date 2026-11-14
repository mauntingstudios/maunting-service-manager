"""CurseForge API Router.

Bietet Endpunkte für Mod-Suche, Popular-Listen und Details über die offizielle
CurseForge API v1. Nutzt den vom Betreiber in den Panel-Einstellungen hinterlegten
API-Schlüssel.
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from models import Server, User
from dependencies import get_current_user, require_server_permission, verify_csrf
from services.curseforge_service import (
    CurseForgeApiUnavailable,
    CurseForgeModInfo,
    extract_curseforge_url_query,
    get_curseforge_service,
)
from games import get_plugin

router = APIRouter(prefix="/api/curseforge", tags=["curseforge"])
_UNSUPPORTED_CLASS = object()
_MAX_MANIFEST_UPLOAD_BYTES = 5 * 1024 * 1024


def _curseforge_api_error(exc: CurseForgeApiUnavailable) -> HTTPException:
    code = exc.code or "curseforge_api_unavailable"
    return HTTPException(
        status_code=503,
        detail={"code": code, "message": f"errors.{code}"},
    )


def _mod_to_dict(mod: CurseForgeModInfo, *, modpack_class_id: int | None = None) -> dict:
    """Konvertiert CurseForgeModInfo in das einheitliche ModBrowserItem-JSON."""
    raw_class_id = getattr(mod, "class_id", None)
    class_id_val = raw_class_id if isinstance(raw_class_id, int) else None
    is_modpack = bool(
        getattr(mod, "is_modpack", False)
        or (
            modpack_class_id is not None
            and class_id_val is not None
            and class_id_val == modpack_class_id
        )
    )
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
        "provider": "curseforge",
        "class_id": class_id_val,
        "has_server_pack": bool(getattr(mod, "has_server_pack", False)),
        "server_pack_file_id": getattr(mod, "server_pack_file_id", None)
        if isinstance(getattr(mod, "server_pack_file_id", None), int)
        else None,
        "main_file_id": getattr(mod, "main_file_id", None)
        if isinstance(getattr(mod, "main_file_id", None), int)
        else None,
        "allow_mod_distribution": bool(getattr(mod, "allow_mod_distribution", True)),
        "is_modpack": is_modpack,
        "item_type": "modpack" if is_modpack else "mod",
    }


def _resolve_curseforge_server(
    server_id: int,
    user: User,
    db: Session,
    *,
    permission: str = "server.mods.read",
) -> tuple[Server, Any, dict, str]:
    require_server_permission(user, server_id, db, permission)

    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Spiel unterstützt keine Mods")

    mod_support = plugin.get_mod_support()
    if not mod_support or not mod_support.get("curseforge_game_id"):
        raise HTTPException(status_code=400, detail="CurseForge für dieses Spiel nicht konfiguriert")

    return server, plugin, mod_support, str(mod_support["curseforge_game_id"])


def _detect_game_modloader_and_version(server: Server, plugin: Any, game_id: str | int) -> tuple[int | None, str | None, str | None]:
    """Ermittelt mod_loader_type, game_version und ggf. class_id aus Blueprint/Server-Umgebung."""
    gt = (server.game_type or "").lower()
    mod_loader_type: int | None = None
    override_class_id: str | None = None

    # Minecraft-spezifische Loader-Typen nur anwenden, wenn das Spiel Minecraft ist
    is_minecraft = str(game_id) == "432" or "minecraft" in gt
    if is_minecraft:
        if "fabric" in gt:
            mod_loader_type = 4
        elif "neoforge" in gt:
            mod_loader_type = 6
        elif "forge" in gt:
            mod_loader_type = 1
        elif "quilt" in gt:
            mod_loader_type = 5
        elif any(k in gt for k in ("paper", "spigot", "purpur", "bukkit")):
            override_class_id = "12"

    game_version: str | None = None
    bp = getattr(plugin, "blueprint", None)
    if bp and hasattr(bp, "runtime") and hasattr(bp.runtime, "env"):
        v = str(bp.runtime.env.get("VERSION", "")).strip()
        if v and v.upper() != "LATEST":
            game_version = v

    return mod_loader_type, game_version, override_class_id


def _detect_minecraft_modloader_and_version(server: Server, plugin: Any) -> tuple[int | None, str | None, str | None]:
    """Kompatibilitäts-Funktion für bestehende Aufrufer."""
    return _detect_game_modloader_and_version(server, plugin, 432)


async def _resolve_curseforge_class_id(
    cf_service: Any,
    game_id: str | int,
    class_id: Optional[str],
    mod_support: dict,
) -> Optional[int | str | object]:
    blueprint_class_id = mod_support.get("curseforge_class_id")
    if class_id is None:
        return blueprint_class_id

    raw = class_id.strip().lower()
    if raw in ("all", "0", "none", ""):
        return None

    if raw in ("modpacks", "modpack", "packs"):
        resolved = await cf_service.find_class_id(game_id, "modpacks")
        return resolved if resolved is not None else _UNSUPPORTED_CLASS

    if raw in ("mods", "mod"):
        resolved = await cf_service.find_class_id(game_id, "mods")
        return resolved or blueprint_class_id

    if raw.isdigit():
        target_id = int(raw)
        try:
            cats = await cf_service.get_categories(game_id, class_only=False)
            if isinstance(cats, list) and cats:
                valid_ids = {int(c["id"]) for c in cats if isinstance(c, dict) and "id" in c}
                if target_id in valid_ids:
                    return target_id
                # Die übergebene ID gehört nicht zu diesem Spiel -> Fallback auf Blueprint-Klasse
                return blueprint_class_id
        except Exception:
            pass
        return target_id

    return raw


@router.get("/classes")
async def get_curseforge_classes(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[dict]:
    """Liefert die dynamisch unterstützten Inhaltsklassen für das Spiel dieses Servers."""
    _server, _plugin, _mod_support, game_id = _resolve_curseforge_server(server_id, user, db)
    try:
        cf_service = await get_curseforge_service()
        if hasattr(cf_service, "get_game_classes"):
            return await cf_service.get_game_classes(game_id)
        raw_classes = await cf_service.get_categories(game_id, class_only=True)
        return [
            {
                "id": int(c["id"]),
                "name": str(c.get("name") or ""),
                "slug": str(c.get("slug") or "").lower(),
                "icon_url": c.get("iconUrl"),
                "kind": "modpacks" if "modpack" in str(c.get("slug", "")).lower() else "other",
            }
            for c in raw_classes
            if isinstance(c, dict) and c.get("id") is not None
        ]
    except CurseForgeApiUnavailable as e:
        raise _curseforge_api_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail="errors.curseforge_load_failed") from e


@router.get("/categories")
async def get_curseforge_categories(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[dict]:
    """Liefert die CurseForge-Kategorien und -Klassen für das Spiel dieses Servers."""
    _server, _plugin, _mod_support, game_id = _resolve_curseforge_server(server_id, user, db)
    try:
        cf_service = await get_curseforge_service()
        return await cf_service.get_categories(game_id)
    except CurseForgeApiUnavailable as e:
        raise _curseforge_api_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail="errors.curseforge_load_failed") from e


async def _find_modpack_class_id_safe(cf_service: Any, game_id: str) -> int | None:
    try:
        val = await cf_service.find_class_id(game_id, "modpacks")
        return val if isinstance(val, int) else None
    except Exception:
        return None


@router.get("/search")
async def search_curseforge_mods(
    server_id: int,
    query: str = Query("", description="Suchbegriff oder CurseForge-URL"),
    page: int = Query(1, ge=1, description="Seitennummer"),
    per_page: int = Query(24, ge=1, le=50, description="Ergebnisse pro Seite"),
    class_id: Optional[str] = Query(None, description="Optionaler CurseForge class_id Filter (z. B. '6', '4471' oder 'mods', 'modpacks')"),
    only_distributable: bool = Query(False, description="Nur Mods mit erlaubter Drittanbieter-Dateidistribution"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[dict]:
    """Sucht CurseForge-Mods oder Modpacks für das Spiel dieses Servers."""
    server, plugin, mod_support, game_id = _resolve_curseforge_server(server_id, user, db)

    try:
        cf_service = await get_curseforge_service()
        resolved_class_id = await _resolve_curseforge_class_id(cf_service, game_id, class_id, mod_support)
        if resolved_class_id is _UNSUPPORTED_CLASS:
            return []

        modpack_class_id = (
            resolved_class_id
            if isinstance(resolved_class_id, int)
            and class_id is not None
            and class_id.strip().lower() in ("modpacks", "modpack", "packs")
            else None
        )

        # Unterstützung für direkt eingefügte CurseForge-URLs
        lower_query = query.lower()
        if "curseforge.com" in lower_query and page == 1:
            url_slug_or_id, url_class_hint = extract_curseforge_url_query(query)
            if url_slug_or_id and url_slug_or_id.isdigit():
                mod_detail = await cf_service.get_mod_details(url_slug_or_id)
                if mod_detail and (not mod_detail.game_id or str(mod_detail.game_id) == str(game_id)):
                    if modpack_class_id is None:
                        modpack_class_id = await _find_modpack_class_id_safe(cf_service, game_id)
                    return [_mod_to_dict(mod_detail, modpack_class_id=modpack_class_id)]
                return []
            if url_slug_or_id:
                slug_class = None
                if url_class_hint:
                    slug_class = await _resolve_curseforge_class_id(cf_service, game_id, url_class_hint, mod_support)
                if slug_class is _UNSUPPORTED_CLASS:
                    slug_class = None
                mods = await cf_service.search_mods(
                    game_id=game_id,
                    query="",
                    slug=url_slug_or_id,
                    page=1,
                    per_page=per_page,
                    class_id=slug_class if slug_class is not None else resolved_class_id,
                    only_distributable=only_distributable,
                )
                if mods:
                    if modpack_class_id is None:
                        modpack_class_id = await _find_modpack_class_id_safe(cf_service, game_id)
                    return [_mod_to_dict(mod, modpack_class_id=modpack_class_id) for mod in mods]

        auto_loader, auto_ver, auto_class = _detect_game_modloader_and_version(server, plugin, game_id)
        mod_loader_type = None if modpack_class_id is not None else auto_loader
        game_version = auto_ver
        if auto_class and resolved_class_id is None:
            resolved_class_id = await cf_service.find_class_id(game_id, auto_class) or resolved_class_id

        mods = await cf_service.search_mods(
            game_id=game_id,
            query=query,
            page=page,
            per_page=per_page,
            class_id=resolved_class_id,
            mod_loader_type=mod_loader_type,
            game_version=game_version,
            only_distributable=only_distributable,
        )
        if not mods and query.strip().isdigit() and page == 1:
            try:
                mod_detail = await cf_service.get_mod_details(query.strip())
                if mod_detail and (not mod_detail.game_id or str(mod_detail.game_id) == str(game_id)):
                    mods = [mod_detail]
            except Exception:
                pass
        return [_mod_to_dict(mod, modpack_class_id=modpack_class_id) for mod in mods]
    except CurseForgeApiUnavailable as e:
        raise _curseforge_api_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail="errors.curseforge_search_failed") from e


@router.get("/popular")
async def get_popular_mods(
    server_id: int,
    limit: int = Query(24, ge=1, le=50, description="Anzahl der Mods"),
    page: int = Query(1, ge=1, description="Seitennummer (Pagination)"),
    sort: str = Query("trending", description="Sortierung: trending | popular | newest | updated"),
    class_id: Optional[str] = Query(None, description="Optionaler CurseForge class_id Filter (z. B. '6', '4471' oder 'mods', 'modpacks')"),
    only_distributable: bool = Query(False, description="Nur Mods mit erlaubter Drittanbieter-Dateidistribution"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[dict]:
    """Liefert CurseForge-Mods oder Modpacks nach Sortierkriterium."""
    server, plugin, mod_support, game_id = _resolve_curseforge_server(server_id, user, db)
    if sort not in ("trending", "popular", "newest", "updated"):
        sort = "trending"

    try:
        cf_service = await get_curseforge_service()
        resolved_class_id = await _resolve_curseforge_class_id(cf_service, game_id, class_id, mod_support)
        if resolved_class_id is _UNSUPPORTED_CLASS:
            return []

        modpack_class_id = (
            resolved_class_id
            if isinstance(resolved_class_id, int)
            and class_id is not None
            and class_id.strip().lower() in ("modpacks", "modpack", "packs")
            else None
        )

        auto_loader, auto_ver, auto_class = _detect_game_modloader_and_version(server, plugin, game_id)
        mod_loader_type = None if modpack_class_id is not None else auto_loader
        game_version = auto_ver
        if auto_class and resolved_class_id is None:
            resolved_class_id = await cf_service.find_class_id(game_id, auto_class) or resolved_class_id

        mods = await cf_service.get_popular_mods(
            game_id=game_id,
            limit=limit,
            page=page,
            sort=sort,
            class_id=resolved_class_id,
            mod_loader_type=mod_loader_type,
            game_version=game_version,
            only_distributable=only_distributable,
        )
        return [_mod_to_dict(mod, modpack_class_id=modpack_class_id) for mod in mods]
    except CurseForgeApiUnavailable as e:
        raise _curseforge_api_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail="errors.curseforge_load_failed") from e


@router.get("/mod/{mod_id}")
async def get_mod_details(
    server_id: int,
    mod_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Liefert Detailinformationen zu einer bestimmten CurseForge-Mod."""
    require_server_permission(user, server_id, db, "server.mods.read")

    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    if not str(mod_id).strip().isdigit():
        raise HTTPException(status_code=400, detail={"code": "invalid_workshop_id", "message": "errors.invalid_workshop_id"})

    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Spiel unterstützt keine Mods")

    try:
        cf_service = await get_curseforge_service()
        mod = await cf_service.get_mod_details(mod_id=mod_id)
        if not mod:
            raise HTTPException(status_code=404, detail="Mod nicht gefunden")
        return _mod_to_dict(mod)
    except HTTPException:
        raise
    except CurseForgeApiUnavailable as e:
        raise _curseforge_api_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail="errors.curseforge_load_failed") from e


@router.get("/mod/{mod_id}/bundle")
async def get_curseforge_bundle_details(
    mod_id: str,
    server_id: int = Query(..., description="Server-ID"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Liefert Modpack-/Bundle-Dateien, Server-Pack-Status und erforderliche Abhängigkeiten."""
    _server, _plugin, _mod_support, game_id = _resolve_curseforge_server(server_id, user, db)
    clean_id = str(mod_id).strip()
    if not clean_id.isdigit() or len(clean_id) > 20:
        raise HTTPException(status_code=400, detail={"code": "invalid_workshop_id", "message": "errors.invalid_workshop_id"})

    try:
        cf_service = await get_curseforge_service()
        mod = await cf_service.get_mod_details(clean_id)
        if not mod:
            raise HTTPException(status_code=404, detail="Mod nicht gefunden")

        modpack_class_id = await _find_modpack_class_id_safe(cf_service, game_id)
        mod_dict = _mod_to_dict(mod, modpack_class_id=modpack_class_id)

        files_raw = await cf_service.get_mod_files(clean_id)
        if not files_raw and mod.latest_files:
            files_raw = mod.latest_files

        files_summary: List[dict] = []
        dep_ids: List[int] = []
        seen_deps: set[int] = set()
        for f in files_raw[:15]:
            if not isinstance(f, dict):
                continue
            files_summary.append(
                {
                    "id": f.get("id"),
                    "display_name": f.get("displayName") or f.get("fileName") or "",
                    "file_name": f.get("fileName") or "",
                    "file_date": f.get("fileDate"),
                    "file_length": int(f.get("fileLength") or 0),
                    "release_type": f.get("releaseType"),
                    "is_server_pack": bool(f.get("isServerPack")),
                    "server_pack_file_id": f.get("serverPackFileId"),
                    "game_versions": f.get("gameVersions") or [],
                }
            )
        # Abhängigkeiten bevorzugt aus der ersten Datei (oder mainFileId) auflösen
        primary_file = None
        if mod.main_file_id:
            primary_file = next((f for f in files_raw if isinstance(f, dict) and f.get("id") == mod.main_file_id), None)
        if primary_file is None and files_raw:
            primary_file = files_raw[0] if isinstance(files_raw[0], dict) else None

        if isinstance(primary_file, dict):
            for dep in primary_file.get("dependencies") or []:
                if not isinstance(dep, dict):
                    continue
                dep_mod_id = dep.get("modId")
                # relationType 3 = RequiredDependency (oder Fallback alle falls nicht gesetzt)
                rel = dep.get("relationType")
                if dep_mod_id and (rel in (None, 3)) and int(dep_mod_id) not in seen_deps:
                    seen_deps.add(int(dep_mod_id))
                    dep_ids.append(int(dep_mod_id))

        dependencies: List[dict] = []
        if dep_ids and hasattr(cf_service, "get_mods_by_ids"):
            dep_mods = await cf_service.get_mods_by_ids(dep_ids[:50])
            dependencies = [_mod_to_dict(dep_mod, modpack_class_id=modpack_class_id) for dep_mod in dep_mods]

        return {
            "mod": mod_dict,
            "files": files_summary,
            "dependencies": dependencies,
            "supports_bundle_install": bool(mod.allow_mod_distribution),
        }
    except HTTPException:
        raise
    except CurseForgeApiUnavailable as e:
        raise _curseforge_api_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail="errors.curseforge_load_failed") from e


def _parse_curseforge_manifest_payload(raw_bytes: bytes) -> dict[str, Any]:
    """Extrahiert Mod-IDs aus einer CurseForge manifest.json, minecraftinstance.json oder Export-ZIP."""
    if len(raw_bytes) > _MAX_MANIFEST_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Manifest-Datei überschreitet das Limit von 5 MiB")

    data: dict[str, Any] | None = None
    # Versuche zuerst ZIP (CurseForge Modpack / Profil-Export)
    if raw_bytes[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
                candidates = []
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    norm_name = info.filename.replace("\\", "/").lstrip("/")
                    if ".." in norm_name.split("/"):
                        continue
                    base_name = norm_name.rsplit("/", 1)[-1].lower()
                    if base_name in ("manifest.json", "minecraftinstance.json"):
                        candidates.append((norm_name.count("/"), base_name != "manifest.json", info))
                if not candidates:
                    raise HTTPException(status_code=400, detail="Keine manifest.json oder minecraftinstance.json im ZIP gefunden")
                candidates.sort(key=lambda entry: (entry[0], entry[1]))
                target_info = candidates[0][2]
                if target_info.file_size > _MAX_MANIFEST_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Manifest innerhalb der ZIP-Datei ist zu groß")
                member_bytes = zf.read(target_info.filename)
                data = json.loads(member_bytes.decode("utf-8"))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail="Ungültiges CurseForge-Archiv") from e
    else:
        try:
            data = json.loads(raw_bytes.decode("utf-8"))
        except Exception as e:
            raise HTTPException(status_code=400, detail="Ungültiges JSON-Manifest") from e

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Ungültiges Manifest-Format")

    pack_name = str(data.get("name") or "").strip()
    pack_version = str(data.get("version") or "").strip()
    author = str(data.get("author") or "").strip()

    entries: list[tuple[int, int | None]] = []
    seen: set[int] = set()
    # Format 1: CurseForge manifest.json {"files": [{"projectID": 123, "fileID": 456}]}
    if isinstance(data.get("files"), list):
        for entry in data["files"]:
            if not isinstance(entry, dict):
                continue
            pid = entry.get("projectID")
            fid = entry.get("fileID")
            if isinstance(pid, int) and pid > 0 and pid not in seen:
                seen.add(pid)
                entries.append((pid, fid if isinstance(fid, int) else None))
    # Format 2: CurseForge App Export minecraftinstance.json {"installedAddons": [{"addonID": 123, "installedFile": {"id": 456}}]}
    elif isinstance(data.get("installedAddons"), list):
        for entry in data["installedAddons"]:
            if not isinstance(entry, dict):
                continue
            pid = entry.get("addonID")
            installed_file = entry.get("installedFile") if isinstance(entry.get("installedFile"), dict) else {}
            fid = installed_file.get("id")
            if isinstance(pid, int) and pid > 0 and pid not in seen:
                seen.add(pid)
                entries.append((pid, fid if isinstance(fid, int) else None))
    else:
        raise HTTPException(status_code=400, detail="Manifest enthält keine 'files'- oder 'installedAddons'-Liste")

    return {
        "pack_name": pack_name,
        "pack_version": pack_version,
        "author": author,
        "entries": entries[:500],
    }


@router.post("/parse-manifest")
async def parse_curseforge_manifest(
    server_id: int = Query(..., description="Server-ID"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Liest ein CurseForge-Manifest (.json oder .zip) ein und löst alle enthaltenen Mods per Batch auf."""
    _server, _plugin, _mod_support, game_id = _resolve_curseforge_server(
        server_id, user, db, permission="server.mods.write"
    )
    raw_bytes = await file.read(_MAX_MANIFEST_UPLOAD_BYTES + 1)
    parsed = _parse_curseforge_manifest_payload(raw_bytes)
    entries: list[tuple[int, int | None]] = parsed["entries"]
    project_ids = [pid for pid, _ in entries]
    file_id_map = {str(pid): fid for pid, fid in entries}

    if not project_ids:
        return {
            "pack_name": parsed["pack_name"],
            "pack_version": parsed["pack_version"],
            "author": parsed["author"],
            "items": [],
            "unavailable_ids": [],
            "item_count": 0,
        }

    try:
        cf_service = await get_curseforge_service()
        mods = await cf_service.get_mods_by_ids(project_ids)
        modpack_class_id = await _find_modpack_class_id_safe(cf_service, game_id)

        resolved_by_id: dict[str, dict] = {}
        wrong_game_ids: list[str] = []
        for mod in mods:
            if mod.game_id and str(mod.game_id) != str(game_id):
                wrong_game_ids.append(mod.publishedfileid)
                continue
            item = _mod_to_dict(mod, modpack_class_id=modpack_class_id)
            item["manifest_file_id"] = file_id_map.get(mod.publishedfileid)
            resolved_by_id[mod.publishedfileid] = item

        ordered_items: list[dict] = []
        unavailable_ids: list[str] = []
        for pid in project_ids:
            pid_str = str(pid)
            if pid_str in resolved_by_id:
                ordered_items.append(resolved_by_id[pid_str])
            else:
                unavailable_ids.append(pid_str)

        return {
            "pack_name": parsed["pack_name"],
            "pack_version": parsed["pack_version"],
            "author": parsed["author"],
            "items": ordered_items,
            "unavailable_ids": unavailable_ids,
            "wrong_game_ids": wrong_game_ids,
            "item_count": len(ordered_items),
        }
    except CurseForgeApiUnavailable as e:
        raise _curseforge_api_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail="errors.curseforge_load_failed") from e
