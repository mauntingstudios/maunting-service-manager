#!/usr/bin/env bash
set -euo pipefail
umask 077

# ═══════════════════════════════════════════════════════════════
#  Maunting Service Manager — Updater
#
#  Usage:  sudo bash update.sh [--check-only] [--force]
#
#  Prüft zuerst GitHub-Releases, falls keine existieren
#  wird der neueste main-Branch-Commit verwendet.
#
#  Die Desktop-Apps aktualisieren sich über Velopack
#  (releases.mss.json / releases.pontis.json auf GitHub).
# ═══════════════════════════════════════════════════════════════

MSM_DIR="/opt/msm"
MSM_USER="msm"
MSM_AGENT_USER="msm-agent"
MSM_DOCKER_USER="msm-docker"
MSM_SERVERS_GROUP="msm-servers"
MSM_DOCKER_HOME="/var/lib/msm-docker"
LOG_FILE="/tmp/msm-update.log"
BACKUP_DIR="/opt/msm/backups"
ENV_FILE="$MSM_DIR/backend/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[UPDATE]${NC} $1" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[ERR]${NC}  $1" | tee -a "$LOG_FILE"; exit 1; }

# Normalisiert Versions-Strings fuer den Vergleich:
# Entfernt v-Prefix und git-describe-Suffixe (-N-gHASH).
# Beispiel: 'v1.7.8-2-gabcdef' -> '1.7.8', 'recovery-v1.7.8' -> '1.7.8'
normalize_version() {
    local v="$1"
    # Entferne alles vor 'v' (z.B. 'recovery-v1.7.8' -> 'v1.7.8')
    v="${v##*v}"
    # Entferne git-describe-Suffix (-N-gHASH)
    v=$(echo "$v" | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/')
    echo "$v"
}

# Setzt Besitz der Panel-Dateien zurueck auf $MSM_USER.
# WICHTIG: /opt/msm/servers (per-Game-Server-User) und /opt/msm/backups
# (eigene Backup-Daten) NICHT anfassen, sonst kippen Datei-Rechte fuer
# laufende Game-Server-Container. Wir chownen nur die Panel-Code-Pfade,
# die `git pull` als root ueberschrieben hat.
restore_panel_ownership() {
    [[ -d "$MSM_DIR" ]] || return 0
    # Wenn der msm-User noch gar nicht existiert (z.B. allererster Run vor
    # install.sh), gibt es nichts zu chownen.
    id "$MSM_USER" &>/dev/null || return 0
    # .git muss msm geschrieben werden koennen (sonst kann msm spaeter nicht
    # `git describe` o.ae. ausfuehren).
    if [[ -d "$MSM_DIR/.git" ]]; then
        chown -R "$MSM_USER:$MSM_USER" "$MSM_DIR/.git" 2>/dev/null || true
    fi
    # ACHTUNG: Auf Produktions-Servern (root server) NIEMALS `git clean -fd` (oder -x)
    # im $MSM_DIR ausfuehren! Auch wenn server-Daten unter $MSM_DIR/servers liegen:
    # git clean loescht untracked Dirs. Die .gitignore schuetzt jetzt die Daten-Pfade,
    # aber manuelle "Sauberkeit" Befehle sind riskant. Immer --dry-run zuerst.
    # Es gibt helper-scripts/recover-docker-storage.sh als Recovery (für den Docker-Store-Corruption-Fall).
    mkdir -p "$MSM_DIR/blueprints/community" 2>/dev/null || true
    for sub in backend frontend docs dis-sidecar docs-sidecar scripts helper-scripts blueprints; do
        if [[ -d "$MSM_DIR/$sub" ]]; then
            chown -R "$MSM_USER:$MSM_USER" "$MSM_DIR/$sub" \
                || err "chown $MSM_USER:$MSM_USER auf $MSM_DIR/$sub fehlgeschlagen"
            if [[ "$sub" == "blueprints" ]]; then
                chmod -R u+rwX,g+rwX "$MSM_DIR/$sub" 2>/dev/null || true
            fi
        fi
    done
    local agent_owner="$MSM_USER"
    id "$MSM_AGENT_USER" &>/dev/null && agent_owner="$MSM_AGENT_USER"
    if [[ -d "$MSM_DIR/msm-agent" ]]; then
        chown -R "$agent_owner:$agent_owner" "$MSM_DIR/msm-agent" \
            || err "chown $agent_owner:$agent_owner auf $MSM_DIR/msm-agent fehlgeschlagen"
    fi
    local docker_owner="$MSM_USER"
    id "$MSM_DOCKER_USER" &>/dev/null && docker_owner="$MSM_DOCKER_USER"
    for dsub in searxng-sidecar livekit-sidecar wetter-sidecar; do
        if [[ -d "$MSM_DIR/$dsub" ]]; then
            chown -R "$docker_owner:$docker_owner" "$MSM_DIR/$dsub" 2>/dev/null || true
        fi
    done
    # npm-Cache des msm-Users (HOME=/opt/msm). Falls ein frueherer fehlge-
    # schlagener Run als root in den Cache geschrieben hat, scheitert npm
    # sonst beim naechsten Lauf.
    if [[ -d "$MSM_DIR/.npm" ]]; then
        chown -R "$MSM_USER:$MSM_USER" "$MSM_DIR/.npm" 2>/dev/null || true
    fi
    # Top-Level-Dateien (Scripts, Templates, README, etc.).
    # `find -maxdepth 1` haelt /opt/msm/servers und /opt/msm/backups raus.
    find "$MSM_DIR" -maxdepth 1 -type f \
        -exec chown "$MSM_USER:$MSM_USER" {} + 2>/dev/null || true
}

# Create/repair a per-app Python venv as target_user (defaults to $MSM_USER; no system pip / PEP 668).
prepare_app_venv() {
    local app_dir="$1"
    local label="$2"
    local recreate="${3:-false}"
    local target_user="${4:-$MSM_USER}"

    [[ -d "$app_dir" ]] || err "$label: Verzeichnis fehlt: $app_dir"
    id "$target_user" &>/dev/null || err "$label: Systemuser $target_user existiert nicht"
    command -v python3 &>/dev/null || err "$label: python3 fehlt"
    if ! python3 -c "import venv" 2>/dev/null; then
        err "$label: python3-venv fehlt (apt install python3-venv)"
    fi

    chown -R "$target_user:$target_user" "$app_dir" \
        || err "$label: chown $target_user:$target_user auf $app_dir fehlgeschlagen"

    if [[ -e "$app_dir/venv" ]]; then
        local vowner
        vowner=$(stat -c '%U' "$app_dir/venv" 2>/dev/null || echo "")
        if [[ "$recreate" == "true" ]] \
            || [[ "$vowner" != "$target_user" ]] \
            || [[ ! -x "$app_dir/venv/bin/python" ]]; then
            rm -rf "$app_dir/venv"
        fi
    fi

    if ! su -s /bin/bash "$target_user" -c "
        set -euo pipefail
        cd $(printf '%q' "$app_dir")
        if [[ ! -x venv/bin/python ]]; then
            rm -rf venv
            python3 -m venv venv
        fi
        # shellcheck disable=SC1091
        source venv/bin/activate
        test -n \"\${VIRTUAL_ENV:-}\"
        case \"\$(command -v python)\" in
            */venv/bin/python*) ;;
            *) echo \"ERROR: $label: not using venv python: \$(command -v python)\" >&2; exit 1 ;;
        esac
        pip install --upgrade pip -q
        pip install -r requirements.txt -q
        test -x venv/bin/python
    " 2>&1 | tee -a "$LOG_FILE"; then
        err "$label: venv-Setup fehlgeschlagen (Ownership/PEP 668). Ownership: $(stat -c '%U:%G' "$app_dir" 2>/dev/null || echo '?')"
    fi

    [[ -x "$app_dir/venv/bin/python" ]] || err "$label: venv/bin/python fehlt nach Setup"
    local venv_owner
    venv_owner=$(stat -c '%U' "$app_dir/venv" 2>/dev/null || echo "")
    [[ "$venv_owner" == "$target_user" ]] || err "$label: venv gehört $venv_owner, nicht $target_user"
}

CHECK_ONLY=false
FORCE=false
UPDATE_SUCCEEDED=false
PANEL_WAS_ACTIVE=false
DB_BACKUP_FILE=""

cleanup_on_failure() {
    local exit_code=$?
    if [[ "$UPDATE_SUCCEEDED" != "true" && $exit_code -ne 0 ]]; then
        warn "Update nicht abgeschlossen. Es wird bewusst kein Erfolg gemeldet."
        [[ -n "$DB_BACKUP_FILE" ]] && warn "PostgreSQL-Sicherung: $DB_BACKUP_FILE"
        if ${SYSTEMD_AVAILABLE:-false} && $PANEL_WAS_ACTIVE; then
            # Sidecar zuerst: der Code ist womoeglich schon neu, und das neue
            # Panel verweigert den Dienst mit einem alten Sidecar.
            systemctl restart msm-dis-sidecar.service 2>/dev/null || true
            [[ -f /etc/systemd/system/msm-docs-sidecar.service ]]                 && systemctl restart msm-docs-sidecar.service 2>/dev/null || true
            systemctl restart msm-panel.service 2>/dev/null || true
        fi
    fi
}
trap cleanup_on_failure EXIT

for arg in "$@"; do
    case "$arg" in
        --check-only) CHECK_ONLY=true ;;
        --force) FORCE=true ;;
    esac
done

# ── Config laden ──
if [[ -f "$ENV_FILE" ]]; then
    # Shell-sicheres Einlesen der .env
    GITHUB_OWNER=$(grep -E '^MSM_GITHUB_OWNER=' "$ENV_FILE" | cut -d'"' -f2 || echo "")
    GITHUB_REPO=$(grep -E '^MSM_GITHUB_REPO=' "$ENV_FILE" | cut -d'"' -f2 || echo "")
    AUTO_UPDATE=$(grep -E '^MSM_AUTO_UPDATE=' "$ENV_FILE" | cut -d'=' -f2 || echo "false")
fi

GITHUB_OWNER="${GITHUB_OWNER:-mauntingstudios}"
GITHUB_REPO="${GITHUB_REPO:-maunting-service-manager}"
AUTO_UPDATE="${AUTO_UPDATE:-false}"

# Umzug des offiziellen Repos (10/2026): bestehende .env-Dateien tragen noch
# den alten Owner und den alten Repo-Namen. Nur die exakten alten offiziellen
# Werte werden ersetzt; ein bewusst eingetragener Fork bleibt unangetastet.
if [[ "$GITHUB_OWNER" == "einmalmaik" || "$GITHUB_REPO" == "maunting-server-manager" ]]; then
    if [[ "$GITHUB_OWNER" == "einmalmaik" ]]; then
        GITHUB_OWNER="mauntingstudios"
        if [[ -f "$ENV_FILE" ]]; then
            sed -i 's#^MSM_GITHUB_OWNER=.*#MSM_GITHUB_OWNER="mauntingstudios"#' "$ENV_FILE" 2>/dev/null || true
        fi
    fi
    if [[ "$GITHUB_REPO" == "maunting-server-manager" ]]; then
        GITHUB_REPO="maunting-service-manager"
        if [[ -f "$ENV_FILE" ]]; then
            sed -i 's#^MSM_GITHUB_REPO=.*#MSM_GITHUB_REPO="maunting-service-manager"#' "$ENV_FILE" 2>/dev/null || true
        fi
    fi
    log "Offizielles Repository umgestellt: $GITHUB_OWNER/$GITHUB_REPO"
fi

SYSTEMD_AVAILABLE=false
if [[ -d /run/systemd/system ]] && command -v systemctl &>/dev/null; then
    SYSTEMD_AVAILABLE=true
fi

log "=== Maunting Service Manager Updater ==="
log "Repository: $GITHUB_OWNER/$GITHUB_REPO"
log ""

# ── Root-Check ──
if [[ $EUID -ne 0 ]]; then
    err "Bitte als root ausführen: sudo bash update.sh"
fi

# ── Aktuelle Version und Branch ermitteln ──
CURRENT_VERSION="unknown"
CURRENT_BRANCH="main"
IS_DEV_BRANCH=false
UPDATE_MODE="release"   # "release" oder "git"
LATEST_TAG=""
RELEASE_JSON=""

if [[ -d "$MSM_DIR/.git" ]]; then
    cd "$MSM_DIR"
    CURRENT_VERSION=$(git describe --tags --always --match "v*" 2>/dev/null || echo "unknown")
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    # Falls der aktuelle Branch nicht main/master/HEAD ist, sind wir im Dev-Modus
    if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" && "$CURRENT_BRANCH" != "HEAD" ]]; then
        IS_DEV_BRANCH=true
    fi
fi

log "Aktuelle Version: $CURRENT_VERSION"
if $IS_DEV_BRANCH; then
    log "Entwicklungs-Branch aktiv: $CURRENT_BRANCH (überspringe GitHub Release-Check)"
fi

# ═══════════════════════════════════════════════════════════════
# 1) Zuerst: GitHub Release prüfen (nur wenn kein Dev-Branch aktiv ist)
# ═══════════════════════════════════════════════════════════════
if ! $IS_DEV_BRANCH; then
    log "Prüfe GitHub Releases..."
    RELEASE_JSON=$(curl -s -L \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/releases/latest" 2>/dev/null) || true

    if [[ -n "$RELEASE_JSON" ]] && [[ "$RELEASE_JSON" != *"Not Found"* ]]; then
        LATEST_TAG=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tag_name',''))" 2>/dev/null || echo "")
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 2) Kein Release oder Dev-Branch? → Git-Branch als Fallback/Quelle verwenden
# ═══════════════════════════════════════════════════════════════
if [[ -z "$LATEST_TAG" ]]; then
    if [[ -d "$MSM_DIR/.git" ]]; then
        UPDATE_MODE="git"
        log "Verwende Git-Branch: $CURRENT_BRANCH..."
        cd "$MSM_DIR"
        git fetch origin "$CURRENT_BRANCH" 2>/dev/null || {
            warn "Konnte origin/$CURRENT_BRANCH nicht fetchen. Prüfe Internet-Verbindung."
            if ! $FORCE; then exit 0; fi
        }
        LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
        REMOTE_SHA=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "")

        # Never continue inside a script that is about to overwrite itself.
        # Execute the updater from the target revision in /tmp first.
        if [[ -n "$LOCAL_SHA" && -n "$REMOTE_SHA" && "$LOCAL_SHA" != "$REMOTE_SHA" ]] \
            && [[ "${MSM_UPDATE_STAGE2:-}" != "1" ]]; then
            NEXT_UPDATER="/tmp/msm-update-${REMOTE_SHA:0:12}.sh"
            git show "${REMOTE_SHA}:update.sh" > "$NEXT_UPDATER" \
                || err "Updater der Zielversion konnte nicht geladen werden."
            chmod 700 "$NEXT_UPDATER"
            bash -n "$NEXT_UPDATER" \
                || err "Updater der Zielversion ist syntaktisch ungültig."
            log "Übergabe an geprüften Updater der Zielversion..."
            export MSM_UPDATE_STAGE2=1
            exec bash "$NEXT_UPDATER" "$@"
        fi

        if [[ -z "$LOCAL_SHA" ]] || [[ -z "$REMOTE_SHA" ]]; then
            warn "Konnte Git-Commits nicht ermitteln."
            if ! $FORCE; then exit 0; fi
            LATEST_TAG="unknown"
        elif [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]] && ! $FORCE; then
            if $SYSTEMD_AVAILABLE && ! $CHECK_ONLY \
                && [[ -d "$MSM_DIR/wetter-sidecar" ]] \
                && { [[ ! -f /etc/systemd/system/msm-wetter.service ]] \
                    || ! systemctl is-enabled --quiet msm-wetter.service 2>/dev/null; }; then
                # 5.6.0 -> 5.7.0 hat das Verzeichnis kopiert, aber die Unit mit
                # dem alten Updater nicht angelegt. Ein zweiter Lauf stieg hier
                # bisher aus und ließ den Sidecar dauerhaft aus.
                warn "Wetter-Sidecar ist vorhanden, aber nicht als Dienst eingerichtet; der Lauf richtet ihn jetzt ein."
                FORCE=true
                LATEST_TAG="$CURRENT_BRANCH-${REMOTE_SHA:0:8}"
            else
                ok "Panel ist bereits auf dem neuesten Stand ($CURRENT_BRANCH: ${LOCAL_SHA:0:8})."
                # Recovery: ein frueherer Run (z.B. mit der alten update.sh ohne
                # Chown-Fix) kann Dateien als root zurueckgelassen haben. Bevor wir
                # frueh aussteigen, stellen wir Besitz wieder her, damit der
                # Panel-Service als msm-User schreibend zugreifen kann.
                restore_panel_ownership
                exit 0
            fi
        else
            LATEST_TAG="$CURRENT_BRANCH-${REMOTE_SHA:0:8}"
            log "Neuer Commit auf $CURRENT_BRANCH: ${REMOTE_SHA:0:8}"
        fi
    else
        warn "Kein GitHub-Release und kein Git-Repo gefunden."
        if ! $FORCE; then exit 0; fi
        LATEST_TAG="unknown"
    fi
else
    log "Neueste Release: $LATEST_TAG"
fi

# ── Vergleich (nur bei Release-Mode) ──
if [[ "$UPDATE_MODE" == "release" ]] && [[ "$(normalize_version "$CURRENT_VERSION")" == "$(normalize_version "$LATEST_TAG")" ]] && ! $FORCE; then
    if $SYSTEMD_AVAILABLE && ! $CHECK_ONLY \
        && [[ -d "$MSM_DIR/wetter-sidecar" ]] \
        && { [[ ! -f /etc/systemd/system/msm-wetter.service ]] \
            || ! systemctl is-enabled --quiet msm-wetter.service 2>/dev/null; }; then
        # Siehe Git-Pfad: eine bestehende 5.7.0-Installation holt die fehlende
        # Wetter-Unit beim nächsten Lauf nach, statt vorher auszusteigen.
        warn "Wetter-Sidecar ist vorhanden, aber nicht als Dienst eingerichtet; der Lauf richtet ihn jetzt ein."
        FORCE=true
    else
        ok "Panel ist bereits auf dem neuesten Stand ($CURRENT_VERSION)."
        # Recovery wie im Git-Pfad: Besitz zurueck auf msm, falls ein frueherer
        # Run Dateien als root liegen gelassen hat.
        restore_panel_ownership
        exit 0
    fi
fi

# ── Nur prüfen? ──
if $CHECK_ONLY; then
    echo ""
    if [[ "$UPDATE_MODE" == "git" ]]; then
        echo -e "${YELLOW}Update verfügbar auf $CURRENT_BRANCH!${NC}"
        echo -e "  Aktuell: ${CYAN}${LOCAL_SHA:0:8}${NC}"
        echo -e "  Neu:     ${CYAN}${REMOTE_SHA:0:8}${NC}"
    else
        echo -e "${YELLOW}Update verfügbar!${NC}"
        echo -e "  Aktuell: ${CYAN}$CURRENT_VERSION${NC}"
        echo -e "  Neu:     ${CYAN}$LATEST_TAG${NC}"
    fi
    echo -e "  Installieren: ${BOLD}sudo bash update.sh${NC}"
    echo ""
    exit 0
fi

# ── Auto-Update deaktiviert? ──
if [[ "$AUTO_UPDATE" != "true" ]] && ! $FORCE; then
    warn "Automatisches Update ist deaktiviert."
    echo "  Setze MSM_AUTO_UPDATE=true in $ENV_FILE"
    echo "  Oder führe aus: sudo bash update.sh --force"
    exit 0
fi

# ═══════════════════════════════════════════════════════════════
# Update durchführen
# ═══════════════════════════════════════════════════════════════

echo ""
if [[ "$UPDATE_MODE" == "git" ]]; then
    echo -e "${YELLOW}Update wird installiert:${NC} $CURRENT_BRANCH ${LOCAL_SHA:0:8} → ${REMOTE_SHA:0:8}"
else
    echo -e "${YELLOW}Update wird installiert:${NC} $CURRENT_VERSION → $LATEST_TAG"
fi
echo ""

# ── Backup ──
log "Erstelle Backup..."
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/msm-backup-$(date +%Y%m%d-%H%M%S).tar.gz"

tar -czf "$BACKUP_FILE" \
    -C "$MSM_DIR" \
    --exclude=venv \
    --exclude=node_modules \
    --exclude=__pycache__ \
    --exclude='*.db' \
    --exclude='*.db.*' \
    backend frontend 2>>"$LOG_FILE" \
    || err "Code-/Konfigurationsbackup fehlgeschlagen."
[[ -s "$BACKUP_FILE" ]] || err "Code-/Konfigurationsbackup ist leer."

# PostgreSQL is the only panel database. A remaining SQLite installation has to
# move with an older MSM release first; this version no longer carries the import.
CURRENT_DATABASE_URL=$(grep -E '^MSM_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
if [[ "$CURRENT_DATABASE_URL" != postgresql* ]]; then
    err "Die Panel-Datenbank ist keine PostgreSQL-Datenbank (MSM_DATABASE_URL). SQLite wird nicht mehr unterstützt — zuerst mit einer älteren MSM-Version nach PostgreSQL umziehen."
fi
DB_BACKUP_FILE="$BACKUP_DIR/msm-postgres-$(date +%Y%m%d-%H%M%S).dump"
DB_BACKUP_HELPER="/tmp/msm-update-db-backup.py"
if [[ "$UPDATE_MODE" == "git" ]]; then
    git show "${REMOTE_SHA}:backend/scripts/update_database_backup.py" > "$DB_BACKUP_HELPER" \
        || err "PostgreSQL-Backuphelfer der Zielversion fehlt."
elif [[ -f "$MSM_DIR/backend/scripts/update_database_backup.py" ]]; then
    cp "$MSM_DIR/backend/scripts/update_database_backup.py" "$DB_BACKUP_HELPER"
else
    curl -fsSL \
        "https://raw.githubusercontent.com/$GITHUB_OWNER/$GITHUB_REPO/$LATEST_TAG/backend/scripts/update_database_backup.py" \
        -o "$DB_BACKUP_HELPER" || err "PostgreSQL-Backuphelfer konnte nicht geladen werden."
fi
python3 -m py_compile "$DB_BACKUP_HELPER" \
    || err "PostgreSQL-Backuphelfer ist ungültig."
python3 "$DB_BACKUP_HELPER" --env-file "$ENV_FILE" --output "$DB_BACKUP_FILE" \
    2>&1 | tee -a "$LOG_FILE" || err "PostgreSQL-Sicherung fehlgeschlagen. Update abgebrochen."

ok "Code-/Konfigurationsbackup erstellt: $BACKUP_FILE"
ok "Datenbank-Backup erstellt und verifiziert: $DB_BACKUP_FILE"

# ── Git Pull oder Tarball ──
cd "$MSM_DIR"

if [[ "$UPDATE_MODE" == "git" ]]; then
    log "Aktualisiere via Git pull..."
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
        err "Lokale Änderungen erkannt. Update sicher abgebrochen; bitte Änderungen zuerst sichern."
    fi
    git pull --ff-only origin "$CURRENT_BRANCH" \
        || err "Git-Update ist kein sicherer Fast-Forward und wurde abgebrochen."
    # Alte Build-Artefakte entfernen (nur dist/, keine Server-Daten!)
    rm -rf frontend/dist 2>/dev/null || true
    # git pull lief als root -> neue/geaenderte Dateien sind jetzt root-owned.
    # Ohne den folgenden Chown scheitert `su - msm -c 'npm install'` mit EACCES
    # auf z.B. frontend/package-lock.json.
    restore_panel_ownership
elif [[ -d ".git" ]]; then
    log "Aktualisiere via Git checkout..."
    git fetch origin --tags --force
    git checkout "$LATEST_TAG" || {
        err "Konnte nicht auf $LATEST_TAG wechseln. Rollback..."
        git checkout "$CURRENT_VERSION" 2>/dev/null || true
        exit 1
    }
    restore_panel_ownership
else
    log "Lade Release-Tarball..."
    readarray -t RELEASE_URLS < <(echo "$RELEASE_JSON" | python3 -c '
import sys, json
data = json.load(sys.stdin)
expected = "msm-panel-{}.tar.gz".format(data.get("tag_name", ""))
tarball_url = ""
checksum_url = ""
for asset in data.get("assets", []):
    if asset.get("name") == expected:
        tarball_url = asset.get("browser_download_url", "")
    elif asset.get("name") == "SHA256SUMS":
        checksum_url = asset.get("browser_download_url", "")
print(tarball_url)
print(checksum_url)
' 2>/dev/null || true)
    TARBALL_URL="${RELEASE_URLS[0]:-}"
    CHECKSUM_URL="${RELEASE_URLS[1]:-}"

    if [[ -z "$TARBALL_URL" || -z "$CHECKSUM_URL" ]]; then
        warn "Kein vollständig prüfbares Panel-Artefakt gefunden. Versuche git clone..."
        git clone --depth 1 --branch "$LATEST_TAG" \
            "https://github.com/$GITHUB_OWNER/$GITHUB_REPO.git" /tmp/msm-update
        cp -r /tmp/msm-update/* "$MSM_DIR/"
        rm -rf /tmp/msm-update
    else
        RELEASE_TMP=$(mktemp -d /tmp/msm-release-update.XXXXXX)
        PANEL_ASSET="msm-panel-$LATEST_TAG.tar.gz"
        curl -fsSL "$TARBALL_URL" -o "$RELEASE_TMP/$PANEL_ASSET" \
            || err "Panel-Release konnte nicht geladen werden."
        curl -fsSL "$CHECKSUM_URL" -o "$RELEASE_TMP/SHA256SUMS" \
            || err "Release-Prüfsummen konnten nicht geladen werden."
        awk -v expected="$PANEL_ASSET" \
            '$2 == expected && $1 ~ /^[[:xdigit:]]{64}$/ { print; found=1 } END { exit found ? 0 : 1 }' \
            "$RELEASE_TMP/SHA256SUMS" > "$RELEASE_TMP/panel.sha256" \
            || err "Prüfsumme für Panel-Artefakt fehlt oder ist ungültig."
        (cd "$RELEASE_TMP" && sha256sum --check panel.sha256) \
            || err "Panel-Release hat eine ungültige Prüfsumme."
        tar -xzf "$RELEASE_TMP/$PANEL_ASSET" -C "$RELEASE_TMP" \
            || err "Panel-Release konnte nicht sicher entpackt werden."
        EXTRACTED="$RELEASE_TMP/mauntingservermanager-$LATEST_TAG"
        [[ -d "$EXTRACTED/backend" && -f "$EXTRACTED/update.sh" ]] \
            || err "Panel-Release hat nicht die erwartete Struktur."
        cp -r "$EXTRACTED"/. "$MSM_DIR/"
        rm -rf "$RELEASE_TMP"
    fi
    restore_panel_ownership
fi

# ── sudoers + iptables-Wrapper direkt als root schreiben (Sicherheitsfix) ──
# Nie aus dem (nach restore_panel_ownership) msm-owned $MSM_DIR lesen.
# Direkte Heredocs als root (Wrapper + Policy). SSOT im Repo bleibt Review-Master.
if [[ -d /etc/sudoers.d ]]; then
    log "Aktualisiere sudoers-Regeln..."
    mkdir -p /usr/local/sbin
    # Wrapper direkt als root (inkl. apply-isolation + quota)
    cat > /usr/local/sbin/msm-iptables <<'WRAPEOF'
#!/bin/sh
set -eu
IPT="/usr/sbin/iptables"
if [ ! -x "$IPT" ]; then
    IPT="$(command -v iptables 2>/dev/null || echo /usr/sbin/iptables)"
fi
if [ $# -eq 0 ]; then
    printf 'msm-iptables: refused disallowed invocation (no args)\n' >&2
    exit 1
fi
case "${1:-}" in
    --version)
        exec "$IPT" "$@"
        ;;
    -L)
        if [ $# -eq 3 ] && [ "${2:-}" = "DOCKER-USER" ] && [ "${3:-}" = "-n" ]; then
            exec "$IPT" "$@"
        fi
        ;;
    -C|-A|-D|-I)
        if [ "${2:-}" = "DOCKER-USER" ]; then
            exec "$IPT" "$@"
        fi
        ;;
    apply-isolation)
        if [ $# -eq 2 ]; then
            exec /usr/bin/python3 - "$2" <<'PYEOF'
import ipaddress, json, os, pwd, re, shutil, subprocess, sys
IPT = shutil.which("iptables") or "/usr/sbin/iptables"
IPT6 = shutil.which("ip6tables") or "/usr/sbin/ip6tables"
NSENTER = shutil.which("nsenter") or "/usr/bin/nsenter"
CHAIN_EGRESS, CHAIN_ISO, CHAIN_OUT = "MSM-EGRESS-BLOCK", "MSM-ISOLATION", "MSM-DOCKER-OUTPUT"
BRIDGE_RE = re.compile(r"^(docker0|br-[0-9a-f]{12})$")

def _norm_nets(items, *, v6=False, limit=128):
    if not isinstance(items, list) or len(items) > limit:
        raise ValueError("invalid network list")
    cls = ipaddress.IPv6Network if v6 else ipaddress.IPv4Network
    return [str(cls(str(i).strip(), strict=False)) for i in items]

def _parse(raw):
    p = json.loads(raw)
    if not isinstance(p, dict):
        raise ValueError("plan must be JSON object")
    grants = []
    for g in (p.get("db_allows") or [])[:512]:
        port = int(g["port"])
        if port < 1 or port > 65535:
            raise ValueError("invalid port")
        grants.append((
            str(ipaddress.IPv4Network(str(g["src"]).strip(), strict=False)),
            str(ipaddress.IPv4Network(str(g["dst"]).strip(), strict=False)),
            str(port),
        ))
    bridges = []
    for b in (p.get("icc_drop_bridges") or [])[:512]:
        bs = str(b).strip()
        if not BRIDGE_RE.match(bs):
            raise ValueError("invalid bridge")
        bridges.append(bs)
    gws = [f"{ipaddress.IPv4Address(str(g).strip().split('/', 1)[0])}/32" for g in (p.get("dns_gateways") or [])[:128]]
    return {
        "blocked_v4": _norm_nets(p.get("blocked_v4") or []),
        "blocked_v6": _norm_nets(p.get("blocked_v6") or [], v6=True),
        "sources": _norm_nets(p.get("container_sources") or [], limit=64),
        "gateways": list(dict.fromkeys(gws)),
        "grants": grants,
        "bridges": list(dict.fromkeys(bridges)),
    }

def _run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=10)

def _apply_nf(prefix, binary, data, *, v6=False):
    cmds = [["-N", CHAIN_EGRESS], ["-F", CHAIN_EGRESS], ["-N", CHAIN_ISO], ["-F", CHAIN_ISO], ["-N", "DOCKER-USER"]]
    if v6:
        for c in data["blocked_v6"]:
            cmds.append(["-A", CHAIN_EGRESS, "-d", c, "-j", "DROP"])
        cmds += [["-A", CHAIN_EGRESS, "-j", "RETURN"], ["-A", CHAIN_ISO, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"], ["-A", CHAIN_ISO, "-i", "br-+", "-j", CHAIN_EGRESS], ["-A", CHAIN_ISO, "-i", "docker0", "-j", CHAIN_EGRESS], ["-A", CHAIN_ISO, "-j", "RETURN"]]
    else:
        for c in data["blocked_v4"]:
            cmds.append(["-A", CHAIN_EGRESS, "-d", c, "-j", "DROP"])
        cmds += [["-A", CHAIN_EGRESS, "-j", "RETURN"], ["-A", CHAIN_ISO, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"]]
        for s, d, port in data["grants"]:
            cmds.append(["-A", CHAIN_ISO, "-s", s, "-d", d, "-p", "tcp", "--dport", port, "-j", "ACCEPT"])
        for gw in data["gateways"]:
            for proto in ("udp", "tcp"):
                cmds.append(["-A", CHAIN_ISO, "-d", gw, "-p", proto, "--dport", "53", "-j", "ACCEPT"])
        for br in data["bridges"]:
            cmds.append(["-A", CHAIN_ISO, "-i", br, "-o", br, "-j", "DROP"])
        for sn in data["sources"]:
            cmds.append(["-A", CHAIN_ISO, "-s", sn, "-j", CHAIN_EGRESS])
        cmds += [["-A", CHAIN_ISO, "-i", "br-+", "-j", CHAIN_EGRESS], ["-A", CHAIN_ISO, "-i", "docker0", "-j", CHAIN_EGRESS], ["-A", CHAIN_ISO, "-j", "RETURN"]]
    for a in cmds:
        r = _run([*prefix, binary, "-w", "5", *a])
        if r.returncode != 0 and a[0] != "-N":
            return False
    if _run([*prefix, binary, "-w", "5", "-C", "DOCKER-USER", "-j", CHAIN_ISO]).returncode != 0:
        if _run([*prefix, binary, "-w", "5", "-I", "DOCKER-USER", "1", "-j", CHAIN_ISO]).returncode != 0:
            return False
    return True

def _resolv_ns():
    v4, v6 = ["127.0.0.53", "127.0.0.1"], ["::1"]
    try:
        with open("/etc/resolv.conf", "r", encoding="utf-8") as fh:
            for line in fh:
                parts = line.strip().split()
                if len(parts) >= 2 and parts[0] == "nameserver":
                    try:
                        ip = ipaddress.ip_address(parts[1])
                        (v4 if ip.version == 4 else v6).append(str(ip))
                    except ValueError:
                        pass
    except OSError:
        pass
    return list(dict.fromkeys(v4)), list(dict.fromkeys(v6))

def _apply_output_guard(data):
    try:
        uid = str(pwd.getpwnam("msm-docker").pw_uid)
    except KeyError:
        return True
    ns4, ns6 = _resolv_ns()
    cmds = [["-N", CHAIN_OUT], ["-F", CHAIN_OUT], ["-A", CHAIN_OUT, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"]]
    for ns in ns4:
        for proto in ("udp", "tcp"):
            cmds.append(["-A", CHAIN_OUT, "-d", f"{ns}/32", "-p", proto, "--dport", "53", "-j", "ACCEPT"])
    for c in data["blocked_v4"]:
        cmds.append(["-A", CHAIN_OUT, "-d", c, "-j", "DROP"])
    cmds.append(["-A", CHAIN_OUT, "-j", "RETURN"])
    for a in cmds:
        r = _run([IPT, "-w", "5", *a])
        if r.returncode != 0 and a[0] != "-N":
            return False
    if _run([IPT, "-w", "5", "-C", "OUTPUT", "-m", "owner", "--uid-owner", uid, "-j", CHAIN_OUT]).returncode != 0:
        _run([IPT, "-w", "5", "-I", "OUTPUT", "1", "-m", "owner", "--uid-owner", uid, "-j", CHAIN_OUT])
    if os.path.exists(IPT6):
        c6 = [["-N", CHAIN_OUT], ["-F", CHAIN_OUT], ["-A", CHAIN_OUT, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"]]
        for ns in ns6:
            for proto in ("udp", "tcp"):
                c6.append(["-A", CHAIN_OUT, "-d", f"{ns}/128", "-p", proto, "--dport", "53", "-j", "ACCEPT"])
        for c in data["blocked_v6"]:
            c6.append(["-A", CHAIN_OUT, "-d", c, "-j", "DROP"])
        c6.append(["-A", CHAIN_OUT, "-j", "RETURN"])
        for a in c6:
            _run([IPT6, "-w", "5", *a])
        if _run([IPT6, "-w", "5", "-C", "OUTPUT", "-m", "owner", "--uid-owner", uid, "-j", CHAIN_OUT]).returncode != 0:
            _run([IPT6, "-w", "5", "-I", "OUTPUT", "1", "-m", "owner", "--uid-owner", uid, "-j", CHAIN_OUT])
    return True

def _rootless_pids():
    try:
        self_ns = os.readlink("/proc/self/ns/net")
    except OSError:
        return []
    out = []
    for ent in os.listdir("/proc"):
        if not ent.isdigit():
            continue
        pid = int(ent)
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as fh:
                cmd = fh.read().replace(b"\x00", b" ").decode("utf-8", "ignore").lower()
            if ("rootlesskit" in cmd or "dockerd-rootless" in cmd) and os.readlink(f"/proc/{pid}/ns/net") != self_ns:
                out.append(pid)
        except OSError:
            continue
    return out

parsed = _parse(sys.argv[1])
ok = _apply_nf([], IPT, parsed, v6=False)
if os.path.exists(IPT6):
    _apply_nf([], IPT6, parsed, v6=True)
for rpid in _rootless_pids():
    pfx = [NSENTER, "--user", "--net", "-t", str(rpid)]
    if _apply_nf(pfx, IPT, parsed, v6=False):
        ok = True
    if os.path.exists(IPT6):
        _apply_nf(pfx, IPT6, parsed, v6=True)
sys.exit(0 if (ok and _apply_output_guard(parsed)) else 1)
PYEOF
        fi
        ;;
esac
printf 'msm-iptables: refused disallowed invocation\n' >&2
exit 1
WRAPEOF
    chown root:root /usr/local/sbin/msm-iptables
    chmod 755 /usr/local/sbin/msm-iptables

    cat > /usr/local/sbin/msm-quota <<'QUOTAEOF'
#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="${MSM_QUOTA_SERVERS_DIR:-/opt/msm/servers}"
IMG_DIR="${MSM_QUOTA_IMAGE_DIR:-/var/lib/msm-quotas}"
FSTAB_FILE="/etc/fstab"
validate_sid() { case "${1:-}" in ""|*[!0-9]*|0*) return 1 ;; esac; }
validate_limit_mb() { case "${1:-}" in ""|*[!0-9]*|0*) return 1 ;; esac; [ "$1" -ge 1024 ] && [ "$1" -le 104857600 ]; }
resolve_owners() {
    AGENT_USER=$(id -u msm-agent >/dev/null 2>&1 && echo msm-agent || echo msm)
    DOCKER_USER=$(id -u msm-docker >/dev/null 2>&1 && echo msm-docker || echo "$AGENT_USER")
    SERVERS_GROUP=$(getent group msm-servers >/dev/null 2>&1 && echo msm-servers || echo "$AGENT_USER")
}
apply_shared_acl() {
    local target="$1"
    resolve_owners
    chown "$DOCKER_USER:$SERVERS_GROUP" "$target"
    chmod 2770 "$target"
    command -v setfacl >/dev/null 2>&1 && setfacl -R -m "u:${AGENT_USER}:rwX,u:${DOCKER_USER}:rwX,d:u:${AGENT_USER}:rwX,d:u:${DOCKER_USER}:rwX,m::rwx" "$target" 2>/dev/null || true
}
ensure_safe_dir() {
    local sid="$1"
    [ ! -L "$BASE_DIR" ] || exit 1
    mkdir -p "$BASE_DIR"
    local srv_dir="${BASE_DIR}/${sid}"
    [ ! -L "$srv_dir" ] || exit 1
    mkdir -p "$srv_dir"
    local rb rs
    rb="$(readlink -f "$BASE_DIR")"; rs="$(readlink -f "$srv_dir")"
    [ "$rs" = "${rb}/${sid}" ] || exit 1
    SRV_DIR="$rs"
}
rm_fstab() {
    local marker="# MSM-QUOTA-SRV-${1}"
    [ -f "$FSTAB_FILE" ] || return 0
    if grep -qF "$marker" "$FSTAB_FILE" 2>/dev/null; then
        local t; t="$(mktemp /tmp/msm-fstab.XXXXXX)"
        grep -vF "$marker" "$FSTAB_FILE" > "$t" || true
        cat "$t" > "$FSTAB_FILE"; rm -f "$t"
    fi
}
case "${1:-}" in
    --version) printf 'msm-quota 1.0\n'; exit 0 ;;
    apply-prjquota)
        [ $# -eq 3 ] && validate_sid "$2" && validate_limit_mb "$3" || exit 2
        ensure_safe_dir "$2"; proj_id=$((10000 + $2))
        mnt="$(findmnt -rn -T "$SRV_DIR" -o TARGET | head -n1)"
        fstype="$(findmnt -rn -T "$SRV_DIR" -o FSTYPE | head -n1)"
        opts="$(findmnt -rn -T "$SRV_DIR" -o OPTIONS | head -n1)"
        case ",${opts}," in *,prjquota,*|*,pquota,*|*,uqnoenforce,*) ;; *) exit 3 ;; esac
        apply_shared_acl "$SRV_DIR"
        if [ "$fstype" = "xfs" ] && command -v xfs_quota >/dev/null 2>&1; then
            xfs_quota -x -c "project -s -p ${SRV_DIR} ${proj_id}" "$mnt"
            xfs_quota -x -c "limit -p bsoft=${3}m bhard=${3}m ${proj_id}" "$mnt"
            exit 0
        elif [ "$fstype" = "ext4" ] && command -v chattr >/dev/null 2>&1 && command -v setquota >/dev/null 2>&1; then
            chattr -R +P -p "$proj_id" "$SRV_DIR"; kb=$(($3 * 1024))
            setquota -P "$proj_id" "$kb" "$kb" 0 0 "$mnt"
            exit 0
        fi
        exit 3
        ;;
    apply-loopback)
        [ $# -eq 3 ] && validate_sid "$2" && validate_limit_mb "$3" || exit 2
        ensure_safe_dir "$2"; mkdir -p "$IMG_DIR"; chmod 0700 "$IMG_DIR"
        img="${IMG_DIR}/srv-${2}.img"; marker="# MSM-QUOTA-SRV-${2}"
        msrc="$(findmnt -rn -M "$SRV_DIR" -o SOURCE 2>/dev/null | head -n1 || true)"
        if [ -n "$msrc" ]; then
            cb="$(stat -c '%s' "$img" 2>/dev/null || echo 0)"; cm=$((cb / 1048576))
            if [ "$3" -gt "$cm" ]; then
                truncate -s "${3}M" "$img"; losetup -c "$msrc" 2>/dev/null || true; resize2fs "$msrc" >/dev/null
            elif [ "$3" -lt "$cm" ]; then
                umount "$SRV_DIR"; e2fsck -fy "$img" >/dev/null 2>&1 || true; resize2fs "$img" "${3}M" >/dev/null
                truncate -s "${3}M" "$img"; mount -o loop,nosuid,nodev "$img" "$SRV_DIR"
            fi
        else
            [ -f "$img" ] || { truncate -s "${3}M" "$img"; mkfs.ext4 -q -F "$img"; }
            if [ -n "$(ls -A "$SRV_DIR" 2>/dev/null || true)" ]; then
                st="$(mktemp -d /run/msm-quota-stage.XXXXXX)"
                mount -o loop,nosuid,nodev "$img" "$st"
                cp -a "${SRV_DIR}/." "${st}/"
                umount "$st"; rmdir "$st"
                find "$SRV_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
            fi
            mount -o loop,nosuid,nodev "$img" "$SRV_DIR"
        fi
        rm_fstab "$2"; printf '%s %s ext4 loop,nosuid,nodev,nofail 0 0 %s\n' "$img" "$SRV_DIR" "$marker" >> "$FSTAB_FILE"
        apply_shared_acl "$SRV_DIR"
        ;;
    remove)
        [ $# -eq 2 ] && validate_sid "$2" || exit 2
        srv_dir="${BASE_DIR}/${2}"; img="${IMG_DIR}/srv-${2}.img"
        mountpoint -q "$srv_dir" 2>/dev/null && { umount "$srv_dir" 2>/dev/null || umount -l "$srv_dir" 2>/dev/null || true; }
        rm_fstab "$2"
        if [ -f "$img" ]; then
            command -v losetup >/dev/null 2>&1 && for dev in $(losetup -j "$img" | cut -d: -f1); do losetup -d "$dev" 2>/dev/null || true; done
            rm -f "$img"
        fi
        if [ -d "$srv_dir" ] && [ ! -L "$srv_dir" ]; then
            mnt="$(findmnt -rn -T "$srv_dir" -o TARGET | head -n1 || true)"
            fstype="$(findmnt -rn -T "$srv_dir" -o FSTYPE | head -n1 || true)"
            proj_id=$((10000 + $2))
            [ "$fstype" = "xfs" ] && command -v xfs_quota >/dev/null 2>&1 && [ -n "$mnt" ] && xfs_quota -x -c "limit -p bsoft=0 bhard=0 ${proj_id}" "$mnt" 2>/dev/null || true
            [ "$fstype" = "ext4" ] && command -v setquota >/dev/null 2>&1 && [ -n "$mnt" ] && setquota -P "$proj_id" 0 0 0 0 "$mnt" 2>/dev/null || true
        fi
        ;;
    *) printf 'msm-quota: disallowed invocation\n' >&2; exit 1 ;;
esac
QUOTAEOF
    chown root:root /usr/local/sbin/msm-quota
    chmod 755 /usr/local/sbin/msm-quota

    # Caddy-Wrapper (Root-Gate für Caddyfile-Konfigurationen)
    cat > /usr/local/sbin/msm-caddy <<'CADDYEOF'
#!/bin/sh
# MSM Caddy wrapper — thin, root-owned privilege gate for Caddy vhost management.
set -eu
STAGING_DIR="/opt/msm/caddy-staging"
CADDY_CONF_DIR="/etc/caddy/conf.d"
CADDYFILE="/etc/caddy/Caddyfile"
if [ $# -eq 0 ]; then
    printf 'msm-caddy: refused disallowed invocation (no args)\n' >&2
    exit 1
fi
ACTION="${1:-}"
validate_server_id() {
    sid="${1:-}"
    case "$sid" in
        ''|*[!0-9]*)
            printf 'msm-caddy: invalid server_id: %s\n' "$sid" >&2
            exit 1
            ;;
    esac
}
case "$ACTION" in
    apply)
        if [ $# -ne 2 ]; then
            printf 'msm-caddy: usage: msm-caddy apply <server_id>\n' >&2
            exit 1
        fi
        SERVER_ID="$2"
        validate_server_id "$SERVER_ID"
        SOURCE_FILE="${STAGING_DIR}/app_${SERVER_ID}.conf"
        TARGET_FILE="${CADDY_CONF_DIR}/app_${SERVER_ID}.conf"
        TMP_FILE="${CADDY_CONF_DIR}/.app_${SERVER_ID}.conf.tmp"
        if [ ! -f "$SOURCE_FILE" ]; then
            printf 'msm-caddy: staging file not found: %s\n' "$SOURCE_FILE" >&2
            exit 1
        fi
        mkdir -p "$CADDY_CONF_DIR"
        cp "$SOURCE_FILE" "$TMP_FILE"
        chmod 0640 "$TMP_FILE"
        if getent group caddy >/dev/null 2>&1; then
            chown root:caddy "$TMP_FILE"
        else
            chown root:root "$TMP_FILE"
        fi
        mv -f "$TMP_FILE" "$TARGET_FILE"
        if [ -f "$CADDYFILE" ] && command -v caddy >/dev/null 2>&1; then
            VAL_OUTPUT=""
            if ! VAL_OUTPUT=$(caddy validate --config "$CADDYFILE" --adapter caddyfile 2>&1); then
                printf 'msm-caddy: caddy validate failed for server %s: %s\n' "$SERVER_ID" "$VAL_OUTPUT" >&2
                rm -f "$TARGET_FILE"
                exit 1
            fi
        fi
        if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
            systemctl reload caddy
        elif command -v caddy >/dev/null 2>&1; then
            caddy reload --config "$CADDYFILE" --adapter caddyfile 2>/dev/null || true
        fi
        exit 0
        ;;
    remove)
        if [ $# -ne 2 ]; then
            printf 'msm-caddy: usage: msm-caddy remove <server_id>\n' >&2
            exit 1
        fi
        SERVER_ID="$2"
        validate_server_id "$SERVER_ID"
        rm -f "${CADDY_CONF_DIR}/app_${SERVER_ID}.conf"
        rm -f "${STAGING_DIR}/app_${SERVER_ID}.conf"
        if [ -f "$CADDYFILE" ] && command -v caddy >/dev/null 2>&1; then
            caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || true
        fi
        if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
            systemctl reload caddy 2>/dev/null || true
        elif command -v caddy >/dev/null 2>&1; then
            caddy reload --config "$CADDYFILE" --adapter caddyfile 2>/dev/null || true
        fi
        exit 0
        ;;
    reload)
        if [ -f "$CADDYFILE" ] && command -v caddy >/dev/null 2>&1; then
            VAL_OUTPUT=""
            if ! VAL_OUTPUT=$(caddy validate --config "$CADDYFILE" --adapter caddyfile 2>&1); then
                printf 'msm-caddy: caddy validate failed during reload: %s\n' "$VAL_OUTPUT" >&2
                exit 1
            fi
        fi
        if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
            systemctl reload caddy
        elif command -v caddy >/dev/null 2>&1; then
            caddy reload --config "$CADDYFILE" --adapter caddyfile
        fi
        exit 0
        ;;
    *)
        printf 'msm-caddy: refused disallowed invocation: %s\n' "$*" >&2
        exit 1
        ;;
esac
CADDYEOF
    chown root:root /usr/local/sbin/msm-caddy
    chmod 755 /usr/local/sbin/msm-caddy
    mkdir -p /opt/msm/caddy-staging
    chown msm:msm /opt/msm/caddy-staging 2>/dev/null || true

    # Policy direkt als root (nur Firewall- und Caddy-Gates, kein Container-systemctl)
    cat > /etc/sudoers.d/msm-panel <<'SUDOEOF'
# MSM Panel — Firewall (UFW/iptables) & Caddy wrapper
# Deployed via root heredoc (never from msm-writable tree at update time).

Defaults:msm !authenticate

# UFW (exact; delete tightened)
msm ALL=(root) NOPASSWD: /usr/sbin/ufw --version
msm ALL=(root) NOPASSWD: /usr/sbin/ufw allow [0-9]*/[a-z]* comment *
msm ALL=(root) NOPASSWD: /usr/sbin/ufw delete allow [0-9]*/[a-z]*
msm ALL=(root) NOPASSWD: /usr/sbin/ufw status
msm ALL=(root) NOPASSWD: /usr/sbin/ufw status numbered

# iptables ONLY via vetted wrapper
msm ALL=(root) NOPASSWD: /usr/local/sbin/msm-iptables
msm ALL=(root) NOPASSWD: /usr/local/sbin/msm-caddy
msm ALL=(root) NOPASSWD: /opt/msm/update.sh
SUDOEOF
    chmod 440 /etc/sudoers.d/msm-panel

    cat > /etc/sudoers.d/msm-agent <<'AGENTSUDOEOF'
# MSM Agent — Firewall & Disk Quota Privilege Boundary
Defaults:msm-agent !authenticate

msm-agent ALL=(root) NOPASSWD: /usr/local/sbin/msm-iptables
msm-agent ALL=(root) NOPASSWD: /usr/local/sbin/msm-quota
msm-agent ALL=(root) NOPASSWD: /usr/local/sbin/msm-agent-firewall *
AGENTSUDOEOF
    chmod 440 /etc/sudoers.d/msm-agent

    # Validierung des Caddy-Root-Helfers
    sudo -u msm sudo -n /usr/local/sbin/msm-caddy reload >/dev/null 2>&1 || true
    ok "sudoers aktualisiert (direkt als root + Wrapper, ohne Container-systemctl)"
fi


# ── Backups-Verzeichnis sicherstellen ──
mkdir -p /opt/msm/backups
chown msm:msm /opt/msm/backups 2>/dev/null || true

# ── Tresor-Cloud-Verzeichnis sicherstellen ──
install -d -o msm -g msm -m 700 /opt/msm/vault-blobs 2>/dev/null || true

# ── Backend aktualisieren ──
log "Aktualisiere Python-Abhängigkeiten..."
prepare_app_venv "$MSM_DIR/backend" "Python-Backend" false
ok "Backend Dependencies aktualisiert"

# Lokales Embeddingmodell fuer die KI-Gedaechtnissuche (~470 MB).
# Bewusst hier und nicht zur Laufzeit: das Panel laedt im Betrieb niemals
# Gewichte aus dem Internet nach. Ein Fehlschlag bricht das Update nicht ab —
# ohne Modell laeuft die Suche ohne Vektoren weiter.
log "Stelle KI-Embeddingmodell bereit (einmalig, ~470 MB)..."
su - msm -c "
    cd $MSM_DIR/backend
    source venv/bin/activate
    python3 scripts/fetch_embedding_model.py
" 2>&1 | tee -a "$LOG_FILE" || warn "Embeddingmodell nicht verfuegbar - KI-Gedaechtnis laeuft ohne Vektoren."


# ── 3-User-Privilegientrennung & Kernel/Systemd/DB-Härten sicherstellen ──
if ! command -v setfacl &>/dev/null || ! command -v quota &>/dev/null; then
    apt-get install -y -qq acl quota e2fsprogs 2>/dev/null || true
fi
if ! id "$MSM_AGENT_USER" &>/dev/null; then
    useradd -r -m -s /usr/sbin/nologin -d /var/lib/msm-agent "$MSM_AGENT_USER"
fi
if ! id "$MSM_DOCKER_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash -d "$MSM_DOCKER_HOME" "$MSM_DOCKER_USER"
fi
if ! getent group "$MSM_SERVERS_GROUP" &>/dev/null; then
    groupadd -r "$MSM_SERVERS_GROUP"
fi
usermod -aG "$MSM_SERVERS_GROUP" "$MSM_AGENT_USER" 2>/dev/null || true
usermod -aG "$MSM_SERVERS_GROUP" "$MSM_DOCKER_USER" 2>/dev/null || true
install -d -o "$MSM_AGENT_USER" -g "$MSM_AGENT_USER" -m 750 /var/lib/msm-agent/guardian 2>/dev/null || true
install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 750 "$MSM_DOCKER_HOME" 2>/dev/null || true

# PG max_connections erhöhen falls nötig
PG_CONF_DIR=$(find /etc/postgresql -name "conf.d" -type d 2>/dev/null | head -1)
if [[ -n "$PG_CONF_DIR" ]] && [[ ! -f "${PG_CONF_DIR}/99-msm.conf" ]]; then
    cat > "${PG_CONF_DIR}/99-msm.conf" <<'PGCONF'
max_connections = 250
PGCONF
    systemctl reload-or-restart postgresql 2>/dev/null || true
fi

# Kernel Hardening sysctl
if [[ -d /etc/sysctl.d ]]; then
    cat > /etc/sysctl.d/99-msm-hardening.conf <<'SYSCTLEOF'
fs.protected_symlinks = 1
fs.protected_hardlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
fs.suid_dumpable = 0
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.unprivileged_bpf_disabled = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
SYSCTLEOF
    sysctl --system >/dev/null 2>&1 || true
fi

# Rootless Docker Migration nach $MSM_DOCKER_USER (falls bisher unter $MSM_USER)
DOCKER_HOST_ACTIVE="unix:///run/user/$(id -u "$MSM_DOCKER_USER")/docker.sock"
if [[ -d "$MSM_DIR/msm-agent" ]]; then
    for f in /etc/subuid /etc/subgid; do
        if ! grep -qE "^${MSM_DOCKER_USER}:" "$f" 2>/dev/null; then
            START_ID=$(awk -F: 'BEGIN{m=99999} NF>=3{e=$2+$3-1; if(e>m)m=e} END{print m+1}' "$f" 2>/dev/null || echo 100000)
            echo "${MSM_DOCKER_USER}:${START_ID}:65536" >> "$f"
        fi
    done
    MSM_DOCKER_UID=$(id -u "$MSM_DOCKER_USER")
    if [[ -d "$MSM_DIR/.local/share/docker" ]] && [[ ! -d "$MSM_DOCKER_HOME/.local/share/docker" ]]; then
        log "Migriere Rootless Docker nach $MSM_DOCKER_USER..."
        MSM_UID_OLD=$(id -u "$MSM_USER" 2>/dev/null || echo 0)
        systemctl stop msm-searxng msm-wetter msm-livekit msm-agent 2>/dev/null || true
        su -s /bin/bash "$MSM_USER" -c "export XDG_RUNTIME_DIR=/run/user/${MSM_UID_OLD}; systemctl --user stop docker.service" 2>/dev/null || true
        mkdir -p "$MSM_DOCKER_HOME/.local/share"
        mv "$MSM_DIR/.local/share/docker" "$MSM_DOCKER_HOME/.local/share/docker"
        chown -R "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$MSM_DOCKER_HOME"
    fi
    if $SYSTEMD_AVAILABLE && command -v dockerd-rootless-setuptool.sh &>/dev/null; then
        modprobe br_netfilter 2>/dev/null || true
        printf 'br_netfilter\n' > /etc/modules-load.d/msm-docker.conf
        mkdir -p /etc/systemd/system/user@.service.d "/etc/systemd/system/user@${MSM_DOCKER_UID}.service.d"
        printf '[Service]\nDelegate=cpu cpuset io memory pids\n' > /etc/systemd/system/user@.service.d/delegate.conf
        # Keep user@UID.service in its default user-UID.slice so runc can detect OwnerUID from /proc/self/cgroup
        printf '[Service]\nOOMScoreAdjust=500\n' > "/etc/systemd/system/user@${MSM_DOCKER_UID}.service.d/msm-workloads.conf"
        systemctl daemon-reload
        loginctl enable-linger "$MSM_DOCKER_USER" 2>/dev/null || true
        if systemctl show -p ControlGroup --value "user@${MSM_DOCKER_UID}.service" 2>/dev/null | grep -q "msm-workloads.slice"; then
            systemctl restart "user@${MSM_DOCKER_UID}.service" 2>/dev/null || true
        else
            systemctl start "user@${MSM_DOCKER_UID}.service" 2>/dev/null || true
        fi
        install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 710 "/run/user/${MSM_DOCKER_UID}" 2>/dev/null || true
        if [[ ! -f "${MSM_DOCKER_HOME}/.config/systemd/user/docker.service" ]]; then
            su -s /bin/bash "$MSM_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${MSM_DOCKER_UID}; dockerd-rootless-setuptool.sh install" 2>/dev/null || true
        fi
        install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 700 "${MSM_DOCKER_HOME}/.config/docker"
        if [[ ! -f "${MSM_DOCKER_HOME}/.config/docker/daemon.json" ]]; then
            cat > "${MSM_DOCKER_HOME}/.config/docker/daemon.json" <<'EOF'
{
  "icc": false,
  "no-new-privileges": true,
  "userland-proxy": false,
  "exec-opts": ["native.cgroupdriver=systemd"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  }
}
EOF
            chown "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "${MSM_DOCKER_HOME}/.config/docker/daemon.json"
        else
            python3 - "${MSM_DOCKER_HOME}/.config/docker/daemon.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    if isinstance(cfg, dict):
        opts = [o for o in cfg.get("exec-opts", []) if not str(o).startswith("native.cgroupdriver=")]
        opts.append("native.cgroupdriver=systemd")
        cfg["exec-opts"] = opts
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, indent=2)
            fh.write("\n")
except Exception:
    pass
PYEOF
            chown "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "${MSM_DOCKER_HOME}/.config/docker/daemon.json"
        fi
        su -s /bin/bash "$MSM_DOCKER_USER" -c "mkdir -p ~/.config/systemd/user/docker.service.d && printf '[Service]\nEnvironment=\"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${MSM_DOCKER_UID}/bus\"\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns\"\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true\"\n' > ~/.config/systemd/user/docker.service.d/override.conf" 2>/dev/null || true
        su -s /bin/bash "$MSM_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${MSM_DOCKER_UID} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${MSM_DOCKER_UID}/bus; systemctl --user daemon-reload && systemctl --user enable docker.service && systemctl --user restart docker.service" 2>/dev/null || true
    fi
    cat > /usr/local/sbin/msm-docker-socket-acl <<ACLEOF
#!/bin/sh
set -eu
DOCKER_UID="$(id -u "$MSM_DOCKER_USER")"
AGENT_USER="$MSM_AGENT_USER"
RUNTIME_DIR="/run/user/\${DOCKER_UID}"
SOCK="\${RUNTIME_DIR}/docker.sock"
[ -d "\$RUNTIME_DIR" ] && command -v setfacl >/dev/null 2>&1 && { chmod 0710 "\$RUNTIME_DIR" || true; setfacl -m "u:\${AGENT_USER}:x" "\$RUNTIME_DIR" || true; }
[ -S "\$SOCK" ] && command -v setfacl >/dev/null 2>&1 && { chmod 0660 "\$SOCK" || true; setfacl -m "u:\${AGENT_USER}:rw" "\$SOCK" || true; }
ACLEOF
    chown root:root /usr/local/sbin/msm-docker-socket-acl
    chmod 0755 /usr/local/sbin/msm-docker-socket-acl
    /usr/local/sbin/msm-docker-socket-acl || true
    if [[ -d /opt/msm/servers ]]; then
        chown "$MSM_AGENT_USER:$MSM_SERVERS_GROUP" /opt/msm/servers
        chmod 0710 /opt/msm/servers
        if command -v setfacl &>/dev/null; then
            for _sd in /opt/msm/servers/*/; do
                [[ -d "$_sd" ]] && setfacl -m "u:${MSM_AGENT_USER}:rwX,u:${MSM_DOCKER_USER}:rwX,d:u:${MSM_AGENT_USER}:rwX,d:u:${MSM_DOCKER_USER}:rwX" "$_sd" 2>/dev/null || true
            done
        fi
    fi
fi

# ── MSM Agent aktualisieren (Monorepo, rootless Node, User $MSM_AGENT_USER) ──
if [[ -d "$MSM_DIR/msm-agent" ]]; then
    log "Aktualisiere MSM Agent..."
    prepare_app_venv "$MSM_DIR/msm-agent" "MSM Agent" false "$MSM_AGENT_USER"
    AGENT_ENV="$MSM_DIR/msm-agent/.env"
    if [[ ! -f "$AGENT_ENV" ]]; then
        AGENT_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
        cat > "$AGENT_ENV" <<EOF
# Automatisch generiert. Dokumentation: $MSM_DIR/msm-agent/.env.example
MSM_AGENT_TOKEN="$AGENT_TOKEN"
MSM_AGENT_HOST="127.0.0.1"
MSM_AGENT_PORT="9000"
MSM_SERVERS_DIR="$MSM_DIR/servers"
MSM_DOCKER_HOST="$DOCKER_HOST_ACTIVE"
MSM_REQUIRE_NETWORK_ISOLATION=true
MSM_QUOTA_DRIVER="auto"
MSM_GUARDIAN_STATE_DIR="/var/lib/msm-agent/guardian"
MSM_AGENT_LOG_LEVEL="INFO"
EOF
    else
        AGENT_TOKEN=$(grep -E '^MSM_AGENT_TOKEN=' "$AGENT_ENV" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
        if grep -qE '^MSM_DOCKER_HOST=' "$AGENT_ENV"; then
            sed -i -E "s|^MSM_DOCKER_HOST=.*|MSM_DOCKER_HOST=\"${DOCKER_HOST_ACTIVE}\"|" "$AGENT_ENV"
        else
            printf 'MSM_DOCKER_HOST="%s"\n' "$DOCKER_HOST_ACTIVE" >> "$AGENT_ENV"
        fi
        if ! grep -qE '^MSM_REQUIRE_NETWORK_ISOLATION=' "$AGENT_ENV"; then
            printf 'MSM_REQUIRE_NETWORK_ISOLATION=true\n' >> "$AGENT_ENV"
        fi
        if ! grep -qE '^MSM_QUOTA_DRIVER=' "$AGENT_ENV"; then
            printf 'MSM_QUOTA_DRIVER="auto"\n' >> "$AGENT_ENV"
        fi
    fi
    chmod 600 "$AGENT_ENV"
    chown "$MSM_AGENT_USER:$MSM_AGENT_USER" "$AGENT_ENV"
    # Backend .env mit lokalem Agent-Token & Hardening-Flags synchronisieren
    if [[ -f "$ENV_FILE" ]]; then
        if [[ -n "${AGENT_TOKEN:-}" ]]; then
            if grep -qE '^MSM_LOCAL_AGENT_TOKEN=' "$ENV_FILE"; then
                sed -i -E "s|^MSM_LOCAL_AGENT_TOKEN=.*|MSM_LOCAL_AGENT_TOKEN=\"${AGENT_TOKEN}\"|" "$ENV_FILE"
            else
                printf 'MSM_LOCAL_AGENT_TOKEN="%s"\n' "$AGENT_TOKEN" >> "$ENV_FILE"
            fi
        fi
        for _kv in "MSM_LOCAL_AGENT_REQUIRED=true" "MSM_REQUIRE_NETWORK_ISOLATION=true" "MSM_ALLOW_LEGACY_BARE_METAL_SETUP=false"; do
            _k="${_kv%%=*}"
            grep -qE "^${_k}=" "$ENV_FILE" || printf '%s\n' "$_kv" >> "$ENV_FILE"
        done
    fi
    ok "MSM Agent Dependencies & 3-User Isolation aktualisiert"
fi

# ── Datenbank-Migrationen ──
if $SYSTEMD_AVAILABLE && systemctl is-active --quiet msm-panel.service; then
    PANEL_WAS_ACTIVE=true
    log "Nehme Panel für das Schema-Upgrade kurz in Wartung..."
    systemctl stop msm-panel.service || err "Panel konnte nicht in Wartung genommen werden."
fi
log "Führe geprüfte PostgreSQL-Schemamigration durch..."
su - msm -c "
    cd $MSM_DIR/backend
    source venv/bin/activate
    python3 scripts/prepare_phase8_schema.py
" 2>&1 | tee -a "$LOG_FILE" || err "PostgreSQL-Schemamigration fehlgeschlagen."

# ── DIS Config laden/generieren ──
log "Lade/Generiere kryptografischen DIS-Config..."
if [[ -f "$ENV_FILE" ]]; then
    SECRET_KEY=$(grep -E '^MSM_SECRET_KEY=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DIS_SALT=$(grep -E '^MSM_DIS_SALT=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DIS_TOKEN=$(grep -E '^MSM_DIS_SIDECAR_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
fi
SECRET_KEY="${SECRET_KEY:-}"
DIS_SALT="${DIS_SALT:-}"
DIS_TOKEN="${DIS_TOKEN:-}"

if [[ -z "$SECRET_KEY" ]]; then
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
    echo "MSM_SECRET_KEY=\"$SECRET_KEY\"" >> "$ENV_FILE"
fi
if [[ -z "$DIS_SALT" ]]; then
    DIS_SALT=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    echo "MSM_DIS_SALT=\"$DIS_SALT\"" >> "$ENV_FILE"
fi
if [[ -z "$DIS_TOKEN" ]]; then
    DIS_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    echo "MSM_DIS_SIDECAR_TOKEN=\"$DIS_TOKEN\"" >> "$ENV_FILE"
fi
if ! grep -q '^MSM_DIS_SIDECAR_URL=' "$ENV_FILE"; then
    echo 'MSM_DIS_SIDECAR_URL="http://127.0.0.1:9100"' >> "$ENV_FILE"
fi

# LiveKit (Anrufe im Messenger). Bestandsinstallationen kennen die beiden
# Werte noch nicht; sie werden hier einmalig ergaenzt und danach nie wieder
# angefasst. Ein Wechsel wuerde laufende Gespraeche abreissen lassen.
LIVEKIT_API_KEY=$(grep -E '^MSM_LIVEKIT_API_KEY=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
LIVEKIT_API_SECRET=$(grep -E '^MSM_LIVEKIT_API_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-}"
if [[ -z "$LIVEKIT_API_KEY" ]]; then
    LIVEKIT_API_KEY="API$(python3 -c "import secrets; print(secrets.token_hex(6))")"
    echo "MSM_LIVEKIT_API_KEY=\"$LIVEKIT_API_KEY\"" >> "$ENV_FILE"
fi
if [[ -z "$LIVEKIT_API_SECRET" ]]; then
    LIVEKIT_API_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    echo "MSM_LIVEKIT_API_SECRET=\"$LIVEKIT_API_SECRET\"" >> "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"
chown "$MSM_USER:$MSM_USER" "$ENV_FILE"

DIS_ENV_FILE="$MSM_DIR/dis-sidecar/.env"
cat > "$DIS_ENV_FILE" <<EOF
# Automatisch generiert. Dokumentation: $MSM_DIR/dis-sidecar/.env.example
MSM_SECRET_KEY="$SECRET_KEY"
MSM_DIS_SALT="$DIS_SALT"
MSM_DIS_SIDECAR_TOKEN="$DIS_TOKEN"
MSM_DIS_SIDECAR_PORT=9100
NODE_ENV=production
EOF
chmod 600 "$DIS_ENV_FILE"
chown "$MSM_USER:$MSM_USER" "$DIS_ENV_FILE"

# Dokumente-Sidecar: Token und Collab-Schluessel bleiben ueber Updates stabil.
DOCS_ENV_FILE="$MSM_DIR/docs-sidecar/.env"
DOCS_DATA_DIR="$MSM_DIR/data/docs-sidecar"
install -d -o "$MSM_USER" -g "$MSM_USER" -m 700 "$DOCS_DATA_DIR"
DOCS_TOKEN=""
DOCS_COLLAB_SECRET=""
DOCS_SIGNING_SECRET=""
if [[ -f "$DOCS_ENV_FILE" ]]; then
    DOCS_TOKEN=$(grep -E '^MSM_DOCS_SIDECAR_TOKEN=' "$DOCS_ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DOCS_COLLAB_SECRET=$(grep -E '^MSM_DOCS_COLLAB_SECRET=' "$DOCS_ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DOCS_SIGNING_SECRET=$(grep -E '^MSM_DOCS_SIGNING_SECRET=' "$DOCS_ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
fi
# Fehlt die Sidecar-Datei, gilt das Token aus dem Backend weiter. Sonst
# erzeugte ein Update ein neues Paar, waehrend das Backend das alte behielte.
if [[ -z "$DOCS_TOKEN" && -f "$ENV_FILE" ]]; then
    DOCS_TOKEN=$(grep -E '^MSM_DOCS_SIDECAR_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DOCS_COLLAB_SECRET=$(grep -E '^MSM_DOCS_COLLAB_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DOCS_SIGNING_SECRET=$(grep -E '^MSM_DOCS_SIGNING_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
fi
[[ -n "$DOCS_TOKEN" ]] || DOCS_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
[[ -n "$DOCS_COLLAB_SECRET" ]] || DOCS_COLLAB_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
[[ -n "$DOCS_SIGNING_SECRET" ]] || DOCS_SIGNING_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
# Dev-Compose-Geheimnisse (Befund 39): docker-compose.dev.yml verlangt echte
# Werte und kennt keine Defaults mehr (:?). Fehlende Schluessel in .env.dev
# werden einmalig ergaenzt, bestehende nie ueberschrieben. Rotation: Zeilen
# loeschen und Skript erneut laufen lassen (Backend und Sidecar teilen sich
# SIDECAR_TOKEN und COLLAB_SECRET; ein SIGNING-Wechsel entwertet alte
# Asset-URLs).
DEV_ENV_FILE="$MSM_DIR/.env.dev"
touch "$DEV_ENV_FILE"
chmod 600 "$DEV_ENV_FILE"
for DEV_KEY in MSM_DOCS_SIDECAR_TOKEN MSM_DOCS_COLLAB_SECRET MSM_DOCS_SIGNING_SECRET; do
    if ! grep -qE "^${DEV_KEY}=.+" "$DEV_ENV_FILE"; then
        DEV_WERT=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
        printf '%s="%s"\n' "$DEV_KEY" "$DEV_WERT" >> "$DEV_ENV_FILE"
    fi
done
cat > "$DOCS_ENV_FILE" <<EOF
# Automatisch generiert. Dokumentation: $MSM_DIR/docs-sidecar/.env.example
MSM_DOCS_WS_PORT=8100
MSM_DOCS_WS_ADDRESS=127.0.0.1
MSM_DOCS_HTTP_PORT=8101
MSM_DOCS_HTTP_ADDRESS=127.0.0.1
MSM_DOCS_DATA_DIR="$DOCS_DATA_DIR"
MSM_BACKEND_URL=http://127.0.0.1:8000
MSM_DOCS_SIDECAR_TOKEN="$DOCS_TOKEN"
MSM_DOCS_COLLAB_SECRET="$DOCS_COLLAB_SECRET"
MSM_DOCS_SIGNING_SECRET="$DOCS_SIGNING_SECRET"
NODE_ENV=production
EOF
chmod 600 "$DOCS_ENV_FILE"
chown "$MSM_USER:$MSM_USER" "$DOCS_ENV_FILE"

if ! grep -q '^MSM_DOCS_SIDECAR_TOKEN=' "$ENV_FILE"; then
    {
        echo "MSM_DOCS_SIDECAR_URL=\"http://127.0.0.1:8101\""
        echo "MSM_DOCS_SIDECAR_TOKEN=\"$DOCS_TOKEN\""
        echo "MSM_DOCS_COLLAB_SECRET=\"$DOCS_COLLAB_SECRET\""
        echo "MSM_DOCS_SIGNING_SECRET=\"$DOCS_SIGNING_SECRET\""
        echo "MSM_DOCS_COLLAB_PUBLIC_URL=\"${DOMAIN:+wss://$DOMAIN/api/docs/collab}\""
    } >> "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    chown "$MSM_USER:$MSM_USER" "$ENV_FILE"
elif ! grep -q '^MSM_DOCS_COLLAB_PUBLIC_URL=' "$ENV_FILE" && [[ -n "$DOMAIN" ]]; then
    echo "MSM_DOCS_COLLAB_PUBLIC_URL=\"wss://$DOMAIN/api/docs/collab\"" >> "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    chown "$MSM_USER:$MSM_USER" "$ENV_FILE"
fi

# SearXNG-Sidecar Environment (zufälliger Secret-Key für CSRF & Sessions)
if [[ -d "$MSM_DIR/searxng-sidecar" ]]; then
    SEARXNG_ENV_FILE="$MSM_DIR/searxng-sidecar/.env"
    if [[ ! -f "$SEARXNG_ENV_FILE" ]]; then
        SEARXNG_SECRET=$(openssl rand -hex 32 2>/dev/null || tr -dc 'a-f0-9' < /dev/urandom | head -c 64)
        cat > "$SEARXNG_ENV_FILE" <<EOF
# Automatisch generiert für SearXNG-Sidecar
SEARXNG_SECRET_KEY="$SEARXNG_SECRET"
SEARXNG_BASE_URL=http://127.0.0.1:8888/
EOF
        chmod 600 "$SEARXNG_ENV_FILE"
        chown "$MSM_USER:$MSM_USER" "$SEARXNG_ENV_FILE"
    fi
fi

# Wetter-Sidecar Environment (keine Secrets; Daten bleiben lokal)
if [[ -d "$MSM_DIR/wetter-sidecar" ]]; then
    WETTER_ENV_FILE="$MSM_DIR/wetter-sidecar/.env"
    if [[ ! -f "$WETTER_ENV_FILE" ]]; then
        cat > "$WETTER_ENV_FILE" <<EOF
# Automatisch generiert für das Wetter-Sidecar
MSM_WETTER_PORT=8890
MSM_WETTER_DATEN=/daten
EOF
        chmod 600 "$WETTER_ENV_FILE"
        chown "$MSM_USER:$MSM_USER" "$WETTER_ENV_FILE"
    fi
    mkdir -p "$MSM_DIR/wetter-sidecar/daten"
    chown -R "$MSM_USER:$MSM_USER" "$MSM_DIR/wetter-sidecar/daten" 2>/dev/null || true
fi

# LiveKit-Sidecar Environment. Wird bei jedem Lauf neu geschrieben, damit
# Sidecar und Backend garantiert dasselbe Schluesselpaar tragen.
if [[ -d "$MSM_DIR/livekit-sidecar" ]]; then
    LIVEKIT_ENV_FILE="$MSM_DIR/livekit-sidecar/.env"
    # Adresse fuer die Medienports, hier auf dem Host ermittelt statt per STUN
    # im Container. Begruendung in livekit-sidecar/medienadresse.py.
    LIVEKIT_NODE_IP=$(python3 "$MSM_DIR/livekit-sidecar/medienadresse.py" "$ENV_FILE" 2>/dev/null || true)
    cat > "$LIVEKIT_ENV_FILE" <<EOF
# Automatisch generiert. Dokumentation: $MSM_DIR/livekit-sidecar/.env.example
LIVEKIT_KEYS="$LIVEKIT_API_KEY: $LIVEKIT_API_SECRET"
EOF
    if [[ -n "$LIVEKIT_NODE_IP" ]]; then
        echo "NODE_IP=\"$LIVEKIT_NODE_IP\"" >> "$LIVEKIT_ENV_FILE"
    else
        warn "Anrufe: keine Adresse fuer die Medienports gefunden. Anrufe verbinden, bleiben aber stumm."
        warn "  MSM_LIVEKIT_NODE_IP=\"<oeffentliche IPv4>\" in $ENV_FILE eintragen und update.sh erneut ausfuehren."
    fi
    chmod 600 "$LIVEKIT_ENV_FILE"
    chown "$MSM_USER:$MSM_USER" "$LIVEKIT_ENV_FILE"

    # Die Caddy-Site gehoert install.sh; ein Update fasst sie nicht an. Ohne
    # diese beiden Zeilen laeuft der Sidecar aber ins Leere: der Browser kaeme
    # nicht an die Signalisierung und bekaeme nicht einmal eine Freigabefrage
    # fuer Kamera und Bildschirm. Deshalb hier nachsehen und es sagen, statt
    # eine fremde Konfiguration umzuschreiben.
    # install.sh legt die Site je nach vorhandenem Import als .caddy oder .conf ab.
    _msm_caddy_site=""
    for _kandidat in /etc/caddy/conf.d/msm.caddy /etc/caddy/conf.d/msm.conf; do
        [[ -f "$_kandidat" ]] && _msm_caddy_site="$_kandidat" && break
    done
    if [[ -n "$_msm_caddy_site" ]]; then
        if ! grep -q "handle_path /livekit/\*" "$_msm_caddy_site" 2>/dev/null; then
            warn "Caddy reicht /livekit noch nicht an den Medienserver durch — Anrufe im Messenger bleiben aus."
            warn "  In $_msm_caddy_site neben 'handle /ws/*' ergaenzen:"
            warn "      handle_path /livekit/* { reverse_proxy localhost:7880 }"
        fi
        if grep -q "camera=()" "$_msm_caddy_site" 2>/dev/null; then
            warn "Caddy setzt noch camera=() — Kamera und Bildschirmfreigabe bleiben im Browser gesperrt."
            warn "  In $_msm_caddy_site auf camera=(self), display-capture=(self) aendern."
        fi
        # Beides ohne Neustart: systemctl reload caddy genuegt.
    fi
fi

# Cache-Regeln der Oberflaeche (seit 09/2026) stehen ebenfalls in der
# Caddy-Site, die ein Update nicht anfasst. Ohne sie haelt ein Browser die
# index.html von vor diesem Update fest. Die zeigt auf Chunks, die es jetzt
# nicht mehr gibt, und Caddy beantwortete jeden fehlenden Chunk mit der
# index.html — die Oberflaeche bleibt leer, bis der Cache verfaellt.
for _kandidat in /etc/caddy/conf.d/msm.caddy /etc/caddy/conf.d/msm.conf; do
    [[ -f "$_kandidat" ]] || continue
    if ! grep -q "handle /api/docs/collab" "$_kandidat" 2>/dev/null; then
        warn "Caddy reicht /api/docs/collab noch nicht an den Dokumente-Sidecar durch — der Editor bleibt bei 'Warte auf den Dokumentserver'."
        warn "  $MSM_DIR/install.sh erneut ausfuehren (behaelt die vorhandenen Werte und schreibt die Site neu)"
        warn "  oder in $_kandidat vor 'handle /api/*' ergaenzen:"
        warn "      handle_path /api/docs/collab/* { reverse_proxy localhost:8100 }"
        warn "      handle /api/docs/collab { reverse_proxy localhost:8100 }"
    fi
    if grep -q "root \* /opt/msm/frontend/dist" "$_kandidat" 2>/dev/null \
            && ! grep -q "handle /assets/\*" "$_kandidat" 2>/dev/null; then
        warn "Caddy liefert die Oberflaeche noch ohne Cache-Regeln aus — ein Browser kann nach diesem Update eine alte, leere Seite festhalten."
        warn "  $MSM_DIR/install.sh erneut ausfuehren (behaelt die vorhandenen Werte und schreibt die Site neu)"
        warn "  oder in $_kandidat die Bloecke 'handle /assets/*' und 'handle' aus $MSM_DIR/Caddyfile.template uebernehmen."
    fi
    break
done

# ── DIS Sidecar Abhängigkeiten installieren ──
log "Installiere DIS Sidecar-Abhängigkeiten..."
if ! su - "$MSM_USER" -c "
    set -e
    cd $MSM_DIR/dis-sidecar
    npm ci -q --omit=dev
" 2>&1 | tee -a "$LOG_FILE"; then
    err "DIS Sidecar npm ci fehlgeschlagen. Prüfe dis-sidecar/package.json und package-lock.json."
fi
ok "DIS Sidecar Abhängigkeiten installiert."

# ── Dokumente-Sidecar Abhängigkeiten ──
if [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]]; then
    err "Node >=22 wird fuer den Dokumente-Sidecar benoetigt (gefunden: $(node -v))."
fi
log "Installiere Dokumente-Sidecar-Abhaengigkeiten..."
if ! su - "$MSM_USER" -c "
    set -e
    cd $MSM_DIR/docs-sidecar
    npm ci -q --omit=dev --install-links
" 2>&1 | tee -a "$LOG_FILE"; then
    err "Dokumente-Sidecar npm ci fehlgeschlagen. Pruefe docs-sidecar/package.json und package-lock.json."
fi
ok "Dokumente-Sidecar Abhaengigkeiten installiert."

# ── systemd Services registrieren ──
if $SYSTEMD_AVAILABLE; then
    log "Aktualisiere systemd Services & QoS-Slices..."
    MSM_UID=$(id -u "$MSM_USER")
    MSM_DOCKER_UID=$(id -u "$MSM_DOCKER_USER" 2>/dev/null || echo "$MSM_UID")
    MSM_DOCKER_HOST="unix:///run/user/${MSM_DOCKER_UID}/docker.sock"

    TOTAL_MEM_MB=$(awk '/MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 4096)
    RESERVE_MEM_MB=$(( TOTAL_MEM_MB * 15 / 100 ))
    if [[ "$RESERVE_MEM_MB" -lt 1536 ]]; then RESERVE_MEM_MB=1536; fi
    if [[ "$TOTAL_MEM_MB" -gt $(( RESERVE_MEM_MB + 512 )) ]]; then
        WORKLOAD_MAX_MB=$(( TOTAL_MEM_MB - RESERVE_MEM_MB ))
    else
        WORKLOAD_MAX_MB=512
    fi
    WORKLOAD_HIGH_MB=$(( WORKLOAD_MAX_MB * 92 / 100 ))

    cat > /etc/systemd/system/msm-control.slice <<EOF
[Unit]
Description=MSM Control Plane Slice (Backend, Worker, DB, Redis, Agent)

[Slice]
CPUWeight=200
MemoryMin=512M
EOF
    cat > /etc/systemd/system/msm-workloads.slice <<EOF
[Unit]
Description=MSM Tenant Workload Slice (Rootless Docker Gameserver & Apps)

[Slice]
CPUWeight=50
IOWeight=50
MemoryHigh=${WORKLOAD_HIGH_MB}M
MemoryMax=${WORKLOAD_MAX_MB}M
EOF
    mkdir -p /etc/systemd/system/postgresql.service.d /etc/systemd/system/redis-server.service.d /etc/systemd/system/msm-docs-sidecar.service.d
    printf '[Service]\nSlice=msm-control.slice\nOOMScoreAdjust=-900\n' > /etc/systemd/system/postgresql.service.d/msm-oom.conf
    printf '[Service]\nSlice=msm-control.slice\nOOMScoreAdjust=-850\n' > /etc/systemd/system/redis-server.service.d/msm-oom.conf
    printf '[Service]\nSlice=msm-control.slice\nOOMScoreAdjust=-750\n' > /etc/systemd/system/msm-docs-sidecar.service.d/msm-slice.conf

    cat > /etc/systemd/system/msm-docker-socket-acl.service <<'EOF'
[Unit]
Description=MSM Docker Socket ACL Sync

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/msm-docker-socket-acl
EOF
    cat > /etc/systemd/system/msm-docker-socket-acl.path <<PATHEOF
[Unit]
Description=Watch msm-docker Rootless Socket for ACL Sync

[Path]
PathExists=/run/user/${MSM_DOCKER_UID}/docker.sock

[Install]
WantedBy=multi-user.target
PATHEOF
    systemctl enable msm-docker-socket-acl.path >/dev/null 2>&1 || true
    systemctl start msm-docker-socket-acl.path >/dev/null 2>&1 || true

    EFFECTIVE_REDIS_URL=""
    if [[ -f "$ENV_FILE" ]]; then
        EFFECTIVE_REDIS_URL=$(grep -E '^MSM_REDIS_URL=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    fi
    if [[ -n "$EFFECTIVE_REDIS_URL" ]]; then
        PANEL_WORKER_MODE="api"
        CPU_CORES=$(nproc 2>/dev/null || echo 2)
        if [[ "$CPU_CORES" -lt 2 ]]; then MSM_UVICORN_WORKERS=2
        elif [[ "$CPU_CORES" -gt 4 ]]; then MSM_UVICORN_WORKERS=4
        else MSM_UVICORN_WORKERS="$CPU_CORES"
        fi
    else
        PANEL_WORKER_MODE="all"
        MSM_UVICORN_WORKERS=1
    fi
    if [[ -f "$ENV_FILE" ]]; then
        if grep -qE '^MSM_WORKER_MODE=' "$ENV_FILE"; then
            sed -i -E "s|^MSM_WORKER_MODE=.*|MSM_WORKER_MODE=\"${PANEL_WORKER_MODE}\"|" "$ENV_FILE"
        else
            printf 'MSM_WORKER_MODE="%s"\n' "$PANEL_WORKER_MODE" >> "$ENV_FILE"
        fi
    fi

    # Dokumente-Sidecar Service
    cat > /etc/systemd/system/msm-docs-sidecar.service <<EOF
[Unit]
Description=MSM Dokumente Sidecar (Hocuspocus/Yjs)
After=network.target msm-dis-sidecar.service
Wants=msm-dis-sidecar.service

[Service]
Type=simple
User=$MSM_USER
Group=$MSM_USER
WorkingDirectory=$MSM_DIR/docs-sidecar
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EnvironmentFile=$MSM_DIR/docs-sidecar/.env
ExecStart=/usr/bin/node --max-old-space-size=768 server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$MSM_DIR
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # DIS Sidecar Service
    cat > /etc/systemd/system/msm-dis-sidecar.service <<EOF
[Unit]
Description=MSM DIS Sidecar (Crypto Service)
After=network.target

[Service]
Type=simple
User=$MSM_USER
Group=$MSM_USER
Slice=msm-control.slice
OOMScoreAdjust=-750
WorkingDirectory=$MSM_DIR/dis-sidecar
Environment="NODE_ENV=production"
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EnvironmentFile=$MSM_DIR/dis-sidecar/.env
ExecStart=/usr/bin/node $MSM_DIR/dis-sidecar/server.mjs
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # --force-recreate: scheitert der Start an einem belegten Port, laesst
    # Docker den angelegten Container liegen. Der naechste Versuch startete ihn
    # dann ohne jede Portfreigabe, und systemd meldete „Started“ (27.09.2026).
    # Frisch angelegt scheitert jeder Versuch sichtbar, bis der Port frei ist.
    # SearXNG Search Sidecar Service (isoliert unter $MSM_DOCKER_USER)
    if [[ -d "$MSM_DIR/searxng-sidecar" ]]; then
        chown -R "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$MSM_DIR/searxng-sidecar" 2>/dev/null || true
        cat > /etc/systemd/system/msm-searxng.service <<EOF
[Unit]
Description=MSM SearXNG Search Sidecar
After=network.target
Wants=network.target

[Service]
Type=simple
User=$MSM_DOCKER_USER
Group=$MSM_DOCKER_USER
Slice=msm-control.slice
WorkingDirectory=$MSM_DIR/searxng-sidecar
Environment="DOCKER_HOST=$MSM_DOCKER_HOST"
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/usr/bin/docker compose up --force-recreate
ExecStop=/usr/bin/docker compose down
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    fi

    # Wetter Sidecar Service (Vorhersage über MSM, isoliert unter $MSM_DOCKER_USER)
    if [[ -d "$MSM_DIR/wetter-sidecar" ]]; then
        chown -R "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$MSM_DIR/wetter-sidecar" 2>/dev/null || true
        cat > /etc/systemd/system/msm-wetter.service <<EOF
[Unit]
Description=MSM Weather Sidecar
After=network.target
Wants=network.target

[Service]
Type=simple
User=$MSM_DOCKER_USER
Group=$MSM_DOCKER_USER
Slice=msm-control.slice
WorkingDirectory=$MSM_DIR/wetter-sidecar
Environment="DOCKER_HOST=$MSM_DOCKER_HOST"
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/usr/bin/docker compose up --force-recreate
ExecStop=/usr/bin/docker compose down
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    fi

    # LiveKit Media Sidecar Service (Anrufe im Messenger, isoliert unter $MSM_DOCKER_USER)
    if [[ -d "$MSM_DIR/livekit-sidecar" ]]; then
        chown -R "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$MSM_DIR/livekit-sidecar" 2>/dev/null || true
        cat > /etc/systemd/system/msm-livekit.service <<EOF
[Unit]
Description=MSM LiveKit Media Sidecar
After=network.target
Wants=network.target

[Service]
Type=simple
User=$MSM_DOCKER_USER
Group=$MSM_DOCKER_USER
Slice=msm-control.slice
WorkingDirectory=$MSM_DIR/livekit-sidecar
Environment="DOCKER_HOST=$MSM_DOCKER_HOST"
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/usr/bin/docker compose up --force-recreate
ExecStop=/usr/bin/docker compose down
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
        # Bestandsinstallationen haben die beiden Medienports noch nicht offen.
        # Ohne sie kommt ein Anruf zustande und bleibt stumm.
        if command -v ufw &>/dev/null; then
            ufw allow 7881/tcp comment 'MSM LiveKit media (TCP fallback)' 2>/dev/null || true
            ufw allow 7882/udp comment 'MSM LiveKit media' 2>/dev/null || true
        fi
    fi

    # Panel Service (Multi-Worker API)
    cat > /etc/systemd/system/msm-panel.service <<EOF
[Unit]
Description=Maunting Service Manager Panel
After=network.target redis-server.service msm-dis-sidecar.service msm-docs-sidecar.service
Wants=redis-server.service msm-docs-sidecar.service
Requires=msm-dis-sidecar.service

[Service]
Type=simple
User=msm
Group=msm
Slice=msm-control.slice
OOMScoreAdjust=-800
WorkingDirectory=/opt/msm/backend
Environment="PATH=/opt/msm/backend/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="MSM_WORKER_MODE=${PANEL_WORKER_MODE}"
ExecStart=/opt/msm/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers ${MSM_UVICORN_WORKERS} --timeout-graceful-shutdown 5
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
StandardOutput=journal
StandardError=journal

PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=/opt/msm -/etc/ufw -/var/lib/ufw -/run/ufw -/run/ufw.lock -/run/user -/run/sudo -/etc/caddy -/run/caddy

[Install]
WantedBy=multi-user.target
EOF

    # Dedizierter Hintergrund-Worker (APScheduler / Pumpen / Node Heartbeats)
    cat > /etc/systemd/system/msm-worker.service <<'EOF'
[Unit]
Description=Maunting Service Manager Background Worker
After=network.target postgresql.service redis-server.service msm-dis-sidecar.service msm-docs-sidecar.service
Wants=redis-server.service msm-docs-sidecar.service
Requires=msm-dis-sidecar.service

[Service]
Type=simple
User=msm
Group=msm
Slice=msm-control.slice
OOMScoreAdjust=-300
WorkingDirectory=/opt/msm/backend
Environment="PATH=/opt/msm/backend/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="MSM_WORKER_MODE=worker"
ExecStart=/opt/msm/backend/venv/bin/python -u worker.py
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=/opt/msm -/etc/ufw -/var/lib/ufw -/run/ufw -/run/ufw.lock -/run/sudo -/etc/caddy -/run/caddy

[Install]
WantedBy=multi-user.target
EOF

    # MSM Agent (local node, isolierter User $MSM_AGENT_USER)
    if [[ -d "$MSM_DIR/msm-agent" ]]; then
        cat > /etc/systemd/system/msm-agent.service <<EOF
[Unit]
Description=MSM Agent (Node Runtime)
After=network.target msm-docker-socket-acl.service

[Service]
Type=simple
User=$MSM_AGENT_USER
Group=$MSM_AGENT_USER
Slice=msm-control.slice
OOMScoreAdjust=-500
WorkingDirectory=$MSM_DIR/msm-agent
Environment="PATH=$MSM_DIR/msm-agent/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="DOCKER_HOST=$MSM_DOCKER_HOST"
EnvironmentFile=-$MSM_DIR/msm-agent/.env
ExecStartPre=+/usr/local/sbin/msm-docker-socket-acl
ExecStart=$MSM_DIR/msm-agent/venv/bin/python main.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
StateDirectory=msm-agent
ReadWritePaths=$MSM_DIR/msm-agent $MSM_DIR/servers -/run/user -/run/sudo -/var/lib/msm-agent -/var/lib/msm-quotas

[Install]
WantedBy=multi-user.target
EOF
    fi

    systemctl daemon-reload
    systemctl enable msm-dis-sidecar.service
    if [[ -d "$MSM_DIR/docs-sidecar" ]]; then
        systemctl enable msm-docs-sidecar.service 2>/dev/null || true
    fi
    if [[ -d "$MSM_DIR/searxng-sidecar" ]]; then
        systemctl enable msm-searxng.service 2>/dev/null || true
    fi
    if [[ -d "$MSM_DIR/wetter-sidecar" ]]; then
        systemctl enable msm-wetter.service 2>/dev/null || true
    fi
    if [[ -d "$MSM_DIR/livekit-sidecar" ]]; then
        systemctl enable msm-livekit.service 2>/dev/null || true
    fi
    systemctl enable msm-panel.service
    if [[ "$PANEL_WORKER_MODE" == "api" ]]; then
        systemctl enable msm-worker.service
    else
        systemctl disable msm-worker.service >/dev/null 2>&1 || true
        systemctl stop msm-worker.service >/dev/null 2>&1 || true
    fi
    if [[ -f /etc/systemd/system/msm-agent.service ]]; then
        systemctl enable msm-agent.service
    fi
    ok "systemd Services registriert."
fi

# ── Frontend bauen ──
# Letzte Verteidigungslinie: selbst wenn alle vorherigen Pfade einen Chown
# ausgelassen haben sollten (z.B. unerwarteter Code-Pfad), stellen wir hier
# noch einmal sicher, dass der msm-User in frontend/ schreiben kann. Idempotent
# und billig.
restore_panel_ownership
log "Baue Frontend..."
if ! su - msm -c "
    set -e
    cd $MSM_DIR/frontend
    npm install -q
    npm run build
" 2>&1 | tee -a "$LOG_FILE"; then
    err "Frontend-Build fehlgeschlagen. Update abgebrochen."
fi

# ── Panel-Service reparieren: NoNewPrivileges entfernen (blockiert sudo) ──
PANEL_UNIT="/etc/systemd/system/msm-panel.service"
if [[ -f "$PANEL_UNIT" ]] && grep -q 'NoNewPrivileges=true' "$PANEL_UNIT"; then
    log "Entferne NoNewPrivileges aus Panel-Service (inkompatibel mit sudo)..."
    sed -i '/^NoNewPrivileges=true$/d' "$PANEL_UNIT"
    if $SYSTEMD_AVAILABLE; then
        systemctl daemon-reload
    fi
    ok "Panel-Service aktualisiert"
fi

# ── Panel-Service reparieren: System-PATH erweitern, damit docker auffindbar ──
# Alte Installationen hatten ``PATH=/opt/msm/backend/venv/bin`` ohne ``/usr/bin``.
# Folge: ``shutil.which("docker")`` schlug fehl, der Console-Stream meldete
# permanent "Docker CLI nicht im PATH des Backends". Idempotenter sed-Fix.
NEW_PATH_LINE='Environment="PATH=/opt/msm/backend/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"'
if [[ -f "$PANEL_UNIT" ]] && grep -qE '^Environment="PATH=/opt/msm/backend/venv/bin"\s*$' "$PANEL_UNIT"; then
    log "Erweitere Panel-Service PATH um System-Pfade (Docker-CLI auffindbar machen)..."
    sed -i "s|^Environment=\"PATH=/opt/msm/backend/venv/bin\"\s*\$|${NEW_PATH_LINE}|" "$PANEL_UNIT"
    if $SYSTEMD_AVAILABLE; then
        systemctl daemon-reload
    fi
    ok "Panel-Service PATH erweitert"
fi

# ── Panel-Service reparieren: UFW-ReadWritePaths optional markieren und -/run/run hinzufügen ──
# Wenn UFW beim Service-Start die Lockdatei noch nicht erzeugt hat,
# scheitert das systemd-Namespacing mit ``status=226/NAMESPACE``.
# ``-``-Praefix laesst systemd fehlende Pfade still ueberspringen.
# ``-/run/user`` wird fuer die Verbindung zum Rootless Docker Socket benoetigt.
GOOD_RWP="ReadWritePaths=/opt/msm -/etc/ufw -/var/lib/ufw -/run/ufw -/run/ufw.lock -/run/user -/run/sudo -/etc/caddy -/run/caddy"
BAD_RWP_1="ReadWritePaths=/opt/msm /etc/systemd/system /run/ufw /var/lib/ufw /etc/ufw /run/ufw.lock"
BAD_RWP_2="ReadWritePaths=/opt/msm -/etc/ufw -/var/lib/ufw -/run/ufw -/run/ufw.lock"

UPDATED_RWP=false
if [[ -f "$PANEL_UNIT" ]]; then
    if grep -qF "$BAD_RWP_1" "$PANEL_UNIT"; then
        sed -i "s|${BAD_RWP_1}|${GOOD_RWP}|" "$PANEL_UNIT"
        UPDATED_RWP=true
    elif grep -qF "$BAD_RWP_2" "$PANEL_UNIT"; then
        sed -i "s|${BAD_RWP_2}|${GOOD_RWP}|" "$PANEL_UNIT"
        UPDATED_RWP=true
    else
        if ! grep -qF "-/run/user" "$PANEL_UNIT"; then
            sed -i 's|^ReadWritePaths=\(.*\)|ReadWritePaths=\1 -/run/user|' "$PANEL_UNIT"
            UPDATED_RWP=true
        fi
        if ! grep -qF "-/run/sudo" "$PANEL_UNIT"; then
            sed -i 's|^ReadWritePaths=\(.*\)|ReadWritePaths=\1 -/run/sudo|' "$PANEL_UNIT"
            UPDATED_RWP=true
        fi
        if ! grep -qF "-/etc/caddy" "$PANEL_UNIT"; then
            sed -i 's|^ReadWritePaths=\(.*\)|ReadWritePaths=\1 -/etc/caddy -/run/caddy|' "$PANEL_UNIT"
            UPDATED_RWP=true
        fi
    fi
fi

if $UPDATED_RWP; then
    log "Aktualisiere ReadWritePaths des Panel-Services (füge -/run/user hinzu)..."
    if $SYSTEMD_AVAILABLE; then
        systemctl daemon-reload
    fi
    ok "Panel-Service ReadWritePaths aktualisiert"
fi

# ── Panel-Service reparieren: ProtectHome=true deaktivieren ──
# ProtectHome=true macht /run/user fuer das Panel unsichtbar, was den Zugriff
# auf den Rootless Docker Socket blockiert. Wir aendern es auf false.
if [[ -f "$PANEL_UNIT" ]] && grep -q 'ProtectHome=true' "$PANEL_UNIT"; then
    log "Deaktiviere ProtectHome im Panel-Service (erforderlich für Zugriff auf /run/user)..."
    sed -i 's|ProtectHome=true|ProtectHome=false|' "$PANEL_UNIT"
    if $SYSTEMD_AVAILABLE; then
        systemctl daemon-reload
    fi
    ok "Panel-Service ProtectHome deaktiviert"
fi

# ── Rootless Docker reparieren: UDP Source-IP + Host-Loopback-Sperre ──
if ! command -v slirp4netns &>/dev/null; then
    log "Installiere slirp4netns für UDP Source-IP Erhalt..."
    apt-get install -y -qq slirp4netns 2>/dev/null || true
fi
TARGET_DOCKER_USER="$(id "$MSM_DOCKER_USER" &>/dev/null && echo "$MSM_DOCKER_USER" || echo "$MSM_USER")"
TARGET_DOCKER_HOME="$(getent passwd "$TARGET_DOCKER_USER" | cut -d: -f6 || echo "$MSM_DOCKER_HOME")"
if id "$TARGET_DOCKER_USER" &>/dev/null; then
    TARGET_DOCKER_UID=$(id -u "$TARGET_DOCKER_USER")
    MSM_OVERRIDE_CONF="${TARGET_DOCKER_HOME}/.config/systemd/user/docker.service.d/override.conf"
    if ! grep -q 'DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true' "$MSM_OVERRIDE_CONF" 2>/dev/null \
       || ! grep -q 'DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns' "$MSM_OVERRIDE_CONF" 2>/dev/null; then
        log "Konfiguriere Rootless Docker für $TARGET_DOCKER_USER (slirp4netns + disable-host-loopback)..."
        su -s /bin/bash "$TARGET_DOCKER_USER" -c "mkdir -p ~/.config/systemd/user/docker.service.d && printf '[Service]\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns\"\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true\"\n' > ~/.config/systemd/user/docker.service.d/override.conf" 2>/dev/null || true
        if $SYSTEMD_AVAILABLE; then
            su -s /bin/bash "$TARGET_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${TARGET_DOCKER_UID}; systemctl --user daemon-reload && systemctl --user restart docker.service" 2>/dev/null || true
            /usr/local/sbin/msm-docker-socket-acl 2>/dev/null || true
            ok "Rootless Docker mit slirp4netns und Loopback-Isolation neugestartet"
        fi
    fi
fi

# ── Service neustarten ──
log "Starte Services neu..."
if $SYSTEMD_AVAILABLE; then
    log "Starte DIS Sidecar..."
    systemctl restart msm-dis-sidecar.service 2>/dev/null \
        || systemctl start msm-dis-sidecar.service 2>/dev/null \
        || err "DIS Sidecar konnte nicht gestartet werden."
    if ! systemctl is-active --quiet msm-dis-sidecar.service; then
        err "DIS Sidecar ist nicht aktiv. Prüfe: journalctl -u msm-dis-sidecar -n 50"
    fi

    if [[ -f /etc/systemd/system/msm-docs-sidecar.service ]]; then
        log "Starte Dokumente-Sidecar..."
        systemctl restart msm-docs-sidecar.service 2>/dev/null \
            || systemctl start msm-docs-sidecar.service 2>/dev/null || true
        systemctl is-active --quiet msm-docs-sidecar.service \
            || warn "Dokumente-Sidecar ist nicht aktiv. Pruefe: journalctl -u msm-docs-sidecar -n 50"
    fi

    if [[ -f /etc/systemd/system/msm-searxng.service ]]; then
        log "Starte SearXNG Search Sidecar..."
        systemctl restart msm-searxng.service 2>/dev/null \
            || systemctl start msm-searxng.service 2>/dev/null || true
        ok "SearXNG Sidecar bereit."
    fi

    # Wetter Sidecar starten
    if [[ -f /etc/systemd/system/msm-wetter.service ]]; then
        log "Starte Wetter Sidecar..."
        systemctl restart msm-wetter.service 2>/dev/null             || systemctl start msm-wetter.service 2>/dev/null || true
        _wetter_ok=false
        for _ in $(seq 1 20); do
            if curl -fsS --max-time 2 http://127.0.0.1:8890/health >/dev/null 2>&1; then
                _wetter_ok=true
                break
            fi
            sleep 2
        done
        if [[ "$_wetter_ok" == true ]]; then
            ok "Wetter Sidecar bereit."
        else
            warn "Wetter Sidecar antwortet nicht auf 127.0.0.1:8890. Ursache: journalctl -u msm-wetter -n 30"
        fi
    fi

    if [[ -f /etc/systemd/system/msm-livekit.service ]]; then
        log "Starte LiveKit Media Sidecar..."
        systemctl restart msm-livekit.service 2>/dev/null \
            || systemctl start msm-livekit.service 2>/dev/null || true
        # Erst pruefen, dann „bereit“ sagen: systemctl gelingt auch, wenn der
        # Container darin an belegten Ports scheitert. Am 27.09.2026 hielt ein
        # fremder LiveKit 7881/7882, und nichts im Lauf sagte das.
        _livekit_ok=false
        for _ in $(seq 1 15); do
            if curl -fsS --max-time 2 http://127.0.0.1:7880 >/dev/null 2>&1; then
                _livekit_ok=true
                break
            fi
            sleep 1
        done
        if [[ "$_livekit_ok" == true ]]; then
            ok "LiveKit Sidecar bereit."
        else
            warn "LiveKit Sidecar antwortet nicht auf 127.0.0.1:7880. Anrufe im Messenger gehen so nicht."
            _livekit_belegt=$(ss -Hlntup '( sport = :7880 or sport = :7881 or sport = :7882 )' 2>/dev/null || true)
            if [[ -n "$_livekit_belegt" ]]; then
                warn "  Auf seinen Ports lauscht bereits:"
                while IFS= read -r _zeile; do warn "    $_zeile"; done <<< "$_livekit_belegt"
                warn "  Diesen Dienst anhalten oder auf andere Ports legen, dann: systemctl restart msm-livekit"
            fi
            warn "  Ursache im Journal: journalctl -u msm-livekit -n 30"
        fi
    fi

    # DIS Migration: Fernet -> DIS (einmalig, nur wenn alte Daten vorhanden)
    if grep -q '^MSM_DATABASE_URL=.*postgresql' "$ENV_FILE" 2>/dev/null; then
        log "Pruefe DIS-Migration (Fernet -> DIS)..."
        su - "$MSM_USER" -c "
            cd $MSM_DIR/backend
            source venv/bin/activate
            python3 scripts/migrate_to_dis.py
        " 2>&1 | tee -a "$LOG_FILE" || err "DIS-Migration fehlgeschlagen! Migration abgebrochen."
    fi

    if [[ -f /etc/systemd/system/msm-agent.service ]]; then
        systemctl restart msm-agent.service 2>/dev/null \
            || systemctl start msm-agent.service 2>/dev/null \
            || err "Lokaler MSM Agent konnte nicht gestartet werden."
        AGENT_READY=false
        for _attempt in $(seq 1 30); do
            if curl -fsS --max-time 2 http://127.0.0.1:9000/health >/dev/null 2>&1; then
                AGENT_READY=true
                break
            fi
            sleep 1
        done
        $AGENT_READY || err "Lokaler MSM Agent ist nicht erreichbar. Prüfe: journalctl -u msm-agent -n 50"
    fi

    systemctl restart msm-panel.service || err "Panel konnte nicht gestartet werden."
    if [[ -f /etc/systemd/system/msm-worker.service ]] && systemctl is-enabled --quiet msm-worker.service 2>/dev/null; then
        systemctl restart msm-worker.service \
            || systemctl start msm-worker.service \
            || err "Hintergrund-Worker (msm-worker) konnte nicht gestartet werden."
        ok "Hintergrund-Worker aktiv (msm-worker)"
    fi
    PANEL_READY=false
    for _attempt in $(seq 1 30); do
        if curl -fsS --max-time 2 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
            PANEL_READY=true
            break
        fi
        sleep 1
    done
    $PANEL_READY || err "Panel-Healthcheck fehlgeschlagen. Prüfe: journalctl -u msm-panel -n 50"
    systemctl restart caddy 2>/dev/null \
        || err "Caddy konnte nicht neu gestartet werden."
    systemctl is-active --quiet caddy \
        || err "Caddy ist nach dem Update nicht aktiv."
else
    err "systemd ist für sichere Produktionsupdates erforderlich."
fi

# ── Version aktualisieren ──
cd "$MSM_DIR"
NEW_VERSION=$(git describe --tags --always --match "v*" 2>/dev/null || echo "$LATEST_TAG")

# ── Fertig ──
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Update erfolgreich!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Version:${NC} $CURRENT_VERSION → ${GREEN}$NEW_VERSION${NC}"
echo -e "  ${BOLD}Backup:${NC}  $BACKUP_FILE"
echo -e "  ${BOLD}Log:${NC}     $LOG_FILE"
echo ""
echo -e "  ${BOLD}Wichtig:${NC}"
echo -e "    - Prüfe das Panel im Browser"
echo -e "    - Bei Problemen: Rollback via Backup"
echo ""
UPDATE_SUCCEEDED=true
