"""Tests for the fix: mod install / reinstall-all must not hold a DB session while
blocked on the install/update lock. Otherwise parallel installs + UI polling
exhaust the QueuePool and yield 500 responses.
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from sqlalchemy.exc import TimeoutError as SAQueueTimeout

from models import Mod, Server


def test_install_mod_bg_does_not_block_with_open_session(test_server: Server, db):
    """install_mod_bg must acquire the install lock *before* opening a DB session.
    The lock used to be acquired *inside* the session, causing the polling UI
    to time out (QueuePool limit) when many mods were pending.
    """
    from routers import mods

    call_order: list[str] = []

    fake_session = _FakeSession()

    def _lock(*_a, **_kw):
        call_order.append("lock")
        return None

    def _release(*_a, **_kw):
        call_order.append("release")
        return None

    def _session_local():
        call_order.append("session")
        return fake_session

    fake_plugin = type(
        "P",
        (),
        {
            "supports_mods": True,
            "install_mod": lambda self, server, wid: {"ok": True},
        },
    )()

    def _get_plugin(_gt):
        call_order.append("get_plugin")
        return fake_plugin

    def _mark_installing(_sid, _wid, _a):
        call_order.append("mark_installing")

    def _mark_installed(_sid, _wid):
        call_order.append("mark_installed")

    fake_session.query = lambda *_a, **_kw: type(  # type: ignore[attr-defined]
        "Q", (), {"filter": lambda *a, **kw: type("R", (), {"first": lambda *a, **kw: test_server})()}
    )()
    fake_session.close = lambda: call_order.append("close")  # type: ignore[assignment]

    with patch.object(mods, "acquire_install_update_lock_blocking", _lock), \
         patch.object(mods, "release_install_update_lock", _release), \
         patch.object(mods, "get_plugin", _get_plugin), \
         patch.object(mods, "mark_mod_installing", _mark_installing), \
         patch.object(mods, "mark_mod_installed", _mark_installed), \
         patch.object(mods, "updater") as mock_updater:
        mock_updater.update_mod_metadata_after_success.return_value = None
        with patch("routers.mods.SessionLocal", _session_local):
            mods.install_mod_bg(test_server.id, "12345", "install")

    # Lock must be acquired first; session must be closed even on success.
    assert call_order[0] == "lock"
    assert "close" in call_order


def test_list_mods_skips_refresh_during_active_jobs(client, test_server, owner_cookies, db):
    """list_mods should not trigger the heavy workshop update check while
    mods are pending/installing on that server (avoids QueuePool pressure)."""
    db.add(Mod(server_id=test_server.id, workshop_id="1", install_status="pending"))
    db.commit()

    with patch("routers.mods._refresh_mod_update_availability") as mock_refresh:
        resp = client.get(f"/api/mods/{test_server.id}", cookies=owner_cookies)
        assert resp.status_code == 200
        mock_refresh.assert_not_called()


def test_list_mods_runs_refresh_when_idle(client, test_server, owner_cookies, db):
    from services.mod_update_service import reset_update_check_cache
    reset_update_check_cache()
    db.add(Mod(server_id=test_server.id, workshop_id="1", install_status="installed"))
    db.commit()

    with patch("routers.mods._refresh_mod_update_availability") as mock_refresh:
        resp = client.get(f"/api/mods/{test_server.id}", cookies=owner_cookies)
        assert resp.status_code == 200
        mock_refresh.assert_called_once()


class _FakeSession:
    def __init__(self):
        self._closed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def close(self):
        self._closed = True


def test_server_scope_lock_isolates_servers_and_respects_per_node_cap():
    import threading
    import time
    from services import install_update_lock_service as lock_svc

    lock_svc.reset_install_update_lock_for_tests()
    try:
        # Zwei verschiedene Server auf demselben Node (Cap=2) koennen parallel laufen.
        assert lock_svc.try_acquire_install_update_lock(
            9101, "mod_install", node_id=701, scope="server", max_per_node=2
        )
        assert lock_svc.try_acquire_install_update_lock(
            9102, "mod_install", node_id=701, scope="server", max_per_node=2
        )
        # Dritter Server auf demselben Node wird vom Per-Node-Cap blockiert,
        # waehrend ein Server auf einem anderen Node sofort starten darf.
        assert not lock_svc.try_acquire_install_update_lock(
            9103, "mod_install", node_id=701, scope="server", max_per_node=2
        )
        assert lock_svc.try_acquire_install_update_lock(
            9201, "mod_install", node_id=702, scope="server", max_per_node=2
        )
        # Derselbe Server darf nicht zweimal gleichzeitig gesperrt werden.
        assert not lock_svc.try_acquire_install_update_lock(
            9101, "mod_install", node_id=701, scope="server", max_per_node=2
        )

        # Ein blockierter Waiter wird nach release sofort geweckt.
        acquired_event = threading.Event()

        def waiter():
            if lock_svc.acquire_install_update_lock_blocking(
                9103,
                "mod_install",
                node_id=701,
                scope="server",
                max_per_node=2,
                timeout_seconds=2.0,
            ):
                acquired_event.set()
                lock_svc.release_install_update_lock(9103)

        t = threading.Thread(target=waiter, daemon=True)
        t.start()
        time.sleep(0.05)
        assert not acquired_event.is_set()
        lock_svc.release_install_update_lock(9101)
        assert acquired_event.wait(timeout=1.5)
        t.join(timeout=1.0)
    finally:
        lock_svc.reset_install_update_lock_for_tests()


def test_reinstall_all_mods_bg_closes_db_before_plugin_install():
    from types import SimpleNamespace
    from routers.mods import reinstall_all_mods_bg
    from services import install_update_lock_service as lock_svc

    sessions: list[_FakeSession] = []
    seen_closed_during_ops: list[tuple[str, bool]] = []
    seen_lock_args: list[tuple[str, int | None]] = []

    class _QuerySession(_FakeSession):
        def query(self, *_args):
            return self

        def filter(self, *_args):
            return self

        def options(self, *_args):
            return self

        def first(self):
            return SimpleNamespace(
                id=444,
                game_type="minecraft",
                node_id=77,
                node=None,
                install_dir="/srv/444",
                mods=[SimpleNamespace(workshop_id="10", enabled=True)],
            )

        def expunge(self, _obj):
            return None

        def commit(self):
            return None

        def rollback(self):
            return None

    def make_session():
        s = _QuerySession()
        sessions.append(s)
        return s

    class _FakePlugin:
        supports_mods = True

        def cleanup_mod(self, _server, _wid):
            seen_closed_during_ops.append(("cleanup", sessions[0]._closed))

        def install_mod(self, _server, _wid):
            seen_closed_during_ops.append(("install", sessions[0]._closed))
            return {"ok": True}

        def update_modlist(self, _server):
            seen_closed_during_ops.append(("modlist", sessions[-1]._closed))

    orig_acquire = lock_svc.acquire_install_update_lock_blocking

    def spy_acquire(server_id, operation, **kwargs):
        seen_lock_args.append((kwargs.get("scope", "node"), kwargs.get("node_id")))
        return orig_acquire(server_id, operation, **kwargs)

    lock_svc.reset_install_update_lock_for_tests()
    try:
        with patch("routers.mods.SessionLocal", side_effect=make_session), \
             patch("routers.mods.get_plugin", return_value=_FakePlugin()), \
             patch("routers.mods.acquire_install_update_lock_blocking", side_effect=spy_acquire), \
             patch("routers.mods._append_console_log"), \
             patch("routers.mods.mark_mod_installing"), \
             patch("routers.mods.mark_mod_installed"), \
             patch("routers.mods.updater.update_mod_metadata_after_success"):
            reinstall_all_mods_bg(444, ["10"])
            assert lock_svc.get_server_node_hint(444) == 77
            reinstall_all_mods_bg(444, ["10"])

        assert seen_closed_during_ops == [
            ("cleanup", True),
            ("install", True),
            ("modlist", True),
            ("cleanup", True),
            ("install", True),
            ("modlist", True),
        ]
        assert seen_lock_args == [("server", None), ("server", 77)]
        assert all(s._closed for s in sessions)
    finally:
        lock_svc.reset_install_update_lock_for_tests()
