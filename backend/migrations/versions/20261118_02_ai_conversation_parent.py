"""Herkunfts-Unterhaltung (parent_conversation_id) an ai_conversations.

Revision ID: 20261118_02
Revises: 20261118_01
Create Date: 2026-11-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261118_02"
down_revision: Union[str, None] = "20261118_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_conversations" not in set(inspector.get_table_names()):
        return

    spalten = {col["name"] for col in inspector.get_columns("ai_conversations")}
    if "parent_conversation_id" not in spalten:
        op.add_column(
            "ai_conversations",
            sa.Column("parent_conversation_id", sa.String(length=36), nullable=True),
        )
        op.create_index(
            "ix_ai_conversations_parent_conversation_id",
            "ai_conversations",
            ["parent_conversation_id"],
        )
        if bind.dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_ai_conversations_parent_conversation_id",
                "ai_conversations",
                "ai_conversations",
                ["parent_conversation_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_conversations" not in set(inspector.get_table_names()):
        return

    spalten = {col["name"] for col in inspector.get_columns("ai_conversations")}
    if "parent_conversation_id" in spalten:
        if bind.dialect.name != "sqlite":
            op.drop_constraint(
                "fk_ai_conversations_parent_conversation_id",
                "ai_conversations",
                type_="foreignkey",
            )
        op.drop_index(
            "ix_ai_conversations_parent_conversation_id",
            table_name="ai_conversations",
        )
        op.drop_column("ai_conversations", "parent_conversation_id")
