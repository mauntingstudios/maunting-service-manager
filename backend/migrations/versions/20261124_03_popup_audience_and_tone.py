"""Pop-up audience (all/shop/panel) and tone (info/promo/maintenance).

Revision ID: 20261124_03
Revises: 20261124_02
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_03"
down_revision: Union[str, None] = "20261124_02"
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
    if "panel_popups" not in _table_names(inspector):
        return

    cols = _column_names(inspector, "panel_popups")
    if "audience" not in cols:
        op.add_column(
            "panel_popups",
            sa.Column("audience", sa.String(length=16), nullable=False, server_default="all"),
        )
    if "tone" not in cols:
        op.add_column(
            "panel_popups",
            sa.Column("tone", sa.String(length=16), nullable=False, server_default="info"),
        )

    checks = _check_names(inspector, "panel_popups")
    for check_name, expr in (
        ("ck_panel_popups_audience", "audience IN ('all', 'shop', 'panel')"),
        ("ck_panel_popups_tone", "tone IN ('info', 'promo', 'maintenance')"),
    ):
        if check_name not in checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("panel_popups") as batch_op:
                    batch_op.create_check_constraint(check_name, expr)
            else:
                op.create_check_constraint(check_name, "panel_popups", expr)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "panel_popups" not in _table_names(inspector):
        return

    checks = _check_names(inspector, "panel_popups")
    for check_name in ("ck_panel_popups_tone", "ck_panel_popups_audience"):
        if check_name in checks:
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("panel_popups") as batch_op:
                    batch_op.drop_constraint(check_name, type_="check")
            else:
                op.drop_constraint(check_name, "panel_popups", type_="check")

    cols = _column_names(inspector, "panel_popups")
    for col_name in ("tone", "audience"):
        if col_name in cols:
            op.drop_column("panel_popups", col_name)
