"""Security and isolation checks for coding-sandbox ephemeral containers in msm-agent."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from config import settings
from main import app
from services.docker_service import HardeningError


def test_ephemeral_coding_sandbox_enforces_network_none_ro_rootfs_and_tmpfs(
    monkeypatch, servers_dir: Path
) -> None:
    ws = servers_dir / "_ai_projects" / "proj_abc"
    ws.mkdir(parents=True)

    container = MagicMock()
    container.wait.return_value = {"StatusCode": 0}
    container.logs.return_value = b"2 passed\n"
    docker_client = SimpleNamespace(
        containers=SimpleNamespace(run=MagicMock(return_value=container)),
        networks=SimpleNamespace(get=MagicMock()),
    )
    monkeypatch.setattr("services.docker_service._get_client", lambda: docker_client)
    monkeypatch.setattr("services.docker_service._apply_network_isolation_safe", lambda _c: None)

    from services.docker_service import run_ephemeral

    res = run_ephemeral(
        image="msm-coding-sandbox:latest",
        command=["/bin/sh", "-c", "pytest -q"],
        volumes={str(ws): {"bind": "/workspace", "mode": "rw"}},
        workdir="/workspace",
        network="none",
        read_only_rootfs=True,
        tmpfs_paths=["/tmp"],
        pids_limit=128,
        mem_limit="1024m",
        nano_cpus=1_000_000_000,
    )

    assert res["ok"] is True
    kwargs = docker_client.containers.run.call_args.kwargs
    assert kwargs["network_mode"] == "none"
    assert "network" not in kwargs
    assert kwargs["read_only"] is True
    assert kwargs["privileged"] is False
    assert kwargs["cap_drop"] == ["ALL"]
    assert kwargs["pids_limit"] == 128
    assert kwargs["mem_limit"] == "1024m"
    assert kwargs["tmpfs"] == {"/tmp": "rw,noexec,nosuid,nodev,size=128m,mode=1777"}
    container.remove.assert_called_once_with(force=True)


@pytest.mark.parametrize("bad_network", ["host", "bridge", "msm-pg-hub", "msm-internal"])
def test_ephemeral_rejects_panel_host_and_bridge_networks(
    monkeypatch, servers_dir: Path, bad_network: str
) -> None:
    target = servers_dir / "_ai_projects" / "proj_badnet"
    target.mkdir(parents=True)
    monkeypatch.setattr(
        "services.docker_service._get_client",
        lambda: SimpleNamespace(containers=SimpleNamespace(run=MagicMock())),
    )
    from services.docker_service import run_ephemeral

    with pytest.raises(HardeningError, match="network is not allowed"):
        run_ephemeral(
            image="msm-coding-sandbox:latest",
            command=["pytest"],
            volumes={str(target): {"bind": "/workspace", "mode": "rw"}},
            network=bad_network,
        )


def test_ephemeral_rejects_arbitrary_tmpfs_paths(monkeypatch, servers_dir: Path) -> None:
    target = servers_dir / "_ai_projects" / "proj_badtmpfs"
    target.mkdir(parents=True)
    monkeypatch.setattr(
        "services.docker_service._get_client",
        lambda: SimpleNamespace(containers=SimpleNamespace(run=MagicMock())),
    )
    from services.docker_service import run_ephemeral

    with pytest.raises(HardeningError, match="tmpfs path"):
        run_ephemeral(
            image="msm-coding-sandbox:latest",
            command=["pytest"],
            volumes={str(target): {"bind": "/workspace", "mode": "rw"}},
            network="none",
            read_only_rootfs=True,
            tmpfs_paths=["/etc"],
        )


def test_ephemeral_router_accepts_sandbox_fields_and_rejects_host_network(
    monkeypatch, servers_dir: Path
) -> None:
    ws = servers_dir / "_ai_projects" / "proj_api"
    ws.mkdir(parents=True)
    captured = {}

    def fake_run_ephemeral(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "stdout": "ok\n", "stderr": ""}

    monkeypatch.setattr("services.docker_service.run_ephemeral", fake_run_ephemeral)
    monkeypatch.setattr(settings, "agent_token", "test-token")
    headers = {"Authorization": "Bearer test-token"}
    with TestClient(app) as client:
        ok_resp = client.post(
            "/containers/ephemeral/run",
            json={
                "image": "msm-coding-sandbox:latest",
                "command": ["pytest"],
                "volumes": {str(ws): {"bind": "/workspace", "mode": "rw"}},
                "workdir": "/workspace",
                "network": "none",
                "read_only_rootfs": True,
                "tmpfs_paths": ["/tmp"],
                "pids_limit": 128,
            },
            headers=headers,
        )
        assert ok_resp.status_code == 200, ok_resp.text
        assert captured["network"] == "none"
        assert captured["read_only_rootfs"] is True
        assert captured["tmpfs_paths"] == ["/tmp"]
        assert captured["pids_limit"] == 128

        bad_resp = client.post(
            "/containers/ephemeral/run",
            json={
                "image": "msm-coding-sandbox:latest",
                "command": ["pytest"],
                "network": "host",
            },
            headers=headers,
        )
        assert bad_resp.status_code == 422
