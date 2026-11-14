"""Game-Plugin-Basis — Docker-only Lifecycle.

Jeder GamePlugin liefert minimale, Docker-spezifische Bausteine:
  - build_container_command(server)  → cmd-Args im Container
  - build_container_env(server)      → ENV-Vars im Container
  - build_port_publishes(server)     → Liste von PortPublish (host↔container)
  - build_volume_binds(server)       → Liste von VolumeBind (host↔container)

`start/stop/get_status/get_logs` haben Default-Implementierungen in der Basis,
die alle Container-Operationen über `docker_service` ausführen. Server-Typen
kommen aus Blueprints; game-spezifische Runtime-Varianten werden deklarativ in
der Blueprint beschrieben und vom generischen `BlueprintPlugin` ausgeführt.

Es gibt KEINE systemd-/linux-user-Pfade mehr. Game-Server laufen ausschließlich
in Docker-Containern. Isolation kommt von Docker, nicht von POSIX-Usern.
"""

from __future__ import annotations

import logging
import os
import re
import shlex
import subprocess
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services import docker_service
from services import server_config_wishes
from services.docker_service import PortPublish, VolumeBind

from blueprints.schema import Blueprint, BlueprintModInjection
from games import updater  # zentrale KISS-Updater-Logik (Blueprint-konform)


def _require_bind_ip(server) -> str:
    """Liefert ``server.public_bind_ip`` oder wirft RuntimeError.

    Wird vor jedem Container-Start aufgerufen — ohne explizite Bind-IP würde
    Docker auf 0.0.0.0 binden und die UFW-Regeln umgehen.
    """
    bind_ip = getattr(server, "public_bind_ip", None) or None
    if not bind_ip or bind_ip == "0.0.0.0":
        raise RuntimeError(
            "public_bind_ip fehlt oder ist 0.0.0.0 — bitte im Server-Detail "
            "eine konkrete Host-IP zuweisen, bevor der Server gestartet wird."
        )
    return bind_ip


def default_port_publishes(server) -> list[PortPublish]:
    """Standard-Port-Mapping: game/query UDP, rcon TCP — immer an Bind-IP."""
    bind_ip = _require_bind_ip(server)
    ports: list[PortPublish] = []
    if server.game_port:
        ports.append(PortPublish(server.game_port, server.game_port, "udp", bind_ip))
    if server.query_port:
        ports.append(PortPublish(server.query_port, server.query_port, "udp", bind_ip))
    if server.rcon_port:
        ports.append(PortPublish(server.rcon_port, server.rcon_port, "tcp", bind_ip))
    return ports

logger = logging.getLogger(__name__)


@dataclass
class ConfigField:
    key: str
    label: str
    type: str  # text, number, bool, select, textarea
    default: Any = None
    options: list[str] | None = None
    description: str = ""
    required: bool = False


@dataclass
class ServerStatus:
    status: str  # stopped, running, installing, updating, starting, error
    cpu_percent: float | None = None
    ram_mb: int | None = None
    disk_mb: int | None = None
    uptime_seconds: int | None = None
    started_at: datetime | None = None
    message: str | None = None


def _map_container_status(docker_status: str) -> str:
    """Mapped Docker-Container-States auf MSM-Status-Codes.

    Docker liefert u. a. "exited", "dead", "created", "removing", "paused",
    "restarting", "running". Diese Strings landen sonst 1:1 im Frontend und
    sind dort nicht uebersetzbar. Wir reduzieren auf das kleine Set, das die
    UI versteht und i18n-Schluessel hat.
    """
    if docker_status == "running":
        return "running"
    if docker_status == "restarting":
        return "starting"
    # exited, dead, created, removing, paused -> stopped
    return "stopped"


def _parse_docker_started_at(value: str | None) -> datetime | None:
    if not value or value.startswith("0001-01-01"):
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


# ── Console-Logging (MSM-eigene Log-Datei pro Server) ──────────────────────


def _console_log_path(server_id: int) -> str:
    """Pfad zur MSM Console-Log-Datei. Liegt zentral unter backend/logs/<id>/console.log
    — unabhängig vom install_dir, damit der Pfad auch dann existiert, wenn der
    Bind-Mount geleert wird.
    """
    base_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
    srv_dir = os.path.join(base_dir, str(server_id))
    os.makedirs(srv_dir, exist_ok=True)
    return os.path.join(srv_dir, "console.log")


def _append_console_log(server_id: int, text: str) -> None:
    """Append a console event line. The line is stored with an embedded UTC ISO
    timestamp so that historical backlog reads can assign the *original* write
    time instead of the time the console panel was opened.
    Format in file: <iso-timestamp>\t<raw-text>\n
    The \t + ts prefix is stripped on read (in console_stream_service).
    """
    try:
        log_path = _console_log_path(server_id)
        ts = datetime.now(timezone.utc).isoformat()
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"{ts}\t{text}")
            f.flush()
        try:
            from services.console_stream_service import append_msm_log_to_memory
            append_msm_log_to_memory(server_id, text, ts)
        except Exception:
            pass
    except OSError as e:
        logger.warning("Could not write console log for server %s: %s", server_id, e)


def finish_install(server_id: int, result: dict) -> None:
    """Background-Thread-Callback: setzt Server-Status nach SteamCMD-Lauf.

    Wird aus dem Hintergrund-Thread aufgerufen, der die Installation/Update
    ausführt. Muss eine FRISCHE DB-Session öffnen, weil die Request-Session
    längst geschlossen ist (Request endete mit "Installation gestartet").

    Bei Erfolg → status="stopped" (bereit zum Starten), oder ``next_status``
    aus dem Result-Dict (z. B. "awaiting_files").
    Bei Fehler → status="error" + Fehlertext (gekürzt).
    """
    # Inline-Imports, weil base.py beim Modul-Load noch keine Modelle kennen darf
    # (zirkulärer Import via games.__init__).
    from database import SessionLocal
    from models import Server
    from services.install_update_lock_service import release_install_update_lock

    db = SessionLocal()
    try:
        server = db.query(Server).filter(Server.id == server_id).first()
        if not server:
            return
        if result.get("ok"):
            server.status = result.get("next_status", "stopped")
            server.status_message = None
        else:
            err = result.get("error") or "Installation fehlgeschlagen"
            server.status = "error"
            server.status_message = err[:500]
        db.commit()
        # Der persistente Provisionierungs-Task folgt demselben fachlichen
        # Abschluss wie der Serverstatus. Es werden keine Installationsdetails
        # oder Credentials in den Task übernommen.
        from services.operation_task_service import finish_server_provisioning

        finish_server_provisioning(
            db,
            server_id,
            succeeded=bool(result.get("ok")),
            success_phase=(
                "awaiting_files"
                if result.get("next_status") == "awaiting_files"
                else "ready"
            ),
        )
    except Exception as e:
        # Kein Re-Raise — Thread soll nicht crashen, nur loggen
        logger.warning("finish_install failed for server %s: %s", server_id, e)
        db.rollback()
    finally:
        release_install_update_lock(server_id)
        db.close()


# ── Container-Name ─────────────────────────────────────────────────────────


def container_name_for(server_id: int) -> str:
    """Stabile, vorhersagbare Container-Bezeichnung pro Server."""
    return f"msm-srv-{server_id}"


# ── Bind-Mount-Layout ──────────────────────────────────────────────────────


# Im Container wird das Server-Verzeichnis IMMER unter /data eingehängt.
# Plugins bauen ihre Kommandos relativ zu /data.
CONTAINER_DATA_DIR = "/data"


def default_volume_binds(server) -> list[VolumeBind]:
    """Standard-Bind: install_dir (Host) → /data (Container, RW)."""
    return [VolumeBind(host_path=server.install_dir, container_path=CONTAINER_DATA_DIR, read_only=False)]


# ── SteamCMD-Installer im ephemeren Container (ausgelagert in steamcmd_runner) ─

from games.steamcmd_runner import (  # noqa: E402,F401
    STEAMCMD_BIN,
    STEAMCMD_CAPS,
    STEAMCMD_IMAGE,
    _bounded_log_buffer_append,
    _build_steamcmd_bash_command,
    _redact,
    _resolve_steam_login,
    classify_steamcmd_failure,
    run_steamcmd_install,
    run_steamcmd_workshop_download,
    run_steamcmd_workshop_download_batch,
)


# ── Mod-Helfer (Blueprint-getrieben) ───────────────────────────────────────


def _query_active_mods(server_id: int) -> list:
    """Liest aktive Mods (``enabled=True``) in ``load_order``-Reihenfolge.

    Eine frische DB-Session, weil die Request-Session bei Background-Threads
    laengst geschlossen sein kann. Wir geben ORM-Objekte zurueck, damit der
    Caller auch ``workshop_id``, ``name`` etc. lesen kann.
    """
    from database import SessionLocal
    from models import Mod

    db = SessionLocal()
    try:
        return (
            db.query(Mod)
            .filter(Mod.server_id == server_id, Mod.enabled == True)  # noqa: E712
            .order_by(Mod.load_order.asc())
            .all()
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Active-Mods-Abfrage fuer Server %s fehlgeschlagen: %s", server_id, exc)
        return []
    finally:
        db.close()


def active_mod_ids(server) -> list[str]:
    """Liefert Workshop-IDs aller aktiven Mods in Lade-Reihenfolge."""
    return [m.workshop_id for m in _query_active_mods(server.id)]


def _finalize_modlist_lines(server, lines: list[str]) -> list[str]:
    """Dedupliziert Modlist-Zeilen stabil unter Erhalt der Reihenfolge."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        line = (raw or "").strip()
        if not line or line in seen:
            continue
        seen.add(line)
        out.append(line)
    return out


def _format_target_line(raw: str, entry_template: str | None) -> str:
    line = (raw or "").strip()
    if not line:
        return ""
    if not entry_template:
        return line
    if entry_template == "*{VALUE}":
        return line if line.startswith("*") else f"*{line}"
    return entry_template.replace("{VALUE}", line)


def _set_flat_config_value(content: str, key: str, value: str) -> str:
    """Setzt einen ``key=value``-Eintrag in einer sektionslosen Config-Datei."""
    prefix = f"{key}="
    lines = content.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if line.rstrip("\r\n").startswith(prefix):
            newline = "\r\n" if line.endswith("\r\n") else "\n"
            lines[index] = f"{prefix}{value}{newline}"
            return "".join(lines)
    if content and not content.endswith(("\n", "\r")):
        content += "\n"
    return f"{content}{prefix}{value}\n"


def write_workshop_modlist_targets(
    server,
    targets: list[Any],
    target_values: dict[Any, list[str]],
) -> None:
    """Schreibt ein oder mehrere BlueprintModListTargets sicher in Dateien unter install_dir."""
    install_dir = getattr(server, "install_dir", None) or ""
    if not install_dir:
        _append_console_log(server.id, "[MSM] Modliste: kein install_dir gesetzt\n")
        return

    server_name = str(getattr(server, "name", ""))
    if any(ch in server_name for ch in ("/", "\\", "\x00")) or server_name in {".", ".."}:
        _append_console_log(server.id, "[MSM] Modliste: unsicherer Servername abgelehnt\n")
        return

    file_targets: dict[str, list[Any]] = {}
    for target in targets:
        rel_path = target.file.replace("{SERVER_NAME}", server_name)
        if not rel_path or rel_path.startswith("/") or "\x00" in rel_path or any(part == ".." for part in rel_path.split("/")):
            _append_console_log(server.id, f"[MSM] Modliste: unsicherer Pfad abgelehnt: {rel_path}\n")
            continue
        file_targets.setdefault(rel_path, []).append(target)

    node = getattr(server, "node", None)
    is_remote = node is not None and not getattr(node, "is_local", False)

    client = None
    if is_remote:
        try:
            from services.node_client import NodeClient

            client = NodeClient.from_node(node)
        except Exception:
            _append_console_log(server.id, "[MSM] Modliste: NodeClient-Initialisierung fehlgeschlagen\n")
            return

    for rel_path, group in file_targets.items():
        current_content = ""
        install_real = ""
        if is_remote:
            try:
                current_content = client.files_read(server.id, rel_path)
            except Exception:
                current_content = ""
        else:
            try:
                install_real = os.path.realpath(install_dir)
                target_path = os.path.realpath(os.path.join(install_real, rel_path))
                rel = os.path.relpath(target_path, install_real)
                if rel.startswith("..") or os.path.isabs(rel):
                    _append_console_log(server.id, f"[MSM] Modliste: Pfad {rel_path} verlaesst install_dir — abgelehnt\n")
                    continue
                if os.path.isfile(target_path):
                    with open(target_path, "r", encoding="utf-8", errors="replace") as f:
                        current_content = f.read()
            except OSError as exc:
                _append_console_log(server.id, f"[MSM] Modliste: Fehler beim Lesen von {rel_path}: {exc}\n")
                continue

        content = current_content
        for target in group:
            raw_vals = target_values.get(target.key, target_values.get(target.file, target_values.get(None, [])))
            formatted_lines = []
            seen = set()
            for r in raw_vals:
                formatted = _format_target_line(str(r), target.entryTemplate)
                if formatted and formatted not in seen:
                    seen.add(formatted)
                    formatted_lines.append(formatted)

            if target.key:
                content = _set_flat_config_value(content, target.key, target.separator.join(formatted_lines))
            else:
                content = "".join(f"{line}\n" for line in formatted_lines)

        if is_remote:
            try:
                client.files_write(server.id, rel_path, content)
            except Exception:
                _append_console_log(server.id, f"[MSM] Modliste: Schreiben auf Node fehlgeschlagen ({rel_path})\n")
        else:
            try:
                target_path = os.path.realpath(os.path.join(install_real, rel_path))
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, "w", encoding="utf-8") as f:
                    f.write(content)
            except OSError as exc:
                _append_console_log(server.id, f"[MSM] Modliste: Schreiben fehlgeschlagen ({rel_path}): {exc}\n")


def write_workshop_modlist(
    server,
    relative_path: str,
    lines: list[str],
    *,
    config_key: str | None = None,
    separator: str = ";",
    entry_template: str | None = None,
) -> None:
    """Rückwärtskompatibler Wrapper; delegiert an write_workshop_modlist_targets."""
    if not relative_path or relative_path.startswith("/") or "\x00" in relative_path:
        _append_console_log(server.id, "[MSM] Modliste: unsicherer Pfad abgelehnt\n")
        return
    if any(part == ".." for part in relative_path.split("/")):
        _append_console_log(server.id, "[MSM] Modliste: Pfad enthaelt '..'\n")
        return

    if entry_template is None and (getattr(server, "game_type", "") or "").strip() == "conan_exiles_ue5":
        entry_template = "*{VALUE}"

    from blueprints.schema import BlueprintModListTarget

    target = BlueprintModListTarget(
        file=relative_path,
        key=config_key,
        valueSource="workshopIds",
        separator=separator,
        entryTemplate=entry_template,
    )
    target_values = {config_key: lines} if config_key else {None: lines}
    write_workshop_modlist_targets(server, [target], target_values)


# ── Plugin-Basis ───────────────────────────────────────────────────────────


class GamePlugin(ABC):
    """Basisklasse für Game-Plugins.

    Pflichtfelder:
      - game_id, game_name, supports_mods, supports_steam_workshop
      - docker_image: das Base-Image, in dem der Server läuft
      - container_needs_tmpfs: wenn True, wird /tmp als tmpfs hinzugefügt

    Pflichtmethoden:
      - build_container_command, build_container_env, build_port_publishes,
        get_config_schema, get_config_files, get_logs
    """

    game_id: str = ""
    game_name: str = ""
    supports_mods: bool = False
    # Phase 4 — Capability-Flag: kommt der Mod-Manager-Tab im Frontend zum
    # Einsatz? Wenn False, blendet die UI den Workshop-Browser aus und kann den
    # Mod-Manager-Tab ausblenden (Backend bleibt zusaetzlich Defensiv-Layer).
    supports_steam_workshop: bool = False

    # Docker-spezifisch — Pflicht für alle konkreten Plugins
    docker_image: str = ""
    container_needs_tmpfs: bool = True  # /tmp als tmpfs (read-only rootfs ist Default)
    container_read_only_rootfs: bool = False  # Game-Binaries schreiben oft in WorkingDir → False

    # ─ Setup / Lifecycle ─────────────────────────────────────────────────

    @abstractmethod
    def install(self, server) -> dict:
        """Installiert oder aktualisiert die Game-Binaries. Threading erlaubt."""
        ...

    def update(self, server) -> dict:
        """Standard-Update == frische Installation (SteamCMD validate macht es smart)."""
        return self.install(server)

    @abstractmethod
    def build_container_command(self, server) -> list[str]:
        """Args, mit denen der Server im Container gestartet wird (ohne Image)."""
        ...

    def build_container_env(self, server) -> dict[str, str]:
        """Default: keine zusätzlichen Env-Vars."""
        return {}

    def build_port_publishes(self, server) -> list[PortPublish]:
        """Welche Ports werden veröffentlicht? (game/query/rcon).

        Default-Implementierung: bindet game_port/query_port als UDP und
        rcon_port als TCP an ``server.public_bind_ip``. Diese darf NIE
        ``None`` oder ``0.0.0.0`` sein — sonst publiziert Docker auf allen
        Interfaces und hängt die UFW-Falle aus. Plugins, die andere Ports
        brauchen, können überschreiben — die Bind-IP-Pflicht bleibt aber
        bestehen.
        """
        return default_port_publishes(server)

    def build_volume_binds(self, server) -> list[VolumeBind]:
        """Default: nur install_dir → /data."""
        return default_volume_binds(server)

    def container_extra_networks(self, server) -> list[str]:
        """Optionale interne Netze fuer servergebundene Dienste."""
        try:
            from database import SessionLocal
            from services.postgres_service import server_extra_networks

            db = SessionLocal()
            try:
                return server_extra_networks(db, server.id)
            finally:
                db.close()
        except Exception:
            return []

    def container_workdir(self, server) -> str:
        return CONTAINER_DATA_DIR

    def container_uid_gid(self, server) -> tuple[int, int]:
        return docker_service.container_runtime_uid_gid()

    def container_tmpfs_paths(self, server) -> list[str]:
        return ["/tmp"] if self.container_needs_tmpfs else []

    def prepare_runtime(self, server) -> None:
        """Hook: vor jedem Container-Start aufgerufen.

        Plugins können hier game-spezifische Config-Files (INIs, .cfg, JSON)
        vorbereiten — z. B. Ports in `Engine.ini`/`Game.ini` schreiben,
        damit das Spiel die vom Port-Manager zugewiesenen Werte tatsächlich
        nutzt. CLI-Argumente reichen bei vielen UE-Spielen NICHT.

        Default ist no-op. Side-effects sind erlaubt (Dateischreiben in
        install_dir), aber bewusst KEIN Container-Code, kein Logging
        sensibler Werte und keine Network-Calls.
        """
        return None

    # ── Zentrale Updater-Hooks (KISS, Blueprint-getrieben) ───────────────────

    def prepare_for_updates(self, server) -> None:
        """
        Hook: wird vor Neustarts / Installs aufgerufen.

        Zentrale Stelle für passive oder vorbereitende Update-Checks
        (Workshop-Mods + Server-Dateien). Default ist No-Op.

        Wird vom neuen `games.updater` Modul bedient.
        Keine Netzwerk-Calls oder schwere Arbeit hier – nur Delegation.
        """
        return None

    def check_for_mod_updates(self, server) -> list[dict]:
        """
        Liefert Liste von Workshop-Mods, die installiert oder aktualisiert
        werden sollten (siehe games.updater.check_workshop_mod_updates).

        Wird nach Server-Neustart und im Background-Scheduler genutzt.
        """
        try:
            bp = self.get_blueprint()
            if bp is None:
                return []
            return updater.check_workshop_mod_updates(server, bp)
        except Exception as exc:  # pragma: no cover - defensiv
            logger.warning("Mod-Update-Check fehlgeschlagen für Server %s: %s", getattr(server, "id", "?"), exc)
            return []

    def check_for_server_file_update(self, server) -> dict:
        """
        Liefert passive Hinweise zu Server-Datei-Updates.
        Bei Steam (checkBased): buildid-Vergleich entscheidet, ob vor Start/Restart
        ``perform_server_file_update`` (SteamCMD) läuft.
        """
        try:
            bp = self.get_blueprint()
            if bp is None:
                return {"action": "none", "reason": "no_blueprint"}
            return updater.check_server_file_update(server, bp)
        except Exception as exc:  # pragma: no cover - defensiv
            logger.warning("Serverfile-Update-Check fehlgeschlagen für Server %s: %s", getattr(server, "id", "?"), exc)
            return {"action": "none", "reason": "error"}

    def perform_server_file_update(self, server) -> dict:
        """
        Führt ein Server-Datei-Update (Game-Binaries) **synchron** aus.

        Wird im Lifecycle vor Start/Restart ausgeführt. Steam-Blueprints laufen
        dabei immer durch SteamCMD-Validate; HTTP-Quellen bleiben checkbasiert.

        Garantiert:
        - Update läuft VOR plugin.start() (Container-Start)
        - cache_manual_configs wird vor dem Update aufgerufen
        - restore_manual_configs wird nach dem Update (oder Fehlerfall) aufgerufen
        - Blockiert den Aufrufer bis Abschluss (Caller muss to_thread nutzen!)

        Implementierung: Delegation an games.updater.apply_server_file_update
        (KISS: keine Duplizierung der Source-Logik, nutzt bestehende
        run_steamcmd_install + install_http_source).

        Native Plugins (DayZ, Conan) profitieren automatisch über get_blueprint().

        Sicherheit (AGENTS.md):
        - Diese Methode fängt Fehler intern ab (siehe apply_).
        - Lifecycle darf unter KEINEN Umständen durch Server-Datei-Update scheitern.
        - Keine Mod-Logik, kein Background, keine E-Mails.

        Rückgabe: {"ok": bool, ...} — siehe apply_server_file_update.
        """
        try:
            bp = self.get_blueprint()
            if bp is None:
                return {"ok": False, "error": "no_blueprint"}
            # Delegation (Lazy nicht nötig, da "updater" bereits auf Modulebene importiert ist)
            return updater.apply_server_file_update(server, bp)
        except Exception as exc:  # pragma: no cover - defensiv, Restart-Sicherheit
            logger.warning("perform_server_file_update fehlgeschlagen für Server %s: %s", getattr(server, "id", "?"), exc)
            # Niemals Exception nach oben werfen — Restart muss weiterlaufen
            return {"ok": False, "error": str(exc)}

    def _filter_auto_update_mods(self, server_id: int, needed: list[dict]) -> list[dict]:
        """Filtert Mod-Update-Tasks auf Mods mit aktiviertem auto_update."""
        from database import SessionLocal
        from models import Mod

        db = SessionLocal()
        try:
            auto_update_ids = {
                str(row.workshop_id)
                for row in db.query(Mod.workshop_id)
                .filter(
                    Mod.server_id == server_id,
                    Mod.enabled == True,  # noqa: E712
                    Mod.auto_update == True,  # noqa: E712
                )
                .all()
            }
        finally:
            db.close()
        return [u for u in needed if str(u.get("workshop_id", "")) in auto_update_ids]

    def _run_workshop_mod_installer(self, server, by_id: dict[str, dict]) -> dict:
        """Ruft `install_mods` als Batch auf oder fällt auf Einzel-Installation zurück."""
        installer = getattr(self, "install_mods", None)
        if callable(installer):
            batch_res = installer(server, list(by_id.keys()))
            return batch_res.get("items", {}) if isinstance(batch_res, dict) else {}

        items: dict[str, dict] = {}
        for wid in by_id:
            single = self.install_mod(server, wid)
            if isinstance(single, dict) and ("error" in single or single.get("ok") is False):
                items[wid] = {"ok": False, "error": single.get("error", "unbekannter Fehler")}
            else:
                items[wid] = {"ok": True}
        return items

    def _apply_workshop_mod_results(
        self,
        server_id: int,
        by_id: dict[str, dict],
        items: dict,
        mark_mod_installed,
        mark_mod_failed,
    ) -> tuple[int, list[str]]:
        """Schreibt Erfolg/Fehler der Workshop-Mod-Updates in DB und Konsolenlog."""
        applied = 0
        errors: list[str] = []
        for wid, u in by_id.items():
            item = items.get(wid, {}) if isinstance(items, dict) else {}
            if item.get("ok"):
                updater.update_mod_metadata_after_success(server_id, wid, u.get("remote_updated"))
                mark_mod_installed(server_id, wid)
                applied += 1
                _append_console_log(server_id, f"[MSM] Mod {wid}: installed\n")
            else:
                err = str(item.get("error") or "Workshop-Download fehlgeschlagen")
                errors.append(f"{wid}: {err}")
                mark_mod_failed(server_id, wid, err)
                _append_console_log(server_id, f"[MSM] Mod {wid}: failed - {err}\n")
        return applied, errors

    def perform_workshop_mod_updates(self, server, *, only_auto_update: bool = False) -> dict:
        """
        Führt erkannte Workshop-Mod-Updates und -Neuinstallationen **synchron** aus.

        Aufruf: aus dem Lifecycle vor Start/Restart, nachdem check_for_mod_updates()
        Handlungsbedarf gemeldet hat.

        Verwendete bestehende Funktionen (genau wie gefordert):
        - self.install_mods(server, workshop_ids): Game-spezifischer Einstieg.
          Ruft intern run_steamcmd_workshop_download_batch auf, um einen
          gebündelten SteamCMD-Workshop-Download durchzuführen.
        - updater.update_mod_metadata_after_success(...): Setzt nach Erfolg
          korrekt Mod.last_updated (remote time_updated) + Mod.installed_version.

        Ablauf pro Mod:
        1. Console-Log (Transparenz).
        2. install_mods aufrufen (blockierend, kann lange dauern).
        3. Bei Erfolg (kein "error" im Result): Metadaten-Update in DB.
        4. Am Ende: update_modlist(server) für Blueprints mit FILE-Injection.

        KISS + AGENTS.md:
        - Keine neuen Abstraktionen, keine Pipelines, keine Manager-Klassen.
        - Symmetrisch zu perform_server_file_update.
        - Fehler werden nur geloggt + in Console; der Restart/Start läuft IMMER weiter
          (sicheres Verhalten, keine harten Abhängigkeiten).
        - Nur aktive Mods (enabled=True) werden betrachtet (Check filtert).
        - Blockierend → Caller (Router) muss asyncio.to_thread verwenden.
        - Deutsche Kommentare, minimale Code-Änderung.

        Rückgabe: {"ok": bool, "applied": int, "errors": list, "message": str}
        """
        try:
            bp = self.get_blueprint()
            if bp is None:
                return {"ok": False, "error": "no_blueprint"}

            needed = self.check_for_mod_updates(server)
            if only_auto_update and needed:
                needed = self._filter_auto_update_mods(server.id, needed)
            if not needed:
                return {"ok": True, "applied": 0, "message": "keine Workshop-Mod-Updates nötig"}

            from services.mod_install_status_service import (
                mark_mod_failed,
                mark_mod_installed,
                mark_mod_installing,
                mark_mod_pending,
            )

            for u in needed:
                mark_mod_pending(server.id, u.get("workshop_id", ""), u.get("action", "update"))

            _append_console_log(
                server.id,
                f"[MSM] Installing/updating {len(needed)} missing/outdated mod(s) in one SteamCMD batch...\n"
            )

            by_id = {str(u.get("workshop_id", "")): u for u in needed if str(u.get("workshop_id", ""))}
            for wid, u in by_id.items():
                mark_mod_installing(server.id, wid, u.get("action", "update"))
                _append_console_log(server.id, f"[MSM] Mod {wid}: queued ({u.get('action', 'update')})\n")

            try:
                items = self._run_workshop_mod_installer(server, by_id)
            except Exception as exc:  # pragma: no cover - defensiv
                items = {wid: {"ok": False, "error": str(exc)} for wid in by_id}

            applied, errors = self._apply_workshop_mod_results(
                server.id,
                by_id,
                items,
                mark_mod_installed,
                mark_mod_failed,
            )

            try:
                self.update_modlist(server)
            except Exception as exc:
                _append_console_log(
                    server.id,
                    f"[MSM] update_modlist nach Workshop-Mod-Updates fehlgeschlagen (nicht kritisch): {exc}\n",
                )

            ok = len(errors) == 0
            summary = f"{applied} Workshop-Mod(s) erfolgreich installiert/aktualisiert"
            if errors:
                summary += f" ({len(errors)} Fehler)"
            _append_console_log(
                server.id, f"[MSM] Workshop-Mod-Updates abgeschlossen: {summary}.\n"
            )

            return {
                "ok": ok,
                "applied": applied,
                "errors": errors,
                "message": summary,
            }
        except Exception as exc:  # pragma: no cover - Restart/Start-Sicherheit (AGENTS.md)
            logger.warning(
                "perform_workshop_mod_updates fehlgeschlagen für Server %s: %s",
                getattr(server, "id", "?"),
                exc,
            )
            sid = getattr(server, "id", 0)
            _append_console_log(
                sid,
                f"[MSM] Workshop-Mod-Update fehlgeschlagen — Restart/Start wird trotzdem fortgesetzt: {exc}\n",
            )
            return {"ok": False, "error": str(exc), "applied": 0}

    # ─ Default Lifecycle (Docker) ────────────────────────────────────────

    def _runtime_node(self, server):
        """Node ORM object for multi-node routing (None = local docker_service)."""
        return getattr(server, "node", None)

    def start(self, server) -> dict:
        """Standard-Start: Container mit aktuellen Limits/Ports neu hochziehen."""
        if not self.docker_image:
            return {"error": "Plugin hat kein docker_image konfiguriert"}
        node = self._runtime_node(server)
        # Remote node: agent must be used; local without node: panel docker
        if node is None and not docker_service.is_available():
            return {"error": "Docker ist auf diesem Host nicht verfügbar"}

        # Pflicht-Bind-IP früh validieren — sonst riskieren wir 0.0.0.0.
        try:
            port_publishes = self.build_port_publishes(server)
        except RuntimeError as e:
            _append_console_log(server.id, f"[MSM] Start abgelehnt: {e}\n")
            return {"error": str(e)}

        uid, gid = self.container_uid_gid(server)
        run_user = f"{uid}:{gid}"
        name = container_name_for(server.id)
        volume_binds = self.build_volume_binds(server)

        def _do_permission_repair():
            if node is None or getattr(node, "is_local", False):
                for volume in volume_binds:
                    if volume.read_only:
                        continue
                    repair = docker_service.repair_bind_mount_permissions(
                        volume.host_path,
                        container_path=volume.container_path,
                        owner_uid_gid=(uid, gid),
                    )
                    if not repair.get("ok"):
                        err = repair.get("error") or "Berechtigungen konnten nicht vorbereitet werden"
                        _append_console_log(
                            server.id,
                            f"[MSM] Permission-Repair Hinweis (Start wird fortgesetzt): {err}\n",
                        )

        # Rechte VOR prepare_runtime normalisieren (falls fremd-eigene Dateien existieren)
        _do_permission_repair()

        # Game-spezifische Config-Files / ensureDirs vor dem Start aktualisieren
        try:
            self.prepare_runtime(server)
        except Exception as e:
            _append_console_log(
                server.id, f"[MSM] prepare_runtime fehlgeschlagen: {e}\n"
            )
            return {"error": str(e)}

        # Die Werte, die dieser eine Server dauerhaft haben soll — **nach**
        # prepare_runtime, damit ein Serverwunsch einen Blueprint-Patch
        # ueberschreiben kann und nicht umgekehrt.
        #
        # Der Anlass ist gemessen (Server 107, 15.–19.08.2026): ein
        # ausgefuehrter Konfigurationsvorschlag stand vier Tage spaeter nicht
        # mehr in der Datei, weil der laufende Spielprozess sie beim Autosave
        # vollstaendig neu geschrieben hatte. Seitdem merkt sich der Server den
        # Wunsch statt nur das Ergebnis, und diese Zeile ist die Stelle, an der
        # daraus eine Zusage wird.
        #
        # Bewusst ohne try/except: die Funktion faengt selbst und meldet in die
        # Konsole. Ein Zusatzwunsch darf keinen Serverstart verhindern.
        server_config_wishes.wuensche_durchsetzen(server)

        # Rechte NACH prepare_runtime erneut normalisieren, damit neu erstellte
        # Ordner (ensureDirs wie logs/, UserData/) und Seed-Dateien die Rechte
        # des Container-Users (uid:gid) erhalten.
        _do_permission_repair()

        result = docker_service.run_container(
            name=name,
            image=self.docker_image,
            command=self.build_container_command(server),
            env=self.build_container_env(server),
            ports=port_publishes,
            volumes=volume_binds,
            cpu_limit_percent=server.cpu_limit_percent,
            ram_limit_mb=server.ram_limit_mb,
            user=run_user,
            workdir=self.container_workdir(server),
            read_only_rootfs=self.container_read_only_rootfs,
            tmpfs_paths=self.container_tmpfs_paths(server),
            extra_networks=self.container_extra_networks(server),
            startup_check_seconds=getattr(getattr(self.get_blueprint(), "runtime", None), "startupCheckSeconds", None) or 2.0,
            allow_unprivileged_user_namespaces=bool(
                getattr(
                    getattr(self.get_blueprint(), "runtime", None),
                    "allowUnprivilegedUserNamespaces",
                    False,
                )
            ),
            server_id=server.id,  # enables pull progress in console
            node=node,
        )
        if not result["ok"]:
            _append_console_log(server.id, f"[MSM] Container-Start fehlgeschlagen: {result['error']}\n")
            return {"error": result["error"]}

        _append_console_log(server.id, f"[MSM] Container {name} gestartet\n")

        return {"message": "Server gestartet", "container": name}

    def stop(self, server) -> dict:
        """Standard-Stop: Container graceful stoppen.

        Grace-Period kommt aus dem Blueprint (``runtime.stopGracePeriodSeconds``,
        Default 30s). Server mit persistenter Welt brauchen oft mehr Zeit
        fuer Save- oder Snapshot-Workflows. Ein zu kurzer Timeout fuehrt
        zu SIGKILL und potenziellem Datenverlust.
        """
        name = container_name_for(server.id)
        timeout = self.stop_grace_period_seconds(server)
        result = docker_service.stop(name, timeout=timeout, node=self._runtime_node(server))
        if not result["ok"]:
            return {"error": result["error"]}
        _append_console_log(server.id, f"[MSM] Container {name} gestoppt\n")
        return {"message": "Server gestoppt", "container": name}

    def stop_grace_period_seconds(self, server) -> int:
        """Blueprint-gesteuerter Grace-Period fuer Container-Stop.

        Default 30s, ueberschreibbar pro Blueprint via
        ``runtime.stopGracePeriodSeconds`` (5..600s). Plugins ohne Blueprint
        nutzen den Default.
        """
        bp = self.get_blueprint()
        if bp and bp.runtime and getattr(bp.runtime, "stopGracePeriodSeconds", None):
            return int(bp.runtime.stopGracePeriodSeconds)
        return 30

    def get_status(self, server) -> ServerStatus:
        """Liefert Live-Status aus Docker (Container-State + CPU/RAM via stats)."""
        name = container_name_for(server.id)
        node = self._runtime_node(server)
        state = docker_service.inspect_state(name, node=node)
        if state is None:
            return ServerStatus(status="stopped")

        is_running = state["status"] == "running"
        if not is_running:
            live_stats = None
        elif "cpu_percent" in state:
            # Node-Zweig: der Agent hat CPU und RAM zusammen mit dem Zustand
            # geliefert. Ein zweiter Aufruf wäre dieselbe Anfrage noch einmal.
            live_stats = state
        else:
            live_stats = docker_service.stats(name, node=node)
        started_at = _parse_docker_started_at(state.get("started_at")) if is_running else None
        uptime_seconds = None
        if started_at is not None:
            uptime_seconds = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds()))

        msg = None
        if state.get("oom_killed"):
            msg = "Container wurde wegen RAM-Limit beendet (OOM)"

        return ServerStatus(
            status=_map_container_status(state["status"]),
            cpu_percent=(live_stats or {}).get("cpu_percent"),
            ram_mb=(live_stats or {}).get("ram_mb"),
            disk_mb=None,  # Disk wird zentral im Scheduler-Job ermittelt
            uptime_seconds=uptime_seconds,
            started_at=started_at,
            message=msg,
        )

    # ─ Logs ──────────────────────────────────────────────────────────────

    @abstractmethod
    def get_logs(self, server, lines: int = 100) -> str:
        """Liest die game-spezifischen Logs (z. B. UE-/DayZ-Logfile im install_dir)."""
        ...

    # ─ Config ────────────────────────────────────────────────────────────

    @abstractmethod
    def get_config_schema(self) -> list[ConfigField]:
        ...

    @abstractmethod
    def get_config_files(self) -> list[dict]:
        ...

    # ─ Mods ──────────────────────────────────────────────────────────────

    def install_mod(self, server, workshop_id: str) -> dict:
        """Default: Plugins ohne Mod-Support liefern einen Fehler."""
        if not self.supports_mods:
            return {"error": "Mod-Installation nicht unterstützt"}
        return {"error": "Mod-Installation nicht implementiert"}

    def cleanup_mod(self, server, workshop_id: str) -> dict:
        """Entfernt game-spezifische Mod-Artefakte.

        Default ist no-op, weil nur Blueprint-Plugins wissen, welche
        Workshop-Dateien/Symlinks/Kopien sie angelegt haben.
        """
        return {"ok": True, "removed": []}

    def get_mod_support(self) -> dict | None:
        if self.supports_mods:
            return {"workshop_id": None, "dependency_resolution": False, "required_tags": []}
        return None

    # ─ Blueprint-Hook ────────────────────────────────────────────────────

    def get_blueprint(self) -> Blueprint | None:
        """Liefert die Blueprint, aus der dieses Plugin seine Metadaten zieht.

        Native Plugins ueberschreiben dies und laden ihre
        ``backend/blueprints/native/<id>.blueprint.json``. Plugins ohne
        Blueprint (z. B. rein generischer ``BlueprintPlugin``-Wrapper laesst
        ``self._blueprint`` setzen) muessen dies konsistent ausliefern.
        """
        return None

    def format_modlist_lines(self, server, mods: list) -> list[str]:
        """Wandelt aktive Mod-Rows in eine Liste von Zeilen fuer ``modlist.txt``.

        Default: eine Workshop-ID pro Zeile. Plugins mit game-spezifischem
        Datei-Format (z. B. Conan, das pak-Dateinamen erwartet) ueberschreiben.
        """
        return [m.workshop_id for m in mods]

    def update_modlist(self, server) -> None:
        """Schreibt die Workshop-Modliste, falls die Blueprint ``file``-Injection nutzt.

        Sicherheits-Invariante: Der finale Pfad muss innerhalb des
        ``install_dir`` des Servers liegen. Symlink-Escape per ``realpath``
        ausgeschlossen.
        """
        blueprint = self.get_blueprint()
        if blueprint is None:
            return
        bp_mods = blueprint.effective_mods()
        if not bp_mods.supportsSteamWorkshop:
            return
        if bp_mods.modInjection != BlueprintModInjection.FILE:
            return

        targets = bp_mods.effective_mod_list_targets()
        if not targets:
            return

        active_mods = _query_active_mods(server.id)
        active_mods.sort(key=lambda m: (m.load_order if m.load_order is not None else 0, m.id if m.id is not None else 0))

        target_values: dict[Any, list[str]] = {}
        for target in targets:
            lookup_key = target.key if target.key is not None else target.file
            if target.valueSource == "workshopIds":
                target_values[lookup_key] = [str(m.workshop_id) for m in active_mods if m.workshop_id]
            elif target.valueSource == "postInstallTargetBasenames":
                target_values[lookup_key] = self.format_modlist_lines(server, active_mods)
            elif target.valueSource.startswith("resolvedIds:"):
                resolver_name = target.valueSource.split(":", 1)[1]
                resolver = next((r for r in bp_mods.modIdResolvers if r.name == resolver_name), None)
                collected_ids: list[str] = []
                for mod in active_mods:
                    raw_json = getattr(mod, "resolved_ids_json", None)
                    if raw_json is None and resolver is not None:
                        from games.blueprint_plugin import _resolve_mod_ids

                        res_ids, err = _resolve_mod_ids(
                            server,
                            workshop_app_id=bp_mods.workshopAppId or "",
                            workshop_id=str(mod.workshop_id),
                            resolver=resolver,
                        )
                        try:
                            from database import SessionLocal
                            from models.mod import Mod
                            import json
                            from datetime import datetime, timezone

                            db = SessionLocal()
                            try:
                                db_mod = db.query(Mod).filter(Mod.id == mod.id).first()
                                if db_mod:
                                    db_mod.resolved_ids_json = json.dumps(res_ids)
                                    db_mod.resolved_at = datetime.now(timezone.utc)
                                    db_mod.resolve_error = err
                                    db.commit()
                            finally:
                                db.close()
                        except Exception:
                            pass
                        collected_ids.extend(res_ids)
                    elif raw_json:
                        try:
                            import json

                            parsed = json.loads(raw_json)
                            if isinstance(parsed, list):
                                collected_ids.extend(str(x) for x in parsed)
                        except Exception:
                            pass
                target_values[lookup_key] = collected_ids

        write_workshop_modlist_targets(server, targets, target_values)
