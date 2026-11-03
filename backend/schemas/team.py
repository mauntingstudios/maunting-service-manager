"""API-Vertraege fuer Teams, Mitglieder und weitergegebene Serverrechte."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from schemas.passkey import Zweitnachweis


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=64)


class TeamRename(BaseModel):
    name: str = Field(min_length=2, max_length=64)


class TeamMemberWrite(BaseModel):
    user_id: int = Field(ge=1)
    can_manage_skills: bool = False
    can_manage_memory: bool = False
    can_access_vault: bool = True
    team_role_id: int | None = None
    role_ids: list[int] = Field(default_factory=list)


class TeamMemberUpdate(BaseModel):
    can_manage_skills: bool
    can_manage_memory: bool
    can_access_vault: bool = True
    team_role_id: int | None = None
    role_ids: list[int] | None = None


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
    can_access_vault: bool = True
    can_manage_skills: bool = False
    can_manage_memory: bool = False
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
    can_access_vault: bool
    can_manage_skills: bool
    can_manage_memory: bool
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


class TeamMemberResponse(BaseModel):
    user_id: int
    username: str
    avatar_url: str | None = None
    role: Literal["owner", "member"]
    can_manage_skills: bool
    can_manage_memory: bool
    can_access_vault: bool = True
    team_role_id: int | None = None
    role_ids: list[int] = Field(default_factory=list)
    roles: list[TeamRoleResponse] = Field(default_factory=list)
    joined_at: datetime


class TeamInvitationResponse(BaseModel):
    """Eine ausgesprochene, noch nicht angenommene Einladung.

    Dieselbe Zeile aus beiden Blickwinkeln: der Gruender sieht in der
    Teamansicht, wen er angeschrieben hat, der Eingeladene in seiner eigenen
    Liste, wer ihn haben will und was ihm dabei angeboten wird.
    """

    team_id: int
    team_name: str
    user_id: int
    username: str
    avatar_url: str | None = None
    invited_by_username: str | None
    can_manage_skills: bool
    can_manage_memory: bool
    can_access_vault: bool = True
    team_role_id: int | None = None
    invited_at: datetime


class TeamServerResponse(BaseModel):
    server_id: int
    server_name: str
    permission_keys: list[str]


class TeamResponse(BaseModel):
    id: int
    name: str
    is_personal: bool
    owner_user_id: int
    # Ob der Abrufende dieses Team verwalten darf. Spart der Oberflaeche eine
    # zweite Abfrage und haelt die Bedingung an einer Stelle.
    is_owner: bool
    can_manage_skills: bool
    can_manage_memory: bool
    can_access_vault: bool = True
    server_roles_active: bool = False
    member_count: int
    created_at: datetime


class TeamDetailResponse(TeamResponse):
    members: list[TeamMemberResponse]
    servers: list[TeamServerResponse]
    # Wer eingeladen ist, ist noch niemand im Team — steht aber hier, damit der
    # Gruender nicht den Eindruck bekommt, seine Einladung sei verschwunden.
    invitations: list[TeamInvitationResponse] = []
    roles: list[TeamRoleResponse] = []


class TeamVaultSaltResponse(BaseModel):
    is_setup: bool
    salt: str | None = None
    bucket_id: str | None = None
    needs_rotation: bool = False
    is_owner: bool = False
    can_access_vault: bool = True
    has_hint: bool = False
    rotation_state: str | None = None
    pending_bucket_id: str | None = None
    pending_salt: str | None = None


class TeamVaultSetupRequest(BaseModel):
    bucket_id: str = Field(min_length=64, max_length=64)
    salt: str = Field(min_length=16, max_length=128)
    hint: str | None = Field(default=None, max_length=512, description="Optionaler Passwort-Hinweis fuer das Master-Passwort")


class TeamVaultRotateRequest(BaseModel):
    bucket_id: str | None = Field(default=None, min_length=64, max_length=64)
    salt: str | None = Field(default=None, min_length=16, max_length=128)
    # Alt-Endpunkt: committet eine vorbereitete Rotation und braucht deshalb
    # denselben frischen Nachweis wie `/rotation/commit`.
    password: str | None = Field(default=None, max_length=256)
    otp_code: str | None = Field(default=None, pattern=r"^\d{6}$")
    passkey: Zweitnachweis | None = None

