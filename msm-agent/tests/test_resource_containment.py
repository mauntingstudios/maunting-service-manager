"""Security & resource containment tests for workload containers, archives, and disk quotas."""

from __future__ import annotations

import io
import json
import os
import subprocess
import tarfile
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from docker.errors import NotFound

from config import settings
from security.seccomp import EXPLICITLY_DENIED_SYSCALLS, container_security_options
from services import docker_service, file_service, quota_service


def _mock_docker_client():
    container = MagicMock(id="cont1234567890", attrs={"State": {"Status": "running"}})
    network = MagicMock()
    client = SimpleNamespace(
        images=SimpleNamespace(get=MagicMock()),
        containers=SimpleNamespace(
            get=MagicMock(side_effect=NotFound("missing")),
            run=MagicMock(return_value=container),
        ),
        networks=SimpleNamespace(
            get=MagicMock(return_value=network),
            list=MagicMock(return_value=[]),
        ),
    )
    return client, container


def test_create_container_enforces_mandatory_resource_ceilings_and_blkio(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    client, _ = _mock_docker_client()
    monkeypatch.setattr("services.docker_service._get_client", lambda: client)
    monkeypatch.setattr("services.docker_service._host_cpu_count", lambda: 4)
    monkeypatch.setattr("services.docker_service._host_total_ram_mb", lambda: 8192)
    monkeypatch.setattr("services.docker_service._resolve_servers_block_device", lambda: "/dev/nvme0n1")
    monkeypatch.setattr("services.docker_service.os", SimpleNamespace(**{**os.__dict__, "name": "posix"}))
    monkeypatch.setattr(settings, "host_reserved_ram_mb", 2048, raising=False)
    monkeypatch.setattr(settings, "max_container_pids_limit", 512, raising=False)
    monkeypatch.setattr(settings, "container_blkio_read_bps", 50_000_000, raising=False)
    monkeypatch.setattr(settings, "container_blkio_write_bps", 25_000_000, raising=False)
    monkeypatch.setattr(settings, "container_blkio_read_iops", 2000, raising=False)
    monkeypatch.setattr(settings, "container_blkio_write_iops", 1000, raising=False)
    monkeypatch.setattr(settings, "servers_dir", str(tmp_path), raising=False)

    # Excessive / missing limits must still be clamped below host capacity.
    res = docker_service.create_container(
        name="msm-srv-77",
        image="alpine:3.20",
        cpu_limit_percent=6400.0,
        ram_limit_mb=65536,
        pids_limit=99999,
        network="msm-srv-net-77",
        tmpfs_paths=["/tmp"],
    )

    assert res["ok"] is True
    kw = client.containers.run.call_args.kwargs
    # Clamped to 4 CPUs (400%)
    assert kw["nano_cpus"] == 4_000_000_000
    # Clamped to 8192 - 2048 = 6144 MB, swap equal to RAM (swap disabled)
    assert kw["mem_limit"] == "6144m"
    assert kw["memswap_limit"] == "6144m"
    assert kw["pids_limit"] == 512
    assert kw["oom_score_adj"] >= 300
    assert kw["read_only"] is True
    assert kw["tmpfs"] == {"/tmp": "rw,noexec,nosuid,nodev,size=128m,mode=1777"}
    assert kw["device_read_bps"] == [{"Path": "/dev/nvme0n1", "Rate": 50_000_000}]
    assert kw["device_write_bps"] == [{"Path": "/dev/nvme0n1", "Rate": 25_000_000}]
    assert kw["device_read_iops"] == [{"Path": "/dev/nvme0n1", "Rate": 2000}]
    assert kw["device_write_iops"] == [{"Path": "/dev/nvme0n1", "Rate": 1000}]
    ulimits = {u.name: (u.soft, u.hard) for u in kw["ulimits"]}
    assert ulimits["core"] == (0, 0)
    assert ulimits["nofile"][1] >= 1024


def test_create_and_ephemeral_never_emit_seccomp_unconfined_and_include_apparmor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("security.seccomp.apparmor_profile_active", lambda _p="msm-container-default": True)
    opts_strict = container_security_options(allow_unprivileged_user_namespaces=False)
    opts_userns = container_security_options(allow_unprivileged_user_namespaces=True)
    for opts in (opts_strict, opts_userns):
        assert "no-new-privileges" in opts
        assert "apparmor=msm-container-default" in opts
        assert "seccomp=unconfined" not in opts
        seccomp_entry = next(o for o in opts if o.startswith("seccomp="))
        profile = json.loads(seccomp_entry.removeprefix("seccomp="))
        assert profile["defaultAction"] == "SCMP_ACT_ERRNO"
        denied = {
            name
            for rule in profile["syscalls"]
            if rule.get("action") == "SCMP_ACT_ERRNO"
            for name in rule.get("names", [])
        }
        for dangerous in ("bpf", "io_uring_setup", "io_uring_enter", "ptrace", "mount", "kexec_load"):
            assert dangerous in EXPLICITLY_DENIED_SYSCALLS
            assert dangerous in denied

    client, container = _mock_docker_client()
    container.wait.return_value = {"StatusCode": 0}
    container.logs.return_value = b"done"
    monkeypatch.setattr("services.docker_service._get_client", lambda: client)

    eph = docker_service.run_ephemeral(
        image="alpine:3.20",
        command=["echo", "ok"],
        pids_limit=999999,
        network="msm-ephemeral-net",
        read_only_rootfs=True,
    )
    assert eph["ok"] is True
    kw = client.containers.run.call_args.kwargs
    assert kw["privileged"] is False
    assert kw["cap_drop"] == ["ALL"]
    assert kw["read_only"] is True
    assert kw["pids_limit"] <= int(getattr(settings, "max_container_pids_limit", 2048))
    assert kw["mem_limit"] == kw["memswap_limit"]
    assert "seccomp=unconfined" not in kw["security_opt"]
    container.remove.assert_called_with(force=True)


def test_runtime_allowlist_and_bind_mount_containment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(settings, "servers_dir", str(tmp_path), raising=False)
    monkeypatch.setattr(settings, "allowed_container_runtimes", "runc,runsc", raising=False)

    with pytest.raises(docker_service.HardeningError):
        docker_service.create_container(
            name="msm-srv-88",
            image="alpine:3.20",
            runtime="kata-qemu",
        )

    client, _ = _mock_docker_client()
    monkeypatch.setattr("services.docker_service._get_client", lambda: client)
    with pytest.raises(docker_service.HardeningError):
        docker_service.create_container(
            name="msm-srv-88",
            image="alpine:3.20",
            volumes={"/etc": {"bind": "/host_etc", "mode": "ro"}},
        )

    res = docker_service.create_container(
        name="msm-srv-88",
        image="alpine:3.20",
        runtime="runsc",
        network="msm-srv-net-88",
    )
    assert res["ok"] is True
    assert client.containers.run.call_args.kwargs["runtime"] == "runsc"


def test_archive_extraction_blocks_symlinks_hardlinks_fifos_traversal_and_zip_bombs(
    servers_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    srv = servers_dir / "55"
    srv.mkdir()

    # 1. ZIP symlink escape
    zip_sym = srv / "sym.zip"
    with zipfile.ZipFile(zip_sym, "w") as zf:
        zi = zipfile.ZipInfo("evil_link")
        zi.create_system = 3
        zi.external_attr = (0o120777) << 16
        zf.writestr(zi, "/etc/passwd")
    with pytest.raises(file_service.PathValidationError):
        file_service.extract_archive("55", "sym.zip")

    # 2. ZIP path traversal
    zip_trav = srv / "trav.zip"
    with zipfile.ZipFile(zip_trav, "w") as zf:
        zf.writestr("../../outside.txt", "pwned")
    with pytest.raises((file_service.PathEscapeError, file_service.PathValidationError)):
        file_service.extract_archive("55", "trav.zip")

    # 3. ZIP bomb exceeding max_archive_extract_bytes
    monkeypatch.setattr(settings, "max_archive_extract_bytes", 1024, raising=False)
    zip_bomb = srv / "bomb.zip"
    with zipfile.ZipFile(zip_bomb, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("big.bin", b"A" * 8192)
    with pytest.raises(ValueError, match="maximum extracted size"):
        file_service.extract_archive("55", "bomb.zip")

    # 4. TAR hardlink + FIFO + traversal + setuid strip
    monkeypatch.setattr(settings, "max_archive_extract_bytes", 10 * 1024 * 1024, raising=False)
    tar_hard = srv / "hard.tar.gz"
    with tarfile.open(tar_hard, "w:gz") as tf:
        ti = tarfile.TarInfo("hard")
        ti.type = tarfile.LNKTYPE
        ti.linkname = "/etc/shadow"
        tf.addfile(ti)
    with pytest.raises(file_service.PathValidationError):
        file_service.extract_archive("55", "hard.tar.gz")

    tar_fifo = srv / "fifo.tar.gz"
    with tarfile.open(tar_fifo, "w:gz") as tf:
        ti = tarfile.TarInfo("pipe")
        ti.type = tarfile.FIFOTYPE
        tf.addfile(ti)
    with pytest.raises(file_service.PathValidationError):
        file_service.extract_archive("55", "fifo.tar.gz")

    tar_suid = srv / "safe.tar.gz"
    with tarfile.open(tar_suid, "w:gz") as tf:
        payload = b"hello"
        ti = tarfile.TarInfo("bin/tool.sh")
        ti.size = len(payload)
        ti.mode = 0o4755
        tf.addfile(ti, io.BytesIO(payload))
    file_service.extract_archive("55", "safe.tar.gz")
    extracted = srv / "bin" / "tool.sh"
    assert extracted.read_bytes() == b"hello"
    # _validate_tar_members masks off setuid/setgid/sticky bits
    with tarfile.open(tar_suid, "r:gz") as tf:
        members = tf.getmembers()
        file_service._validate_tar_members(srv, members)
        assert (members[0].mode & 0o7000) == 0


def test_quota_service_applies_resizes_removes_and_fails_closed_when_required(
    servers_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, **_kwargs):  # noqa: ANN001
        calls.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0, stdout='{"ok": true}\n', stderr="")

    posix_os = SimpleNamespace(**{**os.__dict__, "name": "posix", "geteuid": lambda: 1000})
    monkeypatch.setattr("services.quota_service.os", posix_os)
    orig_is_file = Path.is_file
    monkeypatch.setattr(
        "services.quota_service.Path.is_file",
        lambda self: self.as_posix() == quota_service._QUOTA_WRAPPER or orig_is_file(self),
    )
    monkeypatch.setattr("services.quota_service._supports_prjquota", lambda _p: False)
    monkeypatch.setattr("services.quota_service.subprocess.run", fake_run)
    monkeypatch.setattr(settings, "quota_driver", "auto", raising=False)

    res = quota_service.apply_quota(12, 10)
    assert res["enforced"] is True
    assert res["driver"] == "loopback"
    assert res["limit_mb"] == 10240
    assert any("apply-loopback" in c or "apply_loopback" in c for c in calls)
    assert any("12" in c and "10240" in c for c in calls)

    res_remove = quota_service.remove_quota(12)
    assert res_remove["ok"] is True
    assert any("remove" in c and "12" in c for c in calls)

    # When helper is missing and MSM_REQUIRE_DISK_QUOTA=true -> must fail closed!
    monkeypatch.setattr("services.quota_service.Path.is_file", lambda _self: False)
    monkeypatch.setattr(settings, "require_disk_quota", True, raising=False)
    with pytest.raises(quota_service.DiskQuotaError):
        quota_service.apply_quota(13, 5)
