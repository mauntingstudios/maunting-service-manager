"""Process-local guard for server install/update jobs.

The guarded work can be SteamCMD, HTTP source downloads, manual-upload setup,
or future blueprint-driven update work. Keep the naming generic so the router
does not encode a SteamCMD-only policy.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


INSTALL_UPDATE_ALREADY_RUNNING = "install_update_already_running"
DEFAULT_INSTALL_UPDATE_LOCK_TTL_SECONDS = 6 * 60 * 60


@dataclass(frozen=True)
class InstallUpdateLockInfo:
    server_id: int
    operation: str
    acquired_at: float
    expires_at: float


_LOCK = threading.RLock()
_CONDITION = threading.Condition(_LOCK)
_ACTIVE: dict[int | None, InstallUpdateLockInfo] = {}
_ACTIVE_SERVER: dict[int, InstallUpdateLockInfo] = {}
_SERVER_NODE_HINTS: dict[int, int | None] = {}
DEFAULT_MAX_CONCURRENT_MOD_JOBS_PER_NODE = 2


def register_server_node_hint(server_id: int, node_id: int | None) -> None:
    """Merkt sich ``server_id -> node_id`` im Speicher ohne laufende DB-Session."""
    with _CONDITION:
        _SERVER_NODE_HINTS[server_id] = node_id


def get_server_node_hint(server_id: int) -> int | None:
    with _CONDITION:
        return _SERVER_NODE_HINTS.get(server_id)


def _prune_stale_locked(now: float) -> None:
    for k, v in list(_ACTIVE.items()):
        if v.expires_at <= now:
            _ACTIVE.pop(k, None)
    for sid, v in list(_ACTIVE_SERVER.items()):
        if v.expires_at <= now:
            _ACTIVE_SERVER.pop(sid, None)


def try_acquire_install_update_lock(
    server_id: int,
    operation: str,
    *,
    node_id: int | None = None,
    ttl_seconds: int = DEFAULT_INSTALL_UPDATE_LOCK_TTL_SECONDS,
    scope: str = "node",
    max_per_node: int = DEFAULT_MAX_CONCURRENT_MOD_JOBS_PER_NODE,
) -> bool:
    """Reserve the install/update slot for a specific node or server.

    - ``scope="node"`` (Default): exklusiver Lock auf dem Ziel-Node (``node_id``),
      abwaertskompatibel fuer Server-Install/Update.
    - ``scope="server"``: sperrt exklusiv pro ``server_id`` (und respektiert aktive
      Node-Locks fuer denselben Server), begrenzt gleichzeitige Mod-Jobs je
      ``node_id`` ueber ``max_per_node`` statt den gesamten Node oder alle Nodes
      (``node_id=None``) global einzufrieren.

    Stale process-local locks are replaced after ``ttl_seconds``.
    """
    now = time.monotonic()
    resolved_node_id = node_id if node_id is not None else _SERVER_NODE_HINTS.get(server_id)
    with _CONDITION:
        _prune_stale_locked(now)

        # Niemals zwei konkurrierende Operationen auf demselben Server zulassen.
        if server_id in _ACTIVE_SERVER:
            return False
        for v in _ACTIVE.values():
            if v.server_id == server_id:
                return False

        if scope == "server":
            # Ein laufender node-weiter Server-Install/Update auf demselben Node
            # blockiert nur, wenn er auf demselben Node liegt; ansonsten begrenzen
            # wir lediglich die parallelen Mod-Jobs pro Node.
            if resolved_node_id in _ACTIVE:
                return False
            if max_per_node > 0:
                active_on_node = sum(
                    1
                    for sid in _ACTIVE_SERVER
                    if _SERVER_NODE_HINTS.get(sid) == resolved_node_id
                )
                if active_on_node >= max_per_node:
                    return False
            _SERVER_NODE_HINTS[server_id] = resolved_node_id
            _ACTIVE_SERVER[server_id] = InstallUpdateLockInfo(
                server_id=server_id,
                operation=operation,
                acquired_at=now,
                expires_at=now + ttl_seconds,
            )
            return True

        # Node-weiter Lock (Server-Installation / Spiel-Update).
        if resolved_node_id in _ACTIVE:
            return False

        _SERVER_NODE_HINTS[server_id] = resolved_node_id
        _ACTIVE[resolved_node_id] = InstallUpdateLockInfo(
            server_id=server_id,
            operation=operation,
            acquired_at=now,
            expires_at=now + ttl_seconds,
        )
        return True


def release_install_update_lock(server_id: int) -> None:
    """Release the lock held by ``server_id`` and wake queued waiters."""
    with _CONDITION:
        removed = _ACTIVE_SERVER.pop(server_id, None) is not None
        for k, v in list(_ACTIVE.items()):
            if v.server_id == server_id:
                _ACTIVE.pop(k, None)
                removed = True
        if removed:
            _CONDITION.notify_all()


def active_install_update_lock() -> InstallUpdateLockInfo | None:
    """Return the first active non-stale lock (for backward-compatible diagnostic/test checks)."""
    now = time.monotonic()
    with _CONDITION:
        _prune_stale_locked(now)
        if _ACTIVE:
            return next(iter(_ACTIVE.values()))
        if _ACTIVE_SERVER:
            return next(iter(_ACTIVE_SERVER.values()))
        return None


def reset_install_update_lock_for_tests() -> None:
    with _CONDITION:
        _ACTIVE.clear()
        _ACTIVE_SERVER.clear()
        _SERVER_NODE_HINTS.clear()
        _CONDITION.notify_all()


def force_release_install_update_lock(server_id: int) -> bool:
    """Admin/cancel: lock freigeben wenn es zu diesem Server gehoert."""
    with _CONDITION:
        removed = _ACTIVE_SERVER.pop(server_id, None) is not None
        for k, v in list(_ACTIVE.items()):
            if v.server_id == server_id:
                _ACTIVE.pop(k, None)
                removed = True
        if removed:
            _CONDITION.notify_all()
        return removed


def acquire_install_update_lock_blocking(
    server_id: int,
    operation: str,
    *,
    node_id: int | None = None,
    ttl_seconds: int = DEFAULT_INSTALL_UPDATE_LOCK_TTL_SECONDS,
    scope: str = "node",
    max_per_node: int = DEFAULT_MAX_CONCURRENT_MOD_JOBS_PER_NODE,
    timeout_seconds: float | None = None,
) -> bool:
    """Reserve the install/update slot, waiting via Condition without spin-polling."""
    deadline = (time.monotonic() + timeout_seconds) if timeout_seconds is not None else None
    with _CONDITION:
        while not try_acquire_install_update_lock(
            server_id,
            operation,
            node_id=node_id,
            ttl_seconds=ttl_seconds,
            scope=scope,
            max_per_node=max_per_node,
        ):
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                _CONDITION.wait(timeout=min(remaining, 1.0))
            else:
                _CONDITION.wait(timeout=1.0)
        return True
