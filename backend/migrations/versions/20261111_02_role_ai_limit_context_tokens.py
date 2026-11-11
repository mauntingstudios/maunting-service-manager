"""Anfragedeckel je Rolle (max_context_tokens).

Revision ID: 20261111_02
Revises: 20261111_01
Create Date: 2026-11-11
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261111_02"
down_revision: Union[str, None] = "20261111_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "role_ai_limits" not in inspector.get_table_names():
        return
    columns = {
        column["name"] for column in inspector.get_columns("role_ai_limits")
    }
    if "max_context_tokens" in columns:
        return
    # Bestandswerte bleiben NULL: das heisst „nichts hinterlegt“, und dann gilt
    # weiter der Standarddeckel von 44.000 Token. Ein Backfill wuerde jede
    # bestehende Rolle auf einen Wert festschreiben, den niemand gewaehlt hat.
    with op.batch_alter_table("role_ai_limits") as batch:
        batch.add_column(sa.Column("max_context_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "role_ai_limits" not in inspector.get_table_names():
        return
    columns = {
        column["name"] for column in inspector.get_columns("role_ai_limits")
    }
    if "max_context_tokens" not in columns:
        return
    with op.batch_alter_table("role_ai_limits") as batch:
        batch.drop_column("max_context_tokens")
