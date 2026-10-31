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


#: Die beiden Werkzeuge, die den Rechner bedienen oder den Bildschirm lesen.
#: `desktop_launch_app` bleibt bewusst draussen: ein Programm zu starten ist
#: keine Bildschirm- oder Eingabesteuerung.
DESKTOP_STEUERUNG = frozenset({"desktop_system", "desktop_steuern"})

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


class ToolSelectionPort(Protocol):
    def select(self, query: str, allowed: frozenset[str], top_k: int = 5) -> list[str]: ...


def pflichtwerkzeuge(
    erlaubt: frozenset[str],
    herkunft: str | None,
    *,
    hat_anhaenge: bool = False,
    query: str = "",
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

    ``hat_anhaenge`` nimmt die beiden Bildschirm-/Eingabewerkzeuge aus der
    Pflicht, solange die Frage keinen Rechnerauftrag nennt. Sonst zwingt der
    Router sie in jeden Anhang-Turn, und das Modell greift zum Rechner, statt
    die Datei zu lesen. ``desktop_launch_app`` bleibt.
    """
    if herkunft != "desktop":
        return frozenset()
    from services.ai_tool_registry import GEHIRN_DESKTOP

    pflicht = GEHIRN_DESKTOP & erlaubt
    if hat_anhaenge and not desktop_absicht(query):
        pflicht = pflicht - DESKTOP_STEUERUNG
    return pflicht
