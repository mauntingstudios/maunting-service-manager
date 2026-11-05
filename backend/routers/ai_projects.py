"""API-Routen fuer universelle Singra KI-Projekte (Wissen, Dateien, Coding-Sandbox & Git)."""

from __future__ import annotations

from datetime import datetime
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
    team_id: int | None = None
    sandbox_mode: str = Field(default="server", pattern="^(server|local|none)$")
    local_path: str | None = Field(default=None, max_length=1024)
    git_provider: str | None = Field(default=None, pattern="^(github|gitlab)$")
    git_repo_url: str | None = Field(default=None, max_length=1024)
    git_branch: str | None = Field(default="main", max_length=120)


class AiProjectUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    system_prompt: str | None = Field(default=None, max_length=12000)
    icon: str | None = Field(default=None, max_length=48)
    color: str | None = Field(default=None, max_length=32)
    pinned: bool | None = None
    sandbox_mode: str | None = Field(default=None, pattern="^(server|local|none)$")
    local_path: str | None = Field(default=None, max_length=1024)
    git_provider: str | None = Field(default=None, pattern="^(github|gitlab)$")
    git_repo_url: str | None = Field(default=None, max_length=1024)
    git_branch: str | None = Field(default=None, max_length=120)


class AiProjectResponse(BaseModel):
    id: int
    user_id: int
    team_id: int | None = None
    name: str
    description: str | None = None
    system_prompt: str | None = None
    icon: str
    color: str
    pinned: bool
    sandbox_mode: str
    sandbox_path: str | None = None
    local_path: str | None = None
    git_provider: str | None = None
    git_repo_url: str | None = None
    git_branch: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiProjectFileWritePayload(BaseModel):
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(default="")
    mime_type: str = Field(default="text/plain", max_length=80)


class AiProjectFileResponse(BaseModel):
    id: int
    project_id: int
    path: str
    content: str
    mime_type: str
    size_bytes: int
    updated_at: datetime

    model_config = {"from_attributes": True}


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


@router.get("", response_model=list[AiProjectResponse])
def list_projects(
    team_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> list[AiProjectResponse]:
    rows = ai_project_service.list_projects(db, user, team_id=team_id)
    return [AiProjectResponse.model_validate(r) for r in rows]


@router.post("", response_model=AiProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: AiProjectCreatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
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
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> AiProjectResponse:
    try:
        row = ai_project_service.get_project(db, user, project_id)
        return AiProjectResponse.model_validate(row)
    except AiProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{project_id}", response_model=AiProjectResponse)
def update_project(
    project_id: int,
    payload: AiProjectUpdatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
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
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> Response:
    try:
        ai_project_service.delete_project(db, user, project_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AiProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{project_id}/files", response_model=list[AiProjectFileResponse])
def list_project_files(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> list[AiProjectFileResponse]:
    try:
        rows = ai_project_service.list_project_files(db, user, project_id)
        return [AiProjectFileResponse.model_validate(r) for r in rows]
    except AiProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{project_id}/files", response_model=AiProjectFileResponse)
def write_project_file(
    project_id: int,
    payload: AiProjectFileWritePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
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
        return AiProjectFileResponse.model_validate(row)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{project_id}/files", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_file(
    project_id: int,
    path: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> Response:
    try:
        ai_project_service.delete_project_file(db, user, project_id, path)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/exec")
def execute_project_command(
    project_id: int,
    payload: AiProjectCommandPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
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


@router.get("/{project_id}/git/status")
def get_project_git_status(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> dict[str, object]:
    try:
        return ai_project_service.git_status(db, user, project_id)
    except AiProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{project_id}/git/sync")
def sync_project_git(
    project_id: int,
    payload: AiProjectGitClonePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
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
    project_id: int,
    payload: AiProjectGitCommitPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
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
