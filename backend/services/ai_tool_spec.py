"""Der Vertrag eines Werkzeugs: eine Deklaration, alle Achsen.

`ToolSpec` haelt zusammen, was heute ueber sieben Dateien verteilt ist:
Klassifikation, JSON-Schema, Handler, Payload-Bauer, Ausfuehrer und einen Satz
fuer den Prompt-Index. Die Deklaration steht im Domaenenmodul, `ai_tool_registry`
aggregiert nur noch und leitet die Mengen ab.

Dieses Modul ist ein Blatt: nur Standardbibliothek, keine Importe aus dem
Dienstpaket. Damit koennen Domaenenmodule ihre Specs deklarieren, ohne die
Registry zu importieren — der Zyklus, den `base.py` bis hierher trug, faellt weg.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

# Die Art entscheidet ueber alles Weitere:
#
# - `server_read`  — liest, braucht eine `server_id`, laeuft ueber `_resolve_server`
# - `global_read`  — liest ohne Serverbezug
# - `docs_write`   — schreibt im Dokument, ohne Vorschlagskarte
# - `server_write` — erzeugt einen bestaetigungspflichtigen Vorschlag zu einem Server
# - `global_write` — erzeugt einen Vorschlag ohne Serverbezug (Servererstellung)
# - `ask`          — beendet den Zug und uebergibt an den Menschen
# - `delegation`   — laeuft sofort im Handler, ohne Vorschlagskarte
# - `voice_control` — steuert nur Zustand der aktuellen Sprachsitzung
ARTEN = (
    "server_read",
    "global_read",
    "docs_write",
    "server_write",
    "global_write",
    "ask",
    "delegation",
    "voice_control",
)

SCHREIBARTEN = frozenset({"server_write", "global_write"})


@dataclass(frozen=True)
class Werkzeug:
    """Die Einordnung eines Werkzeugs — nicht seine Definition.

    ``gruppe`` fasst thematisch zusammen, was die Oberflaeche unterschiedlich
    darstellt: Gedaechtnis- und Skill-Aufrufe bekommen im Verlauf ein eigenes
    Symbol statt des allgemeinen Werkzeugsymbols.

    ``immer_bestaetigen`` schliesst ein Werkzeug vom autonomen Modus aus, auch
    bei erteilter Freigabe. Die Liste ist eine Vorgabe des Betreibers vom
    25.09.2026, woertlich: nur noch Server loeschen, zuruecksetzen oder neu
    installieren, Dateien loeschen, Backup einspielen, Blueprint oder Rolle
    loeschen, Rechte anderer Benutzer (die stehen am Aufruf, `verlangt_klick`),
    Shop-Anbindung, Tarif-Rolle und Zugangsdaten. Was nur die eigenen Daten des
    Benutzers loescht — Notiz, Termin, Aufgabe, DNS-Eintrag, Skill —
    laeuft autonom (`EIGENE_DATEN_LOESCHEN`).

    Dazwischen lag die Regel vom 23.09.2026, "jedes Loeschen fragt", nachdem
    das Modell dem Betreiber im autonomen Modus fast seinen Discord-Bot geloescht
    haette. Der Betreiber hat sie zwei Tage spaeter zurueckgenommen: autonom
    heisst autonom, und gefragt wird dort, wo sich ein Fehlgriff nicht mehr
    auffangen laesst. Bestaetigt wird in jedem Fall per Klick auf die Karte, nie
    per gesprochenem Ja (`ai_voice.interactions.klick_noetig`).

    ``recht`` ist der Permission-Key, den ein Schreibwerkzeug verlangt.
    ``recht_global`` entscheidet, **wie** geprueft wird: die meisten Rechte
    haengen am Server, einige sind bewusst global und nicht delegierbar.
    ``angebot`` sind die Rechte, von denen **eines** genuegt, damit das Werkzeug
    dem Modell ueberhaupt angeboten wird. Ohne Angabe gilt `recht`; steht auch
    das nicht da, wird das Werkzeug jedem angeboten.
    """

    art: str
    gruppe: str | None = None
    immer_bestaetigen: bool = False
    recht: str | None = None
    recht_global: bool = False
    angebot: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.art not in ARTEN:
            raise ValueError(f"Unbekannte Werkzeugart: {self.art}")
        if self.recht_global and not self.recht:
            raise ValueError("recht_global ohne recht ist sinnlos")
        if self.art == "delegation" and (self.recht or self.immer_bestaetigen):
            # `recht` prueft der Vorschlagspfad, `immer_bestaetigen` der
            # autonome Modus — durch beide kommt eine Delegation nie. Ein Wert
            # hier saehe nach einer Schranke aus, die nirgends greift.
            raise ValueError(
                "delegation läuft ohne Vorschlagspfad — recht/immer_bestaetigen "
                "würden dort nie geprüft"
            )


@dataclass(frozen=True)
class ToolSpec:
    """Eine Zeile je Werkzeug, im Domaenenmodul deklariert.

    ``funktion`` ist das fertige OpenAI-Schema (`_function`/`_server_function`).
    Zwei Handler-Felder statt einem: serverbezogene Werkzeuge bekommen den
    aufgeloesten Server, globale das Lauf-Envelope. Ein gemeinsamer Nenner
    dafuer waere eine Abstraktion, die mehr verdeckt als ordnet — dieselbe
    Begruendung, mit der die Registry bis hierher bewusst keine Handler trug.
    """

    funktion: dict[str, Any]
    art: str
    gruppe: str | None = None
    immer_bestaetigen: bool = False
    recht: str | None = None
    recht_global: bool = False
    angebot: tuple[str, ...] = ()
    hinweis: str = ""
    handler: Callable[..., dict] | None = None
    global_handler: Callable[..., dict] | None = None
    vorschlag: Callable[..., tuple[dict, dict]] | None = None
    ausfuehren: Callable[..., Any] | None = None

    def __post_init__(self) -> None:
        funktion = self.funktion.get("function") if isinstance(self.funktion, dict) else None
        if not isinstance(funktion, dict) or not funktion.get("name"):
            raise ValueError("ToolSpec braucht ein Schema mit function.name")
        if self.name in ALLE:
            raise ValueError(f"Werkzeug {self.name!r} ist bereits deklariert")
        if not self.hinweis.strip():
            raise ValueError(f"Werkzeug {self.name!r} braucht einen Hinweis")
        if self.art in SCHREIBARTEN:
            if self.vorschlag is None or self.ausfuehren is None:
                raise ValueError(
                    f"{self.name!r} ist {self.art}, braucht aber Vorschlag und Ausfuehrung"
                )
        elif self.vorschlag is not None or self.ausfuehren is not None:
            raise ValueError(
                f"{self.name!r} ist {self.art}, darf aber keinen Vorschlag tragen"
            )
        if self.immer_bestaetigen and self.art not in SCHREIBARTEN:
            raise ValueError(
                f"{self.name!r} fragt immer, ist aber keine Schreibfaehigkeit"
            )

    @property
    def name(self) -> str:
        return str(self.funktion["function"]["name"])

    @property
    def werkzeug(self) -> Werkzeug:
        return Werkzeug(
            art=self.art,
            gruppe=self.gruppe,
            immer_bestaetigen=self.immer_bestaetigen,
            recht=self.recht,
            recht_global=self.recht_global,
            angebot=self.angebot,
        )


ALLE: dict[str, ToolSpec] = {}


def spaet(pfad: str) -> Callable[..., Any]:
    """Bindet eine Funktion ueber ihren Importpfad, erst beim ersten Aufruf.

    Fuer den Uebergang: die Vorschlagsmodule liegen unter `ai_proposals`, und
    deren Paket`__init__` importiert die Registry. Ein Import zur Deklarations-
    zeit schloesse den Kreis wieder. Sobald der Vorschlagspfad ohne
    Registry-Import auskommt, faellt dieser Helfer weg.
    """
    modul_name, funktion_name = pfad.rsplit(".", 1)

    def aufrufen(*args: Any, **kwargs: Any) -> Any:
        import importlib

        return getattr(importlib.import_module(modul_name), funktion_name)(*args, **kwargs)

    aufrufen.__name__ = funktion_name
    return aufrufen


def spaet_vorschlag(pfad: str) -> Callable[..., tuple[dict, dict]]:
    """Wie `spaet`, aber in der Signatur des Vorschlagspfads.

    Die Bauer in `ai_proposals` nehmen `(db, user, rest)`; der Vorschlagspfad
    ruft `(db, user, rest, arguments, guardian)`. Der Unterschied bleibt hier
    an einer Stelle sichtbar.
    """
    bauen = spaet(pfad)

    def bauer(
        db: Any, user: Any, rest: dict, arguments: dict | None = None, guardian: Any = None
    ) -> tuple[dict, dict]:
        return bauen(db, user, rest)

    bauer.__name__ = f"{pfad.rsplit('.', 1)[1]}_vorschlag"
    return bauer


def vorschlag_aus_tabelle(tool_name: str) -> Callable[..., tuple[dict, dict]]:
    """Bindet den vorhandenen Bauer aus `_GLOBALE_PAYLOADS_ROH`.

    Fuer den Uebergang: die Bauer liegen noch in `ai_proposals/lifecycle.py`.
    Der Snapshot `_GLOBALE_PAYLOADS_ROH` wird vor dem Spec-Overlay genommen,
    damit dieser Weg nicht auf sich selbst zeigt.
    """

    def bauer(
        db: Any, user: Any, rest: dict, arguments: dict | None = None, guardian: Any = None
    ) -> tuple[dict, dict]:
        from services.ai_proposals.lifecycle import _GLOBALE_PAYLOADS_ROH

        return _GLOBALE_PAYLOADS_ROH[tool_name](db, user, rest, arguments, guardian)

    bauer.__name__ = f"{tool_name}_vorschlag"
    return bauer


def vorschlag_server(tool_name: str) -> Callable[..., tuple[dict, dict]]:
    """Baut den Vorschlag eines serverbezogenen Werkzeugs.

    Der Bauer bleibt im Vorschlagspfad (`server_vorschlag`), weil dort
    `_resolve_server`, Guardian-Bindung und die Rechtepruefung zusammengehoeren.
    """

    def bauer(
        db: Any, user: Any, rest: dict, arguments: dict | None = None, guardian: Any = None
    ) -> tuple[dict, dict]:
        from services.ai_proposals.lifecycle import server_vorschlag

        _server, payload, preview, _revision = server_vorschlag(
            db,
            user,
            tool_name,
            arguments if isinstance(arguments, dict) else dict(rest),
            rest,
            guardian,
            None,
        )
        return payload, preview

    bauer.__name__ = f"{tool_name}_server_vorschlag"
    return bauer


def ausfuehrung_aus_tabelle(tool_name: str) -> Callable[..., Any]:
    """Bindet den vorhandenen Ausfuehrer aus `_AUSFUEHRUNGEN_ROH`."""

    def ausfuehren(db: Any, rahmen: Any) -> Any:
        from services.ai_proposals.lifecycle import _AUSFUEHRUNGEN_ROH

        return _AUSFUEHRUNGEN_ROH[tool_name](db, rahmen)

    ausfuehren.__name__ = f"{tool_name}_ausfuehren"
    return ausfuehren


def werkzeug(schema: dict[str, Any], **felder: Any) -> ToolSpec:
    """Deklariert ein Werkzeug und nimmt es in `ALLE` auf.

    Kein Dekorator: es gibt keine Funktion zu umhuellen, die Spec ist Daten.
    Die Pruefung sitzt in `ToolSpec.__post_init__`, damit auch ein direkter
    Aufruf sie nicht umgehen kann.
    """
    spec = ToolSpec(funktion=schema, **felder)
    ALLE[spec.name] = spec
    return spec
