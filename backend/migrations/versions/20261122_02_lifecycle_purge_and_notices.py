"""Phase 5 Lifecycle-Bereinigung (Shop & Hoster-API) und idempotente E-Mail-Mahnstufen.

Revision ID: 20261122_02
Revises: 20261122_01
Create Date: 2026-11-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261122_02"
down_revision: Union[str, None] = "20261122_01"
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


def _index_names(inspector, table: str) -> set[str]:
    return {
        idx["name"] for idx in inspector.get_indexes(table) if idx.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "shop_subscriptions" in tables:
        sub_cols = _column_names(inspector, "shop_subscriptions")
        if "delete_server_on_end" not in sub_cols:
            op.add_column(
                "shop_subscriptions",
                sa.Column(
                    "delete_server_on_end",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )

    if "shop_entitlements" in tables:
        ent_cols = _column_names(inspector, "shop_entitlements")
        for col_name, col in (
            ("suspended_at", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True)),
            ("purge_after", sa.Column("purge_after", sa.DateTime(timezone=True), nullable=True)),
            ("purge_reason", sa.Column("purge_reason", sa.String(length=24), nullable=True)),
            ("purge_cycle_token", sa.Column("purge_cycle_token", sa.String(length=36), nullable=True)),
            ("purged_at", sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True)),
        ):
            if col_name not in ent_cols:
                op.add_column("shop_entitlements", col)

        checks = _check_names(inspector, "shop_entitlements")
        if "ck_shop_entitlements_provisioning_status" in checks:
            op.drop_constraint(
                "ck_shop_entitlements_provisioning_status",
                "shop_entitlements",
                type_="check",
            )
        op.create_check_constraint(
            "ck_shop_entitlements_provisioning_status",
            "shop_entitlements",
            "provisioning_status IS NULL OR provisioning_status IN "
            "('pending', 'provisioning', 'ready', 'suspended', 'revoked', 'failed', 'purged')",
        )
        if "ck_shop_entitlements_purge_reason" not in checks:
            op.create_check_constraint(
                "ck_shop_entitlements_purge_reason",
                "shop_entitlements",
                "purge_reason IS NULL OR purge_reason IN ('voluntary_cancel', 'unpaid', 'refund')",
            )
        if "ix_shop_entitlements_purge_after" not in _index_names(
            inspector, "shop_entitlements"
        ):
            op.create_index(
                "ix_shop_entitlements_purge_after",
                "shop_entitlements",
                ["status", "purge_after"],
            )

    if "hoster_integrations" in tables:
        hi_cols = _column_names(inspector, "hoster_integrations")
        if "unpaid_delete_days" not in hi_cols:
            op.add_column(
                "hoster_integrations",
                sa.Column("unpaid_delete_days", sa.Integer(), nullable=True),
            )
        hi_checks = _check_names(inspector, "hoster_integrations")
        if "ck_hoster_integrations_unpaid_delete" not in hi_checks:
            op.create_check_constraint(
                "ck_hoster_integrations_unpaid_delete",
                "hoster_integrations",
                "unpaid_delete_days IS NULL OR (unpaid_delete_days >= 0 AND unpaid_delete_days <= 365)",
            )

    if "hoster_services" in tables:
        hs_cols = _column_names(inspector, "hoster_services")
        for col_name, col in (
            ("suspended_at", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True)),
            ("purge_reason", sa.Column("purge_reason", sa.String(length=24), nullable=True)),
            ("purge_cycle_token", sa.Column("purge_cycle_token", sa.String(length=36), nullable=True)),
            ("purged_at", sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True)),
        ):
            if col_name not in hs_cols:
                op.add_column("hoster_services", col)
        hs_checks = _check_names(inspector, "hoster_services")
        if "ck_hoster_services_purge_reason" not in hs_checks:
            op.create_check_constraint(
                "ck_hoster_services_purge_reason",
                "hoster_services",
                "purge_reason IS NULL OR purge_reason IN ('voluntary_cancel', 'unpaid')",
            )

    if "lifecycle_deletion_notices" not in tables:
        op.create_table(
            "lifecycle_deletion_notices",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("target_kind", sa.String(length=24), nullable=False),
            sa.Column("target_id", sa.Integer(), nullable=False),
            sa.Column("cycle_token", sa.String(length=36), nullable=False),
            sa.Column("stage_days", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column(
                "attempts", sa.Integer(), nullable=False, server_default="1"
            ),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(
                "target_kind IN ('shop_entitlement', 'hoster_service')",
                name="ck_lifecycle_notices_target_kind",
            ),
            sa.CheckConstraint(
                "status IN ('sent', 'skipped', 'failed')",
                name="ck_lifecycle_notices_status",
            ),
            sa.CheckConstraint(
                "stage_days > 0",
                name="ck_lifecycle_notices_stage_days",
            ),
            sa.UniqueConstraint(
                "target_kind",
                "target_id",
                "cycle_token",
                "stage_days",
                name="uq_lifecycle_notice_stage",
            ),
        )
        op.create_index(
            "ix_lifecycle_notices_target",
            "lifecycle_deletion_notices",
            ["target_kind", "target_id", "cycle_token"],
        )
        op.create_index(
            "ix_lifecycle_deletion_notices_id",
            "lifecycle_deletion_notices",
            ["id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "lifecycle_deletion_notices" in tables:
        op.drop_table("lifecycle_deletion_notices")

    if "hoster_services" in tables:
        hs_checks = _check_names(inspector, "hoster_services")
        if "ck_hoster_services_purge_reason" in hs_checks:
            op.drop_constraint(
                "ck_hoster_services_purge_reason",
                "hoster_services",
                type_="check",
            )
        hs_cols = _column_names(inspector, "hoster_services")
        for col_name in (
            "purged_at",
            "purge_cycle_token",
            "purge_reason",
            "suspended_at",
        ):
            if col_name in hs_cols:
                op.drop_column("hoster_services", col_name)

    if "hoster_integrations" in tables:
        hi_checks = _check_names(inspector, "hoster_integrations")
        if "ck_hoster_integrations_unpaid_delete" in hi_checks:
            op.drop_constraint(
                "ck_hoster_integrations_unpaid_delete",
                "hoster_integrations",
                type_="check",
            )
        if "unpaid_delete_days" in _column_names(inspector, "hoster_integrations"):
            op.drop_column("hoster_integrations", "unpaid_delete_days")

    if "shop_entitlements" in tables:
        if "ix_shop_entitlements_purge_after" in _index_names(
            inspector, "shop_entitlements"
        ):
            op.drop_index(
                "ix_shop_entitlements_purge_after", table_name="shop_entitlements"
            )
        checks = _check_names(inspector, "shop_entitlements")
        if "ck_shop_entitlements_purge_reason" in checks:
            op.drop_constraint(
                "ck_shop_entitlements_purge_reason",
                "shop_entitlements",
                type_="check",
            )
        if "ck_shop_entitlements_provisioning_status" in checks:
            op.drop_constraint(
                "ck_shop_entitlements_provisioning_status",
                "shop_entitlements",
                type_="check",
            )
        op.execute(
            "UPDATE shop_entitlements SET provisioning_status = 'revoked' WHERE provisioning_status = 'purged'"
        )
        op.create_check_constraint(
            "ck_shop_entitlements_provisioning_status",
            "shop_entitlements",
            "provisioning_status IS NULL OR provisioning_status IN "
            "('pending', 'provisioning', 'ready', 'suspended', 'revoked', 'failed')",
        )
        ent_cols = _column_names(inspector, "shop_entitlements")
        for col_name in (
            "purged_at",
            "purge_cycle_token",
            "purge_reason",
            "purge_after",
            "suspended_at",
        ):
            if col_name in ent_cols:
                op.drop_column("shop_entitlements", col_name)

    if "shop_subscriptions" in tables:
        if "delete_server_on_end" in _column_names(inspector, "shop_subscriptions"):
            op.drop_column("shop_subscriptions", "delete_server_on_end")
