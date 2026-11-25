"""Add cpu_overcommit_factor to nodes.

Revision ID: 20261125_02
Revises: 20261125_01
Create Date: 2026-11-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261125_02"
down_revision: Union[str, None] = "20261125_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "nodes" not in set(inspector.get_table_names()):
        return
    cols = _column_names(inspector, "nodes")
    if "cpu_overcommit_factor" not in cols:
        op.add_column(
            "nodes",
            sa.Column("cpu_overcommit_factor", sa.Float(), nullable=False, server_default="1.0"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "nodes" not in set(inspector.get_table_names()):
        return
    cols = _column_names(inspector, "nodes")
    if "cpu_overcommit_factor" in cols:
        op.drop_column("nodes", "cpu_overcommit_factor")
