"""Cross-worker Redis backplane with graceful in-memory fallback.

Provides fork-safe sync/async clients, atomic distributed locks, worker
liveness heartbeats, shared TTL caches, console ring-buffers, and a unified
Pub/Sub fan-out loop for multi-worker Uvicorn + dedicated ``msm-worker``.

Important: ``redis`` is soft-imported so ``test_startup_dependencies.py`` and
single-process deployments without ``MSM_REDIS_URL`` continue to work cleanly.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import logging
import os
import threading
import time
from typing import Any, AsyncIterator, Awaitable, Callable
from uuid import uuid4

from config import settings

logger = logging.getLogger(__name__)

try:
    import redis as _redis_sync
    import redis.asyncio as _redis_async
except ImportError:  # pragma: no cover - verified by test_startup_dependencies
    _redis_sync = None  # type: ignore[assignment]
    _redis_async = None  # type: ignore[assignment]

_SYNC_CLIENTS: dict[tuple[int, str], Any] = {}
_ASYNC_CLIENTS: dict[tuple[int, int, str], Any] = {}
_LOCAL_LOCKS: dict[str, tuple[threading.Lock, str | None]] = {}
_LOCAL_LOCK_GUARD = threading.Lock()
_CLIENT_GUARD = threading.Lock()

CHANNEL_SETTINGS_INVALIDATE = "msm:panel_settings:invalidate"
CHANNEL_SYNC_EVENTS = "msm:sync_events:broadcast"
CHANNEL_CONSOLE_PREFIX = "msm:console:server:"
CHANNEL_AI_RUN_PREFIX = "msm:ai_run:events:"
CHANNEL_WORKER_AI_RUN = "msm:worker:ai_run"
CHANNEL_WORKER_OPS = "msm:worker:ops"

_LUA_RELEASE_LOCK = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
"""

_LUA_APPEND_STREAM = """
local seq = redis.call("INCR", KEYS[1])
local item = string.gsub(ARGV[1], "__MSM_SEQ__", tostring(seq), 1)
redis.call("RPUSH", KEYS[2], item)
local len = redis.call("LLEN", KEYS[2])
local max_len = tonumber(ARGV[2])
if len > max_len then
    redis.call("LTRIM", KEYS[2], len - max_len, -1)
end
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
return seq
"""


def _redis_url() -> str:
    return (getattr(settings, "redis_url", "") or os.getenv("MSM_REDIS_URL", "") or "").strip()


def is_redis_enabled() -> bool:
    return bool(_redis_url()) and _redis_sync is not None


def get_sync_redis() -> Any | None:
    """Return a fork-safe cached synchronous Redis client, or ``None``."""
    url = _redis_url()
    if not url or _redis_sync is None:
        return None
    key = (os.getpid(), url)
    with _CLIENT_GUARD:
        client = _SYNC_CLIENTS.get(key)
        if client is None:
            client = _redis_sync.Redis.from_url(
                url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=1.5,
                socket_timeout=2.0,
                health_check_interval=30,
            )
            _SYNC_CLIENTS[key] = client
        return client


def get_async_redis() -> Any | None:
    """Return a loop- and PID-scoped async Redis client, or ``None``."""
    url = _redis_url()
    if not url or _redis_async is None:
        return None
    try:
        loop_id = id(asyncio.get_running_loop())
    except RuntimeError:
        return None
    key = (os.getpid(), loop_id, url)
    with _CLIENT_GUARD:
        client = _ASYNC_CLIENTS.get(key)
        if client is None:
            client = _redis_async.Redis.from_url(
                url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=1.5,
                socket_timeout=2.0,
                health_check_interval=30,
            )
            _ASYNC_CLIENTS[key] = client
        return client


def create_pubsub_async_redis() -> Any | None:
    """Create a dedicated async client without short read timeout for PSUBSCRIBE."""
    url = _redis_url()
    if not url or _redis_async is None:
        return None
    return _redis_async.Redis.from_url(
        url,
        encoding="utf-8",
        decode_responses=True,
        socket_connect_timeout=2.0,
        socket_timeout=None,
        health_check_interval=30,
    )


def reset_clients() -> None:
    with _CLIENT_GUARD:
        for client in _SYNC_CLIENTS.values():
            try:
                client.close()
            except Exception:
                pass
        _SYNC_CLIENTS.clear()
        _ASYNC_CLIENTS.clear()


async def aclose_async_clients() -> None:
    with _CLIENT_GUARD:
        pid = os.getpid()
        keys = [k for k in _ASYNC_CLIENTS if k[0] == pid]
        clients = [_ASYNC_CLIENTS.pop(k) for k in keys]
    for client in clients:
        try:
            await client.aclose()
        except Exception:
            pass


def ping_redis() -> dict[str, Any]:
    if not _redis_url():
        return {"configured": False, "ok": False, "reason": "not_configured"}
    client = get_sync_redis()
    if client is None:
        return {"configured": True, "ok": False, "reason": "redis_library_missing"}
    try:
        started = time.monotonic()
        pong = bool(client.ping())
        latency_ms = round((time.monotonic() - started) * 1000, 2)
        return {"configured": True, "ok": pong, "latency_ms": latency_ms}
    except Exception as exc:
        return {"configured": True, "ok": False, "reason": type(exc).__name__}


# ── Shared JSON cache ─────────────────────────────────────────────────────────


def cache_get_json(namespace: str, key: str) -> Any | None:
    client = get_sync_redis()
    if client is None:
        return None
    try:
        raw = client.get(f"msm:cache:{namespace}:{key}")
        return json.loads(raw) if raw else None
    except Exception:
        return None


def cache_set_json(namespace: str, key: str, value: Any, ttl_seconds: int) -> None:
    client = get_sync_redis()
    if client is None:
        return
    try:
        client.setex(
            f"msm:cache:{namespace}:{key}",
            max(1, int(ttl_seconds)),
            json.dumps(value, separators=(",", ":")),
        )
    except Exception:
        pass


def cache_delete(namespace: str, *keys: str) -> None:
    client = get_sync_redis()
    if client is None or not keys:
        return
    try:
        client.delete(*(f"msm:cache:{namespace}:{k}" for k in keys))
    except Exception:
        pass


# ── Distributed locks (with safe local fallback) ──────────────────────────────


def acquire_distributed_lock(name: str, ttl_seconds: int = 30) -> str | None:
    token = uuid4().hex
    client = get_sync_redis()
    if client is not None:
        try:
            acquired = client.set(f"msm:lock:{name}", token, nx=True, ex=max(1, int(ttl_seconds)))
            return token if acquired else None
        except Exception:
            pass

    with _LOCAL_LOCK_GUARD:
        entry = _LOCAL_LOCKS.get(name)
        if entry is None:
            lock = threading.Lock()
            _LOCAL_LOCKS[name] = (lock, token)
            lock.acquire()
            return token
        lock, _holder = entry
        if lock.acquire(blocking=False):
            _LOCAL_LOCKS[name] = (lock, token)
            return token
        return None


def release_distributed_lock(name: str, token: str | None) -> None:
    if not token:
        return
    client = get_sync_redis()
    if client is not None:
        try:
            client.eval(_LUA_RELEASE_LOCK, 1, f"msm:lock:{name}", token)
            return
        except Exception:
            pass

    with _LOCAL_LOCK_GUARD:
        entry = _LOCAL_LOCKS.get(name)
        if entry is not None:
            lock, holder = entry
            if holder == token and lock.locked():
                _LOCAL_LOCKS[name] = (lock, None)
                try:
                    lock.release()
                except RuntimeError:
                    pass


@asynccontextmanager
async def distributed_lock(
    name: str, *, ttl_seconds: int = 60, wait_timeout: float = 0.0
) -> AsyncIterator[bool]:
    deadline = time.monotonic() + max(0.0, wait_timeout)
    token: str | None = None
    while True:
        token = await asyncio.to_thread(acquire_distributed_lock, name, ttl_seconds)
        if token is not None:
            break
        if time.monotonic() >= deadline:
            break
        await asyncio.sleep(0.1)
    try:
        yield token is not None
    finally:
        if token is not None:
            await asyncio.to_thread(release_distributed_lock, name, token)


# ── Worker heartbeat & cross-worker active job flags ──────────────────────────


def set_worker_heartbeat(worker_id: str, ttl_seconds: int = 15) -> None:
    client = get_sync_redis()
    if client is None:
        return
    try:
        client.setex("msm:worker:heartbeat", max(5, int(ttl_seconds)), worker_id)
    except Exception:
        pass


def is_worker_alive() -> bool:
    client = get_sync_redis()
    if client is None:
        return False
    try:
        return bool(client.exists("msm:worker:heartbeat"))
    except Exception:
        return False


def mark_lifecycle_active(server_id: int, active: bool, ttl_seconds: int = 600) -> None:
    client = get_sync_redis()
    if client is None:
        return
    key = f"msm:lifecycle_active:{int(server_id)}"
    try:
        if active:
            client.setex(key, max(10, int(ttl_seconds)), "1")
        else:
            client.delete(key)
    except Exception:
        pass


def is_lifecycle_active_remote(server_id: int) -> bool:
    client = get_sync_redis()
    if client is None:
        return False
    try:
        return bool(client.exists(f"msm:lifecycle_active:{int(server_id)}"))
    except Exception:
        return False


# ── Global install/update lock helpers ────────────────────────────────────────


def try_acquire_remote_install_lock(
    *,
    server_id: int,
    node_id: int | None,
    operation: str,
    ttl_seconds: int,
    scope: str,
    max_per_node: int,
) -> bool | None:
    """Coordinate install/update locks across workers via Redis.

    Returns ``None`` if Redis is unavailable (caller uses local lock only).
    """
    client = get_sync_redis()
    if client is None:
        return None
    node_key = str(node_id) if node_id is not None else "local"
    srv_key = f"msm:install_lock:srv:{int(server_id)}"
    node_exclusive_key = f"msm:install_lock:node_excl:{node_key}"
    node_slots_key = f"msm:install_lock:node_slots:{node_key}"
    ttl = max(30, int(ttl_seconds))
    now_ts = time.time()
    record = json.dumps(
        {
            "server_id": int(server_id),
            "node_id": node_id,
            "operation": operation,
            "acquired_at": now_ts,
            "expires_at": now_ts + ttl,
            "scope": scope,
        },
        separators=(",", ":"),
    )
    try:
        if client.exists(srv_key):
            return False
        if scope == "server":
            if client.exists(node_exclusive_key):
                return False
            if max_per_node > 0:
                # Prune stale slot entries whose server lock expired
                members = list(client.smembers(node_slots_key) or ())
                active_count = 0
                for sid_str in members:
                    if client.exists(f"msm:install_lock:srv:{sid_str}"):
                        active_count += 1
                    else:
                        client.srem(node_slots_key, sid_str)
                if active_count >= max_per_node:
                    return False
            if not client.set(srv_key, record, nx=True, ex=ttl):
                return False
            client.sadd(node_slots_key, str(int(server_id)))
            client.expire(node_slots_key, ttl)
            return True

        # scope == "node"
        if not client.set(node_exclusive_key, record, nx=True, ex=ttl):
            return False
        if not client.set(srv_key, record, nx=True, ex=ttl):
            client.delete(node_exclusive_key)
            return False
        return True
    except Exception:
        return None


def release_remote_install_lock(server_id: int) -> None:
    client = get_sync_redis()
    if client is None:
        return
    srv_key = f"msm:install_lock:srv:{int(server_id)}"
    try:
        raw = client.get(srv_key)
        node_key = "local"
        if raw:
            info = json.loads(raw)
            if info.get("node_id") is not None:
                node_key = str(info["node_id"])
            if info.get("scope") == "node":
                client.delete(f"msm:install_lock:node_excl:{node_key}")
            else:
                client.srem(f"msm:install_lock:node_slots:{node_key}", str(int(server_id)))
        client.delete(srv_key)
    except Exception:
        pass


# ── Pub/Sub & Stream helpers ──────────────────────────────────────────────────


def publish_sync(channel: str, payload: dict[str, Any]) -> None:
    client = get_sync_redis()
    if client is None:
        return
    try:
        client.publish(channel, json.dumps(payload, separators=(",", ":"), ensure_ascii=True))
    except Exception:
        pass


async def publish_async(channel: str, payload: dict[str, Any]) -> None:
    client = get_async_redis()
    if client is None:
        return
    try:
        await client.publish(channel, json.dumps(payload, separators=(",", ":"), ensure_ascii=True))
    except Exception:
        pass


def console_append_and_publish_sync(
    server_id: int,
    *,
    text: str,
    source: str,
    timestamp: str,
    max_len: int = 1000,
) -> int | None:
    client = get_sync_redis()
    if client is None:
        return None
    seq_key = f"msm:console:seq:{int(server_id)}"
    buf_key = f"msm:console:buf:{int(server_id)}"
    placeholder = json.dumps(
        {"id": "__MSM_SEQ__", "timestamp": timestamp, "source": source, "text": text},
        separators=(",", ":"),
        ensure_ascii=True,
    ).replace('"__MSM_SEQ__"', "__MSM_SEQ__")
    try:
        seq = int(client.eval(_LUA_APPEND_STREAM, 2, seq_key, buf_key, placeholder, str(max_len), "86400"))
        msg = {
            "id": seq,
            "timestamp": timestamp,
            "source": source,
            "text": text,
            "origin_pid": os.getpid(),
        }
        client.publish(f"{CHANNEL_CONSOLE_PREFIX}{int(server_id)}", json.dumps(msg, separators=(",", ":")))
        return seq
    except Exception:
        return None


async def console_append_and_publish_async(
    server_id: int,
    *,
    text: str,
    source: str,
    timestamp: str,
    max_len: int = 1000,
) -> int | None:
    client = get_async_redis()
    if client is None:
        return None
    seq_key = f"msm:console:seq:{int(server_id)}"
    buf_key = f"msm:console:buf:{int(server_id)}"
    placeholder = json.dumps(
        {"id": "__MSM_SEQ__", "timestamp": timestamp, "source": source, "text": text},
        separators=(",", ":"),
        ensure_ascii=True,
    ).replace('"__MSM_SEQ__"', "__MSM_SEQ__")
    try:
        seq = int(await client.eval(_LUA_APPEND_STREAM, 2, seq_key, buf_key, placeholder, str(max_len), "86400"))
        msg = {
            "id": seq,
            "timestamp": timestamp,
            "source": source,
            "text": text,
            "origin_pid": os.getpid(),
        }
        await client.publish(f"{CHANNEL_CONSOLE_PREFIX}{int(server_id)}", json.dumps(msg, separators=(",", ":")))
        return seq
    except Exception:
        return None


async def console_read_buffer_async(server_id: int) -> list[dict[str, Any]]:
    client = get_async_redis()
    if client is None:
        return []
    try:
        items = await client.lrange(f"msm:console:buf:{int(server_id)}", 0, -1)
        out: list[dict[str, Any]] = []
        for raw in items:
            try:
                out.append(json.loads(raw))
            except Exception:
                continue
        return out
    except Exception:
        return []


def ai_run_snapshot_set(run_id: str, snapshot: dict[str, Any], ttl_seconds: int = 3600) -> None:
    cache_set_json("ai_run_snapshot", run_id, snapshot, ttl_seconds)


def ai_run_snapshot_get(run_id: str) -> dict[str, Any] | None:
    val = cache_get_json("ai_run_snapshot", run_id)
    return val if isinstance(val, dict) else None


async def run_pubsub_subscriber(
    handlers: list[tuple[str, Callable[[str, dict[str, Any]], Awaitable[None]]]],
) -> None:
    """Long-running background subscriber dispatching pattern-matched Redis messages."""
    if not _redis_url() or _redis_async is None or not handlers:
        return

    patterns = [pattern for pattern, _cb in handlers]
    while True:
        client = create_pubsub_async_redis()
        if client is None:
            return
        pubsub = client.pubsub(ignore_subscribe_messages=True)
        try:
            await pubsub.psubscribe(*patterns)
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    await asyncio.sleep(0.05)
                    continue
                if msg.get("type") not in {"pmessage", "message"}:
                    continue
                channel = str(msg.get("channel") or "")
                raw_data = msg.get("data")
                try:
                    payload = json.loads(raw_data) if isinstance(raw_data, str) else {}
                except Exception:
                    continue
                if not isinstance(payload, dict):
                    continue
                for prefix, callback in handlers:
                    bare = prefix.rstrip("*")
                    if channel == prefix or (prefix.endswith("*") and channel.startswith(bare)):
                        try:
                            await callback(channel, payload)
                        except Exception as exc:
                            logger.debug("PubSub callback error for %s: %s", channel, exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("Redis subscriber reconnecting after error: %s", exc)
            await asyncio.sleep(1.0)
        finally:
            try:
                await pubsub.close()
            except Exception:
                pass
            try:
                await client.aclose()
            except Exception:
                pass
