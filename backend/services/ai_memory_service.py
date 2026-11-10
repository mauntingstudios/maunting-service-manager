"""Ownership, DIS-Schutz, Secret-Abweisung und Abruf fuer AI-Memory."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import logging
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session

from models import (
    AiMemoryBeleg,
    AiMemoryEntry,
    AiMemoryTopic,
    AiMemoryVersion,
    Server,
    Team,
    User,
)
from services import (
    ai_embedding_service,
    ai_limit_service,
    audit_service,
    permission_service,
)
from services.ai_redaction import enthaelt_zugangsdaten
from services.dis_client import DisClient, DisDecryptionError
# Re-Exporte: Router, Dienste, Migrationen und Tests holen diese Namen ueber
# diesen Modulpfad statt ueber das Ursprungsmodul. Sie sind hier absichtlich
# nicht benutzt, damit der Pfad nicht bricht (`noqa: F401`).
from services.ai_memory_ranking import (
    HALTBARKEIT_START,  # noqa: F401 - Re-Export
    MAX_HALTBARKEIT_TAGE,  # noqa: F401 - Re-Export
    _reiz,  # noqa: F401 - Re-Export
    _relevance,  # noqa: F401 - Re-Export
    _tokens,  # noqa: F401 - Re-Export
    _wortquelle,  # noqa: F401 - Re-Export
    haltbarkeit,  # noqa: F401 - Re-Export
    haltbarkeit_nach_gebrauch,  # noqa: F401 - Re-Export
    kopf_rang,
)
from services.ai_memory_lesen import (
    Gedaechtnisseite,  # noqa: F401 - Re-Export
    list_entries,  # noqa: F401 - Re-Export
    personal_entries,  # noqa: F401 - Re-Export
    scope_entries,  # noqa: F401 - Re-Export
)
from services.ai_memory_consent import (
    NOTICE_REPEAT_HOURS,  # noqa: F401 - Re-Export
    einwilligung_seit,  # noqa: F401 - Re-Export
    notice_due,  # noqa: F401 - Re-Export
    preference,  # noqa: F401 - Re-Export
    record_notice_answer,  # noqa: F401 - Re-Export
    set_preference,  # noqa: F401 - Re-Export
)
from services.ai_memory_vektor import (
    GEPACKT_BYTES,  # noqa: F401 - Re-Export
    _stored_vector,
    _vektor_verschluesseln,  # noqa: F401 - Re-Export
    begriff_werte,  # noqa: F401 - Re-Export
    indizes_nachziehen,  # noqa: F401 - Re-Export
    refresh_embedding,
    vektor_lesen,  # noqa: F401 - Re-Export
)
from services.ai_memory_krypto import (
    SCHLUSS,
    _STAPEL_WERTE,  # noqa: F401 - Re-Export
    _aad,
    _entschluesseln,  # noqa: F401 - Re-Export
    _entschluesseln_lesbare,
    _index_nachziehen,  # noqa: F401 - Re-Export
    _memory_line,  # noqa: F401 - Re-Export
    _oeffnen,  # noqa: F401 - Re-Export
    _schluessel_indizes,
    _schluessel_laden,
    _sammeln,
    _stapel,  # noqa: F401 - Re-Export
    _utc,
    _versions_aad,
    schluessel_bedingung,
    schluessel_nachziehen,  # noqa: F401 - Re-Export
)


logger = logging.getLogger(__name__)

#: Was diesem Benutzer gehoert und deshalb an seiner Einwilligung haengt.
#: `team` und `panel` gehoeren dem Team bzw. dem Betreiber.
PERSOENLICHE_SCOPES = ("user", "server")
#: Wieviele Einträge eine Seite trägt — in **jeder** blätternden Ansicht.
#:
#: Der Name stammt von der Profilansicht, die als erste blättern musste; seit
#: die Bereichsansicht (`scope_entries`) dasselbe tut, gilt die Zahl für beide.
#: Zwei Seitengrößen nebeneinander wären zwei Zahlen mit derselben Begründung,
#: und eine davon liefe der anderen irgendwann davon.
#:
#: Die Zahl steht hier und nicht in der Anfrage. Jede Zeile dieser Seite kostet
#: einen eigenen Roundtrip zum DIS-Sidecar; wer die Grenze selbst setzen dürfte,
#: könnte sich 5.000 davon auf einmal bestellen — gemessen am 19.08.2026 sind
#: das 10,3 s bei 2 ms je Roundtrip, genug für ein Gateway-Timeout. Der Aufrufer
#: sagt also nur, *wo* er weiterlesen will, nie *wieviel*.
#:
#: 200 bleibt bei 0,1 bis 0,4 s und ist immer noch eine Seite, die ein Mensch
#: überfliegen kann. Der Deckel je Bereich liegt bei 5.000 — das sind 25 Seiten
#: und damit eine Zahl, die man auch durchblättert.
PERSONAL_PAGE_SIZE = 200
# Der **Sockel** des Gedächtnisses: soviel Platz bekommt es, wenn der Aufrufer
# kein Kontextfenster nennt. Wer eines kennt, reicht es als `budget` an den
# Abruf durch (`ai_gedaechtnis_abruf.abrufen`) — die Zahl kommt dann aus
# `ai_context_service.teilbudgets(...).gedaechtnis_zeichen` und wächst mit dem
# Fenster des Modells.
MAX_CONTEXT_CHARS = 6_000
# Wieviele Erinnerungen der Abruf „im Kopf“ höchstens öffnet — beim
# Sockelbudget; mit dem Budget wächst die Zahl im selben Verhältnis. Bei kurzen
# Einträgen passen höchstens rund 150 Zeilen in 6.000 Zeichen, 300 ist das
# Doppelte davon. Mehr öffnet keine Anfrage für den Kopf, egal wie groß der
# Bestand ist; was zur Frage passt, kommt über höchstens 2 × 60 Kandidaten dazu
# (`ai_gedaechtnis_abruf.KANDIDATEN`).
MAX_CONTEXT_ROWS = 300
# Nach so vielen Tagen ohne Nutzung halbiert sich der Aktualitätsbonus. Grob
# an „eine Arbeitswoche“ angelehnt; der Wert ordnet nur, er wählt nicht aus.

#: Ab welchem Reiz eine Erinnerung als von der Frage **getroffen** gilt
#: (`_reiz`): dann kommt sie „passend zur Frage“ mit und zählt als gebraucht.
#: Ein gemeinsames Wort hebt auf 0,75, über die Bedeutung allein reicht eine
#: Ähnlichkeit ab 0,35 — in großen Bereichen zählt stattdessen, ob die Zeile
#: aus dem Rauschen ragt (`ai_gedaechtnis_abruf.BEDEUTUNG_ABSTAND`).
#:
#: Bis Stufe 4 hieß die Zahl `VERBLASSEN_AB` und kürzte außerdem Einträge im
#: Block, die lange niemand gebraucht hatte. Seit der Abruf auswählt, was
#: überhaupt mitgeht — im Kopf das Wichtige, hinten das Getroffene —, gibt es
#: nichts mehr zu kürzen; die Präsenz über die Zeit regelt die Pflege
#: (Stufe 5).
TREFFER_AB = 0.35

#: Die Stärke einer Erinnerung wie beim Menschen: ihre Präsenz fällt ohne
#: Gebrauch mit e^(−Tage / Haltbarkeit). Die Haltbarkeit beginnt bei der
#: Wichtigkeit — eine Nebensache ist nach einer Woche ohne Gebrauch auf gut ein
#: Drittel gefallen, eine Allergie erst nach einem Jahr — und wächst mit jedem
#: Gebrauch (`haltbarkeit_nach_gebrauch`). Daraus folgt nur, was „im Kopf“
#: steht (`kopf_rang`); gelöscht oder gekürzt wird nichts. Was den Kopf
#: verlässt, kommt zurück, sobald eine Frage es trifft.
#: Länger hält nichts: auch was oft gebraucht wurde, darf nach zehn Jahren
#: ohne Gebrauch den Kopf verlassen.
#: Wörter, die in fast jedem Satz stehen und deshalb nichts treffen.
#:
#: Seit Gedächtnis v2 ist eine Erinnerung ein ganzer Satz („Der Benutzer ist
#: …“). Ohne diese Liste traf „Was ist der Plan?“ über „ist“ und „der“ jede
#: Erinnerung, und der Wortbezug — gedacht für Lehnwörter wie Backup und RAM —
#: sagte nichts mehr. Kürzer als drei Zeichen fällt ohnehin heraus (`_tokens`).
#: Wieviele Werte ein Sammelaufruf an den DIS-Sidecar hoechstens traegt.
#:
#: An einer Entschluesselung ist fast nichts Rechnung: der Sidecar oeffnet ein
#: paar hundert Byte AES-GCM, alles andere ist der Weg hin und zurueck. Bis
#: 06.10.2026 ging hier jede Zeile als eigener `/decrypt`, acht zugleich in
#: Threads; gemessen am 19.08.2026 kostete das bei 300 Zeilen 150 bis 600 ms
#: vor dem ersten Byte der Antwort. Seit es `/decrypt-many` gibt, gehen Text,
#: Titel und Name aller Zeilen in einem Aufruf (`_oeffnen`). Die beiden
#: Grenzen liegen unter denen des Sidecars (10.000 Werte, 8 MiB), mit Luft.

# ── Gedächtnis v2: Sätze statt Schlüssel (06.10.2026) ───────────────────────
#
# Eine Erinnerung ist ein bis fünf Sätze, die ohne das Gespräch verständlich
# sind („Jonas trinkt Kaffee schwarz.“), mit Titel, Thema, Art, Quelle und
# Wichtigkeit daneben. Der Schlüssel war bis hierher ihre Identität; dieselbe
# Sache unter zwei Namen stand zweimal da, und eine Erzählung ließ sich in
# Namen gar nicht fassen. Alte Einträge behalten ihren Namen, bis die Pflege
# sie in Sätze umschreibt.

#: Was für eine Aussage eine Erinnerung ist. Dieselbe Liste hält die Datenbank
#: (`ck_ai_memory_entries_art`).
ARTEN = ("fakt", "vorliebe", "anweisung", "ereignis", "plan", "beziehung", "wissen")
#: Ein Schluss der nächtlichen Pflege (`ai_gedaechtnis_pflege`): er folgt aus
#: mindestens zwei Erinnerungen desselben Bereichs und gilt nur, solange sie
#: gelten (`AiMemoryBeleg`, `_schluesse_entkraeften`). Kein anderer Schreibweg
#: legt ihn an; darum steht er nicht in `ARTEN`, die Schreiber und Import dem
#: Modell zur Wahl geben.
#: Woher eine Erinnerung kommt (`ck_ai_memory_entries_quelle`).
QUELLEN = ("eingetragen", "gespraech", "import", "pflege")
#: Warum es eine frühere Fassung gibt (`ck_ai_memory_versionen_grund`).
GRUENDE = (
    "bearbeitet", "aktualisiert", "zusammengefuehrt", "aufgenommen",
    "umgeschrieben", "wiederhergestellt",
)
#: Wie lang Text, Titel und Thema sein dürfen. Der Text bleibt bei der alten
#: Grenze des Werts: fünf Sätze passen bequem hinein, ein Kapitel nicht, und
#: genau das ist gewollt.
MAX_TEXT_ZEICHEN = 2_000
MAX_TITEL_ZEICHEN = 120
MAX_THEMA_ZEICHEN = 60
#: Wieviele frühere Fassungen eine Erinnerung behält. Die älteste fällt, wenn
#: eine neue dazukommt; ohne Grenze wüchse eine oft geänderte Erinnerung mit
#: jeder Pflege weiter.
MAX_VERSIONEN = 20
#: Wie lange eine vergessene Erinnerung zurückgeholt werden kann.
VERGESSEN_TAGE = 30
#: Wieviele vergessene Erinnerungen ein Bereich höchstens aufhebt. Vergessene
#: zählen nicht gegen das Rollenlimit (sonst schüfe Vergessen keinen Platz),
#: ihr Vorrat braucht deshalb eine eigene Grenze: darüber fallen die ältesten
#: vor Ablauf der Frist.
MAX_VERGESSENE = 1_000


class MemoryScopeVoll(HTTPException):
    """409 mit dem Zählstand daneben, weil ein Text allein zu wenig trägt.

    Bleibt bewusst eine `HTTPException`: der Router in `routers/ai_memory.py`
    und jeder andere Aufrufer merken von dieser Klasse nichts, bekommen
    denselben 409 und dasselbe `detail` wie vorher — und dieses `detail` ist
    ein Satz für einen **Menschen**, denn über den Router legt der Benutzer
    selbst einen Eintrag an und liest die Meldung als Toast.

    Die drei Zahlen daneben sind für Aufrufer da, die „gesperrt“ von „genau
    voll“ von „nachträglich gesenkt“ unterscheiden wollen, ohne auf den
    Meldungstext zu horchen — jede Umformulierung hier änderte dort sonst
    stillschweigend das Verhalten. Bis Stufe 2 des Gedächtnisses machte
    `remember` daraus eine Anweisung an das Modell; der Gedächtnisschreiber
    kennt den freien Platz vorher (`ai_gedaechtnis_schreiber._bereiche`).
    """

    def __init__(self, *, bereich: str, bestand: int, grenze: int, detail: str) -> None:
        super().__init__(status_code=409, detail=detail)
        self.bereich = bereich
        self.bestand = bestand
        self.grenze = grenze






# ── Der verschluesselte Name ────────────────────────────────────────────────
#
# Bis 26.09.2026 stand `key` im Klartext und war zugleich Suchschluessel und
# Eindeutigkeit je Bereich. Heute liegt er verschluesselt in `key_encrypted`,
# und gesucht wird ueber `key_index` (HMAC ueber Bereich und Namen, siehe
# Modell). Die Funktionen hier sind der einzige Weg dorthin: wer nach einem
# Namen sucht, nimmt `schluessel_bedingung`, nie einen eigenen Filter.
















def scope_identity(
    db: Session, user: User, scope: str, server_id: int | None,
    team_id: int | None = None,
) -> tuple[str, int | None, int | None, int | None]:
    """Loest einen Scope in seine Kennung und die zugehoerigen Fremdschluessel auf.

    Die Kennung ist der Primaerfilter jeder Leseabfrage und damit die
    eigentliche Trennlinie zwischen den Benutzern. Sie wird ausschliesslich
    hier gebildet — jede Stelle, die selbst eine Zeichenkette zusammensetzt,
    waere eine Stelle, an der die Trennung falsch sein kann.
    """
    if scope == "user":
        if server_id is not None or team_id is not None:
            raise HTTPException(status_code=422, detail="User-Memory akzeptiert keinen Bezug")
        return f"user:{user.id}", user.id, None, None
    if scope in ("server", "server_shared"):
        if team_id is not None:
            raise HTTPException(status_code=422, detail="Server-Memory akzeptiert kein Team")
        # Existenz **und** Recht — vorher stand hier nur das Recht.
        # `has_server_permission` laedt den Server nie: fuer einen Owner oder
        # eine Rolle mit pauschalem `server.view` ist damit jede beliebige
        # Nummer erlaubt. Eine erfundene ID kam so bis zum `db.commit()` durch
        # und scheiterte erst am Fremdschluessel auf `servers.id`; der
        # IntegrityError-Handler weiter unten deutet das als Schreibkonflikt und
        # antwortet "Bitte erneut versuchen". Das Modell, das bis Stufe 2 des
        # Gedaechtnisses selbst schrieb, befolgte diese Aufforderung und
        # wiederholte denselben aussichtslosen Aufruf, statt mit
        # `list_my_servers` nach der richtigen Nummer zu suchen. Die Diagnose
        # muss stimmen, sonst fuehrt sie jeden Leser in die Irre.
        #
        # Ein nicht existierender und ein nicht sichtbarer Server bleiben
        # ununterscheidbar — dieselbe Zusage wie in `_resolve_server`: sonst
        # waere die Fehlermeldung ein Existenzorakel ueber fremde Server.
        if (
            server_id is None
            or db.get(Server, server_id) is None
            or not permission_service.has_server_permission(
                db=db, user=user, server_id=server_id, key="server.view"
            )
        ):
            raise HTTPException(status_code=404, detail="Server nicht gefunden")
        if scope == "server":
            return f"server:{server_id}:user:{user.id}", user.id, server_id, None
        # Das Wissen der Anlage. Bewusst **ohne** Besitzer, genau wie bei `team`
        # weiter unten: es soll stehenbleiben, wenn der Kollege geht, der es
        # aufgeschrieben hat — und `owner_user_id` traegt ein CASCADE auf
        # `users.id`, das es mitnehmen wuerde.
        #
        # Die Kennung endet auf `:shared` und nicht auf der blossen Servernummer.
        # `server:62` waere ein **Praefix** von `server:62:user:7`; jede
        # Vergleichslogik, die je mit `startswith` arbeitet, saehe die
        # persoenliche Notiz eines Kollegen dann als Anlagenwissen an.
        return f"server:{server_id}:shared", None, server_id, None
    if scope == "team":
        from services import team_service

        if server_id is not None:
            raise HTTPException(status_code=422, detail="Team-Memory akzeptiert keinen Server")
        if team_id is None or team_service.membership(db, team_id, user.id) is None:
            # 404 statt 403: ob es ein Team mit dieser Nummer gibt, geht einen
            # Aussenstehenden nichts an.
            raise HTTPException(status_code=404, detail="Team nicht gefunden")
        # Bewusst **ohne** Besitzer: Teamwissen gehoert dem Team. Es soll
        # bestehen bleiben, wenn der Kollege geht, der es aufgeschrieben hat —
        # und ein `ondelete="CASCADE"` auf den Benutzer wuerde es mitnehmen.
        return f"team:{team_id}", None, None, team_id
    if scope == "panel":
        if server_id is not None or team_id is not None:
            raise HTTPException(status_code=422, detail="Panel-Memory akzeptiert keinen Bezug")
        return "panel", None, None, None
    raise HTTPException(status_code=422, detail="Unbekannter Memory-Scope")


# So lange nach einem "Nein" Ruhe ist, bevor erneut gefragt wird.


def _safe_value(value: str) -> str:
    normalized = value.strip()
    if not normalized or len(normalized) > 2_000:
        raise HTTPException(status_code=422, detail="Memory-Inhalt ist leer oder zu gross")
    # `enthaelt_zugangsdaten`, nicht "Schwaerzung veraendert etwas": die
    # Schwaerzung ersetzt auch E-Mail-Adressen und Zahlenkontingente
    # ("Serverwechsel-Token: 2"), und beides sind keine Zugangsdaten. Wer
    # "Rechnungen gehen an billing@firma.de" merken will, legt die Adresse
    # absichtlich in seinen eigenen Vorrat — die Abweisung log ihn an
    # ("darf keine Zugangsdaten enthalten") und die KI erklaerte ihm dann,
    # er habe ein Passwort geschickt.
    if enthaelt_zugangsdaten(normalized):
        raise HTTPException(status_code=422, detail="Memory darf keine Zugangsdaten enthalten")
    return normalized




#: Die Reihenfolge, in der eine Seite geschnitten wird: zuletzt genutzt zuerst,
#: nie Genutztes hinten, dann nach Schlüssel.
#:
#: Dieselbe Reihenfolge, die die Oberfläche schon immer herstellte — nur ist sie
#: seit der Seitenweise keine Geschmacksfrage mehr, sondern die Schnittkante:
#: welche Zeile auf Seite 3 landet, entscheidet allein sie. Wer sie hier ändert,
#: ändert die Seiteneinteilung, und wer in der Oberfläche anders sortiert,
#: bekommt eine Seite in einer anderen Reihenfolge angezeigt, als sie
#: geschnitten wurde.
#:
#: ``last_used_at IS NULL`` als erstes Kriterium: ohne Angabe stellt PostgreSQL
#: NULL bei DESC nach vorn, und die nie benutzten Einträge sollen ans Ende.
#: Davor nur noch das Angeheftete: es steht im Kopf jedes Gesprächs und in
#: der Liste oben.
_SEITENORDNUNG = (
    AiMemoryEntry.angeheftet.desc(),
    AiMemoryEntry.last_used_at.is_(None),
    AiMemoryEntry.last_used_at.desc(),
    # Bis 26.09.2026 stand hier der Name. Er ist seitdem verschluesselt und
    # sortierte nach Chiffrat; das Neueste zuerst ist bei Gleichstand ohnehin
    # die nuetzlichere Reihenfolge, und die ID macht sie eindeutig.
    AiMemoryEntry.created_at.desc(),
    AiMemoryEntry.id,
)


#: Was eine Ansicht zeigen kann: was gilt, oder was die KI vergessen hat und
#: sich noch zurueckholen laesst.
ANSICHTEN = ("aktiv", "vergessen")












def _assert_may_write(
    db: Session, user: User, scope: str, team_id: int | None,
    server_id: int | None = None,
) -> None:
    """Wer einen geteilten Bereich veraendern darf.

    Persoenliche Eintraege brauchen keine Pruefung — sie verlassen den Benutzer
    nie. Alles Geteilte verlangt ein Recht, und zwar *dasselbe*, das ein Mensch
    fuer denselben Schritt braeuchte. Genau darin liegt die Zusicherung, die
    ueber jedem KI-Schreibvorgang steht: **die KI kann nie mehr teilen, als der
    Benutzer selbst teilen duerfte.**

    ``server_id`` ist bereits durch `scope_identity` gegangen und damit gegen
    `server.view` geprueft. Hier steht die zweite, engere Frage: Lesen reicht,
    um das Wissen einer Anlage zu **sehen**; um es zu **aendern**, muss man an
    der Anlage auch etwas aendern duerfen. Sonst schriebe ein Gast eine Ansage
    in die Betriebsanleitung, nach der sich alle anderen richten.
    """
    if scope == "server_shared":
        if server_id is None or not permission_service.has_server_permission(
            db=db, user=user, server_id=server_id, key="server.config.write"
        ):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Du darfst das Wissen dieses Servers nicht veraendern. Fuer "
                    "eine eigene Notiz dazu nimm scope='server'."
                ),
            )
        return
    if scope == "panel":
        if not permission_service.has_global_permission(db, user, "panel.settings.write"):
            raise HTTPException(status_code=403, detail="Keine Berechtigung")
        return
    if scope == "team":
        from services import team_service

        if team_id is None or not team_service.can_manage_team_memory(db, user, team_id):
            raise HTTPException(
                status_code=403,
                detail="Du darfst das Wissen dieses Teams nicht veraendern",
            )
        # Ein persoenliches Team ist kein Ablageort fuer Teamwissen. Der Eintrag
        # laege unter `team:{persoenlich}` und waere danach **nirgends**
        # sichtbar: die persoenliche Ansicht zeigt `scope='user'`, eine
        # Teamansicht gibt es fuer das Ein-Mann-Team nicht. Der KI-Weg stuft
        # deshalb auf `scope='user'` herunter — genau deswegen gehoert die Regel
        # hierher und nicht in die Aufrufer.
        ziel = db.get(Team, team_id)
        if ziel is not None and ziel.is_personal:
            raise HTTPException(
                status_code=422,
                detail="Persoenliches Wissen gehoert nicht in ein Team",
            )


def _bereichsname(
    db: Session, user: User, scope: str, server_id: int | None, team_id: int | None
) -> str:
    """Benennt einen Bereich so, dass der Satz darum vor einem Menschen besteht.

    Der zweite Benenner dieses Moduls neben dem in `_memory_line`, und das mit
    Absicht. Das dortige Etikett (`server:62:anlage`) ist eine Marke für die
    Maschine: es steht vor **jeder** Kontextzeile, wird also je Zeile bezahlt,
    und das Modell muss es wieder in `scope` und `server_id` zerlegen können,
    um denselben Bereich noch einmal anzusprechen. Hier ist das Gegenteil
    gefragt — ein Satzteil, den ein Mensch versteht, gleich ob er ihn selbst
    als Fehlermeldung liest oder das Modell ihn ihm vorliest. Die
    beiden aus einer Funktion zu bedienen hiesse, an jeder Aufrufstelle einen
    Schalter mitzuführen, und sie ändern sich aus verschiedenen Gründen: das
    Etikett, wenn ein Bereich dazukommt, dieser Name, wenn der Ton der
    Meldungen nicht mehr stimmt. Auch die Form passt nicht zusammen: dort liegt
    eine fertige Zeile vor, hier gibt es noch keine — geschrieben wird ja
    gerade erst.

    Sitzung und Benutzer stehen in der Signatur wegen des Teams: dessen Name
    ist das einzige Stück dieses Satzes, das nicht schon in den Argumenten
    liegt — und wie er lauten muss, hängt daran, in welchen Teams der Benutzer
    sonst noch ist (siehe unten). Ohne beides wäre der Satz für ein Team
    wertlos.
    """
    if scope == "user":
        return "dein persönliches Gedächtnis"
    if scope == "server":
        return f"deine Notizen zu Server {server_id}"
    if scope == "server_shared":
        return f"das Wissen von Server {server_id}"
    if scope == "team":
        # Der Name, nicht die Nummer: diese Absage liest ein Mensch, und
        # „Team 42“ benennt für ihn nichts. Der **ansprechbare** Name statt
        # des blanken, weil Teamnamen nur je Gründer eindeutig sind — ist der
        # Benutzer in zwei Teams namens „Alpha“, benennt „Alpha“ beide, und
        # `ansprechbarer_name` hängt dann den Gründer an.
        ziel = db.get(Team, team_id) if team_id is not None else None
        if ziel is not None and ziel.name:
            from services import team_service

            gemeint = team_service.ansprechbarer_name(db, user, ziel)
            return f"das Wissen von Team „{gemeint}“"
        # Kein stiller Notausgang: `scope_identity` hat die Mitgliedschaft in
        # genau diesem Team schon geprüft, die Zeile existiert also. Bliebe sie
        # wider Erwarten aus, ist die Nummer immer noch besser als ein Satz ohne
        # Bereich — dass es um das Team geht und nicht um den eigenen Vorrat,
        # ist die Hälfte der Meldung, und die darf nie fehlen.
        return f"das Wissen von Team {team_id}"
    if scope == "panel":
        return "das panelweite Gedächtnis"
    # Unerreichbar: `scope_identity` hat jeden unbekannten Bereich längst mit
    # 422 abgewiesen. Trotzdem kein `else`-Zweig auf "panel" — ein neuer
    # Bereich, der hier durchrutscht, würde dem Benutzer sonst als das
    # panelweite Gedächtnis angesagt und damit als Sache des Betreibers.
    return "dieser Bereich"


def _sperrzeile(db: Session, identity: str) -> Query:
    """Die eine Zeile, auf der zwei gleichzeitige Schreiber aufeinandertreffen.

    Zwischen der Zählung in `upsert_entry` und dem `db.add()` danach lag einmal
    keine Sperre. Zwei gleichzeitige Läufe mit verschiedenen Schlüsseln — Chat
    und Sprachsitzung sind ausdrücklich möglich — sahen beide denselben Bestand
    und legten beide an; die einzige Datenbankzusage ist der UNIQUE auf
    (scope_identity, key) und greift bei verschiedenen Schlüsseln gar nicht.
    Die Bereichsgrenze war damit eine Bitte, keine Grenze.

    Gesperrt wird dafür **eine** Zeile und nicht der ganze Bereich. Bis
    `MAX_MEMORY_ENTRIES_MAX` auf 5.000 stieg, war das dasselbe in teuer: beide
    Schreiber lesen in derselben Reihenfolge, sie treffen sich also ohnehin an
    der ersten Zeile — wer danach noch 4.999 weitere sperrt, kauft damit keine
    zusätzliche Ausschließlichkeit, nur Arbeit. Gemessen gegen PostgreSQL 17
    (local-plans/mess-bestandssperre.py): alle 5.000 Zeilen sperren kostet
    10–18 ms und 281 KB WAL **je gemerktem Satz**, diese eine Zeile 0,5 ms und
    56 Bytes. Der Rest des Bereichs bleibt dabei schreibbar — der Abrufweg
    zählt Nutzung hoch und schreibt Vektoren nach, und das lief bisher gegen
    die Sperre des Schreibenden.

    Dass der Treffpunkt hält, hängt am `LIMIT` **über** der Sperre: geliefert
    wird die erste Zeile, die sich auch wirklich sperren lässt. Wurde die
    bisher erste gerade gelöscht, rücken alle Wartenden gemeinsam auf die
    nächste. Und eine Zeile, die sich davor einsortiert, kann nur anlegen, wer
    selbst durch diese Sperre gegangen ist — die Reihenfolge ist deshalb kein
    Schmuck, sondern die Zusage.

    Eine Grenze, unverändert zu vorher: ein **leerer** Bereich hat keine Zeile
    zum Sperren, dort können zwei erste Einträge nebeneinander entstehen.
    """
    return (
        db.query(AiMemoryEntry.id)
        .filter(AiMemoryEntry.scope_identity == identity)
        .order_by(AiMemoryEntry.id)
        .limit(1)
        .with_for_update()
    )


def _bestand_unter_sperre(db: Session, identity: str) -> int:
    """Wieviele Einträge der Bereich führt — gezählt hinter der Sperre.

    Erst sperren, dann zählen, und diese Reihenfolge ist der eigentliche Punkt.
    Vorher taten beides eine einzige Abfrage, weil `count()` kein `FOR UPDATE`
    verträgt und deshalb die Liste der IDs herhalten musste. Das kostete nicht
    nur — es zählte auch falsch: der wartende Schreiber bekam die Zeilen aus
    dem Schnappschuss von **vor** dem Warten. Gemessen (siehe `_sperrzeile`)
    zählte er 5.001, während in der Datenbank bereits 5.002 standen, und legte
    darauf den 5.003. an. Als eigene Anweisung **nach** der Sperre sieht die
    Zählung den fremden Eintrag; dieselbe Messung ergibt dann 5.001 von 5.001.

    Der Bereich ist bis zum Commit gesperrt, die Zahl gilt also bis dahin.

    Gezaehlt wird nur, was gilt. Eine vergessene Erinnerung belegt keinen
    Platz mehr: wer „vergiss das“ sagt, um Platz zu schaffen, soll ihn
    bekommen, auch wenn sich das Vergessene noch 30 Tage zurueckholen laesst.
    """
    _sperrzeile(db, identity).first()
    return _bestand(db, identity)


def _bestand(db: Session, identity: str) -> int:
    """Wieviele geltende Erinnerungen ein Bereich hat — ohne Sperre."""
    return int(
        db.query(func.count(AiMemoryEntry.id))
        .filter(AiMemoryEntry.scope_identity == identity, AiMemoryEntry.status == "aktiv")
        .scalar()
        or 0
    )


def _platz_sicherstellen(
    db: Session, user: User, scope: str, identity: str,
    server_id: int | None, team_id: int | None,
) -> None:
    """Wirft `MemoryScopeVoll`, wenn der Bereich keine weitere Erinnerung fasst.

    Gilt fuer jeden Weg, auf dem eine Erinnerung **dazukommt**: neu angelegt,
    aus dem Vergessen zurueckgeholt oder (Altbestand) unter einem neuen Namen
    gemerkt. Eine Aenderung an einer bestehenden kostet keinen Platz.

    Bei einer Grenze bleibt der Bereich bis zum Commit des Aufrufers gesperrt
    (`_bestand_unter_sperre`); die Zahl gilt also, bis die neue Zeile steht.
    """
    # Wieviel hier hineinpasst, entscheidet nicht mehr eine Konstante dieses
    # Moduls, sondern der Betreiber über das Rollenlimit — je nach Bereich
    # das des Schreibenden, das des Teamgründers oder die feste
    # Systemgrenze. Eine zweite Zahl hier daneben wäre eine zweite Wahrheit,
    # die mit der ersten auseinanderläuft.
    #
    # ``None`` heißt unbegrenzt — dann gibt es nichts zu zählen und nichts
    # zu sperren. Eine 0 ist dagegen eine Zahl und läuft durch die Zählung.
    # Das Ergebnis steht in einer Variablen, weil die Meldung es gleich
    # noch braucht.
    grenze = ai_limit_service.resolve_scope_memory_limit(
        db, scope, user, team_id=team_id, server_id=server_id,
    )
    bestand = _bestand_unter_sperre(db, identity) if grenze is not None else 0
    if grenze is not None and bestand >= grenze:
        # Hier steht die **Tatsache**, in Sätzen, die ein Mensch versteht —
        # und nichts sonst. Vorher stand hier eine Regieanweisung an das
        # Modell („Sag dem Benutzer …“, „Suche mit search_memory …“). Diese
        # Funktion hat aber zwei Adressaten: über `routers/ai_memory.py`
        # legt der Benutzer selbst einen Eintrag an, und `detail` wird ihm
        # als Toast vorgesetzt. Er las dort eine Anweisung an eine dritte
        # Instanz, über ihn selbst, mit Werkzeugnamen, die er nicht hat. Ein
        # Text, der beiden dienen soll, dient keinem. (Bis Stufe 2 übersetzte
        # `remember` die Tatsache für das Modell; der Gedächtnisschreiber
        # kennt den freien Platz heute vorher.)
        #
        # Der Bereich steht in jedem der drei Sätze, und das ist keine
        # Höflichkeit: nur er sagt, **wo** es klemmt. „Voll“ ohne Bereich
        # liest sich wie „das Gedächtnis ist voll“ und stimmt dann für jeden
        # anderen Vorrat des Benutzers nicht.
        #
        # Drei Fälle, weil die Auskunft in dreien verschieden ist:
        #
        # 0 — hier passt nichts hinein, und daran ändert kein Aufräumen
        #   etwas. Vom Tarif des Benutzers spricht die Absage bewusst nicht:
        #   bei `scope='team'` kommt die 0 vom Gründer, nicht vom
        #   Schreibenden. Ein Mitglied mit grosszügigem eigenem Limit hörte
        #   sonst, sein Tarif sei schuld — und könnte das durch keinen
        #   Tarifwechsel beheben.
        # genau voll — der Normalfall. Einer geht, einer kommt.
        # zu voll — der Betreiber hat nachträglich gesenkt. Nur dieser Fall
        #   nennt eine Menge, und er nennt sie als Auskunft, nicht als
        #   Auftrag: „einer muss weichen“ wäre hier eine Anleitung zu so
        #   vielen Fehlschlägen, wie der Bereich zu viel hat. Wer entscheidet,
        #   welche gehen, steht bewusst **nicht** mehr dabei. „Welche das
        #   sind, entscheidet der Benutzer“ stand hier bis zuletzt — ein Satz,
        #   der über seinen eigenen Leser hinwegredet, denn dieses `detail`
        #   liest der Benutzer selbst als Toast, und die zwei Sätze davor
        #   duzen ihn. Derselbe Fehler wie die frühere Regieanweisung im
        #   0-Fall, nur eine Stufe leiser.
        #
        # Verdrängt wird bewusst nichts von selbst: was ein Mensch gesagt
        # hat, wirft das Panel nicht ungefragt weg.
        bereich = _bereichsname(
            db, user, scope, server_id, team_id
        )
        if grenze == 0:
            meldung = (
                f"Für {bereich} ist kein Gedächtnis freigegeben (0 Einträge erlaubt). "
                "Das entscheidet die Rolle und nicht der Inhalt — Löschen schafft hier "
                "keinen Platz."
            )
        elif bestand == grenze:
            meldung = (
                f"Voll — {bereich} führt {bestand} von {grenze} erlaubten Einträgen. "
                "Einer muss weichen, bevor ein neuer passt."
            )
        else:
            # Nicht `bestand - grenze`: der neue Eintrag will ja auch noch
            # hinein. Bei 21 von 20 wären das sonst „1 muss weichen“ und
            # danach immer noch kein Platz.
            zuviel = bestand - grenze + 1
            meldung = (
                f"Zu voll — {bereich} führt {bestand} Einträge, erlaubt sind {grenze}. "
                f"Die Grenze wurde nachträglich gesenkt; {zuviel} müssen weichen."
            )
        raise MemoryScopeVoll(
            bereich=bereich, bestand=bestand, grenze=grenze, detail=meldung
        )


def upsert_entry(
    db: Session, *, user: User, scope: str, server_id: int | None, key: str, value: str,
    origin: str = "user", team_id: int | None = None, quelle: str | None = None,
) -> tuple[AiMemoryEntry, str]:
    """Legt einen Eintrag an oder ueberschreibt ihn unter demselben Schluessel.

    Das Ueberschreiben ist die Konfliktaufloesung des Gedaechtnisses: "ich will
    jetzt 16 GB" ersetzt "8 GB", statt beides nebeneinander stehen zu lassen.
    Deshalb ist der Schluessel die Identitaet eines Fakts — und deshalb bekam
    die KI, solange sie selbst schrieb (bis Stufe 2), die Anweisung, einen
    vorhandenen Schluessel wiederzuverwenden, statt einen aehnlichen anzulegen.

    ``origin`` unterscheidet eine Ansage des Benutzers von einer Ableitung der
    KI. Eine Ableitung ueberschreibt bewusst **keine** ausdrueckliche Ansage:
    was der Benutzer selbst gesagt hat, darf die KI nicht stillschweigend
    korrigieren. Die ausdrueckliche Korrektur (`replace_user_entry`) gab es
    nur fuer `remember`; seit Stufe 2 aendert der Gedaechtnisschreiber ueber
    `erinnerung_aendern`, mit der Nachricht des Menschen als Beleg.

    Der Weg der Namen, und damit Altbestand: seit Gedaechtnis v2 legt
    `erinnerung_anlegen` Erinnerungen ohne Namen an. Was hier entsteht, kommt
    mit ``quelle`` an (Vorgabe nach ``origin``: von der KI aus dem Gespraech,
    sonst eingetragen).
    """
    if origin not in {"user", "ai"}:
        raise HTTPException(status_code=422, detail="Unbekannte Memory-Herkunft")
    if quelle is not None and quelle not in QUELLEN:
        raise HTTPException(status_code=422, detail="Unbekannte Memory-Quelle")
    identity, owner_id, normalized_server_id, normalized_team_id = scope_identity(
        db, user, scope, server_id, team_id
    )
    _assert_may_write(db, user, scope, normalized_team_id, normalized_server_id)
    safe_value = _safe_value(value)
    row = db.query(AiMemoryEntry).filter(schluessel_bedingung(db, identity, [key])).first()
    action = "ai.memory.updated"
    if row is not None and row.status != "aktiv":
        # Unter diesem Namen steht eine vergessene Erinnerung. Wer ihn jetzt
        # wieder benutzt, merkt sich etwas neu: das kostet Platz wie eine neue
        # Zeile, und das Vergessene ist damit ueberschrieben.
        _platz_sicherstellen(
            db, user, scope, identity, normalized_server_id, normalized_team_id
        )
        row.status = "aktiv"
        row.vergessen_am = None
        row.origin = origin
        row.quelle = quelle or ("gespraech" if origin == "ai" else "eingetragen")
        action = "ai.memory.created"
    elif row is None:
        _platz_sicherstellen(
            db, user, scope, identity, normalized_server_id, normalized_team_id
        )
        row = AiMemoryEntry(
            id=str(uuid4()), owner_user_id=owner_id, server_id=normalized_server_id,
            team_id=normalized_team_id,
            scope=scope, scope_identity=identity, value_encrypted="",
            origin=origin, aad_version=2,
            quelle=quelle or ("gespraech" if origin == "ai" else "eingetragen"),
            kopf_rang=3.0,  # Standardwichtigkeit bei Präsenz 1
        )
        # Erst jetzt: die AAD des Namens braucht ID und Bereich der Zeile.
        row.key = key
        row.key_index = _schluessel_indizes(identity, [key])[0]
        db.add(row)
        action = "ai.memory.created"
    elif origin == "ai" and row.origin == "user":
        # Der Schutz gilt gegen die *stillschweigende* Korrektur: die KI leitet
        # nebenbei etwas ab und ueberschreibt damit, was der Benutzer selbst
        # gesagt hat.
        raise HTTPException(
            status_code=409,
            detail="Dieser Eintrag stammt vom Benutzer und wird nicht still überschrieben.",
        )
    else:
        # Die Herabstufung "user" -> "ai" hat der Zweig darueber schon
        # abgewiesen. Die Hochstufung "ai" -> "user" bleibt erlaubt: wer eine
        # Ableitung selbst bestaetigt, macht sie damit zu seiner eigenen Ansage
        # und sie verdient den Schutz.
        row.origin = origin
        # Der Stand davor bleibt als Fassung lesbar, wie bei jeder Aenderung
        # seit Gedaechtnis v2. Gelesen wird vor dem Umstellen der AAD unten.
        # Ein Stand, der sich nicht mehr oeffnen laesst, wird ohne Fassung
        # ueberschrieben; ihn zu behalten hiesse, den Eintrag zu sperren.
        try:
            bisher: str | None = DisClient.decrypt(row.value_encrypted, aad=_aad(row))
        except DisDecryptionError:
            bisher = None
        if bisher is not None and bisher != safe_value:
            _fassung_ablegen(
                db, row, bisher, row.titel,
                grund="aktualisiert" if origin == "ai" else "bearbeitet", von=origin,
            )
    # Jeder Schreibvorgang hebt den Eintrag auf die gebundene AAD. Bestandsdaten
    # aus Phase C wandern damit von selbst mit, sobald sie angefasst werden —
    # ohne Migrationsschritt, der den DIS-Sidecar voraussetzt.
    row.aad_version = 2
    row.value_encrypted = DisClient.encrypt(safe_value, aad=_aad(row))
    if action == "ai.memory.updated":
        row.fassung = int(row.fassung or 1) + 1
    # Der Vektor entsteht aus dem Klartext, bevor er verschluesselt wird —
    # danach waere er nicht mehr zu haben, ohne erneut zu entschluesseln.
    refresh_embedding(db, row, safe_value)
    row.updated_at = datetime.now(timezone.utc)
    audit_service.record_privileged_action(
        db, user_id=user.id, action=action, target_type="ai_memory", target_id=row.id,
        # Die Servernummer gehoert ins Protokoll, sobald der Bereich sie hat.
        # Ohne sie stuende dort "jemand hat Anlagenwissen geaendert" und nicht
        # bei welcher Anlage — und genau das ist die Frage, die ein Betreiber
        # spaeter stellt.
        #
        # Für das Team gilt derselbe Satz, und dort wiegt er schwerer: ein
        # Teameintrag hat bewusst keinen Besitzer (`owner_user_id` ist NULL),
        # und nach dem Löschen ist die Zeile weg. Das Protokoll ist damit der
        # einzige Ort, an dem die Zuordnung überlebt — bei einem Benutzer in
        # mehreren Teams sagte "scope: team" allein gar nichts.
        details={
            "scope": scope, "origin": origin,
            **({"server_id": normalized_server_id} if normalized_server_id else {}),
            **({"team_id": normalized_team_id} if normalized_team_id else {}),
        },
        origin="ai" if origin == "ai" else "direct",
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # Zwei parallele Schreibvorgaenge auf denselben (scope, key). Die
        # UNIQUE-Bedingung hat den Verlierer abgewiesen. Das ist ein
        # verstaendlicher Konflikt und kein Serverfehler: der naechste Versuch
        # findet die Zeile vor und nimmt den Update-Zweig.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Memory-Eintrag wurde parallel geaendert. Bitte erneut versuchen.",
        ) from exc
    db.refresh(row)
    return row, safe_value


def _titel_pruefen(titel: str | None) -> str | None:
    """Ein Titel ist eine Zeile, kurz und ohne Zugangsdaten — oder keiner."""
    if titel is None:
        return None
    normal = " ".join(str(titel).split())
    if not normal:
        return None
    if len(normal) > MAX_TITEL_ZEICHEN:
        raise HTTPException(status_code=422, detail="Der Titel ist zu lang")
    if enthaelt_zugangsdaten(normal):
        raise HTTPException(status_code=422, detail="Memory darf keine Zugangsdaten enthalten")
    return normal


def _themenname(name: str | None) -> str | None:
    """Ein Themenname in der Form, in der er verglichen und gezeigt wird."""
    if name is None:
        return None
    normal = " ".join(str(name).split())
    if not normal:
        return None
    if len(normal) > MAX_THEMA_ZEICHEN:
        raise HTTPException(status_code=422, detail="Der Themenname ist zu lang")
    if enthaelt_zugangsdaten(normal):
        raise HTTPException(status_code=422, detail="Memory darf keine Zugangsdaten enthalten")
    return normal


def _art_pruefen(art: str | None) -> str | None:
    if art is not None and art not in (*ARTEN, SCHLUSS):
        raise HTTPException(status_code=422, detail="Unbekannte Art der Erinnerung")
    return art


def _wichtigkeit_pruefen(wichtigkeit: int) -> int:
    # `True` ist in Python eine 1. Eine Wichtigkeit ist eine Zahl, kein
    # Schalter (AGENTS.md, Punkt 97).
    if isinstance(wichtigkeit, bool) or not isinstance(wichtigkeit, int) or not 1 <= wichtigkeit <= 5:
        raise HTTPException(status_code=422, detail="Wichtigkeit liegt zwischen 1 und 5")
    return wichtigkeit


def thema_fuer(
    db: Session, *, identity: str, owner_id: int | None, server_id: int | None,
    team_id: int | None, name: str | None,
) -> AiMemoryTopic | None:
    """Das Thema eines Bereichs mit diesem Namen — gefunden oder neu angelegt.

    Verglichen wird ohne Gross- und Kleinschreibung: „Familie“ und „familie“
    sind ein Thema, gezeigt wird die Schreibweise, mit der es entstand. Legen
    zwei Schreiber dasselbe Thema gleichzeitig an, gewinnt einer am UNIQUE,
    und der andere nimmt dessen Zeile.
    """
    normal = _themenname(name)
    if normal is None:
        return None
    index = DisClient.blind_index([f"{identity}\nthema\n{normal.casefold()}"])[0]
    jetzt = datetime.now(timezone.utc)
    # Gesperrt: räumt `vergessene_aufraeumen` dieses Thema gerade ab, wartet
    # die Abfrage auf dessen Ende und findet dann nichts, statt eine Zeile zu
    # benutzen, die es gleich nicht mehr gibt.
    thema = (
        db.query(AiMemoryTopic)
        .filter(AiMemoryTopic.scope_identity == identity, AiMemoryTopic.name_index == index)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if thema is not None:
        # Wer ein Thema benutzt, haelt es frisch: `vergessene_aufraeumen`
        # raeumt nur Themen ab, die eine Weile niemand mehr angefasst hat.
        thema.updated_at = jetzt
        return thema
    thema = AiMemoryTopic(
        id=str(uuid4()), scope_identity=identity, owner_user_id=owner_id,
        server_id=server_id, team_id=team_id, name_encrypted="", name_index=index,
        created_at=jetzt, updated_at=jetzt,
    )
    thema.name_encrypted = DisClient.encrypt(normal, aad=thema.name_aad())
    try:
        with db.begin_nested():
            db.add(thema)
    except IntegrityError:
        thema = (
            db.query(AiMemoryTopic)
            .filter(AiMemoryTopic.scope_identity == identity, AiMemoryTopic.name_index == index)
            .first()
        )
    return thema


def themennamen(db: Session, paare: Iterable[tuple[str | None, str]]) -> dict[str, str]:
    """Klartext der Themennamen, in einem Sidecar-Aufruf.

    ``paare`` sind (Thema, Bereich) der Erinnerungen, die gezeigt werden.
    Geöffnet wird ein Name nur, wenn das Thema in genau diesem Bereich steht.
    Die AAD des Namens bindet ihn an sein eigenes Thema, nicht an die
    Erinnerung: wer per Datenbankzugriff die `thema_id` seiner Erinnerung auf
    ein fremdes Thema zeigen ließ, bekam bis 06.10.2026 dessen Namen im
    Klartext — genau der Weg, den die AAD bei Text, Titel und Fassungen
    versperrt.

    Ein Name, der sich nicht oeffnen laesst, fehlt im Ergebnis; die
    Erinnerung erscheint dann ohne Thema, statt die Seite zu kippen.
    """
    gesucht = {(kennung, bereich) for kennung, bereich in paare if kennung}
    if not gesucht:
        return {}
    themen = [
        thema
        for thema in db.query(AiMemoryTopic)
        .filter(AiMemoryTopic.id.in_(sorted({kennung for kennung, _ in gesucht})))
        .all()
        if (thema.id, thema.scope_identity) in gesucht
    ]
    klartexte = _sammeln([(thema.name_encrypted, thema.name_aad()) for thema in themen])
    return {
        thema.id: klar for thema, klar in zip(themen, klartexte) if klar is not None
    }


@dataclass(frozen=True)
class Themenzeile:
    """Ein Thema einer Ansicht und wieviele geltende Erinnerungen darunter stehen."""

    id: str
    name: str
    anzahl: int


#: Wieviele Themen eine Ansicht hoechstens auflistet, die vollsten zuerst.
#: Ein Bereich mit 100.000 Erinnerungen kann tausende Themen haben; eine
#: Filterleiste mit tausend Eintraegen hilft niemandem und kostet je Aufruf
#: eine Entschluesselung je Name.
MAX_THEMEN_LISTE = 300


def _themen_der_ansicht(db: Session, basis: Query) -> list[Themenzeile]:
    # Nur Themen aus dem Bereich der Erinnerung selbst (siehe `themennamen`).
    zahlen = (
        basis.filter(AiMemoryEntry.status == "aktiv")
        .join(
            AiMemoryTopic,
            and_(
                AiMemoryTopic.id == AiMemoryEntry.thema_id,
                AiMemoryTopic.scope_identity == AiMemoryEntry.scope_identity,
            ),
        )
        .with_entities(
            AiMemoryEntry.thema_id, AiMemoryEntry.scope_identity, func.count(AiMemoryEntry.id)
        )
        .group_by(AiMemoryEntry.thema_id, AiMemoryEntry.scope_identity)
        .order_by(func.count(AiMemoryEntry.id).desc(), AiMemoryEntry.thema_id)
        .limit(MAX_THEMEN_LISTE)
        .all()
    )
    namen = themennamen(db, [(kennung, bereich) for kennung, bereich, _anzahl in zahlen])
    zeilen = [
        Themenzeile(id=kennung, name=namen[kennung], anzahl=int(anzahl))
        for kennung, _bereich, anzahl in zahlen
        if kennung in namen
    ]
    return sorted(zeilen, key=lambda zeile: (zeile.name.casefold(), zeile.id))


def scope_themen(
    db: Session, user: User, scope: str, server_id: int | None = None,
    team_id: int | None = None,
) -> list[Themenzeile]:
    """Die Themen eines Bereichs mit ihrer Zahl — die Filterleiste der Ansicht."""
    identity, _, _, _ = scope_identity(db, user, scope, server_id, team_id)
    return _themen_der_ansicht(
        db, db.query(AiMemoryEntry).filter(AiMemoryEntry.scope_identity == identity)
    )


def personal_themen(db: Session, user: User) -> list[Themenzeile]:
    """Die Themen der eigenen Erinnerungen, allgemein und zu Servern zusammen.

    Dasselbe Wort kann hier zweimal stehen ("Minecraft" allgemein und zu
    Server 62): es sind zwei Bereiche mit je eigenem Thema. Die Oberflaeche
    fasst gleiche Namen zu einem Filter zusammen.
    """
    return _themen_der_ansicht(
        db,
        db.query(AiMemoryEntry).filter(
            AiMemoryEntry.owner_user_id == user.id,
            AiMemoryEntry.scope.in_(PERSOENLICHE_SCOPES),
        ),
    )


def _fassung_ablegen(
    db: Session, row: AiMemoryEntry, text: str, titel: str | None, *, grund: str, von: str,
) -> AiMemoryVersion:
    """Legt den bisherigen Stand einer Erinnerung als fruehere Fassung ab.

    Danach bleiben die juengsten `MAX_VERSIONEN`; aeltere fallen weg.
    """
    if grund not in GRUENDE or von not in {"user", "ai"}:
        raise ValueError(f"unbekannte Fassung: {grund}/{von}")
    fassung = AiMemoryVersion(
        id=str(uuid4()), memory_id=row.id, scope_identity=row.scope_identity,
        text_encrypted="", grund=grund, von=von, created_at=datetime.now(timezone.utc),
    )
    fassung.text_encrypted = DisClient.encrypt(text, aad=_versions_aad(fassung, "text"))
    if titel:
        fassung.titel_encrypted = DisClient.encrypt(titel, aad=_versions_aad(fassung, "titel"))
    db.add(fassung)
    db.flush()
    ueberzaehlig = [
        kennung
        for (kennung,) in db.query(AiMemoryVersion.id)
        .filter(AiMemoryVersion.memory_id == row.id)
        .order_by(AiMemoryVersion.created_at.desc(), AiMemoryVersion.id.desc())
        .offset(MAX_VERSIONEN)
        .all()
    ]
    if ueberzaehlig:
        db.query(AiMemoryVersion).filter(AiMemoryVersion.id.in_(ueberzaehlig)).delete(
            synchronize_session=False
        )
    return fassung


def erinnerung_anlegen(
    db: Session,
    *,
    user: User,
    scope: str,
    text: str,
    server_id: int | None = None,
    team_id: int | None = None,
    titel: str | None = None,
    thema: str | None = None,
    art: str | None = None,
    wichtigkeit: int = 3,
    quelle: str = "eingetragen",
    quelle_ref: str | None = None,
    origin: str = "user",
    faellig_am: date | None = None,
    commit: bool = True,
) -> tuple[AiMemoryEntry, str]:
    """Legt eine Erinnerung an: ein bis fuenf Saetze, ohne Namen.

    Dieselben Grenzen wie jeder Schreibweg: Rechte des Bereichs
    (`_assert_may_write`), keine Zugangsdaten, und das Rollenlimit des
    Bereichs (`_platz_sicherstellen`): 100, eine eingestellte Zahl oder
    unbegrenzt, 0 heisst gesperrt.

    ``commit=False`` schreibt nur in die laufende Transaktion; der Aufrufer
    (Import, Pflege) schreibt dann mehrere Erinnerungen in einem Zug fest.
    """
    if origin not in {"user", "ai"}:
        raise HTTPException(status_code=422, detail="Unbekannte Memory-Herkunft")
    if quelle not in QUELLEN:
        raise HTTPException(status_code=422, detail="Unbekannte Memory-Quelle")
    _art_pruefen(art)
    _wichtigkeit_pruefen(wichtigkeit)
    identity, owner_id, sid, tid = scope_identity(db, user, scope, server_id, team_id)
    _assert_may_write(db, user, scope, tid, sid)
    sauber = _safe_value(text)
    sauberer_titel = _titel_pruefen(titel)
    _platz_sicherstellen(db, user, scope, identity, sid, tid)
    gefunden = thema_fuer(
        db, identity=identity, owner_id=owner_id, server_id=sid, team_id=tid, name=thema,
    )
    jetzt = datetime.now(timezone.utc)
    row = AiMemoryEntry(
        id=str(uuid4()), owner_user_id=owner_id, server_id=sid, team_id=tid,
        scope=scope, scope_identity=identity, value_encrypted="", origin=origin,
        aad_version=2, quelle=quelle, quelle_ref=quelle_ref, art=art,
        wichtigkeit=wichtigkeit, faellig_am=faellig_am, status="aktiv", fassung=1,
        thema_id=gefunden.id if gefunden is not None else None,
        created_at=jetzt, updated_at=jetzt, kopf_rang=float(wichtigkeit),
    )
    row.value_encrypted = DisClient.encrypt(sauber, aad=_aad(row))
    row.titel = sauberer_titel
    refresh_embedding(db, row, sauber)
    db.add(row)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="ai.memory.created", target_type="ai_memory",
        target_id=row.id,
        details=_protokolldetails(row, origin=origin, quelle=quelle),
        origin="ai" if origin == "ai" else "direct",
    )
    if not commit:
        db.flush()
        return row, sauber
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Die Erinnerung wurde gleichzeitig angelegt oder geändert. Bitte noch einmal versuchen.",
        ) from exc
    db.refresh(row)
    return row, sauber


#: Steht fuer "dieses Feld nicht anfassen" — im Unterschied zu ``None``, das
#: bei Titel und Thema "entfernen" heisst.
UNVERAENDERT = object()


def erinnerung_aendern(
    db: Session,
    *,
    user: User,
    entry_id: str,
    text: str | None = None,
    titel: object = UNVERAENDERT,
    thema: object = UNVERAENDERT,
    art: object = UNVERAENDERT,
    wichtigkeit: int | None = None,
    erwartete_fassung: int | None = None,
    von: str = "user",
    grund: str = "bearbeitet",
    ueberschreibt_mensch: bool = False,
    faellig_am: object = UNVERAENDERT,
    commit: bool = True,
) -> tuple[AiMemoryEntry, str]:
    """Aendert eine Erinnerung und legt den Stand davor als Fassung ab.

    ``erwartete_fassung`` ist die Fassung, die der Aendernde gesehen hat.
    Passt sie nicht mehr, hat inzwischen jemand anderes geschrieben (ein
    zweites Fenster, die Pflege im Hintergrund), und die Aenderung wird mit
    409 abgelehnt statt dessen Stand still zu ueberschreiben.

    Aendert ein Mensch den Text, ist es danach seine Aussage (``origin``
    wird ``user``). Die KI (``von='ai'``) aendert Text oder Titel einer
    Aussage des Menschen nur mit ``ueberschreibt_mensch``: derselbe Schutz wie
    beim Namen (`upsert_entry`). Thema, Art und
    Wichtigkeit ordnet sie dagegen frei zu; das sagt nichts anderes, als der
    Mensch gesagt hat.
    """
    if von not in {"user", "ai"}:
        raise ValueError("von ist 'user' oder 'ai'")
    row = _zeile(db, user, entry_id, aendern=True)
    if row.status != "aktiv":
        raise HTTPException(
            status_code=409,
            detail="Diese Erinnerung ist vergessen. Hol sie zuerst zurück.",
        )
    if erwartete_fassung is not None and int(row.fassung or 1) != erwartete_fassung:
        raise HTTPException(
            status_code=409,
            detail="Die Erinnerung wurde inzwischen geändert. Lade neu und versuch es noch einmal.",
        )
    alter_text = DisClient.decrypt(row.value_encrypted, aad=_aad(row))
    alter_titel = row.titel
    neuer_text = _safe_value(text) if text is not None else alter_text
    neuer_titel = alter_titel if titel is UNVERAENDERT else _titel_pruefen(titel)
    geaendert = False
    if neuer_text != alter_text or neuer_titel != alter_titel:
        if von == "ai" and row.origin == "user" and not ueberschreibt_mensch:
            raise HTTPException(
                status_code=409,
                detail="Diese Erinnerung stammt vom Benutzer und wird nicht still überschrieben.",
            )
        _fassung_ablegen(db, row, alter_text, alter_titel, grund=grund, von=von)
        if neuer_text != alter_text:
            # Was aus dem alten Text geschlossen war, gilt nicht mehr.
            _schluesse_entkraeften(db, [row.id], user_id=user.id)
            if row.art == SCHLUSS:
                # Wer einen Schluss umschreibt, macht ihn zu einer eigenen
                # Aussage: sie hängt danach nicht mehr an ihren Belegen.
                db.query(AiMemoryBeleg).filter(AiMemoryBeleg.schluss_id == row.id).delete(
                    synchronize_session=False
                )
                row.art = None
        row.aad_version = 2
        row.value_encrypted = DisClient.encrypt(neuer_text, aad=_aad(row))
        row.titel = neuer_titel
        refresh_embedding(db, row, neuer_text)
        if von == "user":
            row.origin = "user"
        geaendert = True
    if thema is not UNVERAENDERT:
        gefunden = thema_fuer(
            db, identity=row.scope_identity, owner_id=row.owner_user_id,
            server_id=row.server_id, team_id=row.team_id, name=thema,
        )
        neue_id = gefunden.id if gefunden is not None else None
        if neue_id != row.thema_id:
            row.thema_id = neue_id
            geaendert = True
    if art is not UNVERAENDERT and art != row.art:
        row.art = _art_pruefen(art)
        geaendert = True
    if wichtigkeit is not None and wichtigkeit != row.wichtigkeit:
        row.wichtigkeit = _wichtigkeit_pruefen(wichtigkeit)
        row.kopf_rang = kopf_rang(row, datetime.now(timezone.utc))
        geaendert = True
    if faellig_am is not UNVERAENDERT and faellig_am != row.faellig_am:
        # Ein Datum allein ist keine neue Fassung: der Satz bleibt derselbe.
        row.faellig_am = faellig_am
    if geaendert:
        row.fassung = int(row.fassung or 1) + 1
        row.updated_at = datetime.now(timezone.utc)
        audit_service.record_privileged_action(
            db, user_id=user.id, action="ai.memory.updated", target_type="ai_memory",
            target_id=row.id,
            details=_protokolldetails(row, origin=von, grund=grund),
            origin="ai" if von == "ai" else "direct",
        )
    if not commit:
        db.flush()
        return row, neuer_text
    db.commit()
    db.refresh(row)
    return row, neuer_text


def erinnerung_anheften(
    db: Session, *, user: User, entry_id: str, angeheftet: bool
) -> tuple[AiMemoryEntry, str]:
    """Heftet eine Erinnerung an oder löst sie: angeheftet steht sie immer im Kopf.

    Keine neue Fassung — am Inhalt ändert sich nichts, und wer zugleich den
    Text bearbeitet, soll daran kein 409 bekommen. Anheften darf, wer ändern
    darf (`_zeile`); die KI heftet nichts an.
    """
    row = _zeile(db, user, entry_id, aendern=True)
    if row.status != "aktiv":
        raise HTTPException(
            status_code=409,
            detail="Diese Erinnerung ist vergessen. Hol sie zuerst zurück.",
        )
    if bool(row.angeheftet) != angeheftet:
        row.angeheftet = angeheftet
        audit_service.record_privileged_action(
            db, user_id=user.id, action="ai.memory.updated", target_type="ai_memory",
            target_id=row.id,
            details=_protokolldetails(
                row, origin="user", grund="angeheftet" if angeheftet else "geloest",
            ),
            origin="direct",
        )
        db.commit()
        db.refresh(row)
    return row, DisClient.decrypt(row.value_encrypted, aad=_aad(row))


def _vergessene_begrenzen(db: Session, identity: str) -> None:
    """Haelt den Vorrat vergessener Erinnerungen eines Bereichs bei `MAX_VERGESSENE`."""
    ueberzaehlig = [
        kennung
        for (kennung,) in db.query(AiMemoryEntry.id)
        .filter(AiMemoryEntry.scope_identity == identity, AiMemoryEntry.status == "vergessen")
        .order_by(AiMemoryEntry.vergessen_am.desc(), AiMemoryEntry.id.desc())
        .offset(MAX_VERGESSENE)
        .all()
    ]
    if ueberzaehlig:
        db.query(AiMemoryEntry).filter(AiMemoryEntry.id.in_(ueberzaehlig)).delete(
            synchronize_session=False
        )


def erinnerung_vergessen(
    db: Session, *, user: User, entry_id: str, commit: bool = True
) -> AiMemoryEntry:
    """Die KI vergisst eine Erinnerung — zurueckholbar fuer `VERGESSEN_TAGE`.

    Ab sofort zaehlt sie nicht mehr, erscheint in keinem Kontext und keiner
    Suche mehr. Nur die Ansicht „Vergessen“ zeigt sie noch, mit der
    Moeglichkeit, sie zurueckzuholen oder endgueltig zu loeschen. Der Grund
    fuer die Frist: hier hat die KI einen Wunsch gedeutet, und eine Deutung
    kann danebenliegen.
    """
    row = _zeile(db, user, entry_id, aendern=True)
    if row.status != "vergessen":
        jetzt = datetime.now(timezone.utc)
        row.status = "vergessen"
        row.vergessen_am = jetzt
        row.updated_at = jetzt
        audit_service.record_privileged_action(
            db, user_id=user.id, action="ai.memory.forgotten", target_type="ai_memory",
            target_id=row.id, details=_protokolldetails(row), origin="ai",
        )
        _schluesse_entkraeften(db, [row.id], user_id=user.id)
        db.flush()
        _vergessene_begrenzen(db, row.scope_identity)
    if commit:
        db.commit()
    return row


def _schluesse_entkraeften(db: Session, beleg_ids: list[str], *, user_id: int) -> int:
    """Vergisst die geltenden Schlüsse, die sich auf einen dieser Belege stützen.

    Ein Schluss folgt aus seinen Belegen und aus nichts sonst
    (`ai_gedaechtnis_pflege`). Ändert sich der Text eines Belegs, wird er
    vergessen oder gelöscht, ist der Schluss nicht mehr gedeckt — auch wenn
    er zufällig weiter stimmen mag. Vergessen statt gelöscht: 30 Tage
    zurückholbar wie alles, was die KI vergisst, und die nächste Pflege darf
    ihn aus dem neuen Stand wieder ziehen. Committet nicht.
    """
    if not beleg_ids:
        return 0
    zeilen = (
        db.query(AiMemoryEntry)
        .join(AiMemoryBeleg, AiMemoryBeleg.schluss_id == AiMemoryEntry.id)
        .filter(AiMemoryBeleg.beleg_id.in_(beleg_ids), AiMemoryEntry.status == "aktiv")
        .all()
    )
    if not zeilen:
        return 0
    jetzt = datetime.now(timezone.utc)
    for row in zeilen:
        row.status = "vergessen"
        row.vergessen_am = jetzt
        row.updated_at = jetzt
        audit_service.record_privileged_action(
            db, user_id=user_id, action="ai.memory.forgotten", target_type="ai_memory",
            target_id=row.id, details=_protokolldetails(row, grund="beleg_entfallen"),
            origin="ai",
        )
    db.flush()
    for identity in {row.scope_identity for row in zeilen}:
        _vergessene_begrenzen(db, identity)
    return len(zeilen)


def schluss_anlegen(
    db: Session,
    *,
    user: User,
    belege: list[str],
    text: str,
    titel: str | None = None,
    thema: str | None = None,
    wichtigkeit: int = 2,
) -> tuple[AiMemoryEntry, str]:
    """Legt einen Schluss der Pflege an, gebunden an seine Belege. Committet nicht.

    Die Belege müssen gelten, dürfen selbst keine Schlüsse sein und müssen alle
    im selben Bereich liegen — dort landet auch der Schluss. Rechte und
    Kontingent wie bei jeder Erinnerung (`erinnerung_anlegen`).
    """
    eindeutig = list(dict.fromkeys(belege))
    if len(eindeutig) < 2:
        raise HTTPException(status_code=422, detail="Ein Schluss braucht mindestens zwei Belege.")
    zeilen = db.query(AiMemoryEntry).filter(AiMemoryEntry.id.in_(eindeutig)).all()
    if (
        len(zeilen) != len(eindeutig)
        or any(row.status != "aktiv" or row.art == SCHLUSS for row in zeilen)
        or len({row.scope_identity for row in zeilen}) != 1
    ):
        raise HTTPException(status_code=409, detail="Die Belege des Schlusses gelten nicht mehr.")
    erste = zeilen[0]
    row, sauber = erinnerung_anlegen(
        db, user=user, scope=erste.scope, server_id=erste.server_id, team_id=erste.team_id,
        text=text, titel=titel, thema=thema, art=SCHLUSS, wichtigkeit=wichtigkeit,
        quelle="pflege", origin="ai", commit=False,
    )
    if row.scope_identity != erste.scope_identity:
        raise HTTPException(status_code=409, detail="Ein Schluss bleibt im Bereich seiner Belege.")
    for beleg_id in eindeutig:
        db.add(AiMemoryBeleg(schluss_id=row.id, beleg_id=beleg_id))
    db.flush()
    return row, sauber


def belege_je_schluss(
    db: Session, rows: Iterable[AiMemoryEntry]
) -> dict[str, list[tuple[str, str]]]:
    """Je Schluss seine Belege als (Kennung, Text), für die Ansicht.

    Ein Sidecar-Aufruf für alle Belege einer Seite. Ein Beleg, der sich nicht
    öffnen lässt, fehlt; vergessene stehen mit da — im Reiter „Vergessen“
    zeigt ein Schluss so, woran er hing.
    """
    schluesse = [row.id for row in rows if row.art == SCHLUSS]
    if not schluesse:
        return {}
    paare = db.query(AiMemoryBeleg.schluss_id, AiMemoryBeleg.beleg_id).filter(
        AiMemoryBeleg.schluss_id.in_(schluesse)
    ).all()
    if not paare:
        return {}
    zeilen = db.query(AiMemoryEntry).filter(
        AiMemoryEntry.id.in_({beleg for _schluss, beleg in paare})
    ).all()
    texte = {row.id: text for row, text in _entschluesseln_lesbare(zeilen)}
    ergebnis: dict[str, list[tuple[str, str]]] = {}
    for schluss, beleg in sorted(paare):
        if beleg in texte:
            ergebnis.setdefault(schluss, []).append((beleg, texte[beleg]))
    return ergebnis


def erinnerung_zurueckholen(
    db: Session, *, user: User, entry_id: str
) -> tuple[AiMemoryEntry, str]:
    """Holt eine vergessene Erinnerung zurueck — wenn der Bereich sie noch fasst.

    Sie zaehlt danach wieder gegen das Rollenlimit. Ist der Bereich inzwischen
    voll, sagt `MemoryScopeVoll` das, statt die Grenze zu ueberschreiten.
    """
    row = _zeile(db, user, entry_id, aendern=True)
    if row.status != "aktiv":
        _platz_sicherstellen(
            db, user, row.scope, row.scope_identity, row.server_id, row.team_id
        )
        row.status = "aktiv"
        row.vergessen_am = None
        row.updated_at = datetime.now(timezone.utc)
        audit_service.record_privileged_action(
            db, user_id=user.id, action="ai.memory.restored", target_type="ai_memory",
            target_id=row.id, details=_protokolldetails(row), origin="direct",
        )
        db.commit()
        db.refresh(row)
    return row, DisClient.decrypt(row.value_encrypted, aad=_aad(row))


@dataclass(frozen=True)
class Fassung:
    """Eine fruehere Fassung im Klartext, wie die Oberflaeche sie zeigt."""

    id: str
    text: str
    titel: str | None
    grund: str
    von: str
    erstellt: datetime


def fassungen(db: Session, *, user: User, entry_id: str) -> list[Fassung]:
    """Die frueheren Fassungen einer Erinnerung, die juengste zuerst.

    Lesen darf sie, wer die Erinnerung sehen darf. Eine Fassung, die sich
    nicht oeffnen laesst, fehlt in der Liste.
    """
    row = _zeile(db, user, entry_id, aendern=False)
    zeilen = (
        db.query(AiMemoryVersion)
        .filter(AiMemoryVersion.memory_id == row.id)
        .order_by(AiMemoryVersion.created_at.desc(), AiMemoryVersion.id.desc())
        .limit(MAX_VERSIONEN)
        .all()
    )
    paare: list[tuple[str, str]] = []
    for zeile in zeilen:
        paare.append((zeile.text_encrypted, _versions_aad(zeile, "text")))
        if zeile.titel_encrypted:
            paare.append((zeile.titel_encrypted, _versions_aad(zeile, "titel")))
    klartexte = iter(_sammeln(paare))
    ergebnis: list[Fassung] = []
    for zeile in zeilen:
        text = next(klartexte)
        titel = next(klartexte) if zeile.titel_encrypted else None
        if text is None:
            continue
        ergebnis.append(Fassung(
            id=zeile.id, text=text, titel=titel, grund=zeile.grund, von=zeile.von,
            erstellt=_utc(zeile.created_at),
        ))
    return ergebnis


def fassung_zurueckholen(
    db: Session, *, user: User, entry_id: str, fassung_id: str,
    erwartete_fassung: int | None = None,
) -> tuple[AiMemoryEntry, str]:
    """Setzt eine Erinnerung auf eine fruehere Fassung zurueck.

    Der Stand davor wird selbst zu einer Fassung (``wiederhergestellt``): wer
    sich vergreift, kommt auf demselben Weg zurueck.
    """
    row = _zeile(db, user, entry_id, aendern=True)
    zeile = db.get(AiMemoryVersion, fassung_id)
    if zeile is None or zeile.memory_id != row.id:
        raise HTTPException(status_code=404, detail="Fassung nicht gefunden")
    text = DisClient.decrypt(zeile.text_encrypted, aad=_versions_aad(zeile, "text"))
    titel = (
        DisClient.decrypt(zeile.titel_encrypted, aad=_versions_aad(zeile, "titel"))
        if zeile.titel_encrypted
        else None
    )
    return erinnerung_aendern(
        db, user=user, entry_id=row.id, text=text, titel=titel,
        erwartete_fassung=erwartete_fassung, von="user", grund="wiederhergestellt",
    )


def erinnerung_aufnehmen(
    db: Session,
    *,
    user: User,
    ziel_id: str,
    quelle_id: str,
    ueberschreibt_mensch: bool = False,
    commit: bool = True,
) -> AiMemoryEntry:
    """Eine Erinnerung geht in einer anderen auf — die Haelfte einer Synthese.

    Die andere Haelfte, den neuen Text des Ziels, schreibt der Aufrufer vorher
    mit `erinnerung_aendern` (Grund ``zusammengefuehrt``). Hier wird der Text
    der aufgehenden Erinnerung zu einer frueheren Fassung **des Ziels**
    (Grund ``aufgenommen``) — im Verlauf des Ziels steht danach, woraus es
    entstanden ist —, und die aufgehende wird vergessen: 30 Tage
    zurueckholbar, wie alles, was die KI vergisst.

    Nur innerhalb eines Bereichs: eine persoenliche Notiz darf nicht im
    Teamwissen aufgehen, sonst laese sie das Team. Eine Erinnerung des
    Menschen geht nur mit ``ueberschreibt_mensch`` auf — derselbe Schutz wie
    beim Aendern ihres Textes.
    """
    ziel = _zeile(db, user, ziel_id, aendern=True)
    quelle = _zeile(db, user, quelle_id, aendern=True)
    if ziel.id == quelle.id or ziel.scope_identity != quelle.scope_identity:
        raise HTTPException(
            status_code=422,
            detail="Zusammengefuehrt wird nur innerhalb eines Bereichs.",
        )
    if ziel.status != "aktiv" or quelle.status != "aktiv":
        raise HTTPException(
            status_code=409,
            detail="Diese Erinnerung ist vergessen. Hol sie zuerst zurück.",
        )
    if quelle.origin == "user" and not ueberschreibt_mensch:
        raise HTTPException(
            status_code=409,
            detail="Diese Erinnerung stammt vom Benutzer und wird nicht still überschrieben.",
        )
    _schluessel_laden([quelle])
    text = DisClient.decrypt(quelle.value_encrypted, aad=_aad(quelle))
    _fassung_ablegen(
        db, ziel, text, quelle.titel or quelle.key, grund="aufgenommen", von="ai"
    )
    erinnerung_vergessen(db, user=user, entry_id=quelle.id, commit=False)
    if commit:
        db.commit()
    return ziel


def _name_als_titel(name: str) -> str | None:
    """Der alte Name als Titel: aus `backup.zeitpunkt` wird „Backup zeitpunkt“.

    Punkte und Unterstriche trennten im Namen Wörter, die ein Titel mit
    Leerzeichen trennt; mehr als den ersten Buchstaben fasst die Umstellung
    nicht an. Einen Titel daraus zu formulieren, ist Sache des Modells.
    """
    lesbar = " ".join(name.replace("_", " ").replace(".", " ").split())
    if not lesbar:
        return None
    try:
        return _titel_pruefen(lesbar[:1].upper() + lesbar[1:])
    except HTTPException:
        return None


def altbestand_umschreiben(
    db: Session,
    *,
    user: User,
    entry_id: str,
    text: str | None,
    titel: str | None = None,
    thema: object = UNVERAENDERT,
    art: object = UNVERAENDERT,
    wichtigkeit: int | None = None,
    erwartete_fassung: int | None = None,
) -> AiMemoryEntry:
    """Bringt eine Erinnerung mit Namen in die Form von Gedächtnis v2.

    Danach hat sie weder Namen noch Index und ist ein Satz wie jede neue
    (`ai_gedaechtnis_altbestand`). ``text`` ist der Satz, den das Modell aus
    Name und Wert gemacht hat; der Stand davor bleibt als Fassung (Grund
    ``umgeschrieben``), mit dem Namen als Titel — wer wissen will, was vorher
    dastand, findet es im Verlauf. Die Fassung entsteht auch, wenn der Text
    bleibt: sonst stünde der Name nirgends mehr. ``text=None`` stellt
    mechanisch um: der Wert bleibt der Text, der Name wird der Titel. Einen
    Titel, den die Erinnerung schon trägt, hat ein Mensch gesetzt; er bleibt.

    Die Herkunft bleibt, wie sie ist, und anders als in `erinnerung_aendern`
    gibt es keinen Schutz für die Aussage des Menschen: umgeschrieben wird
    ihre Form, nicht ihr Inhalt, und ihr Wortlaut steht daneben in der Fassung.
    Committet nicht.
    """
    row = _zeile(db, user, entry_id, aendern=True)
    if row.status != "aktiv":
        raise HTTPException(
            status_code=409,
            detail="Diese Erinnerung ist vergessen. Hol sie zuerst zurück.",
        )
    if erwartete_fassung is not None and int(row.fassung or 1) != erwartete_fassung:
        raise HTTPException(
            status_code=409,
            detail="Die Erinnerung wurde inzwischen geändert. Lade neu und versuch es noch einmal.",
        )
    if row.key_encrypted is None:
        return row
    _schluessel_laden([row])
    name = row.key
    alter_text = DisClient.decrypt(row.value_encrypted, aad=_aad(row))
    alter_titel = row.titel
    neuer_text = alter_text if text is None else _safe_value(text)
    neuer_titel = alter_titel or (_titel_pruefen(titel) if titel else None) or _name_als_titel(name)
    _fassung_ablegen(
        db, row, alter_text, name or alter_titel or None, grund="umgeschrieben", von="ai"
    )
    if neuer_text != alter_text:
        row.aad_version = 2
        row.value_encrypted = DisClient.encrypt(neuer_text, aad=_aad(row))
    if thema is not UNVERAENDERT:
        gefunden = thema_fuer(
            db, identity=row.scope_identity, owner_id=row.owner_user_id,
            server_id=row.server_id, team_id=row.team_id, name=thema,
        )
        row.thema_id = gefunden.id if gefunden is not None else None
    if art is not UNVERAENDERT:
        row.art = _art_pruefen(art)
    if wichtigkeit is not None:
        row.wichtigkeit = _wichtigkeit_pruefen(wichtigkeit)
        row.kopf_rang = kopf_rang(row, datetime.now(timezone.utc))
    row.key_encrypted = None
    row.key_index = None
    row.__dict__.pop("_key_klartext", None)
    row.titel = neuer_titel
    # Nach dem Titel: der Vektor entsteht aus Titel und Text, nicht mehr aus
    # dem Namen (`_einbettungstext`).
    refresh_embedding(db, row, neuer_text)
    row.fassung = int(row.fassung or 1) + 1
    row.updated_at = datetime.now(timezone.utc)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="ai.memory.updated", target_type="ai_memory",
        target_id=row.id,
        details=_protokolldetails(
            row, origin="ai", grund="umgeschrieben" if text is not None else "umgestellt",
        ),
        origin="ai",
    )
    db.flush()
    return row


def aehnlichkeit_zu_texten(
    db: Session, rows: list[AiMemoryEntry], texte: list[str]
) -> list[float | None]:
    """Je Zeile die hoechste Bedeutungsaehnlichkeit zu einem der Texte.

    Fuer den Gedaechtnisschreiber: er vergleicht den Bestand nicht mit einer
    Frage, sondern mit jeder Nachricht eines Gespraechsausschnitts einzeln.
    Ein Ausschnitt ueber drei Dinge, zu einem Vektor vermischt, traefe keines
    davon.

    ``None`` heisst: kein Vergleich moeglich (kein Modell,
    kein Vektor aus demselben Modell), nicht "unaehnlich". Gerechnet wird als
    eine Matrix, nicht je Text — bei einem unbegrenzten Vorrat sind das sonst
    hunderttausend Vektoren je Nachricht.
    """
    texte = [text for text in texte if text and text.strip()]
    if not rows or not texte:
        return [None] * len(rows)
    kodierung = ai_embedding_service.encode(texte, db=db)
    if kodierung is None or len(kodierung.vektoren) != len(texte):
        return [None] * len(rows)
    gespeichert = [_stored_vector(row, kodierung.modell) for row in rows]
    bekannt = [index for index, vektor in enumerate(gespeichert) if vektor is not None]
    if not bekannt:
        return [None] * len(rows)
    try:
        import numpy as np

        matrix = np.asarray([gespeichert[index] for index in bekannt], dtype="float32")
        fragen = np.asarray(kodierung.vektoren, dtype="float32")
        beste = (matrix @ fragen.T).max(axis=1).tolist()
    except Exception as exc:  # noqa: BLE001 - ohne Vergleich gilt die Ersatzordnung
        logger.warning("Aehnlichkeit zum Ausschnitt fehlgeschlagen error=%s", type(exc).__name__)
        return [None] * len(rows)
    ergebnis: list[float | None] = [None] * len(rows)
    for index, wert in zip(bekannt, beste):
        ergebnis[index] = float(wert)
    return ergebnis


def erinnerung_lesen(db: Session, *, user: User, entry_id: str) -> tuple[AiMemoryEntry, str]:
    """Eine Erinnerung, wie sie jetzt steht — fuer die Ansicht nach einem 409.

    Wer beim Speichern an einer neueren Fassung gescheitert ist, braucht genau
    diese eine Zeile, nicht die Seite: steht sie inzwischen auf einer anderen
    Seite (die Ordnung folgt dem letzten Gebrauch), fand die Ansicht sie dort
    nicht und hielt an der alten Fassung fest — jedes weitere Speichern bekam
    wieder 409. Eine Zeile, die sich nicht oeffnen laesst, heisst 404 wie auf
    der Seite, wo sie still fehlt.
    """
    row = _zeile(db, user, entry_id, aendern=False)
    geoeffnet = _entschluesseln_lesbare([row])
    if not geoeffnet:
        raise HTTPException(status_code=404, detail="Memory-Eintrag nicht gefunden")
    return geoeffnet[0]


#: Wieviele Zeilen ein Aufraeumlauf hoechstens loescht. Der Rest kommt im
#: naechsten Lauf dran; eine einzelne Anweisung ueber hunderttausend Zeilen
#: hielte Sperren, die der Chat danach zu spueren bekaeme.
_AUFRAEUMEN_JE_LAUF = 5_000


def vergessene_aufraeumen(db: Session, *, jetzt: datetime | None = None) -> int:
    """Loescht, was laenger als `VERGESSEN_TAGE` vergessen ist, und verwaiste Themen.

    Laeuft stuendlich im Hintergrund (`scheduler_service`). Ein Thema gilt als
    verwaist, wenn keine Erinnerung mehr darunter steht und es seit einer
    Stunde niemand angefasst hat: so faellt kein Thema weg, das ein Schreiber
    gerade erst angelegt hat und gleich benutzen will.
    """
    jetzt = jetzt or datetime.now(timezone.utc)
    frist = jetzt - timedelta(days=VERGESSEN_TAGE)
    abgelaufen = [
        kennung
        for (kennung,) in db.query(AiMemoryEntry.id)
        .filter(AiMemoryEntry.status == "vergessen", AiMemoryEntry.vergessen_am < frist)
        .limit(_AUFRAEUMEN_JE_LAUF)
        .all()
    ]
    # Gelöscht wird mit denselben Bedingungen, unter denen ausgewählt wurde.
    # Zwischen beiden Schritten kann jemand eine Erinnerung zurückholen oder
    # ein Thema wieder benutzen; beide halten dabei die Zeile gesperrt, und
    # PostgreSQL prüft die Bedingungen nach dem Warten an der neuen Fassung
    # der Zeile. Mit der Kennung allein fiele die zurückgeholte Erinnerung
    # trotzdem weg.
    geloescht = 0
    if abgelaufen:
        geloescht = db.query(AiMemoryEntry).filter(
            AiMemoryEntry.id.in_(abgelaufen),
            AiMemoryEntry.status == "vergessen",
            AiMemoryEntry.vergessen_am < frist,
        ).delete(synchronize_session=False)
    ruhig_seit = jetzt - timedelta(hours=1)
    benutzt = select(AiMemoryEntry.thema_id).where(AiMemoryEntry.thema_id.is_not(None))
    verwaist = [
        kennung
        for (kennung,) in db.query(AiMemoryTopic.id)
        .filter(AiMemoryTopic.updated_at < ruhig_seit, AiMemoryTopic.id.not_in(benutzt))
        .limit(_AUFRAEUMEN_JE_LAUF)
        .all()
    ]
    if verwaist:
        db.query(AiMemoryTopic).filter(
            AiMemoryTopic.id.in_(verwaist),
            AiMemoryTopic.updated_at < ruhig_seit,
            AiMemoryTopic.id.not_in(benutzt),
        ).delete(synchronize_session=False)
    db.commit()
    return geloescht


@dataclass(frozen=True)
class Importziel:
    """Wohin ein Import schreibt: der Bereich, geprüft wie beim Schreiben.

    ``grenze`` ist das Kontingent der Rolle für diesen Bereich — ``None``
    unbegrenzt, 0 gesperrt —, ``frei`` wieviele neue Erinnerungen er noch
    fasst (``None`` unbegrenzt). Gezählt wird wie in `_platz_sicherstellen`:
    nur, was gilt.
    """

    identity: str
    server_id: int | None
    team_id: int | None
    grenze: int | None
    frei: int | None


def importziel(
    db: Session, user: User, scope: str, server_id: int | None, team_id: int | None
) -> Importziel:
    """Prüft den Zielbereich eines Imports, bevor etwas gelesen wird.

    Dieselben Rechte wie beim Schreiben: wer in diesen Bereich nicht schreiben
    darf, bekommt die Absage vor dem Modellaufruf der Vorschau — nicht erst,
    nachdem der Text beim Anbieter war und der Benutzer ausgesucht hat.
    """
    identity, _owner, sid, tid = scope_identity(db, user, scope, server_id, team_id)
    _assert_may_write(db, user, scope, tid, sid)
    grenze = ai_limit_service.resolve_scope_memory_limit(
        db, scope, user, team_id=tid, server_id=sid,
    )
    bestand = (
        db.query(AiMemoryEntry.id)
        .filter(AiMemoryEntry.scope_identity == identity, AiMemoryEntry.status == "aktiv")
        .count()
    )
    return Importziel(
        identity=identity, server_id=sid, team_id=tid, grenze=grenze,
        frei=None if grenze is None else max(0, grenze - int(bestand)),
    )


def aehnlichkeit_je_text(
    db: Session, rows: list[AiMemoryEntry], texte: list[str]
) -> list[float | None]:
    """Je Text die höchste Bedeutungsähnlichkeit zu einer der Zeilen.

    Die Umkehrung von `aehnlichkeit_zu_texten`, für den Import: dort wird
    nicht gefragt, welcher Bestand zu einem Gespräch passt, sondern ob ein
    vorgeschlagener Satz schon dasteht. Alle Sätze in einem Aufruf des
    Modells — bei einem Ersatzanbieter für die Einbettung wäre einer je Satz
    ein HTTP-Aufruf je Satz. ``None`` heißt: kein Vergleich möglich.
    """
    if not rows or not texte:
        return [None] * len(texte)
    kodierung = ai_embedding_service.encode(texte, db=db)
    if kodierung is None or len(kodierung.vektoren) != len(texte):
        return [None] * len(texte)
    gespeichert = [_stored_vector(row, kodierung.modell) for row in rows]
    vorhanden = [vektor for vektor in gespeichert if vektor is not None]
    if not vorhanden:
        return [None] * len(texte)
    try:
        import numpy as np

        matrix = np.asarray(vorhanden, dtype="float32")
        fragen = np.asarray(kodierung.vektoren, dtype="float32")
        return [float(wert) for wert in (fragen @ matrix.T).max(axis=1).tolist()]
    except Exception as exc:  # noqa: BLE001 - ohne Vergleich bleibt der Satz in der Vorschau
        logger.warning("Aehnlichkeit der Importsaetze fehlgeschlagen error=%s", type(exc).__name__)
        return [None] * len(texte)


def _darf_aendern(db: Session, user: User, row: AiMemoryEntry) -> bool:
    """Darf dieser Benutzer diese eine Erinnerung aendern, vergessen oder loeschen?

    Dieselben Rechte wie beim Schreiben in ihren Bereich (`_assert_may_write`),
    nur fuer eine Zeile, die schon da ist.
    """
    if row.scope == "panel":
        return permission_service.has_global_permission(db, user, "panel.settings.write")
    if row.scope == "team":
        from services import team_service

        return row.team_id is not None and team_service.can_manage_team_memory(
            db, user, row.team_id
        )
    if row.scope == "server_shared":
        # Ein eigener Zweig und nicht der `else` darunter. Dort steht
        # `row.owner_user_id == user.id`, und Anlagenwissen hat bewusst keinen
        # Besitzer: der Vergleich waere gegen NULL immer False, der Eintrag
        # damit fuer **niemanden** loeschbar — auch nicht fuer den Betreiber.
        #
        # Und auch die Begruendung des `else` traegt hier nicht: sie gilt dem
        # eigenen Eintrag, den man behalten koennen soll, wenn der Serverzugang
        # wegfaellt. Fremdes Wissen zu loeschen, das man nicht mehr sehen darf,
        # ist das Gegenteil davon.
        return row.server_id is not None and permission_service.has_server_permission(
            db=db, user=user, server_id=row.server_id, key="server.config.write"
        )
    # Der eigene Eintrag, ohne zusaetzliche Serverbedingung. Vorher verlangte
    # eine serverbezogene Notiz weiterhin `server.view` — wer den Zugriff auf
    # einen Server verlor, konnte seine eigene Notiz dazu nicht mehr
    # loeschen. Sie blieb in der Datenbank, zaehlte gegen sein Kontingent
    # und war fuer ihn unerreichbar. Was gelesen wird, entscheidet weiterhin
    # `ai_gedaechtnis_abruf.sichtbare_bereiche` mit `server.view`; das ist eine andere Frage.
    return row.owner_user_id == user.id


def _darf_lesen(db: Session, user: User, row: AiMemoryEntry) -> bool:
    """Darf dieser Benutzer diese eine Erinnerung sehen (etwa ihren Verlauf)?

    Dieselbe Antwort wie die Bereichsansichten: das Panelwissen sieht jeder,
    der das Gedaechtnis benutzen darf (die Route prueft das), Teamwissen jedes
    Mitglied, Anlagenwissen wer den Server sehen darf, alles Persoenliche nur
    sein Besitzer.
    """
    if row.scope == "panel":
        return True
    if row.scope == "team":
        from services import team_service

        return row.team_id is not None and team_service.membership(
            db, row.team_id, user.id
        ) is not None
    if row.scope == "server_shared":
        return row.server_id is not None and permission_service.has_server_permission(
            db=db, user=user, server_id=row.server_id, key="server.view"
        )
    return row.owner_user_id == user.id


def _zeile(db: Session, user: User, entry_id: str, *, aendern: bool) -> AiMemoryEntry:
    """Laedt eine Erinnerung, die dieser Benutzer sehen bzw. aendern darf.

    Gibt es sie nicht oder darf er nicht, heisst die Antwort in beiden Faellen
    404: ob es eine fremde Erinnerung mit dieser Kennung gibt, geht ihn nichts
    an.
    """
    try:
        canonical = str(UUID(entry_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Memory-Eintrag nicht gefunden") from exc
    if aendern:
        # Gesperrt und frisch gelesen. Ohne Sperre lasen zwei gleichzeitige
        # Änderungen dieselbe `fassung`, bestanden beide die Prüfung, und die
        # zweite schrieb über die erste hinweg — deren Text stand danach weder
        # in der Erinnerung noch in ihren Fassungen. `populate_existing`, weil
        # `db.get` eine Zeile aus der Sitzung zurückgäbe, ohne die Datenbank
        # zu fragen.
        row = (
            db.query(AiMemoryEntry)
            .filter(AiMemoryEntry.id == canonical)
            .with_for_update()
            .populate_existing()
            .one_or_none()
        )
    else:
        row = db.get(AiMemoryEntry, canonical)
    erlaubt = row is not None and (
        _darf_aendern(db, user, row) if aendern else _darf_lesen(db, user, row)
    )
    if not erlaubt:
        raise HTTPException(status_code=404, detail="Memory-Eintrag nicht gefunden")
    return row


def _protokolldetails(row: AiMemoryEntry, **weitere) -> dict:
    return {
        "scope": row.scope,
        **({"server_id": row.server_id} if row.server_id else {}),
        **({"team_id": row.team_id} if row.team_id else {}),
        **weitere,
    }


def delete_entry(db: Session, user: User, entry_id: str) -> None:
    """Loescht eine Erinnerung endgueltig, mit allen frueheren Fassungen.

    Das ist der Weg des Menschen in der Oberflaeche und deshalb sofort. Was die
    KI auf Wunsch vergisst, geht dagegen ueber `erinnerung_vergessen` und
    laesst sich 30 Tage zurueckholen.
    """
    row = _zeile(db, user, entry_id, aendern=True)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="ai.memory.deleted", target_type="ai_memory",
        target_id=row.id,
        details=_protokolldetails(row),
        origin="direct",
    )
    _schluesse_entkraeften(db, [row.id], user_id=user.id)
    db.delete(row)
    db.commit()


def delete_all_entries(
    db: Session, user: User, scope: str, server_id: int | None = None,
    team_id: int | None = None,
) -> int:
    """Leert einen ganzen Bereich. Gibt die Zahl der geloeschten Eintraege zurueck.

    Ohne das musste man ein gewachsenes Gedaechtnis Zeile fuer Zeile abraeumen —
    bei dreissig abgeleiteten Eintraegen dreissig Bestaetigungen. Wer sein
    Gedaechtnis loeschen will, will es ganz loeschen.

    Die Berechtigung entsteht **nicht** neu, sondern aus denselben zwei Quellen
    wie beim einzelnen Loeschen: `scope_identity` entscheidet, welche Zeilen
    ueberhaupt sichtbar sind (bei `user` nur die eigenen, bei `team` nur die des
    Teams, in dem man Mitglied ist), und `_assert_may_write` entscheidet, ob man
    einen geteilten Bereich veraendern darf. Persoenliche Eintraege verlassen
    den Benutzer nie und brauchen keine zweite Pruefung.

    Ein Audit-Eintrag mit der Anzahl statt einem je Zeile: dreissig gleichartige
    Zeilen im Protokoll verdecken die Handlung, statt sie zu belegen.
    """
    # Die **normalisierten** Werte weitergeben und nicht die rohen. Vorher stand
    # hier `team_id` direkt aus der Anfrage; bei einem Bereich, dessen Kennung
    # aus etwas anderem entsteht, laeuft die Rechtepruefung damit gegen einen
    # anderen Gegenstand als das Loeschen darunter.
    identity, _, normalized_server_id, normalized_team_id = scope_identity(
        db, user, scope, server_id, team_id
    )
    _assert_may_write(db, user, scope, normalized_team_id, normalized_server_id)
    rows = db.query(AiMemoryEntry).filter(
        AiMemoryEntry.scope_identity == identity
    ).all()
    if not rows:
        return 0
    for row in rows:
        db.delete(row)
    audit_service.record_privileged_action(
        db, user_id=user.id, action="ai.memory.cleared", target_type="ai_memory",
        target_id=None,
        details={
            "scope": scope, "count": len(rows),
            **({"server_id": normalized_server_id} if normalized_server_id else {}),
            **({"team_id": normalized_team_id} if normalized_team_id else {}),
        },
        origin="direct",
    )
    db.commit()
    return len(rows)




















#: Die vier Gewichte von `_bewertung`: Bedeutung, Bezug zur Frage, Nutzung,
#: Aktualitaet.
#:
#: Gemessen am 19.08.2026 an 5.000 Eintraegen und zehn Fragen mit bekannter
#: Antwort (local-plans/mess-gedaechtnis.py): die Nutzung darf nur ein
#: Ausschlag bei Gleichstand sein. Als rohe Zahl 0 bis 20 mit Gewicht 0,5
#: bildete sie die Schwelle des letzten Platzes allein, und gesuchte
#: Antworten fielen heraus, obwohl die Bedeutung sie auf Platz 1 gesetzt
#: hatte. Seit sie normiert wird (Begruendung in `_bewertung`), wiegt jeder
#: Anteil hoechstens sein Gewicht. Seit Stufe 4 ordnet die Formel nur noch,
#: was die Frage ohnehin getroffen hat (`ai_gedaechtnis_abruf._treffer`).




#: Länge der Nonce vor dem verschlüsselten Vektor — die Größe, für die AES-GCM
#: ausgelegt ist.












def server_shared_context(
    db: Session, user: User, server_id: int, query: str = ""
) -> str | None:
    """Nur das Wissen **einer** Anlage, als fertiger Block (`ai_gedaechtnis_abruf.anlagenwissen`)."""
    from services import ai_gedaechtnis_abruf

    return ai_gedaechtnis_abruf.anlagenwissen(db, user, server_id, query)


def provider_memory_context(
    db: Session,
    user: User,
    query: str = "",
    server_id: int | None = None,
    budget: int | None = None,
) -> str | None:
    """Beide Teile des Abrufs in einem Block — was im Kopf steht, dann was zur Frage passt.

    Der Chat setzt die beiden getrennt (`ai_context_service`): den Kopf vor den
    Verlauf, wo er zwischengespeichert wird, das Passende in den Nachspann.
    Wer nur einen Block braucht, nimmt diesen. Die Auswahl steht in
    `ai_gedaechtnis_abruf.abrufen`.
    """
    from services import ai_gedaechtnis_abruf

    abruf = ai_gedaechtnis_abruf.abrufen(db, user, query, server_id, budget)
    teile = [teil for teil in (abruf.kopf, abruf.passend) if teil]
    return "\n".join(teile) or None


# Wie viele Treffer eine Suche hoechstens meldet. Bewusst knapp: die Liste
# landet im Chat und der Benutzer soll sie ueberblicken koennen.
MAX_SEARCH_RESULTS = 15


def search_entries(
    db: Session,
    user: User,
    query: str,
    limit: int = MAX_SEARCH_RESULTS,
    *,
    nur_team_id: int | None = None,
) -> list[tuple[AiMemoryEntry, str, float]]:
    """Findet Eintraege nach Bedeutung und Woertern (`ai_gedaechtnis_abruf.suchen`).

    Gesucht wird ausschliesslich in dem, was der Benutzer ohnehin sehen darf,
    **einschliesslich der Einwilligung**. Der Rueckgabewert enthaelt den
    Klartext; die gemeldeten Treffer gelten als benutzt.

    ``nur_team_id`` beschraenkt die Suche auf das Gedaechtnis eines Teams.
    Der Dokument-Lauf nutzt das, damit ein praeparierter Dokumenttext keine
    persoenlichen oder serverbezogenen Erinnerungen abfragen kann.
    """
    from services import ai_gedaechtnis_abruf

    return [
        (treffer.row, treffer.text, treffer.rang)
        for treffer in ai_gedaechtnis_abruf.suchen(
            db, user, query, limit, nur_team_id=nur_team_id
        )
    ]
