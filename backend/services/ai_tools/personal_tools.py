from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session
from models import User
from services import permission_service
from services.ai_action_errors import AiActionValidationError
from services.ai_redaction import redact_sensitive_text
from services.ai_tools.base import (
    _function,
    _positive_int,
    _RATIONALE_SCHEMA,
    _RATIONALE_REQUIRED,
    MAX_KALENDER_VORKOMMEN,
    MAX_LISTED_POPUPS,
    MAX_POPUP_INHALT_CHARS,
    MAX_TESTMAILS_JE_STUNDE,
)
from services.ai_tool_spec import spaet, spaet_vorschlag, werkzeug

logger = logging.getLogger(__name__)

_NUR_DATUM = re.compile(r"\d{4}-\d{2}-\d{2}|\d{8}")

# Lokaler Zaehler fuer Test-E-Mails je Benutzer und Stunde
_TESTMAILS: dict[int, list[float]] = {}

# Wiederholung als **Feld** an den beiden bestehenden Terminwerkzeugen statt
# als eigenes Werkzeug. Drei Gruende, in der Reihenfolge ihres Gewichts:
#
# 1. Ein Termin mit Wiederholung ist derselbe Vorgang mit einem Feld mehr,
#    nicht eine zweite Handlung. Zwei Werkzeuge haetten das Modell vor eine
#    Wahl gestellt, die es nicht zu treffen hat — und `propose_task_set` wie
#    `propose_popup_set` machen es aus demselben Grund schon so.
# 2. `propose_calendar_event_create` steht fest im Sprachweg
#    (`realtime_session.realtime_static_extra` und `HOTSET`). Ein neues
#    Werkzeug haette dort und bei Gemini Live einzeln nachgetragen werden
#    muessen; eine Faehigkeit, die nur im Chatweg steht, fehlt im Sprachweg.
# 3. Der Katalog geht in **jeder** Runde mit. Dieses Feld kostet rund 350
#    Zeichen, ein eigenes Werkzeug rund 900 (test_ai_tool_handler_contract).
#
# Die Wochentage stehen deutsch im Schema, werden aber in beiden Sprachen
# gelesen (`serie_aus_werkzeug`): MO, FR und SA meinen hier wie dort denselben
# Tag, es gibt also nichts zu verwechseln.
# Bewusst karg beschrieben. Beim Bau lag der Desktop-Katalog bei 91.908 von
# 92.000 Zeichen — 92 Zeichen Luft, weil eine ausfuehrliche Fassung dieses
# Schemas 1.664 Zeichen kostete (832 je Werkzeug, es steht an zweien).
#
# Was das Modell **wissen** muss, steht deshalb in `ai_prompt`: dass
# Wiederkehrendes eine Wiederholung ist und nicht zwanzig Einzeltermine, dass
# `wochentage` nur zum woechentlichen Takt gehoert, dass `bis` und `anzahl`
# einander ausschliessen. Der Systemprompt wird zwischengespeichert, der
# Katalog geht in **jeder** Runde ungecacht mit — dieselbe Auskunft ist dort
# um ein Vielfaches billiger.
#
# Die Feldnamen tragen den Rest: `takt`, `intervall`, `wochentage`, `bis`,
# `anzahl` sagen auf Deutsch, was sie meinen. Gelesen werden die Wochentage in
# beiden Sprachen (`serie_aus_werkzeug`); MO, FR und SA meinen hier wie dort
# denselben Tag.
_WIEDERHOLUNG_SCHEMA = {
    "type": "object",
    "description": "Optionale Wiederholung. Ohne Angabe einmalig.",
    "properties": {
        "takt": {
            "type": "string",
            "enum": ["taeglich", "woechentlich", "monatlich", "jaehrlich"],
        },
        "intervall": {"type": "integer", "minimum": 1},
        "wochentage": {
            "type": "array",
            "items": {"type": "string", "enum": ["MO", "DI", "MI", "DO", "FR", "SA", "SO"]},
        },
        "bis": {"type": "string", "description": "YYYY-MM-DD"},
        "anzahl": {"type": "integer", "minimum": 1},
    },
}

def _mailbox_and_calendar_tool_definitions() -> list[dict]:
    """E-Mail- und Kalender-Werkzeuge (Verknüpfte Postfächer und Kalender)."""
    return [
        _function(
            "email_search",
            "Sucht in den verknüpften Postfächern des Benutzers nach E-Mails. "
            "Liefert Betreff, Absender, Empfänger, Datum und Nachrichten-ID.",
            {
                "query": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Suchbegriff für Betreff oder Inhalt.",
                },
                "sender": {
                    "type": "string",
                    "maxLength": 255,
                    "description": "Filter nach Absender-Adresse oder Name.",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 25,
                    "description": "Maximale Anzahl Ergebnisse (Standard: 10).",
                },
                "mailbox_id": {
                    "type": "integer",
                },
            },
            [],
        ),
        _function(
            "email_read",
            "Liest den bereinigten Volltext einer E-Mail anhand ihrer Nachrichten-ID (aus email_search).",
            {
                "message_id": {
                    "type": "string",
                    "maxLength": 128,
                    "description": "ID der Nachricht aus email_search.",
                },
                "mailbox_id": {
                    "type": "integer",
                },
            },
            ["message_id"],
        ),
        _function(
            "calendar_read",
            "Liest Termine aus dem verknüpften Kalender des Benutzers.",
            {
                "start_date": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "YYYY-MM-DD oder ISO-8601.",
                },
                "end_date": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "Wie start_date.",
                },
                "calendar_id": {
                    "type": "integer",
                },
            },
            [],
        ),
        _function(
            "propose_email_send",
            "Schlägt eine E-Mail über ein verknüpftes Postfach vor.",
            {
                "recipient": {
                    "type": "string",
                    "maxLength": 255,
                },
                "subject": {
                    "type": "string",
                    "maxLength": 255,
                },
                "body_text": {
                    "type": "string",
                    "maxLength": 8000,
                    "description": "Vollständiger Textinhalt der E-Mail.",
                },
                "body_html": {
                    "type": "string",
                    "maxLength": 16000,
                },
                "mailbox_id": {
                    "type": "integer",
                    "description": "Absender-Postfach; leer = Standard.",
                },
                **_RATIONALE_SCHEMA,
            },
            ["recipient", "subject", "body_text", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_calendar_event_create",
            "Schlägt einen neuen Termin vor (je Termin ein Aufruf; ohne genannte Endzeit eine Stunde).",
            {
                "title": {
                    "type": "string",
                    "maxLength": 255,
                },
                "start_time": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "Etwa 2026-08-26 14:00 oder ISO-8601.",
                },
                "end_time": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "Wie start_time.",
                },
                "description": {
                    "type": "string",
                    "maxLength": 2000,
                },
                "location": {
                    "type": "string",
                    "maxLength": 255,
                    "description": "Optionaler Ort oder Meeting-Link.",
                },
                "calendar_id": {
                    "type": "integer",
                },
                "event_type": {
                    "type": "string",
                    "enum": ["personal", "team", "server", "node"],
                    "description": "Standard personal; server = Wartung, node = Infrastruktur.",
                },
                "team_id": {
                    "type": "integer",
                    "description": "Bei event_type=team.",
                },
                "server_id": {
                    "type": "integer",
                    "description": "Bei event_type=server.",
                },
                "color": {
                    "type": "string",
                    "description": "blue, green, purple, amber, red oder cyan.",
                },
                "recurrence": _WIEDERHOLUNG_SCHEMA,
                **_RATIONALE_SCHEMA,
            },
            ["title", "start_time", "end_time", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_calendar_event_update",
            "Ändert oder verschiebt einen bestehenden Termin (neue: propose_calendar_event_create). Nur genannte Felder ändern sich.",
            {
                "event_id": {
                    "type": "string",
                    "maxLength": 255,
                    "description": "Aus calendar_read.",
                },
                "title": {
                    "type": "string",
                    "maxLength": 255,
                },
                "start_time": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "Etwa 2026-08-26 15:00 oder ISO-8601.",
                },
                "end_time": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "Neue Endzeit (z. B. 2026-08-26 16:00 oder ISO-8601).",
                },
                "description": {
                    "type": "string",
                    "maxLength": 2000,
                },
                "location": {
                    "type": "string",
                    "maxLength": 255,
                },
                "calendar_id": {
                    "type": "integer",
                },
                "event_type": {
                    "type": "string",
                    "enum": ["personal", "team", "server", "node"],
                },
                "team_id": {
                    "type": "integer",
                },
                "server_id": {
                    "type": "integer",
                },
                "color": {
                    "type": "string",
                },
                "recurrence": _WIEDERHOLUNG_SCHEMA,
                **_RATIONALE_SCHEMA,
            },
            ["event_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_calendar_event_delete",
            "Schlägt das Löschen eines Termins aus dem Kalender vor.",
            {
                "event_id": {
                    "type": "string",
                    "maxLength": 255,
                    "description": "ID des zu löschenden Termins.",
                },
                "calendar_id": {
                    "type": "integer",
                },
                **_RATIONALE_SCHEMA,
            },
            ["event_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "popups_read",
            "Listet die Panel-Pop-ups (Ankündigungen) mit Kennung, Titel, Text, "
            "Zeitfenster und Aktivität — die `popup_id` für propose_popup_set.",
            {
                "only_active": {
                    "type": "boolean",
                    "description": "Nur aktiv geschaltete Pop-ups (Standard: alle).",
                },
            },
            [],
        ),
        _function(
            "propose_popup_set",
            "Schlägt ein panelweites Pop-up (Ankündigung) vor: ohne `popup_id` "
            "neu, mit `popup_id` aus popups_read als Änderung. Inhalt in sauberem "
            "Markdown, menschlich, ohne KI-Schablonen oder Gedankenstrich-Ketten.",
            {
                "popup_id": {
                    "type": "integer",
                    "description": "Leer = neues Pop-up.",
                },
                "title": {
                    "type": "string",
                    "maxLength": 255,
                },
                "content_markdown": {
                    "type": "string",
                    "maxLength": 32000,
                    "description": "Beim Ändern der ganze neue Text.",
                },
                "is_active": {
                    "type": "boolean",
                    "description": "Beim Anlegen Standard true.",
                },
                "start_at": {
                    "type": ["string", "null"],
                    "maxLength": 32,
                    "description": "ISO-8601; null entfernt.",
                },
                "end_at": {
                    "type": ["string", "null"],
                    "maxLength": 32,
                    "description": "ISO-8601; null entfernt.",
                },
                "button_text": {
                    "type": ["string", "null"],
                    "maxLength": 100,
                    "description": "Zusätzlicher Button; null entfernt.",
                },
                "button_url": {
                    "type": ["string", "null"],
                    "maxLength": 2048,
                    "description": "http(s); null entfernt.",
                },
                **_RATIONALE_SCHEMA,
            },
            [*_RATIONALE_REQUIRED],
        ),
    ]

def _notes_tool_definitions() -> list[dict]:
    """Notiz-Werkzeuge (Persönliche und geteilte Notizen, Aufgaben und Checklisten)."""
    return [
        _function(
            "notes_read",
            "Liest oder durchsucht die Notizen des Benutzers.",
            {
                "query": {
                    "type": "string",
                    "maxLength": 200,
                },
                "category": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "shopping, todo, work, idea, meeting oder personal.",
                },
                "team_id": {
                    "type": "integer",
                    "description": "0 = nur persönliche.",
                },
                "is_pinned": {
                    "type": "boolean",
                },
            },
            [],
        ),
        _function(
            "propose_note_create",
            "Schlägt eine neue Notiz, Checkliste oder Einkaufsliste vor. Übersichtlich "
            "in Markdown, Checklisten als [ ] / [x], Einkaufslisten mit geschätzten "
            "Richtpreisen und Gesamtsumme.",
            {
                "title": {
                    "type": "string",
                    "maxLength": 255,
                    "description": "Etwa 'Einkaufsliste Edeka'.",
                },
                "content": {
                    "type": "string",
                    "maxLength": 32000,
                    "description": "Markdown.",
                },
                "category": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "personal, shopping, todo, work, idea oder meeting.",
                },
                "color": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "primary, emerald, amber, rose, purple oder cyan.",
                },
                "is_pinned": {
                    "type": "boolean",
                },
                "note_type": {
                    "type": "string",
                    "maxLength": 32,
                    "description": "personal oder team.",
                },
                "team_id": {
                    "type": "integer",
                    "description": "Bei note_type team.",
                },
                **_RATIONALE_SCHEMA,
            },
            ["title", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_note_update",
            "Schlägt die Bearbeitung oder Ergänzung einer bestehenden Notiz vor.",
            {
                "note_id": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "ID oder UID der zu bearbeitenden Notiz.",
                },
                "title": {
                    "type": "string",
                    "maxLength": 255,
                },
                "content": {
                    "type": "string",
                    "maxLength": 32000,
                },
                "category": {
                    "type": "string",
                    "maxLength": 64,
                },
                "color": {
                    "type": "string",
                    "maxLength": 32,
                },
                "is_pinned": {
                    "type": "boolean",
                },
                "is_archived": {
                    "type": "boolean",
                },
                "note_type": {
                    "type": "string",
                    "maxLength": 32,
                },
                "team_id": {
                    "type": "integer",
                },
                **_RATIONALE_SCHEMA,
            },
            ["note_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "propose_note_delete",
            "Schlägt das Löschen einer Notiz vor.",
            {
                "note_id": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "ID oder UID der zu löschenden Notiz.",
                },
                **_RATIONALE_SCHEMA,
            },
            ["note_id", *_RATIONALE_REQUIRED],
        ),
        _function(
            "execute_server_action",
            "Führt eine Server-, Mod-, Backup-, Konfigurations- oder Verwaltungsaktion aus, "
            "für die gerade kein eigenes Werkzeug angeboten ist (etwa Ports abfragen, Mods "
            "installieren, Backup anlegen, Aufgaben planen).",
            {
                "action": {
                    "type": "string",
                    "maxLength": 500,
                    "description": "In natürlicher Sprache.",
                },
                "server_id": {
                    "type": "integer",
                },
                "tool_name": {
                    "type": "string",
                    "maxLength": 64,
                },
                "parameters": {
                    "type": "object",
                },
            },
            [],
        ),
    ]

def _attachment_tool_definitions() -> list[dict]:
    """Werkzeuge fuer Chat-Dateianhaenge (Suche nach Name/Zeit und Volltextabruf)."""
    return [
        _function(
            "search_chat_attachments",
            "Sucht im Chat hochgeladene Dateien (nach Name, Inhalt oder Upload-Zeitpunkt).",
            {
                "query": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Dateiname oder Suchbegriff im Text.",
                },
                "referenz_zeit": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Ungefährer Upload-Zeitpunkt (z. B. '2026-10-29T14:00:00Z').",
                },
                "toleranz_stunden": {
                    "type": "number",
                    "description": "Suchfenster in Stunden vor und nach der Referenzzeit (Standard: 2.0).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximale Anzahl an Treffern (1 bis 20, Standard: 5).",
                },
            },
            [],
        ),
        _function(
            "read_chat_attachment",
            "Liest den extrahierten Text oder Inhalt einer Datei anhand ihrer attachment_id.",
            {
                "attachment_id": {
                    "type": "string",
                    "maxLength": 36,
                    "description": "Die 36-stellige UUID des Anhangs.",
                },
            },
            ["attachment_id"],
        ),
    ]

def _execute_send_test_email(db: Session, *, user: User) -> dict:
    """Schickt eine Testmail an die eigene Adresse des Fragenden.

    **Kein Empfaengerparameter.** Das ist die eigentliche Sicherheitsaussage
    dieses Werkzeugs: es gibt keinen Weg von einer Modellausgabe zu einer
    fremden Adresse, also kann MSM ueber die KI kein Mailversender fuer Dritte
    werden. Ein `to`-Argument haette genau das eroeffnet — und waere aus dem
    Chat heraus mit einem Satz auszuloesen gewesen.

    Zurueck kommt, was der Benutzer zum Nachsehen braucht: ob es rausging, an
    welches Postfach (maskiert) und **welche Art** von Versandweg benutzt wurde.
    Bewusst nicht der SMTP-Host: das ist Betreiberkonfiguration, die ein Kunde
    im Panel nur mit `panel.settings.read` zu sehen bekaeme. Fuer die Diagnose
    genuegt "es lief ueber SMTP" — wo die Einstellungen stehen, weiss der
    Betreiber selbst.

    Der Versand laeuft ueber `ai_mail` und damit ueber denselben Weg wie jede
    andere Mail der KI. Genau das macht die Pruefung aussagekraeftig: getestet
    wird nicht irgendein Mailversand, sondern **der**, den auch ein
    Aufgabenbericht nehmen wuerde.
    """
    import time

    from services import ai_mail
    from services.ai_redaction import maskiere_email
    from services.email_service import EmailService

    jetzt = time.monotonic()
    verlauf = [wann for wann in _TESTMAILS.get(user.id, []) if jetzt - wann < 3600]
    if len(verlauf) >= MAX_TESTMAILS_JE_STUNDE:
        _TESTMAILS[user.id] = verlauf
        return {
            "sent": False,
            "reason": "rate_limited",
            "detail": (
                f"In dieser Stunde wurden bereits {MAX_TESTMAILS_JE_STUNDE} "
                "Testmails verschickt. Sag dem Benutzer, er soll im Postfach "
                "und im Spam-Ordner nachsehen, statt es erneut zu versuchen."
            ),
        }

    # `empfaenger` prueft die drei Bedingungen, die auch fuer jede andere KI-Mail
    # gelten. Ein Test, der sie umginge, testete etwas anderes als den Ernstfall.
    adresse = ai_mail.empfaenger(db, user)
    if adresse is None:
        return {
            "sent": False,
            "reason": "not_deliverable",
            "detail": (
                "Es gibt keinen Weg zu diesem Benutzer: entweder sind seine "
                "E-Mail-Benachrichtigungen aus, oder der Betreiber hat im Panel "
                "keinen Versand eingerichtet, oder am Konto haengt keine "
                "Adresse. Nenne ihm diese drei Moeglichkeiten."
            ),
        }

    verlauf.append(jetzt)
    _TESTMAILS[user.id] = verlauf

    # Auch die Testmail schreibt die KI selbst — der Betreiber hat
    # ausdruecklich verlangt, dass hier nichts Vorgefertigtes mehr steht. Der
    # Verfassungsschritt liegt aber nicht mehr hier, sondern im Arbeiter am
    # Ausgangskorb: dort steht er innerhalb einer Schranke und ueberlebt einen
    # Neustart. Was hier entsteht, ist der Rueckfall — und bei genau dieser Mail
    # ist er wichtiger als bei den anderen beiden. Sie ist das Messgeraet fuer
    # den Versandweg und darf nicht ausgerechnet dann ausbleiben, wenn das
    # Modell klemmt.
    rahmen = EmailService.ai_rahmen_test(str(user.username))
    betreff, text, html = EmailService.ai_mail_rendern(
        rahmen, rueckfall=EmailService.AI_TESTMAIL_RUECKFALL
    )
    ai_mail.zustellen(
        name="ai-test-email",
        db=db,
        user_id=int(user.id),
        betreff=betreff,
        text=text,
        html=html,
        fakten=(
            "Anlass: der Benutzer hat im Chat um eine Testmail gebeten, "
            "um den eingerichteten Versandweg des Panels zu pruefen.\n"
            "Es ist nichts passiert, worueber zu berichten waere — die Mail "
            "beweist sich selbst, indem sie ankommt.\n"
            "Sag ihm in zwei bis drei Saetzen, dass der Versandweg damit "
            "nachgewiesen ist und dass auch die Berichte zu seinen Aufgaben "
            "und zu behobenen Stoerungen diesen Weg nehmen."
        ),
        rahmen=rahmen,
    )
    return {
        "sent": True,
        "recipient": maskiere_email(adresse),
        "transport": EmailService._get_provider(),
        "detail": (
            "Die Mail wurde dem Versand uebergeben. Ob sie ankommt, entscheidet "
            "der Weg dahinter — sag dem Benutzer, er soll jetzt nachsehen, auch "
            "im Spam-Ordner. Kommt nichts an, liegt es an der Einrichtung des "
            "Versands im Panel und nicht an dir."
        ),
    }


# --- Werkzeugvertrag -------------------------------------------------------
#
# Ab hier steht die Ausfuehrung bei ihrem Fach. Die Handler unten sind aus der
# langen Kette in `server_tools._execute_global_read_tool` hierher gezogen,
# woertlich bis auf die Signatur. Die Vorschlaege bleiben, wo sie sind; die
# Spec zeigt ueber `spaet`/`spaet_vorschlag` darauf.


def _lies_email_suche(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    if not permission_service.has_global_permission(db, user, "ai.mailbox.use"):
        raise AiActionValidationError("Postfach-Einsicht ist nicht erlaubt")
    from services.mailbox_service import MailboxService

    query = str(arguments.get("query", "")) if arguments.get("query") else None
    sender = str(arguments.get("sender", "")) if arguments.get("sender") else None
    # Gedeckelt und getippt statt `int(...)`: ein `int("alle")` riss den Lauf
    # ab, und ein `limit: 1000000` war eine Postfachabfrage ohne Obergrenze.
    limit = _positive_int(
        arguments.get("limit"), name="limit", default=10, minimum=1, maximum=100
    )
    mailbox_id = _positive_int(
        arguments.get("mailbox_id"), name="mailbox_id", default=0, minimum=1
    ) or None
    messages = MailboxService.search_messages(
        db, user=user, mailbox_id=mailbox_id, query=query, sender=sender, limit=limit
    )
    return {"messages": messages, "count": len(messages)}


def _lies_email(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    if not permission_service.has_global_permission(db, user, "ai.mailbox.use"):
        raise AiActionValidationError("Postfach-Einsicht ist nicht erlaubt")
    from services.mailbox_service import MailboxService

    if "message_id" not in arguments:
        raise AiActionValidationError("message_id ist erforderlich")
    message_id = str(arguments["message_id"]).strip()
    mailbox_id = _positive_int(
        arguments.get("mailbox_id"), name="mailbox_id", default=0, minimum=1
    ) or None
    msg = MailboxService.read_message(
        db, user=user, message_id=message_id, mailbox_id=mailbox_id
    )
    if not msg:
        return {"error": "Nachricht nicht gefunden oder Postfach nicht erreichbar"}
    return msg


def _lies_notizen(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    if not (
        permission_service.has_global_permission(db, user, "notes.use")
        and permission_service.has_global_permission(db, user, "ai.notes.use")
    ):
        raise AiActionValidationError("Notiz-Einsicht ist nicht erlaubt")
    from services.notes_service import NotesService

    query = str(arguments.get("query", "")) if arguments.get("query") else None
    category = str(arguments.get("category", "")) if arguments.get("category") else None
    team_id = int(arguments["team_id"]) if arguments.get("team_id") is not None else None
    is_pinned = bool(arguments["is_pinned"]) if arguments.get("is_pinned") is not None else None
    notes = NotesService.get_notes(
        db, user=user, search=query, category=category, team_id=team_id, is_pinned=is_pinned
    )
    return {"notes": notes, "count": len(notes)}


def _lies_popups(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    # Dasselbe Recht wie das Schreibwerkzeug und nicht `panel.settings.read`:
    # wer der KI keine Ankuendigungen erlaubt, soll ihr auch die bestehenden
    # nicht vorlegen.
    if not permission_service.has_global_permission(db, user, "ai.popups.manage"):
        raise AiActionValidationError("Pop-up-Einsicht ist nicht erlaubt")
    if set(arguments) - {"only_active"}:
        raise AiActionValidationError("Pop-up-Tool hat ungueltige Argumente")
    from models import PanelPopup

    abfrage = db.query(PanelPopup).order_by(PanelPopup.id.desc())
    # Nachsichtig gelesen: das Schema sagt `boolean`, aber ein Modell schickt
    # auch mal den String "false" — und der ist als Wahrheitswert wahr.
    if str(arguments.get("only_active", "")).strip().lower() in ("true", "1"):
        abfrage = abfrage.filter(PanelPopup.is_active.is_(True))
    popups = abfrage.limit(MAX_LISTED_POPUPS).all()
    eintraege = []
    for popup in popups:
        inhalt = redact_sensitive_text(str(popup.content_markdown or ""))
        gekuerzt = len(inhalt) > MAX_POPUP_INHALT_CHARS
        eintraege.append({
            "popup_id": popup.id,
            "title": redact_sensitive_text(str(popup.title or "")),
            "content_markdown": inhalt[:MAX_POPUP_INHALT_CHARS],
            # Die Marke ist keine Kosmetik: `propose_popup_set` ersetzt den
            # Inhalt vollstaendig. Wer einen gekuerzten Text zurueckschreibt,
            # loescht den Rest des Pop-ups, ohne es zu merken.
            "content_truncated": gekuerzt,
            "is_active": bool(popup.is_active),
            "start_at": popup.start_at.isoformat() if popup.start_at else None,
            "end_at": popup.end_at.isoformat() if popup.end_at else None,
            "button_text": redact_sensitive_text(str(popup.button_text))
            if popup.button_text
            else None,
            "button_url": popup.button_url or None,
        })
    return {"popups": eintraege, "count": len(eintraege)}


def _lies_kalender(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    if not (
        permission_service.has_global_permission(db, user, "calendar.use")
        and permission_service.has_global_permission(db, user, "ai.calendar.use")
    ):
        raise AiActionValidationError("Kalender-Einsicht ist nicht erlaubt")
    from services.calendar_service import CalendarService

    start_date = str(arguments.get("start_date", "")) if arguments.get("start_date") else None
    end_date = str(arguments.get("end_date", "")) if arguments.get("end_date") else None
    calendar_id = _positive_int(
        arguments.get("calendar_id"), name="calendar_id", default=0, minimum=1
    ) or None
    # Ausgebreitete Vorkommen, nicht Serienkoepfe: auf "was steht naechste
    # Woche an" ist ein Geburtstag von 1995 die richtige Antwort.
    from datetime import date as _datum, timedelta as _zeitspanne

    from services.calendar_service import _parse_datetime as _kalender_zeit

    # Ohne Zeitraum braucht es trotzdem einen: eine Serie ohne Ende liefe sonst
    # bis an die Schrittgrenze. Ein Jahr voraus und ein Monat zurueck ist das,
    # was "was steht an" gewoehnlich meint.
    jetzt = datetime.now(timezone.utc)
    von = _kalender_zeit(start_date, user=user) if start_date else jetzt - _zeitspanne(days=30)
    if end_date and _NUR_DATUM.fullmatch(end_date.strip()):
        # Ein reines Datum als Ende meint den **ganzen** Tag. Das Fensterende
        # ist Mitternacht des Folgetags, in der Benutzerzone gerechnet und
        # nicht als UTC + 24 h — ueber eine Zeitumstellung ist ein Tag 23 oder
        # 25 Stunden lang.
        folgetag = _datum.fromisoformat(end_date.strip()) + _zeitspanne(days=1)
        bis = _kalender_zeit(folgetag.isoformat(), user=user)
    else:
        bis = _kalender_zeit(end_date, user=user) if end_date else jetzt + _zeitspanne(days=365)

    events = CalendarService.vorkommen_im_fenster(
        db, user=user, calendar_id=calendar_id, von=von, bis=bis
    )
    gekuerzt = len(events) > MAX_KALENDER_VORKOMMEN
    if gekuerzt:
        events = events[:MAX_KALENDER_VORKOMMEN]
    ergebnis: dict[str, Any] = {"events": events, "count": len(events)}
    if gekuerzt:
        ergebnis["gekuerzt"] = True
        ergebnis["hinweis"] = (
            f"Nur die ersten {MAX_KALENDER_VORKOMMEN} Vorkommen. "
            "Fuer mehr einen engeren Zeitraum angeben."
        )
    return ergebnis


def _lies_anhang(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    if not permission_service.has_global_permission(db, user, "ai.attachments.use"):
        raise AiActionValidationError("Dateianhang-Zugriff ist nicht erlaubt")
    from services.ai_tools.server_tools import _execute_read_chat_attachment

    return _execute_read_chat_attachment(
        db,
        user=user,
        arguments=arguments,
        docs_document_uid=(lauf or {}).get("docs_document_uid"),
    )


def _sucht_anhaenge(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    if not permission_service.has_global_permission(db, user, "ai.attachments.use"):
        raise AiActionValidationError("Dateianhang-Zugriff ist nicht erlaubt")
    from services.ai_tools.server_tools import _execute_search_chat_attachments

    return _execute_search_chat_attachments(
        db,
        user=user,
        arguments=arguments,
        docs_document_uid=(lauf or {}).get("docs_document_uid"),
    )


def _fuehrt_server_aktion(
    db: Session, *, user: User, arguments: dict, lauf: dict | None = None
) -> dict:
    from services.ai_voice.voice_dispatcher import dispatch_voice_action

    lauf = lauf or {}
    wert, fehler, _anzeige, _vorschlaege = dispatch_voice_action(
        user.id,
        arguments,
        conversation_id=None,
        herkunft=lauf.get("herkunft", "panel"),
        familie=lauf.get("familie"),
        # Hier kommt ein Chatlauf an, und der hat fuer diesen Aufruf schon
        # gefragt oder autonom freigegeben.
        schon_freigegeben=True,
        stimme=False,
    )
    if fehler and isinstance(wert, dict) and "error" not in wert:
        wert["error"] = fehler
    return wert if isinstance(wert, dict) else {"result": wert}


_PERSONAL_WERKZEUGE = {
    "email_search": dict(
        art="global_read",
        gruppe="mailbox",
        angebot=("ai.mailbox.use",),
        hinweis="Durchsucht das Postfach nach Stichwort oder Absender.",
        global_handler=_lies_email_suche,
    ),
    "email_read": dict(
        art="global_read",
        gruppe="mailbox",
        angebot=("ai.mailbox.use",),
        hinweis="Liest eine Nachricht samt Inhalt.",
        global_handler=_lies_email,
    ),
    "notes_read": dict(
        art="global_read",
        gruppe="notes",
        angebot=("ai.notes.use",),
        hinweis="Liest Notizen, gefiltert nach Suche, Kategorie oder Team.",
        global_handler=_lies_notizen,
    ),
    "popups_read": dict(
        art="global_read",
        gruppe="popup",
        angebot=("ai.popups.manage",),
        hinweis="Listet die Ankuendigungen des Panels.",
        global_handler=_lies_popups,
    ),
    "calendar_read": dict(
        art="global_read",
        gruppe="calendar",
        angebot=("ai.calendar.use",),
        hinweis="Liest Termine eines Zeitraums, Serien als Vorkommen.",
        global_handler=_lies_kalender,
    ),
    "read_chat_attachment": dict(
        art="global_read",
        gruppe="attachments",
        angebot=("ai.attachments.use",),
        hinweis="Liest einen angehaengten Text oder ein Dokument.",
        global_handler=_lies_anhang,
    ),
    "search_chat_attachments": dict(
        art="global_read",
        gruppe="attachments",
        angebot=("ai.attachments.use",),
        hinweis="Durchsucht die Anhaenge der Unterhaltung.",
        global_handler=_sucht_anhaenge,
    ),
    "execute_server_action": dict(
        art="global_read",
        hinweis="Fuehrt eine freigegebene Serveraktion im Chat aus.",
        global_handler=_fuehrt_server_aktion,
    ),
    "propose_email_send": dict(
        art="global_write",
        gruppe="mailbox",
        recht="ai.mailbox.use",
        recht_global=True,
        hinweis="Legt eine E-Mail als bestaetigungspflichtigen Vorschlag vor.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.personal_proposals._email_send_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.personal_proposals._ausfuehren_email_send"
        ),
    ),
    "propose_calendar_event_create": dict(
        art="global_write",
        gruppe="calendar",
        recht="ai.calendar.use",
        recht_global=True,
        hinweis="Legt einen Termin als Vorschlag vor.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.personal_proposals._calendar_event_create_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.personal_proposals._ausfuehren_calendar_event_create"
        ),
    ),
    "propose_calendar_event_update": dict(
        art="global_write",
        gruppe="calendar",
        recht="ai.calendar.use",
        recht_global=True,
        hinweis="Aendert einen Termin als Vorschlag.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.personal_proposals._calendar_event_update_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.personal_proposals._ausfuehren_calendar_event_update"
        ),
    ),
    "propose_calendar_event_delete": dict(
        art="global_write",
        gruppe="calendar",
        recht="ai.calendar.use",
        recht_global=True,
        hinweis="Loescht einen Termin nach Bestaetigung.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.personal_proposals._calendar_event_delete_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.personal_proposals._ausfuehren_calendar_event_delete"
        ),
    ),
    "propose_popup_set": dict(
        art="global_write",
        gruppe="popup",
        recht="ai.popups.manage",
        recht_global=True,
        hinweis="Legt eine Ankuendigung an oder ersetzt sie.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.task_proposals._popup_set_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.task_proposals._ausfuehren_popup_set"
        ),
    ),
    "propose_note_create": dict(
        art="global_write",
        gruppe="notes",
        recht="ai.notes.use",
        recht_global=True,
        hinweis="Legt eine Notiz nach Bestaetigung an.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.personal_proposals._note_create_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.personal_proposals._ausfuehren_note_create"
        ),
    ),
    "propose_note_update": dict(
        art="global_write",
        gruppe="notes",
        recht="ai.notes.use",
        recht_global=True,
        hinweis="Aendert eine Notiz nach Bestaetigung.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.personal_proposals._note_update_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.personal_proposals._ausfuehren_note_update"
        ),
    ),
    "propose_note_delete": dict(
        art="global_write",
        gruppe="notes",
        recht="ai.notes.use",
        recht_global=True,
        hinweis="Loescht eine Notiz nach Bestaetigung.",
        vorschlag=spaet_vorschlag(
            "services.ai_proposals.personal_proposals._note_delete_payload"
        ),
        ausfuehren=spaet(
            "services.ai_proposals.personal_proposals._ausfuehren_note_delete"
        ),
    ),
}

# Einmal beim Import gebaut: die Registry liest `ALLE`, bevor der erste Lauf
# beginnt. Die Liste bleibt die Katalog-Reihenfolge.
DEFINITIONEN = [
    *_mailbox_and_calendar_tool_definitions(),
    *_notes_tool_definitions(),
    *_attachment_tool_definitions(),
]

for _schema in DEFINITIONEN:
    _eintrag = _PERSONAL_WERKZEUGE.get(_schema["function"]["name"])
    if _eintrag is not None:
        werkzeug(_schema, **_eintrag)
