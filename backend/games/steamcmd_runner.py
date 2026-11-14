"""Ephemere SteamCMD-Ausführung für Server-Installation, Updates und Workshop-Batches."""

import logging
import os
import re
import shlex
import shutil
import time
from pathlib import Path
from typing import Any

from services.docker_service import VolumeBind

logger = logging.getLogger(__name__)

# Dedicated image for MSM's internal SteamCMD install/update/workshop steps.
# It must have the steamcmd binary pre-installed at a known path (see STEAMCMD_BIN).
# We use cm2network/steamcmd:root because it reliably contains /home/steam/steamcmd/steamcmd.sh
# and supports running as root for the chown step.
# Blueprints define their own runtime.image for the long-running game container (can be parkervcp etc.).
# The install tool image is intentionally a fixed, known-good one (not taken from blueprint).
STEAMCMD_IMAGE = "cm2network/steamcmd:root"
# Pfad des steamcmd-Wrappers im Image. Wird in den bash-Aufruf eingesetzt.
STEAMCMD_BIN = "/home/steam/steamcmd/steamcmd.sh"
# Caps, die wir nach `--cap-drop=ALL` für den SteamCMD-Lauf wieder brauchen:
# - DAC_OVERRIDE: /home/steam (mode 700, steam-User-only) traversieren
# - DAC_READ_SEARCH: idem, für Read-Operationen ohne Owner-Match
# - CHOWN + FOWNER: am Ende `chown -R uid:gid /data`
STEAMCMD_CAPS = ["DAC_OVERRIDE", "DAC_READ_SEARCH", "CHOWN", "FOWNER"]

_BAD_MANIFEST_MARKERS = ("550", "0x226", "0x206", "0x2", "Timed out waiting")


def _build_steamcmd_bash_command(steam_args: list[str], chown_uid: int, chown_gid: int) -> list[str]:
    """Verpackt SteamCMD-Args in ein `bash -c`-Kommando, das nach Abschluss /data
    auf die Host-UID umownt.

    Hintergrund: Das `:root`-Image hat `/home/steam` mit Mode 750 (steam-User-
    only). Wir müssen SteamCMD als root im Container laufen lassen, sonst
    schlägt schon das `stat`/`exec` auf den Wrapper mit `permission denied`
    fehl. Container-Root ist durch `--cap-drop=ALL --security-opt=no-new-
    privileges` und einen Bind-Mount-only-Schreibpfad genügend abgeschottet.
    Nach dem Lauf chown'en wir /data zurück auf die msm-Host-UID, damit das
    Panel als unprivilegierter User weiterarbeiten kann.

    Zusätzlich: Vor dem SteamCMD-Lauf werden stale downloading/ und temp/
    Reste für alle Apps im Server-Ordner entfernt. Das verhindert "state is
    0x202/0x226 after update job" durch Dateiblockaden von vorherigen
    fehlgeschlagenen Jobs (häufig bei SCUM und anderen großen Windows-Servern
    via Wine/Proton).
    """
    from games import base as _base

    data_dir = _base.CONTAINER_DATA_DIR
    quoted = " ".join(shlex.quote(a) for a in steam_args)
    # KISS-Cleanup: stale Steam partials sind immer nur von fehlgeschlagenen
    # vorherigen Jobs. Löschen ist sicher (keine Nutzerdaten) und löst
    # den häufigsten Grund für 0x2xx State-Fehler nach App-Update.
    cleanup = (
        f"rm -rf {shlex.quote(data_dir)}/steamapps/downloading/* "
        f"{shlex.quote(data_dir)}/steamapps/temp/* 2>/dev/null || true; "
    )
    script = (
        cleanup +
        f"{shlex.quote(STEAMCMD_BIN)} {quoted}; "
        "rc=$?; "
        f"chown -R {int(chown_uid)}:{int(chown_gid)} {shlex.quote(data_dir)} 2>/dev/null || true; "
        f"chmod -R a+rwx {shlex.quote(data_dir)} 2>/dev/null || true; "
        "exit $rc"
    )
    return ["-c", script]


def _redact(text: str, secrets_to_redact: list[str]) -> str:
    for s in secrets_to_redact:
        if s:
            text = text.replace(s, "***")
    return text


def classify_steamcmd_failure(output: str, fallback_error: str = "") -> dict[str, str] | None:
    """Map known SteamCMD failure markers to safe structured errors.

    The message intentionally names causes as possible and ``nicht verifiziert``:
    SteamCMD output alone does not prove whether disk, quota, permissions,
    platform metadata, or concurrent access was the root cause.
    """
    text = f"{output}\n{fallback_error}".lower()
    if "0x202" in text or "0x226" in text:
        state = "0x202" if "0x202" in text else "0x226"
        return {
            "error_code": f"steamcmd_update_state_{state}",
            "error": (
                f"SteamCMD meldet App-State {state} nach dem Update-Job. "
                "Mögliche Ursachen (nicht verifiziert): Dateiblockaden (z. B. laufender "
                "Server-Prozess hält Dateien offen), Berechtigungsprobleme (z. B. nach "
                "abgebrochenem vorherigem Job), unvollständige/partial Downloads "
                "(Reste in steamapps/downloading/ oder temp/), Plattenplatz/Quota oder "
                "paralleler Zugriff auf Install-/Cache-Daten. "
                "MSM führt automatisch Cleanup der stale downloading/temp-Ordner vor "
                "jedem +app_update durch (siehe _build_steamcmd_bash_command)."
            ),
        }
    if "missing configuration" in text:
        return {
            "error_code": "steamcmd_missing_configuration",
            "error": (
                "SteamCMD meldet auch nach Metadaten-Aktualisierung und einmaligem "
                "Retry weiterhin Missing Configuration. Bei loginpflichtigen Spielen "
                "kann ein fehlender Steam-Account oder App-Zugriff die Ursache sein. "
                "Weitere mögliche Ursachen (nicht verifiziert): vorübergehend "
                "unvollständige Steam-App-Metadaten, eine falsche Plattform oder eine "
                "serverseitige Steam-Störung."
            ),
        }
    return None


def _bounded_log_buffer_append(buffer: list[str], line: str, *, max_chars: int = 20000) -> None:
    buffer.append(line)
    total = sum(len(part) for part in buffer)
    while buffer and total > max_chars:
        total -= len(buffer.pop(0))


def _resolve_steam_login(server_id: int) -> tuple[str, str] | None:
    """Liefert Benutzername und Passwort fuer den SteamCMD-Login dieses Servers.

    Zuerst ein diesem Server zugewiesenes Benutzer-Credential, sonst der
    panelweite Account. Faellt beides aus, gibt es bewusst keinen stillen
    Rueckfall — der Aufrufer meldet das als verstaendlichen Fehler.

    Eigene, kurzlebige Session: der Aufruf kommt aus einem Installations-Thread,
    der keine Request-Session besitzt.
    """
    from database import SessionLocal
    from models import KIND_STEAM_ACCOUNT
    from services.credential_service import resolve_for_server

    db = SessionLocal()
    try:
        resolved = resolve_for_server(db, server_id, KIND_STEAM_ACCOUNT)
    finally:
        db.close()
    if resolved is None or not resolved.username:
        return None
    return resolved.username, resolved.secret


def _is_corrupt_steam_manifest(manifest_text: str) -> bool:
    """Erkennt typische 0x2xx-/Timeout-Fehlerzustände in einer appmanifest_*.acf."""
    if any(marker in manifest_text for marker in _BAD_MANIFEST_MARKERS):
        return True
    return "UpdateResult" in manifest_text and ("43" in manifest_text or "8" in manifest_text)


def _preflight_clean_bad_manifest(
    server_id: int,
    install_dir: str,
    app_id: str,
    node: Any | None,
) -> None:
    """Sichert und entfernt defekte Steam-Manifeste vor einem Install/Update-Lauf."""
    from games import base as _base

    try:
        from services.node_client import NodeClient, NodeClientError

        if node is not None:
            client = NodeClient.from_node(node)
            manifest_rel = f"steamapps/appmanifest_{app_id}.acf"
            try:
                mt = client.files_read(server_id, manifest_rel)
                if _is_corrupt_steam_manifest(mt):
                    bak_rel = f"{manifest_rel}.bad-state.{int(time.time())}"
                    client.files_write(server_id, bak_rel, mt)
                    client.files_delete(server_id, manifest_rel)
                    _base._append_console_log(
                        server_id,
                        f"[MSM] Bad Steam manifest detected (0x2xx / timeout state) on agent - backed up to {bak_rel} and removed\n",
                    )
            except NodeClientError as exc:
                if exc.status_code != 404:
                    logger.warning("Fehler beim pre-flight manifest check auf remote agent: %s", exc.message)
            except Exception as exc:
                logger.warning("Fehler beim pre-flight manifest check auf remote agent: %s", exc)
        else:
            man = os.path.join(install_dir, "steamapps", f"appmanifest_{app_id}.acf")
            if os.path.exists(man):
                with open(man) as mf:
                    mt = mf.read()
                if _is_corrupt_steam_manifest(mt):
                    bak = man + ".bad-state." + str(int(time.time()))
                    shutil.copy2(man, bak)
                    os.unlink(man)
                    _base._append_console_log(
                        server_id,
                        f"[MSM] Bad Steam manifest detected (0x2xx / timeout state) - backed up and removed: {bak}\n",
                    )
    except Exception:
        pass  # non-fatal


def _resolve_steamcmd_login_args(
    server_id: int,
    use_authenticated_login: bool,
    missing_login_error: str,
) -> tuple[list[str], list[str], dict | None]:
    """Bereitet SteamCMD-Login-Argumente und Secret-Redaction vor."""
    from games import base as _base

    if not use_authenticated_login:
        return ["+login", "anonymous"], [], None

    login = _base._resolve_steam_login(server_id)
    if login is None:
        _base._append_console_log(server_id, f"[MSM] {missing_login_error}\n")
        return [], [], {"ok": False, "error": missing_login_error}
    username, password = login
    return ["+login", username, password], [username, password], None


def _build_steamcmd_install_args(
    app_id: str,
    login_args: list[str],
    *,
    platform: str | None,
    validate: bool,
    beta_branch: str | None,
    extra_args: list[str] | None,
) -> list[str]:
    """Erstellt die SteamCMD-Kommandozeilenargumente für App-Installation/Update."""
    from games import base as _base

    steam_args: list[str] = []
    if platform:
        steam_args.extend(["+@sSteamCmdForcePlatformType", platform])
    steam_args.extend([
        "+force_install_dir", _base.CONTAINER_DATA_DIR,
        *login_args,
        "+app_update", app_id,
    ])
    branch = (beta_branch or "").strip() or None
    if branch and branch != "public":
        steam_args.extend(["-beta", branch])
    if validate:
        steam_args.append("validate")
    if extra_args:
        steam_args.extend(extra_args)
    steam_args.append("+quit")
    return steam_args


def _resolve_install_chown_ids(install_dir: str, node: Any | None) -> tuple[int, int]:
    """Leitet die Chown-UID/GID vom Host-Installationsverzeichnis oder Docker-Runtime ab."""
    from games import base as _base

    try:
        if node is not None:
            raise FileNotFoundError
        st = os.stat(install_dir)
        return st.st_uid, st.st_gid
    except Exception:
        return _base.docker_service.container_runtime_uid_gid()


def _finalize_steamcmd_failure_log(
    server_id: int,
    result: dict,
    live_output: list[str],
    out: str,
    failure_prefix: str,
) -> dict:
    """Klassifiziert fehlgeschlagene SteamCMD-Läufe und schreibt Diagnose ins Konsolenlog."""
    from games import base as _base

    classified = classify_steamcmd_failure(
        "".join(live_output) + out,
        str(result.get("error") or ""),
    )
    if classified:
        result = {**result, **classified}
        _base._append_console_log(server_id, f"\n[MSM] SteamCMD Diagnose: {classified['error']}\n")
    _base._append_console_log(server_id, f"\n[MSM] {failure_prefix}: {result['error']}\n")
    return result


def _force_clean_manifest_after_0x2xx(
    server_id: int,
    install_dir: str,
    app_id: str,
    result: dict,
    live_output: list[str],
    node: Any | None,
) -> None:
    """Schreibt nach 0x2xx-/Timeout-Abbruch ein sauberes StateFlags=4-Manifest für Best-Effort-Starts."""
    from games import base as _base

    try:
        combined_err = str(result.get("error", "")) + "".join(live_output)
        if not (
            "0x2" in combined_err
            or "0x226" in combined_err
            or "0x206" in combined_err
            or "Timed out" in combined_err
            or "exit 8" in combined_err
        ):
            return

        clean = (
            '"AppState"\n{\n\t"appid"\t\t"'
            + app_id
            + '"\n\t"StateFlags"\t\t"4"\n\t"UpdateResult"\t\t"0"\n\t"BytesToDownload"\t\t"0"\n\t"BytesToStage"\t\t"0"\n}\n'
        )
        if node is not None:
            from services.node_client import NodeClient

            client = NodeClient.from_node(node)
            manifest_rel = f"steamapps/appmanifest_{app_id}.acf"
            try:
                mt = client.files_read(server_id, manifest_rel)
                bak_rel = f"{manifest_rel}.post-fail.{int(time.time())}"
                client.files_write(server_id, bak_rel, mt)
            except Exception:
                pass
            client.files_write(server_id, manifest_rel, clean)
            _base._append_console_log(
                server_id,
                "[MSM] Forced clean manifest (State 4) after 0x2xx failure on agent — best effort start can proceed\n",
            )
            return

        manp = os.path.join(install_dir, "steamapps", f"appmanifest_{app_id}.acf")
        if os.path.exists(manp):
            bak = manp + ".post-fail." + str(int(time.time()))
            shutil.copy2(manp, bak)
        with open(manp, "w") as mf:
            mf.write(clean)
        _base._append_console_log(
            server_id,
            "[MSM] Forced clean manifest (State 4) after 0x2xx failure — best effort start can proceed\n",
        )
        try:
            uid, gid = _base.docker_service.container_runtime_uid_gid()
            os.chown(manp, uid, gid)
        except Exception:
            pass
    except Exception:
        pass


def run_steamcmd_install(
    *,
    server_id: int,
    install_dir: str,
    app_id: str,
    extra_args: list[str] | None = None,
    use_authenticated_login: bool = False,
    platform: str | None = None,
    steamcmd_image: str | None = None,
    validate: bool = True,
    beta_branch: str | None = None,
    node: Any | None = None,
) -> dict:
    """Lädt/aktualisiert eine Steam-App in `install_dir` via ephemerem
    SteamCMD-Container. Blockiert bis SteamCMD fertig ist.

    Schreibt strukturiertes Console-Log und gibt strukturiertes dict zurück.
    """
    from games import base as _base

    if node is None:
        os.makedirs(install_dir, exist_ok=True)

    # 0x226/0x202 auto-recovery (generic for all Steam Blueprint servers):
    # If previous update left a bad manifest (StateFlags 550 etc.), delete it (with backup).
    # SteamCMD will recreate a clean one during validate without touching player data.
    _preflight_clean_bad_manifest(server_id, install_dir, app_id, node)

    missing_login_error = (
        "Dieses Spiel benötigt einen Steam-Account-Login. Bitte im Server "
        "unter Zugangsdaten ein eigenes Steam-Konto hinterlegen oder unter "
        "Einstellungen → Steam Account einen panelweiten Account setzen "
        "(Steam Guard muss deaktiviert sein)."
    )
    login_args, secrets_to_redact, login_err = _resolve_steamcmd_login_args(
        server_id,
        use_authenticated_login,
        missing_login_error,
    )
    if login_err is not None:
        return login_err

    steam_args = _build_steamcmd_install_args(
        app_id,
        login_args,
        platform=platform,
        validate=validate,
        beta_branch=beta_branch,
        extra_args=extra_args,
    )

    _base._append_console_log(server_id, f"[MSM] SteamCMD startet für App {app_id} (Docker)\n")

    # Derive chown target from the actual host directory owner for rootless Docker compatibility.
    chown_uid, chown_gid = _resolve_install_chown_ids(install_dir, node)
    live_output: list[str] = []

    def _live_log(line: str) -> None:
        """Callback für Live-Streaming: redact Secrets, dann in Console-Log schreiben."""
        safe_line = _redact(line, secrets_to_redact)
        _bounded_log_buffer_append(live_output, safe_line)
        _base._append_console_log(server_id, safe_line)

    image = steamcmd_image or STEAMCMD_IMAGE
    data_dir = _base.CONTAINER_DATA_DIR

    def _run(args: list[str]) -> dict:
        return _base.docker_service.run_ephemeral(
            image=image,
            command=_build_steamcmd_bash_command(args, chown_uid, chown_gid),
            volumes=[VolumeBind(install_dir, data_dir, read_only=False)],
            user="0:0",
            cap_adds=STEAMCMD_CAPS,
            entrypoint="bash",
            env={"HOME": data_dir},
            timeout=3600,
            log_callback=_live_log,
            node=node,
        )

    result = _run(steam_args)
    first_out = (result.get("stdout") or "") + (result.get("stderr") or "")
    first_error = str(result.get("error") or "")
    if not result.get("ok", False) and "missing configuration" in (
        "".join(live_output) + first_out + first_error
    ).lower():
        _base._append_console_log(
            server_id,
            "\n[MSM] SteamCMD Missing Configuration — App-Metadaten werden "
            "aktualisiert; genau ein automatischer Retry folgt.\n",
        )
        refresh_args = list(steam_args)
        app_update_index = refresh_args.index("+app_update")
        refresh_args[app_update_index:app_update_index] = ["+app_info_update", "1"]
        live_output.clear()
        result = _run(refresh_args)

    # Bei Live-Streaming ist out leer (wurde bereits live geschrieben).
    # Fallback für den Fall, dass der Stream unterbrochen wurde.
    out = (result.get("stdout") or "") + (result.get("stderr") or "")
    if out:
        _base._append_console_log(server_id, _redact(out, secrets_to_redact))
    if result["ok"]:
        _base._append_console_log(server_id, f"\n[MSM] SteamCMD abgeschlossen (App {app_id}).\n")
    else:
        result = _finalize_steamcmd_failure_log(
            server_id,
            result,
            live_output,
            out,
            "SteamCMD fehlgeschlagen",
        )

    # Post-failure 0x2xx safety so best-effort server starts are not blocked.
    if not result.get("ok", False):
        _force_clean_manifest_after_0x2xx(server_id, install_dir, app_id, result, live_output, node)

    # Rootless-friendly aggressive repair after EVERY SteamCMD run (success or failure).
    if node is None:
        try:
            _base.docker_service.repair_bind_mount_permissions(install_dir)
        except Exception:
            pass

    return result


def run_steamcmd_workshop_download(
    *,
    server_id: int,
    install_dir: str,
    workshop_app_id: str,
    workshop_item_id: str,
    use_authenticated_login: bool = False,
    steamcmd_image: str | None = None,
    node: Any | None = None,
) -> dict:
    """Kompatibler Single-Mod-Einstieg; intern ein Batch mit einer Mod."""
    from games import base as _base

    result = _base.run_steamcmd_workshop_download_batch(
        server_id=server_id,
        install_dir=install_dir,
        workshop_app_id=workshop_app_id,
        workshop_item_ids=[workshop_item_id],
        use_authenticated_login=use_authenticated_login,
        steamcmd_image=steamcmd_image,
        node=node,
    )
    if not result.get("ok", False):
        item = (result.get("items") or {}).get(str(workshop_item_id), {})
        if item.get("error"):
            return {**result, "ok": False, "error": item["error"]}
    return result


def _verify_workshop_batch_items(
    server_id: int,
    install_dir: str,
    workshop_app_id: str,
    item_ids: list[str],
    result: dict,
    live_output: list[str],
    out: str,
    node: Any | None,
) -> dict[str, dict[str, object]]:
    """Verifiziert geladene Workshop-Items anhand des SteamCMD-Logs und des Host-Dateisystems."""
    from games import base as _base

    items: dict[str, dict[str, object]] = {}
    full_log = "\n".join(live_output) + "\n" + (out or "")
    verify_started_at = time.time()
    base_path = Path(install_dir).resolve()

    for item_id in item_ids:
        target = base_path / "steamapps" / "workshop" / "content" / workshop_app_id / item_id
        installed = False
        success_marker = f"Success. Downloaded item {item_id} "
        # Primary signal: SteamCMD success line — must not depend on target.exists().
        if success_marker in full_log:
            installed = True
            _base._append_console_log(
                server_id,
                f"[MSM] Mod {item_id}: trusted via SteamCMD success log (overlayfs visibility fix)\n",
            )
        if node is None and not installed and target.exists():
            # Secondary: folder visible on host with content or recent mtime
            for _ in range(10):
                try:
                    if any(target.iterdir()):
                        installed = True
                        break
                except OSError:
                    pass
                time.sleep(0.25)
            if not installed:
                try:
                    if target.stat().st_mtime > verify_started_at - 900:
                        installed = True
                except OSError:
                    pass
        # installed (Dateien liegen auf Platte) ist die Quelle der Wahrheit.
        if installed:
            items[item_id] = {"ok": True, "installed": True}
        else:
            error = result.get("error") or "Workshop-Download nicht verifiziert"
            items[item_id] = {"ok": False, "installed": False, "error": str(error)}

    return items


def run_steamcmd_workshop_download_batch(
    *,
    server_id: int,
    install_dir: str,
    workshop_app_id: str,
    workshop_item_ids: list[str],
    use_authenticated_login: bool = False,
    batch_size: int = 25,
    timeout: int = 3600,
    retry: bool = True,
    steamcmd_image: str | None = None,
    node: Any | None = None,
) -> dict:
    """Lädt mehrere Workshop-Items in einer SteamCMD-Session.

    SteamCMD entscheidet selbst, ob lokale Inhalte aktuell sind. MSM startet
    höchstens einen Container pro Batch und prüft danach pro Mod den erwarteten
    Workshop-Ordner, damit Fehler sichtbar einzelnen Mods zugeordnet werden.
    """
    from games import base as _base

    item_ids = [str(item).strip() for item in workshop_item_ids if str(item).strip()]
    if not item_ids:
        return {"ok": True, "applied": 0, "items": {}, "message": "keine Workshop-Mods zu laden"}
    if len(item_ids) > batch_size:
        return {
            "ok": False,
            "error": f"Workshop-Batch zu gross ({len(item_ids)} > {batch_size})",
            "items": {item_id: {"ok": False, "error": "batch_size_exceeded"} for item_id in item_ids},
        }

    missing_login_error = (
        "Dieses Spiel benötigt einen Steam-Account für Workshop-Downloads. "
        "Bitte im Server unter Zugangsdaten ein eigenes Steam-Konto "
        "hinterlegen oder unter Einstellungen → Steam Account einen "
        "panelweiten Account setzen."
    )
    login_args, secrets_to_redact, login_err = _resolve_steamcmd_login_args(
        server_id,
        use_authenticated_login,
        missing_login_error,
    )
    if login_err is not None:
        return login_err

    data_dir = _base.CONTAINER_DATA_DIR
    steam_args: list[str] = ["+force_install_dir", data_dir, *login_args]
    for item_id in item_ids:
        steam_args.extend(["+workshop_download_item", workshop_app_id, item_id])
    steam_args.append("+quit")

    _base._append_console_log(
        server_id,
        f"[MSM] SteamCMD Workshop-Batch: app={workshop_app_id} mods={len(item_ids)}\n",
    )

    live_output: list[str] = []
    _current_workshop_item: list[str | None] = [None]
    _item_line_re = re.compile(r"Downloading item (\d+)", re.IGNORECASE)

    def _live_log(line: str) -> None:
        safe_line = _redact(line, secrets_to_redact)
        _bounded_log_buffer_append(live_output, safe_line)
        _base._append_console_log(server_id, safe_line)
        item_match = _item_line_re.search(line)
        if item_match:
            _current_workshop_item[0] = item_match.group(1)
        active_wid = _current_workshop_item[0]
        if active_wid:
            try:
                from services.mod_install_status_service import record_mod_download_output

                record_mod_download_output(server_id, active_wid, line)
            except Exception:
                pass

    uid, gid = _base.docker_service.container_runtime_uid_gid()
    image = steamcmd_image or STEAMCMD_IMAGE
    result = _base.docker_service.run_ephemeral(
        image=image,
        command=_build_steamcmd_bash_command(steam_args, uid, gid),
        volumes=[VolumeBind(install_dir, data_dir, read_only=False)],
        user="0:0",
        cap_adds=STEAMCMD_CAPS,
        entrypoint="bash",
        env={"HOME": data_dir},
        timeout=timeout,
        log_callback=_live_log,
        node=node,
    )
    out = (result.get("stdout") or "") + (result.get("stderr") or "")
    if out:
        _base._append_console_log(server_id, _redact(out, secrets_to_redact))
    if not result["ok"]:
        result = _finalize_steamcmd_failure_log(
            server_id,
            result,
            live_output,
            out,
            "Workshop-Batch fehlgeschlagen",
        )

    # Rootless Docker + overlayfs repair after workshop batch so newly written
    # workshop folders are visible and owned correctly for the host-side check.
    if node is None:
        try:
            uid, gid = _base.docker_service.container_runtime_uid_gid()
            _base.docker_service.repair_bind_mount_permissions(install_dir, owner_uid_gid=(uid, gid))
        except Exception:
            pass

    items = _verify_workshop_batch_items(
        server_id,
        install_dir,
        workshop_app_id,
        item_ids,
        result,
        live_output,
        out,
        node,
    )

    failed_ids = [item_id for item_id, item in items.items() if not item.get("ok")]
    if retry and failed_ids:
        _base._append_console_log(
            server_id,
            f"[MSM] Workshop-Batch retry for {len(failed_ids)} failed mod(s)...\n",
        )
        retry_result = _base.run_steamcmd_workshop_download_batch(
            server_id=server_id,
            install_dir=install_dir,
            workshop_app_id=workshop_app_id,
            workshop_item_ids=failed_ids,
            use_authenticated_login=use_authenticated_login,
            batch_size=batch_size,
            timeout=timeout,
            retry=False,
            steamcmd_image=steamcmd_image,
            node=node,
        )
        retry_items = retry_result.get("items", {}) if isinstance(retry_result, dict) else {}
        for item_id in failed_ids:
            if isinstance(retry_items, dict) and item_id in retry_items:
                items[item_id] = retry_items[item_id]

    return {
        **result,
        "ok": all(bool(item.get("ok")) for item in items.values()),
        "applied": sum(1 for item in items.values() if item.get("ok")),
        "items": items,
    }
