"""Server-Geschichte lesen: Backups, Guardian-Vorfaelle, eigene KI-Aktionen.

Drei Lesewerkzeuge, die denselben Zweck teilen: zeigen, was auf diesem Server
schon passiert ist. Die Handler standen in der langen Kette in `server_tools`.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Server, User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import (
    MAX_LISTED_ACTIONS,
    MAX_LISTED_BACKUPS,
    MAX_LISTED_INCIDENTS,
    _require_no_arguments,
    _server_function,
    _vorfall_versuche,
)

_BACKUPS = _server_function(
    "read_server_backups",
    "Liest die vorhandenen Backups mit Groesse und Zeitpunkt.",
)
_INCIDENTS = _server_function(
    "read_guardian_incidents",
    "Liest die zuletzt erkannten Guardian-Vorfaelle dieses Servers.",
)
_ACTIONS = _server_function(
    "read_ai_action_history",
    "Liest die vom aktuellen Benutzer frueher vorgeschlagenen und "
    "ausgefuehrten KI-Aktionen dieses Servers.",
)

BACKUP_DEFINITIONEN = [_BACKUPS]
HISTORY_DEFINITIONEN = [_INCIDENTS, _ACTIONS]


def lies_backups(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    _require_no_arguments("read_server_backups", arguments)
    if not permission_service.has_server_permission(db, user, server.id, "server.backups.read"):
        raise AiActionValidationError("Backup-Lesezugriff ist nicht erlaubt")
    from models import Backup

    rows = (
        db.query(Backup)
        .filter(Backup.server_id == server.id)
        .order_by(Backup.created_at.desc())
        .limit(MAX_LISTED_BACKUPS)
        .all()
    )
    return {
        "server_id": server.id,
        "backups": [
            {
                "id": row.id,
                # Der Name ist frei vom Benutzer gesetzt und wird redigiert.
                "name": redact_sensitive_text(str(row.name or ""))[:128],
                "size_mb": row.size_mb,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


def lies_vorfaelle(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    _require_no_arguments("read_guardian_incidents", arguments)
    from services.ai_guardian_settings import is_guardian_ai_enabled

    if not is_guardian_ai_enabled():
        raise AiActionValidationError("Die Guardian-KI-Integration ist deaktiviert.")

    from models import Incident

    rows = (
        db.query(Incident)
        .filter(Incident.server_id == server.id)
        .order_by(Incident.created_at.desc())
        .limit(MAX_LISTED_INCIDENTS)
        .all()
    )
    return {
        "server_id": server.id,
        "incidents": [
            {
                # Ohne Kennung konnte das Modell einen Vorfall nicht benennen,
                # auf den es sich bezieht — weder in seiner Antwort noch in der
                # Begruendung eines Vorschlags.
                "id": row.id,
                "type": row.type,
                "status": row.status,
                "title": redact_sensitive_text(str(row.title))[:128],
                # Guardian-Beschreibungen enthalten Ausschnitte aus Logs.
                "description": redact_sensitive_text(str(row.description))[:512],
                "occurrences": row.occurrences,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
                # Was die Guardian-Engine selbst schon versucht hat. Ohne das
                # faengt die KI bei jedem Vorfall mit einem Neustart an.
                "attempts": _vorfall_versuche(row.attempts),
            }
            for row in rows
        ],
    }


def lies_eigene_aktionen(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    _require_no_arguments("read_ai_action_history", arguments)
    from models import AiActionProposal

    rows = (
        db.query(AiActionProposal)
        .filter(
            AiActionProposal.server_id == server.id,
            # Nur die eigenen: das Werkzeug haengt an `server.view`, und ein
            # Gast auf einem geteilten Server erfuehre sonst, dass ein anderer
            # Benutzer hier `propose_server_delete` versucht hat.
            AiActionProposal.user_id == user.id,
        )
        .order_by(AiActionProposal.created_at.desc())
        .limit(MAX_LISTED_ACTIONS)
        .all()
    )
    return {
        "server_id": server.id,
        "actions": [
            {
                # Kein Payload und kein Diff: die Historie soll zeigen, was
                # passiert ist, nicht frueheren Configinhalt erneut ausgeben.
                "tool": row.tool_name,
                "status": row.status,
                "autonomous": bool(row.autonomous),
                "error_code": row.error_code,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


werkzeug(
    _BACKUPS,
    art="server_read",
    angebot=("server.backups.read",),
    hinweis="Listet vorhandene Backups mit Groesse und Zeitpunkt.",
    handler=lies_backups,
)
werkzeug(
    _INCIDENTS,
    art="server_read",
    hinweis="Listet die zuletzt erkannten Guardian-Vorfaelle des Servers.",
    handler=lies_vorfaelle,
)
werkzeug(
    _ACTIONS,
    art="server_read",
    hinweis="Listet die eigenen frueheren KI-Aktionen auf diesem Server.",
    handler=lies_eigene_aktionen,
)
