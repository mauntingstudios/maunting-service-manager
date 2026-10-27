"""Die Migration der Praesenzsitzungen.

Geprueft wird der Weg von `20261027_01` auf `20261027_02` und zurueck:
*vor* dem Schritt gibt es die Sitzungstabelle nicht und die Praesenzzeile traegt
noch `status`/`device_type`; *danach* traegt sie `manual_status`, die alten
Spalten sind weg, und die Sitzungstabelle steht. Ein vorhandenes „unsichtbar“
muss die Umstellung ueberleben, und der Rueckweg muss die Spalten wieder
herstellen.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from database import Base
import models  # noqa: F401


def _alembic(backend_dir: Path) -> Config:
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


ALTE_SPALTEN = ("status", "device_type", "custom_status", "activity_label", "activity_detail")


def test_praesenz_wird_je_geraet_und_mit_wahl_umgestellt(pg_wegwerf, monkeypatch):
    db_url = pg_wegwerf("praesenz")
    from config import settings

    monkeypatch.setattr(settings, "database_url", db_url)
    engine = create_engine(db_url)
    cfg = _alembic(Path(__file__).resolve().parent.parent)

    # Den alten Stand herstellen: neue Metadaten anlegen, dann Sitzungstabelle
    # und `manual_status` entfernen und die alten Spalten zurueckholen.
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS user_presence_sessions"))
        conn.execute(text("ALTER TABLE user_presences DROP COLUMN manual_status"))
        for spalte, typ in (
            ("status", "VARCHAR(16) NOT NULL DEFAULT 'online'"),
            ("device_type", "VARCHAR(16) NOT NULL DEFAULT 'web'"),
            ("custom_status", "VARCHAR(128)"),
            ("activity_label", "VARCHAR(128)"),
            ("activity_detail", "VARCHAR(128)"),
        ):
            conn.execute(text(f"ALTER TABLE user_presences ADD COLUMN {spalte} {typ}"))

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (username, password_hash, is_owner, is_active, email_verified, "
                "two_factor_enabled, email_notifications, social_privacy, created_at) "
                "VALUES ('migrationsprobe', 'x', false, true, false, false, false, 'friends', now())"
            )
        )
        conn.execute(
            text(
                "INSERT INTO user_presences (user_id, status, device_type, updated_at) "
                "SELECT id, 'invisible', 'mobile', now() FROM users WHERE username = 'migrationsprobe'"
            )
        )

    command.stamp(cfg, "20261027_01")
    command.upgrade(cfg, "20261027_02")

    inspector = inspect(engine)
    assert "user_presence_sessions" in inspector.get_table_names()
    spalten = {c["name"] for c in inspector.get_columns("user_presences")}
    assert "manual_status" in spalten
    for alt in ALTE_SPALTEN:
        assert alt not in spalten, alt

    with engine.connect() as conn:
        wahl = conn.execute(
            text(
                "SELECT p.manual_status FROM user_presences p "
                "JOIN users u ON u.id = p.user_id WHERE u.username = 'migrationsprobe'"
            )
        ).scalar_one()
    assert wahl == "invisible"

    # Der Rueckweg stellt die alten Spalten wieder her und nimmt die Tabelle mit.
    command.downgrade(cfg, "20261027_01")

    inspector = inspect(engine)
    assert "user_presence_sessions" not in inspector.get_table_names()
    spalten = {c["name"] for c in inspector.get_columns("user_presences")}
    for alt in ALTE_SPALTEN:
        assert alt in spalten, alt
    assert "manual_status" not in spalten

    with engine.connect() as conn:
        status = conn.execute(
            text(
                "SELECT p.status FROM user_presences p "
                "JOIN users u ON u.id = p.user_id WHERE u.username = 'migrationsprobe'"
            )
        ).scalar_one()
    assert status == "invisible"
