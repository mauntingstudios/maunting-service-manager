from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from models import (
    User,
    UserFriend,
    UserInfo,
)
from services.achievement_service import AchievementService
from services.social.basis import _now

logger = logging.getLogger(__name__)


#: So lang darf eine Info sein (WhatsApp: 139 Zeichen).
INFO_MAX_ZEICHEN = 139
#: Hoechste Frist: ein Jahr. 0 heisst „fuer immer“.
INFO_DAUER_MAX_SEKUNDEN = 365 * 24 * 3600
INFO_SICHTBARKEITEN = ("friends", "public", "nobody")


def _info_dict(zeile: UserInfo) -> dict[str, Any]:
    return {
        "text": zeile.text,
        "visibility": zeile.visibility,
        "expires_at": zeile.expires_at,
        "updated_at": zeile.updated_at,
    }


def _info_gueltig(zeile: UserInfo | None, jetzt: datetime | None = None) -> bool:
    if zeile is None:
        return False
    if zeile.expires_at is None:
        return True
    ablauf = zeile.expires_at if zeile.expires_at.tzinfo else zeile.expires_at.replace(tzinfo=timezone.utc)
    return ablauf > (jetzt or _now())


class ProfilMixin:
    @classmethod
    def update_privacy(cls, db: Session, user_id: int, privacy: str) -> str:
        """Setzt die 3-Stufen Privatsphäre: 'private', 'friends', 'public'."""
        if privacy not in ("private", "friends", "public"):
            raise HTTPException(status_code=400, detail="Ungültige Privatsphäre-Einstellung")
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
        user.social_privacy = privacy
        db.commit()
        return user.social_privacy

    # ── Info (freiwilliger Text) ─────────────────────────────────────────

    @classmethod
    def get_own_info(cls, db: Session, user_id: int) -> dict[str, Any] | None:
        zeile = db.query(UserInfo).filter_by(user_id=user_id).first()
        return _info_dict(zeile) if _info_gueltig(zeile) else None

    @classmethod
    def set_info(
        cls,
        db: Session,
        user_id: int,
        *,
        text: str,
        visibility: str,
        dauer_sekunden: int,
    ) -> dict[str, Any] | None:
        """Setzt oder loescht die Info. Leerer Text loescht die Zeile."""
        if visibility not in INFO_SICHTBARKEITEN:
            raise HTTPException(status_code=400, detail="Ungueltige Sichtbarkeit.")
        if dauer_sekunden < 0 or dauer_sekunden > INFO_DAUER_MAX_SEKUNDEN:
            raise HTTPException(status_code=400, detail="Ungueltige Dauer.")

        sauber = (text or "").strip()[:INFO_MAX_ZEICHEN]
        zeile = db.query(UserInfo).filter_by(user_id=user_id).first()

        if not sauber:
            if zeile is not None:
                db.delete(zeile)
                db.commit()
            return None

        if zeile is None:
            zeile = UserInfo(user_id=user_id, text=sauber)
            db.add(zeile)
        zeile.text = sauber
        zeile.visibility = visibility
        zeile.expires_at = (
            _now() + timedelta(seconds=dauer_sekunden) if dauer_sekunden > 0 else None
        )
        zeile.updated_at = _now()
        db.commit()
        db.refresh(zeile)
        return _info_dict(zeile)

    @classmethod
    def info_fuer_viewer(
        cls,
        db: Session,
        viewer_user_id: int | None,
        target_user: User | int,
        *,
        ist_freund: bool | None = None,
    ) -> dict[str, Any] | None:
        """Die Info, wie sie dieser Betrachter sehen darf.

        ``nobody`` nur fuer das eigene Konto, ``friends`` nur fuer bestaetigte
        Freunde, ``public`` fuer jeden, der das Profil sehen darf. Abgelaufene
        Zeilen zaehlen nicht. Blockierte prueft der Aufrufer.
        """
        ziel_id = target_user if isinstance(target_user, int) else target_user.id
        if viewer_user_id is not None and viewer_user_id == ziel_id:
            return cls.get_own_info(db, ziel_id)

        zeile = db.query(UserInfo).filter_by(user_id=ziel_id).first()
        if not _info_gueltig(zeile):
            return None
        if zeile.visibility == "nobody":
            return None
        if zeile.visibility == "friends":
            if ist_freund is None:
                ist_freund = bool(viewer_user_id) and cls.is_confirmed_friend(
                    db, viewer_user_id, ziel_id
                )
            if not ist_freund:
                return None
        return _info_dict(zeile)

    @classmethod
    def infos_fuer(
        cls, db: Session, viewer_user_id: int | None, ziele: dict[int, bool]
    ) -> dict[int, dict[str, Any]]:
        """Infos fuer eine Liste — eine Abfrage, je Ziel mit Freund-Marke.

        ``ziele`` bildet Konto auf „ist mit dem Betrachter befreundet“ ab.
        """
        ids = [int(i) for i in ziele]
        if not ids:
            return {}
        jetzt = _now()
        ergebnis: dict[int, dict[str, Any]] = {}
        for zeile in db.query(UserInfo).filter(UserInfo.user_id.in_(ids)).all():
            if not _info_gueltig(zeile, jetzt):
                continue
            if zeile.visibility == "nobody":
                continue
            if zeile.visibility == "friends" and not ziele.get(int(zeile.user_id), False):
                continue
            ergebnis[int(zeile.user_id)] = _info_dict(zeile)
        return ergebnis

    @classmethod
    def cleanup_expired_infos(cls, db: Session) -> int:
        jetzt = _now()
        geloescht = (
            db.query(UserInfo)
            .filter(UserInfo.expires_at.is_not(None), UserInfo.expires_at <= jetzt)
            .delete(synchronize_session=False)
        )
        if geloescht:
            db.commit()
        return int(geloescht or 0)

    @classmethod
    def get_profile(
        cls,
        db: Session,
        viewer_user_id: int | None,
        target_user: User,
        *,
        mit_erfolgen: bool = True,
    ) -> dict[str, Any]:
        """Liefert das Benutzerprofil unter Berücksichtigung des 3-Stufen-Modells.

        ``mit_erfolgen=False`` laesst Zahlen und Erfolge weg (``None``). Die
        Liste der oeffentlichen Profile zeigt nur Name, Bild und Status, und
        die Erfolge kosteten dort je Profil mehrere Abfragen, alle 15 Sekunden.
        """
        is_self = viewer_user_id is not None and viewer_user_id == target_user.id
        privacy = getattr(target_user, "social_privacy", "friends")
        is_friend = cls.is_confirmed_friend(db, viewer_user_id, target_user.id) if viewer_user_id else False

        # Blockierung prüfen
        if viewer_user_id and viewer_user_id != target_user.id:
            blocked = (
                db.query(UserFriend)
                .filter(
                    or_(
                        and_(UserFriend.user_id == viewer_user_id, UserFriend.friend_id == target_user.id),
                        and_(UserFriend.user_id == target_user.id, UserFriend.friend_id == viewer_user_id),
                    ),
                    UserFriend.status == "blocked",
                )
                .first()
            )
            if blocked:
                return {
                    "user_id": target_user.id,
                    "username": target_user.username,
                    "avatar_url": None,
                    "privacy": privacy,
                    "restricted": True,
                    "is_friend": False,
                    "presence": None,
                    "info": None,
                    "stats": None,
                    "achievements": None,
                }

        allowed = False
        if is_self or privacy == "public":
            allowed = True
        elif privacy == "friends" and viewer_user_id:
            allowed = is_friend

        if not allowed:
            return {
                "user_id": target_user.id,
                "username": target_user.username,
                "avatar_url": target_user.avatar_url,
                "privacy": privacy,
                "restricted": True,
                "is_friend": is_friend,
                "presence": None,
                "info": None,
                "stats": None,
                "achievements": None,
            }

        pres_data = cls.get_presence_for_viewer(db, viewer_user_id, target_user)
        stats = None
        achievements = None
        if mit_erfolgen:
            stats = AchievementService.get_user_stats(db, target_user.id, fuer_fremde=not is_self)
            achievements = AchievementService.get_user_achievements(
                db, target_user.id, fuer_fremde=not is_self, pruefen=False
            )

        return {
            "user_id": target_user.id,
            "username": target_user.username,
            "avatar_url": target_user.avatar_url,
            "privacy": privacy,
            "restricted": False,
            "is_friend": is_friend,
            # Nur der Tag: die Uhrzeit der Registrierung sagt niemandem etwas.
            "member_since": target_user.created_at.date() if target_user.created_at else None,
            "presence": pres_data,
            "info": cls.info_fuer_viewer(
                db, viewer_user_id, target_user, ist_freund=is_friend
            ),
            "stats": stats,
            "achievements": achievements,
        }

    @classmethod
    def get_public_profiles(
        cls,
        db: Session,
        viewer_user_id: int | None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Ermittelt alle aktiven Benutzer mit öffentlichem Profil ('public') für die Discovery.

        Zwingend auf DB-/Query-Ebene: Profile mit 'friends' oder 'private' tauchen NIEMALS auf.
        """
        query = db.query(User).filter(
            User.is_active.is_(True),
            User.social_privacy == "public",
        )
        if viewer_user_id:
            query = query.filter(User.id != viewer_user_id)
            blocked_rels = (
                db.query(UserFriend)
                .filter(
                    or_(UserFriend.user_id == viewer_user_id, UserFriend.friend_id == viewer_user_id),
                    UserFriend.status == "blocked",
                )
                .all()
            )
            blocked_ids = {r.friend_id if r.user_id == viewer_user_id else r.user_id for r in blocked_rels}
            if blocked_ids:
                query = query.filter(User.id.notin_(blocked_ids))

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(User.username.ilike(term))

        users = query.order_by(User.username.asc()).offset(offset).limit(limit).all()
        results = []
        for u in users:
            results.append(cls.get_profile(db, viewer_user_id, u, mit_erfolgen=False))
        return results
