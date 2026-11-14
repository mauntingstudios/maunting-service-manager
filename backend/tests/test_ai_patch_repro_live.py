"""Live-Reproduktionstest mit dem echten Singra Agent Harness (OpenRouter).

Fuehrt beide Problemfaelle aus dem echten Project-Zomboid-Chatverlauf durch den
vollstaendigen Singra-Harness (Gehirn + Worker + Tool-Routing + Schreibpfad +
Vorschlagspersistenz):

1. Vager Wunsch (Mods-Reihenfolge in .ini + anfaengerfreundliche Zombie-Werte
   ohne exakte Zahlen, Websuche verfuegbar).
2. Konkreter Auftrag fuer ``servertest_SandboxVars.lua`` (Tag-1-Zombie-Werte +
   Weltreset), bei dem das Modell / der Harness typischerweise auf
   ``"Patch-Tool hat ungueltige Argumente"`` oder fehlende Schreibwerkzeuge
   laeuft.

Ausfuehren:

    MSM_LIVE_AI_KEY=sk-or-v1-... \\
    MSM_LIVE_AI_MODEL=minimax/minimax-m3.1-flash \\
    python -m pytest tests/test_ai_patch_repro_live.py -o addopts="" -v -s
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.orm import Session

from models import (
    AiActionProposal,
    AiConversation,
    AiMeldung,
    AiMessage,
    AiProvider,
    AiRun,
    AiToolResult,
    Mod,
    Server,
    User,
)
from services import (
    ai_autonomy_service,
    ai_model_catalog,
    ai_provider_service,
    ai_run_broker,
    ai_run_service,
    ai_stream as ai_stream_pkg,
    ai_stream_service,
    ai_web_search_service,
)
from services.ai_stream import write_tools as ai_stream_write_tools


LIVE_KEY = os.environ.get("MSM_LIVE_AI_KEY", "").strip()
LIVE_MODEL = os.environ.get("MSM_LIVE_AI_MODEL", "minimax/minimax-m3.1-flash").strip()

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not LIVE_KEY,
        reason="MSM_LIVE_AI_KEY nicht gesetzt — echter OpenRouter-Lauf uebersprungen",
    ),
]


def _pz_fixture(db: Session, tmp_path: Path) -> Server:
    install_dir = tmp_path / "pz-server"
    srv_dir = install_dir / "Zomboid" / "Server"
    srv_dir.mkdir(parents=True)

    (srv_dir / "servertest.ini").write_text(
        "PublicName=Project Zomboid\n"
        "MaxPlayers=16\n"
        "PauseEmpty=true\n"
        "Open=true\n"
        "WorkshopItems=\n"
        "Mods=\n"
        "ResetID=123456789\n",
        encoding="utf-8",
    )
    (srv_dir / "servertest_SandboxVars.lua").write_text(
        "SandboxVars = {\n"
        "    VERSION = 5,\n"
        "    Zombies = 4,\n"
        "    ZombieLore = {\n"
        "        Speed = 2,\n"
        "        Strength = 2,\n"
        "        Toughness = 2,\n"
        "        Transmission = 1,\n"
        "        Sight = 2,\n"
        "        Hearing = 2,\n"
        "    },\n"
        "    ZombieConfig = {\n"
        "        PopulationMultiplier = 1.0,\n"
        "        PopulationStartMultiplier = 1.0,\n"
        "        PopulationPeakMultiplier = 1.5,\n"
        "        PopulationPeakDay = 28,\n"
        "        RespawnHours = 72.0,\n"
        "        RespawnUnseenHours = 16.0,\n"
        "        RespawnMultiplier = 0.1,\n"
        "    },\n"
        "}\n",
        encoding="utf-8",
    )
    save_dir = install_dir / "Zomboid" / "Saves" / "Multiplayer" / "Project_Zomboid"
    save_dir.mkdir(parents=True)
    (save_dir / "map_meta.bin").write_bytes(b"PZMETA")

    workshop_root = install_dir / "steamapps" / "workshop" / "content" / "108600"
    mods_spec = [
        ("2991554822", "ZombieBuddy", "ZombieBuddy", 0, None),
        ("3001000001", "Project Viewpoint", "ProjectViewpoint", 1, "ZombieBuddy"),
        ("3001000002", "Viewpoint Combat Expansion", "ViewpointCombat", 2, "ZombieBuddy,ProjectViewpoint"),
    ]
    for wid, name, mod_id, order, req in mods_spec:
        mod_dir = workshop_root / wid / "mods" / mod_id
        mod_dir.mkdir(parents=True)
        info = f"name={name}\nid={mod_id}\n"
        if req:
            info += f"require={req}\n"
        (mod_dir / "mod.info").write_text(info, encoding="utf-8")

    server = Server(
        name="Project Zomboid",
        game_type="project_zomboid",
        install_dir=str(install_dir),
        container_name=f"msm-pz-live-{uuid4().hex[:8]}",
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    for wid, name, mod_id, order, _req in mods_spec:
        db.add(Mod(
            server_id=server.id,
            workshop_id=wid,
            name=name,
            load_order=order,
            enabled=True,
            install_status="installed",
            update_status="up_to_date",
            resolved_ids_json=json.dumps([mod_id]),
        ))
    db.commit()
    return server


def _provider(db: Session) -> AiProvider:
    return ai_provider_service.create_provider(
        db,
        name=f"OpenRouter Live ({LIVE_MODEL})",
        provider_kind="openrouter",
        default_model=LIVE_MODEL,
        worker_model=LIVE_MODEL,
        worker_enabled=True,
        allow_all_models=True,
        enabled=True,
        requires_api_key=True,
        operator_api_key=LIVE_KEY,
    )


async def _run_gehirn_and_workers(
    db: Session,
    *,
    user: User,
    server: Server,
    provider: AiProvider,
    prompt: str,
    monkeypatch: pytest.MonkeyPatch,
) -> dict:
    """Fuehrt einen echten Chat-Zug (Gehirn + automatisch gestartete Worker) aus."""
    ai_run_broker.zuruecksetzen_fuer_tests()

    web_queries: list[str] = []
    monkeypatch.setattr(ai_web_search_service, "ai_web_search_enabled", lambda: True)
    monkeypatch.setattr(ai_web_search_service, "is_configured", lambda: True)

    def _fake_search(query: str, count: int = 5, *, cache_scope: str | None = None) -> list[dict]:
        web_queries.append(query)
        return [
            {
                "title": "Project Zomboid Dedicated Server Configuration - PZwiki",
                "url": "https://pzwiki.net/wiki/Server_settings",
                "snippet": (
                    "WorkshopItems= and Mods= in Zomboid/Server/servertest.ini use semicolon-separated IDs "
                    "in load order (e.g. ZombieBuddy;ProjectViewpoint;ViewpointCombat). "
                    "Beginner zombie settings in servertest_SandboxVars.lua (ZombieConfig): "
                    "PopulationMultiplier = 0.5 or 1.0, PopulationStartMultiplier = 0.1 to 0.35, "
                    "PopulationPeakMultiplier = 1.5, PopulationPeakDay = 28, RespawnHours = 72.0, "
                    "RespawnUnseenHours = 16.0, RespawnMultiplier = 0.1."
                ),
            }
        ]

    monkeypatch.setattr(ai_web_search_service, "search", _fake_search)

    worker_queue: list[str] = []
    orig_anlauf = ai_run_service.anlauf

    def _queued_anlauf(db_sess: Session, worker_run: AiRun) -> bool:
        ai_run_broker.eroeffnen(worker_run.id)
        worker_queue.append(worker_run.id)
        return True

    monkeypatch.setattr(ai_run_service, "anlauf", _queued_anlauf)

    # Spion auf stream_chat_completion fuer angebotene Tools und rohe Modell-Tool-Calls
    llm_trace: list[dict] = []
    orig_stream = ai_stream_pkg.stream_chat_completion

    async def _traced_stream(client, *, provider, api_key, messages, usage, tools=None, **kwargs):
        offered = [t["function"]["name"] for t in (tools or []) if isinstance(t, dict)]
        entry: dict = {
            "model": kwargs.get("model_override") or getattr(provider, "default_model", None),
            "offered_tools": offered,
            "offered_count": len(offered),
            "tool_calls": [],
            "text_preview": "",
        }
        chunks: list[str] = []
        async for chunk in orig_stream(
            client,
            provider=provider,
            api_key=api_key,
            messages=messages,
            usage=usage,
            tools=tools,
            **kwargs,
        ):
            if getattr(chunk, "kind", "content") == "content" and getattr(chunk, "text", None):
                chunks.append(chunk.text)
            yield chunk
        entry["text_preview"] = "".join(chunks)[:500]
        entry["tool_calls"] = [
            {"id": c.id, "name": c.name, "arguments": c.arguments}
            for c in usage.tool_calls
        ]
        llm_trace.append(entry)
        print(
            f"\n[TRACE round={len(llm_trace)} offered={len(offered)} calls={[(c.name, c.arguments) for c in usage.tool_calls]}]",
            flush=True,
        )

    monkeypatch.setattr(ai_stream_pkg, "stream_chat_completion", _traced_stream)

    # Spion auf Write-Rejections (z.B. "Patch-Tool hat ungueltige Argumente")
    write_outcomes: list[dict] = []
    orig_persist = ai_stream_write_tools._persist_write_proposals

    def _traced_persist(*, user_id, conversation_id, correlation_id, run_id, tool_calls, **kwargs):
        res = orig_persist(
            user_id=user_id,
            conversation_id=conversation_id,
            correlation_id=correlation_id,
            run_id=run_id,
            tool_calls=tool_calls,
            **kwargs,
        )
        for call, outcome in zip(tool_calls, res):
            write_outcomes.append({
                "run_id": run_id,
                "tool_name": call.name,
                "arguments": call.arguments,
                "outcome": outcome,
            })
        return res

    monkeypatch.setattr(ai_stream_write_tools, "_persist_write_proposals", _traced_persist)

    # Autonomie-Modus fuer diesen Testbenutzer aktivieren (wie im Panel-Betrieb),
    # damit Read-Tools und Schreibversuche bis zu propose_config_patch / propose_config_set durchlaufen.
    ai_autonomy_service.set_grant(
        db,
        user=user,
        server_id=None,
        enabled=True,
        max_actions_per_hour=100,
        granted_by=user.id,
    )

    conv = AiConversation(
        id=str(uuid4()),
        user_id=user.id,
        server_id=server.id,
        kind="primary",
        title="PZ Live Repro",
    )
    db.add(conv)
    db.commit()

    run, fehler = ai_stream_service.lauf_beginnen(
        db,
        user=user,
        conversation=conv,
        provider=provider,
        request_id=uuid4(),
        content=prompt,
        reasoning=True,
    )
    assert fehler is None, f"lauf_beginnen fehlgeschlagen: {fehler}"
    assert run is not None

    async with httpx.AsyncClient(timeout=180.0) as client:
        ai_model_catalog.laufzeit_setzen(client)
        ai_run_service.laufzeit_setzen(None, client)
        try:
            ai_run_broker.eroeffnen(run.id)
            await ai_stream_service.segment_ausfuehren(run.id, client=client)

            seen_workers: set[str] = set()
            while worker_queue:
                wid = worker_queue.pop(0)
                if wid in seen_workers:
                    continue
                seen_workers.add(wid)
                await ai_stream_service.segment_ausfuehren(wid, client=client)
        finally:
            ai_run_service.laufzeit_setzen(None, None)
            ai_model_catalog.laufzeit_setzen(None)
            monkeypatch.setattr(ai_run_service, "anlauf", orig_anlauf)

    db.expire_all()
    all_runs = db.query(AiRun).order_by(AiRun.created_at.asc()).all()
    proposals = db.query(AiActionProposal).order_by(AiActionProposal.created_at.asc()).all()
    tool_results = db.query(AiToolResult).order_by(AiToolResult.created_at.asc()).all()
    messages = db.query(AiMessage).order_by(AiMessage.created_at.asc()).all()
    meldungen = db.query(AiMeldung).order_by(AiMeldung.created_at.asc()).all()

    return {
        "web_queries": web_queries,
        "llm_trace": llm_trace,
        "write_outcomes": write_outcomes,
        "runs": [
            {
                "id": r.id,
                "status": r.status,
                "stop_reason": r.stop_reason,
                "error_code": getattr(r, "error_code", None),
                "rolle": ai_run_service.zustand_lesen(r).get("rolle"),
            }
            for r in all_runs
        ],
        "proposals": [
            {"id": p.id, "tool_name": p.tool_name, "status": p.status, "error_code": p.error_code, "preview": p.preview_json}
            for p in proposals
        ],
        "tool_results": [
            {"tool_name": tr.tool_name, "result_json": tr.result_json}
            for tr in tool_results
        ],
        "assistant_messages": [
            m.content for m in messages if m.role == "assistant"
        ],
        "meldungen": [
            {"art": m.art, "kanal": m.kanal, "text": m.text} for m in meldungen
        ],
    }


@pytest.mark.asyncio
async def test_live_repro_pz_vague_mods_and_beginner_zombies(
    db: Session,
    owner_user: User,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Szenario 1: Vager Wunsch mit Mods-Reihenfolge & anfaengerfreundlichen Zombies."""
    server = _pz_fixture(db, tmp_path)
    provider = _provider(db)

    prompt = (
        "Wir haben einen Project Zomboid Server. Ich habe auch schon ein paar Mods "
        "installiert, nur hatte ich vergessen, dass man die Mods ja auch noch in dieser "
        "einen .ini-Datei eintragen muss. Würdest du diese Mods bitte in der richtigen "
        "Reihenfolge machen? Also ZombieBuddy muss als erstes rein, dann Project "
        "Viewpoint und dann die Erweiterung. Und würdest du das Spiel bitte so "
        "konfigurieren, wie man es für Neulinge eigentlich konfigurieren würde (nicht "
        "direkt zu viele Zombies am Anfang)? Ich habe keine exakten Zahlen — schlag es "
        "nach bzw. entscheide sinnvoll nach Best Practice und setze es direkt um."
    )

    report = await _run_gehirn_and_workers(
        db,
        user=owner_user,
        server=server,
        provider=provider,
        prompt=prompt,
        monkeypatch=monkeypatch,
    )
    print("\n=== LIVE REPRO SZENARIO 1 (VAGER WUNSCH) ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    assert report["llm_trace"], "Mindestens ein LLM-Aufruf erwartet"


@pytest.mark.asyncio
async def test_live_repro_pz_sandboxvars_lua_patch_and_reset(
    db: Session,
    owner_user: User,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Szenario 2: Exakter Prompt aus dem Chatverlauf (servertest_SandboxVars.lua + Reset)."""
    server = _pz_fixture(db, tmp_path)
    provider = _provider(db)

    prompt = (
        "Aufgabe: Passe die Project Zomboid Server-Konfiguration für einen "
        "realistischen, langsam eskalierenden Start an (Tag-1-Szenario) und setze die "
        "Welt zurück.\n"
        "1. Welt & Charakter-Save zurücksetzen (Wichtig, sonst greifen die Zombie-Zahlen nicht):\n"
        "• Stoppe den Project Zomboid Dedicated Server.\n"
        "• Lösche im Verzeichnis Zomboid/Saves/Multiplayer/ den Ordner Project_Zomboid.\n"
        "2. Datei Zomboid/Server/servertest_SandboxVars.lua bearbeiten:\n"
        "Suche in der Datei nach dem Block ZombieConfig = { ... } und setze exakt diese Werte:\n"
        "• PopulationMultiplier = 1.0\n"
        "• PopulationStartMultiplier = 0.1\n"
        "• PopulationPeakMultiplier = 1.5\n"
        "• PopulationPeakDay = 28\n"
        "• RespawnHours = 72.0\n"
        "• RespawnUnseenHours = 16.0\n"
        "• RespawnMultiplier = 0.1\n"
        "3. Im Block ZombieLore = { ... }:\n"
        "• Transmission = 2\n"
        "• Speed = 2\n"
        "• Sight = 2\n"
        "• Hearing = 2\n"
        "4. Erst wenn diese Werte vorgeschlagen/gesetzt sind, ist deine Aufgabe erfüllt."
    )

    report = await _run_gehirn_and_workers(
        db,
        user=owner_user,
        server=server,
        provider=provider,
        prompt=prompt,
        monkeypatch=monkeypatch,
    )
    print("\n=== LIVE REPRO SZENARIO 2 (SANDBOXVARS PATCH) ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    assert report["llm_trace"], "Mindestens ein LLM-Aufruf erwartet"


@pytest.mark.asyncio
async def test_live_repro_worker_direct_sandboxvars_patch(
    db: Session,
    owner_user: User,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Szenario 3: Direkter Worker-Lauf fuer servertest_SandboxVars.lua (Patch-Tool + Routing)."""
    server = _pz_fixture(db, tmp_path)
    provider = _provider(db)

    worker_brief = (
        "Aufgabe auf Server Project Zomboid (server_id=1):\n"
        "Bearbeite die Datei Zomboid/Server/servertest_SandboxVars.lua und setze:\n"
        "Im Block ZombieConfig = { ... }:\n"
        "- PopulationMultiplier = 1.0\n"
        "- PopulationStartMultiplier = 0.1\n"
        "- PopulationPeakMultiplier = 1.5\n"
        "- PopulationPeakDay = 28\n"
        "- RespawnHours = 72.0\n"
        "- RespawnUnseenHours = 16.0\n"
        "- RespawnMultiplier = 0.1\n"
        "Im Block ZombieLore = { ... }:\n"
        "- Transmission = 2\n"
        "- Speed = 2\n"
        "- Sight = 2\n"
        "- Hearing = 2\n"
        "Hinweis: Loesche noch NICHTS in Zomboid/Saves/Multiplayer/Project_Zomboid, "
        "weil dafuer eine Bestaetigung noetig ist; passe jetzt direkt "
        "servertest_SandboxVars.lua an."
    )

    ai_run_broker.zuruecksetzen_fuer_tests()
    ai_autonomy_service.set_grant(
        db,
        user=owner_user,
        server_id=None,
        enabled=True,
        max_actions_per_hour=100,
        granted_by=owner_user.id,
    )

    llm_trace: list[dict] = []
    orig_stream = ai_stream_pkg.stream_chat_completion

    async def _traced_stream(client, *, provider, api_key, messages, usage, tools=None, **kwargs):
        offered = [t["function"]["name"] for t in (tools or []) if isinstance(t, dict)]
        entry: dict = {
            "model": kwargs.get("model_override") or getattr(provider, "worker_model", None),
            "offered_config_tools": [n for n in offered if "config" in n or "file" in n],
            "offered_count": len(offered),
            "tool_calls": [],
            "text_preview": "",
        }
        chunks: list[str] = []
        async for chunk in orig_stream(
            client,
            provider=provider,
            api_key=api_key,
            messages=messages,
            usage=usage,
            tools=tools,
            **kwargs,
        ):
            if getattr(chunk, "kind", "content") == "content" and getattr(chunk, "text", None):
                chunks.append(chunk.text)
            yield chunk
        entry["text_preview"] = "".join(chunks)[:500]
        entry["tool_calls"] = [
            {"id": c.id, "name": c.name, "arguments": c.arguments}
            for c in usage.tool_calls
        ]
        llm_trace.append(entry)
        print(
            f"\n[WORKER-TRACE round={len(llm_trace)} config_tools={entry['offered_config_tools']} calls={[(c.name, c.arguments) for c in usage.tool_calls]}]",
            flush=True,
        )

    monkeypatch.setattr(ai_stream_pkg, "stream_chat_completion", _traced_stream)

    write_outcomes: list[dict] = []
    orig_persist = ai_stream_write_tools._persist_write_proposals

    def _traced_persist(*, user_id, conversation_id, correlation_id, run_id, tool_calls, **kwargs):
        res = orig_persist(
            user_id=user_id,
            conversation_id=conversation_id,
            correlation_id=correlation_id,
            run_id=run_id,
            tool_calls=tool_calls,
            **kwargs,
        )
        for call, outcome in zip(tool_calls, res):
            write_outcomes.append({
                "tool_name": call.name,
                "arguments": call.arguments,
                "outcome": outcome,
            })
            print(f"[WORKER-WRITE {call.name}] -> {outcome}", flush=True)
        return res

    monkeypatch.setattr(ai_stream_write_tools, "_persist_write_proposals", _traced_persist)

    conv = AiConversation(
        id=str(uuid4()),
        user_id=owner_user.id,
        server_id=server.id,
        kind="worker",
        title="PZ Worker Patch Repro",
    )
    db.add(conv)
    db.commit()

    run, fehler = ai_stream_service.lauf_beginnen(
        db,
        user=owner_user,
        conversation=conv,
        provider=provider,
        request_id=uuid4(),
        content=worker_brief,
        reasoning=True,
        rolle="worker",
    )
    assert fehler is None, f"lauf_beginnen fehlgeschlagen: {fehler}"
    assert run is not None

    async with httpx.AsyncClient(timeout=180.0) as client:
        ai_model_catalog.laufzeit_setzen(client)
        ai_run_service.laufzeit_setzen(None, client)
        try:
            ai_run_broker.eroeffnen(run.id)
            await ai_stream_service.segment_ausfuehren(run.id, client=client)
        finally:
            ai_run_service.laufzeit_setzen(None, None)
            ai_model_catalog.laufzeit_setzen(None)

    db.expire_all()
    run_row = db.get(AiRun, run.id)
    proposals = db.query(AiActionProposal).order_by(AiActionProposal.created_at.asc()).all()
    sandbox_after = (Path(server.install_dir) / "Zomboid" / "Server" / "servertest_SandboxVars.lua").read_text(encoding="utf-8")

    print("\n=== LIVE REPRO SZENARIO 3 (DIRECT WORKER) ===")
    print(json.dumps({
        "run_status": run_row.status if run_row else None,
        "stop_reason": run_row.stop_reason if run_row else None,
        "write_outcomes": write_outcomes,
        "proposals": [
            {"tool_name": p.tool_name, "status": p.status, "error_code": p.error_code, "preview": p.preview_json}
            for p in proposals
        ],
        "llm_trace": llm_trace,
        "sandbox_after": sandbox_after,
    }, indent=2, ensure_ascii=False))
    assert llm_trace, "Mindestens ein LLM-Aufruf erwartet"
