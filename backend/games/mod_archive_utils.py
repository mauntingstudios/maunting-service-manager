"""Gemeinsame Download-, Entpack- und Bereinigungshelfer fuer Mod-Installer (Modrinth & Thunderstore)."""

from __future__ import annotations

import hashlib
import logging
import stat
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin

import httpx

from database import SessionLocal
from models import Mod
from services.mod_install_status_service import set_mod_install_progress

logger = logging.getLogger(__name__)

_MAX_REDIRECT_HOPS = 5
_SPOOL_MEMORY_THRESHOLD_BYTES = 16 * 1024 * 1024


def log_mod_console(server_id: int, message: str) -> None:
    from games import blueprint_plugin as _bp

    _bp._append_console_log(server_id, message)


def update_mod_title_in_db(server_id: int, wid: str, title: str, *, label: str) -> None:
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
        logger.debug("%s-Mod-Titel in DB nicht aktualisierbar server_id=%s wid=%s", label, server_id, wid, exc_info=True)


def is_zip_symlink(member: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(member.external_attr >> 16)


def parse_content_length(raw: Any, fallback: int = 0) -> int:
    try:
        val = int(raw or 0)
        return val if val > 0 else fallback
    except (TypeError, ValueError):
        return fallback


async def stream_verified_download(
    url: str,
    *,
    user_agent: str,
    url_validator: Callable[[str], bool],
    max_bytes: int,
    expected_sha512: str | None = None,
    expected_sha1: str | None = None,
    fallback_total_bytes: int = 0,
    server_id: int | None = None,
    wid: str | None = None,
    domain_label: str = "Mod",
    client_factory: type[httpx.AsyncClient] | None = None,
    progress_fn: Callable[..., None] | None = None,
) -> tuple[tempfile.SpooledTemporaryFile, str]:
    """Laedt eine Datei mit Redirect-Allowlist-Pruefung und Groessen-/Hash-Verifikation."""
    current_url = url
    if not url_validator(current_url):
        raise ValueError(f"Download-URL liegt ausserhalb der erlaubten {domain_label}-Domain")

    tmp = tempfile.SpooledTemporaryFile(max_size=_SPOOL_MEMORY_THRESHOLD_BYTES)
    hasher_512 = hashlib.sha512()
    hasher_1 = hashlib.sha1()
    downloaded = 0
    async_client_cls = client_factory or httpx.AsyncClient
    report_progress = progress_fn or set_mod_install_progress

    try:
        async with async_client_cls(
            timeout=120.0,
            follow_redirects=False,
            headers={"User-Agent": user_agent},
        ) as client:
            for _hop in range(_MAX_REDIRECT_HOPS + 1):
                async with client.stream("GET", current_url) as resp:
                    status = getattr(resp, "status_code", 200)
                    if status in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            raise ValueError("Redirect ohne Location-Header")
                        next_url = urljoin(current_url, location)
                        if not url_validator(next_url):
                            raise ValueError(
                                f"Redirect-Ziel liegt ausserhalb der erlaubten {domain_label}-Domain"
                            )
                        current_url = next_url
                        continue
                    resp.raise_for_status()
                    total_bytes = parse_content_length(resp.headers.get("content-length"), fallback_total_bytes)
                    if total_bytes > max_bytes:
                        raise ValueError(f"{domain_label}-Datei ueberschreitet das Download-Limit")
                    last_pct = 20
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        downloaded += len(chunk)
                        if downloaded > max_bytes:
                            raise ValueError(f"{domain_label}-Datei ueberschreitet das Download-Limit")
                        tmp.write(chunk)
                        hasher_512.update(chunk)
                        hasher_1.update(chunk)
                        if server_id is not None and wid is not None:
                            pct = (
                                min(85, 20 + int((downloaded / total_bytes) * 65))
                                if total_bytes > 0
                                else min(85, last_pct + 5)
                            )
                            if pct >= last_pct + 5:
                                last_pct = pct
                                report_progress(
                                    server_id,
                                    wid,
                                    pct,
                                    current_bytes=downloaded,
                                    total_bytes=total_bytes or None,
                                )
                    break
            else:
                raise ValueError(f"Zu viele Redirects beim {domain_label}-Download")

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


def remove_stale_files(base: Path, old_files: list[str], keep_files: set[str]) -> list[str]:
    """Entfernt veraltete Mod-Dateien (inkl. .disabled), die nicht Teil der neuen Installation sind."""
    removed: list[str] = []
    for rel in old_files:
        rel_norm = str(rel).replace("\\", "/")
        if rel_norm in keep_files:
            continue
        for candidate_rel in (rel_norm, f"{rel_norm}.disabled"):
            target = (base / candidate_rel).resolve()
            try:
                target.relative_to(base)
            except ValueError:
                continue
            if target.is_file():
                target.unlink(missing_ok=True)
                removed.append(candidate_rel)
    return removed
