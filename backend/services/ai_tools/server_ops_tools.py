"""Server-Status, Kapazitaet und Logs lesen.

Die drei Handler standen in `execute_read_tool` hinter der Kontext-Kette. Jeder
prueft sein eigenes Recht; die Logs sind bewusst enger als der Status.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Server, User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import MAX_LOG_CHARS, _server_function

_STATUS = _server_function(
    "read_server_status",
    "Liest den minimierten Status eines Servers.",
)
_CAPACITY = _server_function(
    "read_server_capacity",
    "Liest minimierte, zuletzt bekannte Kapazitaetswerte des Servers und "
    "seines Nodes. Die Zahlen des Hosts bekommt nur, wer die Grenzen "
    "dieses Servers aendern darf; sonst kommt `node_details: withheld` "
    "und du darfst ueber die Auslastung des Hosts nichts behaupten.",
)
_LOGS = _server_function(
    "read_server_logs",
    "Liest einen begrenzten, redigierten Log-Ausschnitt des Servers.",
    {"lines": {"type": "integer", "minimum": 1, "maximum": 200}},
)

DEFINITIONEN = [_STATUS, _CAPACITY, _LOGS]


def lies_status(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    if arguments:
        raise AiActionValidationError("Status-Tool akzeptiert keine Argumente")
    return {
        "server_id": server.id,
        "game": server.game_type,
        "status": server.status,
        "cpu_limit_percent": server.cpu_limit_percent,
        "ram_limit_mb": server.ram_limit_mb,
        "disk_limit_gb": server.disk_limit_gb,
    }


def lies_kapazitaet(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    if arguments:
        raise AiActionValidationError("Kapazitaets-Tool akzeptiert keine Argumente")
    node = server.node
    if node is None:
        return {"server_id": server.id, "node_status": "unassigned"}
    # Die Zahlen der Node sind nicht die Zahlen dieses Servers.
    # `sum_allocated_ram_mb` filtert in `services/node_capacity.py` allein auf
    # `node_id` — das ist die Summe der Buchungen **aller** Kunden auf diesem
    # Host —, und cpu_total/ram_total/disk_* beschreiben die Maschine des
    # Betreibers. `_resolve_server` prueft nur `server.view`; damit gab dieses
    # Werkzeug jedem Hosting-Kunden die Ueberbuchungslage seines Anbieters
    # heraus. Die Grenze ist dieselbe wie bei `describe_network`: wer die
    # Grenzen dieses Servers aendern darf, muss sehen, wieviel Platz dafuer da
    # ist. Alle anderen bekommen den Status der Node und sonst nichts —
    # ausdruecklich als `withheld`, damit das Modell die Luecke kennt.
    if not permission_service.has_server_permission(
        db, user, server.id, "server.resources.manage"
    ):
        return {
            "server_id": server.id,
            "node_status": node.status,
            "node_details": "withheld",
        }
    from services.node_capacity import (
        allocatable_ram_mb,
        sum_allocated_ram_mb,
        sum_running_ram_mb,
    )

    allocated_ram_mb = sum_allocated_ram_mb(db, node.id)
    return {
        "server_id": server.id,
        "node_status": node.status,
        "cpu_total": node.cpu_total,
        "cpu_percent": node.cpu_percent,
        "ram_total_bytes": node.ram_total,
        "ram_used_bytes": node.ram_used,
        "ram_allocated_mb": allocated_ram_mb,
        # Gestoppte Server buchen, belegen aber nichts. Ohne diese Zeile
        # meldet das Modell "kein RAM frei", waehrend die Node leer laeuft.
        "ram_allocated_running_mb": sum_running_ram_mb(db, node.id),
        "ram_allocatable_mb": allocatable_ram_mb(node, allocated_ram_mb),
        "disk_total_bytes": node.disk_total,
        "disk_used_bytes": node.disk_used,
    }


def lies_logs(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    if set(arguments) - {"lines"}:
        raise AiActionValidationError("Log-Tool hat ungueltige Argumente")
    # Dasselbe Recht, das der Panel-Endpunkt verlangt (routers/servers.py und
    # die Konsolen-WebSocket). `_resolve_server` prueft nur `server.view` —
    # damit war die Konsole ueber den KI-Pfad fuer jeden lesbar, der den Server
    # ueberhaupt sehen darf. Containerlogs sind kein Nebenprodukt: dort stehen
    # Spielerchat, Join-Zeilen mit IP-Adressen, Admin-Kommandos und
    # Stacktraces, und `redact_sensitive_text` entfernt davon nichts.
    if not permission_service.has_server_permission(
        db, user, server.id, "server.console.read"
    ):
        raise AiActionValidationError("Konsolen-Lesezugriff ist nicht erlaubt")
    lines = arguments.get("lines", 100)
    if not isinstance(lines, int) or isinstance(lines, bool) or not 1 <= lines <= 200:
        raise AiActionValidationError("Ungueltige Log-Zeilenanzahl")
    from services import docker_service
    from services.node_service import is_node_offline

    # docker_service.logs() liefert bei einem nicht erreichbaren Node
    # denselben leeren String wie bei einem Container ohne Ausgabe. Ohne diese
    # Unterscheidung wuerde das Modell "keine Fehler gefunden" antworten.
    if is_node_offline(server.node):
        return {
            "server_id": server.id,
            "lines_requested": lines,
            "content": "",
            "available": False,
            "reason": "node_unreachable",
        }
    if server.container_name == "caddy-managed" or server.game_type == "web_static":
        ports = [f"{p.port}/{p.protocol}" for p in (server.ports or [])]
        port_str = ", ".join(ports) if ports else "kein Port"
        return {
            "server_id": server.id,
            "lines_requested": lines,
            "content": f"[MSM] Web-Server #{server.id} ({server.name}) wird aktiv über Caddy verwaltet (Ports: {port_str}).",
            "available": True,
            "truncated": False,
            "redacted": False,
        }
    if not server.container_name:
        return {
            "server_id": server.id,
            "lines_requested": lines,
            "content": "",
            "available": False,
            "reason": "container_missing",
        }
    content = docker_service.logs(server.container_name, lines=lines, node=server.node)
    redacted = redact_sensitive_text(content)
    return {
        "server_id": server.id,
        "lines_requested": lines,
        "content": redacted[-MAX_LOG_CHARS:],
        "available": True,
        "truncated": len(redacted) > MAX_LOG_CHARS,
        "redacted": redacted != content,
    }


werkzeug(
    _STATUS,
    art="server_read",
    hinweis="Liest Status, Spieltyp und gesetzte Grenzen des Servers.",
    handler=lies_status,
)
werkzeug(
    _CAPACITY,
    art="server_read",
    hinweis="Liest Auslastung von Server und Node; Hostzahlen nur mit Recht.",
    handler=lies_kapazitaet,
)
werkzeug(
    _LOGS,
    art="server_read",
    angebot=("server.console.read",),
    hinweis="Liest einen begrenzten, redigierten Ausschnitt der Serverkonsole.",
    handler=lies_logs,
)
