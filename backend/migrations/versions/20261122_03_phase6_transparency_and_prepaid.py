"""Phase 6 Transparenz, Prepaid-Modus, Update-Pinning und Cloudflare-Subdomains.

Revision ID: 20261122_03
Revises: 20261122_02
Create Date: 2026-11-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261122_03"
down_revision: Union[str, None] = "20261122_02"
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


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "nodes" in tables:
        node_cols = _column_names(inspector, "nodes")
        for col_name, col in (
            ("location_label", sa.Column("location_label", sa.String(length=120), nullable=True)),
            ("ram_type", sa.Column("ram_type", sa.String(length=32), nullable=True)),
            ("storage_type", sa.Column("storage_type", sa.String(length=64), nullable=True)),
            ("cpu_steal_percent", sa.Column("cpu_steal_percent", sa.Float(), nullable=True)),
        ):
            if col_name not in node_cols:
                op.add_column("nodes", col)

    for table_name, check_name in (
        ("shop_orders", "ck_shop_orders_billing_mode"),
        ("shop_subscriptions", "ck_shop_subscriptions_billing_mode"),
    ):
        if table_name in tables:
            cols = _column_names(inspector, table_name)
            if "billing_mode" not in cols:
                op.add_column(
                    table_name,
                    sa.Column(
                        "billing_mode",
                        sa.String(length=16),
                        nullable=False,
                        server_default="subscription",
                    ),
                )
            if table_name == "shop_orders" and "extend_subscription_id" not in cols:
                op.add_column(
                    "shop_orders",
                    sa.Column(
                        "extend_subscription_id",
                        sa.Integer(),
                        sa.ForeignKey("shop_subscriptions.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            checks = _check_names(inspector, table_name)
            if check_name not in checks:
                op.create_check_constraint(
                    check_name,
                    table_name,
                    "billing_mode IN ('prepaid', 'subscription')",
                )

    if "servers" in tables:
        srv_cols = _column_names(inspector, "servers")
        if "auto_update_paused" not in srv_cols:
            op.add_column(
                "servers",
                sa.Column(
                    "auto_update_paused",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )
        for col_name, length in (
            ("public_hostname", 255),
            ("cloudflare_zone_id", 64),
            ("cloudflare_a_record_id", 64),
            ("cloudflare_srv_record_id", 64),
        ):
            if col_name not in srv_cols:
                op.add_column(
                    "servers",
                    sa.Column(col_name, sa.String(length=length), nullable=True),
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "servers" in tables:
        srv_cols = _column_names(inspector, "servers")
        for col_name in (
            "cloudflare_srv_record_id",
            "cloudflare_a_record_id",
            "cloudflare_zone_id",
            "public_hostname",
            "auto_update_paused",
        ):
            if col_name in srv_cols:
                op.drop_column("servers", col_name)

    for table_name, check_name in (
        ("shop_subscriptions", "ck_shop_subscriptions_billing_mode"),
        ("shop_orders", "ck_shop_orders_billing_mode"),
    ):
        if table_name in tables:
            checks = _check_names(inspector, table_name)
            if check_name in checks:
                op.drop_constraint(check_name, table_name, type_="check")
            cols = _column_names(inspector, table_name)
            if table_name == "shop_orders" and "extend_subscription_id" in cols:
                op.drop_column("shop_orders", "extend_subscription_id")
            if "billing_mode" in cols:
                op.drop_column(table_name, "billing_mode")

    if "nodes" in tables:
        node_cols = _column_names(inspector, "nodes")
        for col_name in ("cpu_steal_percent", "storage_type", "ram_type", "location_label"):
            if col_name in node_cols:
                op.drop_column("nodes", col_name)
