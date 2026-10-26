"""WebPush fuer neue Chatnachrichten.

Die Nachricht liegt bereits in ``e2ee_messages``. Push ist Beiwerk: ein
Fehler hier darf das Senden nicht scheitern lassen.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import E2eeMessage


def push_message(db: Session, message: E2eeMessage, mitglieder: set[int]) -> None:
    """WebPush an die uebrigen Mitglieder, solange die Gruppe ueberschaubar ist.

    Bei sehr grossen Gruppen waere ein Push je Mitglied teurer als der Nutzen;
    dort tragen Echtzeitkanal und Ungelesen-Stand. Der Absender bekommt keinen
    Push fuer seine eigene Nachricht.
    """
    if len(mitglieder) > 200:
        return
    try:
        from services import webpush_service

        for uid in mitglieder:
            if uid == message.sender_user_id:
                continue
            webpush_service.sende_an_konto(
                db,
                uid,
                {
                    "type": "chat_message",
                    "chat_type": message.chat_type,
                    "chat_id": int(message.chat_id),
                    "client_uuid": message.client_uuid,
                    "title": "Neue Nachricht",
                    "body": "Du hast eine neue verschluesselte Nachricht.",
                    "tag": f"msm-chat-{message.chat_type}-{message.chat_id}",
                },
            )
    except Exception:
        # Push ist Beiwerk; die Nachricht liegt bereits.
        return
