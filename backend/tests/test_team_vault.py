"""Tests fuer den Team-Tresor (Setup, Dual-Gate Autorisierung, Sync und Rotation)."""

from __future__ import annotations

import secrets
from sqlalchemy.orm import Session

from models import Team, TeamMember, User
from services import team_service


def _valid_bucket_id() -> str:
    return secrets.token_hex(32)


def _headers(cookies: dict) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": token}


def test_team_vault_lifecycle(
    db: Session,
    client,
    owner_user: User,
    owner_cookies: dict,
    regular_user: User,
    user_cookies: dict,
) -> None:
    # 1. Team anlegen mit owner_user als Gruender und regular_user als Mitglied
    team = Team(name="Familie Mueller", owner_user_id=owner_user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner_user.id, role="owner"))
    db.add(TeamMember(team_id=team.id, user_id=regular_user.id, role="member"))
    db.commit()

    # 2. Salt abrufen vor Setup (noch nicht eingerichtet)
    resp = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_setup"] is False
    assert data["salt"] is None
    assert data["bucket_id"] is None
    assert data["needs_rotation"] is False
    assert data["is_owner"] is True

    # 3. Regular member darf den Tresor NICHT einrichten (nur Owner)
    bucket_id = _valid_bucket_id()
    salt = "somesalt1234567890abcdef"
    resp = client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": bucket_id, "salt": salt},
        cookies=user_cookies,
        headers=_headers(user_cookies),
    )
    assert resp.status_code == 403

    # 4. Owner richtet den Team-Tresor ein
    resp = client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": bucket_id, "salt": salt},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

    # 5. Regular member ruft Salt ab -> hat Zugriff, is_owner ist False
    resp = client.get(f"/api/teams/{team.id}/vault/salt", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_setup"] is True
    assert data["salt"] == salt
    assert data["bucket_id"] == bucket_id
    assert data["needs_rotation"] is False
    assert data["is_owner"] is False

    # 6. Regular member darf Mutations syncen
    mutation_id = "team-entry-1"
    sync_payload = {
        "bucket_id": bucket_id,
        "since_revision": 0,
        "mutations": [
            {
                "id": mutation_id,
                "ciphertext": "sv-vault-v1:c2VjcmV0ZGF0YQ==",
                "revision": 0,
                "is_deleted": False,
            }
        ],
    }
    resp = client.post(
        f"/api/teams/{team.id}/vault/sync",
        json=sync_payload,
        cookies=user_cookies,
        headers=_headers(user_cookies),
    )
    assert resp.status_code == 200
    sync_data = resp.json()
    assert sync_data["server_revision"] >= 1
    assert len(sync_data["entries"]) == 1
    assert sync_data["entries"][0]["id"] == mutation_id

    # 7. Mitglied wird aus Team entfernt -> Rotation wird getriggert
    db.refresh(team)
    team_service.remove_member(db, team=team, user=owner_user, member_user_id=regular_user.id)

    # 8. Owner sieht, dass Rotation nötig ist
    resp = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies)
    assert resp.status_code == 200
    assert resp.json()["needs_rotation"] is True

    # 9. Entferntes Mitglied hat KEINEN Zugriff mehr (Gate 1 sperrt sofort)
    resp = client.get(f"/api/teams/{team.id}/vault/salt", cookies=user_cookies)
    assert resp.status_code == 404

    resp = client.post(
        f"/api/teams/{team.id}/vault/sync",
        json=sync_payload,
        cookies=user_cookies,
        headers=_headers(user_cookies),
    )
    assert resp.status_code == 404

    # 10. Owner rotiert das Passwort
    new_salt = "newsalt9876543210fedcba"
    resp = client.post(
        f"/api/teams/{team.id}/vault/rotate",
        json={"salt": new_salt},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert resp.status_code == 200

    resp = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies)
    assert resp.status_code == 200
    assert resp.json()["needs_rotation"] is False
    assert resp.json()["salt"] == new_salt
