"""Modrinth Mod-, Plugin- und Modpack-Installer (.jar / .mrpack) fuer Blueprint-Plugins."""

from __future__ import annotations

import asyncio
import hashlib
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
from services.modrinth_service import (
    MODRINTH_USER_AGENT,
    get_modrinth_service,
    is_allowed_modrinth_download_url,
    strip_modrinth_prefix,
)

logger = logging.getLogger(__name__)
MAX_MODRINTH_DOWNLOAD_BYTES = 512 * 1024 * 1024  # 512 MiB Sicherheitsgrenze
MAX_MODRINTH_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB Entpack-Limit (Zip-Bomb-Schutz)
MAX_MODRINTH_EXTRACT_FILES = 5000
_MAX_REDIRECT_HOPS = 5
_SPOOL_MEMORY_THRESHOLD_BYTES = 16 * 1024 * 1024
MODRINTH_META_DIR = ".msm-modrinth"


def _log_console(server_id: int, message: str) -> None:
    from games import blueprint_plugin as _bp

    _bp._append_console_log(server_id, message)


def _update_modrinth_mod_title_in_db(server_id: int, wid: str, title: str) -> None:
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
        logger.debug("Modrinth-Mod-Titel in DB nicht aktualisierbar server_id=%s wid=%s", server_id, wid, exc_info=True)


def _select_primary_file(version: dict[str, Any]) -> dict[str, Any] | None:
    files = [f for f in (version.get("files") or []) if isinstance(f, dict) and f.get("url")]
    if not files:
        return None
    for f in files:
        if f.get("primary"):
            return f
    return files[0]


def _detect_server_game_version(plugin) -> str | None:
    bp = getattr(plugin, "_blueprint", None)
    if bp and hasattr(bp, "runtime") and hasattr(bp.runtime, "env"):
        v = str(bp.runtime.env.get("VERSION", "")).strip()
        if v and v.upper() != "LATEST":
            return v
    return None


async def _download_verified_file(
    url: str,
    *,
    expected_sha512: str | None = None,
    expected_sha1: str | None = None,
    server_id: int | None = None,
    wid: str | None = None,
) -> tuple[tempfile.SpooledTemporaryFile, str]:
    """Laedt eine Datei von der Modrinth-CDN (mit Redirect-Allowlist-Pruefung) und verifiziert SHA-512/SHA-1."""
    current_url = url
    if not is_allowed_modrinth_download_url(current_url):
        raise ValueError("Download-URL liegt ausserhalb der erlaubten Modrinth-CDN")

    tmp = tempfile.SpooledTemporaryFile(max_size=_SPOOL_MEMORY_THRESHOLD_BYTES)
    hasher_512 = hashlib.sha512()
    hasher_1 = hashlib.sha1()
    downloaded = 0

    try:
        async with httpx.AsyncClient(
            timeout=120.0,
            follow_redirects=False,
            headers={"User-Agent": MODRINTH_USER_AGENT},
        ) as client:
            for _hop in range(_MAX_REDIRECT_HOPS + 1):
                async with client.stream("GET", current_url) as resp:
                    status = getattr(resp, "status_code", 200)
                    if status in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            raise ValueError("Redirect ohne Location-Header")
                        next_url = urljoin(current_url, location)
                        if not is_allowed_modrinth_download_url(next_url):
                            raise ValueError("Redirect-Ziel liegt ausserhalb der erlaubten Modrinth-CDN")
                        current_url = next_url
                        continue
                    resp.raise_for_status()
                    try:
                        total_bytes = int(resp.headers.get("content-length") or 0)
                    except (TypeError, ValueError):
                        total_bytes = 0
                    if total_bytes > MAX_MODRINTH_DOWNLOAD_BYTES:
                        raise ValueError("Modrinth-Datei ueberschreitet das Download-Limit")
                    last_pct = 20
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        downloaded += len(chunk)
                        if downloaded > MAX_MODRINTH_DOWNLOAD_BYTES:
                            raise ValueError("Modrinth-Datei ueberschreitet das Download-Limit")
                        tmp.write(chunk)
                        hasher_512.update(chunk)
                        hasher_1.update(chunk)
                        if server_id is not None and wid is not None:
                            pct = min(85, 20 + int((downloaded / total_bytes) * 65)) if total_bytes > 0 else min(85, last_pct + 5)
                            if pct >= last_pct + 5:
                                last_pct = pct
                                set_mod_install_progress(
                                    server_id,
                                    wid,
                                    pct,
                                    current_bytes=downloaded,
                                    total_bytes=total_bytes or None,
                                )
                    break
            else:
                raise ValueError("Zu viele Redirects beim Modrinth-Download")

        actual_sha512 = hasher_512.hexdigest()
        actual_sha1 = hasher_1.hexdigest()
        if expected_sha512 and actual_sha512.lower() != expected_sha512.lower():
            raise ValueError("SHA-512-Pruefsumme stimmt nicht ueberein")
        if not expected_sha512 and expected_sha1 and actual_sha1.lower() != expected_sha1.lower():
            raise ValueError("SHA-1-Pruefsumme stimmt nicht ueberein")

        tmp.seek(0)
        return tmp, actual_sha512
    except Exception:
        tmp.close()
        raise


def _is_zip_symlink(member: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(member.external_attr >> 16)


def _safe_extract_zip_prefix(
    plugin,
    server,
    zf: zipfile.ZipFile,
    prefix: str,
    base: Path,
    installed_files: list[str],
    budget: list[int],
) -> None:
    for member in zf.infolist():
        raw_name = member.filename.replace("\\", "/")
        if not raw_name.startswith(prefix) or _is_zip_symlink(member):
            continue
        rel_part = raw_name[len(prefix) :]
        if not rel_part:
            continue
        member_path = Path(rel_part)
        if member_path.is_absolute() or ".." in member_path.parts:
            continue
        raw_target = base / rel_part
        if raw_target.is_symlink():
            continue
        target = raw_target.resolve()
        try:
            target.relative_to(base)
        except ValueError:
            continue
        if member.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if len(installed_files) >= MAX_MODRINTH_EXTRACT_FILES:
            raise ValueError("Modpack ueberschreitet die maximale Dateianzahl")
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(member, "r") as src_fp, target.open("wb") as dst_fp:
            while True:
                buf = src_fp.read(65536)
                if not buf:
                    break
                budget[0] += len(buf)
                if budget[0] > MAX_MODRINTH_EXTRACT_BYTES:
                    raise ValueError("Modpack ueberschreitet das maximale Entpack-Limit")
                dst_fp.write(buf)
        plugin._try_chown_install_path(server, target)
        installed_files.append(str(target.relative_to(base)).replace("\\", "/"))


async def _install_mrpack(
    plugin,
    server,
    mrpack_tmp: tempfile.SpooledTemporaryFile,
    base: Path,
    title: str,
) -> list[str]:
    """Entpackt ein Modrinth .mrpack (modrinth.index.json + overrides + server-overrides)."""
    installed_files: list[str] = []
    mrpack_tmp.seek(0)
    with zipfile.ZipFile(mrpack_tmp) as zf:
        if "modrinth.index.json" not in zf.namelist():
            raise ValueError("Ungueltiges .mrpack: modrinth.index.json fehlt")
        index_data = json.loads(zf.read("modrinth.index.json").decode("utf-8"))
        files = index_data.get("files") or []
        _log_console(
            server.id,
            f"[MSM] Modrinth Modpack {title}: {len(files)} Datei(en) werden geladen...\n",
        )
        for idx, entry in enumerate(files, 1):
            if not isinstance(entry, dict):
                continue
            env_spec = entry.get("env") or {}
            if isinstance(env_spec, dict) and env_spec.get("server") == "unsupported":
                continue
            rel_path = str(entry.get("path") or "").strip().lstrip("/")
            if not rel_path or Path(rel_path).is_absolute() or ".." in Path(rel_path).parts:
                continue
            target = (base / rel_path).resolve()
            try:
                target.relative_to(base)
            except ValueError:
                continue
            downloads = [u for u in (entry.get("downloads") or []) if isinstance(u, str) and is_allowed_modrinth_download_url(u)]
            if not downloads:
                continue
            hashes = entry.get("hashes") or {}
            try:
                sub_tmp, _ = await _download_verified_file(
                    downloads[0],
                    expected_sha512=hashes.get("sha512"),
                    expected_sha1=hashes.get("sha1"),
                )
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("wb") as dst_fp:
                        shutil.copyfileobj(sub_tmp, dst_fp, length=65536)
                    plugin._try_chown_install_path(server, target)
                    installed_files.append(str(target.relative_to(base)).replace("\\", "/"))
                finally:
                    sub_tmp.close()
            except Exception as exc:
                logger.warning("Modpack-Datei %s uebersprungen: %s", rel_path, exc)
            if idx % 10 == 0 or idx == len(files):
                _log_console(server.id, f"[MSM] Modpack Fortschritt: {idx}/{len(files)}\n")

        budget = [0]
        _safe_extract_zip_prefix(plugin, server, zf, "overrides/", base, installed_files, budget)
        _safe_extract_zip_prefix(plugin, server, zf, "server-overrides/", base, installed_files, budget)

    return installed_files


def _meta_key(raw_id: str) -> str:
    return strip_modrinth_prefix(raw_id).lower()


def _write_modrinth_metadata(
    base: Path,
    meta_id: str,
    *,
    project_id: str,
    version_id: str,
    version_number: str,
    sha512: str,
    files: list[str],
) -> None:
    meta_dir = (base / MODRINTH_META_DIR).resolve()
    meta_dir.relative_to(base)
    meta_dir.mkdir(parents=True, exist_ok=True)
    meta_file = (meta_dir / f"{_meta_key(meta_id)}.json").resolve()
    meta_file.relative_to(meta_dir)
    payload = {
        "project_id": project_id,
        "version_id": version_id,
        "version_number": version_number,
        "sha512": sha512,
        "files": list(dict.fromkeys(files)),
        "installed_at": datetime.now(timezone.utc).isoformat(),
    }
    meta_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def read_modrinth_metadata(base: Path, project_id: str) -> dict[str, Any] | None:
    clean = _meta_key(project_id)
    if not clean:
        return None
    meta_file = (base / MODRINTH_META_DIR / f"{clean}.json").resolve()
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


def cleanup_modrinth_mod(server, workshop_id: str) -> dict[str, Any]:
    """Entfernt installierte Modrinth-Dateien anhand der gespeicherten Metadaten."""
    meta_key = _meta_key(workshop_id)
    base = Path(server.install_dir).resolve()
    removed: list[str] = []

    meta = read_modrinth_metadata(base, meta_key)
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
        meta_file = (base / MODRINTH_META_DIR / f"{meta_key}.json").resolve()
        try:
            meta_file.relative_to(base)
            if meta_file.is_file():
                meta_file.unlink(missing_ok=True)
        except ValueError:
            pass

    _log_console(server.id, f"[MSM] Modrinth Mod {workshop_id} entfernt ({len(removed)} Datei(en))\n")
    return {"ok": True, "removed": removed}


def sync_modrinth_enabled_state(base: Path, workshop_id: str, enabled: bool) -> None:
    """Schaltet Modrinth-Dateien (.jar <-> .jar.disabled) anhand von Mod.enabled um."""
    project_id = strip_modrinth_prefix(workshop_id)
    meta = read_modrinth_metadata(base, project_id)
    if not meta:
        return
    for rel in meta.get("files") or []:
        rel_str = str(rel)
        if not rel_str.lower().endswith(".jar"):
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


async def _install_single_modrinth_mod(
    plugin,
    server,
    svc,
    wid: str,
    base: Path,
    target_dir: Path,
    target_dir_rel: str,
    loaders: list[str],
    game_version: str | None,
) -> tuple[bool, str | None, dict[str, Any]]:
    project_id = strip_modrinth_prefix(wid)
    try:
        set_mod_install_progress(server.id, wid, 10)
        project = await svc.get_project(project_id)
        if not project:
            return False, f"Modrinth Projekt {project_id} nicht gefunden", {"ok": False, "error": "Projekt nicht gefunden"}

        game_versions = [game_version] if game_version else None
        versions = await svc.get_project_versions(
            project.project_id,
            loaders=loaders or None,
            game_versions=game_versions,
        )
        if not versions and game_versions:
            versions = await svc.get_project_versions(project.project_id, loaders=loaders or None)
        if not versions:
            versions = await svc.get_project_versions(project.project_id)
        if not versions:
            return False, f"{project.title}: Keine kompatiblen Versionen gefunden", {"ok": False, "error": "Keine Version verfuegbar"}

        chosen = versions[0]
        primary_file = _select_primary_file(chosen)
        if not primary_file:
            return False, f"{project.title}: Keine Download-Datei in Version", {"ok": False, "error": "Keine Datei verfuegbar"}

        dl_url = str(primary_file.get("url") or "")
        raw_filename = str(primary_file.get("filename") or f"{project.slug}.jar").replace("\\", "/")
        file_name = Path(raw_filename).name
        if not file_name or file_name in (".", ".."):
            file_name = f"{project.slug}.jar"
        hashes = primary_file.get("hashes") or {}

        set_mod_install_progress(server.id, wid, 20)
        dl_tmp, sha512 = await _download_verified_file(
            dl_url,
            expected_sha512=hashes.get("sha512"),
            expected_sha1=hashes.get("sha1"),
            server_id=server.id,
            wid=wid,
        )
        try:
            set_mod_install_progress(server.id, wid, 90)
            # Vorherige Dateien dieses Projekts/Modpacks bereinigen, um Duplikate bei Updates zu vermeiden
            cleanup_modrinth_mod(server, wid)
            installed_files: list[str] = []
            if file_name.lower().endswith(".mrpack"):
                installed_files = await _install_mrpack(plugin, server, dl_tmp, base, project.title)
            else:
                target_dir.mkdir(parents=True, exist_ok=True)
                dest_file = (target_dir / file_name).resolve()
                dest_file.relative_to(base)
                with dest_file.open("wb") as dst_fp:
                    shutil.copyfileobj(dl_tmp, dst_fp, length=65536)
                plugin._try_chown_install_path(server, dest_file)
                installed_files = [str(dest_file.relative_to(base)).replace("\\", "/")]
                _log_console(
                    server.id,
                    f"[MSM] Modrinth {project.title} ({file_name}) installiert nach {target_dir_rel}/\n",
                )
        finally:
            dl_tmp.close()

        _write_modrinth_metadata(
            base,
            wid,
            project_id=project.project_id,
            version_id=str(chosen.get("id") or ""),
            version_number=str(chosen.get("version_number") or ""),
            sha512=sha512,
            files=installed_files,
        )
        _update_modrinth_mod_title_in_db(server.id, wid, project.title)
        set_mod_install_progress(server.id, wid, 100)
        return True, None, {"ok": True, "version_id": chosen.get("id")}
    except Exception as exc:
        logger.warning("Modrinth-Installation fuer %s fehlgeschlagen: %s", wid, exc)
        return False, f"{wid}: {exc}", {"ok": False, "error": str(exc)}


def install_modrinth_mods(plugin, server, workshop_ids: list[str]) -> dict[str, Any]:
    """Synchroner Einstiegspunkt fuer BlueprintPlugin.install_mods()."""
    bp_mods = plugin._blueprint.effective_mods()
    clean_ids = [str(wid).strip() for wid in workshop_ids if str(wid).strip()]
    if not clean_ids:
        return {"ok": True, "applied": 0, "items": {}}

    base = Path(server.install_dir).resolve()
    target_dir_rel = bp_mods.modrinthInstallPath or bp_mods.curseforgeInstallPath or "mods"
    target_dir = (base / target_dir_rel).resolve()
    try:
        target_dir.relative_to(base)
    except ValueError:
        return {"ok": False, "error": "modrinthInstallPath verlaesst Server-Verzeichnis"}

    loaders = list(bp_mods.modrinthLoaders or [])
    game_version = _detect_server_game_version(plugin)

    async def _run() -> dict[str, Any]:
        svc = await get_modrinth_service()
        items: dict[str, Any] = {}
        errors: list[str] = []
        applied = 0
        for wid in clean_ids:
            ok, err, item_res = await _install_single_modrinth_mod(
                plugin,
                server,
                svc,
                wid,
                base,
                target_dir,
                target_dir_rel,
                loaders,
                game_version,
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
