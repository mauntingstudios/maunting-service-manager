"""Schemas für das SQLite Studio."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class SqliteRowsRequest(BaseModel):
    table: str = Field(..., min_length=1, max_length=120)
    limit: Literal[25, 50, 100, 500] = 50
    offset: int = Field(0, ge=0, le=100_000_000)
    filters: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    sort: list[dict[str, Any]] = Field(default_factory=list, max_length=8)


class SqliteRowUpdateRequest(BaseModel):
    table: str = Field(..., min_length=1, max_length=120)
    key: dict[str, Any] = Field(..., min_length=1, max_length=32)
    changes: dict[str, Any] = Field(..., min_length=1, max_length=1600)


class SqliteRowDeleteRequest(BaseModel):
    table: str = Field(..., min_length=1, max_length=120)
    keys: list[dict[str, Any]] = Field(..., min_length=1, max_length=500)


class SqliteRowInsertRequest(BaseModel):
    table: str = Field(..., min_length=1, max_length=120)
    values: dict[str, Any] = Field(..., min_length=1, max_length=1600)


class SqliteSqlRequest(BaseModel):
    sql: str = Field(..., min_length=1, max_length=100_000)
    read_only: bool = True
    row_limit: int = Field(500, ge=1, le=1000)
