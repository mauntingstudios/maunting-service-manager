"""Phase 6: agent-direct S3 backup orchestration (mocked agent + DIS)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.backup_orchestrator import (
    _create_remote_agent_s3_backup,
    restore_via_agent_s3,
)
from services.node_client import NodeClientError


def test_remote_agent_s3_backup_success(db):
    from models import Node, Server

    node = Node(
        name="R",
        host="https://10.0.0.9:9000",
        auth_token_enc="enc",
        tls_fingerprint="a" * 64,
        is_local=False,
        status="online",
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    server = Server(
        name="s",
        game_type="test",
        install_dir="/tmp/x",
        node_id=node.id,
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    with patch("services.node_service.ensure_node_online"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_password", return_value="pw"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_salt", return_value="c2FsdA=="), \
         patch("services.backup_crypto_service.BackupCryptoService.derive_raw_key_b64", return_value="dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGt5dA=="), \
         patch("services.s3_service.S3Service.get_ephemeral_agent_s3_config", return_value={
             "endpoint": "http://minio:9000",
             "access_key": "ak",
             "secret_key": "sk",
             "bucket": "msm",
             "region": "",
         }), \
         patch("services.node_client.NodeClient.from_node") as fn:
        client = MagicMock()
        client.backup_create_s3.return_value = {
            "ok": True,
            "s3_key": "msm-backups/servers/1/x.enc",
            "size_bytes": 5 * 1024 * 1024,
            "sha256": "abc",
        }
        fn.return_value = client
        backup = _create_remote_agent_s3_backup(server.id, db, node, name="n1")

    assert backup.s3_key
    assert backup.encrypted is True
    assert backup.size_mb == 5
    client.backup_create_s3.assert_called_once()
    call_kw = client.backup_create_s3.call_args.kwargs
    assert call_kw["server_key"] == "x"
    assert "encryption_key_b64" in call_kw
    assert call_kw["s3_config"]["access_key"] == "ak"


def test_remote_agent_s3_backup_failure_deletes_record(db):
    from models import Backup, Node, Server

    node = Node(
        name="R2",
        host="https://10.0.0.8:9000",
        auth_token_enc="enc",
        tls_fingerprint="b" * 64,
        is_local=False,
        status="online",
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    server = Server(
        name="s2",
        game_type="test",
        install_dir="/tmp/y",
        node_id=node.id,
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    with patch("services.node_service.ensure_node_online"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_password", return_value="pw"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_salt", return_value="c2FsdA=="), \
         patch("services.backup_crypto_service.BackupCryptoService.derive_raw_key_b64", return_value="dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGt5dA=="), \
         patch("services.s3_service.S3Service.get_ephemeral_agent_s3_config", return_value={
             "endpoint": "",
             "access_key": "ak",
             "secret_key": "sk",
             "bucket": "b",
             "region": "",
         }), \
         patch("services.node_client.NodeClient.from_node") as fn:
        client = MagicMock()
        client.backup_create_s3.side_effect = NodeClientError("down")
        fn.return_value = client
        with pytest.raises(RuntimeError, match="Remote-Backup"):
            _create_remote_agent_s3_backup(server.id, db, node)

    assert db.query(Backup).filter(Backup.server_id == server.id).count() == 0


def test_restore_via_agent_s3_calls_client():
    server = SimpleNamespace(id=7, node=SimpleNamespace(is_local=False, status="online", id=1))
    backup = SimpleNamespace(s3_key="k/path.enc", s3_bucket="bucket")

    with patch("services.node_service.resolve_server_node", return_value=server.node), \
         patch("services.node_service.ensure_node_online"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_password", return_value="pw"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_salt", return_value="c2FsdA=="), \
         patch("services.backup_crypto_service.BackupCryptoService.derive_raw_key_b64", return_value="dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGt5dA=="), \
         patch("services.s3_service.S3Service.get_ephemeral_agent_s3_config", return_value={
             "endpoint": "",
             "access_key": "ak",
             "secret_key": "sk",
             "bucket": "other",
             "region": "",
         }), \
         patch("services.node_client.NodeClient.from_node") as fn:
        client = MagicMock()
        fn.return_value = client
        restore_via_agent_s3(server, backup)

    client.backup_restore_s3.assert_called_once()
    call_kw = client.backup_restore_s3.call_args.kwargs
    assert call_kw["s3_key"] == "k/path.enc"
    assert call_kw["s3_config"]["bucket"] == "bucket"


def test_create_server_backup_routes_remote_to_agent(db):
    from models import Node, Server
    from services.backup_orchestrator import create_server_backup

    node = Node(
        name="R3",
        host="https://10.0.0.7:9000",
        auth_token_enc="enc",
        tls_fingerprint="c" * 64,
        is_local=False,
        status="online",
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    server = Server(
        name="s3",
        game_type="test",
        install_dir="/tmp/z",
        node_id=node.id,
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    fake = MagicMock()
    fake.id = 99
    
    def fake_reconcile(_db, _server):
        _server.guardian_agent_recovery_suspension_json = _server.guardian_recovery_suspension
        return {
            "payload_hash": "sha256:dummy",
            "recovery_suspension": (
                json.loads(_server.guardian_recovery_suspension)
                if _server.guardian_recovery_suspension
                else None
            ),
        }

    with patch("services.backup_config_service.BackupConfigService.is_backup_password_set", return_value=True), \
         patch("services.backup_config_service.BackupConfigService.is_s3_configured", return_value=True), \
         patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=fake_reconcile), \
         patch("services.backup_orchestrator._create_remote_agent_s3_backup", return_value=fake) as remote:
        out = create_server_backup(server.id, db)
    assert out is fake
    remote.assert_called_once()


def test_local_node_with_local_agent_creates_local_and_s3_backup(db, monkeypatch):
    from config import settings
    from models import Node, Server
    from services.backup_orchestrator import create_server_backup

    monkeypatch.setattr(settings, "local_agent_required", True)
    node = Node(
        name="Local",
        host="https://127.0.0.1:9000",
        auth_token_enc="enc",
        tls_fingerprint="d" * 64,
        is_local=True,
        status="online",
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    server = Server(
        name="local_dual",
        game_type="test",
        install_dir="/tmp/local_dual",
        node_id=node.id,
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    fake = MagicMock()
    fake.id = 101

    def fake_reconcile(_db, _server):
        _server.guardian_agent_recovery_suspension_json = _server.guardian_recovery_suspension
        return {
            "payload_hash": "sha256:dummy",
            "recovery_suspension": (
                json.loads(_server.guardian_recovery_suspension)
                if _server.guardian_recovery_suspension
                else None
            ),
        }

    with patch("services.backup_config_service.BackupConfigService.is_backup_password_set", return_value=True), \
         patch("services.backup_config_service.BackupConfigService.is_s3_configured", return_value=True), \
         patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=fake_reconcile), \
         patch("services.backup_service.run_backup", return_value=fake) as run_local, \
         patch("services.backup_orchestrator._upload_to_s3") as upload_s3, \
         patch("services.backup_orchestrator._create_remote_agent_s3_backup") as remote:
        out = create_server_backup(server.id, db)

    assert out is fake
    remote.assert_not_called()
    run_local.assert_called_once()
    upload_s3.assert_called_once_with(fake, db, server.id)


def test_restore_prefers_local_file_before_s3_fallback(db, tmp_path):
    import tarfile as _tf
    from models import Backup, Node, Server, ServerPermission, User
    from services.actor_context import ActorContext
    from services.backup_restore_service import restore_server_backup

    node = Node(
        name="LocalRestore",
        host="https://127.0.0.1:9000",
        auth_token_enc="enc",
        tls_fingerprint="e" * 64,
        is_local=True,
        status="online",
    )
    db.add(node)
    user = User(username="restorer", email="r@example.invalid", password_hash="x", is_active=True)
    db.add(user)
    db.commit()
    db.refresh(node)
    db.refresh(user)

    server = Server(
        name="r_dual",
        game_type="test",
        install_dir="/opt/msm/servers/r_dual_5",
        node_id=node.id,
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    db.add(ServerPermission(user_id=user.id, server_id=server.id, permission_key="server.backups.restore"))
    db.commit()

    local_tar = tmp_path / "local.tar.gz"
    with _tf.open(local_tar, "w:gz") as tar:
        pass
    backup = Backup(
        server_id=server.id,
        filename=str(local_tar),
        size_mb=1,
        s3_key="msm-backups/servers/5/fallback.enc",
        s3_bucket="msm",
        encrypted=False,
    )
    db.add(backup)
    db.commit()
    db.refresh(backup)

    fake_client = MagicMock()
    from config import settings

    def fake_reconcile(_db, _server):
        _server.guardian_agent_recovery_suspension_json = _server.guardian_recovery_suspension
        return {
            "payload_hash": "sha256:dummy",
            "recovery_suspension": (
                json.loads(_server.guardian_recovery_suspension)
                if _server.guardian_recovery_suspension
                else None
            ),
        }

    with patch.object(settings, "local_agent_required", True), \
         patch("services.node_client.NodeClient.from_node", return_value=fake_client), \
         patch("services.backup_orchestrator.restore_via_agent_s3") as s3_restore, \
         patch("services.docker_service.is_running", return_value=False), \
         patch("services.docker_service.remove"), \
         patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=fake_reconcile):
        restore_server_backup(db, server_id=server.id, backup_id=backup.id, actor=ActorContext.for_user(user))

    s3_restore.assert_not_called()
    fake_client.files_restore_archive.assert_called_once_with("r_dual_5", str(local_tar))
    fake_client.files_finalize_restore.assert_called_once_with("r_dual_5")

    # Missing local file falls back to agent S3 without pre-stopping container
    local_tar.unlink()
    with patch.object(settings, "local_agent_required", True), \
         patch("services.backup_orchestrator.restore_via_agent_s3") as s3_fallback, \
         patch("services.docker_service.stop") as pre_stop, \
         patch("services.audit_service.record_privileged_action") as audit_rec, \
         patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=fake_reconcile):
        restore_server_backup(db, server_id=server.id, backup_id=backup.id, actor=ActorContext.for_user(user))

    pre_stop.assert_not_called()
    s3_fallback.assert_called_once()
    assert s3_fallback.call_args.kwargs.get("stop_container") is True
    audit_rec.assert_called_once()
    assert audit_rec.call_args.kwargs["action"] == "server.backups.restore"


def test_local_node_backup_survives_s3_upload_failure_and_restores_locally(db, tmp_path):
    import io as _io
    import tarfile as _tf
    from config import settings
    from models import Node, Server, ServerPermission, User
    from services.actor_context import ActorContext
    from services.backup_orchestrator import create_server_backup
    from services.backup_restore_service import restore_server_backup
    from services.s3_service import S3OperationError

    node = Node(
        name="LocalDualFailS3",
        host="https://127.0.0.1:9000",
        auth_token_enc="enc",
        tls_fingerprint="f" * 64,
        is_local=True,
        status="online",
    )
    db.add(node)
    user = User(username="dualfail", email="df@example.invalid", password_hash="x", is_active=True)
    db.add(user)
    db.commit()
    db.refresh(node)
    db.refresh(user)

    server = Server(
        name="dual_fail_srv",
        game_type="generic",
        install_dir="/opt/msm/servers/dual_fail_7",
        node_id=node.id,
        status="stopped",
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    db.add(ServerPermission(user_id=user.id, server_id=server.id, permission_key="server.backups.restore"))
    db.commit()

    tar_buf = _io.BytesIO()
    with _tf.open(fileobj=tar_buf, mode="w:gz") as tar:
        data = b"world-state"
        info = _tf.TarInfo("world.dat")
        info.size = len(data)
        tar.addfile(info, _io.BytesIO(data))
    tar_bytes = tar_buf.getvalue()

    fake_client = MagicMock()
    fake_client.files_archive.return_value = iter([tar_bytes])

    def fake_reconcile(_db, _server):
        _server.guardian_agent_recovery_suspension_json = _server.guardian_recovery_suspension
        return {
            "payload_hash": "sha256:dummy",
            "recovery_suspension": (
                json.loads(_server.guardian_recovery_suspension)
                if _server.guardian_recovery_suspension
                else None
            ),
        }

    backups_root = tmp_path / "backups" / str(server.id)
    with patch.object(settings, "local_agent_required", True), \
         patch("services.backup_service._backup_dir_for", return_value=str(backups_root)), \
         patch("services.node_client.NodeClient.from_node", return_value=fake_client), \
         patch("services.backup_config_service.BackupConfigService.is_backup_password_set", return_value=True), \
         patch("services.backup_config_service.BackupConfigService.is_s3_configured", return_value=True), \
         patch("services.backup_config_service.BackupConfigService.get_backup_password", return_value="pw"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_salt", return_value="c2FsdA=="), \
         patch("services.backup_service._encrypt_local_backup", side_effect=RuntimeError("DIS unreachable")), \
         patch("services.s3_service.S3Service.upload_stream", side_effect=S3OperationError("S3 down")), \
         patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=fake_reconcile):
        backup = create_server_backup(server.id, db, name="DualSurvive")

    assert backup.s3_key is None
    assert backup.encrypted is False
    assert backups_root.is_dir() and tmp_path.joinpath("backups", str(server.id), backup.filename.split("/")[-1].split("\\")[-1]).exists()

    # Even with S3 down, local restore works directly via agent without S3 call
    with patch.object(settings, "local_agent_required", True), \
         patch("services.node_client.NodeClient.from_node", return_value=fake_client), \
         patch("services.backup_orchestrator.restore_via_agent_s3") as s3_restore, \
         patch("services.docker_service.is_running", return_value=False), \
         patch("services.docker_service.remove"), \
         patch("services.guardian_sync_service.compile_and_sync_desired_state", side_effect=fake_reconcile):
        restore_server_backup(db, server_id=server.id, backup_id=backup.id, actor=ActorContext.for_user(user))

    s3_restore.assert_not_called()
    fake_client.files_restore_archive.assert_called_once()


def test_remote_agent_s3_backup_enforces_retention_and_survives_cleanup_error(db):
    from models import Node, Server

    node = Node(
        name="RemoteRet",
        host="https://10.0.0.15:9000",
        auth_token_enc="enc",
        tls_fingerprint="1" * 64,
        is_local=False,
        status="online",
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    server = Server(
        name="ret_srv",
        game_type="test",
        install_dir="/tmp/ret_srv",
        node_id=node.id,
        status="stopped",
        backup_retention_count=3,
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    client = MagicMock()
    client.backup_create_s3.return_value = {
        "ok": True,
        "s3_key": "msm-backups/servers/1/ret.enc",
        "size_bytes": 2 * 1024 * 1024,
        "sha256": "deadbeef",
    }

    with patch("services.node_service.ensure_node_online"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_password", return_value="pw"), \
         patch("services.backup_config_service.BackupConfigService.get_backup_salt", return_value="c2FsdA=="), \
         patch("services.backup_crypto_service.BackupCryptoService.derive_raw_key_b64", return_value="dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGt5dA=="), \
         patch("services.s3_service.S3Service.get_ephemeral_agent_s3_config", return_value={
             "endpoint": "http://minio:9000",
             "access_key": "ak",
             "secret_key": "sk",
             "bucket": "msm",
             "region": "",
         }), \
         patch("services.s3_service.S3Service.object_size", return_value=2 * 1024 * 1024), \
         patch("services.node_client.NodeClient.from_node", return_value=client), \
         patch("services.backup_service.cleanup_old_backups", side_effect=RuntimeError("cleanup failed")) as cleanup_mock:
        backup = _create_remote_agent_s3_backup(server.id, db, node, name="ret1")

    assert backup.s3_key == "msm-backups/servers/1/ret.enc"
    cleanup_mock.assert_called_once_with(server.id, db, keep=3)
