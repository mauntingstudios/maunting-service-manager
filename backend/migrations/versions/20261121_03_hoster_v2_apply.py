"""Hoster-API v2: Server- und Add-on-Positionen auf HosterService.

Revision ID: 20261121_03
Revises: 20261121_02
Create Date: 2026-11-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261121_03"
down_revision: Union[str, None] = "20261121_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _fk_names(inspector, table: str) -> set[str]:
    return {fk["name"] for fk in inspector.get_foreign_keys(table) if fk.get("name")}


def _check_names(inspector, table: str) -> set[str]:
    return {ck["name"] for ck in inspector.get_check_constraints(table) if ck.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "hoster_services" not in set(inspector.get_table_names()):
        return

    cols = _column_names(inspector, "hoster_services")
    if "item_kind" not in cols:
        op.add_column(
            "hoster_services",
            sa.Column(
                "item_kind",
                sa.String(length=16),
                nullable=False,
                server_default="server",
            ),
        )
    if "ck_hoster_services_item_kind" not in _check_names(inspector, "hoster_services"):
        op.create_check_constraint(
            "ck_hoster_services_item_kind",
            "hoster_services",
            "item_kind IN ('server', 'addon')",
        )
    if "addon_id" not in cols:
        op.add_column(
            "hoster_services",
            sa.Column("addon_id", sa.Integer(), nullable=True),
        )
    if "fk_hoster_services_addon" not in _fk_names(inspector, "hoster_services"):
        op.create_foreign_key(
            "fk_hoster_services_addon",
            "hoster_services",
            "shop_addons",
            ["addon_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "hoster_services" not in set(inspector.get_table_names()):
        return

    cols = _column_names(inspector, "hoster_services")
    if "fk_hoster_services_addon" in _fk_names(inspector, "hoster_services"):
        op.drop_constraint(
            "fk_hoster_services_addon", "hoster_services", type_="foreignkey"
        )
    if "ck_hoster_services_item_kind" in _check_names(inspector, "hoster_services"):
        op.drop_constraint(
            "ck_hoster_services_item_kind", "hoster_services", type_="check"
        )
    if "addon_id" in cols:
        op.drop_column("hoster_services", "addon_id")
    if "item_kind" in cols:
        op.drop_column("hoster_services", "item_kind")
