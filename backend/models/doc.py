"""Dokumente, Ordner, Freigaben, Kommentare, Revisionen und Assets.

Ein Dokument gehoert genau einem Team. Inhalte liegen als DIS-Chiffrat in der
Datenbank, die Metadaten (Titel, Rolle, Rev) im Klartext — der Server muss fuer
Suche, Export und KI lesen koennen.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _gen_uid() -> str:
    return str(uuid.uuid4())


DOC_ROLES = ("viewer", "commenter", "editor")
REVISION_REASONS = (
    "initial",
    "autosave",
    "checkpoint",
    "ai_pre_edit",
    "ai_edit",
    "ai_undo",
    "before_restore",
    "restore",
    "import",
)


class DocFolder(Base):
    __tablename__ = "doc_folders"
    __table_args__ = (
        Index("ix_doc_folders_team_parent", "team_id", "parent_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    folder_uid: Mapped[str] = mapped_column(
        String(36), default=_gen_uid, nullable=False, unique=True
    )
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("doc_folders.id", ondelete="CASCADE"), nullable=True
    )
    name_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint(
            "default_role IN ('viewer', 'commenter', 'editor')",
            name="ck_documents_default_role",
        ),
        CheckConstraint(
            "share_role IS NULL OR share_role IN ('viewer', 'commenter')",
            name="ck_documents_share_role",
        ),
        CheckConstraint("rev >= 0", name="ck_documents_rev"),
        Index("ix_documents_team_folder", "team_id", "folder_id"),
        Index("ix_documents_team_updated", "team_id", text("updated_at DESC")),
        Index("ix_documents_owner", "owner_user_id"),
        Index(
            "uq_documents_share_token",
            "share_token_hash",
            unique=True,
            postgresql_where=text("share_token_hash IS NOT NULL"),
        ),
        Index(
            "ix_documents_purge",
            "purge_after",
            postgresql_where=text("purge_after IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    doc_uid: Mapped[str] = mapped_column(
        String(36), default=_gen_uid, nullable=False, unique=True
    )
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("doc_folders.id", ondelete="SET NULL"), nullable=True
    )
    owner_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    icon: Mapped[str | None] = mapped_column(String(16), nullable=True)
    default_role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="editor", server_default="editor"
    )
    share_role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    share_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    share_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    share_created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rev: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    state_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    state_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    state_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    schema_version: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=1, server_default="1"
    )
    content_text_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_chars: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    content_truncated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    asset_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    revision_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    purge_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
    last_edited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class DocMember(Base):
    __tablename__ = "doc_members"
    __table_args__ = (
        CheckConstraint(
            "role IN ('viewer', 'commenter', 'editor')", name="ck_doc_members_role"
        ),
        CheckConstraint("source IN ('manual', 'link')", name="ck_doc_members_source"),
        UniqueConstraint("document_id", "user_id", name="uq_doc_members_doc_user"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="manual", server_default="manual"
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    granted_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class DocComment(Base):
    __tablename__ = "doc_comments"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'resolved')", name="ck_doc_comments_status"),
        Index("ix_doc_comments_document", "document_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    comment_uid: Mapped[str] = mapped_column(
        String(36), default=_gen_uid, nullable=False, unique=True
    )
    document_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("doc_comments.id", ondelete="CASCADE"), nullable=True
    )
    author_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    anchor_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="open", server_default="open"
    )
    resolved_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class DocRevision(Base):
    __tablename__ = "doc_revisions"
    __table_args__ = (
        CheckConstraint(
            "reason IN (" + ", ".join(f"'{r}'" for r in REVISION_REASONS) + ")",
            name="ck_doc_revisions_reason",
        ),
        CheckConstraint(
            "author_kind IN ('user', 'ai', 'system')", name="ck_doc_revisions_author_kind"
        ),
        Index("uq_doc_revisions_doc_rev", "document_id", "rev", unique=True),
        Index("ix_doc_revisions_created", "document_id", text("created_at DESC")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    rev: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(24), nullable=False)
    label_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    state_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    state_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    state_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    preview_text_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_kind: Mapped[str] = mapped_column(
        String(8), nullable=False, default="user", server_default="user"
    )
    ai_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


PENDING_STATUSES = ("pending", "applying", "applied", "rejected", "stale")


class DocPendingEdit(Base):
    """Eine KI-Aenderung, die noch auf die Bestaetigung ihres Menschen wartet.

    Sie liegt **nicht** im Yjs-Dokument und nicht in `doc_revisions`: Andere
    Mitarbeiter duerfen sie nicht sehen, und der Verlauf soll keine Aenderung
    zeigen, die es noch nicht gibt. Der Inhalt ist DIS-verschluesselt; die
    Statusspalte bleibt Klartext, damit Aufraeumer und Sperren ohne
    Entschluesselung arbeiten koennen.
    """

    __tablename__ = "doc_pending_edits"
    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{s}'" for s in PENDING_STATUSES) + ")",
            name="ck_doc_pending_edits_status",
        ),
        CheckConstraint(
            "operation IN ('append', 'replace_block')",
            name="ck_doc_pending_edits_operation",
        ),
        Index("ix_doc_pending_document_user", "document_id", "user_id"),
        Index(
            "uq_doc_pending_offen",
            "document_id",
            "user_id",
            unique=True,
            postgresql_where=text("status IN ('pending', 'applying')"),
        ),
        Index("ix_doc_pending_expires", "expires_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    pending_uid: Mapped[str] = mapped_column(
        String(36), default=_gen_uid, nullable=False, unique=True
    )
    document_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    call_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    payload_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    base_rev: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Wann die Uebernahme beansprucht wurde. Nicht `created_at`: Ein alter
    # Vorschlag wuerde sonst waehrend der Uebernahme als haengend gelten.
    applying_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    applied_rev: Mapped[int | None] = mapped_column(Integer, nullable=True)


class DocAsset(Base):
    __tablename__ = "doc_assets"
    __table_args__ = (Index("ix_doc_assets_document", "document_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset_uid: Mapped[str] = mapped_column(
        String(36), default=_gen_uid, nullable=False, unique=True
    )
    document_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    uploader_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    file_name_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    mime: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    ciphertext_blob: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
