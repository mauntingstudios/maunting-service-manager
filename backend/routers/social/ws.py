"""Echtzeit-WebSocket fuer den einen E2EE-Nachrichtenweg.

Senden, Zustellquittung und Lesequittung laufen ueber dieselben Service-
Funktionen wie HTTP. Der Kanal traegt nur Signale und bereits verschluesselte
Nutzlasten; der Server liest keinen Klartext.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, WebSocket
from starlette.websockets import WebSocketDisconnect

from database import SessionLocal
from dependencies import get_current_user_for_ws, ws_session_familie, ws_subprotokoll
from models import ChatGroupMember, DirectChatMember, User
from services.social.messages_service import ack_messages, mark_read, send_message
from services.social_service import SocialService
from services.sync_event_service import SyncEventService

logger = logging.getLogger(__name__)

router = APIRouter()

_WS_FEHLERTEXTE = {
    400: "Ungueltige Anfrage.",
    401: "Anmeldung erforderlich.",
    403: "Kein Zugriff auf dieses Gespraech.",
    404: "Gespraech oder Nachricht nicht gefunden.",
    409: "Die Nachricht konnte nicht eingeordnet werden.",
    410: "Die Nachricht ist nicht mehr verfuegbar.",
    413: "Die Nachricht ist zu gross.",
    422: "Die Nachricht ist ungueltig.",
    429: "Zu viele Anfragen. Bitte spaeter erneut versuchen.",
}


def _ws_fehler(exc: Exception, client_uuid: str | None) -> dict:
    """Eine sichere Fehlerantwort ohne Ausnahmetext.

    ``str(exc)`` kann bei Treiber- und Datenbankfehlern SQL oder Parameter
    enthalten. Nach aussen geht deshalb nur ein Status, ein optionaler
    Maschinencode und ein fester Satz.
    """
    status = int(getattr(exc, "status_code", 500) or 500)
    detail = getattr(exc, "detail", None)
    code = None
    text = None
    if isinstance(detail, dict):
        code = detail.get("code")
        text = detail.get("message") or detail.get("detail")
    elif isinstance(detail, str) and status < 500:
        text = detail
    if status >= 500:
        text = None
    return {
        "type": "error",
        "error": "send_message_failed",
        "status_code": status,
        "code": code,
        "detail": text or _WS_FEHLERTEXTE.get(status, "Der Versand ist fehlgeschlagen."),
        "client_uuid": client_uuid,
    }


def _mitglieder(db, chat_type: str, chat_id: int) -> set[int]:
    if chat_type == "direct":
        return {
            int(r[0])
            for r in db.query(DirectChatMember.user_id)
            .filter(DirectChatMember.chat_id == chat_id)
            .all()
        }
    return {
        int(r[0])
        for r in db.query(ChatGroupMember.user_id)
        .filter(ChatGroupMember.group_id == chat_id)
        .all()
    }


@router.websocket("/ws")
async def social_websocket(websocket: WebSocket) -> None:
    with SessionLocal() as db:
        try:
            user = get_current_user_for_ws(websocket, db)
            user_id = user.id
            user_username = user.username
        except HTTPException as exc:
            # Vor dem Accept sieht der Browser bei einem fehlgeschlagenen
            # Handshake nur 1006. Nach dem Accept kann er 401/403 von einem
            # echten Verbindungsabbruch unterscheiden.
            code = 4401 if exc.status_code == 401 else 4403
            try:
                await websocket.accept(subprotocol=ws_subprotokoll(websocket))
                await websocket.close(code=code)
            except Exception:
                pass
            return
        except Exception:
            try:
                await websocket.accept(subprotocol=ws_subprotokoll(websocket))
                await websocket.close(code=1008)
            except Exception:
                pass
            return

    await websocket.accept(subprotocol=ws_subprotokoll(websocket))
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
        def _lauf():
            with SessionLocal() as db:
                return arbeit(db)

        return await asyncio.to_thread(_lauf)

    async def _recv_loop():
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception:
                async with ws_lock:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "error": "invalid_message",
                            "status_code": 400,
                            "detail": "Ungueltige Nachricht.",
                        }
                    )
                continue
            if not isinstance(data, dict):
                async with ws_lock:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "error": "invalid_message",
                            "status_code": 400,
                            "detail": "Ungueltige Nachricht.",
                        }
                    )
                continue
            msg_type = data.get("type")
            if msg_type == "ping":
                async with ws_lock:
                    await websocket.send_json({"type": "pong"})
            elif msg_type == "join":
                try:
                    await _mit_sitzung(
                        lambda db: SocialService.broadcast_user_joined(db, user_id, user_username)
                    )
                    async with ws_lock:
                        await websocket.send_json({"type": "joined", "status": "ok", "user_id": user_id})
                except Exception as exc:
                    logger.debug("Fehler bei broadcast_user_joined: %s", exc)
            elif msg_type in ("init", "fetch_pending"):
                async with ws_lock:
                    await websocket.send_json(
                        {"type": "ready", "user_id": user_id, "device_id": device_id_param or ""}
                    )
            elif msg_type == "send_message":
                client_uuid = str(data.get("client_uuid") or "")
                try:
                    chat_type = str(data.get("chat_type") or "direct")
                    chat_id = int(data.get("chat_id") or 0)
                    key_version = int(data.get("key_version") or 1)
                    payload = str(data.get("encrypted_payload") or "")
                except (TypeError, ValueError):
                    async with ws_lock:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "error": "invalid_message",
                                "status_code": 400,
                                "detail": "Ungueltige Nachricht.",
                                "client_uuid": client_uuid,
                            }
                        )
                    continue

                def _sende(db):
                    sender = db.query(User).filter(User.id == user_id).first()
                    if sender is None:
                        raise ValueError("Benutzer nicht gefunden.")
                    return send_message(
                        db, sender, chat_type, chat_id, client_uuid, key_version, payload
                    )

                try:
                    message = await _mit_sitzung(_sende)
                    async with ws_lock:
                        await websocket.send_json(
                            {
                                "type": "message_sent",
                                "client_uuid": client_uuid,
                                "id": message["id"],
                                "status": "ok",
                            }
                        )
                except Exception as exc:
                    logger.debug("Fehler bei WS send_message: %s", type(exc).__name__)
                    async with ws_lock:
                        await websocket.send_json(_ws_fehler(exc, client_uuid))
            elif msg_type == "ack_message":
                try:
                    chat_type = str(data.get("chat_type") or "direct")
                    chat_id = int(data.get("chat_id") or 0)
                    up_to_id = int(data.get("up_to_id") or 0)
                except (TypeError, ValueError):
                    async with ws_lock:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "error": "invalid_message",
                                "status_code": 400,
                                "detail": "Ungueltige Quittung.",
                            }
                        )
                    continue

                def _quittiere(db):
                    u = db.query(User).filter(User.id == user_id).first()
                    if u is None:
                        return {"last_delivered_message_id": 0}
                    return ack_messages(db, u, chat_type, chat_id, up_to_id)

                try:
                    ergebnis = await _mit_sitzung(_quittiere)
                    async with ws_lock:
                        await websocket.send_json(
                            {"type": "ack_ok", **ergebnis, "client_uuid": data.get("client_uuid")}
                        )
                except Exception as exc:
                    logger.debug("Fehler bei WS ack_message: %s", type(exc).__name__)
                    antwort = _ws_fehler(exc, data.get("client_uuid"))
                    antwort["error"] = "ack_failed"
                    async with ws_lock:
                        await websocket.send_json(antwort)
            elif msg_type == "read_receipt":
                try:
                    chat_type = str(data.get("chat_type") or "direct")
                    chat_id = int(data.get("chat_id") or 0)
                    up_to_id = int(data.get("up_to_id") or 0)
                except (TypeError, ValueError):
                    async with ws_lock:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "error": "invalid_message",
                                "status_code": 400,
                                "detail": "Ungueltige Lesequittung.",
                            }
                        )
                    continue

                def _lese(db):
                    u = db.query(User).filter(User.id == user_id).first()
                    if u is None:
                        return {"last_read_message_id": 0}
                    return mark_read(db, u, chat_type, chat_id, up_to_id)

                try:
                    ergebnis = await _mit_sitzung(_lese)
                    async with ws_lock:
                        await websocket.send_json({"type": "read_ok", **ergebnis})
                except Exception as exc:
                    logger.debug("Fehler bei WS read_receipt: %s", type(exc).__name__)
                    antwort = _ws_fehler(exc, data.get("client_uuid"))
                    antwort["error"] = "read_failed"
                    async with ws_lock:
                        await websocket.send_json(antwort)
            elif msg_type == "presence":
                try:
                    await _mit_sitzung(lambda db: SocialService.update_presence(db, user_id, data))
                except Exception as exc:
                    logger.debug("Fehler bei update_presence: %s", exc)
            elif msg_type == "typing":
                chat_type = str(data.get("chat_type") or "direct")
                try:
                    chat_id = int(data.get("chat_id") or 0)
                except (TypeError, ValueError):
                    continue
                status = str(data.get("status") or "idle")

                def _tippen(db):
                    mitglieder = _mitglieder(db, chat_type, chat_id)
                    if user_id not in mitglieder:
                        return 0
                    SyncEventService.publish(
                        {
                            "type": "typing",
                            "chat_type": chat_type,
                            "chat_id": chat_id,
                            "sender_id": user_id,
                            "sender_username": user_username,
                            "status": status,
                        },
                        user_ids=mitglieder - {user_id},
                    )
                    return len(mitglieder)

                try:
                    await _mit_sitzung(_tippen)
                except Exception as exc:
                    logger.debug("Fehler beim Tippsignal: %s", exc)

    send_task = asyncio.create_task(_send_loop())
    recv_task = asyncio.create_task(_recv_loop())

    try:
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
