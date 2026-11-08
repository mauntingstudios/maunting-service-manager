"""Auto-Pause Worker für inaktive Singra Dev-Umgebungen.

Pausiert Dev-Umgebungen nach 60 Minuten Inaktivität automatisch zur Ressourcenschonung.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from models.ai_project import AiProject
from models.server import Server
from services import ai_project_service

logger = logging.getLogger(__name__)

DEFAULT_MAX_IDLE_MINUTES = 60


def check_and_pause_idle_dev_environments(
    db: Session,
    max_idle_minutes: int = DEFAULT_MAX_IDLE_MINUTES,
) -> list[str]:
    """Prüft alle Projekte auf inaktive Dev-Umgebungen und pausiert diese nach Ablauf des Timeouts."""
    now = datetime.now(timezone.utc)
    paused_projects: list[str] = []

    projects = db.query(AiProject).all()
    for proj in projects:
        try:
            ws = ai_project_service.ensure_project_workspace(proj)
            if not ai_project_service._env_meta_path(ws).exists():
                continue
            meta = ai_project_service._load_env_metadata(ws)

            dev_status = meta.get("dev_status")
            if dev_status != "running":
                continue

            last_active = meta.get("dev_last_active_at")
            if not last_active:
                # Kein Zeitstempel vorhanden -> setze auf jetzt, um sofortige Pause zu vermeiden
                meta["dev_last_active_at"] = now.isoformat()
                ai_project_service._save_env_metadata(ws, meta)
                continue

            dt = datetime.fromisoformat(last_active)
            idle_seconds = (now - dt).total_seconds()
            if idle_seconds > (max_idle_minutes * 60):
                logger.info(
                    "Dev-Umgebung fuer Projekt %s (%s) seit %.1f Minuten inaktiv — wird pausiert.",
                    proj.id,
                    proj.name,
                    idle_seconds / 60.0,
                )

                # Server stoppen
                be_id = meta.get("dev_backend_server_id")
                if be_id and str(be_id).isdigit():
                    be_srv = db.get(Server, int(be_id))
                    if be_srv:
                        be_srv.status = "stopped"
                        be_srv.desired_power_state = "stopped"

                fe_id = meta.get("dev_frontend_server_id")
                if fe_id and str(fe_id).isdigit():
                    fe_srv = db.get(Server, int(fe_id))
                    if fe_srv:
                        fe_srv.status = "stopped"
                        fe_srv.desired_power_state = "stopped"

                meta["dev_status"] = "paused_idle"
                meta["dev_paused_at"] = now.isoformat()
                ai_project_service._save_env_metadata(ws, meta)
                paused_projects.append(proj.id)
        except Exception as exc:
            logger.warning("Fehler beim Prüfen von Projekt %s auf Dev-Inaktivität: %s", proj.id, exc)

    if paused_projects:
        db.commit()

    return paused_projects
