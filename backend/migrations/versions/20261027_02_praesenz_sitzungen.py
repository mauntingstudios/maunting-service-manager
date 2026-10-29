"""Praesenz je Geraet und eine Wahl, die ueber allen Geraeten gilt.

Bis 27.10.2026 lag der Kontostatus in genau einer Zeile je Konto: die letzte
Meldung gewann. Ein versteckter Tab nahm einem sichtbaren das "online" weg, ein
zweites Geraet hob ein "unsichtbar" auf, und weil nur bei einem Routenwechsel
gemeldet wurde, galt ein fleissiger Nutzer nach zwei Minuten als offline.

Neu:
* ``user_presences.manual_status`` traegt die Wahl des Menschen
  (``auto`` | ``online`` | ``away`` | ``invisible``).
* ``user_presence_sessions`` traegt je Geraet ein Lebenszeichen samt Client
  (``web`` | ``pontis`` | ``mss``), Plattform, Zustaendigkeit und Aktivitaet.

Revision ID: 20261027_02
Revises: 20261027_01
Create Date: 2026-10-27
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261027_02"
down_revision: Union[str, None] = "20261027_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)

    if "user_presence_sessions" not in tables:
        op.create_table(
            "user_presence_sessions",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("geraet", sa.String(length=64), nullable=False),
            sa.Column("client", sa.String(length=16), nullable=False, server_default="web"),
            sa.Column("plattform", sa.String(length=16), nullable=False, server_default="web"),
            sa.Column("zustand", sa.String(length=16), nullable=False, server_default="online"),
            sa.Column("activity_key", sa.String(length=48), nullable=True),
            sa.Column("vorn", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "geraet", name="uq_user_presence_session_geraet"),
        )
        op.create_index(
            "ix_user_presence_sessions_user_id",
            "user_presence_sessions",
            ["user_id"],
        )

    spalten = _columns(bind, "user_presences")
    if "manual_status" not in spalten:
        op.add_column(
            "user_presences",
            sa.Column("manual_status", sa.String(length=16), nullable=False, server_default="auto"),
        )

    # Die alte Wahl uebernehmen, solange die Spalte noch steht. "online" wird zu
    # "auto": die Automatik war bisher nur ein Teil des Verhaltens und soll ab
    # jetzt greifen; wer ausdruecklich unsichtbar oder abwesend war, behaelt es.
    if "status" in spalten:
        op.execute(
            "UPDATE user_presences SET manual_status = CASE "
            "WHEN status = 'invisible' THEN 'invisible' "
            "WHEN status = 'away' THEN 'away' "
            "ELSE 'auto' END"
        )

    for alt in ("status", "device_type", "custom_status", "activity_label", "activity_detail"):
        if alt in spalten:
            op.drop_column("user_presences", alt)


def downgrade() -> None:
    bind = op.get_bind()
    spalten = _columns(bind, "user_presences")

    if "status" not in spalten:
        op.add_column(
            "user_presences",
            sa.Column("status", sa.String(length=16), nullable=False, server_default="online"),
        )
    if "device_type" not in spalten:
        op.add_column(
            "user_presences",
            sa.Column("device_type", sa.String(length=16), nullable=False, server_default="web"),
        )
    if "custom_status" not in spalten:
        op.add_column("user_presences", sa.Column("custom_status", sa.String(length=128), nullable=True))
    if "activity_label" not in spalten:
        op.add_column("user_presences", sa.Column("activity_label", sa.String(length=128), nullable=True))
    if "activity_detail" not in spalten:
        op.add_column("user_presences", sa.Column("activity_detail", sa.String(length=128), nullable=True))

    op.execute(
        "UPDATE user_presences SET status = CASE "
        "WHEN manual_status = 'invisible' THEN 'invisible' "
        "WHEN manual_status = 'away' THEN 'away' "
        "ELSE 'online' END"
    )

    if "manual_status" in spalten:
        op.drop_column("user_presences", "manual_status")
    if "user_presence_sessions" in _tables(bind):
        op.drop_table("user_presence_sessions")
