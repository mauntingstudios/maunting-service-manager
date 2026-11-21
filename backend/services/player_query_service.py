"""Live-Spielerabfrage fuer Gameserver (A2S, Minecraft SLP, GameSpy, RCON).

Kapselt alle Netzwerk-Query-Protokolle auf Basis der Python-Standardbibliothek.
Meldet Live-Spielerzahlen und etwaige Slot-Ueberschreitungen rein informativ;
ein laufender Server wird dadurch niemals beendet oder pausiert.
"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
import struct
from dataclasses import dataclass, replace

from sqlalchemy.orm import Session

from models import Server
from services import server_runtime_env, shop_slot_service

_DEFAULT_TIMEOUT_S = 2.0
_MAX_PACKET_BYTES = 65535
_A2S_REQUEST = b"\xff\xff\xff\xffTSource Engine Query\x00"


@dataclass(frozen=True)
class PlayerQueryResult:
    protocol: str
    online: bool
    players: int | None = None
    max_players: int | None = None
    server_name: str | None = None
    booked_slots: int | None = None
    slot_exceeded: bool = False
    warning: str | None = None
    error: str | None = None


def _socket_family(host: str) -> socket.AddressFamily:
    try:
        addr = ipaddress.ip_address(host)
        return socket.AF_INET6 if addr.version == 6 else socket.AF_INET
    except ValueError:
        return socket.AF_INET


def _read_cstr(data: bytes, offset: int) -> tuple[str, int]:
    end = data.find(b"\x00", offset)
    if end == -1:
        raise ValueError("Unvollstaendiger C-String in Query-Antwort")
    return data[offset:end].decode("utf-8", errors="replace"), end + 1


def _udp_request(host: str, port: int, payload: bytes, timeout: float) -> bytes:
    family = _socket_family(host)
    with socket.socket(family, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        sock.connect((host, port))
        sock.send(payload)
        data = sock.recv(_MAX_PACKET_BYTES + 1)
        if len(data) > _MAX_PACKET_BYTES:
            raise ValueError("Query-Antwort ueberschreitet Paketlimit")
        return data


def _recv_exact(sock: socket.socket, count: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < count:
        part = sock.recv(count - len(chunks))
        if not part:
            raise EOFError("TCP-Verbindung unerwartet beendet")
        chunks.extend(part)
    return bytes(chunks)


def _encode_varint(value: int) -> bytes:
    out = bytearray()
    val = value & 0xFFFFFFFF
    while True:
        byte = val & 0x7F
        val >>= 7
        if val:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _read_varint(sock: socket.socket) -> int:
    num_read = 0
    result = 0
    while True:
        raw = sock.recv(1)
        if not raw:
            raise EOFError("VarInt abgebrochen")
        byte = raw[0]
        result |= (byte & 0x7F) << (7 * num_read)
        num_read += 1
        if num_read > 5:
            raise ValueError("VarInt zu lang")
        if (byte & 0x80) == 0:
            return result


def _read_varint_bytes(buf: bytes, offset: int) -> tuple[int, int]:
    num_read = 0
    result = 0
    pos = offset
    while pos < len(buf):
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << (7 * num_read)
        num_read += 1
        if num_read > 5:
            raise ValueError("VarInt zu lang")
        if (byte & 0x80) == 0:
            return result, pos
    raise ValueError("Unvollstaendiger VarInt")


def query_a2s(host: str, port: int, timeout: float = _DEFAULT_TIMEOUT_S) -> PlayerQueryResult:
    """Fragt einen Server via Valve Source Engine A2S_INFO (UDP) ab."""
    try:
        family = _socket_family(host)
        with socket.socket(family, socket.SOCK_DGRAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))
            sock.send(_A2S_REQUEST)
            resp = sock.recv(_MAX_PACKET_BYTES + 1)
            if len(resp) > _MAX_PACKET_BYTES:
                raise ValueError("A2S-Antwort ueberschreitet Paketlimit")
            if len(resp) >= 9 and resp[:5] == b"\xff\xff\xff\xff\x41":
                sock.send(_A2S_REQUEST + resp[5:9])
                resp = sock.recv(_MAX_PACKET_BYTES + 1)
                if len(resp) > _MAX_PACKET_BYTES:
                    raise ValueError("A2S-Antwort ueberschreitet Paketlimit")

        if len(resp) < 10 or resp[:5] != b"\xff\xff\xff\xff\x49":
            return PlayerQueryResult(protocol="a2s", online=False, error="Ungueltige A2S-Antwort")

        pos = 6  # ueberspringe Header (5) + Protokollversion (1)
        server_name, pos = _read_cstr(resp, pos)
        _map_name, pos = _read_cstr(resp, pos)
        _folder, pos = _read_cstr(resp, pos)
        _game, pos = _read_cstr(resp, pos)
        if pos + 4 > len(resp):
            raise ValueError("Unvollstaendiges A2S-INFO-Paket")
        pos += 2  # Steam App-ID (uint16 LE)
        players = resp[pos]
        max_players = resp[pos + 1]
        return PlayerQueryResult(
            protocol="a2s",
            online=True,
            players=int(players),
            max_players=int(max_players),
            server_name=server_name or None,
        )
    except (OSError, ValueError, TimeoutError) as exc:
        return PlayerQueryResult(protocol="a2s", online=False, error=str(exc))


def query_minecraft_slp(
    host: str, port: int, timeout: float = _DEFAULT_TIMEOUT_S
) -> PlayerQueryResult:
    """Fragt einen Minecraft-Server via Server List Ping (TCP 1.7+) ab."""
    try:
        host_bytes = host.encode("utf-8")
        handshake_body = (
            b"\x00"
            + _encode_varint(760)
            + _encode_varint(len(host_bytes))
            + host_bytes
            + struct.pack(">H", port)
            + _encode_varint(1)
        )
        handshake = _encode_varint(len(handshake_body)) + handshake_body
        status_req = b"\x01\x00"

        family = _socket_family(host)
        with socket.socket(family, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))
            sock.sendall(handshake + status_req)

            packet_len = _read_varint(sock)
            if packet_len <= 0 or packet_len > _MAX_PACKET_BYTES:
                raise ValueError("Ungueltige SLP-Paketlaenge")
            packet = _recv_exact(sock, packet_len)

        packet_id, pos = _read_varint_bytes(packet, 0)
        if packet_id != 0x00:
            raise ValueError(f"Unerwartete SLP-Paket-ID {packet_id}")
        json_len, pos = _read_varint_bytes(packet, pos)
        if json_len <= 0 or pos + json_len > len(packet):
            raise ValueError("Ungueltige SLP-JSON-Laenge")

        data = json.loads(packet[pos : pos + json_len].decode("utf-8", errors="replace"))
        players_obj = data.get("players") or {}
        online_val = players_obj.get("online")
        max_val = players_obj.get("max")
        desc = data.get("description")
        name = desc.get("text") if isinstance(desc, dict) else (desc if isinstance(desc, str) else None)
        return PlayerQueryResult(
            protocol="minecraft_slp",
            online=True,
            players=int(online_val) if online_val is not None else None,
            max_players=int(max_val) if max_val is not None else None,
            server_name=name,
        )
    except (OSError, ValueError, EOFError, json.JSONDecodeError, TimeoutError) as exc:
        return PlayerQueryResult(protocol="minecraft_slp", online=False, error=str(exc))


def _parse_gamespy_fields(raw_payload: bytes) -> dict[str, str]:
    tokens = [part.decode("utf-8", errors="replace") for part in raw_payload.split(b"\x00")]
    if "numplayers" in tokens:
        idx = tokens.index("numplayers")
        parsed: dict[str, str] = {}
        if idx + 1 < len(tokens):
            parsed["numplayers"] = tokens[idx + 1]
        if "maxplayers" in tokens:
            m_idx = tokens.index("maxplayers")
            if m_idx + 1 < len(tokens):
                parsed["maxplayers"] = tokens[m_idx + 1]
        if "hostname" in tokens:
            h_idx = tokens.index("hostname")
            if h_idx + 1 < len(tokens):
                parsed["hostname"] = tokens[h_idx + 1]
        return parsed

    # Basic-Stat-Reihenfolge: hostname, gametype, map, numplayers, maxplayers
    non_empty = [tok for tok in tokens if tok != ""]
    if len(non_empty) >= 5 and non_empty[3].isdigit() and non_empty[4].isdigit():
        return {
            "hostname": non_empty[0],
            "numplayers": non_empty[3],
            "maxplayers": non_empty[4],
        }
    return {}


def query_gamespy(host: str, port: int, timeout: float = _DEFAULT_TIMEOUT_S) -> PlayerQueryResult:
    """Fragt einen Server via GameSpy UDP Challenge/Basic-Stat ab."""
    sid = b"\x00\x00\x00\x01"
    try:
        family = _socket_family(host)
        with socket.socket(family, socket.SOCK_DGRAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))
            sock.send(b"\xfe\xfd\x09" + sid)
            ch_resp = sock.recv(_MAX_PACKET_BYTES + 1)
            if len(ch_resp) < 6 or ch_resp[0] != 0x09 or ch_resp[1:5] != sid:
                return PlayerQueryResult(
                    protocol="gamespy", online=False, error="Ungueltige GameSpy-Challenge"
                )
            challenge_int = int(ch_resp[5:].split(b"\x00", 1)[0].decode("ascii"))
            stat_req = b"\xfe\xfd\x00" + sid + struct.pack(">i", challenge_int)
            sock.send(stat_req)
            stat_resp = sock.recv(_MAX_PACKET_BYTES + 1)

        if len(stat_resp) < 6 or stat_resp[0] != 0x00 or stat_resp[1:5] != sid:
            return PlayerQueryResult(
                protocol="gamespy", online=False, error="Ungueltige GameSpy-Stat-Antwort"
            )

        fields = _parse_gamespy_fields(stat_resp[5:])
        if "numplayers" not in fields:
            return PlayerQueryResult(
                protocol="gamespy", online=False, error="Spielerfelder fehlen in GameSpy-Antwort"
            )
        return PlayerQueryResult(
            protocol="gamespy",
            online=True,
            players=int(fields["numplayers"]),
            max_players=int(fields["maxplayers"]) if "maxplayers" in fields else None,
            server_name=fields.get("hostname"),
        )
    except (OSError, ValueError, UnicodeError, TimeoutError) as exc:
        return PlayerQueryResult(protocol="gamespy", online=False, error=str(exc))


def _rcon_send(sock: socket.socket, req_id: int, pkt_type: int, body: str) -> None:
    payload = struct.pack("<ii", req_id, pkt_type) + body.encode("utf-8") + b"\x00\x00"
    sock.sendall(struct.pack("<i", len(payload)) + payload)


def _rcon_recv(sock: socket.socket) -> tuple[int, int, str]:
    size_bytes = _recv_exact(sock, 4)
    (size,) = struct.unpack("<i", size_bytes)
    if size < 8 or size > _MAX_PACKET_BYTES:
        raise ValueError("Ungueltige RCON-Paketgroesse")
    data = _recv_exact(sock, size)
    req_id, pkt_type = struct.unpack("<ii", data[:8])
    body = data[8:-2].decode("utf-8", errors="replace")
    return req_id, pkt_type, body


def _parse_rcon_players(text: str) -> tuple[int | None, int | None]:
    mc_match = re.search(r"(\d+)\s+of\s+a\s+max\s+of\s+(\d+)\s+players", text, re.IGNORECASE)
    if mc_match:
        return int(mc_match.group(1)), int(mc_match.group(2))
    src_match = re.search(r"players\s*:\s*(\d+)\s+humans?", text, re.IGNORECASE)
    if src_match:
        return int(src_match.group(1)), None
    slash_match = re.search(r"players\s*:\s*(\d+)\s*/\s*(\d+)", text, re.IGNORECASE)
    if slash_match:
        return int(slash_match.group(1)), int(slash_match.group(2))
    return None, None


def query_rcon_fallback(
    host: str,
    port: int,
    password: str | None,
    timeout: float = _DEFAULT_TIMEOUT_S,
) -> PlayerQueryResult:
    """RCON-Fallback fuer Spiele ohne oeffentlichen Query-Port."""
    if not password:
        return PlayerQueryResult(
            protocol="rcon", online=False, error="Kein RCON-Passwort konfiguriert"
        )
    try:
        family = _socket_family(host)
        with socket.socket(family, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))
            _rcon_send(sock, 1, 3, password)
            resp_id, _ptype, _body = _rcon_recv(sock)
            if resp_id == -1:
                return PlayerQueryResult(
                    protocol="rcon", online=False, error="RCON-Authentifizierung fehlgeschlagen"
                )
            _rcon_send(sock, 2, 2, "status")
            _, _, body = _rcon_recv(sock)
            players, max_players = _parse_rcon_players(body)
            if players is None:
                _rcon_send(sock, 3, 2, "list")
                _, _, body2 = _rcon_recv(sock)
                players, max_players = _parse_rcon_players(body2)
            return PlayerQueryResult(
                protocol="rcon",
                online=True,
                players=players,
                max_players=max_players,
            )
    except (OSError, ValueError, EOFError, TimeoutError) as exc:
        return PlayerQueryResult(protocol="rcon", online=False, error=str(exc))


def _resolve_target(server: Server, preferred_role: str) -> tuple[str, int | None]:
    raw_host = (getattr(server, "public_bind_ip", None) or "").strip()
    host = "127.0.0.1" if not raw_host or raw_host == "0.0.0.0" else raw_host
    ports = getattr(server, "ports", []) or []
    for role in (preferred_role, "query", "game", "rcon"):
        for port_entry in ports:
            if getattr(port_entry, "role", None) == role and getattr(port_entry, "port", None):
                return host, int(port_entry.port)
    return host, None


def query_server_players(db: Session, server: Server) -> PlayerQueryResult:
    """Ermittelt Live-Spielerzahl und prueft gegen gebuchte Slots (ohne Kill)."""
    players_spec = shop_slot_service.get_blueprint_players(server.game_type)
    booked_slots = shop_slot_service.read_configured_slots(db, server)
    if players_spec is None or players_spec.queryProtocol == "none":
        return PlayerQueryResult(
            protocol=players_spec.queryProtocol if players_spec else "none",
            online=False,
            booked_slots=booked_slots,
            error="Kein Spieler-Query-Protokoll am Blueprint hinterlegt",
        )

    protocol = players_spec.queryProtocol
    if getattr(server, "status", None) != "running":
        return PlayerQueryResult(
            protocol=protocol,
            online=False,
            booked_slots=booked_slots,
            error="Server laeuft aktuell nicht",
        )

    host, port = _resolve_target(server, players_spec.queryPortRole)
    if port is None:
        return PlayerQueryResult(
            protocol=protocol,
            online=False,
            booked_slots=booked_slots,
            error="Kein Query-Port am Server zugewiesen",
        )

    if protocol == "a2s":
        res = query_a2s(host, port)
    elif protocol == "minecraft_slp":
        res = query_minecraft_slp(host, port)
    elif protocol == "gamespy":
        res = query_gamespy(host, port)
    elif protocol == "rcon":
        env = server_runtime_env.get_runtime_env(server.id, db=db)
        pwd = env.get("RCON_PASSWORD")
        res = query_rcon_fallback(host, port, pwd)
    else:
        return PlayerQueryResult(
            protocol=protocol,
            online=False,
            booked_slots=booked_slots,
            error=f"Unbekanntes Query-Protokoll: {protocol}",
        )

    exceeded = bool(
        res.online
        and res.players is not None
        and booked_slots is not None
        and res.players > booked_slots
    )
    warning = (
        f"Aktive Spielerzahl ({res.players}) ueberschreitet gebuchte Slots ({booked_slots})"
        if exceeded
        else None
    )
    return replace(
        res,
        booked_slots=booked_slots,
        slot_exceeded=exceeded,
        warning=warning,
    )
