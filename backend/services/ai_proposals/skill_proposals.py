"""Vorschlag und Ausfuehrung fuer den Bestaetigungs-Import externer Skills (`propose_skill_import`)."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import AiSkill, User
from services import ai_skill_service, github_skill_service, team_service
from services.ai_action_errors import AiActionValidationError
from services.ai_proposals.base import _Ausgefuehrt, _AusfuehrungsRahmen

_SKILL_IMPORT_FELDER = frozenset({
    "skill_key",
    "name",
    "description",
    "body",
    "scope",
    "team",
    "always_active",
    "source_url",
    "disable_always_active_key",
})
_PERSONAL_ALIASES = frozenset({"persoenlich", "persönlich", "personal"})


def _resolve_target_scope(
    db: Session,
    user: User,
    *,
    scope: object,
    team_name: object,
) -> tuple[int | None, str]:
    if scope not in {"team", "global"}:
        raise AiActionValidationError("scope muss 'team' oder 'global' sein")

    if scope == "global":
        try:
            ai_skill_service.assert_may_write(db, user, None)
        except HTTPException as exc:
            raise AiActionValidationError(str(exc.detail)) from exc
        return None, "Panelweit"

    wanted = str(team_name).strip() if isinstance(team_name, str) and team_name.strip() else None
    if wanted and wanted.casefold() in _PERSONAL_ALIASES:
        personal = team_service.personal_team(db, user)
        try:
            ai_skill_service.assert_may_write(db, user, personal.id)
        except HTTPException as exc:
            raise AiActionValidationError(str(exc.detail)) from exc
        return personal.id, "Persönlich"

    target, question = team_service.learning_team(
        db,
        user,
        schalter="skills",
        wunsch=wanted,
    )
    if target is None:
        raise AiActionValidationError(
            question or "Kein beschreibbares Team gefunden. Bitte klaere mit dem Benutzer, in welches Team der Skill soll."
        )
    try:
        ai_skill_service.assert_may_write(db, user, target.id)
    except HTTPException as exc:
        raise AiActionValidationError(str(exc.detail)) from exc
    label = "Persönlich" if target.is_personal else f"Team: {target.name}"
    return target.id, label


def _find_demotable_always_active(
    db: Session, user: User, demote_key: str
) -> AiSkill:
    match_view = next(
        (
            item
            for item in ai_skill_service.visible_skills(db, user)
            if item.skill_key == demote_key and item.always_active and item.id is not None
        ),
        None,
    )
    row = db.get(AiSkill, match_view.id) if match_view is not None and match_view.id else None
    if row is None:
        raise AiActionValidationError(
            f"Abzuloesender Always-Active-Skill '{demote_key}' nicht gefunden."
        )
    ai_skill_service.assert_may_write(db, user, row.team_id)
    return row


def _skill_import_payload(db: Session, user: User, rest: dict) -> tuple[dict, dict]:
    if set(rest) - _SKILL_IMPORT_FELDER:
        raise AiActionValidationError("Skill-Import hat ungueltige Argumente")

    for field in ("skill_key", "name", "description", "body"):
        if not isinstance(rest.get(field), str) or not rest[field].strip():
            raise AiActionValidationError(f"Skill-Feld '{field}' fehlt oder ist leer")

    team_id, scope_label = _resolve_target_scope(
        db, user, scope=rest.get("scope"), team_name=rest.get("team")
    )

    always_active = bool(rest.get("always_active", False))
    demote_raw = rest.get("disable_always_active_key")
    clean_demote_key: str | None = None
    if isinstance(demote_raw, str) and demote_raw.strip():
        clean_demote_key = demote_raw.strip().lower()

    source_raw = rest.get("source_url")
    source_url: str | None = None
    if isinstance(source_raw, str) and source_raw.strip():
        try:
            github_skill_service.parse_github_skill_url(source_raw.strip())
        except HTTPException as exc:
            raise AiActionValidationError(str(exc.detail)) from exc
        source_url = source_raw.strip()[:500]

    try:
        key = ai_skill_service._normalized_key(str(rest["skill_key"]))
        name = ai_skill_service._safe_text(str(rest["name"]), ai_skill_service.MAX_NAME_CHARS, "Skill-Name")
        description = ai_skill_service._safe_text(
            str(rest["description"]), ai_skill_service.MAX_DESCRIPTION_CHARS, "Skill-Beschreibung"
        )
        body = ai_skill_service._safe_text(str(rest["body"]), ai_skill_service.MAX_BODY_CHARS, "Skill-Text")
        if clean_demote_key is not None:
            _find_demotable_always_active(db, user, clean_demote_key)
        if always_active:
            exclude = (key, clean_demote_key) if clean_demote_key else (key,)
            ai_skill_service._assert_always_active_limit(db, user, exclude_skill_keys=exclude)
    except HTTPException as exc:
        raise AiActionValidationError(str(exc.detail)) from exc

    payload = {
        "skill_key": key,
        "name": name,
        "description": description,
        "body": body,
        "scope": str(rest["scope"]),
        "team_id": team_id,
        "always_active": always_active,
        "source_url": source_url,
        "disable_always_active_key": clean_demote_key,
    }
    mode_label = "Immer aktiv im Kontext" if always_active else "Nur bei Bedarf"
    preview = {
        "operation": "skill_import",
        "skill_key": key,
        "name": name,
        "description": description,
        "scope_label": scope_label,
        "mode_label": mode_label,
        "always_active": always_active,
        "source_url": source_url,
        "disable_always_active_key": clean_demote_key,
        "body_preview": body[:400] + ("..." if len(body) > 400 else ""),
    }
    return payload, preview


def _ausfuehren_skill_import(db: Session, rahmen: _AusfuehrungsRahmen) -> _Ausgefuehrt:
    p = rahmen.payload
    team_id = p.get("team_id")
    ai_skill_service.assert_may_write(db, rahmen.active_user, team_id)

    demote_key = p.get("disable_always_active_key")
    if isinstance(demote_key, str) and demote_key:
        demote_row = _find_demotable_always_active(db, rahmen.active_user, demote_key)
        ai_skill_service.set_always_active(
            db,
            user=rahmen.active_user,
            skill_id=demote_row.id,
            always_active=False,
            commit=False,
        )

    row = ai_skill_service.upsert_skill(
        db,
        user=rahmen.active_user,
        skill_key=str(p["skill_key"]),
        name=str(p["name"]),
        description=str(p["description"]),
        body=str(p["body"]),
        team_id=team_id,
        origin="operator",
        status="active",
        enabled=True,
        always_active=bool(p.get("always_active", False)),
        commit=False,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AiActionValidationError("Skill wurde parallel geaendert. Bitte erneut versuchen.") from exc
    db.refresh(row)

    return _Ausgefuehrt(
        result={
            "imported": True,
            "skill_id": row.id,
            "skill_key": row.skill_key,
            "name": row.name,
            "scope": "global" if row.team_id is None else "team",
            "team_id": row.team_id,
            "always_active": row.always_active,
        }
    )
