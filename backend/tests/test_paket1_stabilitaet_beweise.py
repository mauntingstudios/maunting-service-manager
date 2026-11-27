"""Wirksamkeitsbeweise für Paket 1 (P0): DB-Transaktionsleaks, ASGI-Security-Headers und Live-500-Fixes."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

import database as db_module
from main import SecurityHeadersMiddleware, app
from models import AiMcpServer, Team, TeamMember, User, UserPresenceSession
from services.social_service import SocialService
from services.sync_event_service import SyncEventService


@pytest.mark.asyncio
async def test_worker_leader_lock_idle_not_in_transaction(monkeypatch: pytest.MonkeyPatch) -> None:
    """1A: Leader-Lock hält die Verbindung im Zustand 'idle', nicht 'idle in transaction'."""
    import worker

    real_engine = create_engine(db_module.engine.url, poolclass=NullPool)
    observer_engine = create_engine(db_module.engine.url, poolclass=NullPool)
    monkeypatch.setattr(worker, "engine", real_engine)

    stop_event = asyncio.Event()
    conn = None
    try:
        conn = await worker._acquire_leader_lock(stop_event)
        assert conn is not None
        lock_pid = int(conn.execute(text("SELECT pg_backend_pid()")).scalar_one())

        with observer_engine.connect() as obs:
            state = obs.execute(
                text("SELECT state FROM pg_stat_activity WHERE pid = :pid"),
                {"pid": lock_pid},
            ).scalar_one()
            assert state == "idle", f"Erwartet 'idle', war aber {state!r}"

            second_acquire = bool(
                obs.execute(
                    text("SELECT pg_try_advisory_lock(:lock_id)"),
                    {"lock_id": worker._PG_WORKER_LEADER_LOCK_ID},
                ).scalar_one()
            )
            assert second_acquire is False
    finally:
        if conn is not None:
            try:
                conn.execute(
                    text("SELECT pg_advisory_unlock(:lock_id)"),
                    {"lock_id": worker._PG_WORKER_LEADER_LOCK_ID},
                )
            finally:
                conn.close()
        real_engine.dispose()
        observer_engine.dispose()


@pytest.mark.asyncio
async def test_sse_live_events_no_idle_in_transaction_and_fast_shutdown(
    owner_cookies: dict,
) -> None:
    """1B: Während ein SSE-Stream offen ist, hängt keine DB-Session in 'idle in transaction'."""
    SyncEventService.clear_all_for_testing()
    observer_engine = create_engine(db_module.engine.url, poolclass=NullPool)
    cookie_header = "; ".join(f"{k}={v}" for k, v in owner_cookies.items()).encode("latin-1")
    in_q: asyncio.Queue[dict] = asyncio.Queue()
    out_q: asyncio.Queue[dict] = asyncio.Queue()

    async def receive() -> dict:
        return await in_q.get()

    async def send(message: dict) -> None:
        await out_q.put(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/events/live",
        "raw_path": b"/api/events/live",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"localhost:8000"),
            (b"cookie", cookie_header),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("localhost", 8000),
        "state": {},
    }

    app_task = asyncio.create_task(app(scope, receive, send))
    try:
        start_msg = await asyncio.wait_for(out_q.get(), timeout=3.0)
        assert start_msg["type"] == "http.response.start"
        assert start_msg["status"] == 200

        ready_seen = False
        for _ in range(5):
            msg = await asyncio.wait_for(out_q.get(), timeout=3.0)
            if msg["type"] == "http.response.body" and b"event: ready" in msg.get("body", b""):
                ready_seen = True
                break
        assert ready_seen, "Erstes SSE 'ready'-Event wurde nicht empfangen"

        with observer_engine.connect() as obs:
            leaks = obs.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() "
                    "AND state = 'idle in transaction' "
                    "AND pid <> pg_backend_pid()"
                )
            ).scalar_one()
            assert leaks == 0, f"{leaks} Verbindung(en) noch in 'idle in transaction'"

        SyncEventService.close_all()
        shutdown_seen = False
        body_done = False
        for _ in range(10):
            msg = await asyncio.wait_for(out_q.get(), timeout=1.5)
            if msg["type"] == "http.response.body":
                if b"event: shutdown" in msg.get("body", b""):
                    shutdown_seen = True
                if not msg.get("more_body", False):
                    body_done = True
                    break
        assert shutdown_seen, "SSE-Stream hat nicht sofort auf Shutdown reagiert"
        assert body_done, "SSE-Stream hat den Body nach Shutdown nicht geschlossen"
        await asyncio.wait_for(app_task, timeout=1.5)
    finally:
        if not app_task.done():
            await in_q.put({"type": "http.disconnect"})
            app_task.cancel()
            await asyncio.gather(app_task, return_exceptions=True)
        SyncEventService.clear_all_for_testing()
        observer_engine.dispose()


def test_security_headers_asgi_streaming_and_referrer_override() -> None:
    """1C: Reine ASGI-SecurityHeadersMiddleware streamt ohne Buffering und schützt no-referrer."""
    mini = FastAPI()
    mini.add_middleware(SecurityHeadersMiddleware)

    @mini.get("/api/stream-probe")
    async def stream_probe():
        async def gen():
            yield b"chunk-1\n"
            yield b"chunk-2\n"

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Referrer-Policy": "no-referrer"},
        )

    with TestClient(mini) as tc:
        with tc.stream("GET", "/api/stream-probe") as resp:
            assert resp.status_code == 200
            assert resp.headers["referrer-policy"] == "no-referrer"
            assert resp.headers["cache-control"] == "no-store"
            assert resp.headers["x-content-type-options"] == "nosniff"
            assert resp.headers["x-frame-options"] == "DENY"
            assert "default-src 'self'" in resp.headers["content-security-policy"]
            body = b"".join(resp.iter_bytes())
            assert body == b"chunk-1\nchunk-2\n"


def test_ai_mcp_list_http_and_stdio_returns_200(
    client: TestClient,
    db: Session,
    owner_user: User,
    owner_cookies: dict,
) -> None:
    """1D: GET /api/ai/mcp liefert HTTP 200 für globale, Team- und User-Server (HTTP + Stdio)."""
    team = Team(name="MCP Team", owner_user_id=owner_user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner_user.id, role="owner"))

    db.add_all(
        [
            AiMcpServer(
                scope="global",
                name="Global HTTP",
                description="Globaler MCP",
                transport="http",
                endpoint_url="https://mcp.example.invalid/global",
                auth_token_encrypted="Bearer global-secret",
                auth_token_hint="cret",
                cached_tools_json=json.dumps([{"name": "ping"}]),
                enabled=True,
            ),
            AiMcpServer(
                scope="team",
                team_id=team.id,
                name="Team SSE",
                transport="sse",
                endpoint_url="https://mcp.example.invalid/team",
                enabled=True,
            ),
            AiMcpServer(
                scope="user",
                user_id=owner_user.id,
                name="Lokaler Stdio",
                transport="stdio",
                command="npx",
                args_json=json.dumps(["-y", "@example/mcp"]),
                enabled=True,
            ),
        ]
    )
    db.commit()

    resp = client.get("/api/ai/mcp", cookies=owner_cookies)
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 3
    by_name = {r["name"]: r for r in rows}
    assert by_name["Global HTTP"]["endpoint_url"] == "https://mcp.example.invalid/global"
    assert by_name["Global HTTP"]["has_auth_header"] is True
    assert by_name["Team SSE"]["endpoint_url"] == "https://mcp.example.invalid/team"
    assert by_name["Lokaler Stdio"]["command"] == "npx"
    assert by_name["Lokaler Stdio"]["args"] == ["-y", "@example/mcp"]
    assert json.loads(by_name["Lokaler Stdio"]["command_json"]) == {
        "command": "npx",
        "args": ["-y", "@example/mcp"],
    }


@pytest.mark.echte_nebenlaeufigkeit
def test_presence_upsert_and_delete_concurrent_no_staledata_or_unique_violation(
    db: Session,
    owner_user: User,
) -> None:
    """1E: Parallele upsert_session + delete_session sowie Erst-Inserts werfen keine 500-DB-Fehler."""
    concurrent_engine = create_engine(db_module.engine.url, poolclass=NullPool)
    SessionMaker = sessionmaker(autocommit=False, autoflush=False, bind=concurrent_engine)
    user_id = owner_user.id
    shared_device = f"race-{uuid4().hex[:8]}"

    def first_insert(idx: int) -> None:
        with SessionMaker() as s:
            SocialService.upsert_session(
                s,
                user_id,
                geraet=shared_device,
                client="web",
                plattform="web",
                zustand="online",
                activity_key="chat" if idx % 2 == 0 else None,
                vorn=True,
            )

    def delete_loop() -> None:
        with SessionMaker() as s:
            for _ in range(15):
                SocialService.delete_session(s, user_id, shared_device)

    def upsert_loop() -> None:
        with SessionMaker() as s:
            for i in range(15):
                SocialService.upsert_session(
                    s,
                    user_id,
                    geraet=shared_device,
                    client="web",
                    plattform="web",
                    zustand="online" if i % 2 == 0 else "away",
                    activity_key="servers",
                    vorn=True,
                )

    try:
        # 1. Parallele Erst-Inserts auf exakt demselben (user_id, geraet)
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(first_insert, i) for i in range(6)]
            for fut in futures:
                fut.result()

        # 2. Paralleles upsert + delete ohne StaleDataError / IntegrityError
        with ThreadPoolExecutor(max_workers=4) as pool:
            futs = [
                pool.submit(upsert_loop),
                pool.submit(delete_loop),
                pool.submit(upsert_loop),
                pool.submit(delete_loop),
            ]
            for fut in futs:
                fut.result()

        with SessionMaker() as check_s:
            count = (
                check_s.query(UserPresenceSession)
                .filter_by(user_id=user_id, geraet=shared_device)
                .count()
            )
            assert count in (0, 1)
    finally:
        concurrent_engine.dispose()
