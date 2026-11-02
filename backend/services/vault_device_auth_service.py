"""Zero-Knowledge Relay Service für Smartcard-Geräte-Autorisierung & Entsperrung.

Erlaubt einem Zielgerät (Desktop/Browser), ein ephemeres Schlüsselpaar zu erzeugen
und einen dynamischen QR-Code anzuzeigen. Ein autorisiertes Smartphone scannt den
Code und liefert eine Ende-zu-Ende verschlüsselte Freigabe-Payload ein.

Sicherheits-Invarianten:
- Zero-Knowledge: Der Server speichert und übermittelt nur Chiffren (`encrypted_payload`),
  niemals Klartext-Schlüssel oder Passwörter.
- Single-Use: Nach dem erfolgreichen Abruf durch das Zielgerät wird die Session konsumiert.
- User-Isolation: Beide Geräte müssen zum selben Benutzerkonto gehören.
- Kurze TTL: Sessions verfallen nach 180 Sekunden.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from models.login_challenge import LoginChallenge, hash_challenge_token

DEFAULT_DEVICE_AUTH_TTL_SECONDS = 180  # 3 Minuten
PURPOSE_VAULT_DEVICE_AUTH = "vault_device_auth"


def _now(bezug: datetime | None = None) -> datetime:
    jetzt = datetime.now(timezone.utc)
    if bezug is not None and bezug.tzinfo is None:
        return jetzt.replace(tzinfo=None)
    return jetzt


def _is_expired(expires_at: datetime) -> bool:
    return expires_at <= _now(expires_at)


def create_device_auth_session(
    db: Session,
    user_id: int,
    public_key: str,
    purpose: str = "authorize",
    device_info: str | None = None,
    ttl_seconds: int = DEFAULT_DEVICE_AUTH_TTL_SECONDS,
) -> tuple[str, str, datetime]:
    """Erzeugt eine neue ephemere Freigabe-Session.

    Returns:
        tuple (session_id, session_token, expires_at)
    """
    session_id = secrets.token_hex(8)  # 16-stellige Hex-ID für QR-Code
    session_token = secrets.token_urlsafe(32)  # Geheimer Token für den Desktop zum Abrufen
    expires = _now() + timedelta(seconds=ttl_seconds)

    payload = {
        "session_id": session_id,
        "public_key": public_key.strip(),
        "purpose": purpose,
        "device_info": device_info.strip() if device_info else None,
        "resolved": False,
        "encrypted_payload": None,
    }

    row = LoginChallenge(
        token_hash=hash_challenge_token(session_token),
        purpose=PURPOSE_VAULT_DEVICE_AUTH,
        user_id=user_id,
        payload_json=json.dumps(payload),
        expires_at=expires,
    )
    db.add(row)
    db.commit()

    return session_id, session_token, expires


def get_device_auth_session_status(
    db: Session,
    session_id: str,
    session_token: str,
    user_id: int,
) -> dict:
    """Prüft den Status einer Session für das anfragende Zielgerät.

    Liefert 'pending', 'expired' oder 'resolved' (mit `encrypted_payload`).
    Bei 'resolved' wird die Session sofort konsumiert (single-use).
    """
    token_hash = hash_challenge_token(session_token)
    row = (
        db.query(LoginChallenge)
        .filter(
            LoginChallenge.token_hash == token_hash,
            LoginChallenge.purpose == PURPOSE_VAULT_DEVICE_AUTH,
            LoginChallenge.user_id == user_id,
        )
        .first()
    )

    if not row:
        return {"status": "not_found"}

    now = _now(row.expires_at)
    if _is_expired(row.expires_at) or row.consumed_at is not None:
        return {"status": "expired"}

    try:
        data = json.loads(row.payload_json or "{}")
    except Exception:
        return {"status": "error"}

    if data.get("session_id") != session_id:
        return {"status": "not_found"}

    if data.get("resolved") and data.get("encrypted_payload"):
        # Sofort als konsumiert markieren, damit die Chiffre nur genau einmal ausgeliefert wird
        row.consumed_at = now
        db.commit()
        return {
            "status": "resolved",
            "encrypted_payload": data["encrypted_payload"],
            "purpose": data.get("purpose", "authorize"),
        }

    return {
        "status": "pending",
        "expires_in_seconds": max(0, int((row.expires_at - now).total_seconds())),
    }


def resolve_device_auth_session(
    db: Session,
    session_id: str,
    user_id: int,
    encrypted_payload: str,
) -> bool:
    """Löst die Session durch das autorisierte Smartphone auf.

    Voraussetzung: Die Session existiert, gehört demselben Benutzer und ist nicht abgelaufen.
    """
    # Finde die aktive Challenge des Nutzers
    rows = (
        db.query(LoginChallenge)
        .filter(
            LoginChallenge.purpose == PURPOSE_VAULT_DEVICE_AUTH,
            LoginChallenge.user_id == user_id,
            LoginChallenge.consumed_at.is_(None),
        )
        .all()
    )

    target_row: LoginChallenge | None = None
    target_payload: dict | None = None

    for r in rows:
        if _is_expired(r.expires_at):
            continue
        try:
            d = json.loads(r.payload_json or "{}")
            if d.get("session_id") == session_id:
                target_row = r
                target_payload = d
                break
        except Exception:
            continue

    if not target_row or not target_payload:
        return False

    target_payload["resolved"] = True
    target_payload["encrypted_payload"] = encrypted_payload.strip()
    target_row.payload_json = json.dumps(target_payload)
    db.commit()

    return True
