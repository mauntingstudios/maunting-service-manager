"""Documents: Keyset-Cursor braucht updated_at und id im Index.

Der Cursor der Dokumentliste laeuft ueber `(updated_at, id)`. Der alte Index
endete bei `updated_at`; Postgres musste die Kennung als Tiebreaker aus der
Tabelle holen. Der neue Index traegt beide Spalten in derselben Richtung.

Revision ID: 20261103_03
Revises: 20261103_01
Create Date: 2026-11-03
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261103_03"
down_revision: Union[str, None] = "20261103_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ALT = "ix_documents_team_updated"
NEU = "ix_documents_team_updated_id"


def _indizes() -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("documents")}


def upgrade() -> None:
    vorhanden = _indizes()
    if NEU not in vorhanden:
        op.create_index(
            NEU,
            "documents",
            ["team_id", sa.text("updated_at DESC"), sa.text("id DESC")],
        )
    if ALT in _indizes():
        op.drop_index(ALT, table_name="documents")


def downgrade() -> None:
    vorhanden = _indizes()
    if ALT not in vorhanden:
        op.create_index(ALT, "documents", ["team_id", sa.text("updated_at DESC")])
    if NEU in vorhanden:
        op.drop_index(NEU, table_name="documents")
