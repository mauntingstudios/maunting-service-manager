"""Team-Medien (Avatar & Banner) sowie Abloesung der Legacy-Mitgliederschalter.

Revision ID: 20261118_01
Revises: 20261117_01
Create Date: 2026-11-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261118_01"
down_revision: Union[str, None] = "20261117_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_FLAG_TO_PERM = (
    ("can_access_vault", "vault.read"),
    ("can_manage_skills", "ai.skills.manage"),
    ("can_manage_memory", "ai.memory.write"),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "team_media" not in tables:
        op.create_table(
            "team_media",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(length=16), nullable=False),
            sa.Column("file_name", sa.String(length=128), nullable=False),
            sa.Column(
                "uploaded_by",
                sa.String(length=128),
                nullable=False,
                server_default="system",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.CheckConstraint("kind IN ('avatar', 'banner')", name="ck_team_media_kind"),
        )
        op.create_index("ix_team_media_team_id", "team_media", ["team_id"])
        op.create_index(
            "ix_team_media_scope_active",
            "team_media",
            ["team_id", "kind", "is_active"],
        )

    if "teams" in tables:
        team_cols = {c["name"] for c in inspector.get_columns("teams")}
        if "category" not in team_cols:
            op.add_column("teams", sa.Column("category", sa.String(length=32), nullable=True))
        if "description" not in team_cols:
            op.add_column("teams", sa.Column("description", sa.String(length=500), nullable=True))
        if "avatar_preset" not in team_cols:
            op.add_column("teams", sa.Column("avatar_preset", sa.String(length=64), nullable=True))
        if "banner_preset" not in team_cols:
            op.add_column("teams", sa.Column("banner_preset", sa.String(length=64), nullable=True))

    # Backfill vor dem Entfernen der Schalter-Spalten:
    # 1. Rollen-Flags -> team_role_permissions
    if {"team_roles", "team_role_permissions"} <= tables:
        role_cols = {c["name"] for c in inspector.get_columns("team_roles")}
        for flag_col, perm_key in _FLAG_TO_PERM:
            if flag_col in role_cols:
                op.execute(
                    sa.text(
                        f"INSERT INTO team_role_permissions (role_id, permission_key) "
                        f"SELECT tr.id, :perm FROM team_roles tr "
                        f"WHERE tr.{flag_col} IS TRUE "
                        f"AND NOT EXISTS ("
                        f"  SELECT 1 FROM team_role_permissions trp "
                        f"  WHERE trp.role_id = tr.id AND trp.permission_key = :perm"
                        f")"
                    ).bindparams(perm=perm_key)
                )

    # 2. Rollenlosen Nicht-Gruendern die Standardrolle ihres Teams zuweisen
    if {"team_members", "team_roles", "team_member_roles"} <= tables:
        op.execute(
            sa.text(
                "UPDATE team_members "
                "SET team_role_id = ("
                "  SELECT tr.id FROM team_roles tr "
                "  WHERE tr.team_id = team_members.team_id AND tr.is_default IS TRUE "
                "  LIMIT 1"
                ") "
                "WHERE role = 'member' AND team_role_id IS NULL "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM team_member_roles tmr WHERE tmr.team_member_id = team_members.id"
                ")"
            )
        )
        op.execute(
            sa.text(
                "INSERT INTO team_member_roles (team_member_id, team_role_id, assigned_at) "
                "SELECT tm.id, tm.team_role_id, NOW() FROM team_members tm "
                "WHERE tm.team_role_id IS NOT NULL "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM team_member_roles tmr "
                "  WHERE tmr.team_member_id = tm.id AND tmr.team_role_id = tm.team_role_id"
                ")"
            )
        )

    for table_name in ("team_roles", "team_members", "team_invitations"):
        if table_name not in tables:
            continue
        existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
        to_drop = [
            col
            for col in ("can_access_vault", "can_manage_skills", "can_manage_memory")
            if col in existing_cols
        ]
        if to_drop:
            with op.batch_alter_table(table_name) as batch_op:
                for col in to_drop:
                    batch_op.drop_column(col)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    for table_name, defaults in (
        (
            "team_invitations",
            (("can_manage_skills", False), ("can_manage_memory", False), ("can_access_vault", True)),
        ),
        (
            "team_members",
            (("can_manage_skills", False), ("can_manage_memory", False), ("can_access_vault", True)),
        ),
        (
            "team_roles",
            (("can_access_vault", True), ("can_manage_skills", False), ("can_manage_memory", False)),
        ),
    ):
        if table_name not in tables:
            continue
        existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
        for col_name, default_val in defaults:
            if col_name not in existing_cols:
                op.add_column(
                    table_name,
                    sa.Column(
                        col_name,
                        sa.Boolean(),
                        nullable=False,
                        server_default=sa.true() if default_val else sa.false(),
                    ),
                )

    if "teams" in tables:
        team_cols = {c["name"] for c in inspector.get_columns("teams")}
        with op.batch_alter_table("teams") as batch_op:
            for col in ("banner_preset", "avatar_preset", "description", "category"):
                if col in team_cols:
                    batch_op.drop_column(col)

    if "team_media" in tables:
        op.drop_index("ix_team_media_scope_active", table_name="team_media")
        op.drop_index("ix_team_media_team_id", table_name="team_media")
        op.drop_table("team_media")
