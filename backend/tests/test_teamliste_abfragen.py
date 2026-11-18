"""Die Teamliste wird regelmaessig abgefragt.

Bis 27.09.2026 kostete sie zwei Abfragen je Team und committete bei jedem
Abruf, auch wenn es nichts zu speichern gab.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

from models import Team, TeamMember, TeamMemberRole, TeamRole, TeamRolePermission, User


def _abruf(db: Session, client, cookies) -> tuple[list[dict], int, int]:
    abfragen, commits = [], []
    bind = db.get_bind()

    def mit(_c, _cur, stmt, *_a, **_k):
        abfragen.append(stmt)

    def festgeschrieben(_conn):
        commits.append(1)

    event.listen(bind, "before_cursor_execute", mit)
    event.listen(bind, "commit", festgeschrieben)
    try:
        antwort = client.get("/api/teams", cookies=cookies)
    finally:
        event.remove(bind, "before_cursor_execute", mit)
        event.remove(bind, "commit", festgeschrieben)
    assert antwort.status_code == 200
    return antwort.json(), len(abfragen), len(commits)


def test_abfragen_wachsen_nicht_mit_den_teams_und_ohne_commit(
    db: Session, client, regular_user: User, user_cookies: dict, owner_user: User
) -> None:
    _abruf(db, client, user_cookies)  # legt das persoenliche Team an
    basis_team = Team(name="Basis", owner_user_id=owner_user.id)
    db.add(basis_team)
    db.flush()
    db.add(TeamMember(team_id=basis_team.id, user_id=owner_user.id, role="owner"))
    basis_member = TeamMember(team_id=basis_team.id, user_id=regular_user.id, role="member")
    db.add(basis_member)
    basis_role = TeamRole(team_id=basis_team.id, name="Rolle", is_default=True)
    db.add(basis_role)
    db.flush()
    basis_member.team_role_id = basis_role.id
    db.add(TeamMemberRole(team_member_id=basis_member.id, team_role_id=basis_role.id))
    db.commit()

    _, vorher, _ = _abruf(db, client, user_cookies)

    for i in range(5):
        team = Team(name=f"Team {i}", owner_user_id=owner_user.id)
        db.add(team)
        db.flush()
        db.add(TeamMember(team_id=team.id, user_id=owner_user.id, role="owner"))
        member = TeamMember(team_id=team.id, user_id=regular_user.id, role="member")
        db.add(member)
        role = TeamRole(team_id=team.id, name="Rolle", is_default=True)
        db.add(role)
        db.flush()
        if i == 0:
            db.add(TeamRolePermission(role_id=role.id, permission_key="ai.skills.manage"))
        member.team_role_id = role.id
        db.add(TeamMemberRole(team_member_id=member.id, team_role_id=role.id))
    db.commit()

    teams, nachher, commits = _abruf(db, client, user_cookies)

    assert nachher == vorher
    assert commits == 0
    fremde = sorted((t for t in teams if not t["is_personal"] and t["name"].startswith("Team ")), key=lambda t: t["name"])
    assert [t["member_count"] for t in fremde] == [2] * 5
    assert [t["can_manage_skills"] for t in fremde] == [True, False, False, False, False]
    assert not any(t["is_owner"] for t in fremde)
    eigenes = next(t for t in teams if t["is_personal"])
    assert eigenes["is_owner"] and eigenes["member_count"] == 1
