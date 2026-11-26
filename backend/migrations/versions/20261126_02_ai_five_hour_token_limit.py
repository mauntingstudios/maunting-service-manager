"""Add five_hour_token_limit column to role_ai_limits.

Revision ID: 20261126_02
Revises: 20261126_01
Create Date: 2026-11-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126_02"
down_revision: Union[str, None] = "20261126_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "role_ai_limits" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("role_ai_limits")}
    if "five_hour_token_limit" not in cols:
        op.add_column(
            "role_ai_limits",
            sa.Column("five_hour_token_limit", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "role_ai_limits" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("role_ai_limits")}
    if "five_hour_token_limit" in cols:
        op.drop_column("role_ai_limits", "five_hour_token_limit")
