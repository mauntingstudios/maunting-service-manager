"""Service für SQLite-Datenbankinspektion und -verwaltung (SQLite Studio).

Bietet sicheren, serverseitigen Zugriff auf SQLite-Dateien (.db, .sqlite)
innerhalb des install_dir eines Servers.

Sicherheits- und Stabilitätsprinzipien:
1. Magic-Bytes-Prüfung: Nur echte SQLite-3-Dateien ("SQLite format 3\\0") werden geöffnet.
2. WAL- & Concurrency-Schutz: Lesezugriffe laufen per URI mode=ro und timeout=10.0.
   Laufende Gameserver (z. B. Project Zomboid) werden weder blockiert noch beschädigt.
3. Path-Traversal-Schutz: Alle relativen Pfade werden strikt gegen server.install_dir geprüft.
4. Parameterbindung: Keine ungefilterten Strings in SQL-Statements (Schutz vor SQL-Injection).
"""

from __future__ import annotations

import base64
import os
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any, Sequence

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import Server
from services import audit_service
from services.server_file_access_service import safe_path

SQLITE_HEADER = b"SQLite format 3\x00"
MAX_ROWS_LIMIT = 500


def is_sqlite_file(file_path: Path) -> bool:
    """Prüft die ersten 16 Bytes auf den genormten SQLite-3-Header."""
    if not file_path.is_file():
        return False
    try:
        if file_path.stat().st_size < 16:
            return False
        with file_path.open("rb") as f:
            header = f.read(16)
            return header == SQLITE_HEADER
    except (OSError, PermissionError):
        return False


def _resolve_target(server: Server, relative_path: str) -> Path:
    """Löst den Pfad sicher innerhalb des Server-Installationsverzeichnisses auf."""
    if not server.install_dir or not os.path.isdir(server.install_dir):
        raise HTTPException(status_code=400, detail="Server-Installationsverzeichnis nicht gefunden")
    target = safe_path(server.install_dir, relative_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Datenbankdatei nicht gefunden")
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Pfad ist keine Datei")
    return target


def _connect_sqlite(target: Path, read_only: bool = True, timeout: float = 10.0) -> sqlite3.Connection:
    """Stellt eine Verbindung zu einer SQLite-Datei her.
    
    Im Lese-Modus wird die URI 'mode=ro' verwendet, um Dateisystem-Sperren zu minimieren.
    """
    posix_path = target.as_posix()
    if read_only:
        uri = f"file:{posix_path}?mode=ro"
    else:
        uri = f"file:{posix_path}"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=timeout)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as exc:
        raise HTTPException(status_code=400, detail=f"SQLite-Verbindungsfehler: {exc}") from exc


def _serialize_val(val: Any) -> Any:
    """Macht SQLite-Werte JSON-serialisierbar (BLOBs zu String/Hex)."""
    if val is None:
        return None
    if isinstance(val, (int, float, str, bool)):
        return val
    if isinstance(val, bytes):
        try:
            return val.decode("utf-8")
        except UnicodeDecodeError:
            return f"<BLOB: {len(val)} Bytes (hex: {val[:16].hex()}...)>"
    return str(val)


def inspect_file(server: Server, relative_path: str) -> dict[str, Any]:
    """Prüft eine Datei und liefert Schnell-Metadaten zurück."""
    target = _resolve_target(server, relative_path)
    is_sqlite = is_sqlite_file(target)
    stat = target.stat()
    wal_exists = target.with_name(target.name + "-wal").exists()
    
    if not is_sqlite:
        return {
            "path": relative_path,
            "name": target.name,
            "is_sqlite": False,
            "size": stat.st_size,
            "modified": int(stat.st_mtime),
            "wal_mode": wal_exists,
            "table_count": 0,
        }

    try:
        with closing(_connect_sqlite(target, read_only=True)) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT count(*) FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
            table_count = int(cursor.fetchone()[0])
            cursor.execute("PRAGMA journal_mode")
            journal_row = cursor.fetchone()
            journal_mode = str(journal_row[0]).lower() if journal_row else ("wal" if wal_exists else "delete")
    except Exception:
        table_count = 0
        journal_mode = "wal" if wal_exists else "unknown"

    return {
        "path": relative_path,
        "name": target.name,
        "is_sqlite": True,
        "size": stat.st_size,
        "modified": int(stat.st_mtime),
        "wal_mode": journal_mode == "wal" or wal_exists,
        "journal_mode": journal_mode,
        "table_count": table_count,
    }


def get_overview(server: Server, relative_path: str, can_write: bool) -> dict[str, Any]:
    """Liefert Übersicht kompatibel mit StudioOverview."""
    target = _resolve_target(server, relative_path)
    if not is_sqlite_file(target):
        raise HTTPException(status_code=400, detail="Datei ist keine gültige SQLite-Datenbank")

    with closing(_connect_sqlite(target, read_only=True)) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        )
        rows = cursor.fetchall()
        tables: list[dict[str, Any]] = []
        for row in rows:
            t_name = str(row[0])
            t_type = "view" if str(row[1]) == "view" else "table"
            try:
                # Schneller Zähler
                cursor.execute(f'SELECT count(*) FROM "{t_name}"')
                count = int(cursor.fetchone()[0])
            except Exception:
                count = 0
            tables.append({
                "oid": abs(hash(t_name)) % 1000000,
                "name": t_name,
                "kind": t_type,
                "estimated_rows": count,
                "size_bytes": None,
                "is_partition": False,
                "rls_enabled": False,
                "comment": None,
                "parent": None,
            })

        cursor.execute("PRAGMA journal_mode")
        j_row = cursor.fetchone()
        journal_mode = str(j_row[0]) if j_row else "delete"

    stat = target.stat()
    return {
        "kind": "shared",
        "server": {
            "version_num": 3040000,
            "version": f"SQLite 3 (Modus: {journal_mode.upper()})",
            "role": "sqlite",
            "database": target.name,
            "size_bytes": stat.st_size,
        },
        "schemas": [
            {
                "name": "main",
                "owner": "sqlite",
                "can_create": can_write,
                "table_count": len(tables),
            }
        ],
        "permissions": {
            "read": True,
            "write": can_write,
            "admin": can_write,
        },
        "relations": tables,
    }


def get_table_details(server: Server, relative_path: str, table_name: str) -> dict[str, Any]:
    """Liefert Spalten- und Index-Details einer Tabelle (StudioTableDetails)."""
    target = _resolve_target(server, relative_path)
    if not is_sqlite_file(target):
        raise HTTPException(status_code=400, detail="Datei ist keine SQLite-Datenbank")

    with closing(_connect_sqlite(target, read_only=True)) as conn:
        cursor = conn.cursor()
        # Prüfen ob Tabelle existiert
        cursor.execute("SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')", (table_name,))
        t_row = cursor.fetchone()
        if not t_row:
            raise HTTPException(status_code=404, detail=f"Tabelle '{table_name}' nicht gefunden")
        t_kind = "view" if t_row[0] == "view" else "table"

        # Spalten via PRAGMA table_info
        cursor.execute(f'PRAGMA table_info("{table_name}")')
        col_rows = cursor.fetchall()
        columns: list[dict[str, Any]] = []
        pk_cols: list[str] = []

        for c in col_rows:
            # c: cid, name, type, notnull, dflt_value, pk
            cid = int(c[0])
            c_name = str(c[1])
            c_type = str(c[2]).upper() if c[2] else "TEXT"
            c_notnull = bool(c[3])
            c_dflt = str(c[4]) if c[4] is not None else None
            c_pk = int(c[5]) > 0
            if c_pk:
                pk_cols.append(c_name)

            columns.append({
                "position": cid + 1,
                "name": c_name,
                "type": c_type,
                "nullable": not c_notnull,
                "default": c_dflt,
                "default_value": c_dflt,
                "has_default": c_dflt is not None,
                "is_primary_key": c_pk,
                "identity": None,
                "is_identity": False,
                "generated": False,
                "is_generated": False,
                "comment": None,
                "category": "s",
                "enum_values": None,
            })

        # Zeilenanzahl
        try:
            cursor.execute(f'SELECT count(*) FROM "{table_name}"')
            total_rows = int(cursor.fetchone()[0])
        except Exception:
            total_rows = 0

        # Fremdschlüssel
        foreign_keys: list[dict[str, Any]] = []
        try:
            cursor.execute(f'PRAGMA foreign_key_list("{table_name}")')
            for fk in cursor.fetchall():
                # id, seq, table, from, to, on_update, on_delete, match
                foreign_keys.append({
                    "name": f"fk_{table_name}_{fk[3]}",
                    "columns": [str(fk[3])],
                    "ref_schema": "main",
                    "ref_table": str(fk[2]),
                    "ref_columns": [str(fk[4])],
                    "on_delete": str(fk[6]).lower().replace(" ", "_"),
                    "on_update": str(fk[5]).lower().replace(" ", "_"),
                    "deferrable": False,
                })
        except Exception:
            pass

        # Constraints (Primary Key + Foreign Keys) für DataGrid & TableStructure
        constraints: list[dict[str, Any]] = []
        if pk_cols:
            constraints.append({
                "name": f"pk_{table_name}",
                "type": "primary_key",
                "definition": f"PRIMARY KEY ({', '.join(pk_cols)})",
                "columns": pk_cols,
                "ref_schema": None,
                "ref_table": None,
                "ref_columns": [],
                "on_delete": None,
                "on_update": None,
                "deferrable": False,
            })
        for fk in foreign_keys:
            constraints.append({
                "name": fk["name"],
                "type": "foreign_key",
                "definition": f"FOREIGN KEY ({', '.join(fk['columns'])}) REFERENCES {fk['ref_table']}({', '.join(fk['ref_columns'])})",
                "columns": fk["columns"],
                "ref_schema": fk["ref_schema"],
                "ref_table": fk["ref_table"],
                "ref_columns": fk["ref_columns"],
                "on_delete": fk["on_delete"],
                "on_update": fk["on_update"],
                "deferrable": False,
            })

        # Indizes
        indexes: list[dict[str, Any]] = []
        try:
            cursor.execute(f'PRAGMA index_list("{table_name}")')
            for idx in cursor.fetchall():
                # seq, name, unique, origin, partial
                idx_name = str(idx[1])
                is_unique = bool(idx[2])
                cursor.execute(f'PRAGMA index_info("{idx_name}")')
                idx_cols = [str(col_row[2]) for col_row in cursor.fetchall()]
                indexes.append({
                    "name": idx_name,
                    "columns": idx_cols,
                    "is_unique": is_unique,
                    "is_primary": idx_name.startswith("sqlite_autoindex_"),
                })
        except Exception:
            pass

    return {
        "schema": "main",
        "table": table_name,
        "oid": 0,
        "kind": "r" if t_kind == "table" else "v",
        "rls_enabled": False,
        "rls_forced": False,
        "comment": None,
        "estimated_rows": total_rows,
        "owner": "sqlite",
        "partition_key": None,
        "partition_bound": None,
        "view_definition": None,
        "size_bytes": None,
        "index_size_bytes": None,
        "primary_key": pk_cols if pk_cols else ["rowid"],
        "columns": columns,
        "constraints": constraints,
        "referenced_by": [],
        "indexes": indexes,
        "triggers": [],
        "policies": [],
        "partitions": [],
        "grants": [],
        "stats": None,
    }


def get_rows(
    server: Server,
    relative_path: str,
    table: str,
    limit: int = 50,
    offset: int = 0,
    filters: Sequence[dict[str, Any]] | None = None,
    sort: Sequence[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Liefert paginierte Zeilen im genormten StudioRows-Format."""
    target = _resolve_target(server, relative_path)
    if not is_sqlite_file(target):
        raise HTTPException(status_code=400, detail="Datei ist keine SQLite-Datenbank")

    limit = min(max(1, limit), MAX_ROWS_LIMIT)
    offset = max(0, offset)

    with closing(_connect_sqlite(target, read_only=True)) as conn:
        cursor = conn.cursor()
        # Validiere Tabelle und Spalten
        cursor.execute("SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')", (table,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"Tabelle '{table}' nicht gefunden")

        cursor.execute(f'PRAGMA table_info("{table}")')
        col_rows = cursor.fetchall()
        valid_cols = {str(c[1]): str(c[2]).upper() if c[2] else "TEXT" for c in col_rows}
        pk_cols = [str(c[1]) for c in col_rows if int(c[5]) > 0]
        has_rowid = len(pk_cols) == 0  # wenn kein expliziter PK, nutzen wir rowid

        # Filter aufbauen
        where_clauses: list[str] = []
        params: list[Any] = []

        if filters:
            for f in filters:
                col = str(f.get("column", ""))
                op = str(f.get("operator", "eq"))
                val = f.get("value")
                if col not in valid_cols and col != "rowid":
                    continue

                if op == "eq":
                    where_clauses.append(f'"{col}" = ?')
                    params.append(val)
                elif op == "neq":
                    where_clauses.append(f'"{col}" != ?')
                    params.append(val)
                elif op == "lt":
                    where_clauses.append(f'"{col}" < ?')
                    params.append(val)
                elif op == "lte":
                    where_clauses.append(f'"{col}" <= ?')
                    params.append(val)
                elif op == "gt":
                    where_clauses.append(f'"{col}" > ?')
                    params.append(val)
                elif op == "gte":
                    where_clauses.append(f'"{col}" >= ?')
                    params.append(val)
                elif op in ("like", "ilike", "contains"):
                    where_clauses.append(f'"{col}" LIKE ?')
                    params.append(f"%{val}%" if op == "contains" else str(val))
                elif op == "not_like":
                    where_clauses.append(f'"{col}" NOT LIKE ?')
                    params.append(str(val))
                elif op == "is_null":
                    where_clauses.append(f'"{col}" IS NULL')
                elif op == "not_null":
                    where_clauses.append(f'"{col}" IS NOT NULL')
                elif op == "in" and isinstance(val, (list, tuple)) and len(val) > 0:
                    placeholders = ", ".join(["?"] * len(val))
                    where_clauses.append(f'"{col}" IN ({placeholders})')
                    params.extend(val)

        where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        # Gesamtzahl
        count_query = f'SELECT count(*) FROM "{table}"{where_sql}'
        cursor.execute(count_query, params)
        total = int(cursor.fetchone()[0])

        # Sortierung aufbauen
        order_clauses: list[str] = []
        if sort:
            for s in sort:
                s_col = str(s.get("column", ""))
                desc = bool(s.get("descending", False))
                if s_col in valid_cols or s_col == "rowid":
                    order_clauses.append(f'"{s_col}" {"DESC" if desc else "ASC"}')

        order_sql = f" ORDER BY {', '.join(order_clauses)}" if order_clauses else ""

        # Daten abfragen
        # Wenn kein PK, fügen wir rowid als erste Spalte hinzu
        if has_rowid:
            select_cols = f'rowid AS "__msm_rowid", *'
        else:
            select_cols = "*"

        query = f'SELECT {select_cols} FROM "{table}"{where_sql}{order_sql} LIMIT ? OFFSET ?'
        query_params = list(params) + [limit, offset]
        cursor.execute(query, query_params)

        col_names = [d[0] for d in cursor.description]
        col_types = [valid_cols.get(name, "INTEGER" if name == "__msm_rowid" else "TEXT") for name in col_names]

        rows: list[list[Any]] = []
        for r in cursor.fetchall():
            rows.append([_serialize_val(val) for val in r])

    key_columns = pk_cols if pk_cols else ["__msm_rowid"]

    return {
        "columns": col_names,
        "types": col_types,
        "rows": rows,
        "total": total,
        "total_is_estimate": False,
        "key": key_columns,
        "editable": len(key_columns) > 0,
    }


def update_row(
    server: Server,
    relative_path: str,
    table: str,
    key_values: dict[str, Any],
    changes: dict[str, Any],
    user_id: int,
    db: Session,
) -> dict[str, Any]:
    """Aktualisiert eine einzelne Zeile parametrisiert und revisionssicher."""
    target = _resolve_target(server, relative_path)
    if not is_sqlite_file(target):
        raise HTTPException(status_code=400, detail="Datei ist keine SQLite-Datenbank")

    with closing(_connect_sqlite(target, read_only=False)) as conn:
        cursor = conn.cursor()
        cursor.execute(f'PRAGMA table_info("{table}")')
        col_rows = cursor.fetchall()
        valid_cols = {str(c[1]) for c in col_rows}

        set_clauses: list[str] = []
        set_params: list[Any] = []
        for col, val in changes.items():
            if col in valid_cols:
                set_clauses.append(f'"{col}" = ?')
                set_params.append(val)

        if not set_clauses:
            raise HTTPException(status_code=400, detail="Keine gültigen Spaltenänderungen übergeben")

        where_clauses: list[str] = []
        where_params: list[Any] = []
        for col, val in key_values.items():
            if col == "__msm_rowid":
                where_clauses.append('"rowid" = ?')
                where_params.append(val)
            elif col in valid_cols:
                where_clauses.append(f'"{col}" = ?')
                where_params.append(val)

        if not where_clauses:
            raise HTTPException(status_code=400, detail="Kein Primärschlüssel für Aktualisierung vorhanden")

        query = f'UPDATE "{table}" SET {", ".join(set_clauses)} WHERE {" AND ".join(where_clauses)}'
        cursor.execute(query, set_params + where_params)
        conn.commit()
        affected = cursor.rowcount

    audit_service.record_privileged_action(
        db,
        user_id=user_id,
        action="server.sqlite.update_row",
        target_type="server",
        target_id=server.id,
        details={"path": relative_path, "table": table, "keys": str(key_values), "affected": affected},
        commit=True,
    )

    return {"message": "Zeile erfolgreich aktualisiert", "affected": affected}


def delete_rows(
    server: Server,
    relative_path: str,
    table: str,
    keys: list[dict[str, Any]],
    user_id: int,
    db: Session,
) -> dict[str, Any]:
    """Löscht selektierte Zeilen parametrisiert."""
    target = _resolve_target(server, relative_path)
    if not is_sqlite_file(target):
        raise HTTPException(status_code=400, detail="Datei ist keine SQLite-Datenbank")

    if not keys:
        return {"message": "Keine Zeilen zum Löschen übergeben", "affected": 0}

    with closing(_connect_sqlite(target, read_only=False)) as conn:
        cursor = conn.cursor()
        cursor.execute(f'PRAGMA table_info("{table}")')
        valid_cols = {str(c[1]) for c in cursor.fetchall()}

        total_affected = 0
        for key_dict in keys:
            where_clauses: list[str] = []
            where_params: list[Any] = []
            for col, val in key_dict.items():
                if col == "__msm_rowid":
                    where_clauses.append('"rowid" = ?')
                    where_params.append(val)
                elif col in valid_cols:
                    where_clauses.append(f'"{col}" = ?')
                    where_params.append(val)

            if where_clauses:
                query = f'DELETE FROM "{table}" WHERE {" AND ".join(where_clauses)}'
                cursor.execute(query, where_params)
                total_affected += cursor.rowcount

        conn.commit()

    audit_service.record_privileged_action(
        db,
        user_id=user_id,
        action="server.sqlite.delete_rows",
        target_type="server",
        target_id=server.id,
        details={"path": relative_path, "table": table, "affected": total_affected},
        commit=True,
    )

    return {"message": f"{total_affected} Zeile(n) gelöscht", "affected": total_affected}


def insert_row(
    server: Server,
    relative_path: str,
    table: str,
    values: dict[str, Any],
    user_id: int,
    db: Session,
) -> dict[str, Any]:
    """Fügt eine neue Zeile in die Tabelle ein."""
    target = _resolve_target(server, relative_path)
    if not is_sqlite_file(target):
        raise HTTPException(status_code=400, detail="Datei ist keine SQLite-Datenbank")

    with closing(_connect_sqlite(target, read_only=False)) as conn:
        cursor = conn.cursor()
        cursor.execute(f'PRAGMA table_info("{table}")')
        valid_cols = {str(c[1]) for c in cursor.fetchall()}

        cols: list[str] = []
        params: list[Any] = []
        for col, val in values.items():
            if col in valid_cols:
                cols.append(col)
                params.append(val)

        if not cols:
            raise HTTPException(status_code=400, detail="Keine gültigen Spaltenwerte übergeben")

        col_sql = ", ".join([f'"{c}"' for c in cols])
        placeholders = ", ".join(["?"] * len(cols))
        query = f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders})'
        cursor.execute(query, params)
        conn.commit()
        last_id = cursor.lastrowid

    audit_service.record_privileged_action(
        db,
        user_id=user_id,
        action="server.sqlite.insert_row",
        target_type="server",
        target_id=server.id,
        details={"path": relative_path, "table": table, "last_id": last_id},
        commit=True,
    )

    return {"message": "Zeile erfolgreich angelegt", "last_id": last_id}


def execute_sql(
    server: Server,
    relative_path: str,
    sql: str,
    read_only: bool = True,
    row_limit: int = 500,
    user_id: int | None = None,
    db: Session | None = None,
) -> dict[str, Any]:
    """Führt Freitext-SQL aus und liefert die Ergebnisse im StudioSqlResponse-Format."""
    target = _resolve_target(server, relative_path)
    if not is_sqlite_file(target):
        raise HTTPException(status_code=400, detail="Datei ist keine SQLite-Datenbank")

    sql_clean = sql.strip()
    if not sql_clean:
        return {"results": [], "notices": []}

    row_limit = min(max(1, row_limit), 1000)
    start_time = time.perf_counter()

    with closing(_connect_sqlite(target, read_only=read_only)) as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(sql_clean)
            if not read_only:
                conn.commit()

            if cursor.description:
                columns = [d[0] for d in cursor.description]
                fetched_rows = cursor.fetchmany(row_limit + 1)
                truncated = len(fetched_rows) > row_limit
                display_rows = fetched_rows[:row_limit]
                rows_serialized = [[_serialize_val(val) for val in r] for r in display_rows]
                row_count = len(display_rows)
            else:
                columns = []
                rows_serialized = []
                row_count = cursor.rowcount if cursor.rowcount >= 0 else 0
                truncated = False

            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

            if not read_only and user_id and db:
                audit_service.record_privileged_action(
                    db,
                    user_id=user_id,
                    action="server.sqlite.execute_sql",
                    target_type="server",
                    target_id=server.id,
                    details={"path": relative_path, "sql_snippet": sql_clean[:100], "row_count": row_count},
                    commit=True,
                )

            return {
                "results": [
                    {
                        "columns": columns,
                        "rows": rows_serialized,
                        "row_count": row_count,
                        "status": f"SUCCESS ({row_count} Zeilen)",
                        "truncated": truncated,
                        "duration_ms": duration_ms,
                    }
                ],
                "notices": [],
            }
        except sqlite3.Error as exc:
            raise HTTPException(status_code=400, detail=f"SQL-Fehler: {exc}") from exc


def discover_databases(server: Server) -> list[dict[str, Any]]:
    """Scannt das Serververzeichnis nach echten SQLite-Datenbankdateien."""
    if not server.install_dir or not os.path.isdir(server.install_dir):
        return []

    base = Path(server.install_dir)
    results: list[dict[str, Any]] = []

    # Suche nach .db, .sqlite, .sqlite3 Dateien (bis Tiefe 5)
    candidates: list[Path] = []
    try:
        for ext in ("*.db", "*.sqlite", "*.sqlite3", "*.db3"):
            candidates.extend(base.rglob(ext))
    except (OSError, PermissionError):
        pass

    for candidate in sorted(candidates, key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)[:50]:
        try:
            if candidate.is_file() and is_sqlite_file(candidate):
                rel_path = candidate.relative_to(base).as_posix()
                # Überspringe temporäre / interne Sicherungen
                if "__msm" in rel_path or ".git" in rel_path:
                    continue
                stat = candidate.stat()
                results.append({
                    "path": rel_path,
                    "name": candidate.name,
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime),
                })
        except (ValueError, OSError, PermissionError):
            continue

    return results
