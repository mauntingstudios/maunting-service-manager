"""Phase 7 Best-of-Hoster Features, Lifetime-Tarife, Server-Pause und 3-Ebenen-DDoS-Felder.

Revision ID: 20261122_04
Revises: 20261122_03
Create Date: 2026-11-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261122_04"
down_revision: Union[str, None] = "20261122_03"
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


def _replace_check(table_name: str, check_name: str, expr: str, inspector) -> None:
    checks = _check_names(inspector, table_name)
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(table_name) as batch_op:
            if check_name in checks:
                batch_op.drop_constraint(check_name, type_="check")
            batch_op.create_check_constraint(check_name, expr)
    else:
        if check_name in checks:
            op.drop_constraint(check_name, table_name, type_="check")
        op.create_check_constraint(check_name, table_name, expr)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "nodes" in tables:
        node_cols = _column_names(inspector, "nodes")
        for col_name, col in (
            ("public_ping_url", sa.Column("public_ping_url", sa.String(length=255), nullable=True)),
            ("ddos_provider", sa.Column("ddos_provider", sa.String(length=100), nullable=True)),
            ("ddos_profile", sa.Column("ddos_profile", sa.String(length=160), nullable=True)),
            (
                "ddos_game_aware",
                sa.Column(
                    "ddos_game_aware",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            ),
        ):
            if col_name not in node_cols:
                op.add_column("nodes", col)

    if "shop_plans" in tables:
        plan_cols = _column_names(inspector, "shop_plans")
        if "lifetime_price_cents" not in plan_cols:
            op.add_column(
                "shop_plans",
                sa.Column("lifetime_price_cents", sa.Integer(), nullable=True),
            )
        if "allow_game_switch" not in plan_cols:
            op.add_column(
                "shop_plans",
                sa.Column(
                    "allow_game_switch",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )
        plan_checks = _check_names(inspector, "shop_plans")
        if "ck_shop_plans_lifetime_price" not in plan_checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("shop_plans") as batch_op:
                    batch_op.create_check_constraint(
                        "ck_shop_plans_lifetime_price",
                        "lifetime_price_cents IS NULL OR lifetime_price_cents >= 0",
                    )
            else:
                op.create_check_constraint(
                    "ck_shop_plans_lifetime_price",
                    "shop_plans",
                    "lifetime_price_cents IS NULL OR lifetime_price_cents >= 0",
                )

    if "shop_entitlements" in tables:
        ent_cols = _column_names(inspector, "shop_entitlements")
        if "paused_at" not in ent_cols:
            op.add_column(
                "shop_entitlements",
                sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
            )
        if "pause_days_used" not in ent_cols:
            op.add_column(
                "shop_entitlements",
                sa.Column(
                    "pause_days_used",
                    sa.Integer(),
                    nullable=False,
                    server_default="0",
                ),
            )

    for table_name, check_name in (
        ("shop_orders", "ck_shop_orders_billing_mode"),
        ("shop_subscriptions", "ck_shop_subscriptions_billing_mode"),
    ):
        if table_name in tables:
            _replace_check(
                table_name,
                check_name,
                "billing_mode IN ('prepaid', 'subscription', 'lifetime')",
                inspector,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    for table_name, check_name in (
        ("shop_subscriptions", "ck_shop_subscriptions_billing_mode"),
        ("shop_orders", "ck_shop_orders_billing_mode"),
    ):
        if table_name in tables:
            _replace_check(
                table_name,
                check_name,
                "billing_mode IN ('prepaid', 'subscription')",
                inspector,
            )

    if "shop_entitlements" in tables:
        ent_cols = _column_names(inspector, "shop_entitlements")
        for col_name in ("pause_days_used", "paused_at"):
            if col_name in ent_cols:
                op.drop_column("shop_entitlements", col_name)

    if "shop_plans" in tables:
        plan_checks = _check_names(inspector, "shop_plans")
        if "ck_shop_plans_lifetime_price" in plan_checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("shop_plans") as batch_op:
                    batch_op.drop_constraint("ck_shop_plans_lifetime_price", type_="check")
            else:
                op.drop_constraint("ck_shop_plans_lifetime_price", "shop_plans", type_="check")
        plan_cols = _column_names(inspector, "shop_plans")
        for col_name in ("allow_game_switch", "lifetime_price_cents"):
            if col_name in plan_cols:
                op.drop_column("shop_plans", col_name)

    if "nodes" in tables:
        node_cols = _column_names(inspector, "nodes")
        for col_name in ("ddos_game_aware", "ddos_profile", "ddos_provider", "public_ping_url"):
            if col_name in node_cols:
                op.drop_column("nodes", col_name)
