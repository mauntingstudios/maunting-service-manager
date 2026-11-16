"""Negative, async background, and multi-worker Redis tests for Server Backups."""

from __future__ import annotations

import io
import json
import os
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Backup, Node, Server, User
from services.backup_config_service import BackupConfigService
from services.node_client import NodeClientError

STREAM_MAGIC_V2 = b"MSMBKP2\n"


def _fake_guardian_sync(_db, _server):
    return {
        "ok": True,
        "recovery_suspension": (
            json.loads(_server.guardian_recovery_suspension)
            if _server.guardian_recovery_suspension
            else None
        ),
    }


def _make_local_server(db: Session, tmp_path: Path, slug: str = "test_srv") -> tuple[Server, Path]:
    install = tmp_path / "servers" / slug
    install.mkdir(parents=True, exist_ok=True)
    (install / "world.dat").write_text("original-world", encoding="utf-8")
    (install / "config.ini").write_text("port=7777", encoding="utf-8")

    node = db.query(Node).filter(Node.is_local.is_(True)).first()
    if node is None:
        node = Node(
            name="Local",
            host="local://",
            auth_token_enc="enc",
            tls_fingerprint="0" * 64,
            is_local=True,
            status="online",
        )
        db.add(node)
        db.commit()
        db.refresh(node)

    srv = Server(
        name=f"Srv-{slug}",
        game_type="generic",
        install_dir=str(install),
        node_id=node.id,
        status="stopped",
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    return srv, install


class TestBackupRestoreNegativePaths:
    def test_remote_s3_decryption_error_returns_400_not_502(
        self, client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        node = Node(
            name="Remote1",
            host="https://10.9.9.1:9000",
            auth_token_enc="enc",
            tls_fingerprint="a" * 64,
            is_local=False,
            status="online",
        )
        db.add(node)
        db.commit()
        db.refresh(node)

        srv = Server(
            name="RemoteSlug",
            game_type="generic",
            install_dir="/opt/msm/servers/custom_slug_99",
            node_id=node.id,
            status="stopped",
        )
        db.add(srv)
        db.commit()
        db.refresh(srv)

        backup = Backup(
            server_id=srv.id,
            filename=str(tmp_path / "missing.tar.gz.enc"),
            size_mb=4,
            s3_key="msm-backups/servers/custom_slug_99/bad.enc",
            s3_bucket="bkt",
            encrypted=True,
        )
        db.add(backup)
        db.commit()
        db.refresh(backup)

        with patch(
            "services.backup_orchestrator.restore_via_agent_s3",
            side_effect=NodeClientError("decryption failed", status_code=400),
        ), patch("services.docker_service.is_running", return_value=False), \
             patch("services.docker_service.remove"), \
             patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=_fake_guardian_sync):
            resp = client.post(
                f"/api/backups/{srv.id}/restore/{backup.id}",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert resp.status_code == 400
        assert "entschlüsselung" in resp.json()["detail"].lower()

    def test_remote_archive_restore_uses_slug_server_key_for_finalize(
        self, client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        """Regression: files_finalize_restore must receive slug key, not raw integer id."""
        node = Node(
            name="Remote2",
            host="https://10.9.9.2:9000",
            auth_token_enc="enc",
            tls_fingerprint="b" * 64,
            is_local=False,
            status="online",
        )
        db.add(node)
        db.commit()
        db.refresh(node)

        srv = Server(
            name="SlugSrv",
            game_type="generic",
            install_dir="/opt/msm/servers/singra_slug_42",
            node_id=node.id,
            status="stopped",
        )
        db.add(srv)
        db.commit()
        db.refresh(srv)

        tar_path = tmp_path / "valid.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            data = b"hello"
            ti = tarfile.TarInfo("hello.txt")
            ti.size = len(data)
            tar.addfile(ti, io.BytesIO(data))

        backup = Backup(
            server_id=srv.id,
            filename=str(tar_path),
            size_mb=1,
            encrypted=False,
        )
        db.add(backup)
        db.commit()
        db.refresh(backup)

        fake_node_client = MagicMock()
        with patch("services.docker_service.is_running", return_value=False), \
             patch("services.docker_service.remove"), \
             patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=_fake_guardian_sync), \
             patch("services.backup_paths.read_pg_dump_from_archive", return_value={}), \
             patch("services.node_client.NodeClient.from_node", return_value=fake_node_client):
            resp = client.post(
                f"/api/backups/{srv.id}/restore/{backup.id}",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert resp.status_code == 200
        fake_node_client.files_restore_archive.assert_called_once_with("singra_slug_42", str(tar_path))
        fake_node_client.files_finalize_restore.assert_called_once_with("singra_slug_42")

    def test_tampered_local_encrypted_backup_returns_400_and_preserves_files(
        self, client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        srv, install = _make_local_server(db, tmp_path, "tamper_local")
        BackupConfigService.set_backup_password("GoodPassword!123")

        # Write fake/tampered .enc file (v2 header + corrupt frame)
        enc_path = tmp_path / "tampered.tar.gz.enc"
        enc_path.write_bytes(STREAM_MAGIC_V2 + b"\x00\x00\x00\x20" + b"\xaa" * 32)

        backup = Backup(
            server_id=srv.id,
            filename=str(enc_path),
            size_mb=1,
            encrypted=True,
        )
        db.add(backup)
        db.commit()
        db.refresh(backup)

        with patch("services.docker_service.is_running", return_value=False), \
             patch("services.docker_service.remove"), \
             patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=_fake_guardian_sync):
            resp = client.post(
                f"/api/backups/{srv.id}/restore/{backup.id}",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
        assert resp.status_code == 400
        assert (install / "world.dat").read_text(encoding="utf-8") == "original-world"

    def test_restore_missing_local_file_without_s3_returns_404(
        self, client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        srv, install = _make_local_server(db, tmp_path, "missing_local")
        backup = Backup(
            server_id=srv.id,
            filename=str(tmp_path / "gone.tar.gz"),
            size_mb=1,
            s3_key=None,
            encrypted=False,
        )
        db.add(backup)
        db.commit()
        db.refresh(backup)

        with patch("services.docker_service.is_running", return_value=False), \
             patch("services.docker_service.remove"), \
             patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=_fake_guardian_sync):
            resp = client.post(
                f"/api/backups/{srv.id}/restore/{backup.id}",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
        assert resp.status_code == 404
        assert (install / "world.dat").read_text(encoding="utf-8") == "original-world"

    def test_restore_conflict_returns_409_when_lifecycle_lock_held(
        self, client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        srv, _install = _make_local_server(db, tmp_path, "locked_srv")
        tar_path = tmp_path / "ok.tar.gz"
        tar_path.write_bytes(b"placeholder")
        backup = Backup(server_id=srv.id, filename=str(tar_path), size_mb=1)
        db.add(backup)
        db.commit()
        db.refresh(backup)

        busy_lock = MagicMock()
        busy_lock.acquire.return_value = False
        with patch("services.server_lifecycle_service.get_server_lifecycle_lock", return_value=busy_lock):
            resp = client.post(
                f"/api/backups/{srv.id}/restore/{backup.id}",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
        assert resp.status_code == 409


class TestBackgroundBackupAndStatus:
    def test_background_backup_returns_202_runs_and_sends_email(
        self, client: TestClient, owner_user: User, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        from services.backup_service import clear_active_backup_status, get_active_backup_status

        srv, _install = _make_local_server(db, tmp_path, "bg_ok")
        clear_active_backup_status(srv.id)

        fake_backup = Backup(
            server_id=srv.id,
            name="NightlyBg",
            filename=str(tmp_path / "b.tar.gz.enc"),
            size_mb=7,
            encrypted=True,
            s3_key="k/b.enc",
        )
        db.add(fake_backup)
        db.commit()
        db.refresh(fake_backup)

        send_mock = AsyncMock(return_value=True)
        with patch("services.backup_orchestrator.create_server_backup", return_value=fake_backup) as run_mock, \
             patch("services.email_service.EmailService.send_backup_completed_notification", send_mock), \
             patch("routers.backups.SessionLocal", return_value=db), \
             patch.object(db, "close"):
            resp = client.post(
                f"/api/backups/{srv.id}",
                json={"name": "NightlyBg", "background": True},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "started"
        assert body["operation"] == "creating"
        run_mock.assert_called_once()
        send_mock.assert_awaited_once()
        assert send_mock.call_args.kwargs["success"] is True
        assert get_active_backup_status(srv.id) is None

    def test_background_backup_conflict_returns_409_when_already_running(
        self, client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        from services.backup_service import clear_active_backup_status, set_active_backup_status

        srv, _install = _make_local_server(db, tmp_path, "bg_conflict")
        set_active_backup_status(srv.id, "creating", 10)
        try:
            resp = client.post(
                f"/api/backups/{srv.id}",
                json={"name": "Second", "background": True},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert resp.status_code == 409
        finally:
            clear_active_backup_status(srv.id)

    def test_background_backup_failure_records_last_error_for_status_poll_and_clears(
        self, client: TestClient, owner_user: User, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
    ):
        from services.backup_service import clear_active_backup_status, get_active_backup_status

        srv, _install = _make_local_server(db, tmp_path, "bg_fail")
        clear_active_backup_status(srv.id)

        send_mock = AsyncMock(return_value=True)
        with patch("services.backup_orchestrator.create_server_backup", side_effect=RuntimeError("disk full")), \
             patch("services.email_service.EmailService.send_backup_completed_notification", send_mock), \
             patch("routers.backups.SessionLocal", return_value=db), \
             patch.object(db, "close"):
            resp = client.post(
                f"/api/backups/{srv.id}",
                json={"name": "WillFail", "background": True},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert resp.status_code == 202
        assert get_active_backup_status(srv.id) is None
        assert send_mock.call_args.kwargs["success"] is False

        st1 = client.get(f"/api/backups/{srv.id}/status", cookies=owner_cookies)
        assert st1.status_code == 200
        assert st1.json()["active"] is False
        assert "fehlgeschlagen" in st1.json()["last_error"].lower()

        # Cleared after being delivered once
        st2 = client.get(f"/api/backups/{srv.id}/status", cookies=owner_cookies)
        assert st2.status_code == 200
        assert "last_error" not in st2.json()

    def test_background_backup_aborts_if_distributed_lock_is_held(self, db: Session, tmp_path: Path):
        from routers.backups import _run_background_backup_job
        from services.backup_service import clear_active_backup_status, get_active_backup_status, set_active_backup_status

        srv, _ = _make_local_server(db, tmp_path, "lock_skip")
        set_active_backup_status(srv.id, "creating", 5)
        try:
            with patch("services.redis_backplane.acquire_distributed_lock", return_value=None), \
                 patch("services.backup_orchestrator.create_server_backup") as create_mock:
                _run_background_backup_job(srv.id, "Dup", 1)
            create_mock.assert_not_called()
            # Must NOT wipe the active status belonging to the live lock holder
            assert get_active_backup_status(srv.id) is not None
        finally:
            clear_active_backup_status(srv.id)

    def test_status_endpoint_is_exempt_from_global_rate_limit(
        self, client: TestClient, owner_cookies: dict, db: Session, tmp_path: Path
    ):
        srv, _install = _make_local_server(db, tmp_path, "poll_no_429")
        with patch("services.rate_limit_settings.dynamic_global_limit_provider", return_value="5/minute"):
            statuses = [
                client.get(f"/api/backups/{srv.id}/status", cookies=owner_cookies).status_code
                for _ in range(12)
            ]
        assert all(s == 200 for s in statuses)
