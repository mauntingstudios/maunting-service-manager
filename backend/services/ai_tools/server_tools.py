from __future__ import annotations

import os
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import AuditLog, Node, Server, User, AiActionProposal
from schemas.ai_action import AiActionProposalResponse
from services import audit_service, permission_service
from services.ai_action_errors import (
    AiActionStateError,
    AiActionValidationError,
)
from services.ai_redaction import redact_sensitive_text
from services.server_file_access_service import read_server_text
from services.ai_tool_registry import (
    CALENDAR_TOOLS,
    DOCUMENTS_TOOLS,
    GLOBAL_READ_TOOLS,
    NOTES_TOOLS,
    SERVER_READ_TOOLS,
    READ_TOOLS,
    WERKZEUGE,
    angebotsrechte,
)
from services.ai_tools.personal_tools import DEFINITIONEN as _PERSONAL_DEFINITIONEN
from services.ai_tools.database_tools import DEFINITIONEN as _DATABASE_DEFINITIONEN
from services.ai_tools.server_network_tools import DEFINITIONEN as _NETWORK_DEFINITIONEN
from services.ai_tools.server_history_tools import (
    BACKUP_DEFINITIONEN as _BACKUP_DEFINITIONEN,
    HISTORY_DEFINITIONEN as _HISTORY_DEFINITIONEN,
)
from services.ai_tools.server_ops_tools import DEFINITIONEN as _OPS_DEFINITIONEN
from services.ai_tools.server_file_tools import (
    DEFINITIONEN as _FILE_DEFINITIONEN,
    suche_dateien as _execute_file_search,
)
from services.ai_tools.document_tools import DEFINITIONEN as _DOCUMENT_DEFINITIONEN
from services.ai_tools.hoster_read_tools import DEFINITIONEN as _HOSTER_DEFINITIONEN
from services.ai_tools.geo_tools import GEO_DEFINITIONEN as _GEO_DEFINITIONEN
from services.ai_tools.cloudflare_read_tools import DEFINITIONEN as _CLOUDFLARE_DEFINITIONEN
from services.ai_tools.project_tools import DEFINITIONEN as _PROJECT_DEFINITIONEN
from services.ai_tools.global_write_tools import DEFINITIONEN as _GLOBAL_WRITE_DEFINITIONEN
from services.ai_tools.server_write_tools import (
    MODPACK_DEFINITIONEN as _MODPACK_DEFINITIONEN,
    SERVER_WRITE_DEFINITIONEN as _SERVER_WRITE_DEFINITIONEN,
)
from services.ai_tools.curseforge_read_tools import DEFINITIONEN as _CURSEFORGE_DEFINITIONEN
from services.ai_tools.panel_overview_tools import (
    KOPF_DEFINITIONEN as _PANEL_KOPF_DEFINITIONEN,
    PLACEMENT_DEFINITIONEN as _PLACEMENT_DEFINITIONEN,
    REST_DEFINITIONEN as _PANEL_REST_DEFINITIONEN,
)
from services.ai_tools.audit_tools import DEFINITIONEN as _AUDIT_DEFINITIONEN
from services.ai_tools.system_tools import (
    ASK_DEFINITIONEN as _ASK_DEFINITIONEN,
    DOKU_DEFINITIONEN as _DOKU_DEFINITIONEN,
    WEB_DEFINITIONEN as _WEB_DEFINITIONEN,
    MEMORY_DEFINITIONEN as _MEMORY_DEFINITIONEN,
    SKILL_LESE_DEFINITIONEN as _SKILL_LESE_DEFINITIONEN,
)
from services.ai_tools.server_mod_tools import (
    MODS_DEFINITIONEN as _MODS_DEFINITIONEN,
    SEARCH_DEFINITIONEN as _SEARCH_DEFINITIONEN,
    execute_mod_tool as _execute_mod_tool,
)
from services.ai_tool_spec import ALLE
from services.ai_tools.validierung import pruefe_argumente
from services.ai_tools.base import (
    MAX_CONFIG_CHARS,
    MAX_DIFF_CHARS,
    MAX_DIFF_LINES,
    MAX_READ_CONFIG_CHARS,
    MAX_LOG_CHARS,
    MAX_READ_CONFIG_LINES,
    MAX_SEARCH_QUERY_CHARS,
    MAX_SEARCH_FILES,
    MAX_SEARCH_DEPTH,
    MAX_SEARCH_MATCHES,
    MAX_SEARCH_LINE_CHARS,
    MAX_SEARCH_CONTEXT_LINES,
    MAX_PATCH_EDITS,
    MAX_PATCH_CHUNK_CHARS,
    MAX_LISTED_MODS,
    MAX_LISTED_BACKUPS,
    MAX_LISTED_INCIDENTS,
    MAX_LISTED_ACTIONS,
    MAX_LISTED_BLUEPRINTS,
    MAX_LISTED_NODES,
    MAX_LISTED_SERVERS,
    MAX_KALENDER_VORKOMMEN,
    MAX_LISTED_POPUPS,
    MAX_POPUP_INHALT_CHARS,
    MAX_REASON_CHARS,
    MAX_BACKUP_NAME_CHARS,
    MAX_QUESTION_OPTIONS,
    MAX_QUESTION_CHARS,
    MAX_OPTION_CHARS,
    MAX_OPTION_HINT_CHARS,
    MAX_DESKTOP_INHALT_CHARS,
    MAX_AUFRAEUM_PFADE,
    MAX_INCIDENT_ATTEMPTS,
    MAX_TESTMAILS_JE_STUNDE,
    CONFIRMATION_TTL,
    _SERVER_ID_SCHEMA,
    _MUTEX_TOOLS,
    _RATIONALE_SCHEMA,
    _RATIONALE_REQUIRED,
    _PLAN_SCHEMA,
    _function,
    _server_function,
    _vorfall_versuche,
    _require_no_arguments,
    _visible_servers,
    _resolve_server,
    _node_health,
    is_binary_text,
    _config_path,
    _positive_int,
)
from services.ai_tools.task_tools import (
    _aufgaben_tool_definitions,
    _worker_tool_definitions,
    DEFINITIONEN as _TASK_DEFINITIONEN,
)
from services.ai_tools.personal_tools import (
    _mailbox_and_calendar_tool_definitions,
    _notes_tool_definitions,
    _attachment_tool_definitions,
    _execute_send_test_email,
)
from services.ai_tools.document_tools import _dokument_tool_definitions
from services.ai_tools.geo_tools import (
    _voice_tool_definitions,
    voice_control_tool_definitions,
    _region_request,
    execute_realtime_region_initial,
    execute_realtime_region_enrichment,
    _execute_analyze_region,
    _execute_control_region_camera,
)
from services.ai_tools.system_tools import (
    _desktop_tool_definitions,
    DEFINITIONEN as _SYSTEM_DEFINITIONEN,
    question_payload,
    _execute_search_memory,
    _execute_forget_skill,
    _execute_search_docs,
    _execute_read_docs,
    _execute_read_skill,
    _execute_learn_skill,
    _execute_web_search,
    _execute_read_web_page,
)

from services.ai_tools.user_tools import (
    _user_tool_definitions,
    DEFINITIONEN as _USER_DEFINITIONEN,
    execute_user_read_tool,
)

logger = logging.getLogger(__name__)

#: Ein Kalenderende ohne Uhrzeit (`calendar_read`), ISO oder iCal-Kurzform.
_NUR_DATUM = re.compile(r"\d{4}-\d{2}-\d{2}|\d{8}")

def _global_tool_definitions() -> list[dict]:
    """Werkzeuge ohne Serverbezug: Serverliste, Blueprints, Kapazitaet, Anlage."""
    optional: list[dict] = []
    # Ohne hinterlegten Schluessel gar nicht erst anbieten. Ein Werkzeug, das
    # immer scheitert, verwirrt ein Modell mehr als es hilft: es versucht es
    # erneut, formuliert um und verbraucht dabei Tokens.
    from services.ai_web_search_service import MAX_RESULTS, is_configured

    if is_configured():
        optional.extend(_WEB_DEFINITIONEN)

    # Die Regionsanalyse steht immer im Katalog: ohne Copernicus-Zugang zeigt
    # sie ein schlüsselfreies Kartenbild statt einer Sentinel-Szene. Das hat
    # den Katalog an seine Grenze gebracht (siehe
    # `test_the_tool_catalogue_stays_within_a_stated_budget`), deshalb so
    # knapp: wann welcher Kameramodus und wann `location`, steht einmal im
    # Systemprompt (`ai_prompt.REGIONSANALYSE`, im Sprachmodus
    # `REGION_ANWEISUNGEN`) statt in jeder Runde ungecacht hier. Die Länge des
    # Ortes kürzt der Server selbst auf 100 Zeichen.
    optional.extend(_GEO_DEFINITIONEN)

    # Globales Lernen kann der Betreiber abschalten. Dann steht "global" gar
    # nicht erst in der Auswahl — ein Modell, das eine Moeglichkeit angeboten
    # bekommt, die immer abgewiesen wird, versucht sie mehrfach.
    from services.ai_learning_policy import policy as learning_policy

    learn_scopes = ["team"] if learning_policy() == "off" else ["team", "global"]

    # Die Seitenliste mit Titeln steht in `search_docs` ausgeschrieben. Das
    # Modell kann sonst nur raten, was es ueberhaupt nachschlagen koennte — und
    # eine geratene Seitenkennung ist der erste Schritt zu einer geratenen
    # Antwort. `read_docs` fuehrt dieselben Kennungen als `enum`; die Titel ein
    # zweites Mal kosteten jede Runde rund 600 Zeichen (gekuerzt 07.10.2026).
    from services.ai_docs_corpus import SEITEN as DOKU_SEITEN

    doku_seiten = sorted(DOKU_SEITEN)
    doku_liste = ", ".join(f"{s.schluessel} ({s.titel})" for s in DOKU_SEITEN.values())

    from services.cloudflare_service import is_configured as is_cloudflare_configured
    if is_cloudflare_configured():
        optional.extend(_CLOUDFLARE_DEFINITIONEN)

    optional.extend(_PLACEMENT_DEFINITIONEN)
    optional.extend(_PROJECT_DEFINITIONEN)
    optional.extend(_CURSEFORGE_DEFINITIONEN)

    return optional + [
        *_DOKU_DEFINITIONEN,
        *_HOSTER_DEFINITIONEN,
        *_SKILL_LESE_DEFINITIONEN,
        *_AUDIT_DEFINITIONEN,
        # Der Bauplan des Textes ("was zu pruefen ist, in welcher Reihenfolge,
        # woran man die Ursache erkennt") und die Ausschlussliste ("Nicht
        # festhalten: Einzelfaelle, Zwischenergebnisse …") stehen in
        # `ai_prompt.SKILLS`, und der Systemprompt geht in derselben Anfrage
        # mit (`ai_prompt.build`). Was dort steht, ist hier gestrichen.
        #
        # Der **Anlass** bleibt dagegen hier, und das ist eine Korrektur: bei
        # der ersten Kuerzung am 14.08.2026 wanderte er mit in den Prompt, nach
        # der Regel "was das Modell vor der Werkzeugwahl braucht, gehoert in
        # den Systemprompt". Die Regel stimmt fuer den Bauplan und nicht fuer
        # den Anlass. Das Modell vergleicht bei der Auswahl die Beschreibungen
        # von 52 Werkzeugen gegeneinander; steht der Anlass nur im Prompt,
        # weiss es *dass* es Skills lernen soll, aber nicht, dass **jetzt** der
        # Moment dafuer ist. Der Benchmark hat es sofort gezeigt: das Szenario
        # `skill_lernen` griff danach zu `read_skill` statt zu `learn_skill`
        # (Werkzeugtreffer 10/10 auf 9/10). Ein Satz zurueck, Ersparnis bleibt.
        _function(
            "learn_skill",
            "Haelt eine Vorgehensweise dauerhaft fest. Keine Zugangsdaten, "
            "keine Personennamen.\n"
            "Anlass: du hast gerade ein Problem gelöst oder eine Vorgehensweise "
            "erarbeitet, die beim nächsten Mal wieder gebraucht wird.\n"
            "Bereich: 'team' fuer diesen Betrieb; 'global' nur, was auf jedem "
            "fremden Panel genauso stimmt (etwa eine Eigenschaft eines Spiels). "
            "Im Zweifel 'team'. Ein vorhandener Schluessel wird vollstaendig "
            "ersetzt — lies ihn vorher mit read_skill.",
            {
                "skill_key": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Kleinbuchstaben, Ziffern, Bindestriche. z. B. valheim-ram",
                },
                "name": {"type": "string", "maxLength": 100},
                "description": {
                    "type": "string",
                    "maxLength": 500,
                    "description": (
                        "Was er tut, wann er gilt UND wann nicht — nur danach "
                        "wird er spaeter gefunden."
                    ),
                },
                # "nichts behaupten, was du nicht geprueft hast" ist der eine
                # Halbsatz der alten Beschreibung, für den `ai_prompt.SKILLS`
                # keinen Ersatz hat. Er steht deshalb nicht weiter oben,
                # sondern an dem Feld, das er regiert.
                "body": {
                    "type": "string",
                    "maxLength": 12_000,
                    "description": "Die Vorgehensweise, gern Markdown. Behaupte nichts Ungeprueftes.",
                },
                "scope": {"type": "string", "enum": learn_scopes},
                "team": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Nur nach einer Rueckfrage nach dem Team: der Name daraus, genau so.",
                },
            },
            ["skill_key", "name", "description", "body", "scope"],
        ),
        *_PANEL_KOPF_DEFINITIONEN,
        *_ASK_DEFINITIONEN,
        *_MEMORY_DEFINITIONEN,
        *_PANEL_REST_DEFINITIONEN,
        *_GLOBAL_WRITE_DEFINITIONEN,
        *_MODPACK_DEFINITIONEN,
        *_TASK_DEFINITIONEN,
        *_PERSONAL_DEFINITIONEN,
        *_DOCUMENT_DEFINITIONEN,
        *_USER_DEFINITIONEN,
    ]

def provider_tool_definitions() -> list[dict]:
    """Feste OpenAI-Tool-Allowlist; keine freie Command-Ausfuehrung.

    Es gibt genau *einen* Werkzeugsatz. Die frueher noetige Unterscheidung
    zwischen Panel-Chat und Server-Chat ist mit dem Einzelchat entfallen: der
    Server steht jetzt in den Argumenten, nicht im Gespraech. Das Modell findet
    ihn ueber `list_my_servers` und fragt bei Mehrdeutigkeit nach.
    """
    return [
        *_global_tool_definitions(),
        *_OPS_DEFINITIONEN,
        *_FILE_DEFINITIONEN,
        # ── Erweiterter Serverkontext (Zielpunkt 3.3) ──────────────────────
        *_NETWORK_DEFINITIONEN,
        *_MODS_DEFINITIONEN,
        *_BACKUP_DEFINITIONEN,
        # Anleitung (Ansichten, Ablauf) in `ai_prompt.DATENBANK_STUDIO` — der
        # Katalog geht jede Runde ungecacht mit.
        *_DATABASE_DEFINITIONEN,
        *_HISTORY_DEFINITIONEN,
        *_SEARCH_DEFINITIONEN,
        # ── Schreib-Tools: erzeugen ausschliesslich Vorschlaege ────────────
        *_SERVER_WRITE_DEFINITIONEN,
        *_SYSTEM_DEFINITIONEN,
    ]


def angebotene_werkzeuge(db: Session, user: User) -> frozenset[str]:
    """Welche Werkzeuge diesem Benutzer angeboten werden.

    Die Allowlist ist die Schranke, dieser Schnitt ist Fuehrung: ohne das Recht
    verbraucht ein angebotenes Werkzeug nur eine Runde. Die Schranke selbst
    steht weiterhin je Aufruf.
    """
    # Alle 24 Schluessel in einer Runde. Der Merkzettel je Schluessel, der hier
    # zuerst stand, half nur halb: er sparte die Wiederholung je Werkzeug, nicht
    # die je Schluessel — und darunter fragte jede Pruefung die Rollen des
    # Benutzers erneut ab. Gemessen waren das 73 Abfragen bei einem
    # gewoehnlichen Kunden und 93 bei einem Rolleninhaber, jedes Mal am Beginn
    # eines Segments und damit auf dem Pfad zum ersten Token.
    verlangt = {key for name in WERKZEUGE for key in angebotsrechte(name)}
    gehalten = permission_service.rechte_irgendwo(db, user, verlangt)

    from services.ai_guardian_settings import is_guardian_ai_enabled
    from services.ai_tool_registry import GUARDIAN_TOOLS

    verfuegbar = set(
        name for name in WERKZEUGE
        if not angebotsrechte(name) or any(key in gehalten for key in angebotsrechte(name))
    )
    if not is_guardian_ai_enabled():
        verfuegbar -= GUARDIAN_TOOLS

    # Dokumentwerkzeuge brauchen drei Dinge gleichzeitig: das Modul, `docs.use`
    # und `ai.docs.use`. Das Angebotsrecht allein (`ai.docs.use`) wuerde sie
    # einem Benutzer zeigen, der das Modul gar nicht betreten darf.
    from services.docs_collab_service import DocsCollabService

    docs_ok = (
        DocsCollabService.module_enabled()
        and permission_service.has_global_permission(db, user, "docs.use")
        and permission_service.has_global_permission(db, user, "ai.docs.use")
    )
    if not docs_ok:
        verfuegbar -= DOCUMENTS_TOOLS
    if not permission_service.has_global_permission(db, user, "calendar.use"):
        verfuegbar -= CALENDAR_TOOLS
    if not permission_service.has_global_permission(db, user, "notes.use"):
        verfuegbar -= NOTES_TOOLS
    return frozenset(verfuegbar)


async def _resolve_curseforge_game_and_class_for_ai(
    db: Session,
    s: Any,
    query: str,
    raw_game: Any = None,
    server_id: Any = None,
    class_id: Any = None,
) -> tuple[int | None, str | None]:
    import re
    from services.curseforge_service import KNOWN_CURSEFORGE_GAMES

    resolved_gid = None
    resolved_cls = class_id

    # 1. Wenn server_id übergeben wurde: Game-ID und Default-Klasse vom Server holen
    if server_id:
        try:
            srv = db.get(Server, int(server_id))
            if srv:
                from games import get_plugin
                pl = get_plugin(srv.game_type)
                if pl:
                    ms = pl.get_mod_support() or {}
                    resolved_gid = ms.get("curseforge_game_id")
                    if not resolved_cls:
                        resolved_cls = ms.get("curseforge_class_id")
        except Exception:
            pass

    # 2. Wenn explizites game oder game_id übergeben wurde
    if not resolved_gid and raw_game:
        resolved_gid = await s.resolve_game_id(raw_game)

    lower_q = query.lower()

    # 3. Wortgrenzen-Prüfung auf bekannte CurseForge-Spiele im Suchtext (keine falschen Substring-Treffer wie ark in dark)
    if not resolved_gid:
        for alias, alias_gid in KNOWN_CURSEFORGE_GAMES.items():
            pattern = r"\b" + re.escape(alias.replace("-", " ")) + r"\b"
            if re.search(pattern, lower_q.replace("-", " ")):
                resolved_gid = alias_gid
                break

    # 4. Dynamische Wortgrenzen-Prüfung auf Spiele via CurseForge API /v1/games
    if not resolved_gid:
        try:
            cf_games = await s.get_games()
            for g in cf_games:
                g_slug = str(g.get("slug") or "").lower()
                g_name = str(g.get("name") or "").lower()
                if g_slug and re.search(r"\b" + re.escape(g_slug.replace("-", " ")) + r"\b", lower_q.replace("-", " ")):
                    resolved_gid = g.get("id")
                    if resolved_gid:
                        break
                if g_name and re.search(r"\b" + re.escape(g_name) + r"\b", lower_q):
                    resolved_gid = g.get("id")
                    if resolved_gid:
                        break
        except Exception:
            pass

    # 5. Prüfung gegen registrierte Server in der Datenbank
    if not resolved_gid:
        try:
            servers = db.query(Server).all()
            candidate_servers = []
            for srv in servers:
                from games import get_plugin
                pl = get_plugin(srv.game_type)
                if pl:
                    ms = pl.get_mod_support() or {}
                    cgid = ms.get("curseforge_game_id")
                    if cgid:
                        candidate_servers.append((srv, cgid, ms.get("curseforge_class_id")))

            # 5a. Prüfung: Nennt der Suchtext den Server-Namen?
            for srv, cgid, ccls in candidate_servers:
                if srv.name and re.search(r"\b" + re.escape(srv.name.lower()) + r"\b", lower_q):
                    resolved_gid = cgid
                    if not resolved_cls:
                        resolved_cls = ccls
                    break

            # 5b. Wenn genau ein eindeutiges Spiel über alle Server existiert
            if not resolved_gid and candidate_servers:
                distinct_gids = {cgid for _, cgid, _ in candidate_servers}
                if len(distinct_gids) == 1:
                    resolved_gid = candidate_servers[0][1]
                    if not resolved_cls:
                        resolved_cls = candidate_servers[0][2]
        except Exception:
            pass

    return (int(resolved_gid) if resolved_gid else None, resolved_cls)


def _execute_search_chat_attachments(
    db: Session, *, user: User, arguments: dict, docs_document_uid: str | None = None
) -> dict:
    from datetime import datetime, timezone, timedelta
    from models import AiAttachment
    from services.ai_attachment_service import _aad
    from services.dis_client import DisClient

    query_text = str(arguments.get("query", "")).strip().lower() if arguments.get("query") else None
    ref_zeit_str = arguments.get("referenz_zeit")
    try:
        toleranz_std = float(arguments.get("toleranz_stunden", 2.0))
    except (ValueError, TypeError):
        toleranz_std = 2.0
    try:
        limit = max(1, min(int(arguments.get("limit", 5)), 20))
    except (ValueError, TypeError):
        limit = 5

    q = db.query(AiAttachment).filter(AiAttachment.status == "ready")

    if docs_document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope
        conversation, _, _ = docs_scope(db, user, docs_document_uid)
        q = q.filter(AiAttachment.conversation_id == conversation.id)
    else:
        q = q.filter(AiAttachment.user_id == user.id)

    if ref_zeit_str:
        try:
            clean_str = str(ref_zeit_str).replace("Z", "+00:00")
            ref_dt = datetime.fromisoformat(clean_str)
            if ref_dt.tzinfo is None:
                ref_dt = ref_dt.replace(tzinfo=timezone.utc)
            start_zeit = ref_dt - timedelta(hours=toleranz_std)
            end_zeit = ref_dt + timedelta(hours=toleranz_std)
            q = q.filter(AiAttachment.created_at >= start_zeit, AiAttachment.created_at <= end_zeit)
        except Exception:
            pass

    rows = q.order_by(AiAttachment.created_at.desc()).limit(limit * 3 if query_text else limit).all()

    treffer = []
    for r in rows:
        name = r.original_name or ""
        text_preview = None
        text_content = ""
        if r.extracted_text_encrypted:
            try:
                text_content = DisClient.decrypt(r.extracted_text_encrypted, aad=_aad(r.id, "text")) or ""
                text_preview = text_content[:200]
            except Exception:
                text_preview = None

        if query_text:
            if query_text not in name.lower() and query_text not in text_content.lower():
                continue

        treffer.append({
            "attachment_id": r.id,
            "filename": name,
            "media_type": r.media_type,
            "size_bytes": r.size_bytes,
            "created_at": r.created_at.isoformat(),
            "preview": text_preview,
        })
        if len(treffer) >= limit:
            break

    return {
        "attachments": treffer,
        "count": len(treffer),
        "hint": (
            "Wenn genau eine passende Datei gefunden wurde, nutze direkt 'read_chat_attachment', um den vollen Inhalt zu lesen. "
            "Wenn mehrere Dateien zutreffen, frage den Nutzer höflich, welche Datei gemeint ist."
        ) if len(treffer) > 1 else None,
    }


def _execute_read_chat_attachment(
    db: Session, *, user: User, arguments: dict, docs_document_uid: str | None = None
) -> dict:
    from uuid import UUID
    from models import AiAttachment
    from services.ai_attachment_service import _aad
    from services.dis_client import DisClient

    raw_id = arguments.get("attachment_id")
    if not raw_id:
        raise AiActionValidationError("attachment_id ist erforderlich")
    try:
        canonical_id = str(UUID(str(raw_id).strip()))
    except (ValueError, TypeError):
        raise AiActionValidationError("Ungültige attachment_id")

    row = db.query(AiAttachment).filter(
        AiAttachment.id == canonical_id,
        AiAttachment.status == "ready",
    ).first()

    if row is None:
        raise AiActionValidationError("Dateianhang nicht gefunden")

    if docs_document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope
        conversation, _, _ = docs_scope(db, user, docs_document_uid)
        if row.conversation_id != conversation.id:
            raise AiActionValidationError("Keine Berechtigung für diesen Anhang")
    elif row.user_id != user.id:
        raise AiActionValidationError("Keine Berechtigung für diesen Anhang")

    text_inhalt = None
    if row.extracted_text_encrypted:
        try:
            text_inhalt = DisClient.decrypt(row.extracted_text_encrypted, aad=_aad(row.id, "text"))
        except Exception as exc:
            logger.warning("Konnte Anhang-Text für %s nicht entschlüsseln: %s", row.id, exc)

    return {
        "attachment_id": row.id,
        "filename": row.original_name,
        "media_type": row.media_type,
        "size_bytes": row.size_bytes,
        "created_at": row.created_at.isoformat(),
        "content_text": text_inhalt,
    }


def _execute_global_read_tool(
    db: Session, *, user: User, tool_name: str, arguments: dict,
    herkunft: str = "panel", familie: str | None = None,
    prefetch_session_id: str | None = None,
    fast_region: bool = False,
    docs_document_uid: str | None = None,
    docs_team_id: int | None = None,
    kontext: Any = None,
) -> dict:
    """Werkzeuge ohne Serverbezug.

    `list_my_servers` ist die Einstiegsfrage jedes Gespraechs und deshalb an
    kein zusaetzliches Recht gebunden — es zeigt ausschliesslich Server, die der
    Benutzer ohnehin sieht, und ohne die Liste kann er den Assistenten gar nicht
    sinnvoll benutzen.

    Blueprintliste und Hostkapazitaet sind dagegen die Vorbereitung einer
    Servererstellung. Wer keine Server anlegen darf, hat auch keinen Grund, die
    Kapazitaetsplanung des Betreibers zu sehen.
    """
    # Dokumentwerkzeuge werden im Dokumentlauf vor diesem Zweig verteilt.
    # Der Zweig hier haelt sie fuer direkte Aufrufer namentlich erreichbar und
    # beantwortet einen Aufruf ohne Dokumentkontext mit einer klaren Meldung.

    # Umgestellte Domaenen entscheiden selbst: die Spec traegt den Handler und
    # prueft ihr Recht dort, wo ihr Fach liegt. Der Rest der Kette bleibt fuer
    # die noch nicht umgestellten Werkzeuge.
    gebunden = ALLE.get(tool_name)
    if gebunden is not None and gebunden.global_handler is not None:
        return gebunden.global_handler(
            db,
            user=user,
            arguments=arguments,
            lauf={
                "herkunft": herkunft,
                "familie": familie,
                "prefetch_session_id": prefetch_session_id,
                "fast_region": fast_region,
                "docs_document_uid": docs_document_uid,
                "docs_team_id": docs_team_id,
                "kontext": kontext,
            },
        )




    if tool_name == "worker_start":
        from services import ai_worker_service

        # Die Herkunft wird **vererbt**, nicht gewaehlt: ein Auftrag aus der
        # App darf denselben Rechner sehen wie der Lauf, der ihn gestellt hat.
        # Ohne sie fiel der Worker auf "panel" und meldete dem Benutzer, er
        # koenne auf dessen Rechner nicht zugreifen (22.08.2026).
        #
        # Die Familie geht denselben Weg und beantwortet die zweite Hälfte
        # derselben Frage: die Herkunft sagt „aus der App", die Familie sagt
        # „aus **dieser** App". Nur mit ihr landet ein Desktop-Auftrag des
        # Workers bei dem Rechner, an dem der Mensch sitzt, statt bei dem, der
        # zuerst nach Arbeit fragt (`desktop_job_service.naechster`).
        return ai_worker_service.worker_start(
            db, user=user, arguments=arguments, herkunft=herkunft,
            familie=familie, docs_document_uid=docs_document_uid,
            docs_team_id=docs_team_id,
            conversation_id=getattr(kontext, "conversation_id", None),
        )

    if tool_name == "worker_cancel":
        from services import ai_worker_service

        return ai_worker_service.worker_cancel(db, user=user, arguments=arguments)

    if tool_name == "worker_antwort":
        from services import ai_worker_service

        return ai_worker_service.worker_antwort(db, user=user, arguments=arguments)

    if tool_name == "wait_until":
        # Wird wie `ask_user` im Rundenlauf abgefangen, bevor ein Werkzeug
        # laeuft: der Lauf parkt (`waiting_wake`), dieser Dispatch sieht das
        # Werkzeug nie. Der Zweig steht trotzdem hier — als benannte Antwort
        # statt des Durchfall-raise, damit ein Aufruf ausserhalb eines
        # parkfaehigen Laufs eine Erklaerung bekommt und kein Raetsel.
        raise AiActionValidationError(
            "wait_until parkt den Lauf und wird im Rundenlauf behandelt — "
            "in diesem Lauf steht es nicht zur Verfügung"
        )

    if tool_name in (
        "desktop_dateien",
        "desktop_launch_app",
        "desktop_steuern",
        "desktop_system",
        "desktop_aufraeumen",
        "desktop_artifact",
    ):
        # Dieselbe Lage wie bei `wait_until`: die fuenf werden im Rundenlauf
        # abgefangen (`_desktop_behandeln`), werden zu einem Auftrag an den
        # Rechner des Benutzers, und der Lauf parkt. Dieser Dispatch sieht sie
        # nur, wenn die Bitte gar nicht von einem Rechner kam — dann sortiert
        # sie schon der Herkunfts-Spiegel aus, und wenn selbst der umgangen
        # waere, ist ein benannter Fehlschlag die einzig ehrliche Antwort. Ein
        # stiller Durchfall lieferte dem Modell ein "erledigt" fuer etwas, das
        # nie passiert ist.
        raise AiActionValidationError(
            "Werkzeuge für den Rechner des Benutzers laufen nur aus der "
            "Smart-System-App — in diesem Lauf stehen sie nicht zur Verfügung"
        )





    if tool_name == "web_search":
        return _execute_web_search(
            db, user=user, arguments=arguments, prefetch_session_id=prefetch_session_id
        )

    if tool_name == "read_web_page":
        return _execute_read_web_page(db, user=user, arguments=arguments)




    if tool_name == "learn_skill":
        return _execute_learn_skill(db, user=user, arguments=arguments)




    # **Die drei Postfach- und Kalenderwerkzeuge pruefen ihr Recht hier.** Bis
    # hierher taten sie es nirgends: `ai.mailbox.use` und `ai.calendar.use`
    # standen allein als `angebot` in `ai_tool_registry`, und das ist
    # ausdruecklich **kein** Ausfuehrungsgate — `angebotene_werkzeuge` sagt
    # selbst, der Katalog sei „eine Bitte, keine Zusage", und verweist fuer die
    # Schranke auf den Handler. Der Nachbar `notes_read` hat sie, diese drei
    # hatten sie nicht.
    #
    # Der Katalog allein traegt aus drei Gruenden nicht: ein Modell kann einen
    # Namen aus dem Gespraechsverlauf abschreiben, `execute_server_action` loest
    # Namen ueber einen semantischen Router auf, und die Sprachsitzungen reichen
    # den Namen des Modells ohne Abgleich mit der Angebotsmenge an
    # `voice_werkzeug_ausfuehren` weiter. In allen drei Faellen las die KI das
    # Postfach eines Benutzers, dem der Betreiber genau das nicht erlaubt hatte.



















    # **Der Durchfall war die gefaehrlichste Zeile der Datei.** Bis hierher war
    # die Kapazitaetsabfrage der namenlose Rumpf am Ende der Kette: wer keinen
    # eigenen Zweig hatte, bekam ihn. Ein Werkzeug, das in der Tabelle und im
    # Katalog steht, aber beim Verdrahten vergessen wurde, lieferte dem Modell
    # damit RAM-Zahlen unter seinem eigenen Namen zurueck — eine falsche
    # Auskunft, die wie eine richtige aussieht, und der einzige Ort im ganzen
    # Werkzeugpfad, an dem das ohne Fehler passieren konnte.
    raise AiActionValidationError(f"Kein Handler für Werkzeug: {tool_name}")

def _execute_server_context_tool(
    db: Session, *, user: User, server: Server, tool_name: str, arguments: dict
) -> dict | None:
    """Die Kontext-Tools aus Zielpunkt 3.3. Jedes prueft sein eigenes Recht."""
    # Umgestellte Server-Werkzeuge: der Spec traegt den Handler und prueft sein
    # Recht im eigenen Modul. Der Rest der Kette bleibt fuer die uebrigen.
    gebunden = ALLE.get(tool_name)
    if gebunden is not None and gebunden.handler is not None:
        return gebunden.handler(db, user=user, server=server, arguments=arguments)






    return None



def execute_read_tool(
    db: Session,
    *,
    user: User,
    tool_name: str,
    arguments: dict,
    herkunft: str = "panel",
    familie: str | None = None,
    prefetch_session_id: str | None = None,
    fast_region: bool = False,
    kontext: Any = None,
) -> dict:
    """Fuehrt ein Lesewerkzeug im Namen des Benutzers aus.

    Die Unterhaltung wird bewusst nicht mehr uebergeben: sie traegt keinen
    Kontext mehr, der die Ausfuehrung beeinflusst. Alles, was ein Werkzeug
    braucht, steht in seinen Argumenten und wird gegen die Rechte von ``user``
    geprueft.

    ``herkunft`` und ``familie`` sind die einzigen Ausnahmen davon, und sie
    stehen ausdrücklich **nicht** in den Argumenten: aus welcher Welt der
    Aufruf kam und von welchem Gerät, sind Tatsachen des Laufs. Gebraucht
    werden beide von genau einem Werkzeug — `worker_start` gibt sie an den
    Auftrag weiter, den es anlegt. Die Herkunft öffnet ihm die
    Desktop-Werkzeuge, die Familie sagt, an welchen Rechner er sich damit
    wendet; ohne sie holt seinen Auftrag der, der zuerst fragt.
    """
    if tool_name.startswith("mcp_"):
        from services.mcp.ausfuehrung import rufe as mcp_rufe

        return mcp_rufe(db, user, tool_name, arguments)

    if tool_name not in READ_TOOLS:
        raise AiActionValidationError("Read-Tool ist in diesem Kontext nicht erlaubt")

    # Nur fuer umgestellte Werkzeuge: die uebrigen behalten ihren Weg, bis
    # ihre Domaene folgt.
    pruefe_argumente(tool_name, arguments)

    # Ein Cache-Hit kommt nur aus derselben Sprachsitzung. Die kleinen,
    # werkzeugspezifischen Vorprüfungen sind die zweite Schranke nach dem
    # Prefetch und verhindern, dass ein inzwischen entzogener Zugriff ein altes
    # Ergebnis erhält.
    from services.ai_intent_classifier import prefetch_cache
    if prefetch_session_id and tool_name == "analyze_region":
        if not permission_service.has_global_permission(db, user, "ai.satellite.use"):
            raise AiActionValidationError("Satelliten- und Regionsanalyse ist für diesen Benutzer nicht freigegeben")
    elif prefetch_session_id and tool_name == "control_region_camera":
        if not permission_service.has_global_permission(db, user, "ai.satellite.use"):
            raise AiActionValidationError("Kartensteuerung ist für diesen Benutzer nicht freigegeben")
    elif prefetch_session_id and tool_name == "web_search":
        if not permission_service.has_global_permission(db, user, "ai.web_search.use"):
            raise AiActionValidationError("Websuche ist fuer diesen Benutzer nicht freigegeben")
    elif prefetch_session_id and tool_name == "calendar_read":
        if not (permission_service.has_global_permission(db, user, "calendar.use") and permission_service.has_global_permission(db, user, "ai.calendar.use")):
            raise AiActionValidationError("Kalender ist fuer diesen Benutzer nicht freigegeben")
    elif prefetch_session_id and tool_name == "notes_read":
        if not (permission_service.has_global_permission(db, user, "notes.use") and permission_service.has_global_permission(db, user, "ai.notes.use")):
            raise AiActionValidationError("Notizen sind fuer diesen Benutzer nicht freigegeben")
    elif prefetch_session_id and tool_name == "search_memory":
        if not permission_service.has_global_permission(db, user, "ai.memory.use"):
            raise AiActionValidationError("Memory ist fuer diesen Benutzer nicht freigegeben")
    elif prefetch_session_id and tool_name == "read_server_status":
        _resolve_server(db, user, arguments)
    hit, cached_result = prefetch_cache.get(
        session_id=prefetch_session_id, user_id=user.id, tool_name=tool_name, arguments=arguments,
    )
    if hit and cached_result is not None:
        logger.info("Spekulativer Prefetch-Cache HIT für tool=%s user=%s", tool_name, user.id)
        return cached_result

    # Dokumentwerkzeuge zuerst: Sie tragen die Art `global_read`, brauchen aber
    # den Laufkontext (Dokument-UID, Team, Gespraech). Stuenden sie hinter dem
    # allgemeinen Zweig, kaeme jeder Aufruf ohne Kontext an und endete mit
    # „Dokumentkontext fehlt“.
    if tool_name in GLOBAL_READ_TOOLS:
        if tool_name == "worker_start":
            # Private Schluessel kommen nie aus dem Modelltext. Sie werden
            # immer entfernt und nur als eigener Server-Parameter uebergeben.
            arguments = {
                key: value
                for key, value in arguments.items()
                if key not in ("_docs_document_uid", "_docs_team_id")
            }
        return _execute_global_read_tool(
            db, user=user, tool_name=tool_name, arguments=arguments,
            herkunft=herkunft, familie=familie, prefetch_session_id=prefetch_session_id,
            fast_region=fast_region,
            docs_document_uid=(
                getattr(kontext, "document_uid", None) if tool_name == "worker_start" else None
            ),
            docs_team_id=(
                getattr(kontext, "team_id", None) if tool_name == "worker_start" else None
            ),
            kontext=kontext,
        )
    server, arguments = _resolve_server(db, user, arguments)
    context = _execute_server_context_tool(
        db, user=user, server=server, tool_name=tool_name, arguments=arguments
    )
    if context is not None:
        return context
    raise AiActionValidationError(f"Kein Handler für Werkzeug: {tool_name}")
