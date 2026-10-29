from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Iterable

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from models import (
    User,
    UserFriend,
    UserPresence,
    UserPresenceSession,
)
from services.sync_event_service import SyncEventService
from services.social.basis import _now

logger = logging.getLogger(__name__)

#: So lange gilt ein Geraet ohne Lebenszeichen noch als offen.
#:
#: Der Client meldet alle 45 Sekunden; zwei verpasste Meldungen (Netz, Standby)
#: sollen ihn nicht sofort als offline zeigen.
SITZUNG_FRIST_SEKUNDEN = 120

#: Sitzungen ohne Lebenszeichen werden nach dieser Zeit aus der Datenbank
#: entfernt. Die Anzeige wartet nur die kurze Frist ab; das hier ist Hygiene.
SITZUNG_AUFRAEUMEN_TAGE = 1

MANUELLE_STATI = ("auto", "online", "away", "invisible")


def _als_utc(zeit: datetime | None) -> datetime | None:
    if zeit is None:
        return None
    return zeit if zeit.tzinfo else zeit.replace(tzinfo=timezone.utc)


def _leer(manual: str = "auto", status: str = "offline") -> dict[str, Any]:
    return {
        "status": status,
        "manual_status": manual,
        "device_type": "web",
        "client": None,
        "activity_key": None,
        "updated_at": None,
    }


def _kern(presence: dict[str, Any] | None) -> tuple:
    """Was sich für andere sichtbar geändert hat. Für die Ereignis-Drosselung."""
    if not presence:
        return ()
    return (
        presence.get("status"),
        presence.get("device_type"),
        presence.get("client"),
        presence.get("activity_key"),
    )


def _sitzungen(
    db: Session, user_ids: Iterable[int], jetzt: datetime | None = None
) -> dict[int, list[UserPresenceSession]]:
    ids = [int(i) for i in user_ids]
    if not ids:
        return {}
    frist = (jetzt or _now()) - timedelta(seconds=SITZUNG_FRIST_SEKUNDEN)
    rows = (
        db.query(UserPresenceSession)
        .filter(
            UserPresenceSession.user_id.in_(ids),
            UserPresenceSession.last_seen_at >= frist,
        )
        .all()
    )
    gesammelt: dict[int, list[UserPresenceSession]] = {}
    for row in rows:
        gesammelt.setdefault(int(row.user_id), []).append(row)
    return gesammelt


def _vordere(sitzungen: list[UserPresenceSession]) -> UserPresenceSession | None:
    if not sitzungen:
        return None
    vorne = [s for s in sitzungen if s.vorn]
    kandidaten = vorne or sitzungen
    return max(
        kandidaten,
        key=lambda s: _als_utc(s.last_seen_at) or datetime.min.replace(tzinfo=timezone.utc),
    )


def _aggregat(
    sitzungen: list[UserPresenceSession],
    manual: str,
    *,
    selbst: bool = False,
) -> dict[str, Any]:
    if not sitzungen:
        # Ohne offenes Geraet ist niemand online — auch nicht, wenn die Wahl
        # "online" lautet. Die Wahl sagt nur, wie es *mit* Geraet aussieht.
        return _leer(manual, "invisible" if manual == "invisible" and selbst else "offline")

    vordere = _vordere(sitzungen)
    if manual == "invisible":
        if not selbst:
            return _leer(manual, "offline")
        status = "invisible"
    elif manual in ("online", "away"):
        status = manual
    else:
        status = "online" if any(s.zustand == "online" for s in sitzungen) else "away"

    return {
        "status": status,
        "manual_status": manual,
        "device_type": vordere.plattform if vordere else "web",
        "client": vordere.client if vordere else None,
        "activity_key": vordere.activity_key if vordere else None,
        "updated_at": max(
            (_als_utc(s.last_seen_at) for s in sitzungen if s.last_seen_at),
            default=None,
        ),
    }


def _manual(db: Session, user_id: int) -> str:
    pres = db.query(UserPresence).filter_by(user_id=user_id).first()
    return pres.manual_status if pres and pres.manual_status else "auto"


def _publiziere(
    cls: type,
    db: Session,
    user_id: int,
    vorher: dict[str, Any],
    nachher: dict[str, Any],
) -> None:
    """Meldet den Freunden, was sich sichtbar geaendert hat — nicht jedes Lebenszeichen."""
    if _kern(vorher) == _kern(nachher):
        return

    user_obj = db.query(User).filter_by(id=user_id).first()
    if not user_obj:
        return
    privacy = getattr(user_obj, "social_privacy", "friends")

    friend_rels = (
        db.query(UserFriend)
        .filter(
            or_(UserFriend.user_id == user_id, UserFriend.friend_id == user_id),
            UserFriend.status == "accepted",
        )
        .all()
    )
    empfaenger = {r.friend_id if r.user_id == user_id else r.user_id for r in friend_rels}
    if privacy == "public" and nachher.get("manual_status") != "invisible":
        # Ein oeffentliches Profil darf auch Abonnenten erreichen; die
        # Chatpartner standen hier bis Stufe 6b und sind nicht mehr noetig.
        empfaenger |= {sub.user_id for sub in SyncEventService._subscribers.values()}

    for viewer_id in empfaenger:
        if viewer_id == user_id:
            continue
        pres_for_viewer = cls.get_presence_for_viewer(db, viewer_id, user_obj)
        if pres_for_viewer is None:
            continue
        payload = dict(pres_for_viewer)
        if payload.get("updated_at") and hasattr(payload["updated_at"], "isoformat"):
            payload["updated_at"] = payload["updated_at"].isoformat()
        SyncEventService.publish(
            {
                "type": "friend_presence_updated",
                "friend_id": user_id,
                "user_id": user_id,
                "presence": payload,
            },
            user_id=viewer_id,
        )


class PraesenzMixin:
    @classmethod
    def get_presence(cls, db: Session, user_id: int) -> dict[str, Any]:
        """Der eigene Zustand: die Wahl und was die Geräte gerade tun."""
        manual = _manual(db, user_id)
        sitzungen = _sitzungen(db, [user_id]).get(int(user_id), [])
        return _aggregat(sitzungen, manual, selbst=True)

    @classmethod
    def get_presence_bulk(
        cls, db: Session, user_ids: Iterable[int]
    ) -> dict[int, dict[str, Any]]:
        """Zustände für eine Liste — eine Abfrage für alle Sitzungen.

        Unsichtbar ist auch hier offline; wer die Liste liest, ist Freund oder
        Betrachter eines öffentlichen Profils.
        """
        ids = [int(i) for i in user_ids]
        if not ids:
            return {}
        manuell = {
            int(p.user_id): (p.manual_status or "auto")
            for p in db.query(UserPresence).filter(UserPresence.user_id.in_(ids)).all()
        }
        sitzungen = _sitzungen(db, ids)
        ergebnis: dict[int, dict[str, Any]] = {}
        for uid in ids:
            ergebnis[uid] = _aggregat(sitzungen.get(uid, []), manuell.get(uid, "auto"))
        return ergebnis

    @classmethod
    def get_presence_for_viewer(
        cls, db: Session, viewer_user_id: int | None, target_user: User | int
    ) -> dict[str, Any] | None:
        """Ermittelt den Präsenzstatus unter strikter Einhaltung der 3-Stufen- und Maskierungsregeln.

        - Unsichtbar: unabhängig von Öffentlich/Freunde/Privat als ``offline`` maskiert.
        - Öffentlich: jeder sieht Status, Gerät und Aktivität.
        - Freunde: nur bestätigte Freunde sehen Details; für Fremde verborgen.
        - Privat: Nicht-Freunde sehen höchstens den reinen Online-Indikator.
        """
        if isinstance(target_user, int):
            user = db.query(User).filter_by(id=target_user).first()
            if not user:
                return _leer()
        else:
            user = target_user

        is_self = viewer_user_id is not None and viewer_user_id == user.id
        pres = cls.get_presence(db, user.id)
        if is_self:
            return pres

        # Blockierte Benutzer sehen niemals Präsenz- oder Statusdaten.
        if viewer_user_id:
            blocked = (
                db.query(UserFriend)
                .filter(
                    or_(
                        and_(UserFriend.user_id == viewer_user_id, UserFriend.friend_id == user.id),
                        and_(UserFriend.user_id == user.id, UserFriend.friend_id == viewer_user_id),
                    ),
                    UserFriend.status == "blocked",
                )
                .first()
            )
            if blocked:
                return None

        if pres["manual_status"] == "invisible":
            return _leer("invisible", "offline")

        privacy = getattr(user, "social_privacy", "friends")
        is_friend = cls.is_confirmed_friend(db, viewer_user_id, user.id) if viewer_user_id else False

        if privacy == "public" or is_friend:
            return pres

        if privacy == "friends":
            return None

        if privacy == "private":
            # Reiner Online-Indikator: kein Gerät, keine Aktivität, kein Zeitpunkt.
            return _leer(
                "", "offline" if pres["status"] == "offline" else ("away" if pres["status"] == "away" else "online")
            )

        return None

    # ── Schreiben ─────────────────────────────────────────────────────────

    @classmethod
    def set_manual_status(cls, db: Session, user_id: int, manual_status: str) -> dict[str, Any]:
        if manual_status not in MANUELLE_STATI:
            raise ValueError("Unbekannter Status")
        vorher = cls.get_presence(db, user_id)
        pres = db.query(UserPresence).filter_by(user_id=user_id).first()
        if not pres:
            pres = UserPresence(user_id=user_id, manual_status=manual_status, updated_at=_now())
            db.add(pres)
        else:
            pres.manual_status = manual_status
            pres.updated_at = _now()
        db.commit()
        nachher = cls.get_presence(db, user_id)
        _publiziere(cls, db, user_id, vorher, nachher)
        return nachher

    @classmethod
    def upsert_session(
        cls,
        db: Session,
        user_id: int,
        *,
        geraet: str,
        client: str,
        plattform: str,
        zustand: str,
        activity_key: str | None,
        vorn: bool,
    ) -> dict[str, Any]:
        """Ein Lebenszeichen. Dieselbe Zeile für dasselbe Gerät, nie eine neue."""
        vorher = cls.get_presence(db, user_id)
        jetzt = _now()
        sitzung = (
            db.query(UserPresenceSession)
            .filter_by(user_id=user_id, geraet=geraet)
            .first()
        )
        if not sitzung:
            sitzung = UserPresenceSession(
                user_id=user_id,
                geraet=geraet,
                client=client,
                plattform=plattform,
                zustand=zustand,
                activity_key=activity_key,
                vorn=vorn,
                last_seen_at=jetzt,
            )
            db.add(sitzung)
        else:
            sitzung.client = client
            sitzung.plattform = plattform
            sitzung.zustand = zustand
            sitzung.activity_key = activity_key
            sitzung.vorn = vorn
            sitzung.last_seen_at = jetzt
        db.commit()
        nachher = cls.get_presence(db, user_id)
        _publiziere(cls, db, user_id, vorher, nachher)
        return nachher

    @classmethod
    def delete_session(cls, db: Session, user_id: int, geraet: str) -> dict[str, Any]:
        vorher = cls.get_presence(db, user_id)
        db.query(UserPresenceSession).filter_by(user_id=user_id, geraet=geraet).delete()
        db.commit()
        nachher = cls.get_presence(db, user_id)
        _publiziere(cls, db, user_id, vorher, nachher)
        return nachher

    @classmethod
    def update_presence(cls, db: Session, user_id: int, data: dict[str, Any]) -> dict[str, Any]:
        """Altweg eines Clients, der noch die eine Zeile je Konto kennt.

        Bildet die Meldung auf eine Sitzung und die manuelle Wahl ab. Freie
        Aktivitätstexte werden verworfen; die Anzeige übersetzt nur Schlüssel.
        """
        status = data.get("status", "online")
        plattform = data.get("device_type") or "web"

        if status == "invisible":
            return cls.set_manual_status(db, user_id, "invisible")

        # Früher hob jede „online“-Meldung ein Unsichtbar auf; für einen alten
        # Client bleibt das so. Die Automatik greift danach wieder.
        neu_manuell = "away" if status == "away" else "auto"
        pres = db.query(UserPresence).filter_by(user_id=user_id).first()
        if pres is None or pres.manual_status != neu_manuell:
            cls.set_manual_status(db, user_id, neu_manuell)

        return cls.upsert_session(
            db,
            user_id,
            geraet=f"legacy-{plattform}",
            client="web",
            plattform=plattform,
            zustand="away" if status == "away" else "online",
            activity_key=None,
            vorn=True,
        )

    @classmethod
    def cleanup_stale_sessions(cls, db: Session) -> int:
        frist = _now() - timedelta(days=SITZUNG_AUFRAEUMEN_TAGE)
        geloescht = (
            db.query(UserPresenceSession)
            .filter(UserPresenceSession.last_seen_at < frist)
            .delete(synchronize_session=False)
        )
        if geloescht:
            db.commit()
        return int(geloescht or 0)

    @classmethod
    def broadcast_user_joined(cls, db: Session, user_id: int, user_username: str) -> None:
        """Broadcastet ein user_joined Event unter strikter Einhaltung des Ghost-Mode und der Privatsphäre."""
        pres = cls.get_presence(db, user_id)

        # Ghost-Mode: Wenn unsichtbar, niemals an irgendwen broadcasten!
        if pres.get("manual_status") == "invisible":
            return

        rels = (
            db.query(UserFriend)
            .filter(
                or_(UserFriend.user_id == user_id, UserFriend.friend_id == user_id),
                UserFriend.status == "accepted",
            )
            .all()
        )
        target_user_ids = {r.friend_id if r.user_id == user_id else r.user_id for r in rels}

        # Blockierte Benutzer niemals benachrichtigen (Datenschutz-Invariante)
        blocked_rels = (
            db.query(UserFriend)
            .filter(
                or_(UserFriend.user_id == user_id, UserFriend.friend_id == user_id),
                UserFriend.status == "blocked",
            )
            .all()
        )
        blocked_user_ids = {r.friend_id if r.user_id == user_id else r.user_id for r in blocked_rels}
        target_user_ids -= blocked_user_ids

        for target_id in target_user_ids:
            SyncEventService.publish(
                {
                    "type": "user_joined",
                    "user_id": user_id,
                    "username": user_username,
                },
                user_id=target_id,
            )
