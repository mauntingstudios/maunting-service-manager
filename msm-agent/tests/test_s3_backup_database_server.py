"""Backups von Datenbankservern: kein Datenverzeichnis im Archiv, keins verloren."""

from __future__ import annotations

import base64
import io
from pathlib import Path
from unittest.mock import patch

import pytest

from services import s3_backup_service

S3 = {"access_key": "a", "secret_key": "b", "bucket": "c"}
KEY = base64.b64encode(b"k" * 32).decode()
POSTGRES = {
    "admin_password": "x",
    "database_names": ["app"],
    "owners": {},
    "target": {"host": "127.0.0.1", "port": 25432, "container": "msm-srv-7"},
}


class _FakeS3:
    def __init__(self) -> None:
        self.objekte: dict[str, bytes] = {}

    def upload_fileobj(self, reader, bucket, key, Config=None):  # noqa: N803
        self.objekte[key] = reader.read()

    def download_file(self, bucket, key, path):
        Path(path).write_bytes(self.objekte[key])


@pytest.fixture
def server(servers_dir: Path) -> Path:
    root = servers_dir / "7"
    (root / "pgdata").mkdir(parents=True)
    (root / "pgdata" / "PG_VERSION").write_text("17\n")
    (root / "conf").mkdir()
    (root / "conf" / "pg_hba.conf").write_text("alt\n")
    return root


def _backup(fake: _FakeS3) -> None:
    with patch.object(s3_backup_service, "_s3_client", return_value=fake), \
         patch("services.postgres_service.dump_databases", return_value={"app": "-- dump app"}):
        s3_backup_service.create_encrypted_s3_backup(
            7, s3=S3, encryption_key_b64=KEY, s3_object_key="b.enc", postgres=POSTGRES
        )


def _archivnamen(fake: _FakeS3) -> list[str]:
    import tarfile

    from services.stream_crypto import decrypt_stream_to_file

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "b.tar.gz"
        decrypt_stream_to_file(io.BytesIO(fake.objekte["b.enc"]), base64.b64decode(KEY), str(tar_path))
        with tarfile.open(tar_path) as tar:
            return tar.getnames()


def test_datenverzeichnis_kommt_nicht_ins_archiv(server: Path):
    fake = _FakeS3()
    _backup(fake)
    namen = _archivnamen(fake)
    assert not any(Path(n).parts[:1] == ("pgdata",) for n in namen)
    assert "./conf/pg_hba.conf" in namen
    assert ".msm/postgres/app.sql" in namen


def test_restore_behaelt_das_vorhandene_datenverzeichnis(server: Path):
    fake = _FakeS3()
    _backup(fake)
    (server / "pgdata" / "PG_VERSION").write_text("aktueller-stand\n")
    (server / "conf" / "pg_hba.conf").write_text("neu\n")

    with patch.object(s3_backup_service, "_s3_client", return_value=fake), \
         patch("services.postgres_service.restore_sql") as restore_sql:
        s3_backup_service.restore_encrypted_s3_backup(
            7, s3=S3, encryption_key_b64=KEY, s3_object_key="b.enc", postgres=POSTGRES
        )

    assert (server / "pgdata" / "PG_VERSION").read_text() == "aktueller-stand\n"
    assert (server / "conf" / "pg_hba.conf").read_text() == "alt\n"
    # Instanz ist gestoppt: der Dump bleibt fuers Studio liegen.
    restore_sql.assert_not_called()
    assert (server / ".msm" / "postgres" / "app.sql").read_text() == "-- dump app"


def test_scheiternder_restore_gibt_das_datenverzeichnis_zurueck(server: Path):
    fake = _FakeS3()
    _backup(fake)
    (server / "pgdata" / "PG_VERSION").write_text("aktueller-stand\n")

    with patch.object(s3_backup_service, "_s3_client", return_value=fake), \
         patch("tarfile.TarFile.extractall", side_effect=OSError("Platte voll")):
        with pytest.raises(s3_backup_service.AgentBackupError):
            s3_backup_service.restore_encrypted_s3_backup(
                7, s3=S3, encryption_key_b64=KEY, s3_object_key="b.enc", postgres=POSTGRES
            )

    assert (server / "pgdata" / "PG_VERSION").read_text() == "aktueller-stand\n"


def test_restore_skips_crafted_pgdata_entries_and_validates_before_stopping_container(server: Path):
    import tarfile as _tf
    import tempfile as _tmp
    from services.stream_crypto import encrypt_file_frames

    buf = io.BytesIO()
    with _tf.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in [("pgdata/PG_VERSION", b"pwned"), ("conf/pg_hba.conf", b"restored")]:
            info = _tf.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            tar.addfile(info, io.BytesIO(data))

    with _tmp.NamedTemporaryFile(delete=False) as tf:
        tf.write(buf.getvalue())
        p = tf.name
    try:
        enc = b"".join(encrypt_file_frames(p, base64.b64decode(KEY)))
    finally:
        Path(p).unlink(missing_ok=True)

    fake = _FakeS3()
    fake.objekte["crafted.enc"] = enc
    fake.objekte["bad.enc"] = b"not-valid-ciphertext"
    (server / "pgdata" / "PG_VERSION").write_text("live-db-intact\n")

    with patch.object(s3_backup_service, "_s3_client", return_value=fake), \
         patch("services.docker_service.stop_container") as stop_mock, \
         patch("services.docker_service.remove_container") as rm_mock:
        with pytest.raises(s3_backup_service.AgentBackupError):
            s3_backup_service.restore_encrypted_s3_backup(
                7,
                s3=S3,
                encryption_key_b64=KEY,
                s3_object_key="bad.enc",
                postgres=POSTGRES,
                container_name="msm-srv-7",
            )
        stop_mock.assert_not_called()
        rm_mock.assert_not_called()

        s3_backup_service.restore_encrypted_s3_backup(
            7,
            s3=S3,
            encryption_key_b64=KEY,
            s3_object_key="crafted.enc",
            postgres=POSTGRES,
            container_name="msm-srv-7",
        )
        stop_mock.assert_called_once_with("msm-srv-7", timeout=30)
        rm_mock.assert_called_once_with("msm-srv-7")

    assert (server / "pgdata" / "PG_VERSION").read_text() == "live-db-intact\n"
    assert (server / "conf" / "pg_hba.conf").read_text() == "restored"
