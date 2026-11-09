"""Cloudflare-Zonen und DNS-Eintraege lesen.

Beide Werkzeuge stehen hinter `cloudflare.manage` und liefern nur, was das
Cloudflare-Konto ohnehin zeigt. Die Handler standen in der Serverkette.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import _function

_ZONES = _function("cloudflare_list_zones", "Listet die Cloudflare-Zonen (Domains). Vor jedem Anlegen fuer die zone_id.", {}, [])
_RECORDS = _function("cloudflare_list_dns_records", "Listet die DNS-Records einer Zone (zone_id oder Domain, leer = Standardzone). Vor dem Anlegen auf Kollision pruefen.", {"zone_id": {"type": "string", "maxLength": 128}}, [])

DEFINITIONEN = [_ZONES, _RECORDS]


def lies_zonen(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    if not permission_service.has_global_permission(db, user, "cloudflare.manage"):
        raise AiActionValidationError("Cloudflare-Einsicht ist nicht erlaubt")
    from services.cloudflare_service import is_configured as _cf_cfg

    if not _cf_cfg():
        return {"error": "cloudflare_not_configured", "hint": "Cloudflare API-Token in Einstellungen hinterlegen und aktivieren"}
    try:
        import concurrent.futures, asyncio as _aio

        def _do_zones():
            from services.cloudflare_service import list_zones

            async def _inner():
                return await list_zones()

            try:
                return _aio.run(_inner())
            except RuntimeError:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    return ex.submit(lambda: _aio.run(_inner())).result(timeout=15)

        zones = _do_zones()
        return {"zones": [{"id": z.get("id"), "name": z.get("name"), "status": z.get("status")} for z in zones]}
    except Exception:
        return {"error": "cloudflare_list_failed"}


def lies_dns(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    if not permission_service.has_global_permission(db, user, "cloudflare.manage"):
        raise AiActionValidationError("Cloudflare-Einsicht ist nicht erlaubt")
    zone_id = str(arguments.get("zone_id", "") or arguments.get("domain", "") or arguments.get("zone", "") or arguments.get("name", "")).strip()
    try:
        import concurrent.futures, asyncio as _aio

        def _do_records():
            from services.cloudflare_service import list_dns_records

            async def _inner():
                return await list_dns_records(zone_id if zone_id else None)

            try:
                return _aio.run(_inner())
            except RuntimeError:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    return ex.submit(lambda: _aio.run(_inner())).result(timeout=15)

        records = _do_records()
        return {"records": [{"id": r.get("id"), "name": r.get("name"), "type": r.get("type"), "content": r.get("content")} for r in records], "zone_id": zone_id}
    except Exception as exc:
        return {"error": "cloudflare_list_failed", "detail": str(exc), "zone_id": zone_id}


werkzeug(
    _ZONES,
    art="global_read",
    gruppe="domains",
    angebot=("cloudflare.manage",),
    hinweis="Listet die Cloudflare-Zonen (Domains).",
    global_handler=lies_zonen,
)
werkzeug(
    _RECORDS,
    art="global_read",
    gruppe="domains",
    angebot=("cloudflare.manage",),
    hinweis="Listet die DNS-Eintraege einer Zone.",
    global_handler=lies_dns,
)
