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


OWNER_PASSWORT = "OwnerPass123!"
NUTZER_PASSWORT = "UserPass123!"


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
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef", "password": OWNER_PASSWORT},
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
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    _sync(client, team.id, neu, owner_cookies, "e1", "sv-vault-v2:neu")

    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
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
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
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
    assert client.post(
        "/api/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 200
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
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    )
    _sync(client, team.id, neu, owner_cookies, "e1", "sv-vault-v2:neu")
    client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
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


def test_team_rotation_unberechtigt_und_ungueltige_zustaende(
    db, client, owner_user, owner_cookies, regular_user, user_cookies
):
    team = _team_mit_tresor(db, owner_user, regular_user)
    alt, neu = _bucket(), _bucket()

    # 1. Setup durch Owner
    assert client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": alt, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies, headers=_headers(owner_cookies),
    ).status_code == 200

    # 2. Nicht-Owner (regular_user) darf keine Rotations-Endpunkte steuern (403).
    # Der Nachweis liegt bei, damit das Nein wirklich von der Owner-Pruefung kommt.
    u_h = _headers(user_cookies)
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef", "password": NUTZER_PASSWORT},
        cookies=user_cookies, headers=u_h,
    ).status_code == 403

    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        json={"password": NUTZER_PASSWORT},
        cookies=user_cookies, headers=u_h,
    ).status_code == 403

    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/abort",
        cookies=user_cookies, headers=u_h,
    ).status_code == 403

    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/rollback",
        cookies=user_cookies, headers=u_h,
    ).status_code == 403

    # 3. Ungueltige Zustaende beim Owner
    o_h = _headers(owner_cookies)
    # Commit ohne vorheriges Prepare (409)
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=o_h,
    ).status_code == 409

    # Rollback ohne vorherigen Commit (409)
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/rollback",
        cookies=owner_cookies, headers=o_h,
    ).status_code == 409

    # Prepare mit identischem aktiven Bucket (400)
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": alt, "salt": "neusalt1234567890abcdef", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=o_h,
    ).status_code == 400


def test_private_rotation_ungueltige_zustaende(client, owner_cookies):
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)

    # Vor Setup: Prepare wirft 400
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 400

    # Tresor einrichten
    assert client.post(
        "/api/vault/salt",
        json={"kdf_salt": "YWx0c2FsdDEyMzQ1Njc4OTA=", "bucket_id": alt},
        cookies=owner_cookies, headers=h,
    ).status_code == 200

    # Commit ohne Prepare wirft 409
    assert client.post(
        "/api/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 409

    # Rollback ohne Commit wirft 409
    assert client.post("/api/vault/rotation/rollback", cookies=owner_cookies, headers=h).status_code == 409

    # Prepare mit demselben Bucket wirft 400
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": alt, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 400


# ── Frischer Nachweis (Befund 1) ─────────────────────────────────────────
# Das Sitzungs-Token allein schaltet keine Rotation: prepare und commit
# brauchen das Kontopasswort oder einen eingerichteten zweiten Faktor.


def _privat_einrichten(client, cookies, alt: str) -> None:
    h = _headers(cookies)
    assert client.post(
        "/api/vault/salt",
        json={"kdf_salt": "YWx0c2FsdDEyMzQ1Njc4OTA=", "bucket_id": alt},
        cookies=cookies, headers=h,
    ).status_code == 200


def test_private_rotation_prepare_ohne_nachweis_403(client, owner_cookies):
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    antwort = client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA="},
        cookies=owner_cookies, headers=h,
    )
    assert antwort.status_code == 403
    assert "Passwort" in antwort.json()["detail"]
    assert client.get("/api/vault/salt", cookies=owner_cookies).json()["rotation_state"] is None


def test_private_rotation_prepare_falsches_passwort_403(client, owner_cookies):
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    antwort = client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": "falsch"},
        cookies=owner_cookies, headers=h,
    )
    assert antwort.status_code == 403
    assert client.get("/api/vault/salt", cookies=owner_cookies).json()["rotation_state"] is None


def test_private_rotation_commit_ohne_nachweis_403(client, owner_cookies):
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 200
    # Ein gestohlenes Token vollendet die vorbereitete Rotation nicht.
    assert client.post(
        "/api/vault/rotation/commit", json={}, cookies=owner_cookies, headers=h
    ).status_code == 403
    assert client.get("/api/vault/salt", cookies=owner_cookies).json()["bucket_id"] == alt
    # Mit Nachweis laeuft sie durch.
    assert client.post(
        "/api/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 200


def test_team_rotation_prepare_ohne_nachweis_403(db, client, owner_user, owner_cookies, regular_user):
    team = _team_mit_tresor(db, owner_user, regular_user)
    alt, neu = _bucket(), _bucket()
    o_h = _headers(owner_cookies)
    assert client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": alt, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies, headers=o_h,
    ).status_code == 200
    antwort = client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef"},
        cookies=owner_cookies, headers=o_h,
    )
    assert antwort.status_code == 403
    status = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies).json()
    assert status["rotation_state"] is None


def test_team_rotation_commit_ohne_nachweis_403(db, client, owner_user, owner_cookies, regular_user):
    team = _team_mit_tresor(db, owner_user, regular_user)
    alt, neu = _bucket(), _bucket()
    o_h = _headers(owner_cookies)
    client.post(
        f"/api/teams/{team.id}/vault/setup",
        json={"bucket_id": alt, "salt": "altsalt1234567890abcdef"},
        cookies=owner_cookies, headers=o_h,
    )
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=o_h,
    ).status_code == 200
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/commit",
        json={},
        cookies=owner_cookies, headers=o_h,
    ).status_code == 403
    status = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == alt


def test_rotation_mit_2fa_braucht_den_faktor(db, client, owner_user, owner_cookies):
    """Bei aktiver 2FA traegt der eingerichtete Faktor den Nachweis, nicht das Passwort."""
    from services.auth_service import AuthService
    from tests._totp import random_totp_secret, totp_now

    geheimnis = random_totp_secret()
    owner_user.two_factor_secret_encrypted = AuthService.encrypt_secret(
        geheimnis, aad=f"msm:user:{owner_user.id}:2fa"
    )
    owner_user.two_factor_enabled = True
    db.commit()

    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    # Das Passwort allein genuegt nicht mehr.
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 403
    # Der Code aus der App oeffnet.
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "otp_code": totp_now(geheimnis)},
        cookies=owner_cookies, headers=h,
    ).status_code == 200


def test_rotation_salz_aus_leerzeichen_422(client, owner_cookies):
    """Befund 45: ein Salz aus Leerzeichen scheitert an der Pruefung, nicht erst am Kuerzen."""
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    antwort = client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": " " * 16, "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    )
    assert antwort.status_code == 422


# ── Abort/Rollback auf dem gesperrten Stand (Befund 44) ───────────────────


def _team_rotation_bis_commit(client, team_id, cookies, alt, neu):
    h = _headers(cookies)
    client.post(
        f"/api/teams/{team_id}/vault/setup",
        json={"bucket_id": alt, "salt": "altsalt1234567890abcdef"},
        cookies=cookies, headers=h,
    )
    assert client.post(
        f"/api/teams/{team_id}/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "neusalt1234567890abcdef", "password": OWNER_PASSWORT},
        cookies=cookies, headers=h,
    ).status_code == 200
    assert client.post(
        f"/api/teams/{team_id}/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
        cookies=cookies, headers=h,
    ).status_code == 200


def test_team_abort_nach_commit_409_und_rollback_bleibt(db, client, owner_user, owner_cookies, regular_user):
    """Befund 44: Ein Abbruch nach Commit zerstoert nicht mehr den Rollback."""
    team = _team_mit_tresor(db, owner_user, regular_user)
    alt, neu = _bucket(), _bucket()
    _team_rotation_bis_commit(client, team.id, owner_cookies, alt, neu)
    o_h = _headers(owner_cookies)

    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/abort",
        cookies=owner_cookies, headers=o_h,
    ).status_code == 409

    # Der Rollback lebt noch: der Abbruch hat den committed-Stand nicht angeruehrt.
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/rollback",
        cookies=owner_cookies, headers=o_h,
    ).status_code == 200
    status = client.get(f"/api/teams/{team.id}/vault/salt", cookies=owner_cookies).json()
    assert status["bucket_id"] == alt

    # Danach ist Schluss: Rollback ohne Commit ist 409, Abbruch ohne Rotation ok.
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/rollback",
        cookies=owner_cookies, headers=o_h,
    ).status_code == 409
    assert client.post(
        f"/api/teams/{team.id}/vault/rotation/abort",
        cookies=owner_cookies, headers=o_h,
    ).status_code == 200


def test_privat_abort_nach_commit_409(client, owner_cookies):
    """Befund 44, privat: Abbruch nach Commit ist 409, Rollback bleibt moeglich."""
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 200
    assert client.post(
        "/api/vault/rotation/commit",
        json={"password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 200

    assert client.post(
        "/api/vault/rotation/abort", cookies=owner_cookies, headers=h
    ).status_code == 409
    assert client.post(
        "/api/vault/rotation/rollback", cookies=owner_cookies, headers=h
    ).status_code == 200
    assert client.get("/api/vault/salt", cookies=owner_cookies).json()["bucket_id"] == alt


def test_commit_gegen_abort_nur_einer_gewinnt(db, client, owner_user, owner_cookies):
    """Befund 44: Commit und Abbruch laufen ueber zwei Verbindungen serialisiert.

    Genau einer gewinnt, der Verlierer bekommt 409 — nie 500, nie ein
    halb umgeschalteter Stand. (Der deterministische Rot-Beweis der
    Committed-Sperre steht in den beiden Tests darueber; hier geht es um
    die Sperre unter echter Nebenlaeufigkeit.)
    """
    import threading

    from fastapi import HTTPException
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    import database as db_module

    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 200

    engine = create_engine(db_module.engine.url, poolclass=NullPool)
    sitzung = sessionmaker(bind=engine)
    barriere = threading.Barrier(2)
    konto = vault_service.tresor_konto(owner_user.id)
    ausgang: dict[str, str] = {}
    fehler: list[Exception] = []

    def lauf(name: str, fn) -> None:
        s = sitzung()
        try:
            try:
                barriere.wait(timeout=10)
            except threading.BrokenBarrierError as exc:
                fehler.append(exc)
                return
            fn(s)
            ausgang[name] = "gewonnen"
        except HTTPException as exc:
            ausgang[name] = f"HTTP {exc.status_code}"
        except Exception as exc:  # noqa: BLE001 — alles ausser 409 ist ein Fehler
            fehler.append(exc)
        finally:
            s.close()

    try:
        threads = [
            threading.Thread(target=lauf, args=("commit", lambda s: vault_service.rotation_commit_privat(s, konto))),
            threading.Thread(target=lauf, args=("abort", lambda s: vault_service.rotation_abbrechen_privat(s, konto))),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not any(t.is_alive() for t in threads)
    finally:
        engine.dispose()

    assert fehler == []
    assert sorted(ausgang.values()) == ["HTTP 409", "gewonnen"]
    status = client.get("/api/vault/salt", cookies=owner_cookies).json()
    if ausgang["commit"] == "gewonnen":
        assert (status["bucket_id"], status["rotation_state"]) == (neu, "committed")
    else:
        assert (status["bucket_id"], status["rotation_state"]) == (alt, None)


def test_abort_raeumt_staging_blobs_ab(db, client, owner_user, owner_cookies, tmp_path, monkeypatch):
    """Befund 44: Nach Abbruch bleiben keine Blob-Zeilen und keine Dateien im Staging."""
    from config import settings
    from models import VaultBlob
    from services import vault_blob_service

    monkeypatch.setattr(settings, "vault_blob_dir", str(tmp_path / "blobs"))
    alt, neu = _bucket(), _bucket()
    h = _headers(owner_cookies)
    _privat_einrichten(client, owner_cookies, alt)
    assert client.post(
        "/api/vault/rotation/prepare",
        json={"bucket_id": neu, "salt": "bmV1c2FsdDEyMzQ1Njc4OTA=", "password": OWNER_PASSWORT},
        cookies=owner_cookies, headers=h,
    ).status_code == 200

    # Eine fertige Datei im Staging: Zeile plus Chunks auf der Platte.
    blob_id = secrets.token_hex(16)
    db.add(VaultBlob(
        id=blob_id, bucket_id=neu, chunk_count=1, bytes_total=100,
        delete_verifier="a" * 64, state="fertig",
    ))
    db.commit()
    verzeichnis = vault_blob_service.blob_verzeichnis(blob_id)
    verzeichnis.mkdir(parents=True)
    (verzeichnis / "0").write_bytes(b"x" * 100)

    assert client.post(
        "/api/vault/rotation/abort", cookies=owner_cookies, headers=h
    ).status_code == 200

    # Der Abbruch gibt den Blob ohne Haltung frei ...
    db.expire_all()
    assert db.get(VaultBlob, blob_id).state == "geloescht"
    # ... und das naechste Aufraeumen entfernt Zeile und Dateien.
    assert vault_blob_service.aufraeumen(db)["entfernt"] == 1
    assert db.get(VaultBlob, blob_id) is None
    assert not verzeichnis.exists()
