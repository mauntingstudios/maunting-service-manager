"""Ephemere SteamCMD-Ausführung für Server-Installation, Updates und Workshop-Batches."""

import logging
import os
import re
import shlex
import shutil
import tempfile
import threading
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
_WORKSHOP_ITEM_SECTIONS = frozenset({"WorkshopItemsInstalled", "WorkshopItemDetails"})

_WORKSHOP_ACF_PERL_SCRIPT = r"""
use strict;
use warnings;
my ($acf, $cdir, $rem) = @ARGV;
exit 0 if !defined $acf || -l $acf || !-f $acf;
my $cdir_ok = defined($cdir) && $cdir ne "" && !-l $cdir && -d $cdir;
my %drop = map { $_ => 1 } grep { $_ ne "" } split /,/, ($rem // "");
open my $in, "<", $acf or exit 0;
my @lines = <$in>;
close $in;
my @out;
my @stack;
my ($pend_k, $pend_l, $skip_d);
my ($kept, $unbal) = (0, 0);
my %cache;
my $keep = sub {
  my ($id) = @_;
  return 0 if $drop{$id} || !$cdir_ok || $id eq "." || $id eq ".." || $id =~ m{[\\/]};
  return $cache{$id} if exists $cache{$id};
  my $d = "$cdir/$id";
  my $ok = 0;
  if (!-l $d && -d $d && opendir(my $dh, $d)) {
    while (defined(my $e = readdir $dh)) {
      if ($e ne "." && $e ne "..") { $ok = 1; last; }
    }
    closedir $dh;
  }
  return $cache{$id} = $ok;
};
for my $l (@lines) {
  my @tok;
  my ($o, $c) = (0, 0);
  my ($inq, $esc, $buf) = (0, 0, "");
  for my $ch (split //, $l) {
    if ($esc) { $buf .= $ch if $inq; $esc = 0; next; }
    if ($ch eq "\\" && $inq) { $esc = 1; $buf .= $ch; next; }
    if ($ch eq q(")) {
      if ($inq) { push @tok, $buf; $buf = ""; $inq = 0; }
      else { $inq = 1; }
      next;
    }
    if ($inq) { $buf .= $ch; }
    elsif ($ch eq "{") { $o++; }
    elsif ($ch eq "}") { $c++; }
  }
  if (defined $skip_d) {
    push @stack, "_s" for 1..$o;
    for (1..$c) {
      if (!@stack) { $unbal = 1; last; }
      pop @stack;
      $skip_d = undef if defined $skip_d && @stack == $skip_d;
    }
    last if $unbal;
    next;
  }
  if (defined $pend_l && $o > 0 && !@tok) {
    if (@stack == 2 && $stack[0] eq "AppWorkshop" && ($stack[1] eq "WorkshopItemsInstalled" || $stack[1] eq "WorkshopItemDetails") && defined $pend_k && !$keep->($pend_k)) {
      $skip_d = scalar @stack;
      push @stack, $pend_k;
      $pend_k = undef; $pend_l = undef;
      push @stack, "_s" for 2..$o;
      for (1..$c) {
        if (!@stack) { $unbal = 1; last; }
        pop @stack;
        $skip_d = undef if defined $skip_d && @stack == $skip_d;
      }
      last if $unbal;
      next;
    }
    $kept++ if @stack == 2 && $stack[0] eq "AppWorkshop" && $stack[1] eq "WorkshopItemsInstalled";
    push @out, $pend_l, $l;
    push @stack, (defined $pend_k ? $pend_k : "_a");
    $pend_k = undef; $pend_l = undef;
    push @stack, "_s" for 2..$o;
    for (1..$c) { if (!@stack) { $unbal = 1; last; } pop @stack; }
    last if $unbal;
    next;
  }
  if (defined $pend_l && $l =~ /^\s*$/) { $pend_l .= $l; next; }
  if (defined $pend_l) { push @out, $pend_l; $pend_l = undef; $pend_k = undef; }
  if (@tok == 1 && $o == 1 && $c == 0 && @stack == 2 && $stack[0] eq "AppWorkshop" && ($stack[1] eq "WorkshopItemsInstalled" || $stack[1] eq "WorkshopItemDetails") && !$keep->($tok[0])) {
    $skip_d = scalar @stack; push @stack, $tok[0]; next;
  }
  if (@tok == 1 && $o == 0 && $c == 0) { $pend_k = $tok[0]; $pend_l = $l; next; }
  if (@stack == 1 && $stack[0] eq "AppWorkshop" && @tok == 2 && $o == 0 && $c == 0 && ($tok[0] eq "NeedsUpdate" || $tok[0] eq "NeedsDownload")) {
    if ($tok[1] ne "0") {
      my ($ind) = ($l =~ /^([ \t]*)/);
      my ($nl) = ($l =~ /(\r?\n)$/);
      $nl = "" unless defined $nl;
      $l = qq(${ind}"$tok[0]"\t\t"0"$nl);
    }
    push @out, $l; next;
  }
  if (@stack == 3 && $stack[0] eq "AppWorkshop" && $stack[1] eq "WorkshopItemDetails" && @tok == 2 && $o == 0 && $c == 0 && ($tok[0] eq "BytesDownloaded" || $tok[0] eq "BytesToDownload")) {
    next;
  }
  $kept++ if @tok == 1 && $o == 1 && $c == 0 && @stack == 2 && $stack[0] eq "AppWorkshop" && $stack[1] eq "WorkshopItemsInstalled";
  push @stack, (@tok ? $tok[0] : "_s") for 1..$o;
  for (1..$c) { if (!@stack) { $unbal = 1; last; } pop @stack; }
  last if $unbal;
  push @out, $l;
}
if (defined $pend_l) { push @out, $pend_l; }
if ($unbal || @stack || defined $skip_d || $kept == 0) { unlink $acf; exit 0; }
my $tmp = "$acf.tmp.$$";
open my $fh, ">", $tmp or exit 1;
print {$fh} @out or do { close $fh; unlink $tmp; exit 1; };
close $fh or do { unlink $tmp; exit 1; };
rename $tmp, $acf or do { unlink $tmp; exit 1; };
""".strip()


def _scan_vdf_line(line: str) -> tuple[list[str], int, int]:
    """Extract quoted VDF tokens and brace counts outside quotes."""
    tokens: list[str] = []
    open_braces = 0
    close_braces = 0
    in_quotes = False
    escaped = False
    token_chars: list[str] = []

    for ch in line:
        if escaped:
            if in_quotes:
                token_chars.append(ch)
            escaped = False
            continue
        if ch == "\\" and in_quotes:
            escaped = True
            token_chars.append(ch)
            continue
        if ch == '"':
            if in_quotes:
                tokens.append("".join(token_chars))
                token_chars.clear()
                in_quotes = False
            else:
                in_quotes = True
            continue
        if in_quotes:
            token_chars.append(ch)
        elif ch == "{":
            open_braces += 1
        elif ch == "}":
            close_braces += 1
    return tokens, open_braces, close_braces


def prune_appworkshop_acf(
    acf_path: Path,
    content_app_dir: Path | None,
    remove_ids: set[str] | None = None,
) -> bool:
    """Prune missing or removed Workshop IDs and dirty flags from ``appworkshop_<appid>.acf``.

    Returns True if the manifest was modified or removed.
    """
    if acf_path.is_symlink():
        acf_path.unlink(missing_ok=True)
        return True
    if not acf_path.is_file():
        return False

    try:
        original = acf_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False

    remove_set = {str(w).strip() for w in (remove_ids or set()) if str(w).strip()}
    valid_cache: dict[str, bool] = {}

    def _keep_item(wid: str) -> bool:
        if wid in remove_set or content_app_dir is None:
            return False
        cached = valid_cache.get(wid)
        if cached is not None:
            return cached
        item_dir = content_app_dir / wid
        try:
            ok = (
                not item_dir.is_symlink()
                and item_dir.is_dir()
                and any(True for _ in item_dir.iterdir())
            )
        except OSError:
            ok = False
        valid_cache[wid] = ok
        return ok

    output_lines: list[str] = []
    stack: list[str] = []
    pending_key: str | None = None
    pending_line: str | None = None
    skip_depth: int | None = None
    kept_installed = 0
    changed = False
    unbalanced = False

    def _flush_pending() -> None:
        nonlocal pending_key, pending_line
        if pending_line is not None:
            output_lines.append(pending_line)
            pending_line = None
        pending_key = None

    for line in original.splitlines(keepends=True):
        tokens, opens, closes = _scan_vdf_line(line)

        if skip_depth is not None:
            for _ in range(opens):
                stack.append("_skip")
            for _ in range(closes):
                if not stack:
                    unbalanced = True
                    break
                stack.pop()
                if len(stack) == skip_depth:
                    skip_depth = None
            changed = True
            if unbalanced:
                break
            continue

        if pending_line is not None and opens > 0 and not tokens:
            if (
                len(stack) == 2
                and stack[0] == "AppWorkshop"
                and stack[1] in _WORKSHOP_ITEM_SECTIONS
                and pending_key is not None
                and not _keep_item(pending_key)
            ):
                skip_depth = len(stack)
                stack.append(pending_key)
                pending_key = None
                pending_line = None
                changed = True
                for _ in range(opens - 1):
                    stack.append("_sub")
                for _ in range(closes):
                    if not stack:
                        unbalanced = True
                        break
                    stack.pop()
                    if skip_depth is not None and len(stack) == skip_depth:
                        skip_depth = None
                if unbalanced:
                    break
                continue
            if (
                len(stack) == 2
                and stack[0] == "AppWorkshop"
                and stack[1] == "WorkshopItemsInstalled"
            ):
                kept_installed += 1
            output_lines.append(pending_line)
            pending_line = None
            section = pending_key or "_anon"
            pending_key = None
            stack.append(section)
            for _ in range(opens - 1):
                stack.append("_sub")
            for _ in range(closes):
                if not stack:
                    unbalanced = True
                    break
                stack.pop()
            output_lines.append(line)
            if unbalanced:
                break
            continue

        if pending_line is not None and not line.strip():
            pending_line += line
            continue

        if pending_line is not None:
            _flush_pending()

        if (
            len(tokens) == 1
            and opens == 1
            and closes == 0
            and len(stack) == 2
            and stack[0] == "AppWorkshop"
            and stack[1] in _WORKSHOP_ITEM_SECTIONS
            and not _keep_item(tokens[0])
        ):
            skip_depth = len(stack)
            stack.append(tokens[0])
            changed = True
            continue

        if len(tokens) == 1 and opens == 0 and closes == 0:
            pending_key = tokens[0]
            pending_line = line
            continue

        if (
            len(stack) == 1
            and stack[0] == "AppWorkshop"
            and len(tokens) == 2
            and opens == 0
            and closes == 0
            and tokens[0] in {"NeedsUpdate", "NeedsDownload"}
        ):
            if tokens[1] != "0":
                indent = line[: len(line) - len(line.lstrip(" \t"))]
                newline = "\r\n" if line.endswith("\r\n") else ("\n" if line.endswith("\n") else "")
                line = f'{indent}"{tokens[0]}"\t\t"0"{newline}'
                changed = True
            output_lines.append(line)
            continue

        if (
            len(stack) == 3
            and stack[0] == "AppWorkshop"
            and stack[1] == "WorkshopItemDetails"
            and len(tokens) == 2
            and opens == 0
            and closes == 0
            and tokens[0] in {"BytesDownloaded", "BytesToDownload"}
        ):
            changed = True
            continue

        if (
            len(tokens) == 1
            and opens == 1
            and len(stack) == 2
            and stack[0] == "AppWorkshop"
            and stack[1] == "WorkshopItemsInstalled"
            and closes == 0
        ):
            kept_installed += 1

        for i in range(opens):
            stack.append(tokens[0] if i == 0 and tokens else "_sub")
        for _ in range(closes):
            if not stack:
                unbalanced = True
                break
            stack.pop()
        if unbalanced:
            break
        output_lines.append(line)

    _flush_pending()

    if unbalanced or stack or skip_depth is not None or kept_installed == 0:
        acf_path.unlink(missing_ok=True)
        return True

    new_text = "".join(output_lines)
    if not changed and new_text == original:
        return False

    tmp_fd, tmp_name = tempfile.mkstemp(prefix=".acf_prune_", dir=str(acf_path.parent))
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_text)
        os.replace(tmp_name, acf_path)
    except Exception:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    return True


def _safe_existing_subdir(root: Path, *parts: str) -> Path | None:
    cur = root
    for part in parts:
        cur = cur / part
        if cur.is_symlink() or not cur.exists():
            return None
    return cur if cur.is_dir() else None


def _remove_path_if_present(target: Path) -> None:
    if target.is_symlink() or target.is_file():
        target.unlink(missing_ok=True)
    elif target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def cleanup_workshop_state(
    install_dir: str | Path,
    workshop_app_id: str,
    remove_ids: set[str] | None = None,
) -> None:
    """Clean stale SteamCMD Workshop temp probes and prune ``appworkshop_<appid>.acf``."""
    root = Path(install_dir)
    if root.is_symlink() or not root.is_dir():
        return

    app_id = str(workshop_app_id).strip()
    temp_dir = _safe_existing_subdir(root, "steamapps", "workshop", "temp")
    if temp_dir is not None:
        for entry in list(temp_dir.iterdir()):
            _remove_path_if_present(entry)

    probe_dirs: list[Path] = []
    steam_dir = _safe_existing_subdir(root, "Steam")
    if steam_dir is not None:
        probe_dirs.append(steam_dir)
    downloads_root = _safe_existing_subdir(root, "steamapps", "workshop", "downloads")
    if downloads_root is not None:
        probe_dirs.append(downloads_root)
        if app_id:
            app_dl = _safe_existing_subdir(root, "steamapps", "workshop", "downloads", app_id)
            if app_dl is not None:
                probe_dirs.append(app_dl)
        for wid in remove_ids or set():
            if wid and app_id:
                wid_dl = _safe_existing_subdir(
                    root, "steamapps", "workshop", "downloads", app_id, str(wid).strip()
                )
                if wid_dl is not None:
                    _remove_path_if_present(wid_dl)

    for probe_dir in probe_dirs:
        for probe in list(probe_dir.glob(".temp_write_*")):
            _remove_path_if_present(probe)

    if app_id:
        workshop_dir = _safe_existing_subdir(root, "steamapps", "workshop")
        if workshop_dir is not None:
            content_app_dir = _safe_existing_subdir(
                root, "steamapps", "workshop", "content", app_id
            )
            prune_appworkshop_acf(
                workshop_dir / f"appworkshop_{app_id}.acf",
                content_app_dir,
                remove_ids=remove_ids,
            )


def _extract_workshop_targets(steam_args: list[str]) -> tuple[str | None, list[str]]:
    """Return ``(workshop_app_id, item_ids)`` parsed from ``+workshop_download_item`` args."""
    app_id: str | None = None
    item_ids: list[str] = []
    seen: set[str] = set()
    for idx, arg in enumerate(steam_args):
        if arg == "+workshop_download_item" and idx + 2 < len(steam_args):
            cand_app = str(steam_args[idx + 1]).strip()
            cand_item = str(steam_args[idx + 2]).strip()
            if cand_app.isdigit() and app_id is None:
                app_id = cand_app
            if cand_item.isdigit() and cand_item not in seen:
                seen.add(cand_item)
                item_ids.append(cand_item)
    return app_id, item_ids


def _build_workshop_acf_reconcile_cmd(data_dir: str, workshop_app_id: str, item_ids: list[str]) -> str:
    """Build an in-container shell command that reconciles ``appworkshop_<appid>.acf`` via perl."""
    q_sa = shlex.quote(f"{data_dir}/steamapps")
    q_ws = shlex.quote(f"{data_dir}/steamapps/workshop")
    q_cnt = shlex.quote(f"{data_dir}/steamapps/workshop/content")
    q_acf = shlex.quote(f"{data_dir}/steamapps/workshop/appworkshop_{workshop_app_id}.acf")
    q_cdir = shlex.quote(f"{data_dir}/steamapps/workshop/content/{workshop_app_id}")
    q_pl = shlex.quote(_WORKSHOP_ACF_PERL_SCRIPT)
    q_ids = shlex.quote(",".join(item_ids))
    return (
        f"_acf={q_acf}; _cdir={q_cdir}; "
        f"if [ -L $_acf ] || [ -L {q_sa} ] || [ -L {q_ws} ]; then rm -f $_acf 2>/dev/null || true; "
        f"elif [ -f $_acf ] && command -v perl >/dev/null 2>&1; then "
        f"[ -L {q_cnt} ] || [ -L $_cdir ] && _cdir=''; "
        f"perl -e {q_pl} \"$_acf\" \"$_cdir\" {q_ids} || rm -f $_acf 2>/dev/null || true; "
        "fi; "
    )


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

    Zusätzlich: Vor dem SteamCMD-Lauf werden stale downloading/, temp/,
    `.temp_write_*`-Probes und defekte `appworkshop_<appid>.acf`-Einträge
    bereinigt. Das verhindert "state is 0x202/0x226 after update job" sowie
    Workshop-"Missing game files"-Fehler nach fehlgeschlagenen Jobs.
    """
    from games import base as _base

    data_dir = _base.CONTAINER_DATA_DIR
    quoted = " ".join(shlex.quote(a) for a in steam_args)
    q_data = shlex.quote(data_dir)
    # KISS-Cleanup: stale Steam partials sind immer nur von fehlgeschlagenen
    # vorherigen Jobs. Löschen ist sicher (keine Nutzerdaten) und löst
    # 0x2xx-State-Fehler sowie stale Workshop-Staging/.temp_write_*-Reste.
    cleanup = (
        f"rm -rf {q_data}/steamapps/downloading/* "
        f"{q_data}/steamapps/temp/* "
        f"{q_data}/Steam/.temp_write_* "
        f"{q_data}/steamapps/workshop/temp/* "
        f"{q_data}/steamapps/workshop/downloads/*/* "
        f"{q_data}/steamapps/workshop/downloads/.temp_write_* "
        f"{q_data}/steamapps/workshop/downloads/*/.temp_write_* "
        "2>/dev/null || true; "
    )
    workshop_app_id, workshop_item_ids = _extract_workshop_targets(steam_args)
    if workshop_app_id:
        cleanup += _build_workshop_acf_reconcile_cmd(data_dir, workshop_app_id, workshop_item_ids)
    script = (
        cleanup +
        "_stdbuf=''; command -v stdbuf >/dev/null 2>&1 && _stdbuf='stdbuf -oL -eL'; "
        f"$_stdbuf {shlex.quote(STEAMCMD_BIN)} {quoted}; "
        "rc=$?; "
        "if [ $rc -ne 0 ]; then "
        f"df -Pm {q_data} 2>/dev/null | awk 'NR==2 {{printf \"[MSM-DIAG] disk_avail_mb=%s disk_total_mb=%s\\n\", $4, $2}}' || true; "
        f"if [ -f {q_data}/Steam/logs/content_log.txt ]; then "
        f"grep -iE 'failed to preallocate|not enough disk|update canceled|scheduler finished|updateresult' "
        f"{q_data}/Steam/logs/content_log.txt 2>/dev/null | tail -n 6 | sed 's/^/[MSM-DIAG] /' || true; "
        "fi; "
        "fi; "
        f"chown -R {int(chown_uid)}:{int(chown_gid)} {q_data} 2>/dev/null || true; "
        f"chmod -R a+rwx {q_data} 2>/dev/null || true; "
        "exit $rc"
    )
    return ["-c", script]


def _redact(text: str, secrets_to_redact: list[str]) -> str:
    for s in secrets_to_redact:
        if s:
            text = text.replace(s, "***")
    return text


_DISK_QUOTA_MARKERS = (
    "not enough disk quota",
    "not enough disk space",
    "failed to preallocate",
    "no space left on device",
    "disk quota exceeded",
    "updateresult 43",
)


def classify_steamcmd_failure(output: str, fallback_error: str = "") -> dict[str, str] | None:
    """Map known SteamCMD failure markers to safe structured errors.

    The message intentionally names causes as possible and ``nicht verifiziert``:
    SteamCMD output alone does not prove whether disk, quota, permissions,
    platform metadata, or concurrent access was the root cause.
    """
    raw = f"{output}\n{fallback_error}"
    text = raw.lower()
    if any(marker in text for marker in _DISK_QUOTA_MARKERS):
        need_match = re.search(r'Failed to preallocate[^"\n]*"([^"]+)"', raw, flags=re.IGNORECASE)
        avail_match = re.search(r"disk_avail_mb=(\d+)", raw)
        details: list[str] = []
        if need_match:
            details.append(f"benötigt ca. {need_match.group(1)}")
        if avail_match:
            avail_gb = int(avail_match.group(1)) / 1024.0
            details.append(f"aktuell verfügbar: {avail_gb:.1f} GB")
        detail_suffix = f" ({', '.join(details)})" if details else ""
        return {
            "error_code": "steamcmd_disk_quota_exceeded",
            "error": (
                f"Nicht genügend freier Speicherplatz oder Disk-Quota für den Download{detail_suffix}. "
                "Bitte das Festplatten-Limit (Disk-Quota) des Servers erhöhen oder freien Speicher auf dem Node schaffen."
            ),
        }
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
    from games.install_diagnostics import classify_generic_install_failure

    return classify_generic_install_failure(output, fallback_error)


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
        from services.node_capacity import agent_server_key, should_delegate_node_fs_to_agent
        from services.node_client import NodeClient, NodeClientError

        if should_delegate_node_fs_to_agent(node) or (
            node is not None and not getattr(node, "is_local", False)
        ):
            server_key = agent_server_key(server_id, install_dir)
            client = NodeClient.from_node(node)
            manifest_rel = f"steamapps/appmanifest_{app_id}.acf"
            try:
                mt = client.files_read(server_key, manifest_rel)
                if _is_corrupt_steam_manifest(mt):
                    bak_rel = f"{manifest_rel}.bad-state.{int(time.time())}"
                    client.files_write(server_key, bak_rel, mt)
                    client.files_delete(server_key, manifest_rel)
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
    beta_password: str | None = None,
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
        pw = (beta_password or "").strip()
        if pw and not any(ch.isspace() or ord(ch) < 32 for ch in pw):
            steam_args.extend(["-betapassword", pw])
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


def _manifest_has_real_build(manifest_text: str) -> bool:
    """True nur, wenn ein bereits installiertes Build (`buildid != 0`) im Manifest steht."""
    return bool(re.search(r'"buildid"\s+"(?!0")[^"]+"', manifest_text))


def _force_clean_manifest_after_0x2xx(
    server_id: int,
    install_dir: str,
    app_id: str,
    result: dict,
    live_output: list[str],
    node: Any | None,
) -> None:
    """Schreibt nach 0x2xx-/Timeout-Abbruch ein sauberes StateFlags=4-Manifest nur bei vorhandenem Alt-Build."""
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
        from services.node_capacity import agent_server_key, should_delegate_node_fs_to_agent

        if should_delegate_node_fs_to_agent(node) or (
            node is not None and not getattr(node, "is_local", False)
        ):
            from services.node_client import NodeClient

            server_key = agent_server_key(server_id, install_dir)
            client = NodeClient.from_node(node)
            manifest_rel = f"steamapps/appmanifest_{app_id}.acf"
            try:
                mt = client.files_read(server_key, manifest_rel)
            except Exception:
                return
            if not _manifest_has_real_build(mt):
                return
            try:
                bak_rel = f"{manifest_rel}.post-fail.{int(time.time())}"
                client.files_write(server_key, bak_rel, mt)
            except Exception:
                pass
            client.files_write(server_key, manifest_rel, clean)
            _base._append_console_log(
                server_id,
                "[MSM] Forced clean manifest (State 4) after 0x2xx failure on agent — best effort start can proceed\n",
            )
            return

        manp = os.path.join(install_dir, "steamapps", f"appmanifest_{app_id}.acf")
        if not os.path.exists(manp):
            return
        with open(manp) as mf:
            mt = mf.read()
        if not _manifest_has_real_build(mt):
            return
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
    beta_password: str | None = None,
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

    pw_clean = (beta_password or "").strip()
    if pw_clean:
        secrets_to_redact = [*secrets_to_redact, pw_clean]

    steam_args = _build_steamcmd_install_args(
        app_id,
        login_args,
        platform=platform,
        validate=validate,
        beta_branch=beta_branch,
        beta_password=pw_clean or None,
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
    from services.node_capacity import should_delegate_node_fs_to_agent

    if not should_delegate_node_fs_to_agent(node):
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
    _success_line_re = re.compile(r"Success\.\s*Downloaded item (\d+)", re.IGNORECASE)
    _monitor_stop = threading.Event()
    _disk_progress_step: dict[str, int] = {}
    _disk_last_bytes: dict[str, int] = {}

    def _dir_size_bytes(path: Path) -> int:
        if not path.exists():
            return 0
        total = 0
        try:
            for root, _dirs, files in os.walk(path):
                for fname in files:
                    try:
                        total += os.path.getsize(os.path.join(root, fname))
                    except OSError:
                        pass
        except OSError:
            pass
        return total

    def _poll_workshop_disk_growth() -> None:
        base_install = Path(install_dir)
        while not _monitor_stop.wait(2.0):
            active_wid = _current_workshop_item[0]
            if not active_wid:
                continue
            dl_dir = base_install / "steamapps" / "workshop" / "downloads" / str(workshop_app_id) / active_wid
            ct_dir = base_install / "steamapps" / "workshop" / "content" / str(workshop_app_id) / active_wid
            cur_bytes = _dir_size_bytes(dl_dir) + _dir_size_bytes(ct_dir)
            prev_bytes = _disk_last_bytes.get(active_wid, -1)
            if cur_bytes > 0 and cur_bytes > prev_bytes:
                _disk_last_bytes[active_wid] = cur_bytes
                cur_pct = _disk_progress_step.get(active_wid, 15)
                next_pct = min(88, cur_pct + max(3, (88 - cur_pct) // 5))
                _disk_progress_step[active_wid] = next_pct
                try:
                    from services.mod_install_status_service import set_mod_install_progress

                    set_mod_install_progress(server_id, active_wid, next_pct)
                except Exception:
                    pass

    def _live_log(line: str) -> None:
        safe_line = _redact(line, secrets_to_redact)
        _bounded_log_buffer_append(live_output, safe_line)
        _base._append_console_log(server_id, safe_line)
        for sub_line in re.split(r"[\r\n]+", line):
            if not sub_line.strip():
                continue
            item_match = _item_line_re.search(sub_line)
            if item_match:
                prev_wid = _current_workshop_item[0]
                next_wid = item_match.group(1)
                _current_workshop_item[0] = next_wid
                try:
                    from services.mod_install_status_service import set_mod_install_progress

                    if prev_wid and prev_wid != next_wid:
                        set_mod_install_progress(server_id, prev_wid, 95)
                    set_mod_install_progress(server_id, next_wid, 15, promote_from_pending=True)
                    _disk_progress_step.setdefault(next_wid, 15)
                except Exception:
                    pass
                continue

            success_match = _success_line_re.search(sub_line)
            if success_match:
                done_wid = success_match.group(1)
                try:
                    from services.mod_install_status_service import set_mod_install_progress

                    set_mod_install_progress(server_id, done_wid, 95)
                except Exception:
                    pass
                continue

            active_wid = _current_workshop_item[0]
            if active_wid:
                try:
                    from services.mod_install_status_service import record_mod_download_output

                    record_mod_download_output(server_id, active_wid, sub_line)
                except Exception:
                    pass

    if node is None:
        cleanup_workshop_state(install_dir, workshop_app_id, remove_ids=set(item_ids))
    uid, gid = _base.docker_service.container_runtime_uid_gid()
    image = steamcmd_image or STEAMCMD_IMAGE
    monitor_thread: threading.Thread | None = None
    if node is None:
        monitor_thread = threading.Thread(target=_poll_workshop_disk_growth, daemon=True)
        monitor_thread.start()
    try:
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
    finally:
        _monitor_stop.set()
        if monitor_thread is not None:
            monitor_thread.join(timeout=1.0)
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
