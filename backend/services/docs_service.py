"""Fachlogik des Dokumente-Moduls.

Der Router bleibt duenn; hier liegen Rollen, Quoten, Verschluesselung und
Ereignisse. Rollen kommen ausschliesslich aus ``docs_access``.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import secrets
import uuid

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from config import settings
from models.doc import (
    DOC_ROLES,
    DocAsset,
    DocComment,
    DocFolder,
    DocMember,
    DocRevision,
    Document,
)
from models.team import TeamMember
from models.user import User
from services import docs_access, team_service
from services.docs_access import ROLE_RANG, DocAccess
from services.dis_client import DisSidecarError
from services.docs_crypto import (
    DocCryptoError,
    aad_asset,
    aad_comment,
    aad_folder,
    aad_revision,
    aad_text,
    aad_title,
    decrypt_blob,
    decrypt_state,
    decrypt_text,
    encrypt_blob,
    encrypt_state,
    encrypt_text,
    sha256_hex,
)
from services.sync_event_service import SyncEventService


MAX_DOCUMENTS_PER_TEAM = 2000
MAX_FOLDER_TIEFE = 20
MAX_TITLE = 200
MAX_ASSETS_PER_DOC = 100
MAX_ASSET_BYTES = 4 * 1024 * 1024
MAX_ASSET_BYTES_DOC = 50 * 1024 * 1024
MAX_ASSET_BYTES_TEAM = 2 * 1024 * 1024 * 1024
MAX_REVISIONS = 100
MAX_REVISION_BYTES = 64 * 1024 * 1024
MAX_SEARCH_KANDIDATEN = 200
PURGE_TAGE = 30

ERLAUBTE_ASSET_MIMES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "application/pdf",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fehler(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _enc(funktion, *args):
    """DIS-Ausfall ist fail-closed: 503 statt eines halb geschriebenen Satzes."""
    try:
        return funktion(*args)
    except DisSidecarError as exc:
        raise fehler(503, "DOCS_STORE_FAILED", "Verschluesselungsdienst nicht erreichbar") from exc


def _uid() -> str:
    return str(uuid.uuid4())


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _signing_secret() -> bytes:
    secret = settings.docs_signing_secret or settings.docs_sidecar_token or "msm-docs"
    return secret.encode("utf-8")


def _doc(db: Session, doc_uid: str, *, mit_trash: bool = False) -> Document:
    doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
    if doc is None or (doc.deleted_at is not None and not mit_trash):
        raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
    return doc


def _titel(doc: Document) -> str:
    try:
        return decrypt_text(doc.title_encrypted, aad_title(doc.doc_uid))
    except Exception:
        return "Dokument"


def _titel_gebuendelt(docs: list[Document]) -> dict[str, str]:
    from services.dis_client import DisClient

    if not docs:
        return {}
    try:
        werte = DisClient.decrypt_many(
            [(d.title_encrypted, aad_title(d.doc_uid)) for d in docs]
        )
    except DisSidecarError as exc:
        raise fehler(
            503, "DOCS_STORE_FAILED", "Verschluesselungsdienst nicht erreichbar"
        ) from exc
    return {
        d.doc_uid: (wert if wert is not None else "Dokument")
        for d, wert in zip(docs, werte)
    }


def _inhalt_text(doc: Document) -> str:
    if not doc.content_text_encrypted:
        return ""
    try:
        return decrypt_text(doc.content_text_encrypted, aad_text(doc.doc_uid))
    except Exception:
        return ""


def _publish(action: str, doc: Document, *, user_id: int | None = None, **extra) -> None:
    payload = {
        "entity": "docs",
        "action": action,
        "id": doc.doc_uid,
        "team_id": doc.team_id,
        "rev": doc.rev,
        **extra,
    }
    try:
        SyncEventService.publish(payload, user_id=user_id, team_id=doc.team_id)
    except Exception:
        pass
    # Externe Link-Mitglieder sind in keinem Team und bekommen das
    # Teamereignis nicht. Hoechstens 20 Einzelereignisse; darueber genuegt der
    # naechste REST-Abruf.
    try:
        from sqlalchemy.orm import object_session

        db = object_session(doc)
        if db is None:
            return
        link_user_ids = [
            row[0]
            for row in db.query(DocMember.user_id)
            .filter(DocMember.document_id == doc.id, DocMember.source == "link")
            .limit(20)
        ]
        for link_user_id in link_user_ids:
            SyncEventService.publish(payload, user_id=int(link_user_id))
    except Exception:
        pass


@dataclass(frozen=True)
class DocFolderInfo:
    folder: DocFolder
    name: str


class DocsService:
    # ── Zugriff und Darstellung ──────────────────────────────────────

    @staticmethod
    def access(
        db: Session, user: User, doc_uid: str, *, mit_trash: bool = False
    ) -> DocAccess:
        doc = _doc(db, doc_uid, mit_trash=mit_trash)
        return docs_access.access_or_404(db, user, doc, mit_trash=mit_trash)

    @staticmethod
    def _summary(
        db: Session,
        doc: Document,
        zugriff: DocAccess,
        titel: str,
        team_name: str | None = None,
    ) -> dict:
        folder = db.get(DocFolder, doc.folder_id) if doc.folder_id else None
        return {
            "uid": doc.doc_uid,
            "title": titel,
            "folder_uid": folder.folder_uid if folder else None,
            "icon": doc.icon,
            "team_id": doc.team_id,
            "team_name": team_name,
            "role": zugriff.role,
            "can_edit": zugriff.can_edit,
            "can_comment": zugriff.can_comment,
            "can_manage": zugriff.can_manage,
            "rev": doc.rev,
            "archived": doc.archived_at is not None,
            "deleted": doc.deleted_at is not None,
            "content_truncated": bool(doc.content_truncated),
            "updated_at": _iso(doc.updated_at),
            "last_edited_at": _iso(doc.last_edited_at),
            "owner": None,
        }

    @staticmethod
    def _detail(db: Session, doc: Document, zugriff: DocAccess) -> dict:
        from models.team import Team

        titel = _titel(doc)
        team = db.get(Team, doc.team_id)
        owner = db.get(User, doc.owner_user_id) if doc.owner_user_id else None
        folder = db.get(DocFolder, doc.folder_id) if doc.folder_id else None
        daten = DocsService._summary(db, doc, zugriff, titel, team.name if team else None)
        daten.update(
            {
                "folder_uid": folder.folder_uid if folder else None,
                "default_role": doc.default_role,
                "schema_version": doc.schema_version,
                "shared": bool(doc.share_token_hash),
                "share_role": doc.share_role,
                "share_expires_at": _iso(doc.share_expires_at),
                "owner": owner.username if owner else None,
            }
        )
        return daten

    # ── Dokumente ────────────────────────────────────────────────────

    @staticmethod
    def create_document(
        db: Session,
        user: User,
        *,
        team_id: int | None = None,
        folder_uid: str | None = None,
        title: str | None = None,
    ) -> dict:
        if team_id is None:
            team = team_service.personal_team(db, user)
        else:
            team = team_service.get_team_for_member(db, team_id, user)

        anzahl = db.query(func.count(Document.id)).filter(Document.team_id == team.id).scalar() or 0
        if anzahl >= MAX_DOCUMENTS_PER_TEAM:
            raise fehler(413, "DOC_QUOTA_EXCEEDED", "Team hat die Dokumentgrenze erreicht")

        folder_id = None
        if folder_uid:
            ordner = DocsService._folder(db, team.id, folder_uid)
            folder_id = ordner.id

        sauberer_titel = (title or "Neues Dokument").strip()[:MAX_TITLE] or "Neues Dokument"
        doc_uid = _uid()
        doc = Document(
            doc_uid=doc_uid,
            team_id=team.id,
            folder_id=folder_id,
            owner_user_id=user.id,
            title_encrypted=_enc(encrypt_text, sauberer_titel, aad_title(doc_uid)),
            default_role="editor",
            rev=0,
            schema_version=1,
            last_edited_at=_now(),
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        zugriff = docs_access.access_or_404(db, user, doc)
        _publish("created", doc, user_id=user.id)
        return DocsService._detail(db, doc, zugriff)

    @staticmethod
    def list_documents(
        db: Session,
        user: User,
        *,
        team_id: int | None = None,
        folder_uid: str | None = None,
        search: str | None = None,
        archived: bool = False,
        trash: bool = False,
        member: str | None = None,
        limit: int = 100,
        cursor: int = 0,
    ) -> list[dict]:
        limit = max(1, min(int(limit), 200))
        offset = max(0, int(cursor))

        team_ids = team_service.user_team_ids(db, user)
        if team_id is not None:
            if team_id not in team_ids and not user.is_owner:
                raise fehler(404, "DOCUMENT_NOT_FOUND", "Team nicht gefunden")
            team_ids = [team_id]

        query = db.query(Document)
        if team_ids:
            query = query.filter(Document.team_id.in_(team_ids))
        else:
            query = query.filter(Document.id == -1)

        # Zusaetzlich per Link freigegebene Dokumente ("Mit mir geteilt").
        if team_id is None:
            geteilt = db.query(DocMember.document_id).filter(
                DocMember.user_id == user.id,
                DocMember.source == "link",
            )
            query = db.query(Document).filter(
                or_(Document.team_id.in_(team_ids), Document.id.in_(geteilt))
            )

        if trash:
            query = query.filter(Document.deleted_at.isnot(None))
            if not user.is_owner:
                query = query.filter(Document.team_id.in_(team_ids))
        else:
            query = query.filter(Document.deleted_at.is_(None))

        if archived:
            query = query.filter(Document.archived_at.isnot(None))
        else:
            query = query.filter(Document.archived_at.is_(None))

        if folder_uid:
            ordner = db.query(DocFolder).filter(DocFolder.folder_uid == folder_uid).first()
            if ordner is None:
                raise fehler(404, "FOLDER_NOT_FOUND", "Ordner nicht gefunden")
            query = query.filter(Document.folder_id == ordner.id)

        if member == "me":
            query = query.filter(Document.owner_user_id == user.id)

        query = query.order_by(Document.updated_at.desc(), Document.id.desc())
        kandidaten = query.offset(offset).limit(limit).all()

        titel = _titel_gebuendelt(kandidaten)
        ergebnis: list[dict] = []
        for doc in kandidaten:
            zugriff = docs_access.resolve_access(db, user, doc, mit_trash=trash)
            if zugriff is None:
                continue
            if doc.deleted_at is not None and not zugriff.can_manage:
                continue
            ergebnis.append(DocsService._summary(db, doc, zugriff, titel[doc.doc_uid]))
        return ergebnis

    @staticmethod
    def search_documents(
        db: Session, user: User, suchbegriff: str, *, limit: int = 50
    ) -> list[dict]:
        begriff = suchbegriff.strip().lower()
        if not begriff:
            return []
        team_ids = team_service.user_team_ids(db, user)
        if not team_ids:
            return []
        kandidaten = (
            db.query(Document)
            .filter(
                Document.team_id.in_(team_ids),
                Document.deleted_at.is_(None),
            )
            .order_by(Document.updated_at.desc())
            .limit(MAX_SEARCH_KANDIDATEN)
            .all()
        )
        titel = _titel_gebuendelt(kandidaten)
        treffer: list[dict] = []
        for doc in kandidaten:
            if begriff not in titel[doc.doc_uid].lower() and begriff not in _inhalt_text(doc).lower():
                continue
            zugriff = docs_access.resolve_access(db, user, doc)
            if zugriff is None:
                continue
            treffer.append(DocsService._summary(db, doc, zugriff, titel[doc.doc_uid]))
            if len(treffer) >= limit:
                break
        return treffer

    @staticmethod
    def get_document(db: Session, user: User, doc_uid: str) -> dict:
        doc = _doc(db, doc_uid, mit_trash=True)
        zugriff = docs_access.access_or_404(db, user, doc, mit_trash=True)
        if doc.deleted_at is not None and not zugriff.can_manage:
            # Ein Papierkorb-Dokument sieht nur, wer es auch wiederherstellen
            # oder endgueltig loeschen darf.
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        return DocsService._detail(db, doc, zugriff)

    @staticmethod
    def update_document(db: Session, user: User, doc_uid: str, daten: dict) -> dict:
        doc = _doc(db, doc_uid)
        zugriff = docs_access.access_or_404(db, user, doc)

        verwaltung = {"folder_uid", "default_role"}
        if verwaltung & set(daten) and not zugriff.can_manage:
            raise fehler(403, "DOCS_FORBIDDEN", "Nur die Verwaltung darf das")
        if not zugriff.can_edit:
            raise fehler(403, "DOCS_READ_ONLY", "Nur Editoren duerfen das Dokument aendern")

        if "title" in daten and daten["title"] is not None:
            titel = daten["title"].strip()[:MAX_TITLE]
            if not titel:
                raise fehler(422, "DOC_INVALID_TARGET", "Titel darf nicht leer sein")
            doc.title_encrypted = _enc(encrypt_text, titel, aad_title(doc.doc_uid))
        if "icon" in daten:
            doc.icon = (daten["icon"] or None) and daten["icon"][:16]
        if "archived" in daten and daten["archived"] is not None:
            doc.archived_at = _now() if daten["archived"] else None
        if "folder_uid" in daten:
            doc.folder_id = (
                DocsService._folder(db, doc.team_id, daten["folder_uid"]).id
                if daten["folder_uid"]
                else None
            )
        if "default_role" in daten and daten["default_role"] is not None:
            if daten["default_role"] not in DOC_ROLES:
                raise fehler(422, "DOC_INVALID_TARGET", "Unbekannte Rolle")
            doc.default_role = daten["default_role"]

        doc.updated_at = _now()
        db.commit()
        db.refresh(doc)
        if "default_role" in daten:
            # Die neue Standardrolle gilt fuer alle, die keinen eigenen Eintrag
            # haben. Bestehende Verbindungen holen beim Reconnect einen Token
            # mit der frisch aufgeloesten Rolle.
            DocsService._disconnect(doc.doc_uid)
        _publish("updated", doc, user_id=user.id)
        return DocsService._detail(db, doc, docs_access.access_or_404(db, user, doc))

    @staticmethod
    def trash_document(db: Session, user: User, doc_uid: str) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_manage(db, user, doc)
        doc.deleted_at = _now()
        doc.purge_after = _now() + timedelta(days=PURGE_TAGE)
        doc.updated_at = _now()
        db.commit()
        _publish("deleted", doc, user_id=user.id)
        DocsService._disconnect(doc_uid)
        return {"ok": True}

    @staticmethod
    def restore_document(db: Session, user: User, doc_uid: str) -> dict:
        doc = _doc(db, doc_uid, mit_trash=True)
        docs_access.require_manage(db, user, doc, mit_trash=True)
        doc.deleted_at = None
        doc.purge_after = None
        doc.archived_at = None
        doc.updated_at = _now()
        db.commit()
        db.refresh(doc)
        _publish("restored", doc, user_id=user.id)
        return DocsService._detail(db, doc, docs_access.access_or_404(db, user, doc))

    @staticmethod
    def delete_permanent(db: Session, user: User, doc_uid: str) -> dict:
        doc = _doc(db, doc_uid, mit_trash=True)
        docs_access.require_manage(db, user, doc, mit_trash=True)
        DocsService._disconnect(doc_uid)
        db.delete(doc)
        db.commit()
        SyncEventService.publish(
            {"entity": "docs", "action": "deleted", "id": doc_uid, "team_id": doc.team_id},
            user_id=user.id,
            team_id=doc.team_id,
        )
        return {"ok": True}

    @staticmethod
    def duplicate_document(db: Session, user: User, doc_uid: str) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "editor")
        anzahl = db.query(func.count(Document.id)).filter(Document.team_id == doc.team_id).scalar() or 0
        if anzahl >= MAX_DOCUMENTS_PER_TEAM:
            raise fehler(413, "DOC_QUOTA_EXCEEDED", "Team hat die Dokumentgrenze erreicht")

        kopie = Document(
            doc_uid=_uid(),
            team_id=doc.team_id,
            folder_id=doc.folder_id,
            owner_user_id=user.id,
            title_encrypted="",
            icon=doc.icon,
            default_role=doc.default_role,
            rev=0,
            schema_version=doc.schema_version,
            state_bytes=0,
            last_edited_at=_now(),
        )
        kopie.title_encrypted = _enc(encrypt_text, 
            f"{_titel(doc)} (Kopie)"[:MAX_TITLE], aad_title(kopie.doc_uid)
        )
        if doc.state_encrypted:
            try:
                roh = decrypt_state(doc.state_encrypted, doc.doc_uid)
            except DocCryptoError as exc:
                raise fehler(
                    503, "DOCS_STORE_FAILED", "Dokumentzustand nicht entschluesselbar"
                ) from exc
            kopie.state_encrypted = _enc(encrypt_state, roh, kopie.doc_uid)
            kopie.state_bytes = len(roh)
            kopie.state_sha256 = sha256_hex(roh)
            kopie.rev = 1
        if doc.content_text_encrypted:
            kopie.content_text_encrypted = _enc(encrypt_text, 
                _inhalt_text(doc), aad_text(kopie.doc_uid)
            )
            kopie.content_chars = doc.content_chars
            kopie.content_truncated = doc.content_truncated
        db.add(kopie)
        db.commit()
        db.refresh(kopie)
        _publish("created", kopie, user_id=user.id)
        return DocsService._detail(db, kopie, docs_access.access_or_404(db, user, kopie))

    @staticmethod
    def _disconnect(doc_uid: str) -> None:
        try:
            from services.docs_collab_service import DocsCollabService

            DocsCollabService.disconnect_doc(doc_uid)
        except Exception:
            pass

    @staticmethod
    def _disconnect_links(doc_uid: str, user_ids: list[int]) -> None:
        try:
            from services.docs_collab_service import DocsCollabService

            for user_id in user_ids:
                DocsCollabService.disconnect_user(doc_uid, int(user_id))
        except Exception:
            pass

    # ── Ordner ───────────────────────────────────────────────────────

    @staticmethod
    def _folder(db: Session, team_id: int, folder_uid: str) -> DocFolder:
        ordner = (
            db.query(DocFolder)
            .filter(DocFolder.folder_uid == folder_uid, DocFolder.team_id == team_id)
            .first()
        )
        if ordner is None:
            raise fehler(404, "FOLDER_NOT_FOUND", "Ordner nicht gefunden")
        return ordner

    @staticmethod
    def _folder_name(ordner: DocFolder) -> str:
        try:
            return decrypt_text(ordner.name_encrypted, aad_folder(ordner.team_id, ordner.folder_uid))
        except Exception:
            return "Ordner"

    @staticmethod
    def _team_owner(db: Session, user: User, team_id: int) -> bool:
        if user.is_owner:
            return True
        mitglied = team_service.membership(db, team_id, user.id)
        return mitglied is not None and mitglied.role == "owner"

    @staticmethod
    def list_folders(db: Session, user: User, team_id: int | None = None) -> list[dict]:
        if team_id is None:
            team = team_service.personal_team(db, user)
        else:
            team = team_service.get_team_for_member(db, team_id, user)
        ordner = (
            db.query(DocFolder)
            .filter(DocFolder.team_id == team.id)
            .order_by(DocFolder.created_at)
            .all()
        )
        by_id = {o.id: o for o in ordner}
        ergebnis = []
        for o in ordner:
            ergebnis.append(
                {
                    "uid": o.folder_uid,
                    "name": DocsService._folder_name(o),
                    "parent_uid": by_id[o.parent_id].folder_uid if o.parent_id else None,
                    "team_id": o.team_id,
                    "created_at": _iso(o.created_at),
                }
            )
        return ergebnis

    @staticmethod
    def _folder_tiefe(db: Session, ordner: DocFolder) -> int:
        tiefe = 1
        aktuell = ordner
        while aktuell.parent_id is not None:
            tiefe += 1
            if tiefe > MAX_FOLDER_TIEFE + 1:
                raise fehler(422, "DOC_INVALID_TARGET", "Ordnertiefe ueberschritten")
            aktuell = db.get(DocFolder, aktuell.parent_id)
            if aktuell is None:
                break
        return tiefe

    @staticmethod
    def _name_konflikt(
        db: Session, team_id: int, parent_id: int | None, name: str, *, ausser_id: int | None = None
    ) -> bool:
        geschwister = (
            db.query(DocFolder)
            .filter(
                DocFolder.team_id == team_id,
                DocFolder.parent_id.is_(None) if parent_id is None else DocFolder.parent_id == parent_id,
            )
            .all()
        )
        for g in geschwister:
            if ausser_id is not None and g.id == ausser_id:
                continue
            if DocsService._folder_name(g).casefold() == name.casefold():
                return True
        return False

    @staticmethod
    def create_folder(db: Session, user: User, *, team_id: int | None, parent_uid: str | None, name: str) -> dict:
        if team_id is None:
            team = team_service.personal_team(db, user)
        else:
            team = team_service.get_team_for_member(db, team_id, user)
        if not DocsService._team_owner(db, user, team.id):
            raise fehler(403, "DOCS_FORBIDDEN", "Nur die Teamverwaltung darf Ordner anlegen")

        sauber = name.strip()[:MAX_TITLE]
        if not sauber:
            raise fehler(422, "DOC_INVALID_TARGET", "Name darf nicht leer sein")
        parent_id = None
        if parent_uid:
            parent = DocsService._folder(db, team.id, parent_uid)
            if DocsService._folder_tiefe(db, parent) >= MAX_FOLDER_TIEFE:
                raise fehler(422, "DOC_INVALID_TARGET", "Ordnertiefe ueberschritten")
            parent_id = parent.id
        if DocsService._name_konflikt(db, team.id, parent_id, sauber):
            raise fehler(409, "DOC_NAME_CONFLICT", "Diesen Ordnernamen gibt es hier schon")

        ordner = DocFolder(
            folder_uid=_uid(),
            team_id=team.id,
            parent_id=parent_id,
            name_encrypted="",
            created_by=user.id,
        )
        ordner.name_encrypted = _enc(encrypt_text, 
            sauber, aad_folder(team.id, ordner.folder_uid)
        )
        db.add(ordner)
        db.commit()
        db.refresh(ordner)
        SyncEventService.publish(
            {"entity": "docs", "action": "created", "id": ordner.folder_uid, "team_id": team.id},
            user_id=user.id,
            team_id=team.id,
        )
        return {
            "uid": ordner.folder_uid,
            "name": sauber,
            "parent_uid": parent_uid,
            "team_id": team.id,
            "created_at": _iso(ordner.created_at),
        }

    @staticmethod
    def update_folder(
        db: Session,
        user: User,
        folder_uid: str,
        *,
        name: str | None = None,
        parent_uid: str | None = None,
    ) -> dict:
        ordner = db.query(DocFolder).filter(DocFolder.folder_uid == folder_uid).first()
        if ordner is None:
            raise fehler(404, "FOLDER_NOT_FOUND", "Ordner nicht gefunden")
        team = team_service.get_team_for_member(db, ordner.team_id, user)
        if not DocsService._team_owner(db, user, team.id):
            raise fehler(403, "DOCS_FORBIDDEN", "Nur die Teamverwaltung darf Ordner aendern")

        if name is not None:
            sauber = name.strip()[:MAX_TITLE]
            if not sauber:
                raise fehler(422, "DOC_INVALID_TARGET", "Name darf nicht leer sein")
            if DocsService._name_konflikt(
                db, ordner.team_id, ordner.parent_id, sauber, ausser_id=ordner.id
            ):
                raise fehler(409, "DOC_NAME_CONFLICT", "Diesen Ordnernamen gibt es hier schon")
            ordner.name_encrypted = _enc(encrypt_text, 
                sauber, aad_folder(ordner.team_id, ordner.folder_uid)
            )

        if parent_uid is not None:
            neuer_parent = DocsService._folder(db, ordner.team_id, parent_uid) if parent_uid else None
            if neuer_parent is not None:
                if neuer_parent.id == ordner.id:
                    raise fehler(422, "DOC_INVALID_TARGET", "Ordner kann nicht sein eigener Elternordner sein")
                # Zyklus: kein Nachfahre darf neuer Elternordner werden.
                pruefer = neuer_parent
                while pruefer is not None:
                    if pruefer.id == ordner.id:
                        raise fehler(422, "DOC_INVALID_TARGET", "Ordner kann nicht in sich selbst verschoben werden")
                    pruefer = db.get(DocFolder, pruefer.parent_id) if pruefer.parent_id else None
                if DocsService._folder_tiefe(db, neuer_parent) >= MAX_FOLDER_TIEFE:
                    raise fehler(422, "DOC_INVALID_TARGET", "Ordnertiefe ueberschritten")
            ordner.parent_id = neuer_parent.id if neuer_parent else None

        ordner.updated_at = _now()
        db.commit()
        db.refresh(ordner)
        SyncEventService.publish(
            {"entity": "docs", "action": "updated", "id": ordner.folder_uid, "team_id": ordner.team_id},
            user_id=user.id,
            team_id=ordner.team_id,
        )
        return {
            "uid": ordner.folder_uid,
            "name": DocsService._folder_name(ordner),
            "parent_uid": (
                db.get(DocFolder, ordner.parent_id).folder_uid if ordner.parent_id else None
            ),
            "team_id": ordner.team_id,
            "created_at": _iso(ordner.created_at),
        }

    @staticmethod
    def delete_folder(db: Session, user: User, folder_uid: str) -> dict:
        ordner = db.query(DocFolder).filter(DocFolder.folder_uid == folder_uid).first()
        if ordner is None:
            raise fehler(404, "FOLDER_NOT_FOUND", "Ordner nicht gefunden")
        team = team_service.get_team_for_member(db, ordner.team_id, user)
        if not DocsService._team_owner(db, user, team.id):
            raise fehler(403, "DOCS_FORBIDDEN", "Nur die Teamverwaltung darf Ordner loeschen")

        db.query(Document).filter(Document.folder_id == ordner.id).update(
            {Document.folder_id: ordner.parent_id}, synchronize_session=False
        )
        db.query(DocFolder).filter(DocFolder.parent_id == ordner.id).update(
            {DocFolder.parent_id: ordner.parent_id}, synchronize_session=False
        )
        team_id = ordner.team_id
        db.delete(ordner)
        db.commit()
        SyncEventService.publish(
            {"entity": "docs", "action": "deleted", "id": folder_uid, "team_id": team_id},
            user_id=user.id,
            team_id=team_id,
        )
        return {"ok": True}

    # ── Mitglieder ───────────────────────────────────────────────────

    @staticmethod
    def list_members(db: Session, user: User, doc_uid: str) -> list[dict]:
        doc = _doc(db, doc_uid)
        docs_access.require_manage(db, user, doc)
        rows = (
            db.query(TeamMember, User)
            .join(User, User.id == TeamMember.user_id)
            .filter(TeamMember.team_id == doc.team_id)
            .all()
        )
        overrides = {
            m.user_id: m
            for m in db.query(DocMember).filter(
                DocMember.document_id == doc.id, DocMember.source == "manual"
            )
        }
        ergebnis = []
        for mitglied, benutzer in rows:
            override = overrides.get(benutzer.id)
            ergebnis.append(
                {
                    "user_id": benutzer.id,
                    "username": benutzer.username,
                    "role": override.role if override else None,
                    "effective_role": override.role if override else doc.default_role,
                    "source": "manual" if override else "team",
                    "is_team_owner": mitglied.role == "owner",
                    "is_doc_owner": doc.owner_user_id == benutzer.id,
                }
            )
        return ergebnis

    @staticmethod
    def put_member(db: Session, user: User, doc_uid: str, target_user_id: int, role: str) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_manage(db, user, doc)
        if role not in DOC_ROLES:
            raise fehler(422, "DOC_INVALID_TARGET", "Unbekannte Rolle")
        if team_service.membership(db, doc.team_id, target_user_id) is None:
            raise fehler(422, "DOC_INVALID_TARGET", "Ziel ist kein Teammitglied")
        row = db.query(DocMember).filter(
            DocMember.document_id == doc.id, DocMember.user_id == target_user_id
        ).first()
        if row is None:
            row = DocMember(
                document_id=doc.id,
                user_id=target_user_id,
                role=role,
                source="manual",
                granted_by=user.id,
            )
            db.add(row)
        else:
            row.role = role
            row.source = "manual"
            row.granted_by = user.id
            row.expires_at = None
        db.commit()
        SyncEventService.publish(
            {"entity": "docs", "action": "access", "id": doc.doc_uid, "team_id": doc.team_id},
            user_id=target_user_id,
            team_id=doc.team_id,
        )
        if role != "editor":
            DocsService._disconnect_links(doc.doc_uid, [target_user_id])
        return {"ok": True}

    @staticmethod
    def delete_member(db: Session, user: User, doc_uid: str, target_user_id: int) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_manage(db, user, doc)
        db.query(DocMember).filter(
            DocMember.document_id == doc.id,
            DocMember.user_id == target_user_id,
            DocMember.source == "manual",
        ).delete(synchronize_session=False)
        db.commit()
        SyncEventService.publish(
            {"entity": "docs", "action": "access", "id": doc.doc_uid, "team_id": doc.team_id},
            user_id=target_user_id,
            team_id=doc.team_id,
        )
        DocsService._disconnect_links(doc.doc_uid, [target_user_id])
        return {"ok": True}

    # ── Share-Links ──────────────────────────────────────────────────

    @staticmethod
    def create_share(
        db: Session, user: User, doc_uid: str, *, role: str, expires_in_days: int | None
    ) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_manage(db, user, doc)
        if role not in ("viewer", "commenter"):
            raise fehler(422, "DOC_INVALID_TARGET", "Share-Rolle darf nur viewer oder commenter sein")
        tage = 7 if expires_in_days is None else max(1, min(int(expires_in_days), 30))
        token = secrets.token_urlsafe(32)
        doc.share_token_hash = _token_hash(token)
        doc.share_role = role
        doc.share_expires_at = _now() + timedelta(days=tage)
        doc.share_created_by = user.id
        alte_links = [
            row[0]
            for row in db.query(DocMember.user_id).filter(
                DocMember.document_id == doc.id, DocMember.source == "link"
            )
        ]
        db.query(DocMember).filter(
            DocMember.document_id == doc.id, DocMember.source == "link"
        ).delete(synchronize_session=False)
        db.commit()
        db.refresh(doc)
        DocsService._disconnect_links(doc.doc_uid, alte_links)
        _publish("access", doc, user_id=user.id)
        return {
            "url": f"/dokumente/freigabe/{token}",
            "role": role,
            "expires_at": _iso(doc.share_expires_at),
        }

    @staticmethod
    def delete_share(db: Session, user: User, doc_uid: str) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_manage(db, user, doc)
        doc.share_token_hash = None
        doc.share_role = None
        doc.share_expires_at = None
        doc.share_created_by = None
        alte_links = [
            row[0]
            for row in db.query(DocMember.user_id).filter(
                DocMember.document_id == doc.id, DocMember.source == "link"
            )
        ]
        db.query(DocMember).filter(
            DocMember.document_id == doc.id, DocMember.source == "link"
        ).delete(synchronize_session=False)
        db.commit()
        DocsService._disconnect_links(doc.doc_uid, alte_links)
        _publish("access", doc, user_id=user.id)
        return {"ok": True}

    @staticmethod
    def claim_share(db: Session, user: User, token: str) -> dict:
        doc = (
            db.query(Document)
            .filter(Document.share_token_hash == _token_hash(token))
            .first()
        )
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Freigabe nicht gefunden")
        expires = doc.share_expires_at
        if expires is not None and (
            expires if expires.tzinfo else expires.replace(tzinfo=timezone.utc)
        ) <= _now():
            raise fehler(403, "DOCS_FORBIDDEN", "Freigabe ist abgelaufen")
        if not doc.share_role:
            raise fehler(403, "DOCS_FORBIDDEN", "Freigabe ist deaktiviert")

        if team_service.membership(db, doc.team_id, user.id) is None:
            row = db.query(DocMember).filter(
                DocMember.document_id == doc.id,
                DocMember.user_id == user.id,
                DocMember.source == "link",
            ).first()
            if row is None:
                row = DocMember(
                    document_id=doc.id,
                    user_id=user.id,
                    role=doc.share_role,
                    source="link",
                    granted_by=doc.share_created_by,
                    expires_at=doc.share_expires_at,
                )
                db.add(row)
            else:
                row.role = doc.share_role
                row.expires_at = doc.share_expires_at
            db.commit()
        return DocsService.get_document(db, user, doc.doc_uid)

    # ── Kommentare ───────────────────────────────────────────────────

    @staticmethod
    def list_comments(
        db: Session, user: User, doc_uid: str, *, status: str | None = None
    ) -> list[dict]:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "viewer")
        query = db.query(DocComment).filter(
            DocComment.document_id == doc.id, DocComment.deleted_at.is_(None)
        )
        if status in ("open", "resolved"):
            query = query.filter(DocComment.status == status)
        rows = query.order_by(DocComment.created_at).all()
        namen = {
            u.id: u.username
            for u in db.query(User).filter(User.id.in_({r.author_user_id for r in rows if r.author_user_id}))
        }
        ergebnis = []
        for row in rows:
            try:
                body = decrypt_text(row.body_encrypted, aad_comment(doc.doc_uid, row.comment_uid, "body"))
            except Exception:
                body = ""
            anchor = None
            if row.anchor_encrypted:
                try:
                    anchor = json.loads(
                        decrypt_text(row.anchor_encrypted, aad_comment(doc.doc_uid, row.comment_uid, "anchor"))
                    )
                except Exception:
                    anchor = None
            ergebnis.append(
                {
                    "uid": row.comment_uid,
                    "parent_uid": None,
                    "body": body,
                    "anchor": anchor,
                    "status": row.status,
                    "author": namen.get(row.author_user_id),
                    "author_user_id": row.author_user_id,
                    "created_at": _iso(row.created_at),
                    "updated_at": _iso(row.updated_at),
                }
            )
        by_id = {r.id: r.comment_uid for r in rows}
        for eintrag, row in zip(ergebnis, rows):
            eintrag["parent_uid"] = by_id.get(row.parent_id)
        return ergebnis

    @staticmethod
    def create_comment(
        db: Session,
        user: User,
        doc_uid: str,
        *,
        body: str,
        parent_uid: str | None,
        anchor: dict | None,
    ) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "commenter")
        parent_id = None
        if parent_uid:
            parent = db.query(DocComment).filter(
                DocComment.comment_uid == parent_uid, DocComment.document_id == doc.id
            ).first()
            if parent is None:
                raise fehler(404, "COMMENT_NOT_FOUND", "Kommentar nicht gefunden")
            if parent.parent_id is not None:
                raise fehler(422, "DOC_INVALID_TARGET", "Antworten sind nur eine Ebene tief")
            parent_id = parent.id
        row = DocComment(
            comment_uid=_uid(),
            document_id=doc.id,
            parent_id=parent_id,
            author_user_id=user.id,
            body_encrypted="",
            status="open",
        )
        row.body_encrypted = _enc(encrypt_text, 
            body, aad_comment(doc.doc_uid, row.comment_uid, "body")
        )
        if anchor:
            row.anchor_encrypted = _enc(encrypt_text, 
                json.dumps(anchor), aad_comment(doc.doc_uid, row.comment_uid, "anchor")
            )
        db.add(row)
        db.commit()
        db.refresh(row)
        _publish("comment", doc, user_id=user.id)
        return {"uid": row.comment_uid}

    @staticmethod
    def _comment(db: Session, doc: Document, comment_uid: str) -> DocComment:
        row = db.query(DocComment).filter(
            DocComment.comment_uid == comment_uid,
            DocComment.document_id == doc.id,
            DocComment.deleted_at.is_(None),
        ).first()
        if row is None:
            raise fehler(404, "COMMENT_NOT_FOUND", "Kommentar nicht gefunden")
        return row

    @staticmethod
    def update_comment(
        db: Session,
        user: User,
        doc_uid: str,
        comment_uid: str,
        *,
        body: str | None,
        status: str | None,
    ) -> dict:
        doc = _doc(db, doc_uid)
        zugriff = docs_access.require_role(db, user, doc, "commenter")
        row = DocsService._comment(db, doc, comment_uid)
        if row.author_user_id != user.id and not zugriff.can_manage:
            raise fehler(403, "DOCS_FORBIDDEN", "Nur der Autor darf den Kommentar aendern")
        if body is not None:
            row.body_encrypted = _enc(encrypt_text, 
                body, aad_comment(doc.doc_uid, row.comment_uid, "body")
            )
        if status in ("open", "resolved"):
            row.status = status
            row.resolved_by = user.id if status == "resolved" else None
            row.resolved_at = _now() if status == "resolved" else None
        row.updated_at = _now()
        db.commit()
        _publish("comment", doc, user_id=user.id)
        return {"ok": True}

    @staticmethod
    def delete_comment(db: Session, user: User, doc_uid: str, comment_uid: str) -> dict:
        doc = _doc(db, doc_uid)
        zugriff = docs_access.require_role(db, user, doc, "commenter")
        row = DocsService._comment(db, doc, comment_uid)
        if row.author_user_id != user.id and not zugriff.can_manage:
            raise fehler(403, "DOCS_FORBIDDEN", "Nur der Autor darf den Kommentar loeschen")
        row.deleted_at = _now()
        db.commit()
        _publish("comment", doc, user_id=user.id)
        return {"ok": True}

    # ── Revisionen (Metadaten) ───────────────────────────────────────

    @staticmethod
    def revision_vorschau(db: Session, doc: Document, row: DocRevision) -> str:
        if not row.preview_text_encrypted:
            return ""
        try:
            return decrypt_text(
                row.preview_text_encrypted, aad_revision(doc.doc_uid, row.rev, "preview")
            )
        except Exception:
            return ""

    @staticmethod
    def revision_label(db: Session, doc: Document, row: DocRevision) -> str | None:
        if not row.label_encrypted:
            return None
        try:
            return decrypt_text(
                row.label_encrypted, aad_revision(doc.doc_uid, row.rev, "label")
            )
        except Exception:
            return None

    @staticmethod
    def list_revisions(db: Session, user: User, doc_uid: str) -> list[dict]:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "viewer")
        rows = (
            db.query(DocRevision)
            .filter(DocRevision.document_id == doc.id)
            .order_by(DocRevision.rev.desc())
            .limit(MAX_REVISIONS)
            .all()
        )
        namen = {
            u.id: u.username
            for u in db.query(User).filter(User.id.in_({r.author_user_id for r in rows if r.author_user_id}))
        }
        return [
            {
                "rev": row.rev,
                "reason": row.reason,
                "label": DocsService.revision_label(db, doc, row),
                "preview": DocsService.revision_vorschau(db, doc, row),
                "size_bytes": row.state_bytes,
                "author": namen.get(row.author_user_id),
                "author_kind": row.author_kind,
                "ai_run_id": row.ai_run_id,
                "created_at": _iso(row.created_at),
            }
            for row in rows
        ]

    @staticmethod
    def get_revision(db: Session, user: User, doc_uid: str, rev: int) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "viewer")
        row = db.query(DocRevision).filter(
            DocRevision.document_id == doc.id, DocRevision.rev == rev
        ).first()
        if row is None:
            raise fehler(404, "REVISION_NOT_FOUND", "Revision nicht gefunden")
        return {
            "rev": row.rev,
            "reason": row.reason,
            "label": DocsService.revision_label(db, doc, row),
            "preview": DocsService.revision_vorschau(db, doc, row),
            "size_bytes": row.state_bytes,
            "created_at": _iso(row.created_at),
        }

    # ── Assets ───────────────────────────────────────────────────────

    @staticmethod
    def _asset(db: Session, doc: Document, asset_uid: str) -> DocAsset:
        row = db.query(DocAsset).filter(
            DocAsset.asset_uid == asset_uid,
            DocAsset.document_id == doc.id,
            DocAsset.deleted_at.is_(None),
        ).first()
        if row is None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Anhang nicht gefunden")
        return row

    @staticmethod
    def upload_asset(
        db: Session,
        user: User,
        doc_uid: str,
        *,
        file_name: str,
        mime: str,
        data_base64: str,
        sha256: str,
    ) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "editor")
        if mime not in ERLAUBTE_ASSET_MIMES:
            raise fehler(422, "DOC_INVALID_TARGET", "Dateityp ist nicht erlaubt")
        try:
            roh = base64.b64decode(data_base64, validate=True)
        except binascii.Error:
            raise fehler(422, "DOC_INVALID_TARGET", "Datei ist nicht base64-kodiert")
        if len(roh) > MAX_ASSET_BYTES:
            raise fehler(413, "DOC_ASSET_TOO_LARGE", "Anhang ist groesser als 4 MiB")
        if sha256_hex(roh) != sha256.lower():
            raise fehler(422, "DOC_INVALID_TARGET", "Pruefsumme passt nicht zur Datei")

        anzahl = db.query(func.count(DocAsset.id)).filter(
            DocAsset.document_id == doc.id, DocAsset.deleted_at.is_(None)
        ).scalar() or 0
        if anzahl >= MAX_ASSETS_PER_DOC:
            raise fehler(413, "DOC_QUOTA_EXCEEDED", "Dokument hat die Anhangsgrenze erreicht")
        if doc.asset_bytes + len(roh) > MAX_ASSET_BYTES_DOC:
            raise fehler(413, "DOC_QUOTA_EXCEEDED", "Dokument-Anhaenge sind zu gross")
        team_bytes = (
            db.query(func.coalesce(func.sum(DocAsset.size_bytes), 0))
            .join(Document, Document.id == DocAsset.document_id)
            .filter(Document.team_id == doc.team_id, DocAsset.deleted_at.is_(None))
            .scalar()
            or 0
        )
        if team_bytes + len(roh) > MAX_ASSET_BYTES_TEAM:
            raise fehler(413, "DOC_QUOTA_EXCEEDED", "Team-Anhaenge sind zu gross")

        asset = DocAsset(
            asset_uid=_uid(),
            document_id=doc.id,
            uploader_user_id=user.id,
            file_name_encrypted="",
            mime=mime,
            size_bytes=len(roh),
            sha256=sha256.lower(),
            ciphertext_blob="",
        )
        asset.file_name_encrypted = _enc(encrypt_text, 
            file_name[:255], aad_asset(doc.doc_uid, asset.asset_uid)
        )
        asset.ciphertext_blob = _enc(encrypt_blob, roh, aad_asset(doc.doc_uid, asset.asset_uid))
        doc.asset_bytes += len(roh)
        db.add(asset)
        db.commit()
        db.refresh(asset)
        url, expires = DocsService.asset_signed_url(db, user, doc_uid, asset.asset_uid)
        return {"asset_uid": asset.asset_uid, "signed_url": url, "expires_at": _iso(expires)}

    @staticmethod
    def asset_signed_url(
        db: Session, user: User, doc_uid: str, asset_uid: str, ttl_seconds: int = 3600
    ) -> tuple[str, datetime]:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "viewer")
        DocsService._asset(db, doc, asset_uid)
        expires_at = _now() + timedelta(seconds=max(60, min(int(ttl_seconds), 86400)))
        expires_ts = int(expires_at.timestamp())
        msg = f"msm:docs-asset:{doc.doc_uid}:{asset_uid}:{user.id}:{expires_ts}".encode()
        token = hmac.new(_signing_secret(), msg, hashlib.sha256).hexdigest()
        url = (
            f"/api/docs/assets/{asset_uid}/content"
            f"?doc={doc.doc_uid}&token={token}&expires={expires_ts}&user_id={user.id}"
        )
        return url, expires_at

    @staticmethod
    def asset_content(
        db: Session, *, asset_uid: str, doc_uid: str, token: str, expires: int, user_id: int
    ) -> tuple[DocAsset, Document, bytes]:
        if int(_now().timestamp()) > expires:
            raise fehler(403, "DOCS_FORBIDDEN", "Signierte URL ist abgelaufen")
        msg = f"msm:docs-asset:{doc_uid}:{asset_uid}:{user_id}:{expires}".encode()
        expected = hmac.new(_signing_secret(), msg, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, token):
            raise fehler(403, "DOCS_FORBIDDEN", "Ungueltige Signatur")
        doc = _doc(db, doc_uid)
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            raise fehler(403, "DOCS_FORBIDDEN", "Konto ist inaktiv")
        docs_access.require_role(db, user, doc, "viewer")
        asset = DocsService._asset(db, doc, asset_uid)
        try:
            roh = decrypt_blob(asset.ciphertext_blob, aad_asset(doc.doc_uid, asset.asset_uid))
        except DocCryptoError as exc:
            raise fehler(
                503, "DOCS_STORE_FAILED", "Anhang nicht entschluesselbar"
            ) from exc
        return asset, doc, roh

    @staticmethod
    def delete_asset(db: Session, user: User, doc_uid: str, asset_uid: str) -> dict:
        doc = _doc(db, doc_uid)
        docs_access.require_role(db, user, doc, "editor")
        asset = DocsService._asset(db, doc, asset_uid)
        asset.deleted_at = _now()
        doc.asset_bytes = max(0, doc.asset_bytes - asset.size_bytes)
        db.commit()
        return {"ok": True}

    # ── Wartung ──────────────────────────────────────────────────────

    @staticmethod
    def purge_deleted(db: Session) -> int:
        jetzt = _now()
        rows = db.query(Document).filter(
            Document.purge_after.isnot(None), Document.purge_after <= jetzt
        ).all()
        for doc in rows:
            DocsService._disconnect(doc.doc_uid)
            db.delete(doc)
        if rows:
            db.commit()
        return len(rows)

    @staticmethod
    def prune_revisions(db: Session, doc: Document) -> None:
        rows = (
            db.query(DocRevision)
            .filter(DocRevision.document_id == doc.id)
            .order_by(DocRevision.created_at.desc())
            .all()
        )
        gesamt = sum(r.state_bytes for r in rows)
        while len(rows) > MAX_REVISIONS or gesamt > MAX_REVISION_BYTES:
            opfer = None
            for row in reversed(rows):
                if row.reason in ("autosave", "ai_pre_edit", "ai_undo"):
                    opfer = row
                    break
            if opfer is None:
                opfer = rows[-1]
            gesamt -= opfer.state_bytes
            rows.remove(opfer)
            db.delete(opfer)
        doc.revision_bytes = max(0, gesamt)
