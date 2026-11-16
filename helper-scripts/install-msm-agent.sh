#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  MSM Agent Installer (Phase 5) — remote node runtime
#  Usage:  sudo bash helper-scripts/install-msm-agent.sh
#          sudo bash install-msm-agent.sh   (when run from repo root)
#  Requires: Ubuntu 22.04+ / Debian 12+, root, Python 3.11+
#  Sets up: msm user, rootless Docker, TLS cert, systemd unit
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
umask 077

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

MSM_USER="msm-agent"
MSM_DOCKER_USER="msm-docker"
MSM_SERVERS_GROUP="msm-servers"
MSM_DOCKER_HOME="/var/lib/msm-docker"
AGENT_DIR="/opt/msm-agent"
SERVERS_DIR="/opt/msm/servers"
CERT_DIR="${AGENT_DIR}/certs"
LOG_FILE="/tmp/msm-agent-install.log"
AGENT_PORT="${MSM_AGENT_PORT:-9000}"
AGENT_HOST="${MSM_AGENT_HOST:-0.0.0.0}"
TOKEN_HANDOFF_FILE="${MSM_AGENT_TOKEN_HANDOFF_FILE:-/root/msm-agent-token}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[MSM-Agent]${NC} $1" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[ERR]${NC}  $1" | tee -a "$LOG_FILE"; exit 1; }

# ── 1. System checks ──────────────────────────────────────────
if [[ "$(id -u)" -ne 0 ]]; then
  err "Bitte als root ausfuehren: sudo bash $0"
fi

if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ok "OS: ${PRETTY_NAME:-$ID}" ;;
    *) warn "OS ${ID:-unknown} — getestet auf Ubuntu/Debian; fortfahren..." ;;
  esac
else
  warn "Kein /etc/os-release — fortfahren auf eigene Gefahr"
fi

if ! command -v python3 >/dev/null 2>&1; then
  err "python3 fehlt"
fi
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 11) else 0)')
if [[ "$PY_OK" != "1" ]]; then
  err "Python 3.11+ erforderlich (gefunden: $PY_VER)"
fi
ok "Python $PY_VER"

# ── 2. Locate agent sources ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_AGENT=""
if [[ -d "$REPO_ROOT/msm-agent" && -f "$REPO_ROOT/msm-agent/main.py" ]]; then
  SRC_AGENT="$REPO_ROOT/msm-agent"
elif [[ -d "./msm-agent" && -f "./msm-agent/main.py" ]]; then
  SRC_AGENT="$(cd ./msm-agent && pwd)"
else
  err "msm-agent/ Quellverzeichnis nicht gefunden (Repo-Root neben helper-scripts/ erwarten)"
fi
ok "Agent-Quellen: $SRC_AGENT"

# ── 3. System packages ────────────────────────────────────────
log "Installiere System-Pakete..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq --allow-releaseinfo-change=true >>"$LOG_FILE" 2>&1 || warn "apt-get update hatte Warnungen"
apt-get install -y -qq \
  python3 python3-venv python3-pip \
  curl ca-certificates gnupg openssl sudo ufw rsync \
  uidmap dbus-user-session slirp4netns acl quota e2fsprogs iptables \
  >>"$LOG_FILE" 2>&1 || err "apt-get install fehlgeschlagen (siehe $LOG_FILE)"
ok "System-Pakete"

# ── 4. msm + msm-docker system users ──────────────────────────
if ! id -u "$MSM_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/msm --shell /bin/bash "$MSM_USER"
  ok "User $MSM_USER angelegt"
else
  ok "User $MSM_USER existiert"
fi
if ! id -u "$MSM_DOCKER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$MSM_DOCKER_HOME" --shell /bin/bash "$MSM_DOCKER_USER"
  ok "User $MSM_DOCKER_USER angelegt"
fi
if ! getent group "$MSM_SERVERS_GROUP" >/dev/null 2>&1; then
  groupadd --system "$MSM_SERVERS_GROUP"
fi
usermod -aG "$MSM_SERVERS_GROUP" "$MSM_USER" 2>/dev/null || true
usermod -aG "$MSM_SERVERS_GROUP" "$MSM_DOCKER_USER" 2>/dev/null || true

# ── 5. Rootless Docker (isoliert unter $MSM_DOCKER_USER) ──────
install_rootless_docker() {
  local docker_home docker_uid
  docker_home="$(getent passwd "$MSM_DOCKER_USER" | cut -d: -f6)"
  docker_uid="$(id -u "$MSM_DOCKER_USER")"

  for f in /etc/subuid /etc/subgid; do
    touch "$f"; chmod 644 "$f"
    if ! grep -qE "^${MSM_DOCKER_USER}:" "$f"; then
      local start
      start=$(awk -F: 'BEGIN{m=99999} NF>=3{e=$2+$3-1; if(e>m)m=e} END{print m+1}' "$f")
      echo "${MSM_DOCKER_USER}:${start}:65536" >> "$f"
    fi
  done

  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$MSM_DOCKER_USER" >>"$LOG_FILE" 2>&1 || true
  fi

  # cgroup v2 delegation & workload slice
  if [[ -d /run/systemd/system ]]; then
    modprobe br_netfilter 2>/dev/null || true
    printf 'br_netfilter\n' > /etc/modules-load.d/msm-docker.conf
    mkdir -p /etc/systemd/system/user@.service.d "/etc/systemd/system/user@${docker_uid}.service.d"
    printf '[Service]\nDelegate=cpu cpuset io memory pids\n' > /etc/systemd/system/user@.service.d/delegate.conf
    # Keep user@UID.service in its default user-UID.slice so runc can detect OwnerUID from /proc/self/cgroup
    printf '[Service]\nOOMScoreAdjust=500\n' > "/etc/systemd/system/user@${docker_uid}.service.d/msm-workloads.conf"
    systemctl daemon-reload >>"$LOG_FILE" 2>&1 || true
    systemctl start "user@${docker_uid}.service" >>"$LOG_FILE" 2>&1 || true
    install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 710 "/run/user/${docker_uid}" 2>/dev/null || true
  fi

  # Docker engine packages if missing
  if ! command -v dockerd-rootless-setuptool.sh >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
    log "Installiere Docker CE (static packages)..."
    if [[ -f /etc/debian_version ]]; then
      install -m 0755 -d /etc/apt/keyrings
      if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
        curl -fsSL https://download.docker.com/linux/${ID}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
      fi
      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME:-stable} stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update -qq --allow-releaseinfo-change=true >>"$LOG_FILE" 2>&1
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin \
        >>"$LOG_FILE" 2>&1 || warn "docker-ce install unvollstaendig"
    fi
  fi

  # Rootless setup for $MSM_DOCKER_USER
  if [[ ! -f "${docker_home}/.config/systemd/user/docker.service" ]]; then
    log "Richte rootless Docker fuer $MSM_DOCKER_USER ein..."
    if ! command -v dockerd-rootless-setuptool.sh >/dev/null 2>&1; then
      apt-get install -y -qq docker-ce-rootless-extras >>"$LOG_FILE" 2>&1 || true
    fi
    if command -v dockerd-rootless-setuptool.sh >/dev/null 2>&1; then
      su -s /bin/bash "$MSM_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${docker_uid}; dockerd-rootless-setuptool.sh install" >>"$LOG_FILE" 2>&1 \
        || warn "dockerd-rootless-setuptool.sh meldete Fehler — manuell pruefen"
    else
      warn "Rootless-Setup-Tool fehlt — Docker manuell als rootless fuer $MSM_DOCKER_USER konfigurieren"
    fi
  else
    ok "Rootless Docker fuer $MSM_DOCKER_USER bereits eingerichtet"
  fi

  # Docker daemon & rootlesskit hardening
  install -d -o "$MSM_DOCKER_USER" -g "$MSM_DOCKER_USER" -m 700 "${docker_home}/.config/docker"
  cat > "${docker_home}/.config/docker/daemon.json" <<'EOF'
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
  chown "$MSM_DOCKER_USER:$MSM_DOCKER_USER" "${docker_home}/.config/docker/daemon.json"
  su -s /bin/bash "$MSM_DOCKER_USER" -c "mkdir -p ~/.config/systemd/user/docker.service.d && printf '[Service]\nEnvironment=\"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${docker_uid}/bus\"\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns\"\nEnvironment=\"DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true\"\n' > ~/.config/systemd/user/docker.service.d/override.conf" >>"$LOG_FILE" 2>&1 || true
  if [[ -d /run/systemd/system ]]; then
    su -s /bin/bash "$MSM_DOCKER_USER" -c "export XDG_RUNTIME_DIR=/run/user/${docker_uid} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${docker_uid}/bus; systemctl --user daemon-reload && systemctl --user enable docker.service && systemctl --user restart docker.service" >>"$LOG_FILE" 2>&1 || true
  fi

  cat > /usr/local/sbin/msm-docker-socket-acl <<ACLEOF
#!/bin/sh
set -eu
DOCKER_UID="${docker_uid}"
AGENT_USER="${MSM_USER}"
RUNTIME_DIR="/run/user/\${DOCKER_UID}"
SOCK="\${RUNTIME_DIR}/docker.sock"
[ -d "\$RUNTIME_DIR" ] && command -v setfacl >/dev/null 2>&1 && { chmod 0710 "\$RUNTIME_DIR" || true; setfacl -m "u:\${AGENT_USER}:x" "\$RUNTIME_DIR" || true; }
[ -S "\$SOCK" ] && command -v setfacl >/dev/null 2>&1 && { chmod 0660 "\$SOCK" || true; setfacl -m "u:\${AGENT_USER}:rw" "\$SOCK" || true; }
ACLEOF
  chown root:root /usr/local/sbin/msm-docker-socket-acl
  chmod 0755 /usr/local/sbin/msm-docker-socket-acl
  /usr/local/sbin/msm-docker-socket-acl || true

  # sysctl hardening
  cat > /etc/sysctl.d/99-msm-hardening.conf <<'EOF'
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
EOF
  sysctl --system >>"$LOG_FILE" 2>&1 || true
}
install_rootless_docker
ok "Rootless Docker Schritt abgeschlossen"

MSM_UID="$(id -u "$MSM_DOCKER_USER")"
DOCKER_HOST_DEFAULT="unix:///run/user/${MSM_UID}/docker.sock"

# ── 6. Deploy agent files ─────────────────────────────────────
log "Deploy nach $AGENT_DIR ..."
mkdir -p "$AGENT_DIR" "$SERVERS_DIR" "$CERT_DIR"
# Copy agent tree excluding venv / .env / servers
rsync -a --delete \
  --exclude 'venv/' \
  --exclude '.env' \
  --exclude 'servers/' \
  --exclude 'certs/' \
  --exclude 'postgres/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '.pytest_cache/' \
  "$SRC_AGENT/" "$AGENT_DIR/" 2>>"$LOG_FILE" \
  || err "Gefiltertes Agent-Deployment fehlgeschlagen"
chown -R "$MSM_USER:$MSM_USER" "$AGENT_DIR"
chown "$MSM_USER:$MSM_SERVERS_GROUP" "$SERVERS_DIR"
chmod 0710 "$SERVERS_DIR"
ok "Agent-Dateien deployed"

# ── 7. venv + deps ────────────────────────────────────────────
log "Python venv..."
if [[ ! -d "$AGENT_DIR/venv" ]]; then
  sudo -u "$MSM_USER" python3 -m venv "$AGENT_DIR/venv"
fi
sudo -u "$MSM_USER" "$AGENT_DIR/venv/bin/pip" install --upgrade pip -q >>"$LOG_FILE" 2>&1
sudo -u "$MSM_USER" "$AGENT_DIR/venv/bin/pip" install -r "$AGENT_DIR/requirements.txt" -q >>"$LOG_FILE" 2>&1 \
  || err "pip install requirements fehlgeschlagen"
ok "Dependencies installiert"

# ── 8. TLS certificate (self-signed RSA 4096) ─────────────────
CERT_FILE="$CERT_DIR/agent.crt"
KEY_FILE="$CERT_DIR/agent.key"
if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
  log "Generiere Self-signed TLS Zertifikat (RSA 4096)..."
  openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -subj "/CN=msm-agent/O=MauntingStudios/OU=MSM-Agent" \
    >>"$LOG_FILE" 2>&1 || err "openssl cert generation failed"
  chmod 600 "$KEY_FILE"
  chmod 644 "$CERT_FILE"
  chown "$MSM_USER:$MSM_USER" "$CERT_FILE" "$KEY_FILE"
  ok "Zertifikat erzeugt"
else
  ok "Bestehendes Zertifikat behalten"
fi

FINGERPRINT=$(openssl x509 -in "$CERT_FILE" -outform DER 2>/dev/null | sha256sum | awk '{print $1}')
if [[ -z "$FINGERPRINT" ]]; then
  # mac/busybox fallback
  FINGERPRINT=$(openssl x509 -in "$CERT_FILE" -noout -fingerprint -sha256 | sed 's/.*=//' | tr -d ':' | tr 'A-F' 'a-f')
fi
ok "Fingerprint berechnet"

# ── 9. Token + .env ───────────────────────────────────────────
ENV_FILE="$AGENT_DIR/.env"
if [[ -f "$ENV_FILE" ]] && grep -q '^MSM_AGENT_TOKEN=.\+' "$ENV_FILE" 2>/dev/null; then
  # Keep existing token
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  AGENT_TOKEN="${MSM_AGENT_TOKEN}"
  ok "Bestehenden MSM_AGENT_TOKEN behalten"
else
  AGENT_TOKEN="$(openssl rand -base64 48 | tr -d '\n=/+' | head -c 48)"
  ok "Neuen MSM_AGENT_TOKEN generiert"
fi

cat > "$ENV_FILE" <<EOF
# Automatisch durch install-msm-agent.sh generiert — niemals committen.
# Vollständige Erklärung aller Werte: ${AGENT_DIR}/.env.example
MSM_AGENT_TOKEN=${AGENT_TOKEN}
MSM_AGENT_HOST=${AGENT_HOST}
MSM_AGENT_PORT=${AGENT_PORT}
MSM_SERVERS_DIR=${SERVERS_DIR}
MSM_DOCKER_HOST=${DOCKER_HOST_DEFAULT}
MSM_REQUIRE_NETWORK_ISOLATION=true
MSM_QUOTA_DRIVER=auto
MSM_REQUIRE_DISK_QUOTA=false
MSM_HOST_RESERVED_RAM_MB=1536
MSM_AGENT_LOG_LEVEL=INFO
MSM_TLS_CERTFILE=${CERT_FILE}
MSM_TLS_KEYFILE=${KEY_FILE}
EOF
chown "$MSM_USER:$MSM_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok ".env geschrieben"

# Narrow root boundary for node-local UFW changes. The agent may only open or
# close one validated TCP/UDP port per invocation; arbitrary UFW arguments are
# impossible through this wrapper.
FIREWALL_WRAPPER="/usr/local/sbin/msm-agent-firewall"
cat > "$FIREWALL_WRAPPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
action="${1:-}"
port="${2:-}"
protocol="${3:-}"
server_name="${4:-server}"
role="${5:-game}"
[[ "$action" =~ ^(open|close)$ ]] || exit 2
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( port >= 1 && port <= 65535 )) || exit 2
[[ "$protocol" =~ ^(tcp|udp)$ ]] || exit 2
[[ "$server_name" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || exit 2
[[ "$role" =~ ^[A-Za-z0-9_.-]{1,32}$ ]] || exit 2
if [[ "$action" == "open" ]]; then
  exec ufw allow "${port}/${protocol}" comment "MSM ${server_name:0:24} ${role}"
fi
exec ufw delete allow "${port}/${protocol}"
EOF
chown root:root "$FIREWALL_WRAPPER"
chmod 0755 "$FIREWALL_WRAPPER"

# Install root-owned iptables isolation + disk quota wrappers on remote nodes too
cp -f "$REPO_ROOT/backend/scripts/msm-iptables" /usr/local/sbin/msm-iptables
chown root:root /usr/local/sbin/msm-iptables
chmod 0755 /usr/local/sbin/msm-iptables
cp -f "$REPO_ROOT/backend/scripts/msm-quota" /usr/local/sbin/msm-quota
chown root:root /usr/local/sbin/msm-quota
chmod 0755 /usr/local/sbin/msm-quota

cat > /etc/sudoers.d/msm-agent <<EOF
Defaults:${MSM_USER} !authenticate
${MSM_USER} ALL=(root) NOPASSWD: ${FIREWALL_WRAPPER} *
${MSM_USER} ALL=(root) NOPASSWD: /usr/local/sbin/msm-iptables
${MSM_USER} ALL=(root) NOPASSWD: /usr/local/sbin/msm-quota
${MSM_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart msm-agent.service, /bin/systemctl restart msm-agent.service
EOF
chmod 0440 /etc/sudoers.d/msm-agent
visudo -cf /etc/sudoers.d/msm-agent >/dev/null || err "Ungueltige Agent-sudoers-Regel"
rm -f /etc/sudoers.d/msm-agent-firewall
ok "Node-Firewall-, Netfilter- & Quota-Wrapper installiert"

# ── 10. systemd unit & slices ─────────────────────────────────
if [[ -d /run/systemd/system ]]; then
  cat > /etc/systemd/system/msm-control.slice <<'EOF'
[Unit]
Description=MSM Node Control Slice (Agent)

[Slice]
CPUWeight=200
MemoryMin=256M
EOF
  cat > /etc/systemd/system/msm-workloads.slice <<'EOF'
[Unit]
Description=MSM Tenant Workload Slice

[Slice]
CPUWeight=50
IOWeight=50
EOF
fi
UNIT_PATH="/etc/systemd/system/msm-agent.service"
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=MSM Agent (Node Runtime)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${MSM_USER}
Group=${MSM_USER}
Slice=msm-control.slice
OOMScoreAdjust=-500
WorkingDirectory=${AGENT_DIR}
Environment="PATH=${AGENT_DIR}/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="DOCKER_HOST=${DOCKER_HOST_DEFAULT}"
Environment="XDG_RUNTIME_DIR=/run/user/${MSM_UID}"
EnvironmentFile=-${ENV_FILE}
ExecStartPre=+/usr/local/sbin/msm-docker-socket-acl
ExecStart=${AGENT_DIR}/venv/bin/python main.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Least privilege
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
StateDirectory=msm-agent
ReadWritePaths=${AGENT_DIR} ${SERVERS_DIR} -/run/user/${MSM_UID} -/run/sudo -/home/${MSM_USER} -/var/lib/msm-agent -/var/lib/msm-quotas

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable msm-agent.service >>"$LOG_FILE" 2>&1
systemctl restart msm-agent.service >>"$LOG_FILE" 2>&1 || warn "Service-Start fehlgeschlagen — journalctl -u msm-agent"
sleep 1
if systemctl is-active --quiet msm-agent.service; then
  ok "msm-agent.service active"
else
  if [[ "${MSM_AGENT_ENROLLMENT:-false}" == "true" ]]; then
    err "msm-agent.service ist nicht aktiv — siehe: journalctl -u msm-agent -n 50"
  fi
  warn "msm-agent.service nicht aktiv — siehe: journalctl -u msm-agent -n 50"
fi

# Open only the configured agent port when UFW is already active. Cloud-provider
# firewalls remain outside the server and must still be configured there.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow "${AGENT_PORT}/tcp" comment 'MSM Agent' >>"$LOG_FILE" 2>&1 \
    || err "UFW-Regel fuer Agent-Port ${AGENT_PORT} konnte nicht gesetzt werden"
  ok "UFW-Port ${AGENT_PORT}/tcp freigegeben"
fi

# ── 11. Detect public IP (best-effort) ────────────────────────
PUBLIC_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PUBLIC_IP="${PUBLIC_IP:-127.0.0.1}"
AGENT_URL="https://${PUBLIC_IP}:${AGENT_PORT}"

# Enrollment installs never expose the token. Manual installs use a protected
# one-time handoff file instead of printing a reusable bearer token to stdout.
if [[ "${MSM_AGENT_ENROLLMENT:-false}" != "true" ]]; then
  install -m 0600 /dev/null "$TOKEN_HANDOFF_FILE"
  printf '%s\n' "$AGENT_TOKEN" > "$TOKEN_HANDOFF_FILE"
fi
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN} MSM Agent Installation abgeschlossen${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Agent-URL (Panel → Node host):"
echo -e "    ${CYAN}${AGENT_URL}${NC}"
echo ""
if [[ "${MSM_AGENT_ENROLLMENT:-false}" != "true" ]]; then
  echo -e "  MSM_AGENT_TOKEN (geschuetzte Uebergabedatei, Mode 0600):"
  echo -e "    ${YELLOW}${TOKEN_HANDOFF_FILE}${NC}"
  echo ""
fi
echo -e "  TLS Fingerprint SHA-256 (Panel → tls_fingerprint):"
echo -e "    ${GREEN}${FINGERPRINT}${NC}"
echo ""
echo -e "  Install-Dir:  ${AGENT_DIR}"
echo -e "  Servers-Dir:  ${SERVERS_DIR}"
echo -e "  Service:      systemctl status msm-agent"
echo -e "  Log:          ${LOG_FILE}"
echo ""
echo -e "  Firewall:     UFW automatisch konfiguriert, falls aktiv"
echo -e "                Cloud-Firewall muss Port ${AGENT_PORT}/tcp erlauben"
echo ""
if [[ "${MSM_AGENT_ENROLLMENT:-false}" != "true" ]]; then
  echo -e "${BOLD}Im Panel:${NC} Admin → Nodes → Token aus ${TOKEN_HANDOFF_FILE} einmalig uebernehmen und Datei danach loeschen."
else
  echo -e "${BOLD}Enrollment:${NC} Agent lokal bereit; warte auf Bestätigung im Panel."
fi
echo -e "${BOLD}Sicherheit:${NC} Token und Keyfile niemals committen oder loggen."
echo ""
