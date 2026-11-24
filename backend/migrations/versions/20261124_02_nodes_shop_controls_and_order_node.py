"""Shop-Steuerfelder fuer Nodes (Hybrid-Modus, CPU-Sichtbarkeit, Klassen-Aufpreis) und Standort-Auswahl auf Bestellungen.

Revision ID: 20261124_02
Revises: 20261124_01
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_02"
down_revision: Union[str, None] = "20261124_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _check_names(inspector, table: str) -> set[str]:
    return {
        ck["name"] for ck in inspector.get_check_constraints(table) if ck.get("name")
    }


def _fk_names(inspector, table: str) -> set[str]:
    return {
        fk["name"] for fk in inspector.get_foreign_keys(table) if fk.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "nodes" in tables:
        node_cols = _column_names(inspector, "nodes")
        for col_name, col in (
            (
                "shop_enabled",
                sa.Column("shop_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            ),
            (
                "shop_show_cpu",
                sa.Column("shop_show_cpu", sa.Boolean(), nullable=False, server_default=sa.true()),
            ),
            (
                "hardware_tier_label",
                sa.Column("hardware_tier_label", sa.String(length=64), nullable=True),
            ),
            (
                "shop_surcharge_cents",
                sa.Column("shop_surcharge_cents", sa.Integer(), nullable=False, server_default="0"),
            ),
        ):
            if col_name not in node_cols:
                op.add_column("nodes", col)

        node_checks = _check_names(inspector, "nodes")
        if "ck_nodes_shop_surcharge_cents" not in node_checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("nodes") as batch_op:
                    batch_op.create_check_constraint(
                        "ck_nodes_shop_surcharge_cents",
                        "shop_surcharge_cents >= 0",
                    )
            else:
                op.create_check_constraint(
                    "ck_nodes_shop_surcharge_cents",
                    "nodes",
                    "shop_surcharge_cents >= 0",
                )

    if "shop_order_items" in tables:
        item_cols = _column_names(inspector, "shop_order_items")
        if "preferred_node_id" not in item_cols:
            op.add_column(
                "shop_order_items",
                sa.Column("preferred_node_id", sa.Integer(), nullable=True),
            )
            if bind.dialect.name != "sqlite":
                op.create_foreign_key(
                    "fk_shop_order_items_preferred_node_id",
                    "shop_order_items",
                    "nodes",
                    ["preferred_node_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
        if "node_surcharge_cents" not in item_cols:
            op.add_column(
                "shop_order_items",
                sa.Column(
                    "node_surcharge_cents",
                    sa.Integer(),
                    nullable=False,
                    server_default="0",
                ),
            )
        item_checks = _check_names(inspector, "shop_order_items")
        if "ck_shop_order_items_node_surcharge" not in item_checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("shop_order_items") as batch_op:
                    batch_op.create_check_constraint(
                        "ck_shop_order_items_node_surcharge",
                        "node_surcharge_cents >= 0",
                    )
            else:
                op.create_check_constraint(
                    "ck_shop_order_items_node_surcharge",
                    "shop_order_items",
                    "node_surcharge_cents >= 0",
                )

    if "shop_entitlements" in tables:
        ent_cols = _column_names(inspector, "shop_entitlements")
        if "preferred_node_id" not in ent_cols:
            op.add_column(
                "shop_entitlements",
                sa.Column("preferred_node_id", sa.Integer(), nullable=True),
            )
            if bind.dialect.name != "sqlite":
                op.create_foreign_key(
                    "fk_shop_entitlements_preferred_node_id",
                    "shop_entitlements",
                    "nodes",
                    ["preferred_node_id"],
                    ["id"],
                    ondelete="SET NULL",
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "shop_entitlements" in tables:
        ent_cols = _column_names(inspector, "shop_entitlements")
        if bind.dialect.name != "sqlite":
            ent_fks = _fk_names(inspector, "shop_entitlements")
            if "fk_shop_entitlements_preferred_node_id" in ent_fks:
                op.drop_constraint(
                    "fk_shop_entitlements_preferred_node_id",
                    "shop_entitlements",
                    type_="foreignkey",
                )
        if "preferred_node_id" in ent_cols:
            op.drop_column("shop_entitlements", "preferred_node_id")

    if "shop_order_items" in tables:
        item_checks = _check_names(inspector, "shop_order_items")
        if "ck_shop_order_items_node_surcharge" in item_checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("shop_order_items") as batch_op:
                    batch_op.drop_constraint(
                        "ck_shop_order_items_node_surcharge", type_="check"
                    )
            else:
                op.drop_constraint(
                    "ck_shop_order_items_node_surcharge",
                    "shop_order_items",
                    type_="check",
                )
        if bind.dialect.name != "sqlite":
            item_fks = _fk_names(inspector, "shop_order_items")
            if "fk_shop_order_items_preferred_node_id" in item_fks:
                op.drop_constraint(
                    "fk_shop_order_items_preferred_node_id",
                    "shop_order_items",
                    type_="foreignkey",
                )
        item_cols = _column_names(inspector, "shop_order_items")
        for col_name in ("node_surcharge_cents", "preferred_node_id"):
            if col_name in item_cols:
                op.drop_column("shop_order_items", col_name)

    if "nodes" in tables:
        node_checks = _check_names(inspector, "nodes")
        if "ck_nodes_shop_surcharge_cents" in node_checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("nodes") as batch_op:
                    batch_op.drop_constraint("ck_nodes_shop_surcharge_cents", type_="check")
            else:
                op.drop_constraint("ck_nodes_shop_surcharge_cents", "nodes", type_="check")
        node_cols = _column_names(inspector, "nodes")
        for col_name in (
            "shop_surcharge_cents",
            "hardware_tier_label",
            "shop_show_cpu",
            "shop_enabled",
        ):
            if col_name in node_cols:
                op.drop_column("nodes", col_name)
