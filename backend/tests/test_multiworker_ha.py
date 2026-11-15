"""Multi-worker Control-Plane HA, Redis backplane resilience, and chaos isolation tests."""

from __future__ import annotations

import asyncio
import fnmatch
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import worker as worker_mod
from config import settings
from models import Node
from services import (
    ai_run_service,
    health_service,
    lifespan_steps,
    redis_backplane,
    scheduler_service,
    server_lifecycle_service,
)


class _InMemoryRedis:
    """Thread-safe minimal Redis test double implementing backplane commands."""

    def __init__(self) -> None:
        self.kv: dict[str, tuple[str, float | None]] = {}
        self.sets: dict[str, set[str]] = {}
        self.published: list[tuple[str, str]] = []

    def _prune(self, key: str) -> None:
        item = self.kv.get(key)
        if item and item[1] is not None and time.monotonic() >= item[1]:
            self.kv.pop(key, None)

    def ping(self) -> bool:
        return True

    def get(self, key: str) -> str | None:
        self._prune(key)
        item = self.kv.get(key)
        return item[0] if item else None

    def exists(self, key: str) -> int:
        return 1 if self.get(key) is not None else 0

    def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool:
        self._prune(key)
        if nx and key in self.kv:
            return False
        exp = time.monotonic() + ex if ex is not None else None
        self.kv[key] = (value, exp)
        return True

    def setex(self, key: str, ttl: int, value: str) -> bool:
        return self.set(key, value, ex=ttl)

    def expire(self, key: str, _ttl: int) -> bool:
        return key in self.kv or key in self.sets

    def delete(self, *keys: str) -> int:
        count = 0
        for key in keys:
            if self.kv.pop(key, None) is not None or self.sets.pop(key, None) is not None:
                count += 1
        return count

    def eval(self, _script: str, _numkeys: int, key: str, expected: str) -> int:
        if self.get(key) == expected:
            self.kv.pop(key, None)
            return 1
        return 0

    def sadd(self, key: str, *values: str) -> int:
        bucket = self.sets.setdefault(key, set())
        before = len(bucket)
        bucket.update(values)
        return len(bucket) - before

    def smembers(self, key: str) -> set[str]:
        return set(self.sets.get(key, set()))

    def srem(self, key: str, *values: str) -> int:
        bucket = self.sets.get(key, set())
        removed = 0
        for v in values:
            if v in bucket:
                bucket.remove(v)
                removed += 1
        return removed

    def publish(self, channel: str, payload: str) -> int:
        self.published.append((channel, payload))
        return 1


def test_worker_mode_skips_background_jobs_in_api_processes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "worker_mode", "api", raising=False)
    assert lifespan_steps._is_worker_role() is False

    fw_called: list[str] = []
    monkeypatch.setattr("services.docker_iptables_service.ensure_baseline_drop", lambda: fw_called.append("fw"))
    lifespan_steps.init_local_agent_and_background_jobs(is_testing=True)
    assert fw_called == []

    monkeypatch.setattr(settings, "worker_mode", "worker", raising=False)
    assert lifespan_steps._is_worker_role() is True
    monkeypatch.setattr(settings, "worker_mode", "all", raising=False)
    assert lifespan_steps._is_worker_role() is True


def test_redis_backplane_distributed_locks_install_locks_and_ai_dispatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_redis = _InMemoryRedis()
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0", raising=False)
    monkeypatch.setattr(redis_backplane, "get_sync_redis", lambda: fake_redis)

    # Distributed lock exclusion + owner-token release protection
    tok_a = redis_backplane.acquire_distributed_lock("guardian:reconcile", ttl_seconds=30)
    assert tok_a is not None
    assert redis_backplane.acquire_distributed_lock("guardian:reconcile", ttl_seconds=30) is None
    redis_backplane.release_distributed_lock("guardian:reconcile", "wrong-token")
    assert redis_backplane.acquire_distributed_lock("guardian:reconcile", ttl_seconds=30) is None
    redis_backplane.release_distributed_lock("guardian:reconcile", tok_a)
    tok_b = redis_backplane.acquire_distributed_lock("guardian:reconcile", ttl_seconds=30)
    assert tok_b is not None

    # Remote install lock: per-server conflict, per-node cap, and exclusive node lock
    assert redis_backplane.try_acquire_remote_install_lock(
        server_id=1, node_id=7, operation="install", ttl_seconds=120, scope="server", max_per_node=1
    ) is True
    assert redis_backplane.try_acquire_remote_install_lock(
        server_id=1, node_id=7, operation="install", ttl_seconds=120, scope="server", max_per_node=1
    ) is False
    # Second server on same node blocked by max_per_node=1
    assert redis_backplane.try_acquire_remote_install_lock(
        server_id=2, node_id=7, operation="install", ttl_seconds=120, scope="server", max_per_node=1
    ) is False
    redis_backplane.release_remote_install_lock(1)
    assert redis_backplane.try_acquire_remote_install_lock(
        server_id=2, node_id=7, operation="node_upgrade", ttl_seconds=120, scope="node", max_per_node=2
    ) is True
    assert redis_backplane.try_acquire_remote_install_lock(
        server_id=3, node_id=7, operation="install", ttl_seconds=120, scope="server", max_per_node=2
    ) is False
    redis_backplane.release_remote_install_lock(2)

    # Lifecycle active tracking + operation epoch fencing across workers
    server_lifecycle_service.reset_lifecycle_jobs_for_tests()
    fake_redis.setex("msm:lifecycle_active:91", 600, "1")
    assert server_lifecycle_service._mark_job_active(91) is False
    fake_redis.delete("msm:lifecycle_active:91")
    assert server_lifecycle_service._mark_job_active(91) is True
    assert fake_redis.exists("msm:lifecycle_active:91") == 1
    server_lifecycle_service._mark_job_done(91)

    epoch1 = server_lifecycle_service._advance_operation_epoch(91)
    epoch2 = server_lifecycle_service._advance_operation_epoch(91)
    assert epoch2 > epoch1
    server_lifecycle_service._ensure_operation_current(91, epoch2)
    with pytest.raises(server_lifecycle_service.LifecycleOperationCancelled):
        server_lifecycle_service._ensure_operation_current(91, epoch1)

    # API worker delegates AI run start & cancel over Redis when worker heartbeat is live
    monkeypatch.setattr(settings, "worker_mode", "api", raising=False)
    redis_backplane.set_worker_heartbeat("worker-1", ttl_seconds=15)
    assert redis_backplane.is_worker_alive() is True
    assert ai_run_service._aufgabe_planen("run-ha-1") is True
    assert ai_run_service.aufgabe_abbrechen("run-ha-1") is True
    channels = [c for c, _ in fake_redis.published]
    assert redis_backplane.CHANNEL_WORKER_AI_RUN in channels

    # Graceful degradation when Redis client is unavailable
    monkeypatch.setattr(redis_backplane, "get_sync_redis", lambda: None)
    assert redis_backplane.try_acquire_remote_install_lock(
        server_id=5, node_id=1, operation="install", ttl_seconds=60, scope="server", max_per_node=1
    ) is None
    assert redis_backplane.is_worker_alive() is False


def test_health_deep_checks_worker_and_fast_health_stays_responsive_under_hung_node(
    client: TestClient, db, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_redis = _InMemoryRedis()
    monkeypatch.setattr(settings, "redis_url", "redis://localhost:6379/0", raising=False)
    monkeypatch.setattr(settings, "worker_mode", "api", raising=False)
    monkeypatch.setattr(redis_backplane, "get_sync_redis", lambda: fake_redis)
    monkeypatch.setattr("services.dis_client.DisClient.health_check", lambda _timeout=2.0: True)

    # Stale worker heartbeat causes /api/health?deep=1 -> 503 degraded, while fast /api/health stays 200
    r_fast = client.get("/api/health")
    assert r_fast.status_code == 200
    assert r_fast.json() == {"status": "ok"}

    r_deep_stale = client.get("/api/health?deep=1")
    assert r_deep_stale.status_code == 503
    assert r_deep_stale.json()["checks"]["worker"] == "stale"

    redis_backplane.set_worker_heartbeat("msm-worker-1", ttl_seconds=15)
    r_deep_ok = client.get("/api/health?deep=1")
    assert r_deep_ok.status_code == 200
    assert r_deep_ok.json()["checks"]["redis"] == "ok"
    assert r_deep_ok.json()["checks"]["worker"] == "ok"

    # Simulate a hung node & failing node inside scheduler heartbeat task concurrently with HTTP health checks
    healthy = Node(
        name="node-fast",
        host="https://fast.invalid:9000",
        is_local=False,
        auth_token_enc="tok1",
        status="offline",
    )
    hung = Node(
        name="node-hung",
        host="https://hung.invalid:9000",
        is_local=False,
        auth_token_enc="tok2",
        status="online",
    )
    db.add_all([healthy, hung])
    db.commit()
    db.refresh(healthy)
    db.refresh(hung)

    class _FakeNodeClient:
        def __init__(self, node_id: int) -> None:
            self.node_id = node_id

        async def metrics_async(self, client=None):  # noqa: ANN001
            if self.node_id == hung.id:
                await asyncio.sleep(0.35)
                raise TimeoutError("node timeout")
            return {"cpu_cores": 8, "ram_total_mb": 32768, "disk_total_gb": 500}

    monkeypatch.setattr("services.node_client.NodeClient.from_node", lambda n, timeout=10.0: _FakeNodeClient(n.id))
    # Threshold = 1 so single failed probe marks hung node offline immediately
    monkeypatch.setattr("services.node_service.handle_node_probe_failure", lambda _db, n, _now: setattr(n, "status", "offline"))

    async def _run_concurrent_chaos() -> tuple[float, int, dict]:
        hb_task = asyncio.create_task(scheduler_service._node_heartbeat_task())
        await asyncio.sleep(0.05)
        t0 = time.monotonic()
        status_code, body = await health_service.pruefe_gesundheit(deep=False)
        elapsed = time.monotonic() - t0
        await hb_task
        return elapsed, status_code, body

    # Verify DB operations in scheduler use clean snapshots and health remains < 200ms
    monkeypatch.setattr(scheduler_service, "_load_nodes_for_heartbeat_sync", lambda: [healthy, hung])
    recorded_outcomes: list[tuple] = []
    monkeypatch.setattr(
        scheduler_service,
        "_apply_node_heartbeat_outcomes_sync",
        lambda outcomes: recorded_outcomes.extend(outcomes),
    )

    health_elapsed, code, payload = asyncio.run(_run_concurrent_chaos())
    assert code == 200
    assert payload == {"status": "ok"}
    assert health_elapsed < 0.2
    outcome_map = {nid: ok for nid, _ts, ok, _pay in recorded_outcomes}
    assert outcome_map[healthy.id] is True
    assert outcome_map[hung.id] is False


def test_worker_leader_lock_handles_postgresql_advisory_lock_and_stop_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _exercise() -> None:
        stop = asyncio.Event()
        fake_conn = SimpleNamespace(
            execute=lambda *_a, **_kw: SimpleNamespace(scalar=lambda: True),
            close=lambda: None,
        )
        fake_engine = SimpleNamespace(
            dialect=SimpleNamespace(name="postgresql"),
            connect=lambda: fake_conn,
        )
        monkeypatch.setattr(worker_mod, "engine", fake_engine)
        conn = await worker_mod._acquire_leader_lock(stop)
        assert conn is fake_conn

        # Contended lock exits promptly when stop_event is set
        busy_conn = SimpleNamespace(
            execute=lambda *_a, **_kw: SimpleNamespace(scalar=lambda: False),
            close=lambda: None,
        )
        monkeypatch.setattr(worker_mod, "engine", SimpleNamespace(
            dialect=SimpleNamespace(name="postgresql"),
            connect=lambda: busy_conn,
        ))
        stop2 = asyncio.Event()
        task = asyncio.create_task(worker_mod._acquire_leader_lock(stop2))
        await asyncio.sleep(0.05)
        stop2.set()
        res = await task
        assert res is None

    asyncio.run(_exercise())
