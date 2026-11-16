"""Tests for idempotent Docker restarts in update.sh and post-update server recovery."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.orm import Session

from models import Node, Server
from services.server_lifecycle_service import recover_servers_after_docker_restart

REPO_ROOT = Path(__file__).resolve().parents[2]


def _make_server(
    db: Session,
    *,
    server_id: int,
    name: str,
    desired_power_state: str = "running",
    status: str = "running",
    node: Node | None = None,
) -> Server:
    srv = Server(
        id=server_id,
        name=name,
        game_type="minecraft",
        install_dir=f"/tmp/msm-test-{server_id}",
        status=status,
        desired_power_state=desired_power_state,
        desired_state_generation=1,
        guardian_observed_state="unknown",
        public_bind_ip="127.0.0.1",
        node=node,
    )
    db.add(srv)
    return srv


def test_recover_servers_after_docker_restart_starts_only_eligible_local_servers(
    db: Session, tmp_path: Path
) -> None:
    local_node = Node(
        id=501,
        name="local-test",
        host="http://127.0.0.1:9000",
        status="online",
        is_local=True,
        auth_token_enc="test-enc-v1:00:00",
    )
    remote_node = Node(
        id=502,
        name="remote-test",
        host="http://10.0.0.5:9000",
        status="online",
        is_local=False,
        auth_token_enc="test-enc-v1:00:00",
    )
    db.add_all([local_node, remote_node])

    srv_local_stopped = _make_server(
        db,
        server_id=801,
        name="Bot-801",
        desired_power_state="running",
        status="running",
        node=local_node,
    )
    srv_no_node = _make_server(
        db,
        server_id=802,
        name="Legacy-802",
        desired_power_state="running",
        status="stopped",
        node=None,
    )
    srv_desired_stopped = _make_server(
        db,
        server_id=803,
        name="Stopped-803",
        desired_power_state="stopped",
        status="stopped",
        node=local_node,
    )
    srv_already_running = _make_server(
        db,
        server_id=804,
        name="Alive-804",
        desired_power_state="running",
        status="running",
        node=local_node,
    )
    srv_remote = _make_server(
        db,
        server_id=805,
        name="Remote-805",
        desired_power_state="running",
        status="running",
        node=remote_node,
    )
    db.commit()

    snapshot = tmp_path / ".update-restart-servers.json"
    snapshot.write_text(
        json.dumps(
            {
                "server_ids": [801, 802, 803, 804, 805, 99999, 801],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        ),
        encoding="utf-8",
    )

    plugin = MagicMock()

    def _fake_get_status(srv: Server):
        if srv.id == srv_already_running.id:
            return SimpleNamespace(status="running", message=None, started_at=None)
        return SimpleNamespace(status="stopped", message=None, started_at=None)

    plugin.get_status.side_effect = _fake_get_status

    queued_calls: list[tuple[int, str]] = []

    def _fake_queue(_db: Session, srv: Server, op: str):
        queued_calls.append((srv.id, op))
        return {"status": "queued", "operation": op}

    with (
        patch("services.server_lifecycle_service.get_plugin", return_value=plugin),
        patch("services.server_lifecycle_service.is_lifecycle_job_active", return_value=False),
        patch("services.server_lifecycle_service.queue_lifecycle_operation", side_effect=_fake_queue),
    ):
        started = recover_servers_after_docker_restart(
            db, snapshot_path=snapshot, stagger_seconds=0.0
        )
        assert started == [srv_local_stopped.id, srv_no_node.id]
        assert queued_calls == [(801, "start"), (802, "start")]
        assert not snapshot.exists()

        # Second invocation must be a no-op once snapshot is claimed.
        assert (
            recover_servers_after_docker_restart(db, snapshot_path=snapshot, stagger_seconds=0.0)
            == []
        )

    assert srv_desired_stopped.id not in started
    assert srv_already_running.id not in started
    assert srv_remote.id not in started


def test_recover_servers_after_docker_restart_handles_corrupt_stale_and_partial_errors(
    db: Session, tmp_path: Path
) -> None:
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not-json", encoding="utf-8")
    assert recover_servers_after_docker_restart(db, snapshot_path=corrupt, stagger_seconds=0.0) == []
    assert not corrupt.exists()

    stale = tmp_path / "stale.json"
    stale.write_text(
        json.dumps(
            {
                "server_ids": [811],
                "created_at": (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat(),
            }
        ),
        encoding="utf-8",
    )
    assert recover_servers_after_docker_restart(db, snapshot_path=stale, stagger_seconds=0.0) == []
    assert not stale.exists()

    srv1 = _make_server(db, server_id=811, name="FailFirst", desired_power_state="running")
    srv2 = _make_server(db, server_id=812, name="SucceedSecond", desired_power_state="running")
    db.commit()

    partial = tmp_path / "partial.json"
    partial.write_text(
        json.dumps({"server_ids": [srv1.id, srv2.id], "created_at": datetime.now(timezone.utc).isoformat()}),
        encoding="utf-8",
    )
    plugin = MagicMock()
    plugin.get_status.return_value = SimpleNamespace(status="stopped", message=None, started_at=None)

    def _queue_with_failure(_db: Session, srv: Server, op: str):
        if srv.id == srv1.id:
            raise RuntimeError("simulated conflict")
        return {"status": "queued", "operation": op}

    with (
        patch("services.server_lifecycle_service.get_plugin", return_value=plugin),
        patch("services.server_lifecycle_service.is_lifecycle_job_active", return_value=False),
        patch("services.server_lifecycle_service.queue_lifecycle_operation", side_effect=_queue_with_failure),
    ):
        started = recover_servers_after_docker_restart(
            db, snapshot_path=partial, stagger_seconds=0.0
        )

    assert started == [srv2.id]
    assert not partial.exists()


def test_update_sh_only_restarts_docker_on_config_change_and_snapshots_servers() -> None:
    updater = (REPO_ROOT / "update.sh").read_text(encoding="utf-8")
    installer = (REPO_ROOT / "install.sh").read_text(encoding="utf-8")

    # Every docker.service restart in update.sh must be preceded by snapshot capture
    # and gated by a change/state condition (never unconditional on every update).
    assert "_write_docker_restart_snapshot" in updater
    assert "if $DOCKER_RESTART_NEEDED; then" in updater
    assert "Rootless-Docker-Konfiguration unverändert – Daemon bleibt ohne Unterbrechung aktiv." in updater

    restart_indices = [m.start() for m in re.finditer(r"systemctl --user[^\n]*restart docker\.service", updater)]
    assert len(restart_indices) == 2  # primary rootless block + legacy fallback
    for idx in restart_indices:
        window = updater[max(0, idx - 1000) : idx]
        assert "_write_docker_restart_snapshot" in window, "Missing snapshot before docker.service restart"
        assert ("if $DOCKER_RESTART_NEEDED" in window) or ("! cmp -s" in window), (
            "docker.service restart is not gated by a change check"
        )

    # Canonical override.conf environment variables must match across install.sh and update.sh.
    for env_line in (
        'DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns',
        'DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true',
        'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/',
    ):
        assert env_line in installer
        assert env_line in updater
