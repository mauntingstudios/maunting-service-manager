"""Bestaetigungspflichtige KI-Aenderungen an einem Dokument.

Ein Vorschlag liegt ausserhalb des Yjs-Dokuments: Andere Mitarbeiter sehen
ihn nicht, der Verlauf enthaelt keine Revision, und ein Neuladen verliert ihn
nicht. Erst der Besitzer entscheidet; dann laeuft derselbe Sidecar-Pfad wie
eine direkte KI-Aenderung.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import uuid

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import User
from models.ai_conversation import AiConversation
from models.doc import DocPendingEdit, Document
from services import docs_access
from services.docs_collab_service import DocsCollabService
from services.docs_crypto import (
    DocCryptoError,
    aad_pending,
    decrypt_text,
    encrypt_text,
)
from services.docs_service import fehler
from services.sync_event_service import SyncEventService


PENDING_TTL = timedelta(hours=24)
APPLY_STUCK = timedelta(minutes=15)
RESOLVED_KEEP = timedelta(days=7)
OFFENE_STATUS = ("pending", "applying")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(wert: datetime | None) -> str | None:
    if wert is None:
        return None
    if wert.tzinfo is None:
        wert = wert.replace(tzinfo=timezone.utc)
    return wert.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dokument(db: Session, doc_uid: str) -> Document:
    doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
    if doc is None or doc.deleted_at is not None:
        raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
    return doc


def _payload(row: DocPendingEdit, doc: Document) -> dict:
    try:
        return json.loads(
            decrypt_text(
                row.payload_encrypted, aad_pending(doc.doc_uid, row.pending_uid)
            )
        )
    except (DocCryptoError, ValueError, TypeError) as exc:
        raise fehler(
            503, "DOCS_STORE_FAILED", "Vorschlag nicht entschluesselbar"
        ) from exc


def _melden(doc: Document, row: DocPendingEdit, aktion: str) -> None:
    """Nur der Besitzer erfaehrt vom Vorschlag. Kein Team-Broadcast."""
    try:
        SyncEventService.publish(
            {
                "entity": "docs",
                "action": aktion,
                "id": doc.doc_uid,
                "team_id": doc.team_id,
                "pending_uid": row.pending_uid,
            },
            user_id=row.user_id,
        )
    except Exception:
        # Ein Ereignis ist Bequemlichkeit; der REST-Abruf bleibt die Wahrheit.
        pass


class DocsPendingEditService:
    @staticmethod
    def cleanup(db: Session, *, doc_id: int | None = None) -> None:
        """Abgelaufene Vorschlaege entfernen, haengende Uebernahmen aufloesen."""
        jetzt = _now()
        abfrage = db.query(DocPendingEdit).filter(
            DocPendingEdit.status.in_(("pending", "stale")),
            DocPendingEdit.expires_at <= jetzt,
        )
        if doc_id is not None:
            abfrage = abfrage.filter(DocPendingEdit.document_id == doc_id)
        abfrage.delete(synchronize_session=False)

        # Entschiedene Vorschlaege sind nach einer Woche nur noch Datenmuell;
        # der Nachweis der Aenderung steht im Dokumentverlauf.
        erledigt = db.query(DocPendingEdit).filter(
            DocPendingEdit.status.in_(("applied", "rejected")),
            DocPendingEdit.resolved_at.is_not(None),
            DocPendingEdit.resolved_at <= jetzt - RESOLVED_KEEP,
        )
        if doc_id is not None:
            erledigt = erledigt.filter(DocPendingEdit.document_id == doc_id)
        erledigt.delete(synchronize_session=False)

        haengend = db.query(DocPendingEdit).filter(
            DocPendingEdit.status == "applying",
            DocPendingEdit.resolved_at.is_(None),
            func.coalesce(
                DocPendingEdit.applying_at, DocPendingEdit.created_at
            ) <= jetzt - APPLY_STUCK,
        )
        if doc_id is not None:
            haengend = haengend.filter(DocPendingEdit.document_id == doc_id)
        for row in haengend.all():
            doc = db.get(Document, row.document_id)
            if doc is not None and int(doc.rev) > int(row.base_rev):
                row.status = "applied"
                row.applied_rev = doc.rev
            else:
                row.status = "pending"
            row.applying_at = None
            row.resolved_at = jetzt if row.status == "applied" else None
        db.flush()

    @staticmethod
    def open_for(db: Session, *, doc_id: int, user_id: int) -> DocPendingEdit | None:
        return (
            db.query(DocPendingEdit)
            .filter(
                DocPendingEdit.document_id == doc_id,
                DocPendingEdit.user_id == user_id,
                DocPendingEdit.status.in_(OFFENE_STATUS),
            )
            .first()
        )

    @staticmethod
    def create(
        db: Session,
        user: User,
        doc_uid: str,
        *,
        conversation_id: str,
        edits: list[dict] | None = None,
        operation: str | None = None,
        markdown: str = "",
        anchor: dict | None = None,
        expected_block: str | None = None,
        summary: str | None,
        run_id: str | None,
        call_id: str | None,
    ) -> dict:
        doc = _dokument(db, doc_uid)
        docs_access.require_role(db, user, doc, "editor")
        gespraech = db.get(AiConversation, conversation_id)
        if (
            gespraech is None
            or gespraech.user_id != user.id
            or gespraech.document_id != doc.id
        ):
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokumentgespraech nicht gefunden")

        DocsPendingEditService.cleanup(db, doc_id=doc.id)
        # Ein veralteter Vorschlag blockiert nichts und hat keinen Nutzen mehr,
        # sobald ein neuer entsteht. Er wird still entfernt, statt als
        # unsichtbarer Rest liegen zu bleiben.
        db.query(DocPendingEdit).filter(
            DocPendingEdit.document_id == doc.id,
            DocPendingEdit.user_id == user.id,
            DocPendingEdit.status == "stale",
        ).delete(synchronize_session=False)
        offen = DocsPendingEditService.open_for(
            db, doc_id=doc.id, user_id=user.id
        )
        if offen is not None:
            return {
                "pending": True,
                "pending_uid": offen.pending_uid,
                "summary": _payload(offen, doc).get("summary"),
                "hinweis": (
                    "Es gibt bereits einen offenen Vorschlag fuer dieses Dokument. "
                    "Bitte bestaetige oder verwirf ihn zuerst; lege keinen zweiten an."
                ),
            }

        # Vor dem Speichern pruefen: Ziele eindeutig, Markdown nicht leer. Der
        # Klon im Sidecar wird dabei nicht gespeichert.
        if edits is not None:
            if not edits:
                raise fehler(422, "DOC_INVALID_TARGET", "Keine Aenderungen")
            DocsCollabService.ai_preview(
                db,
                user,
                doc.doc_uid,
                edits=edits,
                run_id=run_id,
                call_id=call_id,
            )
            payload = {
                "version": 2,
                "edits": edits,
                "summary": (summary or "")[:200] or None,
            }
            gespeicherte_operation = "batch"
        else:
            if operation not in ("append", "replace_block"):
                raise fehler(422, "DOC_INVALID_TARGET", "Unbekannte Operation")
            if not markdown.strip():
                raise fehler(422, "DOC_INVALID_TARGET", "markdown ist leer")
            vorschau = DocsCollabService.ai_preview(
                db,
                user,
                doc.doc_uid,
                operation=operation,
                markdown=markdown,
                anchor=anchor,
                expected_block=expected_block,
                run_id=run_id,
                call_id=call_id,
            )
            payload = {
                "version": 1,
                "operation": operation,
                "markdown": markdown[:20_000],
                "anchor": anchor,
                "summary": (summary or "")[:200] or None,
                "target_block": vorschau.get("target_block"),
            }
            gespeicherte_operation = operation
        pending_uid = str(uuid.uuid4())
        row = DocPendingEdit(
            pending_uid=pending_uid,
            document_id=doc.id,
            user_id=user.id,
            conversation_id=gespraech.id,
            run_id=run_id,
            call_id=call_id,
            operation=gespeicherte_operation,
            payload_encrypted=encrypt_text(
                json.dumps(payload, ensure_ascii=False),
                aad_pending(doc.doc_uid, pending_uid),
            ),
            base_rev=doc.rev,
            status="pending",
            created_at=_now(),
            expires_at=_now() + PENDING_TTL,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise fehler(
                409,
                "DOC_AI_PENDING_OPEN",
                "Es gibt bereits einen offenen Vorschlag fuer dieses Dokument",
            ) from exc
        _melden(doc, row, "ai_pending")
        return {
            "pending": True,
            "pending_uid": row.pending_uid,
            "summary": payload["summary"],
            "hinweis": (
                "Die Aenderung ist als Vorschau angelegt und noch nicht im "
                "Dokument. Der Mensch muss sie bestaetigen. Rufe edit_document "
                "nicht erneut auf."
            ),
        }

    @staticmethod
    def list_for_user(db: Session, user: User, doc_uid: str) -> dict:
        doc = _dokument(db, doc_uid)
        docs_access.require_role(db, user, doc, "viewer")
        DocsPendingEditService.cleanup(db, doc_id=doc.id)
        db.commit()
        rows = (
            db.query(DocPendingEdit)
            .filter(
                DocPendingEdit.document_id == doc.id,
                DocPendingEdit.user_id == user.id,
                # `stale` bleibt sichtbar: Der Nutzer soll den Vorschlag
                # verwerfen koennen, auch wenn die Stelle nicht mehr passt.
                DocPendingEdit.status.in_((*OFFENE_STATUS, "stale")),
                DocPendingEdit.expires_at > _now(),
            )
            .order_by(DocPendingEdit.created_at.asc())
            .all()
        )
        eintraege = []
        for row in rows:
            daten = _payload(row, doc)
            eintrag = {
                "uid": row.pending_uid,
                "operation": row.operation,
                "status": row.status,
                "summary": daten.get("summary"),
                "created_at": _iso(row.created_at),
                "expires_at": _iso(row.expires_at),
            }
            if daten.get("version") == 2:
                eintrag["edits"] = [
                    {
                        "op": str(teil.get("op") or ""),
                        "summary": str(teil.get("summary") or "")[:200] or None,
                        "target": {
                            "index": (teil.get("target") or {}).get("index"),
                            "fingerprint": (teil.get("target") or {}).get("fingerprint"),
                        },
                    }
                    for teil in (daten.get("edits") or [])
                    if isinstance(teil, dict)
                ]
            else:
                eintrag["anchor_quote"] = (daten.get("anchor") or {}).get("quote")
            eintraege.append(eintrag)
        return {"pending_edits": eintraege}

    @staticmethod
    def preview(db: Session, user: User, doc_uid: str, pending_uid: str) -> dict:
        doc = _dokument(db, doc_uid)
        docs_access.require_role(db, user, doc, "editor")
        row = (
            db.query(DocPendingEdit)
            .filter(
                DocPendingEdit.pending_uid == pending_uid,
                DocPendingEdit.document_id == doc.id,
                DocPendingEdit.user_id == user.id,
            )
            .first()
        )
        if row is None:
            raise fehler(404, "DOC_AI_PENDING_NOT_FOUND", "Vorschlag nicht gefunden")
        if row.status not in OFFENE_STATUS:
            raise fehler(409, "DOC_AI_PENDING_DONE", "Vorschlag ist bereits entschieden")
        daten = _payload(row, doc)
        try:
            if daten.get("version") == 2:
                vorschau = DocsCollabService.ai_preview(
                    db,
                    user,
                    doc.doc_uid,
                    edits=daten.get("edits") or [],
                    run_id=row.run_id,
                    call_id=row.call_id,
                )
                return {
                    "uid": row.pending_uid,
                    "html": vorschau.get("html") or "",
                    "previews": vorschau.get("edits") or [],
                    "target_block": None,
                    "target_index": None,
                }
            vorschau = DocsCollabService.ai_preview(
                db,
                user,
                doc.doc_uid,
                operation=row.operation,
                markdown=str(daten.get("markdown") or ""),
                anchor=daten.get("anchor"),
                expected_block=daten.get("target_block"),
                run_id=row.run_id,
                call_id=row.call_id,
            )
        except HTTPException as exc:
            if exc.status_code in (409, 422):
                row.status = "stale"
                row.resolved_at = _now()
                db.commit()
            raise
        return {
            "uid": row.pending_uid,
            "html": vorschau.get("html") or "",
            "target_block": vorschau.get("target_block"),
            "target_index": vorschau.get("target_index"),
        }

    @staticmethod
    def apply(db: Session, user: User, doc_uid: str, pending_uid: str) -> dict:
        doc = _dokument(db, doc_uid)
        docs_access.require_role(db, user, doc, "editor")
        beansprucht = (
            db.query(DocPendingEdit)
            .filter(
                DocPendingEdit.pending_uid == pending_uid,
                DocPendingEdit.document_id == doc.id,
                DocPendingEdit.user_id == user.id,
                DocPendingEdit.status == "pending",
                DocPendingEdit.expires_at > _now(),
            )
            .update(
                {
                    DocPendingEdit.status: "applying",
                    DocPendingEdit.applying_at: _now(),
                },
                synchronize_session=False,
            )
        )
        db.commit()
        if not beansprucht:
            raise fehler(
                409,
                "DOC_AI_PENDING_DONE",
                "Der Vorschlag ist bereits entschieden oder wird gerade uebernommen",
            )
        row = (
            db.query(DocPendingEdit)
            .filter(DocPendingEdit.pending_uid == pending_uid)
            .first()
        )
        if row is None:
            raise fehler(404, "DOC_AI_PENDING_NOT_FOUND", "Vorschlag nicht gefunden")
        try:
            daten = _payload(row, doc)
        except HTTPException:
            row.status = "pending"
            row.applying_at = None
            db.commit()
            raise
        try:
            if daten.get("version") == 2:
                ergebnis = DocsCollabService.ai_edit(
                    db,
                    user,
                    doc.doc_uid,
                    edits=daten.get("edits") or [],
                    summary=daten.get("summary"),
                    run_id=row.run_id,
                    call_id=row.call_id,
                )
            else:
                ergebnis = DocsCollabService.ai_edit(
                    db,
                    user,
                    doc.doc_uid,
                    operation=row.operation,
                    markdown=str(daten.get("markdown") or ""),
                    anchor=daten.get("anchor"),
                    summary=daten.get("summary"),
                    expected_block=daten.get("target_block"),
                    run_id=row.run_id,
                    call_id=row.call_id,
                )
        except HTTPException as exc:
            row.status = "stale" if exc.status_code in (409, 422) else "pending"
            row.applying_at = None
            row.resolved_at = _now() if row.status == "stale" else None
            db.commit()
            raise
        except Exception as exc:  # noqa: BLE001 - Status darf nicht haengen
            row.status = "pending"
            row.applying_at = None
            row.resolved_at = None
            db.commit()
            raise fehler(
                503, "DOCS_STORE_FAILED", "Dokumentserver hat die Aenderung abgelehnt"
            ) from exc
        db.refresh(doc)
        row.status = "applied"
        row.applied_rev = doc.rev
        row.applying_at = None
        row.resolved_at = _now()
        db.commit()
        _melden(doc, row, "ai_pending_applied")
        return {"rev": doc.rev, "pending_uid": row.pending_uid, **ergebnis}

    @staticmethod
    def reject(db: Session, user: User, doc_uid: str, pending_uid: str) -> dict:
        doc = _dokument(db, doc_uid)
        docs_access.require_role(db, user, doc, "editor")
        row = (
            db.query(DocPendingEdit)
            .filter(
                DocPendingEdit.pending_uid == pending_uid,
                DocPendingEdit.document_id == doc.id,
                DocPendingEdit.user_id == user.id,
                DocPendingEdit.status.in_(("pending", "stale")),
            )
            .first()
        )
        if row is None:
            raise fehler(404, "DOC_AI_PENDING_NOT_FOUND", "Vorschlag nicht gefunden")
        row.status = "rejected"
        row.applying_at = None
        row.resolved_at = _now()
        db.commit()
        _melden(doc, row, "ai_pending_rejected")
        return {"rejected": True, "pending_uid": row.pending_uid}
