from pathlib import Path
import json
import pytest

from services.singra.start_sh import generate_start_sh
from services.singra.env import build_runtime_env
from services.singra.release import build_release, SingraBuildError


def test_generate_start_sh_node_npm_start():
    pkg = json.dumps({"name": "my-app", "scripts": {"start": "node index.js"}})
    sh = generate_start_sh({"package.json": pkg})
    assert "export PORT=" in sh
    assert "export HOST=" in sh
    assert "exec npm start" in sh


def test_generate_start_sh_node_server_script():
    pkg = json.dumps({"name": "my-app", "scripts": {"server": "node server.js"}})
    sh = generate_start_sh({"package.json": pkg})
    assert "exec npm run server" in sh


def test_generate_start_sh_node_main_entry():
    pkg = json.dumps({"name": "my-app", "main": "dist/server.js"})
    sh = generate_start_sh({"package.json": pkg})
    assert "exec node dist/server.js" in sh


def test_generate_start_sh_node_server_fallback():
    sh = generate_start_sh({"server.js": "console.log('hi');"})
    assert "exec node server.js" in sh


def test_generate_start_sh_python_fastapi():
    sh = generate_start_sh({"main.py": "from fastapi import FastAPI\napp = FastAPI()"})
    assert "uvicorn main:app --host 0.0.0.0 --port \"$PORT\"" in sh


def test_generate_start_sh_python_script():
    sh = generate_start_sh({"main.py": "print('hello')", "requirements.txt": "requests"})
    assert "exec python main.py" in sh or "exec .venv/bin/python main.py" in sh


def test_build_runtime_env_no_db():
    env = build_runtime_env(port=27025, environment="prod")
    assert env["PORT"] == "27025"
    assert env["API_PORT"] == "27025"
    assert env["SERVER_PORT"] == "27025"
    assert env["HOST"] == "0.0.0.0"
    assert env["NODE_ENV"] == "production"
    assert "DATABASE_URL" not in env


def test_build_runtime_env_dev():
    env = build_runtime_env(port=27025, environment="dev")
    assert env["NODE_ENV"] == "development"


def test_build_runtime_env_with_db():
    creds = {
        "user": "appuser",
        "password": "secret&password",
        "database": "appdb",
    }
    env = build_runtime_env(port=3000, db_credentials=creds, environment="prod")
    assert "DATABASE_URL" in env
    assert "postgresql://appuser:secret%26password@msm-postgres:5432/appdb" in env["DATABASE_URL"]
    assert env["PGHOST"] == "msm-postgres"
    assert env["PGPORT"] == "5432"
    assert env["PGUSER"] == "appuser"
    assert env["PGPASSWORD"] == "secret&password"
    assert env["PGDATABASE"] == "appdb"
    assert "127.0.0.1" not in env["DATABASE_URL"]


def test_build_release_backend_only(tmp_path):
    class DummyProject:
        id = "test-proj-1"

    files = {
        "server.js": "const http = require('http');\nhttp.createServer().listen(process.env.PORT);",
        "package.json": json.dumps({"name": "backend", "scripts": {"start": "node server.js"}}),
    }

    rel_dir = build_release(
        project=DummyProject(),
        files=files,
        workspace_dir=tmp_path,
        environment="prod",
    )

    assert rel_dir.exists()
    assert rel_dir.name == "_prod_release"
    assert (rel_dir / "server.js").exists()
    assert (rel_dir / "start.sh").exists()
    assert (rel_dir / "release.json").exists()

    manifest = json.loads((rel_dir / "release.json").read_text(encoding="utf-8"))
    assert manifest["project_id"] == "test-proj-1"
    assert manifest["environment"] == "prod"
    assert "server.js" in manifest["checksums"]


def test_build_release_frontend_missing_dist_raises(tmp_path, monkeypatch):
    from services import docker_service

    class DummyProject:
        id = "test-frontend-proj"

    # Mock docker to say unavailable so local fallback runs, and mock npm to produce no dist
    monkeypatch.setattr(docker_service, "is_docker_available", lambda node=None: False)

    files = {
        "package.json": json.dumps({"name": "frontend", "scripts": {"build": "exit 0"}}),
        "index.html": "<!DOCTYPE html><html><body>Test</body></html>",
    }

    with pytest.raises(SingraBuildError) as exc_info:
        build_release(
            project=DummyProject(),
            files=files,
            workspace_dir=tmp_path,
            environment="prod",
        )

    assert exc_info.value.phase == "build_frontend"
    assert "dist/index.html" in str(exc_info.value)
