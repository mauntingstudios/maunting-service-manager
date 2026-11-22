from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, require_global, verify_csrf
from models import RoleFrontendBuildQuota, User
from schemas import RoleCreate, RoleResponse, RoleUpdate
from services import ai_project_quota_service, rechtevergabe_service, role_service

router = APIRouter(prefix="/api/roles", tags=["roles"])


def _http(fehler: rechtevergabe_service.RechteFehler) -> HTTPException:
    """Die Grenzen stehen in `rechtevergabe_service` — dieselben ruft die KI."""
    return HTTPException(status_code=fehler.status_code, detail=fehler.detail)


def _to_response(db: Session, role) -> RoleResponse:
    return RoleResponse(
        id=role.id,
        name=role.name,
        description=role.description,
        color=getattr(role, "color", None) or "#3b82f6",
        icon=getattr(role, "icon", None),
        is_system=role.is_system,
        permissions=role_service.role_permission_keys(db, role.id),
        created_at=role.created_at,
    )


@router.get("", response_model=list[RoleResponse])
def list_roles(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[RoleResponse]:
    """Jeder eingeloggte User darf die Rollen-Liste lesen.

    **Was hier wirklich herausgeht:** `_to_response` haengt an jede Rolle ihre
    tatsaechlich zugewiesenen Permission-Keys. Der Docstring behauptete bis
    09/2026 "nur Namen/Beschreibung" und stimmte damit nicht mit dem Code
    ueberein — nachgemessen antwortet die Route einem Konto ohne jedes
    globale Recht mit 200 und der vollstaendigen Rechtezuordnung aller Rollen.

    Das ist mehr als `/api/permissions/catalog`: der Katalog nennt die
    *moeglichen* Keys, diese Route die *dieser Instanz tatsaechlich
    vergebenen*. Wer sie enger ziehen will, braucht ein `require_global` —
    das ist eine bewusste Betreiberentscheidung, keine stille Aenderung.
    Welches Konto welche Rolle traegt, verraet sie nicht, und Aenderungen
    bleiben per `roles.manage` geschuetzt.
    """
    return [_to_response(db, r) for r in role_service.list_roles(db)]


@router.get("/{role_id}", response_model=RoleResponse)
def get_role(
    role_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> RoleResponse:
    role = role_service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Rolle nicht gefunden")
    return _to_response(db, role)


@router.post("", response_model=RoleResponse, status_code=201)
def create_role(
    req: RoleCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("roles.manage")),
    __: None = Depends(verify_csrf),
) -> RoleResponse:
    try:
        role = rechtevergabe_service.create_role(
            db,
            actor,
            req.name,
            req.description,
            req.permissions,
            color=req.color,
            icon=req.icon,
        )
    except rechtevergabe_service.RechteFehler as fehler:
        raise _http(fehler) from None
    return _to_response(db, role)


@router.patch("/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    req: RoleUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("roles.manage")),
    __: None = Depends(verify_csrf),
) -> RoleResponse:
    try:
        role = rechtevergabe_service.update_role(
            db,
            actor,
            role_id,
            req.name,
            req.description,
            req.permissions,
            color=req.color,
            icon=req.icon,
        )
    except rechtevergabe_service.RechteFehler as fehler:
        raise _http(fehler) from None
    return _to_response(db, role)


@router.delete("/{role_id}", status_code=204)
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_global("roles.manage")),
    __: None = Depends(verify_csrf),
) -> None:
    try:
        rechtevergabe_service.delete_role(db, actor, role_id)
    except rechtevergabe_service.RechteFehler as fehler:
        raise _http(fehler) from None


class RoleFrontendQuotaPayload(BaseModel):
    max_cpu_cores: int = Field(default=2, ge=1, le=16)
    max_memory_mb: int = Field(default=2048, ge=256, le=32768)
    build_timeout_seconds: int = Field(default=900, ge=60, le=3600)
    max_concurrent_builds: int = Field(default=1, ge=1, le=8)
    max_previews_per_server: int = Field(default=5, ge=0, le=50)


@router.get("/{role_id}/frontend-quota", response_model=RoleFrontendQuotaPayload)
def get_role_frontend_quota(
    role_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> RoleFrontendQuotaPayload:
    role = role_service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Rolle nicht gefunden")
    row = db.get(RoleFrontendBuildQuota, role_id)
    if row is None:
        return RoleFrontendQuotaPayload()
    return RoleFrontendQuotaPayload(
        max_cpu_cores=row.max_cpu_cores,
        max_memory_mb=row.max_memory_mb,
        build_timeout_seconds=row.build_timeout_seconds,
        max_concurrent_builds=row.max_concurrent_builds,
        max_previews_per_server=row.max_previews_per_server,
    )


@router.put("/{role_id}/frontend-quota", response_model=RoleFrontendQuotaPayload)
def set_role_frontend_quota(
    role_id: int,
    req: RoleFrontendQuotaPayload,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_global("roles.manage")),
    __: None = Depends(verify_csrf),
) -> RoleFrontendQuotaPayload:
    role = role_service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Rolle nicht gefunden")
    row = db.get(RoleFrontendBuildQuota, role_id)
    if row is None:
        row = RoleFrontendBuildQuota(role_id=role_id)
        db.add(row)
    row.max_cpu_cores = req.max_cpu_cores
    row.max_memory_mb = req.max_memory_mb
    row.build_timeout_seconds = req.build_timeout_seconds
    row.max_concurrent_builds = req.max_concurrent_builds
    row.max_previews_per_server = req.max_previews_per_server
    db.commit()
    return req


class RoleAiProjectQuotaPayload(BaseModel):
    max_projects: int = Field(default=3, ge=0, le=1000)
    max_storage_mb: int = Field(default=256, ge=0, le=102400)


@router.get("/{role_id}/ai-project-quota", response_model=RoleAiProjectQuotaPayload)
def get_role_ai_project_quota(
    role_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> RoleAiProjectQuotaPayload:
    role = role_service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Rolle nicht gefunden")
    quota = ai_project_quota_service.get_role_quota(db, role_id)
    return RoleAiProjectQuotaPayload(**quota)


@router.put("/{role_id}/ai-project-quota", response_model=RoleAiProjectQuotaPayload)
def set_role_ai_project_quota(
    role_id: int,
    req: RoleAiProjectQuotaPayload,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_global("roles.manage")),
    __: None = Depends(verify_csrf),
) -> RoleAiProjectQuotaPayload:
    role = role_service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Rolle nicht gefunden")
    row = ai_project_quota_service.upsert_role_quota(
        db,
        role_id,
        max_projects=req.max_projects,
        max_storage_mb=req.max_storage_mb,
    )
    db.commit()
    return RoleAiProjectQuotaPayload(
        max_projects=row.max_projects,
        max_storage_mb=row.max_storage_mb,
    )
