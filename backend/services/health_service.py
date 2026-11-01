"""Health- und Tiefendiagnosedienst (Hardening WP1.4).

Vertrag:
- /api/health ohne Parameter liefert immer 200 {"status": "ok"} (Kubernetes-Liveness/Readiness-Vertrag).
- /api/health?deep=1 prueft Abhaengigkeiten:
  - Datenbank: SELECT 1 mit 2 s Frist
  - DIS Sidecar: GET /health mit 2 s Frist
  - Festplattenspeicher: mindestens 5 % freier Speicherplatz
  Liefert 200 bei Erfolg, 503 mit status: 'degraded' bei Ausfall einer Kernkomponente oder Speichermangel.
"""

import asyncio
import os
import shutil
from typing import Any, Dict, Tuple
from sqlalchemy import text

from database import engine
from services.dis_client import DisClient


async def _pruefe_datenbank(timeout: float = 2.0) -> Tuple[bool, str]:
    def _db_ping() -> None:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))

    try:
        await asyncio.wait_for(asyncio.to_thread(_db_ping), timeout=timeout)
        return True, "ok"
    except Exception as e:
        return False, f"Fehler: {type(e).__name__}"


async def _pruefe_dis_sidecar(timeout: float = 2.0) -> Tuple[bool, str]:
    try:
        ok = await asyncio.wait_for(asyncio.to_thread(DisClient.health_check, timeout), timeout=timeout)
        return (True, "ok") if ok else (False, "nicht erreichbar")
    except Exception as e:
        return False, f"Fehler: {type(e).__name__}"


def _pruefe_festplatte() -> Tuple[bool, Dict[str, Any]]:
    try:
        # Auf Windows den System-Root-Pfad ermitteln, sonst "/"
        root = os.path.splitdrive(os.path.abspath("."))[0] + os.path.sep if os.name == "nt" else "/"
        usage = shutil.disk_usage(root)
        free_gb = round(usage.free / (1024**3), 2)
        total_gb = round(usage.total / (1024**3), 2)
        free_pct = round((usage.free / usage.total) * 100, 2) if usage.total > 0 else 0.0
        is_ok = free_pct >= 5.0
        return is_ok, {
            "status": "ok" if is_ok else "low_space",
            "free_gb": free_gb,
            "total_gb": total_gb,
            "free_percent": free_pct,
        }
    except Exception as e:
        return True, {"status": "unbekannt", "error": str(e)}


async def pruefe_gesundheit(deep: bool = False) -> Tuple[int, Dict[str, Any]]:
    """Ermittelt den Gesundheitszustand des Backends."""
    if not deep:
        return 200, {"status": "ok"}

    db_ok, db_msg = await _pruefe_datenbank(timeout=2.0)
    dis_ok, dis_msg = await _pruefe_dis_sidecar(timeout=2.0)
    disk_ok, disk_info = _pruefe_festplatte()

    checks = {
        "database": db_msg,
        "dis_sidecar": dis_msg,
        "disk": disk_info,
    }

    if db_ok and dis_ok and disk_ok:
        return 200, {"status": "ok", "checks": checks}
    else:
        return 503, {"status": "degraded", "checks": checks}
