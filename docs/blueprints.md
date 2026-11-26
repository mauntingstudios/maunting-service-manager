# Blueprint Runtime & Specification Reference

Blueprints are the single source of truth for both native and community game servers, Discord bots, and Linux background services in the Maunting Service Manager (MSM). Native support means MSM includes tested blueprint templates under `backend/blueprints/native`. Community servers utilize the exact same runtime by importing custom blueprint definitions.

There are no game-specific Python plugins or custom daemon forks for individual games. The generic, hardened `BlueprintPlugin` powers every service uniformly.

> [!NOTE]
> Die deutschsprachige Fassung dieser Dokumentation befindet sich unter [docs/de-docs/blueprints.md](de-docs/blueprints.md).

---

## Security Boundaries & Hardening

Blueprints represent declarative configuration data, not executable scripts:

- **No shell hooks:** Arbitrary shell scripts in container hooks are forbidden.
- **No Python hooks:** Custom arbitrary Python code injection is blocked.
- **Strict path boundaries:** No absolute host file paths and no directory traversal (`..`) are accepted.
- **Whitelisted capabilities only:** Container environments enforce strict isolation.

### Unprivileged User Namespaces & Tmpfs Execution

The property `runtime.allowUnprivilegedUserNamespaces` defaults to `false`. This flag is reserved solely for specialized container runtimes (such as UMU/pressure-vessel) that need to nest an unprivileged user namespace inside an already rootless game container. When set to `true`, MSM applies the narrowed Wine/Proton seccomp profile (never `seccomp=unconfined`).

`runtime.allowTmpfsExec` defaults to `true` and allows executing binaries on mounted `tmpfs` paths such as `/tmp` (needed e.g. for Java or SQLite JNI). Set it to `false` for strictly hardened containers.

All standard guardrails remain immutable:
- `cap-drop=ALL` (complete capability stripping)
- `no-new-privileges=true`
- Strictly non-root numeric user IDs
- Explicit prohibition of `privileged: true` and host network binding (`network_mode: host`)

---

## Blueprint Structure Overview

A blueprint defines an application or server archetype, not a single running instance. When creating an actual instance, users allocate port numbers, RAM/CPU thresholds, and IP bindings based on the blueprint definition. Blueprints can be created and edited directly in the web panel's Blueprint Editor or imported as JSON.

### Primary Sections

| Section | Role |
|---|---|
| `meta` | Identifier, display title, description, and UI categorization (`steam_game`, `non_steam_game`, `voice_server`, `bot`, `database`, `web_app`, `frontend`, `backend`). |
| `runtime` | Target container image, working directory, environment variables, startup command, seed files, config patches, and hardening flags. |
| `ports` | Declarative network requirements with functional names (`game`, `query`, `rcon`, `voice`, `web`, `peer`, `database`, `custom`) rather than hardcoded port numbers. |
| `source` | Upstream asset distribution: SteamCMD, HTTPS archive download, prebuilt Docker image, Git repository, or manual upload. |
| `mods` | Optional multi-source integration with CurseForge, Modrinth, Thunderstore, and Steam Workshop, plus multi-target mod lists (`modListTargets`), ID resolvers (`modIdResolvers`), `iniKey` lists, and `postInstall` (`purgeBefore`). |
| `guardian` | Autonomous health checking, log pattern monitoring, diagnostics, and recovery policies. |

### Source Types

- **`dockerOnly`:** The server software is already bundled inside the container image.
- **`steam`:** Server files are installed and updated automatically via SteamCMD using their Steam AppID.
- **`http`:** MSM downloads and extracts a remote ZIP or TAR archive from a verified HTTPS URL.
- **`github`:** Pulls code repositories directly from Git/GitHub (ideal for Node.js, Python, or Discord bots) with branch selection and automatic pulling.
- **`manualUpload`:** Clean container workspace where users supply required binary packages manually.

### Steam Artwork (`source.steam.artworkAppId`, optional)

`source.steam.appId` is the dedicated-server/tool ID (required for Steam).
Many games use a **different game ID** for their store artwork
(e.g. Project Zomboid: server `380870`, game `108600`). Set the optional
`artworkAppId` to that game ID and the server detail page shows the official
`library_hero.jpg` automatically. Leave it empty when both IDs are identical.

Resolution order (backend, no extra lists to maintain):
`artworkAppId` → `mods.workshopAppId` → `source.steam.appId` → time-of-day
panorama. Custom uploads per game always win and never touch the blueprint
(see `docs/plans/server_wallpapers_architecture_plan.md`).

```json
"source": {
  "type": "steam",
  "steam": { "appId": "380870", "artworkAppId": "108600" }
}
```

---

## Blueprint Example: Non-Steam Application via HTTPS (Hytale)

```json
{
  "version": 1,
  "meta": {
    "id": "hytale",
    "name": "Hytale (Dedicated)",
    "category": "non_steam_game"
  },
  "runtime": {
    "image": "ghcr.io/natroutter/egg-hytale:latest",
    "workdir": "/home/container",
    "env": {
      "STARTUP": "./start.sh",
      "SERVER_PORT": "{GAME_PORT}",
      "AUTH_MODE": "AUTHENTICATED",
      "AUTOMATIC_UPDATE": "1",
      "PATCHLINE": "release"
    },
    "startup": "/entrypoint.sh"
  },
  "ports": [
    { "name": "game", "protocol": "udp" }
  ],
  "source": {
    "type": "http",
    "http": {
      "url": "https://downloader.hytale.com/hytale-downloader.zip",
      "archiveType": "zip"
    }
  }
}
```

---

## Blueprint Example: Autonomous Guardian Discord Bot via GitHub

```json
{
  "version": 1,
  "meta": {
    "id": "discord-bot",
    "name": "Custom Discord Bot",
    "category": "application"
  },
  "runtime": {
    "image": "node:22-alpine",
    "workdir": "/app",
    "env": {
      "NODE_ENV": "production"
    },
    "startup": "npm start"
  },
  "ports": [],
  "source": {
    "type": "github",
    "github": {
      "repository": "my-org/discord-bot",
      "branch": "main",
      "autoPull": true
    }
  },
  "guardian": {
    "health": {
      "intervalSeconds": 60,
      "timeoutSeconds": 5,
      "maxConsecutiveFailures": 3
    },
    "recovery": {
      "autoRestart": true,
      "restartLimitPerHour": 5
    }
  }
}
```

---

## Guardian Engine Integration

Guardian monitoring is an opt-in component declared inside the blueprint's `guardian` configuration block. If any of the `health`, `logs`, `diagnostics`, `recovery`, or `backups` blocks are defined, MSM syncs the Guardian policy contract directly to the node agent managing that container.

- **Crash Loop Detection:** Limits rapid restarts to prevent server exhaustion.
- **Log Pattern Triggers:** Reacts to fatal errors or specific status logs automatically.
- **Port & Socket Probing:** Verifies service responsiveness independently from container exit codes.
- **Graceful Lifecycle Serialization:** Ensures maintenance and recovery actions never collide.

Reference template files are provided under [`docs/templates/`](templates/):
- [`guardian_autonomous_bot.blueprint.json`](templates/guardian_autonomous_bot.blueprint.json): Full autonomous monitoring and recovery configuration.
- [`generic_github_bot.blueprint.json`](templates/generic_github_bot.blueprint.json): Lightweight bot template running without Guardian policies.
- [`standard_steam_server.blueprint.json`](templates/standard_steam_server.blueprint.json): Conservative standard game server blueprint with port monitoring and auto-restart.
