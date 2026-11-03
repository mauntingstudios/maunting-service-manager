"""Team-Rollen und Tresor-Zugriffsberechtigung (can_access_vault).

Revision ID: 20261102_02
Revises: 20261102_01
Create Date: 2026-11-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261102_02"
down_revision: Union[str, None] = "20261102_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    # 1. team_roles Tabelle anlegen
    if "team_roles" not in tables:
        op.create_table(
            "team_roles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(length=32), nullable=False),
            sa.Column("color", sa.String(length=16), nullable=False, server_default="#3b82f6"),
            sa.Column("can_access_vault", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("can_manage_skills", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("can_manage_memory", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("team_id", "name", name="uq_team_roles_team_name"),
        )
    role_indexes = {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes("team_roles")
    }
    if "ix_team_roles_team_id" not in role_indexes:
        op.create_index("ix_team_roles_team_id", "team_roles", ["team_id"])

    # 2. team_members Spalten ergänzen
    if "team_members" in tables:
        columns = {column["name"] for column in inspector.get_columns("team_members")}
        if "can_access_vault" not in columns:
            op.add_column(
                "team_members",
                sa.Column(
                    "can_access_vault", sa.Boolean(), nullable=False, server_default=sa.true()
                ),
            )
        if "team_role_id" not in columns:
            op.add_column(
                "team_members",
                sa.Column(
                    "team_role_id",
                    sa.Integer(),
                    sa.ForeignKey("team_roles.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )

    # 3. team_invitations Spalten ergänzen
    if "team_invitations" in tables:
        columns = {
            column["name"] for column in inspector.get_columns("team_invitations")
        }
        if "can_access_vault" not in columns:
            op.add_column(
                "team_invitations",
                sa.Column(
                    "can_access_vault", sa.Boolean(), nullable=False, server_default=sa.true()
                ),
            )
        if "team_role_id" not in columns:
            op.add_column(
                "team_invitations",
                sa.Column(
                    "team_role_id",
                    sa.Integer(),
                    sa.ForeignKey("team_roles.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "team_invitations" in tables:
        columns = {
            column["name"] for column in inspector.get_columns("team_invitations")
        }
        if "team_role_id" in columns:
            op.drop_column("team_invitations", "team_role_id")
        if "can_access_vault" in columns:
            op.drop_column("team_invitations", "can_access_vault")

    if "team_members" in tables:
        columns = {column["name"] for column in inspector.get_columns("team_members")}
        if "team_role_id" in columns:
            op.drop_column("team_members", "team_role_id")
        if "can_access_vault" in columns:
            op.drop_column("team_members", "can_access_vault")

    if "team_roles" in tables:
        indexes = {
            index["name"] for index in sa.inspect(op.get_bind()).get_indexes("team_roles")
        }
        if "ix_team_roles_team_id" in indexes:
            op.drop_index("ix_team_roles_team_id", table_name="team_roles")
        op.drop_table("team_roles")
