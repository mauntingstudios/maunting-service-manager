"""Einwilligung und Hinweise des KI-Gedaechtnisses.

Herausgezogen aus `ai_memory_service`: die Einwilligung des Benutzers, die
Voreinstellung und die Erinnerung an den Hinweis. Der Dienst re-exportiert
alle Namen.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models import AiMemoryPreference, User
from services.ai_memory_krypto import _utc

logger = logging.getLogger(__name__)

NOTICE_REPEAT_HOURS = 24


def preference(db: Session, user_id: int) -> bool:
    """Darf sich die KI fuer diesen Benutzer etwas merken?

    Ohne Zeile: **nein**. Frueher stand hier `True` — das Gedaechtnis war also
    fuer jeden neuen Benutzer stillschweigend eingeschaltet. Das ist bei einer
    Funktion, deren Inhalt an einen externen Anbieter geht, die falsche
    Voreinstellung, unabhaengig davon, wie nuetzlich sie ist.
    """
    row = db.get(AiMemoryPreference, user_id)
    return False if row is None else row.enabled


def _preference_row(db: Session, user_id: int) -> AiMemoryPreference:
    row = db.get(AiMemoryPreference, user_id)
    if row is None:
        row = AiMemoryPreference(user_id=user_id, enabled=False)
        db.add(row)
        db.flush()
    return row


def _einschalten(db: Session, row: AiMemoryPreference) -> None:
    """Das Gedaechtnis wird eingeschaltet: der Schreiber liest ab jetzt.

    Was in der Zeit ohne Einwilligung gesagt wurde, liest niemand nach — wer
    den Schalter umlegt, soll nicht schlagartig ein Gedaechtnis ueber die Zeit
    davor bekommen (`ai_gedaechtnis_schreiber`). Die Marke jedes Gespraechs
    rueckt deshalb auf jetzt, und der Zeitpunkt bleibt an der Einwilligung
    stehen (`einwilligung_seit`): auch der Zusammenhang vor der Marke darf
    nicht aus der Zeit davor stammen. ``updated_at`` bleibt stehen: das
    Gespraech ist dadurch nicht neuer geworden.
    """
    from models import AiConversation
    from sqlalchemy import update

    jetzt = datetime.now(timezone.utc)
    db.execute(
        update(AiConversation)
        .where(AiConversation.user_id == row.user_id)
        .values(
            gedaechtnis_bis=jetzt,
            gedaechtnis_bis_id=None,
            updated_at=AiConversation.updated_at,
        )
        .execution_options(synchronize_session=False)
    )
    row.eingeschaltet_am = jetzt
    row.enabled = True


def einwilligung_seit(db: Session, user_id: int) -> datetime | None:
    """Seit wann das Gedaechtnis ohne Unterbrechung eingeschaltet ist; ``None``: aus.

    Fuer den Gedaechtnisschreiber: Persoenliches schreibt er nur aus dem, was
    seitdem gesagt wurde. Eine eingeschaltete Zeile ohne Zeitpunkt ist an
    `_einschalten` vorbei entstanden (die Migration hat jeder eingeschalteten
    Zeile einen gegeben); sie gilt als schon immer eingeschaltet — ab 1970,
    was jede Datenbank darstellen kann.
    """
    row = db.get(AiMemoryPreference, user_id)
    if row is None or not row.enabled:
        return None
    if row.eingeschaltet_am is None:
        return datetime.fromtimestamp(0, timezone.utc)
    return _utc(row.eingeschaltet_am)


def set_preference(db: Session, user: User, enabled: bool) -> AiMemoryPreference:
    row = _preference_row(db, user.id)
    if enabled and not row.enabled:
        _einschalten(db, row)
    row.enabled = enabled
    db.commit()
    db.refresh(row)
    return row


def notice_due(db: Session, user_id: int) -> bool:
    """Soll dem Benutzer der Hinweis vor der naechsten Nachricht gezeigt werden?

    Drei Bedingungen, alle noetig: das Gedaechtnis ist aus, der Benutzer hat
    den Hinweis nicht dauerhaft abbestellt, und seit dem letzten Mal ist genug
    Zeit vergangen. Ist das Gedaechtnis an, gibt es nichts zu fragen.
    """
    row = db.get(AiMemoryPreference, user_id)
    if row is None:
        return True
    if row.enabled or row.notice_hidden:
        return False
    if row.notice_last_shown_at is None:
        return True
    shown = _utc(row.notice_last_shown_at)
    return (datetime.now(timezone.utc) - shown).total_seconds() >= NOTICE_REPEAT_HOURS * 3600


def record_notice_answer(
    db: Session, user: User, *, enable: bool, hide_future: bool
) -> AiMemoryPreference:
    """Verarbeitet die Antwort auf den Hinweis.

    "Ja" schaltet ein. "Nein" laesst es aus und merkt sich den Zeitpunkt, damit
    in 24 Stunden erneut gefragt wird. "Nicht mehr anzeigen" beendet das
    Fragen — aber nicht die Moeglichkeit: unter Profil > Memory bleibt der
    Schalter erreichbar.
    """
    row = _preference_row(db, user.id)
    if enable and not row.enabled:
        _einschalten(db, row)
    if hide_future:
        row.notice_hidden = True
    row.notice_last_shown_at = datetime.now(timezone.utc)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row
