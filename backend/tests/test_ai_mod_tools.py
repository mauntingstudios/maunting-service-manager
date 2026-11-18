"""Mod-Werkzeuge der KI: lesen, Updates erkennen, Installation vorschlagen.

Zielpunkt 3.1 nennt Modverwaltung ausdruecklich als KI-Aufgabe. Zielpunkt 16
zieht die Grenze: externe Inhalte duerfen nicht ungeprueft in Serververzeichnisse
geschrieben werden. Beides zusammen bedeutet, dass die KI den vorhandenen
Installationspfad benutzt statt einen eigenen zu bekommen.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models import (
    AiActionProposal,
    AiConversation,
    Mod,
    Role,
    RolePermission,
    Server,
    ServerPermission,
    User,
)
from services import ai_action_errors, ai_action_service, ai_proposal_service
from services.role_service import set_user_roles


def _setup(db: Session, user: User, *, server_keys: tuple[str, ...]) -> tuple[Server, AiConversation]:
    role = Role(name=f"mods-{user.id}", description=None, is_system=False)
    db.add(role)
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_key="ai.chat.use"))
    db.commit()
    set_user_roles(db, user, [role.id])

    server = Server(
        name="Mod Server",
        game_type="dayz",
        install_dir="/tmp/mod-server",
        container_name="msm-mod-server",
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    for key in server_keys:
        db.add(ServerPermission(user_id=user.id, server_id=server.id, permission_key=key))
    conversation = AiConversation(
        id=str(uuid4()), user_id=user.id, server_id=server.id, title="Mods"
    )
    db.add(conversation)
    db.commit()
    return server, conversation


def _install_arguments(server_id: int = 0, **overrides) -> dict:
    """Argumente eines Mod-Vorschlags samt `server_id`.

    Der Serverbezug haengt seit dem Einzelchat am Werkzeugaufruf und nicht mehr
    an der Unterhaltung.
    """
    values = {
        "server_id": server_id,
        "workshop_id": "1559212036",
        "action": "install",
        "reason": "Der Server startet ohne diese Abhaengigkeit nicht.",
        "expected_effect": "Nach dem Neustart laedt der Server die Mod.",
    }
    values.update(overrides)
    return values


def test_reading_mods_requires_the_mod_read_permission(
    db: Session, regular_user: User
) -> None:
    server, conversation = _setup(db, regular_user, server_keys=("server.view",))

    with pytest.raises(ai_action_errors.AiActionValidationError):
        ai_action_service.execute_read_tool(
            db,
            user=regular_user,
            tool_name="read_server_mods",
            arguments={"server_id": server.id},
        )


def test_reading_mods_returns_status_without_secrets(
    db: Session, regular_user: User
) -> None:
    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    db.add(Mod(
        server_id=server.id,
        workshop_id="1559212036",
        name="CF",
        enabled=True,
        install_status="installed",
        update_status="outdated",
        update_reason="remote_newer",
        load_order=1,
    ))
    db.commit()

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="read_server_mods",
        arguments={"server_id": server.id},
    )

    assert result["mods"][0]["workshop_id"] == "1559212036"
    assert result["mods"][0]["update_status"] == "outdated"
    assert result["mods"][0]["update_reason"] == "remote_newer"


def test_mod_install_without_write_permission_is_rejected(
    db: Session, regular_user: User
) -> None:
    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )

    with pytest.raises(ai_action_errors.AiActionValidationError):
        ai_proposal_service.create_proposal(
            db,
            user=regular_user,
            conversation=conversation,
            tool_name="propose_mod_install",
            arguments=_install_arguments(server.id),
            correlation_id=str(uuid4()),
        )
    assert db.query(AiActionProposal).count() == 0


def test_a_non_numeric_workshop_id_is_rejected(
    db: Session, regular_user: User
) -> None:
    """Die Kennung geht in einen Downloadpfad — sie muss rein numerisch sein."""
    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read", "server.mods.write")
    )

    for bad in ("../../etc/passwd", "12a", "", "1" * 21):
        with pytest.raises(ai_action_errors.AiActionValidationError):
            ai_proposal_service.create_proposal(
                db,
                user=regular_user,
                conversation=conversation,
                tool_name="propose_mod_install",
                arguments=_install_arguments(server.id, workshop_id=bad),
                correlation_id=str(uuid4()),
            )


def test_mod_install_proposal_needs_confirmation_and_shows_a_preview(
    db: Session, regular_user: User
) -> None:
    import json

    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read", "server.mods.write")
    )

    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_install",
        arguments=_install_arguments(server.id),
        correlation_id=str(uuid4()),
    )
    db.commit()

    assert proposal.requires_confirmation is True
    preview = json.loads(proposal.preview_json)
    assert preview["operation"] == "mod_install"
    assert preview["workshop_id"] == "1559212036"
    assert preview["already_installed"] is False
    # Eine Mod wirkt erst nach einem Neustart — das gehoert in die Vorschau.
    assert preview["restart_required"] is True


def test_execution_uses_the_existing_install_path(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Zielpunkt 16: kein eigener Downloadbereich fuer die KI.

    Ausgefuehrt wird `install_mod_bg` — derselbe Code mit demselben
    Install-Lock, den auch der Mod-Tab des Panels ausloest.
    """
    started: list[tuple] = []

    class _Thread:
        def __init__(self, *, target, args, daemon, name):
            started.append((target, args))

        def start(self) -> None:
            return None

    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read", "server.mods.write")
    )
    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_install",
        arguments=_install_arguments(server.id),
        correlation_id=str(uuid4()),
    )
    db.commit()
    monkeypatch.setattr("threading.Thread", _Thread)

    _, token = ai_proposal_service.confirm_proposal(
        db, proposal_id=proposal.id, user=regular_user
    )
    executed, result = ai_proposal_service.execute_proposal(
        db, proposal_id=proposal.id, user=regular_user, confirmation_token=token
    )

    assert len(started) == 1
    target, args = started[0]
    from routers.mods import install_mod_bg

    assert target is install_mod_bg
    assert args == (server.id, "1559212036", "install")
    assert result["installation"] == "running"
    assert executed.status == "succeeded"
    # Die Mod-Zeile existiert und traegt den laufenden Vorgang.
    assert db.query(Mod).filter(Mod.server_id == server.id).count() == 1


def test_a_running_installation_blocks_a_second_one(
    db: Session, regular_user: User
) -> None:
    from services.mod_install_status_service import INSTALL_RUNNING

    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read", "server.mods.write")
    )
    db.add(Mod(
        server_id=server.id,
        workshop_id="1559212036",
        install_status=INSTALL_RUNNING,
    ))
    db.commit()
    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_install",
        arguments=_install_arguments(server.id, action="update"),
        correlation_id=str(uuid4()),
    )
    db.commit()

    _, token = ai_proposal_service.confirm_proposal(
        db, proposal_id=proposal.id, user=regular_user
    )
    with pytest.raises(ai_action_errors.AiActionStateError) as excinfo:
        ai_proposal_service.execute_proposal(
            db, proposal_id=proposal.id, user=regular_user, confirmation_token=token
        )

    assert excinfo.value.code == "AI_ACTION_SERVER_BUSY"


def test_workshop_search_reports_a_missing_api_key_honestly(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Eine leere Trefferliste waere hier eine falsche Aussage ueber den Workshop."""
    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    monkeypatch.setattr("services.steam_api_key_service.resolve_key", lambda: None)

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="search_workshop_mods",
        arguments={"server_id": server.id, "query": "cf"},
    )

    assert result["available"] is False
    assert result["reason"] in {"steam_api_key_missing", "workshop_id_missing", "mods_not_supported"}
    assert "results" not in result


def test_die_workshop_anfrage_verlaesst_das_panel_geschwaerzt(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Der zweite Ausgang neben `web_search` — und er stand offen.

    Der Suchbegriff ist reine Modellausgabe und geht als URL-Parameter an
    Steam, wo er protokolliert wird. Das Modell hat vorher Konfigurationsdateien
    und Logs gelesen; eine Zuweisung daraus kann es woertlich uebernehmen.
    `web_search` schwaerzt deshalb vor dem Absenden — `search_workshop_mods`
    reichte die Anfrage unveraendert durch, und der Choke Point greift erst auf
    dem Rueckweg.
    """
    server, _conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    gesehen: list[str] = []

    def _suche(*, appid, query, page, required_tags):
        gesehen.append(query)
        return []

    monkeypatch.setattr("services.mod_update_service.search_workshop", _suche)

    ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="search_workshop_mods",
        arguments={
            "server_id": server.id,
            "query": "ServerAdminPassword=Maik1234 base building",
        },
    )

    assert gesehen == ["ServerAdminPassword=[REDACTED] base building"]
    # Die Schwaerzung ist wertbezogen: der Einstellungsname als Wort ueberlebt
    # sie, sonst waere die Suche fuer ihren haeufigsten Zweck unbrauchbar.
    assert "ServerAdminPassword" in gesehen[0]

    # Und die Laenge, die das Schema verspricht, gilt auch dann, wenn das
    # Modell sich nicht daran haelt: ein Schema ist eine Bitte, keine Schranke.
    gesehen.clear()
    ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="search_workshop_mods",
        arguments={"server_id": server.id, "query": "a" * 300},
    )
    assert len(gesehen[0]) == ai_action_service.MAX_SEARCH_QUERY_CHARS


def test_mod_install_proposal_with_name_stores_mod_name(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    started: list[tuple] = []

    class _Thread:
        def __init__(self, *, target, args, daemon, name):
            started.append((target, args))

        def start(self) -> None:
            return None

    monkeypatch.setattr("threading.Thread", _Thread)

    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read", "server.mods.write")
    )
    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_install",
        arguments=_install_arguments(
            server.id,
            workshop_id="927142",
            name="Moros Indomitable Duo",
        ),
        correlation_id=str(uuid4()),
    )
    db.commit()

    preview = json.loads(proposal.preview_json)
    assert preview["workshop_id"] == "927142"
    assert preview["known_name"] == "Moros Indomitable Duo"

    _, token = ai_proposal_service.confirm_proposal(
        db, proposal_id=proposal.id, user=regular_user
    )
    executed, result = ai_proposal_service.execute_proposal(
        db, proposal_id=proposal.id, user=regular_user, confirmation_token=token
    )
    assert executed.status == "succeeded"

    mod = db.query(Mod).filter(Mod.server_id == server.id, Mod.workshop_id == "927142").first()
    assert mod is not None
    assert mod.name == "Moros Indomitable Duo"


def test_read_server_mods_reports_install_error(
    db: Session, regular_user: User
) -> None:
    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    db.add(Mod(
        server_id=server.id,
        workshop_id="927142",
        name="Moros Indomitable Duo",
        enabled=True,
        install_status="failed",
        install_error="Installation fehlgeschlagen. — Download timeout",
        load_order=0,
    ))
    db.commit()

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="read_server_mods",
        arguments={"server_id": server.id},
    )

    assert len(result["mods"]) == 1
    assert result["mods"][0]["workshop_id"] == "927142"
    assert result["mods"][0]["install_status"] == "failed"
    assert result["mods"][0]["install_error"] == "Installation fehlgeschlagen. — Download timeout"



# ── Der Schalter ──────────────────────────────────────────────────────────
#
# Anlass ist ein Betriebsvorfall vom 22.08.2026: der Betreiber bat, eine Mod
# zu aktivieren und den Server neu zu starten. Passiert ist nichts. Der
# Auftrag suchte die Einstellung in der `GameUserSettings.ini` — dort steht
# sie nicht und stand sie nie — und meldete, die Aenderung sei "derzeit nicht
# pruefbar". `read_server_mods` meldete `enabled` seit jeher; setzen konnte
# es niemand.


def _toggle_arguments(server_id: int, enabled: bool, **overrides) -> dict:
    values = {
        "server_id": server_id,
        "workshop_id": "1559212036",
        "enabled": enabled,
        "reason": "Der Benutzer hat darum gebeten.",
        "expected_effect": "Nach dem Neustart laedt der Server die Mod.",
    }
    values.update(overrides)
    return values


def _installierte_mod(db: Session, server_id: int, *, enabled: bool) -> Mod:
    mod = Mod(
        server_id=server_id,
        workshop_id="1559212036",
        name="Moros Indominus",
        enabled=enabled,
        install_status="installed",
        load_order=0,
    )
    db.add(mod)
    db.commit()
    return mod


def test_mod_toggle_braucht_das_schaltrecht(db: Session, regular_user: User) -> None:
    """`server.mods.toggle` und nicht `server.mods.write`.

    Das Recht steht seit jeher im Katalog und war fuer die KI unerreichbar.
    Wer Mods nur schalten darf, soll nichts herunterladen koennen — und
    umgekehrt.
    """
    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.write")
    )
    _installierte_mod(db, server.id, enabled=False)

    with pytest.raises(ai_action_errors.AiActionValidationError):
        ai_proposal_service.create_proposal(
            db,
            user=regular_user,
            conversation=conversation,
            tool_name="propose_mod_toggle",
            arguments=_toggle_arguments(server.id, True),
            correlation_id=str(uuid4()),
        )
    assert db.query(AiActionProposal).count() == 0

    # Mit dem richtigen Recht geht derselbe Aufruf durch.
    db.add(ServerPermission(
        user_id=regular_user.id, server_id=server.id,
        permission_key="server.mods.toggle",
    ))
    db.commit()
    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_toggle",
        arguments=_toggle_arguments(server.id, True),
        correlation_id=str(uuid4()),
    )
    assert proposal.tool_name == "propose_mod_toggle"


def test_ein_schalter_an_einer_nicht_installierten_mod_ist_ein_formfehler(
    db: Session, regular_user: User
) -> None:
    """Erst installieren, dann schalten — als Auskunft, nicht als Absturz.

    Ein Formfehler kostet eine Runde und sagt dem Modell den Weg; ein
    Vorschlag, der beim Klick scheitert, kostet den Menschen einen Klick und
    sagt niemandem etwas.
    """
    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.toggle")
    )

    with pytest.raises(ai_action_service.AiActionValidationError, match="nicht installiert"):
        ai_proposal_service.create_proposal(
            db,
            user=regular_user,
            conversation=conversation,
            tool_name="propose_mod_toggle",
            arguments=_toggle_arguments(server.id, True),
            correlation_id=str(uuid4()),
        )


def test_der_schalter_zeigt_den_bisherigen_stand_und_den_neustart(
    db: Session, regular_user: User
) -> None:
    import json

    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.toggle")
    )
    _installierte_mod(db, server.id, enabled=False)

    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_toggle",
        arguments=_toggle_arguments(server.id, True),
        correlation_id=str(uuid4()),
    )
    db.commit()

    preview = json.loads(proposal.preview_json)
    assert preview["operation"] == "mod_enable"
    assert preview["was_enabled"] is False
    # Die Startzeile entsteht beim Bau des Containers — vorher wirkt nichts.
    assert preview["restart_required"] is True
    # Die Rueckfrage der Karte setzt `path` ein („Den Schalter der Mod
    # „{{path}}" umlegen?"). Ohne den Schluessel stand dort ein leeres Paar
    # Anfuehrungszeichen, und der Bestaetigende sollte zustimmen, ohne zu
    # lesen, wozu.
    assert preview["path"] == "Moros Indominus"


def test_der_name_der_mod_steht_in_der_rueckfrage(
    db: Session, regular_user: User
) -> None:
    """Auch beim Einspielen — und ohne bekannten Namen die Kennung.

    Eine frisch in der Werkstatt gefundene Mod hat im Panel noch keinen
    Namen; dann ist die Workshop-Kennung die ehrlichere Auskunft als eine
    leere Zeile.
    """
    import json

    server, conversation = _setup(
        db, regular_user,
        server_keys=("server.view", "server.mods.read", "server.mods.write"),
    )

    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_install",
        arguments=_install_arguments(server.id),
        correlation_id=str(uuid4()),
    )
    db.commit()

    preview = json.loads(proposal.preview_json)
    assert preview["path"]
    assert preview["path"] == (preview["known_name"] or preview["workshop_id"])


def test_der_schalter_legt_die_spalte_um(
    db: Session, regular_user: User
) -> None:
    """Die Wahrheit ueber „welche Mod ist aktiv" steht in `mods.enabled`.

    Von dort baut `games/base.active_mod_ids` die Startzeile — nicht aus einer
    Spielkonfiguration. Genau diese Spalte muss der Schalter treffen; alles
    andere (Modlisten-Dateien, `.disabled`-Marken) zieht `update_modlist`
    hinterher und ist je nach Spiel wirkungslos.
    """
    server, _conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.toggle")
    )
    mod = _installierte_mod(db, server.id, enabled=True)

    ergebnis = ai_proposal_service._execute_mod_toggle(
        db, server_id=server.id,
        payload={"workshop_id": "1559212036", "enabled": False},
    )

    db.refresh(mod)
    assert mod.enabled is False
    assert ergebnis["enabled"] is False
    assert ergebnis["restart_required"] is True


def test_eine_installation_meldet_den_schalterstand_mit(
    db: Session, regular_user: User
) -> None:
    """Installiert heisst nicht aktiv.

    Eine vorhandene, aber ausgeschaltete Mod laedt der Installationspfad
    zwar herunter — in die Startzeile kommt sie trotzdem nicht. Ohne diesen
    Wert in der Vorschau meldet die KI Erfolg und der Server startet ohne die
    Mod.
    """
    import json

    server, conversation = _setup(
        db, regular_user,
        server_keys=("server.view", "server.mods.read", "server.mods.write"),
    )
    _installierte_mod(db, server.id, enabled=False)

    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_install",
        arguments=_install_arguments(server.id, action="reinstall"),
        correlation_id=str(uuid4()),
    )
    db.commit()

    preview = json.loads(proposal.preview_json)
    assert preview["already_installed"] is True
    assert preview["currently_enabled"] is False


def test_search_workshop_collections_uses_filetype_1(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock
    from services.steam_service import SteamModInfo, SteamService

    server, _conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    fake_col = SteamModInfo(
        publishedfileid="99887766",
        title="RP Bau Sammlung",
        description="Coole Bau-Mods",
        creator="Admin",
        file_size=0,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        subscriptions=120,
        favorites=15,
        tags=["Collection"],
        direct_url="https://steamcommunity.com/sharedfiles/filedetails/?id=99887766",
        item_type="collection",
        children_count=12,
    )
    mock_search = AsyncMock(return_value=[fake_col])
    monkeypatch.setattr(SteamService, "search_workshop_mods", mock_search)
    monkeypatch.setattr(SteamService, "close", AsyncMock(return_value=None))

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="search_workshop_mods",
        arguments={
            "server_id": server.id,
            "query": "Bau",
            "content_type": "collections",
            "sort": "popular",
        },
    )

    assert result["available"] is True
    assert result["provider"] == "steam"
    assert result["results"][0]["workshop_id"] == "99887766"
    assert result["results"][0]["item_type"] == "collection"
    assert result["results"][0]["children_count"] == 12
    assert mock_search.call_args.kwargs["filetype"] == 1
    assert mock_search.call_args.kwargs["sort"] == "popular"


def test_read_steam_collection_resolves_url_and_items(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock
    from services.steam_service import SteamModInfo, SteamService

    server, _conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    col_info = SteamModInfo(
        publishedfileid="555000111",
        title="Mega Survival",
        description="",
        creator="Builder",
        file_size=0,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        subscriptions=50,
        favorites=5,
        tags=[],
        direct_url="https://steamcommunity.com/sharedfiles/filedetails/?id=555000111",
        item_type="collection",
    )
    child = SteamModInfo(
        publishedfileid="111222333",
        title="Base Building Plus",
        description="",
        creator="Modder",
        file_size=2 * 1024 * 1024,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        subscriptions=100,
        favorites=10,
        tags=[],
    )
    mock_details = AsyncMock(
        return_value={
            "collection": col_info,
            "items": [child],
            "unavailable_ids": ["404"],
            "total_children": 2,
        }
    )
    monkeypatch.setattr(SteamService, "get_collection_details", mock_details)
    monkeypatch.setattr(SteamService, "close", AsyncMock(return_value=None))

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="read_steam_collection",
        arguments={
            "server_id": server.id,
            "collection_id": "https://steamcommunity.com/sharedfiles/filedetails/?id=555000111",
        },
    )

    assert result["available"] is True
    assert result["collection"]["title"] == "Mega Survival"
    assert result["item_count"] == 1
    assert result["items"][0]["workshop_id"] == "111222333"
    assert result["unavailable_ids"] == ["404"]


def test_propose_mod_batch_install_from_collection_and_execute(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock, MagicMock
    from services.steam_service import SteamModInfo, SteamService

    server, conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read", "server.mods.write")
    )
    _installierte_mod(db, server.id, enabled=True)  # 1559212036 bereits installiert

    col_info = SteamModInfo(
        publishedfileid="777000111",
        title="Weekend Pack",
        description="",
        creator="Admin",
        file_size=0,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        subscriptions=10,
        favorites=1,
        tags=[],
        item_type="collection",
    )
    mod_existing = SteamModInfo(
        publishedfileid="1559212036",
        title="CF",
        description="",
        creator="A",
        file_size=1024,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        subscriptions=1,
        favorites=0,
        tags=[],
    )
    mod_new = SteamModInfo(
        publishedfileid="222333444",
        title="New Cool Mod",
        description="",
        creator="B",
        file_size=1024,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        subscriptions=1,
        favorites=0,
        tags=[],
    )
    monkeypatch.setattr(
        SteamService,
        "get_collection_details",
        AsyncMock(
            return_value={
                "collection": col_info,
                "items": [mod_existing, mod_new],
                "unavailable_ids": [],
                "total_children": 2,
            }
        ),
    )
    monkeypatch.setattr(SteamService, "close", AsyncMock(return_value=None))

    proposal = ai_proposal_service.create_proposal(
        db,
        user=regular_user,
        conversation=conversation,
        tool_name="propose_mod_batch_install",
        arguments={
            "server_id": server.id,
            "collection_id": "777000111",
            "reason": "Nutzer moechte das Weekend Pack installieren.",
            "expected_effect": "Die fehlenden Mods der Sammlung werden installiert.",
        },
        correlation_id=str(uuid4()),
    )
    db.commit()

    preview = json.loads(proposal.preview_json)
    assert preview["operation"] == "mod_batch_install"
    assert preview["collection_title"] == "Weekend Pack"
    assert preview["mod_count"] == 2
    assert preview["queued_count"] == 1
    assert preview["skipped_count"] == 1

    mock_bg = MagicMock()
    monkeypatch.setattr("routers.mods.install_mods_batch_bg", mock_bg)
    monkeypatch.setattr("threading.Thread", lambda target, args, **kw: MagicMock(start=lambda: target(*args)))

    _, token = ai_proposal_service.confirm_proposal(
        db, proposal_id=proposal.id, user=regular_user
    )
    executed, result = ai_proposal_service.execute_proposal(
        db,
        proposal_id=proposal.id,
        user=regular_user,
        confirmation_token=token,
    )
    assert executed.status == "succeeded"
    assert result["queued"] == 1
    assert result["skipped"] == 1
    mock_bg.assert_called_once_with(server.id, ["222333444"])

    new_row = db.query(Mod).filter(Mod.server_id == server.id, Mod.workshop_id == "222333444").first()
    assert new_row is not None
    assert new_row.name == "New Cool Mod"
    assert new_row.install_status == "pending"


def test_read_mod_details_steam_returns_full_description_dependencies_and_comments(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json
    import httpx
    from unittest.mock import AsyncMock

    server, _conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    db.add(Mod(
        server_id=server.id,
        workshop_id="100200",
        name="CF",
        enabled=True,
        install_status="installed",
    ))
    db.commit()

    long_desc = "Compatibility: Works on DayZ 1.26 and Build 42. " + ("Details " * 60)
    workshop_html = """
    <div class="commentthread_comment responsive_body_text" id="comment_1">
      <div class="commentthread_comment_content">
        <div class="commentthread_comment_author">
          <a class="hoverunderline commentthread_author_link" href="#"><bdi>SurvivorOne</bdi></a>
          <span class="commentthread_comment_timestamp" title="12 Nov, 2026 @ 5:10pm">12 Nov @ 5:10pm</span>
        </div>
        <div class="commentthread_comment_text">Works great on 1.26!<br>No errors in logs.</div>
      </div>
    </div>
    """

    async def _fake_get(url: str, **kwargs):
        if "GetDetails" in url:
            payload = json.loads(kwargs["params"]["input_json"])
            pids = [str(pid) for pid in payload["publishedfileids"]]
            items = []
            for pid in pids:
                if pid == "100100":
                    assert payload["short_description"] is False
                    items.append({
                        "result": 1,
                        "publishedfileid": "100100",
                        "title": "Expansion Core",
                        "file_description": long_desc,
                        "short_description": "Short text",
                        "creator": "ModTeam",
                        "file_size": 4 * 1024 * 1024,
                        "time_created": 1700000000,
                        "time_updated": 1700001000,
                        "subscriptions": 5000,
                        "favorited": 300,
                        "tags": [{"tag": "Mod"}, {"tag": "Framework"}],
                        "children": [
                            {"publishedfileid": "100200", "sortorder": 0},
                            {"publishedfileid": "100300", "sortorder": 1},
                        ],
                    })
                elif pid == "100200":
                    items.append({
                        "result": 1,
                        "publishedfileid": "100200",
                        "title": "CF",
                        "short_description": "Community Framework",
                        "creator": "CFTeam",
                        "file_size": 1024,
                        "time_created": 1700000000,
                        "time_updated": 1700000100,
                    })
                elif pid == "100300":
                    items.append({
                        "result": 1,
                        "publishedfileid": "100300",
                        "title": "Dabs Framework",
                        "short_description": "Required UI framework",
                        "creator": "Dab",
                        "file_size": 2048,
                        "time_created": 1700000000,
                        "time_updated": 1700000200,
                    })
            return httpx.Response(200, json={"response": {"publishedfiledetails": items}}, request=httpx.Request("GET", url))
        if "sharedfiles/filedetails" in url:
            return httpx.Response(200, text=workshop_html, request=httpx.Request("GET", url))
        raise AssertionError(f"Unerwartete URL: {url}")

    monkeypatch.setattr("services.steam_api_key_service.resolve_key", lambda: "STEAM_TEST_KEY")
    monkeypatch.setattr(httpx.AsyncClient, "get", AsyncMock(side_effect=_fake_get))

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="read_mod_details",
        arguments={
            "server_id": server.id,
            "mod_id": "https://steamcommunity.com/sharedfiles/filedetails/?id=100100",
        },
    )

    assert result["available"] is True
    assert result["provider"] == "steam"
    assert result["mod"]["workshop_id"] == "100100"
    assert len(result["mod"]["full_description"]) > 256
    assert "Compatibility: Works on DayZ 1.26" in result["mod"]["full_description"]
    assert result["mod"]["already_installed"] is False
    assert result["dependencies_count"] == 2
    assert result["missing_dependencies_count"] == 1
    deps_by_id = {d["workshop_id"]: d for d in result["dependencies"]}
    assert deps_by_id["100200"]["already_installed"] is True
    assert deps_by_id["100200"]["currently_enabled"] is True
    assert deps_by_id["100300"]["already_installed"] is False
    assert deps_by_id["100300"]["currently_enabled"] is False
    assert len(result["comments"]) == 1
    assert result["comments"][0]["author"] == "SurvivorOne"
    assert result["comments"][0]["timestamp"] == "12 Nov, 2026 @ 5:10pm"
    assert "Works great on 1.26!" in result["comments"][0]["text"]


def test_read_mod_details_curseforge_returns_description_compatibility_and_dependencies(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock, MagicMock
    from services.curseforge_service import CurseForgeModInfo

    server, _conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )
    server.game_type = "minecraft_fabric"
    db.add(Mod(
        server_id=server.id,
        workshop_id="500",
        name="Fabric API",
        enabled=False,
        install_status="installed",
    ))
    db.commit()

    fake_plugin = MagicMock()
    fake_plugin.supports_mods = True
    fake_plugin.get_mod_support.return_value = {"provider": "curseforge", "curseforge_game_id": "432"}
    fake_plugin.blueprint = MagicMock()
    fake_plugin.blueprint.runtime.env = {"VERSION": "1.20.1"}

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    files = [
        {
            "id": 10,
            "displayName": "Mod Forge 1.20.1",
            "fileName": "mod-forge.jar",
            "fileDate": "2026-01-01T00:00:00Z",
            "fileLength": 1024,
            "gameVersions": ["1.20.1", "Forge"],
            "dependencies": [{"modId": 9001, "relationType": 3}],
        },
        {
            "id": 11,
            "displayName": "Mod Fabric 1.20.1",
            "fileName": "mod-fabric.jar",
            "fileDate": "2026-01-02T00:00:00Z",
            "fileLength": 2048,
            "gameVersions": ["1.20.1", "Fabric"],
            "dependencies": [{"modId": 500, "relationType": 3}],
        },
    ]
    main_mod = CurseForgeModInfo(
        publishedfileid="400",
        title="Fancy Fabric Mod",
        description="Short summary",
        creator="CFDev",
        file_size=2048,
        created=now,
        updated=now,
        subscriptions=1000,
        favorites=50,
        tags=["Tech"],
        direct_url="https://www.curseforge.com/minecraft/mc-mods/fancy-fabric-mod",
        main_file_id=10,
        latest_files=files,
        game_id="432",
        class_id=6,
        issues_url="https://github.com/example/issues",
        wiki_url="https://github.com/example/wiki",
    )
    dep_500 = CurseForgeModInfo(
        publishedfileid="500",
        title="Fabric API",
        description="Core API",
        creator="modmuss50",
        file_size=1024,
        created=now,
        updated=now,
        subscriptions=999999,
        favorites=500,
        tags=["API"],
        direct_url="https://www.curseforge.com/minecraft/mc-mods/fabric-api",
        main_file_id=50,
        latest_files=[{
            "id": 50,
            "gameVersions": ["1.20.1", "Fabric"],
            "dependencies": [{"modId": 600, "relationType": 3}],
        }],
        game_id="432",
        class_id=6,
    )
    dep_600 = CurseForgeModInfo(
        publishedfileid="600",
        title="Cloth Config",
        description="Config lib",
        creator="shedaniel",
        file_size=512,
        created=now,
        updated=now,
        subscriptions=500000,
        favorites=100,
        tags=["Library"],
        direct_url="https://www.curseforge.com/minecraft/mc-mods/cloth-config",
        main_file_id=60,
        latest_files=[],
        game_id="432",
        class_id=6,
    )

    mock_cf = MagicMock()
    mock_cf.search_mods = AsyncMock(return_value=[main_mod])
    mock_cf.get_mod_details = AsyncMock(return_value=main_mod)
    mock_cf.get_mod_files = AsyncMock(return_value=files)
    mock_cf.find_class_id = AsyncMock(return_value=4471)
    mock_cf.get_mods_by_ids = AsyncMock(side_effect=[[dep_500], [dep_600]])
    mock_cf.get_mod_description = AsyncMock(
        return_value="Full description for Minecraft 1.20.1 Fabric. " + ("Note " * 70)
    )

    monkeypatch.setattr("games.get_plugin", lambda _gt: fake_plugin)
    monkeypatch.setattr("services.curseforge_service.get_curseforge_service", AsyncMock(return_value=mock_cf))

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="read_mod_details",
        arguments={
            "server_id": server.id,
            "mod_id": "https://www.curseforge.com/minecraft/mc-mods/fancy-fabric-mod",
        },
    )

    assert result["available"] is True
    assert result["provider"] == "curseforge"
    assert result["mod"]["workshop_id"] == "400"
    assert len(result["mod"]["full_description"]) > 256
    assert result["mod"]["issues_url"] == "https://github.com/example/issues"
    assert result["mod"]["wiki_url"] == "https://github.com/example/wiki"
    assert result["compatibility"]["server_mod_loader"] == "fabric"
    assert result["compatibility"]["server_game_version"] == "1.20.1"
    assert result["compatibility"]["compatible_files"][0]["id"] == 11
    assert "Fabric" in result["compatibility"]["compatible_files"][0]["game_versions"]
    assert result["dependencies_count"] == 2
    assert result["missing_dependencies_count"] == 1
    assert [d["workshop_id"] for d in result["dependencies"]] == ["600", "500"]
    assert result["dependencies"][0]["already_installed"] is False
    assert result["dependencies"][1]["already_installed"] is True
    assert result["dependencies"][1]["currently_enabled"] is False


def test_search_workshop_mods_includes_dependencies_count_and_direct_url(
    db: Session, regular_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json
    import httpx

    server, _conversation = _setup(
        db, regular_user, server_keys=("server.view", "server.mods.read")
    )

    steam_json = {
        "response": {
            "publishedfiledetails": [
                {
                    "result": 1,
                    "publishedfileid": "2542661512",
                    "title": "Dabs Framework",
                    "short_description": "Required UI framework",
                    "time_updated": 1700000000,
                    "subscriptions": 25000,
                    "tags": [{"tag": "Framework"}],
                    "children": [
                        {"publishedfileid": "1559212036", "sortorder": 0},
                        {"publishedfileid": "2542661512", "sortorder": 1},
                    ],
                }
            ]
        }
    }

    captured_params: dict = {}

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, params=None):
            captured_params.update(params or {})
            return httpx.Response(200, json=steam_json, request=httpx.Request("GET", url))

    monkeypatch.setattr("services.steam_api_key_service.resolve_key", lambda: "STEAM_TEST_KEY")
    monkeypatch.setattr(httpx, "Client", _FakeClient)

    result = ai_action_service.execute_read_tool(
        db,
        user=regular_user,
        tool_name="search_workshop_mods",
        arguments={"server_id": server.id, "query": "Dabs"},
    )

    assert result["available"] is True
    sent = json.loads(captured_params["input_json"])
    assert sent["return_children"] is True
    hit = result["results"][0]
    assert hit["workshop_id"] == "2542661512"
    assert hit["direct_url"] == "https://steamcommunity.com/sharedfiles/filedetails/?id=2542661512"
    assert hit["dependencies_count"] == 1
    assert hit["required_dependency_ids"] == ["1559212036"]
