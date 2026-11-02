"""SQL-Anweisungen zaehlen (N+1-Beweise, Regel 31)."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import event
from sqlalchemy.orm import Session


@contextmanager
def count_statements(db: Session) -> Iterator[list[str]]:
    """Zaehlt jede SQL-Anweisung dieser Sitzung im Block.

    Gibt die Liste der Statements herein (je ein gekuerzter Text): Die Laenge
    ist die Zahl, der Inhalt hilft beim Eingrenzen. Gezaehlt wird auf der
    Engine dieser Sitzung — wer ueber den HTTP-Client misst, zaehlt Anmeldung
    und CSRF mit; N+1-Beweise rufen den Dienst direkt.
    """
    engine = db.get_bind()
    aufrufe: list[str] = []

    def vor(conn, element, mehrzahl, params, optionen) -> None:  # noqa: ANN001, ANN202
        aufrufe.append(str(element)[:160])

    event.listen(engine, "before_cursor_execute", vor)
    try:
        yield aufrufe
    finally:
        event.remove(engine, "before_cursor_execute", vor)
