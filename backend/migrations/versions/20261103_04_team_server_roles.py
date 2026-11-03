"""Teams: Serverrechte nach Rollen als ausdruecklicher Schalter.

Bisher schaltete die erste Rollen-Server-Grant-Zeile das ganze Team still auf
strenge Rollenpruefung um. Der Schalter macht diesen Modus sichtbar. Teams, die
heute schon Rollen-Grants haben, behalten ihr bisheriges Verhalten; alle
anderen starten im Modus "Team-Zuordnung gilt fuer alle".

Revision ID: 20261103_04
Revises: 20261103_03
Create Date: 2026-11-03
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261103_04"
down_revision: Union[str, None] = "20261103_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tabellen = _tables()
    if "teams" not in tabellen:
        return
    spalten = {spalte["name"] for spalte in sa.inspect(op.get_bind()).get_columns("teams")}
    if "server_roles_active" not in spalten:
        op.add_column(
            "teams",
            sa.Column(
                "server_roles_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if {"team_roles", "team_role_server_grants"} <= tabellen:
        # Bestehende Teams mit Rollen-Grants bleiben im strengen Modus.
        op.execute(
            sa.text(
                """
                UPDATE teams SET server_roles_active = true
                WHERE EXISTS (
                    SELECT 1
                    FROM team_roles tr
                    JOIN team_role_server_grants g ON g.role_id = tr.id
                    WHERE tr.team_id = teams.id
                )
                """
            )
        )


def downgrade() -> None:
    if "teams" not in _tables():
        return
    spalten = {spalte["name"] for spalte in sa.inspect(op.get_bind()).get_columns("teams")}
    if "server_roles_active" in spalten:
        op.drop_column("teams", "server_roles_active")
