"""Getrennte, verschluesselte Gruppeninfo und Gruppenhintergrund.

Revision ID: 20261027_01
Revises: 20261025_01
Create Date: 2026-10-27

Die Allgemeinangaben einer Gruppe lagen bisher im Rollenblock. Fuer die neuen
Berechtigungen ``edit_group`` und ``set_group_background`` bekommen sie eigene
Zeilen: klein, verschluesselt, mit eigener Revision. Der Server liest keinen
Inhalt.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261027_01"
down_revision: Union[str, None] = "20261025_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    tables = _tables(op.get_bind())

    if "chat_group_infos" not in tables:
        op.create_table(
            "chat_group_infos",
            sa.Column("group_id", sa.Integer(), nullable=False),
            sa.Column("blob", sa.Text(), nullable=False),
            sa.Column("revision", sa.BigInteger(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["group_id"], ["chat_groups.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("group_id"),
        )

    if "chat_group_backgrounds" not in tables:
        op.create_table(
            "chat_group_backgrounds",
            sa.Column("group_id", sa.Integer(), nullable=False),
            sa.Column("blob", sa.Text(), nullable=False),
            sa.Column("revision", sa.BigInteger(), nullable=False),
            sa.Column("mime", sa.String(length=100), nullable=True),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["group_id"], ["chat_groups.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("group_id"),
        )


def downgrade() -> None:
    tables = _tables(op.get_bind())
    if "chat_group_backgrounds" in tables:
        op.drop_table("chat_group_backgrounds")
    if "chat_group_infos" in tables:
        op.drop_table("chat_group_infos")
