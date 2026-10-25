"""Der eine E2EE-Transport unter Last: Senden, Haekchen, Cursor, Fristen, Stories.

Die Verschluesselung liegt im Client; der Server sieht nur Chiffrat. Geprueft
wird deshalb, was er wirklich entscheidet: Zugehoerigkeit, Idempotenz,
Wasserstaende, Fristen und die Sichtbarkeit von Stories.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import ChatGroupMember, E2eeChatKey, E2eeMessage, User
from services.auth_service import AuthService
from services.social import messages_service
from services.sync_event_service import SyncEventService
from services.social_service import SocialService

CHIFFRAT = "sv-e2ee-test-v1:chiffrat"


def _freunde(db: Session, a: User, b: User) -> None:
    anfrage = SocialService.send_friend_request(db, a.id, b.username)
    SocialService.accept_friend_request(db, b.id, anfrage["id"])


def _direktchat(db: Session, a: User, b: User):
    _freunde(db, a, b)
    chat = SocialService.ensure_direct_chat(db, a.id, b.id)
    for uid in (a.id, b.id):
        db.add(
            E2eeChatKey(
                chat_type="direct",
                chat_id=chat.id,
                user_id=uid,
                key_version=1,
                encrypted_chat_key="gepackt",
            )
        )
    db.commit()
    return chat


def _konto(db: Session, name: str) -> User:
    user = AuthService.create_user(db, name, f"{name}@probe.example", "ProbePass123!")
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user


def test_direktchat_senden_lesen_und_doppelte_kennung(
    db: Session, owner_user: User, regular_user: User
):
    """Eine Nachricht liegt einmal; eine Wiederholung mit derselben Kennung
    legt keine zweite an und liefert dieselbe Zeile."""
    chat = _direktchat(db, owner_user, regular_user)

    erste = messages_service.send_message(
        db, owner_user, "direct", chat.id, "kennung-1", 1, CHIFFRAT
    )
    doppelt = messages_service.send_message(
        db, owner_user, "direct", chat.id, "kennung-1", 1, CHIFFRAT
    )

    assert doppelt["id"] == erste["id"]
    assert db.query(E2eeMessage).count() == 1

    seite = messages_service.list_messages(db, regular_user, "direct", chat.id)
    assert [m["client_uuid"] for m in seite["messages"]] == ["kennung-1"]
    assert seite["messages"][0]["encrypted_payload"] == CHIFFRAT


def test_message_created_traegt_flache_felder_und_zusteller(
    monkeypatch, db: Session, owner_user: User, regular_user: User
):
    chat = _direktchat(db, owner_user, regular_user)
    aufrufe: list[tuple[dict, dict]] = []

    def merke(payload, **kwargs):
        aufrufe.append((payload, kwargs))
        return 1

    monkeypatch.setattr(SyncEventService, "publish", classmethod(lambda cls, payload, **kw: merke(payload, **kw)))
    gesendet = messages_service.send_message(
        db, owner_user, "direct", chat.id, "event-1", 1, CHIFFRAT
    )

    ereignis, optionen = next(
        (p, k) for p, k in aufrufe if p.get("type") == "message_created"
    )
    assert ereignis["type"] == "message_created"
    assert ereignis["sender_user_id"] == owner_user.id
    assert ereignis["chat_type"] == "direct"
    assert ereignis["chat_id"] == chat.id
    assert ereignis["client_uuid"] == "event-1"
    assert ereignis["message"]["id"] == gesendet["id"]
    assert ereignis["message"]["sender_user_id"] == owner_user.id
    assert optionen["melden_markieren"] is True
    assert isinstance(optionen["zusteller"], set)


def test_der_absender_bekommt_keine_meldung_fuer_seine_eigene_nachricht(
    monkeypatch, db: Session, owner_user: User, regular_user: User
):
    chat = _direktchat(db, owner_user, regular_user)
    optionen: dict = {}

    def merke(payload, **kwargs):
        optionen.update(kwargs)
        return 1

    monkeypatch.setattr(
        SyncEventService, "publish", classmethod(lambda cls, payload, **kw: merke(payload, **kw))
    )
    # Fuer jedes Konto steht eine Verbindung offen, auch fuer den Absender.
    monkeypatch.setattr(
        SyncEventService,
        "zustelllage",
        classmethod(
            lambda cls, *, user_id=None, mailbox_id=None: (f"conn-{user_id}", True)
        ),
    )
    messages_service.send_message(db, owner_user, "direct", chat.id, "event-2", 1, CHIFFRAT)

    assert optionen["zusteller"] == {f"conn-{regular_user.id}"}


def test_angeheftete_nachricht_kommt_mit_der_seite(
    db: Session, owner_user: User, regular_user: User
):
    chat = _direktchat(db, owner_user, regular_user)
    gesendet = messages_service.send_message(db, owner_user, "direct", chat.id, "pin-1", 1, CHIFFRAT)
    messages_service.set_pinned(db, owner_user, "pin-1", True)

    seite = messages_service.list_messages(db, regular_user, "direct", chat.id)
    assert seite["pinned_message"] is not None
    assert seite["pinned_message"]["id"] == gesendet["id"]
    assert seite["pinned_message"]["is_pinned"] is True


def test_gruppe_mit_sechzig_mitgliedern(
    db: Session, owner_user: User, regular_user: User
):
    """Eine grosse Gruppe kostet einen Datensatz, nicht einen je Mitglied."""
    gruppe = SocialService.create_group(db, owner_user)
    mitglieder = [owner_user, regular_user]
    for i in range(58):
        mitglieder.append(_konto(db, f"gross-{i}"))
    for user in mitglieder:
        if user.id == owner_user.id:
            continue
        db.add(
            ChatGroupMember(
                group_id=gruppe.id,
                user_id=user.id,
                role="member",
                joined_at=datetime.now(timezone.utc),
            )
        )
    db.commit()
    db.add(
        E2eeChatKey(
            chat_type="group",
            chat_id=gruppe.id,
            user_id=owner_user.id,
            key_version=1,
            encrypted_chat_key="gepackt",
        )
    )
    db.commit()

    messages_service.send_message(
        db, owner_user, "group", gruppe.id, "gruppe-gross-1", 1, CHIFFRAT
    )

    assert db.query(E2eeMessage).filter_by(chat_type="group").count() == 1
    seite = messages_service.list_messages(db, regular_user, "group", gruppe.id)
    assert [m["client_uuid"] for m in seite["messages"]] == ["gruppe-gross-1"]

    fremd = _konto(db, "gruppe-fremd")
    with pytest.raises(HTTPException) as fehler:
        messages_service.list_messages(db, fremd, "group", gruppe.id)
    assert fehler.value.status_code == 403


def test_vier_haken_phasen_mit_nachholen(
    db: Session, owner_user: User, regular_user: User
):
    """gesendet -> zugestellt -> gelesen, und ein alter Stand holt nichts zurueck."""
    chat = _direktchat(db, owner_user, regular_user)
    erste = messages_service.send_message(
        db, owner_user, "direct", chat.id, "haken-1", 1, CHIFFRAT
    )
    zweite = messages_service.send_message(
        db, owner_user, "direct", chat.id, "haken-2", 1, CHIFFRAT
    )

    seite = messages_service.list_messages(db, owner_user, "direct", chat.id)
    assert seite["partner_last_delivered_id"] == 0
    assert seite["partner_last_read_id"] == 0

    # Nachgeholt: der Empfaenger war offline und bestaetigt beide.
    messages_service.ack_messages(db, regular_user, "direct", chat.id, zweite["id"])
    seite = messages_service.list_messages(db, owner_user, "direct", chat.id)
    assert seite["partner_last_delivered_id"] == zweite["id"]
    assert seite["partner_last_read_id"] == 0

    messages_service.mark_read(db, regular_user, "direct", chat.id, zweite["id"])
    seite = messages_service.list_messages(db, owner_user, "direct", chat.id)
    assert seite["partner_last_read_id"] == zweite["id"]

    # Ein aelterer Stand darf die Wasserstaende nicht senken.
    messages_service.ack_messages(db, regular_user, "direct", chat.id, erste["id"])
    messages_service.mark_read(db, regular_user, "direct", chat.id, erste["id"])
    seite = messages_service.list_messages(db, owner_user, "direct", chat.id)
    assert seite["partner_last_delivered_id"] == zweite["id"]
    assert seite["partner_last_read_id"] == zweite["id"]


def test_cursor_pagination_ohne_luecke(
    db: Session, owner_user: User, regular_user: User
):
    chat = _direktchat(db, owner_user, regular_user)
    ids = [
        messages_service.send_message(
            db, owner_user, "direct", chat.id, f"seite-{i}", 1, CHIFFRAT
        )["id"]
        for i in range(60)
    ]

    neueste = messages_service.list_messages(
        db, regular_user, "direct", chat.id, limit=50
    )
    assert [m["id"] for m in neueste["messages"]] == ids[-50:]
    assert neueste["has_more"] is True

    aelter = messages_service.list_messages(
        db, regular_user, "direct", chat.id, limit=50, before_id=ids[-50]
    )
    assert [m["id"] for m in aelter["messages"]] == ids[:10]
    assert aelter["has_more"] is False

    neuer = messages_service.list_messages(
        db, regular_user, "direct", chat.id, limit=50, after_id=ids[-51]
    )
    # Die `after_id`-Seite kommt neueste zuerst; entscheidend ist, dass sie
    # lueckenlos dieselben Zeilen traegt wie die neueste Seite.
    assert sorted(m["id"] for m in neuer["messages"]) == ids[-50:]

    nach_allem = messages_service.list_messages(
        db, regular_user, "direct", chat.id, after_id=ids[-1]
    )
    assert nach_allem["messages"] == []


def test_verschwindende_nachrichten_nur_wer_sie_einschaltet(
    db: Session, owner_user: User, regular_user: User
):
    chat = _direktchat(db, owner_user, regular_user)
    dauerhaft = messages_service.send_message(
        db, owner_user, "direct", chat.id, "dauerhaft", 1, CHIFFRAT
    )

    messages_service.set_ephemeral(db, owner_user, "direct", chat.id, 3600)
    with pytest.raises(HTTPException) as fehler:
        messages_service.set_ephemeral(db, regular_user, "direct", chat.id, 7200)
    assert fehler.value.status_code == 403

    kurz = messages_service.send_message(
        db, owner_user, "direct", chat.id, "kurz", 1, CHIFFRAT
    )
    zeile = db.query(E2eeMessage).filter_by(client_uuid="kurz").one()
    assert zeile.expires_at is not None

    # Der Aktivator darf abschalten, danach darf der andere einschalten.
    messages_service.set_ephemeral(db, owner_user, "direct", chat.id, 0)
    assert (
        messages_service.set_ephemeral(db, regular_user, "direct", chat.id, 7200)[
            "ephemeral_ttl_seconds"
        ]
        == 7200
    )

    zeile.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert messages_service.cleanup_expired(db) == 1
    assert db.query(E2eeMessage).filter_by(id=dauerhaft["id"]).first() is not None
    assert db.query(E2eeMessage).filter_by(id=kurz["id"]).first() is None


def test_story_sichtbarkeit_public_friends_private(
    db: Session, owner_user: User, regular_user: User
):
    freund = regular_user
    fremd = _konto(db, "story-fremd")
    _freunde(db, owner_user, freund)

    owner_user.social_privacy = "public"
    db.commit()
    oeffentlich = SocialService.create_story(db, owner_user, "oeffentlich")
    assert oeffentlich.id in {
        s["id"] for s in SocialService.list_active_stories(db, fremd.id)
    }

    owner_user.social_privacy = "friends"
    db.commit()
    freundes = SocialService.create_story(db, owner_user, "freunde")
    assert freundes.id in {
        s["id"] for s in SocialService.list_active_stories(db, freund.id)
    }
    assert freundes.id not in {
        s["id"] for s in SocialService.list_active_stories(db, fremd.id)
    }

    owner_user.social_privacy = "private"
    db.commit()
    privat = SocialService.create_story(db, owner_user, "privat")
    assert privat.id not in {
        s["id"] for s in SocialService.list_active_stories(db, freund.id)
    }
    assert privat.id in {
        s["id"] for s in SocialService.list_active_stories(db, owner_user.id)
    }


def test_http_senden_lesen_quittieren(
    db: Session,
    client,
    owner_user: User,
    regular_user: User,
    owner_cookies: dict,
    user_cookies: dict,
    csrf_token: str | None,
    user_csrf_token: str | None,
):
    """Derselbe Weg ueber die echten Routen: senden, lesen, zustellen, lesen."""
    chat = _direktchat(db, owner_user, regular_user)

    gesendet = client.post(
        "/api/social/messages/send",
        json={
            "chat_type": "direct",
            "chat_id": chat.id,
            "client_uuid": "http-1",
            "key_version": 1,
            "encrypted_payload": CHIFFRAT,
        },
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert gesendet.status_code == 200, gesendet.text
    mitte = int(gesendet.json()["id"])

    seite = client.get(
        f"/api/social/messages?chat_type=direct&chat_id={chat.id}&limit=50",
        cookies=user_cookies,
    )
    assert seite.status_code == 200, seite.text
    assert [m["client_uuid"] for m in seite.json()["messages"]] == ["http-1"]

    quittung = client.post(
        "/api/social/messages/ack",
        json={"chat_type": "direct", "chat_id": chat.id, "up_to_id": mitte},
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert quittung.status_code == 200, quittung.text

    gelesen = client.post(
        "/api/social/messages/read",
        json={"chat_type": "direct", "chat_id": chat.id, "up_to_id": mitte},
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert gelesen.status_code == 200, gelesen.text

    stand = client.get(
        f"/api/social/messages?chat_type=direct&chat_id={chat.id}",
        cookies=owner_cookies,
    )
    assert stand.status_code == 200, stand.text
    assert stand.json()["partner_last_delivered_id"] == mitte
    assert stand.json()["partner_last_read_id"] == mitte


def _gruppe_mit_mitglied(db: Session, owner_user: User, mitglied: User):
    gruppe = SocialService.create_group(db, user=owner_user)
    SocialService.join_group_by_invite_code(db, mitglied, gruppe.invite_code)
    return gruppe


def test_verschwindende_nachrichten_gruppenrecht_und_aktivator(
    db: Session, owner_user: User, regular_user: User
):
    gruppe = _gruppe_mit_mitglied(db, owner_user, regular_user)

    # Ein einfaches Mitglied darf nicht einschalten.
    with pytest.raises(HTTPException) as fehler:
        messages_service.set_ephemeral(db, regular_user, "group", gruppe.id, 3600)
    assert fehler.value.status_code == 403

    messages_service.set_ephemeral(db, owner_user, "group", gruppe.id, 3600)
    assert messages_service.get_ephemeral(db, owner_user, "group", gruppe.id)[
        "ephemeral_enabled_by_user_id"
    ] == owner_user.id

    # Dieselbe Frist erneut setzen ist keine Aenderung und ueberschreibt den
    # Aktivator nicht.
    stand = messages_service.set_ephemeral(db, regular_user, "group", gruppe.id, 3600)
    assert stand["ephemeral_enabled_by_user_id"] == owner_user.id
    assert stand["ephemeral_ttl_seconds"] == 3600

    # Eine andere Frist bleibt dem Aktivator (oder Owner/Admin) vorbehalten.
    with pytest.raises(HTTPException) as fehler:
        messages_service.set_ephemeral(db, regular_user, "group", gruppe.id, 7200)
    assert fehler.value.status_code == 403

    messages_service.set_ephemeral(db, owner_user, "group", gruppe.id, 0)
    with pytest.raises(HTTPException) as fehler:
        messages_service.set_ephemeral(db, regular_user, "group", gruppe.id, 7200)
    assert fehler.value.status_code == 403


def test_direktchat_aktivator_und_uebergabe(
    db: Session, owner_user: User, regular_user: User
):
    chat = _direktchat(db, owner_user, regular_user)
    messages_service.set_ephemeral(db, owner_user, "direct", chat.id, 3600)

    stand = messages_service.set_ephemeral(db, regular_user, "direct", chat.id, 3600)
    assert stand["ephemeral_enabled_by_user_id"] == owner_user.id

    with pytest.raises(HTTPException) as fehler:
        messages_service.set_ephemeral(db, regular_user, "direct", chat.id, 7200)
    assert fehler.value.status_code == 403

    messages_service.set_ephemeral(db, owner_user, "direct", chat.id, 0)
    stand = messages_service.set_ephemeral(db, regular_user, "direct", chat.id, 7200)
    assert stand["ephemeral_enabled_by_user_id"] == regular_user.id


def test_gruppenadmin_darf_chat_schluessel_rotieren(
    db: Session, owner_user: User, regular_user: User
):
    gruppe = _gruppe_mit_mitglied(db, owner_user, regular_user)
    mitglieder = [owner_user.id, regular_user.id]
    rows = [
        {"user_id": uid, "encrypted_chat_key": f"key-{uid}"}
        for uid in mitglieder
    ]
    messages_service.store_chat_keys(db, owner_user, "group", gruppe.id, 1, rows)

    admin = (
        db.query(ChatGroupMember)
        .filter_by(group_id=gruppe.id, user_id=regular_user.id)
        .one()
    )
    admin.role = "admin"
    db.commit()

    messages_service.store_chat_keys(db, regular_user, "group", gruppe.id, 2, rows)
    assert messages_service.latest_chat_key_version(db, "group", gruppe.id) == 2

    # Ein einfaches Mitglied bleibt aussen vor.
    admin.role = "member"
    db.commit()
    with pytest.raises(HTTPException) as fehler:
        messages_service.store_chat_keys(db, regular_user, "group", gruppe.id, 3, rows)
    assert fehler.value.status_code == 403


def test_chat_schluessel_nur_fuer_mitglieder(
    db: Session, owner_user: User, regular_user: User
):
    """Der fruehere Geraete-Posteingang ist weg; Schluessel liegen am Chat.

    Wer nicht Mitglied ist, darf weder schreiben noch lesen. Und wer
    schreibt, nennt jedes Mitglied genau einmal — sonst bliebe ein Geraet
    ohne Schluessel und saehe die Nachricht nie.
    """
    chat = _direktchat(db, owner_user, regular_user)
    fremd = _konto(db, "schluessel-fremd")

    with pytest.raises(HTTPException) as schreiben:
        messages_service.store_chat_keys(
            db, fremd, "direct", chat.id, 2,
            [
                {"user_id": owner_user.id, "encrypted_chat_key": "x"},
                {"user_id": regular_user.id, "encrypted_chat_key": "y"},
            ],
        )
    assert schreiben.value.status_code == 403

    with pytest.raises(HTTPException) as lesen:
        messages_service.list_chat_keys(db, fremd.id, "direct", chat.id)
    assert lesen.value.status_code == 403

    # Ein Mitglied darf schreiben, muss aber alle nennen.
    with pytest.raises(HTTPException) as unvollstaendig:
        messages_service.store_chat_keys(
            db, owner_user, "direct", chat.id, 2,
            [{"user_id": owner_user.id, "encrypted_chat_key": "x"}],
        )
    assert unvollstaendig.value.status_code == 403

    messages_service.store_chat_keys(
        db, owner_user, "direct", chat.id, 2,
        [
            {"user_id": owner_user.id, "encrypted_chat_key": "x"},
            {"user_id": regular_user.id, "encrypted_chat_key": "y"},
        ],
    )
    assert messages_service.latest_chat_key_version(db, "direct", chat.id) == 2


def test_konto_bund_nur_von_eigenem_geraet_und_nicht_ueberschreiben(
    db: Session,
    client,
    owner_user: User,
    owner_cookies: dict,
    csrf_token: str | None,
):
    from models import E2eeAccountKeyVault, UserE2eeDevice

    for did in ("source-device-01", "target-device-01", "third-device-001", "target2-device-1"):
        db.add(
            UserE2eeDevice(
                user_id=owner_user.id,
                device_id=did,
                public_key_jwk="{}",
                signing_public_key_jwk=None,
                label="",
                is_approved=True,
            )
        )
    db.add(
        E2eeAccountKeyVault(
            user_id=owner_user.id,
            device_id="source-device-01",
            encrypted_bundle="bund",
        )
    )
    db.commit()

    kopf = {"X-Device-Id": "source-device-01", "X-CSRF-Token": csrf_token or ""}
    erste = client.post(
        "/api/social/e2ee/account/bundle/target-device-01",
        json={"encrypted_bundle": "bund-1"},
        cookies=owner_cookies,
        headers=kopf,
    )
    assert erste.status_code == 200, erste.text

    zweite = client.post(
        "/api/social/e2ee/account/bundle/target-device-01",
        json={"encrypted_bundle": "bund-2"},
        cookies=owner_cookies,
        headers=kopf,
    )
    assert zweite.status_code == 409, zweite.text

    ohne_bund = client.post(
        "/api/social/e2ee/account/bundle/target2-device-1",
        json={"encrypted_bundle": "bund-3"},
        cookies=owner_cookies,
        headers={"X-Device-Id": "third-device-001", "X-CSRF-Token": csrf_token or ""},
    )
    assert ohne_bund.status_code == 403, ohne_bund.text


def test_migration_archiviert_alte_umschlaege(tmp_path, pg_wegwerf):
    """Ein Upgrade loescht keine alten Zeilen, sondern legt sie als legacy_ ab."""
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect, text

    from config import settings
    from database import Base

    db_url = pg_wegwerf("archiv")
    vorher = settings.database_url
    settings.database_url = db_url
    backend = __import__("pathlib").Path(__file__).resolve().parent.parent
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    engine = create_engine(db_url)
    try:
        Base.metadata.create_all(engine)
        command.stamp(config, "head")
        command.downgrade(config, "20261024_02")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO e2ee_blind_envelopes "
                    "(blind_mailbox_id, ciphertext_envelope, ciphertext_sha256, client_uuid, created_at) "
                    "VALUES ('box-archiv', 'chiffrat', NULL, 'uuid-archiv', now())"
                )
            )
        command.upgrade(config, "head")

        namen = set(inspect(engine).get_table_names())
        assert "e2ee_blind_envelopes" not in namen
        assert "legacy_e2ee_blind_envelopes" in namen
        with engine.connect() as conn:
            zahl = conn.execute(
                text("SELECT COUNT(*) FROM legacy_e2ee_blind_envelopes WHERE client_uuid = 'uuid-archiv'")
            ).scalar()
        assert zahl == 1
    finally:
        settings.database_url = vorher


def test_gruppenadmin_darf_verfall_einschalten(db: Session, owner_user: User, regular_user: User):
    gruppe = _gruppe_mit_mitglied(db, owner_user, regular_user)
    mitglied = (
        db.query(ChatGroupMember)
        .filter_by(group_id=gruppe.id, user_id=regular_user.id)
        .one()
    )
    mitglied.role = "admin"
    db.commit()

    stand = messages_service.set_ephemeral(db, regular_user, "group", gruppe.id, 1800)
    assert stand["ephemeral_enabled_by_user_id"] == regular_user.id
