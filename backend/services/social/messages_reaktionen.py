"""Reaktionen zu Nachrichten buendeln.

Eine Seite mit vielen Nachrichten soll nicht je Zeile eine eigene Abfrage
ausloesen. Der Aufrufer holt alle Reaktionen der sichtbaren Kennungen in einem
Zug und ordnet sie danach den Nachrichten zu.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import E2eeMessageReaction


def reaktionen_fuer(
    db: Session,
    message_ids: list[int],
) -> dict[int, list[E2eeMessageReaction]]:
    if not message_ids:
        return {}
    rows = (
        db.query(E2eeMessageReaction)
        .filter(E2eeMessageReaction.message_id.in_(message_ids))
        .all()
    )
    out: dict[int, list[E2eeMessageReaction]] = {}
    for row in rows:
        out.setdefault(int(row.message_id), []).append(row)
    return out
