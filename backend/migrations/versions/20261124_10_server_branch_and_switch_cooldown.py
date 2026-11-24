"""Add last_blueprint_switch_at, steam_branch, and steam_branch_password_encrypted to servers.

Revision ID: 20261124_10
Revises: 20261124_09
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_10"
down_revision: Union[str, None] = "20261124_09"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "servers" not in _table_names(inspector):
        return
    cols = _column_names(inspector, "servers")
    if "last_blueprint_switch_at" not in cols:
        op.add_column(
            "servers",
            sa.Column("last_blueprint_switch_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "steam_branch" not in cols:
        op.add_column(
            "servers",
            sa.Column("steam_branch", sa.String(64), nullable=True),
        )
    if "steam_branch_password_encrypted" not in cols:
        op.add_column(
            "servers",
            sa.Column("steam_branch_password_encrypted", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "servers" not in _table_names(inspector):
        return
    cols = _column_names(inspector, "servers")
    if "steam_branch_password_encrypted" in cols:
        op.drop_column("servers", "steam_branch_password_encrypted")
    if "steam_branch" in cols:
        op.drop_column("servers", "steam_branch")
    if "last_blueprint_switch_at" in cols:
        op.drop_column("servers", "last_blueprint_switch_at")
