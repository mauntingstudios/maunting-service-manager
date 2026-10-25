<div align="center">

# Maunting Service Manager (MSM)

**A modern, self-hosted management panel for game servers, applications, and Linux services.**  
Autonomous monitoring with the Guardian Engine, rootless container security, E2EE backups, and AI-assisted operations.

[![Status](https://img.shields.io/badge/Status-Active%20Development-orange)](https://github.com/mauntingstudios/maunting-service-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick Start](#installation) • [Key Features](#what-msm-can-do) • [Comparison](#msm-compared) • [Architecture](#how-everything-connects) • [Documentation](docs/self-hosting.md)

<br />

![MSM dashboard showing running game servers, node capacity, and system health](docs/images/dashboard.png)
*Unified Dashboard: Monitor game servers, node capacities, and system health in real-time.*

![AI assistant answering server management questions with tool calls and data tables](docs/images/ki-assistent.png)
*AI Assistant: Inspects service states, logs, and disk utilization autonomously to provide actionable insights.*

<sub>Images display sample demonstration data.</sub>

</div>

---

> [!IMPORTANT]
> MSM is actively under development. Please avoid running it in mission-critical environments without performing regular, verified backups.

> [!NOTE]
> 🧪 **Experimental Feature: Kubernetes**  
> Under `deploy/kubernetes/`, you will find experimental manifests for running the panel. This setup has not yet undergone full production validation by the core team. If you are experienced with Kubernetes, feel free to test it and share your feedback or pull requests!

---

## What is MSM?

MSM separates two primary components: the **Panel**, which you operate via modern web browsers, and the **Nodes**, the physical or virtual machines where your games and services actually run. Every service operates in isolated Docker containers strictly without root privileges.

### What you can use MSM for
- **Game Servers:** Create, start, stop, and restart instances. MSM handles port allocations automatically. Native support includes Conan Exiles, DayZ, Minecraft, ARK, and more.
- **Linux Applications:** Deploy databases, web applications, and background workers using blueprint templates.
- **Multi-Server Management:** Control any number of bare-metal servers or VPS instances from a single, centralized dashboard.

### What MSM is not
- **Not a Hosting Provider:** You bring your own Linux servers (e.g., Hetzner, OVH, netcup, or your local homelab).
- **Not a Windows Application:** Both the panel and node agents run exclusively on Linux.
- **Not completely rootless during setup:** The bootstrap script requires root rights once during initial installation. Afterwards, the panel daemon and all service containers run entirely rootless.

---

## What MSM Can Do

### 1. Multi-Node by Design
One panel manages unlimited nodes. New nodes join through a secure enrollment protocol (mTLS backed by HMAC challenge verification) and require explicit administrator approval.

### 2. Autonomous Guardian Engine
Every node runs the Guardian Engine to supervise local containers. It continuously evaluates container health, HTTP/TCP probes, and log patterns. If a service becomes unresponsive, Guardian initiates local recovery procedures or quarantines the container—even during panel or network outages. All incident logs synchronize once the panel reconnects.

### 3. Declarative Blueprints
Services are defined via structured blueprints (YAML or JSON), declaring container images, ports, environment variables, persistent volumes, config templates, and Guardian check routines. This allows MSM to manage any containerized workload, not just game servers.

### 4. Built-in Steam Workshop
For supported games, nodes handle Steam Workshop mods natively through SteamCMD, keeping files updated and mapped directly into containers.

### 5. Rootless Container Security
All service containers run inside the rootless Docker namespace of the dedicated unprivileged user `msm` (`unix:///run/user/<uid>/docker.sock`). The panel process does not belong to the host `docker` group. All game server ports operate above 1024, eliminating the need for elevated rights or `setcap` binaries.

### 6. Zero-Knowledge Backups (DIS)
Backups for servers and databases are encrypted client-side prior to leaving your infrastructure (AES-256-GCM, key derivation via Argon2id) before transmission to S3-compatible object storage. Encryption keys and S3 credentials are never stored in plaintext.

### 7. Component Migration Wizard
Using `migrate-panel-components.sh`, you can relocate the panel, web frontend, or individual server workloads to another node. Migrations run transactionally, featuring automated rollbacks should any step fail.

### 8. Optional Hoster & Store Integration
External store systems can automate server provisioning, suspensions, and terminations through a standardized API. Requests are idempotent to prevent duplicate processing. Customers can access their provisioned servers via signed single-sign-on (SSO) links without secondary credentials. **Unless configured, this subsystem remains dormant.** See [`docs/self-hosting.md`](docs/self-hosting.md#hoster--und-shop-anbindung-optional-phase-6) and [`docs/hoster-api.md`](docs/hoster-api.md).

### 9. Voice & AI Interaction (Optional)
Supports standard voice pipelines (transcription, chat models, Pipecat, ElevenLabs) as well as direct low-latency OpenAI Realtime integration over WebRTC between browser/desktop clients and endpoints. The backend maintains strict enforcement of tool execution permissions, Guardian actions, and quotas. API keys never reach the client. See [`docs/self-hosting.md`](docs/self-hosting.md#sprachmodus-mit-der-ki-reden).

### 10. Centralized Secrets Management
GitHub tokens and Steam account credentials can be stored centrally at panel scope, user scope, or per server instance. Servers reference credential aliases rather than copying raw secrets. Once saved, secrets cannot be retrieved in plaintext.

### 11. AI Assistant, Search & Organization
The AI assistant operates against a defined tool registry verified by the backend. Subject to your permissions, it can review server telemetry, parse logs, inspect backups, manage reminders, and structure maintenance workflows. Sensitive modifications always require explicit user confirmation.

**Maunting Search** integrates a private research interface powered by your server's local SearXNG instance (AGPLv3), complete with AI overviews, citations, and Wikipedia panels. For geographic inquiries, it pulls coordinates, weather reports, and optional Sentinel-2 satellite imagery (via Copernicus). For architecture details, review [`docs/ai-system-architecture.md`](docs/ai-system-architecture.md).

### 12. Integrated PostgreSQL Studio
Manage panel and application databases directly inside the browser: edit table structures, import/export datasets, manage indexes, execute raw queries, and handle dump restorations. Custom SQL commands execute under their respective database user privileges, never as superuser. See [`docs/self-hosting.md`](docs/self-hosting.md#postgresql-datenbanken-und-das-studio).

---

## Maunting Pontis (Desktop Browser)

This repository includes **Maunting Pontis**, a privacy-focused desktop application built with Tauri v2 and Rust. It operates standalone or connects directly with your MSM panel ecosystem.

![Maunting Pontis Browser](docs/images/maunting-pontis.png)
*Maunting Pontis: In-memory Bergamot translation, strict process isolation, and direct cluster integration.*

- **Strict Tab Isolation:** Sandboxed execution without direct host filesystem access.
- **Local AI Tools:** In-memory client translation via Bergamot (WASM) and offline Whisper speech processing.
- **Optimized Performance:** Fast execution profiles with minimal baseline RAM overhead (800–1,200 MB).
- **MSM Link:** Direct status streaming and encrypted vault integration.

---

## MSM Compared

| Feature | MSM | Pelican Panel | Classical Panels (Pterodactyl v1, AMP) |
|---|---|---|---|
| **Architecture** | Single panel, unlimited nodes | Panel and node daemon (Wings) | Monolithic application or panel + daemon |
| **Container Security** | **Rootless Docker** per node user | Root Docker daemon | Root Docker daemon |
| **Self-Healing** | **Yes (Guardian)**: Independent local checks & repairs during network partition | **No**: Dependent on continuous panel connection | **No**: Daemon processes passive commands only |
| **Workload Definition** | **Blueprints (YAML/JSON)** for games, services, databases | Eggs (JSON format) | Eggs or vendor-locked modules |
| **Steam Workshop** | **Native**: SteamCMD downloads & updates managed automatically | **Partial**: Via community eggs or scripts | **Partial**: Via community addons or manual steps |
| **Backup Encryption** | **Yes, client-side** (AES-256-GCM, Argon2id) | Plaintext or server-side S3 encryption | Plaintext, local or S3 |
| **Migration Tooling** | **Interactive wizard** for panel, frontends, and servers | Manual CLI procedures | Manual SSH dumps and transfers |
| **Installation & TLS** | Single command, automated HTTPS via Caddy, PostgreSQL included | Multi-step installer or compose | Manual web server and database configuration |

---

## System Requirements

### Prerequisites
1. **Root SSH access** on target Linux machines for initial deployment.
2. **A configured domain or subdomain** (e.g., `panel.example.com`) pointing to your server's public IP address for automated HTTPS certificates.
3. **Hardware capacity** according to workload plans (specifications below cover the management panel; game instances need additional capacity).

### Hardware Requirements for the Panel

| Resource | Minimum | Recommended |
|---|---|---|
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 15 GB SSD | 40 GB SSD |

**Memory Allocation Breakdown:**

| Component | RAM Footprint |
|---|---|
| Backend idle state | ~0.25 GB |
| Backend with active AI context model | ~1.3 GB (peaks at ~1.7 GB during model loading) |
| Encryption service (DIS) | ~0.18 GB (+128 MB per active concurrent session) |
| Database (PostgreSQL baseline) | ~0.06 GB |
| Frontend compilation during upgrades | Up to 1.1 GB (transient; panel stays offline during build) |

Base distributions, Caddy, Redis, and the local agent require standard overhead. With 2 GB RAM, the panel runs only if AI features remain disabled and Swap memory is provisioned. The 8 GB recommendation accommodates LiveKit calls, local SearXNG search, concurrent operators, and database growth.

**Storage & CPU Footprint:** The Python environment uses ~0.7 GB, embedded AI models ~0.5 GB, and frontend build tooling ~0.3 GB, alongside container layers. The updater (`update.sh`) creates snapshots in `/opt/msm/backups` before performing migrations—regularly verify this directory if running daily builds. Backend idle CPU usage averages around 1.5% of one core.

### Supported Operating Systems

MSM requires a modern Linux environment utilizing systemd and Docker.

| Operating System | Support Tier | Notes |
|---|---|---|
| **Ubuntu 24.04 LTS** | 🟢 **Supported** | Primary reference and development target |
| **Ubuntu 22.04 LTS** | 🟡 **Untested** | Expected to work; feedback welcome |
| **Debian 12 (Bookworm)** | 🟡 **Untested** | Expected to work; feedback welcome |
| **Debian 11 (Bullseye)** | 🟡 **Untested** | Untested baseline |
| **AlmaLinux 9 / Rocky Linux 9** | 🔴 **Unsupported** | RHEL-based environment differences |
| **Fedora Server (40+)** | 🔴 **Unsupported** | Package and service mismatch |
| **Arch Linux** | 🔴 **Unsupported** | Rolling-release variance |
| **Alpine Linux** | 🔴 **Unsupported** | Uses OpenRC and musl libc instead of systemd/glibc |
| **Windows / Windows Server** | 🔴 **Unsupported** | Requires native Linux kernel and systemd subsystem |

---

## Installation

### Single-Command Bootstrap

Connect to your target machine over SSH:

```bash
ssh root@YOUR_SERVER_IP
```

Run the bootstrap command:

```bash
curl -fsSL https://raw.githubusercontent.com/mauntingstudios/maunting-service-manager/main/scripts/bootstrap.sh | sudo bash -s -- --domain panel.example.com
```

*Replace `panel.example.com` with your designated DNS hostname.*

The bootstrap installer automates:
- PostgreSQL database setup and Redis caching services
- Rootless Docker setup for the dedicated `msm` system account
- The Data Isolation & Security service (DIS)
- LiveKit sidecar for audio and video messenger calls
- Local Node Agent and Guardian monitoring daemon
- Caddy reverse proxy with automated Let's Encrypt TLS provisioning
- Systemd service configurations and automated update timers

### Post-Installation Steps

1. Navigate to your domain in your web browser (`https://panel.example.com`).
2. Complete the initial onboarding assistant.
3. Configure your primary Administrator (Owner) account.
4. Deploy your first server instance or enroll additional remote nodes.

---

## How Everything Connects

```text
┌─────────────────────────────────────────┐
│  Browser / Client (HTTPS)               │
│  → panel.example.com                    │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│  Caddy Reverse-Proxy (Auto TLS)         │
│  → Port 80 / 443                        │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│  FastAPI Backend (Python)               │
│  → Port 8000 (Localhost)                │
│  → PostgreSQL (Loopback) / Redis        │
│  → DIS Sidecar (@msdis/shield)          │
│  → LiveKit Sidecar (/livekit)           │
└────────────┬────────────────────────────┘
             │ (mTLS / HMAC Enrollment)
┌────────────▼────────────────────────────┐
│  Node Agent + Guardian Engine           │
│  → Rootless Docker Socket               │
│  → Autonomous Monitoring & Recovery     │
│  → Isolated per-server container user   │
└─────────────────────────────────────────┘
```

---

## Security Model

- **Automated TLS:** End-to-end HTTPS certificates via Caddy and Let's Encrypt.
- **Firewall Integration:** UFW rules default to SSH (22), Web (80/443), and provisioned game ports.
- **Intrusion Prevention:** Fail2ban protection for SSH and authentication endpoints.
- **Token Lifecycle:** Short-lived access tokens (15 minutes) paired with 30-day refresh cycles.
- **Multi-Factor Auth:** Time-based One-Time Password (TOTP) enforcement with one-time backup recovery codes.
- **Container Sandbox:** Full rootless Docker operation; limits enforced for CPU, memory, and storage per container.

---

## Maintenance & Updates

### Manual Upgrades

```bash
sudo bash /opt/msm/update.sh
```

The update pipeline backs up databases before applying structural migrations, sets temporary maintenance status, and validates system operations. Running game instances remain active and uninterrupted during panel updates.

Encrypted vault files reside under `/opt/msm/vault-blobs` and are not included inside the database snapshot. Include this folder in your standard server backup policies (see [`docs/self-hosting.md`](docs/self-hosting.md#tresor-cloud-dateien-im-tresor)).

### Automatic Upgrades (Optional)

Configure `/opt/msm/backend/.env`:

```env
MSM_AUTO_UPDATE=true
```

Then activate the systemd timer:

```bash
sudo systemctl enable --now msm-update.timer
```

---

## Essential Commands

| Command | Purpose |
|---|---|
| `sudo systemctl status msm-panel` | Check panel service status |
| `sudo systemctl restart msm-panel` | Restart the panel service |
| `sudo journalctl -u msm-panel -f` | Tail panel application logs |
| `sudo bash /opt/msm/update.sh --check-only` | Query upstream for new releases |
| `sudo /opt/msm/helper-scripts/migrate-panel-components.sh` | Launch interactive migration assistant |

---

## Default Network Ports

| Port | Protocol | Purpose |
|---|---|---|
| 80 | TCP | HTTP to HTTPS redirection |
| 443 | TCP | Web panel dashboard and API |
| 27015–27999 | UDP/TCP | Dynamically allocated game server traffic (above port 1024) |

---

## Community & Support

- **Documentation:** Review comprehensive guides in [`docs/self-hosting.md`](docs/self-hosting.md) and inside the panel under **Documentation**.
- **Issue Tracker:** Report issues or submit enhancements on [GitHub Issues](https://github.com/mauntingstudios/maunting-service-manager/issues).

---

## Discord Rich Presence (Optional)

The desktop client (*Maunting Smart System*, MSS) can broadcast your activity via Discord Rich Presence over local IPC pipes.

- **Privacy Preserved:** The client connects solely to the local Windows named pipe (`\\.\pipe\discord-ipc-0`). No cluster keys, private endpoints, or user chats are transmitted to external services.
- **Configuration:** Adjust parameters in `konfig.json`:
  ```json
  {
    "discord_rpc_aktiv": true,
    "discord_client_id": "YOUR_APPLICATION_ID",
    "discord_details": "Custom status line 1",
    "discord_state": "Custom status line 2"
  }
  ```
- **Disable:** Set `"discord_rpc_aktiv": false` in `konfig.json`.

---

## License

MSM is licensed under the [MIT License](LICENSE).