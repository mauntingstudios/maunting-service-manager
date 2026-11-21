"""Fulfillment-Felder an shop_entitlements (Server-Bindung & Rollennachweis).

Revision ID: 20261121_01
Revises: 20261120_06
Create Date: 2026-11-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261121_01"
down_revision: Union[str, None] = "20261120_06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    spalten = {col["name"] for col in inspector.get_columns("shop_entitlements")}
    indizes = {idx["name"] for idx in inspector.get_indexes("shop_entitlements")}
    checks = {ck["name"] for ck in inspector.get_check_constraints("shop_entitlements")}

    if "server_id" not in spalten:
        op.add_column(
            "shop_entitlements",
            sa.Column("server_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_shop_entitlements_server",
            "shop_entitlements",
            "servers",
            ["server_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "ix_shop_entitlements_server_id" not in indizes:
        op.create_index(
            "ix_shop_entitlements_server_id",
            "shop_entitlements",
            ["server_id"],
        )

    if "granted_role_id" not in spalten:
        op.add_column(
            "shop_entitlements",
            sa.Column("granted_role_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_shop_entitlements_granted_role",
            "shop_entitlements",
            "roles",
            ["granted_role_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if "provisioning_status" not in spalten:
        op.add_column(
            "shop_entitlements",
            sa.Column("provisioning_status", sa.String(length=24), nullable=True),
        )
    if "ck_shop_entitlements_provisioning_status" not in checks:
        op.create_check_constraint(
            "ck_shop_entitlements_provisioning_status",
            "shop_entitlements",
            "provisioning_status IS NULL OR provisioning_status IN "
            "('pending', 'provisioning', 'ready', 'suspended', 'revoked', 'failed')",
        )

    if "provisioning_error" not in spalten:
        op.add_column(
            "shop_entitlements",
            sa.Column("provisioning_error", sa.String(length=64), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    spalten = {col["name"] for col in inspector.get_columns("shop_entitlements")}
    indizes = {idx["name"] for idx in inspector.get_indexes("shop_entitlements")}
    checks = {ck["name"] for ck in inspector.get_check_constraints("shop_entitlements")}
    fks = inspector.get_foreign_keys("shop_entitlements")

    if "provisioning_error" in spalten:
        op.drop_column("shop_entitlements", "provisioning_error")

    if "ck_shop_entitlements_provisioning_status" in checks:
        op.drop_constraint(
            "ck_shop_entitlements_provisioning_status",
            "shop_entitlements",
            type_="check",
        )
    if "provisioning_status" in spalten:
        op.drop_column("shop_entitlements", "provisioning_status")

    if "granted_role_id" in spalten:
        for fk in fks:
            if fk.get("constrained_columns") == ["granted_role_id"] and fk.get("name"):
                op.drop_constraint(fk["name"], "shop_entitlements", type_="foreignkey")
        op.drop_column("shop_entitlements", "granted_role_id")

    if "ix_shop_entitlements_server_id" in indizes:
        op.drop_index("ix_shop_entitlements_server_id", table_name="shop_entitlements")
    if "server_id" in spalten:
        for fk in fks:
            if fk.get("constrained_columns") == ["server_id"] and fk.get("name"):
                op.drop_constraint(fk["name"], "shop_entitlements", type_="foreignkey")
        op.drop_column("shop_entitlements", "server_id")
