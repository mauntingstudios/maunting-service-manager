"""Praesenz: eine Wahl je Konto, ein Lebenszeichen je Geraet.

Die Fehlerklasse bis 27.10.2026: eine Zeile je Konto, letzte Meldung gewinnt.
Ein versteckter Tab nahm einem sichtbaren das "online" weg, ein zweites Geraet
hob ein "unsichtbar" auf, und ohne Meldung galt ein aktiver Nutzer nach zwei
Minuten als offline. Hier stehen die Faelle, die das verhindern.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from models import User, UserFriend, UserPresenceSession
from services.social_service import SocialService


def _befreunden(db: Session, a: User, b: User) -> None:
    db.add(UserFriend(user_id=a.id, friend_id=b.id, status="accepted"))
    db.commit()


def _sitzung(
    db: Session,
    user_id: int,
    *,
    geraet: str = "geraet-eins",
    client: str = "web",
    plattform: str = "web",
    zustand: str = "online",
    activity_key: str | None = "chat",
    vorn: bool = True,
) -> dict:
    return SocialService.upsert_session(
        db,
        user_id,
        geraet=geraet,
        client=client,
        plattform=plattform,
        zustand=zustand,
        activity_key=activity_key,
        vorn=vorn,
    )


def _altern(db: Session, user_id: int, geraet: str, sekunden: int) -> None:
    sitzung = db.query(UserPresenceSession).filter_by(user_id=user_id, geraet=geraet).one()
    sitzung.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=sekunden)
    db.commit()


def test_die_vordere_sitzung_liefert_plattform_und_aktivitaet(db: Session, owner_user: User, regular_user: User):
    _befreunden(db, owner_user, regular_user)

    _sitzung(db, owner_user.id, geraet="web-eins", client="web", plattform="web", activity_key="chat", vorn=False)
    _sitzung(db, owner_user.id, geraet="mss-eins", client="mss", plattform="desktop", activity_key="server", vorn=True)

    pres = SocialService.get_presence_for_viewer(db, regular_user.id, owner_user)
    assert pres is not None
    assert pres["status"] == "online"
    assert pres["client"] == "mss"
    assert pres["device_type"] == "desktop"
    assert pres["activity_key"] == "server"


def test_ein_versteckter_tab_nimmt_dem_sichtbaren_das_online_nicht(db: Session, owner_user: User, regular_user: User):
    _befreunden(db, owner_user, regular_user)

    _sitzung(db, owner_user.id, geraet="mss-eins", client="mss", plattform="desktop", vorn=True)
    _sitzung(db, owner_user.id, geraet="web-eins", client="web", plattform="web", zustand="away", vorn=False)

    assert SocialService.get_presence(db, owner_user.id)["status"] == "online"

    # Nun ist auch das vordere Geraet abwesend: erst dann ist niemand mehr da.
    _sitzung(db, owner_user.id, geraet="mss-eins", client="mss", plattform="desktop", zustand="away")
    assert SocialService.get_presence(db, owner_user.id)["status"] == "away"


def test_manuelle_wahl_gewinnt_gegen_die_sitzungen(db: Session, owner_user: User):
    _sitzung(db, owner_user.id)

    SocialService.set_manual_status(db, owner_user.id, "away")
    assert SocialService.get_presence(db, owner_user.id)["status"] == "away"

    # „online“ bleibt online, auch wenn das Geraet nichts tut.
    _sitzung(db, owner_user.id, zustand="away")
    SocialService.set_manual_status(db, owner_user.id, "online")
    assert SocialService.get_presence(db, owner_user.id)["status"] == "online"

    # Zurueck auf Automatik: die Sitzung entscheidet wieder.
    SocialService.set_manual_status(db, owner_user.id, "auto")
    assert SocialService.get_presence(db, owner_user.id)["status"] == "away"


def test_ohne_geraet_ist_niemand_online_auch_nicht_mit_wahl_online(db: Session, owner_user: User):
    SocialService.set_manual_status(db, owner_user.id, "online")
    pres = SocialService.get_presence(db, owner_user.id)
    assert pres["status"] == "offline"
    assert pres["client"] is None


def test_unsichtbar_bleibt_trotz_zweitem_geraet(db: Session, owner_user: User, regular_user: User):
    _befreunden(db, owner_user, regular_user)
    _sitzung(db, owner_user.id, geraet="web-eins")
    SocialService.set_manual_status(db, owner_user.id, "invisible")

    # Ein zweites Geraet meldet sich: das darf das Unsichtbar nicht aufheben.
    _sitzung(db, owner_user.id, geraet="mss-eins", client="mss", plattform="desktop")

    pres = SocialService.get_presence_for_viewer(db, regular_user.id, owner_user)
    assert pres["status"] == "offline"
    assert pres["client"] is None
    assert pres["activity_key"] is None

    # Das eigene Konto sieht die Wahl weiterhin.
    assert SocialService.get_presence(db, owner_user.id)["status"] == "invisible"


def test_abgelaufenes_lebenszeichen_macht_offline_ohne_plattform(db: Session, owner_user: User):
    _sitzung(db, owner_user.id, client="mss", plattform="desktop", activity_key="server")
    _altern(db, owner_user.id, "geraet-eins", 200)

    pres = SocialService.get_presence(db, owner_user.id)
    assert pres["status"] == "offline"
    assert pres["client"] is None
    assert pres["device_type"] == "web"
    assert pres["activity_key"] is None


def test_der_altweg_meldet_eine_sitzung(db: Session, owner_user: User):
    SocialService.update_presence(db, owner_user.id, {"status": "online", "device_type": "mobile"})

    sitzung = db.query(UserPresenceSession).filter_by(user_id=owner_user.id).one()
    assert sitzung.plattform == "mobile"
    assert sitzung.vorn is True

    pres = SocialService.get_presence(db, owner_user.id)
    assert pres["status"] == "online"
    assert pres["device_type"] == "mobile"

    # Der Altweg hob frueher ein Unsichtbar auf; das bleibt so.
    SocialService.set_manual_status(db, owner_user.id, "invisible")
    SocialService.update_presence(db, owner_user.id, {"status": "online"})
    assert SocialService.get_presence(db, owner_user.id)["manual_status"] == "auto"


def test_freundesliste_zeigt_offline_ohne_aktivitaet(db: Session, owner_user: User, regular_user: User):
    _befreunden(db, owner_user, regular_user)
    _sitzung(db, regular_user.id, client="mss", plattform="desktop", activity_key="server")
    _altern(db, regular_user.id, "geraet-eins", 200)

    eintrag = next(f for f in SocialService.get_friends(db, owner_user.id) if f["user_id"] == regular_user.id)
    assert eintrag["presence"]["status"] == "offline"
    assert eintrag["presence"]["activity_key"] is None
    assert eintrag["presence"]["client"] is None


def test_freundesliste_zeigt_keine_details_eines_unsichtbaren(db: Session, owner_user: User, regular_user: User):
    _befreunden(db, owner_user, regular_user)
    _sitzung(db, regular_user.id, client="mss", plattform="desktop", activity_key="server")
    SocialService.set_manual_status(db, regular_user.id, "invisible")

    eintrag = next(f for f in SocialService.get_friends(db, owner_user.id) if f["user_id"] == regular_user.id)
    assert eintrag["presence"]["status"] == "offline"
    assert eintrag["presence"]["client"] is None


def test_alte_sitzungen_werden_aufgeraeumt(db: Session, owner_user: User):
    _sitzung(db, owner_user.id)
    _altern(db, owner_user.id, "geraet-eins", 2 * 24 * 3600)

    assert SocialService.cleanup_stale_sessions(db) == 1
    assert db.query(UserPresenceSession).filter_by(user_id=owner_user.id).count() == 0


def test_ein_gleichbleibender_zustand_erzeugt_kein_ereignis(db: Session, owner_user: User, regular_user: User):
    """Das Lebenszeichen alle 45 s darf die Ereignisleitung nicht fluten."""
    from services.sync_event_service import SyncEventService

    empfaenger = regular_user
    _befreunden(db, owner_user, empfaenger)
    conn, queue = SyncEventService.subscribe(user_id=empfaenger.id)
    try:
        _sitzung(db, owner_user.id, activity_key="chat")
        assert not queue.empty()
        queue.get_nowait()

        # Dasselbe Lebenszeichen noch einmal: nichts Neues fuer den Betrachter.
        _sitzung(db, owner_user.id, activity_key="chat")
        assert queue.empty()
    finally:
        SyncEventService.unsubscribe(conn)


def test_unbekannte_manuelle_wahl_wird_abgewiesen(db: Session, owner_user: User):
    # Das Schema begrenzt den Wert; der Dienst prueft ihn zusaetzlich.
    with pytest.raises(ValueError):
        SocialService.set_manual_status(db, owner_user.id, "kaputt")
