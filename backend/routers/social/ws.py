from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, WebSocket
from starlette.websockets import WebSocketDisconnect

from database import SessionLocal
from dependencies import (
    get_current_user_for_ws,
    ws_session_familie,
    ws_subprotokoll,
)
from models import ChatGroupMember, User, UserE2eeDevice
from services.social.queue_service import E2eeQueueService
from services.social_service import SocialService
from services.sync_event_service import MAX_MAILBOXES, SyncEventService

logger = logging.getLogger(__name__)

router = APIRouter()



@router.websocket("/ws")
async def social_websocket(
    websocket: WebSocket,
) -> None:
    """Echtzeit-WebSocket für Social Presence, Messaging und Live-Benachrichtigungen.

    Stabilitäts-Invariante:
    - Verhindert DB-Session-Leaks & Pool-Erschöpfung: DB-Sitzungen werden nur bedarfsgerecht
      je Aktion kurzzeitig geöffnet und direkt freigegeben.
    - Robuste Nebenläufigkeit: Sende- und Empfangs-Loops sind gekoppelt; bricht eine Seite
      ab, wird die andere unmittelbar gecancelt und alle Ressourcen freigegeben.
    - Ghost-Mode Schutz: 'invisible' und 'private' Status lecken niemals über Join-Events
      an Nicht-Freunde.
    - Nachrichten-Deduplizierung: Client-UUIDs werden bei Relays verarbeitet und quittiert.
    """
    with SessionLocal() as db:
        try:
            user = get_current_user_for_ws(websocket, db)
            user_id = user.id
            user_username = user.username
        except Exception:
            await websocket.close(code=1008)
            return

    subprotocol = ws_subprotokoll(websocket)
    await websocket.accept(subprotocol=subprotocol)

    conn_id, queue = SyncEventService.subscribe(
        user_id=user_id, familie=ws_session_familie(websocket)
    )
    ws_lock = asyncio.Lock()
    device_id_param = websocket.query_params.get("device_id") or websocket.headers.get("x-device-id")

    async def _send_loop():
        try:
            while True:
                event = await queue.get()
                if event.get("type") == "shutdown":
                    try:
                        async with ws_lock:
                            await websocket.send_json(event)
                            await websocket.close(code=1001, reason="Server restart")
                    except Exception:
                        pass
                    break
                async with ws_lock:
                    await websocket.send_json(event)
        except (asyncio.CancelledError, WebSocketDisconnect):
            raise
        except Exception:
            pass

    async def _mit_sitzung(arbeit):
        """Datenbankarbeit im Thread, nie auf der Ereignisschleife."""
        def _lauf():
            with SessionLocal() as db:
                return arbeit(db)

        return await asyncio.to_thread(_lauf)

    # Initialer Push offener Chiffrate bei Verbindungsaufbau (Signal-Modell)
    if device_id_param:
        def _hole_anstehende_connect(db):
            dev = (
                db.query(UserE2eeDevice)
                .filter(
                    UserE2eeDevice.user_id == user_id,
                    UserE2eeDevice.device_id == str(device_id_param),
                )
                .first()
            )
            if dev and dev.is_approved:
                return E2eeQueueService.fetch_pending_messages(db, dev)
            return []

        try:
            anstehende = await _mit_sitzung(_hole_anstehende_connect)
            if anstehende:
                async with ws_lock:
                    await websocket.send_json({
                        "type": "incoming_messages",
                        "messages": anstehende,
                    })
        except Exception as exc:
            logger.debug("Fehler beim Abrufen anstehender Nachrichten bei WS Connect: %s", exc)

    async def _recv_loop():
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "ping":
                # Heartbeat Pong - strikt isoliert, keine Präsenz-Leaks an Dritte
                async with ws_lock:
                    await websocket.send_json({"type": "pong"})
            elif msg_type == "join":
                # WebSocket Join Event:
                # Ghost-Mode & Privacy-Schutz delegiert an SocialService
                try:
                    await _mit_sitzung(
                        lambda db: SocialService.broadcast_user_joined(db, user_id, user_username)
                    )
                    async with ws_lock:
                        await websocket.send_json({"type": "joined", "status": "ok", "user_id": user_id})
                except Exception as exc:
                    logger.debug("Fehler bei broadcast_user_joined: %s", exc)
            elif msg_type in ("init", "fetch_pending"):
                dev_id = data.get("device_id") or device_id_param
                def _hole_anstehende_init(db):
                    if not dev_id:
                        return []
                    dev = (
                        db.query(UserE2eeDevice)
                        .filter(
                            UserE2eeDevice.user_id == user_id,
                            UserE2eeDevice.device_id == str(dev_id),
                        )
                        .first()
                    )
                    if dev and dev.is_approved:
                        return E2eeQueueService.fetch_pending_messages(db, dev)
                    return []

                try:
                    anstehende = await _mit_sitzung(_hole_anstehende_init)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "incoming_messages",
                            "messages": anstehende,
                        })
                except Exception as exc:
                    logger.debug("Fehler bei WS init/fetch_pending: %s", exc)
            elif msg_type == "send_message":
                c_uuid = str(data.get("client_uuid") or "")
                c_type = str(data.get("chat_type") or "direct")
                c_id = str(data.get("chat_id") or "")
                raw_envelopes = data.get("envelopes") or []
                dev_id = data.get("device_id") or device_id_param

                def _sende_nachricht(db):
                    s_dev_id = None
                    if dev_id:
                        s_dev = (
                            db.query(UserE2eeDevice)
                            .filter(
                                UserE2eeDevice.user_id == user_id,
                                UserE2eeDevice.device_id == str(dev_id),
                            )
                            .first()
                        )
                        if s_dev:
                            s_dev_id = s_dev.id

                    u = db.query(User).filter(User.id == user_id).first()
                    if not u:
                        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")

                    return E2eeQueueService.enqueue_message(
                        db=db,
                        sender=u,
                        envelopes=raw_envelopes,
                        client_uuid=c_uuid,
                        chat_type=c_type,
                        chat_id=c_id,
                        sender_device_id=s_dev_id,
                    )

                try:
                    created_ids = await _mit_sitzung(_sende_nachricht)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "message_sent",
                            "client_uuid": c_uuid,
                            "status": "ok",
                            "enqueued": len(created_ids),
                        })
                except HTTPException as he:
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "error",
                            "error": "send_message_failed",
                            "status_code": he.status_code,
                            "detail": he.detail,
                            "client_uuid": c_uuid,
                        })
                except Exception as exc:
                    logger.warning("Fehler bei WS send_message für User %s: %s", user_id, exc)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "error",
                            "error": "send_message_failed",
                            "status_code": 500,
                            "detail": str(exc),
                            "client_uuid": c_uuid,
                        })
            elif msg_type == "ack_message":
                queue_ids = data.get("queue_ids") or []
                dev_id = data.get("device_id") or device_id_param
                ack_client_uuid = data.get("client_uuid")

                def _quittiere(db):
                    if not dev_id:
                        return 0
                    dev = (
                        db.query(UserE2eeDevice)
                        .filter(
                            UserE2eeDevice.user_id == user_id,
                            UserE2eeDevice.device_id == str(dev_id),
                        )
                        .first()
                    )
                    if not dev or not dev.is_approved:
                        return 0
                    return E2eeQueueService.acknowledge_messages(db, dev, queue_ids)

                try:
                    count = await _mit_sitzung(_quittiere)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "ack_ok",
                            "acknowledged": count,
                            "client_uuid": ack_client_uuid,
                        })
                except Exception as exc:
                    logger.debug("Fehler bei WS ack_message: %s", exc)
            elif msg_type == "read_receipt":
                c_type = str(data.get("chat_type") or "direct")
                c_id = str(data.get("chat_id") or "")
                client_uuids = data.get("client_uuids") or []

                def _lesequittung(db):
                    u = db.query(User).filter(User.id == user_id).first()
                    if u and client_uuids:
                        E2eeQueueService.mark_chat_read(
                            db=db,
                            reader=u,
                            chat_type=c_type,
                            chat_id=c_id,
                            client_uuids=client_uuids,
                        )

                try:
                    await _mit_sitzung(_lesequittung)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "read_ok",
                            "chat_id": c_id,
                        })
                except Exception as exc:
                    logger.debug("Fehler bei WS read_receipt: %s", exc)
            elif msg_type == "mailboxes":
                eintraege = data.get("eintraege")
                erlaubt: list[str] = []
                if isinstance(eintraege, list):
                    wunsch = [
                        (str(e.get("mailbox_id") or ""), e.get("mailbox_token"))
                        for e in eintraege[:MAX_MAILBOXES]
                        if isinstance(e, dict)
                    ]
                    try:
                        erlaubt = await _mit_sitzung(
                            lambda db: SocialService.erlaubte_mailboxen(db, user_id, wunsch)
                        )
                    except Exception as exc:
                        logger.debug("Fehler beim Setzen der Mailbox-Abos: %s", exc)
                anzahl = SyncEventService.set_mailboxes(conn_id, erlaubt, user_id=user_id)
                async with ws_lock:
                    await websocket.send_json({"type": "mailboxes_ok", "count": anzahl})
            elif msg_type == "presence":
                try:
                    await _mit_sitzung(lambda db: SocialService.update_presence(db, user_id, data))
                except Exception as exc:
                    logger.debug("Fehler bei update_presence: %s", exc)
            elif msg_type == "typing":
                chat_id_val = data.get("chat_id")
                chat_type_val = data.get("chat_type") or "direct"
                status = data.get("status", "idle")
                if chat_id_val and chat_type_val == "direct":
                    try:
                        partner_id = int(chat_id_val)
                        SyncEventService.publish(
                            {
                                "type": "typing",
                                "sender_id": user_id,
                                "sender_username": user_username,
                                "chat_type": "direct",
                                "chat_id": str(user_id),
                                "status": status,
                            },
                            user_id=partner_id,
                        )
                    except Exception as exc:
                        logger.debug("Fehler bei direct typing signal: %s", exc)
                elif chat_id_val and chat_type_val == "group":
                    def _tippen_gruppe(db):
                        try:
                            gid = int(chat_id_val)
                            members = db.query(ChatGroupMember.user_id).filter(ChatGroupMember.group_id == gid).all()
                            for m in members:
                                if m[0] != user_id:
                                    SyncEventService.publish(
                                        {
                                            "type": "typing",
                                            "sender_id": user_id,
                                            "sender_username": user_username,
                                            "chat_type": "group",
                                            "chat_id": str(gid),
                                            "status": status,
                                        },
                                        user_id=m[0],
                                    )
                        except Exception:
                            pass
                    try:
                        await _mit_sitzung(_tippen_gruppe)
                    except Exception as exc:
                        logger.debug("Fehler bei group typing signal: %s", exc)
                else:
                    blind_mailbox_id = data.get("blind_mailbox_id", "")
                    def _tippen(db, blind_mailbox_id=blind_mailbox_id, status=status, data=data):
                        SocialService.assert_mailbox_zugang(
                            db, user_id, blind_mailbox_id, data.get("mailbox_token")
                        )
                        SocialService.broadcast_typing_signal(
                            blind_mailbox_id=blind_mailbox_id,
                            status=status,
                            sender_id=user_id,
                            sender_username=user_username,
                            db=db,
                        )

                    try:
                        await _mit_sitzung(_tippen)
                    except Exception as exc:
                        logger.debug("Fehler bei broadcast_typing_signal: %s", exc)
            elif msg_type == "relay":
                blind_mailbox_id = data.get("blind_mailbox_id", "")
                ciphertext_envelope = data.get("ciphertext_envelope", "")
                is_control = bool(data.get("is_control", False))
                control_type = data.get("control_type")
                client_uuid = data.get("client_uuid")
                def _weiterleiten(
                    db,
                    blind_mailbox_id=blind_mailbox_id,
                    ciphertext_envelope=ciphertext_envelope,
                    client_uuid=client_uuid,
                    is_control=is_control,
                    control_type=control_type,
                    data=data,
                ):
                    SocialService.assert_mailbox_token(
                        db, blind_mailbox_id, data.get("mailbox_token"), user_id
                    )
                    return SocialService.relay_blind_envelope(
                        db,
                        blind_mailbox_id=blind_mailbox_id,
                        ciphertext_envelope=ciphertext_envelope,
                        sender_user_id=user_id,
                        client_uuid=client_uuid,
                        is_control=is_control,
                        control_type=control_type,
                        mailbox_token=data.get("mailbox_token"),
                    )

                try:
                    envelope = await _mit_sitzung(_weiterleiten)
                    # Sofortige Bestätigung an den WebSocket-Sender (Acknowledge zur Queue-Bereinigung)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "relay_ack",
                            "client_uuid": envelope.client_uuid or client_uuid,
                            "id": envelope.id,
                            "blind_mailbox_id": envelope.blind_mailbox_id,
                            "created_at": envelope.created_at.isoformat() if hasattr(envelope.created_at, "isoformat") else str(envelope.created_at),
                        })
                except HTTPException as he:
                    logger.debug("HTTPException bei WebSocket Relay für User %s: %s", user_id, he.detail)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "error",
                            "error": "relay_failed",
                            "status_code": he.status_code,
                            "detail": he.detail,
                            "client_uuid": client_uuid,
                        })
                except Exception as exc:
                    logger.warning("Unerwarteter Fehler bei WebSocket Relay für User %s: %s", user_id, exc)
                    async with ws_lock:
                        await websocket.send_json({
                            "type": "error",
                            "error": "relay_failed",
                            "status_code": 500,
                            "detail": "Interner Fehler beim Verarbeiten der Nachricht.",
                            "client_uuid": client_uuid,
                        })

    send_task = asyncio.create_task(_send_loop())
    recv_task = asyncio.create_task(_recv_loop())

    try:
        # Sobald eine Task endet (z.B. Disconnect beim Lesen oder Schreiben),
        # wird die andere Task sauber gecancelt.
        done, pending = await asyncio.wait(
            [send_task, recv_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("Social WebSocket getrennt: %s", e)
    finally:
        send_task.cancel()
        recv_task.cancel()
        await asyncio.gather(send_task, recv_task, return_exceptions=True)
        SyncEventService.unsubscribe(conn_id)
