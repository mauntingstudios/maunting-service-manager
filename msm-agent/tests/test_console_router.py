from __future__ import annotations

import asyncio
from typing import Any, cast

from routers import console


class _DisconnectingWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.sent: list[str] = []

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        pass

    async def send_text(self, text: str) -> None:
        self.sent.append(text)

    async def receive(self) -> dict[str, str]:
        return {"type": "websocket.disconnect"}


def test_console_passes_disconnect_signal_to_docker_log_stream(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_stream(_name: str, tail: int = 200, *, stop_event) -> object:
        captured["stop_event"] = stop_event
        if False:
            yield ""

    monkeypatch.setattr(console.docker_service, "assert_msm_container_name", lambda value: value)
    monkeypatch.setattr(console, "console_log_config", lambda _server_id: None)
    monkeypatch.setattr(console.docker_service, "stream_logs_sync", fake_stream)

    websocket = _DisconnectingWebSocket()
    asyncio.run(console.console_ws(cast(Any, websocket), "msm-srv-107"))

    assert websocket.accepted is True
    assert cast(Any, captured["stop_event"]).is_set() is True


def test_console_attaches_docker_and_file_logs_when_container_starts_later(
    tmp_path, monkeypatch
) -> None:
    import json
    from types import SimpleNamespace

    logs_dir = tmp_path / "Logs"
    logs_dir.mkdir()
    user_log = logs_dir / "2026-11-17_user.txt"

    checks = {"count": 0}

    def fake_inspect(_name: str):
        checks["count"] += 1
        if checks["count"] < 2:
            return None
        return {"running": True, "status": "running", "started_at": "2026-11-17T00:00:00Z"}

    def fake_config(_server_id: int):
        if checks["count"] < 2:
            return None
        return SimpleNamespace(
            sources=["stdout", "Logs/*_user.txt"],
            redact=[],
            max_tail_bytes=65536,
        )

    def fake_stream(_name: str, tail: int = 200, *, stop_event):
        user_log.write_text("user ZomboidPlayer connected\n", encoding="utf-8")
        yield "SERVER STARTED"
        while not stop_event.is_set():
            stop_event.wait(0.05)

    class _TimedWebSocket:
        def __init__(self) -> None:
            self.accepted = False
            self.sent: list[str] = []

        async def accept(self) -> None:
            self.accepted = True

        async def close(self, code: int = 1000) -> None:
            pass

        async def send_text(self, text: str) -> None:
            self.sent.append(text)

        async def receive(self) -> dict[str, str]:
            await asyncio.sleep(1.5)
            return {"type": "websocket.disconnect"}

    monkeypatch.setattr(console.docker_service, "assert_msm_container_name", lambda value: value)
    monkeypatch.setattr(console.docker_service, "inspect_container_state", fake_inspect)
    monkeypatch.setattr(console.docker_service, "managed_bind_root", lambda _name: tmp_path)
    monkeypatch.setattr(console.docker_service, "stream_logs_sync", fake_stream)
    monkeypatch.setattr(console, "console_log_config", fake_config)

    websocket = _TimedWebSocket()
    asyncio.run(console.console_ws(cast(Any, websocket), "msm-srv-107"))

    assert websocket.accepted is True
    assert "SERVER STARTED" in websocket.sent
    file_texts = [
        json.loads(item)["text"]
        for item in websocket.sent
        if item.startswith("{") and json.loads(item).get("msm_console_source") == "file"
    ]
    assert "user ZomboidPlayer connected" in file_texts
