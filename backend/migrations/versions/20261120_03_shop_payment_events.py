"""Tabelle fuer verarbeitete Zahlungs-Webhooks (Idempotenz).

Revision ID: 20261120_03
Revises: 20261120_02
Create Date: 2026-11-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261120_03"
down_revision: Union[str, None] = "20261120_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "shop_payment_events" in tables:
        return

    op.create_table(
        "shop_payment_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="processed"
        ),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["shop_orders.id"],
            name="fk_shop_payment_events_order",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("event_id", name="uq_shop_payment_events_event"),
    )
    op.create_index("ix_shop_payment_events_id", "shop_payment_events", ["id"])
    op.create_index(
        "ix_shop_payment_events_event_id", "shop_payment_events", ["event_id"]
    )
    op.create_index(
        "ix_shop_payment_events_type_received",
        "shop_payment_events",
        ["event_type", "received_at"],
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "shop_payment_events" in set(inspector.get_table_names()):
        op.drop_table("shop_payment_events")
