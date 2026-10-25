"""Das Panel-Backup traegt den E2EE-Zustellbestand nicht mit.

Der Dump bleibt ein voller `pg_dump` der Panel-Datenbank — aber ohne die
Zeilen der Zustellpuffer. Das Schema bleibt stehen, damit ein Restore die
Tabellen, Fremdschluessel und Indizes wieder anlegt; nur der Inhalt fehlt.
Nach einer Wiederherstellung darf kein abgelaufener Chiffretext wieder
ausgeliefert werden.

Die Liste ist nicht frei gewaehlt: jede Tabelle mit `ablauf_am` gilt als
Zustellpuffer. Eine neue Transporttabelle mit Frist macht diesen Test rot,
solange sie nicht in `PANEL_BACKUP_OHNE_DATEN` steht. Die drei Tabellen ohne
diese Spalte (alter Relaisbestand, verschluesselte Anhaenge, Kopplungen)
stehen namentlich daneben.

`device_pairings` traegt neben dem kurzlebigen Kopplungscode den versiegelten
Verlaufs-Erstabgleich. Ein Restore soll keine offene Kopplung weiterfuehren:
das Schema bleibt, die Zeilen fallen, und eine Kopplung beginnt danach neu.
"""

from __future__ import annotations

import models  # noqa: F401  — fuellt Base.metadata mit allen Tabellen
from config import settings
from database import Base
from services import panel_backup_service as pbs


def _dump_kommando(monkeypatch) -> list[str]:
    """Fuehrt `_pg_dump_postgres` aus, ohne pg_dump zu starten."""
    aufrufe: list[list[str]] = []

    class _Fertig:
        returncode = 0
        stdout = b"-- PostgreSQL database dump\n-- pg_dump version 17\n"
        stderr = b""

    def _run(cmd, **_kwargs):
        aufrufe.append(list(cmd))
        return _Fertig()

    monkeypatch.setattr(pbs.subprocess, "run", _run)
    monkeypatch.setattr(
        settings,
        "database_url",
        "postgresql+psycopg2://msm:synthetic@127.0.0.1:5432/msm",
    )
    pbs._pg_dump_postgres()
    assert len(aufrufe) == 1
    return aufrufe[0]


def test_pg_dump_nimmt_die_zustellpuffer_ohne_daten_mit(monkeypatch) -> None:
    cmd = _dump_kommando(monkeypatch)

    assert cmd[-1] == "msm"
    assert cmd[cmd.index("--format") + 1] == "plain"

    ausgeschlossen = {
        arg.split("=", 1)[1]
        for arg in cmd
        if arg.startswith("--exclude-table-data=")
    }
    assert ausgeschlossen == set(pbs.PANEL_BACKUP_OHNE_DATEN)

    # `--exclude-table` wuerde die Tabelle ganz aus dem Dump nehmen. Dann
    # fehlte sie nach einem Restore, und jeder Fremdschluessel auf sie waere
    # ungueltig. Es darf deshalb nur die Datenvariante sein.
    assert not any(arg.startswith("--exclude-table=") for arg in cmd)


def test_nur_die_puffer_stehen_ohne_daten_in_der_liste() -> None:
    tabellen = Base.metadata.tables

    for name in pbs.PANEL_BACKUP_OHNE_DATEN:
        assert name in tabellen, name

    # Die Liste nennt genau die Puffer: die verschluesselten Anhaenge (eigene
    # Frist) und die Kopplungen (kurzer Vorgang, kein Bestand).
    assert set(pbs.PANEL_BACKUP_OHNE_DATEN) == {"chat_media", "device_pairings"}

    # `e2ee_messages` traegt den bleibenden Nachrichtenbestand. Nur
    # verschwindende Nachrichten haben eine Frist; die Tabelle gehoert
    # deshalb in jedes Backup. Wer sie hier eintraegt, loescht den Verlauf.
    assert "e2ee_messages" not in pbs.PANEL_BACKUP_OHNE_DATEN
    assert "expires_at" in tabellen["e2ee_messages"].c

    # Die Kopplung ist ein kurzer Vorgang, kein Bestand. Nach einem Restore
    # darf weder ein alter Code noch ein versiegelter Verlaufsblob
    # weiterlaufen; beides entsteht bei einer neuen Kopplung neu.
    assert "device_pairings" in pbs.PANEL_BACKUP_OHNE_DATEN
    assert "verlauf_blob" in tabellen["device_pairings"].c
    assert "code_hash" in tabellen["device_pairings"].c
