# MSM Feature Reference

Status: 11 November 2026, repository commit `34213740`, release tag `v5.9.1`.

This document describes what Maunting Service Manager (MSM) can do and how each part is
implemented. Every behavioural statement was checked against the source files named in the same
section. Comments, docstrings, patch notes and older documents were used only as pointers to
the code, never as evidence. Where code and prose disagree, the code wins; the disagreement is
listed in chapter 22.

Numbers in this document are reproducible. The counting method is given in chapter 23.

## Contents

1. [What MSM is and where it stands](#1-what-msm-is-and-where-it-stands)
2. [Installation, update and migration](#2-installation-update-and-migration)
3. [Creating and running servers](#3-creating-and-running-servers)
4. [Server detail tabs](#4-server-detail-tabs)
5. [Blueprints](#5-blueprints)
6. [Mod manager](#6-mod-manager)
7. [File manager and database studios](#7-file-manager-and-database-studios)
8. [Backups](#8-backups)
9. [Multi-node operation](#9-multi-node-operation)
10. [Permissions and organisation](#10-permissions-and-organisation)
11. [Accounts and security](#11-accounts-and-security)
12. [Settings: all 17 tabs](#12-settings-all-17-tabs)
13. [AI: Singra](#13-ai-singra)
14. [Messenger](#14-messenger)
15. [Calendar and notes](#15-calendar-and-notes)
16. [Documents](#16-documents)
17. [Vault](#17-vault)
18. [Pontis browser](#18-pontis-browser)
19. [MSS desktop app and Recovery](#19-mss-desktop-app-and-recovery)
20. [Design system and quality bar](#20-design-system-and-quality-bar)
21. [Comparison with other open source projects](#21-comparison-with-other-open-source-projects)
22. [Gaps and contradictions](#22-gaps-and-contradictions)
23. [Appendix: numbers, glossary, file map](#23-appendix-numbers-glossary-file-map)

## 1. What MSM is and where it stands

MSM is a self-hosted management panel for game servers, containers, databases and Linux
services. It has two halves: the **panel**, a FastAPI application plus a React frontend, and one
or more **nodes**, each running `msm-agent` on a Linux host. Workloads run as Docker containers
inside the rootless Docker daemon of an unprivileged user, not on the host directly.

### 1.1 Timeline and size

| Fact | Value | Evidence |
|---|---|---|
| First commit | 2026-05-19, "Initial import: Conan Exiles Panel" | `git log --reverse` |
| Commits | 2481 | `git rev-list --count HEAD` |
| Release tags | `v0.9.0` through `v5.9.1` | `git tag --sort=creatordate` |
| Current release | `v5.9.1` | `git describe --tags --abbrev=0` |
| Router modules | 57, plus 12 social routers | `ls backend/routers`, `backend/routers/social` |
| HTTP route decorators | 740 | `grep -rhoE '@router\.(get\|post\|put\|patch\|delete\|websocket)\('` |
| Service modules | 235 | `ls backend/services/*.py` |
| Database tables | 131 | unique `__tablename__` values in `backend/models` |
| Permission keys | 91 | unique `PermissionDef("…")` in `backend/services/permission_catalog.py` |
| AI tools | 125 | asserted in `backend/tests/test_ai_tool_drift.py` |
| Blueprints | 32 native + 1 community | `backend/blueprints/native/*.blueprint.json`, `blueprints/community/` |
| AI skill files | 9 | `backend/ai_skills/*.md` |
| Backend tests | 460 files, 6592 test functions | `find backend/tests -name 'test_*.py'` |
| Frontend tests | 544 files, 4531 cases | `find frontend/src -name '*.test.ts[x]'` |
| Rust test markers | 425 | `#[test]` and `#[tokio::test]` in the three Tauri crates |

The project started in May 2026 as a panel for one game. The current tree contains more than
game hosting: identity and permissions, a PostgreSQL studio, an AI agent, an end-to-end
encrypted messenger, a zero-knowledge vault, a document editor, a browser and a desktop app.
This breadth is why the document is long.

### 1.2 Security model in one paragraph

Service containers are created with `cap_drop=ALL` and `security_opt=["no-new-privileges"]`
(`backend/services/docker_service.py:935`, `msm-agent/services/docker_service.py:297`). The
Docker socket is the rootless socket of the service user, for example
`/run/user/<uid>/docker.sock` (`docker_service.py:139`), not `/var/run/docker.sock`. The panel
process runs as user `msm` with `ProtectSystem=strict` and a short list of writable paths
(`msm.service.template`). Authorisation is decided in the backend, never in the frontend. The
frontend may hide a control, but the route checks again.

### 1.3 What MSM is not

- Not a hosting provider. You bring the Linux hosts. The optional hoster API (chapter 10) exists
  for providers who want to automate provisioning, but it is dormant unless configured.
- Not a Linux-only product on the client side. Panel and node agents run on Linux; the desktop
  application MSS runs on Windows and Android and renders the panel UI natively.
- Not rootless during the one-time installation. `install.sh` needs root once. After that, the
  panel daemon, the agent and every service container run unprivileged.

## 2. Installation, update and migration

### 2.1 Bootstrap

`scripts/bootstrap.sh` resolves the latest release, downloads `SHA256SUMS` and the panel
archive, and verifies the archive against that checksum before it executes
`install.sh --simple --domain <domain>` (`scripts/bootstrap.sh:78-116`).

`install.sh` accepts `--simple`, `--domain` and `--resume-partial`. It refuses to continue when
a PostgreSQL role or database named `msm` already exists, unless the previous run is provably
an aborted first installation (`install.sh:1115`). That guard exists so a second run cannot
overwrite a live installation.

**What it sets up:** PostgreSQL, rootless Docker for the service user, the DIS sidecar, the
agent, Caddy for TLS and the systemd units. **Limit:** the bootstrap expects a domain that
resolves to the host; the simple path requires `--domain` (`install.sh:994`).

### 2.2 Updates

`update.sh` is the update path on a node. It runs `git pull --ff-only` on the current branch
(`update.sh:428`), repairs ownership after the root pull, reinstalls dependencies, and restarts
the panel and sidecars (`update.sh:158-160`). `--check-only` reports without changing anything
(`update.sh:168`). `msm-update.timer` schedules the check daily.

**Limit:** a failed run leaves the previous services running. The script does not claim success
before the services answer; a restart that fails is reported.

### 2.3 systemd and TLS

`msm.service.template` runs the panel as `User=msm` with `ProtectSystem=strict`,
`ReadWritePaths={{MSM_DIR}}` plus explicit UFW paths (`msm.service.template:9-35`). Caddy
terminates TLS; `Caddyfile.template` carries security headers, the API proxy, the document
collaboration endpoint and the LiveKit proxy.

**Limit:** `NoNewPrivileges` is deliberately not enabled, because firewall management uses
narrow sudo gates (comment in `msm.service.template:24`). This is a documented trade-off, not
an oversight.

### 2.4 Sidecars

| Sidecar | Purpose | Binding |
|---|---|---|
| `dis-sidecar` | Encryption service for `DisText`, ALTCHA, backup streaming | local HTTP |
| `docs-sidecar` | Yjs/Hocuspocus collaboration and rendering | ports 8100 and 8101 (`docs-sidecar/Dockerfile.dev:20`) |
| `searxng-sidecar` | Meta search for Maunting Search and AI web search | `127.0.0.1:8888` (`searxng-sidecar/docker-compose.yml:7`) |
| `wetter-sidecar` | Local weather data | local |
| `livekit-sidecar` | Calls | 7880 TCP local, 7881 TCP public, 7882 UDP public (`livekit-sidecar/README.md:27-29`) |

LiveKit needs the public media ports because WebRTC media does not pass through Caddy. The
signalling socket stays local and is published as `wss://<domain>/livekit`.

### 2.5 PostgreSQL only

The backend refuses SQLite, including with `MSM_TESTING`
(`backend/database_policy.py`). Tests require `MSM_TEST_DATABASE_URL`; `scripts/test-postgres.sh`
starts a disposable PostgreSQL container. The reason is behavioural: SQLite does not enforce
the length limits, boolean types and migration behaviour that production relies on.

### 2.6 Panel backup and component migration

`panel_backups.py` and `panel_backup_service.py` create a panel-level backup: database dump,
configuration and a manifest. Three tables go into the dump without rows
(`PANEL_BACKUP_OHNE_DATEN`): `chat_media`, `device_pairings` and `login_challenges`. Their
schema stays so a restore works, but old ciphertext blobs, open pairing codes and expired login
challenges do not come back.

`helper-scripts/migrate-panel-components.sh` moves components between hosts: frontend, individual
game servers, or the control plane. It supports a dry run and an atomic cutover with rollback.
The migration is not a copy-and-hope script; it stops workloads, dumps databases and verifies
before switching.

### 2.7 Kubernetes

`deploy/kubernetes/` contains manifests for the control plane only. Game servers remain Docker
workloads on nodes. The deployment is marked experimental and runs one replica; the DIS sidecar
must run in the same pod. Chapter 22 repeats this limitation.

## 3. Creating and running servers

### 3.1 Creating a server

A server is created from a blueprint. The request names the blueprint, the node, resource
limits, the bind IP and the ports. `server_provisioning_service.py` creates the container,
materialises the directories declared by the blueprint, writes seed files and applies config
patches. If a step fails, the service rolls back what it created instead of leaving a half
server behind.

**How it works:** `routers/servers.py` exposes create, start, stop, restart, kill, install,
unlock, switch-blueprint, console and exec. The heavy work sits in
`server_lifecycle_service.py` and `server_provisioning_service.py`. Operations that outlive one
HTTP request become persistent tasks (`routers/tasks.py`), so the UI can show progress instead of
a spinner that lies.

### 3.2 Start, stop, restart, kill

Lifecycle actions are queued per server (`queue_lifecycle_operation`) rather than fired in
parallel. The queue matters: two simultaneous "start" calls would otherwise create two
containers or leave the port allocator inconsistent.

### 3.3 Automatic restarts

Automatic restarts are a per-server setting with two modes:

- **Interval:** restart every N hours. The next run is scheduled from the successful completion
  of the previous one, not from creation time, so an interval of eight hours does not drift
  towards 4 a.m. (`scheduler_service.py:174-181`).
- **Cron:** restart at a fixed `HH:MM` (`scheduler_service.py:240-273`).

The scheduler is APScheduler, started with the panel. Jobs carry deterministic ids
(`restart_server_<id>`, `restart_cron_server_<id>_<time>`) and are removed before re-adding, so
editing a schedule replaces it instead of stacking duplicates (`scheduler_service.py:103`).

### 3.4 Restarts from the AI

The AI does not flip a database flag directly. It creates a proposal card with the intended
change, and the user confirms it (`backend/services/ai_proposals/server_proposals.py`). The
proposal service validates the target server and the caller's permission, writes the change
through the same service the UI uses, and records the result in the audit log.

**Limit:** proposals that change power state or schedules belong to the write class and require
confirmation unless the server is in an autonomy grant that allows that tool (chapter 13).

### 3.5 Guardian restart

A separate watchdog restarts a server when the container disappeared and the expected state is
still "running". The conditions in `guardian_restart_service.py` are deliberately narrow:

- observed state is exactly `stopped`; `unhealthy` is left to the agent's recovery ladder,
- the desired generation equals the accepted generation, so a fresh intent is not raced,
- desired power state is `running`,
- `auto_restart` is enabled on the server,
- at most one attempt every 300 seconds (`_AUTO_RESTART_COOLDOWN_SECONDS`).

If any condition is missing, Guardian does not restart. A crashing server therefore does not
turn into a restart loop that hides the crash.

### 3.6 Console and exec

The console has two paths with different risk profiles:

- **STDIN console:** writes a line to the container's standard input, as if typed in the game
  console. It cannot run a host command.
- **argv exec:** runs a command inside the container (`exec`), only when the blueprint sets
  `enableExec` and the user holds the matching permission.

The UI shows a live stream over WebSocket, with search and copy. Exec is not a shell on the node;
it is limited to the container and its timeout (`execTimeoutSeconds` in the blueprint).

### 3.7 Metrics and incidents

`routers/metrics.py` exposes panel metrics. Per-server CPU, memory and disk come from Docker
statistics through the node client. Incidents (`routers/incidents.py`) record problems with a
timeline; `change_timeline.py` records changes that affected a server. Both are readable in the
panel and through AI tools with the caller's permissions.

## 4. Server detail tabs

The server page builds its tab strip from the blueprint and the caller's permissions. Verified
keys in `frontend/src/pages/ServerDetail.tsx` are files, console, exec, mods, restarts, backups,
databases, webhooks, memory and guardian. `exec` appears only when the blueprint allows it,
mods only for mod-capable blueprints, databases only when the server has them.

| Tab | What the user can do | Backend |
|---|---|---|
| Files | Browse, edit, upload, rename, move, delete, extract archives, search by name and content | `routers/files.py` |
| Console | Read output, send stdin | `routers/servers.py` |
| Exec | Run a command inside the container when enabled | `routers/servers.py` |
| Mods | Install, update, enable, disable, reorder, abort | `routers/mods.py` |
| Restarts | Configure auto restart, interval or cron | `services/scheduler_service.py` |
| Backups | Create, restore, delete, schedule, upload to S3 | `routers/backups.py`, `backup_orchestrator.py` |
| Databases | Create and manage databases attached to the server | `routers/databases.py` |
| Webhooks | Configure outgoing notifications for server events | `routers/webhooks_outbound.py` |
| Knowledge | Curated facts the AI may use for this server | `routers/ai_memory.py`, `ai_memory_service.py` |
| Autopilot | Guardian actions and automatic repairs | `routers/guardian.py`, `ai_guardian_*` |

### 4.1 Knowledge tab

Knowledge entries are stored like other AI memories: encrypted at rest, with a blind index for
lookup. The tab is not a wiki for humans only; it feeds the AI context for that server, which is
why it sits next to the server and not in a global notebook.

### 4.2 Autopilot tab

Autopilot shows what Guardian observed and what it did: probes, recovery attempts, quarantine
state and overrides. Actions are recorded; clearing a quarantine or overriding a decision is a
separate permission (`routers/guardian.py`).

**Limit:** Autopilot is not a general-purpose script runner. It repairs within the policies the
blueprint declares; anything outside them becomes an incident, not an improvised command.

## 5. Blueprints

A blueprint is the declarative contract between the panel and a workload. It describes the image,
the start command, ports, data paths, health checks and backup scope. MSM ships 32 native
blueprints plus one community example; 18 are Steam games, 10 are non-Steam games (eight
Minecraft variants, FiveM/RedM, Hytale), plus backends, a database and a static frontend.

### 5.1 Schema

`backend/blueprints/schema.py` defines the accepted shape. The main sections:

| Section | Contents |
|---|---|
| `meta` | id, name, category, author, description |
| `runtime` | image, workdir, numeric non-root `user`, env, startup argv, startup profiles, directories, seed files, config patches, stop grace, startup check, exec switch |
| `ports` | named ports (game, query, rcon, voice, web, peer, database, custom) with TCP/UDP |
| `source` | how files arrive: Steam, HTTPS archive, GitHub, manual upload, docker-only |
| `mods` | workshop or CurseForge support, injection method, mod list target |
| `backup` | include paths as relative globs, exclusions |
| `health` | process, port, application and startup probes |
| `logs` | log sources and redaction rules |
| `diagnostics` | what to collect when something fails |
| `recovery` | policies for restart, quarantine and verification |

The schema is validated, not advisory. A blueprint with a Steam source but without
`source.steam` is rejected (`schema.py` validates the source union). A missing `backup` block
means a full backup; a present block restricts the backup to the listed paths.

### 5.2 Deliberate limits

Blueprints contain **no shell hooks and no Python hooks**. That is a design decision, not a
missing feature: a blueprint uploaded by a user must not be able to run arbitrary commands on the
node. Everything a blueprint needs is expressed as data (argv, env, seed files, config patches,
copy/symlink operations) and executed by code the operator controls.

**Limit:** because of that rule, a workload that needs a custom setup script cannot express it in
a blueprint. It becomes a container image concern instead.

### 5.3 Import and validation

`routers/blueprints.py` lists, shows, imports, replaces and deletes blueprints. Import validates
the JSON against the schema before it becomes selectable. The panel ships a builder UI
(`frontend/src/features/blueprints/BlueprintBuilder.tsx`) with a contract test.

### 5.4 Work in progress

The blueprint system is the core of the product and is still being extended. Chapter 22 lists the
open work instead of claiming completeness.

## 6. Mod manager

The mod manager installs three kinds of content: Steam Workshop items, CurseForge mods and
CurseForge modpacks. It keeps enough state to update, disable and reorder them without touching
the files manually.

### 6.1 What the user can do

| Action | Route |
|---|---|
| List mods for a server | `GET /mods/{server_id}` |
| Add a mod record | `POST /mods/{server_id}` |
| Check for updates | `POST /mods/{server_id}/check-updates` |
| Install or reinstall one mod | `POST /mods/{server_id}/{mod_id}/install` |
| Reinstall all | `POST /mods/{server_id}/reinstall-all` |
| Abort running installs | `POST /mods/{server_id}/abort-installs` |
| Enable, disable, edit | `PATCH /mods/{server_id}/{mod_id}` |
| Remove | `DELETE /mods/{server_id}/{mod_id}` |
| Change load order | `POST /mods/{server_id}/reorder` |

### 6.2 Steam Workshop

For blueprints with `source.type=steam` and workshop support, the node downloads the item with
SteamCMD. The blueprint then decides how the files reach the game: an additional start argument,
a copy or symlink into a target directory, or an entry in a mod list file or INI key. The
mod list content can be the workshop ids or the installed directory names
(`BlueprintModListContent`).

A **Steam Web API key** (settings, chapter 12) is used for update lookups. A **Steam account**
credential can be stored for titles that need an authenticated SteamCMD download, for example
DayZ. Credentials are stored centrally and referenced by alias; the server never receives a copy
of the secret in plaintext.

### 6.3 CurseForge

`routers/curseforge.py` and the CurseForge service search and resolve mods and modpacks with an
operator API key. The blueprint carries the game id and the class id; MSM does not hardcode
individual games. That matters because a new game must work without a code change.

### 6.4 State and updates

`backend/models/mod.py` stores dependencies, load order, auto-update, install status, progress,
ETA, error text and update status. Installation runs as a background task with a lock per server,
so two installs cannot write the same directory. A periodic update check runs every six hours in
the scheduler; a manual check is always available.

**Limit:** there is no Modrinth integration in the code. Older prose mentions it; chapter 22
records that as a documentation defect, not a feature.

## 7. File manager and database studios

### 7.1 File manager

`routers/files.py` serves the tree, reads and writes files, creates directories, renames, moves,
deletes, extracts archives and searches. Large uploads use a chunked path: initialise, upload
chunks, finalise. Text files keep a version history so an accidental overwrite can be inspected
and restored.

The editor (`FileEditorWorkspace.tsx`) autosaves, opens several files at once and shows a
conflict dialog when the file changed on disk while it was open. The workspace handles its
keyboard shortcuts at its root element, so Ctrl+S works when the focus is on a toolbar button,
not only inside the text area (`FileEditorWorkspace.a11y.test.tsx`).

**Limit:** file access is scoped to the server's data directory. Path traversal is rejected.

### 7.2 PostgreSQL Studio

The studio is an in-house build, not a wrapper around pgAdmin. `routers/postgres_studio.py`
exposes 27 routes: catalog, data grid, structure, SQL, explain, preview and execute, dump,
restore, monitoring and security. The DDL engine lives in `backend/services/postgres_ddl.py`.

Two properties make it usable for real work:

1. **Preview equals execution.** The same `compile_operation` builds the plan for the preview and
   for the real run, so the preview cannot promise something the execution does not do.
2. **Identity matters.** Operations run either as the database owner or as the admin identity
   (`identity: "owner" | "admin"`), and the required permission is
   `server.databases.admin` for sessions and locks. The studio never connects as a superuser.

`BLOCKED_PARAMETERS` and `BLOCKED_PARAMETER_PREFIXES` reject settings that would escalate or
break the instance. Free-form SQL expressions are compiled by one function that keeps them a
single statement; the engine does not concatenate user text into a script.

### 7.3 SQLite Studio

`routers/sqlite_studio.py` provides the same workflow for SQLite files inside a server:
inspect, overview, tables, rows, row insert/update/delete, arbitrary SQL and discovery of database
files. It is a separate implementation because SQLite has different types, locking and DDL, but
the user-facing model is the PostgreSQL studio: browse, edit, query.

**Limit:** the SQLite studio edits the file in the server's directory. It does not mount the file
into the panel process.

## 8. Backups

### 8.1 What a backup contains

A backup follows the blueprint's `backup.includePaths` (relative globs) and exclusions. If the
blueprint has no backup block, the full server directory is captured. Archives are `tar.gz` with
a manifest that records what was included.

### 8.2 Local and remote

`backup_orchestrator.py` makes the local archive the primary artefact. Two modes exist:

- **Without a backup password:** the local file stays `tar.gz`.
- **With a backup password:** the tar is created in a private temporary directory, encrypted
  through DIS to `.enc`, and the plaintext temporary file is removed
  (`backup_service.py:101-201`). The record then points to the `.enc` file.

S3 upload is only possible when a backup password is set
(`backup_orchestrator.py:74-87`). The panel streams the local file through the DIS sidecar
(`backup_crypto_service.py`) and uploads the ciphertext. After the upload it checks the object
with `head_object` and only then writes `s3_key`, `s3_bucket` and `encrypted=true` to the record
(`backup_orchestrator.py:12-25`). A record never claims a remote copy that was not verified.

For a server on a remote node, the agent does the encryption and upload; the panel only
orchestrates and never holds the S3 credentials longer than the call.

### 8.3 Retention, schedule and restore

Backups can be created manually or on a schedule (interval or fixed time). Retention is a count
per server (`Server.backup_retention_count`, default 5). Restore stops the container if it is
running, writes the data, and records the operation (`backup_restore_service.py`). The recovery
app (chapter 19) can decrypt a `.enc` backup offline if the panel is gone.

**Limit:** a local `tar.gz` without a password is not encrypted. That is the documented default,
and the README was corrected accordingly.

## 9. Multi-node operation

### 9.1 The agent

`msm-agent/` is a separate Python package with its own routers, services and tests
(30 test files). It performs Docker work on its node and reports state to the panel. The panel
never opens a Docker socket on a remote host directly.

### 9.2 Enrolment

Adding a node takes three steps: generate an install command in the panel, run it on the target,
approve the node. The token is short-lived (15 minutes), rate-limited, and stored only on the
target. The connection uses mutual TLS; the agent pins the panel certificate
(`node_enrollment_service.py`, `tls_pinning.py`). An owner or a user with node permission must
approve; a token alone is not enough.

**Why approval is separate:** a stolen install command should not be able to join a node to a
panel. The human approval is the second factor.

### 9.3 Capacity and placement

Each node reports capacity: CPU, memory, disk and interfaces (`routers/nodes.py`). Server
creation shows the remaining capacity and refuses a placement that exceeds it. A server can be
moved to another node (`server_node_migration_service.py`); the move stops the server, transfers
data, and starts it on the target.

### 9.4 Firewall

`firewall_service.py` opens and closes the ports a server declares, through narrow UFW paths.
Ports are allocated by MSM, so two servers cannot claim the same port on one node.

**Limit:** firewall management is why the systemd unit keeps specific UFW paths writable and why
`NoNewPrivileges` is not set. Chapter 2 records that trade-off.

## 10. Permissions and organisation

### 10.1 Permission model

There are 91 permission keys in `backend/services/permission_catalog.py`, grouped by area
(servers, files, backups, databases, nodes, teams, AI, messenger, vault and so on). A permission
is either global or server-scoped. The evaluation order in `permission_service.py` is:

1. the owner bypasses checks,
2. the user's global role,
3. a per-server grant,
4. team membership,
5. in a team, the founder's own rights cap what a team role can grant.

The last point prevents a team role from handing out more than the founder holds. The admin role
is reconciled on start-up against the catalogue, so a new key does not silently miss the admin.

### 10.2 Roles

Roles are Discord-style: a role has a name, a permission matrix and members. `routers/roles.py`
and the role editor write the matrix. A role can be global or team-local. Server grants assign a
role on one server, which is how a user can manage one game server without seeing the rest.

**Limit:** permissions are enforced on routes, not by hiding buttons. The UI hides what the user
cannot do, but the route is the authority.

### 10.3 Teams

A team has members, invitations, its own roles, server grants, shared AI knowledge and a team
vault. `routers/teams.py` covers membership and grants. The team vault is a separate key
hierarchy: a data key per team, wrapped for each member, with a rotate flow (prepare, commit,
abort, rollback). Removing a member is therefore not just a database flag; it ends access to the
wrapped key.

### 10.4 User administration from the messenger

The messenger is a module of the panel, not a separate product, so a user with the matching role
can administer users and roles from there. The same routes and permissions apply. There is no
second, weaker admin path inside the messenger.

### 10.5 Audit log

`models/audit_log.py` and `services/audit_service.py` record administrative and security-relevant
actions with actor, action, target, result and details. `routers/admin.py` exposes list, summary
and export. The AI has read tools for the audit log (`backend/services/ai_tools/audit_tools.py`),
so an operator can ask what changed without leaving the chat. The tools still check the caller's
permission; the AI does not gain a broader view than the user.

### 10.6 Hoster and shop API

`routers/hoster_admin.py` and `routers/hoster_api.py` implement a desired-state API for hosting
providers: create, suspend, resume and terminate servers idempotently, plus signed single-sign-on
handoffs for customers. Webhooks report state changes back to the shop. The subsystem is optional
and dormant until configured. The owner describes it as early-stage; chapter 22 repeats that.

## 11. Accounts and security

### 11.1 Registration and login

Registration can require a captcha (chapter 12) and email verification. Login supports a second
step: a login challenge is issued, and the client must present TOTP, a passkey or a backup code.
The second factor is verified on the server against stored material, never by a boolean field in
the request. Session cookies are `HttpOnly`; state-changing requests require a CSRF token.

### 11.2 Two-factor authentication

Three mechanisms coexist:

- **TOTP** against an encrypted secret. A code is accepted once per time step.
- **Passkeys (WebAuthn)** against a stored public key, with a one-time challenge per purpose.
- **Backup codes**, each usable once, stored hashed.

A factor does not replace another: a passkey and an authenticator app can be active at the same
time. Turning 2FA off removes the secret, the passkeys and the backup codes together.

### 11.3 Device pairing and sessions

`/auth/devices/*` pairs a native client (MSS, Pontis) with the account. Pairing produces a token
family with refresh rotation. A replayed refresh token after the grace window revokes the whole
family, which is the standard mitigation for a stolen token. The refresh response is
reconstructable from the database and a server secret, so a panel restart does not break a client
that repeats a request.

### 11.4 Rate limits and local connections

Two limits are configurable in the security tab: `rate_limit_auth` and `rate_limit_global`
(`frontend/src/pages/settings/SecurityTab.tsx`). They are enforced by the backend middleware, not
by the UI.

`allow_localhost_connections` lets a locally installed client connect. Enabling it requires a
fresh proof (passkey or TOTP), because it widens the origin surface. It is not a toggle a stolen
access token can flip.

### 11.5 Account lifecycle

Users can change password and email, export their data and delete the account. Changing the email
or setting a password on a social-login account requires a fresh proof; the link goes to the
confirmed address. Deletion runs through a preparation step that removes vault data, files and
credentials before the row is deleted, so nothing is orphaned.

**Limit:** deletion is irreversible. The UI names what will be removed before it starts.

## 12. Settings: all 17 tabs

`frontend/src/pages/Settings.tsx` defines 17 tabs. Two are permission-gated: hoster (read
permission) and backup (settings write). Everything below is a real tab, not a mock.

| # | Tab | What it controls |
|---|---|---|
| 1 | General | Language, seasonal effects with date windows, module switches |
| 2 | Imprint | Operator details and a link to the operator's own imprint |
| 3 | Security | API rate limits, allow local connections (with fresh proof) |
| 4 | Captcha | Registration captcha provider |
| 5 | Cloudflare | API token and default zone |
| 6 | OAuth | Social login providers |
| 7 | Steam | Steam Web API key and Steam account credentials |
| 8 | CurseForge | API key for the mod manager |
| 9 | Hoster | Hoster API credentials and behaviour (read-gated) |
| 10 | Email | SMTP or Resend |
| 11 | Messenger | Local LiveKit sidecar or an external server |
| 12 | Search | Maunting Search: SearXNG endpoint and optional Brave Search API key |
| 13 | AI | Providers, cost roles, limits, tool availability |
| 14 | Vault storage | Per-role storage quota |
| 15 | Backup | S3 endpoint, bucket, password |
| 16 | Support widget | Singra bot, Crisp, Tawk or a custom provider |
| 17 | Popup | Panel-wide announcements |

### 12.1 General

The general tab carries the module switches. Verified switches in `GeneralTab.tsx` include
calendar, notes, docs, social (messenger), vault, Cloudflare, desktop app download, browser
download and story/fable download. The routers enforce the switch: `calendar.py:87-89`,
`notes.py:27-29` and `docs.py:56-57` read the setting and reject requests when it is off, so a
disabled module is not merely hidden in the navigation.

Seasonal effects have their own switch and three windows: birthday, Halloween and Christmas,
each with a start and end date (`GeneralTab.tsx:21-51`). This is a cosmetic feature; it does not
change behaviour.

### 12.2 Captcha

`backend/services/captcha_service.py` supports four providers: `altcha` (default, local proof of
work through the DIS sidecar), `turnstile` (Cloudflare), `hcaptcha` and `recaptcha`. The local
provider needs no external service and no API key. The three cloud providers verify against their
official endpoints (`captcha_service.py:43-45`).

**Limit:** ALTCHA is proof of work, not image recognition. It raises the cost of automated
registration but does not stop a determined attacker.

### 12.3 Cloudflare

The Cloudflare tab stores an API token and a default zone (`CloudflareTab.tsx`). The AI has
network proposals for DNS: create and delete records go through a proposal card and are executed
by `services/cloudflare_service.py` (`ai_proposals/network_proposals.py`). The token never
reaches the browser; the panel uses it server-side.

### 12.4 Social login, Steam and CurseForge

OAuth presets exist for Google, Discord and GitHub (`backend/services/oauth_presets.py`); the
OAuth tab stores client id and secret and the callback. Steam and CurseForge are operator-level
credentials for the mod manager, as described in chapter 6. None of these secrets is returned to
the client after saving.

### 12.5 Email

`backend/services/email_service.py` supports SMTP and Resend. Resend is used when
`resend_api_key` is set; otherwise SMTP settings are used. The settings tab has a test action so
an operator can verify delivery before relying on password resets.

### 12.6 Messenger media server

The messenger can use the bundled LiveKit sidecar or an external LiveKit-compatible server.
`MessengerTab.tsx` switches between `lokal` and `extern`; the external mode stores URL, API key
and secret and offers a connection test. The signalling endpoint is proxied by Caddy; media ports
are described in chapter 2.

### 12.7 Search

Maunting Search is configured in one place (`SearchEngineTab.tsx`):

- **SearXNG:** the bundled sidecar at `http://127.0.0.1:8888` by default, or an operator's own
  instance URL. A switch controls whether external API keys may be used when a custom instance is
  configured, so a foreign instance cannot silently consume the operator's API credit.
- **Brave Search API:** optional key, used for web, image, video and news results.

The same configuration feeds Maunting Search in Pontis and the AI web search.

### 12.8 AI settings

The AI tab configures providers, models, cost roles and limits. The mechanics are in chapter 13.
It is not a text box for a prompt: prompts are built by the backend, and the tab controls
availability and budgets.

### 12.9 Vault storage, backup, support widget, popup

- **Vault storage:** a quota in bytes per role (`RoleVaultQuota`). A user's quota is the highest
  value among their roles (`vault_blob_service.quote_fuer`). A user with no role that carries a
  quota gets 0 and cannot upload, while existing files stay readable and deletable. The owner is
  unlimited.
- **Backup:** S3 endpoint, bucket and backup password. A remote upload requires the password
  (chapter 8).
- **Support widget:** four modes: the project's own Singra support bot (labelled "Singra
  (Discord-Bot)" in the UI), Crisp, Tawk or a custom provider with its own embed
  (`SupportWidgetTab.tsx`). The Singra mode uses an install id that can come from the panel or
  from the environment.
- **Popup:** a panel-wide announcement system, managed with the popup permission.

## 13. AI: Singra

Singra is an agent inside the panel. The model talks, but every action runs through backend code
that checks the caller's permission. The prompt is not a security boundary.

### 13.1 Providers

`backend/services/ai_provider_registry/` contains six provider adapters: `openai`,
`azure_openai`, `azure_anthropic`, `google`, `openrouter` and `elevenlabs` (speech). A provider
entry holds endpoint, key, models and which roles it may serve. Keys are stored encrypted and are
never sent to the client.

Model prices come from `ai_model_price_service.py`; usage is booked per run
(`ai_usage_service.py`, `ai_kosten.py`). The AI tab shows the configured providers and their
assigned roles.

### 13.2 Cost roles and limits

Five roles can point at different models: standard chat, background worker, ethics check, memory
maintenance and search summary (`ai_provider_service.py:159-207`). A provider is eligible for a
role only when the role is enabled and a model is set.

Limits are per role (`models/role_ai_limit.py`): daily, weekly and monthly token limits, plus
monthly minutes for realtime voice and dictation. A run stops at the limit instead of silently
spending more.

### 13.3 Tool catalog

There are 125 tools, a number asserted by `backend/tests/test_ai_tool_drift.py` so the catalogue
and the registry cannot drift apart. A tool declares its kind in `services/ai_tool_spec.py`:

| Kind | Behaviour |
|---|---|
| `server_read` | reads on one server, resolved and permission-checked per call |
| `global_read` | reads without a server |
| `docs_write` | edits a document without a proposal card |
| `server_write` | creates a confirmation proposal for a server |
| `global_write` | creates a proposal without a server, for example server creation |
| `ask` | ends the turn and asks the human |
| `delegation` | runs immediately in its handler |
| `voice_control` | changes only the state of the current voice session |

Tool domains in the tree (module names in `backend/services/ai_tools/`): audit, Cloudflare,
CurseForge, database, documents, geo, hoster, panel overview, personal (calendar, notes, mail),
project, server history, server network, server files, server mods, server operations, server
writes, system, tasks and users.

Two examples of how narrow a tool is: `web_search` is only in the catalogue when a search key is
configured (`ai_action_service._global_tool_definitions`), and region analysis falls back to a
keyless map image when no Copernicus access exists, instead of pretending to have satellite data.

### 13.4 Proposals and confirmation

A write action becomes an `AiActionProposal`: target, operation, before and after values, and a
human-readable preview. Confirming executes the same service the UI uses. Rejecting leaves the
system untouched. Proposals are listed in `ai_proposals/` per domain (servers, network, roles,
users, documents, database).

**Why this exists:** an LLM can produce a syntactically valid but wrong change. The card is the
point where a human sees the target and the delta.

### 13.5 Autonomy

Autonomous execution requires four conditions at once
(`backend/services/ai_autonomy_service.py`):

1. the user has the right for the concrete tool,
2. the user granted autonomy explicitly (per tool, optionally per server),
3. the tool is allowed for autonomy (`immer_bestaetigen` excludes sensitive tools),
4. the hourly budget still has room (`max_actions_per_hour`).

If one condition fails, the action becomes a proposal again. A grant on a normal server does not
implicitly cover a sensitive one (`hat_engere_server_freigabe`).

### 13.6 Memory

Memory v2 stores facts with local embeddings, a blind HMAC index for lookup and encryption at
rest (`ai_memory_service.py`, `ai_memory_vektor.py`, `ai_memory_krypto.py`). A nightly maintenance
job compacts and deduplicates (`ai_gedaechtnis_pflege.py`, `ai_compaction_service.py`). Search by
name uses the blind index, never a plaintext column.

**Limit:** memory is per user or per team scope; a server knowledge entry does not leak into
another user's chat. The AI reads only what the caller could read in the UI.

### 13.7 Web search

Search goes through SearXNG (`ai_web_search_service.py`) and optionally Brave Search. A follow-up
question is rewritten with the conversation in mind into at most three queries, then at most two
follow-up rounds, then at most two pages are opened for detail
(`ai_search_summary_service.py`). Results carry numbered citations; an answer without a source is
marked as such.

### 13.8 Voice

Two pipelines exist:

- **Classic:** voice activity detection, speech to text, the same `AiRun` as text, then text to
  speech (local or ElevenLabs).
- **Realtime:** direct OpenAI Realtime over WebRTC between client and endpoint. API keys stay on
  the server; the client never receives them.

Tool calls in voice mode travel through the same registry and permissions
(`ai_voice_bridge.py`). The bridge must include tool payloads such as geo results in the JSON
sent to the frontend; otherwise the voice UI has nothing to render.

### 13.9 MCP, skills and workers

- **MCP:** `routers/ai_mcp.py` manages Model Context Protocol servers at global, team and user
  scope. Tool scopes are checked per call.
- **Skills:** nine Markdown skill files in `backend/ai_skills/` are loaded as reusable
  instructions; `ai_skill_service.py` decides which apply.
- **Workers:** background agents run a bounded loop. `ai_worker_limits.py` sets
  `MAX_RUNDEN = 48`; a worker cannot loop forever. Tasks have persistent state
  (`routers/ai_tasks.py`).

### 13.10 Projects and coding sandbox

`routers/ai_projects.py` (33 routes) gives the AI a project workspace with files, commands, Git
and preview. The sandbox is not a shell: commands are validated against an allowlist of developer
tools, paths are anchored inside the project directory (`ai_project_service.py`), and Git
credentials are resolved per user through `GIT_ASKPASS` rather than embedded in a URL.

**Limit:** the allowlist rejects privilege escalation, system control, destructive disk
operations, reverse shells and access to system paths. A project that needs something outside the
list is not silently executed.

### 13.11 Computer use

Computer use runs on the desktop through MSS jobs (`routers/desktop.py`,
`desktop_job_service.py`). It is off by default. Mouse and keyboard control require an explicit
local approval in MSS with a ten-minute expiry; screenshots show a visible indicator. The panel
cannot grant itself desktop control.

### 13.12 Geo and satellite imagery

`ai_geo_service.py`, `ai_satellite_service.py`, `ai_geo_image_service.py` and
`ai_maptiler_service.py` provide geocoding, weather, a 3D globe target and regional imagery.
With a Copernicus account the newest Sentinel-2 scene is used; without one, a keyless ArcGIS
mosaic. The UI renders a MapTiler map and a 3D globe; camera commands do not block user
interaction.

### 13.13 Ethics and redaction

An ethics check (`ai_ethics_service.py`, `ai_ethics_trigger.py`) can run off, automatically, always
or only for critical actions. `ai_redaction.py` removes secrets from tool output before the model
sees it. The context ceiling is per role: the default request ceiling is 44,000 tokens, a role can
raise it up to the model's own limit (`ai_context_window.py`, `ai_limit_service.py`).

## 14. Messenger

### 14.1 What the user can do

Direct chats, groups, stories ("Aktuelles"), a community view, filters by all/groups/friends/
teams/public, search, invite links, archive, mute, block, drafts, typing indicators, presence,
delivery and read receipts, reactions, replies, forwarding, copy, selection, editing, deletion,
pinning (with `can_pin_messages`), disappearing messages with a server-set expiry, attachments
(camera, gallery, file, note, calendar event), voice notes, round video notes, stickers including
a mixer and a photo-sticker editor. There is no poll feature in the code.

Group roles come from two sources: the team role and the group role; `services/gruppenRollen.ts`
derives the effective rights for the conversation. Groups have invite links and encrypted
metadata.

### 14.2 Encrypted formats

The backend accepts only these envelopes for message content: `sv-e2ee-dr-v1:`,
`sv-e2ee-group-v1:` and `sv-e2ee-hybrid-v1:` (`backend/schemas/social.py:167-169`). Older formats
that the server could derive are rejected on write. The server stores ciphertext, routing metadata
and timestamps; it cannot read the plaintext.

### 14.3 Double ratchet and devices

Each device has its own ratchet chain. A new device starts with its own chain; an existing device
can hand over history and the chat secret in signed, sealed packages, but only after the security
number is compared. The device directory (`models/user_e2ee_device.py`) tracks public keys and
approval state.

Group content uses a separate group key, carried in encrypted blocks with a key identifier so a
device can hold several generations.

### 14.4 Delivery

The transport distinguishes the shared mailbox from the per-device inbox. Migrations
`20261023_02_e2ee_zustellung.py` and `20261025_01_einheits_transport.py` define the delivery
tables and the sequence used for device inbox items. A device inbox item has its own id space,
which is why a receipt must not mix envelope ids and inbox ids (chapter 22 of the project rules
records the historical bug).

Queues make offline work durable: effects (edit, delete, reaction, pin, expiry), deletions,
media fetches and history transfers are stored locally, retried with backoff and removed after
a definitive rejection. Receipts are cumulative watermarks, not id lists.

### 14.5 Calls

Calls use LiveKit, either the bundled sidecar or an external server (chapter 12.6). `social_calls.py`
has 16 routes for rooms, participants and admin actions. Group calls support camera, screen
sharing with system audio, quality from 720p to 2160p at 30 or 60 fps, device selection,
moderation and moving a call between devices.

### 14.6 Lock, notifications and administration

The messenger has a PIN lock with automatic locking on focus loss or tab change. Push
notifications use WebPush with a provider allowlist (Google, Mozilla, Apple, Microsoft) and
short timeouts, so a tarpit cannot exhaust workers. The bell and the notification service are
shared with the rest of the panel.

Users with the matching role administer users and roles from the messenger, as described in
chapter 10.4; there is no separate admin surface with weaker checks.

## 15. Calendar and notes

### 15.1 Calendar

The calendar holds personal, team, server and node events. A user filters by these scopes.
Events can repeat: `kalender_serie.py` expands series with exceptions, and the expansion is
bounded so a long series cannot freeze the browser. Each event can be exported; the calendar also
serves an ICS feed and supports CalDAV for external clients (`routers/calendar.py`).

Event content is encrypted client-side (`services/notesCalendarCrypto.ts`) when the item is
personal. Shared items follow the visibility rule: a team or server event must be readable by
the people who are allowed to see it, so it uses the shared path, not the personal key.

Reminders run in the panel and, on Android, as scheduled local alarms. The alarm carries a title
the phone can decrypt; there is no background service holding a session token for reminders.

**Limit:** creating or editing a node-wide event requires `nodes.manage` or owner status;
otherwise a normal user could write into every administrator's calendar.

### 15.2 Notes

Notes support categories, colours, pinning, archive, team notes, search and a preview. The note
key is per account, not per device: devices agree on one key through a signed record on the
server (`/api/notes/kontoschluessel`), so a note written on one device opens on another.

A note that becomes personal again is re-encrypted with the personal key. The UI says when a note
is shared and who can read it; it does not claim end-to-end encryption for a team note the team
can read.

## 16. Documents

The documents module is a collaborative editor built on Tiptap in the frontend and a Yjs/
Hocuspocus sidecar (`docs-sidecar/`) for realtime collaboration. It is closer to a small Google
Docs than to a Markdown box.

### 16.1 What the user can do

- Folder tree, trash, duplicate, drag and drop, search.
- Rich text with headings, lists, tables, code, links, images stored as assets.
- Realtime collaboration with presence and conflict-free merging.
- Comment threads with resolved state.
- Revisions with restore.
- Sharing with roles and claim links.
- Outline, slash menu and an AI panel.
- Export to HTML, Markdown, plain text and print.
- Offline editing with IndexedDB and a pending-edit queue.

### 16.2 How it works

`routers/docs.py` and `routers/docs_internal.py` cover folders, members, comments, revisions,
assets and a collaboration token. The token is a short-lived JWT signed by the panel
(`docs_collab_service.py`), so the sidecar accepts a connection only for a document the user may
open. Document state and revisions are encrypted by the panel; the sidecar sees the document
content it collaborates on, which is why it runs on the same host and only on loopback ports.

**Limit:** realtime collaboration needs the sidecar. Without it, editing still works locally and
syncs later, but two users do not see each other's cursors.

## 17. Vault

The vault is zero-knowledge: the master password derives a key in the client, and the server
stores ciphertext it cannot open. It works as a password manager and as a private gallery and
file store.

### 17.1 Storage model

- The bucket is identified by an HMAC of the account id, not by the account id
  (`konto_index`), so a database dump does not map buckets to people.
- Files are split into 4 MiB plaintext chunks (`CHUNK_KLARTEXT`), each with a 12-byte IV and a
  16-byte tag; the ciphertext chunk is 28 bytes larger (`vault_blob_service.py:51-53`).
- A single blob can be up to 1 TiB (`MAX_BLOB_BYTES`), but the role quota is the real limit.
- Uploads check the size against the chunk count before writing, and keep a disk reserve of
  1 GiB (`PLATTENRESERVE`).
- The quota is the highest value across the user's roles (`quote_fuer`); no role with a quota
  means no uploads. The owner is unlimited.
- Deleting and resetting leave tombstones. A reset bucket answers 410 and cannot be claimed back
  by an old device, so a deleted vault does not reappear.

### 17.2 Features

Passwords, TOTP codes, notes, files and folders, a gallery with thumbnails and a lightbox, cards
and IBANs, import and export, a password generator, a breach check, a security check, trash with
remaining days, archive with undo, favourites, search, multi-select, an image editor and offline
sync. Unlock works with the master password, Windows Hello/biometrics or a passkey; a QR flow
authorises a new device.

The team vault is a separate key hierarchy: a data key per team, wrapped for each member, with a
rotation flow. Removing a member ends access to the wrapped key.

### 17.3 Camera backup and autofill inbox

On Android, MSS can back up camera photos into the vault. The phone encrypts with a post-quantum
hybrid envelope (ML-KEM-768 and RSA-4096-OAEP-SHA-256,
`smart-system/src-tauri/src/kamera_krypto.rs`) and sends
the ciphertext through an inbox. The panel never sees the plaintext. A background job uploads in
chunks and the entry is created only when all blobs are complete.

The browser can fill credentials while the vault is locked through a separate, narrow inbox. This
is not the vault key: it is a limited channel that the user unlocks explicitly.

**Limit:** the vault is only as safe as the master password. A forgotten password cannot be
recovered by the operator; a reset deletes the data, by design.

## 18. Pontis browser

Pontis is a Tauri v2 browser. On Windows it uses one WebView2 controller per tab; on Android it
uses the system WebView through JNI. The two implementations share decisions where a difference
would be a security bug.

### 18.1 Tabs and isolation

Private tabs, session restore, a tab grid with drag-to-split, horizontal and vertical split,
a vertical tab bar, and workspaces with isolated profiles. Suspended tabs release memory and can
be restored. Each tab is a separate controller, not an iframe inside the panel.

### 18.2 Adblock and cookie banners

The filter engine is adblock-rust. `schild/listen.rs` loads EasyList, EasyList Germany,
EasyPrivacy and the EasyList Cookie List, refreshed every four days. Requests from a tab pass the
tracker list first, then the ad list.

Cookie banners are rejected by autoconsent, not hidden. That distinction matters: hiding a banner
with CSS would stop autoconsent from seeing it and rejecting it. The cookie list therefore
contributes network rules only; hiding until rejection is done by autoconsent itself.

### 18.3 Youth protection

Five categories (adult, gambling, social, games, shopping) with StevenBlack lists, up to 500
custom blocks and exceptions, SafeSearch and YouTube Restricted Mode. A change that loosens the
setting is an application: it waits 24 hours to 7 days, then must be confirmed within an hour,
and a cancelled or expired application blocks a new one for a day. Tightening takes effect
immediately. Time comes from a network source, so changing the clock does not shorten a waiting
period.

### 18.4 Downloads

Downloads go through quarantine, a Windows Defender scan and an origin mark before they reach the
target. History keeps 500 entries with search, filters and date groups. Limits per tab and a disk
reserve prevent a page from filling the disk; a failed download reports whether storage,
quota or the file type was the cause.

### 18.5 Password manager and translation

The browser fills and generates credentials from the vault, including payment cards and IBANs.
Payment data is only filled over HTTPS, only into visible fields, and only after Windows Hello or
the master password. Translation runs locally with Bergamot/WASM models
(`frontend/src/browser/uebersetzung/`); the page text does not leave the device.

### 18.6 The rest

Reader mode, in-page search, voice and image search, an own meta search (`msm://suche`),
bookmarks, history, screenshots (visible area, selection, full page), a start page with widgets
(weather, clock, appointments, notes, recent pages, news, smartcard, protection statistics), site
settings with reset, a permissions popover, default-browser registration, import from Chrome,
Firefox and Edge, extensions (Windows, CRX3 signature-checked) and developer tools.

**Limit:** extensions are Windows-only. Full-page screenshots are unavailable while the device
emulation is active, because both use the same override.

## 19. MSS desktop app and Recovery

### 19.1 MSS

MSS renders the same panel UI in a Tauri window, with its own integration layer:

- **Pairing instead of a password:** a pairing code links the app to the account; the refresh
  token lives in the OS credential store.
- **Tray, hotkeys and wake word:** tray state colours, two global shortcuts, and an offline wake
  word based on rustpotter with a clamped threshold (`smart-system/src-tauri/src/konfig.rs`).
- **Overlay and screenshot:** a click-through overlay and a screenshot tool with a visible
  indicator.
- **Computer use:** mouse and keyboard control only after a local approval with a ten-minute
  expiry (`uebernahme.rs`, `durchklick.rs`).
- **Sandbox and scanning:** file jobs run in a sandbox with write zones and a recycle-bin policy;
  downloads are scanned with `MpCmdRun` and quarantined (`virenscan.rs`, `artefakt.rs`).
- **Local integrations:** MCP over stdio (`mcp_stdio.rs`), Discord RPC over a local named pipe,
  audio ducking via WASAPI, device handling for microphone and camera.
- **Reminders and Android:** local appointment alarms; on Android a separate process service and
  up to 100 scheduled reminders.
- **Updates and uninstall:** Velopack on Windows, a three-stage update on Android; uninstall
  removes wake-word recordings and local artefacts.

**Limit:** the debug build has its own application id and never updates the installed app. That
guard exists because an earlier debug build did exactly that.

### 19.2 Recovery

The recovery app decrypts a `.enc` backup offline, using the backup password (Argon2id and
AES-256-GCM through DIS). It extracts the `tar.gz` into a temporary directory, shows the file
tree and a preview, and saves what the user selects. The password stays in memory; the temporary
directory is cleaned up.

## 20. Design system and quality bar

### 20.1 Shared UI

`frontend/packages/maunting-ui` (published internally as `@maunting/ui`) holds 54 components used
by the panel, the browser shell and the desktop app: buttons, dialogs, dropdowns, cards, tab
bars, tables, toasts, tooltips, a date-time picker, a colour picker, an icon picker, a chat input
bar, a progress bar and more. Tokens live in `tokens.css`/`tokens.ts`; the package also ships the
WebGL voice visual as a separate entry point.

The rule is design system first. A native `<select>` is not acceptable when a `Dropdown` exists;
a native `title` tooltip is not acceptable when `Kurzinfo` exists. Tests enforce parts of this,
for example `frontend/src/test/keinNativesTitle.test.ts` and the switch-label test.

### 20.2 Accessibility

Dialog stacking, focus return, Escape handling, 44 px touch targets on touch devices, one tab stop
per grid, named controls and a visible focus ring are implemented in the components, not left to
each page. Tests cover two open dialogs, a popover over a dialog, and a grid reached with one Tab.

### 20.3 Languages

The UI ships German and English. `frontend/src/locales/de.json` contains 9731 string values
(counted by walking the JSON). No component may carry a fixed German or English sentence:
defaults for placeholders, search and empty states come from i18n.

### 20.4 Test discipline

- Backend tests require PostgreSQL; SQLite is rejected (`database_policy.py`). Migration tests run
  up and down on a disposable database.
- A fix test must fail on the state before the fix; otherwise it does not prove the fix.
- The crypto facade test (`test_krypto_fassade.py`) rejects direct imports of crypto libraries
  outside the approved facade. All encryption goes through `DisClient`.
- The mojibake test (`test_quelltext_ohne_mojibake.py`) scans every tracked source file for
  double-encoded text, because such text looks valid to every tool.
- The version test (`test_versionen_gleich.py`) keeps frontend, Tauri crates, the agent and the
  backend version endpoint on the same number.

### 20.5 Product text

Visible text follows the project rules: no formulaic introductions, no artificial conclusions, no
unbacked superlatives, no emojis in the interface, no invented sources. A statement about
encryption appears only where the code keeps it, and the privacy page is versioned with its date
and checked against its tests.

## 21. Comparison with other open source projects

All comparisons below use the official project documentation retrieved on 11 November 2026. Where
a project's documentation did not answer a question, the table says "not verified" instead of
guessing. MSM statements are backed by the code references in chapters 1 to 20.

### 21.1 Game server panels

| | MSM | Pterodactyl v1 | Pelican | AMP | Crafty Controller | LinuxGSM |
|---|---|---|---|---|---|---|
| Licence | AGPL-3.0 | MIT | AGPL-3.0 | Commercial | GPLv3 | MIT |
| Shape | Panel + own agent per node | Panel (PHP) + Wings (Go) | Panel + Wings + Eggs + Yolks | ADS + instance manager | Python web GUI | Shell scripts, no panel |
| Isolation | Rootless Docker, `cap_drop=ALL` | Docker container per instance | Docker container per instance | Docker optional | Not verified | None (host processes) |
| Workload definition | 32 native blueprints, data-only | Eggs (site: 253 games, 55 apps) | Eggs and Yolks | Vendor modules | Minecraft jars/EXEs | 148 game scripts |
| Steam Workshop | Native via SteamCMD | Not verified as built-in | Not verified as built-in | Not verified | No | Via SteamCMD |
| Multi-node | Yes, enrolment with approval | Yes, Wings per host | Yes, Wings per host | ADS instances | Single install | Per host |
| Roles | 91 permissions, global/server/team | Subusers with granular permissions | Subusers | Edition limits | User/role configuration | OS users |
| Self-healing | Guardian on each node | No | No | Not verified | No | Restart on monitor |

What MSM does differently: the panel is not only a game host manager. The same install carries
databases, documents, a messenger, a vault, an AI agent and a browser client, with one permission
model across them. Guardian evaluates health locally and repairs within blueprint policies, so a
panel outage does not stop recovery. Blueprints are data-only; a user cannot upload a script that
runs on the node.

Where the others are ahead: Pterodactyl's egg catalogue is much larger than MSM's 32 blueprints,
and its ecosystem is older. LinuxGSM supports 148 games without a panel. Pelican is a direct
successor of Pterodactyl with the same mental model, which makes migration for existing users
easier. AMP is a commercial product with vendor support, not an open source project; it is listed
for context, not as a licence peer.

### 21.2 Container platforms

Portainer CE (zlib licence) manages Docker, Swarm, Kubernetes and Podman, with an agent per node.
Its documentation states that RBAC is a Business Edition feature, not a CE feature
(Portainer docs). Rancher (Apache-2.0) is a Kubernetes management platform.

MSM does not try to be a general container IDE. It runs a fixed set of workloads declared by
blueprints, with ports, backups and health checks. If you need arbitrary compose stacks and
cluster-wide Kubernetes policy, Portainer or Rancher are the better tool.

### 21.3 Messengers

| | MSM | Mattermost | Element / Matrix | Rocket.Chat |
|---|---|---|---|---|
| Licence | AGPL-3.0 | MIT binaries, AGPLv3 source | AGPL-3.0 | MIT except `ee/` |
| Message E2EE | Yes, double ratchet per device | No; TLS and disk encryption | Yes, Olm/Megolm | DMs and private channels, not public |
| Federation | No | No | Yes | Via Matrix, premium |
| Calls | LiveKit, E2EE room keys | DTLS/SRTP through the server | MatrixRTC with LiveKit | Not verified here |

Mattermost documents that calls are not end-to-end encrypted and media passes through the server.
Matrix has the most mature federation and cross-signing model, including SAS and QR verification.
Rocket.Chat's E2EE explicitly excludes public channels and encrypted content is not searchable or
auditable, which is a deliberate trade-off.

MSM's difference is integration: the messenger shares accounts, roles, the vault and the panel
with the rest. The cost is the same: no federation, and a smaller client ecosystem than Matrix.

### 21.4 Vaults

Vaultwarden (AGPL-3.0) is an unofficial Bitwarden-compatible server written in Rust; it supports
organisations, collections, attachments and 2FA. Its documentation does not explicitly describe
the zero-knowledge property, so this document does not claim it for Vaultwarden; it is a property
of the Bitwarden client model. Bitwarden's server is AGPLv3 by default with a separate licence in
`/bitwarden_license`; Send is documented as end-to-end encrypted.

MSM's vault is zero-knowledge by construction: the server stores chunks, an HMAC bucket id and a
quota, and never the master key. It also carries a gallery, team vaults and a camera backup with a
post-quantum hybrid envelope. Bitwarden and Vaultwarden have the larger client ecosystem and
browser-extension coverage; MSM's browser integration is its own Pontis.

### 21.5 Search

SearXNG (AGPL-3.0) is the meta search engine MSM ships as a sidecar. Its documentation states no
user tracking or profiling and up to 260 search services. Whoogle (MIT) was an alternative that
proxied Google results without JavaScript; the project was archived on 24 July 2026 and no longer
returns results, so it is not a viable choice today.

MSM adds two things on top: Brave Search as an optional API for structured result types, and an AI
summary with citations over the merged results. The privacy claim stays the same as SearXNG's: the
query goes to the local instance, not to the browser vendor.

### 21.6 AI front ends

Open WebUI uses the "Open WebUI License", a BSD-style licence with a branding clause. It supports
Ollama, OpenAI and compatible endpoints, Python tools, MCP over streamable HTTP, RAG with hybrid
search and multiple vector databases, plus RBAC and SSO. LibreChat (MIT) supports many providers,
agents with subagents, MCP servers and a code-interpreter sandbox, plus 2FA and passkeys.

Both are stronger than MSM as general chat front ends, especially in RAG breadth and provider
choice. MSM's AI is different in kind: its 125 tools operate the panel itself (servers, files,
backups, databases, DNS, audit, documents), and every write becomes a proposal card tied to the
caller's permissions. A chat front end cannot restart a game server; MSM's agent can, within the
same permission model as the UI.

### 21.7 Sources

All retrieved 11 November 2026.

- Pterodactyl: https://pterodactyl.io/ and https://github.com/pterodactyl/panel/releases
- Pelican: https://pelican.dev/docs and https://github.com/pelican-dev/panel
- AMP: https://cubecoders.com/AMP, https://cubecoders.com/TermsOfSale/AMP
- Crafty: https://craftycontrol.com/ and https://docs.craftycontrol.com/
- LinuxGSM: https://linuxgsm.com/
- Portainer: https://docs.portainer.io/ and https://docs.portainer.io/admin/environments/add/docker/agent
- Rancher: https://github.com/rancher/rancher
- Mattermost: https://docs.mattermost.com/deployment-guide/application-architecture,
  https://docs.mattermost.com/deployment-guide/encryption-options,
  https://docs.mattermost.com/end-user-guide/collaborate/make-calls.html
- Matrix E2EE: https://spec.matrix.org/latest/client-server-api/#end-to-end-encryption
- Element Call: https://github.com/element-hq/element-call
- Rocket.Chat: https://docs.rocket.chat/docs/end-to-end-encryption-user-guide,
  https://docs.rocket.chat/docs/federation
- Vaultwarden: https://github.com/dani-garcia/vaultwarden/wiki
- Bitwarden: https://github.com/bitwarden/server, https://bitwarden.com/help/collections/,
  https://bitwarden.com/blog/bitwarden-send-how-it-works/
- SearXNG: https://docs.searxng.org/
- Whoogle: https://github.com/benbusby/whoogle-search
- Open WebUI: https://docs.openwebui.com/features/
- LibreChat: https://www.librechat.ai/docs/features

Uncertainties kept out of the tables: AMP's exact licence text and game count; whether Pterodactyl
or Pelican ship Workshop support natively; Crafty's container isolation; Portainer CE's compose
scope; Vaultwarden's explicit zero-knowledge wording; Rocket.Chat's key management; Element's
group-call encryption detail; SearXNG's server-log behaviour.

## 22. Gaps and contradictions

This chapter lists what the code does **not** do and where older text disagrees with the code.
It exists so the document can be used as a reference without repeating claims that do not hold.

### 22.1 Missing features that are sometimes assumed

- **Modrinth is not integrated.** `docs/blueprints.md` mentions it; the schema and services know
  Steam Workshop and CurseForge only. A Modrinth mod cannot be installed through the mod manager
  today.
- **No command palette.** The panel has no global command palette or global keyboard shortcut
  layer. Shortcuts exist in the browser and in the document editor.
- **Kubernetes is experimental.** `deploy/kubernetes/` covers the control plane only, with one
  replica, and is labelled experimental in the README.
- **The hoster API is early-stage.** The routes and the desired-state contract exist, but the
  owner describes the subsystem as still under development.
- **Blueprints are still being extended.** The system is the core of the product and has open
  work, especially around the catalogue and mod injection for more games.
- **Google Programmable Search is not integrated.** It was removed from the backend, the API
  schemas and the search settings tab; Maunting Search uses SearXNG and optional Brave Search.
- **Polls do not exist in the messenger.** Reactions, replies and stickers do; polls are not
  implemented.
- **Extensions in Pontis are Windows-only.** The Android build does not load them.
- **Full-page screenshots are unavailable during device emulation.** Both use the same WebView2
  override.

### 22.2 Where older text disagrees with the code

| Older statement | Actual behaviour |
|---|---|
| Backups are always encrypted client-side before leaving the infrastructure | Local archive is `tar.gz` by default; it becomes `.enc` when a backup password is set. S3 upload requires the password and is encrypted through DIS. |
| "Not a Hosting Provider" without qualification | A hoster API exists and is optional. The README now says self-hosted with an optional hoster integration. |
| "Not a Windows Application" | Panel and agent are Linux; MSS is a Windows and Android client. The README now separates the two. |
| 125 AI tools is a documentation claim | 125 is asserted by `backend/tests/test_ai_tool_drift.py`; the registry and the catalogue must agree. |
| Modrinth support | Not implemented (see 22.1). |

The README was corrected in the same change that added this document.

## 23. Appendix: numbers, glossary, file map

### 23.1 Counting method

| Number | Value | Command or file |
|---|---|---|
| Commits | 2481 | `git rev-list --count HEAD` |
| First commit | 2026-05-19 | `git log --reverse --format='%ad %s' --date=short \| head -1` |
| Router modules | 57 + 12 | `ls backend/routers/*.py`, `ls backend/routers/social/*.py` |
| Route decorators | 740 | `grep -rhoE '@router\.(get\|post\|put\|patch\|delete\|websocket)\(' backend/routers \| wc -l` |
| Service modules | 235 | `ls backend/services/*.py \| wc -l` |
| Tables | 131 | unique `__tablename__` in `backend/models` |
| Permission keys | 91 | unique `PermissionDef("…")` |
| AI tools | 125 | `backend/tests/test_ai_tool_drift.py` |
| Blueprints | 32 + 1 | `backend/blueprints/native`, `blueprints/community` |
| Backend tests | 460 files / 6592 | `find backend/tests -name 'test_*.py'`, count `def test_` |
| Frontend tests | 544 files / 4531 | `find frontend/src -name '*.test.ts[x]'`, count `it(`/`test(` |
| Rust tests | 425 | count `#[test]` and `#[tokio::test]` in the three Tauri crates |
| Pages | 84 | `find frontend/src/pages -name '*.tsx' ! -name '*.test.tsx'` |
| Components | 229 | `find frontend/src/components -name '*.tsx' ! -name '*.test.tsx'` |
| UI components | 54 | `find frontend/packages/maunting-ui/src -name '*.tsx' ! -name '*.test.tsx'` |
| Locale strings | 9731 | walk of `frontend/src/locales/de.json` |

Counts are from the tree at commit `aad9d19e`. A later commit can change them; recount with the
same command instead of copying the number.

### 23.2 Glossary

- **Blueprint:** declarative workload definition (image, ports, files, checks, backups). The MSM
  equivalent of an egg, but data-only and without shell hooks.
- **Node:** a Linux host running `msm-agent`; the panel manages one or more.
- **Guardian:** local supervisor on a node that probes containers and repairs within blueprint
  policies.
- **DIS:** the project's encryption library (`@msdis/shield`), used through a sidecar for database
  columns, backups, ALTCHA and messaging formats.
- **Blind index:** HMAC of a value, stored next to ciphertext so a lookup is possible without
  storing plaintext.
- **AAD:** additional authenticated data; binds a ciphertext to its context (table and column, or
  a file id) so it cannot be moved elsewhere.
- **Double Ratchet:** the E2EE protocol used per device, giving forward secrecy and post-compromise
  recovery.
- **Device inbox:** per-device delivery queue with its own id space, separate from the shared
  mailbox.
- **MSS:** Maunting Smart System, the Windows and Android desktop client.
- **MSB / Pontis:** the browser; "MSB" is used in code and older text, "Pontis" is the product name.
- **Hoster API:** optional desired-state API for hosting providers.

### 23.3 File map

| Area | Entry points |
|---|---|
| Panel API | `backend/main.py`, `backend/routers/` |
| Servers | `routers/servers.py`, `services/server_lifecycle_service.py`, `server_provisioning_service.py` |
| Blueprints | `blueprints/schema.py`, `routers/blueprints.py`, `backend/blueprints/native/` |
| Mods | `routers/mods.py`, `routers/curseforge.py`, `services/mod_update_service.py` |
| Backups | `services/backup_orchestrator.py`, `backup_service.py`, `backup_crypto_service.py` |
| Databases | `services/postgres_ddl.py`, `routers/postgres_studio.py`, `routers/sqlite_studio.py` |
| Nodes | `msm-agent/`, `routers/nodes.py`, `services/node_enrollment_service.py` |
| Permissions | `services/permission_catalog.py`, `permission_service.py`, `routers/roles.py` |
| AI | `services/ai_*`, `routers/ai_*.py`, `backend/ai_skills/` |
| Messenger | `routers/social/`, `services/social/`, `frontend/src/components/social/` |
| Vault | `routers/vault.py`, `services/vault_*.py`, `frontend/src/desktop/vault/` |
| Documents | `routers/docs.py`, `docs-sidecar/`, `frontend/src/docs/` |
| Browser | `browser/src-tauri/src/`, `frontend/src/browser/` |
| Desktop | `smart-system/src-tauri/src/`, `frontend/src/desktop/` |
| Design system | `frontend/packages/maunting-ui/` |
