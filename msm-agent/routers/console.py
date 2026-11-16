"""WebSocket console streaming for container logs + stdin."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services import docker_service, file_service
from services.console_log_service import read_declared_log_updates
from services.docker_service import ContainerNameError, DockerUnavailableError
from services.agent_operation_coordinator import server_id_from_container_name
from services.guardian_service import console_log_config, redact_log_text
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["console"])


@router.websocket("/console/{container_name}/ws")
async def console_ws(websocket: WebSocket, container_name: str) -> None:
    """Stream docker logs to the client; forward text frames to container stdin.

    Auth is enforced by the HTTP middleware on the upgrade request
    (Authorization: Bearer <token>). /health is the only unauthenticated path.
    """
    try:
        docker_service.assert_msm_container_name(container_name)
    except ContainerNameError:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[str] = asyncio.Queue()
    stop = threading.Event()
    server_id = server_id_from_container_name(
        container_name, settings.container_name_prefix
    )

    def _load_log_config():
        if server_id is None:
            return None
        try:
            return console_log_config(server_id)
        except Exception:
            return None

    def _producer() -> None:
        backoff = 0.5
        streamed_stopped = False
        last_started_at: str | None = None
        while not stop.is_set():
            state = None
            state_known = False
            try:
                state = docker_service.inspect_container_state(container_name)
                state_known = True
            except (DockerUnavailableError, ContainerNameError):
                state_known = False
            except Exception:
                state_known = False

            if state_known:
                if state is None:
                    streamed_stopped = False
                    stop.wait(backoff)
                    backoff = min(backoff * 1.5, 3.0)
                    continue
                running = bool(state.get("running"))
                started_at = str(state.get("started_at") or "")
                if not running:
                    if streamed_stopped and started_at == last_started_at:
                        stop.wait(backoff)
                        backoff = min(backoff * 1.5, 3.0)
                        continue
                    streamed_stopped = True
                    last_started_at = started_at
                else:
                    streamed_stopped = False
                    last_started_at = started_at

            backoff = 0.5
            config = _load_log_config()
            redactors = config.redact if config is not None else []
            got_lines = False
            try:
                for line in docker_service.stream_logs_sync(
                    container_name, tail=200, stop_event=stop
                ):
                    got_lines = True
                    if stop.is_set():
                        break
                    asyncio.run_coroutine_threadsafe(
                        queue.put(redact_log_text(line, redactors)), loop
                    )
            except (DockerUnavailableError, FileNotFoundError, ContainerNameError):
                pass
            except Exception:
                logger.warning("console log producer failed")

            if stop.is_set():
                break
            if not state_known and not got_lines:
                stop.wait(backoff)
                backoff = min(backoff * 1.5, 3.0)
            else:
                stop.wait(0.5)

    def _file_producer() -> None:
        positions: dict[str, int] = {}
        while not stop.is_set():
            config = _load_log_config()
            if config is None or not any(source != "stdout" for source in config.sources):
                stop.wait(1.0)
                continue
            try:
                root = docker_service.managed_bind_root(container_name)
            except (DockerUnavailableError, FileNotFoundError, ContainerNameError, OSError):
                if server_id is not None:
                    fallback = file_service.server_root(server_id)
                    if fallback.is_dir():
                        root = fallback
                    else:
                        stop.wait(1.0)
                        continue
                else:
                    stop.wait(1.0)
                    continue
            try:
                for line in read_declared_log_updates(
                    root=root,
                    sources=config.sources,
                    redactors=config.redact,
                    max_tail_bytes=config.max_tail_bytes,
                    positions=positions,
                ):
                    if stop.is_set():
                        break
                    envelope = json.dumps(
                        {"msm_console_source": "file", "text": line},
                        ensure_ascii=False,
                    )
                    asyncio.run_coroutine_threadsafe(queue.put(envelope), loop)
            except OSError:
                pass
            except Exception:
                logger.warning("console file log producer failed")
            stop.wait(0.2)

    producer_future = loop.run_in_executor(None, _producer)
    file_producer_future = loop.run_in_executor(None, _file_producer)

    async def _send_logs() -> None:
        while True:
            line = await queue.get()
            try:
                await websocket.send_text(line)
            except Exception:
                break

    send_task = asyncio.create_task(_send_logs())

    try:
        while True:
            message: Any = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            text = message.get("text")
            if text is None:
                continue
            # Do not log stdin content (may contain secrets / RCON passwords)
            result = await loop.run_in_executor(
                None, docker_service.send_stdin, container_name, text
            )
            if not result.get("ok"):
                try:
                    await websocket.send_text(
                        f"[msm-agent] stdin failed: {result.get('error', 'unknown')}"
                    )
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        stop.set()
        send_task.cancel()
        try:
            await send_task
        except asyncio.CancelledError:
            pass
        try:
            await producer_future
        except Exception:
            pass
        try:
            await file_producer_future
        except Exception:
            pass
