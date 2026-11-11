<div align="center">

# Maunting Service Manager (MSM)

**A modern, self-hosted management panel for game servers, applications, and Linux services.**  
Autonomous monitoring with the Guardian Engine, rootless container security, encrypted backup uploads, and AI-assisted operations.

[![Status](https://img.shields.io/badge/Status-Active%20Development-orange)](https://github.com/mauntingstudios/maunting-service-manager)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

[Quick Start](#installation) • [Key Features](#what-msm-can-do) • [Feature Reference](docs/features.md) • [Comparison](#msm-compared) • [Architecture](#how-everything-connects) • [Documentation](docs/self-hosting.md)

<br />

![MSM dashboard showing running game servers, node capacity, and system health](docs/images/dashboard.png)
*Unified Dashboard: Monitor game servers, node capacities, and system health in real-time.*

![AI assistant answering server management questions with tool calls and data tables](docs/images/ki-assistent.png)
*AI Assistant: Inspects service states, logs, and disk utilization autonomously to provide actionable insights.*

<sub>Images display sample demonstration data.</sub>

</div>

---

> [!IMPORTANT]
> MSM is actively under development. Please avoid running it in mission-critical environments without performing regular, verified backups. Development started in May 2026; the current release is v5.9.1.

> [!NOTE]
> 🧪 **Experimental Feature: Kubernetes**  
> Under `deploy/kubernetes/`, you will find experimental manifests for running the panel. This setup has not yet undergone full production validation by the core team. If you are experienced with Kubernetes, feel free to test it and share your feedback or pull requests!

---

## What is MSM?

MSM separates two primary components: the **Panel**, which you operate via modern web browsers, and the **Nodes**, the physical or virtual machines where your games and services actually run. Every service operates in isolated Docker containers strictly without root privileges.

The Documents module uses a dedicated collaboration sidecar. Production installs keep it to one process and store its startup lock under `$MSM_DIR/data/docs-sidecar`; see the [self-hosting guide](docs/self-hosting.md) for deployment details.

### What you can use MSM for
- **Game Servers:** Create, start, stop, and restart instances. MSM handles port allocations automatically. Native support includes Conan Exiles, DayZ, Minecraft, ARK, and more.
- **Linux Applications:** Deploy databases, web applications, and background workers using blueprint templates.
- **Multi-Server Management:** Control any number of bare-metal servers or VPS instances from a single, centralized dashboard.

### What MSM is not
- **Not a hosting service:** MSM is self-hosted. You bring the Linux hosts (Hetzner, OVH, netcup or a homelab). A hoster API exists for providers who want to automate provisioning, but it stays dormant unless configured.
- **Not a Windows server product:** The panel and the node agents run on Linux. The desktop application MSS runs on Windows and Android and connects to the same panel.
- **Not rootless during setup:** The bootstrap script needs root once. Afterwards the panel daemon, the agent and every service container run unprivileged.

---

## What MSM Can Do

The list below is an overview. Every capability with its backend routes, security boundaries and limits is documented in the [Feature Reference](docs/features.md).

### Run game servers and applications
- Create servers from 32 native blueprints (18 Steam games, 10 non-Steam games, backends, databases, a static frontend) plus one community example; resource limits, bind IP and ports are handled by the panel.
- Start, stop, restart and kill. Automatic restarts on an interval or at a fixed time, scheduled from the last successful run so intervals do not drift.
- Live console with stdin input and an optional `exec` inside the container; file manager with editor, version history, content search and chunked uploads.
- Backups with per-blueprint paths, retention, restore, scheduling and optional S3 upload.
- Webhooks, metrics, incident log and a change timeline.

### Mods, databases and files
- Steam Workshop through SteamCMD, CurseForge mods and modpacks, load order, enable/disable, update checks and cleanup of aborted installs. Modrinth is not integrated.
- Managed PostgreSQL databases plus an in-house PostgreSQL Studio (structure, data, SQL, dump/restore, monitoring) and a SQLite Studio for database files inside a server.

### Multi-node
- One panel, any number of nodes. A node joins with a short-lived command, mutual TLS with certificate pinning and explicit approval.
- Capacity-aware placement, migration of a server to another node, automatic firewall rules for declared ports.

### Identity, permissions and audit
- 91 permission keys, Discord-style roles, server grants, teams with their own roles, shared AI knowledge and a team vault.
- Audit log with export and read access for the AI, limited by the caller's permissions.
- Optional hoster/shop API with idempotent provisioning and signed SSO handoffs.

### AI (Singra)
- Six provider adapters, five cost roles and per-role daily, weekly and monthly token limits.
- 125 backend tools for servers, files, backups, databases, DNS, documents, audit, users and more. Writes become confirmation cards unless autonomy was granted for that exact tool.
- Memory with local embeddings and encrypted storage, web search through SearXNG or Brave with citations, a classic voice pipeline and OpenAI Realtime, MCP at global, team and user scope, background workers and a coding sandbox.

### Messenger
- Direct chats, groups, stories, attachments, voice and video notes, stickers, reactions, edits, deletions, pins, disappearing messages and calls over LiveKit.
- End-to-end encrypted with a double ratchet per device. The server stores ciphertext; a new device receives history only after the security number is compared.

### Vault
- Zero-knowledge storage for passwords, TOTP codes, notes, files and photos, with a gallery, folders, trash and archive, import/export and a breach check.
- Team vault with per-member wrapped keys, Windows Hello and passkey unlock, QR device approval, and an Android camera backup with a post-quantum hybrid envelope.

### Productivity
- End-to-end encrypted calendar (series, CalDAV, ICS, reminders) and notes with a per-account key shared by signed device records.
- A document editor with realtime collaboration, comments, revisions, sharing links, assets and offline editing.

### Clients
- **Maunting Pontis**, a Tauri browser for Windows and Android: isolated tabs, adblock with EasyList and EasyPrivacy, cookie-banner rejection, youth protection with self-binding, quarantined downloads, vault autofill, local Bergamot translation, reader mode and devtools.
- **MSS**, the Windows and Android desktop app: pairing instead of a password, tray, global hotkeys, wake word, overlay, screenshot, computer use only after local approval, sandboxed file jobs, reminders and Velopack updates.
- **Recovery**, a small app that decrypts a backup offline when the panel is gone.

### Security and operations
- Rootless Docker with `cap_drop=ALL` and `no-new-privileges`; the panel never joins the host `docker` group.
- User content in the database is encrypted through DIS. Backups are encrypted on S3 upload, and locally when a backup password is set.
- Single-command installation with checksum verification, automated HTTPS, PostgreSQL included, and a transactional migration wizard for components.

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

| Feature | MSM | Pelican Panel | Pterodactyl v1 / AMP |
|---|---|---|---|
| **Licence** | AGPL-3.0 | AGPL-3.0 | MIT / commercial |
| **Architecture** | Panel plus own agent per node | Panel, Wings, Eggs and Yolks | Panel and Wings (Pterodactyl); ADS and instance manager (AMP) |
| **Container isolation** | Rootless Docker, `cap_drop=ALL`, `no-new-privileges` | Docker container per instance | Docker container per instance (Pterodactyl); Docker optional (AMP). Not verified as rootless. |
| **Local self-healing** | Guardian runs on each node and repairs within blueprint policies | Not documented | Not documented |
| **Workload definition** | Data-only blueprints, 32 native | Eggs and Yolks | Eggs / vendor modules |
| **Steam Workshop** | Native through SteamCMD | Not verified as built-in | Not verified as built-in |
| **Backup encryption** | Local `tar.gz`, or `.enc` when a backup password is set; S3 upload encrypted through DIS (AES-256-GCM, Argon2id) | Not verified | Not verified |
| **Migration tooling** | Transactional wizard with rollback | Manual procedures | Manual procedures |
| **Installation and TLS** | One command with checksum verification, Caddy HTTPS, PostgreSQL included | Multi-step installer | Varies by setup |

The comparison reflects the official documentation of each project as retrieved on 11 November 2026: full table, sources and open questions are in the [Feature Reference](docs/features.md#21-comparison-with-other-open-source-projects). "Not verified" means the project documentation checked for this table did not answer the question, not that the feature is absent.

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
- PostgreSQL database setup and optional Redis for rate limiting
- Rootless Docker setup for the dedicated `msm` system account
- The Data Isolation & Security service (DIS)
- Docs sidecar for realtime document collaboration (`/api/docs/collab`)
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
│  → Docs Sidecar (/api/docs/collab)      │
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

## Local Development Stack

```bash
bash dev-up.sh -d   # start backend, docs sidecar and dependencies
```

The dev stack (`docker-compose.dev.yml`) requires real secrets and ships no
defaults: on first start, `dev-up.sh` (like `install.sh`/`update.sh`)
generates `MSM_DOCS_SIDECAR_TOKEN`, `MSM_DOCS_COLLAB_SECRET` and
`MSM_DOCS_SIGNING_SECRET` into `.env.dev` (mode `600`). Existing keys are
never overwritten. Without them, Compose aborts with a `:?` error naming
the missing variable.

Rotation: delete the lines from `.env.dev` and restart the stack. Backend
and sidecar share `SIDECAR_TOKEN` and `COLLAB_SECRET`; rotating
`SIGNING_SECRET` invalidates old signed asset URLs.

---
## Community & Support

- **Documentation:** Review the [Feature Reference](docs/features.md) for every capability with its implementation, the comprehensive guides in [`docs/self-hosting.md`](docs/self-hosting.md), and the built-in documentation under **Documentation** in the panel.
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

Maunting Service Manager (MSM) is free and open-source software licensed under the **[GNU Affero General Public License v3 (AGPL-3.0)](LICENSE)**.

### Summary of Terms:
- **Free to Use & Self-Host:** You can run, deploy, and self-host MSM for personal, community, or commercial hosting operations.
- **Commercial Use Allowed:** You are permitted to use MSM to operate commercial server hosting infrastructure and earn revenue.
- **Strong Copyleft (Network / SaaS Clause):** If you modify MSM or create a derivative work and make it available over a network (e.g., offering a hosted service to users), you **must make the complete corresponding source code of your modified version publicly available under the AGPL-3.0**. Closed-source proprietary forks are prohibited.
- **Authorship & Ownership:** The original copyright, ownership, and authorship remain with **Maunting Studios**. Copyright and attribution notices must be preserved in all source code distributions and user interfaces.
- **Trademarks & Branding:** The names "Maunting Studios", "Maunting Service Manager", "MSM", and "Maunting Pontis", along with associated logos, are protected trademarks and brand assets of Maunting Studios and are not licensed for unauthorized branding or misleading re-use.