"""Teams, Teammitglieder, Team-Rollen und Team-Serverrechte für die KI.

Lesen läuft direkt über `list_teams` und `read_team_overview` (inkl. Präsenzstatus,
Team-Rollen, Server-Grants und unscharfer Namensauflösung); Schreiben läuft über
Vorschlagskarten (`services/ai_proposals/team_proposals.py`).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import (
    Server,
    Team,
    TeamMember,
    TeamRole,
    User,
)
from services import permission_service, team_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import spaet, spaet_vorschlag, werkzeug
from services.ai_tools.base import (
    _RATIONALE_REQUIRED,
    _RATIONALE_SCHEMA,
    _function,
    _require_no_arguments,
)
from services.ai_tools.user_tools import MAX_QUERY_CHARS, MIN_MATCH, aehnlichkeit, kennung
from services.permission_catalog import (
    SERVER_KEYS,
    SERVER_PERMISSIONS,
    TEAM_PERMISSIONS,
    UNCRITICAL_SERVER_PERMISSIONS,
)
from services.social_service import SocialService

MAX_MATCH_CANDIDATES = 8


def _team_tool_definitions() -> list[dict]:
    """Kompakte Schemas aller neun Team-Werkzeuge (`gruppe="teams"`)."""
    rechte_liste = {
        "type": "array",
        "items": {"type": "string", "maxLength": 64},
        "maxItems": 64,
    }
    queries_liste = {
        "type": "array",
        "items": {"type": "string", "maxLength": MAX_QUERY_CHARS},
        "maxItems": 16,
    }
    modus = {"type": "string", "enum": ["merge", "replace", "remove"]}

    return [
        _function(
            "list_teams",
            "Listet alle Teams des Benutzers (auch echte vs. persönliches Team) mit ID, Namen, Mitgliederzahl und eigenen Teamrechten.",
            {},
            [],
        ),
        _function(
            "read_team_overview",
            "Liest Teamdetails: Mitglieder mit Präsenz/Aktivität, Team-Rollen, Server-Grants, delegierbare Server, Rechtekataloge und unscharfe Namensauflösung für Team, Mitglieder, Server und Rollen.",
            {
                "team_id": {"type": "integer", "minimum": 1},
                "team": {"type": "string", "maxLength": MAX_QUERY_CHARS},
                "member_queries": queries_liste,
                "server_queries": queries_liste,
                "role_queries": queries_liste,
            },
            [],
        ),
        _function(
            "propose_team_create",
            "Gründet ein neues echtes Team mit Standardrollen (Admin, Mitglied, Gast).",
            {
                "name": {"type": "string", "minLength": 2, "maxLength": 64},
                **_RATIONALE_SCHEMA,
            },
            ["name", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_team_role_set",
            "Erstellt eine Team-Rolle oder ändert sie (mit role_id), inkl. Teamrechten und Serverrechten (einzelne Server oder alle Server).",
            {
                "team_id": {"type": "integer", "minimum": 1},
                "role_id": {"type": "integer", "minimum": 1},
                "name": {"type": "string", "maxLength": 32},
                "description": {"type": ["string", "null"], "maxLength": 255},
                "color": {"type": "string", "maxLength": 16},
                "icon": {"type": ["string", "null"], "maxLength": 32},
                "is_default": {"type": "boolean"},
                "is_admin": {"type": "boolean"},
                "team_permissions": rechte_liste,
                "server_grants": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                        "type": "object",
                        "properties": {
                            "server_id": {"type": "integer", "minimum": 1},
                            "permissions": rechte_liste,
                        },
                        "required": ["server_id", "permissions"],
                        "additionalProperties": False,
                    },
                },
                "all_servers_permissions": rechte_liste,
                "mode": modus,
                **_RATIONALE_SCHEMA,
            },
            ["team_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_team_role_delete",
            "Löscht eine Team-Rolle (Standardrolle ist geschützt; fragt immer nach Bestätigung).",
            {
                "team_id": {"type": "integer", "minimum": 1},
                "role_id": {"type": "integer", "minimum": 1},
                **_RATIONALE_SCHEMA,
            },
            ["team_id", "role_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_team_member_roles",
            "Weist einem Teammitglied Team-Rollen zu oder entzieht sie.",
            {
                "team_id": {"type": "integer", "minimum": 1},
                "user_id": {"type": "integer", "minimum": 1},
                "role_ids": {
                    "type": "array",
                    "items": {"type": "integer", "minimum": 1},
                    "maxItems": 32,
                },
                "mode": modus,
                **_RATIONALE_SCHEMA,
            },
            ["team_id", "user_id", "role_ids", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_team_member_invite",
            "Lädt einen Benutzer (user_id aus list_users) ins Team ein, optional mit Startrolle.",
            {
                "team_id": {"type": "integer", "minimum": 1},
                "user_id": {"type": "integer", "minimum": 1},
                "team_role_id": {"type": ["integer", "null"], "minimum": 1},
                **_RATIONALE_SCHEMA,
            },
            ["team_id", "user_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_team_member_remove",
            "Entfernt ein Mitglied aus dem Team (fragt immer nach Bestätigung).",
            {
                "team_id": {"type": "integer", "minimum": 1},
                "user_id": {"type": "integer", "minimum": 1},
                **_RATIONALE_SCHEMA,
            },
            ["team_id", "user_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_team_server_grants",
            "Setzt teamweite Serverrechte (ein Server oder alle delegierbaren Server) oder schaltet den Rollenmodus für Serverrechte um.",
            {
                "team_id": {"type": "integer", "minimum": 1},
                "server_id": {"type": "integer", "minimum": 1},
                "all_servers": {"type": "boolean"},
                "permissions": rechte_liste,
                "mode": modus,
                "server_roles_active": {"type": "boolean"},
                **_RATIONALE_SCHEMA,
            },
            ["team_id", *_RATIONALE_REQUIRED],
        ),
    ]


def _teamname(team: Team) -> str:
    return redact_sensitive_text(str(team.name or ""))[:64]


def _benutzereigenes_team(db: Session, team: Team, user: User) -> bool:
    return bool(user.is_owner or team.owner_user_id == user.id)


def _delegierbare_team_server(db: Session, team: Team, user: User) -> list[dict]:
    """Server samt Rechten, die der Aufrufende und der Gründer im Team weitergeben dürfen."""
    founder = db.get(User, team.owner_user_id)
    if founder is None:
        return []
    pauschal_user, delegiert_user = permission_service.direkte_rechte(db, user, set(SERVER_KEYS))
    pauschal_founder, delegiert_founder = (
        (pauschal_user, delegiert_user)
        if founder.id == user.id
        else permission_service.direkte_rechte(db, founder, set(SERVER_KEYS))
    )
    hoster_ids = permission_service.hoster_customer_server_ids(db)
    user_hoster = permission_service.has_global_permission(
        db, user, permission_service.HOSTER_CUSTOMERS_VIEW_KEY
    )
    founder_hoster = (
        user_hoster
        if founder.id == user.id
        else permission_service.has_global_permission(
            db, founder, permission_service.HOSTER_CUSTOMERS_VIEW_KEY
        )
    )

    ergebnis: list[dict] = []
    for srv in db.query(Server).order_by(Server.name).all():
        u_pauschal = pauschal_user if user_hoster or srv.id not in hoster_ids else set()
        u_keys = u_pauschal | {key for sid, key in delegiert_user if sid == srv.id}
        if "server.view" not in u_keys:
            continue
        f_pauschal = pauschal_founder if founder_hoster or srv.id not in hoster_ids else set()
        f_keys = f_pauschal | {key for sid, key in delegiert_founder if sid == srv.id}
        gemeinsam = u_keys & f_keys
        if "server.view" not in gemeinsam:
            continue
        ergebnis.append({
            "server_id": srv.id,
            "name": redact_sensitive_text(str(srv.name or ""))[:128],
            "game_type": srv.game_type,
            "status": srv.status,
            "permission_keys": sorted(gemeinsam),
        })
    return ergebnis


def _match_eintraege(
    queries: list[str],
    candidates: list[dict],
    *,
    name_key: str,
    id_key: str,
) -> list[dict]:
    """Löst unscharfe Namen gegen Kandidaten auf und meldet eindeutige vs. mehrdeutige Treffer."""
    ausgaben: list[dict] = []
    for raw in queries:
        suche = str(raw or "").strip()[:MAX_QUERY_CHARS]
        if not suche:
            continue
        exact = [c for c in candidates if str(c.get(name_key) or "").casefold() == suche.casefold()]
        if len(exact) == 1:
            ausgaben.append({
                "query": suche,
                "status": "exact",
                "match": {id_key: exact[0][id_key], "name": exact[0][name_key]},
                "candidates": [{id_key: exact[0][id_key], "name": exact[0][name_key], "score": 1.0}],
            })
            continue
        scored = []
        for cand in candidates:
            score = aehnlichkeit(suche, str(cand.get(name_key) or ""))
            if score >= MIN_MATCH:
                scored.append((score, cand))
        scored.sort(key=lambda item: (-item[0], str(item[1].get(name_key) or "").casefold()))
        top = scored[:MAX_MATCH_CANDIDATES]
        if not top:
            status = "not_found"
            match_obj = None
        elif len(top) == 1 or (top[0][0] >= 0.85 and top[0][0] - top[1][0] >= 0.15):
            status = "unique"
            match_obj = {id_key: top[0][1][id_key], "name": top[0][1][name_key]}
        else:
            status = "ambiguous"
            match_obj = None
        ausgaben.append({
            "query": suche,
            "status": status,
            "match": match_obj,
            "candidates": [
                {id_key: c[id_key], "name": c[name_key], "score": round(s, 2)}
                for s, c in top
            ],
        })
    return ausgaben


def _resolve_team_from_args(db: Session, user: User, arguments: dict) -> tuple[Team | None, dict | None]:
    raw_id = arguments.get("team_id")
    raw_name = arguments.get("team")
    if raw_id not in (None, "", 0):
        team_id = kennung(raw_id, "team_id")
        try:
            return team_service.get_team_for_member(db, team_id, user), None
        except Exception as exc:
            detail = getattr(exc, "detail", None) or "Team nicht gefunden"
            raise AiActionValidationError(str(detail)) from None

    teams = team_service.list_user_teams(db, user)
    echte = [t for t in teams if not t.is_personal]
    pool = echte if echte else teams
    if raw_name is None or not str(raw_name).strip():
        if not teams:
            return None, {"teams": [], "note": "Der Benutzer gehört noch keinem Team an."}
        if len(echte) == 1:
            return echte[0], None
        if not echte and len(teams) == 1:
            return teams[0], None
        return None, {
            "needs_clarification": True,
            "reason": "team_selection_required",
            "team_candidates": [
                {
                    "team_id": t.id,
                    "name": _teamname(t),
                    "addressable_name": team_service.ansprechbarer_name(db, user, t),
                    "is_personal": bool(t.is_personal),
                }
                for t in pool
            ],
        }

    suche = str(raw_name).strip()[:MAX_QUERY_CHARS]
    exakt = [
        t for t in teams
        if t.name.casefold() == suche.casefold()
        or team_service.ansprechbarer_name(db, user, t).casefold() == suche.casefold()
    ]
    if len(exakt) == 1:
        return exakt[0], None
    if len(exakt) > 1:
        return None, {
            "needs_clarification": True,
            "reason": "team_ambiguous",
            "query": suche,
            "team_candidates": [
                {
                    "team_id": t.id,
                    "name": _teamname(t),
                    "addressable_name": team_service.ansprechbarer_name(db, user, t),
                    "is_personal": bool(t.is_personal),
                }
                for t in exakt
            ],
        }

    scored = []
    for t in pool:
        s = max(
            aehnlichkeit(suche, t.name),
            aehnlichkeit(suche, team_service.ansprechbarer_name(db, user, t)),
        )
        if s >= MIN_MATCH:
            scored.append((s, t))
    scored.sort(key=lambda item: (-item[0], item[1].name.casefold()))
    if len(scored) == 1 or (
        len(scored) > 1 and scored[0][0] >= 0.85 and scored[0][0] - scored[1][0] >= 0.15
    ):
        return scored[0][1], None
    if scored:
        return None, {
            "needs_clarification": True,
            "reason": "team_ambiguous",
            "query": suche,
            "team_candidates": [
                {
                    "team_id": t.id,
                    "name": _teamname(t),
                    "addressable_name": team_service.ansprechbarer_name(db, user, t),
                    "score": round(s, 2),
                }
                for s, t in scored[:MAX_MATCH_CANDIDATES]
            ],
        }
    raise AiActionValidationError(f"Kein passendes Team zu '{suche}' gefunden.")


def _execute_list_teams(db: Session, user: User, arguments: dict) -> dict:
    _require_no_arguments("list_teams", arguments)
    teams = team_service.list_user_teams(db, user)
    teams.sort(key=lambda t: (bool(t.is_personal), t.name.casefold(), t.id))
    items = []
    for team in teams:
        member = team_service.membership(db, team.id, user.id)
        count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
        is_owner = _benutzereigenes_team(db, team, user)
        items.append({
            "team_id": team.id,
            "name": _teamname(team),
            "addressable_name": team_service.ansprechbarer_name(db, user, team),
            "is_personal": bool(team.is_personal),
            "is_owner": is_owner,
            "member_role": member.role if member else ("owner" if user.is_owner else None),
            "server_roles_active": bool(team.server_roles_active),
            "member_count": count,
            "can_manage_roles": is_owner or team_service.has_team_permission(db, team.id, user, "team.roles.manage"),
            "can_manage_servers": is_owner or team_service.has_team_permission(db, team.id, user, "team.servers.manage"),
            "can_invite_members": is_owner or team_service.has_team_permission(db, team.id, user, "team.members.invite"),
            "can_remove_members": is_owner or team_service.has_team_permission(db, team.id, user, "team.members.kick"),
        })
    return {"teams": items, "count": len(items)}


def _execute_read_team_overview(db: Session, user: User, arguments: dict) -> dict:
    erlaubt = {"team_id", "team", "member_queries", "server_queries", "role_queries"}
    if set(arguments) - erlaubt:
        raise AiActionValidationError("read_team_overview hat ungueltige Argumente")
    team, clarification = _resolve_team_from_args(db, user, arguments)
    if clarification is not None:
        return clarification
    assert team is not None

    is_owner = _benutzereigenes_team(db, team, user)
    can_manage_roles = is_owner or team_service.has_team_permission(db, team.id, user, "team.roles.manage")
    can_manage_servers = is_owner or team_service.has_team_permission(db, team.id, user, "team.servers.manage")

    team_roles = team_service.list_team_roles(db, team.id)
    roles_out: list[dict] = []
    roles_by_id: dict[int, TeamRole] = {}
    for role in team_roles:
        roles_by_id[role.id] = role
        grants_by_srv: dict[int, list[str]] = {}
        for sg in role.server_grants:
            grants_by_srv.setdefault(sg.server_id, []).append(sg.permission_key)
        grant_list = []
        for sid, pkeys in sorted(grants_by_srv.items()):
            srv = db.get(Server, sid)
            grant_list.append({
                "server_id": sid,
                "server_name": redact_sensitive_text(str(srv.name))[:128] if srv else f"Server #{sid}",
                "permission_keys": sorted(pkeys),
            })
        members_count = len(team_service._rollen_traeger(db, team.id, role.id))
        roles_out.append({
            "role_id": role.id,
            "name": redact_sensitive_text(str(role.name))[:32],
            "description": redact_sensitive_text(str(role.description or ""))[:255] or None,
            "is_admin": bool(role.is_admin),
            "is_default": bool(role.is_default),
            "permission_keys": sorted(p.permission_key for p in role.permissions),
            "server_grants": grant_list,
            "members_count": members_count,
        })

    rows = (
        db.query(TeamMember, User.username)
        .join(User, User.id == TeamMember.user_id)
        .filter(TeamMember.team_id == team.id)
        .order_by(TeamMember.role.desc(), User.username)
        .all()
    )
    members_out: list[dict] = []
    for member, username in rows:
        role_ids = team_service.get_member_role_ids(db, member.id, member.team_role_id)
        presence = SocialService.get_presence_for_teammate(db, user.id, member.user_id)
        presence_dict = None
        if isinstance(presence, dict):
            raw_act = presence.get("activity_key") or presence.get("activity")
            raw_seen = presence.get("updated_at") or presence.get("last_seen_at")
            presence_dict = {
                "status": presence.get("status"),
                "device_type": presence.get("device_type"),
                "client": presence.get("client"),
                "activity": redact_sensitive_text(str(raw_act))[:128] if raw_act else None,
                "updated_at": raw_seen.isoformat() if hasattr(raw_seen, "isoformat") else raw_seen,
            }
        members_out.append({
            "user_id": member.user_id,
            "username": redact_sensitive_text(str(username or ""))[:64],
            "team_membership_role": member.role,
            "role_ids": role_ids,
            "role_names": [
                redact_sensitive_text(str(roles_by_id[rid].name))[:32]
                for rid in role_ids if rid in roles_by_id
            ],
            "joined_at": member.joined_at.isoformat() if member.joined_at else None,
            "presence": presence_dict,
        })

    team_servers_out: list[dict] = []
    for sid in team_service.team_server_ids(db, team.id):
        srv = db.get(Server, sid)
        if srv is None:
            continue
        team_servers_out.append({
            "server_id": sid,
            "name": redact_sensitive_text(str(srv.name or ""))[:128],
            "game_type": srv.game_type,
            "status": srv.status,
            "permission_keys": team_service.team_server_keys(db, team.id, sid),
        })

    assignable = (
        _delegierbare_team_server(db, team, user)
        if (is_owner or can_manage_roles or can_manage_servers) and not team.is_personal
        else []
    )

    invitations_out = []
    if is_owner:
        for inv in team_service.team_invitations(db, team.id):
            invited_user = db.get(User, inv.user_id)
            invitations_out.append({
                "user_id": inv.user_id,
                "username": redact_sensitive_text(str(invited_user.username))[:64] if invited_user else "",
                "team_role_id": inv.team_role_id,
                "invited_at": inv.created_at.isoformat() if inv.created_at else None,
            })

    resolved: dict[str, list[dict]] = {}
    if arguments.get("member_queries"):
        resolved["members"] = _match_eintraege(
            list(arguments["member_queries"]), members_out, name_key="username", id_key="user_id"
        )
    if arguments.get("role_queries"):
        resolved["roles"] = _match_eintraege(
            list(arguments["role_queries"]), roles_out, name_key="name", id_key="role_id"
        )
    if arguments.get("server_queries"):
        srv_pool = assignable if assignable else team_servers_out
        resolved["servers"] = _match_eintraege(
            list(arguments["server_queries"]), srv_pool, name_key="name", id_key="server_id"
        )

    return {
        "team_id": team.id,
        "name": _teamname(team),
        "addressable_name": team_service.ansprechbarer_name(db, user, team),
        "is_personal": bool(team.is_personal),
        "is_owner": is_owner,
        "server_roles_active": bool(team.server_roles_active),
        "members": members_out,
        "roles": roles_out,
        "team_servers": team_servers_out,
        "assignable_servers": assignable,
        "open_invitations": invitations_out,
        "team_permissions": {p.key: p.label for p in TEAM_PERMISSIONS},
        "server_permissions": {p.key: p.label for p in SERVER_PERMISSIONS},
        "uncritical_server_permissions": sorted(UNCRITICAL_SERVER_PERMISSIONS),
        **({"resolved": resolved} if resolved else {}),
    }


def _lies_teams(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    return _execute_list_teams(db, user, arguments)


def _lies_team_overview(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    return _execute_read_team_overview(db, user, arguments)


_TEAM_WERKZEUGE = {
    "list_teams": dict(
        art="global_read",
        gruppe="teams",
        hinweis="Listet alle Teams des Benutzers samt Rechten.",
        global_handler=_lies_teams,
    ),
    "read_team_overview": dict(
        art="global_read",
        gruppe="teams",
        hinweis="Liest Mitglieder, Präsenz, Team-Rollen, Server und löst Namen auf.",
        global_handler=_lies_team_overview,
    ),
    "propose_team_create": dict(
        art="global_write",
        gruppe="teams",
        recht="teams.create",
        recht_global=True,
        hinweis="Gründet ein neues Team.",
        vorschlag=spaet_vorschlag("services.ai_proposals.team_proposals._team_create_payload"),
        ausfuehren=spaet("services.ai_proposals.team_proposals._ausfuehren_team_create"),
    ),
    "propose_team_role_set": dict(
        art="global_write",
        gruppe="teams",
        hinweis="Legt eine Team-Rolle an oder ändert sie.",
        vorschlag=spaet_vorschlag("services.ai_proposals.team_proposals._team_role_set_payload"),
        ausfuehren=spaet("services.ai_proposals.team_proposals._ausfuehren_team_role_set"),
    ),
    "propose_team_role_delete": dict(
        art="global_write",
        gruppe="teams",
        immer_bestaetigen=True,
        hinweis="Löscht eine Team-Rolle nach Bestätigung.",
        vorschlag=spaet_vorschlag("services.ai_proposals.team_proposals._team_role_delete_payload"),
        ausfuehren=spaet("services.ai_proposals.team_proposals._ausfuehren_team_role_delete"),
    ),
    "propose_team_member_roles": dict(
        art="global_write",
        gruppe="teams",
        hinweis="Weist einem Teammitglied Rollen zu oder entzieht sie.",
        vorschlag=spaet_vorschlag("services.ai_proposals.team_proposals._team_member_roles_payload"),
        ausfuehren=spaet("services.ai_proposals.team_proposals._ausfuehren_team_member_roles"),
    ),
    "propose_team_member_invite": dict(
        art="global_write",
        gruppe="teams",
        hinweis="Lädt einen Benutzer ins Team ein.",
        vorschlag=spaet_vorschlag("services.ai_proposals.team_proposals._team_member_invite_payload"),
        ausfuehren=spaet("services.ai_proposals.team_proposals._ausfuehren_team_member_invite"),
    ),
    "propose_team_member_remove": dict(
        art="global_write",
        gruppe="teams",
        immer_bestaetigen=True,
        hinweis="Entfernt ein Teammitglied nach Bestätigung.",
        vorschlag=spaet_vorschlag("services.ai_proposals.team_proposals._team_member_remove_payload"),
        ausfuehren=spaet("services.ai_proposals.team_proposals._ausfuehren_team_member_remove"),
    ),
    "propose_team_server_grants": dict(
        art="global_write",
        gruppe="teams",
        hinweis="Setzt teamweite Serverrechte oder schaltet den Server-Rollenmodus um.",
        vorschlag=spaet_vorschlag("services.ai_proposals.team_proposals._team_server_grants_payload"),
        ausfuehren=spaet("services.ai_proposals.team_proposals._ausfuehren_team_server_grants"),
    ),
}

TEAM_READ_TOOLS = frozenset({"list_teams", "read_team_overview"})
TEAM_SCOPED_WRITE_TOOLS = frozenset({
    "propose_team_role_set",
    "propose_team_role_delete",
    "propose_team_member_roles",
    "propose_team_member_invite",
    "propose_team_member_remove",
    "propose_team_server_grants",
})

DEFINITIONEN = _team_tool_definitions()

for _schema in DEFINITIONEN:
    _eintrag = _TEAM_WERKZEUGE.get(_schema["function"]["name"])
    if _eintrag is not None:
        werkzeug(_schema, **_eintrag)
