"""Gemeinsamer Chunk-Upload-Helfer mit Parallelitätsdeckel (M2)."""

from __future__ import annotations

from typing import Callable

from fastapi import HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from services import vault_blob_service

# So viele Chunks nimmt ein Prozess zugleich entgegen. Jeder liegt bis zum
# Schreiben im Speicher (gut 4 MiB); ohne Grenze hielten tausend gleichzeitige
# Uploads Gigabytes. Darueber 503 mit Retry-After, der Client versucht es beim
# naechsten Anstoss wieder.
CHUNKS_ZUGLEICH = 16
_chunks_laufend = 0


async def chunk_annehmen(
    request: Request,
    db: Session,
    bucket: str,
    blob_id: str,
    index: int,
    fehler_mapper: Callable[[vault_blob_service.BlobFehler], HTTPException],
) -> Response:
    """Nimmt einen Chunk als rohe Bytes an. Laenge exakt wie angemeldet, sonst 413/422."""
    global _chunks_laufend
    try:
        erwartet = await run_in_threadpool(vault_blob_service.laenge_fuer_upload, db, bucket, blob_id, index)
    except vault_blob_service.BlobFehler as exc:
        raise fehler_mapper(exc) from exc
    await run_in_threadpool(db.rollback)

    if _chunks_laufend >= CHUNKS_ZUGLEICH:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Der Tresor nimmt gerade zu viele Dateien zugleich an.",
            headers={"Retry-After": "5"},
        )
    _chunks_laufend += 1
    try:
        daten = bytearray()
        async for teil in request.stream():
            daten += teil
            if len(daten) > erwartet:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Chunk zu gross.")
        if len(daten) != erwartet:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Chunk hat die falsche Laenge.")

        try:
            await run_in_threadpool(vault_blob_service.chunk_ablegen, db, bucket, blob_id, index, daten)
        except vault_blob_service.BlobFehler as exc:
            raise fehler_mapper(exc) from exc
    finally:
        _chunks_laufend -= 1
    return Response(status_code=status.HTTP_204_NO_CONTENT)
