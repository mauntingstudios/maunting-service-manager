"""Negative and ACL-preservation tests for msm-agent backup & restore paths."""

from __future__ import annotations

import base64
import io
import struct
import tarfile
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services import file_service, s3_backup_service
from services.file_service import PathEscapeError, PathValidationError
from services.s3_backup_service import AgentBackupError
from services.stream_crypto import STREAM_CHUNK, STREAM_MAGIC_V2, encrypt_file_frames


S3_CFG = {"access_key": "ak", "secret_key": "sk", "bucket": "test-bucket"}
KEY_A = b"A" * 32
KEY_A_B64 = base64.b64encode(KEY_A).decode()
KEY_B_B64 = base64.b64encode(b"B" * 32).decode()


class _MemS3:
    def __init__(self, initial: bytes | None = None) -> None:
        self.objects: dict[str, bytes] = {}
        if initial is not None:
            self.objects["srv/bak.enc"] = initial

    def upload_fileobj(self, reader, bucket, key, Config=None):  # noqa: N803
        self.objects[key] = reader.read()

    def download_file(self, bucket, key, path):
        if key not in self.objects:
            raise RuntimeError("NoSuchKey")
        Path(path).write_bytes(self.objects[key])


def _make_targz_bytes(entries: list[tuple[str, bytes, str]]) -> bytes:
    """Build an in-memory tar.gz with custom member types ('file', 'symlink', 'dir')."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data, kind in entries:
            info = tarfile.TarInfo(name=name)
            if kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = "/etc/passwd"
            elif kind == "dir":
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
            else:
                info.size = len(data)
                info.mode = 0o644
            tar.addfile(info, io.BytesIO(data) if kind == "file" else None)
    return buf.getvalue()


def _encrypt_stream(raw: bytes, key: bytes) -> bytes:
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        tf.write(raw)
        path = tf.name
    try:
        return b"".join(encrypt_file_frames(path, key))
    finally:
        Path(path).unlink(missing_ok=True)


def _seed_live_server(servers_dir: Path, key: str = "srv_test_1") -> Path:
    root = servers_dir / key
    root.mkdir(parents=True, exist_ok=True)
    (root / "live.txt").write_text("do-not-lose-me", encoding="utf-8")
    (root / "sub").mkdir(exist_ok=True)
    (root / "sub" / "cfg.ini").write_text("mode=prod", encoding="utf-8")
    return root


class TestAgentS3RestoreNegative:
    def test_wrong_key_rejects_with_400_and_preserves_live_files(self, servers_dir: Path):
        root = _seed_live_server(servers_dir, "srv_wrong_key")
        tar_bytes = _make_targz_bytes([("./live.txt", b"restored", "file")])
        enc = _encrypt_stream(tar_bytes, KEY_A)
        s3 = _MemS3(enc)

        with patch.object(s3_backup_service, "_s3_client", return_value=s3):
            with pytest.raises(AgentBackupError) as exc_info:
                s3_backup_service.restore_encrypted_s3_backup(
                    "srv_wrong_key",
                    s3=S3_CFG,
                    encryption_key_b64=KEY_B_B64,
                    s3_object_key="srv/bak.enc",
                )

        assert exc_info.value.status_code == 400
        assert "decryption" in exc_info.value.message.lower()
        assert (root / "live.txt").read_text(encoding="utf-8") == "do-not-lose-me"

    def test_tampered_ciphertext_rejects_with_400_and_rolls_back(self, servers_dir: Path):
        root = _seed_live_server(servers_dir, "srv_tamper")
        # Multi-frame payload so frame 0 decrypts and frame 1 fails mid-stream!
        big = _make_targz_bytes([("./big.bin", b"X" * (STREAM_CHUNK + 4096), "file")])
        enc = bytearray(_encrypt_stream(big, KEY_A))
        # Corrupt near the end (frame 1 ciphertext/tag).
        enc[-5] ^= 0x55
        s3 = _MemS3(bytes(enc))

        with patch.object(s3_backup_service, "_s3_client", return_value=s3):
            with pytest.raises(AgentBackupError) as exc_info:
                s3_backup_service.restore_encrypted_s3_backup(
                    "srv_tamper",
                    s3=S3_CFG,
                    encryption_key_b64=KEY_A_B64,
                    s3_object_key="srv/bak.enc",
                )

        assert exc_info.value.status_code == 400
        assert (root / "live.txt").read_text(encoding="utf-8") == "do-not-lose-me"

    def test_truncated_before_final_frame_rejects_with_400(self, servers_dir: Path):
        root = _seed_live_server(servers_dir, "srv_trunc")
        big = _make_targz_bytes([("./big.bin", b"Y" * (STREAM_CHUNK + 1024), "file")])
        enc = _encrypt_stream(big, KEY_A)
        # Drop the final frame completely on a valid frame boundary.
        f0_len = struct.unpack(">I", enc[len(STREAM_MAGIC_V2) : len(STREAM_MAGIC_V2) + 4])[0]
        without_final = enc[: len(STREAM_MAGIC_V2) + 4 + f0_len]
        s3 = _MemS3(without_final)

        with patch.object(s3_backup_service, "_s3_client", return_value=s3):
            with pytest.raises(AgentBackupError) as exc_info:
                s3_backup_service.restore_encrypted_s3_backup(
                    "srv_trunc",
                    s3=S3_CFG,
                    encryption_key_b64=KEY_A_B64,
                    s3_object_key="srv/bak.enc",
                )

        assert exc_info.value.status_code == 400
        assert (root / "live.txt").read_text(encoding="utf-8") == "do-not-lose-me"

    @pytest.mark.parametrize(
        "bad_entries",
        [
            [("../escape.txt", b"pwned", "file")],
            [("/etc/cron.d/evil", b"pwned", "file")],
            [("./evil_link", b"", "symlink")],
        ],
    )
    def test_unsafe_tar_member_rejects_with_400_and_rolls_back(
        self, servers_dir: Path, bad_entries: list[tuple[str, bytes, str]]
    ):
        root = _seed_live_server(servers_dir, "srv_unsafe_tar")
        tar_bytes = _make_targz_bytes(bad_entries)
        s3 = _MemS3(_encrypt_stream(tar_bytes, KEY_A))

        with patch.object(s3_backup_service, "_s3_client", return_value=s3):
            with pytest.raises(AgentBackupError) as exc_info:
                s3_backup_service.restore_encrypted_s3_backup(
                    "srv_unsafe_tar",
                    s3=S3_CFG,
                    encryption_key_b64=KEY_A_B64,
                    s3_object_key="srv/bak.enc",
                )

        assert exc_info.value.status_code == 400
        assert (root / "live.txt").read_text(encoding="utf-8") == "do-not-lose-me"
        assert (root / "sub" / "cfg.ini").read_text(encoding="utf-8") == "mode=prod"

    def test_missing_s3_object_returns_502_and_preserves_live_files(self, servers_dir: Path):
        root = _seed_live_server(servers_dir, "srv_missing_s3")
        s3 = _MemS3(None)

        with patch.object(s3_backup_service, "_s3_client", return_value=s3):
            with pytest.raises(AgentBackupError) as exc_info:
                s3_backup_service.restore_encrypted_s3_backup(
                    "srv_missing_s3",
                    s3=S3_CFG,
                    encryption_key_b64=KEY_A_B64,
                    s3_object_key="srv/nonexistent.enc",
                )

        assert exc_info.value.status_code == 502
        assert (root / "live.txt").read_text(encoding="utf-8") == "do-not-lose-me"


class TestAgentArchiveRestoreSecurityAndAcl:
    def test_restore_backup_archive_rejects_traversal_and_rolls_back(self, servers_dir: Path):
        root = _seed_live_server(servers_dir, "srv_arch_trav")
        bad_tar = _make_targz_bytes([("../../outside.txt", b"bad", "file")])

        with pytest.raises((PathEscapeError, PathValidationError, ValueError, tarfile.TarError)):
            file_service.restore_backup_archive("srv_arch_trav", io.BytesIO(bad_tar))

        assert (root / "live.txt").read_text(encoding="utf-8") == "do-not-lose-me"
        assert not (servers_dir / "outside.txt").exists()

    def test_restore_backup_archive_rejects_symlink_and_rolls_back(self, servers_dir: Path):
        root = _seed_live_server(servers_dir, "srv_arch_sym")
        bad_tar = _make_targz_bytes([("evil_link", b"", "symlink")])

        with pytest.raises((PathValidationError, ValueError)):
            file_service.restore_backup_archive("srv_arch_sym", io.BytesIO(bad_tar))

        assert (root / "live.txt").read_text(encoding="utf-8") == "do-not-lose-me"

    def test_restore_backup_archive_calls_acl_helper_on_success(self, servers_dir: Path):
        root = _seed_live_server(servers_dir, "srv_arch_ok")
        good_tar = _make_targz_bytes([("restored.txt", b"fresh-state", "file")])

        with patch.object(file_service, "apply_shared_server_acl") as acl_mock:
            file_service.restore_backup_archive("srv_arch_ok", io.BytesIO(good_tar))

        acl_mock.assert_called_once_with(root.resolve())
        assert (root / "restored.txt").read_text(encoding="utf-8") == "fresh-state"
        assert not (root / "live.txt").exists()

    def test_apply_shared_server_acl_skips_postgres_data(self, tmp_path: Path):
        root = tmp_path / "pg_srv"
        (root / ".msm" / "postgres-data").mkdir(parents=True)
        (root / ".msm" / "postgres" ).mkdir(parents=True)
        (root / "conf").mkdir(parents=True)

        fake_pwd = SimpleNamespace(
            getpwnam=lambda _n: SimpleNamespace(pw_name="msm-docker"),
            getpwuid=lambda _u: SimpleNamespace(pw_name="msm-agent"),
        )
        fake_grp = SimpleNamespace(getgrnam=lambda _n: SimpleNamespace(gr_gid=999))
        calls: list[list[str]] = []
        with patch.object(file_service, "pwd", fake_pwd), \
             patch.object(file_service, "grp", fake_grp), \
             patch.object(file_service.os, "getuid", return_value=1000, create=True), \
             patch.object(file_service.os, "chown", create=True), \
             patch.object(file_service.shutil, "which", return_value="/usr/bin/setfacl"), \
             patch.object(file_service.subprocess, "run", side_effect=lambda cmd, **kw: calls.append(cmd) or MagicMock()):
            file_service.apply_shared_server_acl(root)

        flat_targets = [c[-1] for c in calls]
        assert str(root) in flat_targets
        assert str(root / "conf") in flat_targets
        assert str(root / ".msm" / "postgres") in flat_targets
        assert all("postgres-data" not in t for t in flat_targets)


def test_map_container_uid_gid_to_host_reads_subuid_and_subgid(tmp_path: Path, monkeypatch) -> None:
    subuid = tmp_path / "subuid"
    subgid = tmp_path / "subgid"
    subuid.write_text("msm-docker:427680:65536\n", encoding="utf-8")
    subgid.write_text("msm-docker:427680:65536\n", encoding="utf-8")

    fake_pwd = SimpleNamespace(
        getpwnam=lambda name: SimpleNamespace(pw_name=name, pw_uid=989, pw_gid=983)
    )
    monkeypatch.setattr(file_service, "pwd", fake_pwd)

    assert file_service.map_container_uid_gid_to_host(
        1000,
        1000,
        subuid_path=subuid,
        subgid_path=subgid,
    ) == (428679, 428679)
    assert file_service.map_container_uid_gid_to_host(
        0,
        0,
        subuid_path=subuid,
        subgid_path=subgid,
    ) == (989, 983)


def test_apply_shared_server_acl_clears_setgid_and_adds_mapped_uid_gid(
    tmp_path: Path, monkeypatch
) -> None:
    root = tmp_path / "138"
    sub = root / "java"
    sub.mkdir(parents=True)
    pg_dir = root / ".msm" / "postgres-data"
    pg_dir.mkdir(parents=True)

    chmod_calls: list[tuple[Path, int]] = []
    monkeypatch.setattr(
        file_service.os,
        "chmod",
        lambda p, mode, **kw: chmod_calls.append((Path(p), mode)),
        raising=False,
    )
    orig_lstat = file_service.os.lstat

    def _fake_lstat(p):
        st = orig_lstat(p)
        if Path(p) == sub:
            return SimpleNamespace(st_mode=st.st_mode | 0o2000, st_uid=1000)
        return st

    monkeypatch.setattr(file_service.os, "lstat", _fake_lstat)
    monkeypatch.setattr(file_service.os, "getuid", lambda: 1000, raising=False)
    monkeypatch.setattr(file_service.stat_module, "S_ISGID", 0o2000, raising=False)
    monkeypatch.setattr(
        file_service,
        "pwd",
        SimpleNamespace(
            getpwnam=lambda name: SimpleNamespace(pw_name="msm-docker", pw_uid=989, pw_gid=983),
            getpwuid=lambda uid: SimpleNamespace(pw_name="msm-agent"),
        ),
    )
    monkeypatch.setattr(file_service, "grp", None)
    monkeypatch.setattr(file_service.shutil, "which", lambda cmd: "/usr/bin/setfacl")
    monkeypatch.setattr(
        file_service,
        "map_container_uid_gid_to_host",
        lambda cuid, cgid, **kw: (428679, 428679) if (cuid, cgid) == (1000, 1000) else None,
    )

    setfacl_cmds: list[list[str]] = []
    monkeypatch.setattr(
        file_service.subprocess,
        "run",
        lambda cmd, **kw: setfacl_cmds.append(cmd) or SimpleNamespace(returncode=0),
    )

    file_service.apply_shared_server_acl(root)

    # Setgid must NOT be set on root and S_ISGID must be stripped on owned subdirs
    assert (root, 0o0770) in chmod_calls
    assert all(mode & 0o2000 == 0 for _, mode in chmod_calls)
    sub_chmod = [mode for p, mode in chmod_calls if p == sub]
    assert sub_chmod and (sub_chmod[0] & 0o2000 == 0)
    assert all(p != pg_dir for p, _ in chmod_calls)
    assert setfacl_cmds
    acl_specs = [cmd[cmd.index("-m") + 1] for cmd in setfacl_cmds if "-m" in cmd]
    assert acl_specs
    assert all("u:428679:rwX" in spec for spec in acl_specs)
    assert all("g:428679:rwX" in spec for spec in acl_specs)
    assert all("d:u:428679:rwX" in spec for spec in acl_specs)
    assert all("d:g:428679:rwX" in spec for spec in acl_specs)
    assert all("m::rwx" in spec for spec in acl_specs)
    # postgres-data still skipped
    assert all("postgres-data" not in arg for cmd in setfacl_cmds for arg in cmd)

