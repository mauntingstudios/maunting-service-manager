"""Server-Netzwerk lesen: Ports, Bind-IP, Firewall, Erreichbarkeit.

Herausgezogen aus der langen Serverkette in `server_tools`. Die drei Werkzeuge
teilen sich Werkzeuge, Rechte und Antwortform; sie gehoeren zusammen.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Server, User
from services import permission_service
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import _require_no_arguments, _server_function

_PORTS = _server_function(
    "read_server_ports",
    "Liest die vergebenen Ports des Servers mit Rolle und Protokoll.",
)
_NETWORK = _server_function(
    "read_server_network",
    "Netzwerk: Bind-IP mit Einordnung, Ports, Host-Adressen, Firewall "
    "und Status. Erster Schritt, wenn niemand sich verbinden kann; "
    "danach check_server_reachability.",
)
_REACHABILITY = _server_function(
    "check_server_reachability",
    "Prueft, ob der Server **auf dem Host** erreichbar ist: ob auf "
    "seinen Ports etwas lauscht und ob er im Spielprotokoll antwortet — "
    "der Beweis bei 'laeuft, aber niemand kommt drauf'. Ob er aus dem "
    "Internet erreichbar ist, kann MSM nicht messen; sag das nie zu. "
    "`game_probe`: `answering`, `not_answering` (Port "
    "offen, Dienst stumm), `not_declared` (keine Probe im Blueprint — "
    "**kein Fehlerbefund**) oder `no_measurement`.",
)

DEFINITIONEN = [_PORTS, _NETWORK, _REACHABILITY]


def lies_ports(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    _require_no_arguments("read_server_ports", arguments)
    from models import ServerPort

    rows = db.query(ServerPort).filter(ServerPort.server_id == server.id).order_by(
        ServerPort.role
    ).all()
    return {
        "server_id": server.id,
        "ports": [
            {"role": row.role, "port": row.port, "protocol": row.protocol} for row in rows
        ],
    }


def lies_netzwerk(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    _require_no_arguments("read_server_network", arguments)
    from services import server_network_diagnostics

    # Host-Adressen und Firewall-Regeln sind die Netzstruktur des Betreibers,
    # nicht die des Servers. Wer sie nicht aendern darf, muss sie auch nicht
    # sehen — die Ports des eigenen Servers schon.
    return server_network_diagnostics.describe_network(
        db,
        server,
        include_host_details=permission_service.has_server_permission(
            db, user, server.id, "server.network.manage"
        ),
    )


def pruefe_erreichbarkeit(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    _require_no_arguments("check_server_reachability", arguments)
    from services import server_network_diagnostics

    return server_network_diagnostics.check_reachability(db, server)


werkzeug(
    _PORTS,
    art="server_read",
    hinweis="Listet die vergebenen Ports mit Rolle und Protokoll.",
    handler=lies_ports,
)
werkzeug(
    _NETWORK,
    art="server_read",
    hinweis="Zeigt Bind-IP, Ports, Host-Adressen und Firewall des Servers.",
    handler=lies_netzwerk,
)
werkzeug(
    _REACHABILITY,
    art="server_read",
    hinweis="Prueft, ob der Server auf dem Host und im Spielprotokoll antwortet.",
    handler=pruefe_erreichbarkeit,
)
