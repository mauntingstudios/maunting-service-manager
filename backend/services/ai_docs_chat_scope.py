"""Ein Fenster je (Benutzer, Dokument) — fuer alle KI-Endpunkte.

Der Dokument-Chat ist derselbe Chat wie der Dauerchat, nur mit einem anderen
Fenster. Diese Datei ist die eine Stelle, die dafuer Rechte, Modulstatus und
Dokumentzugriff prueft; die Endpunkte rufen sie nur noch auf.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import User
from models.doc import Document
from services import docs_access, permission_service, team_service
from services.ai_chat_service import get_or_create_docs_conversation
from services.docs_service import DocsService


def resolve(
    db: Session, user: User, document_uid: str
) -> tuple[object, Document, int | None]:
    """Liefert (Unterhaltung, Dokument, Team-ID) oder wirft 403/404.

    Die Team-ID ist ``None`` fuer Link-Gaeste und persoenliche Dokumente:
    Beide haben kein Teamwissen, das die KI lesen duerfte.
    """
    from services.docs_collab_service import DocsCollabService

    if not DocsCollabService.module_enabled():
        raise HTTPException(status_code=403, detail="Das Dokumente-Modul ist deaktiviert")
    if not permission_service.has_global_permission(db, user, "docs.use"):
        raise HTTPException(status_code=403, detail="Dokumente sind nicht freigegeben")
    if not permission_service.has_global_permission(db, user, "ai.docs.use"):
        raise HTTPException(
            status_code=403, detail="Singra ist fuer Dokumente nicht freigegeben"
        )
    zugriff = DocsService.access(db, user, document_uid)
    conversation = get_or_create_docs_conversation(db, user, zugriff.document.id)
    db.commit()
    # Ein Link-Gast darf das Dokument bearbeiten, ist aber kein Teammitglied.
    # Team-Gedaechtnis, Team-Skills, Team-Notizen und Team-Kalender bleiben
    # ihm verschlossen; die Dokumentwerkzeuge selbst brauchen kein Team.
    # Das persoenliche Team ist kein Teambereich: Was dort liegt, ist
    # persoenlich und darf nicht als Teamwissen im Dokument auftauchen.
    from models.team import Team

    team = db.get(Team, zugriff.document.team_id)
    team_mitglied = (
        team is not None
        and not team.is_personal
        and team_service.membership(db, team.id, user.id) is not None
    )
    return (
        conversation,
        zugriff.document,
        zugriff.document.team_id if team_mitglied else None,
    )
