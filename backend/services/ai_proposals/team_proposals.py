"""Vorschlagspfade und Ausführung für Team-, Teamrollen- und Teamserver-Aktionen.

Jede Grenze kommt aus `team_service` und `permission_service`:
- `_require_tool_permission` in `ai_proposals/base.py` prüft Teammitgliedschaft und
  Teamrecht auf `team_id` **vor** dem Payload-Bau (kein Zustands-Orakel).
- Im autonomen Modus laufen Anlegen, Bearbeiten, Rollenzuweisungen, Einladungen
  und Server-Freigaben direkt; Löschen (`propose_team_role_delete`,
  `propose_team_member_remove`) trägt `immer_bestaetigen=True` und fragt immer.
- Revisionsschutz (`AI_ACTION_REVISION_CONFLICT`) verhindert stille Überschreibungen,
  wenn zwischen Vorschlag und Bestätigung im Panel etwas geändert wurde.
"""

from __future__ import annotations

import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import Server, Team, TeamMember, TeamRole, User
from services import permission_service, team_service
from services.ai_action_errors import AiActionStateError, AiActionValidationError
from services.ai_proposals.base import _AusfuehrungsRahmen, _Ausgefuehrt
from services.ai_redaction import redact_sensitive_text
from services.ai_tools.team_tools import _delegierbare_team_server
from services.ai_tools.user_tools import benutzername, kennung
from services.permission_catalog import SERVER_KEYS, TEAM_KEYS

_MODI = {
    "merge": "merge", "add": "merge", "grant": "merge", "hinzufuegen": "merge",
    "replace": "replace", "set": "replace", "ersetzen": "replace",
    "remove": "remove", "revoke": "remove", "entziehen": "remove", "entfernen": "remove",
}


def _modus(roh: object, default: str = "merge") -> str:
    if roh is None or (isinstance(roh, str) and not roh.strip()):
        return default
    modus = _MODI.get(str(roh).strip().lower())
    if modus is None:
        raise AiActionValidationError("mode ist merge, replace oder remove")
    return modus


def _liste(roh: object, name: str) -> list:
    if roh is None:
        return []
    if isinstance(roh, str):
        return [teil for teil in re.split(r"[,\s]+", roh) if teil]
    if isinstance(roh, (list, tuple)):
        return list(roh)
    raise AiActionValidationError(f"'{name}' muss eine Liste sein")


def _team_rechte(roh: object) -> list[str]:
    keys = {str(x).strip().lower() for x in _liste(roh, "team_permissions")}
    keys.discard("")
    unbekannt = sorted(keys - TEAM_KEYS)
    if unbekannt:
        raise AiActionValidationError(
            f"Unbekannte Team-Rechte: {unbekannt}. Gültige Schlüssel liefert read_team_overview."
        )
    return sorted(keys)


def _server_rechte(roh: object) -> list[str]:
    keys = {str(x).strip().lower() for x in _liste(roh, "permissions")}
    keys.discard("")
    unbekannt = sorted(keys - SERVER_KEYS)
    if unbekannt:
        raise AiActionValidationError(
            f"Unbekannte Server-Rechte: {unbekannt}. Gültige Schlüssel liefert read_team_overview."
        )
    return sorted(keys)


def _mit_server_sicht(keys: set[str], *, modus: str) -> set[str]:
    if not keys:
        return set()
    if "server.view" not in keys:
        if modus == "remove":
            raise AiActionValidationError(
                "server.view lässt sich nur zusammen mit allen anderen Rechten auf einem Server entziehen"
            )
        keys = set(keys) | {"server.view"}
    return keys


def _http_zu_validation(exc: HTTPException) -> AiActionValidationError:
    detail = exc.detail
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("code") or str(detail)
    return AiActionValidationError(str(detail))


def _http_zu_state(exc: HTTPException) -> AiActionStateError:
    if exc.status_code in (403, 404):
        return AiActionStateError("AI_ACTION_ACCESS_REVOKED")
    return AiActionStateError("AI_ACTION_EXECUTION_FAILED")


def _team_laden(db: Session, user: User, raw_team_id: object) -> Team:
    team_id = kennung(raw_team_id, "team_id")
    try:
        team = team_service.get_team_for_member(db, team_id, user)
    except HTTPException as exc:
        raise _http_zu_validation(exc) from None
    if team.is_personal:
        raise AiActionValidationError("Das persönliche Team unterstützt keine Team-Rollen oder Serverfreigaben.")
    return team


def _team_name(team: Team) -> str:
    return redact_sensitive_text(str(team.name or ""))[:64]


def _role_grants_map(role: TeamRole) -> dict[int, set[str]]:
    res: dict[int, set[str]] = {}
    for sg in role.server_grants:
        res.setdefault(sg.server_id, set()).add(sg.permission_key)
    return res


def _summarize_grants(db: Session, grants_map: dict[int, set[str]]) -> list[str]:
    if not grants_map:
        return []
    srv_names = dict(db.query(Server.id, Server.name).filter(Server.id.in_(list(grants_map))).all())
    out = []
    for sid in sorted(grants_map):
        keys = sorted(grants_map[sid])
        if not keys:
            continue
        name = redact_sensitive_text(str(srv_names.get(sid) or f"Server #{sid}"))[:64]
        out.append(f"{name}: {', '.join(keys)}")
    return out


# ── Team gründen ──────────────────────────────────────────────────────


def _team_create_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    if set(rest) - {"name"}:
        raise AiActionValidationError("propose_team_create hat ungueltige Argumente")
    safe_name = str(rest.get("name") or "").strip()
    if not 2 <= len(safe_name) <= 64:
        raise AiActionValidationError("Teamname muss 2 bis 64 Zeichen lang sein")
    try:
        team_service._assert_name_is_free(db, owner_user_id=user.id, name=safe_name)
    except HTTPException as exc:
        raise _http_zu_validation(exc) from None
    payload = {"name": safe_name}
    preview = {
        "operation": "team_create",
        "team_name": redact_sensitive_text(safe_name)[:64],
    }
    return payload, preview


def _ausfuehren_team_create(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    name = str(rahmen.payload.get("name") or "").strip()
    try:
        team = team_service.create_team(db, user=rahmen.active_user, name=name)
    except HTTPException as exc:
        raise _http_zu_state(exc) from exc
    return _Ausgefuehrt(result={"team_id": team.id, "name": _team_name(team)})


# ── Team-Rolle anlegen / ändern ───────────────────────────────────────


def _team_role_set_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    erlaubt = {
        "team_id", "role_id", "name", "description", "color", "icon",
        "is_default", "is_admin", "team_permissions", "server_grants",
        "all_servers_permissions", "mode",
    }
    if set(rest) - erlaubt:
        raise AiActionValidationError("propose_team_role_set hat ungueltige Argumente")
    team = _team_laden(db, user, rest.get("team_id"))
    roh_role_id = rest.get("role_id")
    role_id = None if roh_role_id in (None, "", 0) else kennung(roh_role_id, "role_id")
    modus = _modus(rest.get("mode"), default="replace" if role_id is None else "merge")

    existing: TeamRole | None = None
    if role_id is not None:
        try:
            existing = team_service.get_team_role(db, team.id, role_id)
        except HTTPException as exc:
            raise _http_zu_validation(exc) from None

    if existing is None:
        name = str(rest.get("name") or "").strip()
        if not 2 <= len(name) <= 32:
            raise AiActionValidationError("Rollenname muss 2 bis 32 Zeichen lang sein")
    else:
        name = (
            str(rest["name"]).strip()
            if rest.get("name") not in (None, "")
            else existing.name
        )
        if not 2 <= len(name) <= 32:
            raise AiActionValidationError("Rollenname muss 2 bis 32 Zeichen lang sein")

    description = (
        redact_sensitive_text(str(rest["description"]).strip())[:255] or None
        if "description" in rest and rest["description"] is not None
        else (None if "description" in rest else (existing.description if existing else None))
    )
    color = str(rest.get("color") or (existing.color if existing else "#3b82f6")).strip()[:16] or "#3b82f6"
    icon = (
        str(rest["icon"]).strip()[:32] or None
        if "icon" in rest and rest["icon"] is not None
        else (None if "icon" in rest else (existing.icon if existing else None))
    )
    is_default = bool(rest["is_default"]) if "is_default" in rest else bool(existing.is_default if existing else False)
    is_admin = bool(rest["is_admin"]) if "is_admin" in rest else bool(existing.is_admin if existing else False)

    vorher_team_perms = {p.permission_key for p in existing.permissions} if existing else set()
    if "team_permissions" in rest and rest["team_permissions"] is not None:
        angefragt_team = set(_team_rechte(rest["team_permissions"]))
        if modus == "merge":
            nachher_team = vorher_team_perms | angefragt_team
        elif modus == "replace":
            nachher_team = angefragt_team
        else:
            nachher_team = vorher_team_perms - angefragt_team
    else:
        nachher_team = set(vorher_team_perms)

    vorher_grants = _role_grants_map(existing) if existing else {}
    nachher_grants: dict[int, set[str]] = {sid: set(keys) for sid, keys in vorher_grants.items()}

    if rest.get("all_servers_permissions") is not None:
        all_req = set(_server_rechte(rest["all_servers_permissions"]))
        delegierbar = _delegierbare_team_server(db, team, user)
        if not delegierbar and all_req and modus != "remove":
            raise AiActionValidationError("Es sind keine delegierbaren Server für dieses Team verfügbar.")
        for srv_entry in delegierbar:
            sid = int(srv_entry["server_id"])
            erlaubt_srv = set(srv_entry["permission_keys"])
            vorher_srv = nachher_grants.get(sid, set())
            gefiltert = all_req & erlaubt_srv
            if modus == "merge":
                ziel_srv = vorher_srv | gefiltert
            elif modus == "replace":
                ziel_srv = gefiltert
            else:
                ziel_srv = vorher_srv - all_req
            ziel_srv = _mit_server_sicht(ziel_srv, modus=modus)
            if ziel_srv:
                nachher_grants[sid] = ziel_srv
            else:
                nachher_grants.pop(sid, None)

    if rest.get("server_grants") is not None:
        for eintrag in rest["server_grants"]:
            sid = kennung(eintrag.get("server_id"), "server_id")
            if not permission_service.direct_server_permission(db, user, sid, "server.view"):
                raise AiActionValidationError(f"Server #{sid} nicht gefunden oder kein direkter Zugriff.")
            req_srv = set(_server_rechte(eintrag.get("permissions")))
            vorher_srv = nachher_grants.get(sid, set())
            if modus == "merge":
                ziel_srv = vorher_srv | req_srv
            elif modus == "replace":
                ziel_srv = req_srv
            else:
                ziel_srv = vorher_srv - req_srv
            ziel_srv = _mit_server_sicht(ziel_srv, modus=modus)
            if ziel_srv:
                nachher_grants[sid] = ziel_srv
            else:
                nachher_grants.pop(sid, None)

    if is_admin:
        nachher_team = set(TEAM_KEYS)

    server_grants_payload = [
        {"server_id": sid, "permission_keys": sorted(keys)}
        for sid, keys in sorted(nachher_grants.items())
        if keys
    ]

    try:
        team_service._pruefe_server_grant_sicht(db, team, server_grants_payload)
        team_service._pruefe_rollen_deckel(
            db,
            team,
            user,
            is_admin=is_admin,
            permission_keys=sorted(nachher_team),
            server_grants=server_grants_payload,
        )
    except HTTPException as exc:
        raise _http_zu_validation(exc) from None

    if existing is None:
        duplikat = next((r for r in team_service.list_team_roles(db, team.id) if r.name.casefold() == name.casefold()), None)
        if duplikat is not None:
            raise AiActionValidationError(
                f"Eine Team-Rolle '{name}' existiert bereits (role_id={duplikat.id}); ändere sie über ihre role_id."
            )
    elif name.casefold() != existing.name.casefold():
        duplikat = next(
            (r for r in team_service.list_team_roles(db, team.id) if r.id != existing.id and r.name.casefold() == name.casefold()),
            None,
        )
        if duplikat is not None:
            raise AiActionValidationError(f"Eine Team-Rolle '{name}' existiert bereits im Team.")

    before_snapshot = None
    if existing is not None:
        before_snapshot = {
            "name": existing.name,
            "is_admin": bool(existing.is_admin),
            "is_default": bool(existing.is_default),
            "permission_keys": sorted(vorher_team_perms),
            "server_grants": [
                {"server_id": sid, "permission_keys": sorted(keys)}
                for sid, keys in sorted(vorher_grants.items())
            ],
        }

    payload = {
        "team_id": team.id,
        "role_id": role_id,
        "name": name,
        "description": description,
        "color": color,
        "icon": icon,
        "is_default": is_default,
        "is_admin": is_admin,
        "permission_keys": sorted(nachher_team),
        "server_grants": server_grants_payload,
        "before": before_snapshot,
    }
    hinzu = sorted(nachher_team - vorher_team_perms)
    weg = sorted(vorher_team_perms - nachher_team)
    preview = {
        "operation": "team_role_set",
        "team_name": _team_name(team),
        "role_name": redact_sensitive_text(name)[:32],
        "permissions_after": sorted(nachher_team),
        "permissions_added": hinzu,
        "permissions_removed": weg,
        "server_grants_summary": _summarize_grants(db, nachher_grants),
    }
    return payload, preview


def _ausfuehren_team_role_set(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    p = rahmen.payload
    team = _team_laden(db, rahmen.active_user, p["team_id"])
    role_id = p.get("role_id")
    try:
        if role_id is None:
            role = team_service.create_team_role(
                db,
                team=team,
                user=rahmen.active_user,
                name=p["name"],
                description=p.get("description"),
                color=p.get("color", "#3b82f6"),
                icon=p.get("icon"),
                is_default=bool(p.get("is_default", False)),
                is_admin=bool(p.get("is_admin", False)),
                permission_keys=list(p.get("permission_keys") or []),
                server_grants=list(p.get("server_grants") or []),
            )
        else:
            existing = team_service.get_team_role(db, team.id, int(role_id))
            before = p.get("before") or {}
            aktuell = {
                "name": existing.name,
                "is_admin": bool(existing.is_admin),
                "is_default": bool(existing.is_default),
                "permission_keys": sorted(perm.permission_key for perm in existing.permissions),
                "server_grants": [
                    {"server_id": sid, "permission_keys": sorted(keys)}
                    for sid, keys in sorted(_role_grants_map(existing).items())
                ],
            }
            if aktuell != before:
                raise AiActionStateError("AI_ACTION_REVISION_CONFLICT")
            role = team_service.update_team_role(
                db,
                team=team,
                user=rahmen.active_user,
                role_id=existing.id,
                name=p["name"],
                description=p.get("description"),
                color=p.get("color", "#3b82f6"),
                icon=p.get("icon"),
                is_default=bool(p.get("is_default", False)),
                is_admin=bool(p.get("is_admin", False)),
                permission_keys=list(p.get("permission_keys") or []),
                server_grants=list(p.get("server_grants") or []),
            )
    except HTTPException as exc:
        raise _http_zu_state(exc) from exc
    return _Ausgefuehrt(result={
        "team_id": team.id,
        "role_id": role.id,
        "role_name": redact_sensitive_text(str(role.name))[:32],
    })


# ── Team-Rolle löschen ────────────────────────────────────────────────


def _team_role_delete_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    if set(rest) - {"team_id", "role_id"}:
        raise AiActionValidationError("propose_team_role_delete hat ungueltige Argumente")
    team = _team_laden(db, user, rest.get("team_id"))
    role_id = kennung(rest.get("role_id"), "role_id")
    try:
        role = team_service.get_team_role(db, team.id, role_id)
    except HTTPException as exc:
        raise _http_zu_validation(exc) from None
    if role.is_default:
        raise AiActionValidationError("Die Standardrolle eines Teams kann nicht gelöscht werden.")
    try:
        team_service._pruefe_rollenzuteilung(db, team, user, [role])
    except HTTPException as exc:
        raise _http_zu_validation(exc) from None

    traeger = team_service._rollen_traeger(db, team.id, role.id)
    traeger_namen = []
    for m in traeger:
        u = db.get(User, m.user_id)
        if u is not None:
            traeger_namen.append(benutzername(u))

    payload = {"team_id": team.id, "role_id": role.id, "name": role.name}
    preview = {
        "operation": "team_role_delete",
        "team_name": _team_name(team),
        "role_name": redact_sensitive_text(str(role.name))[:32],
        "role_users": traeger_namen,
        "always_confirm": True,
    }
    return payload, preview


def _ausfuehren_team_role_delete(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    p = rahmen.payload
    team = _team_laden(db, rahmen.active_user, p["team_id"])
    try:
        team_service.delete_team_role(db, team=team, user=rahmen.active_user, role_id=int(p["role_id"]))
    except HTTPException as exc:
        raise _http_zu_state(exc) from exc
    return _Ausgefuehrt(result={"team_id": team.id, "role_id": int(p["role_id"]), "deleted": True})


# ── Rollen eines Teammitglieds ändern ─────────────────────────────────


def _team_member_roles_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    if set(rest) - {"team_id", "user_id", "role_ids", "mode"}:
        raise AiActionValidationError("propose_team_member_roles hat ungueltige Argumente")
    team = _team_laden(db, user, rest.get("team_id"))
    ziel_id = kennung(rest.get("user_id"), "user_id")
    ziel = db.get(User, ziel_id)
    if ziel is None:
        raise AiActionValidationError("Benutzer nicht gefunden.")
    member = team_service.membership(db, team.id, ziel_id)
    if member is None:
        raise AiActionValidationError("Benutzer ist kein Mitglied dieses Teams.")

    modus = _modus(rest.get("mode"), default="merge")
    angefragt = [kennung(rid, "role_ids") for rid in _liste(rest.get("role_ids"), "role_ids")]
    for rid in angefragt:
        try:
            team_service._rolle_im_team(db, team, rid)
        except HTTPException as exc:
            raise _http_zu_validation(exc) from None

    vorher_ids = set(team_service.get_member_role_ids(db, member.id, member.team_role_id))
    if modus == "merge":
        nachher_ids = vorher_ids | set(angefragt)
    elif modus == "replace":
        nachher_ids = set(angefragt)
    else:
        nachher_ids = vorher_ids - set(angefragt)

    if nachher_ids == vorher_ids:
        raise AiActionValidationError(f"Keine Änderung: {benutzername(ziel)} hat diese Team-Rollen bereits.")

    ziel_rollen = (
        db.query(TeamRole)
        .filter(TeamRole.team_id == team.id, TeamRole.id.in_(list(nachher_ids)))
        .all()
        if nachher_ids
        else []
    )
    try:
        team_service._pruefe_rollenzuteilung(db, team, user, ziel_rollen)
    except HTTPException as exc:
        raise _http_zu_validation(exc) from None

    rollen_namen = {
        r.id: redact_sensitive_text(str(r.name))[:32]
        for r in team_service.list_team_roles(db, team.id)
    }
    payload = {
        "team_id": team.id,
        "user_id": ziel.id,
        "role_ids": sorted(nachher_ids),
        "before": sorted(vorher_ids),
    }
    preview = {
        "operation": "team_member_roles",
        "team_name": _team_name(team),
        "target_user": benutzername(ziel),
        "roles_after": [rollen_namen.get(rid, f"#{rid}") for rid in sorted(nachher_ids)],
        "roles_added": [rollen_namen.get(rid, f"#{rid}") for rid in sorted(nachher_ids - vorher_ids)],
        "roles_removed": [rollen_namen.get(rid, f"#{rid}") for rid in sorted(vorher_ids - nachher_ids)],
    }
    return payload, preview


def _ausfuehren_team_member_roles(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    p = rahmen.payload
    team = _team_laden(db, rahmen.active_user, p["team_id"])
    ziel_id = int(p["user_id"])
    member = team_service.membership(db, team.id, ziel_id)
    if member is None:
        raise AiActionStateError("AI_ACTION_EXECUTION_FAILED")
    jetzt = set(team_service.get_member_role_ids(db, member.id, member.team_role_id))
    if jetzt != set(p.get("before") or []):
        raise AiActionStateError("AI_ACTION_REVISION_CONFLICT")
    try:
        rollen = team_service.set_member_roles(
            db, team=team, user=rahmen.active_user, member_user_id=ziel_id, role_ids=list(p["role_ids"])
        )
    except HTTPException as exc:
        raise _http_zu_state(exc) from exc
    ziel = db.get(User, ziel_id)
    return _Ausgefuehrt(result={
        "team_id": team.id,
        "user_id": ziel_id,
        "username": benutzername(ziel) if ziel else str(ziel_id),
        "role_ids": [r.id for r in rollen],
    })


# ── Mitglied einladen ─────────────────────────────────────────────────


def _team_member_invite_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    erlaubt = {"team_id", "user_id", "team_role_id"}
    if set(rest) - erlaubt:
        raise AiActionValidationError("propose_team_member_invite hat ungueltige Argumente")
    team = _team_laden(db, user, rest.get("team_id"))
    ziel_id = kennung(rest.get("user_id"), "user_id")
    ziel = db.get(User, ziel_id)
    if ziel is None or not ziel.is_active:
        raise AiActionValidationError("Benutzer nicht gefunden oder inaktiv.")
    if team_service.membership(db, team.id, ziel_id) is not None:
        raise AiActionValidationError(f"{benutzername(ziel)} ist bereits Mitglied im Team.")

    roh_role_id = rest.get("team_role_id")
    team_role_id = None if roh_role_id in (None, "", 0) else kennung(roh_role_id, "team_role_id")
    role_name: str | None = None
    if team_role_id is not None:
        try:
            rolle = team_service._rolle_im_team(db, team, team_role_id)
            team_service._pruefe_rollenzuteilung(db, team, user, [rolle])
            role_name = redact_sensitive_text(str(rolle.name))[:32]
        except HTTPException as exc:
            raise _http_zu_validation(exc) from None

    payload = {
        "team_id": team.id,
        "user_id": ziel.id,
        "team_role_id": team_role_id,
    }
    preview = {
        "operation": "team_member_invite",
        "team_name": _team_name(team),
        "target_user": benutzername(ziel),
        **({"role_name": role_name} if role_name else {}),
    }
    return payload, preview


def _ausfuehren_team_member_invite(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    p = rahmen.payload
    team = _team_laden(db, rahmen.active_user, p["team_id"])
    try:
        inv = team_service.invite_member(
            db,
            team=team,
            user=rahmen.active_user,
            new_user_id=int(p["user_id"]),
            team_role_id=p.get("team_role_id"),
        )
    except HTTPException as exc:
        raise _http_zu_state(exc) from exc
    return _Ausgefuehrt(result={"team_id": team.id, "user_id": inv.user_id, "invited": True})


# ── Mitglied entfernen ────────────────────────────────────────────────


def _team_member_remove_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    if set(rest) - {"team_id", "user_id"}:
        raise AiActionValidationError("propose_team_member_remove hat ungueltige Argumente")
    team = _team_laden(db, user, rest.get("team_id"))
    ziel_id = kennung(rest.get("user_id"), "user_id")
    if ziel_id == team.owner_user_id:
        raise AiActionValidationError("Der Teamgründer kann nicht entfernt werden.")
    ziel = db.get(User, ziel_id)
    member = team_service.membership(db, team.id, ziel_id)
    if ziel is None or member is None:
        raise AiActionValidationError("Mitglied nicht gefunden.")
    payload = {"team_id": team.id, "user_id": ziel.id}
    preview = {
        "operation": "team_member_remove",
        "team_name": _team_name(team),
        "target_user": benutzername(ziel),
        "always_confirm": True,
    }
    return payload, preview


def _ausfuehren_team_member_remove(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    p = rahmen.payload
    team = _team_laden(db, rahmen.active_user, p["team_id"])
    try:
        team_service.remove_member(db, team=team, user=rahmen.active_user, member_user_id=int(p["user_id"]))
    except HTTPException as exc:
        raise _http_zu_state(exc) from exc
    return _Ausgefuehrt(result={"team_id": team.id, "user_id": int(p["user_id"]), "removed": True})


# ── Teamweite Serverrechte & Server-Rollenmodus ───────────────────────


def _team_server_grants_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    erlaubt = {"team_id", "server_id", "all_servers", "permissions", "mode", "server_roles_active"}
    if set(rest) - erlaubt:
        raise AiActionValidationError("propose_team_server_grants hat ungueltige Argumente")
    team = _team_laden(db, user, rest.get("team_id"))
    has_mode_toggle = "server_roles_active" in rest and rest["server_roles_active"] is not None
    all_servers = bool(rest.get("all_servers", False))
    raw_server_id = rest.get("server_id")
    has_grants_change = all_servers or raw_server_id not in (None, "", 0) or rest.get("permissions") is not None

    if not has_mode_toggle and not has_grants_change:
        raise AiActionValidationError("Mindestens Serverrechte oder server_roles_active angeben.")
    if has_mode_toggle and not team_service._ist_team_gruender(team, user):
        raise AiActionValidationError("Nur der Teamgründer darf den Rollenmodus für Serverrechte umschalten.")

    next_roles_active = bool(rest["server_roles_active"]) if has_mode_toggle else None
    grants_payload: list[dict] = []
    before_map: dict[str, list[str]] = {}
    summary_map: dict[int, set[str]] = {}

    if has_grants_change:
        modus = _modus(rest.get("mode"), default="merge")
        req_keys = set(_server_rechte(rest.get("permissions")))
        if all_servers:
            delegierbar = _delegierbare_team_server(db, team, user)
            if not delegierbar:
                raise AiActionValidationError("Keine delegierbaren Server für dieses Team gefunden.")
            targets = [(int(item["server_id"]), set(item["permission_keys"])) for item in delegierbar]
        else:
            sid = kennung(raw_server_id, "server_id")
            if not permission_service.direct_server_permission(db, user, sid, "server.view"):
                raise AiActionValidationError("Server nicht gefunden oder kein direkter Zugriff.")
            targets = [(sid, set(SERVER_KEYS))]

        founder = db.get(User, team.owner_user_id)
        for sid, erlaubt_srv in targets:
            vorher = set(team_service.team_server_keys(db, team.id, sid))
            before_map[str(sid)] = sorted(vorher)
            if modus == "merge":
                nachher = vorher | (req_keys & erlaubt_srv)
            elif modus == "replace":
                nachher = req_keys & erlaubt_srv
            else:
                nachher = vorher - req_keys
            nachher = _mit_server_sicht(nachher, modus=modus)
            for k in sorted(nachher):
                if not permission_service.direct_server_permission(db, user, sid, k):
                    raise AiActionValidationError(f"Du hältst '{k}' auf Server #{sid} nicht direkt.")
                if founder and founder.id != user.id and not permission_service.direct_server_permission(db, founder, sid, k):
                    raise AiActionValidationError(f"Der Teamgründer hält '{k}' auf Server #{sid} nicht direkt.")
            grants_payload.append({"server_id": sid, "permission_keys": sorted(nachher)})
            if nachher:
                summary_map[sid] = nachher

    payload = {
        "team_id": team.id,
        "grants": grants_payload,
        "before": before_map,
        "server_roles_active": next_roles_active,
        "before_server_roles_active": bool(team.server_roles_active),
    }
    preview = {
        "operation": "team_server_grants",
        "team_name": _team_name(team),
        "server_grants_summary": _summarize_grants(db, summary_map),
        **({"servers_updated": len(grants_payload)} if grants_payload else {}),
        **({"server_roles_active": next_roles_active} if next_roles_active is not None else {}),
    }
    return payload, preview


def _ausfuehren_team_server_grants(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    p = rahmen.payload
    team = _team_laden(db, rahmen.active_user, p["team_id"])
    if p.get("server_roles_active") is not None:
        if bool(team.server_roles_active) != bool(p.get("before_server_roles_active")):
            raise AiActionStateError("AI_ACTION_REVISION_CONFLICT")
        try:
            team = team_service.set_server_roles_active(
                db, team=team, user=rahmen.active_user, active=bool(p["server_roles_active"])
            )
        except HTTPException as exc:
            raise _http_zu_state(exc) from exc

    grants = list(p.get("grants") or [])
    if grants:
        before_map = p.get("before") or {}
        for entry in grants:
            sid = int(entry["server_id"])
            jetzt = team_service.team_server_keys(db, team.id, sid)
            if jetzt != list(before_map.get(str(sid)) or []):
                raise AiActionStateError("AI_ACTION_REVISION_CONFLICT")
        try:
            team_service.set_server_grants_batch(
                db, team=team, user=rahmen.active_user, grants=grants
            )
        except HTTPException as exc:
            raise _http_zu_state(exc) from exc

    return _Ausgefuehrt(result={
        "team_id": team.id,
        "servers_updated": len(grants),
        "server_roles_active": bool(team.server_roles_active),
    })
