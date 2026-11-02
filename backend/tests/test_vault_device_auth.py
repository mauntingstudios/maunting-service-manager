"""Zero-Knowledge Device-Auth Relay: Aufloesen braucht den gescannten Code.

Befunde 11–14: Der Abruf verbraucht atomar (zweiter Abruf sieht `expired`),
eine aufgeloeste Session wird nie ueberschrieben, das Aufloese-Token steht nur
im QR-Code, beide POSTs brauchen CSRF, das Sitzungs-Token reist im Header.
"""

from __future__ import annotations

from datetime import timedelta

from models.login_challenge import LoginChallenge
from services import vault_device_auth_service as relay


def _kopf(cookies: dict, geraet_token: str | None = None) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    kopf = {"X-CSRF-Token": token}
    if geraet_token is not None:
        kopf["X-MSM-Device-Token"] = geraet_token
    return kopf


def _session_anlegen(client, cookies, zweck="authorize"):
    antwort = client.post(
        "/api/vault/device-auth/session",
        json={"public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0", "purpose": zweck},
        cookies=cookies,
        headers=_kopf(cookies),
    )
    assert antwort.status_code == 201, antwort.text
    return antwort.json()


def test_device_auth_voller_ablauf(client, owner_cookies):
    sitzung = _session_anlegen(client, owner_cookies)
    sid, token, rt = sitzung["session_id"], sitzung["session_token"], sitzung["resolve_token"]

    abfrage = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, token),
    )
    assert abfrage.status_code == 200
    assert abfrage.json()["status"] == "pending"
    assert "resolve_token" not in abfrage.json()

    aufloesen = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "chiffre", "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert aufloesen.status_code == 200

    abfrage = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, token),
    )
    assert abfrage.status_code == 200
    assert abfrage.json()["status"] == "resolved"
    assert abfrage.json()["encrypted_payload"] == "chiffre"

    # Single-use: der zweite Abruf sieht `expired`, nicht die Chiffre.
    zweiter = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, token),
    )
    assert zweiter.status_code == 200
    assert zweiter.json()["status"] == "expired"


def test_device_auth_fremdes_konto_sieht_nichts(client, owner_cookies, user_cookies):
    sitzung = _session_anlegen(client, owner_cookies)
    sid, token = sitzung["session_id"], sitzung["session_token"]

    fremd = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "x", "resolve_token": sitzung["resolve_token"]},
        cookies=user_cookies,
        headers=_kopf(user_cookies),
    )
    assert fremd.status_code == 404

    fremd = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=user_cookies,
        headers=_kopf(user_cookies, token),
    )
    assert fremd.status_code == 404


def test_device_auth_ohne_aufloese_token_kein_resolve(client, owner_cookies):
    sitzung = _session_anlegen(client, owner_cookies)
    sid = sitzung["session_id"]

    falsch = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "x", "resolve_token": "falsches-token-aus-dem-nichts"},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert falsch.status_code == 404

    fehlend = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "x"},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert fehlend.status_code == 422

    abfrage = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, sitzung["session_token"]),
    )
    assert abfrage.json()["status"] == "pending"


def test_device_auth_zweites_resolve_ueberschreibt_nicht(client, db, owner_user, owner_cookies):
    sitzung = _session_anlegen(client, owner_cookies)
    sid, rt = sitzung["session_id"], sitzung["resolve_token"]

    erst = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "erste", "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert erst.status_code == 200

    db.expire_all()
    zeile = (
        db.query(LoginChallenge)
        .filter(LoginChallenge.purpose == relay.PURPOSE_VAULT_DEVICE_AUTH)
        .one()
    )
    assert zeile.resolved_at is not None

    zweit = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "zweite", "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert zweit.status_code == 404

    abfrage = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, sitzung["session_token"]),
    )
    assert abfrage.json()["encrypted_payload"] == "erste"


def test_device_auth_posts_brauchen_csrf(client, owner_cookies):
    sitzung = _session_anlegen(client, owner_cookies)

    ohne = client.post(
        "/api/vault/device-auth/session",
        json={"public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0", "purpose": "authorize"},
        cookies=owner_cookies,
    )
    assert ohne.status_code == 403

    ohne = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sitzung["session_id"], "encrypted_payload": "x", "resolve_token": sitzung["resolve_token"]},
        cookies=owner_cookies,
    )
    assert ohne.status_code == 403


def test_device_auth_abgelaufen(client, db, owner_user, owner_cookies):
    sitzung = _session_anlegen(client, owner_cookies)
    sid, token = sitzung["session_id"], sitzung["session_token"]

    db.query(LoginChallenge).filter(
        LoginChallenge.purpose == relay.PURPOSE_VAULT_DEVICE_AUTH
    ).update(
        {LoginChallenge.expires_at: relay._now() - timedelta(seconds=1)},
        synchronize_session=False,
    )
    db.commit()

    abfrage = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, token),
    )
    assert abfrage.json()["status"] == "expired"

    spaet = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "x", "resolve_token": sitzung["resolve_token"]},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert spaet.status_code == 404


def test_device_auth_service_aufloesen_setzt_resolved_at(db, owner_user):
    sid, _token, rt, _expires = relay.create_device_auth_session(db, owner_user.id, "MIIB-KEY")
    assert relay.resolve_device_auth_session(db, sid, owner_user.id, "chiffre", rt) is True
    assert relay.resolve_device_auth_session(db, sid, owner_user.id, "chiffre", rt) is False

    db.expire_all()
    zeile = (
        db.query(LoginChallenge)
        .filter(LoginChallenge.purpose == relay.PURPOSE_VAULT_DEVICE_AUTH)
        .one()
    )
    assert zeile.resolved_at is not None
    assert zeile.consumed_at is None

    assert relay.resolve_device_auth_session(db, sid, owner_user.id, "neu", "falsch") is False


def test_device_auth_zwei_abrufe_einer_bekommt_die_chiffre(client, owner_user, owner_cookies):
    """Befund 11: Zwei Abrufe zugleich ueber zwei Verbindungen — genau einer
    sieht `resolved`, der andere `expired`. Am alten Stand sahen beide die
    Chiffre (kein Verbrauch unter Sperre)."""
    import threading

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    import database as db_module

    sitzung = _session_anlegen(client, owner_cookies)
    sid, token, rt = sitzung["session_id"], sitzung["session_token"], sitzung["resolve_token"]
    assert client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "chiffre", "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    ).status_code == 200

    engine = create_engine(db_module.engine.url, poolclass=NullPool)
    sitzungen = sessionmaker(bind=engine)
    barriere = threading.Barrier(2)
    ausgang: list[str] = []
    fehler: list[Exception] = []

    def abruf() -> None:
        s = sitzungen()
        try:
            barriere.wait(timeout=10)
            ausgang.append(relay.get_device_auth_session_status(
                s, session_id=sid, session_token=token, user_id=owner_user.id,
            )["status"])
        except Exception as exc:  # noqa: BLE001 — alles ausser expired/resolved ist ein Fehler
            fehler.append(exc)
        finally:
            s.close()

    try:
        threads = [threading.Thread(target=abruf) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not any(t.is_alive() for t in threads)
    finally:
        engine.dispose()

    assert fehler == []
    assert sorted(ausgang) == ["expired", "resolved"]


def test_device_auth_token_nur_im_header(client, owner_cookies):
    """Befund 14: Der Query-Parameter ist tot — ohne Header gibt es nichts,
    auch wenn der Token in der URL steht. Am alten Stand lieferte die URL."""
    sitzung = _session_anlegen(client, owner_cookies)
    sid, token = sitzung["session_id"], sitzung["session_token"]

    alt = client.get(
        f"/api/vault/device-auth/session/{sid}?token={token}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert alt.status_code == 404

    neu = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, token),
    )
    assert neu.status_code == 200
    assert neu.json()["status"] == "pending"
