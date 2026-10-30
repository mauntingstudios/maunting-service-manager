"""Dokumente: KI-Vorschlaege mit mehreren Aenderungen.

Revision ID: 20261031_01
Revises: 20261030_01
Create Date: 2026-10-31
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261031_01"
down_revision: Union[str, None] = "20261030_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT = "ck_doc_pending_edits_operation"


def _check_text(bind: sa.engine.Connection, tabelle: str, name: str) -> str | None:
    for eintrag in sa.inspect(bind).get_check_constraints(tabelle):
        if eintrag.get("name") == name:
            return eintrag.get("sqltext") or ""
    return None


def upgrade() -> None:
    # Idempotent wie 20261030_01: Tests und halb ausgefuehrte Installationen
    # koennen die neue Bedingung schon tragen.
    bind = op.get_bind()
    if "doc_pending_edits" not in sa.inspect(bind).get_table_names():
        return
    text = _check_text(bind, "doc_pending_edits", CONSTRAINT)
    if text is None or "'batch'" in text:
        return
    op.drop_constraint(CONSTRAINT, "doc_pending_edits", type_="check")
    op.create_check_constraint(
        CONSTRAINT,
        "doc_pending_edits",
        "operation IN ('append', 'replace_block', 'batch')",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "doc_pending_edits" not in sa.inspect(bind).get_table_names():
        return
    text = _check_text(bind, "doc_pending_edits", CONSTRAINT)
    if text is None or "'batch'" not in text:
        return
    op.drop_constraint(CONSTRAINT, "doc_pending_edits", type_="check")
    op.create_check_constraint(
        CONSTRAINT,
        "doc_pending_edits",
        "operation IN ('append', 'replace_block')",
    )
