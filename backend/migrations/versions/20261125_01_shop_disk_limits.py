"""Add configurable disk limits to shop_plans, shop_order_items, and shop_entitlements.

Revision ID: 20261125_01
Revises: 20261124_10
Create Date: 2026-11-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261125_01"
down_revision: Union[str, None] = "20261124_10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "shop_plans" in tables:
        cols = _column_names(inspector, "shop_plans")
        if "disk_included_gb" not in cols:
            op.add_column("shop_plans", sa.Column("disk_included_gb", sa.Integer(), nullable=True))
        if "disk_max_gb" not in cols:
            op.add_column("shop_plans", sa.Column("disk_max_gb", sa.Integer(), nullable=True))
        if "disk_step_gb" not in cols:
            op.add_column(
                "shop_plans",
                sa.Column("disk_step_gb", sa.Integer(), nullable=False, server_default="10"),
            )
        if "price_per_disk_step_cents" not in cols:
            op.add_column(
                "shop_plans",
                sa.Column("price_per_disk_step_cents", sa.Integer(), nullable=False, server_default="0"),
            )

    if "shop_order_items" in tables:
        cols = _column_names(inspector, "shop_order_items")
        if "disk_gb" not in cols:
            op.add_column("shop_order_items", sa.Column("disk_gb", sa.Integer(), nullable=True))

    if "shop_entitlements" in tables:
        cols = _column_names(inspector, "shop_entitlements")
        if "disk_gb" not in cols:
            op.add_column("shop_entitlements", sa.Column("disk_gb", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "shop_entitlements" in tables and "disk_gb" in _column_names(inspector, "shop_entitlements"):
        op.drop_column("shop_entitlements", "disk_gb")

    if "shop_order_items" in tables and "disk_gb" in _column_names(inspector, "shop_order_items"):
        op.drop_column("shop_order_items", "disk_gb")

    if "shop_plans" in tables:
        cols = _column_names(inspector, "shop_plans")
        for col in ("price_per_disk_step_cents", "disk_step_gb", "disk_max_gb", "disk_included_gb"):
            if col in cols:
                op.drop_column("shop_plans", col)
