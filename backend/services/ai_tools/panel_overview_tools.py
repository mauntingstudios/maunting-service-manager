"""Serverliste, Blueprints und Nodes lesen.

Die Handler standen in `_execute_global_read_tool`; die Schemas in
`_global_tool_definitions`. Beide gehoeren zur selben Uebersicht und stehen
jetzt zusammen. `advise_node_placement` folgt spaeter (eigener Zweig).
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import (
    MAX_LISTED_BLUEPRINTS,
    MAX_LISTED_NODES,
    MAX_LISTED_SERVERS,
    _function,
    _node_health,
    _require_no_arguments,
    _visible_servers,
)


_S_LIST_MY_SERVERS = _function(
            "list_my_servers",
            "Listet alle Server, die der Benutzer sehen darf, mit ID, Name, Spiel "
            "und Status. Immer zuerst aufrufen, wenn der Benutzer einen Server "
            "nur mit Namen nennt oder gar nicht benennt.",
            {},
            [],
        )

_S_LIST_BLUEPRINTS = _function(
            "list_blueprints",
            "Listet verfuegbare Servertypen (Blueprints) mit Modunterstuetzung und Portrollen.",
            {},
            [],
        )

_S_READ_BLUEPRINT = _function(
            "read_blueprint",
            "Liest einen Blueprint: Image, Startbefehl, Ports, Umgebung. **Die "
            "Spielversion steht hier, nicht am Server** (Minecraft: "
            "runtime.env.VERSION, Steam: source.steam.branch, sonst Image-Tag). "
            "`origin: native` = mitgeliefert, schreibgeschuetzt.",
            {"blueprint_id": {"type": "string", "maxLength": 64}},
            ["blueprint_id"],
        )

_S_READ_NODE_CAPACITY = _function(
            "read_node_capacity",
            "Kapazitaet aller Hosts. **Gebucht ist nicht belegt**: "
            "`ram_allocated_mb` zaehlt alle Grenzen einschliesslich gestoppter "
            "Server; was laeuft, steht "
            "in `ram_allocated_running_mb`, gemessen in `ram_used_mb` und "
            "`ram_real_free_mb`. Ueberbuchung ist erlaubt: solange "
            "`ram_real_free_mb` > 0, ist Anlegen zulaessig.",
            {},
            [],
        )

_S_READ_NODE_HEALTH = _function(
            "read_node_health",
            "Liest den Gesundheitszustand aller Hosts: erreichbar, Docker "
            "verbunden, CPU, RAM, Festplatte, Containerzahl, letzter Kontakt. "
            "Fuer Fragen wie 'bei einer meiner Nodes stimmt etwas nicht'.",
            {},
            [],
        )

KOPF_DEFINITIONEN = [_S_LIST_MY_SERVERS]
REST_DEFINITIONEN = [_S_LIST_BLUEPRINTS, _S_READ_BLUEPRINT, _S_READ_NODE_CAPACITY, _S_READ_NODE_HEALTH]


def lies_serverliste(db: Session, *, user: User, arguments: dict, lauf: dict | None = None, tool_name: str = "list_my_servers") -> dict:
    _require_no_arguments(tool_name, arguments)
    servers = _visible_servers(db, user)
    return {
        "servers": [
            {
                "server_id": server.id,
                # Der Name ist frei vom Benutzer gesetzt und wird redigiert.
                "name": redact_sensitive_text(str(server.name or ""))[:128],
                "game_type": server.game_type,
                "status": server.status,
            }
            for server in servers
        ],
        "count": len(servers),
        "truncated": len(servers) >= MAX_LISTED_SERVERS,
    }


def lies_blueprints(db: Session, *, user: User, arguments: dict, lauf: dict | None = None, tool_name: str = "list_blueprints") -> dict:
    _require_no_arguments(tool_name, arguments)
    if not permission_service.has_global_permission(db, user, "servers.create"):
        raise AiActionValidationError("Serverplanung ist nicht erlaubt")
    from games import list_game_info

    entries = []
    for info in list_game_info()[:MAX_LISTED_BLUEPRINTS]:
        entries.append({
            "game_type": info.get("id"),
            "name": info.get("name"),
            "platform": info.get("platform"),
            "mod_support": bool(info.get("mod_support")),
            "ports": [port.get("name") for port in (info.get("ports") or [])],
        })
    return {"blueprints": entries, "count": len(entries)}


def lies_blueprint(db: Session, *, user: User, arguments: dict, lauf: dict | None = None, tool_name: str = "read_blueprint") -> dict:
    if not (
        permission_service.has_global_permission(db, user, "servers.create")
        or permission_service.has_global_permission(db, user, "blueprints.manage")
    ):
        raise AiActionValidationError("Blueprint-Einsicht ist nicht erlaubt")
    if set(arguments) != {"blueprint_id"}:
        raise AiActionValidationError("Blueprint-Tool hat ungueltige Argumente")
    from services import blueprint_service

    try:
        return blueprint_service.blueprint_view(str(arguments["blueprint_id"]))
    except HTTPException as exc:
        raise AiActionValidationError(str(exc.detail)) from exc


def lies_node_kapazitaet(db: Session, *, user: User, arguments: dict, lauf: dict | None = None, tool_name: str = "read_node_capacity") -> dict:
    _require_no_arguments(tool_name, arguments)
    if not permission_service.has_global_permission(db, user, "servers.create"):
        raise AiActionValidationError("Serverplanung ist nicht erlaubt")
    from models import Node
    from services.node_capacity import (
        allocatable_ram_mb, sum_allocated_ram_mb, sum_running_ram_mb, normalize_ram_mb,
    )

    nodes = db.query(Node).order_by(Node.id).limit(MAX_LISTED_NODES).all()
    entries = []
    for node in nodes:
        allocated = sum_allocated_ram_mb(db, node.id)
        total_mb = normalize_ram_mb(node.ram_total)
        used_mb = normalize_ram_mb(node.ram_used)
        running_mb = sum_running_ram_mb(db, node.id)
        real_free_mb = max(0, total_mb - (used_mb if used_mb is not None else running_mb)) if total_mb is not None else None

        # Netzwerk-Interfaces & IPs der Node für Vergabe und DNS
        host_ifaces = []
        default_bind = None
        if node.is_local:
            try:
                from services import network_interfaces_service
                host_ifaces = [h.to_dict() for h in network_interfaces_service.list_host_interfaces()]
                default_bind = network_interfaces_service.default_bind_ip()
            except Exception:
                pass
        else:
            try:
                from services.node_client import NodeClient
                data = NodeClient.from_node(node, timeout=2.0).interfaces()
                host_ifaces = data.get("interfaces", []) if isinstance(data, dict) else []
                default_bind = data.get("default_bind_ip") if isinstance(data, dict) else None
            except Exception:
                pass

        public_ip = next(
            (iface["ip"] for iface in host_ifaces if isinstance(iface, dict) and not iface.get("is_private") and not iface.get("is_loopback") and not iface.get("is_link_local")),
            default_bind or node.host
        )

        entries.append({
            "node_id": node.id,
            "name": node.name,
            "host": node.host,
            "status": node.status,
            "is_local": bool(node.is_local),
            "public_ip": public_ip,
            "default_bind_ip": default_bind or public_ip,
            "interfaces": host_ifaces,
            "cpu_total": node.cpu_total,
            "cpu_percent": node.cpu_percent,
            # Gebucht ueber **alle** Server, auch gestoppte. Das ist die
            # Ueberbuchungsgrenze, nicht der Verbrauch.
            "ram_allocated_mb": allocated,
            # Gebucht von den Servern, die gerade wirklich laufen. Die
            # Unterscheidung ist der Kern einer wiederkehrenden Fehlauskunft:
            # vier gestoppte Server zu je 8 GB buchen 32 GB und belegen null.
            "ram_allocated_running_mb": running_mb,
            "ram_allocatable_mb": allocatable_ram_mb(node, allocated),
            # Was die Node selbst meldet — echte Messung und physischer Freiraum.
            "ram_total_mb": total_mb,
            "ram_used_mb": used_mb,
            "ram_real_free_mb": real_free_mb,
            "overcommit_allowed": True,
        })
    return {"nodes": entries}


def lies_node_zustand(db: Session, *, user: User, arguments: dict, lauf: dict | None = None, tool_name: str = "read_node_health") -> dict:
    _require_no_arguments(tool_name, arguments)
    # Bewusst `nodes.read` statt `servers.create`: den Zustand der Hosts zu
    # sehen ist eine Aufgabe des Betriebs, nicht der Serverplanung. Ein
    # Support-Mitarbeiter soll nachsehen koennen, ohne Server anlegen zu
    # duerfen.
    if not permission_service.has_global_permission(db, user, "nodes.read"):
        raise AiActionValidationError("Node-Einsicht ist nicht erlaubt")
    return _node_health(db)


werkzeug(
    _S_LIST_MY_SERVERS,
    art="global_read",
    hinweis="Listet die Server, die der Benutzer sieht.",
    global_handler=lies_serverliste,
)
werkzeug(
    _S_LIST_BLUEPRINTS,
    art="global_read",
    angebot=("servers.create",),
    hinweis="Listet die verfuegbaren Spiel-Blueprints.",
    global_handler=lies_blueprints,
)
werkzeug(
    _S_READ_BLUEPRINT,
    art="global_read",
    angebot=("servers.create", "blueprints.manage"),
    hinweis="Liest einen Blueprint samt Startbefehl und Variablen.",
    global_handler=lies_blueprint,
)
werkzeug(
    _S_READ_NODE_CAPACITY,
    art="global_read",
    angebot=("servers.create",),
    hinweis="Listet Nodes mit gebuchtem und echtem Speicherplatz.",
    global_handler=lies_node_kapazitaet,
)
werkzeug(
    _S_READ_NODE_HEALTH,
    art="global_read",
    angebot=("nodes.read",),
    hinweis="Liest den Zustand der Nodes.",
    global_handler=lies_node_zustand,
)


# --- Werkzeugvertrag: Platzierungsberatung --------------------------------

_ADVISE = _function(
    "advise_node_placement",
    "Empfiehlt einen Host fuer einen neuen Server. Nutze vor propose_server_create um RAM/Disk bewusst zu waehlen. Unterscheidet gebucht vs wirklich belegt.",
    {"ram_need_mb": {"type": "integer", "minimum": 512}, "disk_need_gb": {"type": "integer", "minimum": 1}},
    ["ram_need_mb"],
)

PLACEMENT_DEFINITIONEN = [_ADVISE]


def berate_node(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    if not permission_service.has_global_permission(db, user, "servers.create"):
        raise AiActionValidationError("Serverplanung ist nicht erlaubt")
    from services.node_advisor_service import advise_node

    ram = int(arguments.get("ram_need_mb", 2048))
    disk = int(arguments.get("disk_need_gb", 5))
    return {
        "advice": advise_node(db, ram, disk),
        "requested": {"ram_need_mb": ram, "disk_need_gb": disk},
    }


werkzeug(
    _ADVISE,
    art="global_read",
    gruppe="nodes",
    angebot=("servers.create",),
    hinweis="Empfiehlt einen Host nach gebuchtem und echtem Speicherplatz.",
    global_handler=berate_node,
)
