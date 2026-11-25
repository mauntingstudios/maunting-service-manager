"""Generische Diagnose-Klassifikation für Installations- und Server-Fehler."""

from __future__ import annotations

_GENERIC_FAILURE_RULES: tuple[tuple[str, tuple[str, ...], str], ...] = (
    (
        "install_disk_full",
        (
            "no space left on device",
            "enospc",
            "disk quota exceeded",
            "edquot",
            "not enough disk quota",
            "not enough disk space",
            "failed to preallocate",
        ),
        (
            "Nicht genügend freier Speicherplatz oder Disk-Quota auf dem Server-Volume. "
            "Bitte Disk-Limit erhöhen oder freien Speicher auf dem Host schaffen."
        ),
    ),
    (
        "install_permission_denied",
        (
            "permission denied",
            "eacces",
            "exit 126",
            "operation not permitted",
        ),
        (
            "Dateizugriff oder Ausführung verweigert (Permission denied). "
            "Bitte Dateiberechtigungen, Mount-Optionen oder Container-Nutzer prüfen."
        ),
    ),
    (
        "install_oom",
        (
            "out of memory",
            "oomkilled",
            "cannot allocate memory",
            "exit 137",
        ),
        (
            "Der Prozess wurde wegen Speichermangels beendet (OOM / Exit 137). "
            "Bitte das RAM-Limit des Servers erhöhen."
        ),
    ),
    (
        "install_network_error",
        (
            "could not resolve host",
            "temporary failure in name resolution",
            "connection timed out",
            "connection refused",
            "network is unreachable",
        ),
        (
            "Netzwerk- oder DNS-Fehler beim Herunterladen der Server-Dateien. "
            "Bitte Internetverbindung, DNS und Firewall des Nodes prüfen."
        ),
    ),
    (
        "install_source_access_error",
        (
            "401 unauthorized",
            "403 forbidden",
            "404 not found",
            "authentication failed",
        ),
        (
            "Die konfigurierte Download- oder Git-Quelle konnte nicht abgerufen werden "
            "(Zugriff verweigert oder Ressource nicht gefunden). Bitte URL, Branch und Zugangsdaten prüfen."
        ),
    ),
    (
        "server_port_conflict",
        (
            "address already in use",
            "eaddrinuse",
        ),
        (
            "Mindestens ein konfigurierter Netzwerk-Port ist auf dem Node bereits belegt. "
            "Bitte die zugewiesenen Server-Ports prüfen."
        ),
    ),
)


def classify_generic_install_failure(
    output: str, fallback_error: str = ""
) -> dict[str, str] | None:
    """Mappt bekannte generische Fehlerbilder (Disk, Rechte, RAM, Netz, Quelle, Port) auf sichere Diagnosen."""
    text = f"{output}\n{fallback_error}".lower()
    if not text.strip():
        return None
    for error_code, markers, message in _GENERIC_FAILURE_RULES:
        if any(marker in text for marker in markers):
            return {"error_code": error_code, "error": message}
    return None
