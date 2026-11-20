"""Rechnungs-Ledger: Belege, Positionen, Nummernkreis, Kaeuferanschrift.

Revision ID: 20261120_05
Revises: 20261120_04
Create Date: 2026-11-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261120_05"
down_revision: Union[str, None] = "20261120_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    order_spalten = {spalte["name"] for spalte in inspector.get_columns("shop_orders")}
    for name, laenge in (
        ("buyer_name", 160),
        ("buyer_street", 160),
        ("buyer_postal_code", 16),
        ("buyer_city", 120),
        ("buyer_country", 2),
        ("buyer_email", 254),
    ):
        if name not in order_spalten:
            op.add_column(
                "shop_orders", sa.Column(name, sa.String(length=laenge), nullable=True)
            )

    if "shop_invoice_sequences" not in tables:
        op.create_table(
            "shop_invoice_sequences",
            sa.Column("year", sa.Integer(), primary_key=True),
            sa.Column(
                "last_number", sa.Integer(), nullable=False, server_default=sa.text("0")
            ),
        )

    if "shop_invoices" not in tables:
        op.create_table(
            "shop_invoices",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("number", sa.String(length=32), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column(
                "type", sa.String(length=16), nullable=False, server_default="invoice"
            ),
            sa.Column(
                "status", sa.String(length=16), nullable=False, server_default="issued"
            ),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column(
                "currency", sa.String(length=3), nullable=False, server_default="EUR"
            ),
            sa.Column("buyer_reference", sa.String(length=64), nullable=False),
            sa.Column("seller_name", sa.String(length=200), nullable=False),
            sa.Column("seller_street", sa.String(length=200), nullable=False),
            sa.Column("seller_postal_code", sa.String(length=16), nullable=False),
            sa.Column("seller_city", sa.String(length=120), nullable=False),
            sa.Column("seller_country", sa.String(length=2), nullable=False),
            sa.Column("seller_email", sa.String(length=254), nullable=False),
            sa.Column("seller_phone", sa.String(length=64), nullable=True),
            sa.Column("seller_vat_id", sa.String(length=32), nullable=True),
            sa.Column("seller_tax_number", sa.String(length=32), nullable=True),
            sa.Column("seller_iban", sa.String(length=34), nullable=True),
            sa.Column("seller_bic", sa.String(length=11), nullable=True),
            sa.Column(
                "small_business",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("buyer_name", sa.String(length=160), nullable=False),
            sa.Column("buyer_street", sa.String(length=160), nullable=False),
            sa.Column("buyer_postal_code", sa.String(length=16), nullable=False),
            sa.Column("buyer_city", sa.String(length=120), nullable=False),
            sa.Column("buyer_country", sa.String(length=2), nullable=False),
            sa.Column("buyer_email", sa.String(length=254), nullable=False),
            sa.Column("buyer_vat_id", sa.String(length=32), nullable=True),
            sa.Column("net_cents", sa.Integer(), nullable=False),
            sa.Column("tax_cents", sa.Integer(), nullable=False),
            sa.Column("gross_cents", sa.Integer(), nullable=False),
            sa.Column("xml_text", sa.Text(), nullable=False),
            sa.Column("xml_sha256", sa.String(length=64), nullable=False),
            sa.Column("pdf_bytes", sa.LargeBinary(), nullable=False),
            sa.Column("pdf_sha256", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["order_id"],
                ["shop_orders.id"],
                name="fk_shop_invoices_order",
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
                name="fk_shop_invoices_user",
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint("number", name="uq_shop_invoices_number"),
            sa.UniqueConstraint("order_id", name="uq_shop_invoices_order"),
            sa.CheckConstraint(
                "type IN ('invoice', 'credit_note')", name="ck_shop_invoices_type"
            ),
            sa.CheckConstraint(
                "status IN ('issued', 'void')", name="ck_shop_invoices_status"
            ),
            sa.CheckConstraint(
                "net_cents >= 0 AND tax_cents >= 0 AND gross_cents >= 0",
                name="ck_shop_invoices_cents",
            ),
        )
        op.create_index("ix_shop_invoices_id", "shop_invoices", ["id"])
        op.create_index("ix_shop_invoices_number", "shop_invoices", ["number"])
        op.create_index("ix_shop_invoices_order_id", "shop_invoices", ["order_id"])
        op.create_index("ix_shop_invoices_user_id", "shop_invoices", ["user_id"])
        op.create_index(
            "ix_shop_invoices_user_issued", "shop_invoices", ["user_id", "issued_at"]
        )

    if "shop_invoice_lines" not in tables:
        op.create_table(
            "shop_invoice_lines",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("invoice_id", sa.Integer(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("description", sa.String(length=255), nullable=False),
            sa.Column(
                "quantity", sa.Integer(), nullable=False, server_default=sa.text("1")
            ),
            sa.Column(
                "unit_code", sa.String(length=8), nullable=False, server_default="C62"
            ),
            sa.Column("unit_price_cents", sa.Integer(), nullable=False),
            sa.Column("line_net_cents", sa.Integer(), nullable=False),
            sa.Column("tax_rate_percent", sa.Integer(), nullable=False),
            sa.Column(
                "tax_category", sa.String(length=4), nullable=False, server_default="S"
            ),
            sa.ForeignKeyConstraint(
                ["invoice_id"],
                ["shop_invoices.id"],
                name="fk_shop_invoice_lines_invoice",
                ondelete="CASCADE",
            ),
            sa.CheckConstraint("quantity > 0", name="ck_shop_invoice_lines_quantity"),
            sa.UniqueConstraint(
                "invoice_id", "position", name="uq_shop_invoice_lines_pos"
            ),
        )
        op.create_index("ix_shop_invoice_lines_id", "shop_invoice_lines", ["id"])
        op.create_index(
            "ix_shop_invoice_lines_invoice_id", "shop_invoice_lines", ["invoice_id"]
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name in ("shop_invoice_lines", "shop_invoices", "shop_invoice_sequences"):
        if name in tables:
            op.drop_table(name)
    order_spalten = {spalte["name"] for spalte in inspector.get_columns("shop_orders")}
    for name in (
        "buyer_email",
        "buyer_country",
        "buyer_city",
        "buyer_postal_code",
        "buyer_street",
        "buyer_name",
    ):
        if name in order_spalten:
            op.drop_column("shop_orders", name)
