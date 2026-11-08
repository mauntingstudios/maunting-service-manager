"""Automatischer Schema- und Migrations-Runner für Singra KI-Projekte."""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING, Any

from services import postgres_service, postgres_studio_service
from services.postgres_studio_service import kontext
from models.postgres_database import PostgresDatabase

if TYPE_CHECKING:
    from sqlalchemy.orm import Session
    from models.ai_project import AiProjectFile

logger = logging.getLogger(__name__)


class AiDbMigrationError(Exception):
    """Fehler bei der Ausfuehrung einer Datenbank-Migration."""

    def __init__(
        self,
        message: str,
        *,
        file_path: str | None = None,
        statement: str | None = None,
        error_code: str = "migration_failed",
    ):
        super().__init__(message)
        self.message = message
        self.file_path = file_path
        self.statement = statement
        self.error_code = error_code


def discover_migration_files(
    files: list[AiProjectFile],
    target_env: str = "prod",
) -> list[tuple[str, str]]:
    """Ermittelt und sortiert alle relevanten SQL-Dateien im Projekt.

    Seeds (seeds/*.sql, seed.sql, dummy_data.sql) werden NUR in der Dev-Umgebung
    ausgeführt, niemals in Produktion.
    """
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
        elif base_name in ("seed.sql", "seeds.sql", "dummy_data.sql", "data.sql") or path_low.startswith("seeds/"):
            seeds_last.append((f.path, content))
        elif path_low.startswith(("migrations/", "migration/", "sql/", "database/")):
            migrations.append((f.path, content))
        else:
            migrations.append((f.path, content))

    # Migrationen natürlich sortieren (z. B. 001_..., 002_...)
    migrations.sort(key=lambda item: item[0].lower())

    if target_env.lower() == "dev":
        return [*schema_first, *migrations, *seeds_last]
    return [*schema_first, *migrations]


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
    *,
    target_env: str = "prod",
) -> dict[str, Any]:
    """Fuehrt alle noch offenen SQL-Dateien des Projekts in geordneter Reihenfolge aus.

    Prüft auf Checksummen-Drift bereits angewendeter Migrationen.
    """
    candidates = discover_migration_files(project_files, target_env=target_env)
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
            existing_chk = applied_existing[file_path]
            if existing_chk and existing_chk != checksum:
                raise AiDbMigrationError(
                    f"Migrations-Prüfsumme weicht ab für bereits angewendete Migration '{file_path}' (migration_drift).",
                    file_path=file_path,
                    error_code="migration_drift",
                )
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

            # Formatierung fuer den Studio-Runner
            escaped_name = file_path.replace("'", "''")
            escaped_check = checksum.replace("'", "''")
            record_stmt = f"INSERT INTO _msm_migrations (name, checksum) VALUES ('{escaped_name}', '{escaped_check}') ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum;"
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
                error_code="migration_failed",
            ) from exc

    return {
        "applied": applied_new,
        "skipped": skipped,
        "total": len(candidates),
    }


def _resolve_project_db_context(
    db: Session,
    user_or_server_id: Any,
    project_id_or_database_id: Any,
    target_env: str = "dev",
) -> tuple[int, int]:
    """Ermittelt (server_id, database_id) entweder direkt oder über User und Projekt."""
    if isinstance(user_or_server_id, int):
        database_id = int(project_id_or_database_id)
        pg_db = db.get(PostgresDatabase, database_id)
        if pg_db is not None:
            return pg_db.server_id, pg_db.id
        return user_or_server_id, database_id

    from services import ai_project_service
    project = ai_project_service.get_project(db, user_or_server_id, str(project_id_or_database_id))
    ws = ai_project_service.ensure_project_workspace(project)
    meta = ai_project_service._ensure_env_metadata(project, ws)

    is_prod = target_env.lower() in ("prod", "production")
    if is_prod:
        database_id = meta.get("prod_database_id")
        server_id = meta.get("prod_backend_server_id") or meta.get("prod_server_id")
    else:
        database_id = meta.get("dev_database_id") or meta.get("prod_database_id")
        server_id = meta.get("dev_backend_server_id") or meta.get("dev_server_id") or meta.get("prod_backend_server_id")

    if not database_id or not server_id:
        raise AiDbMigrationError(
            f"Für das Projekt '{project.name}' ist in Umgebung '{target_env}' keine PostgreSQL-Datenbank hinterlegt."
        )

    pg_db = db.get(PostgresDatabase, int(database_id))
    if pg_db is not None:
        target_srv_id = int(server_id)
        if pg_db.server_id != target_srv_id:
            logger.info(
                "Passe PostgresDatabase %s server_id von %s auf Projekt-Server %s an",
                pg_db.id,
                pg_db.server_id,
                target_srv_id,
            )
            try:
                pg_db.server_id = target_srv_id
                db.commit()
            except Exception:
                db.rollback()
        return pg_db.server_id, pg_db.id

    return int(server_id), int(database_id)


def execute_project_sql(
    db: Session,
    user_or_server_id: Any = None,
    project_id_or_database_id: Any = None,
    sql: str = "",
    *,
    server_id: Any = None,
    database_id: Any = None,
    target_env: str = "dev",
    write: bool = False,
    row_limit: int = 200,
) -> dict[str, Any]:
    """Fuehrt eine direkte SQL-Anfrage fuer Singra auf der Datenbank aus.

    Sicherheitsregeln:
    - Standardmodus ist 'read' (SELECT)
    - Schreibender Zugriff ('tx') erfordert explizit write=True und ai.projects.manage Berechtigung
    """
    effective_first = server_id if server_id is not None else user_or_server_id
    effective_second = database_id if database_id is not None else project_id_or_database_id
    res_server_id, res_database_id = _resolve_project_db_context(
        db, effective_first, effective_second, target_env=target_env
    )

    if write and not isinstance(effective_first, int):
        from services import permission_service
        if not permission_service.has_global_permission(db, effective_first, "ai.projects.manage"):
            raise AiDbMigrationError("Schreibender Zugriff auf die Datenbank erfordert das Recht 'ai.projects.manage'.")

    k = kontext(db, res_server_id, res_database_id)
    statements = postgres_service._split_sql_statements(sql)
    if not statements:
        raise ValueError("Keine ausfuehrbare SQL-Anweisung angegeben.")

    mode = "tx" if write else "read"
    res = postgres_studio_service._run(
        db,
        k,
        [(stmt, None) for stmt in statements],
        mode=mode,
        rollback=False,
        row_limit=row_limit,
    )
    return res


def get_project_db_status(
    db: Session,
    user: Any,
    project_id: str,
    *,
    target_env: str = "dev",
) -> dict[str, Any]:
    """Prüft die Datenbankverbindung und liefert angewendete Migrationen."""
    try:
        server_id, database_id = _resolve_project_db_context(db, user, project_id, target_env=target_env)
        applied = get_applied_migrations(db, server_id, database_id)
        return {
            "ok": True,
            "connected": True,
            "server_id": server_id,
            "database_id": database_id,
            "environment": target_env,
            "applied_migrations_count": len(applied),
            "applied_migrations": list(applied.keys()),
        }
    except Exception as exc:
        return {
            "ok": False,
            "connected": False,
            "environment": target_env,
            "error": str(exc),
        }


def list_project_tables(
    db: Session,
    user: Any,
    project_id: str,
    *,
    target_env: str = "dev",
) -> list[str]:
    """Liefert alle Tabellennamen im public-Schema der Projektdatenbank."""
    sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
    try:
        res = execute_project_sql(db, user, project_id, sql, target_env=target_env, write=False)
        tables: list[str] = []
        results = res.get("results", [])
        if results and isinstance(results, list):
            for r in results[0].get("rows", []):
                if r and len(r) > 0:
                    tables.append(str(r[0]))
        return tables
    except Exception as exc:
        logger.warning("list_project_tables für Projekt %s (%s) fehlgeschlagen: %s", project_id, target_env, exc)
        return []


def get_project_table_rows(
    db: Session,
    user: Any,
    project_id: str,
    table_name: str,
    *,
    limit: int = 50,
    target_env: str = "dev",
) -> dict[str, Any]:
    """Liest Zeilen einer Tabelle mit Limit."""
    import re
    if not re.match(r"^[a-zA-Z0-9_]+$", table_name):
        raise ValueError("Ungültiger Tabellenname")
    sql = f'SELECT * FROM "{table_name}" LIMIT {int(limit)};'
    return execute_project_sql(db, user, project_id, sql, target_env=target_env, write=False, row_limit=limit)


def apply_project_migrations(
    db: Session,
    user: Any,
    project_id: str,
    *,
    target_env: str = "dev",
) -> dict[str, Any]:
    """Wendet offene Migrationen für das angegebene Projekt an."""
    from services import ai_project_service
    server_id, database_id = _resolve_project_db_context(db, user, project_id, target_env=target_env)
    files = ai_project_service.list_project_files(db, user, project_id)
    return run_migrations_for_database(db, server_id, database_id, files, target_env=target_env)

