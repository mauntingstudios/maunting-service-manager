from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    User,
    ChatGroup,
    ChatGroupBackground,
    ChatGroupConfig,
    ChatGroupInfo,
    ChatGroupMember,
)
from models.chat_group import generate_invite_code
from services.sync_event_service import SyncEventService
from services.call_room_service import GroupCallRoomRegistry, UserActiveCallRegistry
from services.social.basis import _now
from services.social.grenzen import (
    GROUP_ROLE_ONLY_PERMISSIONS,
)

logger = logging.getLogger(__name__)


class GruppenMixin:
    @classmethod
    def create_group(cls, db: Session, user: User) -> ChatGroup:
        """Legt eine Gruppe an — ohne Namen.

        Bis Stufe 6 nahm diese Stelle einen Namen entgegen, prüfte seine Länge
        und legte ihn ab. Sie tut nichts davon mehr: Name, Beschreibung und
        Logo liegen im verschlüsselten Gruppenblock und in der
        Einladungskarte, und dieser Server kennt sie nicht.

        Was bleibt, ist das Gerüst, das er tragen muss und nur er tragen kann:
        eine Kennung, ein Eigentümer, ein Einladungscode, eine erste
        Mitgliedschaft.
        """
        cls.assert_social_enabled(db)

        import secrets
        invite_code = secrets.token_urlsafe(16)

        group = ChatGroup(
            invite_code=invite_code,
            owner_user_id=user.id,
            default_permissions="send_messages,attach_media,invite_members",
            created_at=_now(),
        )
        db.add(group)
        db.flush()

        member = ChatGroupMember(
            group_id=group.id,
            user_id=user.id,
            role="owner",
            joined_at=_now(),
        )
        db.add(member)
        db.commit()
        db.refresh(group)
        return group

    @classmethod
    def list_user_groups(cls, db: Session, user_id: int) -> list[dict[str, Any]]:
        cls.assert_social_enabled(db)
        memberships = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.user_id == user_id)
            .all()
        )
        if not memberships:
            return []

        group_ids = [m.group_id for m in memberships]
        groups = db.query(ChatGroup).filter(ChatGroup.id.in_(group_ids)).all()
        all_members = (
            db.query(ChatGroupMember, User.username, User.avatar_url)
            .join(User, User.id == ChatGroupMember.user_id)
            .filter(ChatGroupMember.group_id.in_(group_ids))
            .all()
        )

        default_by_group = {g.id: g.default_permissions for g in groups}

        members_by_group: dict[int, list[dict[str, Any]]] = {}
        for mem, uname, uavatar in all_members:
            # Einmal ausgerechnet, zweimal gebraucht: fuer die Rechteliste und
            # fuer die Marken darunter. ``effective_permissions`` ist dieselbe
            # Funktion, die ``has_group_permission`` befragt — kein zweiter
            # Regelsatz, der auseinanderlaufen koennte.
            wirksam = cls.effective_permissions(
                mem.permissions, default_by_group.get(mem.group_id), mem.role
            )
            members_by_group.setdefault(mem.group_id, []).append({
                "user_id": mem.user_id,
                "username": uname,
                "avatar_url": uavatar,
                "role": mem.role,
                # Kanonisch nach aussen, damit die Oberflaeche nur ein
                # Vokabular kennt. Was in der Spalte steht, kann noch alt sein.
                "permissions": (
                    ",".join(sorted(cls.expand_group_permissions(mem.permissions)))
                    if mem.permissions is not None
                    else None
                ),
                # Der Server kann den Inhalt einer Nachricht nicht lesen und
                # deshalb nicht pruefen, ob jemand ``@everyone`` geschrieben,
                # eine Nachricht angeheftet oder die Verfallsfrist gestellt
                # hat. Das entscheidet der **empfangende** Client — und er
                # braucht dafuer die Rechtelage des *Absenders*, nicht seine
                # eigene. Darum steht die Marke hier an jedem Mitglied und
                # nicht nur an der Gruppe.
                "can_mention_everyone": "mention_everyone" in wirksam,
                "can_pin_messages": "pin_messages" in wirksam,
                "can_set_disappearing_messages": "set_disappearing_messages" in wirksam,
                "can_edit_group": "edit_group" in wirksam,
                "can_set_group_background": "set_group_background" in wirksam,
                "joined_at": mem.joined_at,
            })

        mein_eintrag = {m.group_id: m for m in memberships}

        results = []
        for g in groups:
            mems = members_by_group.get(g.id, [])
            offener_raum = GroupCallRoomRegistry.find_for_group(g.id)
            # Dieselbe Regel wie `has_group_permission` und `darf_einladen`,
            # nur aus den schon geladenen Zeilen. Bis 27.09.2026 fragte jede
            # Marke die Datenbank einzeln: neun bis achtzehn Abfragen je
            # Gruppe, alle 15 Sekunden je offenem Messenger.
            ich = mein_eintrag[g.id]
            darf = cls.effective_permissions(ich.permissions, g.default_permissions, ich.role)
            darf_einladen = ich.role in ("owner", "admin") or "invite_members" in darf
            results.append({
                "id": g.id,
                # Seit Stufe 6 leer, und zwar an der Quelle: die Spalten sind
                # geräumt, und niemand schreibt mehr hinein. Der Client setzt
                # Name, Beschreibung und Logo aus dem verschlüsselten Block.
                "name": None,
                "description": None,
                "avatar_url": None,
                # Nur für die, die einladen dürfen. Der Code ist ein Geheimnis,
                # das Zugang gewährt — er hat in der Antwort an ein Mitglied
                # ohne dieses Recht nichts verloren.
                "invite_code": g.invite_code if darf_einladen else None,
                "owner_user_id": g.owner_user_id,
                "default_permissions": ",".join(
                    sorted(
                        cls.expand_group_permissions(
                            g.default_permissions or "send_messages,attach_media,invite_members"
                        )
                    )
                ),
                "member_count": len(mems),
                "role": ich.role,
                # Dieselbe Entscheidung, die der Anruf-Endpunkt trifft. Ohne sie
                # muesste das Frontend die Regel nachbauen und wuerde einen Knopf
                # zeigen, den das Backend danach mit 403 beantwortet.
                "can_start_call": "start_group_calls" in darf,
                "can_join_call": "join_group_calls" in darf,
                "can_share_screen": "share_screen" in darf,
                "can_mute_others": "mute_in_calls" in darf,
                "can_kick_from_call": "kick_from_calls" in darf,
                # Ob **ich** den Knopf sehe. Die Schranke sitzt beim Empfaenger,
                # das hier ist nur die Bequemlichkeit: eine Auswahl anzubieten,
                # die beim Gegenueber folgenlos verpufft, waere irrefuehrend.
                "can_mention_everyone": "mention_everyone" in darf,
                "can_pin_messages": "pin_messages" in darf,
                "can_set_disappearing_messages": "set_disappearing_messages" in darf,
                # Wer die Gruppeninfo (Name, Beschreibung, Bild) schreiben darf,
                # getrennt von den Rollen. ``manage_roles`` ist bei
                # Eigentümern und Administratoren nicht Teil der wirksamen
                # Rechte — dieselbe Ausnahme wie in
                # ``darf_gruppenzustand_schreiben``.
                "can_edit_group": "edit_group" in darf,
                "can_set_group_background": "set_group_background" in darf,
                "can_manage_roles": ich.role in ("owner", "admin") or "manage_roles" in darf,
                "created_at": g.created_at,
                "members": mems,
                "room_token": offener_raum,
                "live_call": offener_raum is not None,
            })

        # Nach Alter, nicht nach Namen: seit 09/2026 kennt der Server keinen
        # Namen mehr, nach dem er sortieren koennte. Die alphabetische Ordnung
        # macht der Client, sobald er die Namen entschluesselt hat -- dort
        # liegt das Wissen, und nur dort kann sie stimmen. `created_at` ist
        # ohnehin Teil der Antwort und verraet damit nichts Neues.
        return sorted(results, key=lambda x: (x["created_at"], x["id"]))

    @classmethod
    def get_group_by_invite_code(cls, db: Session, invite_code: str) -> ChatGroup:
        cls.assert_social_enabled(db)
        clean_code = invite_code.strip()
        group = db.query(ChatGroup).filter(ChatGroup.invite_code == clean_code).first()
        if not group:
            raise HTTPException(status_code=404, detail="Einladungslink ist ungültig oder abgelaufen.")
        return group

    @classmethod
    def join_group_by_invite_code(cls, db: Session, user: User, invite_code: str) -> ChatGroup:
        cls.assert_social_enabled(db)
        group = cls.get_group_by_invite_code(db, invite_code)
        existing = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group.id, ChatGroupMember.user_id == user.id)
            .first()
        )
        if not existing:
            new_member = ChatGroupMember(
                group_id=group.id,
                user_id=user.id,
                role="member",
                joined_at=_now(),
            )
            db.add(new_member)
            db.commit()
            db.refresh(group)

            # Auch die übrigen Mitglieder sollen die Liste live sehen; der
            # Beitretende bekommt das Ereignis über denselben Weg.
            cls._melde_an_alle(
                db,
                group.id,
                {
                    "type": "chat_group_joined",
                    "group_id": group.id,
                    "user_id": user.id,
                    "username": user.username,
                },
            )

        return group

    @classmethod
    def leave_group(cls, db: Session, user: User, group_id: int) -> None:
        cls.assert_social_enabled(db)
        cls.trage_mitglied_aus(db, group_id, user.id)
        db.commit()
        cls._melde_an_alle(
            db,
            group_id,
            {
                "type": "chat_group_member_left",
                "group_id": group_id,
                "user_id": user.id,
            },
        )
        cls._aus_gruppenanruf_nehmen(db, group_id, user.id)

    @classmethod
    def _aus_gruppenanruf_nehmen(cls, db: Session, group_id: int, user_id: int) -> None:
        """Wer die Gruppe verlässt oder hinausfliegt, verlässt auch ihren Anruf.

        Bis 26.09.2026 blieb er drin und hörte und sah weiter mit. Der Server
        wirft ihn aus dem Medienraum; die Verbliebenen bekommen ein Ereignis,
        und der Schlüsselhalter tauscht daraufhin den Raumschlüssel
        (`useCallStore`). Das ist die eigentliche Sperre: das LiveKit-Token
        läuft noch bis zu einer Stunde und lässt sich nicht widerrufen, einen
        neuen Schlüssel bekommt er aber nicht mehr (`/calls/{raum}/key` prüft
        die Mitgliedschaft).
        """
        raum = GroupCallRoomRegistry.find_for_group(group_id)
        if not raum:
            return
        UserActiveCallRegistry.leave(user_id, raum=raum)
        from services import livekit_service

        try:
            livekit_service.entferne_teilnehmer(raum, f"u{user_id}", db)
        except livekit_service.LivekitNichtErreichbar:
            # Der Austritt selbst gilt trotzdem; der Schlüsseltausch sperrt ihn aus.
            logger.warning("Teilnehmer nach Gruppenaustritt nicht aus dem Anruf entfernt")
        ereignis = {
            "type": "group_call_member_removed",
            "group_id": group_id,
            "room_token": raum,
            "user_id": user_id,
        }
        empfaenger = {
            mid for (mid,) in db.query(ChatGroupMember.user_id).filter(ChatGroupMember.group_id == group_id)
        }
        empfaenger.add(user_id)
        for mid in empfaenger:
            SyncEventService.publish(ereignis, user_id=mid)

    @classmethod
    def trage_mitglied_aus(cls, db: Session, group_id: int, user_id: int) -> None:
        """Nimmt jemanden aus einer Gruppe, ohne zu committen.

        Bleibt niemand übrig, fällt die Gruppe weg. Geht der Eigentümer, erbt
        ein Admin, sonst das am längsten beigetretene Mitglied. Auch die
        Kontolöschung läuft hier durch: `chat_groups.owner_user_id` kaskadiert,
        ohne Nachfolger nähme das Löschen eines Eigentümers seine Gruppen
        allen anderen Mitgliedern weg.
        """
        group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
        if not group:
            return
        member = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id, ChatGroupMember.user_id == user_id)
            .first()
        )
        was_owner = group.owner_user_id == user_id or (member is not None and member.role == "owner")
        if member:
            db.delete(member)
            db.flush()

        remaining = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id)
            .order_by(
                (ChatGroupMember.role == "admin").desc(),
                ChatGroupMember.joined_at,
                ChatGroupMember.id,
            )
            .all()
        )
        if not remaining:
            db.delete(group)
        elif was_owner:
            remaining[0].role = "owner"
            group.owner_user_id = remaining[0].user_id
        db.flush()

    @classmethod
    def delete_group(cls, db: Session, user: User, group_id: int) -> None:
        cls.assert_social_enabled(db)
        group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Gruppe nicht gefunden.")
        if group.owner_user_id != user.id:
            mem = (
                db.query(ChatGroupMember)
                .filter(
                    ChatGroupMember.group_id == group_id,
                    ChatGroupMember.user_id == user.id,
                    ChatGroupMember.role == "owner",
                )
                .first()
            )
            if not mem:
                raise HTTPException(status_code=403, detail="Nur der Eigentümer kann die Gruppe löschen.")
        mitglieder = [
            mid for (mid,) in db.query(ChatGroupMember.user_id).filter(ChatGroupMember.group_id == group_id)
        ]
        db.delete(group)
        db.commit()
        # Ohne Gruppe kein Anruf: der Raum endet für alle.
        raum = GroupCallRoomRegistry.find_for_group(group_id)
        if raum:
            GroupCallRoomRegistry.discard(raum)
            UserActiveCallRegistry.remove_room(raum)
            for mid in mitglieder:
                SyncEventService.publish(
                    {"type": "group_call_ended", "group_id": group_id, "room_token": raum, "ended_by": user.id},
                    user_id=mid,
                )

    @classmethod
    def update_member_role_permissions(
        cls,
        db: Session,
        group_id: int,
        target_user_id: int,
        role: str,
        permissions: str | None,
        caller: User,
    ) -> dict[str, Any]:
        cls.assert_social_enabled(db)
        caller_mem = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id, ChatGroupMember.user_id == caller.id)
            .first()
        )
        if not caller_mem or caller_mem.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Keine Berechtigung zum Ändern von Gruppenrollen.")

        target_mem = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id, ChatGroupMember.user_id == target_user_id)
            .first()
        )
        if not target_mem:
            raise HTTPException(status_code=404, detail="Gruppenmitglied nicht gefunden.")

        if target_mem.role == "owner" and caller.id != target_mem.user_id:
            raise HTTPException(status_code=403, detail="Die Rolle des Gruppen-Eigentümers kann nicht geändert werden.")

        if target_mem.role == "admin" and caller_mem.role != "owner" and caller.id != target_user_id:
            raise HTTPException(status_code=403, detail="Nur der Eigentümer kann die Rolle anderer Administratoren anpassen.")

        target_mem.role = role
        target_mem.permissions = cls.assert_known_permissions(permissions) if permissions else None
        db.commit()
        db.refresh(target_mem)

        cls._melde_an_alle(
            db,
            group_id,
            {
                "type": "chat_group_member_updated",
                "group_id": group_id,
                "user_id": target_user_id,
                "role": target_mem.role,
                "permissions": target_mem.permissions,
            },
        )

        target_user = db.query(User).filter(User.id == target_user_id).first()
        return {
            "user_id": target_mem.user_id,
            "username": target_user.username if target_user else f"User #{target_mem.user_id}",
            "avatar_url": target_user.avatar_url if target_user else None,
            "role": target_mem.role,
            "permissions": target_mem.permissions,
            "joined_at": target_mem.joined_at,
        }

    @classmethod
    def kick_group_member(
        cls,
        db: Session,
        group_id: int,
        target_user_id: int,
        caller: User,
    ) -> ChatGroup:
        """Wirft ein Mitglied hinaus und erneuert dabei den Einladungscode.

        Wer hinausgeworfen wird, kennt den Code oft: er hatte das
        Einladungsrecht, oder der Link stand im Verlauf. Bis 09/2026 blieb der
        Code gültig, und der Rauswurf war eine Formalie — ein Klick auf den
        alten Link, und er war wieder drin.

        Die Einladungskarte geht mit. Ihre gebundenen Daten nennen den alten
        Code; gegen den neuen öffnet sie sich nicht mehr. Wer als Nächstes
        einen Link teilt, hinterlegt eine neue.
        """
        cls.assert_social_enabled(db)
        caller_mem = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id, ChatGroupMember.user_id == caller.id)
            .first()
        )
        if not caller_mem:
            raise HTTPException(status_code=403, detail="Du bist kein Mitglied dieser Gruppe.")

        can_kick = (
            caller_mem.role in ("owner", "admin")
            or (caller_mem.permissions and "kick_members" in caller_mem.permissions)
        )
        if not can_kick:
            raise HTTPException(status_code=403, detail="Keine Berechtigung zum Entfernen von Mitgliedern.")

        target_mem = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id, ChatGroupMember.user_id == target_user_id)
            .first()
        )
        if not target_mem:
            raise HTTPException(status_code=404, detail="Gruppenmitglied nicht gefunden.")

        if target_mem.role == "owner":
            raise HTTPException(status_code=403, detail="Der Eigentümer der Gruppe kann nicht entfernt werden.")

        if target_mem.role == "admin" and caller_mem.role != "owner":
            raise HTTPException(status_code=403, detail="Nur der Eigentümer kann Administratoren entfernen.")

        group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Gruppe nicht gefunden.")

        db.delete(target_mem)
        # Im selben Commit: ein Rauswurf ohne neuen Code wäre genau der Zustand,
        # den diese Stelle beenden soll.
        group.invite_code = generate_invite_code()
        group.invite_card = None
        db.commit()
        db.refresh(group)

        SyncEventService.publish(
            {
                "type": "chat_group_member_kicked",
                "group_id": group_id,
                "user_id": target_user_id,
            },
            user_id=target_user_id,
        )
        # Die Verbliebenen sehen den Austritt ebenfalls, sonst bleibt die
        # Mitgliederliste der Einstellungsseite stehen.
        cls._melde_an_alle(
            db,
            group_id,
            {
                "type": "chat_group_member_left",
                "group_id": group_id,
                "user_id": target_user_id,
            },
        )
        cls._aus_gruppenanruf_nehmen(db, group_id, target_user_id)
        return group

    @classmethod
    def update_group_default_permissions(
        cls,
        db: Session,
        group_id: int,
        default_permissions: str,
        caller: User,
    ) -> ChatGroup:
        cls.assert_social_enabled(db)
        caller_mem = (
            db.query(ChatGroupMember)
            .filter(ChatGroupMember.group_id == group_id, ChatGroupMember.user_id == caller.id)
            .first()
        )
        if not caller_mem or caller_mem.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Keine Berechtigung zum Konfigurieren der Standard-Gruppenrechte.")

        group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Gruppe nicht gefunden.")

        clean_perms = cls.assert_known_permissions(default_permissions) or ""
        # Nach dem Auflösen der Aliase prüfen, nicht davor: sonst käme ein
        # künftiger Aliasname auf ein nur-Rollen-Recht hier ungesehen durch.
        nur_rollen = sorted(
            set(p for p in clean_perms.split(",") if p) & GROUP_ROLE_ONLY_PERMISSIONS
        )
        if nur_rollen:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Diese Berechtigung gehört an eine Rolle, nicht an die "
                    f"Standardrechte aller Mitglieder: {', '.join(nur_rollen)}"
                ),
            )
        group.default_permissions = clean_perms
        db.commit()
        db.refresh(group)

        # Notify all group members
        cls._melde_an_alle(
            db,
            group_id,
            {
                "type": "chat_group_permissions_updated",
                "group_id": group.id,
                "default_permissions": group.default_permissions,
            },
        )

        return group

    @classmethod
    def get_group_config(cls, db: Session, group_id: int, caller: User) -> ChatGroupConfig | None:
        """Liest den verschlüsselten Rollenblock. Jedes Mitglied darf das.

        Eine engere Schranke am Server wäre Schein: öffnen kann den Block nur,
        wer den Gruppenschlüssel hat, und wer den hat, ist Mitglied. Für ein
        Nichtmitglied ist die Antwort 404, nicht 403 — sonst verriete sie,
        dass es diese Gruppe gibt.
        """
        cls.assert_social_enabled(db)
        cls._mitglied_oder_404(db, group_id, caller)
        return (
            db.query(ChatGroupConfig).filter(ChatGroupConfig.group_id == group_id).first()
        )

    @classmethod
    def write_group_config(
        cls,
        db: Session,
        group_id: int,
        blob: str,
        erwartete_revision: int,
        caller: User,
    ) -> ChatGroupConfig:
        """Schreibt den nächsten Rollenstand — nur wenn niemand dazwischenkam.

        Der Server liest den Block nie. Er prüft Mitgliedschaft und
        Schreibrecht; die Revision schützt davor, dass ein alter Stand einen
        Rechteentzug rückgängig macht. Wer schreiben durfte, steht in der
        Unterschrift **innerhalb** des Blocks — das prüfen die Mitglieder nach
        dem Entschlüsseln.
        """
        cls.assert_social_enabled(db)
        cls._mitglied_oder_404(db, group_id, caller)
        if not cls.darf_gruppenzustand_schreiben(db, group_id, caller.id):
            raise HTTPException(
                status_code=403, detail="Keine Berechtigung, die Rollen dieser Gruppe zu ändern."
            )
        eintrag = cls._revisioniert_schreiben(
            db, ChatGroupConfig, group_id, blob, erwartete_revision
        )
        cls._melde_an_alle(
            db,
            group_id,
            {
                "type": "chat_group_config_updated",
                "group_id": group_id,
                "revision": eintrag.revision,
            },
        )
        return eintrag

    @classmethod
    def get_group_info(cls, db: Session, group_id: int, caller: User) -> ChatGroupInfo | None:
        """Die verschlüsselte Gruppeninfo. Lesen darf jedes Mitglied."""
        cls.assert_social_enabled(db)
        cls._mitglied_oder_404(db, group_id, caller)
        return db.query(ChatGroupInfo).filter(ChatGroupInfo.group_id == group_id).first()

    @classmethod
    def write_group_info(
        cls,
        db: Session,
        group_id: int,
        blob: str,
        erwartete_revision: int,
        caller: User,
    ) -> ChatGroupInfo:
        """Name, Beschreibung und Logo — nur mit ``edit_group``.

        Der Rollenblock bleibt bei ``/config``: ``edit_group`` öffnet keine
        Rollen, und ``manage_roles`` öffnet diese Route nicht. Der Server
        liest den Block nie; er prüft Mitgliedschaft, Revision und Größe.
        """
        cls.assert_social_enabled(db)
        cls._mitglied_oder_404(db, group_id, caller)
        if not cls.darf_gruppeninfo_schreiben(db, group_id, caller.id):
            raise HTTPException(
                status_code=403, detail="Keine Berechtigung, die Gruppeninfo zu ändern."
            )
        eintrag = cls._revisioniert_schreiben(
            db, ChatGroupInfo, group_id, blob, erwartete_revision
        )
        cls._melde_an_alle(
            db,
            group_id,
            {
                "type": "chat_group_info_updated",
                "group_id": group_id,
                "revision": eintrag.revision,
            },
        )
        return eintrag

    @classmethod
    def get_group_background(
        cls, db: Session, group_id: int, caller: User
    ) -> ChatGroupBackground | None:
        """Der geteilte Gruppenhintergrund. Lesen darf jedes Mitglied."""
        cls.assert_social_enabled(db)
        cls._mitglied_oder_404(db, group_id, caller)
        return (
            db.query(ChatGroupBackground)
            .filter(ChatGroupBackground.group_id == group_id)
            .first()
        )

    @classmethod
    def write_group_background(
        cls,
        db: Session,
        group_id: int,
        blob: str,
        erwartete_revision: int,
        caller: User,
        mime: str | None = None,
    ) -> ChatGroupBackground:
        """Der Hintergrund gehört der Gruppe, nicht dem Gerät.

        Deshalb ein eigener Block, ein eigenes Recht und ein eigenes Ereignis:
        wer ihn setzt, ändert die Ansicht **aller** Mitglieder.
        """
        cls.assert_social_enabled(db)
        cls._mitglied_oder_404(db, group_id, caller)
        if not cls.darf_hintergrund_setzen(db, group_id, caller.id):
            raise HTTPException(
                status_code=403, detail="Keine Berechtigung, den Gruppenhintergrund zu ändern."
            )
        eintrag = cls._revisioniert_schreiben(
            db,
            ChatGroupBackground,
            group_id,
            blob,
            erwartete_revision,
            zusatz={"mime": mime, "size_bytes": len(blob.encode("utf-8"))},
        )
        cls._melde_an_alle(
            db,
            group_id,
            {
                "type": "chat_group_background_updated",
                "group_id": group_id,
                "revision": eintrag.revision,
                "mime": eintrag.mime,
            },
        )
        return eintrag

    @classmethod
    def _mitglied_oder_404(cls, db: Session, group_id: int, caller: User) -> None:
        if not cls.get_group_member(db, group_id, caller.id):
            raise HTTPException(status_code=404, detail="Gruppe nicht gefunden.")

    @classmethod
    def _melde_an_alle(
        cls, db: Session, group_id: int, ereignis: dict[str, Any]
    ) -> None:
        """Ein Ereignis an jedes Mitglied — nicht nur an das eigene Gerät.

        Die Einstellungsseite soll live bleiben, auch wenn ein anderes
        Mitglied schreibt. Der Server nennt dabei nur die Revision, nie den
        Inhalt.
        """
        for (mitglied_id,) in (
            db.query(ChatGroupMember.user_id)
            .filter(ChatGroupMember.group_id == group_id)
            .all()
        ):
            SyncEventService.publish(ereignis, user_id=mitglied_id)

    @classmethod
    def _revisioniert_schreiben(
        cls,
        db: Session,
        modell: type,
        group_id: int,
        blob: str,
        erwartete_revision: int,
        zusatz: dict[str, Any] | None = None,
    ):
        """Schreibt den nächsten Stand, genau dann, wenn niemand dazwischenkam.

        Gilt für Rollenblock, Gruppeninfo und geteilten Hintergrund. Der
        bedingte UPDATE verhindert, dass zwei Geräte beide Erfolg für dieselbe
        Revision melden; ``erwartete_revision == 0`` legt den ersten Stand an
        und meldet die Primärschlüssel-Kollision als Konflikt, nicht als 500.
        """
        jetzt = _now()
        werte = dict(zusatz or {})
        if erwartete_revision == 0:
            eintrag = modell(
                group_id=group_id, blob=blob, revision=1, updated_at=jetzt, **werte
            )
            db.add(eintrag)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise cls._revisionskonflikt(db, modell, group_id)
            db.refresh(eintrag)
        else:
            aenderungen = {getattr(modell, name): wert for name, wert in werte.items()}
            aenderungen.update(
                {
                    modell.blob: blob,
                    modell.revision: erwartete_revision + 1,
                    modell.updated_at: jetzt,
                }
            )
            betroffen = (
                db.query(modell)
                .filter(
                    modell.group_id == group_id,
                    modell.revision == erwartete_revision,
                )
                .update(aenderungen, synchronize_session=False)
            )
            if betroffen == 0:
                db.rollback()
                raise cls._revisionskonflikt(db, modell, group_id)
            db.commit()
            eintrag = db.query(modell).filter(modell.group_id == group_id).first()
        return eintrag

    @classmethod
    def _revisionskonflikt(cls, db: Session, modell: type, group_id: int) -> HTTPException:
        """409 mit dem Stand, den der Client als nächstes lesen muss."""
        aktuell = db.query(modell).filter(modell.group_id == group_id).first()
        return HTTPException(
            status_code=409,
            detail={
                "grund": "revision_veraltet",
                "aktuelle_revision": aktuell.revision if aktuell else 0,
                "nachricht": (
                    "Der Gruppenblock wurde inzwischen von einem anderen Gerät "
                    "geändert. Bitte neu laden."
                ),
            },
        )
