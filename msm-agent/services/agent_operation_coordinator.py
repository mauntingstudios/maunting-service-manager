"""Serialize every mutating Agent operation per managed server.

The coordinator deliberately uses one ``threading.Lock`` per server.  The same
lock can therefore be used by synchronous FastAPI handlers, worker threads and
the asynchronous Guardian loop.  Nested calls in the same logical execution
context are allowed so a multi-step recovery can hold the lock while calling
the normal Docker service methods.
"""

from __future__ import annotations

import asyncio
import threading
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import AsyncIterator, Iterator


class InvalidServerOperation(ValueError):
    """Raised when an operation is not scoped to a valid server ID."""


@dataclass
class _OperationLease:
    """Active per-server lock lease bound to the acquiring task or thread."""

    server_id: int
    owner_task: int | None
    owner_thread: int
    inner_lock: threading.RLock = field(default_factory=threading.RLock)
    active: bool = True


_LOCKS: dict[int, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()
_HELD_BY_CONTEXT: ContextVar[dict[int, _OperationLease]] = ContextVar(
    "msm_agent_operations_held",
    default={},
)


def _validated_server_id(server_id: int | str) -> int:
    try:
        value = int(server_id)
    except (TypeError, ValueError) as exc:
        raise InvalidServerOperation("server_id must be a positive integer") from exc
    if value <= 0 or str(server_id).strip() != str(value):
        raise InvalidServerOperation("server_id must be a positive integer")
    return value


def server_id_from_container_name(name: str, prefix: str) -> int:
    """Return the numeric ID from the one allowed managed-container format."""
    if not isinstance(name, str) or not name.startswith(prefix):
        raise InvalidServerOperation("invalid managed container name")
    suffix = name[len(prefix) :]
    if not suffix.isdigit() or not suffix or suffix.startswith("0"):
        raise InvalidServerOperation("invalid managed container name")
    return _validated_server_id(suffix)


def _lock_for(server_id: int) -> threading.Lock:
    with _LOCKS_GUARD:
        lock = _LOCKS.get(server_id)
        if lock is None:
            lock = threading.Lock()
            _LOCKS[server_id] = lock
        return lock


def _current_task_id() -> int | None:
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    return id(task) if task is not None else None


def _lease_matches_context(lease: _OperationLease | None) -> bool:
    if lease is None or not lease.active:
        return False
    task_id = _current_task_id()
    if task_id is not None:
        return lease.owner_task == task_id
    # Worker thread without a current asyncio task:
    # - reentrant sync call on the owning thread matches owner_thread
    # - asyncio.to_thread() inside operation_async inherits an active owner_task
    return lease.owner_thread == threading.get_ident() or lease.owner_task is not None


def _mark_held(server_id: int, lease: _OperationLease):
    held = dict(_HELD_BY_CONTEXT.get())
    held[server_id] = lease
    return _HELD_BY_CONTEXT.set(held)


@contextmanager
def operation(server_id: int | str) -> Iterator[None]:
    """Acquire the shared per-server mutation lock synchronously."""
    sid = _validated_server_id(server_id)
    lease = _HELD_BY_CONTEXT.get().get(sid)
    if _lease_matches_context(lease):
        assert lease is not None
        lease.inner_lock.acquire()
        if lease.active:
            try:
                yield
            finally:
                lease.inner_lock.release()
            return
        lease.inner_lock.release()

    lock = _lock_for(sid)
    lock.acquire()
    new_lease = _OperationLease(
        server_id=sid,
        owner_task=_current_task_id(),
        owner_thread=threading.get_ident(),
    )
    token = _mark_held(sid, new_lease)
    try:
        yield
    finally:
        try:
            try:
                _HELD_BY_CONTEXT.reset(token)
            except ValueError:
                held = dict(_HELD_BY_CONTEXT.get())
                if held.get(sid) is new_lease:
                    held.pop(sid, None)
                    _HELD_BY_CONTEXT.set(held)
            with new_lease.inner_lock:
                new_lease.active = False
        finally:
            lock.release()


@asynccontextmanager
async def operation_async(server_id: int | str) -> AsyncIterator[None]:
    """Acquire the shared per-server mutation lock without blocking the loop."""
    sid = _validated_server_id(server_id)
    lease = _HELD_BY_CONTEXT.get().get(sid)
    if _lease_matches_context(lease):
        assert lease is not None
        yield
        return

    lock = _lock_for(sid)
    await asyncio.to_thread(lock.acquire)
    new_lease = _OperationLease(
        server_id=sid,
        owner_task=_current_task_id(),
        owner_thread=threading.get_ident(),
    )
    token = _mark_held(sid, new_lease)
    try:
        yield
    finally:
        try:
            try:
                _HELD_BY_CONTEXT.reset(token)
            except ValueError:
                held = dict(_HELD_BY_CONTEXT.get())
                if held.get(sid) is new_lease:
                    held.pop(sid, None)
                    _HELD_BY_CONTEXT.set(held)
            if not new_lease.inner_lock.acquire(blocking=False):
                await asyncio.to_thread(new_lease.inner_lock.acquire)
            try:
                new_lease.active = False
            finally:
                new_lease.inner_lock.release()
        except BaseException:
            new_lease.active = False
            raise
        finally:
            lock.release()


def is_operation_active(server_id: int | str) -> bool:
    """Return whether another logical context currently owns the server lock."""
    sid = _validated_server_id(server_id)
    lease = _HELD_BY_CONTEXT.get().get(sid)
    if _lease_matches_context(lease):
        return False
    lock = _lock_for(sid)
    acquired = lock.acquire(blocking=False)
    if acquired:
        lock.release()
        return False
    return True


def is_operation_held_by_context(server_id: int | str) -> bool:
    """Return whether this propagated logical context already owns the lock."""
    sid = _validated_server_id(server_id)
    lease = _HELD_BY_CONTEXT.get().get(sid)
    return bool(lease is not None and lease.active)


def reset_operation_coordinator_for_tests() -> None:
    """Clear idle locks.  Active locks are intentionally never discarded."""
    with _LOCKS_GUARD:
        active = [sid for sid, lock in _LOCKS.items() if lock.locked()]
        if active:
            raise RuntimeError("cannot reset operation coordinator while locks are active")
        _LOCKS.clear()
