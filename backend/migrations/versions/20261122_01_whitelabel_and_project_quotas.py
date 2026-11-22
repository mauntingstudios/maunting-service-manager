"""Whitelabel-Katalog-Verknuepfung (HosterService -> ShopPlan) und KI-Projekt-Kontingente.

Revision ID: 20261122_01
Revises: 20261121_04
Create Date: 2026-11-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261122_01"
down_revision: Union[str, None] = "20261121_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _fk_names(inspector, table: str) -> set[str]:
    return {fk["name"] for fk in inspector.get_foreign_keys(table) if fk.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "role_ai_project_quotas" not in tables:
        op.create_table(
            "role_ai_project_quotas",
            sa.Column(
                "role_id",
                sa.Integer(),
                sa.ForeignKey("roles.id", ondelete="CASCADE"),
                primary_key=True,
                nullable=False,
            ),
            sa.Column(
                "max_projects",
                sa.Integer(),
                nullable=False,
                server_default="3",
            ),
            sa.Column(
                "max_storage_mb",
                sa.Integer(),
                nullable=False,
                server_default="256",
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    if "hoster_services" in tables:
        cols = _column_names(inspector, "hoster_services")
        if "shop_plan_id" not in cols:
            op.add_column(
                "hoster_services",
                sa.Column("shop_plan_id", sa.Integer(), nullable=True),
            )
        if "shop_plans" in tables and "fk_hoster_services_shop_plan" not in _fk_names(
            inspector, "hoster_services"
        ):
            op.create_foreign_key(
                "fk_hoster_services_shop_plan",
                "hoster_services",
                "shop_plans",
                ["shop_plan_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "hoster_services" in tables:
        cols = _column_names(inspector, "hoster_services")
        if "fk_hoster_services_shop_plan" in _fk_names(inspector, "hoster_services"):
            op.drop_constraint(
                "fk_hoster_services_shop_plan", "hoster_services", type_="foreignkey"
            )
        if "shop_plan_id" in cols:
            op.drop_column("hoster_services", "shop_plan_id")

    if "role_ai_project_quotas" in tables:
        op.drop_table("role_ai_project_quotas")
