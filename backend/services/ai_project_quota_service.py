"""Separate KI-Projekt-Kontingente je Benutzer und globaler Rolle.

Unabhaengig von KI-Token-Budgets (`RoleAiLimit`): steuert maximal erlaubte
KI-Projekte und den gesamten gespeicherten Projekt-Speicher in MB (`0` = unbegrenzt).
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import AiProject, AiProjectFile, RoleAiProjectQuota, User
from services import role_service
from services.ai_project_errors import AiProjectError

DEFAULT_MAX_PROJECTS = 3
DEFAULT_MAX_STORAGE_MB = 256
MAX_PROJECTS_LIMIT = 1000
MAX_STORAGE_MB_LIMIT = 102_400


class AiProjectQuotaError(AiProjectError):
    """Wird ausgeloest, wenn Projektanzahl oder Speicherlimit erreicht ist."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def get_role_quota(db: Session, role_id: int) -> dict[str, int]:
    row = db.get(RoleAiProjectQuota, role_id)
    if row is None:
        return {
            "max_projects": DEFAULT_MAX_PROJECTS,
            "max_storage_mb": DEFAULT_MAX_STORAGE_MB,
        }
    return {
        "max_projects": int(row.max_projects),
        "max_storage_mb": int(row.max_storage_mb),
    }


def upsert_role_quota(
    db: Session,
    role_id: int,
    *,
    max_projects: int,
    max_storage_mb: int,
) -> RoleAiProjectQuota:
    row = db.get(RoleAiProjectQuota, role_id)
    if row is None:
        row = RoleAiProjectQuota(role_id=role_id)
        db.add(row)
    row.max_projects = max(0, min(MAX_PROJECTS_LIMIT, int(max_projects)))
    row.max_storage_mb = max(0, min(MAX_STORAGE_MB_LIMIT, int(max_storage_mb)))
    db.flush()
    return row


def get_effective_user_quota(db: Session, user: User) -> dict[str, object]:
    """Effektives Projekt-/Speicherlimit eines Benutzers (hoechste Rolle gewinnt; 0 = unbegrenzt)."""
    if getattr(user, "is_owner", False):
        return {
            "max_projects": 0,
            "max_storage_mb": 0,
            "unlimited_projects": True,
            "unlimited_storage": True,
        }

    role_ids = list(role_service.effective_user_role_ids(db, user))
    if not role_ids:
        return {
            "max_projects": DEFAULT_MAX_PROJECTS,
            "max_storage_mb": DEFAULT_MAX_STORAGE_MB,
            "unlimited_projects": False,
            "unlimited_storage": False,
        }

    rows = (
        db.query(RoleAiProjectQuota)
        .filter(RoleAiProjectQuota.role_id.in_(role_ids))
        .all()
    )
    if not rows:
        return {
            "max_projects": DEFAULT_MAX_PROJECTS,
            "max_storage_mb": DEFAULT_MAX_STORAGE_MB,
            "unlimited_projects": False,
            "unlimited_storage": False,
        }

    proj_vals = [int(r.max_projects) for r in rows]
    stor_vals = [int(r.max_storage_mb) for r in rows]
    eff_projects = 0 if any(v == 0 for v in proj_vals) else max(proj_vals)
    eff_storage = 0 if any(v == 0 for v in stor_vals) else max(stor_vals)

    return {
        "max_projects": eff_projects,
        "max_storage_mb": eff_storage,
        "unlimited_projects": eff_projects == 0,
        "unlimited_storage": eff_storage == 0,
    }


def get_user_usage(db: Session, user_id: int) -> dict[str, int | float]:
    project_count = int(
        db.query(func.count(AiProject.id))
        .filter(AiProject.user_id == user_id, AiProject.archived.is_(False))
        .scalar()
        or 0
    )
    used_bytes = int(
        db.query(func.coalesce(func.sum(AiProjectFile.size_bytes), 0))
        .join(AiProject, AiProject.id == AiProjectFile.project_id)
        .filter(AiProject.user_id == user_id, AiProject.archived.is_(False))
        .scalar()
        or 0
    )
    used_mb = round(used_bytes / (1024 * 1024), 2)
    return {
        "project_count": project_count,
        "used_bytes": used_bytes,
        "used_mb": used_mb,
    }


def get_quota_summary(db: Session, user: User) -> dict[str, object]:
    quota = get_effective_user_quota(db, user)
    usage = get_user_usage(db, user.id)
    max_storage_mb = int(quota["max_storage_mb"])  # type: ignore[arg-type]
    max_storage_bytes = max_storage_mb * 1024 * 1024 if max_storage_mb > 0 else 0
    return {
        **quota,
        **usage,
        "max_storage_bytes": max_storage_bytes,
    }


def check_can_create_project(db: Session, user: User) -> None:
    quota = get_effective_user_quota(db, user)
    max_projects = int(quota["max_projects"])  # type: ignore[arg-type]
    if max_projects <= 0:
        return
    usage = get_user_usage(db, user.id)
    if int(usage["project_count"]) >= max_projects:
        raise AiProjectQuotaError(
            "project_count_limit_reached",
            f"Projektlimit erreicht ({usage['project_count']}/{max_projects} Projekte). "
            "Archiviere ein altes Projekt oder erweitere dein Kontingent.",
        )


def check_can_write_bytes(db: Session, user: User, additional_bytes: int) -> None:
    if additional_bytes <= 0:
        return
    quota = get_effective_user_quota(db, user)
    max_storage_mb = int(quota["max_storage_mb"])  # type: ignore[arg-type]
    if max_storage_mb <= 0:
        return
    max_bytes = max_storage_mb * 1024 * 1024
    usage = get_user_usage(db, user.id)
    projected = int(usage["used_bytes"]) + int(additional_bytes)
    if projected > max_bytes:
        raise AiProjectQuotaError(
            "project_storage_limit_reached",
            f"Projekt-Speicherlimit erreicht ({max_storage_mb} MB maximal erlaubt). "
            "Reduziere Dateien oder erweitere dein Kontingent.",
        )
