"""Team-Schalter aus den Rollen neu berechnen (Befund 15).

Revision ID: 20261103_01
Revises: 20261103_02
Create Date: 2026-11-03

Bislang hoben Rollenzuteilungen die drei Mitgliedsschalter nur an, nie senkten
sie sie: wer eine Rolle verlor, behielt den Tresor. Ab sofort rechnet der
Dienst die Schalter bei jeder Zuteilung neu; diese Migration zieht den Bestand
einmal nach — nur Mitglieder mit Rollen, als ODER ueber alle zugewiesenen
Rollen (Mehrfach- plus Legacy-Einzelrolle). Idempotent: wiederholtes Laufen
schreibt dieselben Werte. Downgrade ist no-op (Schalter sind abgeleitet).

Betreiber-Hinweis: Schalter, die ueber Einladung oder Zustimmung ueber die
Rollen hinaus angehoben wurden, fallen dabei auf das Rollen-ODER zurueck.
Wer solche Gewaehrungen behalten will, hinterlegt vorher Rollen, die sie
tragen — oder vergibt sie nach dem Update erneut ueber die Rollen.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20261103_01"
# Nach 20261103_02 (Welle 2a): ein Head je Wellen-Commit. Die Nummer ist ein
# Name, die Kette folgt down_revision.
down_revision: Union[str, None] = "20261103_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_AUS_ROLLEN = """
SELECT 1 FROM team_member_roles mr
JOIN team_roles r ON r.id = mr.team_role_id
WHERE mr.team_member_id = m.id AND r.{flag}
""".strip()


def _flag_sql(flag: str) -> str:
    return (
        f"EXISTS ({_AUS_ROLLEN.format(flag=flag)}) "
        f"OR EXISTS (SELECT 1 FROM team_roles r "
        f"WHERE r.id = m.team_role_id AND r.{flag})"
    )


def upgrade() -> None:
    op.execute(
        "UPDATE team_members m SET "
        "can_access_vault = (" + _flag_sql("can_access_vault") + "), "
        "can_manage_skills = (" + _flag_sql("can_manage_skills") + "), "
        "can_manage_memory = (" + _flag_sql("can_manage_memory") + ") "
        "WHERE EXISTS (SELECT 1 FROM team_member_roles mr "
        "WHERE mr.team_member_id = m.id) "
        "OR m.team_role_id IS NOT NULL"
    )


def downgrade() -> None:
    pass
