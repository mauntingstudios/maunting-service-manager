"""Lesen, Seiten und Ansichten des KI-Gedaechtnisses.

Herausgezogen aus `ai_memory_service`: die Eintragsliste, die blaetternden
Ansichten und die persoenliche Seite. Konstanten und Themenhelfer bleiben im
Dienst und werden beim Aufruf geholt.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from fastapi import HTTPException
from sqlalchemy.orm import Query, Session

from models import AiMemoryEntry, User
from services.ai_memory_krypto import _entschluesseln_lesbare

logger = logging.getLogger(__name__)

def list_entries(
    db: Session, user: User, scope: str, server_id: int | None,
    team_id: int | None = None,
) -> list[tuple[AiMemoryEntry, str]]:
    """Ein ganzer Bereich auf einmal — eine Entschlüsselung je Zeile.

    Der ungeblätterte Leseweg, und damit der teuerste. Die Oberfläche nimmt ihn
    nicht mehr: sie liest Seiten (`scope_entries`), seit ein Teambereich 5.000
    Einträge fassen darf. Wer ihn ruft, sollte den Bereich kennen, den er
    aufmacht.
    """
    from services.ai_memory_service import scope_identity
    identity, _, _, _ = scope_identity(db, user, scope, server_id, team_id)
    rows = (
        db.query(AiMemoryEntry)
        .filter(AiMemoryEntry.scope_identity == identity, AiMemoryEntry.status == "aktiv")
        .order_by(AiMemoryEntry.created_at, AiMemoryEntry.id)
        .all()
    )
    # Nach dem Namen sortiert wird erst hier: in der Datenbank steht er
    # verschluesselt, eine SQL-Sortierung ordnete nach Chiffrat. Zeilen ohne
    # Namen (Gedaechtnis v2) bleiben in der Reihenfolge ihres Entstehens.
    return sorted(_entschluesseln_lesbare(rows), key=lambda paar: paar[0].key)


@dataclass(frozen=True)
class Gedaechtnisseite:
    """Ein Ausschnitt einer Gedächtnisansicht und die zwei Zahlen daneben.

    Beide Zahlen zählen etwas anderes, und beide werden gebraucht:

    * ``gesamt`` trägt die Ansage über der Liste ("5.000 Einträge, Seite 1 von
      25"). Ohne sie wäre die Seitenweise genau der stille Deckel, den sie
      ersetzen soll — der Benutzer sähe 200 Zeilen und nichts, was ihm sagt,
      dass 4.800 dahinterliegen.
    * ``loeschbar`` ist davon das, was "Alle löschen" wirklich trifft. In der
      Profilansicht sind das nur die allgemeinen Einträge (``scope='user'``):
      gelöscht wird über die Kennung ``user:{id}``, die Servernotizen liegen
      unter ``server:{sid}:user:{uid}`` und bleiben stehen. In der Ansicht eines
      einzelnen Bereichs sind es alle, denn dort *ist* die Kennung die Ansicht.
      Die Bestätigungsfrage muss die Zahl nennen, die sie danach wirklich
      trifft — sonst fragt sie nach 200 und meldet 4.800.
    """

    eintraege: list[tuple[AiMemoryEntry, str]]
    gesamt: int
    loeschbar: int
    #: Die Namen der Themen, die auf dieser Seite vorkommen (Kennung -> Name).
    themen: dict[str, str] = field(default_factory=dict)


def _ansicht(
    basis: Query, status: str, themen: list[str] | None
) -> Query:
    """Schraenkt eine Bestandsabfrage auf eine Ansicht und Themen ein.

    Vergessenes steht neuestes zuerst nach dem Zeitpunkt des Vergessens; die
    Frist laeuft ab dort.
    """
    from services.ai_memory_service import ANSICHTEN
    if status not in ANSICHTEN:
        raise HTTPException(status_code=422, detail="Unbekannte Ansicht")
    abfrage = basis.filter(AiMemoryEntry.status == status)
    if themen:
        abfrage = abfrage.filter(AiMemoryEntry.thema_id.in_(themen))
    return abfrage


def _seite(
    basis: Query, offset: int, *, loeschbar: int | None = None, status: str = "aktiv"
) -> Gedaechtnisseite:
    """Eine Seite aus einer Bestandsabfrage — der gemeinsame Rumpf aller Ansichten.

    ``basis`` ist die ungeschnittene Abfrage und wird zweimal gebraucht: einmal
    für die Zeilen dieser Seite und einmal für die Gesamtzahl daneben. Nur die
    Zeilen der Seite gehen durch den Sidecar; die Zahl kommt aus der Datenbank
    und kostet nichts.

    ``loeschbar`` bestimmt der Aufrufer, denn nur er weiß, was sein "Alle
    löschen" trifft (siehe `Gedaechtnisseite`). ``None`` heißt "alles, was diese
    Abfrage findet" — dann wird nicht zweimal dasselbe gezählt.

    Die Seitengröße steht bewusst **nicht** in der Signatur: sie wird in
    Sidecar-Roundtrips bezahlt, und eine Größe, die der Aufrufer wählen darf,
    ist keine Grenze.
    """
    from services.ai_memory_service import PERSONAL_PAGE_SIZE, _SEITENORDNUNG, themennamen
    ordnung = (
        (AiMemoryEntry.vergessen_am.desc(), AiMemoryEntry.id)
        if status == "vergessen"
        else _SEITENORDNUNG
    )
    rows = (
        basis.order_by(*ordnung)
        .offset(max(0, offset))
        .limit(PERSONAL_PAGE_SIZE)
        .all()
    )
    gesamt = basis.count()
    eintraege = _entschluesseln_lesbare(rows)
    return Gedaechtnisseite(
        eintraege=eintraege,
        gesamt=gesamt,
        loeschbar=gesamt if loeschbar is None else loeschbar,
        themen=themennamen(
            basis.session, [(row.thema_id, row.scope_identity) for row, _wert in eintraege]
        ),
    )


def _suchseite(
    db: Session, kennungen: list[str], suche: str, themen: list[str] | None, loeschbar: int
) -> Gedaechtnisseite:
    """Die Treffer einer Suche als Seite — über den ganzen Bestand, nicht nur die geladene.

    Gesucht wird wie im Chat nach Bedeutung und Wörtern
    (`ai_gedaechtnis_abruf.verwaltung_suchen`), höchstens
    `ai_gedaechtnis_abruf.MAX_SUCHTREFFER`, das Passendste zuerst.
    """
    from services.ai_memory_service import themennamen
    from services import ai_gedaechtnis_abruf

    treffer = ai_gedaechtnis_abruf.verwaltung_suchen(db, kennungen, suche)
    if themen:
        treffer = [(row, text) for row, text in treffer if row.thema_id in themen]
    return Gedaechtnisseite(
        eintraege=treffer,
        gesamt=len(treffer),
        loeschbar=loeschbar,
        themen=themennamen(db, [(row.thema_id, row.scope_identity) for row, _ in treffer]),
    )


def scope_entries(
    db: Session, user: User, scope: str, server_id: int | None = None,
    team_id: int | None = None, *, offset: int = 0, status: str = "aktiv",
    themen: list[str] | None = None, suche: str | None = None,
) -> Gedaechtnisseite:
    """Eine Seite **eines** Bereichs — Team, Panel oder das Wissen einer Anlage.

    Dieselbe Auswahl wie `list_entries`, nur in Stücken. Von den drei Bereichen
    braucht das heute genau einer: `panel` und `server_shared` hängen an der
    festen `ai_limit_service.MAX_SYSTEM_SCOPE_ENTRIES` und passen damit immer
    auf eine Seite, `team` hängt am Rollenlimit seines Gründers und darf seit
    dem 19.08.2026 bis zu 5.000 Einträge fassen, seit dem 05.10.2026 bei
    „Unbegrenzt“ beliebig viele. Jeder davon kostet beim Öffnen
    einen eigenen Roundtrip zum DIS-Sidecar — gemessen 10,3 s bei 5.000 Zeilen,
    also dieselbe Wartezeit, gegen die die Profilansicht längst geschützt ist.

    Ein stiller Deckel wäre hier so falsch wie dort: wer diese Liste aufruft,
    will aufräumen, und eine Ansicht, die 300 von 5.000 zeigt, versteckt genau
    die Zeilen, wegen denen er gekommen ist. `gesamt` steht deshalb daneben, und
    die nächste Seite ist einen Klick entfernt.

    ``loeschbar`` zählt alles unter dieser Kennung, auch Vergessenes:
    `delete_all_entries` räumt genau diese eine Kennung ab, und die
    Bestätigungsfrage nennt die Zahl, die danach wirklich fehlt. In der
    Profilansicht ist das anders — dort liegen zwei Bereiche in einer Liste.

    Mit ``suche`` kommen statt einer Seite die Treffer im ganzen Bereich
    (`_suchseite`); Vergessenes durchsucht die Oberfläche selbst.
    """
    from services.ai_memory_service import scope_identity
    identity, _, _, _ = scope_identity(db, user, scope, server_id, team_id)
    bereich = db.query(AiMemoryEntry).filter(AiMemoryEntry.scope_identity == identity)
    if suche and suche.strip() and status == "aktiv":
        return _suchseite(db, [identity], suche, themen, bereich.count())
    return _seite(
        _ansicht(bereich, status, themen),
        offset,
        loeschbar=bereich.count(),
        status=status,
    )


def personal_entries(
    db: Session, user: User, *, offset: int = 0, status: str = "aktiv",
    themen: list[str] | None = None, suche: str | None = None,
) -> Gedaechtnisseite:
    """Eine Seite von allem, was diesem Benutzer selbst gehoert.

    `list_entries` fragt genau eine Scope-Kennung ab und braucht dafuer bei
    serverbezogenen Notizen eine konkrete `server_id`. Damit war der Bereich
    ueber die Oberflaeche nicht erreichbar: die KI schreibt solche Notizen
    (scope='server'), sie fliessen in jeden Chat und zaehlen
    gegen die Bereichsgrenze — sehen oder loeschen konnte man sie nicht.

    Serverbezogene Eintraege bleiben persoenlich (`owner_user_id` ist gesetzt,
    die Kennung lautet `server:{sid}:user:{uid}`), gehoeren also ins Profil und
    nicht zum Server. Anders als beim Kontextaufbau wird hier **nicht** auf
    `server.view` geprueft: es ist der eigene Eintrag, und wer den Zugriff auf
    einen Server verliert, soll seine Notiz dazu weiterhin loeschen koennen.

    **Seitenweise statt gedeckelt.** Bis der Bereich 1.000 Eintraege fasste,
    ging hier alles auf einmal durch den Sidecar; bei 5.000 sind das gemessen
    10,3 s (2 ms je Roundtrip) und der Multiplikator je sichtbarem Server kommt
    noch obendrauf. Ein `MAX_CONTEXT_ROWS` wie im Chatweg waere hier trotzdem
    die falsche Antwort und bleibt es: dort schuetzt der Deckel *jede*
    Nachricht und schneidet an einer Rangfolge, die zur Frage passt — hier hat
    der Benutzer genau diese Liste angefordert, um sie aufzuraeumen, und eine
    Ansicht, die stillschweigend 300 von 5.000 zeigt, versteckte genau die
    Zeilen, wegen denen er gekommen ist.

    Der Unterschied ist, dass eine Seite nichts verschweigt: `gesamt` steht
    daneben, und die naechste Seite ist einen Klick entfernt. `offset` ist das
    einzige, was der Aufrufer bestimmt — die Groesse gehoert dem Dienst
    (`PERSONAL_PAGE_SIZE`), weil sie in Sidecar-Roundtrips bezahlt wird.

    Geschnitten wird wie in jeder anderen Seitenansicht (`_SEITENORDNUNG`); den
    Unterschied macht allein die Abfrage darunter — sie geht über den
    **Besitzer** und nicht über eine Bereichskennung, denn genau diesen Bereich
    gibt es als Kennung nicht.
    """
    from services.ai_memory_service import PERSOENLICHE_SCOPES
    basis = db.query(AiMemoryEntry).filter(
        AiMemoryEntry.owner_user_id == user.id,
        AiMemoryEntry.scope.in_(PERSOENLICHE_SCOPES),
    )
    if suche and suche.strip() and status == "aktiv":
        from services import ai_gedaechtnis_abruf

        return _suchseite(
            db, ai_gedaechtnis_abruf.eigene_bereiche(db, user), suche, themen,
            basis.filter(AiMemoryEntry.scope == "user").count(),
        )
    return _seite(
        _ansicht(basis, status, themen),
        offset,
        # Die einzige Ansicht, in der "Alle löschen" weniger trifft, als die
        # Liste zeigt: die Servernotizen stehen mit drin und bleiben stehen.
        # Vergessenes unter `user:{id}` geht dagegen mit und zählt mit.
        loeschbar=basis.filter(AiMemoryEntry.scope == "user").count(),
        status=status,
    )


