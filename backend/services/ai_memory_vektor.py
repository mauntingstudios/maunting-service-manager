"""Vektoren und Begriffe des KI-Gedaechtnisses.

Herausgezogen aus `ai_memory_service`: gepackte Embeddings, der Begriff-Index
und das Nachziehen der Vektoren. Der Dienst re-exportiert alle Namen; die
Textzerlegung fuer Begriffe wird beim Aufruf geholt.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from collections.abc import Iterable, Sequence
from datetime import datetime, timezone
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.orm import Session

from config import settings
from models import AiMemoryBegriff, AiMemoryEntry
from services import ai_embedding_service
from services.ai_embedding_service import EMBEDDING_BYTES

logger = logging.getLogger(__name__)

_VEKTOR_NONCE = 12

#: Wie lang eine verpackte Vektorspalte des heutigen Modells ist: Nonce, Vektor
#: und das 16 Byte lange Siegel. Jede andere Länge ist offen — unverpackt
#: (`_liegt_im_klartext`) oder aus einem Modell mit anderer Ausgabegröße —, und
#: der Takt rechnet sie neu (`ai_gedaechtnis_abruf.nachziehen`).
GEPACKT_BYTES = _VEKTOR_NONCE + EMBEDDING_BYTES + 16


@lru_cache(maxsize=1)
def _vektorschluessel() -> AESGCM:
    """Der Schlüssel, unter dem die Vektorspalte liegt.

    Abgeleitet aus dem Panel-Secret und **nicht** über den DIS-Sidecar geholt.
    Das ist der einzige Grund, warum diese Verschlüsselung überhaupt tragbar
    ist: der Sidecar kostet je Zeile einen HTTP-Roundtrip, und die Rangfolge
    liest bis zu 5.000 Vektoren je Anfrage. Im Prozess gemessen sind es für
    dieselben 5.000 Zeilen 10 bis 17 ms.

    Was das schützt und was nicht, steht am Modellfeld (`models/ai_memory.py`):
    gegen bloßen Datenbankzugriff ja, gegen jemanden mit der Panel-Umgebung
    nein. Der Wert daneben bleibt stärker geschützt, weil sein Schlüssel im
    Sidecar liegt und nicht hier.

    Einmal abgeleitet und gehalten: `settings.secret_key` ändert sich innerhalb
    eines Prozesses nicht, und die Ableitung je Zeile kostete bei 5.000 Zeilen
    mehr als das Entschlüsseln selbst.
    """
    return AESGCM(
        hashlib.sha256(f"msm:ai:memory:vektor:{settings.secret_key}".encode()).digest()
    )


def _vektor_verschluesseln(roh: bytes) -> bytes:
    """Packt die float32-Bytes in die Form, in der sie in der Spalte stehen."""
    nonce = os.urandom(_VEKTOR_NONCE)
    return nonce + _vektorschluessel().encrypt(nonce, roh, None)


def _vektor_entschluesseln(gespeichert: bytes | None) -> bytes | None:
    """Öffnet die Vektorspalte, oder ``None``, wenn das nicht geht.

    ``None`` heißt hier "nicht unter diesem Schlüssel verpackt" und nicht
    "kaputt": eine Bestandszeile mit rohen Zahlen fällt genauso hierher wie
    eine, die unter einem gewechselten Panel-Secret entstanden ist. Was daraus
    folgt, entscheidet `_stored_vector` — nicht diese Funktion.
    """
    if not gespeichert or len(gespeichert) <= _VEKTOR_NONCE:
        return None
    try:
        return _vektorschluessel().decrypt(
            gespeichert[:_VEKTOR_NONCE], gespeichert[_VEKTOR_NONCE:], None
        )
    except InvalidTag:
        return None


def _liegt_im_klartext(row: AiMemoryEntry) -> bool:
    """Trägt diese Zeile ihren Vektor noch unverschlüsselt?

    Eine Form aus dem Bestand: die Bytespalte vor dem 23.08.2026, dann genau
    `EMBEDDING_BYTES` lang, ohne Nonce und ohne Siegel, und damit sauber von
    einer verpackten zu unterscheiden. (Die alte Textspalte `embedding_json`
    ist am 26.09.2026 weggefallen; Migration `20260926_08` hat ihren Rest in
    genau diese Form umgepackt.)

    Sie wird weiter **gelesen**. Sie einfach für ungültig zu erklären wäre
    der bequemere Weg gewesen und hätte das Gedächtnis schlechter gemacht, als
    es war: bis zum Neurechnen fände die Bedeutung die Zeile nicht. Stattdessen
    zählt sie hier als **offen**: gelesen wie bisher, aber im nächsten Takt
    (`ai_gedaechtnis_abruf.nachziehen`) neu geschrieben, und dabei verpackt.
    """
    return (
        row.embedding_bytes is not None
        and len(row.embedding_bytes) == EMBEDDING_BYTES
    )


def _stored_vector(row: AiMemoryEntry, modell: str) -> Sequence[float] | None:
    """Liest den gespeicherten Vektor, wenn er aus dem Modell ``modell`` stammt.

    ``modell`` ist die Kennung der Frage, gegen die verglichen wird
    (`ai_embedding_service.Kodierung`), und keine Konstante: `encode` rechnet
    lokal oder im Google-Rückfall, und ein Vektor aus dem jeweils anderen Raum
    hat dieselbe Länge, aber keine vergleichbare Bedeutung.

    Geschrieben wird seit dem 19.08.2026 als float32-Bytes, seit dem
    23.08.2026 unter AES-GCM. Das Lesen kostet 4 ms bei 5.000 Einträgen, plus
    10 bis 17 ms fürs Entschlüsseln.

    Lässt sich die Bytespalte nicht öffnen, wird sie **roh** gelesen: dann ist
    es eine Bestandszeile mit unverpackten Zahlen, und `bytes_zu_vektor` erkennt
    an der Länge, ob sie das wirklich ist. Warum sie weiter gelesen wird und
    nicht einfach als fehlend gilt, steht an `_liegt_im_klartext`.
    """
    return vektor_lesen(row.embedding_bytes, row.embedding_model, modell)


def vektor_lesen(
    gespeichert: bytes | None, gespeichert_mit: str | None, modell: str
) -> Sequence[float] | None:
    """`_stored_vector` ohne Zeile — für den Vektorspeicher des Abrufs, der
    nur die beiden Spalten lädt (`ai_gedaechtnis_abruf`)."""
    if gespeichert_mit != modell:
        return None
    geoeffnet = _vektor_entschluesseln(gespeichert)
    return ai_embedding_service.bytes_zu_vektor(gespeichert if geoeffnet is None else geoeffnet)


@lru_cache(maxsize=1)
def _begriff_schluessel() -> bytes:
    """Der Schlüssel des Wortindex (`models.ai_memory.AiMemoryBegriff`).

    Abgeleitet aus dem Panel-Secret wie der des Vektors (`_vektorschluessel`)
    und aus demselben Grund nicht über den Sidecar: die Frage einer
    Chatnachricht wird je sichtbarem Bereich zu Prüfwerten, und das soll
    nichts kosten. Eigene Domäne, damit ein Prüfwert nie mit einem Vektor-
    oder Sidecar-Schlüssel zusammenhängt.
    """
    return hashlib.sha256(f"msm:ai:memory:begriff:{settings.secret_key}".encode()).digest()


def begriff_werte(identity: str, woerter: Iterable[str]) -> list[int]:
    """Die Prüfwerte der Wörter in einem Bereich — sortiert, ohne Doppel.

    HMAC über Bereich und Wort, die ersten acht Byte als vorzeichenbehaftete
    Zahl (`BigInteger`). Zwei Wörter, die sich zufällig treffen, kosten einen
    Kandidaten mehr, nicht mehr: was mitkommt, entscheidet danach der Klartext.
    """
    schluessel = _begriff_schluessel()
    return sorted({
        int.from_bytes(
            hmac.new(schluessel, f"{identity}\n{wort}".encode(), hashlib.sha256).digest()[:8],
            "big", signed=True,
        )
        for wort in woerter
    })


#: Wieviele Wörter einer Erinnerung höchstens in den Wortindex gehen. Ein Text
#: fasst 2.000 Zeichen; mehr verschiedene Wörter hat er praktisch nie.
MAX_BEGRIFFE = 200


def _begriffe_setzen(row: AiMemoryEntry, text: str) -> None:
    from services.ai_memory_ranking import _tokens, _wortquelle

    """Ersetzt den Wortindex einer Zeile durch den ihres jetzigen Textes."""
    woerter = sorted(_tokens(_wortquelle(row, text)))[:MAX_BEGRIFFE]
    row.begriffe = [
        AiMemoryBegriff(begriff=wert) for wert in begriff_werte(row.scope_identity, woerter)
    ]


def _vektor_setzen(
    row: AiMemoryEntry, vektor: Sequence[float] | None, modell: str | None
) -> None:
    """Schreibt den Vektor einer Zeile, verpackt, oder verwirft ihn."""
    row.embedding_bytes = (
        None
        if vektor is None
        else _vektor_verschluesseln(ai_embedding_service.vektor_zu_bytes(vektor))
    )
    row.embedding_model = None if vektor is None else modell


def _embedding_source(key: str, value: str) -> str:
    """Der Text, aus dem der Vektor entsteht.

    Schluessel und Wert zusammen: der Schluessel traegt oft das Stichwort
    ("zeitzone"), der Wert den Inhalt. Punkte und Unterstriche werden zu
    Leerzeichen, damit `backup.zeitpunkt` als zwei Woerter gelesen wird.
    """
    readable_key = key.replace(".", " ").replace("_", " ").replace("-", " ")
    return f"{readable_key}: {value}"


def _einbettungstext(row: AiMemoryEntry, text: str) -> str:
    """Der Text, aus dem der Vektor einer Zeile entsteht.

    Titel und Text, wo es einen Titel gibt; der alte Name und der Wert bei
    Altbestand; sonst der Text allein. Der Satz traegt seit Gedaechtnis v2
    die Bedeutung selbst, Titel und Name sind nur Stichworte davor.
    """
    if row.titel:
        return f"{row.titel}: {text}"
    if row.key:
        return _embedding_source(row.key, text)
    return text


def refresh_embedding(db: Session, row: AiMemoryEntry, value: str) -> None:
    """Berechnet Vektor und Wortindex eines Eintrags neu — bei jedem neuen Text.

    Der Wortindex entsteht immer, der Vektor nur, wenn ein Modell da ist.
    `indiziert_am` sagt danach dem Vektorspeicher des Abrufs, dass sich etwas
    geändert hat.

    Schlägt es fehl, wird ein alter Vektor **verworfen** und der Eintrag eben
    ohne Bedeutungsanteil bewertet. Ein Gedächtniseintrag darf nicht daran
    scheitern, dass ein Modell fehlt.

    Das Verwerfen ist der Punkt: bliebe der alte Vektor stehen, beschriebe er
    dauerhaft den *alten* Text. Ein von "Minecraft" auf "Factorio" berichtigter
    Eintrag würde bei knappem Platz weiterhin für Minecraft-Fragen hochgezogen.
    ``None`` heißt laut Modell "noch nicht berechnet"; `_stored_vector` kommt
    damit zurecht — und der Takt holt es nach, sobald wieder ein Modell da ist
    (`indizes_nachziehen`).
    """
    kodierung = ai_embedding_service.encode([_einbettungstext(row, value)], db=db)
    if kodierung is None or not kodierung.vektoren:
        _vektor_setzen(row, None, None)
    else:
        _vektor_setzen(row, kodierung.vektoren[0], kodierung.modell)
    _begriffe_setzen(row, value)
    row.indiziert_am = datetime.now(timezone.utc)


def indizes_nachziehen(
    db: Session, decoded: list[tuple[AiMemoryEntry, str]], *, auch_vektoren: bool = False
) -> int:
    """Rechnet Vektor und Wortindex nach, solange der Klartext ohnehin vorliegt.

    Offen ist eine Zeile ohne `indiziert_am` — entstanden vor Stufe 4 —, und
    mit ``auch_vektoren`` (der Takt, `ai_gedaechtnis_abruf.nachziehen`) eine
    ohne Vektor aus dem geladenen Modell oder mit unverpacktem
    (`_liegt_im_klartext`). Gerechnet wird der Vektor nur, wo er fehlt; der
    Wortindex für jede offene Zeile. Ein Aufruf des Modells für alle.

    `refresh_embedding` verwirft den Vektor, wenn `encode` beim Schreiben
    nichts liefert — richtig, sonst beschriebe er den *alten* Text. Diese
    Funktion holt ihn nach, sobald wieder ein Modell da ist. Gibt die Zahl der
    nachgezogenen Zeilen zurück.
    """
    modell = ai_embedding_service.aktives_modell(db=db)

    def _ohne_vektor(row: AiMemoryEntry) -> bool:
        return modell is not None and (
            _stored_vector(row, modell) is None or _liegt_im_klartext(row)
        )

    offen = [
        (row, text) for row, text in decoded
        if row.indiziert_am is None or (auch_vektoren and _ohne_vektor(row))
    ]
    if not offen:
        return 0
    rechnen = [(row, text) for row, text in offen if _ohne_vektor(row)]
    if rechnen:
        kodierung = ai_embedding_service.encode(
            [_einbettungstext(row, text) for row, text in rechnen], db=db
        )
        # Die Längenprüfung ist keine Formsache: käme weniger zurück als
        # hineingegeben, schriebe das `zip` den Vektor der einen Zeile an die
        # andere — eine falsche Bedeutung unter dem richtigen Text.
        if kodierung is not None and len(kodierung.vektoren) == len(rechnen):
            for (row, _text), vektor in zip(rechnen, kodierung.vektoren):
                _vektor_setzen(row, vektor, kodierung.modell)
    jetzt = datetime.now(timezone.utc)
    for row, text in offen:
        _begriffe_setzen(row, text)
        row.indiziert_am = jetzt
    return len(offen)
