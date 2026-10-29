"""Rollenaufloesung fuer Dokumente.

Eine Stelle, damit REST, Collab-Token und KI-Werkzeuge dieselbe Wahrheit
benutzen. Team-Mitgliedschaft ist die Grundlage; wer das Team verlaesst,
verliert den Zugriff — auch als Dokument-Owner.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.doc import DocMember, Document
from models.user import User
from services import team_service


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


def _manual_override(db: Session, doc_id: int, user_id: int) -> DocMember | None:
    return (
        db.query(DocMember)
        .filter(
            DocMember.document_id == doc_id,
            DocMember.user_id == user_id,
            DocMember.source == "manual",
        )
        .first()
    )


def _link_member(db: Session, doc_id: int, user_id: int) -> DocMember | None:
    row = (
        db.query(DocMember)
        .filter(
            DocMember.document_id == doc_id,
            DocMember.user_id == user_id,
            DocMember.source == "link",
        )
        .first()
    )
    if row is None:
        return None
    expires = _aware(row.expires_at)
    if expires is not None and expires <= _now():
        return None
    return row


def _share_gueltig(doc: Document) -> bool:
    if not doc.share_token_hash or not doc.share_role:
        return False
    expires = _aware(doc.share_expires_at)
    return expires is None or expires > _now()


def resolve_access(
    db: Session, user: User, doc: Document, *, mit_trash: bool = False
) -> DocAccess | None:
    """Effektive Rolle oder ``None``, wenn das Dokument nicht sichtbar ist."""
    if doc.deleted_at is not None and not mit_trash:
        return None

    if user.is_owner:
        return DocAccess(doc, "editor", True)

    mitglied = team_service.membership(db, doc.team_id, user.id)
    if mitglied is not None:
        if mitglied.role == "owner":
            return DocAccess(doc, "editor", True)
        override = _manual_override(db, doc.id, user.id)
        if override is not None:
            role = override.role
        elif doc.owner_user_id == user.id:
            role = "editor"
        else:
            role = doc.default_role if doc.default_role in ROLE_RANG else "editor"
        manage = doc.owner_user_id == user.id and role == "editor"
        return DocAccess(doc, role, manage)

    link = _link_member(db, doc.id, user.id)
    if link is not None and _share_gueltig(doc):
        role = _bester(link.role, doc.share_role)
        return DocAccess(doc, role, False, via_link=True)

    return None


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


def require_role(
    db: Session, user: User, doc: Document, mindestens: str
) -> DocAccess:
    zugriff = access_or_404(db, user, doc)
    if ROLE_RANG[zugriff.role] < ROLE_RANG[mindestens]:
        code = "DOCS_READ_ONLY" if mindestens != "viewer" else "DOCS_FORBIDDEN"
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
        raise HTTPException(
            status_code=403,
            detail={"code": "DOCS_FORBIDDEN", "message": "Nur die Verwaltung darf das"},
        )
    return zugriff
