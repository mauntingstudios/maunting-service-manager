"""Add pinned_in_hero and promo_highlight_text to shop_plans.

Revision ID: 20261124_08
Revises: 20261124_07
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_08"
down_revision: Union[str, None] = "20261124_07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "shop_plans" not in _table_names(inspector):
        return
    cols = _column_names(inspector, "shop_plans")
    if "pinned_in_hero" not in cols:
        op.add_column(
            "shop_plans",
            sa.Column("pinned_in_hero", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if "promo_highlight_text" not in cols:
        op.add_column(
            "shop_plans",
            sa.Column("promo_highlight_text", sa.String(80), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "shop_plans" not in _table_names(inspector):
        return
    cols = _column_names(inspector, "shop_plans")
    if "promo_highlight_text" in cols:
        op.drop_column("shop_plans", "promo_highlight_text")
    if "pinned_in_hero" in cols:
        op.drop_column("shop_plans", "pinned_in_hero")
