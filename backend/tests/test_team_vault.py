"""Tests fuer den Team-Tresor (Setup, Dual-Gate Autorisierung, Sync und Rotation)."""

from __future__ import annotations

import secrets
from sqlalchemy.orm import Session

from models import Team, TeamMember, User, VaultEntry, VaultUserSetting
from models.vault_bucket_tombstone import VaultBucketTombstone
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

    # 10. Owner rotiert das Passwort (Zwei-Phasen: prepare -> staging-sync -> commit)
    new_salt = "newsalt9876543210fedcba"
    new_bucket = _valid_bucket_id()
    resp = client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": new_bucket, "salt": new_salt},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert resp.status_code == 200
    resp = client.post(
        f"/api/teams/{team.id}/vault/sync",
        json={
            "bucket_id": new_bucket,
            "since_revision": 0,
            "mutations": [
                {
                    "id": mutation_id,
                    "ciphertext": "sv-vault-v1:cm90aWVydA==",
                    "revision": 0,
                    "is_deleted": False,
                }
            ],
        },
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert resp.status_code == 200
    resp = client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert resp.status_code == 200

    resp = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies)
    assert resp.status_code == 200
    assert resp.json()["needs_rotation"] is False
    assert resp.json()["salt"] == new_salt


def test_team_setup_und_prepare_beanspruchen_keinen_fremdbucket(
    db: Session,
    client,
    owner_user: User,
    owner_cookies: dict,
    regular_user: User,
) -> None:
    # 1. Fremder befuellter Bucket eines Benutzers
    fremder_bucket = _valid_bucket_id()
    db.add(VaultUserSetting(konto_index="index_opfer_123", bucket_id=fremder_bucket))
    db.add(VaultEntry(id="e-opfer", bucket_id=fremder_bucket, ciphertext="sv-vault-v1:geheim", revision=1, is_deleted=False))
    # Beerdigter Bucket
    tomb_bucket = _valid_bucket_id()
    db.add(VaultBucketTombstone(bucket_id=tomb_bucket))
    db.commit()

    team = Team(name="Attacker Team", owner_user_id=owner_user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner_user.id, role="owner"))
    db.commit()

    # Setup mit befuelltem Fremdbucket muss mit 403 abgewiesen werden
    res = client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": fremder_bucket, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res.status_code == 403

    # Setup mit beerdigtem Bucket muss mit 410 abgewiesen werden
    res_tomb = client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": tomb_bucket, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_tomb.status_code == 410

    # Legitimer Setup
    eigener_bucket = _valid_bucket_id()
    assert client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": eigener_bucket, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    ).status_code == 200

    # Prepare mit Fremdbucket muss mit 403 abgewiesen werden
    res_rot = client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": fremder_bucket, "salt": "neusalt1234567890abcdef"},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_rot.status_code == 403


def test_team_blobs_quota_und_lifecycle(
    db: Session,
    client,
    owner_user: User,
    owner_cookies: dict,
    regular_user: User,
    user_cookies: dict,
    tmp_path,
    monkeypatch,
) -> None:
    import hashlib
    from config import settings
    from models import Role, RoleVaultQuota
    from services.vault_blob_service import CHUNK_UEBERHANG

    blob_dir = tmp_path / "vault-blobs"
    monkeypatch.setattr(settings, "vault_blob_dir", str(blob_dir))

    # Team anlegen (regular_user ist Team-Owner ohne Rolle -> Quote 0)
    team = Team(name="Blob Team", owner_user_id=regular_user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=regular_user.id, role="owner"))
    db.add(TeamMember(team_id=team.id, user_id=owner_user.id, role="member"))
    db.commit()

    team_bucket = _valid_bucket_id()
    client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": team_bucket, "salt": "blobsalt1234567890abcdef"},
        cookies=user_cookies,
        headers=_headers(user_cookies),
    )

    # 1. Owner hat keine Speicher-Rolle -> Upload scheitert mit 507
    blob_id = secrets.token_hex(16)
    roh_key = secrets.token_bytes(32)
    schluessel = roh_key.hex()
    verifier = hashlib.sha256(roh_key).hexdigest()
    bytes_total = CHUNK_UEBERHANG + 10

    res_no_quota = client.post(
        f"/api/teams/{team.id}/vault/blobs",
        json={"id": blob_id, "chunk_count": 1, "bytes_total": bytes_total, "delete_verifier": verifier},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_no_quota.status_code == 507
    assert "Der Team-Owner hat keinen Tresorspeicher" in res_no_quota.json()["detail"]

    # 2. Owner erhaelt Rolle mit 50 MiB Speicher
    rolle = Role(name="Tresor-Team-Owner", description=None, is_system=False)
    db.add(rolle)
    db.flush()
    db.add(RoleVaultQuota(role_id=rolle.id, quota_bytes=50 * 1024 * 1024))
    regular_user.role_id = rolle.id
    db.commit()

    # 3. Mitglied laedt Blob an
    res_anlegen = client.post(
        f"/api/teams/{team.id}/vault/blobs",
        json={"id": blob_id, "chunk_count": 1, "bytes_total": bytes_total, "delete_verifier": verifier},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_anlegen.status_code == 201
    assert res_anlegen.json() == {"id": blob_id}

    # 4. Chunk hochladen
    chunk_daten = b"x" * bytes_total
    res_chunk = client.put(
        f"/api/teams/{team.id}/vault/blobs/{blob_id}/chunks/0",
        content=chunk_daten,
        headers={"Content-Type": "application/octet-stream", **_headers(owner_cookies)},
        cookies=owner_cookies,
    )
    assert res_chunk.status_code == 204

    # 5. Fertigstellen
    res_fertig = client.post(
        f"/api/teams/{team.id}/vault/blobs/{blob_id}/fertig",
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_fertig.status_code == 200
    assert res_fertig.json() == {"state": "fertig"}

    # 6. Speicher pruefen (rechnet auf Owner-Quota)
    res_speicher = client.get(
        f"/api/teams/{team.id}/vault/speicher",
        cookies=owner_cookies,
    )
    assert res_speicher.status_code == 200
    sp = res_speicher.json()
    assert sp["belegt"] == bytes_total
    assert sp["quote"] == 50 * 1024 * 1024

    # 7. Chunk lesen
    res_get = client.get(
        f"/api/teams/{team.id}/vault/blobs/{blob_id}/chunks/0",
        cookies=owner_cookies,
    )
    assert res_get.status_code == 200
    assert res_get.content == chunk_daten

    # 8. Kleine Blobs Batch-Lesen
    res_klein = client.post(
        f"/api/teams/{team.id}/vault/blobs/klein",
        json={"ids": [blob_id]},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_klein.status_code == 200

    # 9. Loeschen mit falschem Schluessel scheitert mit 403 (LoeschnachweisFalsch)
    falscher_key = secrets.token_bytes(32).hex()
    res_del_falsch = client.request(
        "DELETE",
        f"/api/teams/{team.id}/vault/blobs/{blob_id}",
        json={"schluessel": falscher_key},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_del_falsch.status_code == 403

    # 10. Nicht-Teammitglied darf keine Team-Blobs anlegen (404)
    fremdes_team = Team(name="Anderes Team", owner_user_id=owner_user.id)
    db.add(fremdes_team)
    db.commit()
    res_fremd = client.post(
        f"/api/teams/{fremdes_team.id}/vault/blobs",
        json={"id": secrets.token_hex(16), "chunk_count": 1, "bytes_total": bytes_total, "delete_verifier": verifier},
        cookies=user_cookies,
        headers=_headers(user_cookies),
    )
    assert res_fremd.status_code == 404

    # 11. Loeschen mit korrektem Schluessel
    res_del = client.request(
        "DELETE",
        f"/api/teams/{team.id}/vault/blobs/{blob_id}",
        json={"schluessel": schluessel},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert res_del.status_code == 200
    assert res_del.json() == {"status": "ok"}


def test_team_vault_access_barrier_when_disabled(
    db: Session,
    client,
    owner_user: User,
    owner_cookies: dict,
    regular_user: User,
    user_cookies: dict,
) -> None:
    # 1. Team anlegen, regular_user mit can_access_vault=False
    team = Team(name="Security Restricted Team", owner_user_id=owner_user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner_user.id, role="owner", can_access_vault=True))
    db.add(TeamMember(team_id=team.id, user_id=regular_user.id, role="member", can_access_vault=False))
    db.commit()

    # 2. Owner richtet Tresor ein
    bucket_id = _valid_bucket_id()
    salt = "somesalt1234567890abcdef"
    resp = client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": bucket_id, "salt": salt},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert resp.status_code == 200

    # 3. Owner hat vollen Zugriff
    resp_owner = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies)
    assert resp_owner.status_code == 200
    data_owner = resp_owner.json()
    assert data_owner["can_access_vault"] is True
    assert data_owner["salt"] == salt
    assert data_owner["bucket_id"] == bucket_id

    # 4. Member mit can_access_vault=False erhaelt Schranke (can_access_vault=False, kein Salt/Bucket)
    resp_member = client.get(f"/api/teams/{team.id}/vault/salt", cookies=user_cookies)
    assert resp_member.status_code == 200
    data_member = resp_member.json()
    assert data_member["can_access_vault"] is False
    assert data_member["salt"] is None
    assert data_member["bucket_id"] is None

    # 5. Member Sync-Versuch wird mit 403 Forbidden abgewiesen
    sync_payload = {
        "bucket_id": bucket_id,
        "since_revision": 0,
        "mutations": [
            {
                "id": "unauthorized-entry",
                "ciphertext": "sv-vault-v1:bm9wZQ==",
                "revision": 0,
                "is_deleted": False,
            }
        ],
    }
    resp_sync = client.post(
        f"/api/teams/{team.id}/vault/sync",
        json=sync_payload,
        cookies=user_cookies,
        headers=_headers(user_cookies),
    )
    assert resp_sync.status_code == 403

    # 6. Member Speicherabfrage wird mit 403 Forbidden abgewiesen
    resp_speicher = client.get(f"/api/teams/{team.id}/vault/speicher", cookies=user_cookies)
    assert resp_speicher.status_code == 403

    # 7. Owner schaltet can_access_vault auf True um
    resp_update = client.put(
        f"/api/teams/{team.id}/members/{regular_user.id}",
        json={"can_manage_skills": False, "can_manage_memory": False, "can_access_vault": True},
        cookies=owner_cookies,
        headers=_headers(owner_cookies),
    )
    assert resp_update.status_code == 200

    # 8. Member hat nun Zugriff
    resp_member_unlocked = client.get(f"/api/teams/{team.id}/vault/salt", cookies=user_cookies)
    assert resp_member_unlocked.status_code == 200
    data_unlocked = resp_member_unlocked.json()
    assert data_unlocked["can_access_vault"] is True
    assert data_unlocked["salt"] == salt
    assert data_unlocked["bucket_id"] == bucket_id

    # 9. Sync klappt nun
    resp_sync_ok = client.post(
        f"/api/teams/{team.id}/vault/sync",
        json=sync_payload,
        cookies=user_cookies,
        headers=_headers(user_cookies),
    )
    assert resp_sync_ok.status_code == 200



