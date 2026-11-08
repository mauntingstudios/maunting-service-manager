import pytest
from unittest.mock import MagicMock, patch

from models import OperationTask, SingraDeployment, User
from models.ai_project import AiProject
from services.ai_project_service import (
    AiProjectError,
    git_branch,
    git_open_pr,
    git_commit_and_push,
    merge_to_main,
)
from services.singra import runner


def test_quality_phase_detects_forbidden_external_cdn(tmp_path, monkeypatch):
    db_mock = MagicMock()
    user = User(id=1, username="admin")

    ws = tmp_path / "ws_cdn"
    ws.mkdir()
    build_dir = ws / "_release_build"
    build_dir.mkdir()
    (build_dir / "index.html").write_text(
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">',
        encoding="utf-8",
    )

    project = AiProject(id="p-cdn", name="FontApp", user_id=1)
    dep = SingraDeployment(id="dep-cdn", project_id="p-cdn", status="pending", phase="snapshot")
    task = OperationTask(id="task-cdn", status="running", phase="snapshot")

    models_store = {
        (User, 1): user,
        (SingraDeployment, "dep-cdn"): dep,
        (OperationTask, "task-cdn"): task,
    }
    db_mock.get.side_effect = lambda model, ident: models_store.get((model, ident))
    monkeypatch.setattr(runner, "SessionLocal", lambda: db_mock)

    from services import ai_project_service
    from services.singra import browser

    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: ws)
    monkeypatch.setattr(ai_project_service, "_ensure_env_metadata", lambda p, w: {})
    monkeypatch.setattr(ai_project_service, "_save_env_metadata", lambda w, m: None)
    monkeypatch.setattr(
        ai_project_service,
        "list_project_files",
        lambda db, u, pid: [
            MagicMock(path="index.html", content='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">')
        ],
    )

    # Test-Gate passes, so it continues to CDN check
    monkeypatch.setattr(browser, "has_passed_test_run", lambda db, pid, chk: True)

    runner._execute_phases(
        deployment_id="dep-cdn",
        task_id="task-cdn",
        project_id="p-cdn",
        user_id=1,
        environment="prod",
        options={"mode": "frontend"},
    )

    assert dep.status == "failed"
    assert dep.phase == "quality"
    assert dep.error_code == "phase_quality_failed"
    assert "external_cdn_forbidden" in (dep.error_detail or "")
    assert "Externe Schriftarten oder CDNs im Quellcode gefunden" in (dep.error_detail or "")


def test_quality_phase_blocks_production_without_passed_test_gate(tmp_path, monkeypatch):
    db_mock = MagicMock()
    user = User(id=1, username="admin")

    ws = tmp_path / "ws_gate"
    ws.mkdir()
    build_dir = ws / "_release_build"
    build_dir.mkdir()
    (build_dir / "index.html").write_text("<h1>Clean Local App</h1>", encoding="utf-8")

    project = AiProject(id="p-gate", name="GateApp", user_id=1)
    dep = SingraDeployment(id="dep-gate", project_id="p-gate", status="pending", phase="snapshot")
    task = OperationTask(id="task-gate", status="running", phase="snapshot")

    models_store = {
        (User, 1): user,
        (SingraDeployment, "dep-gate"): dep,
        (OperationTask, "task-gate"): task,
    }
    db_mock.get.side_effect = lambda model, ident: models_store.get((model, ident))
    monkeypatch.setattr(runner, "SessionLocal", lambda: db_mock)

    from services import ai_project_service
    from services.singra import browser

    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: ws)
    monkeypatch.setattr(ai_project_service, "_ensure_env_metadata", lambda p, w: {})
    monkeypatch.setattr(ai_project_service, "_save_env_metadata", lambda w, m: None)
    monkeypatch.setattr(
        ai_project_service,
        "list_project_files",
        lambda db, u, pid: [MagicMock(path="index.html", content="<h1>Clean Local App</h1>")],
    )

    # Test gate returns False -> must fail immediately in quality phase
    monkeypatch.setattr(browser, "has_passed_test_run", lambda db, pid, chk: False)

    runner._execute_phases(
        deployment_id="dep-gate",
        task_id="task-gate",
        project_id="p-gate",
        user_id=1,
        environment="prod",
        options={"mode": "frontend"},
    )

    assert dep.status == "failed"
    assert dep.phase == "quality"
    assert dep.error_code == "phase_quality_failed"
    assert "test_required" in (dep.error_detail or "")
    assert "Veröffentlichung auf Produktion gesperrt" in (dep.error_detail or "")


def test_git_branch_workflow(tmp_path, monkeypatch):
    db_mock = MagicMock()
    user = User(id=1, username="developer")
    project = AiProject(id="p-git", name="GitApp", user_id=1, git_branch="main")

    monkeypatch.setattr("services.ai_project_service.get_project", lambda db, u, pid: project)
    monkeypatch.setattr("services.ai_project_service.ensure_project_workspace", lambda p: tmp_path)
    monkeypatch.setattr("services.ai_project_service._materialize_db_files_to_workspace", lambda db, p, ws: None)
    monkeypatch.setattr("services.ai_project_service._ensure_env_metadata", lambda p, ws: {})
    monkeypatch.setattr("services.ai_project_service._save_env_metadata", lambda ws, m: None)
    monkeypatch.setattr("services.ai_project_service.git_status", lambda db, u, pid: {"branch": "singra/feature-login"})

    # Mock subprocess.run for git commands
    with patch("subprocess.run") as mock_sub:
        mock_sub.return_value = MagicMock(returncode=0, stdout="", stderr="")

        res = git_branch(db_mock, user, "p-git", branch_name="feature-login")

        assert res["ok"] is True
        assert res["branch"] == "singra/feature-login"
        assert project.git_branch == "singra/feature-login"


def test_git_commit_blocks_direct_push_to_main(tmp_path, monkeypatch):
    db_mock = MagicMock()
    user = User(id=1, username="developer")
    project = AiProject(id="p-block-main", name="MainApp", user_id=1, git_repo_url="https://github.com/org/repo.git", git_branch="main")

    monkeypatch.setattr("services.ai_project_service.get_project", lambda db, u, pid: project)
    monkeypatch.setattr("services.ai_project_service.ensure_project_workspace", lambda p: tmp_path)
    monkeypatch.setattr("services.ai_project_service._materialize_db_files_to_workspace", lambda db, p, ws: None)
    monkeypatch.setattr("services.ai_project_service.resolve_git_token_for_user", lambda db, u, p: "token123")
    monkeypatch.setattr("services.ai_project_service._clean_git_remote_url", lambda u, p: u)

    with patch("subprocess.run") as mock_sub:
        mock_sub.return_value = MagicMock(returncode=0, stdout="", stderr="")

        # Direct push on main must be rejected
        with pytest.raises(AiProjectError) as exc_info:
            git_commit_and_push(db_mock, user, "p-block-main", message="direct push to main", push=True)

        assert "Direkter Push auf den main-Branch ist untersagt" in str(exc_info.value)
