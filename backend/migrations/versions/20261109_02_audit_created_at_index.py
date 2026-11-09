"""Index fuer Zeitfenster im Audit-Protokoll.

Die Uebersicht der neuen Audit-Seite fragt je Zeitraum viermal nach
`created_at` und gruppiert einmal danach. Der vorhandene Dedupe-Index beginnt
mit `user_id` und traegt diese Abfrage nicht. Die Tabelle waechst unbegrenzt;
ohne eigenen Index waere jede Kennzahl ein Heap-Scan.

Revision ID: 20261109_02
Revises: 20261109_01
Create Date: 2026-11-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261109_02"
down_revision: Union[str, None] = "20261109_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = "ix_audit_logs_created_at"


def _indizes() -> set[str] | None:
    """Die Indizes der Tabelle; `None`, wenn es die Tabelle nicht gibt."""
    inspector = sa.inspect(op.get_bind())
    if "audit_logs" not in set(inspector.get_table_names()):
        return None
    return {index["name"] for index in inspector.get_indexes("audit_logs")}


def upgrade() -> None:
    indizes = _indizes()
    if indizes is not None and INDEX not in indizes:
        op.create_index(INDEX, "audit_logs", ["created_at"])


def downgrade() -> None:
    indizes = _indizes()
    if indizes is not None and INDEX in indizes:
        op.drop_index(INDEX, table_name="audit_logs")
