"""Minecraft-Versionskatalog (6h-Cache) und sicherer Versionswechsel mit Welt-Schutz."""

from __future__ import annotations

from datetime import datetime, timezone
import logging
import os
import re
import shutil
import threading
import time
from typing import Any, Literal

from fastapi import HTTPException
import httpx
from sqlalchemy.orm import Session

from models import Server
from services import (
    audit_service,
    docker_service,
    server_file_access_service,
    server_lifecycle_service,
    server_runtime_env,
)
from services.node_client import NodeClientError

logger = logging.getLogger(__name__)

MINECRAFT_VERSION_RE = re.compile(
    r"^(LATEST|SNAPSHOT|[0-9]{1,2}\.[0-9]{1,3}(?:\.[0-9]{1,3})?(?:-[a-zA-Z0-9._-]+)?)$"
)
_WORLD_DIRS = ("world", "world_nether", "world_the_end")
_CACHE_TTL_SECONDS = 6 * 3600
_API_TIMEOUT_SECONDS = 6.0

_CACHE_LOCK = threading.Lock()
_VERSION_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}

_FALLBACK_RELEASES: list[dict[str, Any]] = [
    {"version": "1.21.4", "release_type": "release", "published_at": None},
    {"version": "1.21.3", "release_type": "release", "published_at": None},
    {"version": "1.21.1", "release_type": "release", "published_at": None},
    {"version": "1.20.6", "release_type": "release", "published_at": None},
    {"version": "1.20.4", "release_type": "release", "published_at": None},
    {"version": "1.20.1", "release_type": "release", "published_at": None},
    {"version": "1.19.4", "release_type": "release", "published_at": None},
    {"version": "1.18.2", "release_type": "release", "published_at": None},
    {"version": "1.16.5", "release_type": "release", "published_at": None},
    {"version": "1.12.2", "release_type": "release", "published_at": None},
    {"version": "1.8.8", "release_type": "release", "published_at": None},
]


def clear_cache_for_tests() -> None:
    with _CACHE_LOCK:
        _VERSION_CACHE.clear()


def _parse_semver(version: str) -> tuple[int, int, int, int] | None:
    raw = (version or "").strip()
    if not raw or raw.upper() in ("LATEST", "SNAPSHOT"):
        return None
    m = re.match(r"^(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?$", raw)
    if not m:
        return None
    major = int(m.group(1))
    minor = int(m.group(2))
    patch = int(m.group(3) or 0)
    pre = 0 if m.group(4) else 1
    return (major, minor, patch, pre)


def classify_version_change(
    current_version: str, target_version: str
) -> Literal["upgrade", "same", "downgrade", "latest"]:
    cur = (current_version or "").strip()
    tgt = (target_version or "").strip()
    if tgt.upper() in ("LATEST", "SNAPSHOT"):
        if cur.upper() == tgt.upper():
            return "same"
        return "latest"
    if cur == tgt:
        return "same"
    cur_parsed = _parse_semver(cur)
    tgt_parsed = _parse_semver(tgt)
    if cur_parsed is None or tgt_parsed is None:
        return "upgrade"
    if tgt_parsed > cur_parsed:
        return "upgrade"
    if tgt_parsed < cur_parsed:
        return "downgrade"
    return "same"


def _fetch_mojang_versions() -> list[dict[str, Any]]:
    url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
    with httpx.Client(timeout=_API_TIMEOUT_SECONDS, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
    out: list[dict[str, Any]] = []
    for entry in (data.get("versions") or [])[:120]:
        vid = str(entry.get("id") or "").strip()
        if not vid:
            continue
        raw_type = str(entry.get("type") or "release").lower()
        rel_type: Literal["release", "snapshot"] = (
            "release" if raw_type == "release" else "snapshot"
        )
        if not MINECRAFT_VERSION_RE.fullmatch(vid) and rel_type == "release":
            continue
        out.append(
            {
                "version": vid,
                "release_type": rel_type,
                "published_at": entry.get("releaseTime"),
            }
        )
    return out


def _fetch_papermc_versions() -> list[dict[str, Any]]:
    url = "https://api.papermc.io/v2/projects/paper"
    with httpx.Client(timeout=_API_TIMEOUT_SECONDS, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
    versions = [str(v).strip() for v in (data.get("versions") or []) if str(v).strip()]
    out: list[dict[str, Any]] = []
    for v in reversed(versions):
        rel_type: Literal["release", "snapshot"] = (
            "snapshot" if "-" in v else "release"
        )
        out.append({"version": v, "release_type": rel_type, "published_at": None})
    return out


def _fetch_purpur_versions() -> list[dict[str, Any]]:
    url = "https://api.purpurmc.org/v2/purpur"
    with httpx.Client(timeout=_API_TIMEOUT_SECONDS, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
    versions = [str(v).strip() for v in (data.get("versions") or []) if str(v).strip()]
    out: list[dict[str, Any]] = []
    for v in reversed(versions):
        rel_type: Literal["release", "snapshot"] = (
            "snapshot" if "-" in v else "release"
        )
        out.append({"version": v, "release_type": rel_type, "published_at": None})
    return out


def _fetch_fabric_versions() -> list[dict[str, Any]]:
    url = "https://meta.fabricmc.net/v2/versions/game"
    with httpx.Client(timeout=_API_TIMEOUT_SECONDS, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
    out: list[dict[str, Any]] = []
    for entry in (data or [])[:120]:
        vid = str(entry.get("version") or "").strip()
        if not vid:
            continue
        rel_type: Literal["release", "snapshot"] = (
            "release" if bool(entry.get("stable")) else "snapshot"
        )
        out.append({"version": vid, "release_type": rel_type, "published_at": None})
    return out


def fetch_provider_versions(provider: str) -> list[dict[str, Any]]:
    """Liefert gecachte Minecraft-Versionen fuer einen Edition-Provider (TTL 6h)."""
    key = (provider or "mojang").strip().lower()
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _VERSION_CACHE.get(key)
        if cached is not None and (now - cached[0]) < _CACHE_TTL_SECONDS:
            return list(cached[1])

    rows: list[dict[str, Any]] = []
    try:
        if key == "papermc":
            rows = _fetch_papermc_versions()
        elif key == "purpurmc":
            rows = _fetch_purpur_versions()
        elif key == "fabric":
            rows = _fetch_fabric_versions()
        else:
            rows = _fetch_mojang_versions()
    except Exception as exc:
        logger.warning("Minecraft-Versionsabruf fuer '%s' fehlgeschlagen: %s", key, exc)
        rows = []

    if not rows:
        rows = list(_FALLBACK_RELEASES)

    with _CACHE_LOCK:
        _VERSION_CACHE[key] = (now, rows)
    return list(rows)


def _require_minecraft_versioning(server: Server):
    from blueprints import get_registry

    entry = get_registry().get(server.game_type)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "blueprint_not_found", "message": "Blueprint nicht gefunden."},
        )
    bp = entry.blueprint
    versioning = getattr(bp.meta, "versioning", None)
    if versioning is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "not_a_minecraft_server",
                "message": "Dieser Server unterstuetzt keinen Minecraft-Versionswechsel.",
            },
        )
    return bp, versioning


def list_minecraft_versions(
    db: Session,
    server: Server,
    *,
    include_snapshots: bool = False,
    user_id: int | None = None,
) -> dict[str, Any]:
    bp, versioning = _require_minecraft_versioning(server)
    env_key = getattr(versioning, "envKey", "VERSION") or "VERSION"
    provider = getattr(versioning, "provider", "mojang") or "mojang"

    env = server_runtime_env.get_runtime_env(server.id, db=db)
    default_version = str((getattr(bp.runtime, "env", None) or {}).get(env_key, "LATEST"))
    current_version = (env.get(env_key) or default_version or "LATEST").strip()

    raw_rows = fetch_provider_versions(provider)
    items: list[dict[str, Any]] = [
        {
            "version": "LATEST",
            "release_type": "latest",
            "published_at": None,
            "relation": classify_version_change(current_version, "LATEST"),
        }
    ]
    seen = {"LATEST"}
    for row in raw_rows:
        vid = str(row["version"])
        rel_type = row.get("release_type", "release")
        if rel_type == "snapshot" and not include_snapshots:
            continue
        if vid in seen:
            continue
        seen.add(vid)
        items.append(
            {
                "version": vid,
                "release_type": rel_type,
                "published_at": row.get("published_at"),
                "relation": classify_version_change(current_version, vid),
            }
        )

    switch_meta = server_lifecycle_service.get_switch_options(db, server, user_id=user_id)
    switch_by_id = {opt["id"]: opt for opt in switch_meta["options"]}

    from blueprints import get_registry

    editions: list[dict[str, Any]] = []
    seen_editions: set[str] = set()
    for bp_entry in get_registry().list():
        bp_id = bp_entry.blueprint.meta.id
        if bp_id in seen_editions:
            continue
        seen_editions.add(bp_id)
        bp_ver = getattr(bp_entry.blueprint.meta, "versioning", None)
        if bp_ver is None:
            continue
        opt = switch_by_id.get(bp_id)
        if switch_meta["mode"] == "shop_customer" and opt is None:
            continue
        editions.append(
            {
                "id": bp_id,
                "name": bp_entry.blueprint.meta.name,
                "provider": bp_ver.provider,
                "is_current": bp_id == server.game_type,
                "selectable": opt["selectable"] if opt is not None else (bp_id != server.game_type),
                "blocked_reason": opt["blocked_reason"] if opt is not None else ("current" if bp_id == server.game_type else None),
            }
        )
    editions.sort(key=lambda e: (not e["is_current"], e["name"].lower()))

    return {
        "provider": provider,
        "env_key": env_key,
        "current_version": current_version,
        "supports_downgrade_warning": bool(getattr(versioning, "supportsDowngradeWarning", True)),
        "is_shop_customer": switch_meta["mode"] == "shop_customer",
        "versions": items,
        "editions": editions,
    }


def _wipe_minecraft_world_dirs(db: Session, server: Server) -> list[str]:
    removed: list[str] = []
    agent = server_file_access_service._agent(server, db)
    if agent is not None:
        server_key = server_file_access_service._agent_key(server)
        for folder in _WORLD_DIRS:
            try:
                agent.files_delete(server_key, folder)
                removed.append(folder)
            except NodeClientError as exc:
                if exc.status_code == 404:
                    continue
                raise HTTPException(
                    status_code=503,
                    detail={
                        "code": "world_reset_failed",
                        "message": exc.message or f"Weltordner '{folder}' konnte auf dem Node-Agenten nicht geloescht werden.",
                    },
                ) from exc
        return removed

    install_dir = (server.install_dir or "").strip()
    if not install_dir or not os.path.isdir(install_dir):
        return removed

    for folder in _WORLD_DIRS:
        target = server_file_access_service.safe_path(install_dir, folder)
        if not target.exists():
            continue
        try:
            shutil.rmtree(target)
            removed.append(folder)
        except PermissionError:
            docker_service.repair_bind_mount_permissions(install_dir)
            shutil.rmtree(target)
            removed.append(folder)
    return removed


def switch_minecraft_version(
    db: Session,
    server: Server,
    target_version: str,
    *,
    reset_world: bool = False,
    confirm_downgrade_keep_world: bool = False,
    user_id: int | None = None,
) -> dict[str, Any]:
    """Wechselt die Minecraft-Version inkl. Pflicht-Backup und optionalem Welt-Reset bei Downgrade."""
    if server.status != "stopped":
        raise HTTPException(
            status_code=400,
            detail={
                "code": "server_must_be_stopped",
                "message": "Der Server muss gestoppt sein, um die Minecraft-Version zu wechseln.",
            },
        )

    bp, versioning = _require_minecraft_versioning(server)
    env_key = getattr(versioning, "envKey", "VERSION") or "VERSION"

    target_clean = (target_version or "").strip()
    if not MINECRAFT_VERSION_RE.fullmatch(target_clean):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_version",
                "message": "Ungueltige Minecraft-Versionsnummer.",
            },
        )

    env = server_runtime_env.get_runtime_env(server.id, db=db)
    default_version = str((getattr(bp.runtime, "env", None) or {}).get(env_key, "LATEST"))
    current_version = (env.get(env_key) or default_version or "LATEST").strip()
    relation = classify_version_change(current_version, target_clean)

    if (
        relation == "downgrade"
        and bool(getattr(versioning, "supportsDowngradeWarning", True))
        and not reset_world
        and not confirm_downgrade_keep_world
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "downgrade_confirmation_required",
                "message": (
                    "Beim Downgrade blockiert Minecraft bestehende Welten haeufig "
                    "('world was created in a different version'). Bitte Welt-Reset "
                    "waehlen oder das Behalten der Welt explizit bestaetigen."
                ),
            },
        )

    from services.backup_orchestrator import create_server_backup

    try:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        backup_record = create_server_backup(
            server.id,
            db,
            name=f"pre-mc-{target_clean}-{ts}",
            timeout_seconds=600,
        )
        if backup_record is None or backup_record.verified_at is None:
            raise RuntimeError("Backup ist nicht nachweisbar erfolgreich.")
    except Exception as exc:
        logger.error("Pre-MC-Version Backup fuer Server ID=%s fehlgeschlagen: %s", server.id, exc)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "pre_switch_backup_failed",
                "message": f"Pflicht-Backup vor Versionswechsel fehlgeschlagen: {exc}",
            },
        )

    worlds_removed: list[str] = []
    if reset_world:
        worlds_removed = _wipe_minecraft_world_dirs(db, server)

    next_env = {**env, env_key: target_clean}
    server_runtime_env.set_runtime_env(
        server.id,
        next_env,
        db=db,
        managed_by="version_switcher",
        commit=False,
    )

    audit_service.record_privileged_action(
        db,
        user_id=user_id,
        action="server.minecraft_version.switch",
        target_type="server",
        target_id=server.id,
        details={
            "old_version": current_version,
            "target_version": target_clean,
            "relation": relation,
            "reset_world": reset_world,
            "worlds_removed": worlds_removed,
            "backup_id": getattr(backup_record, "id", None),
        },
    )
    db.commit()
    db.refresh(server)

    server_lifecycle_service.sync_desired_state_to_agent(db, server)
    return {
        "message": f"Minecraft-Version auf '{target_clean}' umgestellt.",
        "server_id": server.id,
        "old_version": current_version,
        "target_version": target_clean,
        "relation": relation,
        "reset_world": reset_world,
        "worlds_removed": worlds_removed,
        "backup_id": getattr(backup_record, "id", None),
        "status": server.status,
    }
