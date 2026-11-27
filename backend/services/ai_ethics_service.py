"""Ethics Advisory Service für das MSM-Agentic-Framework.

Führt eine fundierte, isolierte ethische Bewertung einer geplanten Handlung durch.
Arbeitet als interner Berater für das Gehirn (Brain) und führt selbst keine Tools aus.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import json
import logging
import threading
import time
from typing import Any, Literal
import httpx
from pydantic import BaseModel, Field, PrivateAttr
from sqlalchemy.orm import Session

from database import SessionLocal
from models import AiProvider, User
from services import ai_provider_service, ai_usage_service, audit_service
from services.ai_ethics_trigger import DecisionContext, should_trigger_ethics
from services.ai_latency_metrics import measure
from services.ai_redaction import redact_sensitive_text
from services.openai_compatible_adapter import (
    AiProviderRequestError,
    StreamUsage,
    stream_chat_completion,
)


logger = logging.getLogger(__name__)

#: Wie lange die Beratung vor einem Werkzeug höchstens dauern darf.
#:
#: Sie steht vor einer Karte oder einer Ausführung, in der Stimme auch vor der
#: nächsten Antwort. Ein langsames Ethikmodell darf dort nicht die ganze
#: Werkzeugfrist (60 s) aufbrauchen. Läuft sie ab, geht der Aufruf ohne Hinweis
#: weiter: die Engine berät, sie hält nichts auf.
BERATUNG_ZEITGRENZE_SEKUNDEN = 15.0


class AiEthicsEvaluation(BaseModel):
    """Das strukturierte Ergebnis einer ethischen Beurteilung."""

    assessment: Literal["low", "review", "critical"]
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    concerns: list[str] = Field(default_factory=list)
    affected_interests: list[str] = Field(default_factory=list)
    possible_harm: list[str] = Field(default_factory=list)
    alternative: str | None = None
    recommendation: str
    reason: str
    #: ``True`` beim Rückfall (`fallback_evaluation`): dann hat kein Modell
    #: geurteilt, und ans Modell geht nichts weiter. Ein „critical" aus dem
    #: Rückfall ist keine Einschätzung, nur die Ableitung aus der Tabelle.
    #: Privat, damit eine Antwort des Ethikmodells das Feld nicht setzen kann.
    _ersatz: bool = PrivateAttr(default=False)


ETHICS_SYSTEM_PROMPT = """Du bist die interne Ethics Advisory Engine von Maunting Service Manager (MSM).
Deine Aufgabe ist eine fundierte, ethisch-konstruktive und sicherheitsbewusste Beurteilung einer geplanten Systemhandlung.

Prüfkriterien:
1. Perspektivübernahme & Betroffene: Wer oder was ist von dieser Handlung betroffen (Benutzer, Server, Kunden, Dritte, Integrität von Daten)?
2. Möglicher Schaden: Welche direkten oder indirekten Schäden könnten entstehen (Datenverlust, Ausfallzeiten, Missbrauch, Vertrauensverlust)?
3. Wertekonflikte: Gibt es Konflikte zwischen Schnelligkeit, Komfort, Datensparsamkeit und Systemsicherheit?
4. Verhältnismäßigkeit & Alternativen: Gibt es eine schonendere, sicherere oder risikoärmere Vorgehensweise?
5. Absichts-Klarheit: Ist das Handlungsziel eindeutig vom autorisierten Benutzer gewollt oder birgt es Missverständnisse?

Antworte AUSSCHLIESSLICH im folgenden JSON-Format ohne zusätzlichen Begleittext:
{
  "assessment": "low" | "review" | "critical",
  "confidence": 0.0 bis 1.0,
  "concerns": ["Konkreter Bedenkenpunkt 1", "..."],
  "affected_interests": ["Betroffenes Interesse / Systemgut 1", "..."],
  "possible_harm": ["Möglicher negativer Effekt 1", "..."],
  "alternative": "Empfohlene schonendere Alternative oder null",
  "recommendation": "Konkrete, handlungsorientierte Empfehlung für das Gehirn",
  "reason": "Kompakte Begründung der ethischen Abwägung"
}
"""


def _build_user_prompt(
    context: DecisionContext, relevant_memories: list[str] | None = None
) -> str:
    """Erstellt den kompakten Kontext-Prompt für die Ethics Engine."""
    parts = [
        f"Ziel: {context.goal}",
        f"Geplante Handlung: {context.planned_action}",
        f"Werkzeug: {context.tool_name}",
        f"Parameter: {json.dumps(context.tool_arguments, ensure_ascii=False)}",
        f"Destruktiv / Unumkehrbar: {'Ja' if context.is_destructive else 'Nein'}",
        f"Bedarf Bestätigung: {'Ja' if context.requires_confirmation else 'Nein'}",
        f"Autonomer Modus: {'Ja' if context.autonomous else 'Nein'}",
    ]
    if context.server_id is not None:
        parts.append(f"Betroffene Server-ID: {context.server_id}")
    if context.target_description:
        parts.append(f"Zielbeschreibung: {context.target_description}")
    if relevant_memories:
        mem_str = "\n".join(f"- {m}" for m in relevant_memories[:5])
        parts.append(f"Relevanter Gedächtniskontext:\n{mem_str}")

    return "\n".join(parts)


def fallback_evaluation(
    context: DecisionContext, *, reason: str = "Ethics Engine Failsafe-Modus"
) -> AiEthicsEvaluation:
    """Sicherer Fallback, falls der Provider nicht erreichbar ist oder kein Modell gesetzt ist."""
    assessment: Literal["low", "review", "critical"] = (
        "critical" if context.is_destructive else ("review" if context.requires_confirmation else "low")
    )
    bewertung = AiEthicsEvaluation(
        assessment=assessment,
        confidence=0.5,
        concerns=["Ethics-Engine-Antwort konnte nicht bezogen werden. Mechanische Sicherheitsgrenzen greifen."],
        affected_interests=["Systemstabilität", "Datensicherheit"],
        possible_harm=["Potenzieller unbemerkter Eingriff ohne ethische Detailprüfung"],
        alternative=None,
        recommendation="Führe die geplante Handlung unter strikter Beachtung aller Bestätigungs- und Sicherheitsregeln durch.",
        reason=reason,
    )
    bewertung._ersatz = True
    return bewertung


async def evaluate_decision(
    http_client: httpx.AsyncClient,
    db: Session,
    provider: AiProvider,
    user: User,
    context: DecisionContext,
    relevant_memories: list[str] | None = None,
) -> AiEthicsEvaluation:
    """Führt die ethische Bewertung mit dem konfigurierten Ethik-Modell durch."""
    target_provider = provider
    if not (
        target_provider.ethics_model
        and getattr(target_provider, "ethics_enabled", True)
        and (target_provider.ethics_mode or "auto") != "off"
    ):
        fallback_providers = (
            db.query(AiProvider)
            .filter(
                AiProvider.enabled.is_(True),
                AiProvider.ethics_enabled.is_(True),
                AiProvider.ethics_model.isnot(None),
            )
            .order_by(AiProvider.id.asc())
            .all()
        )
        for cand in fallback_providers:
            if (cand.ethics_mode or "auto") != "off" and (
                not cand.requires_api_key or cand.operator_api_key_encrypted
            ):
                target_provider = cand
                break

    if not target_provider.ethics_model or (target_provider.ethics_mode or "auto") == "off":
        return fallback_evaluation(
            context, reason="Ethics Engine ist nicht konfiguriert oder deaktiviert"
        )

    api_key = ai_provider_service.resolve_api_key(db, target_provider, user.id)
    if target_provider.requires_api_key and not api_key:
        logger.warning(
            "Ethics Engine: Kein API-Schlüssel für Provider %s hinterlegt", target_provider.id
        )
        return fallback_evaluation(
            context, reason="API-Schlüssel für Ethics Engine fehlt"
        )

    from services import branding_service

    user_prompt = _build_user_prompt(context, relevant_memories)
    messages = [
        {"role": "system", "content": branding_service.apply_brand_name(ETHICS_SYSTEM_PROMPT, db=db)},
        {"role": "user", "content": user_prompt},
    ]

    usage = StreamUsage()
    raw_response_text = ""

    try:
        eth_reasoning, eth_effort = _resolve_ethics_reasoning(target_provider)
        async for chunk in stream_chat_completion(
            http_client,
            provider=target_provider,
            api_key=api_key,
            messages=messages,
            usage=usage,
            tools=None,
            model=target_provider.ethics_model,
            reasoning=eth_reasoning,
            reasoning_effort=eth_effort,
            json_schema=AiEthicsEvaluation.model_json_schema(),
        ):
            if chunk.kind == "content" and chunk.text:
                raw_response_text += chunk.text

        # JSON aus der Antwort extrahieren
        clean_text = raw_response_text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        elif clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()

        data = json.loads(clean_text)
        evaluation = AiEthicsEvaluation(**data)

        # Audit-Protokollierung bei kritischen oder relevanten Befunden
        if evaluation.assessment in ("review", "critical"):
            audit_service.record_privileged_action(
                db,
                user_id=user.id,
                action="ai.ethics.evaluated",
                target_type="ai_action",
                target_id=context.server_id,
                details={
                    "tool_name": context.tool_name,
                    "assessment": evaluation.assessment,
                    "confidence": evaluation.confidence,
                    "reason": evaluation.reason[:200],
                },
            )
            db.commit()

        return evaluation

    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "Ethics Engine: Fehler beim Parsen der JSON-Antwort von %s: %s",
            target_provider.ethics_model,
            exc,
        )
        return fallback_evaluation(
            context, reason="Antwort der Ethics Engine entsprach nicht dem geforderten Schema"
        )
    except (AiProviderRequestError, httpx.HTTPError, Exception) as exc:
        logger.warning(
            "Ethics Engine: Provider-Aufruf für Modell %s fehlgeschlagen: %s",
            target_provider.ethics_model,
            exc,
        )
        return fallback_evaluation(
            context, reason=f"Provider-Fehler bei der Ethics Engine: {type(exc).__name__}"
        )
    finally:
        # Auch nach einer unbrauchbaren Antwort, einem Abbruch mitten im Strom
        # und dem Abbruch nach der Frist (`_Beratung.abbrechen`): bezahlt hat
        # der Betreiber den Aufruf in jedem dieser Fälle.
        _verbrauch_buchen(
            db, user, target_provider,
            usage=usage, messages=messages, antwort=raw_response_text,
        )


def _verbrauch_buchen(
    db: Session,
    user: User,
    anbieter: AiProvider,
    *,
    usage: StreamUsage,
    messages: list[dict],
    antwort: str,
) -> None:
    """Bucht eine Beurteilung beim Benutzer, dessen Lauf sie ausgelöst hat.

    Bis zum 24.09.2026 blieb jede Beratung ungebucht, obwohl sie seit dem
    23.09. vor jedem folgenreichen Werkzeug läuft.

    Gebucht wird nachträglich und ohne Prüfung der Grenzen
    (`ai_usage_service.nachtraeglich_buchen`): die Engine berät, und ein
    ausgeschöpftes Kontingent darf weder den Rat verhindern noch den Lauf
    beenden. In Tokens und Kosten zählt sie trotzdem, nur nicht als Anfrage
    pro Minute.

    Bepreist mit den Ethikpreisen des Zugangs (Eingabe, Ausgabe, Cache), weil
    das Ethikmodell ein anderes sein kann als das Chatmodell. Fehlt einer der
    beiden ersten, gilt der gepflegte Rückfallpreis wie überall sonst. Meldet
    der Anbieter den Betrag selbst, gilt der.

    Nichts gebucht wird, wenn keine Antwort kam und der Anbieter nichts
    gemeldet hat: dann ist der Aufruf nicht angekommen, wie bei
    `fail_ai_usage`. Ein Fehler beim Buchen kostet die Buchung, nie die
    Beratung.
    """
    if usage.total_tokens is None and not (
        usage.vom_anbieter or antwort or usage.output_chars or usage.reasoning_chars
    ):
        return
    eingabe = max(1, sum(len(str(m.get("content") or "")) for m in messages) // 4)
    ausgabe = (len(antwort) + usage.reasoning_chars) // 4
    try:
        if not db.is_active:
            # Ein gescheiterter Auditeintrag lässt die Sitzung im Fehlerzustand
            # zurück; der Verbrauch ist trotzdem angefallen.
            db.rollback()
        ai_usage_service.nachtraeglich_buchen(
            db,
            user,
            zweck=ai_usage_service.ZWECK_ETHIK,
            usage=usage,
            estimated_actual_tokens=min(eingabe + ausgabe, ai_usage_service.TOKEN_LIMIT_MAX),
            provider_id=anbieter.id,
            model=anbieter.ethics_model,
            token_price_micro_usd_per_million=anbieter.token_price_micro_usd_per_million,
            rollenpreise=(
                anbieter.ethics_input_price_micro_usd_per_million,
                anbieter.ethics_output_price_micro_usd_per_million,
                anbieter.ethics_cache_price_micro_usd_per_million,
            ),
            geschaetzte_teile=(eingabe, ausgabe),
        )
        db.commit()
    except Exception as fehler:  # noqa: BLE001 - Buchung hält die Beratung nicht auf
        db.rollback()
        logger.warning(
            "Ethics Engine: Verbrauch nicht gebucht fuer Benutzer %s: %s",
            getattr(user, "id", None),
            type(fehler).__name__,
        )


# ── Beratung vor den Werkzeugen, im Chat und in der Stimme ────────────────


def ethik_anbieter(db: Session, bevorzugt_id: int | None) -> AiProvider | None:
    """Der Anbieter, dessen Ethik-Engine gilt.

    Der bevorzugte, wenn er eine eingerichtet hat: im Chat der Anbieter des
    Laufs, in der Stimme der am Konto gewählte. Sonst der erste eingeschaltete
    Anbieter mit einer. Eine Sprachsitzung spricht oft über einen anderen
    Anbieter als der Chat; ohne den Rückfall bliebe die Engine dort stumm,
    obwohl der Betreiber sie eingerichtet hat.
    """
    if bevorzugt_id is not None:
        bevorzugt = db.get(AiProvider, bevorzugt_id)
        if bevorzugt is not None and ai_provider_service.fuer_ethics(bevorzugt):
            return bevorzugt
    kandidaten = (
        db.query(AiProvider)
        .filter(
            AiProvider.enabled.is_(True),
            AiProvider.ethics_enabled.is_(True),
            AiProvider.ethics_model.isnot(None),
        )
        .order_by(AiProvider.id.asc())
        .all()
    )
    for kandidat in kandidaten:
        if ai_provider_service.fuer_ethics(kandidat) and (
            not kandidat.requires_api_key or kandidat.operator_api_key_encrypted
        ):
            return kandidat
    return None


def hinweis_fuers_modell(bewertung: AiEthicsEvaluation) -> dict | None:
    """Was das Modell von einer Beurteilung erfährt, oder ``None``.

    Nur ein echtes Urteil, und nur `review` oder `critical`: ein `low` ändert
    nichts an der Handlung, und der Rückfall ist kein Urteil.

    Der Hinweis ist als ``untrusted`` markiert. Das Ethikmodell hat die
    Werkzeugargumente gelesen, und die können aus einer Logzeile oder Mail
    stammen; eine Weisung darin könnte es in seine Empfehlung übernehmen.
    Beratung ist Material zum Abwägen, keine Anweisung.
    """
    if bewertung._ersatz or bewertung.assessment == "low":
        return None
    hinweis: dict = {
        "untrusted": True,
        "quelle": "ethik_engine",
        "einschaetzung": bewertung.assessment,
        "empfehlung": redact_sensitive_text(bewertung.recommendation)[:600],
        "begruendung": redact_sensitive_text(bewertung.reason)[:600],
    }
    if bewertung.concerns:
        hinweis["bedenken"] = [
            redact_sensitive_text(str(bedenken))[:300] for bedenken in bewertung.concerns[:5]
        ]
    if bewertung.alternative:
        hinweis["alternative"] = redact_sensitive_text(bewertung.alternative)[:600]
    return hinweis


def _faellige(
    *, user_id: int, aufrufe: list, bevorzugt_id: int | None
) -> tuple[int | None, list[tuple[str, DecisionContext]]]:
    """Der zuständige Anbieter und die Aufrufe, bei denen der Trigger anschlägt.

    Ohne Modellaufruf und ohne Ereignisschleife: in den meisten Runden schlägt
    nichts an (Lesen ist im Modus `auto` kein Anlass), und dann soll die
    Beratung nichts kosten außer einer Abfrage.

    Die Argumente gehen geschwärzt hinaus. Das Ethikmodell kann bei einem
    anderen Anbieter liegen als das Chatmodell, und ein Passwort in einem
    Konfigurationspatch braucht es für seine Abwägung nicht.
    """
    from services.ai_stream.read_tools import _ergebnis_schwaerzen

    with SessionLocal() as db:
        benutzer = db.get(User, user_id)
        if benutzer is None or not benutzer.is_active:
            return None, []
        if bevorzugt_id is None:
            bevorzugt_id = getattr(benutzer, "ai_provider_id", None)
        anbieter = ethik_anbieter(db, bevorzugt_id)
        if anbieter is None:
            return None, []
        anbieter_id = anbieter.id
        modus = anbieter.ethics_mode or "auto"
    faellig: list[tuple[str, DecisionContext]] = []
    for aufruf in aufrufe:
        argumente = aufruf.arguments if isinstance(aufruf.arguments, dict) else {}
        server_id = argumente.get("server_id")
        trigger = should_trigger_ethics(
            aufruf.name,
            _ergebnis_schwaerzen(argumente),
            ethics_mode=modus,
            goal=f"Ausführung von {aufruf.name}",
            planned_action=f"Werkzeugaufruf {aufruf.name}",
            server_id=(
                server_id
                if isinstance(server_id, int) and not isinstance(server_id, bool)
                else None
            ),
        )
        if trigger.should_evaluate:
            faellig.append((str(aufruf.id or ""), trigger.decision_context))
    return anbieter_id, faellig


#: Wie lange die Stimme höchstens auf die Beratung wartet, ab ihrem Start.
#:
#: Ihre Werkzeuge haben zwölf Sekunden (`REALTIME_TOOL_TIMEOUT_SECONDS`,
#: `GEMINI_TOOL_TIMEOUT_SECONDS`). Mit den 15 Sekunden des Chats lief ein
#: Werkzeug hinter einem langsamen Ethikmodell in die Zeitgrenze, meldete „nicht
#: abgewartet" und führte im Hintergrund trotzdem aus (Review vom 23.09.2026).
#: Seitdem berät die Stimme auch neben dem Werkzeug statt davor
#: (`beratung_anstossen`).
BERATUNG_ZEITGRENZE_STIMME = 5.0

#: Die Threads, in denen beraten wird.
#:
#: Eine Beurteilung holt den Schlüssel synchron beim DIS-Sidecar
#: (`resolve_api_key`, bis zu 15 Sekunden), schreibt ihr Audit und streamt erst
#: dann. Auf der Hauptschleife stünde dabei das ganze Panel still, derselbe
#: Fehler, den `ai_stream.lifecycle` mit `to_thread` behoben hat, und
#: `asyncio.wait_for` kann synchronen Code nicht unterbrechen. Im eigenen
#: Thread mit eigener Schleife wartet der Aufrufer dagegen mit harter Frist und
#: geht danach ohne Rat weiter; die Beurteilung wird abgebrochen
#: (`_Beratung.abbrechen`). Modulweit und nicht je Aufruf: ein
#: `with ThreadPoolExecutor()` wartete beim Verlassen auf genau den Thread,
#: dessen Frist abgelaufen ist.
_BERATER = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="msm-ethik"
)


class _EthikAuftrag:
    """Entkoppeltes Arbeitsbündel für eine Ethik-Runde ohne offene DB-Sitzung."""

    def __init__(
        self,
        *,
        user_id: int,
        provider: AiProvider,
        api_key: str | None,
        system_prompt: str,
        faellig: list[tuple[str, DecisionContext]],
    ) -> None:
        self.user_id = user_id
        self.provider = provider
        self.api_key = api_key
        self.system_prompt = system_prompt
        self.faellig = faellig


class _EthikRohErgebnis:
    """Ergebnis eines einzelnen Ethik-Modellaufrufs vor der gebündelten Persistenz."""

    def __init__(
        self,
        *,
        kennung: str,
        kontext: DecisionContext,
        messages: list[dict],
    ) -> None:
        self.kennung = kennung
        self.kontext = kontext
        self.messages = messages
        self.usage = StreamUsage()
        self.raw_response_text = ""
        self.bewertung: AiEthicsEvaluation | None = None


def _resolve_ethics_reasoning(provider: AiProvider) -> tuple[bool, str | None]:
    """Löst Thinking-Parameter für das Ethikmodell rein aus Konfiguration + Katalog-Cache."""
    explicit = (getattr(provider, "ethics_reasoning_effort", None) or "").strip()
    if explicit:
        return True, explicit
    model_id = (getattr(provider, "ethics_model", None) or "").strip()
    if not model_id:
        return False, None
    from services import ai_model_catalog, ai_reasoning

    try:
        modell = ai_model_catalog.cached_finde(
            provider.provider_kind, model_id, provider=provider
        )
        if modell is None:
            return False, None
        return ai_reasoning.klemmen(
            modell, wunsch=None, aktiv=False, deckel=ai_reasoning.MIN_RANG
        )
    except Exception:
        return False, None


def _ethik_client() -> httpx.AsyncClient:
    """Fallback-Client fuer den eigenen Beratungsthread ohne Hauptschleifen-Client."""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=5.0, read=BERATUNG_ZEITGRENZE_SEKUNDEN, write=10.0, pool=5.0
        ),
        follow_redirects=False,
    )


def _faellige(
    *, user_id: int, aufrufe: list, bevorzugt_id: int | None
) -> tuple[int | None, list[tuple[str, DecisionContext]]]:
    """Der zuständige Anbieter und die Aufrufe, bei denen der Trigger anschlägt."""
    from services.ai_stream.read_tools import _ergebnis_schwaerzen

    with SessionLocal() as db:
        benutzer = db.get(User, user_id)
        if benutzer is None or not benutzer.is_active:
            return None, []
        if bevorzugt_id is None:
            bevorzugt_id = getattr(benutzer, "ai_provider_id", None)
        anbieter = ethik_anbieter(db, bevorzugt_id)
        if anbieter is None:
            return None, []
        anbieter_id = anbieter.id
        modus = anbieter.ethics_mode or "auto"
    faellig: list[tuple[str, DecisionContext]] = []
    for aufruf in aufrufe:
        argumente = aufruf.arguments if isinstance(aufruf.arguments, dict) else {}
        server_id = argumente.get("server_id")
        trigger = should_trigger_ethics(
            aufruf.name,
            _ergebnis_schwaerzen(argumente),
            ethics_mode=modus,
            goal=f"Ausführung von {aufruf.name}",
            planned_action=f"Werkzeugaufruf {aufruf.name}",
            server_id=(
                server_id
                if isinstance(server_id, int) and not isinstance(server_id, bool)
                else None
            ),
        )
        if trigger.should_evaluate:
            faellig.append((str(aufruf.id or ""), trigger.decision_context))
    return anbieter_id, faellig


def _auftrag_laden(
    *, user_id: int, anbieter_id: int, faellig: list[tuple[str, DecisionContext]]
) -> _EthikAuftrag | None:
    """Lädt Provider, Schlüssel und Markenprompt einmalig pro Ethik-Runde."""
    from services import branding_service

    with SessionLocal() as db:
        benutzer = db.get(User, user_id)
        anbieter = db.get(AiProvider, anbieter_id)
        if benutzer is None or anbieter is None:
            return None
        api_key = ai_provider_service.resolve_api_key(db, anbieter, benutzer.id)
        if anbieter.requires_api_key and not api_key:
            logger.warning(
                "Ethics Engine: Kein API-Schlüssel für Provider %s hinterlegt",
                anbieter.id,
            )
            return None
        system_prompt = branding_service.apply_brand_name(ETHICS_SYSTEM_PROMPT, db=db)
        db.refresh(anbieter)
        db.expunge(anbieter)
    return _EthikAuftrag(
        user_id=user_id,
        provider=anbieter,
        api_key=api_key,
        system_prompt=system_prompt,
        faellig=faellig,
    )


def ethik_vorbereiten(
    *, user_id: int, aufrufe: list, bevorzugt_id: int | None = None
) -> _EthikAuftrag | None:
    """Lädt fällige Kontexte, Provider und Schlüssel in einer kurzen DB-Sitzung."""
    if not aufrufe:
        return None
    anbieter_id, faellig = _faellige(
        user_id=user_id, aufrufe=aufrufe, bevorzugt_id=bevorzugt_id
    )
    if anbieter_id is None or not faellig:
        return None
    return _auftrag_laden(
        user_id=user_id, anbieter_id=anbieter_id, faellig=faellig
    )


async def _ethik_einzel_stream(
    client: httpx.AsyncClient,
    auftrag: _EthikAuftrag,
    ergeb: _EthikRohErgebnis,
    *,
    eth_reasoning: bool,
    eth_effort: str | None,
) -> None:
    try:
        async for chunk in stream_chat_completion(
            client,
            provider=auftrag.provider,
            api_key=auftrag.api_key,
            messages=ergeb.messages,
            usage=ergeb.usage,
            tools=None,
            model=auftrag.provider.ethics_model,
            reasoning=eth_reasoning,
            reasoning_effort=eth_effort,
            json_schema=AiEthicsEvaluation.model_json_schema(),
        ):
            if chunk.kind == "content" and chunk.text:
                ergeb.raw_response_text += chunk.text

        clean_text = ergeb.raw_response_text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        elif clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()
        data = json.loads(clean_text)
        ergeb.bewertung = AiEthicsEvaluation(**data)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "Ethics Engine: Fehler beim Parsen der JSON-Antwort von %s: %s",
            auftrag.provider.ethics_model,
            exc,
        )
    except Exception as exc:  # noqa: BLE001 - Beratung hält nichts auf
        logger.warning(
            "Ethics Engine Auswertung fehlgeschlagen fuer %s: %s",
            ergeb.kontext.tool_name,
            type(exc).__name__,
        )


async def ethik_streamen(
    auftrag: _EthikAuftrag,
    *,
    hinweise: dict[str, dict] | None = None,
    out_results: list[_EthikRohErgebnis] | None = None,
    eigene_client: bool = False,
) -> list[_EthikRohErgebnis]:
    """Führt alle fälligen Ethik-Prüfungen parallel über reines Async-HTTP aus."""
    from services import ai_run_service

    ziel_hinweise = hinweise if hinweise is not None else {}
    ergebnisse = out_results if out_results is not None else []
    for kennung, kontext in auftrag.faellig:
        messages = [
            {"role": "system", "content": auftrag.system_prompt},
            {"role": "user", "content": _build_user_prompt(kontext, None)},
        ]
        ergebnisse.append(
            _EthikRohErgebnis(kennung=kennung, kontext=kontext, messages=messages)
        )

    warm_client = None if eigene_client else ai_run_service.http_client()
    sem = asyncio.Semaphore(4)
    eth_reasoning, eth_effort = _resolve_ethics_reasoning(auftrag.provider)

    async def _run_with_client(client: httpx.AsyncClient) -> None:
        async def _one(ergeb: _EthikRohErgebnis) -> None:
            async with sem:
                try:
                    await asyncio.wait_for(
                        _ethik_einzel_stream(
                            client,
                            auftrag,
                            ergeb,
                            eth_reasoning=eth_reasoning,
                            eth_effort=eth_effort,
                        ),
                        timeout=BERATUNG_ZEITGRENZE_SEKUNDEN,
                    )
                except TimeoutError:
                    logger.warning(
                        "Ethics Engine: Zeitgrenze abgelaufen fuer %s",
                        ergeb.kontext.tool_name,
                    )
                if ergeb.bewertung is not None:
                    if ergeb.bewertung.assessment in ("review", "critical"):
                        logger.info(
                            "Ethics Engine Hinweis fuer %s: assessment=%s",
                            ergeb.kontext.tool_name,
                            ergeb.bewertung.assessment,
                        )
                    try:
                        hinweis = hinweis_fuers_modell(ergeb.bewertung)
                        if hinweis is not None:
                            ziel_hinweise[ergeb.kennung] = hinweis
                    except Exception as fehler:
                        logger.warning(
                            "Ethics Engine Hinweis fehlgeschlagen fuer %s: %s",
                            ergeb.kontext.tool_name,
                            type(fehler).__name__,
                        )

        await asyncio.gather(*(_one(e) for e in ergebnisse))

    if warm_client is not None:
        await _run_with_client(warm_client)
    else:
        async with _ethik_client() as fallback_client:
            await _run_with_client(fallback_client)
    return ergebnisse


def ethik_verbuchen(
    auftrag: _EthikAuftrag | None,
    ergebnisse: list[_EthikRohErgebnis],
) -> None:
    """Persistiert Audit-Einträge und Verbrauchsabrechnung gebündelt in einer Transaktion."""
    if auftrag is None or not ergebnisse:
        return
    with SessionLocal() as db:
        benutzer = db.get(User, auftrag.user_id)
        if benutzer is None:
            return
        anbieter = auftrag.provider
        for ergeb in ergebnisse:
            bew = ergeb.bewertung
            if bew is not None and not bew._ersatz and bew.assessment in ("review", "critical"):
                try:
                    audit_service.record_privileged_action(
                        db,
                        user_id=benutzer.id,
                        action="ai.ethics.evaluated",
                        target_type="ai_action",
                        target_id=ergeb.kontext.server_id,
                        details={
                            "tool_name": ergeb.kontext.tool_name,
                            "assessment": bew.assessment,
                            "confidence": bew.confidence,
                            "reason": bew.reason[:200],
                        },
                        commit=False,
                    )
                except Exception as fehler:
                    logger.warning(
                        "Ethics Engine: Audit nicht geschrieben: %s",
                        type(fehler).__name__,
                    )
            if (
                ergeb.usage.total_tokens is None
                and not (
                    ergeb.usage.vom_anbieter
                    or ergeb.raw_response_text
                    or ergeb.usage.output_chars
                    or ergeb.usage.reasoning_chars
                )
            ):
                continue
            eingabe = max(
                1, sum(len(str(m.get("content") or "")) for m in ergeb.messages) // 4
            )
            ausgabe = (len(ergeb.raw_response_text) + ergeb.usage.reasoning_chars) // 4
            try:
                ai_usage_service.nachtraeglich_buchen(
                    db,
                    benutzer,
                    zweck=ai_usage_service.ZWECK_ETHIK,
                    usage=ergeb.usage,
                    estimated_actual_tokens=min(
                        eingabe + ausgabe, ai_usage_service.TOKEN_LIMIT_MAX
                    ),
                    provider_id=anbieter.id,
                    model=anbieter.ethics_model,
                    token_price_micro_usd_per_million=anbieter.token_price_micro_usd_per_million,
                    rollenpreise=(
                        anbieter.ethics_input_price_micro_usd_per_million,
                        anbieter.ethics_output_price_micro_usd_per_million,
                        anbieter.ethics_cache_price_micro_usd_per_million,
                    ),
                    geschaetzte_teile=(eingabe, ausgabe),
                )
            except Exception as fehler:  # noqa: BLE001 - Buchung hält die Beratung nicht auf
                logger.warning(
                    "Ethics Engine: Verbrauch nicht gebucht fuer Benutzer %s: %s",
                    getattr(benutzer, "id", None),
                    type(fehler).__name__,
                )
        try:
            db.commit()
        except Exception as fehler:
            db.rollback()
            logger.warning("Ethics Engine: Commit fehlgeschlagen: %s", type(fehler).__name__)


class EthikRunde:
    """Ueberlappte Ethics-Runde fuer read_tools und write_tools ohne DB-Thread-Konflikt."""

    def __init__(
        self,
        hinweise: dict[str, dict],
        *,
        auftrag: _EthikAuftrag | None = None,
        ergebnisse: list[_EthikRohErgebnis] | None = None,
        task: asyncio.Task | None = None,
    ) -> None:
        self.hinweise = hinweise
        self._auftrag = auftrag
        self._ergebnisse = ergebnisse if ergebnisse is not None else []
        self._task = task

    async def abschliessen(self) -> dict[str, dict]:
        """Wartet auf laufendes Ethics-Streaming (mit Timeout) und verbucht einmalig."""
        task = self._task
        if task is None:
            return self.hinweise
        self._task = None
        auftrag = self._auftrag
        assert auftrag is not None
        try:
            await asyncio.wait_for(
                task,
                timeout=BERATUNG_ZEITGRENZE_SEKUNDEN * len(auftrag.faellig),
            )
        except TimeoutError:
            task.cancel()
            logger.warning("Ethics Engine: Frist der Runde abgelaufen")
        except Exception as fehler:
            logger.warning("Ethics Engine fehlgeschlagen: %s", type(fehler).__name__)
        if self._ergebnisse:
            await asyncio.to_thread(ethik_verbuchen, auftrag, self._ergebnisse)
        return self.hinweise


async def ethik_runde_starten(
    *,
    user_id: int,
    aufrufe: list,
    bevorzugt_id: int | None = None,
) -> EthikRunde:
    """Startet die Ethics-Pruefung ueberlappend, solange `beraten` nicht gemockt ist."""
    if getattr(beraten, "__module__", "") != __name__:
        return EthikRunde(
            await beraten(user_id=user_id, aufrufe=aufrufe, bevorzugt_id=bevorzugt_id)
        )
    auftrag = await asyncio.to_thread(
        ethik_vorbereiten,
        user_id=user_id,
        aufrufe=aufrufe,
        bevorzugt_id=bevorzugt_id,
    )
    hinweise: dict[str, dict] = {}
    ergebnisse: list[_EthikRohErgebnis] = []
    task: asyncio.Task | None = None
    if auftrag is not None and auftrag.faellig:
        task = asyncio.create_task(
            ethik_streamen(auftrag, hinweise=hinweise, out_results=ergebnisse)
        )
    return EthikRunde(hinweise, auftrag=auftrag, ergebnisse=ergebnisse, task=task)


class _Beratung:
    """Eine Beratung im Beratungsthread: ihre Hinweise, ihr Ende, ihr Abbruch."""

    def __init__(self) -> None:
        self.hinweise: dict[str, dict] = {}
        self.zukunft: concurrent.futures.Future | None = None
        self.beginn = time.monotonic()
        self._schloss = threading.Lock()
        self._schleife: asyncio.AbstractEventLoop | None = None
        self._aufgabe: asyncio.Task | None = None
        self._abgebrochen = False

    async def _laufen(
        self,
        *,
        user_id: int,
        anbieter_id: int,
        faellig: list[tuple[str, DecisionContext]],
    ) -> None:
        with self._schloss:
            if self._abgebrochen:
                return
            self._schleife = asyncio.get_running_loop()
            self._aufgabe = asyncio.current_task()
        auftrag = _auftrag_laden(
            user_id=user_id, anbieter_id=anbieter_id, faellig=faellig
        )
        if auftrag is None:
            return
        with self._schloss:
            if self._abgebrochen:
                return
        ergebnisse: list[_EthikRohErgebnis] = []
        try:
            await ethik_streamen(
                auftrag,
                hinweise=self.hinweise,
                out_results=ergebnisse,
                eigene_client=True,
            )
        finally:
            ethik_verbuchen(auftrag, ergebnisse)

    def abbrechen(self) -> None:
        """Die Frist ist um: was noch wartet, entfällt; was läuft, wird beendet."""
        if self.zukunft is not None:
            self.zukunft.cancel()
        with self._schloss:
            self._abgebrochen = True
            schleife, aufgabe = self._schleife, self._aufgabe
        if schleife is not None and aufgabe is not None:
            with contextlib.suppress(RuntimeError):
                schleife.call_soon_threadsafe(aufgabe.cancel)


def _beratung_starten(
    *, user_id: int, anbieter_id: int, faellig: list[tuple[str, DecisionContext]]
) -> _Beratung:
    """Startet die parallele Ethik-Runde im Beratungsthread."""
    beratung = _Beratung()

    def _lauf() -> None:
        with contextlib.suppress(asyncio.CancelledError):
            asyncio.run(
                beratung._laufen(
                    user_id=user_id, anbieter_id=anbieter_id, faellig=faellig
                )
            )

    beratung.zukunft = _BERATER.submit(_lauf)
    return beratung


async def beraten(
    *,
    user_id: int,
    aufrufe: list,
    bevorzugt_id: int | None = None,
) -> dict[str, dict]:
    """Die Ethik-Engine vor den Werkzeugaufrufen einer Runde im Chat."""
    if not aufrufe:
        return {}
    with measure("ai_ethics", "beraten"):
        beratung: _Beratung | None = None
        try:
            anbieter_id, faellig = await asyncio.to_thread(
                _faellige, user_id=user_id, aufrufe=aufrufe, bevorzugt_id=bevorzugt_id
            )
            if anbieter_id is None or not faellig:
                return {}
            beratung = _beratung_starten(
                user_id=user_id, anbieter_id=anbieter_id, faellig=faellig
            )
            await asyncio.wait_for(
                asyncio.wrap_future(beratung.zukunft),
                timeout=BERATUNG_ZEITGRENZE_SEKUNDEN * len(faellig),
            )
        except TimeoutError:
            logger.warning("Ethics Engine: Frist der Runde abgelaufen")
        except Exception as fehler:  # noqa: BLE001 - Beratung hält nichts auf
            logger.warning("Ethics Engine fehlgeschlagen: %s", type(fehler).__name__)
        finally:
            if beratung is not None and beratung.zukunft is not None and not beratung.zukunft.done():
                beratung.abbrechen()
        return dict(beratung.hinweise) if beratung is not None else {}


def beratung_anstossen(
    *,
    user_id: int,
    aufrufe: list,
    bevorzugt_id: int | None = None,
) -> _Beratung | None:
    """Startet die Beratung für einen Sprachweg, ohne auf sie zu warten."""
    if not aufrufe:
        return None
    try:
        anbieter_id, faellig = _faellige(
            user_id=user_id, aufrufe=aufrufe, bevorzugt_id=bevorzugt_id
        )
        if anbieter_id is None or not faellig:
            return None
        return _beratung_starten(
            user_id=user_id, anbieter_id=anbieter_id, faellig=faellig
        )
    except Exception as fehler:  # noqa: BLE001 - Beratung hält nichts auf
        logger.warning("Ethics Engine im Sprachweg fehlgeschlagen: %s", type(fehler).__name__)
        return None


def beratung_abholen(
    beratung: _Beratung | None, *, frist: float = BERATUNG_ZEITGRENZE_STIMME
) -> dict[str, dict]:
    """Die Hinweise einer angestoßenen Beratung, spätestens ``frist`` Sekunden
    nach ihrem Start; was bis dahin nicht fertig ist, wird abgebrochen."""
    if beratung is None or beratung.zukunft is None:
        return {}
    rest = max(0.0, frist - (time.monotonic() - beratung.beginn))
    try:
        beratung.zukunft.result(timeout=rest)
    except TimeoutError:
        beratung.abbrechen()
        logger.warning("Ethics Engine: Frist der Stimme abgelaufen")
    except Exception as fehler:  # noqa: BLE001 - auch ein abgebrochener Start
        logger.warning("Ethics Engine im Sprachweg fehlgeschlagen: %s", type(fehler).__name__)
    return dict(beratung.hinweise)


def beraten_im_thread(
    *,
    user_id: int,
    aufrufe: list,
    bevorzugt_id: int | None = None,
    frist: float = BERATUNG_ZEITGRENZE_STIMME,
) -> dict[str, dict]:
    """Anstoßen und gleich abholen, für synchrone Aufrufer ohne eigenes Werkzeug."""
    return beratung_abholen(
        beratung_anstossen(user_id=user_id, aufrufe=aufrufe, bevorzugt_id=bevorzugt_id),
        frist=frist,
    )
