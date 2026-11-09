"""Prueft Werkzeugargumente gegen das Schema, das dem Modell angeboten wurde.

Bis hierher war `additionalProperties: false` eine Zusage ohne Wirkung: jeder
Handler pruefte von Hand, und ein falsch getipptes Feld kam entweder gar nicht
an oder wurde still ignoriert. `jsonschema` ist die Standardauslegung genau
der Sprache, in der die Schemas schon geschrieben sind — eine eigene
Mini-Pruefung waere eine zweite Wahrheit daneben.

Geprueft wird nur, wofuer es eine `ToolSpec` gibt. Die noch nicht umgestellten
Werkzeuge behalten ihren bisherigen Weg; mit jeder Domaene waechst die
Abdeckung, ohne dass sich an den alten Werkzeugen etwas aendert.
"""

from __future__ import annotations

import logging
import os

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from services.ai_action_errors import AiActionValidationError

# Der Import fuellt `ALLE`: die Domaenenmodule registrieren ihre Specs beim
# Import der Registry. Ohne ihn waere die Pruefung still wirkungslos, wenn
# jemand sie vor dem ersten KI-Aufruf benutzt.
import services.ai_tool_registry  # noqa: F401
from services.ai_tool_spec import ALLE

logger = logging.getLogger(__name__)

_VALIDATOREN: dict[str, Draft202012Validator] = {}


def _validator(tool_name: str) -> Draft202012Validator:
    if tool_name not in _VALIDATOREN:
        parameter = ALLE[tool_name].funktion["function"]["parameters"]
        _VALIDATOREN[tool_name] = Draft202012Validator(parameter)
    return _VALIDATOREN[tool_name]


def _grund(fehler: ValidationError) -> str:
    """Ein Grund ohne den Wert.

    `fehler.message` nennt den eingegangenen Wert im Klartext. Der gehoert
    nicht in eine Meldung, die im Chatverlauf landet — Argumente koennen
    Nachrichtentexte, Adressen oder Schluessel tragen.
    """
    if fehler.validator == "required":
        fehlend = fehler.validator_value
        if isinstance(fehlend, (list, tuple)):
            fehlend = ", ".join(str(teil) for teil in fehlend)
        return f"Pflichtfeld fehlt: {fehlend}"
    if fehler.validator == "type":
        return f"falscher Typ, erwartet {fehler.validator_value}"
    if fehler.validator == "additionalProperties":
        return "unerlaubtes Feld"
    if fehler.validator == "enum":
        return "Wert nicht in der erlaubten Auswahl"
    if fehler.validator in {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"}:
        return "Wert ausserhalb der erlaubten Grenze"
    if fehler.validator in {"minLength", "maxLength", "pattern"}:
        return "Wert passt nicht zur erlaubten Form"
    if fehler.validator in {"minItems", "maxItems", "uniqueItems"}:
        return "Liste passt nicht zur erlaubten Form"
    return f"Schema-Regel {fehler.validator} verletzt"


def pruefe_argumente(
    tool_name: str, arguments: dict, *, aliase: frozenset[str] = frozenset()
) -> None:
    """Wirft `AiActionValidationError`, wenn das Schema den Aufruf ablehnt.

    `aliase` sind Schreibweisen, die der Vorschlagspfad bewusst akzeptiert
    (`grund` neben `reason`), die aber nicht im Schema stehen. Sie werden
    verworfen, wenn das Schema sie nicht selbst nennt; die kanonische Form
    bleibt und erfuellt `required`.

    `MSM_AI_ARG_VALIDATION=loggen` protokolliert nur. Das ist fuer die
    Umstellungszeit gedacht: ein Schema, das einen bisher erlaubten Aufruf
    ablehnt, faellt dann im Log auf, statt den Lauf zu beenden.
    """
    if tool_name not in ALLE:
        return
    validator = _validator(tool_name)
    if aliase:
        properties = validator.schema.get("properties", {})
        arguments = {
            key: value
            for key, value in arguments.items()
            if not (key in aliase and key not in properties)
        }
    fehler = next(validator.iter_errors(arguments), None)
    if fehler is None:
        return
    pfad = "/".join(str(teil) for teil in fehler.absolute_path) or "(root)"
    text = f"Ungueltige Argumente fuer {tool_name}: {pfad}: {_grund(fehler)}"[:200]
    if os.getenv("MSM_AI_ARG_VALIDATION", "streng").strip().lower() in {"loggen", "log"}:
        logger.warning("%s", text)
        return
    raise AiActionValidationError(text)
