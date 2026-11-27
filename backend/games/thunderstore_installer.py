"""Thunderstore Mod- und BepInEx-Installer fuer Blueprint-Plugins."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from games.mod_archive_utils import (
    is_zip_symlink,
    log_mod_console,
    remove_stale_files,
    stream_verified_download,
    update_mod_title_in_db,
)
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
THUNDERSTORE_META_DIR = ".msm-thunderstore"


def _log_console(server_id: int, message: str) -> None:
    log_mod_console(server_id, message)


def _update_thunderstore_mod_title_in_db(server_id: int, wid: str, title: str) -> None:
    update_mod_title_in_db(server_id, wid, title, label="Thunderstore")


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
                if is_zip_symlink(member):
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
                if is_zip_symlink(member):
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
        dl_tmp, _ = await stream_verified_download(
            current_url,
            user_agent=THUNDERSTORE_USER_AGENT,
            url_validator=is_allowed_thunderstore_download_url,
            max_bytes=MAX_THUNDERSTORE_DOWNLOAD_BYTES,
            fallback_total_bytes=pkg.file_size,
            server_id=server.id,
            wid=wid,
            domain_label="Thunderstore",
            client_factory=httpx.AsyncClient,
            progress_fn=set_mod_install_progress,
        )
        old_meta = read_thunderstore_metadata(base, wid)
        old_files = list(old_meta.get("files") or []) if old_meta else []
        old_dirs = list(old_meta.get("dirs") or []) if old_meta else []
        try:
            set_mod_install_progress(server.id, wid, 90)
            installed_files, created_dirs = _extract_thunderstore_zip(
                plugin,
                server,
                dl_tmp,
                base,
                target_dir,
                pkg.full_name,
                allow_bepinex_root=pkg.name.lower().startswith("bepinexpack"),
            )
        finally:
            dl_tmp.close()

        remove_stale_files(base, old_files, set(installed_files))
        keep_dirs = {str(d).replace("\\", "/") for d in created_dirs}
        for old_dir in old_dirs:
            old_dir_norm = str(old_dir).replace("\\", "/")
            if old_dir_norm in keep_dirs:
                continue
            dpath = (base / old_dir_norm).resolve()
            try:
                dpath.relative_to(base)
            except ValueError:
                continue
            if dpath.is_dir() and dpath != base:
                shutil.rmtree(dpath, ignore_errors=True)

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
