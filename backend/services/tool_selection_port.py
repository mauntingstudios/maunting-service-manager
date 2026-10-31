from __future__ import annotations

from typing import Protocol

HOTSET = frozenset({
    "list_my_servers",
    "read_server_status",
    "read_server_logs",
    "analyze_region",
    "control_region_camera",
    "web_search",
    "search_docs",
    # Ohne `read_docs` findet `search_docs` nur Ausschnitte: den Abschnitt
    # selbst liest erst sie. Bis zum 07.10.2026 kam sie ueber die Seitentitel
    # in ihrer Beschreibung ins Angebot; seit die nur noch in `search_docs`
    # stehen, fiel sie bei Fragen wie „Wie funktioniert die Hoster-API?“ aus
    # den Top 5.
    "read_docs",
    "calendar_read",
    "notes_read",
    # Dokumente: lesen und die eine Aenderung, die den Lauf ausmacht.
    "read_document",
    "read_document_selection",
    "edit_document",
    "propose_calendar_event_create",
    "propose_note_create",
    "search_memory",
    "learn_skill",
    "worker_start",
    "execute_server_action",
    "cloudflare_list_zones",
    "cloudflare_list_dns_records",
    "propose_cloudflare_dns_record",
    "propose_cloudflare_dns_delete",
    "search_curseforge_modpacks",
    "search_curseforge_mods",
    "advise_node_placement",
})


#: Wann ein Anhang-Turn doch ein Rechnerauftrag ist. Bewusst eng: „Was steht
#: auf dem Bild?“ soll den Rechner nicht anfassen, „öffne die Datei auf meinem
#: PC“ schon.
_DESKTOP_ABSICHT = (
    "rechner", "computer", "pc", "desktop", "bildschirm", "monitor",
    "maus", "tastatur", "klick", "steuere", "bediene", "fenster",
    "öffne", "oeffne", "starte", "installiere", "programm",
)


def desktop_absicht(query: str) -> bool:
    """Nennt die Frage ausdruecklich den Rechner oder eine Eingabe?"""
    text = (query or "").lower()
    return any(wort in text for wort in _DESKTOP_ABSICHT)


def desktop_erlaubt(
    *, query: str = "", hat_anhaenge: bool, computer_use_aktiv: bool | None,
    desktop_intent: bool | None = None,
) -> bool:
    """Darf dieser Turn ueberhaupt Desktop-Werkzeuge sehen?

    Ein Anhang-Turn liest die Datei aus dem Gespraech. Nur wenn der Benutzer
    ausdruecklich den Rechner, ein Programm oder eine Eingabe nennt, bleibt
    Computer-Use im Angebot. ``computer_use_aktiv is False`` schaltet es
    unabhaengig davon ab.

    ``desktop_intent`` ist die im Lauf eingefrorene Antwort auf
    `desktop_absicht` fuer die **Frage** des Benutzers. Sie ueberlebt
    Fortsetzungen und ist unabhaengig davon, welche Nachricht gerade am Ende
    der Providerliste steht (dort steht oft ein Gedaechtnis- oder
    Anhangsblock, nicht die Frage).
    """
    if computer_use_aktiv is False:
        return False
    absicht = desktop_absicht(query) if desktop_intent is None else desktop_intent
    return not (hat_anhaenge and not absicht)


class ToolSelectionPort(Protocol):
    def select(self, query: str, allowed: frozenset[str], top_k: int = 5) -> list[str]: ...


def pflichtwerkzeuge(
    erlaubt: frozenset[str],
    herkunft: str | None,
    *,
    hat_anhaenge: bool = False,
    query: str = "",
    desktop_intent: bool | None = None,
) -> frozenset[str]:
    """Was kein Router-Schnitt entfernen darf, ueber ``HOTSET`` hinaus.

    Aus der App gehoeren Sehen, Zeigen und Programmstarten (``GEHIRN_DESKTOP``)
    immer ins Angebot. Bis zum 05.10.2026 entschied der semantische Router
    auch ueber sie: "klick auf Start" oder "was siehst du?" traf selten die
    Beschreibung von ``desktop_steuern``, und Singra sagte, sie habe keinen
    Zugriff auf den Rechner — bei eingeschaltetem Computer-Use.

    Nur was ``erlaubt`` ohnehin enthaelt: die Rechte und ``herkunft_schnitt``
    haben vorher entschieden, diese Menge oeffnet nichts. Aus dem Panel ist
    sie leer.

    ``hat_anhaenge`` nimmt **alle** Desktop-Werkzeuge aus der Pflicht, solange
    die Frage keinen Rechnerauftrag nennt. Sonst zwingt der Router sie in jeden
    Anhang-Turn, und das Modell greift zum Rechner, statt die Datei zu lesen.
    Das gilt ausdruecklich auch fuer ``desktop_launch_app``: „oeffne das Bild“
    ist ein Rechnerauftrag, „was steht auf dem Bild?“ nicht.
    """
    if herkunft != "desktop":
        return frozenset()
    from services.ai_tool_registry import DESKTOP_TOOLS, GEHIRN_DESKTOP

    pflicht = GEHIRN_DESKTOP & erlaubt
    absicht = desktop_absicht(query) if desktop_intent is None else desktop_intent
    if hat_anhaenge and not absicht:
        # **Alle** Desktop-Werkzeuge, nicht nur Bildschirm und Eingabe.
        # `desktop_launch_app` blieb hier frueher stehen und war genau der
        # Weg, auf dem ein hochgeladenes Bild als Rechnerauftrag endete.
        pflicht = pflicht - DESKTOP_TOOLS
    return pflicht
