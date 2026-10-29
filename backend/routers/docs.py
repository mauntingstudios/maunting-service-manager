"""REST-Router fuer das Dokumente-Modul."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, verify_csrf
from models.user import User
from schemas.docs import (
    AssetUpload,
    CommentCreate,
    CommentUpdate,
    DocCreate,
    DocFolderCreate,
    DocUpdate,
    MemberPut,
    RevisionCreate,
    ShareCreate,
)
from services.auth_service import AuthService
from services.panel_settings_service import PanelSettingsService
from services.permission_service import has_global_permission
from services.docs_collab_service import DocsCollabService
from services.docs_service import DocsService, fehler

router = APIRouter(prefix="/api/docs", tags=["docs"])


def _check_docs_enabled() -> None:
    if PanelSettingsService.get("docs_enabled", "true") == "false":
        raise fehler(403, "DOCS_DISABLED", "Das Dokumente-Modul ist deaktiviert")


def _docs_user(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> User:
    _check_docs_enabled()
    if not has_global_permission(db, user, "docs.use"):
        raise fehler(403, "DOCS_FORBIDDEN", "Kein Zugriff auf Dokumente")
    return user


def _session_claims(request: Request) -> tuple[str | None, str | None]:
    token = None
    auth = request.headers.get("authorization", "")
    if auth[:7].lower() == "bearer ":
        token = auth[7:].strip()
    token = token or request.cookies.get("__Secure-access_token")
    if not token:
        return None, None
    payload = AuthService.decode_token(token) or {}
    return payload.get("familie"), payload.get("jti")


@router.get("/status")
def get_status(_: User = Depends(_docs_user)) -> dict[str, Any]:
    gesundheit = DocsCollabService.health()
    return {
        "enabled": True,
        "sidecar_ok": bool(gesundheit.get("sidecar_ok")),
        "sidecar_version": gesundheit.get("version"),
        "limits": {
            "state_bytes": 4 * 1024 * 1024,
            "title_chars": 200,
            "asset_bytes": 4 * 1024 * 1024,
            "assets_per_doc": 100,
            "documents_per_team": 2000,
            "revisions_per_doc": 100,
            "collab_token_minutes": 30,
        },
    }


# ── Ordner ───────────────────────────────────────────────────────────


@router.get("/folders")
def list_folders(
    team_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> list[dict]:
    return DocsService.list_folders(db, user, team_id)


@router.post("/folders", status_code=201)
def create_folder(
    req: DocFolderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.create_folder(
        db, user, team_id=req.team_id, parent_uid=req.parent_uid, name=req.name
    )


@router.patch("/folders/{folder_uid}")
def update_folder(
    folder_uid: str,
    req: dict[str, Any],
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.update_folder(
        db,
        user,
        folder_uid,
        name=req.get("name"),
        parent_uid=req.get("parent_uid") if "parent_uid" in req else None,
    )


@router.delete("/folders/{folder_uid}")
def delete_folder(
    folder_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.delete_folder(db, user, folder_uid)


# ── Oeffentliche Hilfswege ───────────────────────────────────────────


@router.post("/shared/{token}/claim")
def claim_share(
    token: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.claim_share(db, user, token)


@router.get("/assets/{asset_uid}/content")
def get_asset_content(
    asset_uid: str,
    doc: str = Query(...),
    token: str = Query(...),
    expires: int = Query(...),
    user_id: int = Query(...),
    db: Session = Depends(get_db),
) -> Response:
    asset, _, roh = DocsService.asset_content(
        db, asset_uid=asset_uid, doc_uid=doc, token=token, expires=expires, user_id=user_id
    )
    return Response(
        content=roh,
        media_type=asset.mime,
        headers={
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── Dokumente ────────────────────────────────────────────────────────


@router.get("")
def list_documents(
    team_id: int | None = Query(None),
    folder_uid: str | None = Query(None),
    search: str | None = Query(None),
    archived: bool = Query(False),
    trash: bool = Query(False),
    member: str | None = Query(None),
    limit: int = Query(100, ge=1, le=200),
    cursor: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> list[dict]:
    if search:
        return DocsService.search_documents(db, user, search, limit=limit)
    return DocsService.list_documents(
        db,
        user,
        team_id=team_id,
        folder_uid=folder_uid,
        archived=archived,
        trash=trash,
        member=member,
        limit=limit,
        cursor=cursor,
    )


@router.post("", status_code=201)
def create_document(
    req: DocCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.create_document(
        db, user, team_id=req.team_id, folder_uid=req.folder_uid, title=req.title
    )


@router.get("/{doc_uid}")
def get_document(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> dict:
    return DocsService.get_document(db, user, doc_uid)


@router.patch("/{doc_uid}")
def update_document(
    doc_uid: str,
    req: DocUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.update_document(db, user, doc_uid, req.model_dump(exclude_unset=True))


@router.delete("/{doc_uid}")
def trash_document(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.trash_document(db, user, doc_uid)


@router.post("/{doc_uid}/restore")
def restore_document(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.restore_document(db, user, doc_uid)


@router.delete("/{doc_uid}/permanent")
def delete_permanent(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.delete_permanent(db, user, doc_uid)


@router.post("/{doc_uid}/duplicate", status_code=201)
def duplicate_document(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.duplicate_document(db, user, doc_uid)


# ── Mitglieder und Freigabe ──────────────────────────────────────────


@router.get("/{doc_uid}/members")
def list_members(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> list[dict]:
    return DocsService.list_members(db, user, doc_uid)


@router.put("/{doc_uid}/members/{target_user_id}")
def put_member(
    doc_uid: str,
    target_user_id: int,
    req: MemberPut,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.put_member(db, user, doc_uid, target_user_id, req.role)


@router.delete("/{doc_uid}/members/{target_user_id}")
def delete_member(
    doc_uid: str,
    target_user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.delete_member(db, user, doc_uid, target_user_id)


@router.post("/{doc_uid}/share")
def create_share(
    doc_uid: str,
    req: ShareCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.create_share(
        db, user, doc_uid, role=req.role, expires_in_days=req.expires_in_days
    )


@router.delete("/{doc_uid}/share")
def delete_share(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.delete_share(db, user, doc_uid)


# ── Kommentare ───────────────────────────────────────────────────────


@router.get("/{doc_uid}/comments")
def list_comments(
    doc_uid: str,
    status: str | None = Query(None, pattern="^(open|resolved)$"),
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> list[dict]:
    return DocsService.list_comments(db, user, doc_uid, status=status)


@router.post("/{doc_uid}/comments", status_code=201)
def create_comment(
    doc_uid: str,
    req: CommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.create_comment(
        db, user, doc_uid, body=req.body, parent_uid=req.parent_uid, anchor=req.anchor
    )


@router.patch("/{doc_uid}/comments/{comment_uid}")
def update_comment(
    doc_uid: str,
    comment_uid: str,
    req: CommentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.update_comment(
        db, user, doc_uid, comment_uid, body=req.body, status=req.status
    )


@router.delete("/{doc_uid}/comments/{comment_uid}")
def delete_comment(
    doc_uid: str,
    comment_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.delete_comment(db, user, doc_uid, comment_uid)


# ── Revisionen ───────────────────────────────────────────────────────


@router.get("/{doc_uid}/revisions")
def list_revisions(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> list[dict]:
    return DocsService.list_revisions(db, user, doc_uid)


@router.post("/{doc_uid}/revisions", status_code=201)
def create_revision(
    doc_uid: str,
    req: RevisionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsCollabService.create_checkpoint(db, user, doc_uid, label=req.label)


@router.get("/{doc_uid}/revisions/{rev}")
def get_revision(
    doc_uid: str,
    rev: int,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> dict:
    return DocsService.get_revision(db, user, doc_uid, rev)


@router.post("/{doc_uid}/revisions/{rev}/restore")
def restore_revision(
    doc_uid: str,
    rev: int,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsCollabService.restore(db, user, doc_uid, rev)


@router.post("/{doc_uid}/ai-undo")
def undo_ai_edit(
    doc_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsCollabService.undo_ai(db, user, doc_uid)


@router.post("/{doc_uid}/collab-token")
def collab_token(
    doc_uid: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    from services.docs_access import access_or_404

    doc = DocsService.access(db, user, doc_uid).document
    fam, jti = _session_claims(request)
    return DocsCollabService.issue_token(db, user, doc, fam=fam, jti=jti)


# ── Assets und Export ────────────────────────────────────────────────


@router.post("/{doc_uid}/assets", status_code=201)
def upload_asset(
    doc_uid: str,
    req: AssetUpload,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.upload_asset(
        db,
        user,
        doc_uid,
        file_name=req.file_name,
        mime=req.mime,
        data_base64=req.data_base64,
        sha256=req.sha256,
    )


@router.get("/{doc_uid}/assets/{asset_uid}/signed-url")
def asset_signed_url(
    doc_uid: str,
    asset_uid: str,
    ttl: int = Query(3600, ge=60, le=86400),
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> dict:
    url, expires = DocsService.asset_signed_url(db, user, doc_uid, asset_uid, ttl)
    return {"signed_url": url, "expires_at": expires.isoformat()}


@router.delete("/{doc_uid}/assets/{asset_uid}")
def delete_asset(
    doc_uid: str,
    asset_uid: str,
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
    __=Depends(verify_csrf),
) -> dict:
    return DocsService.delete_asset(db, user, doc_uid, asset_uid)


@router.get("/{doc_uid}/export")
def export_document(
    doc_uid: str,
    format: str = Query("html", pattern="^(html|md|txt)$"),
    rev: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(_docs_user),
) -> Response:
    inhalt, mime, dateiname = DocsCollabService.render(
        db, user, doc_uid, format=format, rev=rev
    )
    return Response(
        content=inhalt,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{dateiname}"'},
    )
