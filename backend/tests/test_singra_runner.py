import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

from models import SingraDeployment, OperationTask, User
from services.actor_context import ActorContext
from services.singra import runner


def test_runner_project_lock_isolation():
    lock1 = runner._get_project_lock("project-1")
    lock2 = runner._get_project_lock("project-2")
    lock1_again = runner._get_project_lock("project-1")

    assert lock1 is lock1_again
    assert lock1 is not lock2

    assert lock1.acquire(blocking=False) is True
    # Second acquisition on same project without release fails non-blocking
    assert lock1.acquire(blocking=False) is False
    lock1.release()


def test_runner_start_deployment(monkeypatch):
    db_mock = MagicMock()
    user = User(id=42, username="devuser")
    actor = ActorContext(user=user, origin="ai", correlation_id="c0a80101-0000-0000-0000-000000000001")

    # Mock task creation
    task_mock = OperationTask(id="task-123", status="queued", phase="accepted")
    monkeypatch.setattr(
        runner.operation_task_service,
        "create_or_reuse_task",
        lambda db, actor, task_type, request_hash: (task_mock, True),
    )

    # Don't actually spawn thread in test
    thread_started = False
    class DummyThread:
        def __init__(self, target, kwargs, daemon):
            self.target = target
            self.kwargs = kwargs
            self.daemon = daemon
        def start(self):
            nonlocal thread_started
            thread_started = True

    monkeypatch.setattr(runner.threading, "Thread", DummyThread)

    dep, task = runner.start_deployment(
        db_mock,
        actor=actor,
        project_id="proj-abc",
        environment="prod",
        options={"version": 2},
    )

    assert dep.project_id == "proj-abc"
    assert dep.environment == "prod"
    assert dep.version == 2
    assert dep.status == "pending"
    assert dep.phase == "snapshot"
    assert task.id == "task-123"
    assert thread_started is True


def test_runner_handle_failure(monkeypatch):
    db_mock = MagicMock()
    dep = SingraDeployment(id="dep-1", project_id="p-1", status="running", phase="build_frontend")
    task = OperationTask(id="task-1", status="running", phase="build_frontend")

    def _mock_get(model, ident):
        if model is SingraDeployment:
            return dep
        if model is OperationTask:
            return task
        return None

    db_mock.get.side_effect = _mock_get
    monkeypatch.setattr(runner.operation_task_service, "mark_failed", lambda db, t, error_code, phase: None)

    runner._handle_failure(
        db_mock,
        deployment_id="dep-1",
        task_id="task-1",
        phase="build_frontend",
        error_code="npm_build_failed",
        detail="Syntax error in App.tsx",
    )

    assert dep.status == "failed"
    assert dep.phase == "build_frontend"
    assert dep.error_code == "npm_build_failed"
    assert "Syntax error in App.tsx" in dep.error_detail


def test_execute_phases_happy_path(monkeypatch, tmp_path):
    from pathlib import Path
    from models.ai_project import AiProject, AiProjectFile
    from models import Server, Node

    db_mock = MagicMock()
    user = User(id=1, username="admin")
    project = AiProject(id="p-happy", name="HappyApp")
    dep = SingraDeployment(id="dep-happy", project_id="p-happy", status="pending", phase="snapshot")
    task = OperationTask(id="task-happy", status="queued", phase="snapshot")
    node = Node(id=1, name="Local Node", is_local=True)
    meta = {}

    fe_file = AiProjectFile(id=1, project_id="p-happy", path="index.html", content="<html></html>")
    sql_file = AiProjectFile(id=2, project_id="p-happy", path="schema.sql", content="CREATE TABLE test(id serial);")
    files = [fe_file, sql_file]

    release_dir = tmp_path / "_prod_release"
    release_dir.mkdir(parents=True, exist_ok=True)
    (release_dir / "dist").mkdir(parents=True, exist_ok=True)
    (release_dir / "dist" / "index.html").write_text("ok")

    models_store = {
        (User, 1): user,
        (SingraDeployment, "dep-happy"): dep,
        (OperationTask, "task-happy"): task,
        (Node, 1): node,
    }

    def _mock_get(model, ident):
        return models_store.get((model, ident))

    db_mock.get.side_effect = _mock_get
    db_mock.query.return_value.order_by.return_value.first.return_value = node

    monkeypatch.setattr(runner, "SessionLocal", lambda: db_mock)
    
    from services import ai_project_service
    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: tmp_path)
    monkeypatch.setattr(ai_project_service, "_ensure_env_metadata", lambda p, ws: meta)
    monkeypatch.setattr(ai_project_service, "list_project_files", lambda db, u, pid: files)
    monkeypatch.setattr(ai_project_service, "_save_env_metadata", lambda ws, m: None)
    monkeypatch.setattr(runner, "build_release", lambda **kwargs: release_dir)

    # Postgres & migration mocks
    monkeypatch.setattr(runner.postgres_service, "create_database", lambda db, server_id, name: {
        "database_id": 99,
        "database_name": name,
        "username": name,
        "password": "secret",
        "host": "msm-postgres",
        "port": 5432,
    })
    monkeypatch.setattr(runner.ai_db_migration_service, "run_migrations_for_database", lambda db, server_id, database_id, project_files, target_env: {"applied": ["schema.sql"]})
    monkeypatch.setattr(runner.ai_db_migration_service, "execute_project_sql", lambda db, server_id, database_id, sql: {"results": []})

    # Network / probe mocks
    monkeypatch.setattr(runner, "_tcp_ping", lambda host, port, timeout=0.5: True)
    
    class DummyClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def get(self, url):
            res = MagicMock()
            res.status_code = 200
            return res

    monkeypatch.setattr(runner.httpx, "Client", DummyClient)
    monkeypatch.setattr(runner.caddy_service, "apply_vhost", lambda server_id, cfg, node: MagicMock(__bool__=lambda s: True, error=None))

    runner._execute_phases(
        deployment_id="dep-happy",
        task_id="task-happy",
        project_id="p-happy",
        user_id=1,
        environment="prod",
        options={"frontend_port": 27030, "backend_port": 27025},
    )

    assert dep.status == "succeeded"
    assert dep.phase == "done"
    assert meta.get("prod_published") is True
    assert meta.get("prod_database_id") == 99


def test_execute_phases_fails_on_broken_frontend_probe(monkeypatch, tmp_path):
    from models.ai_project import AiProject, AiProjectFile
    from models import Server, Node

    db_mock = MagicMock()
    user = User(id=1, username="admin")
    project = AiProject(id="p-fail-fe", name="FailFeApp")
    dep = SingraDeployment(id="dep-fail-fe", project_id="p-fail-fe", status="pending", phase="snapshot")
    task = OperationTask(id="task-fail-fe", status="queued", phase="snapshot")
    node = Node(id=1, name="Local Node", is_local=True)
    meta = {}

    fe_file = AiProjectFile(id=1, project_id="p-fail-fe", path="index.html", content="<html></html>")
    files = [fe_file]

    release_dir = tmp_path / "_prod_release"
    release_dir.mkdir(parents=True, exist_ok=True)
    (release_dir / "dist").mkdir(parents=True, exist_ok=True)
    (release_dir / "dist" / "index.html").write_text("ok")

    models_store = {
        (User, 1): user,
        (SingraDeployment, "dep-fail-fe"): dep,
        (OperationTask, "task-fail-fe"): task,
        (Node, 1): node,
    }

    db_mock.get.side_effect = lambda m, i: models_store.get((m, i))
    db_mock.query.return_value.order_by.return_value.first.return_value = node

    monkeypatch.setattr(runner, "SessionLocal", lambda: db_mock)
    
    from services import ai_project_service
    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: tmp_path)
    monkeypatch.setattr(ai_project_service, "_ensure_env_metadata", lambda p, ws: meta)
    monkeypatch.setattr(ai_project_service, "list_project_files", lambda db, u, pid: files)
    monkeypatch.setattr(ai_project_service, "_save_env_metadata", lambda ws, m: None)
    monkeypatch.setattr(runner, "build_release", lambda **kwargs: release_dir)

    monkeypatch.setattr(runner.caddy_service, "apply_vhost", lambda server_id, cfg, node: MagicMock(__bool__=lambda s: True, error=None))
    monkeypatch.setattr(runner.caddy_service, "is_caddy_available", lambda: True)

    # Force frontend probe to fail
    monkeypatch.setattr(runner, "_tcp_ping", lambda host, port, timeout=0.5: False)
    
    class FailingClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def get(self, url):
            raise RuntimeError("Connection refused")

    monkeypatch.setattr(runner.httpx, "Client", FailingClient)

    runner._execute_phases(
        deployment_id="dep-fail-fe",
        task_id="task-fail-fe",
        project_id="p-fail-fe",
        user_id=1,
        environment="prod",
        options={"frontend_port": 27030},
    )

    assert dep.status == "failed"
    assert dep.phase == "verify_frontend"
    assert "Frontend antwortet nach Start nicht" in dep.error_detail
    # Invariant 2: prod_published remains unset/False!
    assert meta.get("prod_published") is not True


def test_execute_phases_fails_on_migration_error(monkeypatch, tmp_path):
    from models.ai_project import AiProject, AiProjectFile
    from models import Server, Node

    db_mock = MagicMock()
    user = User(id=1, username="admin")
    project = AiProject(id="p-fail-mig", name="FailMigApp")
    dep = SingraDeployment(id="dep-fail-mig", project_id="p-fail-mig", status="pending", phase="snapshot")
    task = OperationTask(id="task-fail-mig", status="queued", phase="snapshot")
    node = Node(id=1, name="Local Node", is_local=True)
    meta = {}

    fe_file = AiProjectFile(id=1, project_id="p-fail-mig", path="index.html", content="<html></html>")
    sql_file = AiProjectFile(id=2, project_id="p-fail-mig", path="schema.sql", content="SYNTAX ERROR SQL;")
    files = [fe_file, sql_file]

    release_dir = tmp_path / "_prod_release"
    release_dir.mkdir(parents=True, exist_ok=True)
    (release_dir / "dist").mkdir(parents=True, exist_ok=True)
    (release_dir / "dist" / "index.html").write_text("ok")

    models_store = {
        (User, 1): user,
        (SingraDeployment, "dep-fail-mig"): dep,
        (OperationTask, "task-fail-mig"): task,
        (Node, 1): node,
    }

    db_mock.get.side_effect = lambda m, i: models_store.get((m, i))
    db_mock.query.return_value.order_by.return_value.first.return_value = node

    monkeypatch.setattr(runner, "SessionLocal", lambda: db_mock)
    
    from services import ai_project_service
    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: tmp_path)
    monkeypatch.setattr(ai_project_service, "_ensure_env_metadata", lambda p, ws: meta)
    monkeypatch.setattr(ai_project_service, "list_project_files", lambda db, u, pid: files)
    monkeypatch.setattr(ai_project_service, "_save_env_metadata", lambda ws, m: None)
    monkeypatch.setattr(runner, "build_release", lambda **kwargs: release_dir)

    monkeypatch.setattr(runner.postgres_service, "create_database", lambda db, server_id, name: {
        "database_id": 99,
        "database_name": name,
        "username": name,
        "password": "secret",
        "host": "msm-postgres",
        "port": 5432,
    })

    def _fail_migrations(*args, **kwargs):
        raise RuntimeError("syntax error at or near 'SYNTAX'")

    monkeypatch.setattr(runner.ai_db_migration_service, "run_migrations_for_database", _fail_migrations)

    runner._execute_phases(
        deployment_id="dep-fail-mig",
        task_id="task-fail-mig",
        project_id="p-fail-mig",
        user_id=1,
        environment="prod",
        options={"frontend_port": 27030, "enable_database": True},
    )

    assert dep.status == "failed"
    assert dep.phase == "migrations"
    assert "syntax error" in dep.error_detail
    # Invariant 2: prod_published remains unset/False!
    assert meta.get("prod_published") is not True
