"""Teams: gemeinsame Wissensbasis und gebuendelte Serverrechte.

Ein Team ist zweierlei:

1. Der Traeger von geteiltem KI-Wissen (Skills und Team-Memory). Genau dafuer
   existiert es ueberhaupt — zwei Mit-Administratoren desselben Servers sollen
   sich nicht zweimal dasselbe merken muessen.
2. Ein Buendel von Serverrechten, das der Gruender an seine Mitglieder
   weitergibt.

Der zweite Punkt ist der sicherheitskritische. Die Weitergabe ist **nach oben
gedeckelt**: ein Team kann nie mehr gewaehren, als sein Gruender selbst direkt
haelt. Durchgesetzt wird das nicht hier, sondern bei jeder einzelnen Pruefung in
`permission_service` — die Tabelle unten ist nur der Wunsch, nicht das Recht.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Team(Base):
    """Ein Team — entweder das persoenliche eines Benutzers oder ein echtes.

    ``personal_for_user_id`` traegt die Unterscheidung *und* die Eindeutigkeit:
    ist es gesetzt, handelt es sich um das Ein-Mann-Team dieses Benutzers, und
    die UNIQUE-Bedingung stellt sicher, dass es davon genau eines gibt. Ist es
    NULL, ist es ein echtes Team — und weil NULL-Werte in einer
    UNIQUE-Bedingung nicht kollidieren, darf derselbe
    Benutzer beliebig viele echte Teams gruenden.

    Ein separates `is_personal`-Flag waere die naheliegendere Loesung gewesen,
    haette aber zwei Wahrheiten fuer dieselbe Aussage geschaffen, die
    auseinanderlaufen koennen.
    """

    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("personal_for_user_id", name="uq_teams_personal_for_user"),
        Index("ix_teams_owner", "owner_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    # Der Gruender. Seine direkten Rechte sind die Obergrenze fuer alles, was
    # das Team weitergeben kann. Deshalb RESTRICT: verschwindet der Gruender,
    # verliert die Obergrenze ihren Bezugspunkt — das Team muss vorher
    # uebertragen oder geloescht werden.
    owner_user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    personal_for_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
    vault_bucket_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vault_salt: Mapped[str | None] = mapped_column(String(128), nullable=True)
    vault_needs_rotation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    vault_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    vault_last_hint_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Zwei-Phasen-Rotation: pending ist der Staging-Bucket, old der nach
    # Commit noch 7 Tage gehaltene Vorgaenger (Rollback-Fenster).
    vault_pending_bucket_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vault_pending_salt: Mapped[str | None] = mapped_column(String(128), nullable=True)
    vault_rotation_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    vault_old_bucket_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vault_old_salt: Mapped[str | None] = mapped_column(String(128), nullable=True)
    vault_rotation_cleanup_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    members: Mapped[list["TeamMember"]] = relationship(
        "TeamMember", back_populates="team", cascade="all, delete-orphan"
    )
    invitations: Mapped[list["TeamInvitation"]] = relationship(
        "TeamInvitation", back_populates="team", cascade="all, delete-orphan"
    )
    server_grants: Mapped[list["TeamServerGrant"]] = relationship(
        "TeamServerGrant", back_populates="team", cascade="all, delete-orphan"
    )
    roles: Mapped[list["TeamRole"]] = relationship(
        "TeamRole", back_populates="team", cascade="all, delete-orphan"
    )

    @property
    def is_personal(self) -> bool:
        return self.personal_for_user_id is not None


class TeamRole(Base):
    """Team-spezifische Rollen für feingranulare Berechtigungen.

    Steuert Tresor-Zugriff (can_access_vault), Skill- und Memory-Verwaltung.
    Standard-Rollen sind 'Admin' (alles an), 'Mitglied' (Tresor an), 'Gast' (alles aus).
    """

    __tablename__ = "team_roles"
    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_team_roles_team_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    color: Mapped[str] = mapped_column(String(16), default="#3b82f6", nullable=False)
    can_access_vault: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    can_manage_skills: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_manage_memory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    team: Mapped["Team"] = relationship("Team", back_populates="roles")
    members: Mapped[list["TeamMember"]] = relationship("TeamMember", back_populates="team_role")


class TeamMember(Base):
    """Mitgliedschaft mit Schaltern für Rechte und optionaler Team-Rolle.

    Serverrechte stehen bewusst **nicht** hier: die haengen am Team, nicht am
    einzelnen Mitglied. Wer im Team ist, bekommt die Server des Teams.
    """

    __tablename__ = "team_members"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'member')", name="ck_team_members_role"),
        UniqueConstraint("team_id", "user_id", name="uq_team_members_team_user"),
        Index("ix_team_members_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), default="member", nullable=False)
    # Darf Team-Skills anlegen und aendern — und erlaubt damit zugleich der KI,
    # im Namen dieses Mitglieds fuer das Team zu lernen.
    can_manage_skills: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_manage_memory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_access_vault: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    team_role_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("team_roles.id", ondelete="SET NULL"), nullable=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    added_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    team: Mapped["Team"] = relationship("Team", back_populates="members")
    team_role: Mapped["TeamRole | None"] = relationship("TeamRole", back_populates="members")


class TeamInvitation(Base):
    """Eine ausgesprochene, noch nicht angenommene Einladung.

    Sie steht bewusst in einer **eigenen Tabelle** und nicht als Zustand an
    `TeamMember`. Eine Mitgliedschaft oeffnet zwei Tueren auf einmal: die
    Serverrechte des Teams und das gemeinsame KI-Gedaechtnis. Beide fragt der
    Code an vielen Stellen ab — in `permission_service` mehrfach als direkter
    Join auf `team_members`, hier ueber `membership`. Ein Zustandsfeld an der
    Mitgliedschaft muesste an jeder dieser Stellen mitgeprueft werden, und die
    erste vergessene waere das Loch, das diese Tabelle schliessen soll. Ohne
    Zeile in `team_members` ist jede bestehende Abfrage ohne Zutun richtig.

    Die beiden Schalter stehen hier schon, weil sie Teil des Angebots sind: wer
    annimmt, soll wissen, was er annimmt. Beim Beitritt wandern sie
    unveraendert in die Mitgliedschaft.
    """

    __tablename__ = "team_invitations"
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_invitations_team_user"),
        # Der Eingeladene fragt "wer will mich haben" — das ist der Lesepfad.
        Index("ix_team_invitations_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    can_manage_skills: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_manage_memory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_access_vault: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    team_role_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("team_roles.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    invited_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    team: Mapped["Team"] = relationship("Team", back_populates="invitations")


class TeamServerGrant(Base):
    """Ein Recht, das das Team auf einem Server weitergeben *moechte*.

    Ausdruecklich ein Wunsch und keine Gewaehrung. Ob er wirkt, entscheidet
    `permission_service` bei jeder Pruefung neu, indem es nachsieht, ob der
    Gruender diesen Key auf diesem Server direkt haelt. Verliert er ihn, wird
    diese Zeile wirkungslos, ohne dass jemand aufraeumen muss.
    """

    __tablename__ = "team_server_grants"
    __table_args__ = (
        UniqueConstraint(
            "team_id", "server_id", "permission_key", name="uq_team_server_grants"
        ),
        # Die Rechtepruefung fragt genau diese Kombination ab.
        Index("ix_team_server_grants_lookup", "server_id", "permission_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    server_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )
    permission_key: Mapped[str] = mapped_column(String(64), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    granted_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    team: Mapped["Team"] = relationship("Team", back_populates="server_grants")
