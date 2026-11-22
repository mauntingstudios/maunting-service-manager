"""DIS-verschluesselte Pro-Server-Konfiguration fuer Blueprint-Variablen."""

from __future__ import annotations

import math
import re
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from blueprints.schema import Blueprint, BlueprintVariable, BlueprintVariableType
from games import get_plugin
from models import Server
from schemas.server import (
    ServerVariableItemOut,
    ServerVariableOptionOut,
    ServerVariablesResponse,
    ServerVariablesUpdateResponse,
)
from services.server_runtime_env import get_probe_url, get_runtime_env, set_runtime_env

_MAX_VAR_VALUE_LEN = 2048
_MAX_GIT_URL_LEN = 512


class ServerVariableValidationError(ValueError):
    """Validierungs- oder Berechtigungsfehler bei Server-Variablen."""

    def __init__(self, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


def _resolve_blueprint(server: Server) -> Blueprint | None:
    plugin = get_plugin(server.game_type)
    if plugin is None or not hasattr(plugin, "get_blueprint"):
        return None
    try:
        return plugin.get_blueprint()
    except Exception:
        return None


def _validate_git_url(raw_url: str, label: str) -> str:
    cleaned = raw_url.strip()
    if not cleaned:
        return ""
    if len(cleaned) > _MAX_GIT_URL_LEN:
        raise ServerVariableValidationError(
            f"'{label}': Repository-URL ist zu lang (maximal {_MAX_GIT_URL_LEN} Zeichen)."
        )
    if any(ch.isspace() for ch in cleaned):
        raise ServerVariableValidationError(
            f"'{label}': Repository-URL darf keine Leerzeichen enthalten."
        )
    parsed = urlparse(cleaned)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ServerVariableValidationError(
            f"'{label}': Nur gueltige https://-Repository-URLs sind erlaubt."
        )
    if parsed.username or parsed.password:
        raise ServerVariableValidationError(
            f"'{label}': Zugangsdaten in der URL sind nicht erlaubt (nutze stattdessen separate Secrets)."
        )
    return cleaned


def _validate_value_for_variable(var: BlueprintVariable, raw_val: str) -> str:
    if "\x00" in raw_val or "\r" in raw_val or "\n" in raw_val:
        raise ServerVariableValidationError(
            f"'{var.label}': Wert darf keine Zeilenumbrueche oder Steuerzeichen enthalten."
        )
    if len(raw_val) > _MAX_VAR_VALUE_LEN:
        raise ServerVariableValidationError(
            f"'{var.label}': Wert ueberschreitet das Limit von {_MAX_VAR_VALUE_LEN} Zeichen."
        )

    vtype = var.type
    if vtype == BlueprintVariableType.SECRET:
        if var.required and raw_val == "":
            raise ServerVariableValidationError(f"'{var.label}' ist ein Pflichtfeld.")
        if var.pattern and raw_val != "" and not re.fullmatch(var.pattern, raw_val):
            raise ServerVariableValidationError(
                f"'{var.label}' entspricht nicht dem erwarteten Format."
            )
        return raw_val

    cleaned = raw_val.strip()

    if vtype == BlueprintVariableType.BOOLEAN:
        low = cleaned.lower()
        if low not in {"true", "false"}:
            raise ServerVariableValidationError(
                f"'{var.label}' erwartet 'true' oder 'false'."
            )
        return low

    if vtype == BlueprintVariableType.NUMBER:
        if not cleaned:
            if var.required:
                raise ServerVariableValidationError(f"'{var.label}' ist ein Pflichtfeld.")
            return ""
        try:
            num = float(cleaned)
        except ValueError as exc:
            raise ServerVariableValidationError(
                f"'{var.label}' muss eine gueltige Zahl sein."
            ) from exc
        if not math.isfinite(num):
            raise ServerVariableValidationError(
                f"'{var.label}' muss eine endliche Zahl sein."
            )
        if var.min is not None and num < var.min:
            raise ServerVariableValidationError(
                f"'{var.label}' muss mindestens {var.min:g} sein."
            )
        if var.max is not None and num > var.max:
            raise ServerVariableValidationError(
                f"'{var.label}' darf hoechstens {var.max:g} sein."
            )
        if var.pattern and not re.fullmatch(var.pattern, cleaned):
            raise ServerVariableValidationError(
                f"'{var.label}' entspricht nicht dem erwarteten Zahlenformat."
            )
        return cleaned

    if vtype == BlueprintVariableType.SELECT:
        allowed_values = {opt.value for opt in var.options}
        if not cleaned:
            if var.required:
                raise ServerVariableValidationError(f"'{var.label}' ist ein Pflichtfeld.")
            return ""
        if cleaned not in allowed_values and not var.allowCustom:
            raise ServerVariableValidationError(
                f"Ungueltige Auswahl '{cleaned}' fuer '{var.label}'."
            )
        if var.pattern and not re.fullmatch(var.pattern, cleaned):
            raise ServerVariableValidationError(
                f"'{var.label}' enthaelt nicht erlaubte Zeichen."
            )
        return cleaned

    if vtype == BlueprintVariableType.GIT_URL:
        git_url = _validate_git_url(cleaned, var.label)
        if var.required and not git_url:
            raise ServerVariableValidationError(f"'{var.label}' ist ein Pflichtfeld.")
        if var.pattern and git_url and not re.fullmatch(var.pattern, git_url):
            raise ServerVariableValidationError(
                f"'{var.label}' entspricht nicht dem erwarteten URL-Format."
            )
        return git_url

    # STRING
    if var.required and not cleaned:
        raise ServerVariableValidationError(f"'{var.label}' ist ein Pflichtfeld.")
    if var.pattern and cleaned and not re.fullmatch(var.pattern, cleaned):
        raise ServerVariableValidationError(
            f"'{var.label}' enthaelt nicht erlaubte Zeichen."
        )
    return cleaned


def _item_response(
    var: BlueprintVariable,
    *,
    stored_env: dict[str, str],
    runtime_env: dict[str, str],
) -> ServerVariableItemOut:
    has_override = var.key in stored_env
    default_val = str(runtime_env.get(var.key, var.default))
    effective_val = str(stored_env[var.key]) if has_override else default_val
    is_secret = var.type == BlueprintVariableType.SECRET
    return ServerVariableItemOut(
        key=var.key,
        label=var.label,
        description=var.description,
        group=var.group,
        type=var.type.value,
        default="" if is_secret else default_val,
        value="" if is_secret else effective_val,
        is_set=bool(effective_val),
        has_override=has_override,
        options=[
            ServerVariableOptionOut(
                value=opt.value,
                label=opt.label,
                badge=opt.badge,
            )
            for opt in var.options
        ],
        allow_custom=var.allowCustom,
        placeholder=var.placeholder,
        required=var.required,
        customer_editable=var.customerEditable,
        min=var.min,
        max=var.max,
        pattern=var.pattern,
        requires_restart=var.requiresRestart,
    )


def get_server_variables(db: Session, server: Server) -> ServerVariablesResponse:
    """Liest alle Blueprint-Variablen inkl. DIS-verschluesselter Server-Overrides."""
    blueprint = _resolve_blueprint(server)
    is_running = (server.status or "").lower() == "running"
    if blueprint is None:
        return ServerVariablesResponse(
            server_id=server.id,
            game_type=server.game_type,
            blueprint_name=server.game_type,
            has_variables=False,
            is_running=is_running,
            source_type=None,
            upload_hint=None,
            variables=[],
        )

    stored_env = get_runtime_env(server.id, db=db) or {}
    runtime_env = dict(blueprint.runtime.env or {})
    items = [
        _item_response(var, stored_env=stored_env, runtime_env=runtime_env)
        for var in blueprint.variables
    ]
    upload_hint = (
        blueprint.source.manual.instructions
        if blueprint.source.manual is not None
        else None
    )
    return ServerVariablesResponse(
        server_id=server.id,
        game_type=server.game_type,
        blueprint_name=blueprint.meta.name,
        has_variables=len(items) > 0,
        is_running=is_running,
        source_type=blueprint.source.type.value,
        upload_hint=upload_hint,
        variables=items,
    )


def update_server_variables(
    db: Session,
    server: Server,
    values: dict[str, str | None],
    *,
    is_operator: bool = False,
) -> ServerVariablesUpdateResponse:
    """Validiert und speichert Variablen-Overrides DIS-verschluesselt pro Server."""
    blueprint = _resolve_blueprint(server)
    if blueprint is None or not blueprint.variables:
        if values:
            raise ServerVariableValidationError(
                "Fuer diesen Servertyp sind keine Start-Variablen definiert."
            )
        return ServerVariablesUpdateResponse(
            variables=get_server_variables(db, server),
            changed_keys=[],
            restart_recommended=False,
        )

    by_key = {var.key: var for var in blueprint.variables}
    runtime_env = dict(blueprint.runtime.env or {})
    existing_env = dict(get_runtime_env(server.id, db=db) or {})
    merged_env = dict(existing_env)
    changed_keys: list[str] = []
    restart_recommended = False

    for key, raw_val in values.items():
        if key not in by_key:
            raise ServerVariableValidationError(f"Unbekannte Variable '{key}'.")
        var = by_key[key]
        if not var.customerEditable and not is_operator:
            raise ServerVariableValidationError(
                f"Variable '{var.label}' darf nur von Administratoren geaendert werden.",
                status_code=403,
            )

        if raw_val is None:
            fallback_val = str(runtime_env.get(key, var.default))
            if var.required and not fallback_val:
                raise ServerVariableValidationError(
                    f"'{var.label}' ist ein Pflichtfeld und kann nicht geleert werden."
                )
            if key in merged_env:
                del merged_env[key]
                changed_keys.append(key)
                if var.requiresRestart:
                    restart_recommended = True
            continue

        if var.type == BlueprintVariableType.SECRET and raw_val == "":
            # Leeres Secret im Request bedeutet "unveraendert belassen";
            # explizites Loeschen erfolgt ueber null.
            continue

        normalized = _validate_value_for_variable(var, raw_val)
        old_val = existing_env.get(key)
        default_val = str(runtime_env.get(key, var.default))

        # Wenn der Wert dem Blueprint-Standard entspricht, Override entfernen
        # (ausser bei Secrets, wenn dort explizit ein Wert gesetzt wird).
        if not (var.type == BlueprintVariableType.SECRET) and normalized == default_val:
            if key in merged_env:
                del merged_env[key]
                changed_keys.append(key)
                if var.requiresRestart:
                    restart_recommended = True
        elif old_val != normalized:
            merged_env[key] = normalized
            changed_keys.append(key)
            if var.requiresRestart:
                restart_recommended = True

    if changed_keys:
        set_runtime_env(
            server.id,
            merged_env,
            probe_url=get_probe_url(server.id, db=db),
            managed_by="variables",
            db=db,
        )

    response = get_server_variables(db, server)
    return ServerVariablesUpdateResponse(
        variables=response,
        changed_keys=changed_keys,
        restart_recommended=restart_recommended and response.is_running,
    )
