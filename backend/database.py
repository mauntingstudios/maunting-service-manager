from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from config import settings
from database_policy import validate_panel_database_url

_db_url = validate_panel_database_url(settings.database_url)
_connect_args: dict = {}
if "postgresql" in _db_url and int(getattr(settings, "db_statement_timeout_ms", 0)) > 0:
    _connect_args["options"] = f"-c statement_timeout={int(settings.db_statement_timeout_ms)}"

engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    pool_size=max(1, int(getattr(settings, "db_pool_size", 5))),
    max_overflow=max(0, int(getattr(settings, "db_max_overflow", 10))),
    pool_timeout=max(5, int(getattr(settings, "db_pool_timeout", 30))),
    pool_recycle=max(60, int(getattr(settings, "db_pool_recycle", 1800))),
    connect_args=_connect_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()
