"""Mods lesen: installierte Mods, Updates und Workshop-Suche.

Der Handler stand als `_execute_mod_tool` in `server_tools`; die drei Schemas
im Katalog derselben Datei. Die Rechtepruefung lag im Zweig davor und sitzt
jetzt hier, damit jeder Weg sie mitnimmt.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy.orm import Session

from models import Server, User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import MAX_LISTED_MODS, MAX_SEARCH_QUERY_CHARS, _require_no_arguments, _server_function

logger = logging.getLogger(__name__)


_MODS = _server_function(
            "read_server_mods",
            "Liest die installierten Mods mit Aktivierungs-, Installations- und Updatestatus.",
        )
_UPDATES = _server_function(
            "read_mod_updates",
            "Prueft, fuer welche Mods ein Update oder eine Nachinstallation aussteht.",
        )
_SEARCH = _server_function(
            "search_workshop_mods",
            "Sucht Mods, Sammlungen, Pakete oder Kollektionen im Steam Workshop oder bei CurseForge fuer das Spiel dieses Servers. "
            "Liefert Kennung, Titel, Typ und Tags.",
            {
                "query": {"type": "string", "description": "Suchbegriff, Thema oder Link/ID."},
                "content_type": {
                    "type": "string",
                    "enum": ["mods", "collections"],
                    "description": "mods = Einzelmods (Standard), collections = Steam-Kollektionen/Sammlungen/Pakete.",
                },
                "sort": {
                    "type": "string",
                    "enum": ["trending", "popular", "newest", "updated"],
                    "description": "Optionale Sortierung, z. B. popular oder trending fuer 'beste/beliebteste Mods'.",
                },
                "page": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            ["query"],
        )
_COLLECTION = _server_function(
            "read_steam_collection",
            "Loest eine Steam-Workshop-Kollektion (Sammlung, Paket, Link oder ID) vollstaendig auf "
            "und liefert Titel sowie alle enthaltenen Mods inklusive Unter-Kollektionen.",
            {
                "collection_id": {
                    "type": "string",
                    "maxLength": 256,
                    "description": "Steam-Kollektions-ID oder Steam-Workshop-URL.",
                },
            },
            ["collection_id"],
        )

MODS_DEFINITIONEN = [_MODS]
SEARCH_DEFINITIONEN = [_UPDATES, _SEARCH, _COLLECTION]


def execute_mod_tool(
    db: Session, *, user: User, server: Server, tool_name: str, arguments: dict
) -> dict:
    if not permission_service.has_server_permission(
        db, user, server.id, "server.mods.read"
    ):
        raise AiActionValidationError("Mod-Lesezugriff ist nicht erlaubt")

    from games import get_plugin
    from models import Mod
    from services import mod_update_service

    if tool_name == "read_server_mods":
        _require_no_arguments(tool_name, arguments)
        rows = (
            db.query(Mod)
            .filter(Mod.server_id == server.id)
            .order_by(Mod.load_order, Mod.id)
            .limit(MAX_LISTED_MODS)
            .all()
        )
        return {
            "server_id": server.id,
            "mods": [
                {
                    "workshop_id": row.workshop_id,
                    "name": redact_sensitive_text(str(row.name or ""))[:128],
                    "enabled": bool(row.enabled),
                    "install_status": row.install_status,
                    "install_error": redact_sensitive_text(str(row.install_error or ""))[:256] if row.install_error else None,
                    "update_status": row.update_status,
                    "update_reason": row.update_reason,
                    "load_order": row.load_order,
                }
                for row in rows
            ],
        }

    plugin = get_plugin(server.game_type)
    if plugin is None or not getattr(plugin, "supports_mods", False):
        return {
            "server_id": server.id,
            "available": False,
            "reason": "mods_not_supported",
        }

    if tool_name == "read_mod_updates":
        _require_no_arguments(tool_name, arguments)
        updates = mod_update_service.refresh_update_availability(db, server, plugin)
        return {
            "server_id": server.id,
            "available": True,
            "updates": [
                {
                    "workshop_id": str(item.get("workshop_id") or ""),
                    "action": str(item.get("action") or ""),
                    "reason": str(item.get("reason") or "")[:128],
                }
                for item in updates[:MAX_LISTED_MODS]
            ],
        }

    if tool_name == "read_steam_collection":
        if set(arguments) != {"collection_id"} or not isinstance(arguments.get("collection_id"), str):
            raise AiActionValidationError("Kollektions-Abfrage braucht genau 'collection_id'")
        raw_col = arguments["collection_id"].strip()
        if not raw_col:
            raise AiActionValidationError("collection_id darf nicht leer sein")
        mod_support = plugin.get_mod_support() or {}
        if mod_support.get("provider") == "curseforge" or mod_support.get("curseforge_game_id"):
            return {
                "server_id": server.id,
                "available": False,
                "reason": "curseforge_uses_modpacks",
                "hint": "Dieses Spiel nutzt CurseForge; nutze search_curseforge_modpacks und propose_modpack_install.",
            }
        appid = mod_support.get("workshop_id")
        if not appid:
            return {"server_id": server.id, "available": False, "reason": "workshop_id_missing"}
        from services.steam_service import SteamApiUnavailable, SteamService, extract_steam_publishedfileid

        clean_id = extract_steam_publishedfileid(raw_col) or (raw_col if raw_col.isdigit() else None)
        if not clean_id:
            raise AiActionValidationError("Ungueltige Steam-Kollektions-ID oder URL")

        async def _fetch_col():
            svc = SteamService()
            try:
                return await svc.get_collection_details(str(appid), clean_id)
            finally:
                await svc.close()

        try:
            details = asyncio.run(_fetch_col())
        except SteamApiUnavailable as exc:
            return {"server_id": server.id, "available": False, "reason": exc.code}
        except Exception as exc:
            logger.warning("Steam-Kollektionsabfrage fehlgeschlagen: %s", type(exc).__name__)
            return {"server_id": server.id, "available": False, "reason": "steam_api_unavailable"}

        if not details:
            return {"server_id": server.id, "available": False, "reason": "collection_not_found"}

        col_info = details["collection"]
        items = details.get("items") or []
        return {
            "server_id": server.id,
            "available": True,
            "collection": {
                "publishedfileid": col_info.publishedfileid,
                "title": redact_sensitive_text(str(col_info.title or ""))[:128],
                "creator": redact_sensitive_text(str(col_info.creator or ""))[:64],
                "direct_url": col_info.direct_url,
            },
            "item_count": len(items),
            "unavailable_ids": list(details.get("unavailable_ids") or [])[:50],
            "items": [
                {
                    "workshop_id": m.publishedfileid,
                    "title": redact_sensitive_text(str(m.title or ""))[:128],
                    "file_size_mb": round((m.file_size or 0) / (1024 * 1024), 2),
                }
                for m in items[:MAX_LISTED_MODS]
            ],
            "truncated": len(items) > MAX_LISTED_MODS,
        }

    if tool_name != "search_workshop_mods":
        raise AiActionValidationError(f"Kein Handler für Werkzeug: {tool_name}")
    if set(arguments) - {"query", "page", "content_type", "sort"} or not isinstance(arguments.get("query"), str):
        raise AiActionValidationError("Workshop-Suche hat ungültige Argumente")
    page = arguments.get("page", 1)
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 50:
        raise AiActionValidationError("Ungültige Seitenzahl")
    content_type = str(arguments.get("content_type") or "mods").strip().lower()
    if content_type not in ("mods", "collections"):
        raise AiActionValidationError("content_type muss 'mods' oder 'collections' sein")
    sort = arguments.get("sort")
    if sort is not None and sort not in ("trending", "popular", "newest", "updated"):
        raise AiActionValidationError("Ungueltige Sortierung")
    mod_support = plugin.get_mod_support() or {}

    # Die Anfrage geht an einen fremden Dienst (Steam oder CurseForge) und wird
    # dort protokolliert — dieselbe Lage wie bei `web_search`, also dieselbe
    # Schwärzung, eine Richtung früher als der Choke Point auf dem Rückweg.
    # Der Suchbegriff ist reine Modellausgabe, und das Modell hat vorher
    # Konfigurationsdateien und Logs gelesen: eine Zuweisung wie
    # `ServerAdminPassword=…` kann es wörtlich übernehmen. Die Schwärzung ist
    # wertbezogen, ein Einstellungs- oder Modname als Wort überlebt sie.
    #
    # Gekürzt wird auf die Länge, die das Schema verspricht. Ein Schema ist eine
    # Bitte an das Modell und keine Schranke; was hier durchkommt, geht als
    # URL-Parameter hinaus.
    sichere_anfrage = redact_sensitive_text(
        arguments["query"].strip()
    )[:MAX_SEARCH_QUERY_CHARS]

    # 1. CurseForge Provider
    if mod_support.get("provider") == "curseforge" or mod_support.get("curseforge_game_id"):
        cf_game_id = str(mod_support.get("curseforge_game_id") or "")
        from routers.curseforge import _detect_game_modloader_and_version
        auto_loader, auto_ver, auto_class = _detect_game_modloader_and_version(server, plugin, cf_game_id)
        cf_mod_loader = auto_loader
        cf_game_version = auto_ver
        cf_class_id = mod_support.get("curseforge_class_id") or auto_class
        if content_type == "collections" or "modpack" in sichere_anfrage.lower():
            cf_class_id = "modpacks"

        try:
            from services.curseforge_service import get_curseforge_service, CurseForgeApiUnavailable

            async def _do_cf_search():
                svc = await get_curseforge_service()
                return await svc.search_mods(
                    game_id=cf_game_id,
                    class_id=cf_class_id,
                    query=sichere_anfrage,
                    page=page,
                    per_page=20,
                    mod_loader_type=cf_mod_loader,
                    game_version=cf_game_version,
                )

            # Ohne Weiche auf eine laufende Ereignisschleife: die Lesewerkzeuge
            # laufen ausschließlich über `_werkzeug_ausfuehren` und damit "in
            # eigener Sitzung und eigenem Thread", wo es nie eine gibt. Hier
            # stand ein `ThreadPoolExecutor`, der `asyncio.run` in einem zweiten
            # Thread startete — toter Verteidigungscode, der obendrein den
            # Eindruck machte, der Handler sei auf der Schleife aufrufbar. Wäre
            # er das, blockierte er sie für die volle Dauer des HTTP-Aufrufs;
            # nebenläufig wird davon nichts, der Executor verdeckt nur den
            # Konstruktionsfehler. `asyncio.run` sagt in dem Fall selbst
            # deutlich, was los ist.
            cf_mods = asyncio.run(_do_cf_search())

            results = [
                {
                    "workshop_id": m.publishedfileid,
                    "title": m.title,
                    "description": redact_sensitive_text(str(m.description or ""))[:256] if m.description else None,
                    "preview_url": m.preview_url,
                    "creator": m.creator,
                    "subscriptions": m.subscriptions,
                    "updated": m.updated.isoformat() if m.updated else None,
                    "direct_url": m.direct_url,
                    "provider": "curseforge",
                }
                for m in cf_mods
            ]
            return {"server_id": server.id, "available": True, "provider": "curseforge", "results": results}
        except CurseForgeApiUnavailable as exc:
            return {"server_id": server.id, "available": False, "reason": exc.code}
        except Exception as exc:
            # Ein stabiler Code wie in jedem anderen Zweig dieses Handlers.
            # Vorher stand hier `str(exc)`: beliebiger Text aus einer beliebigen
            # Bibliothek, der als Grund an das Modell ging und dort mit
            # `curseforge_game_id_missing` in einer Reihe stand. Die Einzelheit
            # gehört ins Log — und dort nur der Ausnahmetyp, wie es
            # `curseforge_service` schon hält: eine Fehlermeldung kann den
            # API-Schlüssel tragen.
            logger.warning(
                "CurseForge-Suche im Werkzeug fehlgeschlagen: %s", type(exc).__name__
            )
            return {"server_id": server.id, "available": False, "reason": "curseforge_fehler"}

    # 2. Steam Workshop Provider
    appid = mod_support.get("workshop_id")
    if not appid:
        return {"server_id": server.id, "available": False, "reason": "workshop_id_missing"}
    if content_type == "collections" or sort is not None:
        from services.steam_service import SteamApiUnavailable, SteamService

        filetype = 1 if content_type == "collections" else 0
        required_tags = None if filetype == 1 else (mod_support.get("required_tags") or None)

        async def _search_steam():
            svc = SteamService()
            try:
                return await svc.search_workshop_mods(
                    appid=str(appid),
                    query=sichere_anfrage,
                    page=page,
                    per_page=20,
                    required_tags=required_tags,
                    filetype=filetype,
                    sort=sort,
                )
            finally:
                await svc.close()

        try:
            steam_items = asyncio.run(_search_steam())
        except SteamApiUnavailable as exc:
            return {"server_id": server.id, "available": False, "reason": exc.code}
        except Exception as exc:
            logger.warning("Steam-Suche im Werkzeug fehlgeschlagen: %s", type(exc).__name__)
            return {"server_id": server.id, "available": False, "reason": "steam_api_unavailable"}

        results = [
            {
                "workshop_id": m.publishedfileid,
                "title": redact_sensitive_text(str(m.title or ""))[:128],
                "description": redact_sensitive_text(str(m.description or ""))[:256] if m.description else None,
                "creator": redact_sensitive_text(str(m.creator or ""))[:64],
                "subscriptions": m.subscriptions,
                "favorites": m.favorites,
                "item_type": m.item_type,
                "children_count": m.children_count,
                "direct_url": m.direct_url,
                "tags": list(m.tags or [])[:5],
            }
            for m in steam_items
        ]
        return {"server_id": server.id, "available": True, "provider": "steam", "results": results}

    try:
        results = mod_update_service.search_workshop(
            appid=str(appid),
            query=sichere_anfrage,
            page=page,
            required_tags=mod_support.get("required_tags") or None,
        )
    except mod_update_service.ModSearchUnavailable as exc:
        # Ehrlich melden statt eine leere Trefferliste liefern: "nichts
        # gefunden" waere hier eine falsche Aussage ueber den Workshop.
        return {"server_id": server.id, "available": False, "reason": exc.code}
    return {"server_id": server.id, "available": True, "results": results}


def lies_mods(db, *, user, server, arguments):
    return execute_mod_tool(db, user=user, server=server, tool_name="read_server_mods", arguments=arguments)


def lies_updates(db, *, user, server, arguments):
    return execute_mod_tool(db, user=user, server=server, tool_name="read_mod_updates", arguments=arguments)


def suche_workshop(db, *, user, server, arguments):
    return execute_mod_tool(db, user=user, server=server, tool_name="search_workshop_mods", arguments=arguments)


def lies_steam_kollektion(db, *, user, server, arguments):
    return execute_mod_tool(db, user=user, server=server, tool_name="read_steam_collection", arguments=arguments)


werkzeug(
    _MODS,
    art="server_read",
    gruppe="mods",
    hinweis="Listet installierte Mods mit Aktivierungs- und Updatestatus.",
    handler=lies_mods,
)
werkzeug(
    _UPDATES,
    art="server_read",
    gruppe="mods",
    hinweis="Prueft, fuer welche Mods ein Update oder eine Nachinstallation aussteht.",
    handler=lies_updates,
)
werkzeug(
    _SEARCH,
    art="server_read",
    gruppe="mods",
    hinweis="Sucht Mods, Sammlungen, Pakete oder Kollektionen im Workshop oder bei CurseForge fuer dieses Spiel.",
    handler=suche_workshop,
)
werkzeug(
    _COLLECTION,
    art="server_read",
    gruppe="mods",
    hinweis="Loest eine Steam-Kollektion (Sammlung, Paket oder Link) auf und listet alle enthaltenen Mods.",
    handler=lies_steam_kollektion,
)
