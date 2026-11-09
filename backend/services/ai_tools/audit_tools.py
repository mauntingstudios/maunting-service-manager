"""Das Audit-Protokoll lesen: Lage und gezielte Suche.

Die beiden Werkzeuge beantworten zwei verschiedene Fragen. `read_audit_summary`
sagt, **wie es steht** (was geschah in den letzten Tagen, was davon
sicherheitsrelevant, was fehlgeschlagen). `search_audit_log` sagt, **was genau**
geschah — zu einem Server, einem Benutzer, einer Aktion oder einem Zeitraum.

Der Anlass ist ein Betriebsfall: „ein Server hat Probleme“ ist ohne das Protokoll
eine halbe Diagnose. Der Serverzustand sagt, **dass** etwas klemmt; das Audit
sagt, wer zuletzt etwas geaendert, gestartet, geloescht oder vergeblich versucht
hat. Beides zusammen ist die Geschichte, und die braucht die KI, bevor sie eine
Ursache behauptet.

Beide Werkzeuge verlangen `system.audit.read` — dasselbe Recht wie die
Panel-Seite. Wer es nicht hat, bekommt einen benannten Fehlschlag, keine leere
Liste; sonst behauptet das Modell hinterher, es habe nachgesehen.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import User
from services import audit_service, permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import _function

_SUMMARY = _function(
    "read_audit_summary",
    "Liest die Lage des Audit-Protokolls: Eintraege, aktive Benutzer, "
    "sicherheitsrelevante und fehlgeschlagene Aktionen, Verteilung nach "
    "Kategorie. Zuerst bei Serverproblemen.",
    {
        "days": {
            "type": "integer",
            "minimum": 1,
            "maximum": 90,
            "description": "Zeitraum in Tagen. Standard 7.",
        },
    },
    [],
)

_SEARCH = _function(
    "search_audit_log",
    "Durchsucht das Audit-Protokoll nach Aktion, Ziel, Benutzer, Zeitraum, "
    "Ergebnis oder Freitext. Zeigt, wer einen Server zuletzt aenderte, "
    "startete oder loeschte und ob ein Versuch scheiterte. Nenne Befunde mit "
    "Zeitpunkt und Aktion; rate keine Ursache aus einem Eintrag.",
    {
        "query": {
            "type": "string",
            "maxLength": 120,
            "description": "Freitext.",
        },
        "category": {
            "type": "string",
            "enum": list(audit_service.AUDIT_KATEGORIEN),
            "description": "Kategorie des Eintrags.",
        },
        "result": {
            "type": "string",
            "enum": ["success", "failed"],
        },
        "origin": {
            "type": "string",
            "enum": ["direct", "ai", "external", "system"],
        },
        "target_type": {"type": "string", "maxLength": 64},
        "target_id": {"type": "string", "maxLength": 64},
        "user_id": {"type": "integer", "minimum": 1},
        "days": {
            "type": "integer",
            "minimum": 1,
            "maximum": 90,
            "description": "Zeitraum in Tagen. Standard 7.",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 50,
        },
    },
    [],
)

DEFINITIONEN = [_SUMMARY, _SEARCH]


def _pruefe_recht(db: Session, user: User) -> None:
    if not permission_service.has_global_permission(db, user, "system.audit.read"):
        raise AiActionValidationError("Audit-Einsicht ist nicht erlaubt")


def _tage(arguments: dict, standard: int = 7) -> int:
    try:
        wert = int(arguments.get("days", standard))
    except (TypeError, ValueError):
        wert = standard
    return min(max(wert, 1), 90)


def lies_uebersicht(
    db: Session,
    *,
    user: User,
    arguments: dict,
    lauf: dict | None = None,
) -> dict:
    _pruefe_recht(db, user)
    return audit_service.audit_uebersicht(db, tage=_tage(arguments))


def suche_protokoll(
    db: Session,
    *,
    user: User,
    arguments: dict,
    lauf: dict | None = None,
) -> dict:
    _pruefe_recht(db, user)
    try:
        limit = int(arguments.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    limit = min(max(limit, 1), 50)
    tage = _tage(arguments)

    kategorie = arguments.get("category")
    if kategorie is not None and kategorie not in audit_service.AUDIT_KATEGORIEN:
        raise AiActionValidationError("Unbekannte Audit-Kategorie.")

    user_id = arguments.get("user_id")
    if user_id is not None:
        try:
            user_id = int(user_id)
        except (TypeError, ValueError) as exc:
            raise AiActionValidationError("Ungueltige Benutzerkennung.") from exc

    rows, gesamt = audit_service.suche_audit_logs(
        db,
        limit=limit,
        tage=tage,
        search=str(arguments.get("query") or "").strip() or None,
        kategorie=kategorie,
        result=arguments.get("result"),
        origin=arguments.get("origin"),
        target_type=arguments.get("target_type"),
        target_id=arguments.get("target_id"),
        user_id=user_id,
    )

    return {
        "range_days": tage,
        "total": gesamt,
        "returned": len(rows),
        "entries": audit_service.audit_zeilen(db, rows),
    }


werkzeug(
    _SUMMARY,
    art="global_read",
    gruppe="audit",
    angebot=("system.audit.read",),
    hinweis="Liest die Lage des Audit-Protokolls (Kennzahlen, Kategorien, Fehlschlaege).",
    global_handler=lies_uebersicht,
)
werkzeug(
    _SEARCH,
    art="global_read",
    gruppe="audit",
    angebot=("system.audit.read",),
    hinweis="Durchsucht das Audit-Protokoll nach Server, Benutzer, Aktion und Zeitraum.",
    global_handler=suche_protokoll,
)
