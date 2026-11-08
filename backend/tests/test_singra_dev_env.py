import pytest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from models import Node, PostgresDatabase, Server, User
from models.ai_project import AiProject
from services import ai_project_service
from services.singra import dev_env, dev_idle_worker


def test_touch_dev_activity(tmp_path):
    ws = tmp_path / "ws_test"
    ws.mkdir()
    meta_path = ai_project_service._env_meta_path(ws)
    meta_path.write_text("{}", encoding="utf-8")

    dev_env.touch_dev_activity("p-1", ws_dir=ws)

    import json
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    assert "dev_last_active_at" in data
    dt = datetime.fromisoformat(data["dev_last_active_at"])
    assert (datetime.now(timezone.utc) - dt).total_seconds() < 5


def test_get_dev_environment_status(tmp_path, monkeypatch):
    db_mock = MagicMock()
    user = User(id=1, username="admin")
    project = AiProject(id="p-test", name="TestApp", user_id=1)

    from services import ai_project_service

    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: tmp_path)

    # Inactive for 75 minutes
    idle_time = (datetime.now(timezone.utc) - timedelta(minutes=75)).isoformat()
    meta = {
        "dev_status": "paused_idle",
        "dev_last_active_at": idle_time,
        "dev_web_url": "http://127.0.0.1:27031",
        "dev_backend_port": 27026,
        "dev_frontend_port": 27031,
    }
    monkeypatch.setattr(ai_project_service, "_ensure_env_metadata", lambda p, ws: meta)

    res = dev_env.get_dev_environment_status(db_mock, user, "p-test")

    assert res["project_id"] == "p-test"
    assert res["status"] == "paused_idle"
    assert res["is_paused"] is True
    assert res["dev_web_url"] == "http://127.0.0.1:27031"
    assert res["idle_minutes"] >= 74.0


def test_start_and_stop_dev_environment(tmp_path, monkeypatch):
    db_mock = MagicMock()
    user = User(id=1, username="admin")
    project = AiProject(id="p-start", name="BlogApp", user_id=1)
    node = Node(id=1, name="LocalNode", is_local=True)

    db_mock.query.return_value.order_by.return_value.first.return_value = node
    db_mock.get.return_value = node

    meta = {}
    from services import ai_project_service

    monkeypatch.setattr(ai_project_service, "get_project", lambda db, u, pid: project)
    monkeypatch.setattr(ai_project_service, "ensure_project_workspace", lambda p: tmp_path)
    monkeypatch.setattr(ai_project_service, "_ensure_env_metadata", lambda p, ws: meta)
    monkeypatch.setattr(ai_project_service, "_save_env_metadata", lambda ws, m: meta.update(m))

    # Mock project files (fullstack: package.json with express + index.html)
    f1 = MagicMock(path="package.json", content='{"dependencies":{"express":"^4.18.2"}}')
    f2 = MagicMock(path="index.html", content='<!DOCTYPE html><html><body>App</body></html>')
    monkeypatch.setattr(ai_project_service, "list_project_files", lambda db, u, pid: [f1, f2])

    # Mock release build & caddy
    monkeypatch.setattr(dev_env, "build_release", lambda *args, **kwargs: tmp_path)
    monkeypatch.setattr(dev_env.caddy_service, "apply_vhost", lambda *args, **kwargs: True)
    monkeypatch.setattr(dev_env.server_runtime_env, "set_runtime_env", lambda *args, **kwargs: True)

    # Mock port allocations: backend 27026, frontend 27031
    port_calls = []
    def dummy_alloc(db, bind_ip, port_requirements, node_id, check_host):
        port = 27026 if not port_calls else 27031
        port_calls.append(port)
        return [(port_requirements[0][0], port)]

    monkeypatch.setattr(dev_env, "allocate_ports", dummy_alloc)

    # 1. Start dev environment
    res = dev_env.start_dev_environment(db_mock, user, "p-start")

    assert res["ok"] is True
    assert res["status"] == "running"
    assert res["dev_frontend_port"] == 27031
    assert res["dev_backend_port"] == 27026
    assert "dev_web_url" in res
    assert meta["dev_status"] == "running"

    # 2. Stop dev environment
    be_srv = Server(id=res["dev_backend_server_id"], status="running", desired_power_state="running")
    fe_srv = Server(id=res["dev_frontend_server_id"], status="running", desired_power_state="running")

    def mock_get(model, pk):
        if model is Server and pk == be_srv.id:
            return be_srv
        if model is Server and pk == fe_srv.id:
            return fe_srv
        return None

    db_mock.get.side_effect = mock_get

    stop_res = dev_env.stop_dev_environment(db_mock, user, "p-start")

    assert stop_res["ok"] is True
    assert stop_res["status"] == "stopped"
    assert be_srv.status == "stopped"
    assert fe_srv.status == "stopped"
    assert meta["dev_status"] == "stopped"


def test_dev_idle_worker_pauses_inactive_projects(tmp_path, monkeypatch):
    db_mock = MagicMock()

    # Project 1: inactive for 65 minutes -> must pause
    p1 = AiProject(id="p-idle", name="IdleApp", user_id=1)
    ws1 = tmp_path / "p-idle"
    ws1.mkdir()
    meta1 = {
        "dev_status": "running",
        "dev_backend_server_id": 101,
        "dev_frontend_server_id": 102,
        "dev_last_active_at": (datetime.now(timezone.utc) - timedelta(minutes=65)).isoformat(),
    }
    import json
    meta1_path = ai_project_service._env_meta_path(ws1)
    meta1_path.write_text(json.dumps(meta1), encoding="utf-8")

    # Project 2: active 10 minutes ago -> should stay running
    p2 = AiProject(id="p-active", name="ActiveApp", user_id=1)
    ws2 = tmp_path / "p-active"
    ws2.mkdir()
    meta2 = {
        "dev_status": "running",
        "dev_backend_server_id": 201,
        "dev_frontend_server_id": 202,
        "dev_last_active_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
    }
    meta2_path = ai_project_service._env_meta_path(ws2)
    meta2_path.write_text(json.dumps(meta2), encoding="utf-8")

    db_mock.query.return_value.all.return_value = [p1, p2]

    def mock_get_ws(proj):
        return ws1 if proj.id == "p-idle" else ws2

    monkeypatch.setattr(dev_idle_worker.ai_project_service, "ensure_project_workspace", mock_get_ws)

    srv101 = Server(id=101, status="running", desired_power_state="running")
    srv102 = Server(id=102, status="running", desired_power_state="running")

    def mock_get(model, pk):
        if pk == 101:
            return srv101
        if pk == 102:
            return srv102
        return None

    db_mock.get.side_effect = mock_get

    paused_projects = dev_idle_worker.check_and_pause_idle_dev_environments(db_mock)

    assert len(paused_projects) == 1
    assert "p-idle" in paused_projects
    assert srv101.desired_power_state == "stopped"
    assert srv102.desired_power_state == "stopped"

    m1_updated = json.loads(meta1_path.read_text(encoding="utf-8"))
    assert m1_updated["dev_status"] == "paused_idle"

    m2_updated = json.loads(meta2_path.read_text(encoding="utf-8"))
    assert m2_updated["dev_status"] == "running"
