"""Add short-duration support to shop_plans, shop_orders, shop_order_items, shop_entitlements.

Revision ID: 20261124_09
Revises: 20261124_08
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_09"
down_revision: Union[str, None] = "20261124_08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _check_names(inspector, table: str) -> set[str]:
    return {ck["name"] for ck in inspector.get_check_constraints(table) if ck.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "shop_plans" in tables:
        cols = _column_names(inspector, "shop_plans")
        if "allow_short_durations" not in cols:
            op.add_column(
                "shop_plans",
                sa.Column(
                    "allow_short_durations",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )

    for table_name, ck_name in (
        ("shop_orders", "ck_shop_orders_duration_days"),
        ("shop_order_items", "ck_shop_order_items_duration_days"),
        ("shop_entitlements", "ck_shop_entitlements_duration_days"),
    ):
        if table_name not in tables:
            continue
        cols = _column_names(inspector, table_name)
        if "duration_days" not in cols:
            op.add_column(
                table_name,
                sa.Column("duration_days", sa.Integer(), nullable=True),
            )
        checks = _check_names(inspector, table_name)
        if ck_name not in checks:
            op.create_check_constraint(
                ck_name,
                table_name,
                "duration_days IS NULL OR duration_days > 0",
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    for table_name, ck_name in (
        ("shop_entitlements", "ck_shop_entitlements_duration_days"),
        ("shop_order_items", "ck_shop_order_items_duration_days"),
        ("shop_orders", "ck_shop_orders_duration_days"),
    ):
        if table_name not in tables:
            continue
        checks = _check_names(inspector, table_name)
        if ck_name in checks:
            op.drop_constraint(ck_name, table_name, type_="check")
        cols = _column_names(inspector, table_name)
        if "duration_days" in cols:
            op.drop_column(table_name, "duration_days")

    if "shop_plans" in tables:
        cols = _column_names(inspector, "shop_plans")
        if "allow_short_durations" in cols:
            op.drop_column("shop_plans", "allow_short_durations")
