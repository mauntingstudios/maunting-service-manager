"""Add always_active boolean column to ai_skills for persistent rule/style skills.

Revision ID: 20261126_04
Revises: 20261126_03
Create Date: 2026-11-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126_04"
down_revision: Union[str, None] = "20261126_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_skills" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("ai_skills")}
    if "always_active" not in cols:
        op.add_column(
            "ai_skills",
            sa.Column(
                "always_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_skills" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("ai_skills")}
    if "always_active" in cols:
        op.drop_column("ai_skills", "always_active")
