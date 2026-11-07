"""AI-Projekte und Projektdateien fuer Wissens-, Schreib- und Coding-Workspaces."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.dis_text import ai_text


WORKSPACE_MODES = ("docs", "sandbox", "desktop")
GIT_PROVIDERS = ("github", "gitlab", "custom")


class AiProject(Base):
    """Ein gemeinsamer Arbeitsbereich fuer Nutzer und KI.

    Vereint Wissens-/Schreibprojekte (Markdown, Docs, Strukturbaum) und
    Code-Projekte (Linux-Server-Sandbox oder lokaler Desktop-Ordner samt
    GitHub-/GitLab-Anbindung).
    """

    __tablename__ = "ai_projects"
    __table_args__ = (
        CheckConstraint(
            "workspace_mode IN ('docs', 'sandbox', 'desktop')",
            name="ck_ai_projects_workspace_mode",
        ),
        Index("ix_ai_projects_user_updated", "user_id", "updated_at"),
        Index("ix_ai_projects_team_updated", "team_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    team_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(ai_text("ai_projects.name"), nullable=False)
    description: Mapped[str | None] = mapped_column(
        ai_text("ai_projects.description"), nullable=True
    )
    instructions: Mapped[str | None] = mapped_column(
        ai_text("ai_projects.instructions"), nullable=True
    )
    icon: Mapped[str] = mapped_column(
        String(32), nullable=False, default="folder", server_default="folder"
    )
    color: Mapped[str] = mapped_column(
        String(32), nullable=False, default="emerald", server_default="emerald"
    )
    workspace_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="docs", server_default="docs"
    )
    # Lokaler Pfad auf dem PC (nur bei workspace_mode == 'desktop' oder verknüpftem lokalen Ordner)
    local_path: Mapped[str | None] = mapped_column(
        ai_text("ai_projects.local_path"), nullable=True
    )
    # Git-Integration (GitHub / GitLab / Custom)
    git_provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    git_repo_url: Mapped[str | None] = mapped_column(
        ai_text("ai_projects.git_repo_url"), nullable=True
    )
    git_branch: Mapped[str | None] = mapped_column(
        String(128), nullable=True, default="main"
    )
    git_credential_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("user_credentials.id", ondelete="SET NULL"),
        nullable=True,
    )
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    @property
    def sandbox_path(self) -> str:
        if self.workspace_mode == "desktop" and self.local_path:
            return self.local_path
        from services.ai_project_service import _sandbox_base_dir
        return str(_sandbox_base_dir() / f"proj_{self.id}")

    @sandbox_path.setter
    def sandbox_path(self, _val: str | None) -> None:
        pass

    @property
    def sandbox_mode(self) -> str:
        return self.workspace_mode

    @property
    def system_prompt(self) -> str | None:
        return self.instructions

    @property
    def owner_user_id(self) -> int:
        return self.user_id

    @property
    def project_kind(self) -> str:
        if self.workspace_mode == "docs":
            return "docs"
        return "coding"

    @property
    def sandbox_enabled(self) -> bool:
        return self.workspace_mode in ("sandbox", "desktop")

    @property
    def local_directory(self) -> str | None:
        return self.local_path

    @property
    def git_token_configured(self) -> bool:
        return self.git_credential_id is not None

    @property
    def file_count(self) -> int:
        return getattr(self, "_file_count", 0)



class AiProjectFile(Base):
    """Eine Datei innerhalb eines AI-Projekts (Text, Code, Markdown, Konzept).

    Wird mit DIS verschlüsselt in der Datenbank gehalten und bei aktivem
    Sandbox-Workspace zusätzlich mit dem isolierten Projektverzeichnis
    synchronisiert.
    """

    __tablename__ = "ai_project_files"
    __table_args__ = (
        Index("ix_ai_project_files_project_path", "project_id", "path", unique=True),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[str] = mapped_column(
        ai_text("ai_project_files.content"), nullable=False, default=""
    )
    mime_type: Mapped[str] = mapped_column(
        String(128), nullable=False, default="text/markdown", server_default="text/markdown"
    )
    size_bytes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    updated_by_ai: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
