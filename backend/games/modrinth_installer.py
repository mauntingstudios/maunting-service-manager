"""Modrinth Mod-, Plugin- und Modpack-Installer (.jar / .mrpack) fuer Blueprint-Plugins."""

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
MODRINTH_META_DIR = ".msm-modrinth"


def _log_console(server_id: int, message: str) -> None:
    log_mod_console(server_id, message)


def _update_modrinth_mod_title_in_db(server_id: int, wid: str, title: str) -> None:
    update_mod_title_in_db(server_id, wid, title, label="Modrinth")


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
    return await stream_verified_download(
        url,
        user_agent=MODRINTH_USER_AGENT,
        url_validator=is_allowed_modrinth_download_url,
        max_bytes=MAX_MODRINTH_DOWNLOAD_BYTES,
        expected_sha512=expected_sha512,
        expected_sha1=expected_sha1,
        server_id=server_id,
        wid=wid,
        domain_label="Modrinth-CDN",
        client_factory=httpx.AsyncClient,
        progress_fn=set_mod_install_progress,
    )


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
        if not raw_name.startswith(prefix) or is_zip_symlink(member):
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
    *,
    installed_out: list[str] | None = None,
) -> list[str]:
    """Entpackt ein Modrinth .mrpack (modrinth.index.json + overrides + server-overrides)."""
    installed_files: list[str] = installed_out if installed_out is not None else []
    budget = [0]
    mrpack_tmp.seek(0)
    with zipfile.ZipFile(mrpack_tmp) as zf:
        if "modrinth.index.json" not in zf.namelist():
            raise ValueError("Ungueltiges .mrpack: modrinth.index.json fehlt")
        index_data = json.loads(zf.read("modrinth.index.json").decode("utf-8"))
        files = index_data.get("files") or []
        if len(files) > MAX_MODRINTH_EXTRACT_FILES:
            raise ValueError("Modpack ueberschreitet die maximale Dateianzahl")
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
            raw_rel = str(entry.get("path") or "").strip().replace("\\", "/")
            if not raw_rel or raw_rel.startswith("/") or Path(raw_rel).is_absolute() or ".." in Path(raw_rel).parts:
                continue
            target = (base / raw_rel).resolve()
            try:
                target.relative_to(base)
            except ValueError:
                continue
            if len(installed_files) >= MAX_MODRINTH_EXTRACT_FILES:
                raise ValueError("Modpack ueberschreitet die maximale Dateianzahl")
            downloads = [u for u in (entry.get("downloads") or []) if isinstance(u, str) and is_allowed_modrinth_download_url(u)]
            if not downloads:
                continue
            hashes = entry.get("hashes") or {}
            expected_sha512 = hashes.get("sha512") if isinstance(hashes, dict) else None
            expected_sha1 = hashes.get("sha1") if isinstance(hashes, dict) else None
            if not expected_sha512 and not expected_sha1:
                raise ValueError(f"Modpack-Datei {raw_rel} enthaelt keine Pruefsumme")

            sub_tmp, _ = await _download_verified_file(
                downloads[0],
                expected_sha512=expected_sha512,
                expected_sha1=expected_sha1,
            )
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as dst_fp:
                    while True:
                        buf = sub_tmp.read(65536)
                        if not buf:
                            break
                        budget[0] += len(buf)
                        if budget[0] > MAX_MODRINTH_EXTRACT_BYTES:
                            raise ValueError("Modpack ueberschreitet das maximale Entpack-Limit")
                        dst_fp.write(buf)
                plugin._try_chown_install_path(server, target)
                installed_files.append(str(target.relative_to(base)).replace("\\", "/"))
            finally:
                sub_tmp.close()
            if idx % 10 == 0 or idx == len(files):
                _log_console(server.id, f"[MSM] Modpack Fortschritt: {idx}/{len(files)}\n")

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
        old_meta = read_modrinth_metadata(base, wid)
        old_files = list(old_meta.get("files") or []) if old_meta else []
        old_file_set = {str(f).replace("\\", "/") for f in old_files}
        installed_files: list[str] = []
        try:
            set_mod_install_progress(server.id, wid, 90)
            if file_name.lower().endswith(".mrpack"):
                await _install_mrpack(
                    plugin,
                    server,
                    dl_tmp,
                    base,
                    project.title,
                    installed_out=installed_files,
                )
            else:
                target_dir.mkdir(parents=True, exist_ok=True)
                dest_file = (target_dir / file_name).resolve()
                dest_file.relative_to(base)
                with dest_file.open("wb") as dst_fp:
                    shutil.copyfileobj(dl_tmp, dst_fp, length=65536)
                plugin._try_chown_install_path(server, dest_file)
                installed_files.append(str(dest_file.relative_to(base)).replace("\\", "/"))
                _log_console(
                    server.id,
                    f"[MSM] Modrinth {project.title} ({file_name}) installiert nach {target_dir_rel}/\n",
                )
        except Exception:
            # Bei Fehler neu geschriebene Dateien zurueckrollen, Altversion bleibt erhalten
            remove_stale_files(base, installed_files, old_file_set)
            raise
        finally:
            dl_tmp.close()

        # Erst nach vollstaendiger Installation alte nicht mehr enthaltene Dateien entfernen
        remove_stale_files(base, old_files, set(installed_files))

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
