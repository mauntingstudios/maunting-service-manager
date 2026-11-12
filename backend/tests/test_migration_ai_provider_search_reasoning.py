"""Migrationstest fuer `20261112_02_ai_provider_search_reasoning` auf PostgreSQL."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from config import settings
from database import Base
import models  # noqa: F401
from models import AiProvider

SPALTE = "search_summary_reasoning_effort"


def _alembic(backend_dir: Path) -> Config:
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


def _spalten(engine) -> set[str]:
    return {spalte["name"] for spalte in inspect(engine).get_columns("ai_providers")}


def test_such_denkstufe_spalte_downgrade_upgrade_und_datenerhalt(
    pg_wegwerf, monkeypatch
) -> None:
    db_url = pg_wegwerf("such_stufe")
    monkeypatch.setattr(settings, "database_url", db_url)
    engine = create_engine(db_url)
    cfg = _alembic(Path(__file__).resolve().parent.parent)

    try:
        Base.metadata.create_all(bind=engine)
        assert SPALTE in _spalten(engine), "AiProvider-Modell muss die Spalte definieren"

        with Session(engine) as session:
            session.add(
                AiProvider(
                    name="Bestandsanbieter",
                    provider_kind="openrouter",
                    default_model="openai/gpt-5.6-luna",
                    enabled=True,
                    requires_api_key=True,
                )
            )
            session.commit()

        # Laut AGENTS.md §14 immer von head rueckwaerts testen.
        command.stamp(cfg, "20261112_02")
        command.downgrade(cfg, "20261112_01")
        assert SPALTE not in _spalten(engine)

        with engine.connect() as conn:
            row = conn.execute(text("SELECT name FROM ai_providers")).mappings().one()
        assert row["name"] == "Bestandsanbieter"

        command.upgrade(cfg, "20261112_02")
        assert SPALTE in _spalten(engine)
        with engine.connect() as conn:
            wert = conn.execute(
                text(f"SELECT {SPALTE} FROM ai_providers")
            ).scalar_one()
        assert wert is None, "Bestandszeilen starten ohne Denkstufe (schnellste Antwort)"

        # Idempotenz: erneutes Upgrade trotz vorhandener Spalte (create_all).
        command.stamp(cfg, "20261112_01")
        command.upgrade(cfg, "20261112_02")
        command.upgrade(cfg, "20261112_02")
        assert SPALTE in _spalten(engine)
    finally:
        engine.dispose()