import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from services.ai_db_migration_service import (
    discover_migration_files,
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


def test_discover_migration_files_ordering():
    files = [
        _file("src/App.tsx", "export const x = 1;"),
        _file("migrations/002_add_ghosts.sql", "ALTER TABLE players ADD COLUMN ghost JSONB;"),
        _file("seed.sql", "INSERT INTO players (name) VALUES ('Test');"),
        _file("schema.sql", "CREATE TABLE players (id SERIAL PRIMARY KEY, name TEXT);"),
        _file("migrations/001_initial.sql", "CREATE TABLE scores (id SERIAL PRIMARY KEY, score INT);"),
    ]

    discovered = discover_migration_files(files)
    paths = [p for p, _ in discovered]

    assert paths == [
        "schema.sql",
        "migrations/001_initial.sql",
        "migrations/002_add_ghosts.sql",
        "seed.sql",
    ]


def test_discover_migration_files_ignores_empty():
    files = [
        _file("schema.sql", "   "),
        _file("migrations/001_test.sql", "-- comment only\n"),
        _file("other.txt", "hello"),
    ]
    discovered = discover_migration_files(files)
    # The comment only is non-empty stripped, schema.sql with only spaces is empty
    assert len(discovered) == 1
    assert discovered[0][0] == "migrations/001_test.sql"


if __name__ == "__main__":
    test_discover_migration_files_ordering()
    test_discover_migration_files_ignores_empty()
    print("Migration discover tests passed successfully!")
