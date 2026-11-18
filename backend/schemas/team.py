"""API-Vertraege fuer Teams, Medien, Mitglieder, Rollen und Serverrechte."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from schemas.social import PresenceInfo


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    category: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=500)
    avatar_preset: str | None = Field(default=None, max_length=64)
    banner_preset: str | None = Field(default=None, max_length=64)


class TeamRename(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    category: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=500)
    avatar_preset: str | None = Field(default=None, max_length=64)
    banner_preset: str | None = Field(default=None, max_length=64)


class TeamMemberWrite(BaseModel):
    user_id: int = Field(ge=1)
    team_role_id: int | None = None
    role_ids: list[int] = Field(default_factory=list)


class TeamMemberRolesUpdate(BaseModel):
    role_ids: list[int] = Field(default_factory=list)


class TeamRoleServerGrantWrite(BaseModel):
    server_id: int = Field(ge=1)
    permission_keys: list[str] = Field(default_factory=list, max_length=64)


class TeamRoleServerGrantResponse(BaseModel):
    server_id: int
    server_name: str
    permission_keys: list[str]


class TeamRoleWrite(BaseModel):
    name: str = Field(min_length=2, max_length=32)
    description: str | None = Field(default=None, max_length=255)
    color: str = Field(default="#3b82f6", max_length=16)
    icon: str | None = Field(default=None, max_length=32)
    is_default: bool = False
    is_admin: bool = False
    permission_keys: list[str] = Field(default_factory=list, max_length=64)
    server_grants: list[TeamRoleServerGrantWrite] = Field(default_factory=list)


class TeamRoleResponse(BaseModel):
    id: int
    team_id: int
    name: str
    description: str | None = None
    color: str
    icon: str | None = None
    is_default: bool
    is_admin: bool = False
    created_at: datetime
    permission_keys: list[str] = Field(default_factory=list)
    server_grants: list[TeamRoleServerGrantResponse] = Field(default_factory=list)
    members_count: int = 0


class TeamServerRolesWrite(BaseModel):
    active: bool


class TeamServerGrantWrite(BaseModel):
    server_id: int = Field(ge=1)
    # Leere Liste heisst: der Server wird dem Team wieder entzogen.
    permission_keys: list[str] = Field(default_factory=list, max_length=64)


class TeamServerGrantsBatchWrite(BaseModel):
    grants: list[TeamServerGrantWrite] = Field(min_length=1, max_length=200)


class TeamMemberResponse(BaseModel):
    user_id: int
    username: str
    avatar_url: str | None = None
    role: Literal["owner", "member"]
    team_role_id: int | None = None
    role_ids: list[int] = Field(default_factory=list)
    roles: list[TeamRoleResponse] = Field(default_factory=list)
    joined_at: datetime
    presence: PresenceInfo | None = None


class TeamInvitationResponse(BaseModel):
    """Eine ausgesprochene, noch nicht angenommene Einladung."""

    team_id: int
    team_name: str
    user_id: int
    username: str
    avatar_url: str | None = None
    invited_by_username: str | None
    team_role_id: int | None = None
    team_role_name: str | None = None
    invited_at: datetime


class TeamServerResponse(BaseModel):
    server_id: int
    server_name: str
    permission_keys: list[str]


class TeamMediaGalleryItem(BaseModel):
    id: int
    team_id: int
    kind: Literal["avatar", "banner"]
    uploaded_by: str
    created_at: datetime
    is_active: bool


class TeamMediaPresetWrite(BaseModel):
    preset: str | None = Field(default=None, max_length=64)


class TeamResponse(BaseModel):
    id: int
    name: str
    is_personal: bool
    owner_user_id: int
    is_owner: bool
    category: str | None = None
    description: str | None = None
    avatar_source: str = "preset"
    avatar_preset: str | None = None
    avatar_url: str | None = None
    avatar_version: str | None = None
    banner_source: str = "panorama"
    banner_preset: str | None = None
    banner_url: str | None = None
    banner_version: str | None = None
    # Abgeleitete effektive Rechte des Abrufenden (aus Rollen + Eigentuemer):
    can_manage_skills: bool = False
    can_manage_memory: bool = False
    can_access_vault: bool = True
    can_manage_avatar: bool = False
    can_manage_banner: bool = False
    server_roles_active: bool = False
    member_count: int
    created_at: datetime


class TeamDetailResponse(TeamResponse):
    members: list[TeamMemberResponse]
    servers: list[TeamServerResponse]
    invitations: list[TeamInvitationResponse] = []
    roles: list[TeamRoleResponse] = []


class TeamVaultStatusResponse(BaseModel):
    is_setup: bool
    bucket_id: str | None = None
    key_version: int | None = None
    needs_rotation: bool = False
    is_owner: bool = False
    can_access_vault: bool = True
    rotation_state: str | None = None
    pending_bucket_id: str | None = None


class TeamVaultSetupRequest(BaseModel):
    bucket_id: str = Field(min_length=64, max_length=64)


class TeamVaultKeyslotUpload(BaseModel):
    user_id: int = Field(gt=0)
    wrapped_dek: str = Field(min_length=32, max_length=16384)


class TeamVaultKeyslotsRequest(BaseModel):
    key_version: int = Field(gt=0)
    slots: list[TeamVaultKeyslotUpload] = Field(min_length=1, max_length=500)


class TeamVaultKeyslotResponse(BaseModel):
    key_version: int
    wrapped_dek: str


class TeamVaultRotationPrepareRequest(BaseModel):
    """Rotation vorbereiten: nur die neue Bucket-Kennung."""

    bucket_id: str = Field(min_length=64, max_length=64)
