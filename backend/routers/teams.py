"""Teams: gemeinsame KI-Wissensbasis und gebuendelte Serverrechte.

Bewusst ohne `require_global`: jeder angemeldete Benutzer darf seine eigenen
Teams sehen — auch das persoenliche, das er nie selbst angelegt hat. Erst das
*Gruenden* eines echten Teams verlangt `teams.create`, geprueft in
`team_service.create_team`.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, verify_csrf
from middleware.rate_limit import auth_rate_limit
from models import Server, Team, TeamInvitation, TeamMember, User
from schemas.team import (
    TeamCreate,
    TeamDetailResponse,
    TeamInvitationResponse,
    TeamMemberResponse,
    TeamMemberUpdate,
    TeamMemberWrite,
    TeamRename,
    TeamResponse,
    TeamServerGrantWrite,
    TeamServerResponse,
    TeamVaultRotateRequest,
    TeamVaultSaltResponse,
    TeamVaultSetupRequest,
)
from schemas.vault import (
    VaultBlobAnlegen,
    VaultBlobLoeschen,
    VaultBlobStatus,
    VaultBlobsKlein,
    VaultHintSetRequest,
    VaultHintStatusResponse,
    VaultResetRequest,
    VaultRotationPrepareRequest,
    VaultSpeicher,
    VaultSyncRequest,
    VaultSyncResponse,
)
from services import (
    audit_service,
    passkey_service,
    permission_service,
    team_service,
    vault_blob_service,
    vault_service,
)
from services.auth_service import AuthService


router = APIRouter(prefix="/api/teams", tags=["teams"])


def _summary(db: Session, team: Team, user: User) -> TeamResponse:
    member = team_service.membership(db, team.id, user.id)
    count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
    return _zusammenfassung(team, user, member, count)


def _zusammenfassung(
    team: Team, user: User, member: TeamMember | None, count: int
) -> TeamResponse:
    return TeamResponse(
        id=team.id,
        name=team.name,
        is_personal=team.is_personal,
        owner_user_id=team.owner_user_id,
        is_owner=user.is_owner or (member is not None and member.role == "owner"),
        can_manage_skills=member is not None and member.can_manage_skills,
        can_manage_memory=member is not None and member.can_manage_memory,
        can_access_vault=user.is_owner or (member is not None and (member.role == "owner" or member.can_access_vault)),
        member_count=count,
        created_at=team.created_at,
    )


def _invitation(db: Session, einladung: TeamInvitation, team: Team) -> TeamInvitationResponse:
    eingeladener = db.get(User, einladung.user_id)
    einlader = (
        db.get(User, einladung.invited_by) if einladung.invited_by is not None else None
    )
    return TeamInvitationResponse(
        team_id=team.id,
        team_name=team.name,
        user_id=einladung.user_id,
        username=eingeladener.username if eingeladener is not None else "",
        avatar_url=eingeladener.avatar_url if eingeladener is not None else None,
        invited_by_username=einlader.username if einlader is not None else None,
        can_manage_skills=einladung.can_manage_skills,
        can_manage_memory=einladung.can_manage_memory,
        can_access_vault=einladung.can_access_vault,
        team_role_id=einladung.team_role_id,
        invited_at=einladung.created_at,
    )


def _detail(db: Session, team: Team, user: User) -> TeamDetailResponse:
    rows = (
        db.query(TeamMember, User.username, User.avatar_url)
        .join(User, User.id == TeamMember.user_id)
        .filter(TeamMember.team_id == team.id)
        .order_by(TeamMember.role.desc(), User.username)
        .all()
    )
    members = [
        TeamMemberResponse(
            user_id=member.user_id, username=username, avatar_url=avatar_url, role=member.role,
            can_manage_skills=member.can_manage_skills,
            can_manage_memory=member.can_manage_memory,
            can_access_vault=member.can_access_vault,
            team_role_id=member.team_role_id,
            joined_at=member.joined_at,
        )
        for member, username, avatar_url in rows
    ]
    servers: list[TeamServerResponse] = []
    for server_id in team_service.team_server_ids(db, team.id):
        server = db.get(Server, server_id)
        if server is None:
            continue
        servers.append(TeamServerResponse(
            server_id=server_id, server_name=server.name,
            permission_keys=team_service.team_server_keys(db, team.id, server_id),
        ))
    base = _summary(db, team, user)
    # Offene Einladungen sieht nur der Gruender. Wer eingeladen ist, hat sich
    # noch zu nichts bekannt — das muss nicht die halbe Mitgliederliste wissen.
    einladungen = (
        [
            _invitation(db, einladung, team)
            for einladung in team_service.team_invitations(db, team.id)
        ]
        if base.is_owner
        else []
    )
    return TeamDetailResponse(
        **base.model_dump(), members=members, servers=servers, invitations=einladungen,
    )


@router.get("", response_model=list[TeamResponse])
def list_teams(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeamResponse]:
    """Alle Teams des Benutzers, einschliesslich des persoenlichen.

    Das persoenliche Team wird hier bei Bedarf angelegt: Diese Liste ist die
    Stelle, an der ein Benutzer Teams zum ersten Mal bewusst ansieht — ein
    guter Zeitpunkt, ihm sein eigenes zu geben, statt es beim ersten Chat
    unbemerkt entstehen zu lassen.
    """
    # Nur committen, wenn das Team fehlt. Die Liste wird regelmaessig
    # abgefragt, und ein Commit je Abruf liess alle geladenen Objekte
    # verfallen, die danach einzeln neu geladen wurden.
    if db.query(Team.id).filter(Team.personal_for_user_id == user.id).first() is None:
        team_service.personal_team(db, user)
        db.commit()
    teams = team_service.list_user_teams(db, user)
    ids = [team.id for team in teams]
    # Mitgliedschaft und Kopfzahl fuer alle Teams in je einer Abfrage,
    # nicht zwei je Team.
    eigene = {
        member.team_id: member
        for member in db.query(TeamMember).filter(
            TeamMember.user_id == user.id, TeamMember.team_id.in_(ids)
        )
    }
    zahlen = dict(
        db.query(TeamMember.team_id, func.count(TeamMember.id))
        .filter(TeamMember.team_id.in_(ids))
        .group_by(TeamMember.team_id)
        .all()
    )
    return [
        _zusammenfassung(team, user, eigene.get(team.id), zahlen.get(team.id, 0))
        for team in teams
    ]


@router.post("", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
def create_team(
    payload: TeamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> TeamResponse:
    team = team_service.create_team(db, user=user, name=payload.name)
    return _summary(db, team, user)


# ── Einladungen ───────────────────────────────────────────────────────
#
# Diese drei Routen stehen bewusst **vor** `/{team_id}`: FastAPI nimmt die
# erste passende, und `/invitations` waere sonst ein Team mit dem Namen
# "invitations" — also ein 422 statt einer Liste.


@router.get("/invitations", response_model=list[TeamInvitationResponse])
def list_invitations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeamInvitationResponse]:
    """Die Einladungen, ueber die dieser Benutzer noch entscheiden muss."""
    return [
        _invitation(db, einladung, einladung.team)
        for einladung in team_service.open_invitations(db, user)
    ]


@router.post("/invitations/{team_id}/accept", response_model=TeamDetailResponse)
def accept_invitation(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> TeamDetailResponse:
    """Beitreten. Erst hier entsteht die Mitgliedschaft — und mit ihr der
    Zugriff auf das gemeinsame Wissen und die Server des Teams."""
    team_service.accept_invitation(db, user=user, team_id=team_id)
    team = team_service.get_team_for_member(db, team_id, user)
    return _detail(db, team, user)


@router.delete("/invitations/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def decline_invitation(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> None:
    team_service.decline_invitation(db, user=user, team_id=team_id)


@router.get("/{team_id}", response_model=TeamDetailResponse)
def get_team(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TeamDetailResponse:
    team = team_service.get_team_for_member(db, team_id, user)
    return _detail(db, team, user)


@router.put("/{team_id}", response_model=TeamResponse)
def rename_team(
    team_id: int,
    payload: TeamRename,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> TeamResponse:
    team = team_service.get_team_for_member(db, team_id, user)
    return _summary(db, team_service.rename_team(db, team=team, user=user, name=payload.name), user)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> None:
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.delete_team(db, team=team, user=user)


@router.post("/{team_id}/members", response_model=TeamDetailResponse, status_code=status.HTTP_201_CREATED)
def invite_member(
    team_id: int,
    payload: TeamMemberWrite,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> TeamDetailResponse:
    """Laedt einen Benutzer ein. Mitglied wird er erst, wenn er annimmt.

    Die Antwort zeigt ihn deshalb unter `invitations` und nicht unter
    `members`.
    """
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.invite_member(
        db, team=team, user=user, new_user_id=payload.user_id,
        can_manage_skills=payload.can_manage_skills,
        can_manage_memory=payload.can_manage_memory,
        can_access_vault=payload.can_access_vault,
        team_role_id=payload.team_role_id,
    )
    return _detail(db, team, user)


@router.put("/{team_id}/members/{member_user_id}", response_model=TeamDetailResponse)
def update_member(
    team_id: int,
    member_user_id: int,
    payload: TeamMemberUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> TeamDetailResponse:
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.update_member(
        db, team=team, user=user, member_user_id=member_user_id,
        can_manage_skills=payload.can_manage_skills,
        can_manage_memory=payload.can_manage_memory,
        can_access_vault=payload.can_access_vault,
        team_role_id=payload.team_role_id,
    )
    return _detail(db, team, user)


@router.delete("/{team_id}/members/{member_user_id}", response_model=TeamDetailResponse)
def remove_member(
    team_id: int,
    member_user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> TeamDetailResponse:
    """Entlaesst ein Mitglied — oder laesst den Aufrufenden selbst gehen.

    Der eigene Austritt braucht den Gruender nicht; die Antwort zeigt dann das
    Team ohne den Ausgetretenen, also nichts, was er nicht eben noch sah.
    """
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.remove_member(db, team=team, user=user, member_user_id=member_user_id)
    return _detail(db, team, user)


@router.put("/{team_id}/servers", response_model=TeamDetailResponse)
def set_server_grants(
    team_id: int,
    payload: TeamServerGrantWrite,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> TeamDetailResponse:
    team = team_service.get_team_for_member(db, team_id, user)
    # Ob es den Server gibt, erfaehrt nur, wer ihn ohnehin sehen darf.
    if not permission_service.direct_server_permission(
        db, user, payload.server_id, "server.view"
    ):
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    team_service.set_server_grants(
        db, team=team, user=user, server_id=payload.server_id,
        keys=payload.permission_keys,
    )
    return _detail(db, team, user)


@router.get("/{team_id}/assignable-servers", response_model=list[TeamServerResponse])
def assignable_servers(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeamServerResponse]:
    """Server, die der Gruender dem Team ueberhaupt geben koennte.

    Bewusst nur, was er **direkt** haelt — nicht, was er selbst ueber ein
    anderes Team bekommen hat. Damit zeigt die Oberflaeche dieselbe Obergrenze,
    die `permission_service` spaeter durchsetzt, statt dass der Benutzer sie
    erst beim Speichern als Fehlermeldung erlebt.

    Die Rechte werden **einmal** mengenweise geholt, nicht je Server und je
    Schlüssel einzeln: das waren 28 Rechtefragen mal drei Abfragen je Server,
    also rund 1700 bei dreißig Servern, für eine Liste, die beim Öffnen
    eines Dialogs entsteht.
    """
    from services.permission_catalog import SERVER_KEYS

    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)

    pauschal, delegiert = permission_service.direkte_rechte(db, user, set(SERVER_KEYS))

    # Auf Hoster-Kundenservern zaehlt der pauschale Anspruch nur mit dem
    # Hoster-Key — dieselbe Schranke wie in `direct_server_permission`. Ohne
    # den Filter boete die Liste Kundenserver samt Namen an, die beim
    # Speichern (Zeile oben: 404) wieder verschwinden — und leakte damit
    # genau die Menge, die `list_visible_server_ids` verbirgt.
    hoster_ids = permission_service.hoster_customer_server_ids(db)
    hoster_zugriff = permission_service.has_global_permission(
        db, user, permission_service.HOSTER_CUSTOMERS_VIEW_KEY
    )

    result: list[TeamServerResponse] = []
    for server in db.query(Server).order_by(Server.name).all():
        pauschal_hier = (
            pauschal if hoster_zugriff or server.id not in hoster_ids else set()
        )
        keys = pauschal_hier | {key for sid, key in delegiert if sid == server.id}
        if "server.view" not in keys:
            continue
        result.append(TeamServerResponse(
            server_id=server.id, server_name=server.name,
            permission_keys=sorted(keys),
        ))
    return result


# ─── Team-Tresor (E2EE Zero-Knowledge) ────────────────────────────────────────

@router.get("/{team_id}/vault/salt", response_model=TeamVaultSaltResponse)
def get_team_vault_salt(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TeamVaultSaltResponse:
    """Liefert Salz und Bucket-ID des Team-Tresors sowie den Rotations-Hinweis."""
    team = team_service.get_team_for_member(db, team_id, user)
    is_owner = bool(user.is_owner or team.owner_user_id == user.id)
    can_access = True
    if not is_owner:
        m = team_service.membership(db, team_id, user.id)
        if m is not None and not m.can_access_vault:
            can_access = False

    return TeamVaultSaltResponse(
        is_setup=team.vault_bucket_id is not None,
        salt=team.vault_salt if can_access else None,
        bucket_id=team.vault_bucket_id if can_access else None,
        needs_rotation=bool(team.vault_needs_rotation) if can_access else False,
        is_owner=is_owner,
        can_access_vault=can_access,
        has_hint=bool(team.vault_hint) if can_access else False,
        rotation_state=team.vault_rotation_state if can_access else None,
        pending_bucket_id=team.vault_pending_bucket_id if can_access else None,
        pending_salt=team.vault_pending_salt if can_access else None,
    )


@router.post("/{team_id}/vault/setup", dependencies=[Depends(verify_csrf)])
def setup_team_vault(
    team_id: int,
    payload: TeamVaultSetupRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Richtet den Team-Tresor ein (nur Gruender)."""
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)
    try:
        vault_service.setup_team_vault(
            db, team, user, payload.bucket_id, payload.salt, payload.hint
        )
    except vault_service.VaultZurueckgesetzt as exc:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Dieser Tresor wurde zurückgesetzt.") from exc
    except vault_service.VaultBucketAccessDenied as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/{team_id}/vault/rotate", dependencies=[Depends(verify_csrf)])
def rotate_team_vault(
    team_id: int,
    payload: TeamVaultRotateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Rotiert das Master-Passwort des Team-Tresors und setzt das Rotations-Flag zurueck (nur Gruender)."""
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)
    vault_service.rotate_team_vault(db, team, user, payload.bucket_id, payload.salt)
    return {"status": "ok"}


@router.post("/{team_id}/vault/rotation/prepare", dependencies=[Depends(verify_csrf)])
def prepare_team_vault_rotation(
    team_id: int,
    payload: "VaultRotationPrepareRequest",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)
    try:
        vault_service.rotation_vorbereiten_team(db, team, payload.bucket_id, payload.salt)
    except vault_service.VaultZurueckgesetzt as exc:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Dieser Tresor wurde zurückgesetzt.") from exc
    except vault_service.VaultBucketAccessDenied as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/{team_id}/vault/rotation/commit", dependencies=[Depends(verify_csrf)])
def commit_team_vault_rotation(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)
    vault_service.rotation_commit_team(db, team)
    return {"status": "ok"}


@router.post("/{team_id}/vault/rotation/abort", dependencies=[Depends(verify_csrf)])
def abort_team_vault_rotation(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)
    vault_service.rotation_abbrechen_team(db, team)
    return {"status": "ok"}


@router.post("/{team_id}/vault/rotation/rollback", dependencies=[Depends(verify_csrf)])
def rollback_team_vault_rotation(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)
    vault_service.rotation_rollback_team(db, team)
    return {"status": "ok"}


@router.post("/{team_id}/vault/sync", response_model=VaultSyncResponse, dependencies=[Depends(verify_csrf)])
def sync_team_vault(
    team_id: int,
    payload: VaultSyncRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VaultSyncResponse:
    """Fuehrt Revisions-Sync fuer den Team-Tresor durch (alle Team-Mitglieder)."""
    team = team_service.get_team_for_member(db, team_id, user)
    if not user.is_owner and team.owner_user_id != user.id:
        m = team_service.membership(db, team.id, user.id)
        if m is not None and not m.can_access_vault:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Zutritt zum Team-Tresor verweigert: Deine Team-Rolle hat keinen Tresor-Zugriff.",
            )
    try:
        return vault_service.sync_team_vault(db, team, user, payload)
    except vault_service.VaultZurueckgesetzt as exc:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Dieser Tresor wurde zurückgesetzt.") from exc
    except vault_service.VaultBucketAccessDenied as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/{team_id}/vault/hint-status", response_model=VaultHintStatusResponse)
def get_team_vault_hint_status(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VaultHintStatusResponse:
    """Prueft den Status des Passwort-Hinweises fuer den Team-Tresor (fuer Teammitglieder)."""
    team = team_service.get_team_for_member(db, team_id, user)
    return vault_service.get_team_vault_hint_status(db, team)


@router.post("/{team_id}/vault/hint", dependencies=[Depends(verify_csrf)])
def set_team_vault_hint(
    team_id: int,
    payload: VaultHintSetRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Hinterlegt oder aktualisiert den Passwort-Hinweis fuer den Team-Tresor."""
    team = team_service.get_team_for_member(db, team_id, user)
    vault_service.set_team_vault_hint(db, team, user, payload.hint)
    return {"status": "ok", "message": "Passwort-Hinweis erfolgreich hinterlegt."}


@router.post("/{team_id}/vault/request-hint", dependencies=[Depends(verify_csrf)])
async def request_team_vault_hint(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Sendet den hinterlegten Hinweis des Team-Tresors an die E-Mail des Mitglieds (max. 1x alle 10 Minuten)."""
    team = team_service.get_team_for_member(db, team_id, user)
    success, msg = await vault_service.request_team_vault_hint_email(db, team, user)
    if not success:
        if "10 Minuten" in msg:
            raise HTTPException(status_code=429, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    return {"status": "ok", "message": msg}


@router.post("/{team_id}/vault/reset", dependencies=[Depends(auth_rate_limit), Depends(verify_csrf)])
def reset_team_vault(
    team_id: int,
    payload: VaultResetRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Setzt den Tresor des Teams zurueck, wenn das Master-Passwort vergessen ist (nur Gruender)."""
    team = team_service.get_team_for_member(db, team_id, user)
    team_service.assert_team_owner(db, team, user)

    if (payload.confirmation or "").strip().lower() != "delete":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bestätigung delete erforderlich")
    if user.has_password and (
        not payload.password or not AuthService.verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bitte dein Passwort bestätigen.")
    if user.two_factor_enabled and not passkey_service.zweiter_faktor_bestaetigt(
        db,
        user,
        otp_code=payload.otp_code,
        passkey=payload.passkey.model_dump() if payload.passkey else None,
        zweck="vault_reset",
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=passkey_service.nachweis_hinweis(user))

    vault_service.team_tresor_zuruecksetzen(db, team)
    audit_service.record_privileged_action(
        db,
        user_id=user.id,
        action="team.vault.reset",
        target_type="team",
        target_id=team.id,
        commit=True,
    )
    return {"status": "ok"}


# ─── Team-Tresor Dateien (Blob-Cloud, Owner-Quota) ───────────────────────────


def _team_bucket(db: Session, team_id: int, user: User) -> tuple[Team, str]:
    team = team_service.get_team_for_member(db, team_id, user)
    if not team.vault_bucket_id:
        raise HTTPException(status_code=400, detail="Team-Tresor ist noch nicht eingerichtet.")
    if not user.is_owner and team.owner_user_id != user.id:
        m = team_service.membership(db, team.id, user.id)
        if m is not None and not m.can_access_vault:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Zutritt zum Team-Tresor verweigert: Deine Team-Rolle hat keinen Tresor-Zugriff.",
            )
    return team, team.vault_bucket_id


def _blob_fehler_team(exc: vault_blob_service.BlobFehler) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _owner_speicher(db: Session, team: Team) -> tuple[User, int, int]:
    """Owner, seine Rollen-Quota und seine Gesamt-Belegung (privat + seine Teams)."""
    owner = db.get(User, team.owner_user_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Team-Owner nicht gefunden")
    quota = vault_blob_service.quote_fuer(db, owner)
    belegt_gesamt = 0
    for anderes in db.query(Team).filter(Team.owner_user_id == owner.id, Team.vault_bucket_id.isnot(None)).all():
        belegt_gesamt += vault_blob_service.belegt(db, anderes.vault_bucket_id)
    try:
        einstellung = vault_service.einstellung(db, vault_service.tresor_konto(owner.id))
        if einstellung is not None and einstellung.bucket_id:
            belegt_gesamt += vault_blob_service.belegt(db, einstellung.bucket_id)
    except Exception:
        pass
    return owner, quota, belegt_gesamt


@router.get("/{team_id}/vault/speicher", response_model=VaultSpeicher)
def team_vault_speicher(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VaultSpeicher:
    team, bucket = _team_bucket(db, team_id, user)
    owner, quota, belegt_gesamt = _owner_speicher(db, team)
    daten = vault_blob_service.speicher(db, owner, bucket)
    daten["quote"] = quota
    daten["belegt"] = belegt_gesamt
    return VaultSpeicher(**daten)


@router.post("/{team_id}/vault/blobs", status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def team_blob_anlegen(
    team_id: int,
    payload: VaultBlobAnlegen,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    _team, bucket = _team_bucket(db, team_id, user)
    owner, quota, belegt_gesamt = _owner_speicher(db, _team)
    if quota <= 0:
        raise HTTPException(
            status_code=507,
            detail="Der Team-Owner hat keinen Tresorspeicher (Rolle ohne Speicher in den Panel-Einstellungen).",
        )
    try:
        vault_blob_service.anlegen(
            db, user, bucket, payload.id, payload.chunk_count, payload.bytes_total,
            payload.delete_verifier, quota_override=quota, belegt_override=belegt_gesamt,
        )
    except vault_blob_service.BlobFehler as exc:
        raise _blob_fehler_team(exc) from exc
    return {"id": payload.id}


@router.put("/{team_id}/vault/blobs/{blob_id}/chunks/{index}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def team_blob_chunk_hochladen(
    team_id: int,
    blob_id: str,
    index: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    _team, bucket = _team_bucket(db, team_id, user)
    try:
        erwartet = await run_in_threadpool(vault_blob_service.laenge_fuer_upload, db, bucket, blob_id, index)
    except vault_blob_service.BlobFehler as exc:
        raise _blob_fehler_team(exc) from exc
    await run_in_threadpool(db.rollback)
    daten = bytearray()
    async for teil in request.stream():
        daten += teil
        if len(daten) > erwartet:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Chunk zu gross.")
    if len(daten) != erwartet:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Chunk hat die falsche Laenge.")
    try:
        await run_in_threadpool(vault_blob_service.chunk_ablegen, db, bucket, blob_id, index, daten)
    except vault_blob_service.BlobFehler as exc:
        raise _blob_fehler_team(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{team_id}/vault/blobs/{blob_id}/status", response_model=VaultBlobStatus)
def team_blob_status(
    team_id: int,
    blob_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VaultBlobStatus:
    _team, bucket = _team_bucket(db, team_id, user)
    try:
        blob = vault_blob_service.eigener_blob(db, bucket, blob_id)
    except vault_blob_service.BlobFehler as exc:
        raise _blob_fehler_team(exc) from exc
    return VaultBlobStatus(state=blob.state, chunk_count=blob.chunk_count, vorhanden=vault_blob_service.vorhandene_chunks(blob))


@router.post("/{team_id}/vault/blobs/{blob_id}/fertig", dependencies=[Depends(verify_csrf)])
def team_blob_fertig(
    team_id: int,
    blob_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    _team, bucket = _team_bucket(db, team_id, user)
    try:
        vault_blob_service.fertigstellen(db, bucket, blob_id)
    except vault_blob_service.BlobFehler as exc:
        raise _blob_fehler_team(exc) from exc
    return {"state": "fertig"}


@router.get("/{team_id}/vault/blobs/{blob_id}/chunks/{index}")
def team_blob_chunk_lesen(
    team_id: int,
    blob_id: str,
    index: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    _team, bucket = _team_bucket(db, team_id, user)
    try:
        pfad = vault_blob_service.chunk_pfad(db, bucket, blob_id, index)
    except vault_blob_service.BlobFehler as exc:
        raise _blob_fehler_team(exc) from exc
    return FileResponse(pfad, media_type="application/octet-stream")


@router.post("/{team_id}/vault/blobs/klein", dependencies=[Depends(verify_csrf)])
def team_blobs_klein(
    team_id: int,
    payload: VaultBlobsKlein,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    _team, bucket = _team_bucket(db, team_id, user)
    inhalt = vault_blob_service.kleine_lesen(db, bucket, payload.ids)
    return Response(content=inhalt, media_type="application/octet-stream")


@router.delete("/{team_id}/vault/blobs/{blob_id}", dependencies=[Depends(verify_csrf)])
def team_blob_loeschen(
    team_id: int,
    blob_id: str,
    payload: VaultBlobLoeschen,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    _team, bucket = _team_bucket(db, team_id, user)
    try:
        vault_blob_service.loeschen(db, bucket, blob_id, payload.schluessel)
    except vault_blob_service.BlobFehler as exc:
        raise _blob_fehler_team(exc) from exc
    return {"status": "ok"}

