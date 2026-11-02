"""Aufloesezeitpunkt der Geraete-Freigabe (Befund 11).

Revision ID: 20261103_02
Revises: 20261102_03
Create Date: 2026-11-03

`consumed_at` markiert die einmalige Abholung durch das Zielgeraet; wer die
Session aufgeloest hat (das Smartphone), stand nur im JSON. Zwei gleichzeitige
Auflosungen ueberschrieben einander. `resolved_at` haelt den Aufloesezeitpunkt
als Spalte: unter Zeilensperre geprueft, wird eine aufgeloeste Session nie
ueberschrieben.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261103_02"
# Direkt am alten Head: Diese Welle (2a) braucht keinen 2b-Vorfahren.
# 20261103_01 (Team-Schalter, Welle 2b) hängt danach an dieser Revision.
down_revision: Union[str, None] = "20261102_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("login_challenges") as batch:
        batch.add_column(sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("login_challenges") as batch:
        batch.drop_column("resolved_at")
