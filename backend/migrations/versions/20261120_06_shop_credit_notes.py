"""Storno/Gutschrift: Ursprungsbezug und eigener Gutschrift-Nummernkreis.

Revision ID: 20261120_06
Revises: 20261120_05
Create Date: 2026-11-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261120_06"
down_revision: Union[str, None] = "20261120_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    spalten = {spalte["name"] for spalte in inspector.get_columns("shop_invoices")}
    if "reference_invoice_id" not in spalten:
        op.add_column(
            "shop_invoices",
            sa.Column("reference_invoice_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_shop_invoices_reference",
            "shop_invoices",
            "shop_invoices",
            ["reference_invoice_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "reason" not in spalten:
        op.add_column("shop_invoices", sa.Column("reason", sa.Text(), nullable=True))

    # Eine Gutschrift gehoert zur selben Bestellung; die Einmaligkeit der
    # Rechnung sichern wir im Dienst (Typ `invoice`), nicht per Order-ID.
    constraints = {
        eintrag["name"] for eintrag in inspector.get_unique_constraints("shop_invoices")
    }
    if "uq_shop_invoices_order" in constraints:
        op.drop_constraint("uq_shop_invoices_order", "shop_invoices", type_="unique")

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "shop_credit_note_sequences" not in tables:
        op.create_table(
            "shop_credit_note_sequences",
            sa.Column("year", sa.Integer(), primary_key=True),
            sa.Column(
                "last_number", sa.Integer(), nullable=False, server_default=sa.text("0")
            ),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "shop_credit_note_sequences" in tables:
        op.drop_table("shop_credit_note_sequences")
    spalten = {spalte["name"] for spalte in inspector.get_columns("shop_invoices")}
    if "reference_invoice_id" in spalten:
        # Der Name kann aus der Migration stammen oder automatisch von
        # PostgreSQL (bei `create_all` im Test). Beide Faelle abdecken.
        for fk in inspector.get_foreign_keys("shop_invoices"):
            if fk.get("constrained_columns") == ["reference_invoice_id"] and fk.get("name"):
                op.drop_constraint(fk["name"], "shop_invoices", type_="foreignkey")
        op.drop_column("shop_invoices", "reference_invoice_id")
    if "reason" in spalten:
        op.drop_column("shop_invoices", "reason")
