from pathlib import Path
from types import SimpleNamespace

import pytest

from services.console_log_service import read_declared_log_updates
from services import docker_service
from services.docker_service import DockerUnavailableError


def test_reads_declared_file_tail_and_redacts_secret(tmp_path: Path) -> None:
    target = tmp_path / "ShooterGame" / "Saved" / "Logs" / "ShooterGame.log"
    target.parent.mkdir(parents=True)
    target.write_text(
        "Server ready\nCommandline: ?ServerAdminPassword=synthetic-secret-not-real\n",
        encoding="utf-8",
    )
    positions: dict[str, int] = {}

    lines = read_declared_log_updates(
        root=tmp_path,
        sources=["ShooterGame/Saved/Logs/ShooterGame.log", "stdout"],
        redactors=["regex:ServerAdminPassword"],
        max_tail_bytes=4096,
        positions=positions,
    )

    text = "\n".join(lines)
    assert "Server ready" in text
    assert "synthetic-secret-not-real" not in text
    assert "[REDACTED]" in text


def test_rejects_symlink_escape_even_if_source_was_schema_valid(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside-console.log"
    outside.write_text("must-not-leak\n", encoding="utf-8")
    (tmp_path / "escape.log").symlink_to(outside)

    lines = read_declared_log_updates(
        root=tmp_path,
        sources=["escape.log"],
        redactors=[],
        max_tail_bytes=4096,
        positions={},
    )

    assert lines == []


def test_managed_bind_root_uses_workdir_mount_inside_servers_root(
    tmp_path: Path, monkeypatch
) -> None:
    server_root = tmp_path / "ark_107"
    server_root.mkdir()
    container = SimpleNamespace(attrs={
        "Config": {"WorkingDir": "/home/container"},
        "Mounts": [{
            "Type": "bind",
            "Source": str(server_root),
            "Destination": "/home/container",
            "RW": True,
        }],
    })
    monkeypatch.setattr(docker_service.settings, "servers_dir", str(tmp_path))
    monkeypatch.setattr(docker_service, "_get_container", lambda _name: container)

    assert docker_service.managed_bind_root("msm-srv-107") == server_root


def test_managed_bind_root_rejects_mount_outside_servers_root(
    tmp_path: Path, monkeypatch
) -> None:
    managed = tmp_path / "managed"
    managed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    container = SimpleNamespace(attrs={
        "Config": {"WorkingDir": "/data"},
        "Mounts": [{
            "Type": "bind",
            "Source": str(outside),
            "Destination": "/data",
            "RW": True,
        }],
    })
    monkeypatch.setattr(docker_service.settings, "servers_dir", str(managed))
    monkeypatch.setattr(docker_service, "_get_container", lambda _name: container)

    with pytest.raises(DockerUnavailableError):
        docker_service.managed_bind_root("msm-srv-107")


def test_incremental_reads_do_not_drop_first_new_line(tmp_path: Path) -> None:
    target = tmp_path / "server-console.txt"
    target.write_text("Server starting\n", encoding="utf-8")
    positions: dict[str, int] = {}

    first = read_declared_log_updates(
        root=tmp_path,
        sources=["server-console.txt", "stdout"],
        redactors=[],
        max_tail_bytes=4096,
        positions=positions,
    )
    assert first == ["Server starting"]

    # Single-line append after initial poll must never be dropped by split[1:]
    with target.open("a", encoding="utf-8") as handle:
        handle.write("Player Bob joined\n")
    second = read_declared_log_updates(
        root=tmp_path,
        sources=["server-console.txt", "stdout"],
        redactors=[],
        max_tail_bytes=4096,
        positions=positions,
    )
    assert second == ["Player Bob joined"]

    with target.open("a", encoding="utf-8") as handle:
        handle.write("Player Bob disconnected\n")
        handle.write("World saved\n")
    third = read_declared_log_updates(
        root=tmp_path,
        sources=["server-console.txt", "stdout"],
        redactors=[],
        max_tail_bytes=4096,
        positions=positions,
    )
    assert third == ["Player Bob disconnected", "World saved"]


def test_initial_read_does_not_starve_secondary_log_source(tmp_path: Path) -> None:
    console_file = tmp_path / "server-console.txt"
    console_file.write_text(("DEBUG server tick\n" * 300), encoding="utf-8")
    logs_dir = tmp_path / "Logs"
    logs_dir.mkdir()
    user_file = logs_dir / "2026-11-17_user.txt"
    user_file.write_text("user Alice fully connected\n", encoding="utf-8")

    lines = read_declared_log_updates(
        root=tmp_path,
        sources=["server-console.txt", "Logs/*_user.txt"],
        redactors=[],
        max_tail_bytes=2048,
        positions={},
    )
    assert "user Alice fully connected" in lines


def test_wildcard_prioritizes_newest_files_when_many_exist(tmp_path: Path) -> None:
    import os

    logs_dir = tmp_path / "Logs"
    logs_dir.mkdir()
    base_ts = 1_700_000_000
    for idx in range(12):
        old_file = logs_dir / f"2026-11-{idx + 1:02d}_user.txt"
        old_file.write_text(f"old entry {idx}\n", encoding="utf-8")
        os.utime(old_file, (base_ts + idx, base_ts + idx))

    newest = logs_dir / "00_active_session_user.txt"
    newest.write_text("user NewPlayer connected\n", encoding="utf-8")
    os.utime(newest, (base_ts + 9999, base_ts + 9999))

    lines = read_declared_log_updates(
        root=tmp_path,
        sources=["Logs/*_user.txt"],
        redactors=[],
        max_tail_bytes=8192,
        positions={},
    )
    assert "user NewPlayer connected" in lines