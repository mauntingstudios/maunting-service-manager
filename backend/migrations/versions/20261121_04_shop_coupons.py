"""Shop-Gutscheine, Aktionsbanner-Metadaten und Bestell-Rabattfelder.

Revision ID: 20261121_04
Revises: 20261121_03
Create Date: 2026-11-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261121_04"
down_revision: Union[str, None] = "20261121_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _check_names(inspector, table: str) -> set[str]:
    return {ck["name"] for ck in inspector.get_check_constraints(table) if ck.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "shop_coupons" not in tables:
        op.create_table(
            "shop_coupons",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(length=48), nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("promo_text", sa.String(length=240), nullable=True),
            sa.Column("discount_type", sa.String(length=16), nullable=False),
            sa.Column("discount_value", sa.Integer(), nullable=False),
            sa.Column(
                "currency", sa.String(length=3), nullable=False, server_default="EUR"
            ),
            sa.Column(
                "scope", sa.String(length=16), nullable=False, server_default="all"
            ),
            sa.Column("target_plan_ids_json", sa.Text(), nullable=True),
            sa.Column(
                "min_gross_cents",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("max_redemptions", sa.Integer(), nullable=True),
            sa.Column(
                "redemption_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
            sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "show_badge",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "show_banner",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "banner_cooldown_hours",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("6"),
            ),
            sa.Column("stripe_coupon_id", sa.String(length=128), nullable=True),
            sa.Column(
                "stripe_promotion_code_id", sa.String(length=128), nullable=True
            ),
            sa.Column(
                "active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("code", name="uq_shop_coupons_code"),
            sa.CheckConstraint(
                "discount_type IN ('percent', 'fixed_cents')",
                name="ck_shop_coupons_type",
            ),
            sa.CheckConstraint("discount_value > 0", name="ck_shop_coupons_value"),
            sa.CheckConstraint(
                "scope IN ('all', 'plans', 'addons')",
                name="ck_shop_coupons_scope",
            ),
            sa.CheckConstraint(
                "min_gross_cents >= 0", name="ck_shop_coupons_min_gross"
            ),
            sa.CheckConstraint(
                "max_redemptions IS NULL OR max_redemptions > 0",
                name="ck_shop_coupons_max_redemptions",
            ),
            sa.CheckConstraint(
                "redemption_count >= 0", name="ck_shop_coupons_redemption_count"
            ),
            sa.CheckConstraint(
                "banner_cooldown_hours >= 0", name="ck_shop_coupons_cooldown"
            ),
        )
        op.create_index("ix_shop_coupons_id", "shop_coupons", ["id"])
        op.create_index("ix_shop_coupons_code", "shop_coupons", ["code"])
        op.create_index("ix_shop_coupons_active", "shop_coupons", ["active"])

    if "shop_orders" in tables:
        order_cols = _column_names(inspector, "shop_orders")
        if "coupon_code" not in order_cols:
            op.add_column(
                "shop_orders",
                sa.Column("coupon_code", sa.String(length=48), nullable=True),
            )
        if "coupon_discount_cents" not in order_cols:
            op.add_column(
                "shop_orders",
                sa.Column(
                    "coupon_discount_cents",
                    sa.Integer(),
                    nullable=False,
                    server_default=sa.text("0"),
                ),
            )
        if "ck_shop_orders_coupon_discount" not in _check_names(
            inspector, "shop_orders"
        ):
            op.create_check_constraint(
                "ck_shop_orders_coupon_discount",
                "shop_orders",
                "coupon_discount_cents >= 0",
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "shop_orders" in tables:
        order_cols = _column_names(inspector, "shop_orders")
        if "ck_shop_orders_coupon_discount" in _check_names(inspector, "shop_orders"):
            op.drop_constraint(
                "ck_shop_orders_coupon_discount", "shop_orders", type_="check"
            )
        if "coupon_discount_cents" in order_cols:
            op.drop_column("shop_orders", "coupon_discount_cents")
        if "coupon_code" in order_cols:
            op.drop_column("shop_orders", "coupon_code")

    if "shop_coupons" in tables:
        existing_idx = {idx["name"] for idx in inspector.get_indexes("shop_coupons")}
        for idx_name in (
            "ix_shop_coupons_active",
            "ix_shop_coupons_code",
            "ix_shop_coupons_id",
        ):
            if idx_name in existing_idx:
                op.drop_index(idx_name, table_name="shop_coupons")
        op.drop_table("shop_coupons")
