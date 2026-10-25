"""WebPush-Abos des angemeldeten Kontos.

Der Push-Weg ist kein Alt-Transport: er traegt weiterhin die Meldung, wenn
niemand offen ist. Beim Umbau auf den Einheits-Transport fiel die Datei
`mailbox.py` mit den alten Mailbox-Routen weg — und mit ihr diese drei
Konto-Routen, obwohl `webpush_service` und die Oberflaeche sie weiter nutzen.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, session_familie, verify_csrf
from models import User
from routers.social.basis import _check_social_enabled
from schemas.social import PushSubscriptionCreate
from services import webpush_service

router = APIRouter()


@router.get("/push/public-key", dependencies=[Depends(_check_social_enabled)])
def get_push_public_key(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Der `applicationServerKey`, gegen den ein Browser abonniert."""
    return {"key": webpush_service.oeffentlicher_schluessel(db)}


@router.post("/push/subscribe", dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)])
def subscribe_push(
    req: PushSubscriptionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    familie: str | None = Depends(session_familie),
) -> dict:
    """Traegt die Zustelladresse dieses Browsers ein."""
    webpush_service.eintragen(
        db, user, endpoint=req.endpoint, p256dh=req.p256dh, auth=req.auth, familie=familie
    )
    return {"ok": True}


@router.delete("/push/subscribe", dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)])
def unsubscribe_push(
    endpoint: str = Query(..., min_length=16, max_length=2048),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Entfernt eine Zustelladresse. Nur die eigene."""
    entfernt = webpush_service.austragen(db, user, endpoint)
    webpush_service.austragen_mailboxen(db, endpoint)
    return {"ok": entfernt}
