import logging
import re
import time
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import Mod, Server, User
from schemas import ModResponse
from dependencies import get_current_user, verify_csrf, require_server_permission
from games import get_plugin, updater, _append_console_log
from services.achievement_service import AchievementService
from services.install_update_lock_service import (
    release_install_update_lock,
    acquire_install_update_lock_blocking,
)
from services import mod_update_service
from services.mod_install_status_service import (
    INSTALL_DONE,
    INSTALL_RUNNING,
    mark_mod_failed,
    mark_mod_installed,
    mark_mod_installing,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mods", tags=["mods"])

_MOD_ACTIONS = {"install", "update", "reinstall"}
_WORKSHOP_ID_RE = re.compile(r"^\d{1,20}$")
_BATCH_CHUNK_SIZE = 25
try:
    from games.blueprint_plugin import WORKSHOP_BATCH_SIZE as _BATCH_CHUNK_SIZE
except Exception:
    _BATCH_CHUNK_SIZE = 25


class BatchModItem(BaseModel):
    workshop_id: str = Field(..., min_length=1, max_length=32)
    name: str | None = Field(default=None, max_length=255)


class BatchModsInstallRequest(BaseModel):
    items: list[BatchModItem] = Field(..., min_length=1, max_length=500)
    auto_update: bool = True
    enabled: bool = True
    skip_existing: bool = True


class BulkModActionRequest(BaseModel):
    mod_ids: list[int] = Field(..., min_length=1, max_length=500)
    action: Literal["reinstall", "update"]


class BulkModDeleteRequest(BaseModel):
    mod_ids: list[int] = Field(default_factory=list, max_length=500)
    delete_all: bool = False


def _safe_error(value: object) -> str:
    text = str(value or "Installation fehlgeschlagen").strip()
    return " ".join(text.split())[:500]


def _validate_workshop_id(workshop_id: str) -> str:
    value = str(workshop_id or "").strip()
    if not _WORKSHOP_ID_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail="errors.invalid_workshop_id")
    return value


def _refresh_mod_update_availability(db: Session, server: Server, plugin, *, force: bool = False) -> list[dict]:
    """Duenner Aufruf auf den gemeinsamen Service.

    Die Logik liegt in `services/mod_update_service.py`, damit das AI-Werkzeug
    `read_mod_updates` exakt dieselbe Pruefung ausfuehrt wie dieser Router —
    inklusive derselben Fuenf-Minuten-Sperre gegen Serienabfragen bei Steam.
    """
    return mod_update_service.refresh_update_availability(db, server, plugin, force=force)


def _server_has_active_mod_jobs(db: Session, server_id: int) -> bool:
    return (
        db.query(Mod.id)
        .filter(
            Mod.server_id == server_id,
            Mod.install_status.in_((INSTALL_RUNNING, "pending")),
        )
        .limit(1)
        .first()
        is not None
    )


def install_mod_bg(server_id: int, workshop_id: str, action: str = "install", remote_updated: str | None = None):
    # Lock zuerst — ohne offene DB-Session warten (verhindert QueuePool-Timeout bei vielen Mods).
    acquire_install_update_lock_blocking(server_id, "mod_install")
    db = SessionLocal()
    try:
        server = db.query(Server).filter(Server.id == server_id).first()
        if not server:
            logger.error("Server %s nicht gefunden in Background Task", server_id)
            mark_mod_failed(server_id, workshop_id, "Server nicht gefunden")
            return
        plugin = get_plugin(server.game_type)
        if not plugin or not plugin.supports_mods:
            mark_mod_failed(server_id, workshop_id, "Steam Workshop nicht in diesem Spiel aktiviert")
            return

        try:
            mark_mod_installing(server.id, workshop_id, action)
            if action == "reinstall":
                try:
                    plugin.cleanup_mod(server, workshop_id)
                    _append_console_log(server.id, f"[MSM] Mod {workshop_id} Re-Install: Cache + Artefakte bereinigt\n")
                except Exception as ce:
                    _append_console_log(server.id, f"[MSM] Mod {workshop_id} Re-Install Cleanup Warnung: {ce}\n")
            result = plugin.install_mod(server, workshop_id)
            has_error = bool(result.get("error")) if isinstance(result, dict) else bool(result)
            is_ok = result.get("ok", True) is not False if isinstance(result, dict) else not has_error
            success = isinstance(result, dict) and is_ok and not has_error
            if success:
                updater.update_mod_metadata_after_success(server.id, workshop_id, remote_updated)
                mark_mod_installed(server.id, workshop_id)
            else:
                if isinstance(result, dict):
                    err = result.get("error") or ("; ".join(result.get("errors") or []) if result.get("errors") else None)
                else:
                    err = result
                mark_mod_failed(server.id, workshop_id, _safe_error(err))
        finally:
            release_install_update_lock(server.id)
    except Exception as exc:
        logger.exception(
            "Fehler bei Hintergrund-Mod-Installation für Server %s (workshop_id: %s)",
            server_id,
            workshop_id,
        )
        mark_mod_failed(server_id, workshop_id, _safe_error(exc))
        release_install_update_lock(server_id)
    finally:
        db.close()


def install_mods_batch_bg(server_id: int, workshop_ids: list[str]) -> None:
    """Installiert eine Liste von Mods gebündelt in Blueprint-Chunks (z. B. Steam-Collections)."""
    if not workshop_ids:
        return

    acquired = acquire_install_update_lock_blocking(server_id, "mod_batch_install")
    if acquired is False:
        for wid in workshop_ids:
            mark_mod_failed(server_id, wid, "Eine andere Installation oder ein Update läuft bereits")
        return

    try:
        db = SessionLocal()
        try:
            server = db.query(Server).filter(Server.id == server_id).first()
            if not server:
                logger.error("Server %s nicht gefunden (batch-install)", server_id)
                for wid in workshop_ids:
                    mark_mod_failed(server_id, wid, "Server nicht gefunden")
                return
            plugin = get_plugin(server.game_type)
            if not plugin or not plugin.supports_mods:
                for wid in workshop_ids:
                    mark_mod_failed(server_id, wid, "Mods in diesem Spiel nicht aktiviert")
                return
            # Relation vor expunge laden, damit DetachedInstanceError bei server.node ausbleibt.
            _ = getattr(server, "node", None)
            db.expunge(server)
        finally:
            db.close()

        _append_console_log(
            server_id,
            f"[MSM] Batch-Installation für {len(workshop_ids)} Mod(s) in Blöcken à {_BATCH_CHUNK_SIZE} gestartet.\n",
        )

        ok_count = 0
        chunk_size = max(1, int(_BATCH_CHUNK_SIZE))
        for offset in range(0, len(workshop_ids), chunk_size):
            chunk = workshop_ids[offset:offset + chunk_size]

            # Zwischen den Chunks prüfen, welche Mods noch pending sind (ermöglicht sauberen Abbruch)
            db_check = SessionLocal()
            try:
                pending_rows = (
                    db_check.query(Mod.workshop_id)
                    .filter(
                        Mod.server_id == server_id,
                        Mod.workshop_id.in_(chunk),
                        Mod.install_status == "pending",
                    )
                    .all()
                )
                pending_set = {row[0] for row in pending_rows}
            finally:
                db_check.close()

            active_chunk = [wid for wid in chunk if wid in pending_set]
            if not active_chunk:
                continue

            for wid in active_chunk:
                mark_mod_installing(server_id, wid, "install")

            try:
                if hasattr(plugin, "install_mods"):
                    result = plugin.install_mods(server, active_chunk)
                else:
                    # Fallback für Plugins ohne Batch-Implementierung
                    per_item: dict[str, dict] = {}
                    for wid in active_chunk:
                        single_res = plugin.install_mod(server, wid)
                        per_item[wid] = single_res if isinstance(single_res, dict) else {"ok": bool(single_res)}
                    result = {
                        "ok": all(v.get("ok", True) is not False and not v.get("error") for v in per_item.values()),
                        "items": per_item,
                    }
            except Exception as exc:
                err_msg = _safe_error(exc)
                for wid in active_chunk:
                    mark_mod_failed(server_id, wid, err_msg)
                _append_console_log(server_id, f"[MSM] Batch-Block fehlgeschlagen — {exc}\n")
                continue

            items_map = result.get("items") if isinstance(result, dict) and isinstance(result.get("items"), dict) else {}
            global_ok = result.get("ok", True) is not False and not result.get("error") if isinstance(result, dict) else not bool(result)
            global_err = (
                (result.get("error") or ("; ".join(result.get("errors") or []) if result.get("errors") else None))
                if isinstance(result, dict)
                else str(result)
            )

            for wid in active_chunk:
                item_res = items_map.get(wid)
                if isinstance(item_res, dict):
                    item_ok = item_res.get("ok", True) is not False and not item_res.get("error")
                    item_err = item_res.get("error") or global_err
                else:
                    item_ok = global_ok
                    item_err = global_err

                if item_ok:
                    updater.update_mod_metadata_after_success(server_id, wid, None)
                    mark_mod_installed(server_id, wid)
                    ok_count += 1
                else:
                    mark_mod_failed(server_id, wid, _safe_error(item_err))

        try:
            plugin.update_modlist(server)
        except Exception as exc:
            logger.warning("Modlist-Update nach batch-install fehlgeschlagen: %s", exc)

        _append_console_log(
            server_id,
            f"[MSM] Batch-Installation abgeschlossen ({ok_count}/{len(workshop_ids)} erfolgreich).\n",
        )
    except Exception:
        logger.exception("batch-install fehlgeschlagen für Server %s", server_id)
        db_err = SessionLocal()
        try:
            unfinished = (
                db_err.query(Mod.workshop_id)
                .filter(
                    Mod.server_id == server_id,
                    Mod.workshop_id.in_(workshop_ids),
                    Mod.install_status.in_((INSTALL_RUNNING, "pending")),
                )
                .all()
            )
            unfinished_ids = [row[0] for row in unfinished]
        finally:
            db_err.close()
        for wid in unfinished_ids:
            mark_mod_failed(server_id, wid, "Batch-Installation abgebrochen")
    finally:
        release_install_update_lock(server_id)


def reinstall_all_mods_bg(server_id: int, workshop_ids: list[str]) -> None:
    acquire_install_update_lock_blocking(server_id, "mod_reinstall_all")
    try:
        db = SessionLocal()
        try:
            server = db.query(Server).filter(Server.id == server_id).first()
            if not server:
                logger.error("Server %s nicht gefunden (reinstall-all)", server_id)
                for wid in workshop_ids:
                    mark_mod_failed(server_id, wid, "Server nicht gefunden")
                return
            plugin = get_plugin(server.game_type)
            if not plugin or not plugin.supports_mods:
                for wid in workshop_ids:
                    mark_mod_failed(server_id, wid, "Steam Workshop nicht in diesem Spiel aktiviert")
                return

            _append_console_log(
                server.id,
                f"[MSM] Neuinstallation für {len(workshop_ids)} Workshop-Mod(s) gestartet (nacheinander).\n",
            )
            ok_count = 0
            for wid in workshop_ids:
                mark_mod_installing(server.id, wid, "reinstall")
                try:
                    plugin.cleanup_mod(server, wid)
                except Exception as exc:
                    _append_console_log(
                        server.id,
                        f"[MSM] Mod {wid} Cleanup-Warnung: {exc}\n",
                    )
                try:
                    result = plugin.install_mod(server, wid)
                except Exception as exc:
                    mark_mod_failed(server.id, wid, _safe_error(exc))
                    _append_console_log(server.id, f"[MSM] Mod {wid}: fehlgeschlagen — {exc}\n")
                    continue
                has_error = bool(result.get("error")) if isinstance(result, dict) else bool(result)
                is_ok = result.get("ok", True) is not False if isinstance(result, dict) else not has_error
                success = isinstance(result, dict) and is_ok and not has_error
                if success:
                    updater.update_mod_metadata_after_success(server.id, wid, None)
                    mark_mod_installed(server.id, wid)
                    ok_count += 1
                    _append_console_log(server.id, f"[MSM] Mod {wid}: neu installiert\n")
                else:
                    if isinstance(result, dict):
                        err = result.get("error") or (
                            "; ".join(result.get("errors") or []) if result.get("errors") else None
                        )
                    else:
                        err = str(result)
                    mark_mod_failed(server.id, wid, _safe_error(err))
                    _append_console_log(server.id, f"[MSM] Mod {wid}: fehlgeschlagen — {err}\n")

            try:
                plugin.update_modlist(server)
            except Exception as exc:
                logger.warning("Modlist-Update nach reinstall-all fehlgeschlagen: %s", exc)

            _append_console_log(
                server.id,
                f"[MSM] Neuinstallation abgeschlossen ({ok_count}/{len(workshop_ids)} erfolgreich).\n",
            )
        finally:
            db.close()
    except Exception:
        logger.exception("reinstall-all fehlgeschlagen für Server %s", server_id)
        for wid in workshop_ids:
            mark_mod_failed(server_id, wid, "Neuinstallation abgebrochen")
    finally:
        release_install_update_lock(server_id)


def bulk_mod_action_bg(
    server_id: int,
    workshop_ids: list[str],
    action: Literal["reinstall", "update"],
    remote_updated_map: dict[str, str | None] | None = None,
) -> None:
    """Führt Update oder Neuinstallation für ausgewählte Mods blockweise im Hintergrund aus."""
    if not workshop_ids:
        return

    acquired = acquire_install_update_lock_blocking(server_id, f"mod_bulk_{action}")
    if acquired is False:
        for wid in workshop_ids:
            mark_mod_failed(server_id, wid, "Eine andere Installation oder ein Update läuft bereits")
        return

    try:
        db = SessionLocal()
        try:
            server = db.query(Server).filter(Server.id == server_id).first()
            if not server:
                logger.error("Server %s nicht gefunden (bulk-action)", server_id)
                for wid in workshop_ids:
                    mark_mod_failed(server_id, wid, "Server nicht gefunden")
                return
            plugin = get_plugin(server.game_type)
            if not plugin or not plugin.supports_mods:
                for wid in workshop_ids:
                    mark_mod_failed(server_id, wid, "Mods in diesem Spiel nicht aktiviert")
                return
            # Relation vor expunge laden, damit DetachedInstanceError bei server.node ausbleibt.
            _ = getattr(server, "node", None)
            db.expunge(server)
        finally:
            db.close()

        action_label = "Neuinstallation" if action == "reinstall" else "Update"
        _append_console_log(
            server_id,
            f"[MSM] {action_label} für {len(workshop_ids)} ausgewählte Mod(s) gestartet.\n",
        )

        ok_count = 0
        chunk_size = max(1, int(_BATCH_CHUNK_SIZE))
        for offset in range(0, len(workshop_ids), chunk_size):
            chunk = workshop_ids[offset:offset + chunk_size]

            db_check = SessionLocal()
            try:
                pending_rows = (
                    db_check.query(Mod.workshop_id)
                    .filter(
                        Mod.server_id == server_id,
                        Mod.workshop_id.in_(chunk),
                        Mod.install_status == "pending",
                    )
                    .all()
                )
                pending_set = {row[0] for row in pending_rows}
            finally:
                db_check.close()

            active_chunk = [wid for wid in chunk if wid in pending_set]
            if not active_chunk:
                continue

            for wid in active_chunk:
                mark_mod_installing(server_id, wid, action)
                if action == "reinstall":
                    try:
                        plugin.cleanup_mod(server, wid)
                    except Exception as exc:
                        _append_console_log(server_id, f"[MSM] Mod {wid} Cleanup-Warnung: {exc}\n")

            try:
                if hasattr(plugin, "install_mods"):
                    result = plugin.install_mods(server, active_chunk)
                else:
                    per_item: dict[str, dict] = {}
                    for wid in active_chunk:
                        single_res = plugin.install_mod(server, wid)
                        per_item[wid] = single_res if isinstance(single_res, dict) else {"ok": bool(single_res)}
                    result = {
                        "ok": all(v.get("ok", True) is not False and not v.get("error") for v in per_item.values()),
                        "items": per_item,
                    }
            except Exception as exc:
                err_msg = _safe_error(exc)
                for wid in active_chunk:
                    mark_mod_failed(server_id, wid, err_msg)
                _append_console_log(server_id, f"[MSM] Bulk-{action_label}-Block fehlgeschlagen — {exc}\n")
                continue

            items_map = result.get("items") if isinstance(result, dict) and isinstance(result.get("items"), dict) else {}
            global_ok = result.get("ok", True) is not False and not result.get("error") if isinstance(result, dict) else not bool(result)
            global_err = (
                (result.get("error") or ("; ".join(result.get("errors") or []) if result.get("errors") else None))
                if isinstance(result, dict)
                else str(result)
            )

            for wid in active_chunk:
                item_res = items_map.get(wid)
                if isinstance(item_res, dict):
                    item_ok = item_res.get("ok", True) is not False and not item_res.get("error")
                    item_err = item_res.get("error") or global_err
                else:
                    item_ok = global_ok
                    item_err = global_err

                if item_ok:
                    remote_updated = remote_updated_map.get(wid) if remote_updated_map else None
                    updater.update_mod_metadata_after_success(server_id, wid, remote_updated)
                    mark_mod_installed(server_id, wid)
                    ok_count += 1
                else:
                    mark_mod_failed(server_id, wid, _safe_error(item_err))

        try:
            plugin.update_modlist(server)
        except Exception as exc:
            logger.warning("Modlist-Update nach bulk-action fehlgeschlagen: %s", exc)

        _append_console_log(
            server_id,
            f"[MSM] Bulk-{action_label} abgeschlossen ({ok_count}/{len(workshop_ids)} erfolgreich).\n",
        )
    except Exception:
        logger.exception("bulk-action fehlgeschlagen für Server %s", server_id)
        db_err = SessionLocal()
        try:
            unfinished = (
                db_err.query(Mod.workshop_id)
                .filter(
                    Mod.server_id == server_id,
                    Mod.workshop_id.in_(workshop_ids),
                    Mod.install_status.in_((INSTALL_RUNNING, "pending")),
                )
                .all()
            )
            unfinished_ids = [row[0] for row in unfinished]
        finally:
            db_err.close()
        for wid in unfinished_ids:
            mark_mod_failed(server_id, wid, "Bulk-Aktion abgebrochen")
    finally:
        release_install_update_lock(server_id)


@router.get("/{server_id}", response_model=list[ModResponse])
def list_mods(server_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_server_permission(user, server_id, db, "server.mods.read")
    server = db.query(Server).filter(Server.id == server_id).first()
    if server:
        plugin = get_plugin(server.game_type)
        # Kein schwerer Workshop-Check während laufender/pending Installs (Polling + SteamCMD = Pool-Timeout).
        if not _server_has_active_mod_jobs(db, server_id):
            _refresh_mod_update_availability(db, server, plugin)
    return db.query(Mod).filter(Mod.server_id == server_id).order_by(Mod.load_order.asc()).all()


@router.post("/{server_id}", response_model=ModResponse)
def subscribe_mod(
    server_id: int,
    workshop_id: str,
    background_tasks: BackgroundTasks,
    name: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
):
    require_server_permission(user, server_id, db, "server.mods.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)

    workshop_id = _validate_workshop_id(workshop_id)
    existing = db.query(Mod).filter(Mod.server_id == server_id, Mod.workshop_id == workshop_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Mod bereits abonniert")

    max_order = db.query(Mod).filter(Mod.server_id == server_id).count()
    mod = Mod(
        server_id=server_id,
        workshop_id=workshop_id,
        name=name,
        load_order=max_order,
        auto_update=True,
        install_status="pending" if plugin and plugin.supports_mods else "installed",
        install_action="install" if plugin and plugin.supports_mods else None,
        install_progress=0 if plugin and plugin.supports_mods else 100,
        update_status="missing" if plugin and plugin.supports_mods else "up_to_date",
        update_reason="missing" if plugin and plugin.supports_mods else None,
    )
    db.add(mod)
    AchievementService.melde(db, user.id, "server_modpack_installer")
    db.commit()
    db.refresh(mod)

    # Mod via SteamCMD installieren (in den Hintergrund auslagern, um nicht zu blockieren)
    if plugin and plugin.supports_mods:
        background_tasks.add_task(install_mod_bg, server.id, workshop_id)

    return mod


@router.post("/{server_id}/batch")
def subscribe_mods_batch(
    server_id: int,
    body: BatchModsInstallRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
):
    """Abonniert und installiert mehrere Mods gebündelt (z. B. aus einer Steam Collection oder Manifest)."""
    require_server_permission(user, server_id, db, "server.mods.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Spiel unterstützt keine Mods")

    ordered_items: list[tuple[str, str | None]] = []
    seen_wids: set[str] = set()
    for entry in body.items:
        wid = _validate_workshop_id(entry.workshop_id)
        if wid in seen_wids:
            continue
        seen_wids.add(wid)
        clean_name = entry.name.strip()[:255] if entry.name else None
        ordered_items.append((wid, clean_name or None))

    existing_rows = db.query(Mod).filter(Mod.server_id == server_id).all()
    existing_map = {m.workshop_id: m for m in existing_rows}
    next_order = (max((m.load_order or 0 for m in existing_rows), default=-1)) + 1

    queued_ids: list[str] = []
    skipped_ids: list[str] = []

    for wid, clean_name in ordered_items:
        existing = existing_map.get(wid)
        if existing is not None:
            if existing.install_status in (INSTALL_RUNNING, "pending") or (
                body.skip_existing and existing.install_status in (INSTALL_DONE, "success", "installed")
            ):
                skipped_ids.append(wid)
                continue
            if clean_name and not existing.name:
                existing.name = clean_name
            existing.install_status = "pending"
            existing.install_action = "install"
            existing.install_progress = 0
            existing.install_error = None
            existing.update_status = "missing"
            existing.update_reason = "missing"
            queued_ids.append(wid)
        else:
            mod = Mod(
                server_id=server_id,
                workshop_id=wid,
                name=clean_name,
                load_order=next_order,
                auto_update=body.auto_update,
                enabled=body.enabled,
                install_status="pending",
                install_action="install",
                install_progress=0,
                update_status="missing",
                update_reason="missing",
            )
            next_order += 1
            db.add(mod)
            existing_map[wid] = mod
            queued_ids.append(wid)

    if queued_ids:
        AchievementService.melde(db, user.id, "server_modpack_installer")
    db.commit()

    if queued_ids:
        background_tasks.add_task(install_mods_batch_bg, server.id, queued_ids)

    return {
        "ok": True,
        "queued": len(queued_ids),
        "skipped": len(skipped_ids),
        "queued_ids": queued_ids,
        "skipped_ids": skipped_ids,
        "total_requested": len(ordered_items),
    }


@router.post("/{server_id}/check-updates", response_model=list[ModResponse])
def check_mod_updates(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
):
    require_server_permission(user, server_id, db, "server.mods.read")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    _refresh_mod_update_availability(db, server, plugin, force=True)
    return db.query(Mod).filter(Mod.server_id == server_id).order_by(Mod.load_order.asc()).all()


@router.post("/{server_id}/{mod_id}/install", response_model=ModResponse)
def install_existing_mod(
    server_id: int,
    mod_id: int,
    background_tasks: BackgroundTasks,
    action: str = "reinstall",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
):
    require_server_permission(user, server_id, db, "server.mods.write")
    if action not in _MOD_ACTIONS:
        raise HTTPException(status_code=400, detail="Ungültige Mod-Aktion")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Steam Workshop nicht in diesem Spiel aktiviert")
    mod = db.query(Mod).filter(Mod.id == mod_id, Mod.server_id == server_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Mod nicht gefunden")
    _validate_workshop_id(mod.workshop_id)
    if mod.install_status == INSTALL_RUNNING:
        raise HTTPException(status_code=409, detail="Mod-Installation läuft bereits")

    remote_updated = mod.last_updated.isoformat() if action == "reinstall" and mod.last_updated else None
    if action == "update":
        updates = _refresh_mod_update_availability(db, server, plugin, force=True)
        for update in updates:
            if str(update.get("workshop_id")) == str(mod.workshop_id):
                remote_updated = update.get("remote_updated")
                break
        db.refresh(mod)
        if not (
            (mod.install_status == "pending" and mod.install_action == "update")
            or mod.update_status == "outdated"
        ):
            raise HTTPException(status_code=400, detail="Kein Mod-Update verfügbar")

    mod.install_status = "pending"
    mod.install_action = action
    mod.install_progress = 0
    mod.install_eta_seconds = None
    mod.install_error = None
    db.commit()
    db.refresh(mod)

    background_tasks.add_task(install_mod_bg, server.id, mod.workshop_id, action, remote_updated)
    return mod


@router.post("/{server_id}/reinstall-all", response_model=list[ModResponse])
def reinstall_all_mods(
    server_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
):
    require_server_permission(user, server_id, db, "server.mods.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Steam Workshop nicht in diesem Spiel aktiviert")

    mods = (
        db.query(Mod)
        .filter(Mod.server_id == server_id)
        .order_by(Mod.load_order.asc())
        .all()
    )
    if not mods:
        raise HTTPException(status_code=400, detail="Keine Mods zum Neuinstallieren")

    if any(m.install_status == INSTALL_RUNNING for m in mods):
        raise HTTPException(status_code=409, detail="Mod-Installation läuft bereits")

    workshop_ids: list[str] = []
    for mod in mods:
        _validate_workshop_id(mod.workshop_id)
        mod.install_status = "pending"
        mod.install_action = "reinstall"
        mod.install_progress = 0
        mod.install_eta_seconds = None
        mod.install_error = None
        workshop_ids.append(mod.workshop_id)
    db.commit()

    background_tasks.add_task(reinstall_all_mods_bg, server.id, workshop_ids)
    return (
        db.query(Mod)
        .filter(Mod.server_id == server_id)
        .order_by(Mod.load_order.asc())
        .all()
    )


@router.post("/{server_id}/abort-installs", response_model=list[ModResponse])
def abort_mod_installs(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
):
    """Hängende Mod-Installationen zurücksetzen (UI-Status + Install-Lock)."""
    require_server_permission(user, server_id, db, "server.mods.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")

    from services.install_update_lock_service import force_release_install_update_lock
    from services.mod_install_status_service import mark_mod_failed, mark_mod_installed

    mods = db.query(Mod).filter(Mod.server_id == server_id).all()
    changed = False
    for mod in mods:
        if mod.install_status == INSTALL_RUNNING:
            mark_mod_failed(
                server_id,
                mod.workshop_id,
                "Installation abgebrochen — bitte erneut starten (Server-Konsole prüfen).",
            )
            changed = True
        elif mod.install_status == "pending" and mod.install_action == "reinstall":
            mark_mod_installed(server_id, mod.workshop_id)
            changed = True
        elif mod.install_status == "pending" and mod.install_action == "install":
            mark_mod_failed(
                server_id,
                mod.workshop_id,
                "Installation abgebrochen — bitte erneut starten (Server-Konsole prüfen).",
            )
            changed = True
    force_release_install_update_lock(server_id)
    if changed:
        _append_console_log(
            server_id,
            "[MSM] Mod-Installationen manuell zurückgesetzt (abort-installs).\n",
        )
    return (
        db.query(Mod)
        .filter(Mod.server_id == server_id)
        .order_by(Mod.load_order.asc())
        .all()
    )


@router.patch("/{server_id}/{mod_id}", response_model=ModResponse)
def update_mod(server_id: int, mod_id: int, load_order: int | None = None, auto_update: bool | None = None, enabled: bool | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user), _: None = Depends(verify_csrf)):
    # Reorder/auto_update gehoeren zu server.mods.write; enable/disable zu server.mods.toggle.
    # Wenn alle Felder None sind, ist es effektiv ein Read -> server.mods.read.
    if enabled is not None:
        require_server_permission(user, server_id, db, "server.mods.toggle")
    if load_order is not None or auto_update is not None:
        require_server_permission(user, server_id, db, "server.mods.write")
    if enabled is None and load_order is None and auto_update is None:
        require_server_permission(user, server_id, db, "server.mods.read")
    mod = db.query(Mod).filter(Mod.id == mod_id, Mod.server_id == server_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Mod nicht gefunden")
    if load_order is not None:
        mod.load_order = load_order
    if auto_update is not None:
        mod.auto_update = auto_update
    if enabled is not None:
        mod.enabled = enabled
    db.commit()
    db.refresh(mod)
    # Write updated modlist to game config (no-op fuer Blueprints mit
    # modInjection!=file; Helper kennt die Regeln aus der Blueprint).
    server = db.query(Server).filter(Server.id == server_id).first()
    if server:
        plugin = get_plugin(server.game_type)
        if plugin and plugin.supports_mods:
            plugin.update_modlist(server)
    return mod


@router.delete("/{server_id}/{mod_id}")
def unsubscribe_mod(server_id: int, mod_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user), _: None = Depends(verify_csrf)) -> dict:
    require_server_permission(user, server_id, db, "server.mods.write")
    mod = db.query(Mod).filter(Mod.id == mod_id, Mod.server_id == server_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Mod nicht gefunden")
    server = db.query(Server).filter(Server.id == server_id).first()
    if server:
        plugin = get_plugin(server.game_type)
        if plugin and plugin.supports_mods:
            try:
                result = plugin.cleanup_mod(server, mod.workshop_id)
                if isinstance(result, dict) and result.get("ok") is False:
                    raise RuntimeError("cleanup_failed")
            except Exception as exc:
                logger.warning(
                    "Mod-Cleanup fehlgeschlagen fuer Server %s, Mod %s error_type=%s",
                    server_id,
                    mod.workshop_id,
                    type(exc).__name__,
                )
                raise HTTPException(
                    status_code=502,
                    detail="Mod-Dateien konnten nicht entfernt werden",
                ) from exc
    db.delete(mod)
    db.commit()
    if server:
        plugin = get_plugin(server.game_type)
        if plugin and plugin.supports_mods:
            plugin.update_modlist(server)
    return {"message": "Mod entfernt"}


@router.post("/{server_id}/reorder", response_model=list[ModResponse])
def reorder_mods(server_id: int, order: list[int], db: Session = Depends(get_db), user: User = Depends(get_current_user), _: None = Depends(verify_csrf)):
    require_server_permission(user, server_id, db, "server.mods.write")
    mods = db.query(Mod).filter(Mod.server_id == server_id).all()
    mod_map = {m.id: m for m in mods}
    if len(order) != len(mod_map) or len(set(order)) != len(order) or set(order) != set(mod_map):
        raise HTTPException(status_code=400, detail="Ungültige Mod-Ladereihenfolge")
    for idx, mod_id in enumerate(order):
        mod_map[mod_id].load_order = idx
    db.commit()
    # Write updated modlist to game config (Helper ist Blueprint-driven).
    server = db.query(Server).filter(Server.id == server_id).first()
    if server:
        plugin = get_plugin(server.game_type)
        if plugin and plugin.supports_mods:
            plugin.update_modlist(server)
    return db.query(Mod).filter(Mod.server_id == server_id).order_by(Mod.load_order.asc()).all()


@router.post("/{server_id}/bulk-action", response_model=list[ModResponse])
def bulk_action_mods(
    server_id: int,
    payload: BulkModActionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
):
    """Startet Update oder Neuinstallation für mehrere ausgewählte Mods."""
    require_server_permission(user, server_id, db, "server.mods.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)
    if not plugin or not plugin.supports_mods:
        raise HTTPException(status_code=400, detail="Mods in diesem Spiel nicht aktiviert")

    unique_ids: list[int] = []
    seen_ids: set[int] = set()
    for mid in payload.mod_ids:
        if mid not in seen_ids:
            seen_ids.add(mid)
            unique_ids.append(mid)

    mods = (
        db.query(Mod)
        .filter(Mod.server_id == server_id, Mod.id.in_(unique_ids))
        .order_by(Mod.load_order.asc())
        .all()
    )
    if len(mods) != len(unique_ids):
        raise HTTPException(status_code=404, detail="Mindestens eine Mod nicht gefunden")
    if any(m.install_status in (INSTALL_RUNNING, "pending") for m in mods):
        raise HTTPException(status_code=409, detail="Mod-Installation läuft bereits")

    remote_updated_map: dict[str, str | None] = {}
    if payload.action == "update":
        try:
            updates = _refresh_mod_update_availability(db, server, plugin, force=False)
            for item in updates:
                wid_key = str(item.get("workshop_id") or "")
                if wid_key:
                    remote_updated_map[wid_key] = item.get("remote_updated")
        except Exception as exc:
            logger.debug("Update-Metadatenabruf vor Bulk-Update übersprungen: %s", exc)

    workshop_ids: list[str] = []
    for mod in mods:
        _validate_workshop_id(mod.workshop_id)
        if payload.action == "reinstall" and mod.workshop_id not in remote_updated_map and mod.last_updated:
            remote_updated_map[mod.workshop_id] = mod.last_updated.isoformat()
        mod.install_status = "pending"
        mod.install_action = payload.action
        mod.install_progress = 0
        mod.install_eta_seconds = None
        mod.install_error = None
        workshop_ids.append(mod.workshop_id)
    db.commit()

    background_tasks.add_task(
        bulk_mod_action_bg,
        server.id,
        workshop_ids,
        payload.action,
        remote_updated_map or None,
    )
    return db.query(Mod).filter(Mod.server_id == server_id).order_by(Mod.load_order.asc()).all()


@router.post("/{server_id}/bulk-delete")
def bulk_delete_mods(
    server_id: int,
    payload: BulkModDeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict:
    """Löscht ausgewählte oder alle Mods aus der DB sowie deren Dateien auf der Festplatte."""
    require_server_permission(user, server_id, db, "server.mods.write")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    plugin = get_plugin(server.game_type)

    if payload.delete_all:
        targets = db.query(Mod).filter(Mod.server_id == server_id).order_by(Mod.load_order.asc()).all()
    else:
        unique_ids: list[int] = []
        seen_ids: set[int] = set()
        for mid in payload.mod_ids:
            if mid not in seen_ids:
                seen_ids.add(mid)
                unique_ids.append(mid)
        if not unique_ids:
            raise HTTPException(status_code=400, detail="Keine Mods ausgewählt")
        targets = (
            db.query(Mod)
            .filter(Mod.server_id == server_id, Mod.id.in_(unique_ids))
            .order_by(Mod.load_order.asc())
            .all()
        )
        if len(targets) != len(unique_ids):
            raise HTTPException(status_code=404, detail="Mindestens eine Mod nicht gefunden")

    if not targets:
        raise HTTPException(status_code=400, detail="Keine Mods zum Löschen vorhanden")
    if any(m.install_status == INSTALL_RUNNING for m in targets):
        raise HTTPException(status_code=409, detail="Laufende Mod-Installation kann nicht gelöscht werden")

    deleted_count = 0
    for mod in targets:
        if plugin and plugin.supports_mods:
            try:
                result = plugin.cleanup_mod(server, mod.workshop_id)
                if isinstance(result, dict) and result.get("ok") is False:
                    raise RuntimeError("cleanup_failed")
            except Exception as exc:
                logger.warning(
                    "Bulk-Mod-Cleanup fehlgeschlagen fuer Server %s, Mod %s error_type=%s",
                    server_id,
                    mod.workshop_id,
                    type(exc).__name__,
                )
                if deleted_count > 0:
                    db.commit()
                    plugin.update_modlist(server)
                raise HTTPException(
                    status_code=502,
                    detail="Mod-Dateien konnten nicht entfernt werden",
                ) from exc
        db.delete(mod)
        deleted_count += 1

    db.commit()
    if plugin and plugin.supports_mods:
        plugin.update_modlist(server)

    remaining = db.query(Mod).filter(Mod.server_id == server_id).order_by(Mod.load_order.asc()).all()
    return {
        "message": f"{deleted_count} Mod(s) entfernt",
        "deleted_count": deleted_count,
        "mods": [ModResponse.model_validate(m).model_dump(mode="json") for m in remaining],
    }
