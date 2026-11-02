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
) -> tuple[str, str, str, datetime]:
    """Erzeugt eine neue ephemere Freigabe-Session.

    Returns:
        tuple (session_id, session_token, resolve_token, expires_at)

    Zwei Geheimnisse, zwei Kanaele: das Sitzungs-Token holt der Desktop per
    Header ab, das Aufloese-Token steht nur im QR-Code. Wer den Code nicht
    gescannt hat, loest die Session nicht auf — auch nicht mit fremder
    Anmeldung. Gespeichert wird nur der Hash.
    """
    session_id = secrets.token_hex(8)  # 16-stellige Hex-ID für QR-Code
    session_token = secrets.token_urlsafe(32)  # Geheimer Token für den Desktop zum Abrufen
    resolve_token = secrets.token_urlsafe(32)  # Nur im QR-Code, nie im Polling
    expires = _now() + timedelta(seconds=ttl_seconds)

    payload = {
        "session_id": session_id,
        "public_key": public_key.strip(),
        "purpose": purpose,
        "device_info": device_info.strip() if device_info else None,
        "resolve_token_hash": hash_challenge_token(resolve_token),
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

    return session_id, session_token, resolve_token, expires


def get_device_auth_session_status(
    db: Session,
    session_id: str,
    session_token: str,
    user_id: int,
) -> dict:
    """Prüft den Status einer Session für das anfragende Zielgerät.

    Liefert 'pending', 'expired' oder 'resolved' (mit `encrypted_payload`).
    Bei 'resolved' wird die Session sofort konsumiert (single-use) — atomar:
    nur wer das Flag umlegt, bekommt die Chiffre; ein zweiter Abruf sieht
    'expired'.
    """
    token_hash = hash_challenge_token(session_token)
    row = (
        db.query(LoginChallenge)
        .filter(
            LoginChallenge.token_hash == token_hash,
            LoginChallenge.purpose == PURPOSE_VAULT_DEVICE_AUTH,
            LoginChallenge.user_id == user_id,
        )
        .with_for_update()
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
        # Atomar verbrauchen: zwei Abrufe duerfen die Chiffre nicht doppelt
        # sehen. Nur wer das Flag umlegt, liefert aus.
        markiert = (
            db.query(LoginChallenge)
            .filter(
                LoginChallenge.id == row.id,
                LoginChallenge.consumed_at.is_(None),
            )
            .update({"consumed_at": now}, synchronize_session=False)
        )
        db.commit()
        if not markiert:
            return {"status": "expired"}
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
    resolve_token: str,
) -> bool:
    """Löst die Session durch das autorisierte Smartphone auf.

    Voraussetzung: Die Session existiert, gehört demselben Benutzer, ist weder
    abgelaufen noch verbraucht noch aufgelöst — und das Aufloese-Token aus dem
    QR-Code stimmt. Eine bereits aufgelöste Session wird nie überschrieben.
    """
    # Kandidaten ohne Sperre suchen (die Kennung steht im JSON), dann genau
    # die Zielzeile sperren und alles erneut prüfen.
    kandidaten = (
        db.query(LoginChallenge)
        .filter(
            LoginChallenge.purpose == PURPOSE_VAULT_DEVICE_AUTH,
            LoginChallenge.user_id == user_id,
            LoginChallenge.consumed_at.is_(None),
        )
        .all()
    )
    kandidat_id: int | None = None
    for r in kandidaten:
        if _is_expired(r.expires_at):
            continue
        try:
            d = json.loads(r.payload_json or "{}")
            if d.get("session_id") == session_id:
                kandidat_id = r.id
                break
        except Exception:
            continue
    if kandidat_id is None:
        return False

    row = (
        db.query(LoginChallenge)
        .filter(LoginChallenge.id == kandidat_id)
        .with_for_update()
        .first()
    )
    if (
        row is None
        or row.consumed_at is not None
        or row.resolved_at is not None
        or _is_expired(row.expires_at)
    ):
        return False
    try:
        daten = json.loads(row.payload_json or "{}")
    except Exception:
        return False
    if daten.get("session_id") != session_id or daten.get("resolved"):
        return False
    erwartet = daten.get("resolve_token_hash", "")
    if not erwartet or not secrets.compare_digest(
        erwartet, hash_challenge_token(resolve_token)
    ):
        return False

    daten["resolved"] = True
    daten["encrypted_payload"] = encrypted_payload.strip()
    row.payload_json = json.dumps(daten)
    row.resolved_at = _now(row.expires_at)
    db.commit()

    return True
