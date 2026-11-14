"""Reproduktionstests fuer "Patch-Tool hat ungueltige Argumente" und Tool-Routing.

Stellt die genauen Fehlerwege nach, die im Singra-Chat beim Bearbeiten von
Server-Konfigurationen (z. B. Project Zomboid ``.ini`` / ``_SandboxVars.lua``)
auftreten:

1. ``_config_patch_payload`` in ``services.ai_proposals.server_proposals`` prueft
   ausschliesslich ``set(arguments) != {"path", "expected_revision", "edits"}``
   und wirft stets dieselbe, unspezifische Meldung
   ``"Patch-Tool hat ungueltige Argumente"`` — ohne zu nennen, welches Feld
   fehlt (z. B. ``expected_revision``), falsch benannt wurde (z. B.
   ``file_path`` statt ``path``, wie es sogar in ``docs/singra-ai.md`` steht)
   oder zusaetzlich uebergeben wurde.
2. ``_persist_write_proposals`` liefert dieses unspezifische Ergebnis als
   ``AI_TOOL_ARGUMENTS_INVALID`` an das Modell zurueck, sodass das Modell im
   naechsten Zug blind raten muss.
3. Im Worker-Segment schneidet ``_werkzeuge_semantisch_routen`` den
   Werkzeugkatalog anhand des kurzen Worker-Auftrags auf ``HOTSET`` + 5
   Treffer + Gruppennachbarn zu. Schreibwerkzeuge wie ``propose_config_patch``
   stehen nicht in ``HOTSET``.
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models import AiConversation, AiRun, Server, User
from services import ai_action_errors, ai_action_service, ai_proposal_service, ai_run_service
from services.ai_action_service import angebotene_werkzeuge, provider_tool_definitions
from services.ai_stream.lifecycle import _erlaubte_werkzeuge_schneiden, _werkzeuge_semantisch_routen
from services.ai_stream.write_tools import _persist_write_proposals
from services.file_edit_service import content_revision
from services.openai_compatible_adapter import ProviderToolCall


def _pz_server(db: Session, tmp_path: Path) -> tuple[Server, str]:
    install_dir = tmp_path / "pz-server"
    srv_dir = install_dir / "Zomboid" / "Server"
    srv_dir.mkdir(parents=True)
    sandbox_file = srv_dir / "servertest_SandboxVars.lua"
    sandbox_file.write_text(
        "SandboxVars = {\n"
        "    ZombieConfig = {\n"
        "        PopulationMultiplier = 1.0,\n"
        "        PopulationStartMultiplier = 1.0,\n"
        "        PopulationPeakMultiplier = 1.5,\n"
        "        PopulationPeakDay = 28,\n"
        "        RespawnHours = 72.0,\n"
        "        RespawnUnseenHours = 16.0,\n"
        "        RespawnMultiplier = 0.1,\n"
        "    },\n"
        "    ZombieLore = {\n"
        "        Speed = 2,\n"
        "        Transmission = 1,\n"
        "        Sight = 2,\n"
        "        Hearing = 2,\n"
        "    },\n"
        "}\n",
        encoding="utf-8",
    )
    server = Server(
        name="Project Zomboid",
        game_type="project_zomboid",
        install_dir=str(install_dir),
        container_name=f"msm-pz-{uuid4().hex[:8]}",
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    rev = content_revision(sandbox_file.read_bytes())
    return server, rev


def _conversation_and_run(db: Session, user: User, server: Server, *, rolle: str = "worker") -> tuple[AiConversation, AiRun]:
    kind = "worker" if rolle == "worker" else "primary"
    conv = AiConversation(
        id=str(uuid4()),
        user_id=user.id,
        server_id=server.id,
        kind=kind,
        title="PZ Repro",
    )
    db.add(conv)
    db.flush()
    zustand = ai_run_service.leerer_zustand([], request_id=str(uuid4()))
    zustand["rolle"] = rolle
    run = ai_run_service.lauf_anlegen(
        db,
        conversation_id=conv.id,
        user_id=user.id,
        provider_id=None,
        message_id=None,
        reasoning=False,
        zustand=zustand,
    )
    db.commit()
    return conv, run


@pytest.mark.parametrize(
    "fehlerhafte_argumente",
    [
        # 1) `expected_revision` weggelassen (modell will ohne vorheriges read_config patchen)
        {
            "path": "Zomboid/Server/servertest_SandboxVars.lua",
            "edits": [{"find": "Transmission = 1,", "replace": "Transmission = 2,"}],
        },
        # 2) `file_path` statt `path` (steht sogar faelschlich in docs/singra-ai.md)
        {
            "file_path": "Zomboid/Server/servertest_SandboxVars.lua",
            "expected_revision": "sha256:" + "0" * 64,
            "edits": [{"find": "Transmission = 1,", "replace": "Transmission = 2,"}],
        },
        # 3) Top-Level `find`/`replace` statt `edits=[...]`
        {
            "path": "Zomboid/Server/servertest_SandboxVars.lua",
            "expected_revision": "sha256:" + "0" * 64,
            "find": "Transmission = 1,",
            "replace": "Transmission = 2,",
        },
        # 4) Zusaetzlicher Kommentar-/Hilfskey, der nicht in _RATIONALE_KEYS steht
        {
            "path": "Zomboid/Server/servertest_SandboxVars.lua",
            "expected_revision": "sha256:" + "0" * 64,
            "edits": [{"find": "Transmission = 1,", "replace": "Transmission = 2,"}],
            "summary": "Zombie-Startwerte fuer Tag 1 setzen",
        },
    ],
    ids=[
        "missing_expected_revision",
        "file_path_instead_of_path",
        "top_level_find_replace",
        "extra_summary_key",
    ],
)
def test_reproduce_patch_tool_invalid_arguments_opaque_error(
    db: Session,
    owner_user: User,
    tmp_path: Path,
    fehlerhafte_argumente: dict,
) -> None:
    """Reproduziert exakt 'Patch-Tool hat ungueltige Argumente' bei allen 4 Fehlermustern."""
    server, rev = _pz_server(db, tmp_path)
    conv, _run = _conversation_and_run(db, owner_user, server)

    args = dict(fehlerhafte_argumente)
    if "expected_revision" in args:
        args["expected_revision"] = rev

    with pytest.raises(ai_action_errors.AiActionValidationError) as exc_info:
        ai_proposal_service.create_proposal(
            db,
            user=owner_user,
            conversation=conv,
            tool_name="propose_config_patch",
            arguments={
                "server_id": server.id,
                "reason": "Tag-1-Zombie-Werte anpassen",
                "expected_effect": "Langsamer Ausbruch-Start",
                **args,
            },
            correlation_id=str(uuid4()),
        )

    assert "Patch-Tool hat ungueltige Argumente" in str(exc_info.value)
    assert "Erwartet: path, expected_revision" in str(exc_info.value)
    if "expected_revision" not in args:
        assert "fehlend: expected_revision" in str(exc_info.value)
    if "file_path" in args:
        assert "unbekannt: file_path" in str(exc_info.value)
    if "find" in args:
        assert "unbekannt: find, replace" in str(exc_info.value)
    if "summary" in args:
        assert "unbekannt: summary" in str(exc_info.value)


def test_reproduce_persist_write_proposals_returns_opaque_rejection(
    db: Session,
    owner_user: User,
    tmp_path: Path,
) -> None:
    """Im Stream-Loop erhaelt das Modell jetzt eine klare Rueckmeldung inkl. fehlender Felder."""
    server, _rev = _pz_server(db, tmp_path)
    conv, run = _conversation_and_run(db, owner_user, server)

    call = ProviderToolCall(
        id="call_patch_repro_1",
        name="propose_config_patch",
        arguments={
            "server_id": server.id,
            "path": "Zomboid/Server/servertest_SandboxVars.lua",
            "edits": [{"find": "Transmission = 1,", "replace": "Transmission = 2,"}],
            "reason": "Biss-Uebertragung aktivieren",
            "expected_effect": "Nur Speichel uebertraegt Infektion",
        },
    )
    ergebnisse = _persist_write_proposals(
        user_id=owner_user.id,
        conversation_id=conv.id,
        correlation_id=str(uuid4()),
        run_id=run.id,
        tool_calls=[call],
    )

    assert len(ergebnisse) == 1
    assert ergebnisse[0]["status"] == "rejected"
    assert ergebnisse[0]["error_code"] == "AI_TOOL_ARGUMENTS_INVALID"
    assert "Patch-Tool hat ungueltige Argumente" in ergebnisse[0]["error"]
    assert "fehlend: expected_revision" in ergebnisse[0]["error"]


@pytest.mark.asyncio
async def test_reproduce_semantic_tool_routing_drops_patch_tool_on_worker_brief(
    db: Session,
    owner_user: User,
    tmp_path: Path,
) -> None:
    """Prueft, dass der Worker nach Routing alle Config-Schreibwerkzeuge behaelt."""
    from types import SimpleNamespace

    server, _rev = _pz_server(db, tmp_path)
    worker_brief = (
        "Passe auf dem Project-Zomboid-Server den Weltreset und die "
        "Zombie-Einstellungen in servertest_SandboxVars.lua fuer das Tag-1-Szenario an."
    )
    zustand = {
        "rolle": "worker",
        "herkunft": "panel",
        "provider_messages": [{"role": "user", "content": worker_brief}],
        "query": worker_brief,
    }
    vorbereitung = SimpleNamespace(
        angebotene_werkzeuge=angebotene_werkzeuge(db, owner_user),
        werkzeuge=provider_tool_definitions(),
        mcp_werkzeuge=[],
    )
    tools, erlaubt, mcp_namen, docs_kontext = _erlaubte_werkzeuge_schneiden(
        vorbereitung=vorbereitung,
        guardian=None,
        aufgabe=None,
        rolle="worker",
        herkunft="panel",
        zustand=zustand,
    )
    routed_tools = await _werkzeuge_semantisch_routen(
        tools=tools,
        erlaubt=erlaubt,
        mcp_namen=mcp_namen,
        docs_kontext=docs_kontext,
        herkunft="panel",
        zustand=zustand,
    )
    routed_names = {t["function"]["name"] for t in routed_tools}

    assert "propose_config_patch" in erlaubt
    assert {"read_config", "list_server_files", "search_server_files", "propose_config_patch", "propose_config_set", "propose_config_update"} <= routed_names
    print(f"\n  [REPRO-ROUTER] worker routed count={len(routed_names)}/{len(erlaubt)}")
    print(f"  [REPRO-ROUTER] config tools present: {sorted(n for n in routed_names if 'config' in n or 'file' in n)}")


def test_execute_server_action_parses_json_parameters_and_reports_rejected_schema(
    db: Session,
    owner_user: User,
    tmp_path: Path,
) -> None:
    """`execute_server_action` dekodiert JSON-Strings und liefert Schema-Hilfe bei Ablehnung."""
    from services.ai_tools.server_tools import execute_read_tool

    server, _rev = _pz_server(db, tmp_path)
    conv, _run = _conversation_and_run(db, owner_user, server)

    wert = execute_read_tool(
        db,
        user=owner_user,
        tool_name="execute_server_action",
        arguments={
            "tool_name": "propose_config_patch",
            "server_id": server.id,
            "action": "Transmission auf 2 setzen",
            "parameters": json.dumps({
                "path": "Zomboid/Server/servertest_SandboxVars.lua",
                "edits": [{"find": "Transmission = 1,", "replace": "Transmission = 2,"}],
            }),
        },
    )

    assert wert["executed_tool"] == "propose_config_patch"
    assert wert["status"] == "rejected"
    assert "fehlend: expected_revision" in wert["error"]
    assert "expected_parameters" in wert
    assert "expected_revision" in wert["expected_parameters"]["required"]


def test_execute_server_action_does_not_inject_server_id_into_global_tools(
    db: Session,
    owner_user: User,
    tmp_path: Path,
) -> None:
    """`execute_server_action` injiziert `server_id` nicht in globale Werkzeuge wie `list_blueprints`."""
    from services.ai_tools.server_tools import execute_read_tool

    server, _rev = _pz_server(db, tmp_path)

    wert = execute_read_tool(
        db,
        user=owner_user,
        tool_name="execute_server_action",
        arguments={
            "tool_name": "list_blueprints",
            "server_id": server.id,
            "action": "Verfuegbare Blueprints anzeigen",
        },
    )

    assert wert["executed_tool"] == "list_blueprints"
    assert "error" not in wert
    assert "unerlaubtes Feld" not in str(wert)
