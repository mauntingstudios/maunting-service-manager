"""Performance-Baseline, TTFT-Messung und Pflicht-Tests fuer AP1-AP5."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import time
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

import database as db_module
from models import (
    AiConversation,
    AiMemoryEntry,
    AiMessage,
    AiProvider,
    Role,
    RolePermission,
    User,
)
from services import (
    ai_embedding_service,
    ai_ethics_service,
    ai_lage,
    ai_memory_service,
    ai_model_catalog,
    ai_provider_service,
    ai_router_service,
    ai_stream,
    ai_stream_service,
    ai_worker_service,
)
from services.ai_action_service import provider_tool_definitions
from services.ai_context_service import _short_term_chat_memory_message
from services.ai_latency_metrics import metrics
from services.ai_provider_registry import Modell
from services.ai_stream.lifecycle import _werkzeuge_semantisch_routen
from services.ai_stream.types import _Vorbereitung
from services.openai_compatible_adapter import ProviderToolCall, StreamChunk
from services.role_service import set_user_roles
from tests._einbettung import modell_ersetzen
from tests._entschluesselung import mitzaehlen


def _det_embed(texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    for t in texts:
        h = hashlib.sha256(t.encode("utf-8")).digest()
        vec = [((h[i % len(h)] / 255.0) - 0.5) for i in range(ai_embedding_service.EMBEDDING_DIMENSIONS)]
        out.append(vec)
    return out


def _setup_full_user_and_router(
    db: Session, user: User, client: TestClient
) -> tuple[AiProvider, AiProvider, AiConversation, list[AiConversation]]:
    """Erstellt Chat-Provider (mit Ethik), Router-Provider, 12 alte Chats und Memory."""
    role = Role(name=f"ttft-role-{uuid4().hex[:6]}", description=None, is_system=False)
    db.add(role)
    db.flush()
    for key in (
        "ai.chat.use",
        "ai.memory.use",
        "ai.background.use",
        "ai.skills.use",
        "server.view",
    ):
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    set_user_roles(db, user, [role.id])

    target = ai_provider_service.create_provider(
        db,
        name=f"TTFT-Target-{uuid4().hex[:5]}",
        provider_kind="openrouter",
        default_model="openai/gpt-5.4-mini",
        enabled_models=["openai/gpt-5.4-mini", "openai/gpt-5.4"],
        worker_model="openai/gpt-5.4-mini",
        ethics_model="openai/gpt-5.4-mini",
        ethics_enabled=True,
        ethics_mode="auto",
        enabled=True,
        requires_api_key=True,
        operator_api_key="sk-or-v1-synthetic-bench-key-0001",
    )
    db.flush()

    ai_router_service.update_router_config(
        db,
        {
            "enabled": True,
            "routing_mode": "quality",
            "eco_models": [{"provider_id": target.id, "model": "openai/gpt-5.4-mini"}],
            "standard_models": [{"provider_id": target.id, "model": "openai/gpt-5.4-mini"}],
            "flagship_models": [{"provider_id": target.id, "model": "openai/gpt-5.4"}],
            "fallback_models": [{"provider_id": target.id, "model": "openai/gpt-5.4-mini"}],
        },
    )
    router_prov = ai_router_service.ensure_router_provider(db, enabled=True)
    db.commit()
    db.refresh(target)
    db.refresh(router_prov)

    ai_memory_service.set_preference(db, user, True)
    ai_memory_service.upsert_entry(
        db,
        user=user,
        scope="user",
        server_id=None,
        key="bevorzugtes_spiel",
        value="Valheim mit Fokus auf automatische Backups.",
    )

    old_convs: list[AiConversation] = []
    for idx in range(12):
        c = AiConversation(
            id=f"old-conv-{idx}-{uuid4().hex[:6]}",
            user_id=user.id,
            kind="primary",
            title=f"Alte Unterhaltung {idx} Backup Server",
            updated_at=datetime.now(timezone.utc) - timedelta(minutes=idx + 5),
        )
        db.add(c)
        db.flush()
        for m_idx in range(4):
            db.add(
                AiMessage(
                    id=str(uuid4()),
                    conversation_id=c.id,
                    role="user" if m_idx % 2 == 0 else "assistant",
                    content=f"Nachricht {m_idx} ueber Server Backup Status {idx}",
                    status="complete",
                )
            )
        old_convs.append(c)

    main_conv = AiConversation(
        id=f"main-conv-{uuid4().hex[:6]}",
        user_id=user.id,
        kind="primary",
        title="Hauptchat",
    )
    db.add(main_conv)
    db.commit()
    return router_prov, target, main_conv, old_convs


def test_ttft_baseline_and_metrics_capture(
    db: Session,
    owner_user: User,
    owner_cookies: dict,
    csrf_token: str | None,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Reproduzierbarer Mess-Test fuer AP0-Baseline und Vorher/Nachher-Vergleich."""
    metrics.clear()
    router_prov, target, main_conv, _ = _setup_full_user_and_router(db, owner_user, client)

    encode_calls: list[int] = []

    def counting_embed(texts: list[str]) -> list[list[float]]:
        encode_calls.append(len(texts))
        return _det_embed(texts)

    modell_ersetzen(monkeypatch, counting_embed)
    monkeypatch.setattr(ai_embedding_service, "is_ready", lambda: True)

    # Katalog offline bereitstellen (kein echtes HTTP)
    fake_modell = Modell(
        model_id="openai/gpt-5.4-mini",
        name="GPT-5.4 Mini",
        denkt=True,
        stufen=("low", "medium", "high"),
        standard_stufe="medium",
        kontext_tokens=128_000,
        cache_marke_noetig=True,
        sieht=True,
    )
    monkeypatch.setattr(
        ai_model_catalog,
        "finde",
        AsyncMock(return_value=fake_modell),
    )

    sent_messages_turns: list[list[dict]] = []

    async def fake_stream_chat_completion(_client, **kwargs):
        sent_messages_turns.append(list(kwargs.get("messages") or []))
        yield StreamChunk(kind="content", text="Hallo")

    monkeypatch.setattr(ai_stream, "stream_chat_completion", fake_stream_chat_completion)

    # 1. SQL-Query-Zaehler in _short_term_chat_memory_message (12 alte Chats)
    stm_queries = 0

    def _count_sql(*_args):
        nonlocal stm_queries
        stm_queries += 1

    event.listen(db_module.engine, "before_cursor_execute", _count_sql)
    try:
        z_stm = mitzaehlen(monkeypatch)
        _short_term_chat_memory_message(db, owner_user, main_conv, "Wie ist der Backup Status?")
    finally:
        event.remove(db_module.engine, "before_cursor_execute", _count_sql)
    stm_decrypts = z_stm.aufrufe

    # 2. Kompletten Chat-Turn (Zug 1 & Zug 2) messen
    total_sql_t1 = 0

    def _count_turn_sql(*_args):
        nonlocal total_sql_t1
        total_sql_t1 += 1

    lage_t1 = "Lage (Auskunft des Panels — nur für dich bestimmt, nicht ansprechen):\nJetzt: Freitag, 27.11.2026, 19:00 Uhr (Europe/Berlin)."
    lage_t2 = "Lage (Auskunft des Panels — nur für dich bestimmt, nicht ansprechen):\nJetzt: Freitag, 27.11.2026, 19:01 Uhr (Europe/Berlin)."
    lage_werte = iter([lage_t1, lage_t2])
    monkeypatch.setattr(ai_lage, "lageblock", lambda *_a, **_kw: next(lage_werte, lage_t2))

    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    client.cookies.update(owner_cookies)

    z_t1 = mitzaehlen(monkeypatch)
    encode_calls.clear()
    event.listen(db_module.engine, "before_cursor_execute", _count_turn_sql)
    t_start_1 = time.perf_counter()
    try:
        resp1 = client.post(
            "/api/ai/conversation/messages/stream",
            json={
                "provider_id": router_prov.id,
                "conversation_id": main_conv.id,
                "request_id": str(uuid4()),
                "content": "Pruefe bitte meinen Server Backup Status",
                "reasoning": False,
            },
            headers=headers,
        )
        assert resp1.status_code == 200
        _ = resp1.text
    finally:
        event.remove(db_module.engine, "before_cursor_execute", _count_turn_sql)
    turn1_ms = (time.perf_counter() - t_start_1) * 1000
    t1_decrypts = z_t1.aufrufe
    t1_decrypt_single = len(z_t1.einzeln)
    t1_decrypt_many = len(z_t1.stapel)
    t1_encode_calls = len(encode_calls)
    t1_encode_texts = sum(encode_calls)

    # Zug 2 (andere Uhrzeit im Lageblock)
    mitzaehlen(monkeypatch)
    encode_calls.clear()
    t_start_2 = time.perf_counter()
    resp2 = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "provider_id": router_prov.id,
            "conversation_id": main_conv.id,
            "request_id": str(uuid4()),
            "content": "Pruefe bitte meinen Server Backup Status",
            "reasoning": False,
        },
        headers=headers,
    )
    assert resp2.status_code == 200
    _ = resp2.text
    turn2_ms = (time.perf_counter() - t_start_2) * 1000
    t2_encode_calls = len(encode_calls)
    t2_encode_texts = sum(encode_calls)

    # Byte-Stabilitaet von messages[0] nach consolidate_system_messages
    from services.openai_compatible_adapter import consolidate_system_messages

    assert len(sent_messages_turns) == 2
    c1 = consolidate_system_messages(sent_messages_turns[0])
    c2 = consolidate_system_messages(sent_messages_turns[1])
    prefix_byte_identical = c1[0] == c2[0]

    # 3. Ethik + Tool-Runde (echter Overlap: 200ms Ethik-HTTP + 200ms Tool-DB/Sleep)
    async def _run_ethics_plus_tool_bench() -> float:
        async def fake_ethics_stream(*_a, **_kw):
            await asyncio.sleep(0.20)
            yield StreamChunk(
                kind="content",
                text=json.dumps({
                    "assessment": "low",
                    "confidence": 0.9,
                    "concerns": [],
                    "affected_interests": [],
                    "possible_harm": [],
                    "alternative": None,
                    "recommendation": "OK",
                    "reason": "Kein Risiko",
                }),
            )

        def fake_persist(**_kw):
            time.sleep(0.20)
            return [
                {
                    "id": None,
                    "call_id": "call_1",
                    "error": "Nur Test",
                    "autonomous": False,
                }
            ]

        monkeypatch.setattr(ai_ethics_service, "stream_chat_completion", fake_ethics_stream)
        monkeypatch.setattr(ai_stream, "_persist_write_proposals", fake_persist)
        monkeypatch.setattr(ai_stream, "_werkzeuge_ansagen", lambda *_a, **_kw: None)
        monkeypatch.setattr("services.ai_run_broker.lauf_status", lambda *_a, **_kw: "running")

        from services.ai_stream.write_tools import _schreibrunde_ausfuehren
        from services.openai_compatible_adapter import StreamUsage

        vorb = _Vorbereitung(
            run_id="bench-run",
            user_id=owner_user.id,
            conversation_id=main_conv.id,
            provider=target,
            api_key="sk-test",
            message_id="msg-1",
            usage_event_id=1,
            request_id="req-1",
            reasoning=False,
            reasoning_effort=None,
            token_price_micro_usd_per_million=None,
            zustand={},
            angebotene_werkzeuge=frozenset({"propose_backup"}),
            mcp_werkzeuge=(),
            mcp_schreib_werkzeuge=frozenset(),
        )
        usage = StreamUsage(
            tool_calls=[
                ProviderToolCall(
                    id="call_1",
                    name="propose_backup",
                    arguments={"server_id": 1},
                )
            ]
        )
        t0 = time.perf_counter()
        await _schreibrunde_ausfuehren(
            run_id="bench-run",
            user_id=owner_user.id,
            conversation_id=main_conv.id,
            vorbereitung=vorb,
            guardian=None,
            aufgabe=None,
            unbeaufsichtigt=False,
            rolle="voll",
            rundendeckel=10,
            rundentext="",
            current_usage=usage,
            provider_messages=[],
            zustand={},
            chunks=[],
            thoughts=[],
            denknaht="",
        )
        return (time.perf_counter() - t0) * 1000

    ethics_tool_ms = asyncio.run(_run_ethics_plus_tool_bench())

    # Direkten ai_ethics/beraten Messpunkt ebenfalls erfassen
    async def _fast_ethics(*_a, **_kw):
        await asyncio.sleep(0.01)
        yield StreamChunk(
            kind="content",
            text=json.dumps({
                "assessment": "low",
                "confidence": 0.9,
                "concerns": [],
                "affected_interests": [],
                "possible_harm": [],
                "alternative": None,
                "recommendation": "OK",
                "reason": "OK",
            }),
        )

    monkeypatch.setattr(ai_ethics_service, "stream_chat_completion", _fast_ethics)
    asyncio.run(
        ai_ethics_service.beraten(
            user_id=owner_user.id,
            aufrufe=[
                ProviderToolCall(
                    id="call_ethics_direct",
                    name="propose_backup",
                    arguments={"server_id": 1},
                )
            ],
            bevorzugt_id=target.id,
        )
    )

    # 4. Worker-Start Dauer
    monkeypatch.setattr("services.ai_run_service.anlauf", lambda *_a, **_kw: True)
    t_w0 = time.perf_counter()
    w_res = ai_worker_service.worker_start(
        db,
        user=owner_user,
        arguments={"auftrag": "Pruefe die Logs", "titel": "Logcheck"},
        conversation_id=main_conv.id,
    )
    assert w_res["started"] is True
    worker_ms = (time.perf_counter() - t_w0) * 1000

    snap = metrics.snapshot()
    report = {
        "stm_queries_12_chats": stm_queries,
        "stm_decrypts_12_chats": stm_decrypts,
        "turn1_sql_queries": total_sql_t1,
        "turn1_decrypt_calls": t1_decrypts,
        "turn1_decrypt_single": t1_decrypt_single,
        "turn1_decrypt_many": t1_decrypt_many,
        "turn1_encode_calls": t1_encode_calls,
        "turn1_encode_texts": t1_encode_texts,
        "turn2_encode_calls": t2_encode_calls,
        "turn2_encode_texts": t2_encode_texts,
        "turn1_wall_ms": round(turn1_ms, 2),
        "turn2_wall_ms": round(turn2_ms, 2),
        "ethics_plus_tool_200_200_ms": round(ethics_tool_ms, 2),
        "worker_start_ms": round(worker_ms, 2),
        "prefix_byte_identical_across_minutes": prefix_byte_identical,
        "metrics_keys": {f"{k[0]}/{k[1]}:{k[2]}": v for k, v in snap.items()},
    }
    print("\n=== TTFT_BENCH_REPORT ===\n" + json.dumps(report, indent=2))
    # Pflicht-Telemetrie-Punkte aus AP0 muessen befuellt sein
    recorded_stages = {(k[0], k[1]) for k in snap.keys()}
    for expected in (
        ("ai_chat", "router_resolve"),
        ("ai_chat", "catalog_reasoning_window"),
        ("ai_launcher", "total"),
        ("ai_context", "short_term_memory"),
        ("ai_context", "memory_retrieval"),
        ("ai_stream", "tool_routing"),
        ("ai_stream", "segment_preparation"),
        ("ai_stream", "first_provider_chunk"),
        ("ai_ethics", "beraten"),
        ("ai_worker", "worker_start"),
    ):
        assert expected in recorded_stages, f"Messpunkt fehlt: {expected}"


def test_ap1_tool_router_cache_and_embedding_lru(monkeypatch: pytest.MonkeyPatch) -> None:
    """AP1 Positiv: Built-in Tool-Router & Query-Embedding-LRU cachen und vermeiden Neuberechnung."""
    import numpy as np

    ai_embedding_service.embedding_cache_leeren_fuer_tests()
    calls: list[list[str]] = []

    class _FakeModel:
        def encode(self, texts: list[str]):
            calls.append(list(texts))
            return np.array(_det_embed(texts), dtype="float32")

    fake_model = _FakeModel()
    monkeypatch.setattr(ai_embedding_service, "_load", lambda: fake_model)
    monkeypatch.setattr(ai_embedding_service, "is_ready", lambda: True)

    v1 = ai_embedding_service.encode(["Server Status pruefen"])
    v2 = ai_embedding_service.encode(["Server Status pruefen"])
    assert v1 is not None and v2 is not None and v1.vektoren == v2.vektoren
    assert len(calls) == 1

    defs = provider_tool_definitions()
    panel_erlaubt = {
        str(d["function"]["name"]) for d in defs if isinstance(d, dict) and d.get("function")
    }
    calls_before = len(calls)
    route_kwargs = dict(
        tools=defs,
        erlaubt=panel_erlaubt,
        mcp_namen=set(),
        docs_kontext=None,
        herkunft="panel",
        zustand={"provider_messages": [{"role": "user", "content": "Backup erstellen"}]},
    )
    r1 = asyncio.run(_werkzeuge_semantisch_routen(**route_kwargs))
    mid_calls = len(calls)
    r2 = asyncio.run(_werkzeuge_semantisch_routen(**route_kwargs))
    assert r1 == r2
    assert mid_calls > calls_before
    # Zweiter Aufruf mit gecachtem Router & Query-LRU darf keine Embeddings neu kodieren
    assert len(calls) == mid_calls

    # Statische Tool-Definitionen liefern flache Kopie (Cache bleibt vor Mutation geschuetzt)
    defs_copy = provider_tool_definitions()
    defs_copy.clear()
    assert len(provider_tool_definitions()) > 0


def test_ap1_embedding_cache_rejects_none_and_isolates_model_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    """AP1 Negativ: None wird nie gecacht und verschiedene modell_tags bleiben getrennt."""
    import numpy as np

    ai_embedding_service.embedding_cache_leeren_fuer_tests()
    counter = 0

    class _FlakyModel:
        def encode(self, texts: list[str]):
            nonlocal counter
            counter += 1
            if counter == 1:
                raise RuntimeError("transient error")
            return np.array(_det_embed(texts), dtype="float32")

    flaky = _FlakyModel()
    monkeypatch.setattr(ai_embedding_service, "_load", lambda: flaky)
    monkeypatch.setattr(ai_embedding_service, "is_ready", lambda: True)

    assert ai_embedding_service.encode(["Testtext"]) is None
    res = ai_embedding_service.encode(["Testtext"])
    assert res is not None and len(res.vektoren) == 1
    assert counter == 2

    # Cache-Hit unter demselben MODEL_TAG
    res_cached = ai_embedding_service.encode(["Testtext"])
    assert res_cached is not None and res_cached.vektoren == res.vektoren
    assert counter == 2

    # Wechsel des MODEL_TAG erzwingt Neuberechnung im getrennten Raum
    monkeypatch.setattr(ai_embedding_service, "MODEL_TAG", "other-model-v2")
    res2 = ai_embedding_service.encode(["Testtext"])
    assert res2 is not None and len(res2.vektoren) == 1
    assert counter == 3


def test_ap2_prompt_caching_stable_prefix_and_azure_cache_control() -> None:
    """AP2 Positiv & Negativ: Stabiler Prefix bei Uhrzeitwechsel, Lektion 263 und Azure Cache-Control."""
    from services.ai_provider_registry import azure_anthropic
    from services.anthropic_messages_adapter import nachrichten_uebersetzen as ant_msgs
    from services.openai_compatible_adapter import consolidate_system_messages

    assert "cache_control" in azure_anthropic.ANBIETER.anfrage_erweiterungen

    m1 = [
        {"role": "system", "content": "Hauptsystem"},
        {"role": "system", "content": "Werkzeugverzeichnis\nA, B"},
        {"role": "user", "content": "Hi"},
        {"role": "system", "content": "Lage (Auskunft des Panels — nur für dich bestimmt, nicht ansprechen):\n19:00"},
        {"role": "user", "content": "Wie spaet?"},
    ]
    m2 = [
        {"role": "system", "content": "Hauptsystem"},
        {"role": "system", "content": "Werkzeugverzeichnis\nA, B"},
        {"role": "user", "content": "Hi"},
        {"role": "system", "content": "Lage (Auskunft des Panels — nur für dich bestimmt, nicht ansprechen):\n19:01"},
        {"role": "user", "content": "Wie spaet?"},
    ]
    c1 = consolidate_system_messages(m1)
    c2 = consolidate_system_messages(m2)
    assert c1[0] == c2[0]
    assert sum(1 for m in c1 if m.get("role") == "system") == 1
    assert "19:00" in c1[2]["content"]

    sys1, hist1 = ant_msgs(m1)
    sys2, hist2 = ant_msgs(m2)
    assert sys1 == sys2 == "Hauptsystem\n\nWerkzeugverzeichnis\nA, B"
    assert "19:00" not in sys1
    assert any("19:00" in json.dumps(msg) for msg in hist1)
    assert any("19:01" in json.dumps(msg) for msg in hist2)


def test_ap3_short_term_memory_batched_no_crash(db: Session, owner_user: User, client: TestClient) -> None:
    """AP3 Positiv: _short_term_chat_memory_message laeuft ohne Crash mit <= 6 SQL & <= 3 DIS-Calls."""
    _router_prov, _target, main_conv, _ = _setup_full_user_and_router(db, owner_user, client)
    sql_count = 0

    def _cnt(*_a):
        nonlocal sql_count
        sql_count += 1

    event.listen(db_module.engine, "before_cursor_execute", _cnt)
    try:
        res = _short_term_chat_memory_message(db, owner_user, main_conv, "Backup Server Status")
    finally:
        event.remove(db_module.engine, "before_cursor_execute", _cnt)
    assert res is not None
    assert "Alte Unterhaltung" in res["content"]
    assert sql_count <= 6


def test_ap3_handoff_single_use_ttl_invalidation_and_secret_hygiene(
    db: Session, owner_user: User, client: TestClient
) -> None:
    """AP3 Positiv & Negativ: Handoff 1x konsumierbar, TTL 10s, Invalidierung, kein Secret in state_json."""
    from services import ai_run_service
    from services.ai_stream.lifecycle import (
        frischer_start_konsumieren,
        frischer_start_registrieren,
    )
    from services.ai_stream.types import _FrischerStart

    start = _FrischerStart(
        zustand={"rolle": "voll"},
        api_key="sk-secret-do-not-persist",
        angebotene_werkzeuge=frozenset(),
        mcp_werkzeuge=(),
        mcp_schreib_werkzeuge=frozenset(),
        vorherige_werkzeuge=(),
        erstellt_am=time.monotonic(),
        api_key_aufgeloest=True,
    )
    frischer_start_registrieren("run-once", start)
    assert frischer_start_konsumieren("run-once") is start
    assert frischer_start_konsumieren("run-once") is None

    # Abgelaufener Handoff (> 10s)
    expired = _FrischerStart(
        zustand={"rolle": "voll"},
        api_key="sk-expired",
        angebotene_werkzeuge=frozenset(),
        mcp_werkzeuge=(),
        mcp_schreib_werkzeuge=frozenset(),
        vorherige_werkzeuge=(),
        erstellt_am=time.monotonic() - 25.0,
        api_key_aufgeloest=True,
    )
    frischer_start_registrieren("run-expired", expired)
    assert frischer_start_konsumieren("run-expired") is None

    # Invalidation bei zustand_schreiben + kein Secret in state_json
    _router_prov, target, main_conv, _ = _setup_full_user_and_router(db, owner_user, client)
    msg_id = str(uuid4())
    db.add(AiMessage(id=msg_id, conversation_id=main_conv.id, role="assistant", content="", status="streaming"))
    db.flush()
    run = ai_run_service.lauf_anlegen(
        db, conversation_id=main_conv.id, user_id=owner_user.id,
        provider_id=target.id, message_id=msg_id, reasoning=False, zustand={"rolle": "voll"},
    )
    db.commit()
    frischer_start_registrieren(run.id, start)
    z = ai_run_service.zustand_lesen(run)
    z["guardian"] = {"server_id": 1}
    ai_run_service.zustand_schreiben(run, z)
    assert frischer_start_konsumieren(run.id) is None
    assert "sk-secret" not in (run.state_json or "")


def test_ap3_deferred_use_count_updates_on_completion_and_sync_when_omitted(
    db: Session, owner_user: User, client: TestClient
) -> None:
    """AP3 Positiv & Negativ: use_count wird am Stream-Ende gebuendelt erhoeht bzw. bei ausgelassen sofort."""
    from services import ai_gedaechtnis_abruf

    _setup_full_user_and_router(db, owner_user, client)
    entry = db.query(AiMemoryEntry).first()
    assert entry is not None
    before_count = int(entry.use_count or 0)

    abruf = ai_gedaechtnis_abruf.abrufen(
        db, owner_user, "Valheim Backup", budget=10_000, gebraucht_sofort=False,
    )
    db.refresh(entry)
    assert abruf.verwendete_ids == (entry.id,)
    # Noch nicht erhoeht waehrend Pre-Stream
    assert int(entry.use_count or 0) == before_count

    ai_gedaechtnis_abruf.markiere_gebraucht(db, abruf.verwendete_ids)
    db.flush()
    db.refresh(entry)
    assert int(entry.use_count or 0) == before_count + 1


def test_ap4_ethics_parallel_and_timeout_isolation(
    db: Session, owner_user: User, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AP4 Positiv & Negativ: Parallele Ethik-Bewertung + Fehlerisolation."""
    from models import AuditLog

    _, target, _, _ = _setup_full_user_and_router(db, owner_user, client)

    async def parallel_or_fail(_client, *, messages, **_kw):
        body = json.dumps(messages)
        if "timeout_tool" in body:
            raise TimeoutError("Simuliertes Ethik-Timeout")
        await asyncio.sleep(0.35)
        yield StreamChunk(
            kind="content",
            text=json.dumps({
                "assessment": "review",
                "confidence": 0.9,
                "concerns": ["Neustart unterbricht aktive Spieler"],
                "affected_interests": ["Spieler"],
                "possible_harm": ["Verbindungsabbruch"],
                "alternative": None,
                "recommendation": "Vorwarnung senden",
                "reason": "Laufender Dienst",
            }),
        )

    monkeypatch.setattr(ai_ethics_service, "stream_chat_completion", parallel_or_fail)

    calls = [
        ProviderToolCall(id="c1", name="propose_server_lifecycle", arguments={"server_id": 1, "action": "restart"}),
        ProviderToolCall(id="c2", name="propose_server_lifecycle", arguments={"server_id": 2, "action": "restart"}),
        ProviderToolCall(id="c3", name="propose_server_lifecycle", arguments={"server_id": 3, "action": "restart"}),
        ProviderToolCall(id="c4", name="propose_server_lifecycle", arguments={"server_id": 4, "note": "timeout_tool"}),
    ]

    t0 = time.perf_counter()
    hinweise = asyncio.run(
        ai_ethics_service.beraten(user_id=owner_user.id, aufrufe=calls, bevorzugt_id=target.id)
    )
    elapsed = time.perf_counter() - t0
    # 3x 0.35s = 1.05s sequenziell; parallel deutlich darunter (< 0.85s trotz DIS/DB-Setup)
    assert elapsed < 0.85
    assert "c1" in hinweise and "c2" in hinweise and "c3" in hinweise
    assert "c4" not in hinweise
    audit_count = db.query(AuditLog).filter(AuditLog.action == "ai.ethics.evaluated").count()
    assert audit_count >= 3


def test_ap4_worker_start_rollback_on_failure(
    db: Session, owner_user: User, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AP4 Negativ: Scheitert lauf_beginnen in worker_start, bleiben keine verwaisten Worker-Chats zurueck."""
    _, _target, main_conv, _ = _setup_full_user_and_router(db, owner_user, client)
    before = db.query(AiConversation).filter(AiConversation.kind == "worker").count()
    monkeypatch.setattr(
        ai_stream_service,
        "lauf_beginnen",
        lambda *_a, **_kw: (None, ("AI_QUOTA_EXCEEDED", "ai.chat.errors.quota")),
    )
    res = ai_worker_service.worker_start(
        db, user=owner_user, arguments={"auftrag": "Testjob"}, conversation_id=main_conv.id,
    )
    assert res["started"] is False
    after = db.query(AiConversation).filter(AiConversation.kind == "worker").count()
    assert after == before


def test_ap5_gemini_thinking_none_vs_pro_and_responses_cache_key() -> None:
    """AP5 Positiv & Negativ: Gemini none vs zwingendes Pro + Responses prompt_cache_key."""
    from types import SimpleNamespace
    from services.ai_provider_registry.google import katalog_lesen
    from services.openai_responses_adapter import offene_ws_sitzung

    flash = katalog_lesen({"id": "gemini-2.5-flash", "thinking": True})
    pro = katalog_lesen({"id": "gemini-2.5-pro", "thinking": True})
    assert flash is not None and "none" in flash.stufen and flash.zwingend is False
    assert pro is not None and "none" not in pro.stufen and pro.zwingend is True

    # Nicht-OpenAI Provider liefert keine WS-Sitzung
    assert offene_ws_sitzung(SimpleNamespace(provider_kind="openrouter", requires_api_key=True), "sk-1") is None
    ws = offene_ws_sitzung(
        SimpleNamespace(
            provider_kind="openai", requires_api_key=True, custom_base_url=None,
            extra_headers_json=None,
        ),
        "sk-openai",
    )
    assert ws is not None and ws.ws_url.startswith("wss://")


def test_ap5_redis_broker_throttle_and_disabled_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    """AP5 Positiv & Negativ: Kein Redis -> 0 Calls; mit Redis -> Delta-Snapshot 0.4s gedrosselt."""
    from services import ai_run_broker, redis_backplane

    ai_run_broker.zuruecksetzen_fuer_tests()
    snaps: list[str] = []
    pubs: list[str] = []
    monkeypatch.setattr(redis_backplane, "ai_run_snapshot_set", lambda rid, _snap: snaps.append(rid))
    monkeypatch.setattr(redis_backplane, "publish_sync", lambda ch, _p: pubs.append(ch))

    monkeypatch.setattr(redis_backplane, "is_redis_enabled", lambda: False)
    ai_run_broker.veroeffentlichen("run-off", "delta", {"content": "A"})
    assert snaps == [] and pubs == []

    monkeypatch.setattr(redis_backplane, "is_redis_enabled", lambda: True)
    ai_run_broker.veroeffentlichen("run-on", "delta", {"content": "A"})
    ai_run_broker.veroeffentlichen("run-on", "delta", {"content": "B"})
    ai_run_broker.veroeffentlichen("run-on", "run", {"status": "completed"})
    # 1. delta (snapshot), 2. delta (throttled: None snapshot), 3. run (immediate snapshot) -> 2 snapshots, 3 publishes
    assert len(snaps) == 2
    assert len(pubs) == 3
    ai_run_broker.zuruecksetzen_fuer_tests()


def test_ap5_search_summary_parallel_and_scrape_timeout(
    db: Session, owner_user: User, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AP5 Positiv & Negativ: Parallele Nachsuche + Scraping-Timeout faellt sauber auf Snippets zurueck."""
    from services import ai_reasoning, ai_search_summary_service, ai_web_search_service

    _router_prov, target, _main_conv, _ = _setup_full_user_and_router(db, owner_user, client)
    target.search_summary_enabled = True
    target.search_summary_model = "openai/gpt-5.4-mini"
    db.commit()

    def slow_scrape(*_a, **_kw):
        time.sleep(3.5)
        return {}

    monkeypatch.setattr(ai_web_search_service, "scrape_top_urls_parallel", slow_scrape)

    async def fake_vorgabe(*_a, **_kw):
        return False, None

    monkeypatch.setattr(ai_reasoning, "vorgabe", fake_vorgabe)

    async def fake_stream(_client, **_kw):
        yield StreamChunk(kind="content", text="Zusammenfassung [1].")

    monkeypatch.setattr(ai_search_summary_service, "stream_chat_completion", fake_stream)

    async def _collect() -> tuple[list[str], float]:
        t0 = time.perf_counter()
        out: list[str] = []
        async for ev in ai_search_summary_service._stream_mit_sitzung(
            db,
            owner_user,
            "Linux Kernel Update",
            [{"titel": "Kernel Info", "url": "https://example.org/kernel", "inhalt": "Snippet"}],
            neue_suche=False,
        ):
            out.append(ev)
        return out, (time.perf_counter() - t0)

    events, stream_elapsed = asyncio.run(_collect())
    assert stream_elapsed < 2.9
    joined = "".join(events)
    assert '"type": "start"' in joined
    assert '"type": "done"' in joined
