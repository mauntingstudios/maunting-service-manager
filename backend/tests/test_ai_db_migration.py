import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from services.ai_db_migration_service import (
    discover_migration_files,
    run_migrations_for_database,
    execute_project_sql,
    AiDbMigrationError,
)
from models.ai_project import AiProjectFile


def _file(path: str, content: str = "SELECT 1;") -> AiProjectFile:
    return AiProjectFile(
        id="f-1",
        project_id="p-1",
        path=path,
        content=content,
        size_bytes=len(content),
    )


def test_discover_migration_files_ordering_dev():
    files = [
        _file("src/App.tsx", "export const x = 1;"),
        _file("migrations/002_add_ghosts.sql", "ALTER TABLE players ADD COLUMN ghost JSONB;"),
        _file("seed.sql", "INSERT INTO players (name) VALUES ('Test');"),
        _file("schema.sql", "CREATE TABLE players (id SERIAL PRIMARY KEY, name TEXT);"),
        _file("migrations/001_initial.sql", "CREATE TABLE scores (id SERIAL PRIMARY KEY, score INT);"),
    ]

    discovered = discover_migration_files(files, target_env="dev")
    paths = [p for p, _ in discovered]

    assert paths == [
        "schema.sql",
        "migrations/001_initial.sql",
        "migrations/002_add_ghosts.sql",
        "seed.sql",
    ]


def test_discover_migration_files_prod_excludes_seeds():
    files = [
        _file("schema.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);"),
        _file("seeds/dummy.sql", "INSERT INTO users DEFAULT VALUES;"),
        _file("seed.sql", "INSERT INTO users DEFAULT VALUES;"),
        _file("migrations/001_init.sql", "CREATE TABLE posts (id SERIAL PRIMARY KEY);"),
    ]

    discovered = discover_migration_files(files, target_env="prod")
    paths = [p for p, _ in discovered]

    assert "seeds/dummy.sql" not in paths
    assert "seed.sql" not in paths
    assert paths == ["schema.sql", "migrations/001_init.sql"]


def test_discover_migration_files_ignores_empty():
    files = [
        _file("schema.sql", "   "),
        _file("migrations/001_test.sql", "-- comment only\n"),
        _file("other.txt", "hello"),
    ]
    discovered = discover_migration_files(files)
    assert len(discovered) == 1
    assert discovered[0][0] == "migrations/001_test.sql"


def test_run_migrations_detects_drift(monkeypatch):
    import hashlib
    from services import ai_db_migration_service, postgres_studio_service

    # Mock ensure_migration_table and kontext
    monkeypatch.setattr(ai_db_migration_service, "ensure_migration_table", lambda db, s, d: None)
    monkeypatch.setattr(ai_db_migration_service, "kontext", lambda db, s, d: {})

    # Existing migration has hash "old-hash"
    existing = {"migrations/001_init.sql": "old-hash-different"}
    monkeypatch.setattr(ai_db_migration_service, "get_applied_migrations", lambda db, s, d: existing)

    files = [
        _file("migrations/001_init.sql", "CREATE TABLE users (id INT, changed TEXT);")
    ]

    db_mock = MagicMock()
    with pytest.raises(AiDbMigrationError) as exc_info:
        run_migrations_for_database(db_mock, server_id=1, database_id=2, project_files=files)

    assert exc_info.value.error_code == "migration_drift"
    assert "migration_drift" in str(exc_info.value)
