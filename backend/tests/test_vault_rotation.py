"""Zwei-Phasen-Rotation: kein Datenverlust an irgendeinem Abbruchpunkt."""

from __future__ import annotations

import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from models import Team, TeamMember, User, VaultEntry
from services import vault_service


def _bucket() -> str:
    return secrets.token_hex(32)


def _headers(cookies: dict) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": token}


def _team_mit_tresor(db: Session, owner: User, member: User):
    team = Team(name="Rotation", owner_user_id=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="owner"))
    db.add(TeamMember(team_id=team.id, user_id=member.id, role="member"))
    db.commit()
    return team


def _sync(client, team_id, bucket, cookies, eintrag_id="e1", chiffrat="sv-vault-v2:alt"):
    return client.post(
        f"/api/teams/{team_id}/vault/sync",
        json={
            "bucket_id": bucket,
            "since_revision": 0,
            "mutations": [{"id": eintrag_id, "ciphertext": chiffrat, "revision": 0, "is_deleted": False}],
        },
        cookies=cookies,
        headers=_headers(cookies),
    )


def test_team_rotation_verliert_nichts_bei_abbruch(db, client, owner_user, owner_cookies, regular_user):
    team = _team_mit_tresor(db, owner_user, regular_user)
    alt, neu = _bucket(), _bucket()
    assert client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": alt, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    ).status_code == 200
    assert _sync(client, team.id, alt, owner_cookies).status_code == 200

    # Prepare darf den aktiven Bucket NICHT umschalten (alter Fehler: sofort weg).
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef"},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    ).status_code == 200
    status = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == alt
    assert status["rotation_state"] == "prepared"

    # Aktiver Bucket ist fuer Mutationen eingefroren, lesbar bleibt er.
    assert _sync(client, team.id, alt, owner_cookies, "e2").status_code == 409

    # Staging beschreiben, dann abbrechen: Altbestand bleibt vollstaendig.
    assert _sync(client, team.id, neu, owner_cookies, "e1", "sv-vault-v2:neu").status_code == 200
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/abort",
        cookies=owner_cookies, headers=_headers(owner_cookies),
    ).status_code == 200
    db.expire_all()
    assert db.query(VaultEntry).filter_by(bucket_id=neu).count() == 0
    assert db.query(VaultEntry).filter_by(bucket_id=alt).count() == 1
    status = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == alt
    assert status["rotation_state"] is None


def test_team_rotation_commit_und_rollback(db, client, owner_user, owner_cookies, regular_user):
    team = _team_mit_tresor(db, owner_user, regular_user)
    alt, neu = _bucket(), _bucket()
    client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": alt, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    _sync(client, team.id, alt, owner_cookies)
    client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef"},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    _sync(client, team.id, neu, owner_cookies, "e1", "sv-vault-v2:neu")

    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        cookies=owner_cookies, headers=_headers(owner_cookies),
    ).status_code == 200
    status = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == neu
    assert status["salt"] == "neusalt1234567890abcdef"
    # Altbestand ist NICHT geloescht (7-Tage-Fenster).
    db.expire_all()
    assert db.query(VaultEntry).filter_by(bucket_id=alt).count() == 1

    # Alt-Bucket ist fuer Mutationen gesperrt (409), lesbar bleibt er (read-only Sync).
    alt_read = client.post(
        f"/api/teams/{team.id}/vault/sync",
        json={"bucket_id": alt, "since_revision": 0, "mutations": []},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    assert alt_read.status_code == 200
    assert len(alt_read.json()["entries"]) == 1

    alt_mutate = _sync(client, team.id, alt, owner_cookies, "e_late")
    assert alt_mutate.status_code == 409

    # Rollback stellt den alten Stand wieder her.
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/rollback",
        cookies=owner_cookies, headers=_headers(owner_cookies),
    ).status_code == 200
    status = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == alt


def test_private_rotation_zwei_phasen(client, owner_cookies):
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    assert client.post(
        "/api/vault/salt",
        json={"kdf_salt": "YWx0c2FsdDEyMzQ1Njc4OTA=", "bucket_id": alt},
        cookies=owner_cookies, headers=h,
    ).status_code == 200
    assert client.post(
        "/api/vault/sync",
        json={"bucket_id": alt, "since_revision": 0, "mutations": [
            {"id": "p1", "ciphertext": "sv-vault-v2:alt", "revision": 0, "is_deleted": False}]},
        cookies=owner_cookies, headers=h,
    ).status_code == 200

    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA="},
        cookies=owner_cookies, headers=h,
    ).status_code == 200
    # Aktiv bleibt, Staging laeuft daneben.
    status = client.get("/api/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == alt
    assert status["rotation_state"] == "prepared"
    assert client.post(
        "/api/vault/sync",
        json={"bucket_id": neu, "since_revision": 0, "mutations": [
            {"id": "p1", "ciphertext": "sv-vault-v2:neu", "revision": 0, "is_deleted": False}]},
        cookies=owner_cookies, headers=h,
    ).status_code == 200
    assert client.post("/api/vault/rotation/commit", cookies=owner_cookies, headers=h).status_code == 200
    status = client.get("/api/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == neu
    assert status["kdf_salt"] == "bmV1c2FsdDEyMzQ1Njc4OTA="

    # Privater Alt-Bucket: read-only moeglich, Mutationen 409
    alt_read = client.post(
        "/api/vault/sync",
        json={"bucket_id": alt, "since_revision": 0, "mutations": []},
        cookies=owner_cookies, headers=h,
    )
    assert alt_read.status_code == 200
    assert len(alt_read.json()["entries"]) == 1

    alt_mutate = client.post(
        "/api/vault/sync",
        json={"bucket_id": alt, "since_revision": 0, "mutations": [
            {"id": "p2", "ciphertext": "sv-vault-v2:neu", "revision": 0, "is_deleted": False}]},
        cookies=owner_cookies, headers=h,
    )
    assert alt_mutate.status_code == 409


def test_rotation_cleanup_loescht_erst_nach_frist(db, client, owner_user, owner_cookies, regular_user):
    team = _team_mit_tresor(db, owner_user, regular_user)
    alt, neu = _bucket(), _bucket()
    client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": alt, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    _sync(client, team.id, alt, owner_cookies)
    client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef"},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    _sync(client, team.id, neu, owner_cookies, "e1", "sv-vault-v2:neu")
    client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    db.expire_all()
    team_db = db.get(Team, team.id)
    team_db.vault_rotation_cleanup_after = vault_service._now() - timedelta(seconds=1)
    db.commit()
    assert vault_service.bereinige_faellige_rotationen(db) >= 1
    db.expire_all()
    assert db.query(VaultEntry).filter_by(bucket_id=alt).count() == 0
    assert db.query(VaultEntry).filter_by(bucket_id=neu).count() == 1
