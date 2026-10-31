"""Konto-Identitaet und Chat-Schluessel.

Der Server sieht nur oeffentliche Schluessel und gegen Geraete- beziehungsweise
Konto-Schluessel verpackte Chiffrate. Er kann keinen Chat-Schluessel oeffnen.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models import E2eeAccount, E2eeAccountKeyVault, User, UserE2eeDevice
from routers.social.basis import _check_social_enabled
from schemas.social import validate_ecdsa_public_key_jwk, validate_rsa_public_key_jwk
from services.social.messages_service import latest_chat_key_version, list_chat_keys, store_chat_keys

router = APIRouter(dependencies=[Depends(_check_social_enabled)])


class AccountPublish(BaseModel):
    device_id: str = Field(..., min_length=8, max_length=64)
    public_key: str = Field(..., min_length=16)
    signing_public_key: str = Field(..., min_length=16)
    encrypted_bundle: str = Field(..., min_length=1)


class AccountLookup(BaseModel):
    user_ids: list[int] = Field(default_factory=list, max_length=1000)


class BundleUpload(BaseModel):
    encrypted_bundle: str = Field(..., min_length=1)


class ChatKeyItem(BaseModel):
    user_id: int = Field(..., gt=0)
    encrypted_chat_key: str = Field(..., min_length=1)


class ChatKeysUpload(BaseModel):
    chat_type: str = Field(..., pattern="^(direct|group)$")
    chat_id: int = Field(..., gt=0)
    key_version: int = Field(1, ge=1)
    keys: list[ChatKeyItem] = Field(..., min_length=1, max_length=64)


def _device(db: Session, user: User, device_id: str, *, require_approved: bool = True) -> UserE2eeDevice:
    row = (
        db.query(UserE2eeDevice)
        .filter_by(user_id=user.id, device_id=(device_id or "").strip())
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Geraet nicht registriert.")
    if require_approved and not row.is_approved:
        raise HTTPException(status_code=403, detail="Geraet ist nicht freigegeben.")
    return row


@router.put("/e2ee/account")
def publish_account(
    req: AccountPublish,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    device = _device(db, current_user, req.device_id)
    validate_rsa_public_key_jwk(req.public_key)
    validate_ecdsa_public_key_jwk(req.signing_public_key)

    account = db.query(E2eeAccount).filter_by(user_id=current_user.id).first()
    if account is None:
        account = E2eeAccount(
            user_id=current_user.id,
            public_key_jwk=req.public_key,
            signing_public_key_jwk=req.signing_public_key,
        )
        db.add(account)
    else:
        # Die Konto-Identitaet ist stabil. Ein Wechsel wuerde jeden alten
        # Chat-Schluessel unlesbar machen; dafuer gibt es keinen stillen Weg.
        if account.public_key_jwk != req.public_key or account.signing_public_key_jwk != req.signing_public_key:
            raise HTTPException(
                status_code=409,
                detail="Die Konto-Identitaet steht bereits. Ein Wechsel braucht einen ausdruecklichen Reset.",
            )

    vault = (
        db.query(E2eeAccountKeyVault)
        .filter_by(user_id=current_user.id, device_id=device.device_id)
        .first()
    )
    if vault is None:
        db.add(
            E2eeAccountKeyVault(
                user_id=current_user.id,
                device_id=device.device_id,
                encrypted_bundle=req.encrypted_bundle,
            )
        )
    else:
        vault.encrypted_bundle = req.encrypted_bundle
    try:
        db.commit()
    except IntegrityError as exc:
        # Zwei Geraete melden sich im selben Augenblick zum ersten Mal. Der
        # Verlierer soll nicht als 500 enden; der Client holt den Bund dann
        # vom Geschwister oder versucht es erneut.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Die Konto-Identitaet wurde gleichzeitig angelegt.",
        ) from exc
    return {
        "user_id": current_user.id,
        "public_key": account.public_key_jwk,
        "signing_public_key": account.signing_public_key_jwk,
        "device_id": device.device_id,
    }


@router.get("/e2ee/account/self/bundle")
def own_bundle(
    device_id: str = Query(..., min_length=8, max_length=64),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _device(db, current_user, device_id)
    row = (
        db.query(E2eeAccountKeyVault)
        .filter_by(user_id=current_user.id, device_id=device_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Kein Konto-Schluessel fuer dieses Geraet.")
    return {
        "user_id": current_user.id,
        "device_id": row.device_id,
        "encrypted_bundle": row.encrypted_bundle,
    }


@router.post("/e2ee/account/bundle/{target_device_id}")
def transfer_bundle(
    target_device_id: str,
    req: BundleUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    device_id: Annotated[str | None, Header(alias="X-Device-Id")] = None,
) -> dict:
    """Ein freigegebenes Geraet legt den Konto-Schluessel fuer ein neues ab."""
    if not device_id:
        raise HTTPException(status_code=400, detail="X-Device-Id fehlt.")
    _device(db, current_user, device_id)
    target = _device(db, current_user, target_device_id)
    if target.device_id == device_id:
        raise HTTPException(status_code=400, detail="Ein Geraet braucht sich nicht selbst zu beliefern.")

    # Nur ein Geraet, das den Bund selbst hat, darf ihn weitergeben. Sonst
    # koennte ein freigegebenes Geraet ohne Kontoschluessel einen erfundenen
    # Bund beim Ziel hinterlegen.
    eigen = (
        db.query(E2eeAccountKeyVault)
        .filter_by(user_id=current_user.id, device_id=device_id)
        .first()
    )
    if eigen is None:
        raise HTTPException(status_code=403, detail="Dieses Geraet hat keinen Konto-Schluessel.")

    # Ein vorhandener Bund wird nicht ueberschrieben. Sonst koennte ein
    # beliebiges freigegebenes Geraet desselben Kontos ein Geschwistergeraet
    # mit einem unbrauchbaren Bund aussperren.
    row = (
        db.query(E2eeAccountKeyVault)
        .filter_by(user_id=current_user.id, device_id=target.device_id)
        .first()
    )
    if row is not None:
        raise HTTPException(status_code=409, detail="Dieses Geraet hat bereits einen Konto-Schluessel.")
    db.add(
        E2eeAccountKeyVault(
            user_id=current_user.id,
            device_id=target.device_id,
            encrypted_bundle=req.encrypted_bundle,
        )
    )
    db.commit()
    return {"ok": True, "device_id": target.device_id}


@router.get("/e2ee/account/{target_user_id}")
def public_account(
    target_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if target_user_id <= 0:
        raise HTTPException(status_code=400, detail="Ungueltige Kennung.")
    account = db.query(E2eeAccount).filter_by(user_id=target_user_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Konto hat noch keine E2EE-Identitaet.")
    return {
        "user_id": target_user_id,
        "public_key": account.public_key_jwk,
        "signing_public_key": account.signing_public_key_jwk,
    }


@router.post("/e2ee/account/lookup")
def lookup_accounts(
    req: AccountLookup,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    ids = sorted({int(uid) for uid in req.user_ids if int(uid) > 0})[:1000]
    if not ids:
        return {"accounts": []}
    rows = db.query(E2eeAccount).filter(E2eeAccount.user_id.in_(ids)).all()
    return {
        "accounts": [
            {
                "user_id": int(row.user_id),
                "public_key": row.public_key_jwk,
                "signing_public_key": row.signing_public_key_jwk,
            }
            for row in rows
        ]
    }


@router.get("/e2ee/chat-keys")
def get_chat_keys(
    chat_type: str = Query(..., pattern="^(direct|group)$"),
    chat_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return {
        "keys": list_chat_keys(db, current_user.id, chat_type, chat_id),
        "latest_key_version": latest_chat_key_version(db, chat_type, chat_id),
    }


@router.put("/e2ee/chat-keys")
def put_chat_keys(
    req: ChatKeysUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    rows = [
        {
            "user_id": item.user_id,
            "encrypted_chat_key": item.encrypted_chat_key,
        }
        for item in req.keys
    ]
    return {
        "keys": store_chat_keys(
            db,
            current_user,
            req.chat_type,
            req.chat_id,
            req.key_version,
            rows,
        )
    }
