"""Teammitglieder sehen einander: die Detailantwort trägt je Mitglied die Anwesenheit.

Ohne Freundschaft gab es bisher nichts — der Messenger zeigte Teammitglieder
dauerhaft als unsichtbar, und die Teams-Seite zeigte gar nichts. Jetzt sieht
ein Mitglied mindestens den reinen Online-Indikator; unsichtbar bleibt
offline, und Blockierte sehen nichts.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Team, TeamMember, User, UserFriend
from services.social_service import SocialService


def _team_mit(db: Session, owner: User, mitglied: User) -> Team:
    team = Team(name="Betrieb", owner_user_id=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="owner"))
    db.add(TeamMember(team_id=team.id, user_id=mitglied.id, role="member"))
    db.commit()
    return team


def _sitzung(db: Session, user_id: int, zustand: str = "online") -> None:
    SocialService.upsert_session(
        db,
        user_id,
        geraet="web-eins",
        client="web",
        plattform="web",
        zustand=zustand,
        activity_key="chat",
        vorn=True,
    )


def _mitglieder(client, cookies: dict, team_id: int) -> dict[int, dict]:
    antwort = client.get(f"/api/teams/{team_id}", cookies=cookies)
    assert antwort.status_code == 200, antwort.text
    return {m["user_id"]: m for m in antwort.json()["members"]}


def test_teammitglieder_sehen_einander_ohne_freundschaft(
    db: Session, client, owner_user: User, regular_user: User, owner_cookies: dict
):
    team = _team_mit(db, owner_user, regular_user)
    _sitzung(db, regular_user.id)

    mitglieder = _mitglieder(client, owner_cookies, team.id)
    assert mitglieder[regular_user.id]["presence"]["status"] == "online"
    # Nur der Indikator: kein Gerät, keine Aktivität ohne Freundschaft.
    assert mitglieder[regular_user.id]["presence"]["activity_key"] is None
    assert mitglieder[regular_user.id]["presence"]["client"] is None
    # Der eigene Eintrag ist nie leer — nur gerade niemand da.
    assert mitglieder[owner_user.id]["presence"]["status"] == "offline"


def test_befreundete_mitglieder_sehen_details(
    db: Session, client, owner_user: User, regular_user: User, owner_cookies: dict
):
    team = _team_mit(db, owner_user, regular_user)
    _sitzung(db, regular_user.id)
    db.add(UserFriend(user_id=owner_user.id, friend_id=regular_user.id, status="accepted"))
    db.commit()

    mitglieder = _mitglieder(client, owner_cookies, team.id)
    pres = mitglieder[regular_user.id]["presence"]
    assert pres["status"] == "online"
    assert pres["activity_key"] == "chat"


def test_unsichtbar_bleibt_offline_und_blockiert_sieht_nichts(
    db: Session, client, owner_user: User, regular_user: User, owner_cookies: dict
):
    team = _team_mit(db, owner_user, regular_user)
    _sitzung(db, regular_user.id)
    SocialService.set_manual_status(db, regular_user.id, "invisible")

    mitglieder = _mitglieder(client, owner_cookies, team.id)
    assert mitglieder[regular_user.id]["presence"]["status"] == "offline"

    SocialService.set_manual_status(db, regular_user.id, "auto")
    db.add(UserFriend(user_id=owner_user.id, friend_id=regular_user.id, status="blocked"))
    db.commit()

    mitglieder = _mitglieder(client, owner_cookies, team.id)
    assert mitglieder[regular_user.id]["presence"] is None
