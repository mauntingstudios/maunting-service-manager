"""Interne Endpunkte fuer den Dokumente-Sidecar.

Nur Loopback und nur mit dem Service-Token. Caddy proxyt ``/internal/*`` nicht.
"""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from schemas.docs import InternalAuthorize, InternalStore
from services.docs_collab_service import DocsCollabService

router = APIRouter(prefix="/internal/docs", tags=["docs-internal"])


def _service_token(
    authorization: str | None = Header(default=None),
) -> None:
    erwartet = settings.docs_sidecar_token
    if not erwartet:
        raise HTTPException(status_code=503, detail="Dokumentdienst ist nicht eingerichtet")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Service-Token fehlt")
    if not hmac.compare_digest(authorization[7:].strip(), erwartet):
        raise HTTPException(status_code=401, detail="Service-Token ist falsch")


@router.post("/authorize", dependencies=[Depends(_service_token)])
def authorize(req: InternalAuthorize, db: Session = Depends(get_db)) -> dict[str, Any]:
    return DocsCollabService.authorize(
        db,
        doc_uid=req.doc_uid,
        user_id=req.user_id,
        role=req.role,
        fam=req.fam,
    )


@router.get("/{doc_uid}/state", dependencies=[Depends(_service_token)])
def load_state(doc_uid: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return DocsCollabService.load_state(db, doc_uid)


@router.post("/{doc_uid}/store", dependencies=[Depends(_service_token)])
def store(doc_uid: str, req: InternalStore, db: Session = Depends(get_db)) -> dict[str, Any]:
    return DocsCollabService.store(db, doc_uid, req.model_dump())
