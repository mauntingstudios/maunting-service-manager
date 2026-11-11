# -*- coding: utf-8 -*-
"""Start- und Nebenlaeufigkeits-Einstiegspunkte fuer AI-Runs."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import logging
from typing import Any, AsyncIterator
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from database import SessionLocal
from models import AiMessage, AiProvider, AiRun, User
import services.ai_stream as ai_stream
from services import (
    ai_attachment_service,
    ai_provider_registry,
    ai_provider_service,
    ai_run_service,
)
from services.ai_chat_service import get_owned_conversation
from services.ai_context_service import build_provider_messages, estimate_reserved_tokens
from services.ai_guardian_service import briefing_nachricht
from services.ai_provider_errors import AiProviderConfigurationError
from services.ai_provider_service import estimate_cost_microunits
from services.ai_redaction import redact_sensitive_text
from services.ai_stream.context import _modell_fuer, _rolle_ableiten
from services.ai_usage_service import (
    AiQuotaExceeded,
    AiUsageConflict,
    reserve_ai_usage,
)
from services.dis_client import DisSidecarError

logger = logging.getLogger(__name__)


def lauf_beginnen(
    db,
    *,
    user: User,
    conversation,
    provider: AiProvider,
    request_id: UUID,
    content: str,
    reasoning: bool,
    reasoning_effort: str | None = None,
    context_chars: int | None = None,
    guardian_briefing_unterdruecken: bool = False,
    unbeaufsichtigt: bool = False,
    gesprochen: bool = False,
    rolle: str | None = None,
    herkunft: str = "panel",
    familie: str | None = None,
    voice_output_checkpoint: str | None = None,
    intern: bool = False,
    docs_document_uid: str | None = None,
    docs_team_id: int | None = None,
    docs_is_link_guest: bool = False,
    modell_sieht: bool | None = None,
    app_faehigkeiten: dict[str, Any] | None = None,
    requested_model: str | None = None,
    project_id: str | None = None,
) -> tuple[AiRun | None, tuple[str, str] | None]:
    """Legt einen Lauf an: Benutzernachricht, Kontingent, Antwortnachricht.

    Bewusst **synchron im Request** und nicht im Hintergrund. Ein
    ueberschrittenes Kontingent, ein fehlender Schluessel oder eine doppelt
    gesendete Anfrage sind Dinge, die der Benutzer sofort erfahren soll — nicht
    Sekunden spaeter aus einem Ereignisstrom. Erst wenn all das durch ist,
    beginnt die eigentliche Arbeit, und ab da haengt sie an nichts mehr.

    ``unbeaufsichtigt`` sagt an, dass dies eine Heilung oder ein fällig
    gewordener Auftrag wird. Es wirkt ausschließlich auf das Skill-Verzeichnis
    (die Datennachricht hinter dem Systemprompt entfällt in einem Lauf ohne
    Zuschauer, siehe `ai_context_service._skill_index_block`): der Rahmen
    selbst (``zustand["guardian"]``, ``zustand["aufgabe"]``) entsteht erst
    **nach** dieser Funktion, der Kontext aber schon darin — ohne diesen
    Wert ließe sich der Unterschied hier nicht sehen. Ein eigener Wert und
    nicht an ``guardian_briefing_unterdruecken`` angehängt: das eine
    unterdrückt einen Bericht, das andere entscheidet über den Prompt, und ein
    Aufrufer, der nur das eine will, soll nicht stillschweigend das andere
    bekommen.

    ``rolle`` (voll/gehirn/worker) wird ohne Angabe aus Fensterart, Zugang und
    ``unbeaufsichtigt`` abgeleitet (`_rolle_ableiten`) und im Laufzustand
    eingefroren — jede Fortsetzung arbeitet unter derselben Rolle wie der
    erste Zug. Explizit setzt sie nur die Meldestelle: ihr Lieferlauf ist ein
    Gehirn-Zug im Dauerchat, obwohl niemand davor sitzt.

    ``familie`` ist das **Gerät**, von dem die Bitte kam (die Refresh-Familie
    der Sitzung). Es wird wie ``herkunft`` eingefroren, weil ein Lauf zwischen
    seinen Segmenten schläft: wacht er auf, um einen Auftrag an den Rechner zu
    legen, gibt es die Anfrage von damals längst nicht mehr. Ohne den Wert
    holt sich den Auftrag der Rechner, der zuerst fragt — bei mehreren
    gekoppelten Geräten also nicht zwingend der, an dem der Mensch sitzt.
    ``None`` heißt „nicht bekannt": dann bleibt der Auftrag für alle Geräte
    dieses Benutzers abholbar, so wie vor dieser Spalte.

    ``intern`` markiert die Benutzernachricht als **Maschinerie**: eine Zeile,
    die kein Mensch getippt hat und die er deshalb auch nicht lesen soll. Sie
    entsteht trotzdem und geht vollständig in den Kontext — nur der Weg in den
    Browser filtert sie (`routers/ai_chat.list_messages`). Vier Aufrufer
    setzen sie: die Zustellung der Worker-Meldungen, das Guardian-Briefing,
    der Wiederanlauf nach einem Neustart und die Notiz über eine abgebrochene
    Runde. Ohne sie las der Betreiber im eigenen Chat Anweisungen an die KI,
    adressiert an ihn selbst.
    """
    safe_content = redact_sensitive_text(content).strip()
    # Ein Bild ohne Begleittext ist eine vollstaendige Frage ("Was ist das?").
    # Der Anhang wird erst beim Anlegen der Nachricht gebunden; vorher ist
    # genau die Menge der ungebundenen Anhaenge die Antwort darauf, ob diese
    # Nachricht Inhalt hat.
    if not safe_content and not ai_attachment_service.has_unbound(
        db, conversation.id, user.id
    ):
        return None, ("AI_MESSAGE_EMPTY", "ai.chat.errors.empty")
    if rolle is None:
        rolle = _rolle_ableiten(db, user, conversation, provider, unbeaufsichtigt)

    # Teamwissen gehoert echten Teammitgliedern. Ein Link-Gast hat Zugriff auf
    # das Dokument, aber keinen Platz in der Mitgliederliste — er bekommt
    # weder Team-Gedaechtnis noch Team-Skills in den Prompt. Die Pruefung
    # steht vor dem Kontextaufbau, weil `build_provider_messages` die Team-ID
    # sonst bereits weitergereicht haette.
    if docs_team_id is not None:
        from models.team import Team
        from services import team_service

        team = db.get(Team, docs_team_id)
        if (
            team is None
            or team.is_personal
            or team_service.membership(db, docs_team_id, user.id) is None
        ):
            docs_team_id = None
    # Nur die App darf ihre Faehigkeiten melden, und nur um das Angebot zu
    # verkleinern. Die Ausfuehrung bleibt in Tauri gesperrt.
    computer_use_aktiv: bool | None = None
    if herkunft == "desktop" and isinstance(app_faehigkeiten, dict):
        wert = app_faehigkeiten.get("computer_use")
        if isinstance(wert, bool):
            computer_use_aktiv = wert
    try:
        geerbte_signaturen = ai_run_service.vorgaenger_abloesen(
            db, conversation_id=conversation.id
        )

        benutzernachricht_id = str(uuid4())
        user_msg = AiMessage(
            id=benutzernachricht_id,
            conversation_id=conversation.id,
            role="user",
            content=safe_content,
            status="complete",
            intern=intern,
        )
        db.add(user_msg)
        gebundene_anhaenge = ai_attachment_service.bind_to_message(
            db, conversation_id=conversation.id, user_id=user.id,
            message_id=benutzernachricht_id,
        )
        db.flush()
        # Das Thema laeuft weiter, auch wenn der Lauf wechselt: "und jetzt
        # starte ihn neu" nennt keinen Server, gemeint ist der aus der Frage
        # davor. Einmal ermittelt und zweimal gebraucht — fuer den Kontext
        # dieser Nachricht und als Startwert des neuen Laufs.
        #
        serverbezug = ai_run_service.letzter_serverbezug(
            db, conversation_id=conversation.id
        )
        # Der Anhang-Adapter muss wissen, in welchem Dialekt der Zugang
        # antwortet. Das ist eine Eigenschaft des Anbieters, nicht des
        # Modellnamens; ein unbekannter Anbieter faellt auf die verbreitete
        # Chat-Completions-Form zurueck.
        try:
            provider_protokoll = ai_provider_service.effective_spec(
                provider
            ).protokoll_chat
        except (KeyError, AiProviderConfigurationError):
            provider_protokoll = None
        provider_messages = build_provider_messages(
            db, conversation, query=safe_content, server_id=serverbezug,
            context_chars=context_chars, unbeaufsichtigt=unbeaufsichtigt,
            gesprochen=gesprochen, rolle=rolle, herkunft=herkunft,
            docs=bool(docs_document_uid),
            docs_team_id=docs_team_id,
            docs_is_link_guest=docs_is_link_guest,
            modell_sieht=modell_sieht, computer_use_aktiv=computer_use_aktiv,
            provider_protokoll=provider_protokoll,
        )
        # Eine Unterbrechung ist keine neue Information des Benutzers und darf
        # deshalb weder als Chatzeile gespeichert noch in die Erinnerung
        # uebernommen werden. Das Modell braucht sie trotzdem im naechsten
        # Sprachzug, damit es nicht bei einem bereits gehoerten Satz wieder
        # einsetzt. Der Hinweis lebt darum nur in dieser Provider-Anfrage.
        effective_project_id = project_id or getattr(conversation, "project_id", None)
        if effective_project_id:
            try:
                from services import ai_project_service

                proj = ai_project_service.get_project(db, user, str(effective_project_id))
                if proj is not None:
                    proj_lines = [
                        f"Aktives Singra-Projekt: {proj.name} (project_id: {proj.id})",
                    ]
                    if proj.description:
                        proj_lines.append(f"Projektbeschreibung: {proj.description}")
                    if proj.system_prompt:
                        proj_lines.append(f"Projektanweisungen:\n{proj.system_prompt}")
                    try:
                        rules = ai_project_service.get_project_agents_rules(db, user, proj.id)
                        if rules.get("found") and rules.get("content"):
                            proj_lines.append(
                                f"Projektregeln aus {rules['filename']} (zwingend zu beachten):\n{rules['content']}"
                            )
                    except Exception:
                        pass
                    if proj.sandbox_enabled and proj.sandbox_path:
                        proj_lines.append(f"Server-Sandbox aktiv: {proj.sandbox_path}")
                    if proj.local_directory:
                        proj_lines.append(f"Lokaler Projektordner: {proj.local_directory}")
                    if proj.git_repo_url:
                        proj_lines.append(
                            f"Git-Repository ({proj.git_provider or 'git'}): {proj.git_repo_url} (Branch: {proj.git_branch})"
                        )
                    proj_lines.append(
                        "Nutze das Werkzeug `project_workspace` mit dieser `project_id`, um Dateien zu lesen/schreiben, Befehle in der Sandbox auszuführen oder Git-Aktionen durchzuführen."
                    )
                    provider_messages.append({
                        "role": "system",
                        "content": "\n".join(proj_lines),
                    })
            except Exception as exc:
                logger.debug("Projektkontext konnte nicht geladen werden: %s", type(exc).__name__)
        if voice_output_checkpoint:
            provider_messages.append({
                "role": "system",
                "content": (
                    "Die vorige Sprachausgabe wurde unterbrochen. Bis hierher "
                    "wurde bereits gehoert: " + voice_output_checkpoint[:2_000]
                    + "\nSetze diesen Inhalt nicht ungefragt fort und wiederhole ihn nicht."
                ),
            })
        # Was Guardian gemeldet hat, waehrend niemand da war. Nur wenn dieser
        # Lauf nicht selbst aus einer Heilung stammt — sonst berichtete die KI
        # sich selbst von dem Vorfall, an dem sie gerade arbeitet.
        #
        # Der Block wird **hier** angehaengt und nicht in
        # `build_provider_messages`: er gehoert zum Start eines Laufs, nicht zum
        # Kontext allgemein, und die Kennungen muessen in den Laufzustand. Eine
        # Provider-Nachricht mit einem Zusatzfeld waere der falsche Traeger — sie
        # geht so, wie sie ist, an den Anbieter.
        gebrieft: list[int] = []
        if not guardian_briefing_unterdruecken:
            from services.ai_guardian_service import briefing_nachricht

            briefing = briefing_nachricht(db, user)
            if briefing is not None:
                text, gebrieft = briefing
                provider_messages.append({"role": "user", "content": text})
        estimated_tokens = estimate_reserved_tokens(provider_messages)
        # Das Modell der Rolle — ein Worker bucht und beschriftet mit dem
        # Arbeitsmodell des Betreibers, nicht mit `default_model`.
        vorab_zustand = {"requested_model": requested_model} if requested_model else None
        modell = _modell_fuer(provider, rolle, vorab_zustand)
        usage_event = ai_stream.reserve_ai_usage(
            db,
            user,
            request_id=request_id,
            estimated_tokens=estimated_tokens,
            estimated_cost_microunits=estimate_cost_microunits(provider, estimated_tokens),
            server_id=None,
            provider_id=provider.id,
            model=modell,
        )
        message_id = str(uuid4())
        db.add(AiMessage(
            id=message_id,
            conversation_id=conversation.id,
            role="assistant",
            content="",
            status="streaming",
            provider_id=provider.id,
            model=modell,
            request_id=str(request_id),
        ))
        conversation.updated_at = datetime.now(timezone.utc)

        zustand = ai_run_service.leerer_zustand(
            provider_messages,
            request_id=str(request_id),
            user_message_id=benutzernachricht_id,
        )
        zustand["usage_event_id"] = usage_event.id
        zustand["tool_signatures"] = geerbte_signaturen
        zustand["guardian_briefed"] = gebrieft
        # Die Rolle, eingefroren wie die Denkstufe: der Systemprompt in den
        # `provider_messages` ist bereits nach ihr geschnitten, und jede
        # Fortsetzung muss denselben Katalogschnitt sehen wie der erste Zug.
        zustand["rolle"] = rolle
        # Nur Kennungen, kein Dokumenttext: `state_json` ist eine Klartextspalte.
        if docs_document_uid:
            zustand["docs"] = {
                "document_uid": str(docs_document_uid),
                "team_id": int(docs_team_id) if docs_team_id is not None else None,
                "team_mitglied": docs_team_id is not None,
            }
        # Und die Herkunft, aus demselben Grund: der Katalog ist danach
        # geschnitten (`herkunft_schnitt`), und eine Fortsetzung darf nicht in
        # einer anderen Welt aufwachen als der erste Zug.
        zustand["herkunft"] = herkunft
        # Und daneben das Geraet: die Herkunft sagt "aus der App", die Familie
        # sagt "aus **dieser** App". Nur zusammen adressieren sie einen
        # Auftrag (`_desktop_behandeln`); die Familie allein entscheidet
        # nichts — weder ueber Rechte noch ueber den Katalog.
        zustand["familie"] = familie
        # Ob in dieser Runde ein Anhang mitgeht und ob Computer-Use ueberhaupt
        # erlaubt ist. Beides entscheidet nur ueber das Werkzeugangebot, nie
        # ueber Rechte; der Herkunftsschnitt bleibt die harte Grenze.
        zustand["hat_anhaenge"] = gebundene_anhaenge > 0
        zustand["computer_use_aktiv"] = computer_use_aktiv
        # Nur die Absicht, nicht die Frage: Der Arbeitszustand soll nach dem
        # Lauf keine Frage mehr tragen. Der Wert entscheidet, ob ein
        # Anhang-Turn die Desktop-Werkzeuge sehen darf.
        from services.tool_selection_port import desktop_absicht

        zustand["desktop_absicht"] = desktop_absicht(safe_content)
        # Das Budget dieses Laufs, festgehalten fuer alle Fortsetzungen. Es hier
        # abzulegen statt es je Segment neu zu ermitteln ist dieselbe
        # Entscheidung wie bei `reasoning_effort`: was mitten in einer Aufgabe
        # gilt, darf sich nicht aendern, weil jemand zwischendurch das Modell
        # umgestellt hat.
        zustand["context_chars"] = context_chars
        if requested_model:
            zustand["requested_model"] = str(requested_model).strip()
        effective_project_id = project_id or getattr(conversation, "project_id", None)
        if effective_project_id:
            zustand["project_id"] = str(effective_project_id)
        run = ai_run_service.lauf_anlegen(
            db,
            conversation_id=conversation.id,
            user_id=user.id,
            provider_id=provider.id,
            message_id=message_id,
            reasoning=reasoning,
            reasoning_effort=reasoning_effort,
            zustand=zustand,
            last_server_id=serverbezug,
        )
        db.commit()
        return run, None
    except IntegrityError:
        db.rollback()
        return None, ("AI_REQUEST_CONFLICT", "ai.chat.errors.requestConflict")
    except AiUsageConflict:
        db.rollback()
        return None, ("AI_REQUEST_CONFLICT", "ai.chat.errors.requestConflict")
    except AiQuotaExceeded as exc:
        db.rollback()
        return None, (f"AI_QUOTA_{exc.reason.upper()}", "ai.chat.errors.quota")
    except DisSidecarError:
        db.rollback()
        return None, ("AI_CREDENTIAL_UNAVAILABLE", "ai.chat.errors.credential")
    except Exception as exc:
        db.rollback()
        logger.warning("AI-Lauf konnte nicht beginnen error=%s", type(exc).__name__)
        return None, ("AI_PREPARATION_FAILED", "ai.chat.errors.unavailable")


def _anlauf_nebenlaeufigkeit() -> int:
    """Wieviele Laufbeginne gleichzeitig laufen duerfen.

    Dieselbe Regel wie bei `_werkzeug_nebenlaeufigkeit`: jeder Anlauf holt sich
    seine eigene Verbindung aus dem Pool (die Testsuite drosselt auf eins, weil
    sie je Worker nur eine Verbindung hat).

    Acht und nicht mehr, obwohl `pool_size=10` plus `max_overflow=20` mehr
    hergaebe: der Anlauf ist kurz (13 ms), aber er ist nicht das Einzige, was
    Verbindungen braucht. Bei Stufe 200 waren schon vorher 20 von 30
    gleichzeitig ausgeliehen. Eine unbegrenzte Breite haette daraus 200
    gleichzeitig wartende Anlaeufe gemacht — der Pool haette abgesagt, und zwar
    zuerst den gewoehnlichen Anfragen des Panels.

    **Der wichtigere Teil ist ohnehin der Thread.** Der Anlauf laeuft durch
    `asyncio.to_thread` und damit *neben* der Schleife. Die Gleichzeitigkeit
    ist der zweite Gewinn, nicht der erste.
    """
    return 8


@asynccontextmanager
async def _anlaufrecht(conversation_id: str) -> AsyncIterator[None]:
    """Haelt die Reihenfolge, die `lauf_beginnen` bisher geschenkt bekam.

    Solange der Anlauf synchron auf der Schleife lief, konnte es je Unterhaltung
    gar keine zwei geben — das erledigte das Nichtvorhandensein von
    Nebenlaeufigkeit. Im Thread ist das weg, und ausgerechnet hier haengt daran
    etwas Tragendes: `vorgaenger_abloesen` beendet die offenen Laeufe der
    Unterhaltung, und **danach** wird der neue angelegt. Liefen zwei Anlaeufe
    derselben Unterhaltung gleichzeitig, koennte jeder abloesen, bevor der
    andere angelegt hat — und am Ende schrieben zwei Laeufe in denselben Chat.
    Ein Benutzer hat genau eine Unterhaltung; zwei schnell hintereinander
    abgeschickte Nachrichten reichen also aus.

    Das Schloss haengt an der Unterhaltung und nicht am Prozess: zwei Benutzer
    stehen sich damit nicht im Weg, und genau darum geht es.

    **Erst das Schloss, dann die Schranke.** Andersherum haetten Wartende einer
    besetzten Unterhaltung Plaetze der Schranke belegt, ohne zu arbeiten.
    """
    # Globals on ai_stream package
    schleife = asyncio.get_running_loop()
    if schleife is not ai_stream._ANLAUF_SCHLEIFE:
        ai_stream._ANLAUF_SCHLEIFE = schleife
        ai_stream._ANLAUF_SCHRANKE = asyncio.Semaphore(ai_stream._anlauf_nebenlaeufigkeit())
        ai_stream._ANLAUF_SCHLOESSER.clear()
        ai_stream._ANLAUF_WARTENDE.clear()
    schloss = ai_stream._ANLAUF_SCHLOESSER.get(conversation_id)
    if schloss is None:
        schloss = asyncio.Lock()
        ai_stream._ANLAUF_SCHLOESSER[conversation_id] = schloss
    # Mitgezaehlt wird, damit das Schloss wieder verschwindet. Ohne das waechst
    # die Ablage mit jeder je begonnenen Unterhaltung und wird nie kleiner.
    ai_stream._ANLAUF_WARTENDE[conversation_id] = ai_stream._ANLAUF_WARTENDE.get(conversation_id, 0) + 1
    try:
        async with schloss:
            assert ai_stream._ANLAUF_SCHRANKE is not None
            async with ai_stream._ANLAUF_SCHRANKE:
                yield
    finally:
        rest = ai_stream._ANLAUF_WARTENDE.get(conversation_id, 1) - 1
        if rest > 0:
            ai_stream._ANLAUF_WARTENDE[conversation_id] = rest
        else:
            ai_stream._ANLAUF_WARTENDE.pop(conversation_id, None)
            ai_stream._ANLAUF_SCHLOESSER.pop(conversation_id, None)


def _anlauf_im_thread(
    *,
    user_id: int,
    conversation_id: str,
    provider_id: int,
    request_id: UUID,
    content: str,
    reasoning: bool,
    reasoning_effort: str | None,
    context_chars: int | None,
    guardian_briefing_unterdruecken: bool,
    gesprochen: bool = False,
    herkunft: str = "panel",
    familie: str | None = None,
    voice_output_checkpoint: str | None = None,
    docs_document_uid: str | None = None,
    docs_team_id: int | None = None,
    docs_is_link_guest: bool = False,
    modell_sieht: bool | None = None,
    app_faehigkeiten: dict[str, Any] | None = None,
    requested_model: str | None = None,
    project_id: str | None = None,
) -> tuple[str | None, tuple[str, str] | None]:
    """Der Anlauf mit **eigener** Sitzung — das ist der ganze Zweck.

    Eine Sitzung ueber eine Threadgrenze zu reichen ist ein Fehler, kein
    Sparfleck: SQLAlchemy-Sitzungen sind nicht threadsicher, und die des
    Requests wird vom Request-Thread gleich danach geschlossen. Deshalb kommen
    hier nur Kennungen an, und die Objekte werden neu geholt.

    Das Neuholen ist zugleich die zweite Pruefung. Zwischen Rechtepruefung im
    Endpunkt und diesem Punkt liegt jetzt eine Wartezeit an der Schranke — in
    der ein Benutzer gesperrt oder ein Anbieter abgeschaltet worden sein kann.
    """
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            logger.info("Anlauf verworfen: Benutzer weg oder gesperrt user_id=%s", user_id)
            return None, ("AI_PREPARATION_FAILED", "ai.chat.errors.unavailable")
        conversation = get_owned_conversation(db, conversation_id, user)
        if conversation is None:
            logger.info("Anlauf verworfen: Unterhaltung weg conversation_id=%s", conversation_id)
            return None, ("AI_PREPARATION_FAILED", "ai.chat.errors.unavailable")
        provider = db.get(AiProvider, provider_id)
        if provider is None or not provider.enabled:
            logger.info("Anlauf verworfen: Anbieter weg provider_id=%s", provider_id)
            return None, ("AI_PREPARATION_FAILED", "ai.chat.errors.unavailable")
        run, fehler = ai_stream.lauf_beginnen(
            db,
            user=user,
            conversation=conversation,
            provider=provider,
            request_id=request_id,
            content=content,
            reasoning=reasoning,
            reasoning_effort=reasoning_effort,
            context_chars=context_chars,
            guardian_briefing_unterdruecken=guardian_briefing_unterdruecken,
            gesprochen=gesprochen,
            herkunft=herkunft,
            familie=familie,
            voice_output_checkpoint=voice_output_checkpoint,
            docs_document_uid=docs_document_uid,
            docs_team_id=docs_team_id,
            docs_is_link_guest=docs_is_link_guest,
            modell_sieht=modell_sieht,
            app_faehigkeiten=app_faehigkeiten,
            requested_model=requested_model,
            project_id=project_id,
        )
        # Nur die Kennung verlaesst den Thread. Ein ORM-Objekt aus einer gleich
        # geschlossenen Sitzung ist eine Falle: nach dem Commit sind seine
        # Felder abgelaufen, und der erste Zugriff danach wirft.
        return (run.id if run is not None else None), fehler


async def lauf_beginnen_nebenher(
    *,
    user_id: int,
    conversation_id: str,
    provider_id: int,
    request_id: UUID,
    content: str,
    reasoning: bool,
    reasoning_effort: str | None = None,
    context_chars: int | None = None,
    guardian_briefing_unterdruecken: bool = False,
    gesprochen: bool = False,
    herkunft: str = "panel",
    familie: str | None = None,
    voice_output_checkpoint: str | None = None,
    docs_document_uid: str | None = None,
    docs_team_id: int | None = None,
    docs_is_link_guest: bool = False,
    modell_sieht: bool | None = None,
    app_faehigkeiten: dict[str, Any] | None = None,
    requested_model: str | None = None,
    project_id: str | None = None,
) -> tuple[str | None, tuple[str, str] | None]:
    """`lauf_beginnen`, aber **neben** der Ereignisschleife statt auf ihr.

    Gibt die Lauf-Kennung zurueck und nicht den Lauf — siehe `_anlauf_im_thread`.
    Der Endpunkt braucht ohnehin nur sie: mit ihr haengt sich der Browser an den
    Ereignisstrom, und das passiert weiterhin sofort, ohne Umweg ueber einen
    Hintergrundauftrag. Verschoben wird nur, **wo** gerechnet wird, nicht
    **wann** geantwortet wird. Ein ueberschrittenes Kontingent und ein
    Anfragekonflikt kommen deshalb weiterhin unmittelbar zurueck.
    """
    async with _anlaufrecht(conversation_id):
        return await asyncio.to_thread(
            ai_stream._anlauf_im_thread,
            user_id=user_id,
            conversation_id=conversation_id,
            provider_id=provider_id,
            request_id=request_id,
            content=content,
            reasoning=reasoning,
            reasoning_effort=reasoning_effort,
            context_chars=context_chars,
            guardian_briefing_unterdruecken=guardian_briefing_unterdruecken,
            gesprochen=gesprochen,
            herkunft=herkunft,
            familie=familie,
            voice_output_checkpoint=voice_output_checkpoint,
            docs_document_uid=docs_document_uid,
            docs_team_id=docs_team_id,
            docs_is_link_guest=docs_is_link_guest,
            modell_sieht=modell_sieht,
            app_faehigkeiten=app_faehigkeiten,
            requested_model=requested_model,
            project_id=project_id,
        )

