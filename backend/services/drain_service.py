"""Graceful-Drain-Steuerung fuer schonende Panel-Updates ohne harte Abbrueche.

Das Flag liegt als kleine JSON-Datei auf Platte, damit Uvicorn-Worker,
``msm-worker.service`` und ``update.sh`` denselben Zustand teilen. Eine
harte TTL (Default 300s, max. 900s) sorgt dafuer, dass ein abgestuerzter Updater
das Panel niemals dauerhaft blockiert (fail-open).
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

DEFAULT_DRAIN_TTL_SECONDS = 300
MAX_DRAIN_TTL_SECONDS = 900
DEFAULT_DRAIN_WAIT_SECONDS = 60


def drain_flag_path() -> Path:
    configured = (os.getenv("MSM_DRAIN_FLAG_FILE") or "").strip()
    if configured:
        return Path(configured)
    return Path(tempfile.gettempdir()) / "msm-panel-draining.json"


def _parse_iso_utc(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def enable_drain(
    *,
    reason: str = "panel_update",
    ttl_seconds: int = DEFAULT_DRAIN_TTL_SECONDS,
) -> dict[str, Any]:
    """Aktiviert den Drain-Modus atomar per Temp-Datei + os.replace."""
    ttl = max(10, min(int(ttl_seconds), MAX_DRAIN_TTL_SECONDS))
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=ttl)
    clean_reason = "".join(ch for ch in str(reason or "panel_update")[:64] if ch.isalnum() or ch in ("_", "-", "."))
    if not clean_reason:
        clean_reason = "panel_update"

    payload: dict[str, Any] = {
        "draining": True,
        "reason": clean_reason,
        "started_at": now.isoformat(),
        "expires_at": expires.isoformat(),
        "ttl_seconds": ttl,
    }
    target = drain_flag_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f".{target.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp_path, target)
    finally:
        tmp_path.unlink(missing_ok=True)
    return payload


def disable_drain() -> dict[str, Any]:
    """Hebt den Drain-Modus wieder auf."""
    drain_flag_path().unlink(missing_ok=True)
    return {"draining": False}


def read_drain_state() -> dict[str, Any] | None:
    """Liest den aktuellen Drain-Status oder None (mit automatischer TTL-Bereinigung)."""
    target = drain_flag_path()
    try:
        if not target.is_file():
            return None
        data = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("draining") is not True:
            return None
        expires = _parse_iso_utc(data.get("expires_at"))
        if expires is None or expires <= datetime.now(timezone.utc):
            return None
        ttl_raw = data.get("ttl_seconds")
        ttl_seconds = int(ttl_raw) if ttl_raw is not None else DEFAULT_DRAIN_TTL_SECONDS
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None

    return {
        "draining": True,
        "reason": str(data.get("reason") or "panel_update"),
        "started_at": data.get("started_at"),
        "expires_at": data.get("expires_at"),
        "ttl_seconds": ttl_seconds,
    }


def is_draining() -> bool:
    return read_drain_state() is not None


def count_active_workloads(db: Session) -> dict[str, int]:
    """Zaehlt aktive KI-Laeufe und laufende Sandbox-/Frontend-Builds."""
    from models import AiRun, FrontendDeployment

    ai_running = int(
        db.query(AiRun.id).filter(AiRun.status == "running").count()
    )
    builds_running = int(
        db.query(FrontendDeployment.id)
        .filter(FrontendDeployment.status.in_(("queued", "building")))
        .count()
    )
    return {
        "active_ai_runs": ai_running,
        "active_frontend_builds": builds_running,
        "active_total": ai_running + builds_running,
    }


def get_drain_status(db: Session) -> dict[str, Any]:
    state = read_drain_state()
    counts = count_active_workloads(db)
    return {
        "draining": state is not None,
        "reason": state["reason"] if state else None,
        "started_at": state["started_at"] if state else None,
        "expires_at": state["expires_at"] if state else None,
        **counts,
    }


def require_not_draining() -> None:
    """Blockiert neue lange Aufgaben waehrend des Graceful Drain mit HTTP 503."""
    if is_draining():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "panel_draining",
                "message": "errors.panel_draining",
            },
            headers={"Retry-After": "5"},
        )
