from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field


class RoleCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    description: str | None = Field(None, max_length=255)
    color: str = Field("#3b82f6", max_length=16)
    icon: str | None = Field(None, max_length=32)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    description: str | None = Field(None, max_length=255)
    color: str | None = Field(None, max_length=16)
    icon: str | None = Field(None, max_length=32)
    permissions: list[str] | None = None


class RoleResponse(BaseModel):
    id: int
    name: str
    description: str | None
    color: str = "#3b82f6"
    icon: str | None = None
    is_system: bool
    permissions: list[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AssignRoleRequest(BaseModel):
    role_id: int | None  # None = Rolle entfernen


class AssignRolesRequest(BaseModel):
    """Vollständige globale Rollenzuweisung eines Benutzers."""

    role_ids: list[Annotated[int, Field(gt=0)]] = Field(default_factory=list, max_length=32)


class ServerPermissionsRequest(BaseModel):
    permissions: list[str] = Field(default_factory=list)


class ServerPermissionsResponse(BaseModel):
    server_id: int
    permissions: list[str]
