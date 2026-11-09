"""Hoster-Anbindung lesen: Einrichtung und Einbindungsblock.

Beide Werkzeuge stehen hinter `panel.hoster.read` und geben keine Schluessel
heraus. Die Handler standen in der langen Kette in `server_tools`.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import User
from services.ai_action_errors import AiActionValidationError
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import _function, _positive_int, _require_no_arguments

_SETUP = _function(
            "read_hoster_setup",
            "Zeigt die Hoster-API- und WHMCS-Shop-Anbindung (Server-Hosting-"
            "Verkauf): Integrationen mit Slug, Dienstbenutzer, Webhook und "
            "Kuendigungsfrist, Produktzuordnungen, vergebene Slugs, taugliche "
            "Dienstbenutzer und die Rollen, die **dieser** Benutzer vergeben "
            "darf, samt KI-Kontingent (`null` = unbegrenzt; unter mehreren "
            "Rollen gewinnt der hoechste Wert). Keine Schluessel.\n"
            "**Ruf das auf, bevor du etwas zur Shop-Einrichtung vorschlaegst** "
            "— Slug, Dienstbenutzer und Produktkennung nie raten.\n"
            "`withheld` heisst: vorhanden, aber fuer dich nicht sichtbar — nicht "
            "dasselbe wie leer.",
            {},
            [],
        )
_EINBINDUNG = _function(
            "read_hoster_integration_guide",
            "Technischer Einbindungsblock einer **bestehenden** Integration: "
            "Basis-Adresse, Header, Endpunkte, Zustaende, Events, Webhook-Header "
            "und Produktkennungen. **Gib den Block unveraendert weiter** — kein "
            "Wert umformuliert, ergaenzt oder weggelassen; erklaeren darfst du "
            "drumherum. Die `status_code`-Werte erklaert die Doku (Abschnitt "
            "steht im Block).",
            {
                "integration_id": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Aus read_hoster_setup. Nie raten.",
                },
            },
            ["integration_id"],
        )

DEFINITIONEN = [_SETUP, _EINBINDUNG]


def lies_setup(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    from services import ai_hoster_tools

    _require_no_arguments("read_hoster_setup", arguments)
    return ai_hoster_tools.setup_uebersicht(db, user=user)


def lies_einbindung(db: Session, *, user: User, arguments: dict, lauf: dict | None = None) -> dict:
    from services import ai_hoster_tools

    if set(arguments) != {"integration_id"}:
        raise AiActionValidationError("Hoster-Werkzeug hat ungueltige Argumente")
    roh = arguments.get("integration_id")
    if roh is None:
        raise AiActionValidationError(
            "integration_id fehlt — hol sie aus read_hoster_setup"
        )
    kennung = _positive_int(roh, name="integration_id", default=0, minimum=1)
    return ai_hoster_tools.integration_guide(db, user=user, integration_id=kennung)


werkzeug(
    _SETUP,
    art="global_read",
    angebot=("panel.hoster.read",),
    hinweis="Zeigt Hoster- und Shop-Anbindung, Produkte und Slugs.",
    global_handler=lies_setup,
)
werkzeug(
    _EINBINDUNG,
    art="global_read",
    angebot=("panel.hoster.read",),
    hinweis="Gibt den technischen Einbindungsblock einer Integration aus.",
    global_handler=lies_einbindung,
)
