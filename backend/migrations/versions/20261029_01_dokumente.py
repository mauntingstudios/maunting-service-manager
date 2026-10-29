"""Dokumente-Modul: Tabellen, Indizes und Docs-Gespraeche.

Revision ID: 20261029_01
Revises: 20261024_01
Create Date: 2026-10-28
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261029_01"
down_revision: Union[str, None] = "20261028_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "doc_folders",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("folder_uid", sa.String(length=36), nullable=False, unique=True),
        sa.Column(
            "team_id",
            sa.Integer(),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.BigInteger(),
            sa.ForeignKey("doc_folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name_encrypted", sa.Text(), nullable=False),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_doc_folders_team_parent", "doc_folders", ["team_id", "parent_id"]
    )

    op.create_table(
        "documents",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("doc_uid", sa.String(length=36), nullable=False, unique=True),
        sa.Column(
            "team_id",
            sa.Integer(),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "folder_id",
            sa.BigInteger(),
            sa.ForeignKey("doc_folders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title_encrypted", sa.Text(), nullable=False),
        sa.Column("icon", sa.String(length=16), nullable=True),
        sa.Column(
            "default_role",
            sa.String(length=16),
            nullable=False,
            server_default="editor",
        ),
        sa.Column("share_role", sa.String(length=16), nullable=True),
        sa.Column("share_token_hash", sa.String(length=64), nullable=True),
        sa.Column("share_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "share_created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rev", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state_encrypted", sa.Text(), nullable=True),
        sa.Column("state_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("state_sha256", sa.String(length=64), nullable=True),
        sa.Column(
            "schema_version", sa.SmallInteger(), nullable=False, server_default="1"
        ),
        sa.Column("content_text_encrypted", sa.Text(), nullable=True),
        sa.Column("content_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "content_truncated", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column("asset_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "revision_bytes", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("purge_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_edited_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "default_role IN ('viewer', 'commenter', 'editor')",
            name="ck_documents_default_role",
        ),
        sa.CheckConstraint(
            "share_role IS NULL OR share_role IN ('viewer', 'commenter')",
            name="ck_documents_share_role",
        ),
        sa.CheckConstraint("rev >= 0", name="ck_documents_rev"),
    )
    op.create_index("ix_documents_team_id", "documents", ["team_id"])
    op.create_index("ix_documents_team_folder", "documents", ["team_id", "folder_id"])
    op.create_index(
        "ix_documents_team_updated",
        "documents",
        ["team_id", sa.text("updated_at DESC")],
    )
    op.create_index("ix_documents_owner", "documents", ["owner_user_id"])
    op.create_index(
        "uq_documents_share_token",
        "documents",
        ["share_token_hash"],
        unique=True,
        postgresql_where=sa.text("share_token_hash IS NOT NULL"),
    )
    op.create_index(
        "ix_documents_purge",
        "documents",
        ["purge_after"],
        postgresql_where=sa.text("purge_after IS NOT NULL"),
    )

    op.create_table(
        "doc_members",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "document_id",
            sa.BigInteger(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column(
            "source", sa.String(length=16), nullable=False, server_default="manual"
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "granted_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "role IN ('viewer', 'commenter', 'editor')", name="ck_doc_members_role"
        ),
        sa.CheckConstraint(
            "source IN ('manual', 'link')", name="ck_doc_members_source"
        ),
        sa.UniqueConstraint("document_id", "user_id", name="uq_doc_members_doc_user"),
    )

    op.create_table(
        "doc_comments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("comment_uid", sa.String(length=36), nullable=False, unique=True),
        sa.Column(
            "document_id",
            sa.BigInteger(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.BigInteger(),
            sa.ForeignKey("doc_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "author_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body_encrypted", sa.Text(), nullable=False),
        sa.Column("anchor_encrypted", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column(
            "resolved_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('open', 'resolved')", name="ck_doc_comments_status"
        ),
    )
    op.create_index(
        "ix_doc_comments_document", "doc_comments", ["document_id", "status"]
    )

    op.create_table(
        "doc_revisions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "document_id",
            sa.BigInteger(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rev", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=24), nullable=False),
        sa.Column("label_encrypted", sa.Text(), nullable=True),
        sa.Column("state_encrypted", sa.Text(), nullable=False),
        sa.Column("state_bytes", sa.BigInteger(), nullable=False),
        sa.Column("state_sha256", sa.String(length=64), nullable=False),
        sa.Column("preview_text_encrypted", sa.Text(), nullable=True),
        sa.Column(
            "author_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "author_kind", sa.String(length=8), nullable=False, server_default="user"
        ),
        sa.Column("ai_run_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "reason IN ('initial', 'autosave', 'checkpoint', 'ai_pre_edit', "
            "'ai_edit', 'ai_undo', 'before_restore', 'restore', 'import')",
            name="ck_doc_revisions_reason",
        ),
        sa.CheckConstraint(
            "author_kind IN ('user', 'ai', 'system')",
            name="ck_doc_revisions_author_kind",
        ),
    )
    op.create_index(
        "uq_doc_revisions_doc_rev", "doc_revisions", ["document_id", "rev"], unique=True
    )
    op.create_index(
        "ix_doc_revisions_created",
        "doc_revisions",
        ["document_id", sa.text("created_at DESC")],
    )

    op.create_table(
        "doc_assets",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("asset_uid", sa.String(length=36), nullable=False, unique=True),
        sa.Column(
            "document_id",
            sa.BigInteger(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "uploader_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("file_name_encrypted", sa.Text(), nullable=False),
        sa.Column("mime", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("ciphertext_blob", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_doc_assets_document", "doc_assets", ["document_id"])

    op.add_column(
        "ai_conversations",
        sa.Column(
            "document_id",
            sa.BigInteger(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_ai_conversations_document_id", "ai_conversations", ["document_id"]
    )
    op.execute(
        "ALTER TABLE ai_conversations DROP CONSTRAINT IF EXISTS ck_ai_conversations_kind"
    )
    op.create_check_constraint(
        "ck_ai_conversations_kind",
        "ai_conversations",
        "kind IN ('primary', 'guardian', 'worker', 'docs')",
    )
    op.create_index(
        "uq_ai_conversations_user_document",
        "ai_conversations",
        ["user_id", "document_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'docs' AND document_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM ai_conversations WHERE kind = 'docs'")
    op.drop_index("uq_ai_conversations_user_document", table_name="ai_conversations")
    op.execute(
        "ALTER TABLE ai_conversations DROP CONSTRAINT IF EXISTS ck_ai_conversations_kind"
    )
    op.create_check_constraint(
        "ck_ai_conversations_kind",
        "ai_conversations",
        "kind IN ('primary', 'guardian', 'worker')",
    )
    op.drop_index("ix_ai_conversations_document_id", table_name="ai_conversations")
    op.drop_column("ai_conversations", "document_id")

    op.drop_index("ix_doc_assets_document", table_name="doc_assets")
    op.drop_table("doc_assets")
    op.drop_index("ix_doc_revisions_created", table_name="doc_revisions")
    op.drop_index("uq_doc_revisions_doc_rev", table_name="doc_revisions")
    op.drop_table("doc_revisions")
    op.drop_index("ix_doc_comments_document", table_name="doc_comments")
    op.drop_table("doc_comments")
    op.drop_table("doc_members")
    op.drop_index("ix_documents_purge", table_name="documents")
    op.drop_index("uq_documents_share_token", table_name="documents")
    op.drop_index("ix_documents_owner", table_name="documents")
    op.drop_index("ix_documents_team_updated", table_name="documents")
    op.drop_index("ix_documents_team_folder", table_name="documents")
    op.drop_index("ix_documents_team_id", table_name="documents")
    op.drop_table("documents")
    op.drop_index("ix_doc_folders_team_parent", table_name="doc_folders")
    op.drop_table("doc_folders")
