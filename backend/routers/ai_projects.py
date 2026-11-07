"""API-Routen fuer universelle Singra KI-Projekte (Wissen, Dateien, Coding-Sandbox & Git)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from dependencies import require_global, verify_csrf
from models import User
from services import ai_project_service
from services.ai_project_service import AiProjectError

router = APIRouter(prefix="/api/ai/projects", tags=["ai-projects"])


class AiProjectCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    system_prompt: str | None = Field(default=None, max_length=12000)
    icon: str = Field(default="folder-code", max_length=48)
    color: str = Field(default="emerald", max_length=32)
    project_kind: str = Field(default="coding", pattern="^(coding|docs|general)$")
    team_id: int | None = None
    sandbox_mode: str = Field(default="server", pattern="^(server|local|none)$")
    sandbox_enabled: bool | None = None
    local_path: str | None = Field(default=None, max_length=1024)
    local_directory: str | None = Field(default=None, max_length=1024)
    git_provider: str | None = Field(default=None, pattern="^(github|gitlab)$")
    git_repo_url: str | None = Field(default=None, max_length=1024)
    git_branch: str | None = Field(default="main", max_length=120)
    git_token: str | None = Field(default=None, max_length=512)


class AiProjectUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    system_prompt: str | None = Field(default=None, max_length=12000)
    icon: str | None = Field(default=None, max_length=48)
    color: str | None = Field(default=None, max_length=32)
    project_kind: str | None = Field(default=None, pattern="^(coding|docs|general)$")
    pinned: bool | None = None
    team_id: int | None = None
    clear_team: bool | None = None
    sandbox_mode: str | None = Field(default=None, pattern="^(server|local|none)$")
    sandbox_enabled: bool | None = None
    local_path: str | None = Field(default=None, max_length=1024)
    local_directory: str | None = Field(default=None, max_length=1024)
    git_provider: str | None = Field(default=None, pattern="^(github|gitlab)$")
    git_repo_url: str | None = Field(default=None, max_length=1024)
    git_branch: str | None = Field(default=None, max_length=120)
    git_token: str | None = Field(default=None, max_length=512)
    clear_git_token: bool | None = None


class AiProjectResponse(BaseModel):
    id: str
    user_id: int
    owner_user_id: int | None = None
    team_id: int | None = None
    name: str
    description: str | None = None
    system_prompt: str | None = None
    icon: str
    color: str
    project_kind: str = "coding"
    pinned: bool
    sandbox_mode: str
    sandbox_enabled: bool = True
    sandbox_path: str | None = None
    local_path: str | None = None
    local_directory: str | None = None
    git_provider: str | None = None
    git_repo_url: str | None = None
    git_branch: str | None = None
    git_token_configured: bool = False
    file_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiProjectFileWritePayload(BaseModel):
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(default="")
    mime_type: str = Field(default="text/plain", max_length=80)


class AiProjectFileResponse(BaseModel):
    id: str
    project_id: str
    path: str
    content: str
    mime_type: str
    size_bytes: int
    updated_at: datetime
    diff: dict[str, object] | None = None

    model_config = {"from_attributes": True}


class AiProjectEnvironmentSwitchPayload(BaseModel):
    environment: str = Field(default="dev", pattern="^(dev|production|prod)$")


class AiProjectPublishPayload(BaseModel):
    node_id: str | None = None
    release_notes: str | None = Field(default=None, max_length=500)
    mode: str | None = Field(default=None, max_length=32)
    domain: str | None = Field(default=None, max_length=160)
    enable_database: bool | None = None
    backend_proxy_url: str | None = Field(default=None, max_length=240)
    api_path: str | None = Field(default=None, max_length=120)


class AiProjectCommandPayload(BaseModel):
    command: str = Field(min_length=1, max_length=2000)
    timeout_seconds: int = Field(default=25, ge=2, le=60)


class AiProjectGitClonePayload(BaseModel):
    repo_url: str | None = Field(default=None, max_length=1024)
    branch: str | None = Field(default=None, max_length=120)
    provider: str | None = Field(default=None, pattern="^(github|gitlab)$")
    token: str | None = Field(default=None, max_length=512)


class AiProjectGitCommitPayload(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    push: bool = False
    token: str | None = Field(default=None, max_length=512)


class AiProjectGitCreateRepoPayload(BaseModel):
    repo_name: str | None = Field(default=None, max_length=120)
    private: bool = True
    description: str | None = Field(default=None, max_length=350)
    provider: str = Field(default="github", pattern="^(github|gitlab)$")
    token: str | None = Field(default=None, max_length=512)


class AiProjectPreviewInspectPayload(BaseModel):
    viewports: list[str] | None = None
    interactions: list[dict[str, Any]] | None = None


AiProjectPreviewInspectPayload.model_rebuild()


@router.get("", response_model=list[AiProjectResponse])
def list_projects(
    team_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> list[AiProjectResponse]:
    rows = ai_project_service.list_projects(db, user, team_id=team_id)
    return [AiProjectResponse.model_validate(r) for r in rows]


@router.post("", response_model=AiProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: AiProjectCreatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> AiProjectResponse:
    try:
        row = ai_project_service.create_project(
            db,
            user,
            **payload.model_dump(),
        )
        return AiProjectResponse.model_validate(row)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{project_id}", response_model=AiProjectResponse)
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> AiProjectResponse:
    try:
        row = ai_project_service.get_project(db, user, project_id)
        return AiProjectResponse.model_validate(row)
    except AiProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{project_id}", response_model=AiProjectResponse)
def update_project(
    project_id: str,
    payload: AiProjectUpdatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> AiProjectResponse:
    try:
        row = ai_project_service.update_project(
            db,
            user,
            project_id,
            **payload.model_dump(exclude_unset=True),
        )
        return AiProjectResponse.model_validate(row)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> Response:
    try:
        ai_project_service.delete_project(db, user, project_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AiProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{project_id}/files", response_model=list[AiProjectFileResponse])
def list_project_files(
    project_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> list[AiProjectFileResponse]:
    try:
        rows = ai_project_service.list_project_files(db, user, project_id)
        return [AiProjectFileResponse.model_validate(r) for r in rows]
    except AiProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{project_id}/files", response_model=AiProjectFileResponse)
@router.put("/{project_id}/files", response_model=AiProjectFileResponse)
def write_project_file(
    project_id: str,
    payload: AiProjectFileWritePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.coding.use")),
    _: None = Depends(verify_csrf),
) -> AiProjectFileResponse:
    try:
        row = ai_project_service.write_project_file(
            db,
            user,
            project_id,
            rel_path=payload.path,
            content=payload.content,
            mime_type=payload.mime_type,
        )
        resp = AiProjectFileResponse.model_validate(row)
        resp.diff = getattr(row, "_last_diff", None)
        return resp
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{project_id}/files", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_file(
    project_id: str,
    path: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> Response:
    try:
        ai_project_service.delete_project_file(db, user, project_id, path)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/exec")
def execute_project_command(
    project_id: str,
    payload: AiProjectCommandPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.coding.use")),
    _: None = Depends(verify_csrf),
) -> dict[str, object]:
    try:
        return ai_project_service.run_project_command(
            db,
            user,
            project_id,
            payload.command,
            timeout_seconds=payload.timeout_seconds,
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{project_id}/agents-rules")
def get_project_agents_rules(
    project_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> dict[str, object]:
    try:
        return ai_project_service.get_project_agents_rules(db, user, project_id)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{project_id}/git/status")
def get_project_git_status(
    project_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> dict[str, object]:
    try:
        return ai_project_service.git_status(db, user, project_id)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/git/sync")
def sync_project_git(
    project_id: str,
    payload: AiProjectGitClonePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> dict[str, object]:
    try:
        return ai_project_service.git_clone_or_pull(
            db,
            user,
            project_id,
            repo_url=payload.repo_url,
            branch=payload.branch,
            provider=payload.provider,
            token=payload.token,
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/git/commit")
def commit_project_git(
    project_id: str,
    payload: AiProjectGitCommitPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.coding.use")),
    _: None = Depends(verify_csrf),
) -> dict[str, object]:
    try:
        return ai_project_service.git_commit_and_push(
            db,
            user,
            project_id,
            message=payload.message,
            push=payload.push,
            token=payload.token,
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/git/create-repo")
def create_project_git_repo(
    project_id: str,
    payload: AiProjectGitCreateRepoPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> dict[str, object]:
    try:
        return ai_project_service.git_create_remote_repository(
            db,
            user,
            project_id,
            repo_name=payload.repo_name,
            private=payload.private,
            description=payload.description,
            provider=payload.provider,
            token=payload.token,
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{project_id}/environment")
def get_project_environment(
    project_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> dict[str, object]:
    try:
        return ai_project_service.get_project_environment(db, user, project_id)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/environment/switch")
def switch_project_environment(
    project_id: str,
    payload: AiProjectEnvironmentSwitchPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> dict[str, object]:
    try:
        return ai_project_service.switch_project_environment(
            db, user, project_id, payload.environment
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/publish")
def publish_project_to_production(
    project_id: str,
    payload: AiProjectPublishPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
    _: None = Depends(verify_csrf),
) -> dict[str, object]:
    try:
        return ai_project_service.publish_project_to_production(
            db,
            user,
            project_id,
            node_id=payload.node_id,
            release_notes=payload.release_notes,
            mode=payload.mode,
            domain=payload.domain,
            enable_database=payload.enable_database,
            backend_proxy_url=payload.backend_proxy_url,
            api_path=payload.api_path,
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{project_id}/production-files")
def list_project_production_files(
    project_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> list[dict[str, object]]:
    try:
        return ai_project_service.list_production_files(db, user, project_id)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{project_id}/cross-project-components")
def search_project_reusable_components(
    project_id: str,
    query: str = Query(default="", max_length=200),
    limit: int = Query(default=8, ge=1, le=25),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> list[dict[str, object]]:
    try:
        return ai_project_service.search_cross_project_components(
            db,
            user,
            current_project_id=project_id,
            query=query,
            limit=limit,
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/preview/inspect")
def inspect_project_preview(
    project_id: str,
    payload: AiProjectPreviewInspectPayload | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.projects.manage")),
) -> dict[str, object]:
    try:
        vps = payload.viewports if payload else None
        inter = payload.interactions if payload else None
        return ai_project_service.inspect_project_preview(
            db, user, project_id, viewports=vps, interactions=inter
        )
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
