"""AAD, Blind-Index und Krypto-Helfer des KI-Gedaechtnisses.

Herausgezogen aus `ai_memory_service`: diese Funktionen binden Chiffrat an
Bereich und Kennung, entschluesseln gebuendelt und halten den Namensindex.
Alle Namen werden im Dienst re-exportiert, damit bestehende Aufrufer und das
Modell unveraendert bleiben.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import datetime, timezone

from sqlalchemy import and_
from sqlalchemy.orm import Session

from models import AiMemoryEntry, AiMemoryVersion
from services.dis_client import DisClient, DisSidecarError

logger = logging.getLogger(__name__)

_STAPEL_WERTE = 2_000
_STAPEL_ZEICHEN = 4 * 1024 * 1024
SCHLUSS = "schluss"

def _aad(row: AiMemoryEntry) -> str:
    """Die Zusatzdaten, an die der Ciphertext gebunden ist.

    Version 2 nimmt den Scope mit auf und bindet den Eintrag damit
    kryptografisch an seinen Besitzer. Wer in der Datenbank `owner_user_id`
    oder `scope_identity` umschreibt, um an fremde Notizen zu kommen, macht sie
    damit **unlesbar**, statt sie zu uebernehmen — die Entschluesselung
    scheitert an der nicht mehr passenden AAD.

    Version 1 ist der Bestand aus Phase C, gebunden nur an die Eintrags-ID. Er
    bleibt lesbar, bis der Eintrag das naechste Mal geschrieben wird. Eine
    Neuverschluesselung waehrend der Migration schied aus: der DIS-Sidecar
    laeuft zu diesem Zeitpunkt nicht garantiert, und eine Migration, die an
    einem HTTP-Aufruf scheitern kann, ist keine.
    """
    if int(row.aad_version or 1) >= 2:
        return f"msm:ai:memory:{row.scope_identity}:{row.id}"
    return f"msm:ai:memory:{row.id}"


def _versions_aad(fassung: AiMemoryVersion, feld: str) -> str:
    """Wie `_aad`, für Text oder Titel einer früheren Fassung.

    Gebunden an Bereich, Erinnerung und Fassung. Ohne den Bereich bliebe eine
    Lücke, die `_aad` gerade schließt: wer eine Erinnerung per
    Datenbankzugriff in seinen eigenen Bereich umhängt, macht ihren Text
    unlesbar, ihre früheren Fassungen aber nicht.
    """
    return (
        f"msm:ai:memory:version:{feld}:{fassung.scope_identity}:"
        f"{fassung.memory_id}:{fassung.id}"
    )


def _schluessel_indizes(identity: str, keys: list[str]) -> list[str]:
    return DisClient.blind_index([f"{identity}\n{key}" for key in keys])


def _stapel(paare: list[tuple[str, str]]) -> Iterator[list[tuple[str, str]]]:
    """Teilt Paare aus Chiffrat und AAD in Stapel unter den Grenzen des Sidecars."""
    stapel: list[tuple[str, str]] = []
    zeichen = 0
    for paar in paare:
        laenge = len(paar[0]) + len(paar[1])
        if stapel and (len(stapel) >= _STAPEL_WERTE or zeichen + laenge > _STAPEL_ZEICHEN):
            yield stapel
            stapel, zeichen = [], 0
        stapel.append(paar)
        zeichen += laenge
    if stapel:
        yield stapel


def _sammeln(paare: list[tuple[str, str]]) -> list[str | None]:
    """Oeffnet Paare aus Chiffrat und AAD in wenigen Aufrufen, in Reihenfolge.

    Ein unlesbarer Wert kommt als ``None`` zurueck (wie `DisClient.decrypt_many`).
    Antwortet der Sidecar nicht, fliegt `DisSidecarError`; was der Aufrufer
    daraus macht, entscheidet er.
    """
    ergebnis: list[str | None] = []
    for stapel in _stapel(paare):
        ergebnis.extend(DisClient.decrypt_many(stapel))
    return ergebnis


def _schluessel_laden(rows: list[AiMemoryEntry]) -> None:
    """Entschluesselt Namen und Titel vieler Zeilen mit einem Sidecar-Aufruf.

    Danach lesen `row.key` und `row.titel` aus dem Speicher der Zeile. Ohne
    diesen Schritt kostete jede Zeile einen eigenen Aufruf, bei 5.000
    Eintraegen rund 4 s. Ein unlesbarer Name wird zu ``""``, ein unlesbarer
    Titel zu ``None``; der Text daneben entscheidet dann, ob die Zeile
    ueberhaupt erscheint.
    """
    namen = [
        row for row in rows
        if "_key_klartext" not in row.__dict__
        and DisClient.ist_verschluesselt(row.key_encrypted or "")
    ]
    titel = [
        row for row in rows
        if "_titel_klartext" not in row.__dict__
        and DisClient.ist_verschluesselt(row.titel_encrypted or "")
    ]
    klartexte = _sammeln(
        [(row.key_encrypted, row.key_aad()) for row in namen]
        + [(row.titel_encrypted, row.titel_aad()) for row in titel]
    )
    for row, klar in zip(namen, klartexte[: len(namen)]):
        row._key_klartext = klar if klar is not None else ""
    for row, klar in zip(titel, klartexte[len(namen):]):
        row._titel_klartext = klar


def _index_nachziehen(db: Session, identity: str) -> None:
    """Gibt Altbestand eines Bereichs Index und verschluesselten Namen.

    Laeuft vor jeder Suche nach einem Namen. So findet die Suche auch eine
    Zeile von vor der Umstellung, bevor `schluessel_nachziehen` beim Start
    des Panels bei ihr angekommen ist, statt einen zweiten Eintrag mit
    demselben Namen anzulegen.
    """
    # Nur Zeilen **mit** Namen. Seit Gedaechtnis v2 haben neue Zeilen gar
    # keinen; ohne die zweite Bedingung bekaeme jede von ihnen den Index des
    # leeren Namens, und die zweite scheiterte am UNIQUE.
    alt = db.query(AiMemoryEntry).filter(
        AiMemoryEntry.scope_identity == identity,
        AiMemoryEntry.key_index.is_(None),
        AiMemoryEntry.key_encrypted.is_not(None),
    ).all()
    if not alt:
        return
    _schluessel_laden(alt)
    for row, index in zip(alt, _schluessel_indizes(identity, [row.key for row in alt])):
        if not DisClient.ist_verschluesselt(row.key_encrypted or ""):
            # Altbestand: der Getter liefert den Klartext, der Setter
            # verschluesselt ihn.
            row.key = row.key
        row.key_index = index
    db.flush()


def schluessel_bedingung(db: Session, identity: str, keys: list[str]):
    """SQL-Bedingung fuer "diese Namen in diesem Bereich"."""
    _index_nachziehen(db, identity)
    return and_(
        AiMemoryEntry.scope_identity == identity,
        AiMemoryEntry.key_index.in_(_schluessel_indizes(identity, keys)),
    )


def schluessel_nachziehen(db: Session) -> int:
    """Zieht alle Bereiche mit Altbestand nach. Laeuft beim Start des Panels."""
    bereiche = [
        kennung for (kennung,) in db.query(AiMemoryEntry.scope_identity)
        .filter(
            AiMemoryEntry.key_index.is_(None), AiMemoryEntry.key_encrypted.is_not(None)
        ).distinct().all()
    ]
    for kennung in bereiche:
        _index_nachziehen(db, kennung)
        db.commit()
    return len(bereiche)


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _entschluesseln(rows: list[AiMemoryEntry]) -> list[tuple[AiMemoryEntry, str]]:
    """Entschluesselt, was sich entschluesseln laesst, und ueberspringt den Rest.

    Vorher stand hier eine Listenauswertung ohne `try`. Ein einziger Eintrag,
    dessen Text sich nicht mehr oeffnen laesst — verdrehte AAD, gewechselter
    Schluessel, halb geschriebene Zeile —, warf `DisDecryptionError` bis in
    `build_provider_messages`. Der Aufrufer in `ai_stream_service` faengt dort
    `DisSidecarError` und uebersetzt ihn zu `AI_CREDENTIAL_UNAVAILABLE`: der
    Lauf begann gar nicht erst. Eine kaputte Notiz nahm damit den ganzen Chat
    mit, und zwar jedes Mal wieder, bis jemand die Zeile in der Datenbank fand.

    Ein Gedaechtnis ist eine Beigabe. Es darf fehlen; es darf nicht im Weg
    stehen. Dieselbe Haltung wie bei `refresh_embedding` weiter oben.

    Auch ein Sidecar, der gar nicht antwortet, faellt hierunter: der Benutzer
    bekommt einen Assistenten ohne Gedaechtnis statt gar keinen. Sichtbar
    bleibt es ueber das Protokoll.
    """
    return _oeffnen(rows, still=True)


def _entschluesseln_lesbare(rows: list[AiMemoryEntry]) -> list[tuple[AiMemoryEntry, str]]:
    """Wie `_entschluesseln`, aber für die Verwaltungsansicht.

    Der Unterschied zum Helfer darüber ist **genau ein Fall**, und er ist
    Absicht:

    - Eine einzelne Zeile lässt sich nicht mehr öffnen (verdrehte AAD,
      gewechselter Schlüssel). Sie fällt in beiden Helfern still heraus, die
      übrigen bleiben sichtbar. Vorher nahm ein einziger solcher Eintrag die
      ganze Seite mit: der Router übersetzt ihn zu 503, und der Benutzer sah
      unter Profil > Memory dauerhaft "Memory ist nicht verfügbar" — auch für
      die vierzig intakten Einträge daneben, während der Chat sie unauffällig
      weiterbenutzte.
    - Der Sidecar antwortet gar nicht. Das läuft hier bewusst **weiter** bis
      zum Router und wird dort zu einem ehrlichen 503. Finge man es hier ab,
      zeigte die Verwaltungsansicht eine leere Liste: das Gedächtnis wäre
      angeblich leer, während jedes Schreiben scheitert.

    Der Chatweg (`_entschluesseln`) wählt im zweiten Fall andersherum, und aus
    demselben Grund: dort ist ein Assistent ohne Gedächtnis besser als gar
    keiner.
    """
    return _oeffnen(rows, still=False)


def _oeffnen(
    rows: list[AiMemoryEntry], *, still: bool
) -> list[tuple[AiMemoryEntry, str]]:
    """Der gemeinsame Rumpf der beiden Helfer darueber — alle Zeilen in einem Zug.

    Text, Titel und (bei Altbestand) Name aller Zeilen gehen zusammen durch
    `/decrypt-many`; vorher kostete jede Zeile einen eigenen `/decrypt`, acht
    zugleich in Threads (Zahlen an `_STAPEL_WERTE`). Was sich nicht oeffnen
    laesst, kommt als ``None`` zurueck: eine Zeile ohne lesbaren Text faellt
    heraus, ein unlesbarer Titel wird zu keinem Titel, ein unlesbarer Name zu
    ``""``.

    ``still`` entscheidet nur ueber den toten Sidecar: im Chat (``True``)
    heisst er "ohne Gedaechtnis", in der Verwaltung (``False``) fliegt der
    Fehler bis zum Router.
    """
    if not rows:
        return []
    paare: list[tuple[str, str]] = []
    ziele: list[tuple[AiMemoryEntry, str]] = []
    for row in rows:
        paare.append((row.value_encrypted, _aad(row)))
        ziele.append((row, "text"))
        if "_titel_klartext" not in row.__dict__ and DisClient.ist_verschluesselt(
            row.titel_encrypted or ""
        ):
            paare.append((row.titel_encrypted, row.titel_aad()))
            ziele.append((row, "titel"))
        if "_key_klartext" not in row.__dict__ and DisClient.ist_verschluesselt(
            row.key_encrypted or ""
        ):
            paare.append((row.key_encrypted, row.key_aad()))
            ziele.append((row, "name"))
    try:
        klartexte = _sammeln(paare)
    except DisSidecarError as exc:
        if not still:
            raise
        logger.warning(
            "Gedächtnis nicht lesbar, der Block bleibt leer: %s", type(exc).__name__
        )
        return []
    texte: dict[int, str | None] = {}
    for (row, feld), klar in zip(ziele, klartexte):
        if feld == "text":
            texte[id(row)] = klar
        elif feld == "titel":
            row._titel_klartext = klar
        else:
            row._key_klartext = klar if klar is not None else ""
    entschluesselt: list[tuple[AiMemoryEntry, str]] = []
    for row in rows:
        wert = texte.get(id(row))
        if wert is None:
            logger.warning(
                "Gedächtniseintrag %s (%s) nicht lesbar, wird übersprungen",
                row.id, row.scope,
            )
            continue
        entschluesselt.append((row, wert))
    return entschluesselt


def _memory_line(row: AiMemoryEntry, value: str) -> str:
    # Der Block ist zeilenbasiert und jede Zeile traegt ihren Scope. Ein Wert
    # mit Zeilenumbruch koennte deshalb beliebig viele gefaelschte
    # "[panel] ..."-Zeilen vortaeuschen — ein Benutzer wuerde sich damit im
    # eigenen Kontext panelweite Vorgaben andichten. Der Schluessel ist
    # bereits auf [A-Za-z0-9_.-] begrenzt (schemas/ai_memory.py), der Wert
    # ist es bewusst nicht: er soll frei formulierbar bleiben.
    flattened = " ".join(str(value).splitlines())
    origin = "gesagt" if row.origin == "user" else "gemerkt"
    if row.art == SCHLUSS:
        # Weder gesagt noch gemerkt: aus anderen Zeilen gefolgert. Singra soll
        # es nicht als Aussage des Menschen wiedergeben.
        origin = "geschlossen"
    # Bei serverbezogenen Eintraegen muss die ID mit dran: sonst weiss das
    # Modell nicht, auf welchen der Server sich die Notiz bezieht, und wendet
    # eine Eigenheit von Server 62 versehentlich auf Server 84 an. Bei Teams
    # gilt dasselbe — wer in zwei Teams ist, hat womoeglich zwei verschiedene
    # Antworten auf dieselbe Frage.
    if row.scope == "server":
        scope = f"server:{row.server_id}"
    elif row.scope == "server_shared":
        # Nummer **und** Unterscheidung zur eigenen Notiz. Der `else`-Zweig
        # unten schriebe bloss "server_shared" ohne Nummer — also genau die
        # Verwechslung, die der Kommentar darueber verhindern soll. Das Wort
        # "anlage" statt "shared", weil das Etikett das Modell erreicht und der
        # Rest der Zeile ebenfalls deutsch ist.
        scope = f"server:{row.server_id}:anlage"
        # **Hier zaehlt die Herkunft anders als ueberall sonst.** Bei den
        # persoenlichen Bereichen heisst "gemerkt", dass die KI es sich im
        # Gespraech mit *diesem* Benutzer notiert hat — er war dabei. Wissen
        # der Anlage liest dagegen jeder Kollege mit `server.view`, und keiner
        # von ihnen war dabei: die Zeile kann aus einem fremden Lauf stammen,
        # der eine Logzeile oder eine Konfigdatei gelesen hat. Bestaetigt hat
        # sie dort niemand.
        #
        # Deshalb sagt die Marke an dieser Stelle nicht, *wie* der Eintrag
        # entstanden ist, sondern *worauf er sich stuetzt*: "eingetragen" hat
        # ihn ein Mensch ueber die Oberflaeche, "unbestätigt" ist er, solange
        # nur eine KI ihn notiert hat. Das nimmt der KI nichts weg — sie darf
        # weiter selbst schreiben —, aber der naechste Lauf weiss, wie fest
        # der Boden ist, auf dem er steht.
        origin = "eingetragen" if row.origin == "user" else "unbestätigt"
    elif row.scope == "team":
        # Die Nummer, nicht der Name — anders als in der Absage
        # (`_bereichsname`) und im Suchergebnis (`_execute_search_memory`), und
        # das ist kein Versehen. Dort liest ein Mensch mit, und dem sagt nur
        # der Name etwas. Hier geht es ums **Unterscheiden**: die Zeile soll sagen, dass zwei
        # widersprechende Antworten aus zwei verschiedenen Teams stammen, und
        # dafuer reicht eine beliebige stabile Marke.
        #
        # Der Name kostete hier, was er dort nicht kostet. `_memory_line` hat
        # keine Sitzung und ist eine reine Formatierung; ihn zu holen hiesse,
        # die Signatur und beide Kontextaufbauten zu aendern und im
        # schlechtesten Fall je Zeile ein `db.get(Team, …)` zu bezahlen — bei
        # jeder Nachricht neu, waehrend die Suche nur auf Nachfrage
        # laeuft. Dazu geht jede Zeile gegen dieselben 6.000 Zeichen; ein Name
        # je Zeile verdraengt Eintraege, statt welche zu erklaeren.
        scope = f"team:{row.team_id}"
        # **Die Herkunft zählt hier wie beim Anlagenwissen darüber**, und zwar
        # aus derselben Lage: eine Teamzeile schreibt die KI in der Sitzung
        # *eines* Mitglieds, gelesen wird sie von allen anderen. Für die heißt
        # "gemerkt" sonst "die KI hat es sich im Gespräch mit mir notiert" — sie
        # waren aber nicht dabei, und die Zeile kann aus einem fremden Lauf
        # stammen, der eine Logzeile gelesen hat. Bestätigt hat sie dort
        # niemand.
        #
        # "eingetragen" trifft zu, weil eine Teamzeile mit `origin='user'` nur
        # über die Oberfläche entsteht (`routers/ai_memory.py`); der KI-Weg
        # schreibt ausnahmslos mit `origin='ai'`. Verboten wird ihr damit
        # nichts — sie darf weiter ins Teamwissen schreiben, der nächste Lauf
        # sieht nur, wie fest der Boden ist.
        origin = "eingetragen" if row.origin == "user" else "unbestätigt"
    else:
        scope = row.scope
    # Seit Gedaechtnis v2 steht vorn kein Name mehr, sondern gleich der Satz:
    # er ist ohne Gespraech verstaendlich, ein Name davor waere nur ein zweites
    # Stichwort, das Platz kostet. Altbestand behaelt seinen Namen, bis die
    # Pflege ihn umschreibt.
    vorn = f"{row.key}: " if row.key else ""
    return f"[{scope}/{origin}] {vorn}{flattened}"


