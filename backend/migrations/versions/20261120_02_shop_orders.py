"""Bestellungen, Positionen, Abos und Freischaltungen des nativen Shops.

Revision ID: 20261120_02
Revises: 20261120_01
Create Date: 2026-11-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261120_02"
down_revision: Union[str, None] = "20261120_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "shop_orders" not in tables:
        op.create_table(
            "shop_orders",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("number", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column(
                "status",
                sa.String(length=24),
                nullable=False,
                server_default="pending_payment",
            ),
            sa.Column(
                "currency", sa.String(length=3), nullable=False, server_default="EUR"
            ),
            sa.Column(
                "billing_interval",
                sa.String(length=16),
                nullable=False,
                server_default="month",
            ),
            sa.Column("months", sa.Integer(), nullable=False),
            sa.Column(
                "discount_percent",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column(
                "net_cents", sa.Integer(), nullable=False, server_default=sa.text("0")
            ),
            sa.Column(
                "tax_cents", sa.Integer(), nullable=False, server_default=sa.text("0")
            ),
            sa.Column(
                "gross_cents", sa.Integer(), nullable=False, server_default=sa.text("0")
            ),
            sa.Column(
                "payment_provider",
                sa.String(length=24),
                nullable=False,
                server_default="demo",
            ),
            sa.Column("payment_reference", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"], ["users.id"], name="fk_shop_orders_user", ondelete="CASCADE"
            ),
            sa.UniqueConstraint("number", name="uq_shop_orders_number"),
            sa.CheckConstraint(
                "status IN ('pending_payment', 'paid', 'cancelled', 'refunded', 'failed')",
                name="ck_shop_orders_status",
            ),
            sa.CheckConstraint("months > 0", name="ck_shop_orders_months"),
            sa.CheckConstraint(
                "discount_percent >= 0 AND discount_percent <= 100",
                name="ck_shop_orders_discount",
            ),
            sa.CheckConstraint(
                "net_cents >= 0 AND tax_cents >= 0 AND gross_cents >= 0",
                name="ck_shop_orders_cents",
            ),
        )
        op.create_index("ix_shop_orders_id", "shop_orders", ["id"])
        op.create_index("ix_shop_orders_number", "shop_orders", ["number"])
        op.create_index("ix_shop_orders_user_id", "shop_orders", ["user_id"])
        op.create_index("ix_shop_orders_status", "shop_orders", ["status"])
        op.create_index(
            "ix_shop_orders_user_created", "shop_orders", ["user_id", "created_at"]
        )

    if "shop_order_items" not in tables:
        op.create_table(
            "shop_order_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(length=16), nullable=False),
            sa.Column("plan_id", sa.Integer(), nullable=True),
            sa.Column("game_type", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column(
                "quantity", sa.Integer(), nullable=False, server_default=sa.text("1")
            ),
            sa.Column("unit_price_cents", sa.Integer(), nullable=False),
            sa.Column("tax_rate_percent", sa.Integer(), nullable=False),
            sa.Column("net_cents", sa.Integer(), nullable=False),
            sa.Column("tax_cents", sa.Integer(), nullable=False),
            sa.Column("gross_cents", sa.Integer(), nullable=False),
            sa.Column("ram_mb", sa.Integer(), nullable=True),
            sa.Column("cpu", sa.Integer(), nullable=True),
            sa.Column("slots", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(
                ["order_id"],
                ["shop_orders.id"],
                name="fk_shop_order_items_order",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["plan_id"],
                ["shop_plans.id"],
                name="fk_shop_order_items_plan",
                ondelete="SET NULL",
            ),
            sa.CheckConstraint(
                "kind IN ('plan', 'addon')", name="ck_shop_order_items_kind"
            ),
            sa.CheckConstraint("quantity > 0", name="ck_shop_order_items_quantity"),
        )
        op.create_index("ix_shop_order_items_id", "shop_order_items", ["id"])
        op.create_index(
            "ix_shop_order_items_order_id", "shop_order_items", ["order_id"]
        )

    if "shop_subscriptions" not in tables:
        op.create_table(
            "shop_subscriptions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("order_item_id", sa.Integer(), nullable=False),
            sa.Column("plan_id", sa.Integer(), nullable=True),
            sa.Column("game_type", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column(
                "status",
                sa.String(length=24),
                nullable=False,
                server_default="active",
            ),
            sa.Column(
                "billing_interval",
                sa.String(length=16),
                nullable=False,
                server_default="month",
            ),
            sa.Column("monthly_gross_cents", sa.Integer(), nullable=False),
            sa.Column("tax_rate_percent", sa.Integer(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "cancel_at_period_end",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
                name="fk_shop_subscriptions_user",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["order_id"],
                ["shop_orders.id"],
                name="fk_shop_subscriptions_order",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["order_item_id"],
                ["shop_order_items.id"],
                name="fk_shop_subscriptions_item",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["plan_id"],
                ["shop_plans.id"],
                name="fk_shop_subscriptions_plan",
                ondelete="SET NULL",
            ),
            sa.CheckConstraint(
                "status IN ('active', 'past_due', 'cancelled')",
                name="ck_shop_subscriptions_status",
            ),
            sa.CheckConstraint(
                "billing_interval IN ('month')",
                name="ck_shop_subscriptions_interval",
            ),
        )
        op.create_index("ix_shop_subscriptions_id", "shop_subscriptions", ["id"])
        op.create_index(
            "ix_shop_subscriptions_user_id", "shop_subscriptions", ["user_id"]
        )
        op.create_index(
            "ix_shop_subscriptions_order_id", "shop_subscriptions", ["order_id"]
        )
        op.create_index(
            "ix_shop_subscriptions_status", "shop_subscriptions", ["status"]
        )

    if "shop_entitlements" not in tables:
        op.create_table(
            "shop_entitlements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("order_item_id", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(length=16), nullable=False),
            sa.Column("label", sa.String(length=255), nullable=False),
            sa.Column("plan_id", sa.Integer(), nullable=True),
            sa.Column("role_id", sa.Integer(), nullable=True),
            sa.Column(
                "status",
                sa.String(length=16),
                nullable=False,
                server_default="active",
            ),
            sa.Column("ram_mb", sa.Integer(), nullable=True),
            sa.Column("cpu", sa.Integer(), nullable=True),
            sa.Column("slots", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
                name="fk_shop_entitlements_user",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["order_id"],
                ["shop_orders.id"],
                name="fk_shop_entitlements_order",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["order_item_id"],
                ["shop_order_items.id"],
                name="fk_shop_entitlements_item",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["plan_id"],
                ["shop_plans.id"],
                name="fk_shop_entitlements_plan",
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["role_id"],
                ["roles.id"],
                name="fk_shop_entitlements_role",
                ondelete="SET NULL",
            ),
            sa.CheckConstraint(
                "kind IN ('server', 'role', 'addon')",
                name="ck_shop_entitlements_kind",
            ),
            sa.CheckConstraint(
                "status IN ('active', 'suspended', 'revoked')",
                name="ck_shop_entitlements_status",
            ),
        )
        op.create_index("ix_shop_entitlements_id", "shop_entitlements", ["id"])
        op.create_index(
            "ix_shop_entitlements_user_id", "shop_entitlements", ["user_id"]
        )
        op.create_index(
            "ix_shop_entitlements_order_id", "shop_entitlements", ["order_id"]
        )
        op.create_index("ix_shop_entitlements_status", "shop_entitlements", ["status"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name in (
        "shop_entitlements",
        "shop_subscriptions",
        "shop_order_items",
        "shop_orders",
    ):
        if name in tables:
            op.drop_table(name)
