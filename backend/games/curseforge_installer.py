"""CurseForge-Mod- und Modpack-Installer für Blueprint-Plugins."""

import asyncio
import io
import json
import logging
import zipfile
from pathlib import Path

import httpx

from blueprints.schema import BlueprintModInjection
from database import SessionLocal
from models import Mod
from services.curseforge_api_key_service import resolve_key as resolve_cf_key
from services.curseforge_service import get_curseforge_service

logger = logging.getLogger(__name__)


def _log_console(server_id: int, message: str) -> None:
    from games import blueprint_plugin as _bp

    _bp._append_console_log(server_id, message)


def _sync_startup_arg_curseforge_mods(plugin, server, clean_ids: list[str]) -> dict:
    """Registriert CurseForge-Mods für Spiele mit Startup-Argument-Injektion (z. B. ASA)."""
    try:
        async def _resolve_titles() -> dict[str, str]:
            svc = await get_curseforge_service()
            titles: dict[str, str] = {}
            if hasattr(svc, "get_mods_by_ids"):
                try:
                    infos = await svc.get_mods_by_ids(clean_ids)
                    for info in infos:
                        if info and info.title:
                            titles[str(info.publishedfileid)] = info.title
                    return titles
                except Exception:
                    pass
            for wid in clean_ids:
                try:
                    info = await svc.get_mod_details(wid)
                    if info and info.title:
                        titles[wid] = info.title
                except Exception:
                    pass
            return titles

        titles = asyncio.run(_resolve_titles())
        if titles:
            db = SessionLocal()
            try:
                for wid, title in titles.items():
                    mod_row = db.query(Mod).filter(Mod.server_id == server.id, Mod.workshop_id == wid).first()
                    if mod_row and not mod_row.name:
                        mod_row.name = title
                db.commit()
            finally:
                db.close()
    except Exception:
        pass

    for wid in clean_ids:
        _log_console(server.id, f"[MSM] CurseForge Mod {wid} registriert (Start-Argument)\n")
    plugin.update_modlist(server)
    return {"ok": True, "applied": len(clean_ids), "items": {wid: {"ok": True} for wid in clean_ids}}


def _update_curseforge_mod_title_in_db(server_id: int, wid: str, title: str) -> None:
    """Aktualisiert generische Mod-Namen in der DB auf den CurseForge-Titel."""
    try:
        db = SessionLocal()
        try:
            mod_row = db.query(Mod).filter(Mod.server_id == server_id, Mod.workshop_id == str(wid)).first()
            if mod_row and (
                not mod_row.name
                or mod_row.name.startswith("CurseForge Modpack ")
                or mod_row.name.startswith("Mod ")
            ):
                mod_row.name = title
                db.commit()
        finally:
            db.close()
    except Exception:
        pass


async def _download_manifest_mods(
    plugin,
    server,
    svc,
    cf_key: str,
    manifest_bytes: bytes,
    base: Path,
    target_dir_rel: str,
) -> None:
    """Lädt in einem CurseForge-Modpack `manifest.json` deklarierte Einzel-Mods nach."""
    try:
        manifest_data = json.loads(manifest_bytes.decode("utf-8"))
        manifest_files = manifest_data.get("files") or []
        if not manifest_files:
            return

        _log_console(
            server.id,
            f"[MSM] Modpack Manifest erkannt ({len(manifest_files)} Mods) — lade Mod-Dateien nach...\n",
        )
        mods_dir = (base / target_dir_rel).resolve()
        mods_dir.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as mc_client:
            for idx, fentry in enumerate(manifest_files, 1):
                pid = fentry.get("projectID")
                fid = fentry.get("fileID")
                if not pid or not fid:
                    continue
                try:
                    m_url = await svc.get_file_download_url(pid, fid)
                    if m_url:
                        m_resp = await mc_client.get(m_url, headers={"x-api-key": cf_key})
                        if m_resp.status_code == 200:
                            m_name = Path(m_url.split("?")[0]).name or f"mod_{pid}_{fid}"
                            safe_m_name = Path(m_name).name
                            m_target = (mods_dir / safe_m_name).resolve()
                            try:
                                m_target.relative_to(base)
                                m_target.write_bytes(m_resp.content)
                                plugin._try_chown_install_path(server, m_target)
                            except (ValueError, Exception) as write_err:
                                logger.warning("Fehler beim Schreiben von Mod %s (%s): %s", pid, safe_m_name, write_err)
                except Exception:
                    pass
                if idx % 10 == 0 or idx == len(manifest_files):
                    _log_console(
                        server.id,
                        f"[MSM] Modpack Download-Fortschritt: {idx}/{len(manifest_files)} Mods geladen\n",
                    )
    except Exception as m_err:
        logger.warning("Fehler beim Nachladen der Modpack-Dateien: %s", m_err)


async def _extract_curseforge_zip(
    plugin,
    server,
    svc,
    cf_key: str,
    file_bytes: bytes,
    mod_info,
    safe_name: str,
    base: Path,
    target_dir: Path,
    target_dir_rel: str,
) -> None:
    """Entpackt ein CurseForge-ZIP (inkl. `overrides/`- und `manifest.json`-Modpack-Support)."""
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
        namelist = zf.namelist()
        has_overrides = any(m.filename.startswith("overrides/") for m in zf.infolist())
        manifest_bytes = zf.read("manifest.json") if "manifest.json" in namelist else None
        # Zielverzeichnis: Bei Modpacks mit 'overrides/' ins Server-Hauptverzeichnis,
        # sonst in den vom Blueprint vorgegebenen Mod-Pfad.
        extract_root = base if has_overrides else target_dir
        for member in zf.infolist():
            member_path = Path(member.filename)
            if member_path.is_absolute() or ".." in member_path.parts:
                continue
            if has_overrides and member.filename.startswith("overrides/"):
                rel_part = member.filename[len("overrides/"):]
                if not rel_part:
                    continue
                extracted_path = (base / rel_part).resolve()
            else:
                extracted_path = (extract_root / member.filename).resolve()
            try:
                extracted_path.relative_to(base)
                if member.is_dir():
                    extracted_path.mkdir(parents=True, exist_ok=True)
                else:
                    extracted_path.parent.mkdir(parents=True, exist_ok=True)
                    extracted_path.write_bytes(zf.read(member))
                    plugin._try_chown_install_path(server, extracted_path)
            except (ValueError, Exception):
                pass

        if manifest_bytes:
            await _download_manifest_mods(plugin, server, svc, cf_key, manifest_bytes, base, target_dir_rel)

    dest_label = "Server-Wurzelverzeichnis" if has_overrides else target_dir_rel + "/"
    _log_console(
        server.id,
        f"[MSM] CurseForge Archiv {mod_info.title} ({safe_name}) entpackt nach {dest_label}\n",
    )


def _select_curseforge_file_obj(mod_info) -> dict | None:
    """Wählt bei Modpacks bevorzugt den Server-Pack-Download, sonst die neueste Datei."""
    if mod_info.has_server_pack and mod_info.server_pack_file_id:
        for lf in mod_info.latest_files or []:
            if isinstance(lf, dict) and lf.get("id") == mod_info.server_pack_file_id:
                return lf
        return {
            "id": mod_info.server_pack_file_id,
            "fileName": None,
            "downloadUrl": None,
            "_is_server_pack_fallback": True,
        }
    if mod_info.latest_files:
        return mod_info.latest_files[0]
    if mod_info.main_file_id:
        return {"id": mod_info.main_file_id, "fileName": None, "downloadUrl": None}
    return None


async def _download_single_curseforge_mod(
    plugin,
    server,
    svc,
    cf_key: str,
    wid: str,
    base: Path,
    target_dir: Path,
    target_dir_rel: str,
) -> tuple[bool, str | None, dict[str, object]]:
    """Lädt eine einzelne CurseForge-Mod/Modpack-Datei herunter und wendet sie an."""
    try:
        mod_info = await svc.get_mod_details(wid)
        if not mod_info:
            return (
                False,
                f"CurseForge ID {wid} nicht gefunden (404/ungueltige ID)",
                {"ok": False, "error": f"Mod/Pack {wid} nicht auf CurseForge gefunden"},
            )

        file_obj = _select_curseforge_file_obj(mod_info)
        if file_obj and file_obj.get("_is_server_pack_fallback") and hasattr(svc, "get_mod_files"):
            try:
                all_files = await svc.get_mod_files(wid)
                for candidate in all_files or []:
                    if isinstance(candidate, dict) and candidate.get("id") == mod_info.server_pack_file_id:
                        file_obj = candidate
                        break
            except Exception:
                pass

        if not file_obj or not file_obj.get("id"):
            return (
                False,
                f"{mod_info.title} (ID {wid}): Keine Dateien auf CurseForge verfuegbar",
                {"ok": False, "error": "Keine Release-Dateien verfuegbar"},
            )

        dl_url = file_obj.get("downloadUrl") or await svc.get_file_download_url(wid, file_obj["id"])
        if not dl_url:
            return (
                False,
                f"{mod_info.title}: Direkter API-Download vom Mod-Autor deaktiviert oder keine URL",
                {"ok": False, "error": "Keine Download-URL verfuegbar"},
            )

        file_name = file_obj.get("fileName")
        if not file_name and isinstance(dl_url, str):
            url_tail = dl_url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
            if url_tail:
                file_name = url_tail
        if not file_name:
            file_name = (
                f"serverpack_{file_obj['id']}.zip"
                if mod_info.has_server_pack and mod_info.server_pack_file_id == file_obj["id"]
                else f"mod_{wid}.jar"
            )
        safe_name = Path(file_name).name
        dest_file_name = safe_name if str(wid) in safe_name else f"cf_{wid}_{safe_name}"
        dest_file = (target_dir / dest_file_name).resolve()
        dest_file.relative_to(base)

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as dl_client:
            resp = await dl_client.get(dl_url, headers={"x-api-key": cf_key})
            resp.raise_for_status()
            file_bytes = resp.content

        if safe_name.lower().endswith(".zip"):
            await _extract_curseforge_zip(
                plugin,
                server,
                svc,
                cf_key,
                file_bytes,
                mod_info,
                safe_name,
                base,
                target_dir,
                target_dir_rel,
            )
        else:
            dest_file.write_bytes(file_bytes)
            plugin._try_chown_install_path(server, dest_file)
            _log_console(
                server.id,
                f"[MSM] CurseForge Mod {mod_info.title} ({dest_file_name}) heruntergeladen nach {target_dir_rel}/\n",
            )

        _update_curseforge_mod_title_in_db(server.id, wid, mod_info.title)
        return True, None, {"ok": True}
    except Exception as exc:
        return False, f"{wid}: {exc}", {"ok": False, "error": str(exc)}


def install_curseforge_mods(plugin, server, workshop_ids: list[str]) -> dict:
    """Installiert oder registriert CurseForge-Mods anhand des Blueprint-Mod-Profils."""
    bp_mods = plugin._blueprint.effective_mods()
    clean_ids = [str(wid).strip() for wid in workshop_ids if str(wid).strip()]
    if not clean_ids:
        return {"ok": True, "applied": 0, "items": {}}

    if bp_mods.modInjection == BlueprintModInjection.STARTUP_ARG:
        return _sync_startup_arg_curseforge_mods(plugin, server, clean_ids)

    cf_key = resolve_cf_key()
    if not cf_key:
        return {"error": "CurseForge API-Key nicht konfiguriert (in Panel-Einstellungen hinterlegen)"}

    base = Path(server.install_dir).resolve()
    target_dir_rel = bp_mods.curseforgeInstallPath or "mods"
    target_dir = (base / target_dir_rel).resolve()
    try:
        target_dir.relative_to(base)
    except ValueError:
        return {"error": "curseforgeInstallPath verlaesst install_dir"}

    target_dir.mkdir(parents=True, exist_ok=True)

    async def _download_cf() -> dict:
        svc = await get_curseforge_service()
        errors: list[str] = []
        applied = 0
        items: dict[str, dict[str, object]] = {}
        for wid in clean_ids:
            ok, err_msg, item_res = await _download_single_curseforge_mod(
                plugin,
                server,
                svc,
                cf_key,
                wid,
                base,
                target_dir,
                target_dir_rel,
            )
            items[wid] = item_res
            if ok:
                applied += 1
            elif err_msg:
                errors.append(err_msg)

        res: dict = {
            "ok": len(errors) == 0,
            "applied": applied,
            "errors": errors,
            "items": items,
        }
        if errors:
            res["error"] = "; ".join(errors)
        return res

    res = asyncio.run(_download_cf())
    plugin.update_modlist(server)
    return res
