"""Mods lesen: installierte Mods, Updates und Workshop-Suche.

Der Handler stand als `_execute_mod_tool` in `server_tools`; die drei Schemas
im Katalog derselben Datei. Die Rechtepruefung lag im Zweig davor und sitzt
jetzt hier, damit jeder Weg sie mitnimmt.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Server, User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import MAX_LISTED_MODS, MAX_SEARCH_QUERY_CHARS, _require_no_arguments, _server_function


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
            "Sucht Mods im Steam Workshop oder bei CurseForge fuer das Spiel dieses Servers. "
            "Liefert Kennung, Titel und Tags.",
            {
                "query": {"type": "string", "maxLength": 128},
                "page": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            ["query"],
        )

MODS_DEFINITIONEN = [_MODS]
SEARCH_DEFINITIONEN = [_UPDATES, _SEARCH]


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

    if tool_name != "search_workshop_mods":
        raise AiActionValidationError(f"Kein Handler für Werkzeug: {tool_name}")
    if set(arguments) - {"query", "page"} or not isinstance(arguments.get("query"), str):
        raise AiActionValidationError("Workshop-Suche hat ungültige Argumente")
    page = arguments.get("page", 1)
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 50:
        raise AiActionValidationError("Ungültige Seitenzahl")
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
        if "modpack" in sichere_anfrage.lower():
            cf_class_id = "modpacks"

        try:
            import asyncio
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


werkzeug(
    _MODS,
    art="server_read",
    hinweis="Listet installierte Mods mit Aktivierungs- und Updatestatus.",
    handler=lies_mods,
)
werkzeug(
    _UPDATES,
    art="server_read",
    hinweis="Prueft, fuer welche Mods ein Update oder eine Nachinstallation aussteht.",
    handler=lies_updates,
)
werkzeug(
    _SEARCH,
    art="server_read",
    hinweis="Sucht Mods im Workshop oder bei CurseForge fuer dieses Spiel.",
    handler=suche_workshop,
)
