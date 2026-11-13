import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from models import SingraTestRun, User
from models.ai_project import AiProject
from services.singra import browser


def test_has_passed_test_run():
    db_mock = MagicMock()

    # Case 1: Matching passed test run exists
    run_passed = SingraTestRun(
        id="run-1",
        project_id="p-1",
        release_checksum="chk-abc",
        status="passed",
    )
    db_mock.query.return_value.filter.return_value.first.return_value = run_passed
    assert browser.has_passed_test_run(db_mock, "p-1", "chk-abc") is True

    # Case 2: Filter query for status="passed" finds nothing (returns None)
    db_mock.query.return_value.filter.return_value.first.return_value = None
    assert browser.has_passed_test_run(db_mock, "p-1", "chk-abc") is False

    # Case 3: No matching run
    assert browser.has_passed_test_run(db_mock, "p-1", "chk-xyz") is False


def test_run_project_browser_tests_origin_guard_and_persistence(tmp_path, monkeypatch):
    db_mock = MagicMock()
    user = User(id=1, username="testadmin")
    project = AiProject(id="p-browser", name="BrowserTestApp", user_id=1)

    from services import ai_project_service

    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: tmp_path)

    # Mock playwright async flow
    mock_page = MagicMock()
    mock_context = MagicMock()
    mock_browser = MagicMock()
    mock_pw = MagicMock()

    mock_pw.chromium.launch.return_value = mock_browser
    mock_browser.new_context.return_value = mock_context
    mock_context.new_page.return_value = mock_page

    # Simulate origin-guard interceptor
    routes_registered = []
    def mock_route(pattern, handler):
        routes_registered.append((pattern, handler))

    mock_page.route.side_effect = mock_route

    # Mock evaluation results
    mock_page.evaluate.side_effect = [
        {"overflow": False, "scroll_width": 375, "client_width": 375}, # mobile overflow check (no overflow)
        {"empty_blocked": True, "invalid_blocked": True}, # negative form tests
        {"overflow": False, "scroll_width": 1280, "client_width": 1280}, # desktop overflow check
    ]

    class FakeSyncPlaywright:
        def __enter__(self):
            return mock_pw
        def __exit__(self, *args):
            pass

    # Patch sync_playwright even if playwright package is not installed on runner
    import sys
    from types import ModuleType
    fake_pw_mod = sys.modules.get("playwright") or ModuleType("playwright")
    fake_sync_mod = sys.modules.get("playwright.sync_api") or ModuleType("playwright.sync_api")
    monkeypatch.setattr(fake_sync_mod, "sync_playwright", FakeSyncPlaywright, raising=False)
    monkeypatch.setitem(sys.modules, "playwright", fake_pw_mod)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_sync_mod)
    monkeypatch.setattr(browser, "find_browser_executable", lambda: "/usr/bin/mock-browser")

    res = browser.run_project_browser_tests(
        db_mock,
        "p-browser",
        target_url="http://127.0.0.1:27031",
        release_checksum="chk-sha256-12345",
    )

    assert res["ok"] is True
    assert res["passed"] is True
    assert res["release_checksum"] == "chk-sha256-12345"
    assert "summary" in res
    assert res["summary"]["viewports"]["mobile"]["overflow"] is False

    # Check that SingraTestRun was added to DB
    assert db_mock.add.called
    saved_run = db_mock.add.call_args[0][0]
    assert isinstance(saved_run, SingraTestRun)
    assert saved_run.project_id == "p-browser"
    assert saved_run.status == "passed"
    assert saved_run.release_checksum == "chk-sha256-12345"
