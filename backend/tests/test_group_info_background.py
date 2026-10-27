"""Getrennte Gruppeninfo und geteilter Hintergrund: Rechte, Revision, Grenzen.

Seit 27.10.2026 liegen Name, Beschreibung und Bild einer Gruppe nicht mehr im
Rollenblock. Der Grund ist die Trennung der Rechte: ``edit_group`` darf die
Info schreiben, aber keine Rollen; ``manage_roles`` darf Rollen schreiben, aber
keine Info; ``set_group_background`` gehört niemandem davon. Der Server sieht
in beiden Blöcken nur Chiffrat.
"""

from __future__ import annotations

import base64

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from models import ChatGroupBackground, ChatGroupInfo, User
from schemas.social import (
    MAX_GROUP_BACKGROUND_BYTES,
    MAX_GROUP_INFO_BYTES,
    ChatGroupBackgroundWrite,
    ChatGroupInfoWrite,
)
from services.social.grenzen import GROUP_PERMISSIONS, GROUP_ROLE_ONLY_PERMISSIONS
from services.social_service import SocialService
from services.sync_event_service import SyncEventService


def _blob(fuellung: int = 7) -> str:
    rumpf = bytes((fuellung + i) % 251 + 1 for i in range(40))
    return "sv-e2ee-group-v1:" + "a1b2c3d4e5f60789" + "." + base64.b64encode(rumpf).decode()


def _fremder(db: Session) -> User:
    vorhanden = db.query(User).filter(User.username == "fremder").first()
    if vorhanden:
        return vorhanden
    from services.auth_service import AuthService

    user = AuthService.create_user(db, "fremder", "fremder@test.de", "FremdPass123!")
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user


def _gruppe(db: Session, besitzer: User, mitglied: User):
    gruppe = SocialService.create_group(db, besitzer)
    SocialService.join_group_by_invite_code(db, mitglied, gruppe.invite_code)
    return gruppe


def _rechte(db: Session, gruppe_id: int, user: User, rechte: str) -> None:
    mitgliedschaft = SocialService.get_group_member(db, gruppe_id, user.id)
    mitgliedschaft.permissions = rechte
    db.commit()


# ── Vokabular und Standardrechte ────────────────────────────────────────────


def test_beide_rechte_stehen_im_vokabular() -> None:
    assert "edit_group" in GROUP_PERMISSIONS
    assert "set_group_background" in GROUP_PERMISSIONS


def test_die_neuen_rechte_haengen_nur_an_rollen() -> None:
    # Als Standardrecht für alle änderte jedes neue Mitglied den Gruppennamen
    # und den geteilten Hintergrund.
    assert "edit_group" in GROUP_ROLE_ONLY_PERMISSIONS
    assert "set_group_background" in GROUP_ROLE_ONLY_PERMISSIONS


def test_standardrechte_koennen_die_neuen_rechte_nicht_tragen(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    for recht in ("edit_group", "set_group_background"):
        with pytest.raises(HTTPException) as fehler:
            SocialService.update_group_default_permissions(
                db,
                group_id=gruppe.id,
                default_permissions=f"send_messages,{recht}",
                caller=owner_user,
            )
        assert fehler.value.status_code == 422
        assert recht in fehler.value.detail


# ── Wer schreiben darf ──────────────────────────────────────────────────────


def test_eigentuemer_schreibt_info_und_hintergrund(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)

    info = SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=owner_user
    )
    hintergrund = SocialService.write_group_background(
        db,
        group_id=gruppe.id,
        blob=_blob(2),
        erwartete_revision=0,
        caller=owner_user,
        mime="image/webp",
    )

    assert info.revision == 1
    assert info.blob == _blob(1)
    assert hintergrund.revision == 1
    assert hintergrund.mime == "image/webp"
    assert hintergrund.size_bytes > 0


def test_mitglied_ohne_recht_wird_abgewiesen(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    _rechte(db, gruppe.id, regular_user, "send_messages")

    for schreiben in (SocialService.write_group_info, SocialService.write_group_background):
        with pytest.raises(HTTPException) as fehler:
            schreiben(
                db,
                group_id=gruppe.id,
                blob=_blob(),
                erwartete_revision=0,
                caller=regular_user,
            )
        assert fehler.value.status_code == 403


def test_edit_group_oeffnet_keine_rollen(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    _rechte(db, gruppe.id, regular_user, "send_messages,edit_group")

    SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(), erwartete_revision=0, caller=regular_user
    )

    with pytest.raises(HTTPException) as fehler:
        SocialService.write_group_config(
            db, group_id=gruppe.id, blob=_blob(3), erwartete_revision=0, caller=regular_user
        )
    assert fehler.value.status_code == 403


def test_manage_roles_oeffnet_keine_gruppeninfo(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    _rechte(db, gruppe.id, regular_user, "send_messages,manage_roles")

    # Rollen ja …
    SocialService.write_group_config(
        db, group_id=gruppe.id, blob=_blob(3), erwartete_revision=0, caller=regular_user
    )
    # … Info und Hintergrund nein.
    for schreiben in (SocialService.write_group_info, SocialService.write_group_background):
        with pytest.raises(HTTPException) as fehler:
            schreiben(
                db,
                group_id=gruppe.id,
                blob=_blob(),
                erwartete_revision=0,
                caller=regular_user,
            )
        assert fehler.value.status_code == 403


def test_set_group_background_oeffnet_keine_info(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    _rechte(db, gruppe.id, regular_user, "send_messages,set_group_background")

    SocialService.write_group_background(
        db, group_id=gruppe.id, blob=_blob(2), erwartete_revision=0, caller=regular_user
    )

    with pytest.raises(HTTPException) as fehler:
        SocialService.write_group_info(
            db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=regular_user
        )
    assert fehler.value.status_code == 403


def test_nichtmitglied_sieht_die_gruppe_nicht(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    fremder = _fremder(db)

    with pytest.raises(HTTPException) as fehler:
        SocialService.write_group_info(
            db, group_id=gruppe.id, blob=_blob(), erwartete_revision=0, caller=fremder
        )
    assert fehler.value.status_code == 404

    with pytest.raises(HTTPException) as fehler:
        SocialService.get_group_background(db, group_id=gruppe.id, caller=fremder)
    assert fehler.value.status_code == 404


# ── Lesen ───────────────────────────────────────────────────────────────────


def test_mitglied_liest_info_und_hintergrund(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=owner_user
    )
    SocialService.write_group_background(
        db, group_id=gruppe.id, blob=_blob(2), erwartete_revision=0, caller=owner_user
    )

    assert SocialService.get_group_info(db, gruppe.id, regular_user).blob == _blob(1)
    assert SocialService.get_group_background(db, gruppe.id, regular_user).blob == _blob(2)


def test_info_und_hintergrund_bleiben_getrennt(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=owner_user
    )

    assert SocialService.get_group_background(db, gruppe.id, owner_user) is None
    assert SocialService.get_group_config(db, gruppe.id, owner_user) is None


# ── Revision ────────────────────────────────────────────────────────────────


def test_alte_revision_wird_nicht_zurueckgespielt(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=owner_user
    )
    SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(2), erwartete_revision=1, caller=owner_user
    )

    with pytest.raises(HTTPException) as fehler:
        SocialService.write_group_info(
            db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=1, caller=owner_user
        )
    assert fehler.value.status_code == 409
    assert fehler.value.detail["aktuelle_revision"] == 2
    assert SocialService.get_group_info(db, gruppe.id, owner_user).blob == _blob(2)


def test_zweiter_erster_stand_bekommt_konflikt(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    SocialService.write_group_background(
        db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=owner_user
    )

    with pytest.raises(HTTPException) as fehler:
        SocialService.write_group_background(
            db, group_id=gruppe.id, blob=_blob(9), erwartete_revision=0, caller=owner_user
        )
    assert fehler.value.status_code == 409
    assert fehler.value.detail["aktuelle_revision"] == 1


# ── Grenzen und Chiffrat ────────────────────────────────────────────────────


def test_klartext_wird_an_der_schemagrenze_abgewiesen() -> None:
    with pytest.raises(ValidationError):
        ChatGroupInfoWrite(blob='{"name": "Sichtbar"}', erwartete_revision=0)
    with pytest.raises(ValidationError):
        ChatGroupBackgroundWrite(blob='{"preset": "sterne"}', erwartete_revision=0)


def test_zu_grosse_info_wird_abgewiesen() -> None:
    riesig = _blob() + "A" * MAX_GROUP_INFO_BYTES
    with pytest.raises(ValidationError):
        ChatGroupInfoWrite(blob=riesig, erwartete_revision=0)


def test_zu_grosser_hintergrund_wird_abgewiesen() -> None:
    riesig = _blob() + "A" * MAX_GROUP_BACKGROUND_BYTES
    with pytest.raises(ValidationError):
        ChatGroupBackgroundWrite(blob=riesig, erwartete_revision=0)


def test_hintergrund_akzeptiert_nur_bild_mime() -> None:
    with pytest.raises(ValidationError):
        ChatGroupBackgroundWrite(blob=_blob(), erwartete_revision=0, mime="text/html")


def test_gespeicherter_block_bleibt_chiffrat(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=owner_user
    )
    SocialService.write_group_background(
        db, group_id=gruppe.id, blob=_blob(2), erwartete_revision=0, caller=owner_user
    )

    info = db.query(ChatGroupInfo).filter(ChatGroupInfo.group_id == gruppe.id).one()
    hintergrund = (
        db.query(ChatGroupBackground)
        .filter(ChatGroupBackground.group_id == gruppe.id)
        .one()
    )
    assert info.blob.startswith("sv-e2ee-group-v1:")
    assert hintergrund.blob.startswith("sv-e2ee-group-v1:")
    assert "Sichtbar" not in info.blob
    assert "preset" not in hintergrund.blob


# ── Ereignisse und Marken ───────────────────────────────────────────────────


def test_ereignisse_gehen_an_alle_mitglieder(
    db: Session, owner_user: User, regular_user: User, monkeypatch
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)
    ereignisse: list[tuple[dict, dict]] = []
    monkeypatch.setattr(
        SyncEventService,
        "publish",
        lambda ereignis, **kwargs: ereignisse.append((ereignis, kwargs)),
    )

    SocialService.write_group_info(
        db, group_id=gruppe.id, blob=_blob(1), erwartete_revision=0, caller=owner_user
    )
    SocialService.write_group_background(
        db, group_id=gruppe.id, blob=_blob(2), erwartete_revision=0, caller=owner_user
    )

    info_ereignisse = [
        kwargs["user_id"]
        for ereignis, kwargs in ereignisse
        if ereignis["type"] == "chat_group_info_updated"
    ]
    hintergrund_ereignisse = [
        kwargs["user_id"]
        for ereignis, kwargs in ereignisse
        if ereignis["type"] == "chat_group_background_updated"
    ]
    assert set(info_ereignisse) == {owner_user.id, regular_user.id}
    assert set(hintergrund_ereignisse) == {owner_user.id, regular_user.id}


def test_gruppenliste_meldet_die_neuen_rechte(
    db: Session, owner_user: User, regular_user: User
) -> None:
    gruppe = _gruppe(db, owner_user, regular_user)

    meins = next(g for g in SocialService.list_user_groups(db, owner_user.id) if g["id"] == gruppe.id)
    assert meins["can_edit_group"] is True
    assert meins["can_set_group_background"] is True
    assert meins["can_manage_roles"] is True
    besitzer = next(m for m in meins["members"] if m["user_id"] == owner_user.id)
    assert besitzer["can_edit_group"] is True
    assert besitzer["can_set_group_background"] is True

    _rechte(db, gruppe.id, regular_user, "send_messages,edit_group")
    seins = next(
        g for g in SocialService.list_user_groups(db, regular_user.id) if g["id"] == gruppe.id
    )
    assert seins["can_edit_group"] is True
    assert seins["can_set_group_background"] is False
    assert seins["can_manage_roles"] is False
    sein_eintrag = next(m for m in seins["members"] if m["user_id"] == regular_user.id)
    assert sein_eintrag["can_edit_group"] is True
    assert sein_eintrag["can_set_group_background"] is False
