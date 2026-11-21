"""Eigenstaendige Shop-Add-ons ohne Serverbindung und Verknuepfungen.

Revision ID: 20261121_02
Revises: 20261121_01
Create Date: 2026-11-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261121_02"
down_revision: Union[str, None] = "20261121_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _fk_names(inspector, table: str) -> set[str]:
    return {fk["name"] for fk in inspector.get_foreign_keys(table) if fk.get("name")}


def _add_addon_fk(inspector, table: str, fk_name: str) -> None:
    if "addon_id" not in _column_names(inspector, table):
        op.add_column(table, sa.Column("addon_id", sa.Integer(), nullable=True))
    if fk_name not in _fk_names(inspector, table):
        op.create_foreign_key(
            fk_name,
            table,
            "shop_addons",
            ["addon_id"],
            ["id"],
            ondelete="SET NULL",
        )


def _drop_addon_fk(inspector, table: str, fk_name: str) -> None:
    if fk_name in _fk_names(inspector, table):
        op.drop_constraint(fk_name, table, type_="foreignkey")
    if "addon_id" in _column_names(inspector, table):
        op.drop_column(table, "addon_id")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "shop_addons" not in tables:
        op.create_table(
            "shop_addons",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("category", sa.String(length=32), nullable=False),
            sa.Column("price_cents", sa.Integer(), nullable=False),
            sa.Column(
                "currency", sa.String(length=3), nullable=False, server_default="EUR"
            ),
            sa.Column(
                "billing_interval",
                sa.String(length=16),
                nullable=False,
                server_default="month",
            ),
            sa.Column(
                "tax_rate_percent",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("19"),
            ),
            sa.Column("extra_slots", sa.Integer(), nullable=True),
            sa.Column("extra_storage_mb", sa.Integer(), nullable=True),
            sa.Column("extra_backups", sa.Integer(), nullable=True),
            sa.Column("extra_ai_tokens", sa.Integer(), nullable=True),
            sa.Column("role_id", sa.Integer(), nullable=True),
            sa.Column(
                "active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column(
                "sort_order",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["role_id"],
                ["roles.id"],
                name="fk_shop_addons_role",
                ondelete="SET NULL",
            ),
            sa.UniqueConstraint("slug", name="uq_shop_addons_slug"),
            sa.CheckConstraint(
                "category IN ('ai_quota', 'slots', 'backups', 'storage', 'role')",
                name="ck_shop_addons_category",
            ),
            sa.CheckConstraint("price_cents >= 0", name="ck_shop_addons_price"),
            sa.CheckConstraint(
                "billing_interval IN ('month')", name="ck_shop_addons_interval"
            ),
            sa.CheckConstraint(
                "tax_rate_percent >= 0 AND tax_rate_percent <= 100",
                name="ck_shop_addons_tax",
            ),
            sa.CheckConstraint(
                "extra_slots IS NULL OR extra_slots >= 0",
                name="ck_shop_addons_extra_slots",
            ),
            sa.CheckConstraint(
                "extra_storage_mb IS NULL OR extra_storage_mb >= 0",
                name="ck_shop_addons_extra_storage",
            ),
            sa.CheckConstraint(
                "extra_backups IS NULL OR extra_backups >= 0",
                name="ck_shop_addons_extra_backups",
            ),
            sa.CheckConstraint(
                "extra_ai_tokens IS NULL OR extra_ai_tokens >= 0",
                name="ck_shop_addons_extra_ai",
            ),
        )
        op.create_index("ix_shop_addons_id", "shop_addons", ["id"])
        op.create_index("ix_shop_addons_slug", "shop_addons", ["slug"])
        op.create_index(
            "ix_shop_addons_cat_active", "shop_addons", ["category", "active"]
        )

    for table, fk_name in (
        ("shop_order_items", "fk_shop_order_items_addon"),
        ("shop_subscriptions", "fk_shop_subscriptions_addon"),
        ("shop_entitlements", "fk_shop_entitlements_addon"),
    ):
        if table in tables:
            _add_addon_fk(inspector, table, fk_name)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    for table, fk_name in (
        ("shop_entitlements", "fk_shop_entitlements_addon"),
        ("shop_subscriptions", "fk_shop_subscriptions_addon"),
        ("shop_order_items", "fk_shop_order_items_addon"),
    ):
        if table in tables:
            _drop_addon_fk(inspector, table, fk_name)

    if "shop_addons" in tables:
        for index_name in (
            "ix_shop_addons_cat_active",
            "ix_shop_addons_slug",
            "ix_shop_addons_id",
        ):
            existing = {idx["name"] for idx in inspector.get_indexes("shop_addons")}
            if index_name in existing:
                op.drop_index(index_name, table_name="shop_addons")
        op.drop_table("shop_addons")
