#!/usr/bin/env bash
set -euo pipefail
umask 077

# ── Global PATH: verhindert "mkdir: not found" in steamcmd-Wrapper ──
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export DEBIAN_FRONTEND="${DEBIAN_FRONTEND:-noninteractive}"

# ═══════════════════════════════════════════════════════════════
#  Maunting Service Manager — Zero-Config One-Line Installer
#  Supports: Ubuntu 22.04+, Debian 12+, WSL2
#
#  Usage:  sudo bash install.sh
#  ─────────────────────────────────────────────────────────────
#  Dieses Script richtet VOLLSTÄNDIG und AUTONOM ein:
#    - System-Abhängigkeiten (Node 20, Python, Caddy)
#    - Redis (optional, empfohlen für Rate-Limiting)
#    - Sichere .env mit automatisch generiertem SECRET_KEY
#    - SMTP-Konfiguration (für Email-Verifikation & 2FA)
#    - Caddy Reverse-Proxy mit automatischem TLS (Let's Encrypt)
#    - Firewall (UFW) + Fail2ban (Brute-Force-Schutz)
#    - systemd Service mit Auto-Restart
#    - Frontend-Build + Datenbank-Initialisierung
#  ─────────────────────────────────────────────────────────────
#  Unterstützt Frisch-Installation UND Re-Install / Config-Change
# ═══════════════════════════════════════════════════════════════

MSM_USER="msm"
MSM_AGENT_USER="msm-agent"
MSM_DOCKER_USER="msm-docker"
MSM_SERVERS_GROUP="msm-servers"
MSM_DOCKER_HOME="/var/lib/msm-docker"
MSM_DIR="/opt/msm"
LOG_FILE="/tmp/msm-install.log"
CADDY_SOURCE_FILE="/etc/apt/sources.list.d/caddy-stable.list"
CADDY_KEYRING_FILE="/usr/share/keyrings/caddy-stable-archive-keyring.gpg"
# Primary repository key. Signing subkeys may rotate without changing this
# pinned trust anchor.
CADDY_SIGNING_FINGERPRINT="65760C51EDEA2017CEA2CA15155B6D79CA56EA34"
CADDY_SOURCE_BACKUP=""

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[MSM]${NC}  $1" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[ERR]${NC}  $1" | tee -a "$LOG_FILE"; exit 1; }
ask()  { read -rp "$(echo -e "${BOLD}[?]${NC} $1 ")" "$2"; }
ask_secret() {
    read -rsp "$(echo -e "${BOLD}[?]${NC} $1 ")" "$2"
    echo ""
}
ask_yesno() {
    local ans
    while true; do
        read -rp "$(echo -e "${BOLD}[?]${NC} $1 [Y/n]: ")" ans
        case "${ans:-Y}" in
            [Yy]*) return 0 ;;
            [Nn]*) return 1 ;;
        esac
    done
}
ask_yesno_default() {
    local question="$1"
    local default="$2"
    local ans
    while true; do
        if [[ "$default" == "Y" ]]; then
            read -rp "$(echo -e "${BOLD}[?]${NC} $question [Y/n]: ")" ans
            case "${ans:-Y}" in
                [Yy]*) return 0 ;;
                [Nn]*) return 1 ;;
            esac
        else
            read -rp "$(echo -e "${BOLD}[?]${NC} $question [y/N]: ")" ans
            case "${ans:-N}" in
                [Yy]*) return 0 ;;
                [Nn]*) return 1 ;;
            esac
        fi
    done
}

disable_caddy_source_for_apt_preflight() {
    # A previous interrupted installation may have written the repository
    # before its keyring was ready. Temporarily disable only MSM's known Caddy
    # source so the base apt update can repair that state safely.
    if [[ ! -f "$CADDY_SOURCE_FILE" ]]; then
        return 0
    fi

    CADDY_SOURCE_BACKUP=$(mktemp "${CADDY_SOURCE_FILE}.msm-disabled.XXXXXX")
    rm -f "$CADDY_SOURCE_BACKUP"
    mv "$CADDY_SOURCE_FILE" "$CADDY_SOURCE_BACKUP"
    log "Bestehende Caddy-Paketquelle wird vor der Schlüsselprüfung vorübergehend deaktiviert."
}

configure_caddy_repository() {
    local armored_key keyring_tmp source_tmp

    install -d -m 0755 /usr/share/keyrings /etc/apt/sources.list.d
    armored_key=$(mktemp /tmp/msm-caddy-key.XXXXXX.asc)
    keyring_tmp=$(mktemp /usr/share/keyrings/.caddy-stable-keyring.XXXXXX)
    source_tmp=$(mktemp /etc/apt/sources.list.d/.caddy-stable.XXXXXX)

    if ! curl -fsSL --retry 3 --retry-delay 2 \
        https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
        -o "$armored_key"; then
        rm -f "$armored_key" "$keyring_tmp" "$source_tmp"
        err "Caddy-Signaturschlüssel konnte nicht geladen werden. Paketquelle bleibt sicher deaktiviert."
    fi

    if ! gpg --batch --show-keys --with-colons "$armored_key" 2>/dev/null \
        | awk -F: -v expected="$CADDY_SIGNING_FINGERPRINT" \
            '$1 == "fpr" && $10 == expected { found=1 } END { exit found ? 0 : 1 }'; then
        rm -f "$armored_key" "$keyring_tmp" "$source_tmp"
        err "Caddy-Signaturschlüssel hat nicht den erwarteten Fingerprint. Paketquelle bleibt deaktiviert."
    fi

    if ! gpg --batch --yes --dearmor --output "$keyring_tmp" "$armored_key"; then
        rm -f "$armored_key" "$keyring_tmp" "$source_tmp"
        err "Caddy-Signaturschlüssel konnte nicht verarbeitet werden. Paketquelle bleibt deaktiviert."
    fi
    chmod 0644 "$keyring_tmp"

    cat > "$source_tmp" <<EOF
# Source: Caddy stable (managed by MSM install.sh)
deb [signed-by=$CADDY_KEYRING_FILE] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main
EOF
    chmod 0644 "$source_tmp"

    mv -f "$keyring_tmp" "$CADDY_KEYRING_FILE"
    mv -f "$source_tmp" "$CADDY_SOURCE_FILE"
    rm -f "$armored_key"
    if [[ -n "$CADDY_SOURCE_BACKUP" ]]; then
        rm -f "$CADDY_SOURCE_BACKUP"
        CADDY_SOURCE_BACKUP=""
    fi
    ok "Caddy-Paketquelle und Signaturschlüssel geprüft"
}

SIMPLE_INSTALL=false
INSTALL_DOMAIN=""
RESUME_PARTIAL=false
CONTROL_PLANE_ONLY=false
EXTERNAL_FRONTEND_ORIGIN=""
INSTALL_GVISOR=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --simple)
            SIMPLE_INSTALL=true
            shift
            ;;
        --domain)
            [[ $# -ge 2 ]] || err "--domain benötigt einen Domainnamen."
            INSTALL_DOMAIN="$2"
            shift 2
            ;;
        --resume-partial)
            RESUME_PARTIAL=true
            shift
            ;;
        --control-plane-only)
            CONTROL_PLANE_ONLY=true
            shift
            ;;
        --external-frontend)
            [[ $# -ge 2 ]] || err "--external-frontend benötigt eine HTTPS-Origin."
            EXTERNAL_FRONTEND_ORIGIN="${2%/}"
            shift 2
            ;;
        --with-gvisor)
            INSTALL_GVISOR=true
            shift
            ;;
        *)
            err "Unbekannte Option: $1"
            ;;
    esac
done
if [[ -n "$INSTALL_DOMAIN" ]] && [[ ! "$INSTALL_DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    err "Ungültige Domain. Beispiel: panel.example.com"
fi
if [[ -n "$EXTERNAL_FRONTEND_ORIGIN" ]] \
    && [[ ! "$EXTERNAL_FRONTEND_ORIGIN" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]]; then
    err "Ungültige Frontend-Origin. Erwartet: https://panel.example.com ohne Pfad."
fi

# ═══════════════════════════════════════════════════════════════
# Re-Install Hilfsfunktionen
# ═══════════════════════════════════════════════════════════════

load_current_env() {
    local env_file="$MSM_DIR/backend/.env"

    CURRENT_DOMAIN=""
    CURRENT_PANEL_URL=""
    CURRENT_SERVE_FRONTEND="true"
    CURRENT_EMAIL_PROVIDER="smtp"
    CURRENT_SMTP_HOST=""
    CURRENT_SMTP_PORT="587"
    CURRENT_SMTP_USER=""
    CURRENT_SMTP_PASS=""
    CURRENT_SMTP_FROM=""
    CURRENT_RESEND_API_KEY=""
    CURRENT_USE_POSTGRES=false
    CURRENT_REDIS_URL=""
    CURRENT_AUTO_UPDATE="false"
    CURRENT_SECRET_KEY=""
    CURRENT_DB_URL=""
    CURRENT_DB_URL_ASYNC=""
    CURRENT_LOCAL_AGENT_ENABLED="true"

    [[ -f "$env_file" ]] || return

    local val

    CURRENT_PANEL_URL=$(grep -E '^MSM_PANEL_URL=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    val=$(grep -E '^MSM_API_URL=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -z "$val" ]]; then
        # Legacy all-in-one installs did not yet persist a distinct API URL.
        val="$CURRENT_PANEL_URL"
    fi
    if [[ -n "$val" ]]; then
        CURRENT_DOMAIN="$val"
        CURRENT_DOMAIN="${CURRENT_DOMAIN#http://}"
        CURRENT_DOMAIN="${CURRENT_DOMAIN#https://}"
    fi

    # Optional keys: missing vars must not make this function return non-zero
    # under `set -e` (a trailing `[[ -n ]] && assign` with empty val does).
    val=$(grep -E '^MSM_SERVE_FRONTEND=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_SERVE_FRONTEND="$val"; fi

    val=$(grep -E '^MSM_EMAIL_PROVIDER=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_EMAIL_PROVIDER="$val"; fi

    val=$(grep -E '^MSM_SMTP_HOST=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_SMTP_HOST="$val"; fi

    val=$(grep -E '^MSM_SMTP_PORT=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_SMTP_PORT="$val"; fi

    val=$(grep -E '^MSM_SMTP_USER=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_SMTP_USER="$val"; fi

    val=$(grep -E '^MSM_SMTP_PASSWORD=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_SMTP_PASS="$val"; fi

    val=$(grep -E '^MSM_SMTP_FROM=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_SMTP_FROM="$val"; fi

    val=$(grep -E '^MSM_RESEND_API_KEY=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_RESEND_API_KEY="$val"; fi

    val=$(grep -E '^MSM_DATABASE_URL=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ "$val" == postgresql* ]]; then
        CURRENT_USE_POSTGRES=true
    else
        CURRENT_USE_POSTGRES=false
    fi
    if [[ -n "$val" ]]; then CURRENT_DB_URL="$val"; fi

    val=$(grep -E '^MSM_DATABASE_URL_ASYNC=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_DB_URL_ASYNC="$val"; fi

    val=$(grep -E '^MSM_REDIS_URL=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_REDIS_URL="$val"; fi

    val=$(grep -E '^MSM_AUTO_UPDATE=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_AUTO_UPDATE="$val"; fi

    val=$(grep -E '^MSM_SECRET_KEY=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_SECRET_KEY="$val"; fi

    # Multi-node: absent on pre-multi-node .env → keep default "true"
    val=$(grep -E '^MSM_LOCAL_AGENT_ENABLED=' "$env_file" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    if [[ -n "$val" ]]; then CURRENT_LOCAL_AGENT_ENABLED="$val"; fi

    return 0
}

show_current_config() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Aktuelle Konfiguration gefunden${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}Domain:${NC}          ${CURRENT_DOMAIN:-<nicht gesetzt>}"
    echo -e "  ${BOLD}Email-Provider:${NC}  ${CURRENT_EMAIL_PROVIDER}"
    if [[ "$CURRENT_EMAIL_PROVIDER" == "resend" ]]; then
        if [[ -n "$CURRENT_RESEND_API_KEY" ]]; then
            echo -e "  ${BOLD}Resend API-Key:${NC}  *** konfiguriert ***"
        else
            echo -e "  ${BOLD}Resend API-Key:${NC}  <nicht gesetzt>"
        fi
    else
        echo -e "  ${BOLD}SMTP-Host:${NC}       ${CURRENT_SMTP_HOST:-<nicht gesetzt>}"
        echo -e "  ${BOLD}SMTP-Port:${NC}       ${CURRENT_SMTP_PORT:-587}"
        echo -e "  ${BOLD}SMTP-User:${NC}       ${CURRENT_SMTP_USER:-<nicht gesetzt>}"
        if [[ -n "$CURRENT_SMTP_PASS" ]]; then
            echo -e "  ${BOLD}SMTP-Passwort:${NC}   *** konfiguriert ***"
        else
            echo -e "  ${BOLD}SMTP-Passwort:${NC}   <nicht gesetzt>"
        fi
    fi
    echo -e "  ${BOLD}SMTP-From:${NC}       ${CURRENT_SMTP_FROM:-<nicht gesetzt>}"
    echo -e "  ${BOLD}Datenbank:${NC}       PostgreSQL"
    if [[ -n "$CURRENT_REDIS_URL" ]]; then
        echo -e "  ${BOLD}Redis:${NC}           Aktiviert"
    else
        echo -e "  ${BOLD}Redis:${NC}           Deaktiviert"
    fi
    if [[ "$CURRENT_AUTO_UPDATE" == "true" ]]; then
        echo -e "  ${BOLD}Auto-Update:${NC}     Aktiviert"
    else
        echo -e "  ${BOLD}Auto-Update:${NC}     Deaktiviert"
    fi
    echo ""
}

# ═══════════════════════════════════════════════════════════════
# 0. Prüfungen
# ═══════════════════════════════════════════════════════════════
if [[ $EUID -ne 0 ]]; then
    err "Bitte als root ausführen: sudo bash install.sh"
fi

if ! grep -qEi 'ubuntu|debian' /etc/os-release 2>/dev/null; then
    warn "Nicht Ubuntu/Debian erkannt. Fortfahren auf eigene Gefahr."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -d "$SCRIPT_DIR/backend" || ! -d "$SCRIPT_DIR/frontend" ]]; then
    err "Backend/Frontend nicht gefunden. Bitte aus dem Repository-Root ausführen."
fi

# Prüfe ob systemd aktiv und verfügbar ist (einmalig, damit die Prüfung nicht wiederholt werden muss)
if [[ -d /run/systemd/system ]] && command -v systemctl &>/dev/null; then
    SYSTEMD_AVAILABLE=true
else
    SYSTEMD_AVAILABLE=false
fi
if $SIMPLE_INSTALL && ! $SYSTEMD_AVAILABLE; then
    err "Die einfache Produktionsinstallation benötigt systemd (Ubuntu/Debian Server)."
fi

ensure_subid_entry() {
    local file="$1"
    local user="$2"
    local count="65536"
    touch "$file"
    chmod 644 "$file"
    if grep -qE "^${user}:" "$file"; then
        return 0
    fi
    local start
    start=$(awk -F: '
        BEGIN { max = 99999 }
        NF >= 3 {
            end = $2 + $3 - 1
            if (end > max) max = end
        }
        END { print max + 1 }
    ' "$file")
    echo "${user}:${start}:${count}" >> "$file"
}

# Create/repair a per-app Python venv as target user (defaults to $MSM_USER).
# Durable against: root-owned trees after git checkout, half-created venvs,
# and PEP 668 (system pip) when activate fails.
# Usage: prepare_app_venv /path/to/app "Label" [recreate=true|false] [target_user=$MSM_USER]
prepare_app_venv() {
    local app_dir="$1"
    local label="$2"
    local recreate="${3:-false}"
    local target_user="${4:-$MSM_USER}"

    [[ -d "$app_dir" ]] || err "$label: Verzeichnis fehlt: $app_dir"
    id "$target_user" &>/dev/null || err "$label: Systemuser $target_user existiert nicht"
    command -v python3 &>/dev/null || err "$label: python3 fehlt"
    # python3-venv must be present for `python3 -m venv`
    if ! python3 -c "import venv" 2>/dev/null; then
        err "$label: python3-venv fehlt (apt install python3-venv)"
    fi

    # Hard requirement: app tree writable by target user (no silent chown failure)
    chown -R "$target_user:$target_user" "$app_dir" \
        || err "$label: chown $target_user:$target_user auf $app_dir fehlgeschlagen (als root?)"

    if [[ -e "$app_dir/venv" ]]; then
        local vowner
        vowner=$(stat -c '%U' "$app_dir/venv" 2>/dev/null || echo "")
        if [[ "$recreate" == "true" ]] \
            || [[ "$vowner" != "$target_user" ]] \
            || [[ ! -x "$app_dir/venv/bin/python" ]]; then
            rm -rf "$app_dir/venv"
        fi
    fi

    # Run entirely as target user so venv/bin/* never lands root-owned
    # and pip never hits the externally-managed system Python (PEP 668).
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
            \"\$PWD/venv/bin/python\"|\"\$PWD/venv/bin/python3\"|*/venv/bin/python*) ;;
            *) echo \"ERROR: $label: pip would use system Python (PEP 668 risk): \$(command -v python)\" >&2; exit 1 ;;
        esac
        pip install --upgrade pip -q
        pip install -r requirements.txt -q
        test -x venv/bin/python
    " 2>&1 | tee -a "$LOG_FILE"; then
        err "$label: venv-Setup fehlgeschlagen. Ownership jetzt: $(stat -c '%U:%G' "$app_dir" 2>/dev/null || echo '?') — erwarte $MSM_USER:$MSM_USER"
    fi

    if [[ ! -x "$app_dir/venv/bin/python" ]]; then
        err "$label: venv/bin/python fehlt nach Setup"
    fi
    local py_owner
    py_owner=$(stat -c '%U' "$app_dir/venv/bin/python" 2>/dev/null || echo "")
    # python is often a symlink; ownership of the link target may vary — check venv dir
    local venv_owner
    venv_owner=$(stat -c '%U' "$app_dir/venv" 2>/dev/null || echo "")
    if [[ "$venv_owner" != "$MSM_USER" ]]; then
        err "$label: venv gehört $venv_owner, nicht $MSM_USER"
    fi
}

stop_legacy_rootful_msm_containers() {
    if ! $REINSTALL_MODE || ! command -v docker &>/dev/null; then
        return 0
    fi
    local containers
    containers=$(env -u DOCKER_HOST docker ps --format '{{.Names}}' 2>/dev/null | awk '/^msm-srv-/ {print}' || true)
    if [[ -z "$containers" ]]; then
        return 0
    fi
    warn "Rootless-Docker-Migration: Stoppe bestehende rootful MSM-Container. Sie werden nicht gelöscht."
    while read -r container; do
        [[ -z "$container" ]] && continue
        env -u DOCKER_HOST docker stop "$container" 2>&1 | tee -a "$LOG_FILE" || true
    done <<< "$containers"
    warn "Migration aktiv: MSM verwaltet Container ab jetzt über Rootless Docker. Bestehende rootful Container bleiben als Altbestand erhalten."
}

install_optional_gvisor() {
    if ! $INSTALL_GVISOR; then
        return 0
    fi
    if command -v runsc &>/dev/null; then
        ok "gVisor (runsc) bereits installiert"
        return 0
    fi
    log "Installiere gVisor (runsc) Sandbox-Runtime..."
    local arch
    arch="$(uname -m)"
    if curl -fsSL "https://storage.googleapis.com/gvisor/releases/release/latest/${arch}/runsc" -o /usr/local/bin/runsc \
        && curl -fsSL "https://storage.googleapis.com/gvisor/releases/release/latest/${arch}/containerd-shim-runsc-v1" -o /usr/local/bin/containerd-shim-runsc-v1; then
        chmod 0755 /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1
        ln -sf /usr/local/bin/runsc /usr/bin/runsc 2>/dev/null || true
        ln -sf /usr/local/bin/containerd-shim-runsc-v1 /usr/bin/containerd-shim-runsc-v1 2>/dev/null || true
        ok "gVisor (runsc) bereit"
    else
        rm -f /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1
        warn "gVisor (runsc) konnte nicht geladen werden — fahre mit runc fort."
    fi
}

setup_rootless_docker() {
    MSM_UID=$(id -u "$MSM_USER")
    MSM_AGENT_UID=$(id -u "$MSM_AGENT_USER")
    MSM_DOCKER_UID=$(id -u "$MSM_DOCKER_USER")
    MSM_DOCKER_HOST="unix:///run/user/${MSM_DOCKER_UID}/docker.sock"

    ensure_subid_entry /etc/subuid "$MSM_DOCKER_USER"
    ensure_subid_entry /etc/subgid "$MSM_DOCKER_USER"

    for _u in "$MSM_USER" "$MSM_AGENT_USER" "$MSM_DOCKER_USER"; do
        if id -nG "$_u" 2>/dev/null | grep -qw docker; then
            log "Entferne $_u aus der globalen docker-Gruppe..."
            gpasswd -d "$_u" docker 2>&1 | tee -a "$LOG_FILE" || true
        fi
    done

    stop_legacy_rootful_msm_containers

    if ! command -v dockerd-rootless-setuptool.sh &>/dev/null; then
        err "dockerd-rootless-setuptool.sh nicht gefunden. Docker Engine wurde nicht korrekt installiert."
    fi

    install_optional_gvisor

    # Migration von Single-User ($MSM_USER) Rootless Docker nach $MSM_DOCKER_USER (einmalig)
    if [[ -d "$MSM_DIR/.local/share/docker" ]] && [[ ! -d "$MSM_DOCKER_HOME/.local/share/docker" ]]; then
        log "Migriere bestehenden Rootless-Docker-Datenbaum nach $MSM_DOCKER_HOME..."
        su -s /bin/bash "$MSM_USER" -c "export XDG_RUNTIME_DIR=/run/user/${MSM_UID}; systemctl --user stop docker.service" 2>/dev/null || true
        mkdir -p "$MSM_DOCKER_HOME/.local/share"
        mv "$MSM_DIR/.local/share/docker" "$MSM_DOCKER_HOME/.local/share/docker"
        chown -R "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$MSM_DOCKER_HOME"
    fi

    if $SYSTEMD_AVAILABLE; then
        modprobe br_netfilter 2>/dev/null || true
        printf 'br_netfilter\n' > /etc/modules-load.d/msm-docker.conf
        mkdir -p /etc/systemd/system/user@.service.d
        cat > /etc/systemd/system/user@.service.d/delegate.conf <<'EOF'
[Service]
Delegate=cpu cpuset io memory pids
EOF

        mkdir -p "/etc/systemd/system/user@${MSM_DOCKER_UID}.service.d"
        cat > "/etc/systemd/system/user@${MSM_DOCKER_UID}.service.d/msm-workloads.conf" <<'EOF'
[Service]
Slice=msm-workloads.slice
OOMScoreAdjust=500
EOF
        systemctl daemon-reload

        loginctl enable-linger "$MSM_DOCKER_USER" 2>&1 | tee -a "$LOG_FILE" || true
        systemctl start "user@${MSM_DOCKER_UID}.service" 2>&1 | tee -a "$LOG_FILE" || true
        install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 710 "/run/user/${MSM_DOCKER_UID}" 2>/dev/null || true

        if [[ -f "${MSM_DOCKER_HOME}/.config/systemd/user/docker.service" ]]; then
            log "Rootless-Docker-User-Service für $MSM_DOCKER_USER existiert bereits."
        else
            log "Richte Rootless Docker isoliert für $MSM_DOCKER_USER ein..."
            su -s /bin/bash "$MSM_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${MSM_DOCKER_UID}; dockerd-rootless-setuptool.sh install" 2>&1 | tee -a "$LOG_FILE" || \
                err "Rootless-Docker-Setup für $MSM_DOCKER_USER fehlgeschlagen"
        fi

        install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 700 "${MSM_DOCKER_HOME}/.config/docker"
        if command -v runsc &>/dev/null; then
            cat > "${MSM_DOCKER_HOME}/.config/docker/daemon.json" <<'EOF'
{
  "icc": false,
  "no-new-privileges": true,
  "userland-proxy": false,
  "exec-opts": ["native.cgroupdriver=cgroupfs"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  },
  "runtimes": {
    "runsc": {
      "path": "/usr/bin/runsc"
    }
  }
}
EOF
        else
            cat > "${MSM_DOCKER_HOME}/.config/docker/daemon.json" <<'EOF'
{
  "icc": false,
  "no-new-privileges": true,
  "userland-proxy": false,
  "exec-opts": ["native.cgroupdriver=cgroupfs"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  }
}
EOF
        fi
        chown "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "${MSM_DOCKER_HOME}/.config/docker/daemon.json"
        chmod 0644 "${MSM_DOCKER_HOME}/.config/docker/daemon.json"

        log "Konfiguriere slirp4netns ohne Host-Loopback-Zugriff..."
        su -s /bin/bash "$MSM_DOCKER_USER" -c "mkdir -p ~/.config/systemd/user/docker.service.d && printf '[Service]\nEnvironment=\"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${MSM_DOCKER_UID}/bus\"\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns\"\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true\"\n' > ~/.config/systemd/user/docker.service.d/override.conf" 2>&1 | tee -a "$LOG_FILE" || true
        su -s /bin/bash "$MSM_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${MSM_DOCKER_UID} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${MSM_DOCKER_UID}/bus; systemctl --user daemon-reload" 2>&1 | tee -a "$LOG_FILE" || true
        su -s /bin/bash "$MSM_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${MSM_DOCKER_UID} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${MSM_DOCKER_UID}/bus; systemctl --user enable docker.service && systemctl --user restart docker.service" 2>&1 | tee -a "$LOG_FILE" || \
            err "Rootless-Docker-User-Service konnte nicht gestartet werden"

        # Socket-ACL-Helper: erlaubt ausschließlich msm-agent den Zugriff auf msm-docker docker.sock (niemals msm panel!)
        mkdir -p /usr/local/sbin
        cat > /usr/local/sbin/msm-docker-socket-acl <<ACLEOF
#!/bin/sh
set -eu
DOCKER_UID="$MSM_DOCKER_UID"
AGENT_USER="$MSM_AGENT_USER"
RUNTIME_DIR="/run/user/\${DOCKER_UID}"
SOCK="\${RUNTIME_DIR}/docker.sock"
if [ -d "\$RUNTIME_DIR" ] && command -v setfacl >/dev/null 2>&1; then
    chmod 0710 "\$RUNTIME_DIR" || true
    setfacl -m "u:\${AGENT_USER}:x" "\$RUNTIME_DIR" || true
fi
if [ -S "\$SOCK" ] && command -v setfacl >/dev/null 2>&1; then
    chmod 0660 "\$SOCK" || true
    setfacl -m "u:\${AGENT_USER}:rw" "\$SOCK" || true
fi
ACLEOF
        chown root:root /usr/local/sbin/msm-docker-socket-acl
        chmod 0755 /usr/local/sbin/msm-docker-socket-acl
        /usr/local/sbin/msm-docker-socket-acl || true

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
        systemctl daemon-reload
        systemctl enable msm-docker-socket-acl.path >/dev/null 2>&1 || true
        systemctl start msm-docker-socket-acl.path >/dev/null 2>&1 || true

        log "Lade Tool-Images über isolierten Rootless Docker vor (steamcmd, alpine/git)..."
        su -s /bin/bash "$MSM_DOCKER_USER" -c "export DOCKER_HOST='${MSM_DOCKER_HOST}'; docker pull cm2network/steamcmd:root" 2>&1 | tee -a "$LOG_FILE" || \
            warn "Konnte SteamCMD-Image nicht vorziehen — wird beim ersten Server-Install nachgeholt."
        su -s /bin/bash "$MSM_DOCKER_USER" -c "export DOCKER_HOST='${MSM_DOCKER_HOST}'; docker pull alpine/git:latest" 2>/dev/null || true
    else
        warn "systemd nicht verfügbar. Rootless Docker wird vorbereitet, aber der User-Service kann nicht aktiviert werden."
    fi

    ok "Rootless Docker isoliert bereit (${MSM_DOCKER_HOST}, User: ${MSM_DOCKER_USER})"
}

log "=== Maunting Service Manager Installation ==="
log "Log: $LOG_FILE"
log ""

# ═══════════════════════════════════════════════════════════════
# 0b. Existierende Installation erkennen & laden
# ═══════════════════════════════════════════════════════════════
REINSTALL_MODE=false
KEEP_SETTINGS=false
CHANGED_DOMAIN=false
CHANGED_EMAIL=false
CHANGED_REDIS=false
CHANGED_AUTO_UPDATE=false
NEED_FULL_REBUILD=false
CODE_CHANGED=false

if [[ "$SCRIPT_DIR" != "$MSM_DIR" ]]; then
    CODE_CHANGED=true
fi

if [[ -f "$MSM_DIR/backend/.env" ]]; then
    REINSTALL_MODE=true
    load_current_env
    if ! $CURRENT_USE_POSTGRES; then
        err "Die bestehende Installation nutzt keine PostgreSQL-Datenbank (MSM_DATABASE_URL in backend/.env). SQLite wird nicht mehr unterstützt — zuerst mit einer älteren MSM-Version nach PostgreSQL umziehen."
    fi
    show_current_config

    if $SIMPLE_INSTALL; then
        KEEP_SETTINGS=true
        NEED_FULL_REBUILD=true
        if [[ -n "$INSTALL_DOMAIN" && "$INSTALL_DOMAIN" != "$CURRENT_DOMAIN" ]]; then
            CHANGED_DOMAIN=true
            log "Bestehende Einstellungen bleiben erhalten; Domain wird auf '$INSTALL_DOMAIN' aktualisiert."
        else
            log "Bestehende Einstellungen werden unverändert übernommen."
        fi
    else
        echo -e "${BOLD}[?]${NC} Einstellungen beibehalten oder ändern?"
        echo "    1) Beibehalten — nur Code aktualisieren, Frontend neu bauen, Services neustarten"
        echo "    2) Ändern — Konfiguration anpassen (Domain, Email, DB, Redis, Auto-Update)"
        ask "[1/2]: " choice

        if [[ "$choice" == "1" ]]; then
            KEEP_SETTINGS=true
            NEED_FULL_REBUILD=true
            log "Re-Install Modus: Einstellungen beibehalten, Code aktualisieren..."
        else
            KEEP_SETTINGS=false
            log "Re-Install Modus: Konfiguration wird angepasst..."
        fi
    fi
else
    log "Frische Installation erkannt..."
fi
if $RESUME_PARTIAL && $REINSTALL_MODE; then
    err "--resume-partial ist nur für eine abgebrochene Erstinstallation ohne backend/.env erlaubt."
fi
INSTALL_LOCAL_AGENT=true
if $CONTROL_PLANE_ONLY; then
    INSTALL_LOCAL_AGENT=false
elif $REINSTALL_MODE && [[ "$CURRENT_LOCAL_AGENT_ENABLED" == "false" ]]; then
    INSTALL_LOCAL_AGENT=false
fi
if $CONTROL_PLANE_ONLY && $REINSTALL_MODE && [[ "$CURRENT_LOCAL_AGENT_ENABLED" != "false" ]]; then
    err "Eine bestehende All-in-one-Installation darf nur über den Migrationsassistenten auf Backend-only umgestellt werden."
fi

# ═══════════════════════════════════════════════════════════════
# 1. System-Abhängigkeiten
# ═══════════════════════════════════════════════════════════════
log "Aktualisiere Paketlisten..."
# --allow-releaseinfo-change=true: PPAs (z.B. ondrej/php) ändern gelegentlich Label/Suite;
# ohne Flag bricht apt-get update non-interaktiv ab (E: Repository ... changed its 'Label').
disable_caddy_source_for_apt_preflight
apt-get update -qq --allow-releaseinfo-change=true | tee -a "$LOG_FILE"

log "Installiere Basis-Pakete..."
apt-get install -y -qq \
    ca-certificates curl wget git gnupg jq openssl rsync sudo \
    python3 python3-pip python3-venv \
    systemd systemd-sysv \
    libc6-i386 lib32stdc++6 lib32gcc-s1 \
    software-properties-common lsb-release \
    debian-keyring debian-archive-keyring apt-transport-https \
    uidmap dbus-user-session slirp4netns ufw iptables \
    acl quota e2fsprogs apparmor apparmor-utils \
    2>&1 | tee -a "$LOG_FILE"

# ── Node.js 20 (nicht das veraltete aus apt) ──
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]]; then
    log "Installiere Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tee -a "$LOG_FILE"
    apt-get install -y -qq nodejs 2>&1 | tee -a "$LOG_FILE"
fi

# ── Caddy (offizielles Repo für aktuelle Version) ──
# Die Quelle wird bei jedem Lauf sicher repariert. Paketupdates behalten eine
# bestehende Caddyfile ausdrücklich bei.
configure_caddy_repository
apt-get update -qq --allow-releaseinfo-change=true | tee -a "$LOG_FILE"
log "Installiere beziehungsweise aktualisiere Caddy..."
apt-get install -y -qq -o Dpkg::Options::="--force-confold" caddy 2>&1 | tee -a "$LOG_FILE"
if command -v caddy &>/dev/null; then
    if [[ -f /etc/caddy/Caddyfile ]]; then
        ok "Caddy bereits vorhanden — bestehende Caddyfile wird erhalten."
    else
        # Caddy ist installiert, aber keine Caddyfile → Minimal-Datei anlegen
        log "Erstelle minimale Caddyfile (bestehende fehlt)..."
        mkdir -p /etc/caddy
        cat > /etc/caddy/Caddyfile <<'CADDYEOF'
import /etc/caddy/conf.d/*.conf
CADDYEOF
        ok "Minimal-Caddyfile angelegt."
    fi
else
    err "Caddy wurde nicht vollständig installiert."
fi

# ── Docker (Game-Server-Runtime — Rootless) ──
# Docker Engine/CLI bleiben Systempakete. MSM nutzt danach ausschließlich den
# Rootless-Daemon des msm-Users, nie /var/run/docker.sock.
if $INSTALL_LOCAL_AGENT; then
    if ! command -v docker &>/dev/null; then
        log "Installiere Docker (offizieller Installer von docker.com)..."
        curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
        sh /tmp/get-docker.sh 2>&1 | tee -a "$LOG_FILE"
        rm -f /tmp/get-docker.sh
        ok "Docker installiert"
    else
        log "Docker bereits installiert ($(docker --version 2>/dev/null || echo unbekannt))"
    fi
else
    log "Backend-only: lokale Docker-/Agent-Runtime wird nicht installiert."
fi

ok "System-Abhängigkeiten installiert"

# ═══════════════════════════════════════════════════════════════
# 2. Redis (optional, empfohlen für Rate-Limiting)
# ═══════════════════════════════════════════════════════════════
INSTALL_REDIS=false
MSM_REDIS_URL=""

if $REINSTALL_MODE && $KEEP_SETTINGS; then
    # Keep mode: aktuellen Redis-Status beibehalten
    if [[ -n "$CURRENT_REDIS_URL" ]]; then
        INSTALL_REDIS=true
        MSM_REDIS_URL="$CURRENT_REDIS_URL"
        log "Redis bleibt aktiviert..."
    else
        INSTALL_REDIS=false
        MSM_REDIS_URL=""
        log "Redis bleibt deaktiviert..."
    fi
elif $REINSTALL_MODE && ! $KEEP_SETTINGS; then
    # Change mode: frage Toggle
    if [[ -n "$CURRENT_REDIS_URL" ]]; then
        echo ""
        echo -e "${BOLD}Redis ist aktuell aktiviert.${NC}"
        if ask_yesno "Redis deaktivieren?"; then
            INSTALL_REDIS=false
            MSM_REDIS_URL=""
            CHANGED_REDIS=true
            if $SYSTEMD_AVAILABLE; then
                systemctl stop redis-server 2>/dev/null || true
            else
                service redis-server stop 2>/dev/null || true
            fi
        else
            INSTALL_REDIS=true
            MSM_REDIS_URL="$CURRENT_REDIS_URL"
        fi
    else
        echo ""
        echo -e "${BOLD}Redis ist aktuell deaktiviert.${NC}"
        if ask_yesno "Redis für verteiltes Rate-Limiting aktivieren?"; then
            INSTALL_REDIS=true
            MSM_REDIS_URL="redis://localhost:6379"
            CHANGED_REDIS=true
        else
            INSTALL_REDIS=false
            MSM_REDIS_URL=""
        fi
    fi
else
    # Fresh install
    if $SIMPLE_INSTALL || ask_yesno "Redis für verteiltes Rate-Limiting installieren? (empfohlen für Produktion)"; then
        INSTALL_REDIS=true
        MSM_REDIS_URL="redis://localhost:6379"
    else
        INSTALL_REDIS=false
        MSM_REDIS_URL=""
    fi
fi

# Redis installieren/Starten & härten wenn nötig
if $INSTALL_REDIS; then
    if ! command -v redis-server &>/dev/null; then
        log "Installiere Redis..."
        apt-get install -y -qq redis-server 2>&1 | tee -a "$LOG_FILE"
    fi

    # Loopback-Bindung + starkes Passwort + gefährliche Kommandos deaktivieren
    REDIS_CONF="/etc/redis/redis.conf"
    REDIS_HARDEN_CONF="/etc/redis/msm-hardening.conf"
    REDIS_PASS=""
    if [[ -n "$MSM_REDIS_URL" ]]; then
        REDIS_PASS=$(python3 - "$MSM_REDIS_URL" <<'PYEOF'
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1])
print(urllib.parse.unquote(u.password or ""))
PYEOF
)
    fi
    if [[ -z "$REDIS_PASS" ]] && [[ -f "$REDIS_HARDEN_CONF" ]]; then
        REDIS_PASS=$(awk '/^requirepass[[:space:]]+/ {print $2; exit}' "$REDIS_HARDEN_CONF" 2>/dev/null || true)
    fi
    if [[ -z "$REDIS_PASS" ]]; then
        REDIS_PASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    fi

    if [[ -d /etc/redis ]]; then
        cat > "$REDIS_HARDEN_CONF" <<EOF
bind 127.0.0.1 ::1
protected-mode yes
requirepass $REDIS_PASS
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
rename-command SHUTDOWN ""
rename-command DEBUG ""
rename-command SAVE ""
rename-command BGSAVE ""
maxmemory-policy allkeys-lru
EOF
        chmod 640 "$REDIS_HARDEN_CONF"
        if id redis &>/dev/null; then
            chown root:redis "$REDIS_HARDEN_CONF"
        fi
        if [[ -f "$REDIS_CONF" ]] && ! grep -qF "include $REDIS_HARDEN_CONF" "$REDIS_CONF"; then
            printf '\ninclude %s\n' "$REDIS_HARDEN_CONF" >> "$REDIS_CONF"
        fi
    fi

    REDIS_ENC_PASS=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$REDIS_PASS")
    MSM_REDIS_URL="redis://:${REDIS_ENC_PASS}@127.0.0.1:6379/0"

    if $SYSTEMD_AVAILABLE; then
        systemctl enable redis-server >/dev/null 2>&1 || true
        systemctl restart redis-server >/dev/null 2>&1 || systemctl start redis-server >/dev/null 2>&1 || true
    else
        service redis-server restart 2>/dev/null || service redis-server start 2>/dev/null || true
    fi
    if ! $REINSTALL_MODE || ($REINSTALL_MODE && ! $KEEP_SETTINGS && $CHANGED_REDIS); then
        ok "Redis installiert, gehärtet und gestartet"
    fi
    REDISCLI_AUTH="$REDIS_PASS" redis-cli --no-auth-warning ping 2>/dev/null | grep -qx 'PONG' \
        || err "Redis wurde ausgewählt, ist aber nicht erreichbar."
else
    if ! $REINSTALL_MODE; then
        log "Redis wird übersprungen (Rate-Limiting nutzt in-memory Fallback)."
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 3. MSM System-User (3-User Privilegientrennung)
# ═══════════════════════════════════════════════════════════════
if ! id "$MSM_USER" &>/dev/null; then
    log "Erstelle Control-Plane-User '$MSM_USER'..."
    useradd -r -m -s /bin/bash -d "$MSM_DIR" "$MSM_USER"
fi
if ! id "$MSM_AGENT_USER" &>/dev/null; then
    log "Erstelle Node-Agent-User '$MSM_AGENT_USER'..."
    useradd -r -m -s /usr/sbin/nologin -d /var/lib/msm-agent "$MSM_AGENT_USER"
fi
if ! id "$MSM_DOCKER_USER" &>/dev/null; then
    log "Erstelle Rootless-Docker-User '$MSM_DOCKER_USER'..."
    useradd -r -m -s /bin/bash -d "$MSM_DOCKER_HOME" "$MSM_DOCKER_USER"
fi
if ! getent group "$MSM_SERVERS_GROUP" &>/dev/null; then
    groupadd -r "$MSM_SERVERS_GROUP"
fi
usermod -aG "$MSM_SERVERS_GROUP" "$MSM_AGENT_USER" 2>/dev/null || true
usermod -aG "$MSM_SERVERS_GROUP" "$MSM_DOCKER_USER" 2>/dev/null || true
install -d -o "$MSM_AGENT_USER" -g "$MSM_AGENT_USER" -m 750 /var/lib/msm-agent/guardian
install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 750 "$MSM_DOCKER_HOME"
ok "System-User bereit ($MSM_USER, $MSM_AGENT_USER, $MSM_DOCKER_USER)"

# ── Servers- und Backups-Verzeichnis anlegen ──
mkdir -p /opt/msm/servers
if $INSTALL_LOCAL_AGENT; then
    chown "$MSM_AGENT_USER:$MSM_SERVERS_GROUP" /opt/msm/servers
    chmod 0710 /opt/msm/servers
else
    chown "$MSM_USER:$MSM_USER" /opt/msm/servers
fi
mkdir -p /opt/msm/backups
chown "$MSM_USER:$MSM_USER" /opt/msm/backups
# Tresor-Cloud: nur verschluesselte Chunks, trotzdem nur fuer das Panel lesbar.
install -d -o "$MSM_USER" -g "$MSM_USER" -m 700 /opt/msm/vault-blobs
mkdir -p /opt/msm/blueprints/community
chown -R "$MSM_USER:$MSM_USER" /opt/msm/blueprints
chmod -R u+rwX,g+rwX /opt/msm/blueprints

MSM_DOCKER_HOST=""
if $INSTALL_LOCAL_AGENT; then
    setup_rootless_docker
fi

# ═══════════════════════════════════════════════════════════════
# 4. Dateien kopieren
# ═══════════════════════════════════════════════════════════════
SHOULD_COPY_FILES=false
if ! $REINSTALL_MODE; then
    SHOULD_COPY_FILES=true
elif $KEEP_SETTINGS; then
    SHOULD_COPY_FILES=true
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && $CODE_CHANGED; then
    SHOULD_COPY_FILES=true
fi

if $SHOULD_COPY_FILES; then
    log "Kopiere Panel-Dateien nach $MSM_DIR..."
    if [[ "$SCRIPT_DIR" == "$MSM_DIR" ]]; then
        # Install.sh läuft direkt im Zielverzeichnis → nicht löschen, nicht kopieren!
        # Nur alte Build-Artefakte und Konfigurationen aufräumen
        rm -rf "$MSM_DIR/frontend/dist" 2>/dev/null || true
        rm -rf "$MSM_DIR/frontend/node_modules" 2>/dev/null || true
        rm -rf "$MSM_DIR/backend/venv" 2>/dev/null || true
        rm -rf "$MSM_DIR/msm-agent/venv" 2>/dev/null || true
    else
        # Code gezielt synchronisieren. Laufzeitdaten und Secrets im Ziel werden
        # niemals durch eine Re-Installation geloescht oder ueberschrieben.
        mkdir -p "$MSM_DIR"

        rsync -a --chown="$MSM_USER:$MSM_USER" --delete \
            --exclude '.env' --exclude 'venv/' --exclude 'msm.db*' \
            --exclude '__pycache__/' --exclude '*.pyc' \
            "$SCRIPT_DIR/backend/" "$MSM_DIR/backend/"
        rsync -a --chown="$MSM_USER:$MSM_USER" --delete \
            --exclude 'node_modules/' --exclude 'dist/' \
            "$SCRIPT_DIR/frontend/" "$MSM_DIR/frontend/"
        if [[ -d "$SCRIPT_DIR/docs-sidecar" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete --exclude '.env' --exclude 'node_modules/' \
                --exclude 'test/' \
                "$SCRIPT_DIR/docs-sidecar/" "$MSM_DIR/docs-sidecar/"
        else
            warn "docs-sidecar fehlt im Release-Archiv — das Dokumente-Modul bleibt ohne Collab-Server dunkel."
        fi
        if [[ -d "$SCRIPT_DIR/dis-sidecar" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete --exclude '.env' --exclude 'node_modules/' \
                "$SCRIPT_DIR/dis-sidecar/" "$MSM_DIR/dis-sidecar/"
        fi
        if [[ -d "$SCRIPT_DIR/searxng-sidecar" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete \
                "$SCRIPT_DIR/searxng-sidecar/" "$MSM_DIR/searxng-sidecar/"
        fi
        if [[ -d "$SCRIPT_DIR/wetter-sidecar" ]]; then
            # daten/ enthält die geladenen Modellläufe und bleibt beim Update
            # erhalten; .env gehört dem Server, nicht dem Release.
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete \
                --exclude '.env' --exclude 'daten/' \
                --exclude '__pycache__/' --exclude '*.pyc' \
                "$SCRIPT_DIR/wetter-sidecar/" "$MSM_DIR/wetter-sidecar/"
        fi
        if [[ -d "$SCRIPT_DIR/livekit-sidecar" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete --exclude '.env' \
                "$SCRIPT_DIR/livekit-sidecar/" "$MSM_DIR/livekit-sidecar/"
        fi
        if [[ -d "$SCRIPT_DIR/msm-agent" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete \
                --exclude '.env' --exclude 'venv/' --exclude 'servers/' \
                --exclude 'postgres/' --exclude 'certs/' \
                --exclude '__pycache__/' --exclude '*.pyc' \
                "$SCRIPT_DIR/msm-agent/" "$MSM_DIR/msm-agent/"
        fi
        if [[ -d "$SCRIPT_DIR/docs" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete "$SCRIPT_DIR/docs/" "$MSM_DIR/docs/"
        fi
        if [[ -d "$SCRIPT_DIR/helper-scripts" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete "$SCRIPT_DIR/helper-scripts/" "$MSM_DIR/helper-scripts/"
        fi
        if [[ -d "$SCRIPT_DIR/scripts" ]]; then
            rsync -a --chown="$MSM_USER:$MSM_USER" --delete "$SCRIPT_DIR/scripts/" "$MSM_DIR/scripts/"
        fi
        cp "$SCRIPT_DIR/Caddyfile.template" "$MSM_DIR/" 2>/dev/null || true
        cp "$SCRIPT_DIR/msm.service.template" "$MSM_DIR/" 2>/dev/null || true
        cp "$SCRIPT_DIR/update.sh" "$MSM_DIR/" 2>/dev/null || true
        chmod +x "$MSM_DIR/update.sh" 2>/dev/null || true
    fi
    chown "$MSM_USER:$MSM_USER" "$MSM_DIR"
    chown "$MSM_USER:$MSM_USER" \
        "$MSM_DIR/Caddyfile.template" "$MSM_DIR/msm.service.template" "$MSM_DIR/update.sh" \
        2>/dev/null || true
    # In-place Install (git checkout as root) leaves trees root-owned. Backend +
    # agent venvs are created as $MSM_USER and need write access to their dirs.
    for _msm_tree in backend frontend dis-sidecar docs-sidecar searxng-sidecar livekit-sidecar wetter-sidecar msm-agent docs scripts helper-scripts blueprints; do
        if [[ -d "$MSM_DIR/$_msm_tree" ]]; then
            chown -R "$MSM_USER:$MSM_USER" "$MSM_DIR/$_msm_tree" 2>/dev/null || true
        fi
    done
    # Caddy braucht nur Traverse-Zugriff bis zum oeffentlichen Frontend. Keine
    # Verzeichnisauflistung und keine Gruppenmitgliedschaft (die Zugriff auf
    # den Rootless-Docker-Socket des msm-Users ermoeglichen koennte).
    chmod 0751 "$MSM_DIR"
    ok "Dateien bereit"
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && ! $CODE_CHANGED; then
    log "Quellverzeichnis identisch mit Ziel — keine Datei-Kopie nötig."
fi

# Always re-own code trees before Python venv work — even when SHOULD_COPY_FILES
# is false (e.g. git checkout as root left msm-agent root:root).
if id "$MSM_USER" &>/dev/null; then
    for _msm_tree in backend frontend dis-sidecar docs-sidecar docs scripts helper-scripts blueprints; do
        if [[ -d "$MSM_DIR/$_msm_tree" ]]; then
            chown -R "$MSM_USER:$MSM_USER" "$MSM_DIR/$_msm_tree" \
                || err "chown $MSM_USER:$MSM_USER auf $MSM_DIR/$_msm_tree fehlgeschlagen"
        fi
    done
    if [[ -d "$MSM_DIR/msm-agent" ]]; then
        chown -R "$MSM_AGENT_USER:$MSM_AGENT_USER" "$MSM_DIR/msm-agent" \
            || err "chown $MSM_AGENT_USER:$MSM_AGENT_USER auf $MSM_DIR/msm-agent fehlgeschlagen"
    fi
    for _docker_tree in searxng-sidecar livekit-sidecar wetter-sidecar; do
        if [[ -d "$MSM_DIR/$_docker_tree" ]]; then
            chown -R "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$MSM_DIR/$_docker_tree" \
                || err "chown $MSM_DOCKER_USER:$MSM_DOCKER_USER auf $MSM_DIR/$_docker_tree fehlgeschlagen"
        fi
    done
fi

# ═══════════════════════════════════════════════════════════════
# 5. Interaktive Konfiguration
# ═══════════════════════════════════════════════════════════════

# Defaults
DOMAIN=""
EMAIL_PROVIDER="smtp"
SMTP_HOST=""
SMTP_PORT=587
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
RESEND_API_KEY=""
USE_POSTGRES=true
PG_PASSWORD=""
MSM_AUTO_UPDATE="false"

if $REINSTALL_MODE && $KEEP_SETTINGS; then
    # Keep mode: alle aktuellen Werte übernehmen
    DOMAIN="${INSTALL_DOMAIN:-$CURRENT_DOMAIN}"
    EMAIL_PROVIDER="$CURRENT_EMAIL_PROVIDER"
    SMTP_HOST="$CURRENT_SMTP_HOST"
    SMTP_PORT="${CURRENT_SMTP_PORT:-587}"
    SMTP_USER="$CURRENT_SMTP_USER"
    SMTP_PASS="$CURRENT_SMTP_PASS"
    SMTP_FROM="$CURRENT_SMTP_FROM"
    RESEND_API_KEY="$CURRENT_RESEND_API_KEY"
    MSM_AUTO_UPDATE="$CURRENT_AUTO_UPDATE"

elif $REINSTALL_MODE && ! $KEEP_SETTINGS; then
    # ═══════════════════════════════════════════════════════════════
    # Change mode: 4 Fragen mit aktuellen Werten als Default
    # ═══════════════════════════════════════════════════════════════

    # ── 1/4 Domain ──
    echo ""
    echo -e "${BOLD}Schritt 1/4: Domain${NC}"
    echo "  Gib eine Domain an, damit Caddy automatisch ein SSL-Zertifikat erstellt."
    echo "  Ohne Domain wird das Panel über HTTP (nur IP) erreichbar — nicht empfohlen."
    echo "  Leer lassen um aktuellen Wert zu behalten: ${CURRENT_DOMAIN:-<nicht gesetzt>}"
    echo ""
    ask "Domain [${CURRENT_DOMAIN:-}]: " DOMAIN_INPUT
    DOMAIN="${DOMAIN_INPUT:-$CURRENT_DOMAIN}"
    if [[ "$DOMAIN" != "$CURRENT_DOMAIN" ]]; then
        CHANGED_DOMAIN=true
    fi

    # ── 2/4 Email ──
    echo ""
    echo -e "${BOLD}Schritt 2/4: Email-Versand${NC}"
    echo "  Aktueller Provider: ${CURRENT_EMAIL_PROVIDER}"
    echo "  'Ändern' wählen um Provider oder Details zu ändern."
    echo ""

    EMAIL_PROVIDER="$CURRENT_EMAIL_PROVIDER"
    SMTP_HOST="$CURRENT_SMTP_HOST"
    SMTP_PORT="${CURRENT_SMTP_PORT:-587}"
    SMTP_USER="$CURRENT_SMTP_USER"
    SMTP_PASS="$CURRENT_SMTP_PASS"
    SMTP_FROM="${CURRENT_SMTP_FROM:-noreply@mauntingstudios.de}"
    RESEND_API_KEY="$CURRENT_RESEND_API_KEY"

    if ask_yesno "Email-Einstellungen ändern?"; then
        echo ""
        echo -e "  ${BOLD}Provider wählen:${NC}"
        echo "    1) Resend (API-Key, einfach)"
        echo "    2) SMTP (Server-Daten)"
        ask "[1/2]: " EMAIL_CHOICE

        if [[ "$EMAIL_CHOICE" == "1" ]]; then
            EMAIL_PROVIDER="resend"
            ask_secret "Resend API-Key [leer = bestehenden behalten]: " RESEND_API_KEY
            RESEND_API_KEY="${RESEND_API_KEY:-$CURRENT_RESEND_API_KEY}"
            ask "Absender-Adresse [${CURRENT_SMTP_FROM:-noreply@mauntingstudios.de}]: " SMTP_FROM_INPUT
            SMTP_FROM="${SMTP_FROM_INPUT:-${CURRENT_SMTP_FROM:-noreply@mauntingstudios.de}}"
            ok "Resend konfiguriert"
        else
            EMAIL_PROVIDER="smtp"
            ask "SMTP-Host [${CURRENT_SMTP_HOST:-smtp.strato.de}]: " SMTP_HOST
            SMTP_HOST="${SMTP_HOST:-$CURRENT_SMTP_HOST}"
            ask "SMTP-Port [${CURRENT_SMTP_PORT:-587}]: " SMTP_PORT_INPUT
            SMTP_PORT="${SMTP_PORT_INPUT:-${CURRENT_SMTP_PORT:-587}}"
            ask "SMTP-Benutzername [${CURRENT_SMTP_USER:-}]: " SMTP_USER
            SMTP_USER="${SMTP_USER:-$CURRENT_SMTP_USER}"
            ask_secret "SMTP-Passwort [leer = bestehendes behalten]: " SMTP_PASS
            if [[ -z "$SMTP_PASS" ]]; then
                SMTP_PASS="$CURRENT_SMTP_PASS"
            fi
            ask "Absender-Adresse [${CURRENT_SMTP_FROM:-noreply@mauntingstudios.de}]: " SMTP_FROM_INPUT
            SMTP_FROM="${SMTP_FROM_INPUT:-${CURRENT_SMTP_FROM:-noreply@mauntingstudios.de}}"
            ok "SMTP konfiguriert"
        fi

        # Prüfe ob Email wirklich geändert wurde
        if [[ "$EMAIL_PROVIDER" != "$CURRENT_EMAIL_PROVIDER" ]]; then
            CHANGED_EMAIL=true
        elif [[ "$EMAIL_PROVIDER" == "resend" && "$RESEND_API_KEY" != "$CURRENT_RESEND_API_KEY" ]]; then
            CHANGED_EMAIL=true
        elif [[ "$EMAIL_PROVIDER" == "smtp" && ( "$SMTP_HOST" != "$CURRENT_SMTP_HOST" || "$SMTP_PORT" != "$CURRENT_SMTP_PORT" || "$SMTP_USER" != "$CURRENT_SMTP_USER" || "$SMTP_PASS" != "$CURRENT_SMTP_PASS" || "$SMTP_FROM" != "$CURRENT_SMTP_FROM" ) ]]; then
            CHANGED_EMAIL=true
        fi
    else
        log "Email-Einstellungen bleiben unverändert."
    fi

    # ── 3/4 PostgreSQL ──
    echo ""
    echo -e "${BOLD}Schritt 3/4: Datenbank${NC}"
    ok "PostgreSQL bleibt als Panel-Datenbank aktiv."

    # ── 4/4 Auto-Update ──
    echo ""
    echo -e "${BOLD}Schritt 4/4: Automatische Updates${NC}"
    if [[ "$CURRENT_AUTO_UPDATE" == "true" ]]; then
        echo "  Aktuell: Aktiviert"
        if ask_yesno_default "Automatische Updates beibehalten?" "Y"; then
            MSM_AUTO_UPDATE="true"
        else
            MSM_AUTO_UPDATE="false"
            CHANGED_AUTO_UPDATE=true
        fi
    else
        echo "  Aktuell: Deaktiviert"
        if ask_yesno_default "Automatische Updates aktivieren?" "N"; then
            MSM_AUTO_UPDATE="true"
            CHANGED_AUTO_UPDATE=true
        else
            MSM_AUTO_UPDATE="false"
        fi
    fi

    # Bestimme ob Full Rebuild nötig
    if $CODE_CHANGED; then
        NEED_FULL_REBUILD=true
    fi

else
    # ═══════════════════════════════════════════════════════════════
    # Fresh install flow (Original)
    # ═══════════════════════════════════════════════════════════════

    if $SIMPLE_INSTALL; then
        [[ -n "$INSTALL_DOMAIN" ]] \
            || err "Die einfache Installation benötigt --domain panel.example.com"
        DOMAIN="$INSTALL_DOMAIN"
        MSM_AUTO_UPDATE="false"
        ok "Domain: $DOMAIN"
        ok "PostgreSQL und Redis werden automatisch lokal eingerichtet."
        log "E-Mail wird sicher im Browser-Setup eingerichtet; automatische Updates bleiben aus."
    else

    # ── 5a. Domain ──
    echo ""
    echo -e "${BOLD}Schritt 1/4: Domain${NC}"
    echo "  Gib eine Domain an, damit Caddy automatisch ein SSL-Zertifikat erstellt."
    echo "  Ohne Domain wird das Panel über HTTP (nur IP) erreichbar — nicht empfohlen."
    echo ""
    ask "Domain (z.B. panel.deinserver.de) oder leer lassen für IP-Modus: " DOMAIN
    DOMAIN="${DOMAIN:-}"

    # ── 5b. Email ──
    echo ""
    echo -e "${BOLD}Schritt 2/4: Email-Versand${NC}"
    echo "  Wird für Setup-Verifikation, 2FA-Setup und Backup-Codes benötigt."
    echo "  Optionen:"
    echo "    1. Resend (resend.com) — API-Key, kein SMTP nötig, empfohlen"
    echo "    2. SMTP (eigener Server, Strato, Gmail, etc.)"
    echo "  Du kannst das später in /opt/msm/backend/.env nachholen."
    echo ""

    if ask_yesno "Email jetzt konfigurieren?"; then
        echo ""
        echo -e "  ${BOLD}Provider wählen:${NC}"
        echo "    1) Resend (API-Key, einfach)"
        echo "    2) SMTP (Server-Daten)"
        ask "[1/2]: " EMAIL_CHOICE

        if [[ "$EMAIL_CHOICE" == "1" ]]; then
            EMAIL_PROVIDER="resend"
            ask_secret "Resend API-Key (re_...): " RESEND_API_KEY
            ask "Absender-Adresse [noreply@mauntingstudios.de]: " SMTP_FROM_INPUT
            SMTP_FROM="${SMTP_FROM_INPUT:-noreply@mauntingstudios.de}"
            ok "Resend konfiguriert"
        else
            EMAIL_PROVIDER="smtp"
            ask "SMTP-Host (z.B. smtp.strato.de): " SMTP_HOST
            ask "SMTP-Port [587]: " SMTP_PORT_INPUT
            SMTP_PORT="${SMTP_PORT_INPUT:-587}"
            ask "SMTP-Benutzername: " SMTP_USER
            ask_secret "SMTP-Passwort: " SMTP_PASS
            ask "Absender-Adresse [noreply@mauntingstudios.de]: " SMTP_FROM_INPUT
            SMTP_FROM="${SMTP_FROM_INPUT:-noreply@mauntingstudios.de}"
            ok "SMTP konfiguriert"
        fi
    else
        warn "Email übersprungen. Setup-Verifikation und 2FA stehen erst nach Konfiguration zur Verfügung."
    fi

    # ── 5c. PostgreSQL ──
    echo ""
    echo -e "${BOLD}Schritt 3/4: Datenbank${NC}"
    ok "PostgreSQL wird automatisch und sicher auf Loopback eingerichtet."

    # ── 5d. Auto-Update ──
    echo ""
    echo -e "${BOLD}Schritt 4/4: Automatische Updates${NC}"
    echo "  Prüft täglich auf neue GitHub-Releases und installiert sie automatisch."
    echo "  Empfohlen für Produktion, aber Updates sollten vorher getestet werden."
    echo ""
    if ask_yesno "Automatische Updates aktivieren?"; then
        MSM_AUTO_UPDATE="true"
    else
        MSM_AUTO_UPDATE="false"
    fi
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 5b. PostgreSQL Setup
# ═══════════════════════════════════════════════════════════════
if ! command -v psql &>/dev/null; then
    log "Installiere PostgreSQL..."
    apt-get install -y -qq postgresql postgresql-contrib libpq-dev python3-dev 2>&1 | tee -a "$LOG_FILE"
fi

# Nur bei frischer Installation: Passwort + User/DB erstellen
if ! $REINSTALL_MODE; then
    PG_PASSWORD=$(python3 -c "import secrets, string; a=string.ascii_letters+string.digits+'_-'; print(''.join(secrets.choice(a) for _ in range(32)))")

    log "Richte PostgreSQL-User und Datenbank ein..."
    PG_ROLE_EXISTS=false
    if su - postgres -c "psql --no-psqlrc -tAc \"SELECT 1 FROM pg_roles WHERE rolname='msm'\"" | grep -q 1; then
        PG_ROLE_EXISTS=true
    fi
    PG_DATABASE_OWNER=$(su - postgres -c \
        "psql --no-psqlrc -tAc \"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='msm'\"" \
        | tr -d '[:space:]')

    if $RESUME_PARTIAL; then
        $PG_ROLE_EXISTS \
            || err "Partielle Installation kann nicht fortgesetzt werden: PostgreSQL-Rolle 'msm' fehlt."
        [[ "$PG_DATABASE_OWNER" == "msm" ]] \
            || err "Partielle Installation kann nicht fortgesetzt werden: Datenbank 'msm' fehlt oder hat einen fremden Eigentümer."

        PG_ROLE_FLAGS=$(su - postgres -c \
            "psql --no-psqlrc -tAc \"SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='msm'\"" \
            | tr -d '[:space:]')
        PG_ROLE_MEMBERSHIPS=$(su - postgres -c \
            "psql --no-psqlrc -tAc \"SELECT count(*) FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='msm') OR member=(SELECT oid FROM pg_roles WHERE rolname='msm')\"" \
            | tr -d '[:space:]')
        PG_OTHER_DATABASES=$(su - postgres -c \
            "psql --no-psqlrc -tAc \"SELECT count(*) FROM pg_database WHERE NOT datistemplate AND datname <> 'msm' AND datdba=(SELECT oid FROM pg_roles WHERE rolname='msm')\"" \
            | tr -d '[:space:]')
        [[ "$PG_ROLE_FLAGS" == "f" && "$PG_ROLE_MEMBERSHIPS" == "0" && "$PG_OTHER_DATABASES" == "0" ]] \
            || err "Partielle Installation wird nicht fortgesetzt: PostgreSQL-Rolle 'msm' besitzt unerwartete Rechte oder weitere Objekte."

        log "Setze die eindeutig erkannte partielle PostgreSQL-Installation sicher fort..."
        if ! printf '%s\n' "ALTER ROLE msm WITH PASSWORD '${PG_PASSWORD}';" \
            | su - postgres -c "psql --no-psqlrc --set ON_ERROR_STOP=1" \
            2>&1 | tee -a "$LOG_FILE"; then
            err "PostgreSQL-Zugang der partiellen Installation konnte nicht erneuert werden."
        fi
    else
        if $PG_ROLE_EXISTS || [[ -n "$PG_DATABASE_OWNER" ]]; then
            err "PostgreSQL-Rolle oder Datenbank 'msm' existiert bereits. Für eine nachweislich abgebrochene Erstinstallation erneut mit --resume-partial starten; fremde Daten werden niemals überschrieben."
        fi

        # Übergabe ausschließlich über stdin: kein Passwort in Prozessargumenten
        # und keine temporäre Root-Datei, die der postgres-User nicht lesen kann.
        if ! printf '%s\n' "CREATE USER msm WITH PASSWORD '${PG_PASSWORD}';" \
            | su - postgres -c "psql --no-psqlrc --set ON_ERROR_STOP=1" \
            2>&1 | tee -a "$LOG_FILE"; then
            err "PostgreSQL-Rolle konnte nicht eingerichtet werden."
        fi

        su - postgres -c "createdb --owner=msm msm" 2>&1 | tee -a "$LOG_FILE" \
            || { su - postgres -c "dropuser --if-exists msm" >/dev/null 2>&1 || true; err "PostgreSQL-Datenbank konnte nicht erstellt werden."; }
    fi

    su - postgres -c "psql -d msm -c \"GRANT ALL ON SCHEMA public TO msm;\"" 2>&1 | tee -a "$LOG_FILE"

    ok "PostgreSQL eingerichtet (DB: msm, User: msm)"
else
    log "PostgreSQL bleibt bestehend — User/DB nicht neu angelegt."
fi

# pg_hba.conf & Connection-Pool-Dimensionierung sicherstellen (auch bei Re-Install)
PG_CONF_DIR=$(find /etc/postgresql -name "conf.d" -type d 2>/dev/null | head -1)
if [[ -n "$PG_CONF_DIR" ]]; then
    cat > "${PG_CONF_DIR}/99-msm.conf" <<'PGCONF'
# Multi-Worker HA + Connection-Pool Reserve (Panel + Worker + Admin)
max_connections = 250
PGCONF
fi
PG_HBA=$(find /etc/postgresql -name pg_hba.conf | head -1)
if [[ -n "$PG_HBA" ]]; then
        sed -i -E 's/^(host\s+all\s+all\s+127\.0\.0\.1\/32)\s+.*/\1            scram-sha-256/' "$PG_HBA"
        sed -i -E 's/^(host\s+all\s+all\s+::1\/128)\s+.*/\1                 scram-sha-256/' "$PG_HBA"
        if ! grep -qE '^host\s+all\s+all\s+127\.0\.0\.1/32' "$PG_HBA"; then
            echo "host    all             all             127.0.0.1/32            scram-sha-256" >> "$PG_HBA"
        fi
        if ! grep -qE '^host\s+all\s+all\s+::1/128' "$PG_HBA"; then
            echo "host    all             all             ::1/128                 scram-sha-256" >> "$PG_HBA"
        fi
        if $SYSTEMD_AVAILABLE; then
            systemctl restart postgresql
        else
            service postgresql restart 2>/dev/null || pg_ctlcluster $(pg_lsclusters | tail -1 | awk '{print $1}') main restart 2>/dev/null || true
        fi
fi

if ! $REINSTALL_MODE; then
    ok "PostgreSQL installiert (DB: msm, User: msm)"
fi

# ═══════════════════════════════════════════════════════════════
# 6. SECRET_KEY generieren & .env schreiben
# ═══════════════════════════════════════════════════════════════
log "Generiere kryptographischen Secret-Key..."
if $REINSTALL_MODE && [[ -n "$CURRENT_SECRET_KEY" ]]; then
    SECRET_KEY="$CURRENT_SECRET_KEY"
    log "Bestehender SECRET_KEY wird beibehalten."
else
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
fi

# DIS Sidecar: Salt + Token generieren (oder beibehalten bei Re-Install).
# Unter ``set -u`` muessen beide Werte auch im frischen Installationspfad
# definiert sein, bevor sie auf Leerwerte geprueft werden.
DIS_SALT=""
DIS_TOKEN=""
DOCS_TOKEN=""
DOCS_COLLAB_SECRET=""
DOCS_SIGNING_SECRET=""
if [[ -f "$MSM_DIR/docs-sidecar/.env" ]]; then
    DOCS_TOKEN=$(grep -E '^MSM_DOCS_SIDECAR_TOKEN=' "$MSM_DIR/docs-sidecar/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DOCS_COLLAB_SECRET=$(grep -E '^MSM_DOCS_COLLAB_SECRET=' "$MSM_DIR/docs-sidecar/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DOCS_SIGNING_SECRET=$(grep -E '^MSM_DOCS_SIGNING_SECRET=' "$MSM_DIR/docs-sidecar/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
fi
if [[ -z "$DOCS_TOKEN" ]]; then
    DOCS_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
fi
if [[ -z "$DOCS_COLLAB_SECRET" ]]; then
    DOCS_COLLAB_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
fi
if [[ -z "$DOCS_SIGNING_SECRET" ]]; then
    DOCS_SIGNING_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
fi
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
if $REINSTALL_MODE && [[ -f "$MSM_DIR/backend/.env" ]]; then
    DIS_SALT=$(grep -E '^MSM_DIS_SALT=' "$MSM_DIR/backend/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    DIS_TOKEN=$(grep -E '^MSM_DIS_SIDECAR_TOKEN=' "$MSM_DIR/backend/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
fi
if [[ -z "$DIS_SALT" ]]; then
    DIS_SALT=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
fi
if [[ -z "$DIS_TOKEN" ]]; then
    DIS_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
fi

# LiveKit-Sidecar: Schluessel und Geheimnis fuer die Anruf-Zugangstoken.
# Dasselbe Paar geht in die Backend-.env und in livekit-sidecar/.env. Weichen
# beide Seiten voneinander ab, weist der Medienserver jedes Token ab und jeder
# Anruf scheitert beim Verbinden — deshalb nur eine Erzeugungsstelle.
# Bei Re-Install wird das Bestehende uebernommen; ein Wechsel wuerde laufende
# Gespraeche abreissen lassen, ohne dass irgendwo etwas gewonnen waere.
LIVEKIT_API_KEY=""
LIVEKIT_API_SECRET=""
if $REINSTALL_MODE && [[ -f "$MSM_DIR/backend/.env" ]]; then
    LIVEKIT_API_KEY=$(grep -E '^MSM_LIVEKIT_API_KEY=' "$MSM_DIR/backend/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    LIVEKIT_API_SECRET=$(grep -E '^MSM_LIVEKIT_API_SECRET=' "$MSM_DIR/backend/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
fi
if [[ -z "$LIVEKIT_API_KEY" ]]; then
    # LiveKit erwartet einen Schluessel, der mit "API" beginnt.
    LIVEKIT_API_KEY="API$(python3 -c "import secrets; print(secrets.token_hex(6))")"
fi
if [[ -z "$LIVEKIT_API_SECRET" ]]; then
    LIVEKIT_API_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
fi

PANEL_URL="http://localhost"
API_URL="http://localhost"
if [[ -n "$DOMAIN" ]]; then
    PANEL_URL="https://$DOMAIN"
    API_URL="https://$DOMAIN"
fi
if $REINSTALL_MODE && [[ "$CURRENT_SERVE_FRONTEND" == "false" ]] \
    && [[ -n "$CURRENT_PANEL_URL" ]] && [[ -z "$EXTERNAL_FRONTEND_ORIGIN" ]]; then
    PANEL_URL="$CURRENT_PANEL_URL"
fi

ENV_FILE="$MSM_DIR/backend/.env"

existing_env_value() {
    local key="$1"
    local fallback="$2"
    local value=""
    if [[ -f "$ENV_FILE" ]]; then
        value=$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    fi
    printf '%s' "${value:-$fallback}"
}

# Datenbank-URL bestimmen
if ! $REINSTALL_MODE; then
    # Frische PostgreSQL-URL generieren
    PG_PASSWORD_ENCODED=$(printf '%s' "$PG_PASSWORD" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=''))")
    DB_URL="postgresql+psycopg2://msm:${PG_PASSWORD_ENCODED}@localhost:5432/msm"
    DB_URL_ASYNC="postgresql+asyncpg://msm:${PG_PASSWORD_ENCODED}@localhost:5432/msm"
else
    # Bestehende URLs beibehalten
    if [[ -n "${CURRENT_DB_URL:-}" && -n "${CURRENT_DB_URL_ASYNC:-}" ]]; then
        DB_URL="$CURRENT_DB_URL"
        DB_URL_ASYNC="$CURRENT_DB_URL_ASYNC"
    else
        # Fallback (sollte bei gültigem .env nie passieren)
        DB_URL="postgresql+psycopg2://msm:@localhost:5432/msm"
        DB_URL_ASYNC="postgresql+asyncpg://msm:@localhost:5432/msm"
        warn "Bestehende DB-URL nicht gefunden — Fallback generiert."
    fi
fi

# Redis-URL Fallback VOR dem Heredoc auswerten,
# damit keine Bash-Control-Flow-Syntax in die .env geschrieben wird.
if $INSTALL_REDIS && [[ -z "$MSM_REDIS_URL" ]]; then
    MSM_REDIS_URL="redis://localhost:6379"
fi

COOKIE_DOMAIN=$(existing_env_value MSM_COOKIE_DOMAIN "")
COOKIE_CROSS_SITE=$(existing_env_value MSM_COOKIE_CROSS_SITE "false")
CORS_ALLOWED_ORIGINS=$(existing_env_value MSM_CORS_ALLOWED_ORIGINS "")
SERVE_FRONTEND=$(existing_env_value MSM_SERVE_FRONTEND "true")
LOGO_URL=$(existing_env_value MSM_LOGO_URL "")
STEAM_API_KEY=$(existing_env_value MSM_STEAM_API_KEY "")
GITHUB_CLONE_TOKEN=$(existing_env_value MSM_GITHUB_CLONE_TOKEN "")

if [[ -n "$EXTERNAL_FRONTEND_ORIGIN" ]]; then
    PANEL_URL="$EXTERNAL_FRONTEND_ORIGIN"
    SERVE_FRONTEND=false
    COOKIE_CROSS_SITE=true
    if [[ -z "$CORS_ALLOWED_ORIGINS" ]]; then
        CORS_ALLOWED_ORIGINS="$EXTERNAL_FRONTEND_ORIGIN"
    elif [[ ",${CORS_ALLOWED_ORIGINS}," != *",${EXTERNAL_FRONTEND_ORIGIN},"* ]]; then
        CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS},${EXTERNAL_FRONTEND_ORIGIN}"
    fi
fi

# Agent-Token vorab ermitteln oder generieren (muss für Backend & msm-agent übereinstimmen,
# weil Backend (msm) unter 3-User-Isolation msm-agent/.env nicht direkt lesen darf)
AGENT_ENV="$MSM_DIR/msm-agent/.env"
AGENT_TOKEN=""
if $INSTALL_LOCAL_AGENT; then
    if [[ -f "$AGENT_ENV" ]]; then
        AGENT_TOKEN=$(grep -E '^MSM_AGENT_TOKEN=' "$AGENT_ENV" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    fi
    if [[ -z "$AGENT_TOKEN" ]] && [[ -f "$ENV_FILE" ]]; then
        AGENT_TOKEN=$(grep -E '^MSM_LOCAL_AGENT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    fi
    if [[ -z "$AGENT_TOKEN" ]]; then
        AGENT_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    fi
fi

if [[ -n "$MSM_REDIS_URL" ]]; then
    PANEL_WORKER_MODE="api"
else
    PANEL_WORKER_MODE="all"
fi

cat > "$ENV_FILE" <<EOF
# Automatisch generiert durch install.sh am $(date -Iseconds)
# ÄNDERUNGEN NUR MIT VORSICHT
# Vollständige Erklärung aller Werte: $MSM_DIR/backend/.env.example

MSM_APP_NAME="Maunting Service Manager"
MSM_DEBUG=false
MSM_DATABASE_URL="$DB_URL"
MSM_DATABASE_URL_ASYNC="$DB_URL_ASYNC"
MSM_SECRET_KEY="$SECRET_KEY"
MSM_ALGORITHM="HS256"
MSM_ACCESS_TOKEN_EXPIRE_MINUTES=15
MSM_REFRESH_TOKEN_EXPIRE_DAYS=30
MSM_CSRF_TOKEN_EXPIRE_MINUTES=1440
MSM_DIS_SIDECAR_URL="http://127.0.0.1:9100"
MSM_DIS_SIDECAR_TOKEN="$DIS_TOKEN"
MSM_DIS_SALT="$DIS_SALT"
MSM_DOCS_SIDECAR_URL="http://127.0.0.1:8101"
MSM_DOCS_SIDECAR_TOKEN="$DOCS_TOKEN"
MSM_DOCS_COLLAB_SECRET="$DOCS_COLLAB_SECRET"
MSM_DOCS_SIGNING_SECRET="$DOCS_SIGNING_SECRET"
MSM_DOCS_COLLAB_PUBLIC_URL="${DOMAIN:+wss://$DOMAIN/api/docs/collab}"
MSM_EMAIL_PROVIDER="$EMAIL_PROVIDER"
MSM_SMTP_HOST="$SMTP_HOST"
MSM_SMTP_PORT=$SMTP_PORT
MSM_SMTP_USER="$SMTP_USER"
MSM_SMTP_PASSWORD="$SMTP_PASS"
MSM_SMTP_TLS=true
MSM_SMTP_FROM="${SMTP_FROM:-noreply@mauntingstudios.de}"
MSM_RESEND_API_KEY="$RESEND_API_KEY"
MSM_PANEL_URL="$PANEL_URL"
MSM_API_URL="$API_URL"
MSM_SETUP_COMPLETED_FILE="/opt/msm/.setup_completed"
MSM_LOGO_URL="$LOGO_URL"
MSM_COOKIE_DOMAIN="$COOKIE_DOMAIN"
MSM_COOKIE_CROSS_SITE=$COOKIE_CROSS_SITE
MSM_CORS_ALLOWED_ORIGINS="$CORS_ALLOWED_ORIGINS"
MSM_SERVE_FRONTEND=$SERVE_FRONTEND
MSM_SERVERS_DIR="$MSM_DIR/servers"
MSM_LOCAL_AGENT_ENV_FILE="$MSM_DIR/msm-agent/.env"
MSM_LOCAL_AGENT_ENABLED=$INSTALL_LOCAL_AGENT
MSM_LOCAL_AGENT_REQUIRED=$INSTALL_LOCAL_AGENT
MSM_LOCAL_AGENT_TOKEN="$AGENT_TOKEN"
MSM_PANEL_CONFIG_DIR="$MSM_DIR"
MSM_PANEL_BACKUP_DIR="$MSM_DIR/backups/panel"
MSM_VAULT_BLOB_DIR="$MSM_DIR/vault-blobs"
MSM_BLUEPRINTS_DIR="$MSM_DIR/blueprints/community"
MSM_DOCKER_HOST="$MSM_DOCKER_HOST"
MSM_WORKER_MODE="$PANEL_WORKER_MODE"
MSM_DB_POOL_SIZE=5
MSM_DB_MAX_OVERFLOW=10
MSM_DB_POOL_TIMEOUT=30
MSM_DB_POOL_RECYCLE=1800
MSM_DB_STATEMENT_TIMEOUT_MS=15000
MSM_REQUIRE_NETWORK_ISOLATION=$INSTALL_LOCAL_AGENT
MSM_STRICT_RESOURCE_CAPACITY_GUARD=true
MSM_HOST_RESERVED_RAM_MB=1536
MSM_ALLOW_LEGACY_BARE_METAL_SETUP=false
MSM_MANAGED_POSTGRES_IMAGE="postgres:17-alpine"
MSM_MANAGED_POSTGRES_CONTAINER_NAME="msm-postgres"
MSM_MANAGED_POSTGRES_NETWORK="msm-pg-hub"
MSM_MANAGED_POSTGRES_HOST="127.0.0.1"
MSM_MANAGED_POSTGRES_PORT=15432
MSM_MANAGED_POSTGRES_DATA_DIR="$MSM_DIR/postgres"
MSM_MANAGED_POSTGRES_STATEMENT_TIMEOUT_MS=5000
MSM_MANAGED_POSTGRES_ROW_LIMIT=500
MSM_STEAMCMD_PATH="/usr/games/steamcmd"
MSM_STEAM_API_KEY="$STEAM_API_KEY"
MSM_GITHUB_CLONE_TOKEN="$GITHUB_CLONE_TOKEN"
MSM_REDIS_URL="$MSM_REDIS_URL"

# Anrufe (LiveKit). Dasselbe Paar steht in livekit-sidecar/.env.
MSM_LIVEKIT_API_KEY="$LIVEKIT_API_KEY"
MSM_LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET"

# Auto-Update (GitHub Releases)
MSM_GITHUB_OWNER="mauntingstudios"
MSM_GITHUB_REPO="maunting-service-manager"
MSM_AUTO_UPDATE=$MSM_AUTO_UPDATE
MSM_AUTO_UPDATE_INTERVAL_HOURS=24
EOF

chmod 600 "$ENV_FILE"
chown "$MSM_USER:$MSM_USER" "$ENV_FILE"
ok ".env geschrieben (chmod 600)"

# Der DIS-Sidecar benoetigt dieselben Crypto-Secrets. Sie gehoeren nicht in
# eine weltweit lesbare systemd-Unit, sondern in eine geschuetzte Environment-Datei.
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

# Dokumente-Sidecar: eigenes Token-Paar, eigener Collab-Schluessel.
DOCS_ENV_FILE="$MSM_DIR/docs-sidecar/.env"
DOCS_DATA_DIR="$MSM_DIR/data/docs-sidecar"
install -d -o "$MSM_USER" -g "$MSM_USER" -m 700 "$DOCS_DATA_DIR"
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
    fi
    chown "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$SEARXNG_ENV_FILE" 2>/dev/null || true
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
    fi
    chown "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$WETTER_ENV_FILE" 2>/dev/null || true
    mkdir -p "$MSM_DIR/wetter-sidecar/daten"
    chown -R "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$MSM_DIR/wetter-sidecar/daten" 2>/dev/null || true
fi

# LiveKit-Sidecar Environment. Anders als bei SearXNG wird die Datei bei jedem
# Lauf neu geschrieben: sie muss mit der Backend-.env uebereinstimmen, und eine
# stehengebliebene alte Datei waere genau der Fall, in dem Anrufe scheitern,
# ohne dass irgendwo etwas kaputt aussieht.
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
    chown "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "$LIVEKIT_ENV_FILE"
fi

# ═══════════════════════════════════════════════════════════════
# 7. Python-Backend einrichten
# ═══════════════════════════════════════════════════════════════
RUN_BACKEND_SETUP=false
if ! $REINSTALL_MODE; then
    RUN_BACKEND_SETUP=true
elif $KEEP_SETTINGS; then
    RUN_BACKEND_SETUP=true
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && $CODE_CHANGED; then
    RUN_BACKEND_SETUP=true
fi

if $RUN_BACKEND_SETUP; then
    log "Installiere Python-Abhängigkeiten..."
    # recreate=true: clean venv after in-place wipe / dependency upgrades
    prepare_app_venv "$MSM_DIR/backend" "Python-Backend" true

    # Lokales Embeddingmodell fuer die KI-Gedaechtnissuche (~470 MB).
    # Bewusst hier und nicht zur Laufzeit: das Panel laedt im Betrieb niemals
    # Gewichte aus dem Internet nach. Ein Fehlschlag bricht die Installation
    # nicht ab — ohne Modell laeuft die Suche ohne Vektoren weiter.
    log "Stelle KI-Embeddingmodell bereit (einmalig, ~470 MB)..."
    su - msm -c "
        cd $MSM_DIR/backend
        source venv/bin/activate
        python3 scripts/fetch_embedding_model.py
    " 2>&1 | tee -a "$LOG_FILE" || warn "Embeddingmodell nicht verfuegbar - KI-Gedaechtnis laeuft ohne Vektoren."

    ok "Python-Backend bereit"

    # MSM Agent (lokaler Node, rootless Docker) — eigenes venv, isolierter User $MSM_AGENT_USER
    if $INSTALL_LOCAL_AGENT && [[ -d "$MSM_DIR/msm-agent" ]]; then
        log "Installiere MSM Agent..."
        prepare_app_venv "$MSM_DIR/msm-agent" "MSM Agent" true "$MSM_AGENT_USER"

        AGENT_ENV="$MSM_DIR/msm-agent/.env"
        if [[ -z "${AGENT_TOKEN:-}" ]] && [[ -f "$AGENT_ENV" ]]; then
            AGENT_TOKEN=$(grep -E '^MSM_AGENT_TOKEN=' "$AGENT_ENV" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
        fi
        if [[ -z "${AGENT_TOKEN:-}" ]]; then
            AGENT_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
        fi
        if [[ ! -f "$AGENT_ENV" ]]; then
            cat > "$AGENT_ENV" <<EOF
# Automatisch generiert. Dokumentation: $MSM_DIR/msm-agent/.env.example
MSM_AGENT_TOKEN="$AGENT_TOKEN"
MSM_AGENT_HOST="127.0.0.1"
MSM_AGENT_PORT="9000"
MSM_SERVERS_DIR="$MSM_DIR/servers"
MSM_DOCKER_HOST="$MSM_DOCKER_HOST"
MSM_REQUIRE_NETWORK_ISOLATION=true
MSM_QUOTA_DRIVER="auto"
MSM_REQUIRE_DISK_QUOTA=false
MSM_HOST_RESERVED_RAM_MB=1536
MSM_GUARDIAN_STATE_DIR="/var/lib/msm-agent/guardian"
MSM_AGENT_LOG_LEVEL="INFO"
EOF
            chmod 600 "$AGENT_ENV"
            chown "$MSM_AGENT_USER:$MSM_AGENT_USER" "$AGENT_ENV"
            ok "MSM Agent .env erzeugt (Token wird nicht geloggt)"
        else
            if grep -qE '^MSM_DOCKER_HOST=' "$AGENT_ENV"; then
                sed -i -E "s|^MSM_DOCKER_HOST=.*|MSM_DOCKER_HOST=\"${MSM_DOCKER_HOST}\"|" "$AGENT_ENV"
            else
                printf 'MSM_DOCKER_HOST="%s"\n' "$MSM_DOCKER_HOST" >> "$AGENT_ENV"
            fi
            if ! grep -qE '^MSM_REQUIRE_NETWORK_ISOLATION=' "$AGENT_ENV"; then
                printf 'MSM_REQUIRE_NETWORK_ISOLATION=true\n' >> "$AGENT_ENV"
            fi
            if ! grep -qE '^MSM_QUOTA_DRIVER=' "$AGENT_ENV"; then
                printf 'MSM_QUOTA_DRIVER="auto"\n' >> "$AGENT_ENV"
            fi
            chmod 600 "$AGENT_ENV"
            chown "$MSM_AGENT_USER:$MSM_AGENT_USER" "$AGENT_ENV"
            ok "MSM Agent .env aktualisiert ($MSM_AGENT_USER)"
        fi
        # Ensure Control-Plane backend/.env shares identical local agent token even in KEEP_SETTINGS reinstalls
        if [[ -f "$MSM_DIR/backend/.env" ]]; then
            if grep -qE '^MSM_LOCAL_AGENT_TOKEN=' "$MSM_DIR/backend/.env"; then
                sed -i -E "s|^MSM_LOCAL_AGENT_TOKEN=.*|MSM_LOCAL_AGENT_TOKEN=\"${AGENT_TOKEN}\"|" "$MSM_DIR/backend/.env"
            else
                printf 'MSM_LOCAL_AGENT_TOKEN="%s"\n' "$AGENT_TOKEN" >> "$MSM_DIR/backend/.env"
            fi
            if ! grep -qE '^MSM_LOCAL_AGENT_REQUIRED=' "$MSM_DIR/backend/.env"; then
                printf 'MSM_LOCAL_AGENT_REQUIRED=true\n' >> "$MSM_DIR/backend/.env"
            fi
        fi
        ok "MSM Agent bereit"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 8. Datenbank initialisieren / Phase-8-Schema (immer idempotent)
# ═══════════════════════════════════════════════════════════════
# KEEP_SETTINGS reinstall previously skipped schema work → missing servers.node_id
# crashed the panel on multi-node startup. Always bridge/stamp (idempotent).
log "Bereite PostgreSQL-Schema vor (Phase 8 / Multi-Node)..."
su - "$MSM_USER" -c "
    set -euo pipefail
    cd $MSM_DIR/backend
    source venv/bin/activate
    python3 scripts/prepare_phase8_schema.py
" 2>&1 | tee -a "$LOG_FILE" || err "PostgreSQL-Schema konnte nicht vorbereitet werden"
ok "Datenbank/Schema bereit"

# ═══════════════════════════════════════════════════════════════
# 9. Frontend bauen
# ═══════════════════════════════════════════════════════════════
RUN_FRONTEND_BUILD=false
if ! $REINSTALL_MODE; then
    RUN_FRONTEND_BUILD=true
elif $KEEP_SETTINGS; then
    RUN_FRONTEND_BUILD=true
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && $CODE_CHANGED; then
    RUN_FRONTEND_BUILD=true
fi

if $RUN_FRONTEND_BUILD && [[ "$SERVE_FRONTEND" == "true" ]]; then
    log "Baue Frontend..."
    if ! su - "$MSM_USER" -c "
        set -e
        cd $MSM_DIR/frontend
        npm install -q
        npm run build
    " 2>&1 | tee -a "$LOG_FILE"; then
        err "Frontend-Build fehlgeschlagen. Prüfe npm-Log und package.json."
    fi
    ok "Frontend gebaut"
elif [[ "$SERVE_FRONTEND" != "true" ]]; then
    log "Externes Frontend: lokaler Frontend-Build wird übersprungen."
fi

# ── DIS Sidecar: npm ci (@msdis/shield) ──
RUN_SIDECAR_SETUP=false
if [[ ! -d "$MSM_DIR/dis-sidecar/node_modules" ]]; then
    RUN_SIDECAR_SETUP=true
elif ! $REINSTALL_MODE; then
    RUN_SIDECAR_SETUP=true
elif $KEEP_SETTINGS; then
    RUN_SIDECAR_SETUP=true
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && $CODE_CHANGED; then
    RUN_SIDECAR_SETUP=true
fi

if $RUN_SIDECAR_SETUP; then
    log "Installiere DIS Sidecar-Abhängigkeiten..."
    if ! su - "$MSM_USER" -c "
        set -e
        cd $MSM_DIR/dis-sidecar
        npm ci -q --omit=dev
    " 2>&1 | tee -a "$LOG_FILE"; then
        err "DIS Sidecar npm ci fehlgeschlagen. Prüfe dis-sidecar/package.json und package-lock.json."
    fi
    ok "DIS Sidecar bereit"
fi

# ── Dokumente-Sidecar: npm ci (Hocuspocus 4, Node >=22) ──
DOCS_NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [[ "$DOCS_NODE_MAJOR" -lt 22 ]]; then
    err "Node >=22 wird fuer den Dokumente-Sidecar benoetigt (gefunden: $(node -v))."
fi
DOCS_RUN_SETUP=false
if [[ ! -d "$MSM_DIR/docs-sidecar/node_modules" ]]; then
    DOCS_RUN_SETUP=true
elif ! $REINSTALL_MODE; then
    DOCS_RUN_SETUP=true
elif $KEEP_SETTINGS; then
    DOCS_RUN_SETUP=true
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && $CODE_CHANGED; then
    DOCS_RUN_SETUP=true
fi
if $DOCS_RUN_SETUP; then
    log "Installiere Dokumente-Sidecar-Abhaengigkeiten..."
    if ! su - "$MSM_USER" -c "
        set -e
        cd $MSM_DIR/docs-sidecar
        npm ci -q --omit=dev --install-links
    " 2>&1 | tee -a "$LOG_FILE"; then
        err "Dokumente-Sidecar npm ci fehlgeschlagen. Pruefe docs-sidecar/package.json und package-lock.json."
    fi
    ok "Dokumente-Sidecar bereit"
fi

# ═══════════════════════════════════════════════════════════════
# 10. Caddy konfigurieren
# ═══════════════════════════════════════════════════════════════
RUN_CADDY_SETUP=false
if ! $REINSTALL_MODE; then
    RUN_CADDY_SETUP=true
elif $KEEP_SETTINGS; then
    RUN_CADDY_SETUP=true
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && ($CODE_CHANGED || $CHANGED_DOMAIN); then
    RUN_CADDY_SETUP=true
fi

if $RUN_CADDY_SETUP; then
    log "Konfiguriere Caddy..."

    CADDY_CONFIG="/etc/caddy/Caddyfile"
    CADDY_CONFD="/etc/caddy/conf.d"
    mkdir -p /etc/caddy
    install -d -o root -g caddy -m 0750 "$CADDY_CONFD"

    # ── Extension erkennen: .caddy oder .conf? ──
    # Prüfe ob existierende Caddyfile bereits conf.d importiert
    if grep -qE "^import\s+${CADDY_CONFD}/\*\.[a-z]+" "$CADDY_CONFIG" 2>/dev/null; then
        # Bestehende Extension auslesen (z.B. *.caddy → caddy, *.conf → conf)
        CADDY_EXT=$(grep -E "^import\s+${CADDY_CONFD}/\*\.[a-z]+" "$CADDY_CONFIG" | head -1 | sed -E 's/.*\*\.([a-z]+).*/\1/')
    else
        CADDY_EXT="conf"  # Default
    fi
    MSM_CADDY_FILE="$CADDY_CONFD/msm.$CADDY_EXT"

    # ═══════════════════════════════════════════════════════════════
    # Caddyfile: import-Zeile nur hinzufügen, wenn noch kein conf.d-Import existiert
    # ═══════════════════════════════════════════════════════════════
    if ! grep -qE "^import\s+${CADDY_CONFD}/\*\.[a-z]+" "$CADDY_CONFIG" 2>/dev/null; then
        if [[ ! -s "$CADDY_CONFIG" ]]; then
            cat > "$CADDY_CONFIG" <<EOF
# Caddyfile
# Weitere Sites können hier direkt oder unter $CADDY_CONFD/ konfiguriert werden.

import $CADDY_CONFD/*.${CADDY_EXT}
EOF
        else
            echo "" >> "$CADDY_CONFIG"
            echo "# MSM Panel — additional site configurations" >> "$CADDY_CONFIG"
            echo "import $CADDY_CONFD/*.${CADDY_EXT}" >> "$CADDY_CONFIG"
        fi
    fi

    # ═══════════════════════════════════════════════════════════════
    # Domain-Conflict-Check: scannt ALLE Dateien in conf.d
    # (egal ob .caddy, .conf, .txt — Caddy lädt alles via import *)
    # ═══════════════════════════════════════════════════════════════
    DOMAIN_CONFLICT=false
    if [[ -n "$DOMAIN" ]]; then
        for conf_file in "$CADDY_CONFD"/*; do
            [[ -f "$conf_file" ]] || continue
            # MSM-eigene Datei darf überschrieben werden
            [[ "$(basename "$conf_file")" == "msm.$CADDY_EXT" ]] && continue
            if grep -qE "(^|\s)${DOMAIN}(\s|\{)" "$conf_file" 2>/dev/null; then
                warn "Domain '$DOMAIN' wird bereits in $(basename "$conf_file") verwendet!"
                warn "Bitte eine andere Domain wählen oder die bestehende Config bereinigen."
                DOMAIN_CONFLICT=true
                break
            fi
        done
        # Auch die Haupt-Caddyfile prüfen (ohne import-/Kommentarzeilen)
        if ! $DOMAIN_CONFLICT && [[ -f "$CADDY_CONFIG" ]]; then
            if grep -vE '^\s*(import|#|$)' "$CADDY_CONFIG" | grep -qE "(^|\s)${DOMAIN}(\s|\{)" 2>/dev/null; then
                warn "Domain '$DOMAIN' wird bereits in der Haupt-Caddyfile verwendet!"
                warn "Bitte eine andere Domain wählen oder die bestehende Config bereinigen."
                DOMAIN_CONFLICT=true
            fi
        fi
    fi

    # MSM-Config nur schreiben, wenn kein Domain-Conflict besteht
    if $DOMAIN_CONFLICT; then
        warn "MSM-Caddy-Config wurde NICHT geschrieben (Domain-Konflikt)."
    elif [[ -n "$DOMAIN" && "$SERVE_FRONTEND" != "true" ]]; then
        cat > "$MSM_CADDY_FILE" <<EOF
# MSM API — managed by install.sh
# Das Frontend wird extern ausgeliefert; diese Site veröffentlicht nur API/WS.
$DOMAIN {
    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        # =(self) statt =(): der Sprachmodus braucht getUserMedia, Anrufe im
        # Messenger zusaetzlich Kamera und getDisplayMedia — jeweils auf der
        # eigenen Herkunft. Mit =() fragt der Browser nicht einmal nach.
        Permissions-Policy "accelerometer=(), camera=(self), display-capture=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), payment=(), usb=()"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://singrabot.mauntingstudios.de https://client.crisp.chat https://embed.tawk.to; style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com https://singrabot.mauntingstudios.de; img-src 'self' data: blob: https:; media-src 'self' blob: data: mediastream:; worker-src 'self' blob:; connect-src 'self' https: http: ws: wss: blob: data:; font-src 'self' data: https://singrabot.mauntingstudios.de; frame-src 'self' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://singrabot.mauntingstudios.de; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    }

    # Dokumente: Hocuspocus-WebSocket. Muss **vor** /api/* stehen, sonst
    # landet der Upgrade am FastAPI-Router. handle_path schneidet das Praefix
    # ab; der Sidecar hoert nur auf 127.0.0.1:8100.
    handle_path /api/docs/collab/* {
        reverse_proxy localhost:8100
    }
    # Der Provider verbindet ohne abschliessenden Slash.
    handle /api/docs/collab {
        reverse_proxy localhost:8100
    }

    handle /api/* {
        reverse_proxy localhost:8000
    }

    handle /ws/* {
        reverse_proxy localhost:8000
    }

    # LiveKit-Sidecar: Signalisierung fuer Anrufe im Messenger. handle_path
    # schneidet das Praefix ab, damit /livekit/rtc dort als /rtc ankommt. Der
    # Sidecar hoert nur auf 127.0.0.1; dies ist sein einziger Weg nach aussen.
    handle_path /livekit/* {
        reverse_proxy localhost:7880
    }

    handle {
        respond "Not Found" 404
    }
}
EOF
    elif [[ -n "$DOMAIN" ]]; then
        cat > "$MSM_CADDY_FILE" <<EOF
# MSM Panel — managed by install.sh
# Nicht manuell bearbeiten. Änderungen via install.sh vornehmen.
$DOMAIN {
    root * /opt/msm/frontend/dist

    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        # =(self) statt =(): der Sprachmodus braucht getUserMedia, Anrufe im
        # Messenger zusaetzlich Kamera und getDisplayMedia — jeweils auf der
        # eigenen Herkunft. Mit =() fragt der Browser nicht einmal nach.
        Permissions-Policy "accelerometer=(), camera=(self), display-capture=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), payment=(), usb=()"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://singrabot.mauntingstudios.de https://client.crisp.chat https://embed.tawk.to; style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com https://singrabot.mauntingstudios.de; img-src 'self' data: blob: https:; media-src 'self' blob: data: mediastream:; worker-src 'self' blob:; connect-src 'self' https: http: ws: wss: blob: data:; font-src 'self' data: https://singrabot.mauntingstudios.de; frame-src 'self' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://singrabot.mauntingstudios.de; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    }

    # Dokumente: Hocuspocus-WebSocket. Muss **vor** /api/* stehen, sonst
    # landet der Upgrade am FastAPI-Router. handle_path schneidet das Praefix
    # ab; der Sidecar hoert nur auf 127.0.0.1:8100.
    handle_path /api/docs/collab/* {
        reverse_proxy localhost:8100
    }
    # Der Provider verbindet ohne abschliessenden Slash.
    handle /api/docs/collab {
        reverse_proxy localhost:8100
    }

    handle /api/* {
        reverse_proxy localhost:8000
    }

    handle /ws/* {
        reverse_proxy localhost:8000
    }

    # LiveKit-Sidecar: Signalisierung fuer Anrufe im Messenger. handle_path
    # schneidet das Praefix ab, damit /livekit/rtc dort als /rtc ankommt. Der
    # Sidecar hoert nur auf 127.0.0.1; dies ist sein einziger Weg nach aussen.
    handle_path /livekit/* {
        reverse_proxy localhost:7880
    }

    # Die gehashten Assets tragen ihren Inhalt im Namen: ein Jahr, ohne
    # Nachfrage. Nur was es gibt; ein fehlender Chunk bleibt ein 404 und wird
    # nie zur index.html, sonst stoppt der laufende Client mit
    # "MIME type text/html".
    handle /assets/* {
        @vorhanden file
        header @vorhanden Cache-Control "public, max-age=31536000, immutable"
        file_server
    }

    # Die Seite selbst (/, jede .html und jede Unterseite, die try_files auf
    # die index.html lenkt) fragt immer nach. Eine alte index.html zeigte nach
    # einem Update auf Chunks, die es nicht mehr gibt, und die Oberflaeche
    # bliebe leer. Icons, Manifest und die Erdtextur duerfen einen Tag bleiben.
    handle {
        @seite not file
        @html path / *.html
        @datei {
            file
            not path / *.html
        }
        header @seite Cache-Control "no-cache, no-store, must-revalidate"
        header @html Cache-Control "no-cache, no-store, must-revalidate"
        header @datei Cache-Control "public, max-age=86400"
        try_files {path} /index.html
        file_server
    }
}
EOF
    else
        cat > "$MSM_CADDY_FILE" <<EOF
# MSM Panel — managed by install.sh
# Nicht manuell bearbeiten. Änderungen via install.sh vornehmen.
# HINWEIS: :80 ist ein Catch-All. Falls andere :80-Sites existieren,
#          sollte MSM mit einer Domain konfiguriert werden.
:80 {
    root * /opt/msm/frontend/dist

    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "accelerometer=(), camera=(self), display-capture=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), payment=(), usb=()"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://singrabot.mauntingstudios.de https://client.crisp.chat https://embed.tawk.to; style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com https://singrabot.mauntingstudios.de; img-src 'self' data: blob: https:; media-src 'self' blob: data: mediastream:; worker-src 'self' blob:; connect-src 'self' https: http: ws: wss: blob: data:; font-src 'self' data: https://singrabot.mauntingstudios.de; frame-src 'self' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://singrabot.mauntingstudios.de; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    }

    # Dokumente: Hocuspocus-WebSocket. Muss **vor** /api/* stehen, sonst
    # landet der Upgrade am FastAPI-Router. handle_path schneidet das Praefix
    # ab; der Sidecar hoert nur auf 127.0.0.1:8100.
    handle_path /api/docs/collab/* {
        reverse_proxy localhost:8100
    }
    # Der Provider verbindet ohne abschliessenden Slash.
    handle /api/docs/collab {
        reverse_proxy localhost:8100
    }

    handle /api/* {
        reverse_proxy localhost:8000
    }

    handle /ws/* {
        reverse_proxy localhost:8000
    }

    # LiveKit-Sidecar: Signalisierung fuer Anrufe im Messenger. handle_path
    # schneidet das Praefix ab, damit /livekit/rtc dort als /rtc ankommt. Der
    # Sidecar hoert nur auf 127.0.0.1; dies ist sein einziger Weg nach aussen.
    handle_path /livekit/* {
        reverse_proxy localhost:7880
    }

    # Die gehashten Assets tragen ihren Inhalt im Namen: ein Jahr, ohne
    # Nachfrage. Nur was es gibt; ein fehlender Chunk bleibt ein 404 und wird
    # nie zur index.html, sonst stoppt der laufende Client mit
    # "MIME type text/html".
    handle /assets/* {
        @vorhanden file
        header @vorhanden Cache-Control "public, max-age=31536000, immutable"
        file_server
    }

    # Die Seite selbst (/, jede .html und jede Unterseite, die try_files auf
    # die index.html lenkt) fragt immer nach. Eine alte index.html zeigte nach
    # einem Update auf Chunks, die es nicht mehr gibt, und die Oberflaeche
    # bliebe leer. Icons, Manifest und die Erdtextur duerfen einen Tag bleiben.
    handle {
        @seite not file
        @html path / *.html
        @datei {
            file
            not path / *.html
        }
        header @seite Cache-Control "no-cache, no-store, must-revalidate"
        header @html Cache-Control "no-cache, no-store, must-revalidate"
        header @datei Cache-Control "public, max-age=86400"
        try_files {path} /index.html
        file_server
    }
}
EOF
        if ! $REINSTALL_MODE; then
            warn "Keine Domain angegeben — Panel läuft über HTTP (nicht empfohlen für Produktion)."
            warn "Falls andere :80-Sites in Caddy konfiguriert sind, konfiguriere MSM mit einer Domain."
        fi
    fi

    if ! $DOMAIN_CONFLICT; then
        # Der Installer nutzt eine restriktive umask. Caddy muss seine
        # Hauptdatei und die verwaltete Site trotzdem lesen koennen, ohne
        # beide Dateien fuer andere Benutzer zugaenglich zu machen.
        chown root:caddy "$CADDY_CONFIG" "$MSM_CADDY_FILE"
        chmod 0640 "$CADDY_CONFIG" "$MSM_CADDY_FILE"
        caddy validate --config "$CADDY_CONFIG" --adapter caddyfile \
            2>&1 | tee -a "$LOG_FILE" \
            || err "Caddy-Konfiguration ist ungültig. Prüfe: $CADDY_CONFIG"
        if $SYSTEMD_AVAILABLE; then
            systemctl reload caddy 2>&1 | tee -a "$LOG_FILE" \
                || systemctl restart caddy 2>&1 | tee -a "$LOG_FILE" \
                || err "Caddy konnte die MSM-Konfiguration nicht laden."
        else
            service caddy restart 2>&1 | tee -a "$LOG_FILE" \
                || caddy reload --config "$CADDY_CONFIG" --adapter caddyfile \
                    2>&1 | tee -a "$LOG_FILE" \
                || err "Caddy konnte die MSM-Konfiguration nicht laden."
        fi
    else
        warn "Caddy wurde NICHT neugestartet (Domain-Konflikt). Bitte Konflikt lösen und install.sh erneut ausführen."
    fi
    ok "Caddy konfiguriert"
fi

# ═══════════════════════════════════════════════════════════════
# 11. systemd Service
# ═══════════════════════════════════════════════════════════════
RUN_SYSTEMD_SETUP=false
if ! $REINSTALL_MODE; then
    RUN_SYSTEMD_SETUP=true
elif $KEEP_SETTINGS; then
    RUN_SYSTEMD_SETUP=true
elif $REINSTALL_MODE && ! $KEEP_SETTINGS && ($CODE_CHANGED || $CHANGED_DOMAIN || $CHANGED_EMAIL || $CHANGED_REDIS); then
    RUN_SYSTEMD_SETUP=true
fi

if $RUN_SYSTEMD_SETUP; then
    log "Registriere systemd Service..."

    # ── Dokumente-Sidecar (Hocuspocus 4, nur Loopback) ──
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

    # ── Systemd QoS-Slices & OOM-Schutz für Control-Plane ──
    TOTAL_MEM_MB=$(awk '/MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 4096)
    RESERVE_MEM_MB=$(( TOTAL_MEM_MB * 15 / 100 ))
    if [[ "$RESERVE_MEM_MB" -lt 1536 ]]; then
        RESERVE_MEM_MB=1536
    fi
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

    mkdir -p /etc/systemd/system/postgresql.service.d /etc/systemd/system/redis-server.service.d
    cat > /etc/systemd/system/postgresql.service.d/msm-oom.conf <<'EOF'
[Service]
Slice=msm-control.slice
OOMScoreAdjust=-900
EOF
    cat > /etc/systemd/system/redis-server.service.d/msm-oom.conf <<'EOF'
[Service]
Slice=msm-control.slice
OOMScoreAdjust=-850
EOF

    # Worker-Aufteilung (api vs all) & Uvicorn-Worker-Skalierung auch bei KEEP_SETTINGS ermitteln
    EFFECTIVE_REDIS_URL="$MSM_REDIS_URL"
    if [[ -z "$EFFECTIVE_REDIS_URL" ]] && [[ -f "$MSM_DIR/backend/.env" ]]; then
        EFFECTIVE_REDIS_URL=$(grep -E '^MSM_REDIS_URL=' "$MSM_DIR/backend/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)
    fi
    if [[ -n "$EFFECTIVE_REDIS_URL" ]]; then
        PANEL_WORKER_MODE="api"
        CPU_CORES=$(nproc 2>/dev/null || echo 2)
        if [[ "$CPU_CORES" -lt 2 ]]; then
            MSM_UVICORN_WORKERS=2
        elif [[ "$CPU_CORES" -gt 4 ]]; then
            MSM_UVICORN_WORKERS=4
        else
            MSM_UVICORN_WORKERS="$CPU_CORES"
        fi
    else
        PANEL_WORKER_MODE="all"
        MSM_UVICORN_WORKERS=1
    fi
    if [[ -f "$MSM_DIR/backend/.env" ]]; then
        if grep -qE '^MSM_WORKER_MODE=' "$MSM_DIR/backend/.env"; then
            sed -i -E "s|^MSM_WORKER_MODE=.*|MSM_WORKER_MODE=\"${PANEL_WORKER_MODE}\"|" "$MSM_DIR/backend/.env"
        else
            printf 'MSM_WORKER_MODE="%s"\n' "$PANEL_WORKER_MODE" >> "$MSM_DIR/backend/.env"
        fi
    fi

    # ── DIS Sidecar Service (vor dem Panel starten) ──
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

    mkdir -p /etc/systemd/system/msm-docs-sidecar.service.d
    cat > /etc/systemd/system/msm-docs-sidecar.service.d/msm-slice.conf <<'EOF'
[Service]
Slice=msm-control.slice
OOMScoreAdjust=-750
EOF

    # --force-recreate: scheitert der Start an einem belegten Port, laesst
    # Docker den angelegten Container liegen. Der naechste Versuch startete ihn
    # dann ohne jede Portfreigabe, und systemd meldete „Started“ (27.09.2026).
    # Frisch angelegt scheitert jeder Versuch sichtbar, bis der Port frei ist.
    # ── SearXNG Search Sidecar Service (isoliert unter $MSM_DOCKER_USER) ──
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

    # ── LiveKit Media Sidecar Service (Anrufe im Messenger, isoliert unter $MSM_DOCKER_USER) ──
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
    fi

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
# Systemd-Units erben kein PATH vom Login-Shell. venv zuerst, danach System-Pfade.
Environment="PATH=/opt/msm/backend/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="MSM_WORKER_MODE=${PANEL_WORKER_MODE}"
ExecStart=/opt/msm/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers ${MSM_UVICORN_WORKERS} --timeout-graceful-shutdown 5
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
StandardOutput=journal
StandardError=journal

# Security Hardening
# NoNewPrivileges bleibt aus, weil UFW/iptables weiterhin ueber enge sudo-Gates laufen.
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=/opt/msm -/etc/ufw -/var/lib/ufw -/run/ufw -/run/ufw.lock -/run/sudo -/etc/caddy -/run/caddy

[Install]
WantedBy=multi-user.target
EOF

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

    # MSM Agent (local node) — eigener isolierter Linux-User ($MSM_AGENT_USER), loopback only
    if $INSTALL_LOCAL_AGENT && [[ -d "$MSM_DIR/msm-agent" ]]; then
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

    if $SYSTEMD_AVAILABLE; then
        systemctl daemon-reload
        systemctl enable msm-dis-sidecar.service
        systemctl enable msm-docs-sidecar.service
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
        if $INSTALL_LOCAL_AGENT && [[ -f /etc/systemd/system/msm-agent.service ]]; then
            systemctl enable msm-agent.service
        fi

        # Kernel Hardening (sysctl)
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
            chmod 644 /etc/sysctl.d/99-msm-hardening.conf
            sysctl --system >/dev/null 2>&1 || true
        fi

        # AppArmor-Basisprofil (best-effort; Container-Kernel kann AppArmor ggf. nicht unterstützen, z.B. WSL)
        if [[ -d /etc/apparmor.d ]]; then
            cat > /etc/apparmor.d/msm-container-default <<'AAEOF'
#include <tunables/global>

profile msm-container-default flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  network,
  capability,
  file,
  umount,

  deny @{PROC}/* w,
  deny @{PROC}/sysrq-trigger rwklx,
  deny @{PROC}/mem rwklx,
  deny @{PROC}/kmem rwklx,
  deny /sys/firmware/** rwklx,
  deny /sys/kernel/security/** rwklx,
}
AAEOF
            if command -v apparmor_parser &>/dev/null; then
                apparmor_parser -r /etc/apparmor.d/msm-container-default 2>/dev/null || true
            fi
        fi

        # Update-Timer (optional — deaktiviert per Default)
        cp "$SCRIPT_DIR/msm-update.service" /etc/systemd/system/msm-update.service 2>/dev/null || true
        cp "$SCRIPT_DIR/msm-update.timer" /etc/systemd/system/msm-update.timer 2>/dev/null || true
        systemctl daemon-reload
        systemctl enable msm-update.timer 2>/dev/null || true
        # Timer starten nur, wenn AUTO_UPDATE=true
        if [[ "${MSM_AUTO_UPDATE:-false}" == "true" ]]; then
            systemctl start msm-update.timer 2>/dev/null || true
            ok "Auto-Update Timer aktiviert (24h Intervall)"
        else
            systemctl stop msm-update.timer 2>/dev/null || true
            systemctl disable msm-update.timer 2>/dev/null || true
            ok "Auto-Update Timer registriert (deaktiviert — setze MSM_AUTO_UPDATE=true)"
        fi
        ok "Service registriert"

        # ── sudoers + iptables/quota/caddy-Wrapper direkt als root schreiben ──
        if [[ -d /etc/sudoers.d ]]; then
            mkdir -p /usr/local/sbin
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

            # Disk-Quota-Wrapper (Root-Gate für Project-Quota / Loopback-Images)
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

            # Policy (direkt als root; nur Firewall- und Caddy-Gates, kein allgemeines Container-systemctl)
            cat > /etc/sudoers.d/msm-panel <<'SUDOEOF'
# MSM Panel — Firewall (UFW/iptables) & Caddy wrapper
# Deployed via root heredoc in install.sh/update.sh (never read from msm-writable tree).

Defaults:msm !authenticate

# UFW (exact from firewall_service.py; delete tightened to match allow glob)
msm ALL=(root) NOPASSWD: /usr/sbin/ufw --version
msm ALL=(root) NOPASSWD: /usr/sbin/ufw allow [0-9]*/[a-z]* comment *
msm ALL=(root) NOPASSWD: /usr/sbin/ufw delete allow [0-9]*/[a-z]*
msm ALL=(root) NOPASSWD: /usr/sbin/ufw status
msm ALL=(root) NOPASSWD: /usr/sbin/ufw status numbered

# iptables ONLY via vetted wrapper (enforces DOCKER-USER only for variable long args)
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
            ok "sudoers + iptables/quota/caddy-Wrapper eingerichtet"
        fi

    else
        warn "systemd nicht verfügbar (typisch für WSL). msm-panel.service wird geschrieben, aber nicht aktiviert."
        warn "Starte manuell mit: cd /opt/msm/backend && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000"
    fi
fi

# Minimal-Apply: nur Auto-Update wurde geändert
if $REINSTALL_MODE && ! $KEEP_SETTINGS && $CHANGED_AUTO_UPDATE && ! $RUN_SYSTEMD_SETUP; then
    if $SYSTEMD_AVAILABLE; then
        log "Aktualisiere Auto-Update Timer..."
        cp "$SCRIPT_DIR/msm-update.service" /etc/systemd/system/msm-update.service 2>/dev/null || true
        cp "$SCRIPT_DIR/msm-update.timer" /etc/systemd/system/msm-update.timer 2>/dev/null || true
        systemctl daemon-reload
        if [[ "$MSM_AUTO_UPDATE" == "true" ]]; then
            systemctl enable msm-update.timer 2>/dev/null || true
            systemctl start msm-update.timer 2>/dev/null || true
            ok "Auto-Update Timer aktiviert"
        else
            systemctl stop msm-update.timer 2>/dev/null || true
            systemctl disable msm-update.timer 2>/dev/null || true
            ok "Auto-Update Timer deaktiviert"
        fi
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 12. Firewall (UFW)
# ═══════════════════════════════════════════════════════════════
log "Konfiguriere Firewall..."
if command -v ufw &>/dev/null; then
    ufw default deny incoming 2>/dev/null || true
    ufw default allow outgoing 2>/dev/null || true
    ufw allow 22/tcp comment 'SSH' 2>/dev/null || true
    ufw allow 80/tcp comment 'HTTP' 2>/dev/null || true
    ufw allow 443/tcp comment 'HTTPS' 2>/dev/null || true
    # WSL im Mirrored-Networking-Modus routet 127.0.0.1 ueber loopback0
    # statt lo. UFW erlaubt lo automatisch, loopback0 jedoch nicht. Ohne
    # diese eng begrenzte Regel sperrt der Installer seine lokalen Dienste
    # (DIS, Backend und Agent) direkt nach dem Aktivieren der Firewall aus.
    if [[ -d /sys/class/net/loopback0 ]]; then
        ufw allow in on loopback0 from 127.0.0.0/8 comment 'WSL local loopback' 2>/dev/null || true
    fi
    # Medienports des LiveKit-Sidecars. Die Signalisierung laeuft ueber 443
    # (Caddy), die Sprach- und Videodaten nicht: sie brauchen einen eigenen
    # Weg. 7882/udp ist der Normalfall, 7881/tcp der Rueckfall fuer Netze, die
    # UDP sperren. Fehlen beide Regeln, kommt ein Anruf zustande und bleibt
    # stumm — der unangenehmste aller Fehlerzustaende, weil nichts kaputt
    # aussieht.
    if [[ -d "$MSM_DIR/livekit-sidecar" ]]; then
        ufw allow 7881/tcp comment 'MSM LiveKit media (TCP fallback)' 2>/dev/null || true
        ufw allow 7882/udp comment 'MSM LiveKit media' 2>/dev/null || true
    fi
    # Spiel-Ports werden ab Phase 2 NICHT mehr als Range freigegeben.
    # Der Port-Manager des Panels öffnet je Server nur die konkret
    # zugewiesenen Einzelports (game/udp, query/udp, rcon/tcp) und schließt
    # sie beim Stop wieder. Siehe backend/services/firewall_service.py.
    ufw --force enable 2>/dev/null || true
    ok "Firewall aktiviert (UFW) — Ports 22, 80, 443 offen, 7881/tcp + 7882/udp für Anrufe. Spiel-Ports werden zur Laufzeit vom Panel verwaltet."
else
    warn "UFW nicht verfügbar. Firewall manuell konfigurieren."
fi

# ═══════════════════════════════════════════════════════════════
# 13. Fail2ban (Brute-Force-Schutz)
# ═══════════════════════════════════════════════════════════════
if ! command -v fail2ban-server &>/dev/null; then
    log "Installiere Fail2ban..."
    apt-get install -y -qq fail2ban 2>&1 | tee -a "$LOG_FILE"
else
    log "Fail2ban ist bereits installiert. Konfiguration wird aktualisiert..."
fi

# Eigene Filterregel für das Panel-Auth
mkdir -p /etc/fail2ban/filter.d
cat > /etc/fail2ban/filter.d/msm-panel.conf <<'EOF'
[Definition]
failregex = ^.*Forbidden login attempt from <HOST>.*$
            ^.*Invalid credentials from <HOST>.*$
            ^.*Too many failed attempts from <HOST>.*$
journalmatch = _SYSTEMD_UNIT=msm-panel.service
EOF

cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log

[msm-panel]
enabled = true
port = 80,443
filter = msm-panel
logpath = /var/log/syslog
backend = systemd
EOF

if $SYSTEMD_AVAILABLE; then
    systemctl enable fail2ban >/dev/null 2>&1 || true
    systemctl restart fail2ban >/dev/null 2>&1 || true
    ok "Fail2ban aktiviert (SSH + Panel Brute-Force-Schutz)"
else
    warn "systemd nicht verfügbar — Fail2ban-Konfiguration geschrieben, aber nicht gestartet."
fi

# ═══════════════════════════════════════════════════════════════
# 14. Service starten / neustarten
# ═══════════════════════════════════════════════════════════════
log "Starte Panel-Service..."
if $SYSTEMD_AVAILABLE; then
    # DIS Sidecar zuerst starten (Panel haengt davon ab)
    systemctl restart msm-dis-sidecar.service 2>/dev/null \
        || systemctl start msm-dis-sidecar.service 2>/dev/null \
        || err "DIS Sidecar konnte nicht gestartet werden."
    DIS_READY=false
    for _attempt in $(seq 1 30); do
        # /health ist wie alle Sidecar-Routen authentifiziert. Den Token ueber
        # stdin statt als Prozessargument uebergeben, damit er nicht in ps
        # oder dem Installationslog sichtbar werden kann.
        if printf 'Authorization: Bearer %s\n' "$DIS_TOKEN" \
            | curl -fsS --max-time 2 --header @- http://127.0.0.1:9100/health \
                >/dev/null 2>&1; then
            DIS_READY=true
            break
        fi
        sleep 1
    done
    $DIS_READY || err "DIS Sidecar ist nicht bereit. Prüfe: journalctl -u msm-dis-sidecar -n 50"

    # Dokumente-Sidecar: eigener Dienst, non-fatal. Ein Panels ohne Docs ist
    # besser als ein Panel, das wegen eines fehlenden Dokumentservers nicht startet.
    systemctl restart msm-docs-sidecar.service 2>/dev/null \
        || systemctl start msm-docs-sidecar.service 2>/dev/null \
        || warn "Dokumente-Sidecar konnte nicht gestartet werden."
    DOCS_READY=false
    for _attempt in $(seq 1 20); do
        if printf 'Authorization: Bearer %s\n' "$DOCS_TOKEN" \
            | curl -fsS --max-time 2 --header @- http://127.0.0.1:8101/internal/docs/health \
                >/dev/null 2>&1; then
            DOCS_READY=true
            break
        fi
        sleep 1
    done
    $DOCS_READY || warn "Dokumente-Sidecar antwortet nicht. Prüfe: journalctl -u msm-docs-sidecar -n 50"

    # SearXNG Sidecar starten
    if [[ -f /etc/systemd/system/msm-searxng.service ]]; then
        log "Starte SearXNG Search Sidecar..."
        systemctl restart msm-searxng.service 2>/dev/null \
            || systemctl start msm-searxng.service 2>/dev/null || true
        ok "SearXNG Sidecar bereit."
    fi

    # LiveKit Sidecar starten (Anrufe im Messenger)
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
    if [[ -f "$MSM_DIR/backend/msm.db" ]] || [[ "$DB_URL" == postgresql* ]]; then
        log "Pruefe DIS-Migration (Fernet -> DIS)..."
        su - "$MSM_USER" -c "
            cd $MSM_DIR/backend
            source venv/bin/activate
            python3 scripts/migrate_to_dis.py
        " 2>&1 | tee -a "$LOG_FILE" || err "DIS-Migration fehlgeschlagen! Migration abgebrochen. Prüfe das Log: $LOG_FILE"
    fi

    if $INSTALL_LOCAL_AGENT && [[ -f /etc/systemd/system/msm-agent.service ]]; then
        systemctl restart msm-agent.service 2>/dev/null \
            || systemctl start msm-agent.service 2>/dev/null \
            || err "MSM Agent konnte nicht gestartet werden."
        AGENT_READY=false
        for _attempt in $(seq 1 30); do
            if curl -fsS --max-time 2 http://127.0.0.1:9000/health >/dev/null 2>&1; then
                AGENT_READY=true
                break
            fi
            sleep 1
        done
        $AGENT_READY || err "MSM Agent ist nicht bereit. Prüfe: journalctl -u msm-agent -n 50"
        ok "MSM Agent läuft (Port 9000)"
    fi

    systemctl restart msm-panel.service 2>/dev/null \
        || systemctl start msm-panel.service 2>/dev/null \
        || err "Panel-Service konnte nicht gestartet werden."
    if [[ -f /etc/systemd/system/msm-worker.service ]] && systemctl is-enabled --quiet msm-worker.service 2>/dev/null; then
        systemctl restart msm-worker.service 2>/dev/null \
            || systemctl start msm-worker.service 2>/dev/null \
            || err "Worker-Service konnte nicht gestartet werden."
        ok "Hintergrund-Worker läuft (msm-worker)"
    fi
    PANEL_READY=false
    # Der erste Start kann auf kleiner Hardware durch Schema-, Firewall- und
    # Runtime-Abgleich deutlich laenger als ein normaler Neustart dauern.
    PANEL_READY_DEADLINE=$((SECONDS + 180))
    while (( SECONDS < PANEL_READY_DEADLINE )); do
        if curl -fsS --max-time 2 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
            PANEL_READY=true
            break
        fi
        sleep 1
    done
    $PANEL_READY || err "Panel-Service ist nicht bereit. Prüfe: journalctl -u msm-panel -n 50"
    ok "Panel-Service läuft"
    systemctl is-active --quiet caddy \
        || err "Caddy ist nicht aktiv. Prüfe: journalctl -u caddy -n 50"
    ok "Caddy läuft"
else
    warn "systemd nicht verfügbar — Service muss manuell gestartet werden."
    warn "Starte manuell mit: cd /opt/msm/backend && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000"
    if $INSTALL_LOCAL_AGENT; then
        warn "Agent: cd /opt/msm/msm-agent && source venv/bin/activate && python main.py"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 15. Fertig — Zusammenfassung
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
if $REINSTALL_MODE; then
    echo -e "${GREEN}  Maunting Service Manager erfolgreich aktualisiert!${NC}"
else
    echo -e "${GREEN}  Maunting Service Manager erfolgreich installiert!${NC}"
fi
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"

# Transparenz: Was wurde geändert?
if $REINSTALL_MODE; then
    echo ""
    echo -e "  ${BOLD}Durchgeführte Änderungen:${NC}"
    if $KEEP_SETTINGS; then
        echo -e "    ${GREEN}•${NC} Quellcode aktualisiert"
        echo -e "    ${GREEN}•${NC} Frontend neu gebaut"
        echo -e "    ${GREEN}•${NC} Services neugestartet"
        echo -e "    ${CYAN}•${NC} Konfiguration unverändert"
    else
        if $CHANGED_DOMAIN; then     echo -e "    ${YELLOW}•${NC} Domain geändert";       else echo -e "    ${CYAN}•${NC} Domain unverändert"; fi
        if $CHANGED_EMAIL; then       echo -e "    ${YELLOW}•${NC} Email geändert";         else echo -e "    ${CYAN}•${NC} Email unverändert"; fi
        if $CHANGED_REDIS; then      echo -e "    ${YELLOW}•${NC} Redis geändert";          else echo -e "    ${CYAN}•${NC} Redis unverändert"; fi
        if $CHANGED_AUTO_UPDATE; then echo -e "    ${YELLOW}•${NC} Auto-Update geändert";   else echo -e "    ${CYAN}•${NC} Auto-Update unverändert"; fi
        if $CODE_CHANGED; then       echo -e "    ${GREEN}•${NC} Quellcode aktualisiert";  else echo -e "    ${CYAN}•${NC} Quellcode unverändert"; fi
    fi
fi
echo ""

if [[ -n "$DOMAIN" ]]; then
    echo -e "  ${BOLD}Panel-URL:${NC}     ${CYAN}https://$DOMAIN${NC}"
else
    PUBLIC_IP=$(curl -s -4 ifconfig.me 2>/dev/null || echo "<DEINE-IP>")
    echo -e "  ${BOLD}Panel-URL:${NC}     ${CYAN}http://$PUBLIC_IP${NC}"
    if ! $REINSTALL_MODE; then
        echo -e "  ${YELLOW}Hinweis:${NC}      Für HTTPS eine Domain einrichten und install.sh erneut laufen lassen."
    fi
fi

echo ""
echo -e "  ${BOLD}Installationspfad:${NC}  $MSM_DIR"
echo -e "  ${BOLD}Log-Datei:${NC}          $LOG_FILE"
echo -e "  ${BOLD}Konfiguration:${NC}      $ENV_FILE"
echo ""

echo -e "  ${GREEN}Datenbank:${NC}         PostgreSQL (DB: msm, User: msm)"

if [[ "$EMAIL_PROVIDER" == "resend" && -n "$RESEND_API_KEY" ]]; then
    echo -e "  ${GREEN}Email:${NC}             Resend (API-Key konfiguriert)"
elif [[ -n "$SMTP_HOST" ]]; then
    echo -e "  ${GREEN}Email:${NC}             SMTP $SMTP_HOST:$SMTP_PORT"
else
    echo -e "  ${YELLOW}Email nicht konfiguriert.${NC}"
    echo -e "         Wird beim ersten Oeffnen sicher im Setup-Wizard eingerichtet."
fi

if $INSTALL_REDIS; then
    echo -e "  ${GREEN}Redis aktiv:${NC}       Verteiltes Rate-Limiting einsatzbereit"
else
    echo -e "  ${YELLOW}Redis nicht aktiv:${NC}  Rate-Limiting nutzt in-memory (verliert State bei Neustart)"
fi

if [[ "$MSM_AUTO_UPDATE" == "true" ]]; then
    echo -e "  ${GREEN}Auto-Update:${NC}      Aktiviert (24h Intervall)"
else
    echo -e "  ${YELLOW}Auto-Update:${NC}      Deaktiviert"
fi

echo ""
echo -e "  ${BOLD}Nächste Schritte:${NC}"
echo -e "    1. Panel im Browser öffnen"
echo -e "    2. E-Mail-Versand und Owner im Setup-Wizard einrichten"
echo -e "    3. E-Mail-Adresse mit dem zugesandten Code bestaetigen"
echo -e "    4. Game-Server erstellen — jeder Server läuft isoliert mit eigenem Linux-User"
echo ""
echo -e "  ${BOLD}Wichtige Befehle:${NC}"
echo -e "    ${CYAN}sudo systemctl status msm-panel${NC}    — Service-Status prüfen"
echo -e "    ${CYAN}sudo journalctl -u msm-panel -f${NC}  — Live-Logs"
echo -e "    ${CYAN}sudo systemctl restart msm-panel${NC}  — Service neustarten"
echo -e "    ${CYAN}sudo systemctl restart caddy${NC}      — Caddy neustarten"
echo ""
echo -e "  ${BOLD}Sicherheit:${NC}"
echo -e "    - Firewall (UFW) aktiv, Ports 22/80/443 offen"
echo -e "    - Fail2ban schützt SSH und Panel vor Brute-Force"
echo -e "    - SECRET_KEY automatisch generiert (256-bit)"
echo -e "    - .env mit chmod 600 geschützt"
echo -e "    - Game-Server isoliert: eigener User, eigene systemd-Unit, Resource-Limits"
echo ""
