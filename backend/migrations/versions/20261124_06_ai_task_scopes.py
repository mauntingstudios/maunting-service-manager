"""Add 3-tier scope fields (personal, team, global) to ai_tasks.

Revision ID: 20261124_06
Revises: 20261124_05
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_06"
down_revision: Union[str, None] = "20261124_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _index_names(inspector, table: str) -> set[str]:
    return {idx["name"] for idx in inspector.get_indexes(table)}


def _check_constraint_names(inspector, table: str) -> set[str]:
    return {cc["name"] for cc in inspector.get_check_constraints(table) if cc.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_tasks" not in _table_names(inspector):
        return

    cols = _column_names(inspector, "ai_tasks")
    if "scope" not in cols:
        op.add_column(
            "ai_tasks",
            sa.Column("scope", sa.String(16), nullable=False, server_default="personal"),
        )
    if "team_id" not in cols:
        op.add_column(
            "ai_tasks",
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
    if "updated_by_user_id" not in cols:
        op.add_column(
            "ai_tasks",
            sa.Column(
                "updated_by_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )

    inspector = sa.inspect(bind)
    if "ix_ai_tasks_scope_team" not in _index_names(inspector, "ai_tasks"):
        op.create_index("ix_ai_tasks_scope_team", "ai_tasks", ["scope", "team_id"], unique=False)

    if "ck_ai_tasks_scope" not in _check_constraint_names(inspector, "ai_tasks"):
        op.create_check_constraint(
            "ck_ai_tasks_scope",
            "ai_tasks",
            "scope IN ('personal', 'team', 'global')",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ai_tasks" not in _table_names(inspector):
        return

    if "ck_ai_tasks_scope" in _check_constraint_names(inspector, "ai_tasks"):
        op.drop_constraint("ck_ai_tasks_scope", "ai_tasks", type_="check")
    if "ix_ai_tasks_scope_team" in _index_names(inspector, "ai_tasks"):
        op.drop_index("ix_ai_tasks_scope_team", table_name="ai_tasks")

    cols = _column_names(inspector, "ai_tasks")
    for col_name in ("updated_by_user_id", "team_id", "scope"):
        if col_name in cols:
            op.drop_column("ai_tasks", col_name)
