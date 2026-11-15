"""Dedicated MSM Control-Plane Worker process (``MSM_WORKER_MODE=worker``).

Separates APScheduler, node heartbeats, Guardian reconciliation, AI streams,
startup recovery, and schema initialization from the multi-worker Uvicorn HTTP
processes so workloads or hung remote nodes can never starve API/UI traffic.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import os
import signal
import sys
from types import SimpleNamespace
from uuid import uuid4

# Force worker role before importing config/database/services
os.environ["MSM_WORKER_MODE"] = "worker"

from sqlalchemy import text

from database import SessionLocal, engine
from services import redis_backplane
from services.lifespan_steps import (
    init_http_clients_and_ai_runtime,
    init_local_agent_and_background_jobs,
    reconcile_ai_runs_on_startup,
    recover_scheduler_and_cleanup_expired,
    seed_system_roles_and_migrate_legacy_permissions,
    shutdown_panel_services,
    sync_node_and_run_legacy_schema_bridges,
    verify_dis_and_upgrade_schema,
)

logger = logging.getLogger("msm.worker")

_PG_WORKER_LEADER_LOCK_ID = 719402


def _setup_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


async def _acquire_leader_lock(stop_event: asyncio.Event):
    """Acquire singleton worker leadership via PostgreSQL advisory lock when available.

    Returns the held DB connection (kept open while leading) or ``None`` for
    non-PostgreSQL engines. Blocks cleanly until acquired or ``stop_event`` fires.
    """
    if engine.dialect.name != "postgresql":
        return None

    while not stop_event.is_set():
        conn = None
        try:
            conn = engine.connect()
            acquired = bool(
                conn.execute(
                    text("SELECT pg_try_advisory_lock(:lock_id)"),
                    {"lock_id": _PG_WORKER_LEADER_LOCK_ID},
                ).scalar()
            )
            if acquired:
                return conn
            conn.close()
        except Exception as exc:
            logger.warning("Leader-Lock-Prüfung fehlgeschlagen: %s", exc)
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            continue
    return None


async def _heartbeat_loop(worker_id: str, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(redis_backplane.set_worker_heartbeat, worker_id, 15)
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            continue


async def _ai_dispatch_fallback_loop(stop_event: asyncio.Event) -> None:
    """Poll orphaned ``running`` AI runs in DB in case a Redis publish was missed."""
    from models import AiRun
    from services import ai_run_service

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=3.0)
            break
        except asyncio.TimeoutError:
            pass

        def _poll_due_ids() -> list[str]:
            cutoff = datetime.now(timezone.utc) - timedelta(seconds=3)
            db = SessionLocal()
            try:
                query = (
                    db.query(AiRun.id)
                    .filter(
                        AiRun.status == "running",
                        AiRun.updated_at <= cutoff,
                    )
                    .order_by(AiRun.updated_at.asc())
                    .limit(10)
                )
                if engine.dialect.name == "postgresql":
                    query = query.with_for_update(skip_locked=True)
                return [row[0] for row in query.all()]
            finally:
                db.close()

        try:
            run_ids = await asyncio.to_thread(_poll_due_ids)
            for rid in run_ids:
                with ai_run_service._BELEGUNG_SPERRE:  # noqa: SLF001
                    already_active = (
                        rid in ai_run_service._AUFGABEN  # noqa: SLF001
                        or rid in ai_run_service._RESERVIERT  # noqa: SLF001
                    )
                if not already_active:
                    ai_run_service._aufgabe_planen(rid)  # noqa: SLF001
        except Exception as exc:
            logger.debug("AI dispatch fallback poll error: %s", exc)


async def run_worker_main() -> None:
    _setup_logging()
    worker_id = f"msm-worker-{os.getpid()}-{uuid4().hex[:8]}"
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            # Windows event loops use signal.signal below
            signal.signal(sig, lambda *_args: loop.call_soon_threadsafe(stop_event.set))

    logger.info("Starte MSM Control-Plane Worker (%s)...", worker_id)
    leader_conn = await _acquire_leader_lock(stop_event)
    if stop_event.is_set():
        return

    pseudo_app = SimpleNamespace(state=SimpleNamespace())
    is_testing = os.getenv("MSM_TESTING") == "true" or "pytest" in sys.modules

    init_http_clients_and_ai_runtime(pseudo_app, is_testing)  # type: ignore[arg-type]
    verify_dis_and_upgrade_schema(engine, is_testing)
    sync_node_and_run_legacy_schema_bridges(engine, is_testing)
    seed_system_roles_and_migrate_legacy_permissions(engine)
    init_local_agent_and_background_jobs(is_testing)
    recover_scheduler_and_cleanup_expired()
    await reconcile_ai_runs_on_startup()

    async def _on_worker_ai_command(_channel: str, payload: dict) -> None:
        from services import ai_run_service

        action = str(payload.get("action") or "")
        run_id = payload.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            return
        if action == "start":
            ai_run_service._aufgabe_planen(run_id)  # noqa: SLF001
        elif action == "cancel":
            ai_run_service.aufgabe_abbrechen(run_id)

    async def _on_settings_invalidate(_channel: str, _payload: dict) -> None:
        from services.panel_settings_service import PanelSettingsService

        PanelSettingsService.invalidate_cache()

    async def _on_sync_event(_channel: str, payload: dict) -> None:
        from services.sync_event_service import SyncEventService

        SyncEventService.handle_remote_event(payload)

    bg_tasks: list[asyncio.Task] = [
        asyncio.create_task(_heartbeat_loop(worker_id, stop_event), name="worker-heartbeat"),
        asyncio.create_task(_ai_dispatch_fallback_loop(stop_event), name="worker-ai-poll"),
    ]
    if redis_backplane.is_redis_enabled():
        bg_tasks.append(
            asyncio.create_task(
                redis_backplane.run_pubsub_subscriber(
                    [
                        (redis_backplane.CHANNEL_WORKER_AI_RUN, _on_worker_ai_command),
                        (redis_backplane.CHANNEL_SETTINGS_INVALIDATE, _on_settings_invalidate),
                        (redis_backplane.CHANNEL_SYNC_EVENTS, _on_sync_event),
                    ]
                ),
                name="worker-redis-pubsub",
            )
        )

    logger.info("MSM Worker bereit (%s).", worker_id)
    try:
        await stop_event.wait()
    finally:
        logger.info("MSM Worker wird heruntergefahren...")
        for task in bg_tasks:
            task.cancel()
        await asyncio.gather(*bg_tasks, return_exceptions=True)
        await shutdown_panel_services(pseudo_app, is_testing)  # type: ignore[arg-type]
        if leader_conn is not None:
            try:
                leader_conn.execute(
                    text("SELECT pg_advisory_unlock(:lock_id)"),
                    {"lock_id": _PG_WORKER_LEADER_LOCK_ID},
                )
            except Exception:
                pass
            try:
                leader_conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(run_worker_main())
