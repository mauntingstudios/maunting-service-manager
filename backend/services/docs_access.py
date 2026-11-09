"""Rollenaufloesung fuer Dokumente.

Eine Stelle, damit REST, Collab-Token und KI-Werkzeuge dieselbe Wahrheit
benutzen. Team-Mitgliedschaft ist die Grundlage; wer das Team verlaesst,
verliert den Zugriff — auch als Dokument-Owner.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.doc import DocMember, Document
from models.team import TeamMember
from models.user import User

logger = logging.getLogger(__name__)


ROLE_RANG: dict[str, int] = {"viewer": 1, "commenter": 2, "editor": 3}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class DocAccess:
    document: Document
    role: str
    can_manage: bool
    via_link: bool = False

    @property
    def can_edit(self) -> bool:
        return self.role == "editor"

    @property
    def can_comment(self) -> bool:
        return ROLE_RANG[self.role] >= ROLE_RANG["commenter"]


def _bester(role_a: str, role_b: str | None) -> str:
    if role_b is None:
        return role_a
    return role_a if ROLE_RANG[role_a] <= ROLE_RANG[role_b] else role_b


def _share_gueltig(doc: Document) -> bool:
    if not doc.share_token_hash or not doc.share_role:
        return False
    expires = _aware(doc.share_expires_at)
    return expires is None or expires > _now()


def resolve_access(
    db: Session, user: User, doc: Document, *, mit_trash: bool = False
) -> DocAccess | None:
    """Effektive Rolle oder ``None``, wenn das Dokument nicht sichtbar ist."""
    return resolve_access_many(db, user, [doc], mit_trash=mit_trash).get(doc.id)


def resolve_access_many(
    db: Session, user: User, docs: list[Document], *, mit_trash: bool = False
) -> dict[int, DocAccess | None]:
    """Wie `resolve_access`, aber gebuendelt ueber viele Dokumente.

    Mitgliedschaften, manuelle Rollen und Link-Rollen je einmal lesen statt
    einmal je Dokument — die Liste lief sonst in N+1 Abfragen (Befund 24).
    Die Einzelpruefung nutzt denselben Weg, damit beide nie auseinanderlaufen.
    """
    if not docs:
        return {}
    jetzt = _now()
    team_ids = {doc.team_id for doc in docs}
    mitglieder = {
        m.team_id: m
        for m in db.query(TeamMember)
        .filter(TeamMember.team_id.in_(team_ids), TeamMember.user_id == user.id)
        .all()
    }
    doc_ids = [doc.id for doc in docs]
    manuell = {
        row.document_id: row
        for row in db.query(DocMember)
        .filter(
            DocMember.document_id.in_(doc_ids),
            DocMember.user_id == user.id,
            DocMember.source == "manual",
        )
        .all()
    }
    links = {
        row.document_id: row
        for row in db.query(DocMember)
        .filter(
            DocMember.document_id.in_(doc_ids),
            DocMember.user_id == user.id,
            DocMember.source == "link",
        )
        .all()
    }
    ergebnis: dict[int, DocAccess | None] = {}
    for doc in docs:
        if doc.deleted_at is not None and not mit_trash:
            ergebnis[doc.id] = None
            continue
        if user.is_owner:
            ergebnis[doc.id] = DocAccess(doc, "editor", True)
            continue
        mitglied = mitglieder.get(doc.team_id)
        if mitglied is not None:
            if mitglied.role == "owner":
                ergebnis[doc.id] = DocAccess(doc, "editor", True)
                continue
            override = manuell.get(doc.id)
            if override is not None:
                role = override.role
            elif doc.owner_user_id == user.id:
                role = "editor"
            else:
                role = doc.default_role if doc.default_role in ROLE_RANG else "editor"
            manage = doc.owner_user_id == user.id and role == "editor"
            ergebnis[doc.id] = DocAccess(doc, role, manage)
            continue
        link = links.get(doc.id)
        if link is not None:
            laeuft_ab = _aware(link.expires_at)
            if (laeuft_ab is None or laeuft_ab > jetzt) and _share_gueltig(doc):
                role = _bester(link.role, doc.share_role)
                ergebnis[doc.id] = DocAccess(doc, role, False, via_link=True)
                continue
        ergebnis[doc.id] = None
    return ergebnis


def access_or_404(
    db: Session, user: User, doc: Document, *, mit_trash: bool = False
) -> DocAccess:
    zugriff = resolve_access(db, user, doc, mit_trash=mit_trash)
    if zugriff is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "DOCUMENT_NOT_FOUND", "message": "Dokument nicht gefunden"},
        )
    return zugriff


def _audit_verweigert(
    db: Session, user: User, doc: Document, mindestens: str, rolle: str
) -> None:
    """Haelt einen verweigerten Dokumentzugriff im Audit fest.

    Die Rollenpruefung steht am Anfang jeder Operation, bevor Daten geschrieben
    werden; der Commit schreibt daher nur die Protokollzeile fest. Der
    Dokumenttitel steht nicht in den Details — nur Kennung, geforderte und
    tatsaechliche Rolle.
    """
    try:
        from services import audit_service

        audit_service.record_privileged_action(
            db,
            user_id=user.id,
            action="docs.access.denied",
            target_type="document",
            target_id=doc.doc_uid,
            details={"mindestens": mindestens, "rolle": rolle},
            origin="direct",
            commit=True,
        )
    except Exception:
        db.rollback()
        logger.exception("Verweigerter Dokumentzugriff konnte nicht protokolliert werden")


def require_role(
    db: Session, user: User, doc: Document, mindestens: str
) -> DocAccess:
    zugriff = access_or_404(db, user, doc)
    if ROLE_RANG[zugriff.role] < ROLE_RANG[mindestens]:
        code = "DOCS_READ_ONLY" if mindestens != "viewer" else "DOCS_FORBIDDEN"
        _audit_verweigert(db, user, doc, mindestens, zugriff.role)
        raise HTTPException(
            status_code=403,
            detail={"code": code, "message": "Dafuer fehlt die Dokumentrolle"},
        )
    return zugriff


def require_manage(
    db: Session, user: User, doc: Document, *, mit_trash: bool = False
) -> DocAccess:
    zugriff = access_or_404(db, user, doc, mit_trash=mit_trash)
    if not zugriff.can_manage:
        _audit_verweigert(db, user, doc, "manage", zugriff.role)
        raise HTTPException(
            status_code=403,
            detail={"code": "DOCS_FORBIDDEN", "message": "Nur die Verwaltung darf das"},
        )
    return zugriff
