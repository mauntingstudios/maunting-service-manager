"""Haltbarkeit, Rang und Reiz des KI-Gedaechtnisses.

Herausgezogen aus `ai_memory_service`: Wortzerlegung, Haltbarkeit, Praesenz,
Kopf-Rang und die Bewertung fuer Suche und Kontext. Der Dienst re-exportiert
alle Namen.
"""

from __future__ import annotations

import math
import re
from datetime import datetime

from models import AiMemoryEntry
from services.ai_memory_krypto import _utc

RECENCY_HALFLIFE_DAYS = 7.0


HALTBARKEIT_START = {1: 7.0, 2: 14.0, 3: 30.0, 4: 90.0, 5: 365.0}


MAX_HALTBARKEIT_TAGE = 3_650.0


_WORD_RE = re.compile(r"[\w]+", re.UNICODE)


_FUELLWOERTER = frozenset("""
aber alle allem allen aller alles als also auch auf aus bei beim bin bis bist
dabei damit dann dass daß dein deine deinem deinen deiner dem den denn der des
dessen dich die dies diese diesem diesen dieser dieses dir doch dort durch ein
eine einem einen einer eines euch euer eure fuer für gegen gibt habe haben hast
hat hatte hatten hier ihm ihn ihr ihre ihrem ihren ihrer ist jede jedem jeden
jeder jedes jetzt kann kannst kein keine keinem keinen keiner koennen können
mal man mehr mein meine meinem meinen meiner mich mir mit muss nach nicht noch
nur oder ohne schon sehr sein seine seinem seinen seiner seit sich sie sind
soll sollen ueber über uns unser unsere unter viel vom von vor war waren was
weil weiss weißt weisst welche welchem welchen welcher welches wem wen wenn wer
werden wie wieder will wir wird wo wurde wurden zum zur zwischen
benutzer benutzerin benutzers nutzer nutzerin person singra
about after all also and any are been but can could did does doing for from
had has have her here hers him his how into its just more most not now our
out over she should some such than that the their them then there these they
this those under very was were what when where which who whom why will with
would you your yours user users
""".split())


def _tokens(text: str) -> set[str]:
    """Zerlegt Text in vergleichbare Wortstaemme.

    Bewusst simpel: Kleinschreibung, alles Nicht-Alphanumerische trennt, kurze
    Fuellwoerter fliegen raus. Das ist **keine** semantische Aehnlichkeit — es
    ist ein Wortabgleich und funktioniert nur innerhalb derselben Sprache.
    Genau deshalb ist er unten nur ein Kriterium von dreien und entscheidet nie
    allein. Fuellwoerter (`_FUELLWOERTER`) zaehlen nicht.
    """
    return {
        word for word in _WORD_RE.findall(text.lower())
        if len(word) > 2 and word not in _FUELLWOERTER
    }


def _wortquelle(row: AiMemoryEntry, text: str = "") -> str:
    """Wogegen der Wortabgleich eine Zeile prueft: Name, Titel und Text.

    Dieselbe Quelle fuer den Wortindex (`_begriffe_setzen`): was hier
    zaehlt, findet auch die Suche in der Datenbank.
    """
    return " ".join(teil for teil in (row.key, row.titel, text) if teil)


def _reiz(similarity: float | None, overlap: int) -> float:
    """Wie stark die aktuelle Frage einen Eintrag trifft — zwischen 0.0 und 1.0.

    Steht als eigene Funktion da, weil an demselben Wert zwei Dinge hängen und
    sie dieselbe Zahl sein müssen: ob ein Eintrag „passend zur Frage“ mitkommt
    (`ai_gedaechtnis_abruf`) und ob er als **gebraucht** vermerkt wird. Zwei
    getrennt gepflegte Fassungen hießen, dass ein Eintrag gezeigt wird, ohne
    als benutzt zu gelten — oder umgekehrt.
    """
    # `similarity` liegt in [-1, 1]; negativ heißt "hat nichts miteinander zu
    # tun" und darf nicht als Beitrag zählen.
    reiz = max(0.0, similarity) if similarity is not None else 0.0
    if overlap:
        # Wortüberlappung ist ein gröberes, aber sehr sicheres Signal — im
        # Gameserver-Umfeld stehen Lehnwörter (Backup, RAM, Ports) wörtlich
        # in deutschen Einträgen. Ein Treffer hebt auf mindestens die Hälfte,
        # zwei auf volle Präsenz.
        reiz = max(reiz, min(1.0, 0.5 + 0.25 * overlap))
    return reiz


def haltbarkeit(row: AiMemoryEntry) -> float:
    """Die Haltbarkeit in Tagen; ohne Gebrauch der Startwert der Wichtigkeit."""
    if row.haltbarkeit_tage:
        return float(row.haltbarkeit_tage)
    return HALTBARKEIT_START.get(int(row.wichtigkeit or 3), HALTBARKEIT_START[3])


def _tage_seit_gebrauch(row: AiMemoryEntry, jetzt: datetime) -> float:
    zuletzt = row.last_used_at or row.created_at or jetzt
    return max(0.0, (jetzt - _utc(zuletzt)).total_seconds() / 86_400)


def praesenz(row: AiMemoryEntry, jetzt: datetime) -> float:
    """Wie präsent eine Erinnerung ist — 1,0 frisch gebraucht, gegen 0 vergessen."""
    return math.exp(-_tage_seit_gebrauch(row, jetzt) / haltbarkeit(row))


def kopf_rang(row: AiMemoryEntry, jetzt: datetime) -> float:
    """Wichtigkeit × Präsenz: danach ordnet sich, was „im Kopf“ steht.

    Dieselbe Rechnung macht die Pflege für alle Zeilen auf einmal in SQL
    (`ai_gedaechtnis_pflege.rang_auffrischen`).
    """
    return int(row.wichtigkeit or 3) * praesenz(row, jetzt)


def haltbarkeit_nach_gebrauch(row: AiMemoryEntry, jetzt: datetime) -> float:
    """Die Haltbarkeit nach einem Gebrauch jetzt — mit Abstandseffekt.

    Wer etwas kurz hintereinander zweimal braucht, festigt es wenig (×1,2);
    wer es nach einer langen Pause wieder braucht, viel (bis ×2,2). Gemessen
    wird die Pause an der bisherigen Haltbarkeit: eine Woche ist für eine
    Nebensache lang, für eine Allergie kurz.
    """
    bisher = haltbarkeit(row)
    pause = min(1.0, _tage_seit_gebrauch(row, jetzt) / bisher)
    return min(MAX_HALTBARKEIT_TAGE, bisher * (1.2 + pause))


def _relevance(
    row: AiMemoryEntry,
    value: str,
    query_tokens: set[str],
    now: datetime,
    similarity: float | None = None,
) -> float:
    """Bewertet einen Eintrag fuer die aktuelle Frage.

    Vier Anteile, die absichtlich verschiedene Dinge messen:

    - **Bedeutung** (Vektoraehnlichkeit). Das einzige Kriterium, das ueber
      Sprachgrenzen traegt: "quel jeu je prefere" findet "lieblingsspiel", wo
      Wortabgleich null liefert.
    - **Bezug zur Frage** (Wortueberlappung). Bleibt trotzdem drin, weil im
      Gameserver-Umfeld die halbe Fachsprache aus Lehnwoertern besteht: Backup,
      RAM, Mods, Ports stehen woertlich in deutschen Eintraegen. Gemessen
      erkennt der Wortabgleich diese Faelle sicherer als das statische
      Embedding — die beiden Signale ergaenzen sich.
    - **Nutzung.** Was oft abgerufen wurde, ist erfahrungsgemaess wichtig —
      aber nur als Ausschlag bei Gleichstand. Sie wiegt höchstens ihr Gewicht,
      genau wie die anderen Anteile; warum das ausdrücklich dasteht, erklärt
      `_bewertung`.
    - **Aktualitaet.** Frisch Gemerktes gewinnt gegen Altes, das nie gebraucht
      wurde — sonst kaeme ein neuer Eintrag nie zum Zug, weil ihm die
      Nutzungshistorie fehlt.

    ``similarity`` ist ``None``, wenn kein Modell geladen ist oder der Eintrag
    noch keinen Vektor hat. Dann entscheiden die drei uebrigen Kriterien; der
    Eintrag faellt nicht heraus.
    """
    return _bewertung(row, _wortquelle(row, value), query_tokens, now, similarity)


GEWICHTE_AUSWAHL = (6.0, 3.0, 0.5, 2.0)


def _bewertung(
    row: AiMemoryEntry,
    text: str,
    query_tokens: set[str],
    now: datetime,
    similarity: float | None = None,
) -> float:
    """Die Formel hinter `_relevance` — mit dem Vergleichstext als Parameter."""
    w_bedeutung, w_bezug, w_nutzung, w_aktualitaet = GEWICHTE_AUSWAHL
    overlap = len(query_tokens & _tokens(text))
    reference = row.last_used_at or row.updated_at or row.created_at
    age_days = max(0.0, (now - _utc(reference)).total_seconds() / 86_400)
    recency = 1.0 / (1.0 + age_days / RECENCY_HALFLIFE_DAYS)
    # Negative Aehnlichkeit heisst "hat nichts miteinander zu tun" und darf
    # einen Eintrag nicht unter einen ohne Vektor druecken.
    meaning = max(0.0, similarity) if similarity is not None else 0.0
    # **Die Nutzung wird normiert, und das ist der Punkt.**
    # Bedeutung und Aktualität liegen zwischen 0 und 1; das Gewicht daneben sagt
    # also, wieviel dieser Anteil höchstens wiegen darf. Die Nutzung stand hier
    # als rohe Zahl von 0 bis 20 — mit demselben Gewicht 0,5 waren das bis zu
    # 10,0 Punkte gegen höchstens 6,0 aus der Bedeutung, und die Zahl hatte mit
    # der Frage nichts zu tun. Gemessen am 19.08.2026 an 5.000 Einträgen: von
    # den 65 Zeilen, die ins Budget passten, standen 65 überwiegend wegen ihrer
    # Nutzung dort, und zwei der zehn gesuchten Antworten fielen deshalb heraus,
    # obwohl die Vorauswahl sie auf Platz 1 gesetzt hatte.
    #
    # Nicht das Gewicht ist gefallen, sondern der Maßstab: durch 20 geteilt
    # wiegt die Nutzung wie jeder andere Anteil höchstens ihr Gewicht. Sie
    # bleibt damit, was sie sein sollte — ein Ausschlag bei Gleichstand, der
    # auch dann noch trägt, wenn jemand auf Englisch nach deutschen Notizen
    # fragt und weder Wortabgleich noch Vektor etwas hergeben.
    familiarity = min(row.use_count or 0, 20) / 20.0
    return (
        meaning * w_bedeutung
        + overlap * w_bezug
        + familiarity * w_nutzung
        + recency * w_aktualitaet
    )


