"""Migrationstest fuer `20261112_01_ai_provider_custom` auf PostgreSQL."""

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

CUSTOM_SPALTEN = {
    "custom_base_url",
    "custom_chat_protocol",
    "custom_reasoning_dialect",
    "custom_context_tokens",
    "custom_max_output_tokens",
    "custom_supports_vision",
}


def _alembic(backend_dir: Path) -> Config:
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


def _spalten(engine) -> set[str]:
    return {spalte["name"] for spalte in inspect(engine).get_columns("ai_providers")}


def test_ai_provider_custom_columns_downgrade_upgrade_and_preserve_data(
    pg_wegwerf, monkeypatch
) -> None:
    db_url = pg_wegwerf("custom_prov")
    monkeypatch.setattr(settings, "database_url", db_url)
    engine = create_engine(db_url)
    cfg = _alembic(Path(__file__).resolve().parent.parent)

    try:
        Base.metadata.create_all(bind=engine)
        assert CUSTOM_SPALTEN <= _spalten(engine), (
            "AiProvider-Modell muss alle sechs custom_*-Spalten definieren"
        )

        # Bestandszeile anlegen, um Datenerhalt und Server-Defaults beim Upgrade zu pruefen.
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
        command.stamp(cfg, "20261112_01")
        command.downgrade(cfg, "20261111_02")

        cols_after_downgrade = _spalten(engine)
        assert CUSTOM_SPALTEN.isdisjoint(cols_after_downgrade), (
            f"Unerwartete Restspalten nach Downgrade: {CUSTOM_SPALTEN & cols_after_downgrade}"
        )

        # Bestandsdatensatz hat das Downgrade unbeschadet ueberlebt.
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT name, provider_kind, default_model FROM ai_providers")
            ).mappings().one()
        assert row["name"] == "Bestandsanbieter"
        assert row["provider_kind"] == "openrouter"
        assert row["default_model"] == "openai/gpt-5.6-luna"

        # Upgrade stellt alle sechs Spalten mit passenden Server-Defaults wieder her.
        command.upgrade(cfg, "20261112_01")
        cols_after_upgrade = _spalten(engine)
        assert CUSTOM_SPALTEN <= cols_after_upgrade

        with engine.connect() as conn:
            upgraded_row = conn.execute(
                text(
                    "SELECT name, custom_base_url, custom_chat_protocol, "
                    "custom_reasoning_dialect, custom_context_tokens, "
                    "custom_max_output_tokens, custom_supports_vision "
                    "FROM ai_providers"
                )
            ).mappings().one()
        assert upgraded_row["name"] == "Bestandsanbieter"
        assert upgraded_row["custom_base_url"] is None
        assert upgraded_row["custom_chat_protocol"] == "chat_completions"
        assert upgraded_row["custom_reasoning_dialect"] == "none"
        assert upgraded_row["custom_context_tokens"] is None
        assert upgraded_row["custom_max_output_tokens"] is None
        assert upgraded_row["custom_supports_vision"] is None

        # Idempotenz: Erneutes Ausfuehren trotz bereits vorhandener Spalten (z. B. nach create_all)
        # sowie wiederholtes upgrade auf head darf nicht scheitern.
        command.stamp(cfg, "20261111_02")
        command.upgrade(cfg, "20261112_01")
        command.upgrade(cfg, "20261112_01")
        assert CUSTOM_SPALTEN <= _spalten(engine)
    finally:
        engine.dispose()
