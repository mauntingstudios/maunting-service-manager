"""OS-enforced per-server disk quota management.

Supports native kernel Project Quotas (XFS ``prjquota`` or ext4 ``project``)
with automatic fallback to sparse ext4 loopback images via a narrow,
root-owned privilege wrapper (``/usr/local/sbin/msm-quota``).

When a host has no quota helper installed (e.g. developer workstations or
unprivileged containers), ``apply_quota`` records metadata and reports
``enforced=False`` unless ``MSM_REQUIRE_DISK_QUOTA=true`` forces fail-closed
behavior in hardened production environments.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
import subprocess
from typing import Any

from config import settings
from services.file_service import PathValidationError, server_root

logger = logging.getLogger(__name__)

_ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LC_ALL": "C",
}
_QUOTA_WRAPPER = "/usr/local/sbin/msm-quota"
_META_FILENAME = ".msm-disk-quota"


class DiskQuotaError(RuntimeError):
    """Raised when disk quota validation or enforcement fails."""


def _validated_limit_mb(limit_gb: int | float) -> int:
    try:
        gb = float(limit_gb)
    except (TypeError, ValueError) as exc:
        raise DiskQuotaError("Invalid disk limit") from exc
    if gb < 1 or gb > 100_000:
        raise DiskQuotaError("disk_limit_gb must be between 1 and 100000")
    return max(1024, int(round(gb * 1024)))


def _numeric_server_id(server_id: str | int) -> str:
    sid = str(server_id).strip()
    if not sid.isdigit() or int(sid) <= 0:
        raise PathValidationError("Quota requires a positive numeric server_id")
    return sid


def _supports_prjquota(servers_base: Path) -> bool:
    """Detect whether the backing mount for MSM_SERVERS_DIR uses prjquota/project."""
    mounts_file = Path("/proc/mounts")
    if os.name != "posix" or not mounts_file.is_file():
        return False
    target = str(servers_base.resolve(strict=False))
    best_mount = ""
    best_match: tuple[str, str] | None = None
    try:
        lines = mounts_file.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return False
    for line in lines:
        parts = line.split()
        if len(parts) < 4:
            continue
        mountpoint, fstype, options = parts[1], parts[2], parts[3]
        if target == mountpoint or target.startswith(mountpoint.rstrip("/") + "/") or mountpoint == "/":
            if len(mountpoint) >= len(best_mount):
                best_mount = mountpoint
                best_match = (fstype, options)
    if not best_match:
        return False
    fstype, options = best_match
    opt_set = set(options.split(","))
    return fstype in {"xfs", "ext4"} and bool({"prjquota", "pquota", "uqnoenforce"} & opt_set or "prjquota" in options)


def resolve_quota_driver() -> str:
    configured = (getattr(settings, "quota_driver", "auto") or "auto").strip().lower()
    if configured in {"prjquota", "loopback", "none"}:
        return configured
    if os.name != "posix" or not Path(_QUOTA_WRAPPER).is_file():
        return "none"
    if _supports_prjquota(settings.servers_path()):
        return "prjquota"
    return "loopback"


def _run_quota_wrapper(args: list[str], *, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["sudo", "-n", _QUOTA_WRAPPER, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env=_ENV,
    )


def apply_quota(server_id: str | int, limit_gb: int | float) -> dict[str, Any]:
    """Ensure hard OS disk quota enforcement for ``server_id`` at ``limit_gb``."""
    sid = _numeric_server_id(server_id)
    limit_mb = _validated_limit_mb(limit_gb)
    root = server_root(sid)
    root.mkdir(parents=True, exist_ok=True)
    driver = resolve_quota_driver()

    if driver == "none":
        if bool(getattr(settings, "require_disk_quota", False)):
            raise DiskQuotaError("Disk quota helper is required but unavailable on this node")
        _write_quota_marker(root, driver="none", limit_mb=limit_mb, enforced=False)
        return {"ok": True, "driver": "none", "enforced": False, "limit_mb": limit_mb}

    action = "apply-prjquota" if driver == "prjquota" else "apply-loopback"
    proc = _run_quota_wrapper([action, sid, str(limit_mb)], timeout=60)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or f"exit {proc.returncode}").strip()[:300]
        if driver == "prjquota":
            logger.warning("prjquota failed for server %s (%s); trying loopback fallback", sid, detail)
            proc2 = _run_quota_wrapper(["apply-loopback", sid, str(limit_mb)], timeout=60)
            if proc2.returncode == 0:
                _write_quota_marker(root, driver="loopback", limit_mb=limit_mb, enforced=True)
                return {"ok": True, "driver": "loopback", "enforced": True, "limit_mb": limit_mb}
            detail = (proc2.stderr or proc2.stdout or detail).strip()[:300]
        if bool(getattr(settings, "require_disk_quota", False)):
            raise DiskQuotaError(f"Failed to enforce disk quota: {detail}")
        logger.warning("Disk quota wrapper unavailable/failed for server %s: %s", sid, detail)
        _write_quota_marker(root, driver=driver, limit_mb=limit_mb, enforced=False)
        return {"ok": True, "driver": driver, "enforced": False, "limit_mb": limit_mb, "warning": detail}

    _write_quota_marker(root, driver=driver, limit_mb=limit_mb, enforced=True)
    return {"ok": True, "driver": driver, "enforced": True, "limit_mb": limit_mb}


def remove_quota(server_id: str | int) -> dict[str, Any]:
    """Tear down any loopback mount or project quota for ``server_id`` before deletion."""
    sid = _numeric_server_id(server_id)
    driver = resolve_quota_driver()
    if driver == "none" or not Path(_QUOTA_WRAPPER).is_file():
        return {"ok": True, "removed": False}
    proc = _run_quota_wrapper(["remove", sid], timeout=30)
    return {"ok": proc.returncode == 0, "removed": proc.returncode == 0}


def inspect_quota(server_id: str | int) -> dict[str, Any]:
    sid = _numeric_server_id(server_id)
    root = server_root(sid)
    marker = root / _META_FILENAME
    if not marker.is_file() or marker.is_symlink():
        return {"enforced": False, "driver": resolve_quota_driver(), "limit_mb": None}
    try:
        raw = marker.read_text(encoding="utf-8").strip().splitlines()
        data: dict[str, str] = {}
        for line in raw:
            if "=" in line:
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip()
        return {
            "enforced": data.get("enforced") == "true",
            "driver": data.get("driver") or "none",
            "limit_mb": int(data["limit_mb"]) if data.get("limit_mb", "").isdigit() else None,
        }
    except OSError:
        return {"enforced": False, "driver": "none", "limit_mb": None}


def _write_quota_marker(root: Path, *, driver: str, limit_mb: int, enforced: bool) -> None:
    try:
        marker = root / _META_FILENAME
        if marker.is_symlink():
            return
        marker.write_text(
            f"driver={driver}\nlimit_mb={limit_mb}\nenforced={'true' if enforced else 'false'}\n",
            encoding="utf-8",
        )
    except OSError:
        pass
