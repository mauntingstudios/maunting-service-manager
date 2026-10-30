"""PostgreSQL schema bootstrap and Alembic upgrade gates."""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from database import Base
import models  # noqa: F401 - ensure complete metadata

logger = logging.getLogger(__name__)

_MAIN_STAND_VOR_DOCS = "20261028_01"


def _alembic_config() -> Config:
    backend_dir = Path(__file__).resolve().parent.parent
    return Config(str(backend_dir / "alembic.ini"))


def _missing_model_schema(engine: Engine) -> list[str]:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    missing: list[str] = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            missing.append(table.name)
            continue
        existing_columns = {
            column["name"] for column in inspector.get_columns(table.name)
        }
        for column in table.columns:
            if column.name not in existing_columns:
                missing.append(f"{table.name}.{column.name}")
    return missing


def _alte_docs_revision_zuruecksetzen(engine: Engine) -> None:
    """Stellt den Stand vor dem Merge wieder her, wenn die Docs-Revision kollidiert.

    Der Dokumente-Branch lief vor dem Merge unter ``20261028_01``. Diese ID
    gehoert seit dem Merge zu ``user_info``. Eine Installation, die den Branch
    schon ausprobiert hat, steht daher auf einer Revision, deren Inhalt sie
    nicht hat: die Docs-Tabellen sind da, die main-Migrationen dazwischen aber
    nicht gelaufen. Ohne Korrektur ueberspringt Alembic sie und laeuft beim
    Docs-Schema in ein DuplicateTable.

    Die Erkennung haengt bewusst nur an ``documents``: auf einer regulaeren
    main-Datenbank entsteht diese Tabelle erst mit ``20261029_01``; steht die
    Revision noch auf ``20261028_01``, kann sie nur aus dem alten Branch
    stammen. Die main-Migrationen sind idempotent und laufen danach nach.

    Die Revision wird auf den Stand davor gesetzt; die Docs-Migration ist
    idempotent und laesst vorhandene Dokumente stehen.
    """
    tabelle = set(inspect(engine).get_table_names())
    if "alembic_version" not in tabelle or "documents" not in tabelle:
        return
    with engine.begin() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if version != "20261028_01":
            return
        conn.execute(text("UPDATE alembic_version SET version_num = '20261024_01'"))
    logger.warning(
        "Alte Dokumente-Revision erkannt (20261028_01 mit vorhandenen Docs-Tabellen). "
        "Setze auf 20261024_01 zurueck und spiele main-Migrationen plus "
        "idempotente Docs-Migration nach."
    )


def _docs_revision_zuruecksetzen(engine: Engine, config: Config) -> None:
    """Löst eine Docs-Revision auf, die dieser Code nicht kennt.

    Wer den Dokumente-Branch ausprobiert und danach wieder main ausliefert,
    behält dessen Revision in ``alembic_version``. Alembic bricht dann schon
    beim Auflösen ab, bevor es die Tabellen sieht. Die Docs-Tabellen bleiben
    unangetastet; nur die Kennung geht auf den main-Stand zurück, an dem die
    Docs-Migration zuletzt angeknüpft hat.
    """
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables or "documents" not in tables:
        return
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    if not version:
        return
    bekannte = {
        revision.revision
        for revision in ScriptDirectory.from_config(config).walk_revisions()
    }
    if version in bekannte:
        return
    missing = _missing_model_schema(engine)
    if missing:
        raise RuntimeError(
            f"Datenbank steht auf unbekannter Revision {version}, "
            "aber das main-Schema ist unvollständig: " + ", ".join(missing[:8])
        )
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE alembic_version SET version_num = :stand"),
            {"stand": _MAIN_STAND_VOR_DOCS},
        )
    logger.warning(
        "Unbekannte Datenbank-Revision %s mit Docs-Schema; setze auf %s zurück. "
        "Docs-Tabellen bleiben erhalten.",
        version,
        _MAIN_STAND_VOR_DOCS,
    )


def initialize_or_upgrade_schema(engine: Engine) -> str:
    """Create/stamp a fresh schema or upgrade an already managed schema.

    An unversioned existing installation is accepted only if its schema exactly
    matches the current models. This prevents Alembic from stamping a partially
    migrated production database as healthy.
    """

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    app_tables = tables & {table.name for table in Base.metadata.sorted_tables}
    config = _alembic_config()

    if "alembic_version" not in tables:
        if not app_tables:
            Base.metadata.create_all(bind=engine)
        missing = _missing_model_schema(engine)
        if missing:
            preview = ", ".join(missing[:8])
            raise RuntimeError(
                "Bestehendes PostgreSQL-Schema ist nicht auf Phase-8-Stand: "
                f"{preview}. Führe zuerst den Legacy-Upgradepfad aus."
            )
        command.stamp(config, "head")
        return "initialized"

    _alte_docs_revision_zuruecksetzen(engine)
    _docs_revision_zuruecksetzen(engine, config)
    command.upgrade(config, "head")
    missing = _missing_model_schema(engine)
    if missing:
        raise RuntimeError(
            "Alembic-Upgrade unvollständig; fehlendes Schema: "
            + ", ".join(missing[:8])
        )
    return "upgraded"
