"""Expand shop_orders.payment_reference for Stripe session IDs.

Revision ID: 20261125_04
Revises: 20261125_03
Create Date: 2026-11-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261125_04"
down_revision: Union[str, None] = "20261125_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "shop_orders" not in set(inspector.get_table_names()):
        return
    op.alter_column(
        "shop_orders",
        "payment_reference",
        existing_type=sa.String(length=64),
        type_=sa.String(length=255),
        existing_nullable=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "shop_orders" not in set(inspector.get_table_names()):
        return
    op.alter_column(
        "shop_orders",
        "payment_reference",
        existing_type=sa.String(length=255),
        type_=sa.String(length=64),
        existing_nullable=True,
    )
