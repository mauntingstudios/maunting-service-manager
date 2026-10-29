"""Dokumente-Modul: Tabellen, Indizes und Docs-Gespraeche.

Revision ID: 20261029_01
Revises: 20261028_01
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


def _tabellen(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _spalten(bind, tabelle: str) -> set[str]:
    try:
        return {spalte["name"] for spalte in sa.inspect(bind).get_columns(tabelle)}
    except sa.exc.NoSuchTableError:
        return set()


def _indizes(bind, tabelle: str) -> set[str]:
    versuch = getattr(_indizes, "cache", None)
    if versuch is None:
        versuch = _indizes.cache = {}
    if tabelle not in versuch:
        try:
            versuch[tabelle] = {i["name"] for i in sa.inspect(bind).get_indexes(tabelle)}
        except sa.exc.NoSuchTableError:
            versuch[tabelle] = set()
    return versuch[tabelle]


def upgrade() -> None:
    """Legt das Docs-Schema an — auch auf Staenden, die es schon teilweise haben.

    Der Branch wurde vor dem Merge unter einer anderen Revisions-ID installiert.
    Ein Betreiber kann deshalb bereits Docs-Tabellen besitzen, waehrend Alembic
    die Revision noch nicht kennt. Jede Anweisung prueft darum zuerst, ob ihr
    Objekt schon da ist; vorhandene Dokumente bleiben unangetastet.
    """
    bind = op.get_bind()
    vorhandene_tabellen = _tabellen(bind)
    _indizes.cache = {}

    def tabelle(name, *spalten, **kw):
        if name in vorhandene_tabellen:
            return
        op.create_table(name, *spalten, **kw)
        vorhandene_tabellen.add(name)

    def index(name, tabelle_name, spalten, **kw):
        if name in _indizes(bind, tabelle_name):
            return
        op.create_index(name, tabelle_name, spalten, **kw)

    tabelle(
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
    index(
        "ix_doc_folders_team_parent", "doc_folders", ["team_id", "parent_id"]
    )

    tabelle(
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
    index("ix_documents_team_id", "documents", ["team_id"])
    index("ix_documents_team_folder", "documents", ["team_id", "folder_id"])
    index(
        "ix_documents_team_updated",
        "documents",
        ["team_id", sa.text("updated_at DESC")],
    )
    index("ix_documents_owner", "documents", ["owner_user_id"])
    index(
        "uq_documents_share_token",
        "documents",
        ["share_token_hash"],
        unique=True,
        postgresql_where=sa.text("share_token_hash IS NOT NULL"),
    )
    index(
        "ix_documents_purge",
        "documents",
        ["purge_after"],
        postgresql_where=sa.text("purge_after IS NOT NULL"),
    )

    tabelle(
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

    tabelle(
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
    index(
        "ix_doc_comments_document", "doc_comments", ["document_id", "status"]
    )

    tabelle(
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
    index(
        "uq_doc_revisions_doc_rev", "doc_revisions", ["document_id", "rev"], unique=True
    )
    index(
        "ix_doc_revisions_created",
        "doc_revisions",
        ["document_id", sa.text("created_at DESC")],
    )

    tabelle(
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
    index("ix_doc_assets_document", "doc_assets", ["document_id"])

    if "document_id" not in _spalten(bind, "ai_conversations"):
        op.add_column(
            "ai_conversations",
            sa.Column(
                "document_id",
                sa.BigInteger(),
                sa.ForeignKey("documents.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
    index(
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
    index(
        "uq_ai_conversations_user_document",
        "ai_conversations",
        ["user_id", "document_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'docs' AND document_id IS NOT NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    _indizes.cache = {}
    op.execute("DELETE FROM ai_conversations WHERE kind = 'docs'")
    if "uq_ai_conversations_user_document" in _indizes(bind, "ai_conversations"):
        op.drop_index("uq_ai_conversations_user_document", table_name="ai_conversations")
    op.execute(
        "ALTER TABLE ai_conversations DROP CONSTRAINT IF EXISTS ck_ai_conversations_kind"
    )
    op.create_check_constraint(
        "ck_ai_conversations_kind",
        "ai_conversations",
        "kind IN ('primary', 'guardian', 'worker')",
    )
    if "document_id" in _spalten(bind, "ai_conversations"):
        if "ix_ai_conversations_document_id" in _indizes(bind, "ai_conversations"):
            op.drop_index("ix_ai_conversations_document_id", table_name="ai_conversations")
        op.drop_column("ai_conversations", "document_id")

    for tabelle_name in (
        "doc_assets",
        "doc_revisions",
        "doc_comments",
        "doc_members",
        "documents",
        "doc_folders",
    ):
        op.execute(f'DROP TABLE IF EXISTS "{tabelle_name}" CASCADE')
