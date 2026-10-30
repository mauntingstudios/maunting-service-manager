"""Pydantic-Schemata fuer das Dokumente-Modul."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

DocRole = Literal["viewer", "commenter", "editor"]
ShareRole = Literal["viewer", "commenter"]


class DocFolderCreate(BaseModel):
    team_id: int | None = None
    parent_uid: str | None = None
    name: str = Field(min_length=1, max_length=200)


class DocFolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_uid: str | None = None


class DocFolderMove(BaseModel):
    parent_uid: str | None = None


class DocCreate(BaseModel):
    team_id: int | None = None
    folder_uid: str | None = None
    title: str | None = Field(default=None, max_length=200)


class DocUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    icon: str | None = Field(default=None, max_length=16)
    archived: bool | None = None
    folder_uid: str | None = None
    default_role: DocRole | None = None
    team_id: int | None = None


class MemberPut(BaseModel):
    role: DocRole


class ShareCreate(BaseModel):
    role: ShareRole = "viewer"
    expires_in_days: int | None = Field(default=7, ge=1, le=30)


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_uid: str | None = None
    anchor: dict[str, Any] | None = None


class CommentUpdate(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=20_000)
    status: Literal["open", "resolved"] | None = None


class RevisionCreate(BaseModel):
    label: str | None = Field(default=None, max_length=200)


class AssetUpload(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    mime: str = Field(min_length=1, max_length=128)
    data_base64: str = Field(min_length=1)
    sha256: str = Field(min_length=64, max_length=64)

    @field_validator("sha256")
    @classmethod
    def _hex(cls, wert: str) -> str:
        wert = wert.lower()
        if any(z not in "0123456789abcdef" for z in wert):
            raise ValueError("sha256 muss hexadezimal sein")
        return wert


class DocSummary(BaseModel):
    uid: str
    title: str
    folder_uid: str | None = None
    team_id: int
    team_name: str | None = None
    role: DocRole
    can_edit: bool
    can_comment: bool
    can_manage: bool = False
    rev: int
    archived: bool = False
    deleted: bool = False
    content_truncated: bool = False
    updated_at: str
    last_edited_at: str
    owner: str | None = None


class DocDetail(DocSummary):
    default_role: DocRole = "editor"
    schema_version: int = 1
    shared: bool = False
    share_role: ShareRole | None = None
    share_expires_at: str | None = None


# ── Interne Endpunkte (Sidecar → FastAPI) ────────────────────────────


class InternalAuthorize(BaseModel):
    doc_uid: str
    user_id: int
    role: str
    fam: str | None = None
    jti: str | None = None


class InternalStore(BaseModel):
    state_b64: str
    expected_rev: int
    origin: str = "autosave"
    author_user_id: int | None = None
    author_family: str | None = None
    ai_run_id: str | None = None
    summary: str | None = None
    state_sha256: str
    content_text: str = ""
    content_truncated: bool = False
    reason: str | None = None
    # Ein Checkpoint oder Pre-KI-Snapshot soll auch dann als Version erscheinen,
    # wenn sich der Zustand seit dem letzten Store nicht geaendert hat.
    force_revision: bool = False


class InternalAiStore(BaseModel):
    """Vorher-Zustand und Ergebnis einer KI-Aenderung, atomar gespeichert."""

    pre_state_b64: str
    pre_state_sha256: str
    state_b64: str
    state_sha256: str
    pre_content_text: str = ""
    content_text: str = ""
    content_truncated: bool = False
    origin: str
    author_user_id: int
    author_family: str | None = None
    ai_run_id: str | None = None
    summary: str | None = None
    edits_applied: int = 1
    schema_version: int = 1
