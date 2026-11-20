"""Tabelle fuer native Shop-Tarife (Preise, Ressourcen, Artwork-Modus).

Revision ID: 20261120_01
Revises: 20261118_02
Create Date: 2026-11-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261120_01"
down_revision: Union[str, None] = "20261118_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "shop_plans" in tables:
        return

    op.create_table(
        "shop_plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("game_type", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.Column("ram_included_mb", sa.Integer(), nullable=True),
        sa.Column("ram_max_mb", sa.Integer(), nullable=True),
        sa.Column("ram_step_mb", sa.Integer(), nullable=True),
        sa.Column(
            "price_per_ram_step_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("cpu_included", sa.Integer(), nullable=True),
        sa.Column("cpu_max", sa.Integer(), nullable=True),
        sa.Column(
            "cpu_step", sa.Integer(), nullable=False, server_default=sa.text("1")
        ),
        sa.Column(
            "price_per_cpu_step_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("slots_included", sa.Integer(), nullable=True),
        sa.Column("slots_max", sa.Integer(), nullable=True),
        sa.Column(
            "slots_step", sa.Integer(), nullable=False, server_default=sa.text("1")
        ),
        sa.Column(
            "price_per_slot_step_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("node_id", sa.Integer(), nullable=True),
        sa.Column("role_id", sa.Integer(), nullable=True),
        sa.Column(
            "artwork_mode",
            sa.String(length=16),
            nullable=False,
            server_default="steam",
        ),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["node_id"], ["nodes.id"], name="fk_shop_plans_node", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["role_id"], ["roles.id"], name="fk_shop_plans_role", ondelete="SET NULL"
        ),
        sa.UniqueConstraint("game_type", "name", name="uq_shop_plans_game_name"),
        sa.CheckConstraint("price_cents >= 0", name="ck_shop_plans_price"),
        sa.CheckConstraint(
            "tax_rate_percent >= 0 AND tax_rate_percent <= 100",
            name="ck_shop_plans_tax",
        ),
        sa.CheckConstraint(
            "billing_interval IN ('month')", name="ck_shop_plans_interval"
        ),
        sa.CheckConstraint(
            "artwork_mode IN ('steam', 'custom', 'none')",
            name="ck_shop_plans_artwork",
        ),
    )
    op.create_index("ix_shop_plans_id", "shop_plans", ["id"])
    op.create_index("ix_shop_plans_game_type", "shop_plans", ["game_type"])
    op.create_index(
        "ix_shop_plans_game_active", "shop_plans", ["game_type", "active"]
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "shop_plans" in tables:
        op.drop_table("shop_plans")
