"""Sicherheitsgrenzen fuer MCP-Endpunkte.

Ein MCP-Server ist eine fremde Schnittstelle, die das Modell aufruft. Bevor
eine Verbindung entsteht, muss feststehen, wohin sie geht: nur HTTPS, keine
Zugangsdaten in der Adresse, keine Ziele im eigenen Netz oder in der
Cloud-Metadaten-Adresse.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

#: Groesste Antwort, die ein MCP-Server liefern darf. Werkzeuglisten und
#: Aufrufergebnisse sind Text; alles darueber ist ein Fehler oder ein Angriff.
MAX_ANTWORT_BYTES = 1024 * 1024

#: Groesste Werkzeugbeschreibung, die in den Prompt darf.
MAX_SCHEMA_BYTES = 64 * 1024

#: Hoechstens so viele Werkzeuge eines Servers werden angeboten.
MAX_WERKZEUGE_JE_SERVER = 8

_ERLAUBTE_SCHEMATA = {"https"}


class McpZielFehler(ValueError):
    """Das Ziel ist aus Sicherheitsgruenden nicht erlaubt."""


def _ist_oeffentlich(adresse: str) -> bool:
    ip = ipaddress.ip_address(adresse)
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return False
    # CGNAT (100.64.0.0/10) ist nicht als privat markiert, aber nie ein
    # oeffentlicher MCP-Server.
    if ip.version == 4 and ip in ipaddress.ip_network("100.64.0.0/10"):
        return False
    return True


def pruefe_endpunkt(url: str, *, erlaube_loopback: bool = False) -> str:
    """Prueft Schema, Adresse und aufgeloeste Ziele. Gibt die URL zurueck.

    `erlaube_loopback` ist nur fuer Entwicklung gedacht (Panel und MCP-Server
    auf demselben Rechner). Im Betrieb bleibt es aus.
    """
    teile = urlsplit(url or "")
    schema = (teile.scheme or "").lower()
    if erlaube_loopback and schema == "http" and teile.hostname in {"127.0.0.1", "localhost", "::1"}:
        return url
    if schema not in _ERLAUBTE_SCHEMATA:
        raise McpZielFehler("MCP-Endpunkt muss https sein")
    if teile.username or teile.password:
        raise McpZielFehler("MCP-Endpunkt darf keine Zugangsdaten in der Adresse tragen")
    host = teile.hostname
    if not host:
        raise McpZielFehler("MCP-Endpunkt hat keinen Host")
    port = teile.port or (443 if schema == "https" else 80)
    try:
        adressen = {
            eintrag[4][0]
            for eintrag in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        }
    except OSError as exc:
        raise McpZielFehler(f"MCP-Endpunkt nicht aufloesbar: {host}") from exc
    if not adressen:
        raise McpZielFehler(f"MCP-Endpunkt nicht aufloesbar: {host}")
    for adresse in adressen:
        if erlaube_loopback and ipaddress.ip_address(adresse).is_loopback:
            continue
        if not _ist_oeffentlich(adresse):
            raise McpZielFehler("MCP-Endpunkt zeigt in ein privates oder reserviertes Netz")
    return url
