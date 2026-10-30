"""Kollaborations-Pipeline: Collab-Token, Zustand laden/speichern, Revisionen.

Der Sidecar ist reine Yjs-Ausfuehrungsschicht. Rechte, Persistenz, Rev und
Verschluesselung bleiben hier.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import base64
import binascii
from html import escape as _html_escape
import re
import uuid

import httpx
from fastapi import HTTPException
from jose import jwt
from sqlalchemy.orm import Session

from config import settings
from models.doc import DocRevision, Document
from models.refresh_token import RefreshToken
from models.user import User
from services import docs_access
from services.docs_crypto import (
    DocCryptoError,
    aad_asset,
    aad_revision,
    aad_text,
    decrypt_blob,
    decrypt_revision_state,
    decrypt_state,
    decrypt_text,
    encrypt_revision_state,
    encrypt_state,
    encrypt_text,
    sha256_hex,
)
from services.docs_service import (
    DocsService,
    fehler,
    _enc,
    _inhalt_text,
    _publish,
)


COLLAB_TOKEN_TTL_MINUTEN = 30
AUTOSAVE_REVISION_ABSTAND = timedelta(minutes=10)
MAX_EXPORT_IMAGE_BYTES = 10 * 1024 * 1024
EXPLIZITE_REVISIONEN = {
    "initial",
    "checkpoint",
    "ai_pre_edit",
    "ai_edit",
    "ai_undo",
    "before_restore",
    "restore",
    "import",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _secret() -> str:
    return settings.docs_collab_secret or settings.secret_key


def _headers() -> dict[str, str]:
    if settings.docs_sidecar_token:
        return {"Authorization": f"Bearer {settings.docs_sidecar_token}"}
    return {}


def _sidecar_url(pfad: str) -> str:
    return settings.docs_sidecar_url.rstrip("/") + pfad


def _call_sidecar(pfad: str, payload: dict, *, timeout: float = 10.0) -> dict:
    try:
        antwort = httpx.post(
            _sidecar_url(pfad), json=payload, headers=_headers(), timeout=timeout
        )
    except httpx.HTTPError as exc:
        raise fehler(503, "DOCS_SIDECAR_UNAVAILABLE", "Dokumentserver nicht erreichbar") from exc
    if antwort.status_code == 404:
        raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument ist nicht geladen")
    if antwort.status_code in (409, 422):
        try:
            detail = antwort.json()
        except ValueError:
            detail = {}
        extra: dict[str, object] = {}
        if detail.get("candidates"):
            extra["candidates"] = detail["candidates"]
        if detail.get("edit_index") is not None:
            extra["edit_index"] = detail["edit_index"]
        raise fehler(
            antwort.status_code,
            str(detail.get("code") or "AI_EDIT_STALE_SELECTION"),
            str(detail.get("error") or "Die Textstelle ist nicht mehr eindeutig"),
            **extra,
        )
    if antwort.status_code >= 400:
        raise fehler(503, "DOCS_STORE_FAILED", "Dokumentserver hat abgelehnt")
    try:
        return antwort.json()
    except ValueError as exc:
        raise fehler(503, "DOCS_STORE_FAILED", "Ungueltige Antwort vom Dokumentserver") from exc


def _familie_aktiv(db: Session, familie: str | None) -> bool:
    if not familie:
        return True
    basis = db.query(RefreshToken.id).filter(RefreshToken.family == str(familie))
    if basis.filter(RefreshToken.revoked_at.is_(None)).first() is not None:
        return True
    return basis.first() is None


class DocsCollabService:
    # ── Token ────────────────────────────────────────────────────────

    @staticmethod
    def issue_token(
        db: Session, user: User, doc: Document, *, fam: str | None, jti: str | None
    ) -> dict:
        zugriff = docs_access.access_or_404(db, user, doc)
        ablauf = _now() + timedelta(minutes=COLLAB_TOKEN_TTL_MINUTEN)
        claims = {
            "iss": "msm",
            "aud": "msm-docs",
            "sub": str(user.id),
            "doc": doc.doc_uid,
            "team": doc.team_id,
            "role": zugriff.role,
            "ro": not zugriff.can_edit,
            "fam": fam or "",
            "jti": jti or str(uuid.uuid4()),
            "exp": int(ablauf.timestamp()),
        }
        token = jwt.encode(claims, _secret(), algorithm="HS256")
        return {
            "url": settings.docs_collab_public_url or "",
            "token": token,
            "expires_at": _iso(ablauf),
            "readonly": not zugriff.can_edit,
            "role": zugriff.role,
            "rev": doc.rev,
        }

    # ── Sidecar-Rueckfragen ──────────────────────────────────────────

    @staticmethod
    def authorize(
        db: Session, *, doc_uid: str, user_id: int, role: str, fam: str | None
    ) -> dict:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            raise fehler(403, "DOCS_FORBIDDEN", "Konto ist inaktiv")
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        zugriff = docs_access.resolve_access(db, user, doc)
        if zugriff is None:
            raise fehler(403, "DOCS_FORBIDDEN", "Kein Zugriff auf das Dokument")
        if not _familie_aktiv(db, fam) and not user.is_owner:
            raise fehler(403, "DOCS_FORBIDDEN", "Sitzung wurde beendet")
        return {
            "ok": True,
            "readonly": not zugriff.can_edit,
            "role": zugriff.role,
            "team_id": doc.team_id,
            "rev": doc.rev,
            "module_enabled": DocsCollabService.module_enabled(),
            "user": {"id": user.id, "username": user.username},
            "state_sha256": doc.state_sha256,
            "schema_version": doc.schema_version,
        }

    @staticmethod
    def load_state(db: Session, doc_uid: str) -> dict:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        if not doc.state_encrypted:
            return {
                "state_b64": "",
                "rev": doc.rev,
                "schema_version": doc.schema_version,
                "state_sha256": doc.state_sha256,
            }
        try:
            roh = decrypt_state(doc.state_encrypted, doc.doc_uid)
        except DocCryptoError as exc:
            raise fehler(503, "DOCS_STORE_FAILED", "Dokumentzustand nicht entschluesselbar") from exc
        return {
            "state_b64": base64.b64encode(roh).decode("ascii"),
            "rev": doc.rev,
            "schema_version": doc.schema_version,
            "state_sha256": doc.state_sha256,
        }

    @staticmethod
    def store(db: Session, doc_uid: str, daten: dict) -> dict:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")

        author_id = daten.get("author_user_id")
        author: User | None = None
        origin = str(daten.get("origin") or "autosave")
        ist_ki = origin.startswith("ai:") or str(daten.get("reason") or "").startswith("ai_")
        if author_id is not None:
            author = db.get(User, int(author_id))
            if author is None or not author.is_active:
                raise fehler(403, "DOCS_FORBIDDEN", "Autor ist nicht aktiv")
            if not _familie_aktiv(db, daten.get("author_family")):
                raise fehler(403, "DOCS_FORBIDDEN", "Sitzung des Autors wurde beendet")
            zugriff = docs_access.resolve_access(db, author, doc)
            if zugriff is None or not zugriff.can_edit:
                raise fehler(403, "DOCS_READ_ONLY", "Autor darf das Dokument nicht mehr schreiben")
        elif not ist_ki:
            raise fehler(403, "DOCS_FORBIDDEN", "Speichern ohne Autor ist nur fuer KI erlaubt")

        try:
            roh = base64.b64decode(daten["state_b64"], validate=True)
        except (binascii.Error, KeyError) as exc:
            raise fehler(422, "DOC_INVALID_TARGET", "Zustand ist nicht base64-kodiert") from exc
        if len(roh) > 4 * 1024 * 1024:
            raise fehler(413, "DOC_TOO_LARGE", "Dokumentzustand groesser als 4 MiB")
        if sha256_hex(roh) != str(daten.get("state_sha256", "")).lower():
            raise fehler(422, "DOC_INVALID_TARGET", "Pruefsumme passt nicht zum Zustand")

        neuer_hash = sha256_hex(roh)
        if doc.state_sha256 == neuer_hash and doc.state_encrypted:
            revision_rev = None
            if daten.get("force_revision"):
                revision_rev = DocsCollabService._revision_anlegen(
                    db,
                    doc,
                    roh,
                    rev=doc.rev,
                    reason=str(daten.get("reason") or "checkpoint"),
                    author_user_id=author_id,
                    ai_run_id=daten.get("ai_run_id"),
                    summary=daten.get("summary"),
                    content_text=str(daten.get("content_text") or ""),
                    ist_ki=ist_ki,
                )
                db.commit()
            return {"stored": False, "rev": doc.rev, "revision_rev": revision_rev}

        inhalt = str(daten.get("content_text") or "")
        abgeschnitten = bool(daten.get("content_truncated"))
        if len(inhalt) > 1_000_000:
            inhalt = inhalt[:1_000_000]
            abgeschnitten = True

        # Erst verschluesseln, dann mutieren: bei DIS-Ausfall bleibt der alte
        # Zustand unangetastet und der Aufrufer bekommt 503.
        neuer_state = _enc(encrypt_state, roh, doc.doc_uid)
        neuer_text = _enc(encrypt_text, inhalt, aad_text(doc.doc_uid))

        doc.rev += 1
        neuer_rev = doc.rev
        doc.state_encrypted = neuer_state
        doc.state_bytes = len(roh)
        doc.state_sha256 = neuer_hash
        doc.schema_version = int(daten.get("schema_version") or doc.schema_version)
        doc.content_text_encrypted = neuer_text
        doc.content_chars = len(inhalt)
        doc.content_truncated = abgeschnitten
        doc.updated_at = _now()
        doc.last_edited_at = doc.updated_at

        reason = str(daten.get("reason") or ("ai_edit" if ist_ki else "autosave"))
        if neuer_rev == 1:
            reason = "initial"
        elif reason not in EXPLIZITE_REVISIONEN and reason != "autosave":
            reason = "autosave"
        letzte = (
            db.query(DocRevision)
            .filter(DocRevision.document_id == doc.id)
            .order_by(DocRevision.created_at.desc())
            .first()
        )
        braucht_revision = (
            reason in EXPLIZITE_REVISIONEN
            or letzte is None
            or (reason == "autosave" and _now() - _aware(letzte.created_at) >= AUTOSAVE_REVISION_ABSTAND)
        )

        revision_rev: int | None = None
        if braucht_revision:
            revision_rev = DocsCollabService._revision_anlegen(
                db,
                doc,
                roh,
                rev=neuer_rev,
                reason=reason,
                author_user_id=author_id,
                ai_run_id=daten.get("ai_run_id"),
                summary=daten.get("summary"),
                content_text=inhalt,
                ist_ki=ist_ki,
            )

        db.commit()
        db.refresh(doc)
        _publish(
            "stored",
            doc,
            user_id=author_id,
            updated_at=_iso(doc.updated_at),
            last_edited_by=author.username if author else ("Singra" if ist_ki else None),
        )
        return {"stored": True, "rev": doc.rev, "revision_rev": revision_rev}

    @staticmethod
    def _zustand(daten: dict, *, prefix: str = "") -> bytes:
        """Liest und prueft einen Zustand aus der internen Nutzlast."""
        feld = "state_b64" if not prefix else f"{prefix}_state_b64"
        hash_feld = "state_sha256" if not prefix else f"{prefix}_state_sha256"
        try:
            roh = base64.b64decode(daten[feld], validate=True)
        except (binascii.Error, KeyError, TypeError) as exc:
            raise fehler(422, "DOC_INVALID_TARGET", "Zustand ist nicht base64-kodiert") from exc
        if len(roh) > 4 * 1024 * 1024:
            raise fehler(413, "DOC_TOO_LARGE", "Dokumentzustand groesser als 4 MiB")
        if sha256_hex(roh) != str(daten.get(hash_feld, "")).lower():
            raise fehler(422, "DOC_INVALID_TARGET", "Pruefsumme passt nicht zum Zustand")
        return roh

    @staticmethod
    def ai_store(db: Session, doc_uid: str, daten: dict) -> dict:
        """Schreibt Vorher-Revision, neuen Zustand und KI-Revision in einem Commit.

        Die frueheren zwei Stores (``ai_pre_edit``, ``ai_edit``) liessen
        entweder eine Revision ohne Aenderung zurueck oder eine Aenderung ohne
        Revision. Hier gilt: entweder beides oder nichts.
        """
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")

        origin = str(daten.get("origin") or "")
        if not origin.startswith("ai:"):
            raise fehler(403, "DOCS_FORBIDDEN", "Nur KI-Aenderungen laufen ueber diesen Weg")
        author_id = daten.get("author_user_id")
        if author_id is None:
            raise fehler(403, "DOCS_FORBIDDEN", "KI-Aenderung ohne Autor")
        author = db.get(User, int(author_id))
        if author is None or not author.is_active:
            raise fehler(403, "DOCS_FORBIDDEN", "Autor ist nicht aktiv")
        if not _familie_aktiv(db, daten.get("author_family")):
            raise fehler(403, "DOCS_FORBIDDEN", "Sitzung des Autors wurde beendet")
        zugriff = docs_access.resolve_access(db, author, doc)
        if zugriff is None or not zugriff.can_edit:
            raise fehler(403, "DOCS_READ_ONLY", "Autor darf das Dokument nicht mehr schreiben")

        pre_roh = DocsCollabService._zustand(daten, prefix="pre")
        post_roh = DocsCollabService._zustand(daten)
        post_hash = sha256_hex(post_roh)

        # Wiederholung nach verlorener Antwort: der Zustand steht schon.
        if doc.state_sha256 == post_hash and doc.state_encrypted:
            return {
                "stored": False,
                "already": True,
                "rev": doc.rev,
                "revision_rev": None,
            }

        inhalt = str(daten.get("content_text") or "")
        abgeschnitten = bool(daten.get("content_truncated"))
        if len(inhalt) > 1_000_000:
            inhalt = inhalt[:1_000_000]
            abgeschnitten = True
        pre_inhalt = str(daten.get("pre_content_text") or "")

        try:
            neuer_state = _enc(encrypt_state, post_roh, doc.doc_uid)
            neuer_text = _enc(encrypt_text, inhalt, aad_text(doc.doc_uid))
            pre_rev = DocsCollabService._revision_anlegen(
                db,
                doc,
                pre_roh,
                rev=doc.rev,
                reason="ai_pre_edit",
                author_user_id=author.id,
                ai_run_id=daten.get("ai_run_id"),
                summary="Vor KI-Aenderung",
                content_text=pre_inhalt,
                ist_ki=True,
            )
            doc.rev += 1
            neuer_rev = doc.rev
            doc.state_encrypted = neuer_state
            doc.state_bytes = len(post_roh)
            doc.state_sha256 = post_hash
            doc.schema_version = int(daten.get("schema_version") or doc.schema_version)
            doc.content_text_encrypted = neuer_text
            doc.content_chars = len(inhalt)
            doc.content_truncated = abgeschnitten
            doc.updated_at = _now()
            doc.last_edited_at = doc.updated_at
            ai_rev = DocsCollabService._revision_anlegen(
                db,
                doc,
                post_roh,
                rev=neuer_rev,
                reason="ai_edit",
                author_user_id=author.id,
                ai_run_id=daten.get("ai_run_id"),
                summary=str(daten.get("summary") or "KI-Aenderung"),
                content_text=inhalt,
                ist_ki=True,
            )
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:  # noqa: BLE001 - Zustand darf nicht halb stehen
            db.rollback()
            raise fehler(
                503, "DOCS_STORE_FAILED", "KI-Aenderung konnte nicht gespeichert werden"
            ) from exc

        db.refresh(doc)
        _publish(
            "stored",
            doc,
            user_id=author.id,
            updated_at=_iso(doc.updated_at),
            last_edited_by="Singra",
        )
        return {
            "stored": True,
            "rev": doc.rev,
            "revision_rev": ai_rev,
            "pre_revision_rev": pre_rev,
            "edits_applied": int(daten.get("edits_applied") or 0),
        }

    @staticmethod
    def _revision_anlegen(
        db: Session,
        doc: Document,
        roh: bytes,
        *,
        rev: int,
        reason: str,
        author_user_id: int | None,
        ai_run_id: str | None,
        summary: str | None,
        content_text: str,
        ist_ki: bool,
    ) -> int | None:
        """Legt eine Version an, sofern diese Rev noch keine hat."""
        vorhanden = (
            db.query(DocRevision.id)
            .filter(DocRevision.document_id == doc.id, DocRevision.rev == rev)
            .first()
        )
        if vorhanden is not None:
            return None
        if reason not in EXPLIZITE_REVISIONEN:
            reason = "autosave"
        label = (summary or "").strip()[:200] or None
        revision = DocRevision(
            document_id=doc.id,
            rev=rev,
            reason=reason,
            label_encrypted=(
                _enc(encrypt_text, label, aad_revision(doc.doc_uid, rev, "label"))
                if label
                else None
            ),
            state_encrypted=_enc(encrypt_revision_state, roh, doc.doc_uid, rev),
            state_bytes=len(roh),
            state_sha256=sha256_hex(roh),
            preview_text_encrypted=(
                _enc(encrypt_text, content_text[:2000], aad_revision(doc.doc_uid, rev, "preview"))
                if content_text
                else None
            ),
            author_user_id=author_user_id,
            author_kind="ai" if ist_ki else ("system" if author_user_id is None else "user"),
            ai_run_id=ai_run_id,
            created_at=_now(),
        )
        db.add(revision)
        DocsService.prune_revisions(db, doc)
        return rev

    # ── Explizite Aktionen ───────────────────────────────────────────

    @staticmethod
    def create_checkpoint(
        db: Session, user: User, doc_uid: str, *, label: str | None
    ) -> dict:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        docs_access.require_role(db, user, doc, "editor")
        ergebnis = _call_sidecar(
            f"/internal/docs/{doc_uid}/checkpoint",
            {
                "user_id": user.id,
                "family": _family_for_user(db, user.id),
                "label": label,
                "reason": "checkpoint",
            },
            timeout=20.0,
        )
        db.refresh(doc)
        return {"rev": doc.rev, **ergebnis}

    @staticmethod
    def restore(
        db: Session, user: User, doc_uid: str, rev: int
    ) -> dict:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        docs_access.require_role(db, user, doc, "editor")
        ziel = (
            db.query(DocRevision)
            .filter(DocRevision.document_id == doc.id, DocRevision.rev == rev)
            .first()
        )
        if ziel is None:
            raise fehler(404, "REVISION_NOT_FOUND", "Revision nicht gefunden")
        try:
            roh = decrypt_revision_state(ziel.state_encrypted, doc.doc_uid, ziel.rev)
        except DocCryptoError as exc:
            raise fehler(409, "DOC_RESTORE_CONFLICT", "Revision nicht entschluesselbar") from exc
        ergebnis = _call_sidecar(
            f"/internal/docs/{doc_uid}/restore",
            {
                "rev": rev,
                "state_b64": base64.b64encode(roh).decode("ascii"),
                "state_sha256": ziel.state_sha256,
                "user_id": user.id,
                "family": _family_for_user(db, user.id),
            },
            timeout=30.0,
        )
        db.refresh(doc)
        _publish("restored", doc, user_id=user.id, restarted_from=rev)
        return {"rev": doc.rev, **ergebnis}

    @staticmethod
    def undo_ai(db: Session, user: User, doc_uid: str) -> dict:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        docs_access.require_role(db, user, doc, "editor")
        ergebnis = _call_sidecar(
            f"/internal/docs/{doc_uid}/undo-ai",
            {"user_id": user.id, "family": _family_for_user(db, user.id)},
            timeout=20.0,
        )
        if not ergebnis.get("undone", True):
            raise fehler(
                409,
                str(ergebnis.get("code") or "AI_UNDO_EMPTY"),
                "Es gibt keine KI-Aenderung dieses Nutzers zum Rueckgaengigmachen",
            )
        db.refresh(doc)
        _publish("ai_edit", doc, user_id=user.id, undo=True)
        return {"rev": doc.rev, **ergebnis}

    @staticmethod
    def _ai_edits(
        edits: list[dict] | None,
        *,
        operation: str | None,
        markdown: str,
        anchor: dict | None,
        expected_block: str | None,
    ) -> list[dict]:
        """Batch oder Altaufruf; der Altaufruf bleibt ein Ein-Element-Batch."""
        if edits is not None:
            if not edits:
                raise fehler(422, "DOC_INVALID_TARGET", "Keine Aenderungen")
            return edits
        if operation not in ("append", "replace_block"):
            raise fehler(422, "DOC_INVALID_TARGET", "Unbekannte Operation")
        eintrag: dict[str, object] = {
            "op": operation,
            "markdown": (markdown or "")[:20_000],
            "target": anchor or {},
        }
        if expected_block is not None:
            eintrag["expected_text"] = expected_block
        return [eintrag]

    @staticmethod
    def document_structure(
        db: Session, user: User, doc_uid: str, *, offset: int = 0, limit: int = 120
    ) -> dict:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        docs_access.require_role(db, user, doc, "viewer")
        daten = _call_sidecar(
            f"/internal/docs/{doc_uid}/structure",
            {
                "offset": max(0, int(offset)),
                "limit": min(300, max(1, int(limit))),
                "user_id": user.id,
                "family": _family_for_user(db, user.id),
            },
            timeout=20.0,
        )
        return {"uid": doc.doc_uid, "rev": doc.rev, **daten}

    @staticmethod
    def ai_preview(
        db: Session,
        user: User,
        doc_uid: str,
        *,
        operation: str | None = None,
        markdown: str = "",
        anchor: dict | None = None,
        expected_block: str | None = None,
        run_id: str | None = None,
        call_id: str | None = None,
        edits: list[dict] | None = None,
    ) -> dict:
        """Prueft KI-Aenderungen, ohne das Dokument anzufassen.

        Der Sidecar wendet sie auf einen Klon an und rendert die
        vorgeschlagenen Bloecke. Es entsteht keine Revision, kein Broadcast und
        kein gespeicherter Zustand.
        """
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        docs_access.require_role(db, user, doc, "editor")
        liste = DocsCollabService._ai_edits(
            edits,
            operation=operation,
            markdown=markdown,
            anchor=anchor,
            expected_block=expected_block,
        )
        nutzlast: dict[str, object] = {
            "edits": liste,
            "run_id": run_id,
            "call_id": call_id,
            "user_id": user.id,
            "family": _family_for_user(db, user.id),
        }
        # Ein alter Sidecar kennt nur den Einzelaufruf. Beim Rollout bleibt
        # dieser Weg deshalb fuer genau eine Aenderung mitgesendet.
        if len(liste) == 1:
            einzeln = liste[0]
            nutzlast.update(
                {
                    "operation": einzeln.get("op"),
                    "markdown": einzeln.get("markdown") or "",
                    "anchor": einzeln.get("target") or {},
                    "expected_block": einzeln.get("expected_text"),
                }
            )
        return _call_sidecar(
            f"/internal/docs/{doc_uid}/ai-preview", nutzlast, timeout=30.0
        )

    @staticmethod
    def ai_edit(
        db: Session,
        user: User,
        doc_uid: str,
        *,
        operation: str | None = None,
        markdown: str = "",
        anchor: dict | None = None,
        run_id: str | None = None,
        call_id: str | None = None,
        summary: str | None = None,
        expected_block: str | None = None,
        edits: list[dict] | None = None,
    ) -> dict:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None or doc.deleted_at is not None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        docs_access.require_role(db, user, doc, "editor")
        liste = DocsCollabService._ai_edits(
            edits,
            operation=operation,
            markdown=markdown,
            anchor=anchor,
            expected_block=expected_block,
        )
        nutzlast: dict[str, object] = {
            "edits": liste,
            "summary": summary,
            "run_id": run_id,
            "call_id": call_id,
            "user_id": user.id,
            "family": _family_for_user(db, user.id),
        }
        if len(liste) == 1:
            einzeln = liste[0]
            nutzlast.update(
                {
                    "operation": einzeln.get("op"),
                    "markdown": einzeln.get("markdown") or "",
                    "anchor": einzeln.get("target") or {},
                    "expected_block": einzeln.get("expected_text"),
                }
            )
        return _call_sidecar(
            f"/internal/docs/{doc_uid}/ai-edit", nutzlast, timeout=60.0
        )

    @staticmethod
    def render(
        db: Session, user: User, doc_uid: str, *, format: str, rev: int | None = None
    ) -> tuple[bytes, str, str]:
        doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
        if doc is None:
            raise fehler(404, "DOCUMENT_NOT_FOUND", "Dokument nicht gefunden")
        docs_access.require_role(db, user, doc, "viewer")
        ziel_rev = doc.rev if rev is None else rev
        roh: bytes | None = None
        if rev is not None and rev != doc.rev:
            row = (
                db.query(DocRevision)
                .filter(DocRevision.document_id == doc.id, DocRevision.rev == rev)
                .first()
            )
            if row is None:
                raise fehler(404, "REVISION_NOT_FOUND", "Revision nicht gefunden")
            try:
                roh = decrypt_revision_state(row.state_encrypted, doc.doc_uid, row.rev)
            except DocCryptoError as exc:
                raise fehler(503, "DOCS_STORE_FAILED", "Revision nicht entschluesselbar") from exc

        try:
            ergebnis = _call_sidecar(
                f"/internal/docs/{doc_uid}/render",
                {
                    "format": format,
                    "state_b64": base64.b64encode(roh).decode("ascii") if roh is not None else None,
                    "rev": ziel_rev,
                    "titel": _titel(db, doc),
                },
                timeout=30.0,
            )
            inhalt = ergebnis.get("content") or ""
            mime = ergebnis.get("mime") or "text/plain; charset=utf-8"
            if format == "html":
                inhalt = DocsCollabService._export_html_mit_bildern(db, user, doc, inhalt)
            return inhalt.encode("utf-8"), mime, f"dokument-{doc_uid[:8]}-{ziel_rev}.{format}"
        except HTTPException:
            if format == "txt":
                text = _inhalt_text(doc)
                return text.encode("utf-8"), "text/plain; charset=utf-8", f"dokument-{doc_uid[:8]}.txt"
            raise

    @staticmethod
    def _export_html_mit_bildern(
        db: Session, user: User, doc: Document, html_text: str
    ) -> str:
        """Bettet Dokumentbilder als Data-URL ein, solange das Budget reicht.

        Signed URLs im Export laufen nach einer Stunde ab. Bis 10 MiB Gesamt-
        groesse stehen die Bytes deshalb direkt im HTML; danach bleibt eine
        frische signierte URL mit sichtbarem Hinweis.
        """
        budget = [MAX_EXPORT_IMAGE_BYTES]
        extern = [0]
        basis = (getattr(settings, "api_url", "") or settings.panel_url or "").rstrip("/")

        def ersetzen(match: re.Match[str]) -> str:
            tag = match.group(0)
            uid_match = re.search(r'data-asset-uid="([^"]+)"', tag)
            if not uid_match:
                return tag
            try:
                asset = DocsService._asset(db, doc, uid_match.group(1))
                roh = decrypt_blob(
                    asset.ciphertext_blob, aad_asset(doc.doc_uid, asset.asset_uid)
                )
            except (HTTPException, DocCryptoError):
                return tag
            if len(roh) > budget[0]:
                extern[0] += 1
                url, _ = DocsService.asset_signed_url(db, user, doc.doc_uid, asset.asset_uid)
                ziel = f"{basis}{url}" if basis else url
            else:
                budget[0] -= len(roh)
                mime = _html_escape(asset.mime)
                ziel = f"data:{mime};base64,{base64.b64encode(roh).decode('ascii')}"
            return re.sub(r'src="[^"]*"', lambda _m: f'src="{_html_escape(ziel)}"', tag, count=1)

        ergebnis = re.sub(r"<img\b[^>]*>", ersetzen, html_text, flags=re.IGNORECASE)
        if extern[0]:
            hinweis = (
                '<p class="docs-export-hinweis">'
                f"{extern[0]} Bild(er) sind nur verlinkt, weil das Exportlimit von 10 MiB erreicht ist."
                "</p>"
            )
            if "</body>" in ergebnis:
                ergebnis = ergebnis.replace("</body>", f"{hinweis}</body>", 1)
            else:
                ergebnis += hinweis
        return ergebnis

    @staticmethod
    def module_enabled() -> bool:
        from services.panel_settings_service import PanelSettingsService

        return PanelSettingsService.get("docs_enabled", "true") != "false"

    # ── Best-effort Steuerung ────────────────────────────────────────

    @staticmethod
    def flush() -> None:
        try:
            _call_sidecar("/internal/docs/flush", {}, timeout=20.0)
        except HTTPException:
            pass

    @staticmethod
    def flush_and_disconnect_all() -> None:
        try:
            _call_sidecar("/internal/docs/flush", {}, timeout=20.0)
            _call_sidecar("/internal/docs/disconnect-all", {}, timeout=10.0)
        except HTTPException:
            pass

    @staticmethod
    def disconnect_doc(doc_uid: str) -> None:
        try:
            _call_sidecar(f"/internal/docs/{doc_uid}/disconnect-doc", {}, timeout=5.0)
        except HTTPException:
            pass

    @staticmethod
    def disconnect_user(doc_uid: str, user_id: int) -> None:
        try:
            _call_sidecar(
                f"/internal/docs/{doc_uid}/disconnect-user", {"user_id": user_id}, timeout=5.0
            )
        except HTTPException:
            pass

    @staticmethod
    def health() -> dict:
        try:
            antwort = httpx.get(_sidecar_url("/internal/docs/health"), headers=_headers(), timeout=3.0)
            if antwort.status_code == 200:
                return {"sidecar_ok": True, **antwort.json()}
        except httpx.HTTPError:
            pass
        return {"sidecar_ok": False}


def _aware(dt: datetime | None) -> datetime:
    if dt is None:
        return _now()
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _family_for_user(db: Session, user_id: int) -> str:
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .order_by(RefreshToken.created_at.desc())
        .first()
    )
    return row.family if row else ""


def _titel(db: Session, doc: Document) -> str:
    try:
        return decrypt_text(doc.title_encrypted, f"msm:docs:v1:{doc.doc_uid}:title")
    except Exception:
        return "Dokument"
