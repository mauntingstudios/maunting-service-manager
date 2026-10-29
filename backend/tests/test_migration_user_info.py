"""Die Info-Tabelle kommt hin und wieder weg."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from database import Base
import models  # noqa: F401


def _alembic(backend_dir: Path) -> Config:
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


def test_user_infos_kommt_hin_und_wieder_weg(pg_wegwerf, monkeypatch):
    db_url = pg_wegwerf("user-info")
    from config import settings

    monkeypatch.setattr(settings, "database_url", db_url)
    engine = create_engine(db_url)
    cfg = _alembic(Path(__file__).resolve().parent.parent)

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(__import__("sqlalchemy").text("DROP TABLE IF EXISTS user_infos"))

    command.stamp(cfg, "20261027_02")
    assert "user_infos" not in inspect(engine).get_table_names()

    command.upgrade(cfg, "20261028_01")
    spalten = {c["name"] for c in inspect(engine).get_columns("user_infos")}
    assert {"user_id", "text", "visibility", "expires_at", "updated_at"} <= spalten

    command.downgrade(cfg, "20261027_02")
    assert "user_infos" not in inspect(engine).get_table_names()
