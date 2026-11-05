"""AiAutonomyGrant project_id Scope Erweiterung.

Revision ID: 20261105_02
Revises: 20261105_01
Create Date: 2026-11-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261105_02"
down_revision: Union[str, None] = "20261105_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [c["name"] for c in inspector.get_columns("ai_autonomy_grants")]

    if "project_id" not in columns:
        with op.batch_alter_table("ai_autonomy_grants") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "project_id",
                    sa.String(length=36),
                    sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
                    nullable=True,
                )
            )
            batch_op.create_index("ix_ai_autonomy_grants_project_id", ["project_id"])


def downgrade() -> None:
    with op.batch_alter_table("ai_autonomy_grants") as batch_op:
        batch_op.drop_index("ix_ai_autonomy_grants_project_id")
        batch_op.drop_column("project_id")
