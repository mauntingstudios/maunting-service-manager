"""Gemeinsame Abhängigkeiten der Social-Router."""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models import User
from services import permission_service
from services.social_service import SocialService


def _check_social_enabled(db: Session = Depends(get_db)) -> None:
    """Betreiber-Toggle vor öffentlichen bzw. geteilten Social-Endpunkten."""
    SocialService.assert_social_enabled(db)


def _require_messenger_access(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Prüft Betreiber-Toggle und das globale Recht ``messenger.use``."""
    SocialService.assert_social_enabled(db)
    if not permission_service.has_global_permission(db, user, "messenger.use"):
        raise HTTPException(
            status_code=403,
            detail="Sie haben keine Berechtigung für den Messenger (messenger.use).",
        )


def mailbox_token(
    x_mailbox_token: str | None = Header(default=None, alias="X-Mailbox-Token"),
) -> str | None:
    """Der Besitznachweis, den der Client zu einer Mailbox mitschickt.

    Als Kopfzeile, nicht als Abfrageparameter: was in der Adresse steht, steht
    im Zugriffsprotokoll des Webservers und in jedem Zwischenspeicher davor.
    Ein Nachweis, der dort landet, ist keiner mehr.

    Fehlt er, ist das für sich kein Fehler — für Mailboxen ohne hinterlegten
    Nachweis ändert sich nichts. Erst `assert_mailbox_token` entscheidet, ob
    an dieser Stelle einer nötig gewesen wäre.
    """
    return x_mailbox_token
