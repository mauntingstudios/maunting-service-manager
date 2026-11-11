"""Tests für SQLite Studio (backend/services/sqlite_studio_service.py und Router)."""

from __future__ import annotations

import os
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from models import Server, User
from services import sqlite_studio_service


@pytest.fixture
def temp_server_dir():
    """Erzeugt ein temporäres Server-Verzeichnis mit einer echten SQLite-Datenbank."""
    with tempfile.TemporaryDirectory() as tmpdir:
        server_dir = Path(tmpdir)
        db_path = server_dir / "test.db"
        
        # Erstelle echte SQLite-Datenbank
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT, score REAL)")
        cur.execute("INSERT INTO users (username, role, score) VALUES ('admin', 'superuser', 99.5)")
        cur.execute("INSERT INTO users (username, role, score) VALUES ('player1', 'user', 42.0)")
        cur.execute("INSERT INTO users (username, role, score) VALUES ('guest', NULL, 0.0)")
        
        cur.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        cur.execute("INSERT INTO settings (key, value) VALUES ('server_name', 'TestServer')")
        
        conn.commit()
        conn.close()

        # Erstelle auch eine Nicht-SQLite .db-Datei (z. B. Dummy-Binärdatei)
        fake_db = server_dir / "fake.db"
        fake_db.write_bytes(b"NOT_SQLITE_BINARY_DATA_1234567890")

        # Erstelle eine Textdatei
        text_file = server_dir / "config.txt"
        text_file.write_text("hello=world\n", encoding="utf-8")

        yield server_dir, db_path, fake_db, text_file


@pytest.fixture
def mock_server(temp_server_dir):
    server_dir, db_path, fake_db, text_file = temp_server_dir
    server = Server(
        id=42,
        name="test-server",
        game_type="testgame",
        status="running",
        install_dir=str(server_dir),
    )
    return server, server_dir, db_path, fake_db, text_file


def test_is_sqlite_file(temp_server_dir):
    _, db_path, fake_db, text_file = temp_server_dir
    assert sqlite_studio_service.is_sqlite_file(db_path) is True
    assert sqlite_studio_service.is_sqlite_file(fake_db) is False
    assert sqlite_studio_service.is_sqlite_file(text_file) is False
    assert sqlite_studio_service.is_sqlite_file(Path("/non/existent/file.db")) is False


def test_inspect_file(mock_server):
    server, _, db_path, fake_db, text_file = mock_server
    
    # Echte SQLite-Datenbank
    res_real = sqlite_studio_service.inspect_file(server, "test.db")
    assert res_real["is_sqlite"] is True
    assert res_real["table_count"] == 2
    assert res_real["size"] > 0
    assert "wal_mode" in res_real

    # Fake .db
    res_fake = sqlite_studio_service.inspect_file(server, "fake.db")
    assert res_fake["is_sqlite"] is False
    assert res_fake["table_count"] == 0

    # Nicht existierende Datei wirft 404
    with pytest.raises(HTTPException) as exc_info:
        sqlite_studio_service.inspect_file(server, "missing.db")
    assert exc_info.value.status_code == 404


def test_get_overview(mock_server):
    server, _, _, _, _ = mock_server
    overview = sqlite_studio_service.get_overview(server, "test.db", can_write=True)
    assert overview["server"]["database"] == "test.db"
    assert overview["permissions"]["read"] is True
    assert overview["permissions"]["write"] is True
    assert len(overview["relations"]) == 2
    
    table_names = [r["name"] for r in overview["relations"]]
    assert "users" in table_names
    assert "settings" in table_names


def test_get_table_details(mock_server):
    server, _, _, _, _ = mock_server
    details = sqlite_studio_service.get_table_details(server, "test.db", "users")
    assert details["table"] == "users"
    assert "id" in details["primary_key"]
    
    col_names = [c["name"] for c in details["columns"]]
    assert col_names == ["id", "username", "role", "score"]
    
    id_col = next(c for c in details["columns"] if c["name"] == "id")
    assert id_col["is_primary_key"] is True


def test_get_rows_pagination_and_sorting(mock_server):
    server, _, _, _, _ = mock_server
    
    # 1. Alle Zeilen abfragen
    res = sqlite_studio_service.get_rows(server, "test.db", "users", limit=50, offset=0)
    assert res["total"] == 3
    assert len(res["rows"]) == 3
    assert res["columns"] == ["id", "username", "role", "score"]
    
    # 2. Pagination (limit=1, offset=1)
    res_page = sqlite_studio_service.get_rows(server, "test.db", "users", limit=1, offset=1)
    assert res_page["total"] == 3
    assert len(res_page["rows"]) == 1
    assert res_page["rows"][0][1] == "player1"

    # 3. Sortierung DESC nach username
    res_sort = sqlite_studio_service.get_rows(
        server, "test.db", "users", limit=10, offset=0, sort=[{"column": "username", "descending": True}]
    )
    usernames = [r[1] for r in res_sort["rows"]]
    assert usernames == ["player1", "guest", "admin"]


def test_get_rows_filtering(mock_server):
    server, _, _, _, _ = mock_server
    
    # Filter: role is NULL
    res_null = sqlite_studio_service.get_rows(
        server, "test.db", "users", filters=[{"column": "role", "operator": "is_null"}]
    )
    assert res_null["total"] == 1
    assert res_null["rows"][0][1] == "guest"

    # Filter: score > 50
    res_gt = sqlite_studio_service.get_rows(
        server, "test.db", "users", filters=[{"column": "score", "operator": "gt", "value": 50}]
    )
    assert res_gt["total"] == 1
    assert res_gt["rows"][0][1] == "admin"

    # Filter: username contains 'play'
    res_like = sqlite_studio_service.get_rows(
        server, "test.db", "users", filters=[{"column": "username", "operator": "contains", "value": "play"}]
    )
    assert res_like["total"] == 1
    assert res_like["rows"][0][1] == "player1"


def test_update_row_and_audit(mock_server):
    server, _, _, _, _ = mock_server
    mock_db = MagicMock()
    
    # Aktualisiere admin-Score
    update_res = sqlite_studio_service.update_row(
        server,
        "test.db",
        table="users",
        key_values={"id": 1},
        changes={"score": 100.0, "role": "founder"},
        user_id=7,
        db=mock_db,
    )
    assert update_res["affected"] == 1

    # Verifiziere das Update in DB
    rows = sqlite_studio_service.get_rows(server, "test.db", "users", filters=[{"column": "id", "operator": "eq", "value": 1}])
    assert rows["rows"][0][3] == 100.0
    assert rows["rows"][0][2] == "founder"


def test_insert_and_delete_row(mock_server):
    server, _, _, _, _ = mock_server
    mock_db = MagicMock()
    
    # Zeile einfügen
    ins_res = sqlite_studio_service.insert_row(
        server,
        "test.db",
        table="users",
        values={"username": "newuser", "role": "tester", "score": 10.0},
        user_id=7,
        db=mock_db,
    )
    assert ins_res["last_id"] == 4

    # Zeilen prüfen
    all_rows = sqlite_studio_service.get_rows(server, "test.db", "users")
    assert all_rows["total"] == 4

    # Zeile löschen
    del_res = sqlite_studio_service.delete_rows(
        server,
        "test.db",
        table="users",
        keys=[{"id": 4}],
        user_id=7,
        db=mock_db,
    )
    assert del_res["affected"] == 1

    after_del = sqlite_studio_service.get_rows(server, "test.db", "users")
    assert after_del["total"] == 3


def test_execute_sql(mock_server):
    server, _, _, _, _ = mock_server
    mock_db = MagicMock()
    
    # 1. Read-Only SELECT
    select_res = sqlite_studio_service.execute_sql(
        server, "test.db", "SELECT username, score FROM users ORDER BY id ASC", read_only=True
    )
    assert len(select_res["results"]) == 1
    assert select_res["results"][0]["columns"] == ["username", "score"]
    assert len(select_res["results"][0]["rows"]) == 3
    assert select_res["results"][0]["rows"][0][0] == "admin"

    # 2. Schreibversuch im Read-Only-Modus wirft Fehler
    with pytest.raises(HTTPException) as exc_info:
        sqlite_studio_service.execute_sql(
            server, "test.db", "UPDATE users SET score = 999", read_only=True
        )
    assert "attempt to write a readonly database" in exc_info.value.detail

    # 3. Schreiben mit read_only=False
    write_res = sqlite_studio_service.execute_sql(
        server, "test.db", "UPDATE users SET score = 88.0 WHERE id = 1", read_only=False, user_id=7, db=mock_db
    )
    assert write_res["results"][0]["row_count"] == 1


def test_discover_databases(mock_server):
    server, _, _, _, _ = mock_server
    discovered = sqlite_studio_service.discover_databases(server)
    paths = [d["path"] for d in discovered]
    assert "test.db" in paths
    assert "fake.db" not in paths
    assert "config.txt" not in paths


def test_path_traversal_protection(mock_server):
    server, _, _, _, _ = mock_server
    with pytest.raises(HTTPException) as exc_info:
        sqlite_studio_service.inspect_file(server, "../secret.db")
    assert exc_info.value.status_code == 400


def test_router_overview_audit_action():
    """Stellt sicher, dass der Router eine in audit_service.READ_ACCESS_ACTIONS erlaubte Aktion nutzt."""
    from unittest.mock import patch
    from routers.sqlite_studio import get_database_overview
    from services.audit_service import READ_ACCESS_ACTIONS

    assert "server.files.read" in READ_ACCESS_ACTIONS

    mock_user = MagicMock()
    mock_user.id = 42
    mock_db = MagicMock()
    mock_server_obj = MagicMock()

    with patch("routers.sqlite_studio.require_server_permission"), \
         patch("routers.sqlite_studio._server", return_value=mock_server_obj), \
         patch("routers.sqlite_studio.sqlite_studio_service.get_overview", return_value={"status": "ok"}), \
         patch("routers.sqlite_studio.audit_service.record_read_access") as mock_record:
        res = get_database_overview(server_id=135, path="db/Project Zomboid.db", db=mock_db, user=mock_user)
        assert res == {"status": "ok"}
        mock_record.assert_called_once_with(
            mock_db, user_id=42, server_id=135, action="server.files.read", details={"path": "db/Project Zomboid.db"}
        )

