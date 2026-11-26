"""Add is_deactivated and deactivated_at columns to servers.

Revision ID: 20261126_01
Revises: 20261125_04
Create Date: 2026-11-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126_01"
down_revision: Union[str, None] = "20261125_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "servers" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("servers")}
    if "is_deactivated" not in cols:
        op.add_column(
            "servers",
            sa.Column(
                "is_deactivated",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if "deactivated_at" not in cols:
        op.add_column(
            "servers",
            sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "servers" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("servers")}
    if "deactivated_at" in cols:
        op.drop_column("servers", "deactivated_at")
    if "is_deactivated" in cols:
        op.drop_column("servers", "is_deactivated")
