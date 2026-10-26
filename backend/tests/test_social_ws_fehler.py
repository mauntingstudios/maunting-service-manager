"""Der WebSocket-Weg darf keine Ausnahmetexte nach aussen tragen.

Die Fehlerantwort nennt Status und optional einen Maschinencode, aber nie
``str(exc)``: Treiber- und Datenbankfehler enthalten sonst SQL oder Parameter.
"""

from __future__ import annotations

from fastapi import HTTPException

import routers.social.ws as ws_router


def _sende(ws, chat_id="1"):
    ws.send_json(
        {
            "type": "send_message",
            "chat_type": "direct",
            "chat_id": chat_id,
            "client_uuid": "ws-fehler-1",
            "key_version": 1,
            "encrypted_payload": "chiffrat",
        }
    )
    return ws.receive_json()


def test_ws_fehler_nennt_keinen_ausnahmetext(
    client, owner_user, owner_cookies, monkeypatch
):
    def kaputt(*_args, **_kwargs):
        raise RuntimeError("SELECT secret FROM users WHERE token = 'abc'")

    monkeypatch.setattr(ws_router, "send_message", kaputt)

    with client.websocket_connect(
        "/api/social/ws",
        cookies=owner_cookies,
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        antwort = _sende(ws)

    assert antwort["type"] == "error"
    assert antwort["status_code"] == 500
    assert "SELECT" not in antwort["detail"]
    assert "token" not in antwort["detail"]


def test_ws_fehler_reicht_den_maschinencode_durch(
    client, owner_user, owner_cookies, monkeypatch
):
    def abgelehnt(*_args, **_kwargs):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "key_version_not_shared",
                "message": "Diese Schluesselversion fehlt mindestens einem Mitglied.",
            },
        )

    monkeypatch.setattr(ws_router, "send_message", abgelehnt)

    with client.websocket_connect(
        "/api/social/ws",
        cookies=owner_cookies,
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        antwort = _sende(ws)

    assert antwort["status_code"] == 409
    assert antwort["code"] == "key_version_not_shared"


def test_kaputter_rahmen_beendet_den_socket_nicht(
    client, owner_user, owner_cookies
):
    with client.websocket_connect(
        "/api/social/ws",
        cookies=owner_cookies,
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        antwort = _sende(ws, chat_id="keine-zahl")
        assert antwort["type"] == "error"
        assert antwort["error"] == "invalid_message"

        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
