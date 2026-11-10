"""Zero-Knowledge Device-Auth Relay: Aufloesen braucht den gescannten Code.

Befunde 11–14: Der Abruf verbraucht atomar (zweiter Abruf sieht `expired`),
eine aufgeloeste Session wird nie ueberschrieben, das Aufloese-Token steht nur
im QR-Code, alle POSTs brauchen CSRF, das Sitzungs-Token reist im Header.
Stufe B: Der kurze Code traegt nur Kennung, Zweck, Aufloese-Token und
Fingerabdruck; der Schluessel kommt nach dem Scan ueber `public-key`.
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

    ohne = client.post(
        "/api/vault/device-auth/public-key",
        json={"session_id": sitzung["session_id"], "resolve_token": sitzung["resolve_token"]},
        cookies=owner_cookies,
    )
    assert ohne.status_code == 403


def test_device_auth_schluessel_nach_scan_abrufbar(client, owner_cookies, user_cookies):
    """Stufe B: Der QR-Code traegt nur Kennung, Zweck, Aufloese-Token und
    Fingerabdruck; der Schluessel kommt nach dem Scan von hier. Ohne das
    Aufloese-Token aus dem Code, nach dem Aufloesen oder fuer ein fremdes
    Konto gibt es nichts — und der Abruf verbraucht die Session nicht."""
    schluessel = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0kurz"
    antwort = client.post(
        "/api/vault/device-auth/session",
        json={"public_key": schluessel, "purpose": "unlock"},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert antwort.status_code == 201, antwort.text
    sitzung = antwort.json()
    sid, rt = sitzung["session_id"], sitzung["resolve_token"]

    falsch = client.post(
        "/api/vault/device-auth/public-key",
        json={"session_id": sid, "resolve_token": "falsches-token-aus-dem-nichts"},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert falsch.status_code == 404

    fremd = client.post(
        "/api/vault/device-auth/public-key",
        json={"session_id": sid, "resolve_token": rt},
        cookies=user_cookies,
        headers=_kopf(user_cookies),
    )
    assert fremd.status_code == 404

    abruf = client.post(
        "/api/vault/device-auth/public-key",
        json={"session_id": sid, "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert abruf.status_code == 200
    assert abruf.json() == {"public_key": schluessel, "purpose": "unlock"}

    abfrage = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, sitzung["session_token"]),
    )
    assert abfrage.json()["status"] == "pending"

    aufloesen = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "chiffre", "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert aufloesen.status_code == 200

    spaet = client.post(
        "/api/vault/device-auth/public-key",
        json={"session_id": sid, "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert spaet.status_code == 404


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


def test_device_auth_chiffre_wird_bei_abruf_in_db_zerstoert(client, owner_cookies, db):
    """Hygiene-Invariante: Bei Abruf (Status 'resolved') wird die Chiffre in der DB
    sofort genullt/zerstoert, damit keine sensiblen Chiffrate persistent liegen bleiben."""
    import json
    sitzung = _session_anlegen(client, owner_cookies)
    sid, token, rt = sitzung["session_id"], sitzung["session_token"], sitzung["resolve_token"]

    aufloesen = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "geheime-chiffre-12345", "resolve_token": rt},
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
    assert abfrage.json()["encrypted_payload"] == "geheime-chiffre-12345"

    db.expire_all()
    rows = db.query(LoginChallenge).filter(LoginChallenge.purpose == relay.PURPOSE_VAULT_DEVICE_AUTH).all()
    ziel_row = None
    for r in rows:
        d = json.loads(r.payload_json or "{}")
        if d.get("session_id") == sid:
            ziel_row = r
            break
    assert ziel_row is not None
    daten = json.loads(ziel_row.payload_json or "{}")
    assert daten.get("encrypted_payload") is None, f"Chiffre verbleibt in DB: {daten.get('encrypted_payload')}"


def test_device_auth_zweiter_abruf_liefert_expired_ohne_chiffre(client, owner_cookies):
    """Single-Use-Invariante: Ein zweiter Abrufversuch auf derselben Session MUSS
    den Status 'expired' liefern und darf die Chiffre keinesfalls erneut ausliefern."""
    sitzung = _session_anlegen(client, owner_cookies)
    sid, token, rt = sitzung["session_id"], sitzung["session_token"], sitzung["resolve_token"]

    aufloesen = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "einmaliges-geheimnis-987", "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert aufloesen.status_code == 200

    # 1. Abruf: liefert Chiffre
    abruf1 = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, token),
    )
    assert abruf1.status_code == 200
    assert abruf1.json()["status"] == "resolved"
    assert abruf1.json()["encrypted_payload"] == "einmaliges-geheimnis-987"

    # 2. Abruf: MUSS 'expired' sein und DARF KEINE Chiffre enthalten
    abruf2 = client.get(
        f"/api/vault/device-auth/session/{sid}",
        cookies=owner_cookies,
        headers=_kopf(owner_cookies, token),
    )
    assert abruf2.status_code == 200
    assert abruf2.json()["status"] == "expired"
    assert "encrypted_payload" not in abruf2.json() or abruf2.json()["encrypted_payload"] is None


def test_device_auth_paralleler_doppelabruf_liefert_genau_einmal_chiffre(client, owner_cookies):
    """Race-Condition-Schutz: Zwei zeitgleiche Abfragen auf dieselbe aufgelöste Session
    duerfen die Chiffre exakt einmal ausliefern. Der Verlierer der Race Condition MUSS
    'expired' erhalten."""
    import concurrent.futures

    sitzung = _session_anlegen(client, owner_cookies)
    sid, token, rt = sitzung["session_id"], sitzung["session_token"], sitzung["resolve_token"]

    aufloesen = client.post(
        "/api/vault/device-auth/resolve",
        json={"session_id": sid, "encrypted_payload": "race-condition-secret-42", "resolve_token": rt},
        cookies=owner_cookies,
        headers=_kopf(owner_cookies),
    )
    assert aufloesen.status_code == 200

    def _abrufen():
        return client.get(
            f"/api/vault/device-auth/session/{sid}",
            cookies=owner_cookies,
            headers=_kopf(owner_cookies, token),
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(_abrufen)
        f2 = executor.submit(_abrufen)
        res1 = f1.result()
        res2 = f2.result()

    assert res1.status_code == 200
    assert res2.status_code == 200

    daten1 = res1.json()
    daten2 = res2.json()

    statuses = [daten1.get("status"), daten2.get("status")]
    assert "resolved" in statuses, f"Mindestens ein Abruf muss 'resolved' sein: {statuses}"
    assert "expired" in statuses, f"Der parallele Doppelabruf muss 'expired' sein: {statuses}"

    erfolgreich = daten1 if daten1.get("status") == "resolved" else daten2
    abgewiesen = daten2 if daten1.get("status") == "resolved" else daten1

    assert erfolgreich.get("encrypted_payload") == "race-condition-secret-42"
    assert abgewiesen.get("encrypted_payload") is None


