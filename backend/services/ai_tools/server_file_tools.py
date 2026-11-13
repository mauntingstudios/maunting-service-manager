"""Serverdateien lesen: Verzeichnis, Textsuche und Konfigurationsfenster.

Alle drei gehen durch `server_file_access_service` und pruefen dasselbe Recht
(`server.files.read`). Sie standen in der langen Kette in `server_tools`; die
Reihenfolge und die Wortlaute sind unveraendert.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Server, User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import (
    MAX_READ_CONFIG_CHARS,
    MAX_READ_CONFIG_LINES,
    MAX_SEARCH_CONTEXT_LINES,
    MAX_SEARCH_DEPTH,
    MAX_SEARCH_FILES,
    MAX_SEARCH_LINE_CHARS,
    MAX_SEARCH_MATCHES,
    MAX_SEARCH_QUERY_CHARS,
    _config_path,
    _positive_int,
    _server_function,
    is_binary_text,
)
from services.server_file_access_service import read_server_text

_LIST = _server_function(
    "list_server_files",
    "Listet ein Verzeichnis im Serververzeichnis auf. Ohne `path` die "
    "Wurzel. Nutze das, bevor du eine Datei liest — Dateinamen raten "
    "fuehrt zu Fehlversuchen.",
    {"path": {"type": "string", "maxLength": 256}},
)
_SEARCH = _server_function(
    "search_server_files",
    "Sucht Text in den Serverdateien; liefert Pfad und Zeile je "
    "Treffer. **Der erste Schritt bei grossen Dateien.** `path` auf "
    "Datei oder Verzeichnis grenzt ein; Teilstring, Gross-/"
    "Kleinschreibung egal.",
    {
        "query": {"type": "string", "maxLength": MAX_SEARCH_QUERY_CHARS},
        "path": {"type": "string", "maxLength": 256},
        "context": {
            "type": "integer",
            "minimum": 0,
            "maximum": MAX_SEARCH_CONTEXT_LINES,
            "description": "Zeilen vor und nach jedem Treffer.",
        },
    },
    ["query"],
)
_READ = _server_function(
    "read_config",
    "Liest eine Textdatei des Servers (alles, was der Dateimanager "
    f"zeigt). Ohne `offset` die ersten {MAX_READ_CONFIG_LINES} Zeilen; "
    "`total_lines` nennt die Laenge, `offset` springt zu einer "
    "Fundstelle. `editable: false` heisst **nur**: nicht ganz ersetzen "
    "— mit `patchable: true` per propose_config_patch aendern.",
    {
        "path": {"type": "string", "maxLength": 256},
        "offset": {
            "type": "integer",
            "minimum": 1,
            "description": "Erste Zeile des Fensters, 1-basiert.",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": MAX_READ_CONFIG_LINES,
            "description": "Zeilen im Fenster.",
        },
    },
    ["path"],
)

DEFINITIONEN = [_LIST, _SEARCH, _READ]


def lies_dateien(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    if set(arguments) - {"path"}:
        raise AiActionValidationError("Datei-Auflistung hat ungueltige Argumente")
    if not permission_service.has_server_permission(
        db, user, server.id, "server.files.read"
    ):
        raise AiActionValidationError("Datei-Lesezugriff ist nicht erlaubt")
    pfad = arguments.get("path") or ""
    # Die Wurzel ist der leere Pfad; alles andere geht durch dieselbe
    # Formpruefung wie beim Lesen.
    geprueft = _config_path(pfad) if pfad else ""
    from services.server_file_access_service import (
        MAX_LISTED_ENTRIES,
        list_server_directory,
    )

    return {
        "server_id": server.id,
        **list_server_directory(
            db,
            server_id=server.id,
            relative_path=geprueft,
            limit=MAX_LISTED_ENTRIES,
        ),
    }


def suche_dateien(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    """Sucht einen Text in einer Datei oder unterhalb eines Verzeichnisses.

    Der Anlass ist eine Datei von einem Megabyte: `read_config` zeigt ein
    Fenster von vierhundert Zeilen, die Datei hat dreizehntausend. Ohne Suche
    muesste das Modell dreissigmal blaettern, um eine Einstellung zu finden —
    also blaettert es nicht, sondern raet oder gibt auf.
    """
    if set(arguments) - {"path", "query", "context"} or "query" not in arguments:
        raise AiActionValidationError("Datei-Suche hat ungueltige Argumente")
    if not permission_service.has_server_permission(
        db, user, server.id, "server.files.read"
    ):
        raise AiActionValidationError("Datei-Lesezugriff ist nicht erlaubt")

    query = arguments["query"]
    if not isinstance(query, str) or not query.strip():
        raise AiActionValidationError("Suchbegriff fehlt")
    if len(query) > MAX_SEARCH_QUERY_CHARS:
        raise AiActionValidationError("Suchbegriff ist zu lang")
    query = query.strip()
    kontext = _positive_int(
        arguments.get("context"),
        name="context",
        default=0,
        minimum=0,
        maximum=MAX_SEARCH_CONTEXT_LINES,
    )
    wurzel = _config_path(arguments["path"]) if arguments.get("path") else ""

    from services.server_file_access_service import search_file_contents

    ergebnis = search_file_contents(
        db,
        server_id=server.id,
        query=query,
        relative_path=wurzel,
        context=kontext,
        max_files=MAX_SEARCH_FILES,
        max_depth=MAX_SEARCH_DEPTH,
        max_matches=MAX_SEARCH_MATCHES,
    )

    def sichtbar(zeile: str) -> str:
        # Redigieren **vor** dem Kuerzen: andersherum schnitte die Kuerzung ein
        # Geheimnis mitten durch, und die Redaktion erkennt es dann nicht mehr.
        return redact_sensitive_text(zeile)[:MAX_SEARCH_LINE_CHARS]

    treffer = []
    for roh in ergebnis["matches"]:
        eintrag = {
            "path": roh["path"],
            "line": roh["line"],
            "text": sichtbar(str(roh["text"])),
        }
        if "context" in roh:
            eintrag["context"] = [sichtbar(str(z)) for z in roh["context"]]
            eintrag["context_first_line"] = roh["context_first_line"]
        treffer.append(eintrag)

    return {
        "server_id": server.id,
        "path": wurzel,
        "query": query,
        "matches": treffer,
        "files_searched": ergebnis["files_searched"],
        "truncated": ergebnis["truncated"],
    }


def lies_konfiguration(db: Session, *, user: User, server: Server, arguments: dict) -> dict:
    if set(arguments) - {"path", "offset", "limit"} or "path" not in arguments:
        raise AiActionValidationError("Datei-Lesewerkzeug hat ungueltige Argumente")
    if not permission_service.has_server_permission(
        db, user, server.id, "server.files.read"
    ):
        raise AiActionValidationError("Datei-Lesezugriff ist nicht erlaubt")
    path = _config_path(arguments["path"])
    offset = _positive_int(arguments.get("offset"), name="offset", default=1, minimum=1)
    limit = _positive_int(
        arguments.get("limit"),
        name="limit",
        default=MAX_READ_CONFIG_LINES,
        minimum=1,
        maximum=MAX_READ_CONFIG_LINES,
    )
    import sys

    _mod = sys.modules.get("services.ai_action_service")
    _fn = getattr(_mod, "read_server_text", read_server_text) if _mod else read_server_text
    result = _fn(db, server_id=server.id, relative_path=path)
    content = str(result["content"])
    # Seit die Endungsliste weg ist, kann hier auch eine Binaerdatei landen —
    # ein Mod-Jar, ein Weltdatei-Chunk. `read_text` dekodiert mit
    # `errors="replace"`; wuerde das Modell den Salat zurueckschreiben, waere
    # die Datei zerstoert.
    binaer = is_binary_text(content)
    redacted = redact_sensitive_text(content)
    was_redacted = redacted != content

    zeilen = redacted.splitlines(keepends=True)
    fenster = zeilen[offset - 1 : offset - 1 + limit]
    sicht = "".join(fenster)
    zeichen_gekuerzt = len(sicht) > MAX_READ_CONFIG_CHARS
    sicht = sicht[:MAX_READ_CONFIG_CHARS]
    # "Vollstaendig" heisst: dieses Fenster **ist** die Datei. Nur dann hat das
    # Modell den ganzen Stand gesehen.
    vollstaendig = offset == 1 and len(fenster) == len(zeilen) and not zeichen_gekuerzt

    # `editable` — darf die Datei **ganz** ersetzt werden? Nur wenn das Modell
    # sie ganz und unveraendert gesehen hat. `patchable` — darf **eine Stelle**
    # ersetzt werden? Dafuer genuegt, dass es Text ist.
    editable = vollstaendig and not was_redacted and not binaer
    patchable = not binaer
    grund = (
        "Diese Datei ist keine Textdatei. Automatisch aendern wuerde sie "
        "zerstoeren. Bitte nicht anfassen."
        if binaer
        else "Diese Datei wurde gekuerzt oder redigiert gelesen und kann "
        "deshalb nicht als Ganzes ersetzt werden. Aendere sie mit "
        "propose_config_patch — dabei bleibt alles Ungesehene unberuehrt."
    )
    return {
        "path": path,
        "revision": result["revision"] if patchable else None,
        # Von einer Binaerdatei geht nichts in den Kontext.
        "content": "" if binaer else sicht,
        "offset": offset,
        "lines": 0 if binaer else len(fenster),
        "total_lines": 0 if binaer else len(zeilen),
        "truncated": not vollstaendig,
        "redacted": was_redacted,
        "binary": binaer,
        "editable": editable,
        "patchable": patchable,
        **({} if editable else {"edit_blocked_reason": grund}),
    }


werkzeug(
    _LIST,
    art="server_read",
    gruppe="files",
    angebot=("server.files.read",),
    hinweis="Listet ein Verzeichnis im Serververzeichnis auf.",
    handler=lies_dateien,
)
werkzeug(
    _SEARCH,
    art="server_read",
    gruppe="files",
    angebot=("server.files.read",),
    hinweis="Sucht Text in Serverdateien und liefert Pfad und Zeile.",
    handler=suche_dateien,
)
werkzeug(
    _READ,
    art="server_read",
    gruppe="files",
    angebot=("server.files.read",),
    hinweis="Liest ein Zeilenfenster einer Serverdatei, redigiert und gekuerzt.",
    handler=lies_konfiguration,
)
