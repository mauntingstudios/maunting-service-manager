"""Teams anlegen, besetzen und mit Servern verbinden.

Die Rechtepruefung selbst steht bewusst nicht hier, sondern in
`permission_service`. Dieser Dienst schreibt nur den *Wunsch* des Gruenders;
ob er wirkt, entscheidet die Pruefung bei jedem Zugriff neu. Beides zu trennen
ist der Grund, warum ein entzogenes Recht nicht nachgepflegt werden muss.

Die eine Zusage, die dieser Dienst selbst traegt: **eine Mitgliedschaft
entsteht nie ohne den Betroffenen — und sie waechst auch nicht ohne ihn.** Der
Gruender laedt ein, beitreten muss der Eingeladene; was ein Mitglied am
gemeinsamen Wissen darf, nimmt der Gruender jederzeit allein zurueck, erweitern
kann er es nur mit dessen Zustimmung — siehe `invite_member`, `update_member`
und `accept_invitation`. Gehen darf der Eingeladene jederzeit allein.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    Server,
    Team,
    TeamInvitation,
    TeamMember,
    TeamMemberRole,
    TeamRole,
    TeamRolePermission,
    TeamRoleServerGrant,
    TeamServerGrant,
    TeamVaultKey,
    User,
)
from services import audit_service, permission_service
from services.permission_catalog import SERVER_KEYS, TEAM_KEYS, is_team_key


MAX_TEAMS_PER_OWNER = 20
MAX_MEMBERS_PER_TEAM = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


def personal_team(db: Session, user: User) -> Team:
    """Das Ein-Mann-Team des Benutzers, bei Bedarf angelegt.

    Es entsteht erst, wenn es gebraucht wird — nicht bei der Registrierung.
    Damit bekommt kein Bestandsbenutzer eine Migration, die Zeilen fuer Konten
    anlegt, die die KI nie benutzen werden.

    Der Zweck ist ein sprachlicher und zugleich ein struktureller: Skills gibt
    es ausschliesslich teambezogen. Ohne dieses Team haette ein Benutzer ohne
    Kollegen keinen Ort, an dem die KI etwas lernen koennte.
    """
    existing = db.query(Team).filter(Team.personal_for_user_id == user.id).first()
    if existing is not None:
        return existing

    team = Team(
        name=user.username,
        owner_user_id=user.id,
        personal_for_user_id=user.id,
    )
    db.add(team)
    try:
        db.flush()
    except IntegrityError:
        # Zwei gleichzeitige Anfragen desselben Benutzers. Die UNIQUE-Bedingung
        # auf `personal_for_user_id` hat den Verlierer abgewiesen — das Team des
        # Gewinners ist genauso gut.
        db.rollback()
        found = db.query(Team).filter(Team.personal_for_user_id == user.id).first()
        if found is None:
            raise
        return found

    db.add(TeamMember(
        team_id=team.id, user_id=user.id, role="owner",
        can_manage_skills=True, can_manage_memory=True, added_by=user.id,
    ))
    db.flush()
    return team


def user_team_ids(db: Session, user: User) -> list[int]:
    """Alle Teams, in denen der Benutzer Mitglied ist — persoenliche und echte.

    Grundlage fuer das Lesen von Team-Wissen. Bewusst ohne das persoenliche
    Team automatisch anzulegen: Lesen darf nichts schreiben, sonst erzeugt eine
    einzige Chatanfrage ohne Zutun des Benutzers eine Zeile.
    """
    rows = db.query(TeamMember.team_id).filter(TeamMember.user_id == user.id).all()
    return [row[0] for row in rows]


def list_user_teams(db: Session, user: User) -> list[Team]:
    ids = user_team_ids(db, user)
    if not ids:
        return []
    return db.query(Team).filter(Team.id.in_(ids)).order_by(Team.name).all()


def membership(db: Session, team_id: int, user_id: int) -> TeamMember | None:
    return (
        db.query(TeamMember)
        .filter(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
        .first()
    )


def get_team_for_member(db: Session, team_id: int, user: User) -> Team:
    """Laedt ein Team, das der Benutzer sehen darf.

    Ein Nichtmitglied bekommt 404 statt 403: ob es ein Team mit dieser Nummer
    ueberhaupt gibt, geht ihn nichts an.
    """
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if membership(db, team_id, user.id) is None and not user.is_owner:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    return team


def assert_team_owner(db: Session, team: Team, user: User) -> None:
    if user.is_owner:
        return
    member = membership(db, team.id, user.id)
    if member is None or member.role != "owner":
        raise HTTPException(status_code=403, detail="Nur der Teamgruender darf das")


def get_member_role_ids(db: Session, member_id: int, fallback_role_id: int | None = None) -> list[int]:
    """Alle zugewiesenen Rollen-IDs eines Team-Mitglieds."""
    rows = (
        db.query(TeamMemberRole.team_role_id)
        .filter(TeamMemberRole.team_member_id == member_id)
        .all()
    )
    role_ids = {row[0] for row in rows}
    if fallback_role_id is not None:
        role_ids.add(fallback_role_id)
    return sorted(role_ids)


def _mitglied_flags_neu(db: Session, member: TeamMember) -> None:
    """Rechnet die drei Mitgliedsschalter aus allen zugewiesenen Rollen neu.

    ODER ueber Mehrfach- plus Legacy-Rolle; ohne Rollen bleiben die Altflags
    (Legacy-Mitglieder ausserhalb des Rollenmodells). Senken ist Absicht:
    wer die Rolle verliert, verliert den Schalter (Befund 15). Committet nicht.

    Der Zustimmungs-Tanz in `update_member` bleibt daneben bestehen: Er regelt
    direkte Schalterwuensche ohne Rolle. Wer eine Rolle (um-)verteilt, regiert
    sofort — auch erhoehend; das ist kein Tanz, sondern Rollenverwaltung.
    """
    rollen_ids = get_member_role_ids(db, member.id, member.team_role_id)
    if not rollen_ids:
        return
    rollen = db.query(TeamRole).filter(TeamRole.id.in_(rollen_ids)).all()
    member.can_access_vault = any(r.can_access_vault for r in rollen)
    member.can_manage_skills = any(r.can_manage_skills for r in rollen)
    member.can_manage_memory = any(r.can_manage_memory for r in rollen)


def _rollen_traeger(db: Session, team_id: int, role_id: int) -> list[TeamMember]:
    """Alle Mitglieder, die diese Rolle halten — mehrfach oder als Legacy."""
    return (
        db.query(TeamMember)
        .filter(
            TeamMember.team_id == team_id,
            or_(
                TeamMember.team_role_id == role_id,
                TeamMember.id.in_(
                    select(TeamMemberRole.team_member_id).where(
                        TeamMemberRole.team_role_id == role_id
                    )
                ),
            ),
        )
        .all()
    )


def has_team_permission(db: Session, team_id: int, user: User, permission_key: str) -> bool:
    """Prüft, ob der Benutzer im Team dieses Recht hält (Owner, Rolle oder Legacy-Schalter)."""
    if user.is_owner:
        return True
    member = membership(db, team_id, user.id)
    if member is None:
        return False
    if member.role == "owner":
        return True

    role_ids = get_member_role_ids(db, member.id, member.team_role_id)
    if role_ids:
        roles = db.query(TeamRole).filter(TeamRole.id.in_(role_ids)).all()
        for role in roles:
            if role.is_admin:
                return True
        has_perm = (
            db.query(TeamRolePermission.id)
            .filter(
                TeamRolePermission.role_id.in_(role_ids),
                TeamRolePermission.permission_key == permission_key,
            )
            .first()
        )
        if has_perm is not None:
            return True

    # Fallback auf Legacy-Schalter an TeamMember
    if permission_key in ("ai.skills.manage",) and member.can_manage_skills:
        return True
    if permission_key in ("ai.memory.write",) and member.can_manage_memory:
        return True
    if permission_key in ("vault.read", "vault.write") and member.can_access_vault:
        return True

    return False


def assert_team_permission(db: Session, team: Team, user: User, permission_key: str) -> None:
    if not has_team_permission(db, team.id, user, permission_key):
        raise HTTPException(status_code=403, detail="Keine Berechtigung im Team")


def _ist_team_gruender(team: Team, user: User) -> bool:
    """Ob der Benutzer im Team alles darf: globaler Owner oder Teamgruender."""
    return bool(user.is_owner or team.owner_user_id == user.id)


def _admin_nur_gruender() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "code": "TEAM_ROLE_ADMIN_OWNER_ONLY",
            "message": "Nur der Teamgründer darf eine Admin-Rolle anlegen, ändern oder zuteilen.",
        },
    )


def _pruefe_rollen_deckel(
    db: Session, team: Team, user: User, *,
    is_admin: bool,
    permission_keys: list[str] | None,
    flags: dict[str, bool],
    server_grants: list[dict] | None = None,
) -> None:
    """Der Deckel: wer nicht Gruender ist, vergibt nur, was er selbst haelt.

    Bis 11/2026 legte jeder mit `team.roles.manage` Admin-Rollen an und teilte
    sie zu — samt Rechten und Schaltern, die er selbst nicht hatte. Jetzt gilt:
    `is_admin` nur durch den Gruender, jedes Recht nur gehalten
    (`has_team_permission`), jeder Schalter nur getragen (Mitgliedszeile) und
    jedes Serverrecht nur selbst gehalten (`direct_server_permission`, ohne
    Teams). Der Gruender bleibt unbeschraenkt.
    """
    if _ist_team_gruender(team, user):
        return
    if is_admin:
        raise _admin_nur_gruender()
    for key in permission_keys or []:
        if is_team_key(key) and not has_team_permission(db, team.id, user, key):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "TEAM_ROLE_GRANT_DENIED",
                    "message": f'Das Recht "{key}" hältst du im Team nicht und kannst es nicht vergeben.',
                },
            )
    eigen = membership(db, team.id, user.id)
    getragen = {
        "can_access_vault": bool(eigen is not None and eigen.can_access_vault),
        "can_manage_skills": bool(eigen is not None and eigen.can_manage_skills),
        "can_manage_memory": bool(eigen is not None and eigen.can_manage_memory),
    }
    for name, gesetzt in flags.items():
        if gesetzt and not getragen.get(name, False):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "TEAM_ROLE_GRANT_DENIED",
                    "message": "Diesen Teamschalter trägst du selbst nicht und kannst ihn nicht vergeben.",
                },
            )
    from services.permission_catalog import SERVER_KEYS

    for grant in server_grants or []:
        server_id = int(grant.get("server_id") or 0)
        for key in grant.get("permission_keys") or []:
            if key not in SERVER_KEYS:
                continue
            if not permission_service.direct_server_permission(db, user, server_id, key):
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "TEAM_ROLE_GRANT_DENIED",
                        "message": f'Das Serverrecht "{key}" hältst du nicht selbst und kannst es nicht vergeben.',
                    },
                )


def _pruefe_server_grant_sicht(
    db: Session, team: Team, server_grants: list[dict] | None
) -> None:
    """Serverrechte einer Rolle brauchen Sicht und die Grundlage des Gruenders.

    Dieselben Regeln wie in `set_server_grants`: ohne `server.view` ergeben
    weitere Serverrechte keinen Sinn, und niemand vergibt ein Recht, das der
    Teamgruender nicht selbst direkt haelt. Damit entstehen keine ruhenden
    Zeilen, die erst lebendig werden, wenn der Gruender spaeter ein Recht
    erhaelt. Bestehende Rollen werden bei der Zuteilung nicht nachtraeglich
    abgewiesen.
    """
    from services.permission_catalog import SERVER_KEYS

    if not server_grants:
        return
    founder = db.get(User, team.owner_user_id)
    if founder is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "TEAM_ROLE_GRANT_DENIED",
                "message": "Der Teamgründer ist nicht mehr vorhanden.",
            },
        )
    for grant in server_grants:
        server_id = int(grant.get("server_id") or 0)
        keys = {key for key in grant.get("permission_keys") or [] if key in SERVER_KEYS}
        if not keys:
            continue
        if "server.view" not in keys:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "TEAM_ROLE_GRANT_DENIED",
                    "message": 'Ohne "server.view" ergeben die uebrigen Serverrechte keinen Sinn.',
                },
            )
        for key in sorted(keys):
            if not permission_service.direct_server_permission(db, founder, server_id, key):
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "TEAM_ROLE_GRANT_DENIED",
                        "message": (
                            f'Der Teamgründer hält "{key}" auf diesem Server nicht '
                            "selbst und kann es deshalb nicht weitergeben."
                        ),
                    },
                )


def _pruefe_rollenzuteilung(db: Session, team: Team, user: User, rollen: list[TeamRole]) -> None:
    """Der Deckel fuer die Zuteilung bestehender Rollen: jede Rolle zaehlt wie neu angelegt."""
    if _ist_team_gruender(team, user):
        return
    rollen_ids = [rolle.id for rolle in rollen]
    if not rollen_ids:
        return
    keys_je_rolle: dict[int, list[str]] = {role_id: [] for role_id in rollen_ids}
    for role_id, key in (
        db.query(TeamRolePermission.role_id, TeamRolePermission.permission_key)
        .filter(TeamRolePermission.role_id.in_(rollen_ids))
        .all()
    ):
        keys_je_rolle[role_id].append(key)
    grants_je_rolle: dict[int, dict[int, list[str]]] = {
        role_id: {} for role_id in rollen_ids
    }
    for role_id, server_id, key in (
        db.query(
            TeamRoleServerGrant.role_id,
            TeamRoleServerGrant.server_id,
            TeamRoleServerGrant.permission_key,
        )
        .filter(TeamRoleServerGrant.role_id.in_(rollen_ids))
        .all()
    ):
        grants_je_rolle[role_id].setdefault(server_id, []).append(key)

    for rolle in rollen:
        _pruefe_rollen_deckel(
            db, team, user,
            is_admin=rolle.is_admin,
            permission_keys=keys_je_rolle[rolle.id],
            flags={
                "can_access_vault": rolle.can_access_vault,
                "can_manage_skills": rolle.can_manage_skills,
                "can_manage_memory": rolle.can_manage_memory,
            },
            server_grants=[
                {"server_id": server_id, "permission_keys": keys}
                for server_id, keys in grants_je_rolle[rolle.id].items()
            ],
        )


def _rolle_im_team(db: Session, team: Team, team_role_id: int) -> TeamRole:
    """Die Rolle muss zum Team gehoeren — sonst 422 statt stiller Fremdrolle."""
    rolle = db.get(TeamRole, team_role_id)
    if rolle is None or rolle.team_id != team.id:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "TEAM_ROLE_NOT_IN_TEAM",
                "message": "Diese Rolle gehört nicht zu diesem Team.",
            },
        )
    return rolle


def ensure_default_team_roles(
    db: Session, team: Team, founder_member: TeamMember | None = None
) -> list[TeamRole]:
    """Stellt sicher, dass das Team die Standardrollen Admin, Mitglied und Gast besitzt."""
    existing = db.query(TeamRole).filter(TeamRole.team_id == team.id).all()
    if existing:
        return existing

    # 1. Admin
    admin_role = TeamRole(
        team_id=team.id,
        name="Admin",
        description="Voller Zugriff auf alle Funktionen des Teams",
        color="#ef4444",
        icon="crown",
        can_access_vault=True,
        can_manage_skills=True,
        can_manage_memory=True,
        is_default=False,
        is_admin=True,
    )
    db.add(admin_role)
    db.flush()
    for key in TEAM_KEYS:
        db.add(TeamRolePermission(role_id=admin_role.id, permission_key=key))

    # 2. Mitglied
    member_role = TeamRole(
        team_id=team.id,
        name="Mitglied",
        description="Standardrolle für neue Teammitglieder",
        color="#10b981",
        icon="user-check",
        can_access_vault=True,
        can_manage_skills=False,
        can_manage_memory=False,
        is_default=True,
        is_admin=False,
    )
    db.add(member_role)
    db.flush()
    for key in ("vault.read", "vault.write", "ai.memory.read", "ai.skills.use", "ai.team_context.use"):
        db.add(TeamRolePermission(role_id=member_role.id, permission_key=key))

    # 3. Gast
    guest_role = TeamRole(
        team_id=team.id,
        name="Gast",
        description="Eingeschränkter Lesezugriff",
        color="#64748b",
        icon="eye",
        can_access_vault=True,
        can_manage_skills=False,
        can_manage_memory=False,
        is_default=False,
        is_admin=False,
    )
    db.add(guest_role)
    db.flush()
    for key in ("vault.read", "ai.memory.read"):
        db.add(TeamRolePermission(role_id=guest_role.id, permission_key=key))

    # Wenn Gründer-Mitglied übergeben wurde, Admin-Rolle zuweisen
    if founder_member is not None:
        founder_member.team_role_id = admin_role.id
        db.add(TeamMemberRole(team_member_id=founder_member.id, team_role_id=admin_role.id))
        db.flush()

    return [admin_role, member_role, guest_role]


def _assert_name_is_free(
    db: Session, *, owner_user_id: int, name: str, team_id: int | None = None
) -> None:
    """Ein Gruender fuehrt keine zwei echten Teams desselben Namens.

    Das ist keine Ordnungsliebe, sondern die Voraussetzung dafuer, dass
    `learning_team` ein Team ueber seinen Namen ansprechen kann: sind zwei
    Kandidaten namensgleich, nennt die Rueckfrage zur Unterscheidung den
    Gruender — und der unterscheidet nur, wenn er innerhalb seiner eigenen
    Teams eindeutig ist.

    Ueber alle Gruender hinweg duerfen Namen sich dagegen wiederholen: eine
    Absage "Name schon vergeben" wuerde verraten, dass es irgendwo ein Team
    dieses Namens gibt.
    """
    gesucht = name.casefold()
    rows = (
        db.query(Team.id, Team.name)
        .filter(
            Team.owner_user_id == owner_user_id,
            Team.personal_for_user_id.is_(None),
        )
        .all()
    )
    for row_id, row_name in rows:
        if row_id != team_id and row_name.casefold() == gesucht:
            raise HTTPException(
                status_code=409, detail="Du hast bereits ein Team mit diesem Namen"
            )


def create_team(db: Session, *, user: User, name: str) -> Team:
    """Legt ein echtes Team an. Der Gruender ist automatisch Mitglied.

    Er bekommt beide Schalter: wer ein Team gruendet, soll dessen Wissen auch
    pflegen koennen, ohne sich das erst selbst zu erlauben.
    """
    if not permission_service.has_global_permission(db, user, "teams.create"):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    safe_name = name.strip()
    if not 2 <= len(safe_name) <= 64:
        raise HTTPException(status_code=422, detail="Teamname ist ungueltig")
    _assert_name_is_free(db, owner_user_id=user.id, name=safe_name)

    owned = (
        db.query(Team)
        .filter(Team.owner_user_id == user.id, Team.personal_for_user_id.is_(None))
        .count()
    )
    if owned >= MAX_TEAMS_PER_OWNER:
        raise HTTPException(status_code=409, detail="Zu viele Teams")

    team = Team(name=safe_name, owner_user_id=user.id, personal_for_user_id=None)
    db.add(team)
    db.flush()
    founder_member = TeamMember(
        team_id=team.id, user_id=user.id, role="owner",
        can_manage_skills=True, can_manage_memory=True, added_by=user.id,
    )
    db.add(founder_member)
    db.flush()
    ensure_default_team_roles(db, team=team, founder_member=founder_member)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.created", target_type="team",
        target_id=team.id, details={"name": safe_name}, origin="direct",
    )
    db.commit()
    db.refresh(team)
    return team


def rename_team(db: Session, *, team: Team, user: User, name: str) -> Team:
    assert_team_owner(db, team, user)
    if team.is_personal:
        raise HTTPException(status_code=409, detail="Das persoenliche Team bleibt wie es ist")
    safe_name = name.strip()
    if not 2 <= len(safe_name) <= 64:
        raise HTTPException(status_code=422, detail="Teamname ist ungueltig")
    _assert_name_is_free(
        db, owner_user_id=team.owner_user_id, name=safe_name, team_id=team.id
    )
    team.name = safe_name
    team.updated_at = _now()
    db.commit()
    db.refresh(team)
    return team


def set_server_roles_active(
    db: Session, *, team: Team, user: User, active: bool
) -> Team:
    """Schaltet die rollenbezogenen Serverrechte eines Teams um.

    Aus: die Team-Zuordnung gilt fuer alle Mitglieder. An: nur ausdrueckliche
    Rollen-Grants zaehlen. Nur der Gruender entscheidet; bestehende Grants
    bleiben beim Ausschalten erhalten und gelten beim erneuten Einschalten
    wieder.
    """
    assert_team_owner(db, team, user)
    if team.is_personal:
        raise HTTPException(status_code=409, detail="Das persoenliche Team kennt keine Rollen")
    aktiv = bool(active)
    if team.server_roles_active == aktiv:
        return team
    team.server_roles_active = aktiv
    team.updated_at = _now()
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="team.server_roles.set",
        target_type="team",
        target_id=team.id,
        details={"active": aktiv},
        origin="direct",
    )
    db.commit()
    db.refresh(team)
    return team


def delete_team(db: Session, *, team: Team, user: User) -> None:
    assert_team_owner(db, team, user)
    if team.is_personal:
        # Ohne persoenliches Team haette das Lernen keinen Ort mehr. Es ist
        # kein Besitz, den man aufgeben kann, sondern Teil des Kontos.
        raise HTTPException(status_code=409, detail="Das persoenliche Team bleibt bestehen")
    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.deleted", target_type="team",
        target_id=team.id, details={"name": team.name}, origin="direct",
    )
    # Offene Dokumente best effort trennen, bevor die Kaskade den Zustand
    # loescht. Der Sidecar haelt nur im RAM; ein Store nach dem Loeschen
    # scheitert am Backend und wuerde die Verbindung ohnehin beenden.
    try:
        from models.doc import Document
        from services.docs_collab_service import DocsCollabService

        for (doc_uid,) in db.query(Document.doc_uid).filter(Document.team_id == team.id):
            DocsCollabService.disconnect_doc(doc_uid)
    except Exception:
        pass
    db.delete(team)
    db.commit()


def invitation(db: Session, team_id: int, user_id: int) -> TeamInvitation | None:
    return (
        db.query(TeamInvitation)
        .filter(TeamInvitation.team_id == team_id, TeamInvitation.user_id == user_id)
        .first()
    )


def open_invitations(db: Session, user: User) -> list[TeamInvitation]:
    """Die Einladungen, ueber die dieser Benutzer noch entscheiden muss."""
    return (
        db.query(TeamInvitation)
        .filter(TeamInvitation.user_id == user.id)
        .order_by(TeamInvitation.created_at)
        .all()
    )


def team_invitations(db: Session, team_id: int) -> list[TeamInvitation]:
    return (
        db.query(TeamInvitation)
        .filter(TeamInvitation.team_id == team_id)
        .order_by(TeamInvitation.created_at)
        .all()
    )


def invite_member(
    db: Session, *, team: Team, user: User, new_user_id: int,
    can_manage_skills: bool, can_manage_memory: bool,
    can_access_vault: bool = True, team_role_id: int | None = None,
) -> TeamInvitation:
    """Spricht eine Einladung aus — und macht noch **niemanden** zum Mitglied.

    Vorher trug diese Funktion den Benutzer direkt ein. Damit konnte jeder mit
    `teams.create` einen beliebigen anderen still in sein Team ziehen, und das
    oeffnete mehr als eine Mitgliederliste: das Team-Wissen des Gruenders
    fliesst ab diesem Moment in jeden KI-Lauf des Hinzugefuegten, und was
    dessen KI fuers Team lernt — die Anweisung dazu steht im Systemprompt —
    landet im Team des Fremden und ist dort im Klartext lesbar. Wer jemanden
    hineinzieht, liest also mit und schreibt mit.

    Die Entscheidung darueber gehoert dem, dessen Daten sie oeffnet. Deshalb
    entsteht hier nur eine Zeile in `team_invitations`; die Mitgliedschaft legt
    `accept_invitation` an. Die KI verliert dadurch nichts: sie liest und
    schreibt weiterhin in jedes Team, dem ihr Benutzer wirklich angehoert.

    Eine bereits offene Einladung wird ueberschrieben statt abgelehnt: nur so
    kann der Gruender ein zu grosszuegiges Angebot zuruecknehmen, ohne dass es
    dafuer einen eigenen Weg braucht.
    """
    if not has_team_permission(db, team.id, user, "team.members.invite"):
        assert_team_owner(db, team, user)
    if team.is_personal:
        # Das persoenliche Team ist per Definition eines. Wer teilen will,
        # gruendet ein echtes — sonst waere "persoenlich" nur noch ein Name.
        raise HTTPException(status_code=409, detail="Das persoenliche Team bleibt allein")
    target = db.get(User, new_user_id)
    if target is None or not target.is_active:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    if membership(db, team.id, new_user_id) is not None:
        raise HTTPException(status_code=409, detail="Benutzer ist bereits im Team")

    # Eine Rolle aus einem fremden Team landet nie auf der Einladung.
    ausdrueckliche_rolle = (
        _rolle_im_team(db, team, team_role_id) if team_role_id is not None else None
    )
    if team_role_id is None and not team.is_personal:
        default_role = db.query(TeamRole.id).filter(TeamRole.team_id == team.id, TeamRole.is_default.is_(True)).first()
        if default_role is not None:
            team_role_id = default_role[0]

    # Der Deckel gilt der ausdruecklichen Rollenwahl. Die automatisch
    # eingesetzte Standardrolle ist kein Vergabewille des Einladenden; sie ist
    # die vom Gruender festgelegte Rolle (dieselbe Ausnahme wie in
    # `accept_invitation`).
    if ausdrueckliche_rolle is not None:
        _pruefe_rollenzuteilung(db, team, user, [ausdrueckliche_rolle])

    offen = invitation(db, team.id, new_user_id)
    if offen is None:
        # Offene Einladungen zaehlen mit: sonst griffe die Obergrenze erst beim
        # Beitritt, und ein Team koennte beliebig viele Menschen gleichzeitig
        # anschreiben.
        belegt = (
            db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
            + db.query(TeamInvitation).filter(TeamInvitation.team_id == team.id).count()
        )
        if belegt >= MAX_MEMBERS_PER_TEAM:
            raise HTTPException(status_code=409, detail="Team ist voll")
        offen = TeamInvitation(team_id=team.id, user_id=new_user_id)
        db.add(offen)

    offen.can_manage_skills = can_manage_skills
    offen.can_manage_memory = can_manage_memory
    offen.can_access_vault = can_access_vault
    offen.team_role_id = team_role_id
    offen.invited_by = user.id
    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.member.invited", target_type="team",
        target_id=team.id,
        details={"member_user_id": new_user_id}, origin="direct",
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # Zwei gleichzeitige Einladungen an denselben Benutzer.
        db.rollback()
        raise HTTPException(status_code=409, detail="Einladung besteht bereits") from exc
    db.refresh(offen)
    return offen


def accept_invitation(db: Session, *, user: User, team_id: int) -> TeamMember:
    """Der Eingeladene nimmt an — beitretend oder aufsteigend.

    Die beiden Schalter kommen aus der Einladung und nicht aus dem Aufruf: was
    angenommen wird, muss dasselbe sein, was angeboten wurde.

    Ist der Annehmende schon Mitglied, war die Einladung ein Angebot aus
    `update_member`: der Gruender wollte einen Schalter anheben, und genau das
    kann nur der Betroffene selbst. Dann entsteht keine zweite Zeile — die
    vorhandene traegt danach, was angeboten wurde.
    """
    einladung = invitation(db, team_id, user.id)
    if einladung is None:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    team = db.get(Team, team_id)
    if team is None:
        # Das Team ist zwischen Einladung und Annahme verschwunden. Die Zeile
        # kann nur ohne Fremdschluesselpruefung ueberlebt haben; sie soll den
        # Benutzer nicht weiter behelligen.
        db.delete(einladung)
        db.commit()
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")

    # Die Rolle auf der Einladung gilt erst nach erneuter Pruefung: sie muss
    # noch da sein und zum Team gehoeren — und eine Admin-Rolle traegt nur eine
    # Einladung vom Gruender (Einladungen von vor dem Deckel eingeschlossen;
    # ein Erstellerfeld hat die Rolle nicht, der Einlader steht auf der Einladung).
    if einladung.team_role_id is not None:
        rolle = _rolle_im_team(db, team, einladung.team_role_id)
        if rolle.is_admin:
            einlader = db.get(User, einladung.invited_by) if einladung.invited_by else None
            if einlader is None or not _ist_team_gruender(team, einlader):
                raise _admin_nur_gruender()

    bestehend = membership(db, team_id, user.id)
    if bestehend is not None:
        bestehend.can_manage_skills = einladung.can_manage_skills
        bestehend.can_manage_memory = einladung.can_manage_memory
        bestehend.can_access_vault = einladung.can_access_vault
        if einladung.team_role_id is not None:
            # Das Angebot trug eine Rolle: Sie regiert wie in set_member_roles —
            # auch senkend (Befund 15). Reine Schalterangebote ohne Rolle
            # bleiben Wort: angenommen wird genau das Angebot.
            bestehend.team_role_id = einladung.team_role_id
            exists = db.query(TeamMemberRole.id).filter(
                TeamMemberRole.team_member_id == bestehend.id,
                TeamMemberRole.team_role_id == einladung.team_role_id,
            ).first()
            if exists is None:
                db.add(TeamMemberRole(team_member_id=bestehend.id, team_role_id=einladung.team_role_id))
            _mitglied_flags_neu(db, bestehend)
        db.delete(einladung)
        # Kein "joined": beigetreten ist hier niemand. Dieselbe Aktion und
        # dieselben Felder wie in `update_member` — nur steht als Handelnder
        # der, dem die Schalter gehoeren.
        audit_service.record_privileged_action(
            db, user_id=user.id, action="team.member.updated", target_type="team",
            target_id=team_id,
            details={
                "member_user_id": user.id,
                "can_manage_skills": bestehend.can_manage_skills,
                "can_manage_memory": bestehend.can_manage_memory,
                "can_access_vault": bestehend.can_access_vault,
            },
            origin="direct",
        )
        db.commit()
        db.refresh(bestehend)
        return bestehend

    # Die Obergrenze gilt nur dem Beitritt: eine Anhebung belegt keinen Platz,
    # den das Mitglied nicht laengst haette.
    if db.query(TeamMember).filter(TeamMember.team_id == team_id).count() >= MAX_MEMBERS_PER_TEAM:
        raise HTTPException(status_code=409, detail="Team ist voll")

    member = TeamMember(
        team_id=team_id, user_id=user.id, role="member",
        can_manage_skills=einladung.can_manage_skills,
        can_manage_memory=einladung.can_manage_memory,
        can_access_vault=einladung.can_access_vault,
        team_role_id=einladung.team_role_id,
        added_by=einladung.invited_by,
    )
    db.add(member)
    db.flush()
    if einladung.team_role_id is not None:
        db.add(TeamMemberRole(team_member_id=member.id, team_role_id=einladung.team_role_id))
        standard = db.query(TeamRole.id).filter(TeamRole.team_id == team.id, TeamRole.is_default.is_(True)).first()
        if standard is None or einladung.team_role_id != standard[0]:
            # Ausdruecklich gewaehlte Rolle: Sie regiert wie in set_member_roles —
            # auch senkend (Befund 15). Die automatisch substituierte
            # Standardrolle ist kein Vergabewille: Sonst verlöre jede Einladung
            # mit Schaltern ihre Schalter schon beim Beitritt.
            _mitglied_flags_neu(db, member)
    elif not team.is_personal:
        default_role = db.query(TeamRole).filter(TeamRole.team_id == team.id, TeamRole.is_default.is_(True)).first()
        if default_role is not None:
            member.team_role_id = default_role.id
            db.add(TeamMemberRole(team_member_id=member.id, team_role_id=default_role.id))
    db.delete(einladung)
    # Beitritt mit Tresor: Das neue Mitglied braucht eine Schluesselhuelle —
    # die naechste Rotation (automatisch beim naechsten Oeffnen durch den
    # Gruender) verpackt den neuen Schluesselstand auch fuer das neue Mitglied.
    if team.vault_bucket_id:
        team.vault_needs_rotation = True
    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.member.joined", target_type="team",
        target_id=team_id,
        details={"member_user_id": user.id}, origin="direct",
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Benutzer ist bereits im Team") from exc
    db.refresh(member)
    return member


def decline_invitation(db: Session, *, user: User, team_id: int) -> None:
    einladung = invitation(db, team_id, user.id)
    if einladung is None:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")
    db.delete(einladung)
    db.commit()


def _docs_verbindungen_trennen(db: Session, team_id: int, user_id: int) -> None:
    """Trennt die Collab-Verbindungen eines Benutzers best effort.

    Der Collab-Token lebt 30 Minuten; nach einer Rollenaenderung tippte der
    Betroffene sonst mit der alten Rolle weiter (Befund 41).
    """
    try:
        from models.doc import Document
        from services.docs_collab_service import DocsCollabService

        for (doc_uid,) in db.query(Document.doc_uid).filter(Document.team_id == team_id):
            DocsCollabService.disconnect_user(doc_uid, user_id)
    except Exception:
        pass


def update_member(
    db: Session, *, team: Team, user: User, member_user_id: int,
    can_manage_skills: bool, can_manage_memory: bool,
    can_access_vault: bool = True, team_role_id: int | None = None,
) -> TeamMember:
    """Setzt die Schalter eines Mitglieds — herunter sofort, herauf als Angebot.

    Zuruecknehmen darf der Gruender allein: er entzieht, was er selbst gegeben
    hat. **Anheben darf er nicht allein.** Ein nachtraeglich eingeschalteter
    Schalter macht sein Team zum Lernziel der KI des Betroffenen: hat der kein
    eigenes verwaltbares Team, ist das fremde ab dann der einzige Kandidat in
    `learning_team`, und was seine KI "fuers Team" merkt, landet dort und ist
    dort im Klartext lesbar. Genau diese Tuer schliesst `invite_member` seit dem
    23.08.2026 — hier stand sie mit einem Zwischenschritt wieder offen: harmlos
    einladen (beide Schalter aus), annehmen lassen, danach den Schalter setzen.

    Deshalb derselbe Weg wie beim Beitritt: die Anhebung wird zu einer
    Einladung, die derselbe Mensch annimmt. Bis dahin bleibt die Zeile, wie sie
    war; der Gruender sieht sein Angebot unter den offenen Einladungen. Ein
    neuer Wunsch ueberholt das alte Angebot — auch dann, wenn er gar nichts
    mehr anheben will, denn sonst bliebe eine zurueckgenommene Anhebung
    annehmbar.

    Wer ueber sich selbst entscheidet, hat damit zugestimmt; bis hierher kommt
    ohnehin nur, wer das Team verwaltet.
    """
    assert_team_owner(db, team, user)
    member = membership(db, team.id, member_user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Mitglied nicht gefunden")
    if team_role_id is not None:
        _pruefe_rollenzuteilung(db, team, user, [_rolle_im_team(db, team, team_role_id)])

    # Das `and` ist die ganze Regel: was aus ist, bleibt aus; was an ist, darf
    # aus werden.
    neu_skills = member.can_manage_skills and can_manage_skills
    neu_memory = member.can_manage_memory and can_manage_memory
    if member_user_id == user.id:
        neu_skills, neu_memory = can_manage_skills, can_manage_memory
    angehoben = (
        (can_manage_skills and not neu_skills) or (can_manage_memory and not neu_memory)
    )
    member.can_manage_skills = neu_skills
    member.can_manage_memory = neu_memory
    hatte_tresor = member.can_access_vault
    member.can_access_vault = can_access_vault
    if team_role_id is not None:
        # Die Rolle ist vergeben wie in set_member_roles: ihre Schalter gelten
        # sofort — auch senkend (Befund 15). Reine Schalterwuensche ohne Rolle
        # laufen weiter ueber den Tanz oben und bleiben unangetastet.
        member.team_role_id = team_role_id
        _mitglied_flags_neu(db, member)
    if hatte_tresor and not member.can_access_vault:
        _tresor_schluessel_entziehen(db, team, member_user_id)

    offen = invitation(db, team.id, member_user_id)
    if angehoben:
        if offen is None:
            offen = TeamInvitation(team_id=team.id, user_id=member_user_id)
            db.add(offen)
        offen.can_manage_skills = can_manage_skills
        offen.can_manage_memory = can_manage_memory
        offen.can_access_vault = can_access_vault
        offen.team_role_id = team_role_id
        offen.invited_by = user.id
    elif offen is not None:
        # Der Wunsch von jetzt ueberholt das Angebot von vorhin.
        db.delete(offen)

    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.member.updated", target_type="team",
        target_id=team.id,
        details={
            "member_user_id": member_user_id,
            # Was wirklich in der Zeile steht, nicht was verlangt wurde. Seit
            # der Zustimmungspflicht sind das zwei verschiedene Dinge, und ein
            # Protokoll, das den Wunsch als Tatsache fuehrt, waere genau dort
            # falsch, wo jemand spaeter nachsieht, wer was durfte.
            "can_manage_skills": member.can_manage_skills,
            "can_manage_memory": member.can_manage_memory,
        },
        origin="direct",
    )
    if angehoben:
        audit_service.record_privileged_action(
            db, user_id=user.id, action="team.member.invited", target_type="team",
            target_id=team.id,
            details={"member_user_id": member_user_id}, origin="direct",
        )
    db.commit()
    _docs_verbindungen_trennen(db, team.id, member_user_id)
    db.refresh(member)
    return member


def _tresor_schluessel_entziehen(db: Session, team: Team, member_user_id: int) -> None:
    """Entzieht einem Mitglied den Team-Tresor-Schluessel.

    Loescht alle Schluesselhuellen des Mitglieds und markiert den Tresor zur
    Rotation: Was es bis hierher lesen konnte, laege mit dem alten DEK noch in
    seinem Cache — erst die Rotation schliesst die Tuer. Committet nicht.
    """
    if not team.vault_bucket_id:
        try:
            db.refresh(team, ["vault_bucket_id"])
        except Exception:
            pass
    if not team.vault_bucket_id:
        deleted = db.query(TeamVaultKey).filter(
            TeamVaultKey.team_id == team.id,
            TeamVaultKey.user_id == member_user_id,
        ).delete(synchronize_session=False)
        if deleted > 0:
            team.vault_needs_rotation = True
        return
    db.query(TeamVaultKey).filter(
        TeamVaultKey.team_id == team.id,
        TeamVaultKey.user_id == member_user_id,
    ).delete(synchronize_session=False)
    team.vault_needs_rotation = True


def remove_member(db: Session, *, team: Team, user: User, member_user_id: int) -> None:
    """Entlaesst ein Mitglied — oder laesst eines selbst gehen.

    Der Austritt aus eigenem Antrieb braucht bewusst nicht die Zustimmung des
    Gruenders. Sonst stuende das Gegenstueck zur Einladung schief: wer selbst
    zustimmen muss, um beizutreten, muss auch ohne fremde Zustimmung gehen
    koennen. Der Gruender bleibt ausgenommen — sein Konto ist die Obergrenze
    fuer alles, was das Team weitergibt.
    """
    if member_user_id != user.id:
        if not has_team_permission(db, team.id, user, "team.members.kick"):
            assert_team_owner(db, team, user)
    if member_user_id == team.owner_user_id:
        raise HTTPException(status_code=409, detail="Der Gruender bleibt im Team")
    member = membership(db, team.id, member_user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Mitglied nicht gefunden")
    offen = invitation(db, team.id, member_user_id)
    if offen is not None:
        # Neben einer Mitgliedschaft kann nur ein Angebot aus `update_member`
        # stehen — `invite_member` weist ein Mitglied ab. Es gehoert zu einer
        # Zeile, die es gleich nicht mehr gibt: bliebe es liegen, waere seine
        # Annahme ein Wiedereintritt, und der Gruender erfuehre davon nichts.
        db.delete(offen)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.member.removed", target_type="team",
        target_id=team.id, details={"member_user_id": member_user_id},
        origin="direct",
    )
    db.delete(member)
    _tresor_schluessel_entziehen(db, team, member_user_id)
    # Dokument-Freigaben dieses Teams verlieren mit der Mitgliedschaft ihre
    # Grundlage. Die Rollenauflösung verweigert ohnehin schon; die Zeilen
    # werden trotzdem entfernt, damit ein Wiedereintritt nicht stillschweigend
    # eine alte manuelle Rolle wiederbelebt.
    from models.doc import DocMember, Document

    db.query(DocMember).filter(
        DocMember.user_id == member_user_id,
        DocMember.document_id.in_(
            db.query(Document.id).filter(Document.team_id == team.id)
        ),
    ).delete(synchronize_session=False)
    db.commit()
    # Offene Verbindungen dieses Benutzers best effort trennen. Der Collab-Token
    # lebt 30 Minuten; ohne diesen Schritt tippte ein Entlassenes weiter.
    try:
        from services.docs_collab_service import DocsCollabService

        for (doc_uid,) in db.query(Document.doc_uid).filter(Document.team_id == team.id):
            DocsCollabService.disconnect_user(doc_uid, member_user_id)
    except Exception:
        pass


def set_server_grants(
    db: Session, *, team: Team, user: User, server_id: int, keys: list[str],
) -> list[str]:
    """Legt fest, welche Rechte das Team auf einem Server weitergeben soll.

    Hier steht die **zweite** Sperre gegen Rechteausweitung. Die erste ist die
    Pruefung zur Laufzeit in `permission_service`; sie allein wuerde genuegen.
    Diese hier existiert, damit ein Gruender nicht stillschweigend eine Zeile
    anlegen kann, die spaeter wirksam wuerde, sobald er das Recht selbst
    erhaelt — und damit die Oberflaeche sofort sagt, was nicht geht.

    Geprueft wird gegen `direct_server_permission`, nicht gegen
    `has_server_permission`: was jemand selbst nur ueber ein Team hat, darf er
    nicht weiterreichen.
    """
    from services.permission_catalog import SERVER_KEYS

    if not has_team_permission(db, team.id, user, "team.servers.manage"):
        assert_team_owner(db, team, user)
    if team.is_personal:
        raise HTTPException(status_code=409, detail="Das persoenliche Team teilt keine Server")

    desired = {key for key in keys if key in SERVER_KEYS}
    founder = db.get(User, team.owner_user_id)
    if founder is None:
        raise HTTPException(status_code=409, detail="Teamgründer nicht gefunden")
    for key in sorted(desired):
        if not permission_service.direct_server_permission(db, user, server_id, key):
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Du haelst \"{key}\" auf diesem Server nicht selbst und "
                    "kannst es deshalb nicht an das Team weitergeben."
                ),
            )
        # Auch der Gruender ist die Obergrenze: sonst legt ein Delegierter
        # eine ruhende Zeile an, die erst mit dessen spaeterem Recht wirkt.
        if founder.id != user.id and not permission_service.direct_server_permission(
            db, founder, server_id, key
        ):
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Der Teamgründer hält \"{key}\" auf diesem Server nicht "
                    "selbst und kann es deshalb nicht weitergeben."
                ),
            )
    # `server.view` ist die Voraussetzung fuer alles Weitere. Ohne sie sieht das
    # Mitglied den Server nicht einmal in der Liste, haette aber Rechte auf ihm
    # — ein Zustand, den die Oberflaeche nicht darstellen kann.
    if desired and "server.view" not in desired:
        raise HTTPException(
            status_code=422,
            detail="Ohne \"server.view\" ergeben die uebrigen Rechte keinen Sinn",
        )

    existing = (
        db.query(TeamServerGrant)
        .filter(TeamServerGrant.team_id == team.id, TeamServerGrant.server_id == server_id)
        .all()
    )
    existing_by_key = {row.permission_key: row for row in existing}
    for key, row in existing_by_key.items():
        if key not in desired:
            db.delete(row)
    for key in desired:
        if key not in existing_by_key:
            db.add(TeamServerGrant(
                team_id=team.id, server_id=server_id, permission_key=key,
                granted_by=user.id,
            ))
    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.server.grants.set", target_type="team",
        target_id=team.id,
        details={"server_id": server_id, "keys": sorted(desired)}, origin="direct",
    )
    db.commit()
    return sorted(desired)


def team_server_keys(db: Session, team_id: int, server_id: int) -> list[str]:
    rows = (
        db.query(TeamServerGrant.permission_key)
        .filter(TeamServerGrant.team_id == team_id, TeamServerGrant.server_id == server_id)
        .all()
    )
    return sorted(row[0] for row in rows)


def team_server_ids(db: Session, team_id: int) -> list[int]:
    rows = (
        db.query(TeamServerGrant.server_id)
        .filter(TeamServerGrant.team_id == team_id)
        .distinct()
        .all()
    )
    return sorted(row[0] for row in rows)


SCHALTER = {"skills": TeamMember.can_manage_skills, "memory": TeamMember.can_manage_memory}


def learning_teams(db: Session, user: User, *, schalter: str) -> list[Team]:
    """Die echten Teams, in die dieser Benutzer schreiben darf — die Kandidaten.

    ``schalter`` entscheidet, welcher der beiden Mitgliedsschalter gilt. Das war
    vorher fest `can_manage_skills`, obwohl beide Erinnerungswerkzeuge dieselbe
    Funktion benutzten: ein Mitglied mit `memory=True, skills=False` bekam sein
    Teamwissen still ins persoenliche Gedaechtnis geschrieben, und umgekehrt
    endete derselbe Satz in einem 403 aus `_assert_may_write`.

    Das persoenliche Team steht bewusst nicht in der Liste. Es ist kein Ziel,
    unter dem man waehlt, sondern der Rueckfall, wenn es keines gibt.
    """
    spalte = SCHALTER.get(schalter)
    if spalte is None:
        raise ValueError(f"Unbekannter Schalter: {schalter}")
    rows = (
        db.query(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .filter(
            TeamMember.user_id == user.id,
            Team.personal_for_user_id.is_(None),
            spalte.is_(True),
        )
        .order_by(Team.name)
        .all()
    )
    return rows


def _mit_gruender(name: str, gruender: str) -> str:
    """Die eine Form, in der ein mehrdeutiger Teamname seinen Gruender traegt.

    Sie steht hier und nicht an ihren Aufrufstellen, weil beide Seiten
    desselben Gespraechs sie treffen muessen: `learning_team` bietet sie in der
    Rueckfrage an und nimmt sie als `wunsch` wieder entgegen, und wer ein Team
    sonst benennt (`ansprechbarer_name`), benennt es in genau dieser Form. Zwei
    Schreibweisen waeren zwei Namen fuer dasselbe Team, und der eine davon
    waehlte nichts aus.
    """
    return f"{name} ({gruender})"


def _gruendernamen(db: Session, teams: list[Team]) -> dict[int, str]:
    """Der Gruendername je Team-ID — in einer Abfrage, nicht einer je Team."""
    namen = dict(
        db.query(User.id, User.username)
        .filter(User.id.in_({team.owner_user_id for team in teams}))
        .all()
    )
    return {
        team.id: str(namen.get(team.owner_user_id, team.owner_user_id))
        for team in teams
    }


def _kandidatennamen(db: Session, kandidaten: list[Team]) -> list[str]:
    """Namen, unter denen die Kandidaten unterscheidbar sind.

    Teamnamen sind nur je Gruender eindeutig — zwei Gruender duerfen dasselbe
    Wort waehlen, und `learning_team` spricht ein Team allein ueber seinen
    Namen an. Hiessen in der Rueckfrage beide schlicht "Alpha", waere jede
    Antwort mehrdeutig: dieselbe Frage kaeme erneut, und Team-Lernen waere fuer
    diesen Benutzer dauerhaft unmoeglich. Deshalb bekommt nur der mehrdeutige
    Name den Gruender dazu — der eindeutige bleibt, wie der Benutzer ihn kennt.

    Der Gruendername verraet nichts: der Benutzer ist Mitglied beider Teams und
    sieht ihn ohnehin in der Mitgliederliste.
    """
    haeufig = Counter(team.name.casefold() for team in kandidaten)
    if all(anzahl == 1 for anzahl in haeufig.values()):
        return [team.name for team in kandidaten]
    gruender = _gruendernamen(db, kandidaten)
    return [
        team.name if haeufig[team.name.casefold()] == 1
        else _mit_gruender(team.name, gruender[team.id])
        for team in kandidaten
    ]


def ansprechbarer_name(db: Session, user: User, team: Team) -> str:
    """Der Name, unter dem dieser Benutzer genau *dieses* Team meint.

    Wer ein Team benennt, ohne es auszuwaehlen — die volle Absage in
    `ai_memory_service._bereichsname`, ein Suchtreffer —, braucht denselben
    Namen, den `learning_team` danach wieder annimmt. Der blosse Teamname ist
    dafuer zu wenig: er ist nur je Gruender eindeutig (`_assert_name_is_free`),
    und ist der Benutzer in zwei Teams desselben Namens, benennt er beide. Was
    dann folgt, ist keine Sackgasse mehr, sondern ein Treffer im falschen Team
    — Schluessel sind bewusst stabil und wiederholen sich ueber Teams hinweg,
    es gibt dort also etwas zu treffen.

    Verglichen wird gegen die **echten** Teams des Benutzers. Das persoenliche
    steht in keiner Auswahl (`learning_teams`) und macht deshalb keinen Namen
    mehrdeutig, auch wenn es zufaellig so heisst.
    """
    gleichnamig = [
        row for row in list_user_teams(db, user)
        if not row.is_personal and row.name.casefold() == team.name.casefold()
    ]
    if len(gleichnamig) < 2:
        return team.name
    return _mit_gruender(team.name, _gruendernamen(db, [team])[team.id])


def learning_team(
    db: Session, user: User, *, schalter: str = "skills", wunsch: str | None = None
) -> tuple[Team | None, str | None]:
    """Wohin die KI schreibt, wenn sie etwas fuer das Team lernt.

    Gibt entweder ein Team zurueck oder einen Grund, warum die KI nachfragen
    muss. Die Regel folgt dem Alltag statt einer Einstellung:

    - genau ein echtes Team, in dem der Benutzer verwalten darf → dorthin
    - keines → das persoenliche Team, damit ueberhaupt gelernt wird
    - mehrere → ``wunsch`` entscheidet; ohne ihn eine Rueckfrage

    ``wunsch`` ist ein **Auswahlmittel, keine Berechtigung.** Die Kandidatenliste
    stammt aus der Datenbank; der Name aus dem Prompt darf nur einen Eintrag
    daraus treffen. Trifft er keinen, gibt es dieselbe Rueckfrage wie ohne ihn —
    ausdruecklich ohne den Hinweis, ob es ein Team dieses Namens ueberhaupt gibt.
    Vorher war der Fall eine Sackgasse: die Rueckfrage kam, aber kein Werkzeug
    nahm die Antwort entgegen, und das Modell fragte erneut. Sind zwei
    Kandidaten namensgleich, nennt die Rueckfrage zusaetzlich den Gruender —
    dieser zusammengesetzte Name waehlt dann genauso aus wie ein eindeutiger.

    Der zweite Rueckgabewert ist bewusst Text fuer das Modell, nicht ein Code:
    er landet direkt im Werkzeugergebnis und soll dort verstanden werden.
    """
    kandidaten = learning_teams(db, user, schalter=schalter)
    if len(kandidaten) == 1:
        return kandidaten[0], None
    if not kandidaten:
        return personal_team(db, user), None

    namen = _kandidatennamen(db, kandidaten)
    if wunsch is not None:
        gesucht = wunsch.strip().casefold()
        # Die Form mit Gruender waehlt **immer** aus, auch wo das Angebot oben
        # mit dem blossen Namen auskommt. `ansprechbarer_name` misst die
        # Mehrdeutigkeit an allen Teams des Benutzers, dieser Schalter nur an
        # seinen Kandidaten — der Name aus einem Suchtreffer ist deshalb
        # manchmal genauer als noetig. Nachsichtig lesen, streng auswaehlen:
        # ein zu genauer Name darf nicht ins Leere laufen.
        gruender = _gruendernamen(db, kandidaten)
        treffer = [
            team for team, name in zip(kandidaten, namen)
            if gesucht in (
                team.name.casefold(),
                name.casefold(),
                _mit_gruender(team.name, gruender[team.id]).casefold(),
            )
        ]
        if len(treffer) == 1:
            return treffer[0], None
    return None, (
        "Der Benutzer ist in mehreren Teams: "
        f"{', '.join(namen)}. Frage nach, welches gemeint ist, und rufe das "
        "Werkzeug erneut mit team=\"<Name>\" auf."
    )


def can_manage_team_skills(db: Session, user: User, team_id: int) -> bool:
    return has_team_permission(db, team_id, user, "ai.skills.manage")


def can_manage_team_memory(db: Session, user: User, team_id: int) -> bool:
    return has_team_permission(db, team_id, user, "ai.memory.write")


def list_team_roles(db: Session, team_id: int) -> list[TeamRole]:
    """Gibt alle Rollen des Teams zurück, sortiert nach Admin, Default und Name."""
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    roles = (
        db.query(TeamRole)
        .filter(TeamRole.team_id == team_id)
        .order_by(TeamRole.is_admin.desc(), TeamRole.is_default.desc(), TeamRole.name)
        .all()
    )
    if not roles and not team.is_personal:
        roles = ensure_default_team_roles(db, team)
        db.commit()
    return roles


def get_team_role(db: Session, team_id: int, role_id: int) -> TeamRole:
    role = (
        db.query(TeamRole)
        .filter(TeamRole.team_id == team_id, TeamRole.id == role_id)
        .first()
    )
    if role is None:
        raise HTTPException(status_code=404, detail="Team-Rolle nicht gefunden")
    return role


def create_team_role(
    db: Session,
    *,
    team: Team,
    user: User,
    name: str,
    description: str | None = None,
    color: str = "#3b82f6",
    icon: str | None = None,
    is_default: bool = False,
    is_admin: bool = False,
    can_access_vault: bool = True,
    can_manage_skills: bool = False,
    can_manage_memory: bool = False,
    permission_keys: list[str] | None = None,
    server_grants: list[dict] | None = None,
) -> TeamRole:
    """Erstellt eine neue Rolle im Team."""
    if not has_team_permission(db, team.id, user, "team.roles.manage"):
        assert_team_owner(db, team, user)
    _pruefe_server_grant_sicht(db, team, server_grants)
    _pruefe_rollen_deckel(
        db, team, user,
        is_admin=is_admin,
        permission_keys=permission_keys,
        flags={
            "can_access_vault": can_access_vault,
            "can_manage_skills": can_manage_skills,
            "can_manage_memory": can_manage_memory,
        },
        server_grants=server_grants,
    )

    safe_name = name.strip()
    if not 2 <= len(safe_name) <= 32:
        raise HTTPException(status_code=422, detail="Rollenname muss 2 bis 32 Zeichen lang sein")

    existing_name = (
        db.query(TeamRole.id)
        .filter(TeamRole.team_id == team.id, func.lower(TeamRole.name) == safe_name.lower())
        .first()
    )
    if existing_name is not None:
        raise HTTPException(status_code=409, detail="Eine Rolle mit diesem Namen existiert bereits im Team")

    if is_default:
        db.query(TeamRole).filter(TeamRole.team_id == team.id).update({TeamRole.is_default: False})

    role = TeamRole(
        team_id=team.id,
        name=safe_name,
        description=description.strip() if description else None,
        color=color if color else "#3b82f6",
        icon=icon,
        is_default=is_default,
        is_admin=is_admin,
        can_access_vault=can_access_vault,
        can_manage_skills=can_manage_skills,
        can_manage_memory=can_manage_memory,
    )
    db.add(role)
    db.flush()

    if permission_keys:
        for key in permission_keys:
            if is_team_key(key):
                db.add(TeamRolePermission(role_id=role.id, permission_key=key))

    if server_grants:
        founder = db.get(User, team.owner_user_id)
        for grant in server_grants:
            server_id = grant.get("server_id")
            keys = grant.get("permission_keys", [])
            if not server_id:
                continue
            for k in keys:
                if k in SERVER_KEYS:
                    if founder and not permission_service.direct_server_permission(db, founder, server_id, k):
                        raise HTTPException(
                            status_code=403,
                            detail=f"Der Teamgründer hält \"{k}\" auf Server {server_id} nicht direkt.",
                        )
                    db.add(TeamRoleServerGrant(role_id=role.id, server_id=server_id, permission_key=k))

    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.role.created", target_type="team_role",
        target_id=role.id, details={"name": safe_name, "team_id": team.id}, origin="direct",
    )
    db.commit()
    db.refresh(role)
    return role


def update_team_role(
    db: Session,
    *,
    team: Team,
    user: User,
    role_id: int,
    name: str,
    description: str | None = None,
    color: str = "#3b82f6",
    icon: str | None = None,
    is_default: bool = False,
    is_admin: bool = False,
    can_access_vault: bool = True,
    can_manage_skills: bool = False,
    can_manage_memory: bool = False,
    permission_keys: list[str] | None = None,
    server_grants: list[dict] | None = None,
) -> TeamRole:
    """Aktualisiert eine bestehende Rolle im Team."""
    if not has_team_permission(db, team.id, user, "team.roles.manage"):
        assert_team_owner(db, team, user)

    role = get_team_role(db, team.id, role_id)
    _pruefe_server_grant_sicht(db, team, server_grants)
    _pruefe_rollen_deckel(
        db, team, user,
        is_admin=is_admin,
        permission_keys=permission_keys,
        flags={
            "can_access_vault": can_access_vault,
            "can_manage_skills": can_manage_skills,
            "can_manage_memory": can_manage_memory,
        },
        server_grants=server_grants,
    )
    safe_name = name.strip()
    if not 2 <= len(safe_name) <= 32:
        raise HTTPException(status_code=422, detail="Rollenname muss 2 bis 32 Zeichen lang sein")

    existing_name = (
        db.query(TeamRole.id)
        .filter(
            TeamRole.team_id == team.id,
            TeamRole.id != role_id,
            func.lower(TeamRole.name) == safe_name.lower(),
        )
        .first()
    )
    if existing_name is not None:
        raise HTTPException(status_code=409, detail="Eine Rolle mit diesem Namen existiert bereits im Team")

    if is_default and not role.is_default:
        db.query(TeamRole).filter(TeamRole.team_id == team.id).update({TeamRole.is_default: False})

    role.name = safe_name
    role.description = description.strip() if description else None
    role.color = color if color else "#3b82f6"
    role.icon = icon
    role.is_default = is_default
    role.is_admin = is_admin
    role.can_access_vault = can_access_vault
    role.can_manage_skills = can_manage_skills
    role.can_manage_memory = can_manage_memory
    # Geaenderte Rolle, neue Schalter: alle Traeger rechnen sofort neu —
    # senkend wie erhoehend (Befund 15).
    for traeger in _rollen_traeger(db, team.id, role.id):
        _mitglied_flags_neu(db, traeger)

    if permission_keys is not None:
        desired_keys = {k for k in permission_keys if is_team_key(k)}
        db.query(TeamRolePermission).filter(TeamRolePermission.role_id == role.id).delete()
        for key in desired_keys:
            db.add(TeamRolePermission(role_id=role.id, permission_key=key))

    if server_grants is not None:
        db.query(TeamRoleServerGrant).filter(TeamRoleServerGrant.role_id == role.id).delete()
        founder = db.get(User, team.owner_user_id)
        for grant in server_grants:
            server_id = grant.get("server_id")
            keys = grant.get("permission_keys", [])
            if not server_id:
                continue
            for k in keys:
                if k in SERVER_KEYS:
                    if founder and not permission_service.direct_server_permission(db, founder, server_id, k):
                        raise HTTPException(
                            status_code=403,
                            detail=f"Der Teamgründer hält \"{k}\" auf Server {server_id} nicht direkt.",
                        )
                    db.add(TeamRoleServerGrant(role_id=role.id, server_id=server_id, permission_key=k))

    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.role.updated", target_type="team_role",
        target_id=role.id, details={"name": safe_name, "team_id": team.id}, origin="direct",
    )
    db.commit()
    db.refresh(role)
    return role


def delete_team_role(db: Session, *, team: Team, user: User, role_id: int) -> None:
    """Löscht eine Team-Rolle."""
    if not has_team_permission(db, team.id, user, "team.roles.manage"):
        assert_team_owner(db, team, user)

    role = get_team_role(db, team.id, role_id)
    if role.is_default:
        raise HTTPException(status_code=409, detail="Die Standardrolle eines Teams kann nicht gelöscht werden")

    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.role.deleted", target_type="team_role",
        target_id=role.id, details={"name": role.name, "team_id": team.id}, origin="direct",
    )
    traeger_ids = [m.id for m in _rollen_traeger(db, team.id, role.id)]
    db.delete(role)
    # Erst flushen: Die Kaskaden (CASCADE auf Mehrfach-, SET NULL auf
    # Legacy-Zuweisung) muessen wirken, bevor die Traeger neu rechnen.
    db.flush()
    for mitglied_id in traeger_ids:
        traeger = db.get(TeamMember, mitglied_id)
        if traeger is not None:
            # SET NULL steht nur in der Datenbank; das Objekt im Speicher
            # kennt es erst nach dem Verfall.
            db.expire(traeger)
            _mitglied_flags_neu(db, traeger)
    db.commit()


def get_member_roles(db: Session, member_id: int) -> list[TeamRole]:
    """Gibt alle TeamRole-Objekte eines Mitglieds zurück."""
    member = db.get(TeamMember, member_id)
    if member is None:
        return []
    role_ids = get_member_role_ids(db, member.id, member.team_role_id)
    if not role_ids:
        return []
    return db.query(TeamRole).filter(TeamRole.id.in_(role_ids)).order_by(TeamRole.name).all()


def set_member_roles(
    db: Session, *, team: Team, user: User, member_user_id: int, role_ids: list[int]
) -> list[TeamRole]:
    """Weist einem Mitglied Rollen im Team zu."""
    if not has_team_permission(db, team.id, user, "team.roles.manage"):
        assert_team_owner(db, team, user)

    member = membership(db, team.id, member_user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Mitglied nicht gefunden")

    valid_roles = (
        db.query(TeamRole)
        .filter(TeamRole.team_id == team.id, TeamRole.id.in_(role_ids))
        .all()
    ) if role_ids else []

    # Der Deckel gilt der Zuteilung wie der Anlage: eine Admin-Rolle teilt nur
    # der Gruender zu, fremde Rechte und Schalter niemand, der sie nicht haelt.
    _pruefe_rollenzuteilung(db, team, user, valid_roles)

    valid_role_ids = {r.id for r in valid_roles}

    db.query(TeamMemberRole).filter(TeamMemberRole.team_member_id == member.id).delete()
    for rid in valid_role_ids:
        db.add(TeamMemberRole(team_member_id=member.id, team_role_id=rid))

    member.team_role_id = next(iter(valid_role_ids), None)

    # Rollen-Flags auf Mitglied spiegeln (OR ueber Rollen) — auch senkend:
    # Wer die Rolle verliert, verliert den Schalter (Befund 15).
    hatte_tresor = member.can_access_vault
    _mitglied_flags_neu(db, member)
    if hatte_tresor and not member.can_access_vault:
        _tresor_schluessel_entziehen(db, team, member_user_id)

    audit_service.record_privileged_action(
        db, user_id=user.id, action="team.member.roles.set", target_type="team",
        target_id=team.id, details={"member_user_id": member_user_id, "role_ids": sorted(valid_role_ids)},
        origin="direct",
    )
    db.commit()
    _docs_verbindungen_trennen(db, team.id, member_user_id)
    return valid_roles
