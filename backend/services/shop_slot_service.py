"""Slot-Steuerung ueber Blueprint-Ziele (`players`), `config_wishes` und Runtime-Env.

Schreibt gebuchte oder geaenderte Spieler-Slots an das im Blueprint deklarierte
Ziel: INI- oder Regex-Wunsch auf ``server.config_wishes_json`` (ueberlebt
Server-Autosaves und reist auf Remote-Nodes mit ``prepare_runtime`` mit) oder
verschluesselte Umgebungsvariable via ``ServerRuntimeEnv``.
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from blueprints.registry import get_registry
from blueprints.schema import BlueprintPlayers
from models import Server, ShopEntitlement
from services import server_config_wishes, server_runtime_env


class SlotConfigurationError(ValueError):
    """Ungueltige Slot-Anforderung; wird am API-Rand auf HTTP 422 abgebildet."""


def get_blueprint_players(game_type: str) -> BlueprintPlayers | None:
    """Liefert das ``players``-Schema des Blueprints oder ``None``."""
    entry = get_registry().get(game_type)
    if entry is None:
        return None
    return getattr(entry.blueprint, "players", None)


def _extract_regex_slots(replacement_template: str, actual_replacement: str) -> int | None:
    parts = replacement_template.split("{SLOTS}", 1)
    if len(parts) != 2:
        return None
    pattern = f"^{re.escape(parts[0])}(\\d+){re.escape(parts[1])}$"
    match = re.fullmatch(pattern, actual_replacement)
    if not match:
        return None
    return int(match.group(1))


def read_configured_slots(db: Session, server: Server) -> int | None:
    """Liest den zuletzt gesetzten Slot-Wert des Servers (oder Entitlement-Wert)."""
    players = get_blueprint_players(server.game_type)
    if players is not None:
        target = players.configTarget
        wishes = server_config_wishes.lese(getattr(server, "config_wishes_json", None))
        if target.type == "ini" and target.file and target.section and target.key:
            for wish in wishes:
                if (
                    wish.art == server_config_wishes.ART_INI
                    and wish.datei.casefold() == target.file.casefold()
                    and wish.sektion.casefold() == target.section.casefold()
                    and wish.schluessel.casefold() == target.key.casefold()
                    and wish.wert.isdigit()
                ):
                    return int(wish.wert)
        elif target.type == "regex" and target.file and target.regex and target.replacement:
            for wish in wishes:
                if (
                    wish.art == server_config_wishes.ART_REGEX
                    and wish.datei.casefold() == target.file.casefold()
                    and wish.finde == target.regex
                ):
                    parsed = _extract_regex_slots(target.replacement, wish.setze)
                    if parsed is not None:
                        return parsed
        elif target.type == "env" and target.key:
            env = server_runtime_env.get_runtime_env(server.id, db=db)
            raw = env.get(target.key)
            if raw and raw.isdigit():
                return int(raw)

    ent = (
        db.query(ShopEntitlement)
        .filter(
            ShopEntitlement.server_id == server.id,
            ShopEntitlement.status == "active",
            ShopEntitlement.slots.isnot(None),
        )
        .order_by(ShopEntitlement.id.desc())
        .first()
    )
    return ent.slots if ent is not None else None


def apply_server_slots(
    db: Session,
    server: Server,
    slots: int,
    *,
    commit_env: bool = True,
) -> dict[str, int | str | bool | None]:
    """Schreibt gebuchte oder geaenderte Slots in das Blueprint-Konfigurationsziel."""
    players = get_blueprint_players(server.game_type)
    if players is None:
        raise SlotConfigurationError(
            "Dieser Blueprint unterstuetzt keine konfigurierbaren Spieler-Slots"
        )
    if not (players.min <= slots <= players.max):
        raise SlotConfigurationError(
            f"Spieler-Slots muessen zwischen {players.min} und {players.max} liegen"
        )

    previous_slots = read_configured_slots(db, server)
    target = players.configTarget
    slot_text = str(int(slots))

    if target.type == "ini":
        assert target.file and target.section and target.key
        server.config_wishes_json = server_config_wishes.setze(
            server.config_wishes_json,
            datei=target.file,
            eintraege=[(target.section, target.key, slot_text)],
        )
        db.flush()
    elif target.type == "regex":
        assert target.file and target.regex and target.replacement
        ersatz = target.replacement.replace("{SLOTS}", slot_text)
        server.config_wishes_json = server_config_wishes.setze_regex(
            server.config_wishes_json,
            datei=target.file,
            muster=target.regex,
            ersatz=ersatz,
        )
        db.flush()
    elif target.type == "env":
        assert target.key
        env = server_runtime_env.get_runtime_env(server.id, db=db)
        env[target.key] = slot_text
        server_runtime_env.set_runtime_env(
            server.id,
            env,
            managed_by="shop_slots",
            db=db,
            commit=commit_env,
        )

    return {
        "server_id": server.id,
        "slots": int(slots),
        "previous_slots": previous_slots,
        "target_type": target.type,
        "downgrade_warning": bool(previous_slots is not None and slots < previous_slots),
        "restart_required": server.status == "running",
    }
