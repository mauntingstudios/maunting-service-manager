"""FastAPI-Router für SQLite Studio.

Bietet server-scopierte Endpunkte zur Inspektion und Verwaltung lokaler
SQLite-Datenbankdateien (.db, .sqlite).
"""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, require_server_permission, verify_csrf
from models import Server, User
from schemas.sqlite_studio import (
    SqliteRowDeleteRequest,
    SqliteRowInsertRequest,
    SqliteRowsRequest,
    SqliteRowUpdateRequest,
    SqliteSqlRequest,
)
from services import audit_service, sqlite_studio_service

router = APIRouter(prefix="/api/servers/{server_id}/sqlite", tags=["sqlite-studio"])


def _server(server_id: int, db: Session) -> Server:
    server = db.get(Server, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    return server


@router.get("/inspect")
def inspect_database(
    server_id: int,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Prüft Magic-Bytes und liefert Schnell-Metadaten einer Datei."""
    require_server_permission(user, server_id, db, "server.files.read")
    server = _server(server_id, db)
    return sqlite_studio_service.inspect_file(server, path)


@router.get("/overview")
def get_database_overview(
    server_id: int,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Liefert Übersicht und Tabellenliste für das Studio."""
    require_server_permission(user, server_id, db, "server.files.read")
    audit_service.record_read_access(
        db, user_id=user.id, server_id=server_id, action="server.sqlite.read_overview"
    )
    server = _server(server_id, db)
    # Prüfe ob Nutzer Schreibrechte hat
    can_write = False
    try:
        require_server_permission(user, server_id, db, "server.files.write")
        can_write = True
    except HTTPException:
        can_write = False

    return sqlite_studio_service.get_overview(server, path, can_write=can_write)


@router.get("/tables/{table_name}")
def get_table_details(
    server_id: int,
    table_name: str,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Liefert Spalten, Indizes und Metadaten einer Tabelle."""
    require_server_permission(user, server_id, db, "server.files.read")
    server = _server(server_id, db)
    return sqlite_studio_service.get_table_details(server, path, table_name)


@router.post("/rows")
def get_table_rows(
    server_id: int,
    body: SqliteRowsRequest,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Liefert paginierte, sortierte und gefilterte Zeilen für das DataGrid."""
    require_server_permission(user, server_id, db, "server.files.read")
    server = _server(server_id, db)
    return sqlite_studio_service.get_rows(
        server,
        path,
        table=body.table,
        limit=body.limit,
        offset=body.offset,
        filters=body.filters,
        sort=body.sort,
    )


@router.post("/row/update")
def update_table_row(
    server_id: int,
    body: SqliteRowUpdateRequest,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    """Aktualisiert eine einzelne Tabellenzeile transaktionssicher."""
    require_server_permission(user, server_id, db, "server.files.write")
    server = _server(server_id, db)
    return sqlite_studio_service.update_row(
        server,
        path,
        table=body.table,
        key_values=body.key,
        changes=body.changes,
        user_id=user.id,
        db=db,
    )


@router.post("/row/delete")
def delete_table_rows(
    server_id: int,
    body: SqliteRowDeleteRequest,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    """Löscht ausgewählte Zeilen aus der Tabelle."""
    require_server_permission(user, server_id, db, "server.files.write")
    server = _server(server_id, db)
    return sqlite_studio_service.delete_rows(
        server,
        path,
        table=body.table,
        keys=body.keys,
        user_id=user.id,
        db=db,
    )


@router.post("/row/insert")
def insert_table_row(
    server_id: int,
    body: SqliteRowInsertRequest,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    """Fügt eine neue Zeile in die Tabelle ein."""
    require_server_permission(user, server_id, db, "server.files.write")
    server = _server(server_id, db)
    return sqlite_studio_service.insert_row(
        server,
        path,
        table=body.table,
        values=body.values,
        user_id=user.id,
        db=db,
    )


@router.post("/sql")
def execute_sql_query(
    server_id: int,
    body: SqliteSqlRequest,
    path: str = Query(..., description="Relativer Pfad zur Datenbankdatei"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(verify_csrf),
) -> dict[str, Any]:
    """Führt ein Freitext-SQL-Statement aus."""
    # Schreibabfragen verlangen server.files.write
    if not body.read_only:
        require_server_permission(user, server_id, db, "server.files.write")
    else:
        require_server_permission(user, server_id, db, "server.files.read")

    server = _server(server_id, db)
    return sqlite_studio_service.execute_sql(
        server,
        path,
        sql=body.sql,
        read_only=body.read_only,
        row_limit=body.row_limit,
        user_id=user.id,
        db=db,
    )


@router.get("/discover")
def discover_sqlite_databases(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Durchsucht das Server-Installationsverzeichnis nach SQLite-Dateien."""
    require_server_permission(user, server_id, db, "server.files.read")
    server = _server(server_id, db)
    databases = sqlite_studio_service.discover_databases(server)
    return {"databases": databases}
