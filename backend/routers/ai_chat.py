"""Die persistenten AI-Unterhaltungen eines Benutzers mit POST-SSE.

Es gibt bewusst keine Routen zum Auflisten, Anlegen oder Loeschen von
Unterhaltungen. Der Assistent hat genau einen Chat je Anlass, und die Anlaesse
sind fest (`models.ai_conversation.ARTEN`); geloescht wird der *Verlauf*, nicht
die Unterhaltung.

**Lesen kennt beide Fenster, Schreiben nur den Dauerchat.** Die Endpunkte, die
etwas veraendern — senden, leeren, eine Nachricht zuruecknehmen — arbeiten
weiterhin unbedingt auf ``primary``. Das ist keine Sparmassnahme, sondern der
Zweck des zweiten Fensters: eine getippte Nachricht loest ueber
`vorgaenger_abloesen` jeden offenen Lauf ihrer Unterhaltung ab, und in das
Guardian-Fenster zu schreiben hiesse, eine laufende Reparatur mit einem
Tastendruck abzubrechen. Wer eingreifen will, tut es ausdruecklich: die
Oberflaeche bricht den Auftrag ab und wechselt in den Dauerchat.
"""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from dependencies import require_global, session_familie, session_herkunft, verify_csrf
from models import AiConversation, AiMessage, AiProvider, User
from models.ai_conversation import ARTEN
from models.dis_text import vorab_entschluesselt
from schemas.ai_chat import (
    AiChatRequest,
    AiContextStatus,
    AiConversationCreate,
    AiConversationDetail,
    AiConversationResponse,
    AiConversationUpdate,
    AiMessageEdit,
    AiMessageEditResponse,
    AiMessageResponse,
    AiQuestionPayload,
    AiRunResponse,
    AiSection,
    AiWorkerInfo,
)
from services import (
    ai_attachment_service,
    ai_chat_service,
    ai_context_service,
    ai_context_window,
    ai_limit_service,
    ai_provider_service,
    ai_reasoning,
    ai_run_broker,
    ai_run_service,
)
from services.ai_redaction import redact_sensitive_text
# Das Fenster auf einen Lauf kommt vom Vermittler, die Arbeit von der Schleife.
# Frueher kam beides aus `ai_stream_service` — der Umzug macht die
# Aufgabenteilung, die dort im Modulkopf steht, hier an der Importzeile sichtbar.
from services.ai_run_broker import lauf_verfolgen, sse_event
from services.ai_stream_service import lauf_beginnen_nebenher


router = APIRouter(prefix="/api/ai/conversation", tags=["ai-chat"])

# Der sichtbare Verlauf. Aeltere Nachrichten bleiben gespeichert und fliessen
# ueber die Zusammenfassung weiter in den Kontext ein.
HISTORY_LIMIT = 200


def _fuer_chat(provider) -> bool:
    """Taugt dieser Zugang fuer den Chat?

    Ein Stimmzugang taugt es nicht — ElevenLabs spricht kein
    ``/chat/completions``, sondern nimmt Text und gibt Ton zurueck.
    Die Absage ist bewusst dasselbe 404 wie bei einem unbekannten Zugang und
    keine eigene Fehlermeldung: aus Sicht des Chats *gibt* es diesen Provider
    nicht. Er steht auch in keiner Auswahl (`/api/ai/providers/available`
    filtert ihn), es kann ihn hier also nur nennen, wer die Kennung errät oder
    eine alte Auswahl im Tab liegen hat.

    Die Bedingung selbst steht im Service — dieselbe, nach der die Auswahlliste
    filtert. Beides hier auszuschreiben hiesse, dieselbe Frage zweimal zu
    beantworten, und die zweite Antwort veraltet.
    """
    return ai_provider_service.fuer_chat(provider)


def _art(kind: str) -> str:
    """Prueft die Fensterangabe aus dem Query und gibt sie zurueck.

    Eine unbekannte Art ist ein 404 und keine stillschweigende Umdeutung auf
    ``primary``: wer ``?kind=guardain`` tippt, soll das erfahren und nicht den
    Dauerchat bekommen, den er fuer das Guardian-Fenster haelt.
    """
    if kind not in ARTEN:
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    return kind


def _conversation_response(conversation) -> AiConversationResponse:
    raw_title = getattr(conversation, "title", None)
    if not raw_title or not str(raw_title).strip():
        raw_title = "Hauptchat" if getattr(conversation, "kind", "primary") == "primary" else "Unterhaltung"
    return AiConversationResponse(
        id=str(conversation.id),
        kind=str(getattr(conversation, "kind", "primary")),
        title=str(raw_title),
        project_id=str(conversation.project_id) if getattr(conversation, "project_id", None) else None,
        pinned=bool(getattr(conversation, "pinned", False)),
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


def _run_response(db: Session, run) -> AiRunResponse:
    """Ein Lauf fuer die Oberflaeche — mitsamt dem Fenster, in dem er arbeitet.

    Die Art kommt ueber die **Unterhaltung** und nicht aus dem Laufrahmen: der
    Rahmen steht in `state_json` und wird bei jedem Endzustand mitsamt dem
    Arbeitsspeicher geleert (`ai_run_service.arbeitsspeicher_leeren`). Ein
    beendeter Reparaturlauf haette danach keine Art mehr — und die Glocke
    haengte ihn dem Dauerchat an, also ausgerechnet dort, wo er nicht hingehoert.
    """
    # Nur die Art, nicht das ganze Fenster: dessen Titel und Zusammenfassung
    # sind verschluesselt, und diese Antwort geht alle acht Sekunden hinaus.
    kind = db.query(AiConversation.kind).filter(AiConversation.id == run.conversation_id).scalar()
    return AiRunResponse(
        id=run.id,
        status=run.status,
        stop_reason=run.stop_reason,
        message_id=run.message_id,
        live=ai_run_broker.laeuft(run.id),
        created_at=run.created_at,
        kind=kind or "primary",
        conversation_id=run.conversation_id,
        server_id=run.last_server_id,
    )


def _question(message: AiMessage) -> AiQuestionPayload | None:
    """Die gespeicherte Rueckfrage, falls diese Nachricht eine gestellt hat.

    Eine unlesbare Zeile wird uebergangen statt den ganzen Verlauf mitzureissen —
    im schlimmsten Fall fehlt eine Frage aus der Vergangenheit, der Chat bleibt
    benutzbar.
    """
    if not message.question_json:
        return None
    try:
        return AiQuestionPayload.model_validate_json(message.question_json)
    except ValueError:
        return None


def _sections(message: AiMessage) -> list[AiSection] | None:
    """Die gespeicherte Gliederung dieser Antwort, falls es eine gibt.

    Dieselbe Nachsicht wie bei `_question` daneben, aus demselben Grund: eine
    unlesbare Zeile kostet die Werkzeugchips einer alten Nachricht, nicht den
    ganzen Verlauf. Der Text steht ohnehin in `content` und wird angezeigt.
    """
    if not message.sections_json:
        return None
    try:
        roh = json.loads(message.sections_json)
    except ValueError:
        return None
    if not isinstance(roh, list):
        return None
    try:
        return [AiSection.model_validate(eintrag) for eintrag in roh]
    except ValueError:
        return None


def _message_response(message: AiMessage) -> AiMessageResponse:
    return AiMessageResponse(
        id=message.id,
        role=message.role,
        content=message.content,
        reasoning=message.reasoning,
        question=_question(message),
        sections=_sections(message),
        status=message.status,
        provider_id=message.provider_id,
        model=message.model,
        created_at=message.created_at,
    )


@router.get("/list", response_model=list[AiConversationResponse])
def list_conversations(
    project_id: str | None = Query(None, max_length=36),
    limit: int = Query(100, ge=1, le=250),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> list[AiConversationResponse]:
    """Listet die Chat-Unterhaltungen des Benutzers (Multi-Chat & Projekt-Chats)."""
    eintraege = ai_chat_service.list_user_conversations(
        db, user, project_id=project_id, limit=limit
    )
    if not eintraege and project_id is None:
        erste = ai_chat_service.get_or_create_primary_conversation(db, user)
        db.commit()
        db.refresh(erste)
        eintraege = [erste]
    return [_conversation_response(c) for c in eintraege]


@router.post("/new", response_model=AiConversationDetail, status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: AiConversationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> AiConversationDetail:
    """Legt eine neue Chat-Unterhaltung an (optional an ein Projekt gebunden)."""
    conversation = ai_chat_service.create_user_conversation(
        db, user, title=payload.title, project_id=payload.project_id
    )
    db.commit()
    db.refresh(conversation)
    return _verlauf_seite(db, conversation, None)


@router.patch("/item/{conversation_id}", response_model=AiConversationResponse)
def update_conversation_item(
    conversation_id: str,
    payload: AiConversationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> AiConversationResponse:
    """Benennt eine Unterhaltung um, pinnt sie oder ordnet sie einem Projekt zu."""
    conversation = ai_chat_service.get_owned_conversation(db, conversation_id, user)
    if conversation is None or conversation.kind != "primary":
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    ai_chat_service.update_user_conversation(
        db,
        conversation,
        title=payload.title,
        pinned=payload.pinned,
        project_id=payload.project_id,
        clear_project=payload.clear_project,
    )
    db.commit()
    db.refresh(conversation)
    return _conversation_response(conversation)


@router.delete("/item/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation_item(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> Response:
    """Loescht eine einzelne Chat-Unterhaltung samt Verlauf."""
    conversation = ai_chat_service.get_owned_conversation(db, conversation_id, user)
    if conversation is None or conversation.kind != "primary":
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    ai_chat_service.delete_user_conversation(db, conversation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=AiConversationDetail)
def get_conversation(
    kind: str = Query("primary"),
    conversation_id: str | None = Query(None, max_length=36),
    document_uid: str | None = Query(None, max_length=36),
    before: str | None = Query(
        None,
        description=(
            "Kennung der aeltesten bereits geladenen Nachricht. Liefert die "
            "Seite davor."
        ),
    ),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> AiConversationDetail:
    """Liefert eine Unterhaltung des Benutzers und legt sie beim ersten Aufruf an."""
    if kind == "worker":
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    if kind == "docs":
        if not document_uid:
            raise HTTPException(status_code=404, detail="Dokument fehlt")
        from services.ai_docs_chat_scope import resolve as docs_scope

        conversation, _, _ = docs_scope(db, user, document_uid)
        return _verlauf_seite(db, conversation, before)
    if conversation_id:
        conversation = ai_chat_service.get_owned_conversation(db, conversation_id, user)
        if conversation is None or conversation.kind != _art(kind):
            raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
        return _verlauf_seite(db, conversation, before)
    conversation = ai_chat_service.get_or_create_conversation(db, user, _art(kind))
    db.commit()
    db.refresh(conversation)
    return _verlauf_seite(db, conversation, before)


def _verlauf_seite(
    db: Session, conversation: AiConversation, before: str | None
) -> AiConversationDetail:
    """Eine Seite des Verlaufs, rueckwaerts ab ``before`` — fuer alle Fenster.

    **Interne Zeilen bleiben draussen.** Vier Stellen schreiben eine
    Benutzernachricht, die kein Mensch getippt hat: die Zustellung der
    Worker-Meldungen, das Guardian-Briefing, der Wiederanlauf nach einem
    Neustart und der Pruefauftrag eines faelligen Auftrags. Der Betreiber las
    dort JSON-Nutzlasten und Anweisungen an die KI, adressiert an ihn selbst —
    "Meldung des Panels (nicht vom Benutzer geschrieben): deine
    Hintergrund-Auftraege haben berichtet…". Ein Worker arbeitet im
    Hintergrund; seine Zettel gehoeren nicht ins Gespraech.

    Gefiltert wird **nur hier**, auf dem Weg in den Browser. Der Kontext, der
    zum Anbieter geht (`ai_context_service`), bleibt vollstaendig: sonst
    bekaeme das Gehirn den Auftrag zu liefern und wuesste eine Runde spaeter
    nicht mehr, warum es geliefert hat.

    Der Filter sitzt vor der Seitengrenze und nicht danach. Andersherum zaehlte
    eine unsichtbare Zeile gegen ``HISTORY_LIMIT``, und eine Seite kaeme mit
    neunzehn statt zwanzig Nachrichten zurueck — oder, schlimmer, ``weitere``
    sagte "es geht weiter", obwohl die letzte sichtbare Zeile bereits gezeigt
    war.
    """
    query = db.query(AiMessage).filter(
        AiMessage.conversation_id == conversation.id,
        AiMessage.intern.is_(False),
    )
    if before is not None:
        anker = db.get(AiMessage, before)
        if anker is None or anker.conversation_id != conversation.id:
            raise HTTPException(status_code=404, detail="Nachricht nicht gefunden")
        # Gleicher Zeitstempel kommt vor — zwei Nachrichten derselben Runde
        # koennen in dieselbe Sekunde fallen. Die Kennung entscheidet dann,
        # damit die Seite weder haengt noch eine Zeile ueberspringt.
        query = query.filter(
            (AiMessage.created_at < anker.created_at)
            | (
                (AiMessage.created_at == anker.created_at)
                & (AiMessage.id < anker.id)
            )
        )

    # Eine mehr holen, als geliefert wird: das ist die ganze Auskunft darueber,
    # ob es weitergeht — ohne ein zweites COUNT ueber den halben Verlauf.
    seite = query.order_by(AiMessage.created_at.desc(), AiMessage.id.desc()).limit(HISTORY_LIMIT + 1)
    with vorab_entschluesselt(
        db, seite, AiMessage.content, AiMessage.reasoning, AiMessage.question_json, AiMessage.sections_json
    ):
        zeilen = seite.all()
    weitere = len(zeilen) > HISTORY_LIMIT
    messages = zeilen[:HISTORY_LIMIT]

    base = _conversation_response(conversation)
    return AiConversationDetail(
        **base.model_dump(),
        messages=[_message_response(message) for message in reversed(messages)],
        has_more=weitere,
    )


@router.get("/workers", response_model=list[AiWorkerInfo])
def list_workers(
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> list[AiWorkerInfo]:
    """Die lebenden Hintergrund-Auftraege — die Worker-Leiste des Chats.

    Nur nicht beendete Laeufe: die Leiste "raeumt sich auf", indem
    Endzustaende beim naechsten Blick schlicht herausfallen
    (docs/agentic-framework.md, Frontend-Zeile). Geloescht wird dabei nichts —
    die Unterhaltung bleibt ueber `GET /conversation/worker/{id}` lesbar,
    solange die Aufbewahrung sie traegt (Audit-Regel).

    Kein eigenes Recht: es sind die eigenen Auftraege dieses Benutzers, und
    gestartet werden sie nur, wenn seine Rolle `ai.background.use` traegt.
    """
    from services import ai_worker_service

    eintraege: list[AiWorkerInfo] = []
    for lauf in ai_worker_service.aktive_worker(db, user_id=user.id):
        fenster = db.get(AiConversation, lauf.conversation_id)
        if fenster is None:
            continue
        eintraege.append(
            AiWorkerInfo(
                conversation_id=fenster.id,
                title=fenster.title,
                status=lauf.status,
                created_at=lauf.created_at,
            )
        )
    return eintraege


@router.get("/worker/{conversation_id}", response_model=AiConversationDetail)
def get_worker_conversation(
    conversation_id: str,
    before: str | None = Query(
        None,
        description=(
            "Kennung der aeltesten bereits geladenen Nachricht. Liefert die "
            "Seite davor."
        ),
    ),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> AiConversationDetail:
    """Liest ein Worker-Fenster ueber seine Kennung — nur lesend.

    Es gibt bewusst keinen Schreibweg in ein Worker-Fenster: eine getippte
    Nachricht loeste ueber `vorgaenger_abloesen` den laufenden Auftrag ab
    (dieselbe Begruendung wie beim Guardian-Fenster im Modul-Docstring).
    Gesteuert wird im Gespraech — "Stopp den Auftrag" geht an das Gehirn,
    das `worker_cancel` ruft (docs/agentic-framework.md, §6).

    Ein fremdes oder andersartiges Fenster ist dasselbe 404 wie ein
    unbekanntes: aus Sicht dieses Benutzers gibt es diese Unterhaltung nicht.
    """
    fenster = db.get(AiConversation, conversation_id)
    if fenster is None or fenster.user_id != user.id or fenster.kind != "worker":
        raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    return _verlauf_seite(db, fenster, before)


@router.post("/typing", status_code=status.HTTP_204_NO_CONTENT)
def typing_signal(
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> Response:
    """Das Tipp-Signal der Ruhe-Regel: "der Mensch schreibt gerade".

    Uebertragen wird ausschliesslich der Zeitpunkt — nie der Text und nicht
    einmal seine Laenge (Datenminimierung: das Eingabefeld kann Secrets
    enthalten). Die Meldestelle haelt je Benutzer nur den letzten Zeitstempel
    im Speicher (`tippen_melden`); solange er frisch ist, stellt sie keine
    Worker-Meldungen zu (docs/agentic-framework.md, §4).
    """
    from services import ai_meldestelle

    ai_meldestelle.tippen_melden(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/context", response_model=AiContextStatus)
async def get_context_status(
    request: Request,
    provider_id: int,
    conversation_id: str | None = Query(None, max_length=36),
    document_uid: str | None = Query(None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> AiContextStatus:
    """Wie voll der Kontext ist, gemessen am Fenster des gewaehlten Modells."""
    provider = db.get(AiProvider, provider_id)
    if provider is None or not provider.enabled or not _fuer_chat(provider):
        raise HTTPException(status_code=404, detail="Provider nicht gefunden")
    if document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope

        conversation, _, _ = docs_scope(db, user, document_uid)
    elif conversation_id:
        conversation = ai_chat_service.get_owned_conversation(db, conversation_id, user)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    else:
        conversation = ai_chat_service.get_or_create_primary_conversation(db, user)
        db.commit()

    fenster = await ai_context_window.ermitteln(
        request.app.state.ai_http_client, provider, db=db, user_id=user.id
    )
    context_chars = fenster.zeichen if fenster.bekannt else None
    grenzen = ai_context_service.teilbudgets(context_chars)
    belegt = ai_context_service.geschaetzte_belegung(db, conversation, grenzen)
    je_token = ai_context_window.ZEICHEN_JE_TOKEN
    return AiContextStatus(
        known=fenster.bekannt,
        window_tokens=fenster.fenster_tokens if fenster.bekannt else None,
        usable_tokens=fenster.nutzbar_tokens,
        used_tokens=belegt // je_token,
        compaction_percent=ai_context_window.schwelle_prozent(),
        summarized=bool(conversation.summary),
    )


@router.delete("/messages", status_code=status.HTTP_204_NO_CONTENT)
def clear_conversation_history(
    conversation_id: str | None = Query(None, max_length=36),
    document_uid: str | None = Query(None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> Response:
    """Leert den Verlauf. Die Unterhaltung und das Audit bleiben bestehen."""
    if document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope

        conversation, _, _ = docs_scope(db, user, document_uid)
        ai_run_service.vorgaenger_abloesen(db, conversation_id=conversation.id)
        ai_chat_service.clear_history(
            db, conversation, user_weit=False, worker_weit=False
        )
    elif conversation_id:
        conversation = ai_chat_service.get_owned_conversation(db, conversation_id, user)
        if conversation is None or conversation.kind != "primary":
            raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
        ai_run_service.vorgaenger_abloesen(db, conversation_id=conversation.id)
        ai_chat_service.clear_history(
            db, conversation, user_weit=False, worker_weit=False
        )
    else:
        conversation = ai_chat_service.get_or_create_primary_conversation(db, user)
        ai_run_service.vorgaenger_abloesen(db, conversation_id=conversation.id)
        ai_chat_service.clear_history(db, conversation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/messages/{message_id}", response_model=AiMessageEditResponse)
def edit_message(
    message_id: str,
    payload: AiMessageEdit,
    conversation_id: str | None = Query(None, max_length=36),
    document_uid: str | None = Query(None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> AiMessageEditResponse:
    """Nimmt eine eigene Nachricht zurueck, damit sie neu gestellt werden kann."""
    safe_content = redact_sensitive_text(payload.content).strip()
    if not safe_content:
        raise HTTPException(status_code=422, detail="Nachricht ist leer")

    if document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope

        conversation, _, _ = docs_scope(db, user, document_uid)
    elif conversation_id:
        conversation = ai_chat_service.get_owned_conversation(db, conversation_id, user)
        if conversation is None or conversation.kind != "primary":
            raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    else:
        conversation = ai_chat_service.get_or_create_primary_conversation(db, user)
    message = ai_chat_service.owned_message(db, conversation, message_id)
    removed = ai_chat_service.truncate_from(db, conversation, message)
    db.commit()
    return AiMessageEditResponse(removed=removed)


def _snapshot_message(message: AiMessage) -> dict:
    return {
        "id": message.id,
        "request_id": message.request_id,
        "reasoning": message.reasoning,
        "content": message.content,
        "sections": _sections(message),
        "question": _question(message),
    }


async def _replay_message(message: AiMessage | dict) -> AsyncIterator[str]:
    data = _snapshot_message(message) if isinstance(message, AiMessage) else message
    yield sse_event("message", {"message_id": data["id"], "request_id": data["request_id"]})
    # Die Wiedergabe folgt der **gespeicherten Reihenfolge**, wenn es eine gibt.
    # Ein einzelnes `delta` mit dem ganzen Text waere fuer eine Antwort, die
    # zwischen ihren Absaetzen Werkzeuge gerufen hat, eine falsche Wiedergabe:
    # der Text stimmte, die Werkzeuge fehlten, und beim naechsten Neuladen
    # saehe dieselbe Nachricht wieder anders aus als eben.
    abschnitte = data["sections"]
    # Trägt die Gliederung die Gedanken, kommen sie an ihrer Stelle. Nur für
    # Nachrichten aus der Zeit davor gibt es sie ausschließlich flach — dann
    # vorweg, wie bisher. Beides zugleich wäre derselbe Text zweimal.
    if data["reasoning"] and not any(
        abschnitt.art == "denken" for abschnitt in (abschnitte or [])
    ):
        yield sse_event("reasoning", {"content": data["reasoning"]})
    if abschnitte:
        for abschnitt in abschnitte:
            if abschnitt.art == "text" and abschnitt.inhalt:
                yield sse_event("delta", {"content": abschnitt.inhalt})
            elif abschnitt.art == "denken" and abschnitt.inhalt:
                yield sse_event("reasoning", {"content": abschnitt.inhalt})
            elif abschnitt.art == "tool" and abschnitt.werkzeug:
                yield sse_event("tool", abschnitt.werkzeug)
    elif data["content"]:
        yield sse_event("delta", {"content": data["content"]})
    # Endete der Zug mit einer Rueckfrage, gehoert sie auch in die Wiedergabe —
    # sonst saehe der Benutzer nach einem erneuten Absenden derselben Anfrage
    # eine Antwort ohne die Frage, auf die er antworten soll.
    frage = data["question"]
    if frage is not None:
        yield sse_event("question", frage.model_dump())
    yield sse_event("done", {"message_id": data["id"], "replayed": True})


async def _fehlerstrom(code: str, message_key: str) -> AsyncIterator[str]:
    """Ein Fehler, der vor dem Lauf auftrat — es gibt nichts zu verfolgen."""
    yield sse_event("error", {"code": code, "message_key": message_key})


@router.get("/run")
def get_active_run(
    kind: str | None = Query(
        "primary",
        description=(
            "Fenster, in dem gesucht wird. Ohne Angabe der Dauerchat; leer "
            "gelassen (kind=) ueber alle Fenster — das fragt die Glocke."
        ),
    ),
    conversation_id: str | None = Query(
        None,
        description=(
            "Kennung eines bestimmten Fensters — der Weg der Worker-Ansicht, "
            "denn kind=worker ist mehrdeutig. Hat Vorrang vor kind."
        ),
    ),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> AiRunResponse | None:
    """Der Lauf, der gerade noch etwas vorhat — oder nichts.

    Die Oberflaeche fragt das beim Oeffnen: laeuft da noch etwas von vorhin?
    Damit haengt sie sich nach einem Seitenwechsel oder einem Neustart des
    Browsers wieder an, statt eine abgebrochene Antwort zu zeigen.

    **Die Fensterangabe ist hier keine Bequemlichkeit.** Ohne sie beantwortet
    der Endpunkt "laeuft irgendwo etwas fuer diesen Menschen?", und der Chat
    haengte sich danach an eine Guardian-Reparatur und zeichnete sie in das
    Fenster des Benutzers — genau das, was die Trennung beseitigt. Die Glocke
    darf die Frage weit stellen (``kind=``), muss dann aber ueber ``kind`` in
    der Antwort entscheiden, wohin sie zeigt.
    """
    if conversation_id is not None:
        run = ai_run_service.aktiver_lauf(
            db, user_id=user.id, conversation_id=conversation_id
        )
    else:
        run = ai_run_service.aktiver_lauf(
            db, user_id=user.id, kind=_art(kind) if kind else None
        )
    if run is None:
        return None
    return _run_response(db, run)


@router.post("/guardian/takeover")
def guardian_uebernehmen(
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> dict:
    """Ein Mensch uebernimmt: die laufenden Reparaturen dieses Menschen enden.

    Der Knopf im Guardian-Fenster. Er ist der Grund, warum es dort kein
    Eingabefeld gibt: abbrechen soll man koennen, aber ausdruecklich und nicht
    durch einen Tastendruck — im Chat loest jede getippte Nachricht ueber
    `vorgaenger_abloesen` den offenen Lauf ab, und in einem Fenster, in dem seit
    vier Uhr eine Reparatur laeuft, waere ein Eingabefeld ein Knopf zum
    versehentlichen Abbrechen.

    **Beendet wird der Auftrag, nicht nur der Lauf.** Nur den Lauf abzubrechen
    hiesse, dass der Takt neunzig Sekunden spaeter den naechsten startet — der
    Mensch haette uebernommen und die KI arbeitete weiter.

    Kein eigenes Recht: es sind die eigenen Auftraege dieses Benutzers, und
    ``ai.chat.use`` hat er ohnehin, sonst gaebe es das Fenster fuer ihn nicht.
    """
    from services import ai_guardian_repair_service

    beendet = ai_guardian_repair_service.uebernehmen(db, user=user)
    # Erst der Auftrag, dann der Lauf. Andersherum faende der Takt zwischen
    # beiden Schritten einen Auftrag ohne laufenden Lauf und startete den
    # naechsten Anlauf — mitten in die Uebernahme hinein.
    fenster = ai_chat_service.get_or_create_conversation(db, user, "guardian")
    ai_run_service.vorgaenger_abloesen(db, conversation_id=fenster.id)
    db.commit()
    return {"aborted": beendet}


@router.post("/stop")
def stop_active_run(
    kind: str = Query("primary"),
    conversation_id: str | None = Query(None, max_length=36),
    document_uid: str | None = Query(None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    _: None = Depends(verify_csrf),
) -> dict:
    """Bricht den derzeit aktiven Lauf dieser Unterhaltung kontrolliert ab."""
    if document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope

        conversation, _, _ = docs_scope(db, user, document_uid)
    elif conversation_id:
        conversation = ai_chat_service.get_owned_conversation(db, conversation_id, user)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
    else:
        fenster_art = _art(kind)
        conversation = ai_chat_service.get_or_create_conversation(db, user, fenster_art)
    ai_run_service.vorgaenger_abloesen(db, conversation_id=conversation.id)
    db.commit()
    return {"ok": True, "stopped": True}


@router.get("/run/{run_id}/stream")
def attach_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
) -> StreamingResponse:
    """Haengt sich an einen laufenden Lauf an — auch Minuten spaeter.

    Kein CSRF-Schutz noetig und keiner moeglich: das ist ein GET, der nichts
    veraendert. Die Zugehoerigkeit wird ueber ``eigener_lauf`` geprueft, ein
    fremder Lauf ist schlicht nicht zu finden.
    """
    run = ai_run_service.eigener_lauf(db, run_id, user)
    if run is None:
        raise HTTPException(status_code=404, detail="Lauf nicht gefunden")
    return StreamingResponse(
        lauf_verfolgen(run.id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/messages/stream")
async def stream_message(
    payload: AiChatRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_global("ai.chat.use")),
    herkunft: str = Depends(session_herkunft),
    familie: str | None = Depends(session_familie),
    _: None = Depends(verify_csrf),
) -> StreamingResponse:
    provider = db.get(AiProvider, payload.provider_id)
    if provider is None or not provider.enabled or not _fuer_chat(provider):
        raise HTTPException(status_code=404, detail="Provider nicht gefunden")
    if provider.requires_api_key and not provider.operator_api_key_encrypted:
        raise HTTPException(status_code=409, detail="Fuer diesen Provider ist kein API-Key konfiguriert")

    # Rollenbasierte Provider- und Modellfreigaben strikt durchsetzen (Fail-closed)
    effective_allowed = ai_limit_service.resolve_effective_allowed_models(db, user)
    if effective_allowed is not None:
        if provider.id not in effective_allowed:
            raise HTTPException(status_code=403, detail="AI_PROVIDER_NOT_PERMITTED_FOR_ROLE")
        allowed_models = effective_allowed[provider.id]
        candidate_model = (payload.model or "").strip() or (provider.default_model or "").strip()
        if "*" not in allowed_models and candidate_model not in allowed_models:
            raise HTTPException(status_code=403, detail="AI_MODEL_NOT_PERMITTED_FOR_ROLE")

    existing = db.query(AiMessage).filter(AiMessage.request_id == str(payload.request_id)).first()
    if existing is not None:
        if payload.conversation_id and existing.conversation_id != payload.conversation_id:
            raise HTTPException(status_code=409, detail="AI-Request-ID wurde widerspruechlich wiederverwendet")
        if existing.provider_id != provider.id:
            raise HTTPException(status_code=409, detail="AI-Request-ID wurde widerspruechlich wiederverwendet")
        if existing.status == "complete":
            conversation = db.get(AiConversation, existing.conversation_id)
            if conversation is None:
                raise HTTPException(status_code=404, detail="Unterhaltung nicht gefunden")
            snapshot = _snapshot_message(existing)
            return StreamingResponse(
                _replay_message(snapshot),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-store",
                    "X-Accel-Buffering": "no",
                    "X-Conversation-Id": conversation.id,
                    "Access-Control-Expose-Headers": "X-Conversation-Id",
                },
            )
        else:
            raise HTTPException(status_code=409, detail="AI-Anfrage ist bereits aktiv oder fehlgeschlagen")

    conversation = None
    if payload.conversation_id:
        conversation = ai_chat_service.get_owned_conversation(
            db, payload.conversation_id, user
        )
        if conversation is not None and conversation.kind != "primary":
            conversation = None

    if conversation is None:
        conversation = ai_chat_service.create_user_conversation(
            db, user, project_id=payload.project_id
        )
    if payload.project_id and not conversation.project_id:
        conversation.project_id = payload.project_id

    # Automatischer Titel beim ersten Zug oder bei generischem Vor-Titel
    raw_content = payload.content.strip()
    is_generic_title = (
        conversation.title in ai_chat_service.GENERIC_TITLES
        or conversation.title.endswith(" Chat")
        or not conversation.title
    )
    if is_generic_title and raw_content:
        # 1. Sofort-Heuristik (synchron): Bereinigt von Floskeln, sauber lesbar
        conversation.title = ai_chat_service.clean_heuristic_title(raw_content)
        # 2. Asynchrone Verfeinerung durch das Modell im Hintergrund
        background_tasks.add_task(
            ai_chat_service.generate_conversation_title_llm,
            conversation.id,
            raw_content,
            payload.provider_id,
            payload.model,
        )
    docs_document_uid: str | None = None
    docs_team_id: int | None = None
    docs_is_link_guest: bool = False
    if payload.document_uid:
        from services.ai_docs_chat_scope import resolve as docs_scope

        scope_res = docs_scope(db, user, payload.document_uid)
        conversation = scope_res.conversation
        docs_document_uid = scope_res.document.doc_uid
        docs_team_id = scope_res.team_id
        docs_is_link_guest = scope_res.is_link_guest
    db.commit()

    requested_model: str | None = None
    if payload.model and payload.model.strip():
        candidate = payload.model.strip()
        erlaubte = ai_provider_service.freigegebene_modelle(provider)
        if getattr(provider, "allow_all_models", False) or candidate in erlaubte or candidate == provider.default_model:
            requested_model = candidate

    safe_content = redact_sensitive_text(payload.content).strip()
    if not safe_content and not ai_attachment_service.has_unbound(
        db, conversation.id, user.id
    ):
        raise HTTPException(status_code=400, detail="Nachricht ist nach Sicherheitsfilter leer")

    # Die Denkvorgabe wird **hier** festgelegt und nicht erst beim Senden:
    # der Anlauf kennt keinen HTTP-Client, der Modellkatalog ist aber ein
    # HTTP-Abruf. Wichtiger noch — der geklemmte Wert gehoert in den Lauf,
    # damit eine Fortsetzung nach einer Bestaetigung dieselbe Tiefe
    # verwendet wie der erste Zug.
    denken, stufe = await ai_reasoning.vorgabe(
        request.app.state.ai_http_client,
        db,
        user=user,
        provider=provider,
        aktiv=payload.reasoning,
        wunsch=payload.reasoning_effort,
    )
    # Aus demselben Grund hier und nicht im Anlauf: das Kontextfenster steht
    # im Modellkatalog, und den zu befragen ist ein HTTP-Abruf. Es gehoert
    # ausserdem in den Lauf — eine Fortsetzung nach einer Bestaetigung muss
    # mit demselben Budget rechnen wie der erste Zug, auch wenn der
    # Betreiber zwischendurch das Modell wechselt.
    fenster = await ai_context_window.ermitteln(
        request.app.state.ai_http_client, provider, db=db, user_id=user.id
    )
    # Ab hier reisen nur noch **Kennungen** weiter. Der Anlauf legt sich
    # gleich eine eigene Sitzung in einem eigenen Thread an, und die des
    # Requests darf diese Grenze nicht ueberschreiten — sie gehoert dem
    # Request-Thread und wird von ihm geschlossen.
    user_id, conversation_id, provider_id = user.id, conversation.id, provider.id
    # Und sie darf auch keine offene Transaktion ueber die Grenze tragen.
    # Die Sitzung im Thread saehe ungesicherte Arbeit dieser Sitzung nicht,
    # und in der Testsuite teilen sich beide sogar eine Verbindung. Frueher
    # endete `lauf_beginnen` selbst mit genau diesem Commit — es ist also
    # derselbe Zeitpunkt wie bisher, nur eine Zeile frueher.
    db.commit()
    run_id, fehler = await lauf_beginnen_nebenher(
        user_id=user_id,
        conversation_id=conversation_id,
        provider_id=provider_id,
        request_id=payload.request_id,
        content=safe_content,
        reasoning=denken,
        reasoning_effort=stufe,
        # Ein unbekanntes Fenster reist als `None` weiter und nicht als
        # Rueckfallzahl: nur so kann die Kompression den Unterschied
        # zwischen "kleines Fenster" und "kein Wissen" noch sehen.
        context_chars=fenster.zeichen if fenster.bekannt else None,
        # Von wo die Bitte kam. Entscheidet den Werkzeugkatalog des Laufs
        # (`herkunft_schnitt`) und wird darin eingefroren. Aus dem Token,
        # nicht aus dem Koerper: solange der Client sie selbst erklaerte,
        # konnte sich jeder als App ausgeben und nach Maus und Tastatur
        # greifen (`dependencies.session_herkunft`).
        herkunft=herkunft,
        # Und von **welchem** Rechner. Die Herkunft unterscheidet App und
        # Panel, nicht zwei gekoppelte Rechner desselben Benutzers — ohne
        # die Familie holt sich einen Auftrag der, der zuerst fragt, und
        # ein Blick auf "meinen Bildschirm" zeigte den des anderen.
        familie=familie,
        docs_document_uid=docs_document_uid,
        docs_team_id=docs_team_id,
        docs_is_link_guest=docs_is_link_guest,
        # Ob das Modell Bilder liest, kommt aus demselben Katalog wie das
        # Fenster. `None` heisst unbekannt; nur ein ausdrueckliches False
        # ersetzt das Bild durch einen Hinweis.
        modell_sieht=fenster.sieht,
        # Nur die App meldet ihre Faehigkeiten; aus dem Panel ignoriert der
        # Launcher das Feld. Es verkleinert nur das Angebot.
        app_faehigkeiten=(
            payload.app_faehigkeiten.model_dump()
            if payload.app_faehigkeiten is not None else None
        ),
        requested_model=requested_model,
        project_id=payload.project_id or conversation.project_id,
    )
    if run_id is None:
        code, message_key = fehler or ("AI_PREPARATION_FAILED", "ai.chat.errors.unavailable")
        stream = _fehlerstrom(code, message_key)
    else:
        if docs_document_uid and isinstance(payload.selection, dict):
            from services import ai_docs_selection

            quote = str(payload.selection.get("quote") or "").strip()
            if quote:
                ai_docs_selection.setzen(
                    run_id,
                    {"quote": quote[:4_000]},
                    hash_wert=str(payload.selection.get("hash") or "")[:64] or None,
                )
        # Reihenfolge ist hier alles: Kanal auf, **abonnieren**, dann erst
        # die Arbeit starten.
        #
        # Der Rumpf einer StreamingResponse laeuft erst an, wenn Starlette
        # ihn zu lesen beginnt — der Lauf arbeitet da laengst. Wuerde erst
        # dort abonniert, waeren die ersten Zeichen schon durch. Abonniert
        # wird deshalb hier, synchron, vor dem Start.
        ai_run_broker.eroeffnen(run_id)
        abo = ai_run_broker.abonnieren(run_id)
        ai_run_service.lauf_starten(run_id)
        stream = lauf_verfolgen(run_id, abo=abo)
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "X-Conversation-Id": conversation.id,
            "Access-Control-Expose-Headers": "X-Conversation-Id",
        },
    )
