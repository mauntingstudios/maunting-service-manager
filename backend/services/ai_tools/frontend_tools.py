"""KI-Werkzeuge fuer Frontend-Deployments (Lesen und bestaetigungspflichtige Vorschlaege)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from models import FrontendDeployment, Server, User
from services import frontend_deploy_service, permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_tool_spec import ausfuehrung_aus_tabelle, vorschlag_server, werkzeug
from services.ai_tools.base import _function

_FRONTEND_READ = _function(
    "frontend_read",
    "Liest Frontend-Status, aktive Previews, Deployments oder (mit deployment_id) das Build-Log.",
    {
        "server_id": {"type": "integer", "minimum": 1, "description": "ID des Frontend-Servers."},
        "view": {"type": "string", "enum": ["overview", "log"], "description": "overview (Standard) oder log."},
        "branch": {"type": "string", "maxLength": 255, "description": "Optionaler Branch-Filter."},
        "deployment_id": {"type": "integer", "minimum": 1, "description": "Fuer view=log: ID des Deployments."},
    },
    ["server_id"],
)

_PROPOSE_ACTION = _function(
    "propose_frontend_action",
    "Schlaegt eine Frontend-Aktion vor: redeploy, promote, rollback, online oder offline.",
    {
        "server_id": {"type": "integer", "minimum": 1, "description": "ID des Frontend-Servers."},
        "action": {
            "type": "string",
            "enum": ["redeploy", "promote", "rollback", "online", "offline"],
            "description": "Auszufuehrende Frontend-Aktion.",
        },
        "branch": {"type": "string", "maxLength": 255, "description": "Fuer redeploy: optionaler Branch."},
        "deployment_id": {"type": "integer", "minimum": 1, "description": "Fuer promote oder rollback."},
    },
    ["server_id", "action"],
)

_PROPOSE_SETTINGS = _function(
    "propose_frontend_settings",
    "Schlaegt vor, Frontend-Einstellungen (Branch, Auto-Deploy, Previews, Domain) zu aendern.",
    {
        "server_id": {"type": "integer", "minimum": 1, "description": "ID des Frontend-Servers."},
        "production_branch": {"type": "string", "maxLength": 255, "description": "Neuer Produktionsbranch."},
        "auto_deploy": {"type": "boolean", "description": "Bei Push automatisch bauen."},
        "previews_enabled": {"type": "boolean", "description": "Previews fuer andere Branches."},
        "domain": {"type": "string", "maxLength": 255, "description": "Optionale eigene Domain."},
    },
    ["server_id"],
)


def _lesen_frontend(
    db: Session, *, user: User, server: Server, arguments: dict[str, Any]
) -> dict[str, Any]:
    if not permission_service.has_server_permission(db, user, server.id, "server.view"):
        raise AiActionValidationError("Kein Zugriff auf diesen Server")

    view = str(arguments.get("view") or "overview").strip().lower()
    if view == "log":
        dep_id = int(arguments.get("deployment_id") or 0)
        if dep_id <= 0:
            raise AiActionValidationError("deployment_id erforderlich fuer view=log")
        dep = db.get(FrontendDeployment, dep_id)
        if dep is None or dep.server_id != server.id:
            raise AiActionValidationError("Deployment nicht gefunden")
        text = ""
        if dep.log_path and Path(dep.log_path).is_file():
            text = Path(dep.log_path).read_text(encoding="utf-8", errors="replace")[-4000:]
        return {"deployment_id": dep.id, "status": dep.status, "log_tail": text}

    fs = frontend_deploy_service.get_or_create_settings(db, server)
    q = db.query(FrontendDeployment).filter(FrontendDeployment.server_id == server.id)
    branch = arguments.get("branch")
    if branch:
        q = q.filter(FrontendDeployment.branch == str(branch))
    rows = q.order_by(FrontendDeployment.created_at.desc()).limit(20).all()
    return {
        "server_id": server.id,
        "online": fs.online,
        "production_branch": fs.production_branch,
        "auto_deploy": fs.auto_deploy,
        "previews_enabled": fs.previews_enabled,
        "domain": fs.domain,
        "domain_verified": fs.domain_verified,
        "deployments": [
            {
                "id": r.id,
                "kind": r.kind,
                "branch": r.branch,
                "status": r.status,
                "is_live": r.is_live,
                "port": r.port,
                "commit_sha": r.commit_sha[:7] if r.commit_sha else None,
            }
            for r in rows
        ],
    }


DEFINITIONEN = [_FRONTEND_READ, _PROPOSE_ACTION, _PROPOSE_SETTINGS]

werkzeug(
    _FRONTEND_READ,
    art="server_read",
    recht="server.view",
    hinweis="Liest Frontend-Deployments, Previews und Build-Logs.",
    handler=_lesen_frontend,
)
werkzeug(
    _PROPOSE_ACTION,
    art="server_write",
    recht="server.restart",
    hinweis="Fuehrt redeploy, promote, rollback, online oder offline fuer ein Frontend aus.",
    vorschlag=vorschlag_server("propose_frontend_action"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_frontend_action"),
)
werkzeug(
    _PROPOSE_SETTINGS,
    art="server_write",
    recht="server.config.write",
    hinweis="Aendert Frontend-Einstellungen (Branch, Auto-Deploy, Previews, Domain).",
    vorschlag=vorschlag_server("propose_frontend_settings"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_frontend_settings"),
)
