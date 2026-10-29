"""Fluechtige Textauswahl eines Dokument-Laufs.

Der Auswahltext ist Dokumentinhalt. Er darf nicht in `ai_runs.state_json`
landen — dort steht Klartext. Deshalb liegt er nur im Prozess, gebunden an die
Lauf-Kennung, mit kurzer Frist. Nach dem Segment ist er weg; ein neuer Lauf
muss die Auswahl erneut senden.
"""

from __future__ import annotations

import time

_auswahlen: dict[str, tuple[dict, float]] = {}
FRIST_SEKUNDEN = 60 * 60


def setzen(run_id: str, auswahl: dict | None, *, hash_wert: str | None = None) -> None:
    if not run_id:
        return
    if not auswahl:
        _auswahlen.pop(run_id, None)
        return
    eintrag = dict(auswahl)
    if hash_wert:
        eintrag["hash"] = hash_wert
    _auswahlen[run_id] = (eintrag, time.monotonic() + FRIST_SEKUNDEN)


def lesen(run_id: str | None) -> dict | None:
    if not run_id:
        return None
    eintrag = _auswahlen.get(run_id)
    if eintrag is None:
        return None
    auswahl, ablauf = eintrag
    if time.monotonic() > ablauf:
        _auswahlen.pop(run_id, None)
        return None
    return dict(auswahl)


def verwerfen(run_id: str | None) -> None:
    if run_id:
        _auswahlen.pop(run_id, None)


def leeren() -> None:
    _auswahlen.clear()
