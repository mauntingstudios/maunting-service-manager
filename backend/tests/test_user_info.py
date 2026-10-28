"""Die freiwillige Info: Sichtbarkeit, Ablauf und Chiffrat.

Entschieden am 27.10.2026: Freunde / Oeffentlich / Niemand, Fristen von einer
Stunde bis „fuer immer“. Der Server setzt beides durch, ohne den Text zu
brauchen; in der Datenbank steht er nur verschluesselt.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import User, UserFriend, UserInfo
from services.dis_client import DisClient
from services.social_service import SocialService
from services.sync_event_service import SyncEventService


def _befreunden(db: Session, a: User, b: User) -> None:
    db.add(UserFriend(user_id=a.id, friend_id=b.id, status="accepted"))
    db.commit()


def _info(db: Session, user: User, *, text_wert: str = "Im Feierabend", visibility: str = "friends", dauer: int = 3600):
    return SocialService.set_info(
        db, user.id, text=text_wert, visibility=visibility, dauer_sekunden=dauer
    )


def test_setzt_liest_und_loescht_die_eigene_info(db: Session, owner_user: User):
    gesetzt = _info(db, owner_user, text_wert="  Im Feierabend  ")
    assert gesetzt["text"] == "Im Feierabend"
    assert gesetzt["visibility"] == "friends"
    assert gesetzt["expires_at"] is not None

    gelesen = SocialService.get_own_info(db, owner_user.id)
    assert gelesen["text"] == "Im Feierabend"

    # Leerer Text loescht die Zeile.
    assert _info(db, owner_user, text_wert="   ") is None
    assert SocialService.get_own_info(db, owner_user.id) is None
    assert db.query(UserInfo).filter_by(user_id=owner_user.id).count() == 0


def test_fuer_immer_hat_kein_ablaufdatum(db: Session, owner_user: User):
    gesetzt = _info(db, owner_user, dauer=0)
    assert gesetzt["expires_at"] is None
    assert SocialService.get_own_info(db, owner_user.id)["expires_at"] is None


def test_sichtbarkeit_freunde_oeffentlich_niemand(db: Session, owner_user: User, regular_user: User):
    freund = regular_user
    fremder = User(username="fremd_info", password_hash="x", is_owner=False, is_active=True)
    db.add(fremder)
    db.commit()
    _befreunden(db, owner_user, freund)

    _info(db, owner_user, visibility="friends")
    assert SocialService.info_fuer_viewer(db, freund.id, owner_user)["text"] == "Im Feierabend"
    assert SocialService.info_fuer_viewer(db, fremder.id, owner_user) is None

    _info(db, owner_user, visibility="public")
    assert SocialService.info_fuer_viewer(db, fremder.id, owner_user)["text"] == "Im Feierabend"

    _info(db, owner_user, visibility="nobody")
    assert SocialService.info_fuer_viewer(db, fremder.id, owner_user) is None
    assert SocialService.info_fuer_viewer(db, freund.id, owner_user) is None
    # Das eigene Konto sieht sie weiterhin.
    assert SocialService.info_fuer_viewer(db, owner_user.id, owner_user)["text"] == "Im Feierabend"


def test_abgelaufene_info_verschwindet(db: Session, owner_user: User, regular_user: User):
    _befreunden(db, owner_user, regular_user)
    _info(db, owner_user, visibility="public", dauer=3600)

    zeile = db.query(UserInfo).filter_by(user_id=owner_user.id).one()
    zeile.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    assert SocialService.get_own_info(db, owner_user.id) is None
    assert SocialService.info_fuer_viewer(db, regular_user.id, owner_user) is None

    assert SocialService.cleanup_expired_infos(db) == 1
    assert db.query(UserInfo).filter_by(user_id=owner_user.id).count() == 0


def test_ungueltige_sichtbarkeit_und_dauer_werden_abgewiesen(db: Session, owner_user: User):
    with pytest.raises(HTTPException):
        SocialService.set_info(db, owner_user.id, text="x", visibility="alle", dauer_sekunden=0)
    with pytest.raises(HTTPException):
        SocialService.set_info(db, owner_user.id, text="x", visibility="friends", dauer_sekunden=-1)
    with pytest.raises(HTTPException):
        SocialService.set_info(
            db,
            owner_user.id,
            text="x",
            visibility="friends",
            dauer_sekunden=10 * 365 * 24 * 3600,
        )


def test_zu_langer_text_wird_gekuerzt(db: Session, owner_user: User):
    gesetzt = _info(db, owner_user, text_wert="x" * 200)
    assert len(gesetzt["text"]) == 139


def test_rohwert_ist_chiffrat(db: Session, owner_user: User):
    _info(db, owner_user, text_wert="Geheimer Info-Text")

    roh = db.execute(
        text("SELECT text FROM user_infos WHERE user_id = :id"), {"id": owner_user.id}
    ).scalar_one()
    assert "Geheimer Info-Text" not in roh
    assert DisClient.ist_verschluesselt(roh)


def test_freundesliste_und_profil_tragen_die_info(db: Session, owner_user: User, regular_user: User):
    _befreunden(db, owner_user, regular_user)
    _info(db, owner_user, visibility="friends", text_wert="Nur für Freunde")

    eintrag = next(
        f for f in SocialService.get_friends(db, regular_user.id) if f["user_id"] == owner_user.id
    )
    assert eintrag["info"]["text"] == "Nur für Freunde"

    profil = SocialService.get_profile(db, viewer_user_id=regular_user.id, target_user=owner_user)
    assert profil["info"]["text"] == "Nur für Freunde"

    # Fremder sieht die Info nicht, das Profil bleibt bei "friends" verborgen.
    fremder = User(username="fremd_profil", password_hash="x", is_owner=False, is_active=True)
    db.add(fremder)
    db.commit()
    verborgen = SocialService.get_profile(db, viewer_user_id=fremder.id, target_user=owner_user)
    assert verborgen["info"] is None


def test_oeffentliche_liste_zeigt_nur_oeffentliche_infos(db: Session, owner_user: User, regular_user: User):
    oeffentlich = User(username="info_oeff", password_hash="x", is_owner=False, is_active=True)
    oeffentlich.social_privacy = "public"
    nur_freunde = User(username="info_freunde", password_hash="x", is_owner=False, is_active=True)
    nur_freunde.social_privacy = "public"
    db.add_all([oeffentlich, nur_freunde])
    db.commit()

    _info(db, oeffentlich, visibility="public", text_wert="Für alle")
    _info(db, nur_freunde, visibility="friends", text_wert="Nur Freunde")

    liste = SocialService.get_public_profiles(db, viewer_user_id=regular_user.id)
    nach_name = {eintrag["username"]: eintrag for eintrag in liste}
    assert nach_name["info_oeff"]["info"]["text"] == "Für alle"
    assert nach_name["info_freunde"]["info"] is None


def test_info_aenderung_erreicht_freunde_sofort(db: Session, owner_user: User, regular_user: User):
    """Ohne Ereignis sahen Freunde die neue Info erst beim naechsten Abgleich."""
    _befreunden(db, owner_user, regular_user)
    conn, queue = SyncEventService.subscribe(user_id=regular_user.id)
    try:
        _info(db, owner_user, text_wert="Neue Info")
        assert not queue.empty()
        ereignis = queue.get_nowait()
        assert ereignis["type"] == "friend_info_updated"
        assert ereignis["friend_id"] == owner_user.id
        assert ereignis["info"]["text"] == "Neue Info"
        # Die Sichtbarkeit bleibt eine Angabe des Servers.
        assert "visibility" not in ereignis["info"]

        _info(db, owner_user, text_wert="   ")
        geloescht = queue.get_nowait()
        assert geloescht["type"] == "friend_info_updated"
        assert geloescht["info"] is None
    finally:
        SyncEventService.unsubscribe(conn)


def test_info_ereignis_bleibt_bei_fremden_aus(db: Session, owner_user: User):
    fremder = User(username="fremd_ereignis", password_hash="x", is_owner=False, is_active=True)
    db.add(fremder)
    db.commit()
    conn, queue = SyncEventService.subscribe(user_id=fremder.id)
    try:
        _info(db, owner_user, visibility="friends")
        assert queue.empty()
    finally:
        SyncEventService.unsubscribe(conn)


def test_oeffentliche_info_erreicht_abonnenten(db: Session, owner_user: User):
    owner_user.social_privacy = "public"
    db.commit()
    fremder = User(username="abonnent_info", password_hash="x", is_owner=False, is_active=True)
    db.add(fremder)
    db.commit()
    conn, queue = SyncEventService.subscribe(user_id=fremder.id)
    try:
        _info(db, owner_user, visibility="public", text_wert="Fuer alle")
        assert not queue.empty()
        ereignis = queue.get_nowait()
        assert ereignis["info"]["text"] == "Fuer alle"
    finally:
        SyncEventService.unsubscribe(conn)


def test_blockierte_bekommen_kein_info_ereignis(db: Session, owner_user: User):
    gesperrt = User(username="gesperrt_info", password_hash="x", is_owner=False, is_active=True)
    db.add(gesperrt)
    db.commit()
    db.add(UserFriend(user_id=owner_user.id, friend_id=gesperrt.id, status="blocked"))
    db.commit()
    conn, queue = SyncEventService.subscribe(user_id=gesperrt.id)
    try:
        _info(db, owner_user, text_wert="Nicht fuer dich")
        assert queue.empty()
    finally:
        SyncEventService.unsubscribe(conn)


def test_emoji_am_limit_ueberlebt_speichern_und_lesen(db: Session, owner_user: User):
    text_wert = "🌙" * 139
    gesetzt = _info(db, owner_user, text_wert=text_wert)
    assert gesetzt["text"] == text_wert
    assert SocialService.get_own_info(db, owner_user.id)["text"] == text_wert
