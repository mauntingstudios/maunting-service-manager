"""Add ui_preferences_json to users.

Revision ID: 20261125_03
Revises: 20261125_02
Create Date: 2026-11-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261125_03"
down_revision: Union[str, None] = "20261125_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in set(inspector.get_table_names()):
        return
    cols = _column_names(inspector, "users")
    if "ui_preferences_json" not in cols:
        op.add_column("users", sa.Column("ui_preferences_json", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in set(inspector.get_table_names()):
        return
    cols = _column_names(inspector, "users")
    if "ui_preferences_json" in cols:
        op.drop_column("users", "ui_preferences_json")
