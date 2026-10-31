"""Reset, Schluesselpakete und der letzte Schluesselhalter.

Der Reset war bis 10/2026 nur ein Loeschen der Geraetezeilen: Konto und
verpackte Bunde blieben stehen, und danach konnte kein Geraet mehr eine neue
Identitaet anlegen. Diese Tests halten die drei Zusagen fest, die den Fall
aufloesen: der Reset raeumt die Konto-Identitaet und die eigenen
Chat-Schluessel, das Entfernen nimmt das Paket des Geraets mit, und der letzte
freigegebene Schluesselhalter laesst sich nicht versehentlich entfernen.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import (
    E2eeAccount,
    E2eeAccountKeyVault,
    E2eeChatKey,
    User,
    UserE2eeDevice,
)
from services import e2ee_device_service
from tests.test_e2ee_device_approval import RSA_A, RSA_B, _ecdsa_paar, _entfernen, _konto


def _geraet(db: Session, user: User, kennung: str, rsa: str, ecdsa: str) -> UserE2eeDevice:
    row = UserE2eeDevice(
        user_id=user.id,
        device_id=kennung,
        public_key_jwk=rsa,
        signing_public_key_jwk=ecdsa,
        label=kennung,
        is_approved=True,
    )
    db.add(row)
    db.flush()
    return row


def test_reset_removes_account_vault_and_only_own_chat_keys(
    db: Session, clean_db,
) -> None:
    user = _konto(db, "reset_eigen")
    other = _konto(db, "reset_fremd")
    _geraet(db, user, "geraet-eigen-1", RSA_A, _ecdsa_paar()[1])
    _geraet(db, other, "geraet-fremd-1", RSA_B, _ecdsa_paar()[1])
    db.add(E2eeAccount(
        user_id=user.id, public_key_jwk=RSA_A, signing_public_key_jwk=_ecdsa_paar()[1],
    ))
    db.add(E2eeAccountKeyVault(
        user_id=user.id, device_id="geraet-eigen-1", encrypted_bundle="bund",
    ))
    db.add_all([
        E2eeChatKey(
            chat_type="direct", chat_id=1, user_id=user.id,
            key_version=1, encrypted_chat_key="eigen",
        ),
        E2eeChatKey(
            chat_type="direct", chat_id=1, user_id=other.id,
            key_version=1, encrypted_chat_key="fremd",
        ),
    ])
    db.commit()

    ergebnis = e2ee_device_service.zuruecksetzen(db, user, None)

    assert ergebnis["account_reset"] is True
    assert ergebnis["removed"] == 1
    assert ergebnis["chat_keys_removed"] == 1
    assert db.query(E2eeAccount).filter_by(user_id=user.id).count() == 0
    assert db.query(E2eeAccountKeyVault).filter_by(user_id=user.id).count() == 0
    assert db.query(E2eeChatKey).filter_by(user_id=user.id).count() == 0
    assert db.query(UserE2eeDevice).filter_by(user_id=user.id).count() == 0
    # Fremde Chat-Schluessel gehoeren nicht diesem Reset.
    assert db.query(E2eeChatKey).filter_by(user_id=other.id).count() == 1

    # Und der eigentliche Zweck: nach dem Reset laesst sich eine **andere**
    # Konto-Identitaet anlegen. Vor dem Fix antwortete der Server hier 409,
    # und das Geraet blieb fuer immer schluessellos.
    from routers.social.e2ee_keys import AccountPublish, publish_account

    neue_signatur = _ecdsa_paar()[1]
    _geraet(db, user, "geraet-neu", RSA_B, neue_signatur)
    db.commit()
    antwort = publish_account(
        AccountPublish(
            device_id="geraet-neu",
            public_key=RSA_B,
            signing_public_key=neue_signatur,
            encrypted_bundle="neuer-bund",
        ),
        db=db,
        current_user=user,
    )
    assert antwort["public_key"] == RSA_B


def test_removing_a_device_deletes_its_wrapped_bundle(db: Session, clean_db) -> None:
    user = _konto(db, "vault_entfernen")
    priv_a, ecdsa_a = _ecdsa_paar()
    priv_b, ecdsa_b = _ecdsa_paar()
    _geraet(db, user, "geraet-a", RSA_A, ecdsa_a)
    _geraet(db, user, "geraet-b", RSA_B, ecdsa_b)
    db.add_all([
        E2eeAccountKeyVault(user_id=user.id, device_id="geraet-a", encrypted_bundle="a"),
        E2eeAccountKeyVault(user_id=user.id, device_id="geraet-b", encrypted_bundle="b"),
    ])
    db.commit()

    assert e2ee_device_service.vergessen(
        db, user, "geraet-b",
        approver_device_id="geraet-a",
        signature=_entfernen(priv_a, user.id, "geraet-b", RSA_B),
    )
    assert db.query(E2eeAccountKeyVault).filter_by(
        user_id=user.id, device_id="geraet-b"
    ).count() == 0
    assert db.query(E2eeAccountKeyVault).filter_by(
        user_id=user.id, device_id="geraet-a"
    ).count() == 1


def test_last_key_holder_is_reported_before_any_proof_is_used(
    db: Session, clean_db,
) -> None:
    user = _konto(db, "letzter_halter")
    _geraet(db, user, "geraet-a", RSA_A, _ecdsa_paar()[1])
    db.add(E2eeAccountKeyVault(
        user_id=user.id, device_id="geraet-a", encrypted_bundle="a",
    ))
    db.commit()

    assert e2ee_device_service.entfernen_hindernis(db, user, "geraet-a") == "letzter_schluesselhalter"


def test_has_account_key_is_computed_for_the_owner_only(db: Session, clean_db) -> None:
    user = _konto(db, "halter_anzeige")
    geraet = _geraet(db, user, "geraet-a", RSA_A, _ecdsa_paar()[1])
    db.add(E2eeAccountKeyVault(
        user_id=user.id, device_id="geraet-a", encrypted_bundle="a",
    ))
    db.commit()

    mit = e2ee_device_service.eintrag_als_dict(
        geraet, db, mit_kontoschluessel=True
    )
    ohne = e2ee_device_service.eintrag_als_dict(
        geraet, db, mit_kontoschluessel=False
    )
    assert mit["has_account_key"] is True
    assert "has_account_key" not in ohne
