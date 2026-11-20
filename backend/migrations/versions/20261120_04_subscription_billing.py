"""Stripe-Aboprobe an lokalen Abos (Renewal-Zuordnung).

Revision ID: 20261120_04
Revises: 20261120_03
Create Date: 2026-11-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261120_04"
down_revision: Union[str, None] = "20261120_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    spalten = {spalte["name"] for spalte in inspector.get_columns("shop_subscriptions")}
    if "provider_reference" not in spalten:
        op.add_column(
            "shop_subscriptions",
            sa.Column("provider_reference", sa.String(length=128), nullable=True),
        )
        op.create_index(
            "ix_shop_subscriptions_provider_reference",
            "shop_subscriptions",
            ["provider_reference"],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    spalten = {spalte["name"] for spalte in inspector.get_columns("shop_subscriptions")}
    if "provider_reference" in spalten:
        op.drop_index(
            "ix_shop_subscriptions_provider_reference",
            table_name="shop_subscriptions",
        )
        op.drop_column("shop_subscriptions", "provider_reference")
