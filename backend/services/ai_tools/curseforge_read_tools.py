"""CurseForge-Suche fuer Mods und Modpacks.

Die beiden Handler standen als lange Zweige in `_execute_global_read_tool`.
Gemeinsam ist ihnen der Schluessel, die Spielaufloesung und die Zeitgrenze;
die Specs stehen jetzt beim Fach.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import User
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import _function

_MODPACKS = _function("search_curseforge_modpacks", "Sucht Modpacks auf CurseForge fuer ein Spiel nach Name oder Thema (etwa 'Tech', 'Magic', 'Dinos'). Liefert id, name, downloads.", {"query": {"type": "string", "maxLength": 128}, "game_id": {"type": "string", "maxLength": 64, "description": "Game-ID oder Spielname/Slug, etwa 'minecraft'."}, "game": {"type": "string", "maxLength": 64, "description": "Spielname, wenn die game_id fehlt."}, "server_id": {"type": "integer", "description": "Spiel aus diesem Server."}, "page": {"type": "integer", "minimum": 1, "maximum": 50}}, ["query"])
_MODS = _function("search_curseforge_mods", "Sucht Einzelmods auf CurseForge fuer ein Spiel nach Name oder Thema (etwa 'Minimap', 'Storage'). Liefert id, name, downloads, author.", {"query": {"type": "string", "maxLength": 128}, "game_id": {"type": "string", "maxLength": 64, "description": "Game-ID oder Spielname/Slug, etwa 'minecraft'."}, "game": {"type": "string", "maxLength": 64, "description": "Spielname, wenn die game_id fehlt."}, "server_id": {"type": "integer", "description": "Spiel aus diesem Server."}, "class_id": {"type": "string", "maxLength": 32, "description": "Klassen-ID oder 'mods'/'modpacks'."}, "page": {"type": "integer", "minimum": 1, "maximum": 50}}, ["query"])

DEFINITIONEN = [_MODPACKS, _MODS]


def suche_modpacks(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    from services.ai_tools.server_tools import _resolve_curseforge_game_and_class_for_ai
    from services.curseforge_api_key_service import resolve_key as _cf_resolve

    if not _cf_resolve():
        return {"error": "curseforge_api_key_missing", "hint": "CurseForge API-Key in Einstellungen hinterlegen"}
    query = str(arguments.get("query", "") or "")[:128]
    raw_game = arguments.get("game_id") or arguments.get("game")
    server_id = arguments.get("server_id")
    page = max(1, min(50, int(arguments.get("page", 1) or 1)))

    try:
        import concurrent.futures

        def _sync_search():
            import asyncio as _aio

            async def _do():
                from services.curseforge_service import get_curseforge_service

                s = await get_curseforge_service()
                gid, _ = await _resolve_curseforge_game_and_class_for_ai(
                    db, s, query, raw_game=raw_game, server_id=server_id
                )
                if not gid:
                    return {
                        "error": "game_required",
                        "hint": "Bitte gib ein Spiel (game oder game_id) oder eine server_id an, da CurseForge spielspezifisch sucht.",
                        "query": query,
                    }

                return await s.search_modpacks(game_id=gid, query=query, page=page, per_page=12)

            try:
                return _aio.run(_do())
            except RuntimeError:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    fut = ex.submit(lambda: _aio.run(_do()))
                    return fut.result(timeout=20)

        mods = _sync_search()
        if isinstance(mods, dict) and "error" in mods:
            return mods
        return {
            "mods": [
                {
                    "id": m.publishedfileid,
                    "name": m.title,
                    "downloads": m.subscriptions,
                    "author": m.creator,
                    "has_server_pack": m.has_server_pack,
                    "server_pack_file_id": m.server_pack_file_id,
                }
                for m in mods
            ],
            "query": query,
        }
    except Exception as exc:
        logger.warning("CurseForge modpack search failed for query=%s error=%s", query, exc)
        return {"error": "curseforge_search_failed", "detail": f"CurseForge-Suche fehlgeschlagen: {exc}", "query": query}


def suche_mods(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    from services.ai_tools.server_tools import _resolve_curseforge_game_and_class_for_ai
    from services.curseforge_api_key_service import resolve_key as _cf_resolve

    if not _cf_resolve():
        return {"error": "curseforge_api_key_missing", "hint": "CurseForge API-Key in Einstellungen hinterlegen"}
    query = str(arguments.get("query", "") or "")[:128]
    raw_game = arguments.get("game_id") or arguments.get("game")
    server_id = arguments.get("server_id")
    class_id = arguments.get("class_id")
    page = max(1, min(50, int(arguments.get("page", 1) or 1)))

    try:
        import concurrent.futures

        def _sync_search():
            import asyncio as _aio

            async def _do():
                from services.curseforge_service import get_curseforge_service

                s = await get_curseforge_service()
                gid, resolved_cls = await _resolve_curseforge_game_and_class_for_ai(
                    db, s, query, raw_game=raw_game, server_id=server_id, class_id=class_id
                )
                if not gid:
                    return {
                        "error": "game_required",
                        "hint": "Bitte gib ein Spiel (game oder game_id) oder eine server_id an, da CurseForge spielspezifisch sucht.",
                        "query": query,
                    }

                return await s.search_mods(
                    game_id=gid,
                    query=query,
                    class_id=resolved_cls,
                    page=page,
                    per_page=15,
                )

            try:
                return _aio.run(_do())
            except RuntimeError:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    fut = ex.submit(lambda: _aio.run(_do()))
                    return fut.result(timeout=20)

        mods = _sync_search()
        if isinstance(mods, dict) and "error" in mods:
            return mods
        return {
            "mods": [
                {
                    "id": m.publishedfileid,
                    "name": m.title,
                    "downloads": m.subscriptions,
                    "author": m.creator,
                    "summary": (m.description or "")[:180],
                    "updated": m.updated.strftime("%Y-%m-%d") if m.updated else None,
                    "tags": m.tags[:5] if m.tags else [],
                }
                for m in mods
            ],
            "query": query,
        }
    except Exception as exc:
        logger.warning("CurseForge mods search failed for query=%s error=%s", query, exc)
        return {"error": "curseforge_search_failed", "detail": f"CurseForge-Suche fehlgeschlagen: {exc}", "query": query}


werkzeug(
    _MODPACKS,
    art="global_read",
    gruppe="mods",
    angebot=("server.mods.read",),
    hinweis="Sucht Modpacks auf CurseForge nach Name oder Thema.",
    global_handler=suche_modpacks,
)
werkzeug(
    _MODS,
    art="global_read",
    gruppe="mods",
    angebot=("server.mods.read",),
    hinweis="Sucht Einzelmods auf CurseForge nach Name oder Thema.",
    global_handler=suche_mods,
)
