import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from database import SessionLocal
from models import PanelSetting
from models.login_challenge import LoginChallenge, hash_challenge_token

#: Zweck des Einmal-Nachweises zur Localhost-Freigabe (Befund 46).
LOCALHOST_FREIGABE_ZWECK = "localhost_freigabe"
#: Wie lange der Bestätigungs-Link gilt (Muster: Passwort-Link).
LOCALHOST_FREIGABE_STUNDEN = 1


class PanelSettingsService:
    """Panel-Einstellungen aus der Datenbank mit In-Memory-Cache.

    DB-Werte haben Vorrang vor Umgebungsvariablen.
    """

    _cache: dict[str, str] = {}
    _cache_loaded: bool = False

    @classmethod
    def _load_cache(cls, db: Session | None = None) -> None:
        if cls._cache_loaded:
            return
        if db is not None:
            for row in db.query(PanelSetting).all():
                cls._cache[row.key] = row.value
            cls._cache_loaded = True
            return
        db_session = SessionLocal()
        try:
            for row in db_session.query(PanelSetting).all():
                cls._cache[row.key] = row.value
            cls._cache_loaded = True
        finally:
            db_session.close()

    @classmethod
    def get(cls, key: str, default: str = "", db: Session | None = None) -> str:
        cls._load_cache(db)
        return cls._cache.get(key, default)

    @classmethod
    def set(cls, key: str, value: str, db: Session | None = None) -> None:
        cls._cache[key] = value
        if db is not None:
            row = db.query(PanelSetting).filter_by(key=key).first()
            if row:
                row.value = value
            else:
                db.add(PanelSetting(key=key, value=value))
            return
        db_session = SessionLocal()
        try:
            row = db_session.query(PanelSetting).filter_by(key=key).first()
            if row:
                row.value = value
            else:
                db_session.add(PanelSetting(key=key, value=value))
            db_session.commit()
        finally:
            db_session.close()

    @classmethod
    def get_all(cls, db: Session | None = None) -> dict[str, str]:
        cls._load_cache(db)
        return dict(cls._cache)

    @classmethod
    def delete(cls, key: str, db: Session | None = None) -> None:
        cls._cache.pop(key, None)
        if db is not None:
            row = db.query(PanelSetting).filter_by(key=key).first()
            if row:
                db.delete(row)
            return
        db_session = SessionLocal()
        try:
            row = db_session.query(PanelSetting).filter_by(key=key).first()
            if row:
                db_session.delete(row)
                db_session.commit()
        finally:
            db_session.close()

    @classmethod
    def invalidate_cache(cls) -> None:
        cls._cache_loaded = False
        cls._cache.clear()

    # ── Localhost-Freigabe per Einmal-Link (Befund 46) ─────────────────────

    @classmethod
    def localhost_freigabe_anfordern(cls, db: Session, user_id: int) -> str:
        """Legt einen Einmal-Nachweis an und gibt den Klartext-Token zurück.

        Der Token reist nur per E-Mail; gespeichert wird nur der Hash.
        Committet selbst, damit der Link auch dann gilt, wenn der Aufrufer
        danach mit 403 abbricht.
        """
        token = secrets.token_urlsafe(32)
        db.add(LoginChallenge(
            token_hash=hash_challenge_token(token),
            purpose=LOCALHOST_FREIGABE_ZWECK,
            user_id=user_id,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=LOCALHOST_FREIGABE_STUNDEN),
        ))
        db.commit()
        return token

    @classmethod
    def localhost_freigabe_bestaetigen(cls, db: Session, user_id: int, token: str) -> bool:
        """Verbraucht den Einmal-Nachweis und schaltet die Freigabe ein.

        Genau einmal: ein bedingtes UPDATE belegt den Nachweis, ein zweiter
        Aufruf mit demselben Link findet ihn schon verbraucht. Bei Erfolg
        steht der Schalter und der Audit-Eintrag in derselben Transaktion.
        """
        from services import audit_service

        treffer = (
            db.query(LoginChallenge)
            .filter(
                LoginChallenge.token_hash == hash_challenge_token(token),
                LoginChallenge.purpose == LOCALHOST_FREIGABE_ZWECK,
                LoginChallenge.user_id == user_id,
            )
            .first()
        )
        if treffer is None:
            return False
        jetzt = datetime.now(timezone.utc)
        abgelaufen = treffer.expires_at
        if abgelaufen.tzinfo is None:
            abgelaufen = abgelaufen.replace(tzinfo=timezone.utc)
        if abgelaufen <= jetzt:
            return False
        belegt = (
            db.query(LoginChallenge)
            .filter(LoginChallenge.id == treffer.id, LoginChallenge.consumed_at.is_(None))
            .update({"consumed_at": jetzt}, synchronize_session=False)
        )
        if not belegt:
            return False
        cls.set("allow_localhost_connections", "true", db=db)
        audit_service.record_privileged_action(
            db,
            user_id=user_id,
            action="panel.settings.localhost.confirm",
            target_type="setting",
            target_id="allow_localhost_connections",
            details={"via": "email-link"},
            commit=True,
        )
        return True


def docs_enabled() -> bool:
    """Ob das Dokumente-Modul eingeschaltet ist — die einzige Wahrheit.

    Alle Vergleichsstellen nutzen sie, damit "an" ueberall dasselbe heisst:
    Vorgabe an, nur der gespeicherte Wert "false" schaltet ab (Befund 18).
    """
    return PanelSettingsService.get("docs_enabled", "true") != "false"


