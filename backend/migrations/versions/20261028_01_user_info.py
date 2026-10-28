"""Der freiwillige Info-Text eines Kontos.

Eine Zeile je Konto, verschluesselt (`DisText`), mit Sichtbarkeit und Ablauf.
Der Server braucht den Text nicht zu lesen, um Sichtbarkeit und Frist
durchzusetzen — die stehen als Klartext-Metadaten daneben.

Revision ID: 20261028_01
Revises: 20261027_02
Create Date: 2026-10-28
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261028_01"
down_revision: Union[str, None] = "20261027_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    if "user_infos" in _tables(op.get_bind()):
        return
    op.create_table(
        "user_infos",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(length=16), nullable=False, server_default="friends"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    if "user_infos" in _tables(op.get_bind()):
        op.drop_table("user_infos")
