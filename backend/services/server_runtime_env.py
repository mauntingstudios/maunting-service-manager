"""Verwaltung verschlüsselter Runtime-Umgebungsvariablen für Server-Container."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from database import SessionLocal
from models.server_runtime_env import ServerRuntimeEnv
from services.auth_service import AuthService

logger = logging.getLogger(__name__)


def _runtime_env_aad(server_id: int) -> str:
    return f"msm:server:runtime-env:{server_id}"


def set_runtime_env(
    server_id: int,
    env: dict[str, Any],
    *,
    probe_url: str | None = None,
    managed_by: str = "singra",
    db: Session | None = None,
) -> ServerRuntimeEnv:
    """Speichert verschlüsselte Umgebungsvariablen für einen Server.

    Die Werte werden über AuthService.encrypt_secret (AES-256-GCM via DIS)
    mit serverspezifischem AAD geschützt.
    """
    clean_env = {str(k): str(v) for k, v in env.items() if v is not None}
    payload_json = json.dumps(clean_env, ensure_ascii=False)
    encrypted_payload = AuthService.encrypt_secret(payload_json, aad=_runtime_env_aad(server_id))

    owns_session = db is None
    session = db or SessionLocal()
    try:
        row = session.get(ServerRuntimeEnv, server_id)
        if row is None:
            row = ServerRuntimeEnv(
                server_id=server_id,
                env_encrypted=encrypted_payload,
                probe_url=probe_url,
                managed_by=managed_by,
            )
            session.add(row)
        else:
            row.env_encrypted = encrypted_payload
            if probe_url is not None:
                row.probe_url = probe_url
            if managed_by:
                row.managed_by = managed_by

        session.commit()
        session.refresh(row)
        return row
    except Exception:
        if owns_session:
            session.rollback()
        raise
    finally:
        if owns_session:
            session.close()


def get_runtime_env(server_id: int, *, db: Session | None = None) -> dict[str, str]:
    """Lädt und entschlüsselt die Runtime-Umgebungsvariablen eines Servers."""
    owns_session = db is None
    session = db or SessionLocal()
    try:
        row = session.get(ServerRuntimeEnv, server_id)
        if row is None or not row.env_encrypted:
            return {}

        decrypted_json = AuthService.decrypt_secret(row.env_encrypted, aad=_runtime_env_aad(server_id))
        data = json.loads(decrypted_json)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
        return {}
    except Exception as exc:
        logger.warning("Konnte Runtime-Env fuer Server %s nicht entschluesseln: %s", server_id, exc)
        return {}
    finally:
        if owns_session:
            session.close()


def get_probe_url(server_id: int, *, db: Session | None = None) -> str | None:
    """Liefert die konfigurierte Health-Probe-URL für den Server."""
    owns_session = db is None
    session = db or SessionLocal()
    try:
        row = session.get(ServerRuntimeEnv, server_id)
        return row.probe_url if row else None
    finally:
        if owns_session:
            session.close()


def delete_runtime_env(server_id: int, *, db: Session | None = None) -> bool:
    """Löscht hinterlegte Runtime-Umgebungsvariablen beim Löschen eines Servers."""
    owns_session = db is None
    session = db or SessionLocal()
    try:
        row = session.get(ServerRuntimeEnv, server_id)
        if row:
            session.delete(row)
            session.commit()
            return True
        return False
    except Exception:
        if owns_session:
            session.rollback()
        raise
    finally:
        if owns_session:
            session.close()
