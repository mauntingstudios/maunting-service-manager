"""Add ShopPlan curation flags (is_featured, is_bestseller, is_new).

Revision ID: 20261124_04
Revises: 20261124_03
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_04"
down_revision: Union[str, None] = "20261124_03"
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
    for col_name in ("is_featured", "is_bestseller", "is_new"):
        if col_name not in cols:
            op.add_column(
                "shop_plans",
                sa.Column(
                    col_name,
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "shop_plans" not in _table_names(inspector):
        return

    cols = _column_names(inspector, "shop_plans")
    for col_name in ("is_new", "is_bestseller", "is_featured"):
        if col_name in cols:
            op.drop_column("shop_plans", col_name)
