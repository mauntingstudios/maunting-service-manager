"""Upload-Rand fuer begrenzte, isoliert validierte AI-Anhaenge."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from database import get_db
from dependencies import require_global, verify_csrf
from models import AiAttachment, User
from schemas.ai_attachment import AiAttachmentResponse
from services import ai_attachment_service, ai_chat_service, permission_service
from services.dis_client import DisSidecarError


router = APIRouter(prefix="/api/ai", tags=["ai-attachments"])


def _response(row: AiAttachment) -> AiAttachmentResponse:
    return AiAttachmentResponse(
        id=row.id, conversation_id=row.conversation_id, message_id=row.message_id,
        original_name=row.original_name, media_type=row.media_type,
        size_bytes=row.size_bytes, status=row.status,
        rejection_code=row.rejection_code, redacted_spans=row.redacted_spans,
        created_at=row.created_at,
    )


def _require_chat(db: Session, user: User) -> None:
    if not permission_service.has_global_permission(db, user, "ai.chat.use"):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")


@router.post(
    "/conversation/attachments",
    response_model=AiAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    file: UploadFile = File(...),
    document_uid: str | None = Query(None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.attachments.use")),
    _: None = Depends(verify_csrf),
) -> AiAttachmentResponse:
    _require_chat(db, user)
    if document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope

        conversation, _, _ = docs_scope(db, user, document_uid)
    else:
        conversation = ai_chat_service.get_or_create_primary_conversation(db, user)
        db.commit()
    data = await file.read(ai_attachment_service.MAX_UPLOAD_BYTES + 1)

    from sqlalchemy import func
    from services import ai_limit_service
    limits = ai_limit_service.resolve_effective_limits(db, user)
    if limits.max_attachment_storage_mb is not None:
        used_bytes = db.query(func.coalesce(func.sum(AiAttachment.size_bytes), 0)).filter(
            AiAttachment.user_id == user.id,
            AiAttachment.status == "ready",
        ).scalar()
        if (used_bytes + len(data)) > limits.max_attachment_storage_mb * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={"code": "storage_limit_exceeded", "max_mb": limits.max_attachment_storage_mb},
            )

    try:
        return _response(ai_attachment_service.create_attachment(
            db, user=user, conversation=conversation, filename=file.filename,
            declared_type=file.content_type, data=data,
        ))
    except ai_attachment_service.AttachmentRejected as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail={"code": exc.code}) from exc
    except DisSidecarError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Anhangspeicher ist nicht verfuegbar") from exc
    finally:
        await file.close()


@router.get("/conversation/attachments", response_model=list[AiAttachmentResponse])
def list_attachments(
    document_uid: str | None = Query(None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.attachments.use")),
) -> list[AiAttachmentResponse]:
    _require_chat(db, user)
    if document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope

        conversation, _, _ = docs_scope(db, user, document_uid)
    else:
        conversation = ai_chat_service.get_or_create_primary_conversation(db, user)
        db.commit()
    return [_response(row) for row in ai_attachment_service.list_owned(
        db, user, conversation.id
    )]


@router.get("/attachments/{attachment_id}/content")
def get_attachment_content(
    attachment_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.attachments.use")),
) -> Response:
    _require_chat(db, user)
    row = ai_attachment_service.get_owned(db, user, attachment_id)
    if row.status != "ready" or not row.content_encrypted:
        raise HTTPException(status_code=404, detail="Anhang nicht bereit")
    import base64
    from services.dis_client import DisClient
    try:
        b64_str = DisClient.decrypt(
            row.content_encrypted, aad=ai_attachment_service._aad(row.id, "content")
        )
        raw_bytes = base64.b64decode(b64_str)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Entschlüsselung fehlgeschlagen") from exc
    return Response(
        content=raw_bytes,
        media_type=row.media_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{row.original_name}"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.attachments.use")),
    _: None = Depends(verify_csrf),
) -> None:
    _require_chat(db, user)
    ai_attachment_service.delete_owned(db, user, attachment_id)
