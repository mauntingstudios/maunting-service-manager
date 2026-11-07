"""Automatischer Schema- und Migrations-Runner für Singra KI-Projekte."""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING, Any

from services import postgres_service, postgres_studio_service
from services.postgres_studio_service import kontext

if TYPE_CHECKING:
    from sqlalchemy.orm import Session
    from models.ai_project import AiProjectFile

logger = logging.getLogger(__name__)


class AiDbMigrationError(Exception):
    """Fehler bei der Ausfuehrung einer Datenbank-Migration."""

    def __init__(self, message: str, *, file_path: str | None = None, statement: str | None = None):
        super().__init__(message)
        self.message = message
        self.file_path = file_path
        self.statement = statement


def discover_migration_files(files: list[AiProjectFile]) -> list[tuple[str, str]]:
    """Ermittelt und sortiert alle relevanten SQL-Dateien im Projekt."""
    schema_first: list[tuple[str, str]] = []
    migrations: list[tuple[str, str]] = []
    seeds_last: list[tuple[str, str]] = []

    for f in files:
        path_low = f.path.lower()
        if not path_low.endswith(".sql"):
            continue

        content = f.content or ""
        if not content.strip():
            continue

        # Unterscheidung nach Dateityp und Ordner
        base_name = path_low.rsplit("/", 1)[-1]
        if base_name in ("schema.sql", "init.sql", "tables.sql", "database.sql", "create_tables.sql"):
            schema_first.append((f.path, content))
        elif base_name in ("seed.sql", "seeds.sql", "dummy_data.sql", "data.sql"):
            seeds_last.append((f.path, content))
        elif path_low.startswith(("migrations/", "migration/", "sql/", "database/")):
            migrations.append((f.path, content))
        else:
            migrations.append((f.path, content))

    # Migrationen natuerlich sortieren (z. B. 001_..., 002_...)
    migrations.sort(key=lambda item: item[0].lower())

    return [*schema_first, *migrations, *seeds_last]


def ensure_migration_table(db: Session, server_id: int, database_id: int) -> None:
    """Stellt sicher, dass die Migration-Tracking-Tabelle existiert."""
    k = kontext(db, server_id, database_id)
    ddl = """
    CREATE TABLE IF NOT EXISTS _msm_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64)
    );
    """
    postgres_studio_service._run(
        db,
        k,
        [(ddl.strip(), None)],
        mode="tx",
    )


def get_applied_migrations(db: Session, server_id: int, database_id: int) -> dict[str, str]:
    """Liefert alle bereits ausgefuehrten Migrationen und deren Pruefsummen."""
    k = kontext(db, server_id, database_id)
    try:
        res = postgres_studio_service._run(
            db,
            k,
            [("SELECT name, checksum FROM _msm_migrations;", None)],
            mode="read",
        )
        applied: dict[str, str] = {}
        for row in res.get("results", [{}])[0].get("rows", []):
            if len(row) >= 2:
                applied[str(row[0])] = str(row[1] or "")
        return applied
    except Exception as exc:
        logger.debug("Konnte _msm_migrations nicht abfragen: %s", exc)
        return {}


def run_migrations_for_database(
    db: Session,
    server_id: int,
    database_id: int,
    project_files: list[AiProjectFile],
) -> dict[str, Any]:
    """Fuehrt alle noch offenen SQL-Dateien des Projekts in geordneter Reihenfolge aus."""
    candidates = discover_migration_files(project_files)
    if not candidates:
        return {"applied": [], "skipped": [], "total": 0}

    ensure_migration_table(db, server_id, database_id)
    applied_existing = get_applied_migrations(db, server_id, database_id)

    k = kontext(db, server_id, database_id)
    applied_new: list[str] = []
    skipped: list[str] = []

    for file_path, content in candidates:
        checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if file_path in applied_existing:
            skipped.append(file_path)
            continue

        statements = postgres_service._split_sql_statements(content)
        if not statements:
            skipped.append(file_path)
            continue

        logger.info("Fuehre Datenbank-Migration '%s' (%s Anweisungen) aus...", file_path, len(statements))

        try:
            # Migration in einer gemeinsamen Transaktion ausfuehren
            postgres_studio_service._run(
                db,
                k,
                [(stmt, None) for stmt in statements],
                mode="tx",
                rollback=False,
            )

            # Eintrag in Tracking-Tabelle schreiben
            record_sql = "INSERT INTO _msm_migrations (name, checksum) VALUES (%s, %s) ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum;"
            # Formatierung fuer den Studio-Runner
            escaped_name = file_path.replace("'", "''")
            escaped_check = checksum.replace("'", "''")
            record_stmt = f"INSERT INTO _msm_migrations (name, checksum) VALUES ('{escaped_name}', '{escaped_check}') ON CONFLICT (name) DO NOTHING;"
            postgres_studio_service._run(
                db,
                k,
                [(record_stmt, None)],
                mode="tx",
            )
            applied_new.append(file_path)
        except Exception as exc:
            err_msg = str(exc)
            logger.error("Migration '%s' fehlgeschlagen: %s", file_path, err_msg)
            raise AiDbMigrationError(
                f"SQL-Migration in '{file_path}' fehlgeschlagen: {err_msg}",
                file_path=file_path,
            ) from exc

    return {
        "applied": applied_new,
        "skipped": skipped,
        "total": len(candidates),
    }


def execute_project_sql(
    db: Session,
    server_id: int,
    database_id: int,
    sql: str,
    *,
    row_limit: int = 200,
) -> dict[str, Any]:
    """Fuehrt eine direkte SQL-Anfrage fuer Singra auf der Datenbank aus."""
    k = kontext(db, server_id, database_id)
    statements = postgres_service._split_sql_statements(sql)
    if not statements:
        raise ValueError("Keine ausfuehrbare SQL-Anweisung angegeben.")

    res = postgres_studio_service._run(
        db,
        k,
        [(stmt, None) for stmt in statements],
        mode="tx",
        rollback=False,
        row_limit=row_limit,
    )
    return res
