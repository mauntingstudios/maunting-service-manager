"""Thunderstore Mod- und BepInEx-Installer fuer Blueprint-Plugins."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import stat
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from database import SessionLocal
from models import Mod
from services.mod_install_status_service import set_mod_install_progress
from services.thunderstore_service import (
    THUNDERSTORE_USER_AGENT,
    get_thunderstore_service,
    is_allowed_thunderstore_download_url,
    strip_thunderstore_prefix,
)

logger = logging.getLogger(__name__)
MAX_THUNDERSTORE_DOWNLOAD_BYTES = 512 * 1024 * 1024  # 512 MiB Sicherheitsgrenze
MAX_THUNDERSTORE_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB Entpack-Limit
MAX_THUNDERSTORE_EXTRACT_FILES = 5000
_MAX_REDIRECT_HOPS = 5
_SPOOL_MEMORY_THRESHOLD_BYTES = 16 * 1024 * 1024
THUNDERSTORE_META_DIR = ".msm-thunderstore"


def _log_console(server_id: int, message: str) -> None:
    from games import blueprint_plugin as _bp

    _bp._append_console_log(server_id, message)


def _update_thunderstore_mod_title_in_db(server_id: int, wid: str, title: str) -> None:
    try:
        db = SessionLocal()
        try:
            mod_row = db.query(Mod).filter(Mod.server_id == server_id, Mod.workshop_id == str(wid)).first()
            if mod_row and (not mod_row.name or mod_row.name.startswith("Mod ") or mod_row.name == wid):
                mod_row.name = title
                db.commit()
        finally:
            db.close()
    except Exception:
        logger.debug("Thunderstore-Mod-Titel in DB nicht aktualisierbar server_id=%s wid=%s", server_id, wid, exc_info=True)


def _meta_key(raw_id: str) -> str:
    return strip_thunderstore_prefix(raw_id).lower()


def _write_thunderstore_metadata(
    base: Path,
    meta_id: str,
    *,
    full_name: str,
    version: str,
    files: list[str],
    dirs: list[str],
) -> None:
    meta_dir = (base / THUNDERSTORE_META_DIR).resolve()
    meta_dir.relative_to(base)
    meta_dir.mkdir(parents=True, exist_ok=True)
    meta_file = (meta_dir / f"{_meta_key(meta_id)}.json").resolve()
    meta_file.relative_to(meta_dir)
    payload = {
        "full_name": full_name,
        "version": version,
        "files": list(dict.fromkeys(files)),
        "dirs": list(dict.fromkeys(dirs)),
        "installed_at": datetime.now(timezone.utc).isoformat(),
    }
    meta_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def read_thunderstore_metadata(base: Path, pkg_id: str) -> dict[str, Any] | None:
    clean = _meta_key(pkg_id)
    if not clean or ".." in clean:
        return None
    meta_file = (base / THUNDERSTORE_META_DIR / f"{clean}.json").resolve()
    try:
        meta_file.relative_to(base)
    except ValueError:
        return None
    if not meta_file.is_file():
        return None
    try:
        data = json.loads(meta_file.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def cleanup_thunderstore_mod(server, workshop_id: str) -> dict[str, Any]:
    """Entfernt installierte Thunderstore-Dateien anhand der gespeicherten Metadaten."""
    meta_key = _meta_key(workshop_id)
    base = Path(server.install_dir).resolve()
    removed: list[str] = []

    meta = read_thunderstore_metadata(base, meta_key)
    if meta:
        for rel in meta.get("files") or []:
            for candidate_rel in (str(rel), f"{rel}.disabled"):
                target = (base / candidate_rel).resolve()
                try:
                    target.relative_to(base)
                except ValueError:
                    continue
                if target.is_file():
                    target.unlink(missing_ok=True)
                    removed.append(candidate_rel)
        for rel_dir in meta.get("dirs") or []:
            dpath = (base / str(rel_dir)).resolve()
            try:
                dpath.relative_to(base)
            except ValueError:
                continue
            if dpath.is_dir() and dpath != base:
                shutil.rmtree(dpath, ignore_errors=True)
        meta_file = (base / THUNDERSTORE_META_DIR / f"{meta_key}.json").resolve()
        try:
            meta_file.relative_to(base)
            if meta_file.is_file():
                meta_file.unlink(missing_ok=True)
        except ValueError:
            pass

    _log_console(server.id, f"[MSM] Thunderstore Mod {workshop_id} entfernt ({len(removed)} Datei(en))\n")
    return {"ok": True, "removed": removed}


def sync_thunderstore_enabled_state(base: Path, workshop_id: str, enabled: bool) -> None:
    """Schaltet Thunderstore-Plugin-DLLs (.dll <-> .dll.disabled) um."""
    full_name = strip_thunderstore_prefix(workshop_id)
    meta = read_thunderstore_metadata(base, full_name)
    if not meta:
        return
    for rel in meta.get("files") or []:
        rel_str = str(rel)
        if not rel_str.lower().endswith(".dll"):
            continue
        active_path = (base / rel_str).resolve()
        disabled_path = (base / f"{rel_str}.disabled").resolve()
        try:
            active_path.relative_to(base)
            disabled_path.relative_to(base)
        except ValueError:
            continue
        if enabled and disabled_path.is_file() and not active_path.exists():
            disabled_path.rename(active_path)
        elif not enabled and active_path.is_file() and not disabled_path.exists():
            active_path.rename(disabled_path)


def _is_zip_symlink(member: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(member.external_attr >> 16)


def _extract_thunderstore_zip(
    plugin,
    server,
    zip_tmp: tempfile.SpooledTemporaryFile,
    base: Path,
    target_dir: Path,
    full_name: str,
    *,
    allow_bepinex_root: bool = False,
) -> tuple[list[str], list[str]]:
    """Entpackt ein Thunderstore-ZIP sicher (BepInExPack-Root oder Plugin-Unterordner)."""
    installed_files: list[str] = []
    created_dirs: list[str] = []
    extracted_bytes = 0
    zip_tmp.seek(0)

    def _copy_member_bounded(zf: zipfile.ZipFile, member: zipfile.ZipInfo, dest: Path) -> None:
        nonlocal extracted_bytes
        if len(installed_files) >= MAX_THUNDERSTORE_EXTRACT_FILES:
            raise ValueError("Thunderstore-Paket ueberschreitet die maximale Dateianzahl")
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(member, "r") as src_fp, dest.open("wb") as dst_fp:
            while True:
                buf = src_fp.read(65536)
                if not buf:
                    break
                extracted_bytes += len(buf)
                if extracted_bytes > MAX_THUNDERSTORE_EXTRACT_BYTES:
                    raise ValueError("Thunderstore-Paket ueberschreitet das maximale Entpack-Limit")
                dst_fp.write(buf)
        plugin._try_chown_install_path(server, dest)
        installed_files.append(str(dest.relative_to(base)).replace("\\", "/"))

    with zipfile.ZipFile(zip_tmp) as zf:
        members = zf.infolist()
        top_names = [m.filename.replace("\\", "/").split("/", 1)[0] for m in members if m.filename]
        is_bepinex_pack = allow_bepinex_root and any(name.startswith("BepInExPack") for name in top_names)

        if is_bepinex_pack:
            bep_prefix = next(name for name in top_names if name.startswith("BepInExPack")) + "/"
            for member in members:
                if _is_zip_symlink(member):
                    continue
                raw_name = member.filename.replace("\\", "/")
                if not raw_name.startswith(bep_prefix):
                    continue
                rel = raw_name[len(bep_prefix) :]
                if not rel:
                    continue
                rel_path = Path(rel)
                if rel_path.is_absolute() or ".." in rel_path.parts:
                    continue
                raw_dest = base / rel
                if raw_dest.is_symlink():
                    continue
                dest = raw_dest.resolve()
                try:
                    dest.relative_to(base)
                except ValueError:
                    continue
                if member.is_dir():
                    dest.mkdir(parents=True, exist_ok=True)
                    continue
                _copy_member_bounded(zf, member, dest)
        else:
            pkg_dir = (target_dir / full_name).resolve()
            pkg_dir.relative_to(base)
            pkg_dir.mkdir(parents=True, exist_ok=True)
            created_dirs.append(str(pkg_dir.relative_to(base)).replace("\\", "/"))

            for member in members:
                if _is_zip_symlink(member):
                    continue
                raw_name = member.filename.replace("\\", "/")
                if not raw_name or member.is_dir():
                    continue
                rel_path = Path(raw_name)
                if rel_path.is_absolute() or ".." in rel_path.parts:
                    continue

                parts = rel_path.parts
                if len(parts) >= 2 and parts[0].lower() == "bepinex":
                    raw_dest = base / rel_path
                elif len(parts) >= 2 and parts[0].lower() == "plugins":
                    raw_dest = pkg_dir / Path(*parts[1:])
                else:
                    raw_dest = pkg_dir / rel_path

                if raw_dest.is_symlink():
                    continue
                dest = raw_dest.resolve()
                try:
                    dest.relative_to(base)
                except ValueError:
                    continue
                _copy_member_bounded(zf, member, dest)

    return installed_files, created_dirs


async def _install_single_thunderstore_mod(
    plugin,
    server,
    svc,
    community: str,
    wid: str,
    base: Path,
    target_dir: Path,
    target_dir_rel: str,
) -> tuple[bool, str | None, dict[str, Any]]:
    try:
        set_mod_install_progress(server.id, wid, 10)
        pkg = await svc.get_package(community, wid)
        if not pkg:
            return False, f"Thunderstore Paket {wid} nicht gefunden", {"ok": False, "error": "Paket nicht gefunden"}
        current_url = pkg.download_url
        if not current_url or not is_allowed_thunderstore_download_url(current_url):
            return False, f"{pkg.full_name}: Keine erlaubte Download-URL", {"ok": False, "error": "Ungueltige Download-URL"}

        set_mod_install_progress(server.id, wid, 20)
        with tempfile.SpooledTemporaryFile(max_size=_SPOOL_MEMORY_THRESHOLD_BYTES) as dl_tmp:
            downloaded = 0
            async with httpx.AsyncClient(
                timeout=120.0,
                follow_redirects=False,
                headers={"User-Agent": THUNDERSTORE_USER_AGENT},
            ) as client:
                for _hop in range(_MAX_REDIRECT_HOPS + 1):
                    async with client.stream("GET", current_url) as resp:
                        status = getattr(resp, "status_code", 200)
                        if status in (301, 302, 303, 307, 308):
                            location = resp.headers.get("location")
                            if not location:
                                raise ValueError("Redirect ohne Location-Header")
                            next_url = urljoin(current_url, location)
                            if not is_allowed_thunderstore_download_url(next_url):
                                raise ValueError("Redirect-Ziel liegt ausserhalb der erlaubten Thunderstore-Domain")
                            current_url = next_url
                            continue
                        resp.raise_for_status()
                        total_bytes = int(resp.headers.get("content-length") or 0) or pkg.file_size
                        if total_bytes > MAX_THUNDERSTORE_DOWNLOAD_BYTES:
                            raise ValueError("Thunderstore-Paket ueberschreitet das Download-Limit")
                        last_pct = 20
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            downloaded += len(chunk)
                            if downloaded > MAX_THUNDERSTORE_DOWNLOAD_BYTES:
                                raise ValueError("Thunderstore-Paket ueberschreitet das Download-Limit")
                            dl_tmp.write(chunk)
                            pct = min(85, 20 + int((downloaded / total_bytes) * 65)) if total_bytes > 0 else min(85, last_pct + 5)
                            if pct >= last_pct + 5:
                                last_pct = pct
                                set_mod_install_progress(
                                    server.id,
                                    wid,
                                    pct,
                                    current_bytes=downloaded,
                                    total_bytes=total_bytes or None,
                                )
                        break
                else:
                    raise ValueError("Zu viele Redirects beim Thunderstore-Download")

            set_mod_install_progress(server.id, wid, 90)
            cleanup_thunderstore_mod(server, wid)
            installed_files, created_dirs = _extract_thunderstore_zip(
                plugin,
                server,
                dl_tmp,
                base,
                target_dir,
                pkg.full_name,
                allow_bepinex_root=pkg.name.lower().startswith("bepinexpack"),
            )

        _write_thunderstore_metadata(
            base,
            wid,
            full_name=pkg.full_name,
            version=pkg.latest_version,
            files=installed_files,
            dirs=created_dirs,
        )
        _update_thunderstore_mod_title_in_db(server.id, wid, pkg.name)
        set_mod_install_progress(server.id, wid, 100)
        _log_console(
            server.id,
            f"[MSM] Thunderstore {pkg.full_name} v{pkg.latest_version} installiert nach {target_dir_rel}/\n",
        )
        return True, None, {"ok": True, "version": pkg.latest_version}
    except Exception as exc:
        logger.warning("Thunderstore-Installation fuer %s fehlgeschlagen: %s", wid, exc)
        return False, f"{wid}: {exc}", {"ok": False, "error": str(exc)}


def install_thunderstore_mods(plugin, server, workshop_ids: list[str]) -> dict[str, Any]:
    """Synchroner Einstiegspunkt fuer BlueprintPlugin.install_mods()."""
    bp_mods = plugin._blueprint.effective_mods()
    community = bp_mods.thunderstoreCommunity
    if not bp_mods.supportsThunderstore or not community:
        return {"ok": False, "error": "Thunderstore nicht in dieser Blueprint aktiviert"}

    clean_ids = [str(wid).strip() for wid in workshop_ids if str(wid).strip()]
    if not clean_ids:
        return {"ok": True, "applied": 0, "items": {}}

    base = Path(server.install_dir).resolve()
    target_dir_rel = bp_mods.thunderstoreInstallPath or "BepInEx/plugins"
    target_dir = (base / target_dir_rel).resolve()
    try:
        target_dir.relative_to(base)
    except ValueError:
        return {"ok": False, "error": "thunderstoreInstallPath verlaesst Server-Verzeichnis"}

    async def _run() -> dict[str, Any]:
        svc = await get_thunderstore_service()
        items: dict[str, Any] = {}
        errors: list[str] = []
        applied = 0
        for wid in clean_ids:
            ok, err, item_res = await _install_single_thunderstore_mod(
                plugin,
                server,
                svc,
                community,
                wid,
                base,
                target_dir,
                target_dir_rel,
            )
            items[wid] = item_res
            if ok:
                applied += 1
            elif err:
                errors.append(err)
        out: dict[str, Any] = {
            "ok": len(errors) == 0,
            "applied": applied,
            "errors": errors,
            "items": items,
        }
        if errors:
            out["error"] = "; ".join(errors)
        return out

    return asyncio.run(_run())
