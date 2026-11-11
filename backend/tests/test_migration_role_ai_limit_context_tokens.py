"""Die Spalte für den Anfragedeckel je Rolle.

Geprüft wird die Strecke von `20261111_01` auf `20261111_02` und zurück: vor
dem Schritt trägt `role_ai_limits` die Spalte nicht, danach schon, und der
Rückweg entfernt sie wieder. Eine bestehende Rolle bekommt dabei keinen Wert —
``NULL`` heißt „nichts hinterlegt“, und dann gilt weiter der Standarddeckel.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from database import Base
import models  # noqa: F401

SPALTE = "max_context_tokens"


def _alembic(backend_dir: Path) -> Config:
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


def _spalten(db_url: str) -> set[str]:
    return {spalte["name"] for spalte in inspect(create_engine(db_url)).get_columns("role_ai_limits")}


def test_der_anfragedeckel_bekommt_seine_spalte_und_gibt_sie_wieder_her(pg_wegwerf, monkeypatch):
    db_url = pg_wegwerf("kontextdeckel")
    from config import settings

    monkeypatch.setattr(settings, "database_url", db_url)
    engine = create_engine(db_url)
    cfg = _alembic(Path(__file__).resolve().parent.parent)

    # Den Stand vor der Migration herstellen: Metadaten anlegen, die neue Spalte
    # wieder entfernen und Alembic auf die Vorgaengerrevision stempeln.
    Base.metadata.create_all(bind=engine)
    assert SPALTE in _spalten(db_url), (
        "Das Modell kennt die Spalte nicht — dann prueft dieser Test die falsche Seite."
    )
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE role_ai_limits DROP COLUMN {SPALTE}"))
        conn.execute(
            text(
                "INSERT INTO roles (name, description, color, is_system, created_at) "
                "VALUES ('deckel-probe', NULL, '#3b82f6', false, now())"
            )
        )
    command.stamp(cfg, "20261111_01")

    command.upgrade(cfg, "20261111_02")

    assert SPALTE in _spalten(db_url)
    with engine.connect() as conn:
        wert = conn.execute(text(f"SELECT {SPALTE} FROM role_ai_limits")).scalar()
    assert wert is None, "Bestandsrollen duerfen keinen Deckel bekommen — NULL heisst Standard."

    command.downgrade(cfg, "20261111_01")
    assert SPALTE not in _spalten(db_url)

    # Und noch einmal hoch: die Migration muss wiederholbar sein, ohne dass die
    # Datenbank aus `create_all` dabei stolpert.
    command.upgrade(cfg, "20261111_02")
    assert SPALTE in _spalten(db_url)
