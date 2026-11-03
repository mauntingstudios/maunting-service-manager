"""Dokumente: KI-Aenderungen als bestaetigungspflichtige Vorschau.

Revision ID: 20261030_01
Revises: 20261029_01
Create Date: 2026-10-30
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261030_01"
down_revision: Union[str, None] = "20261029_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tabellen = set(sa.inspect(op.get_bind()).get_table_names())
    if "doc_pending_edits" not in tabellen:
        op.create_table(
            "doc_pending_edits",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("pending_uid", sa.String(length=36), nullable=False, unique=True),
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
            sa.Column(
                "conversation_id",
                sa.String(length=36),
                sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("run_id", sa.String(length=36), nullable=True),
            sa.Column("call_id", sa.String(length=64), nullable=True),
            sa.Column("operation", sa.String(length=16), nullable=False),
            sa.Column("payload_encrypted", sa.Text(), nullable=False),
            sa.Column("base_rev", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "status", sa.String(length=16), nullable=False, server_default="pending"
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("applying_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("applied_rev", sa.Integer(), nullable=True),
            sa.CheckConstraint(
                "status IN ('pending', 'applying', 'applied', 'rejected', 'stale')",
                name="ck_doc_pending_edits_status",
            ),
            sa.CheckConstraint(
                "operation IN ('append', 'replace_block')",
                name="ck_doc_pending_edits_operation",
            ),
        )

    indizes = {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes("doc_pending_edits")
    }
    if "ix_doc_pending_document_user" not in indizes:
        op.create_index(
            "ix_doc_pending_document_user",
            "doc_pending_edits",
            ["document_id", "user_id"],
        )
    if "uq_doc_pending_offen" not in indizes:
        op.create_index(
            "uq_doc_pending_offen",
            "doc_pending_edits",
            ["document_id", "user_id"],
            unique=True,
            postgresql_where=sa.text("status IN ('pending', 'applying')"),
        )
    if "ix_doc_pending_expires" not in indizes:
        op.create_index(
            "ix_doc_pending_expires", "doc_pending_edits", ["expires_at"]
        )


def downgrade() -> None:
    if "doc_pending_edits" not in sa.inspect(op.get_bind()).get_table_names():
        return
    indizes = {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes("doc_pending_edits")
    }
    for name in (
        "ix_doc_pending_expires",
        "uq_doc_pending_offen",
        "ix_doc_pending_document_user",
    ):
        if name in indizes:
            op.drop_index(name, table_name="doc_pending_edits")
    op.drop_table("doc_pending_edits")
