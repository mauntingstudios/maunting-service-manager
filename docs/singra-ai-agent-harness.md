# Singra AI — Complete System Documentation & Technical Manual

**Authoritative Technical Reference**  
**Product**: Singra AI (Autonomous Intelligence & Agentic Platform)  
**Author**: MauntingStudios  
**Version**: 5.1.5+ LTS  
**Security Engine**: Defensive Integration Shield (DIS)  

---

## Table of Contents

1. [Executive Summary & Core Identity](#1-executive-summary--core-identity)
   - 1.1 [What is Singra?](#11-what-is-singra)
   - 1.2 [Name Origin & The Singularity Metaphor](#12-name-origin--the-singularity-metaphor)
   - 1.3 [Operational Architecture Spectrum](#13-operational-architecture-spectrum)
2. [Architecture & Execution Engine (AiRun & Streaming Pipeline)](#2-architecture--execution-engine-airun--streaming-pipeline)
   - 2.1 [The Native Agentic Kernel](#21-the-native-agentic-kernel)
   - 2.2 [Execution Lifecycle Flowchart](#22-execution-lifecycle-flowchart)
   - 2.3 [Execution Guardrails & Hard Constraints](#23-execution-guardrails--hard-constraints)
3. [System Prompt Architecture (`ai_prompt.py`)](#3-system-prompt-architecture-ai_promptpy)
   - 3.1 [Named Modular String Blocks](#31-named-modular-string-blocks)
   - 3.2 [Role Block Matrices (`ROLLEN_BLOECKE`)](#32-role-block-matrices-rollen_bloecke)
   - 3.3 [Filter Sets & Voice Adaptations (`NUR_GETIPPT`)](#33-filter-sets--voice-adaptations-nur_getippt)
   - 3.4 [GPU Prompt Caching & 10% Accounting Rule](#34-gpu-prompt-caching--10-accounting-rule)
   - 3.5 [The Non-Negotiable Axiom: Prompt is Not the Security Boundary](#35-the-non-negotiable-axiom-prompt-is-not-the-security-boundary)
4. [Context Window Engineering & Compaction](#4-context-window-engineering--compaction)
   - 4.1 [Token Calculations & The Per-Role Request Ceiling](#41-token-calculations--the-per-role-request-ceiling)
   - 4.2 [Dual-Tier Context Compaction](#42-dual-tier-context-compaction)
   - 4.3 [Sensitive Data Redaction Pipeline](#43-sensitive-data-redaction-pipeline)
5. [Thinking Levels & Reasoning Engine (Denkstufen)](#5-thinking-levels--reasoning-engine-denkstufen)
6. [Multi-Provider Infrastructure & Token Economics](#6-multi-provider-infrastructure--token-economics)
   - 6.1 [Pluggable Provider Architecture](#61-pluggable-provider-architecture)
   - 6.2 [Local Sovereign Inference (Ollama / vLLM)](#62-local-sovereign-inference-ollama--vllm)
   - 6.3 [Rolling Quota Windows](#63-rolling-quota-windows)
7. [Tool Execution Engine, Autonomy & Origin Boundary Security](#7-tool-execution-engine-autonomy--origin-boundary-security)
   - 7.1 [Strict JSON Schema Invariance](#71-strict-json-schema-invariance)
   - 7.2 [Tool Classification: Read vs. Write & Action Proposals](#72-tool-classification-read-vs-write--action-proposals)
   - 7.3 [Autonomy Grants (`AiAutonomyGrant`)](#73-autonomy-grants-aiautonomygrant)
   - 7.4 [Infinite Loop & Polling Protection (`MAX_GLEICHE_AUFRUFE`)](#74-infinite-loop--polling-protection-max_gleiche_aufrufe)
   - 7.5 [Origin Boundary Security (`herkunft_schnitt`)](#75-origin-boundary-security-herkunft_schnitt)
   - 7.6 [Comprehensive Tool Catalog Across 18 Operational Domains (125 Tools)](#76-comprehensive-tool-catalog-across-18-operational-domains-125-tools)
8. [Model Context Protocol (MCP) Integration](#8-model-context-protocol-mcp-integration)
   - 8.1 [Open Extensibility with MCP](#81-open-extensibility-with-mcp)
   - 8.2 [Dynamic Tool Discovery & Schema Normalization](#82-dynamic-tool-discovery--schema-normalization)
9. [Hierarchical Long-Term Memory Graph & DIS Privacy Shield (Gedächtnis v2)](#9-hierarchical-long-term-memory-graph--dis-privacy-shield-gedächtnis-v2)
   - 9.1 [Memory Entity Hierarchy](#91-memory-entity-hierarchy)
   - 9.2 [The Two-Tier Retrieval Engine](#92-the-two-tier-retrieval-engine)
   - 9.3 [Zero-Knowledge Storage with DIS & Blind HMAC Indexing](#93-zero-knowledge-storage-with-dis--blind-hmac-indexing)
10. [Web Research & SearXNG Search Synthesis](#10-web-research--searxng-search-synthesis)
    - 10.1 [Architecture & Self-Hosted Meta-Search](#101-architecture--self-hosted-meta-search)
    - 10.2 [Query Reformulation & Co-Reference Resolution](#102-query-reformulation--co-reference-resolution)
    - 10.3 [In-Memory Scraping & Inline Citation Attribution](#103-in-memory-scraping--inline-citation-attribution)
    - 10.4 [Ephemeral Zero-Retention Privacy](#104-ephemeral-zero-retention-privacy)
11. [Singra Projects & Autonomous Agentic Development](#11-singra-projects--autonomous-agentic-development)
    - 11.1 [Virtual Filesystem & In-Browser Preview Bundler](#111-virtual-filesystem--in-browser-preview-bundler)
    - 11.2 [Automated Diagnostics, Testing & Visual Inspection](#112-automated-diagnostics-testing--visual-inspection)
    - 11.3 [Git Integration & Token Hygiene](#113-git-integration--token-hygiene)
    - 11.4 [Fullstack Dev Sandbox & Ephemeral Environment Architecture](#114-fullstack-dev-sandbox--ephemeral-environment-architecture)
    - 11.5 [The 13-Phase Zero-Downtime Deployment Pipeline](#115-the-13-phase-zero-downtime-deployment-pipeline)
    - 11.6 [Automated Headless Browser Testing with Playwright](#116-automated-headless-browser-testing-with-playwright)
12. [Real-Time Multimodal Voice & Audio Processing](#12-real-time-multimodal-voice--audio-processing)
    - 12.1 [Dual-Transport Voice Architecture](#121-dual-transport-voice-architecture)
    - 12.2 [Speculative UI Dispatching](#122-speculative-ui-dispatching)
    - 12.3 [Conversational Etiquette & Verbal Bridging](#123-conversational-etiquette--verbal-bridging)
13. [Maunting Smart System (MSS) Desktop Companion](#13-maunting-smart-system-mss-desktop-companion)
    - 13.1 [Native Rust/Tauri Architecture](#131-native-rusttauri-architecture)
    - 13.2 [Offline Wake-Word: "Singra"](#132-offline-wake-word-singra)
    - 13.3 [Click-Through Floating Particle Swarm Overlay](#133-click-through-floating-particle-swarm-overlay)
    - 13.4 [Cryptographic Device Pairing](#134-cryptographic-device-pairing)
14. [Autonomous Background Workers, Tasks & Guardian Watchdog](#14-autonomous-background-workers-tasks--guardian-watchdog)
    - 14.1 [Autonomous Task Engine (`AiTask`) & Skills (`AiSkill`)](#141-autonomous-task-engine-aitask--skills-aiskill)
    - 14.2 [Guardian Watchdog & Self-Healing Repairs](#142-guardian-watchdog--self-healing-repairs)
15. [Architectural Rationale: Why Singra is Built This Way](#15-architectural-rationale-why-singra-is-built-this-way)

---

## 1. Executive Summary & Core Identity

### 1.1 What is Singra?
**Singra** is the unified, enterprise-grade artificial intelligence and autonomous agent harness developed by MauntingStudios. Deeply integrated into the core architecture of Maunting Server Manager (MSM), Singra functions as an operational intelligence rather than a cosmetic chatbot wrapper.

Singra bridges high-level semantic reasoning with direct, low-level execution: managing container lifecycles, diagnosing complex game server logs, provisioning PostgreSQL databases, running fullstack coding environments, maintaining end-to-end encrypted long-term memory, and executing real-time voice interactions.

The AI is formally and immutably named **Singra** across all layers of the stack:
- **Backend constant:** Defined uniquely in `backend/services/ai_prompt.py` as `KI_NAME = "Singra"`.
- **System prompt identity:** Singra introduces herself strictly under this identity using feminine pronouns ("sie").
- **Desktop wake-word:** The Maunting Smart System (MSS) desktop companion recognizes the spoken wake-word `"Singra"` with local acoustic calibration.
- **Permanent deprecation:** Previous configurable agent alias settings (`users.agent_name`) were permanently removed in database migration `20261005_01`.

### 1.2 Name Origin & The Singularity Metaphor
The name **Singra** is derived directly from **Gravitational Singularity** (*Singularität des Schwarzen Lochs*) — the astrophysical phenomenon of infinite density where all physical paths converge, established classical physical laws cease to apply, and something fundamentally new emerges.

Historically, the AI was conceived under the internal working title **AEGIS** (symbolizing defense and protective armor) before being redefined and unified as **Singra**.

In the context of the MSM agent harness, the singularity metaphor defines a critical architectural boundary:
1. **The End of Deterministic Code**: Classical server management relies on deterministic scripts and rigid `if/else` branching. When an unexpected container error, an unhandled exception in a modloader, or a novel network topology occurs, deterministic software breaks down and fails closed.
2. **The Singularity Threshold**: Singra represents the point where deterministic programming ends and autonomous emergent intelligence begins. The harness provides the gravitational well where telemetry, logs, configuration files, long-term memory, and web research converge into unified reasoning.
3. **Emergence & Self-Healing**: Where a classical script crashes, Singra analyzes the stack trace, forms hypotheses, tests solutions using safe read tools, and executes self-healing remediation routines.

### 1.3 Operational Architecture Spectrum
Singra operates across three tightly integrated execution environments:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Singra AI Agent Harness (MSM)                      │
└──────┬──────────────────────────────┬────────────────────────────┬──────┘
       │                              │                            │
       ▼                              ▼                            ▼
┌──────────────┐               ┌──────────────┐             ┌──────────────┐
│  Web Panel   │               │ MSS Desktop  │             │   Headless   │
│ (Chat, Voice,│               │ (Rust/Tauri, │             │ Background   │
│  Projects IDE)               │  Takeover)   │             │   Workers    │
└──────┬───────┘               └──────┬───────┘             └──────┬───────┘
       │                              │                            │
       └──────────────────────────────┼────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Unified Agentic Core Runtime                        │
│   (AiRun · ai_stream · ai_tool_registry · DIS Shield · Gedächtnis v2)   │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Web Management Panel**: Fullstack browser operations, reactive Server-Sent Events (SSE) chat, WebRTC voice stream, and the sandboxed Singra Projects IDE.
2. **Maunting Smart System (MSS) Desktop Companion**: Native desktop application with 100% offline local wake-word detection, particle swarm visualizer, and hardware-level desktop interaction controls.
3. **Headless Background Workers & Guardian**: Autonomous asynchronous task execution (`AiTask`), scheduled maintenance, and continuous watchdog monitoring without an active user session.

---

## 2. Architecture & Execution Engine (AiRun & Streaming Pipeline)

### 2.1 The Native Agentic Kernel
MSM deliberately avoids external orchestration frameworks (such as LangGraph, AutoGen, CrewAI, or Pipecat). Instead, MSM implements a custom, tightly coupled agentic execution runtime tailored to production server operations:

- **Persistent Execution (`AiRun`)**: Every interaction (chat prompt, voice command, background worker step) instantiates an `AiRun` record in PostgreSQL (`models/ai_run.py`). The run persists its lifecycle state (`created`, `streaming`, `waiting_confirmation`, `executing_tools`, `completed`, `failed`), role, provider parameters, tool execution trace, token usage, and error boundary.
- **Live Event Broker (`ai_run_broker`)**: An in-memory asynchronous publish/subscribe broker decoupled from HTTP and WebSocket handlers (`services/ai_run_broker.py`). It publishes real-time run snapshots, incremental text chunks, tool invocation intents, and proposal events. If a user disconnects or refreshes their browser tab, the run continues executing on the backend; the client reconnects to the broker stream seamlessly without losing execution state.
- **Segment Execution Pipeline (`ai_stream.engine`)**: Manages the iterative conversation loop between the model and tool execution.

### 2.2 Execution Lifecycle Flowchart

```
User Input (Chat / Voice / API)
              │
              ▼
    ai_chat / ai_voice
 (Auth Check, Permission Gate,
  Input Redaction, Token Check)
              │
              ▼
      AiRun Instantiation
  (State: INITIALIZING, DB Lock)
              │
              ▼
   ai_stream.launcher.start
 (Assemble Context, Memory, System
  Prompt, Tools & Thinking Level)
              │
              ▼
┌──────────────────────────────────┐
│        Provider Stream Loop      │◄─────────────────────────┐
│    (OpenAI / Anthropic / Gemini) │                          │
└─────────────────┬────────────────┘                          │
                  │                                           │
         Tool Call Emitted?                                   │
         ├── NO ──> Stream Tokens to ai_run_broker ──> Done   │
         │                                                    │
         └── YES                                              │
              │                                               │
              ▼                                               │
    ai_tool_registry Dispatch                                 │
 (Validate Schema, Check Role,                                │
  Enforce Origin herkunft_schnitt)                            │
              │                                               │
     Tool Classification                                      │
     ├── READ TOOL ───────────────────────────────────────────┤
     │   (Execute immediately, collect up to 48k chars,       │
     │    feed result to next provider round)                 │
     │                                                        │
     └── WRITE TOOL                                           │
         ├── Active AiAutonomyGrant?                          │
         │   ├── YES ──> Execute immediately ─────────────────┘
         │   └── NO  ──> Generate AiActionProposal Card
         │               State: AWAITING_APPROVAL
         │               (Yield execution until human approves)
```

### 2.3 Execution Guardrails & Hard Constraints
To protect infrastructure and budgets against runaway models, Singra enforces strict, hard-coded limits (`backend/services/ai_stream/types.py`):

| Parameter | Value | Operational Purpose |
|---|---|---|
| `MAX_TOOL_RESULT_CHARS_PER_ROUND` | 48,000 (~12,000 tokens) | Prevents bulky logs from overflowing the context window in a single round. Excess tool results are deferred to subsequent rounds. |
| `MAX_TOOL_CALLS` | 64 per round | Emergency circuit-breaker. Any single turn attempting >64 tool calls is aborted as a malfunction rather than a legitimate plan. |
| `MAX_TOOL_ROUNDS` | 48 rounds | Maximum read-tool iterations per run. Ensures multi-step diagnostic and setup workflows complete end-to-end without artificial mid-way cutoffs. |
| `MAX_WRITE_ROUNDS` | 24 rounds | Maximum write-tool iterations per run. Allows complex, multi-phase setup routines (create, configure, start, verify, retry) while capping destructive risk. |
| `WERKZEUG_ZEITGRENZE` | 60.0 seconds | Per-tool timeout. Prevents hung network sockets or locked database queries from indefinitely stalling the entire stream. |
| `MAX_GLEICHE_AUFRUFE` | 4 identical calls | Infinite loop detection. If a model invokes the same tool with identical arguments 4 times without progress, the fifth call is rejected with an explanatory prompt. |
| `MAX_GLEICHE_POLLING_AUFRUFE` | 8 calls | Dedicated loop ceiling for status polling tools (`POLLING_WERKZEUGE = {"read_server_status", "read_server_logs", "check_server_reachability"}`). |

---

## 3. System Prompt Architecture (`ai_prompt.py`)

Singra's system prompt (`backend/services/ai_prompt.py`) is engineered as a modular, block-structured compilation matrix rather than a monolithic string. This architecture prevents syntax errors, ensures strict separation of concerns, and optimizes provider GPU prompt caching.

### 3.1 Named Modular String Blocks
Each behavioural rule is encapsulated in a standalone constant:

- **`ROLLE`**: Establishes core identity as Singra, managing server operations, configurations, mods, networks, and general inquiries without unwarranted caution refusals.
- **`IDENTITAET`**: Immutable identity block. Mandates feminine pronouns ("sie"), explains the Black Hole Singularity origin, declares the underlying LLM as interchangeable technology, and forbids renaming upon user request.
- **`HALTUNG`**: Professional demeanor: calm, direct, to the point. Strictly forbids sycophantic affirmations ("Sure, I can help with that!"), fake enthusiasm, and editorial throat-clearing ("Here is an overview:"). Requires natural sentence variation and sparing use of em-dashes.
- **`FORMAT`**: Markdown formatting instructions. Forbids artificial templates (introduction, body, conclusion, bullets); structure must arise organically from the data. Excluded in voice mode.
- **`ZEITANSAGE`**: Forbids proactive date and time announcements. The clock is an internal computation tool, not spoken prose.
- **`EINZELCHAT`**: Directives for continuous single-conversation sessions. Forbids dragging historical server issues into new unrelated inquiries.
- **`MITREDEN`**: Conversational bridging. Singra utters a brief, natural introductory sentence before executing tools, keeping the user informed without exposing internal tool names.
- **`GEHIRN_QUITTUNG` & `GEHIRN_EINWURF`**: Tailored behavioral blocks for the "Gehirn" role. Emits short acknowledgments when delegating background work and handles incoming worker results with natural conversational interjections ("Ach, übrigens...").
- **`BUENDELN`**: Enforces parallel execution. Independent tool calls (e.g. status, ports, and backups across three servers) must be dispatched simultaneously in a single round rather than sequentially.
- **`KEIN_STUMMER_ZUG`**: Forbids silent turns. Even when submitting action proposals or asking clarifying questions, an explanatory sentence must precede the action.
- **`BELEGE`**: Evidence over transcripts. Models must never copy entire log files into responses. Instead, Singra extracts 1 to 5 relevant lines into a code block and explains their operational meaning underneath.
- **`RUECKFRAGEN` & `ERMESSEN`**: High threshold for user questions. Questions are permitted only for irreversible decisions or genuine ambiguities. When a user defines high-level goals ("Set up a casual DayZ server"), Singra decides concrete parameters (RAM, CPU, ports) autonomously and presents them in the result.
- **`PROAKTIV` & `AGENTIC_LOOP_SELF_HEALING`**: Autonomous multi-step problem solving. If a tool returns an error or empty result, Singra analyzes the error, adjusts arguments, reads missing dependencies, and retries in the next turn without apologizing.
- **`AUFTRAEGE`**: Comprehensive definition of "set up" (*einrichten*) across 6 mandatory verification steps: version resolution, blueprint adaptation, node capacity inspection, server creation, DNS configuration, and log-based runtime proof.
- **Domain Blocks**: Dedicated instruction modules for `DATENBANKSERVER`, `DATENBANK_STUDIO`, `KAPAZITAET`, `SERVERBEZUG`, `AUDIT`, `WERKZEUGE`, `DOKUMENTATION`, `DATEIEN`, `PROJEKTE_UND_CODING`, `BLUEPRINTS`, `MODS`, `ERREICHBARKEIT`, `WEBSUCHE`, `REGIONSANALYSE`, `UNWIDERRUFLICHES`, `POSTFACH_UND_KALENDER`, `POPUPS_UND_ANKUENDIGUNGEN`, `NOTIZEN`, `DATEIANHAENGE`, `MESSENGER`, `CLOUDFLARE`, `BENUTZER_UND_RECHTE`, `GEDAECHTNIS`, `SPRECHWEISE`, `SKILLS`, `GEHEIMNISSE`, `UNTRUSTED`, `GUARDIAN`, and `AUFGABEN`.

### 3.2 Role Block Matrices (`ROLLEN_BLOECKE`)
The system compiles prompt blocks into role-specific matrices:

```python
ROLLEN_BLOECKE = {
    "voll": BLOECKE,
    "gehirn": GEHIRN_BLOECKE,
    "worker": WORKER_BLOECKE,
    "realtime": REALTIME_BLOECKE,
    "live": LIVE_BLOECKE,
}
```

- **`voll`**: The complete block tuple for interactive single-model operations.
- **`gehirn`**: High-level reasoning persona. Replaces direct write tools with worker delegation (`worker_start`), using `GEHIRN_QUITTUNG` and `GEHIRN_EINWURF`.
- **`worker`**: Autonomous background task agent. Excludes human-facing conversational blocks (`NICHT_IM_WORKER = {EINZELCHAT, RUECKFRAGEN, GEDAECHTNIS, HALTUNG, IDENTITAET, SPRECHWEISE, GUARDIAN}`) and appends the dedicated `WORKER` block.
- **`realtime`**: Voice mode session matrix.
- **`live`**: Backend assistant driving external voice models (`LIVE_BLOECKE = REALTIME_BLOECKE \ {MITREDEN, BELEGE}` with `HINTER_DER_STIMME`).

### 3.3 Filter Sets & Voice Adaptations (`NUR_GETIPPT`)
To prevent spoken channels from attempting to vocalize formatting syntax, Singra filters blocks:

- **`NUR_GETIPPT = frozenset({FORMAT, GUARDIAN})`**: Excluded from voice sessions. Strips Markdown formatting rules and non-interactive guardian loops.
- **`GESPROCHEN` & `ZUSTIMMUNG_GESPROCHEN`**: Spoken-mode suffix appended to the prompt. Directs the model to output fluid prose without bullet points, round large numbers into words ("about two gigabytes"), and format code blocks exclusively for visual display cards on screen.
- **`HINTER_DER_STIMME`**: Directives for backend models operating behind OpenAI GPT-Live or speech synthesis pipelines.

### 3.4 GPU Prompt Caching & 10% Accounting Rule
Modern frontier LLMs cache prompt prefixes on provider GPUs. To maximize cache hits:
1. Singra places static prompt blocks at the absolute start of the prompt payload (`backend/services/ai_context_service.py`).
2. The static prefix remains byte-identical across requests.
3. In `backend/services/ai_usage_service.py`, cached input tokens are billed at only 10% (`CACHE_ANRECHNUNG_PROZENT = 10`):

$$\text{Angerechnete Tokens} = \text{Echte Tokens} \times 0.10$$

This discounted rate is reflected across user quotas and billing dashboards, preventing unfair exhaustion of token limits.

### 3.5 The Non-Negotiable Axiom: Prompt is Not the Security Boundary
Singra enforces a foundational engineering principle:

> **"Der Prompt ist nicht die Sicherheitsgrenze." (The prompt is not the security boundary.)**

System prompts provide behavioral guidance and prevent model confusion; they are **never** trusted as an access control mechanism. Mechanical security boundaries are enforced exclusively by the backend kernel:
1. **RBAC Permissions**: Evaluated by `permission_service.py` before any tool schema is presented to the model.
2. **Origin Allowlist (`herkunft_schnitt`)**: Enforces token-level capability constraints based on client type.
3. **Server Resolution (`_resolve_server`)**: Validates database ownership and user permissions for every target `server_id`.
4. **Mandatory Action Approval**: Write tools pause execution and generate persistent `AiActionProposal` records requiring explicit human approval.

---

## 4. Context Window Engineering & Compaction

### 4.1 Token Calculations & The Per-Role Request Ceiling
Uncontrolled context window growth degrades model reasoning ("needle-in-a-haystack" degradation) and inflates operational costs. Singra implements deterministic context budgeting (`services/ai_context_window.py`):
- **Universal Character-to-Token Ratio (`ZEICHEN_JE_TOKEN = 4`)**: Rapid token estimation without heavy tokenizer libraries.
- **German Safety Factor (`SICHERHEIT = 0.9`)**: Accommodates compound German nouns (Komposita) and dense JSON payloads (~3.6 chars/token).
- **The Per-Role Input Ceiling (`max_context_tokens`, default `ANFRAGE_DECKEL_TOKENS = 44,000`)**: Input payloads are clamped regardless of advertised provider limits (e.g. 1M+ tokens). The ceiling lives on the role ("Roles & quotas", 44,000 to 1,000,000 tokens); without an entry, 44,000 applies. The model window remains an additional hard limit.
- **Output Reservation (`RESERVE_AUSGABE_TOKENS = 8,192`)**: Dedicated headroom for code generation and multi-file project synthesis.

### 4.2 Dual-Tier Context Compaction
When context size reaches the configured threshold (`ai_context_compaction_percent`, default 75%), Singra triggers automated context folding (`ai_compaction_service.py`):
1. **Anchor Retention**: Core system prompts, user identity, active project metadata, and pinned memories remain permanently anchored.
2. **Intermediate Folding**: Historical message turns and bulky tool outputs are summarized into a concise, factual representation.
3. **Recent Window Preservation**: The most recent 4 to 8 turns are preserved verbatim.

### 4.3 Sensitive Data Redaction Pipeline
Before any text enters the context assembler (`ai_context_service.py`), it passes through `ai_redaction.py`:
- Detects API keys (`sk-...`, `ghp_...`), JWT bearer tokens, SSH private keys, database passwords, and session cookies.
- Replaces secrets with cryptographic placeholders (`[REDACTED_SECRET_#]`), ensuring upstream LLM providers never receive plaintext infrastructure credentials.

---

## 5. Thinking Levels & Reasoning Engine (Denkstufen)

Singra provides four runtime thinking levels (`Denkstufen`), selectable per session:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Singra Thinking Levels                          │
├───────────────┬────────────────┬───────────────────┬───────────────────┤
│    Schnell    │   Durchdacht   │    Tiefgründig    │  Benutzerdefiniert│
│  (Zero-Shot)  │  (Multi-Step)  │ (Full Synthesis)  │ (Custom Overrides)│
└───────────────┴────────────────┴───────────────────┴───────────────────┘
```

1. **Schnell (Fast)**:
   - Optimized for instant, low-latency execution and simple lookups.
   - Temperature: ~0.2. Tool loops capped at 2 iterations.
2. **Durchdacht (Thoughtful — Default)**:
   - Balanced general-purpose operational mode.
   - Temperature: ~0.4. Multi-turn tool reasoning with autonomous error recovery.
3. **Tiefgründig (Deep Reasoning)**:
   - Extended reasoning for complex refactoring, multi-codebase bug triage, and root-cause analysis.
   - Activates extended reasoning tokens (OpenAI o-series, Claude Thinking).
4. **Benutzerdefiniert (Custom)**:
   - Administrative overrides for temperature, top_p, and custom prompt injections.

---

## 6. Multi-Provider Infrastructure & Token Economics

### 6.1 Pluggable Provider Architecture
Singra features a modular provider registry (`backend/services/ai_provider_registry/`):
- **Commercial APIs**: OpenAI (GPT-4o, GPT-5/Luna, o1/o3), Anthropic / Azure Anthropic (Claude 3.5 Sonnet, Claude 3.5 Haiku), Azure OpenAI, Google (Gemini 1.5 Pro, Gemini 2.0 Flash), OpenRouter, and ElevenLabs (speech synthesis).
- **Elimination of SSRF Risk**: Base URLs are defined as constants within provider modules. For Azure instances requiring custom endpoints, only a single validated DNS label is accepted via strict regex (`_assert_ressource`), completely preventing Server-Side Request Forgery (SSRF).

### 6.2 Local Sovereign Inference (Ollama / vLLM)
For air-gapped or privacy-restricted sovereign deployments, Singra integrates local inference engines via `backend/services/openai_compatible_adapter.py`. Local models (Ollama, vLLM, llama.cpp) provide complete offline autonomy without external API dependencies.

### 6.3 Rolling Quota Windows
Token limits are enforced across rolling temporal windows (`services/ai_limit_service.py`):
- `FENSTER_TAG`: Rolling 24 hours.
- `FENSTER_WOCHE`: Rolling 7 days.
- `FENSTER_MONAT`: Rolling 30 days.  
This eliminates arbitrary end-of-month quota cliffs.

---

## 7. Tool Execution Engine, Autonomy & Origin Boundary Security

### 7.1 Strict JSON Schema Invariance
Every tool registered in `ai_tool_registry.py` must define a strictly typed JSON Schema with `type: "object"` and an explicit `properties` dictionary. Modern reasoning models (`gpt-5.6-luna`, Claude Tool Use) reject malformed schemas with `400 Bad Request`. Singra's tool compiler validates all 125+ schemas at application boot.

### 7.2 Tool Classification: Read vs. Write & Action Proposals
Singra strictly separates tools into two operational classes:
- **Read Tools**: Non-mutating queries (reading server status, checking logs, searching documentation). Executed immediately and autonomously.
- **Write Tools (`SCHREIBWERKZEUGE`)**: Mutating actions (modifying configurations, starting/stopping containers, editing files, sending emails, database DDL). By default, write tools pause execution and emit an interactive `AiActionProposal` card in the UI showing the exact planned diff or shell command for human approval.

### 7.3 Autonomy Grants (`AiAutonomyGrant`)
Administrators can grant Singra autonomous execution rights for specific tool categories (e.g. personal notes, calendar entries, non-destructive file edits) for a designated duration (e.g. 1 hour). Even with autonomy active, high-risk operations (server deletion, database drops) permanently mandate manual confirmation.

### 7.4 Infinite Loop & Polling Protection (`MAX_GLEICHE_AUFRUFE`)
To prevent models from becoming stuck in repetitive tool loops:
- **Standard Tools (`MAX_GLEICHE_AUFRUFE = 4`)**: If a model invokes the same tool with identical arguments 4 times without progress, the 5th attempt is rejected with an explanatory guidance prompt.
- **Polling Tools (`MAX_GLEICHE_POLLING_AUFRUFE = 8`)**: Dedicated allowance for container boot monitoring tools (`POLLING_WERKZEUGE = {"read_server_status", "read_server_logs", "check_server_reachability"}`).

### 7.5 Origin Boundary Security (`herkunft_schnitt`)
Tool privileges are strictly isolated by operational origin:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Origin Boundary Isolation                       │
├──────────────────────┬─────────────────────────────────────────────────┤
│ Origin               │ Permitted Tool Capabilities                     │
├──────────────────────┼─────────────────────────────────────────────────┤
│ Web Browser Panel    │ Server management, Database queries, Projects,   │
│                      │ Web research, Mail, Calendar, Chat tools.       │
│                      │ BLOCKED: Local desktop mouse/keyboard takeover. │
├──────────────────────┼─────────────────────────────────────────────────┤
│ MSS Desktop App      │ All Web Panel tools PLUS:                       │
│                      │ Local desktop takeover (Mouse/Keyboard),        │
│                      │ Local workstation sandbox filesystem.           │
├──────────────────────┼─────────────────────────────────────────────────┤
│ Headless Worker      │ Scheduled tasks, Health monitoring, Guardian.   │
│                      │ BLOCKED: Interactive prompts, Desktop takeover. │
└──────────────────────┴─────────────────────────────────────────────────┘
```


### 7.6 Comprehensive Tool Catalog Across 18 Operational Domains (125 Tools)

Singra registers exactly 125 tools in `backend/services/ai_tool_registry.py` covering all infrastructure and operational scopes:

#### 7.6.1 Server Operations & Lifecycle (9 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `list_my_servers` | Global Read | *None* | `query`, `status_filter` | Lists all servers accessible to the calling user. Resolves server IDs required for subsequent server-specific tool calls. |
| `read_server_status` | Server Read | `server.view` | `server_id` | Fetches container run-state, PID, uptime, memory usage, CPU load, and healthcheck status. |
| `read_server_capacity` | Server Read | `server.view` | `server_id` | Inspects allocated RAM, CPU quota, disk usage, and host capacity thresholds. |
| `read_server_logs` | Server Read | `server.logs.view` | `server_id`, `lines`, `tail` | Reads the most recent container log output (up to 1,000 lines). Essential for crash diagnosis. Output is redacted for passwords/tokens. |
| `execute_server_action` | Server Write | `server.power.control` | `server_id`, `action`, `rationale` | Triggers container power actions (`start`, `stop`, `restart`, `kill`). Handled via action proposals. |
| `propose_server_lifecycle` | Server Write | `server.power.control` | `server_id`, `action`, `timeout`, `rationale` | Formal proposal for server power cycle with custom graceful termination timeouts. |
| `propose_server_repair` | Server Write | `server.power.control` | `server_id`, `repair_action`, `rationale` | Initiates automated repair routines (rebuilding container, resetting broken volume permissions, re-pulling image). |
| `propose_server_create` | Global Write | `panel.servers.create` | `name`, `blueprint_id`, `node_id`, `ram_mb`, `ports`, `rationale` | Creates a new server from an existing blueprint definition on a specific host node. |
| `propose_server_delete` | Server Write | `server.delete` | `server_id`, `delete_volumes`, `rationale` | Deletes a server instance. Irreversible; always mandates explicit interactive confirmation. |

#### 7.6.2 Server Configuration & Files (7 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `read_config` | Server Read | `server.files.read` | `server_id`, `file_path`, `max_lines` | Reads server config files (`.env`, `.ini`, `.json`, `.yml`, `.properties`). Sandboxed within container data root. |
| `list_server_files` | Server Read | `server.files.read` | `server_id`, `directory`, `depth` | Lists directory trees. Directory traversal (`..`) is strictly blocked. |
| `search_server_files` | Server Read | `server.files.read` | `server_id`, `query`, `file_pattern` | High-speed regex or substring search across configuration and data files. |
| `propose_config_set` | Server Write | `server.files.write` | `server_id`, `file_path`, `content`, `rationale` | Replaces an entire configuration file with new content. Creates a pre-modification backup. |
| `propose_config_update` | Server Write | `server.files.write` | `server_id`, `file_path`, `updates`, `rationale` | Updates specific key-value pairs in `.ini`, `.env`, or `.properties` files without altering comments or surrounding lines. |
| `propose_config_patch` | Server Write | `server.files.write` | `server_id`, `file_path`, `find`, `replace`, `rationale` | Performs surgical search-and-replace patches on large files. Prevents accidental truncation of large config files. |
| `propose_file_delete` | Server Write | `server.files.write` | `server_id`, `file_path`, `rationale` | Deletes a specified file inside the server directory. Guarded against deleting critical system mounts. |

#### 7.6.3 Generic Multi-Game Mods & Modpacks (8 Tools)
*Architectural Invariant:* Single-game hardcoding (e.g., fixing CurseForge Minecraft game ID `432`) is strictly forbidden. All mod operations dynamically query platform game registries to support Minecraft, ARK, Palworld, Valheim, Factorio, and future blueprint games uniformly.

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `read_server_mods` | Server Read | `server.mods.view` | `server_id` | Inspects currently installed mods, enabled/disabled states, versions, and filenames. |
| `read_mod_updates` | Server Read | `server.mods.view` | `server_id` | Compares installed mod versions against CurseForge/Modrinth upstream releases. |
| `search_curseforge_mods` | Global Read | `ai.mods.search` | `query`, `game_id`, `category` | Searches individual mods on CurseForge by keyword or topic (e.g., 'optimization', 'minimap'). |
| `search_curseforge_modpacks` | Global Read | `ai.mods.search` | `query`, `game_id`, `page` | Searches complete modpacks across supported game categories. |
| `search_workshop_mods` | Global Read | `ai.mods.search` | `query`, `app_id` | Searches Steam Workshop items for Steam-based dedicated servers. |
| `propose_mod_install` | Server Write | `server.mods.manage` | `server_id`, `mod_id`, `file_id`, `rationale` | Downloads and installs a specific mod file into the server's mod directory. |
| `propose_mod_toggle` | Server Write | `server.mods.manage` | `server_id`, `mod_filename`, `enable`, `rationale` | Renames mod files (e.g., appending `.disabled`) to toggle active state without deleting files. |
| `propose_modpack_install` | Global Write | `server.mods.manage` | `server_id`, `modpack_id`, `file_id`, `rationale` | Performs automated modpack installation, handling overrides, configs, and dependency resolution. |

#### 7.6.4 Network, Ports & Cloudflare DNS (8 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `read_server_network` | Server Read | `server.network.view` | `server_id` | Inspects internal bridge IP, public IP, bound interface, and port mappings. |
| `read_server_ports` | Server Read | `server.network.view` | `server_id` | Checks container port bindings, protocols (TCP/UDP), and host port allocations. |
| `check_server_reachability` | Server Read | `server.network.view` | `server_id`, `port` | Performs an external TCP/UDP socket ping to verify firewall reachability from the outside. |
| `propose_bind_ip_update` | Server Write | `server.network.manage` | `server_id`, `bind_ip`, `rationale` | Rebinds a server container to a specific public or internal IP address on multi-homed nodes. |
| `cloudflare_list_zones` | Global Read | `ai.cloudflare.read` | *None* | Retrieves available DNS zones from configured Cloudflare API integrations. |
| `cloudflare_list_dns_records` | Global Read | `ai.cloudflare.read` | `zone_id` | Lists existing DNS A, AAAA, CNAME, and SRV records to verify collisions before proposing new records. |
| `propose_cloudflare_dns_record` | Global Write | `ai.cloudflare.manage` | `zone_id`, `type`, `name`, `content`, `ttl`, `proxied`, `rationale` | Proposes creating or updating a Cloudflare DNS record for server domains. |
| `propose_cloudflare_dns_delete` | Global Write | `ai.cloudflare.manage` | `zone_id`, `record_id`, `rationale` | Proposes deleting a Cloudflare DNS record. |

#### 7.6.5 Backups & Disaster Recovery (5 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `read_server_backups` | Server Read | `server.backups.view` | `server_id` | Lists existing snapshots, archive sizes, timestamps, and integrity status. |
| `propose_backup` | Server Write | `server.backups.create` | `server_id`, `name`, `rationale` | Creates an immediate compressed backup archive of the server's persistent volumes. |
| `propose_backup_restore` | Server Write | `server.backups.restore` | `server_id`, `backup_id`, `rationale` | Restores a server snapshot. Stops container, restores file tree, and verifies data integrity. |
| `propose_backup_schedule_set` | Server Write | `server.backups.manage` | `server_id`, `cron_expression`, `retention`, `rationale` | Configures automated backup schedules and retention horizons. |
| `propose_restart_schedule_set` | Server Write | `server.power.manage` | `server_id`, `cron_expression`, `rationale` | Configures automated maintenance restarts (e.g., daily memory clear at 04:00). |

#### 7.6.6 Nodes & Blueprints (8 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `read_node_capacity` | Global Read | `panel.nodes.view` | `node_id` | Inspects host CPU cores, total RAM, disk arrays, and current container density. |
| `read_node_health` | Global Read | `panel.nodes.view` | `node_id` | Retrieves host daemon status, load averages, temperature, and Docker socket health. |
| `advise_node_placement` | Global Read | `panel.nodes.view` | `required_ram`, `required_cpu`, `game_slug` | Evaluates node telemetry to recommend the optimal host node for placing a new server instance. |
| `list_blueprints` | Global Read | `panel.blueprints.view` | `category` | Lists native and community blueprint templates registered in the system. |
| `read_blueprint` | Global Read | `panel.blueprints.view` | `blueprint_id` | Reads the declarative JSON specification of a blueprint (image, environment, ports, mount points). |
| `propose_blueprint_change` | Global Write | `panel.blueprints.manage` | `blueprint_id`, `patch`, `rationale` | Updates blueprint settings. Enforces blueprint safety invariants (no shell hooks, no root privilege). |
| `propose_blueprint_delete` | Global Write | `panel.blueprints.manage` | `blueprint_id`, `rationale` | Removes a custom blueprint template. Blocked if active server instances depend on it. |
| `propose_server_blueprint_switch` | Server Write | `server.edit` | `server_id`, `new_blueprint_id`, `rationale` | Migrates a server to an updated blueprint definition while preserving volume data. |

#### 7.6.7 PostgreSQL Database Studio (2 Tools, 14 Operational Views)
Singra interfaces directly with the panel's native PostgreSQL Studio (`services/postgres_studio_service.py`), utilizing the exact same Pydantic schema validation as the visual UI.

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `read_database` | Server Read | `server.databases.read` (`server.databases.admin` for admin views) | `server_id`, `database_id`, `view`, `target` | Inspects database structure. Supported views: `overview`, `objects`, `table`, `function`, `extensions`, `roles`, `grants`, `health`, `rows`, `operations`, `operation_schema`, and admin views (`parameters`, `sessions`, `locks`). |
| `propose_database_change` | Server Write | `server.databases.admin` | `server_id`, `database_id`, `operation`, `rationale` | Compiles and executes structured DDL operations (`create_table`, `add_column`, `alter_column`, `create_index`, `drop_table`) using `postgres_ddl.compile_operation`. |

#### 7.6.8 Singra Coding Platform, Projects & Sandbox (2 Tools, 26 Sub-Actions)
Singra is equipped with an integrated development and deployment studio (`backend/services/singra/`).

#### `project_create`
- **Type:** Global Write (`ai.projects.create`)
- **Parameters:** `name`, `description`, `project_kind` (`coding`, `docs`, `general`), `framework` (`html`, `react`, `fullstack`).
- **Function:** Initializes a new AI Project record (`AiProject`), creates a virtual workspace directory, and configures default project files.

#### `project_workspace`
- **Type:** Dynamic (Read/Write depending on action)
- **Parameters:** `action`, `project_id`, `path`, `content`, `find`, `replace`, `command`, `sql`, `environment`, etc.
- **Supported Actions:**
  1. `list_projects`: Lists all coding projects belonging to the user or team.
  2. `create_project`: Programmatic alternative to `project_create`.
  3. `list_files`: Enumerates virtual project files and directory hierarchy.
  4. `read_file`: Reads full UTF-8 text content of a project file.
  5. `write_file`: Writes or overwrites a project file, updating file hashes and timestamps.
  6. `patch_file`: Performs surgical text replacements (`find` / `replace` blocks) on existing files.
  7. `delete_file`: Removes a file from the project tree.
  8. `configure_preview`: Sets entrypoint file (`index.html`, `src/App.tsx`) and viewport options.
  9. `preview_inspect`: Inspects headless browser console logs, DOM errors, and network failures.
  10. `test_project`: Triggers automated unit and lint test runs.
  11. `run_command`: Executes sandboxed development commands inside the project's dev container.
  12. `get_environment`: Inspects assigned dev ports, database credentials, and container states.
  13. `publish_production`: Initiates the automated 13-phase zero-downtime deployment pipeline.
  14. `search_components`: Discovers UI components, hooks, and design tokens across the project.
  15. `run_sql`: Executes SQL queries against the project's dedicated dev or prod PostgreSQL database.
  16. `db_status`: Checks connection state, migration version, and table count of project databases.
  17. `db_tables`: Enumerates tables, column types, and foreign key relationships.
  18. `db_rows`: Reads row data from a specific table with limit and pagination.
  19. `apply_migrations`: Safely applies pending Alembic or custom SQL schema migrations.
  20. `git_status`: Inspects working tree diffs, staged files, and branch pointers.
  21. `git_sync`: Fetches and rebases against upstream Git remote branches.
  22. `git_commit`: Stages files and creates a signed commit. Git credentials are passed via ephemeral process environments (`GIT_CONFIG_KEY_*`) and never saved in URLs.
  23. `dev_start`: Spins up ephemeral dev backend and frontend containers with live reload.
  24. `dev_stop`: Pauses dev containers to free system RAM.
  25. `dev_status`: Returns runtime status and health metrics of dev containers.
  26. `git_branch`, `git_open_pr`, `merge_to_main`: Manages branch lifecycles and pull request reviews.

#### 7.6.9 Rich Text Documents Engine (11 Tools)
Allows Singra to collaborate on Word-like rich text documents, contracts, architecture notes, and documentation inside MSM.

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `list_documents` | Global Read | `docs.use` | `folder_id`, `query` | Lists collaborative documents accessible to the user. |
| `read_document` | Global Read | `docs.use` | `document_id` | Reads the full content and metadata of a rich text document. |
| `read_document_structure` | Global Read | `docs.use` | `document_id` | Returns the outline, heading hierarchy, and section blocks. |
| `read_document_selection` | Global Read | `docs.use` | `document_id`, `selection_range` | Reads the text currently highlighted or selected by the user in the UI. |
| `read_document_skill` | Global Read | `docs.use` | `document_id` | Reads document-specific instructions or formatting guidelines. |
| `edit_document` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `operations`, `rationale` | Applies structured edits (insert, replace, delete sections). Operates with live user visibility; undo is supported via `undo_ai_edit`. |
| `update_document_title` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `title` | Renames the document title. |
| `add_document_comment` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `anchor`, `comment_text` | Attaches a contextual review comment or suggestion to a specific passage. |
| `list_document_comments` | Global Read | `docs.use` | `document_id` | Reads open and resolved comment threads on a document. |
| `get_document_outline` | Global Read | `docs.use` | `document_id` | Extracts a concise table of contents for navigation. |
| `undo_ai_edit` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `version_id` | Reverts the document to its state prior to the AI's last edit operation. |

#### 7.6.10 Personal Productivity: Email, Calendar, Notes, Popups (16 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `email_search` | Global Read | `email.use` | `query`, `sender`, `limit` | Searches linked IMAP mailboxes for relevant emails by subject or body. |
| `email_read` | Global Read | `email.use` | `message_id`, `mailbox_id` | Fetches the sanitized plain-text body and headers of an email. |
| `propose_email_send` | Global Write | `email.send` | `recipient`, `subject`, `body_text`, `body_html`, `rationale` | Drafts and proposes sending an outbound email via connected SMTP credentials. |
| `send_test_email` | Global Read | `email.use` | *None* | Sends a diagnostic test email strictly to the user's verified personal address. Requires no confirmation card because it cannot send to third parties. |
| `calendar_read` | Global Read | `calendar.use` | `start_date`, `end_date`, `calendar_id` | Reads events from personal CalDAV calendars within a date window. |
| `read_team_calendar` | Global Read | `calendar.use` | `team_id`, `start_date`, `end_date` | Reads scheduled events from shared team calendars. |
| `propose_calendar_event_create` | Global Write | `calendar.manage` | `title`, `start_time`, `end_time`, `recurrence`, `event_type`, `rationale` | Creates a single or recurring calendar event (`recurrence` supports daily, weekly, monthly, yearly rules). |
| `propose_calendar_event_update` | Global Write | `calendar.manage` | `event_id`, `title`, `start_time`, `end_time`, `rationale` | Modifies or reschedules an existing calendar entry. |
| `propose_calendar_event_delete` | Global Write | `calendar.manage` | `event_id`, `rationale` | Proposes deleting a scheduled calendar event. |
| `notes_read` | Global Read | `notes.use` | `query`, `category`, `team_id`, `is_pinned` | Reads and searches personal or shared notes. |
| `read_team_notes` | Global Read | `notes.use` | `team_id`, `category` | Reads team-shared knowledge notes and meeting minutes. |
| `propose_note_create` | Global Write | `notes.manage` | `title`, `content_markdown`, `category`, `team_id`, `rationale` | Creates a new structured Markdown note. |
| `propose_note_update` | Global Write | `notes.manage` | `note_id`, `title`, `content_markdown`, `rationale` | Updates content or category of an existing note. |
| `propose_note_delete` | Global Write | `notes.manage` | `note_id`, `rationale` | Deletes a note. |
| `popups_read` | Global Read | `panel.popups.view` | `only_active` | Lists panel-wide user announcements and maintenance pop-ups. |
| `propose_popup_set` | Global Write | `panel.popups.manage` | `popup_id`, `title`, `content_markdown`, `start_at`, `end_at`, `rationale` | Creates or updates system announcement pop-ups shown to panel users. |

#### 7.6.11 Geospatial Analysis, 3D Globe & Satellite (5 Tools)
Singra interfaces with MapLibre GL, Copernicus Sentinel-2, Open-Meteo, and TomTom to render visual geospatial intelligence.

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `analyze_region` | Global Read | `ai.satellite.use` | `location`, `camera` (`overview`, `focus`, `detail`) | Resolves geocoding, fetches Open-Meteo weather forecasts, retrieves recent Copernicus Sentinel-2 or ArcGIS True-Color satellite scenes, and compiles local news. Initial response renders under 300ms; enrichment proceeds in parallel. |
| `control_region_camera` | Global Read | `ai.satellite.use` | `action` (`zoom_in`, `zoom_out`, `overview`, `focus_location`), `location` | Animates the visible 3D globe camera to target coordinates without re-querying satellite datasets. Enforces a 10-second dwell time per landmark during tours. |
| `voice_set_region_view` | Voice Control | `ai.satellite.use` | `tab` (`overview`, `satellite`, `news`, `traffic`, `weather`), `source_id`, `scene_id` | Synchronizes the visible panel tab in real-time immediately before Singra discusses weather, news, or satellite imagery over voice. |
| `voice_leave_region_view` | Voice Control | `ai.satellite.use` | *None* | Closes the geospatial view when conversation shifts back to non-geographical server or coding topics. |
| `voice_resolve_latest_proposal` | Voice Control | *None* | `decision` (`confirm`, `reject`) | Allows dismissing or rejecting the active action proposal via voice command. Confirmation strictly requires clicking the card or explicit autonomy. |

#### 7.6.12 Privacy Web Search & Content Scraping (2 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `web_search` | Global Read | `ai.web_search.use` | `query`, `count` | Queries privacy-respecting SearXNG sidecar meta-search instances. Prevents leaking panel search habits to public search monopolies. |
| `read_web_page` | Global Read | `ai.web_search.use` | `url`, `max_chars` | Fetches and extracts sanitized markdown reader text from a target webpage. **SSRF Guard:** Strictly prohibits requests to private/internal IP ranges (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.0.0/16`) and local loopback adapters. |

#### 7.6.13 Long-Term Memory & User Skills (6 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `search_memory` | Global Read | `ai.memory.use` | `query`, `limit` | Performs semantic cosine-similarity search over user memories. Memories are encrypted at rest with DIS Shield AES-GCM. |
| `search_team_memory` | Global Read | `ai.memory.use` | `team_id`, `query`, `limit` | Searches shared organizational memory entries. |
| `read_skill` | Global Read | `ai.skills.use` | `skill_id` | Reads behavioral skill guidelines and expert procedures learned by Singra. |
| `learn_skill` | Global Read | `ai.skills.use` | `name`, `trigger_description`, `instructions` | Registers a new behavioral rule. Classified as `global_read` because prose guidelines cannot bypass RBAC or execute commands directly. |
| `learn_team_skill` | Global Read | `ai.skills.use` | `team_id`, `name`, `instructions` | Stores organizational guidelines shared across an entire team. |
| `forget_skill` | Global Read | `ai.skills.use` | `skill_id` | Removes an obsolete skill guideline from Singra's repertoire. |

#### 7.6.14 Desktop & Smart System Integration (Maunting Smart System) (6 Tools)
Operates through the Maunting Smart System (MSS) desktop companion app running on developer workstations.

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `desktop_steuern` | Desktop | `desktop.control` | `action`, `parameters` | Controls desktop window state, media keys, and system shortcuts with user consent. |
| `desktop_system` | Desktop | `desktop.control` | `query` | Inspects local workstation metrics (RAM, CPU, active desktop windows, OS version). |
| `desktop_dateien` | Desktop | `desktop.control` | `action`, `path` | Sandboxed file interactions on workstation dev directories. |
| `desktop_launch_app` | Desktop | `desktop.control` | `app_identifier` | Launches registered local developer tools (VS Code, terminal, Git GUI). |
| `desktop_aufraeumen` | Desktop | `desktop.control` | `target` | Cleans up temporary build directories and caches. |
| `desktop_artifact` | Desktop | `desktop.control` | `artifact_id` | Manages quarantined artifacts inside `%LOCALAPPDATA%\Singra\MSS-Quarantine`. |

#### 7.6.15 Background Tasks, Workers & Multi-Agent (8 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `list_tasks` | Global Read | `ai.tasks.view` | `status` | Lists scheduled and active background tasks owned by the user. |
| `propose_task_set` | Global Write | `ai.tasks.manage` | `name`, `schedule_cron`, `action_payload`, `rationale` | Schedules an automated recurring maintenance task. |
| `propose_task_delete` | Global Write | `ai.tasks.manage` | `task_id`, `rationale` | Cancels and removes a scheduled background task. |
| `wait_until` | Global Read | *None* | `condition_type`, `target_id`, `expected_status`, `timeout_seconds` | Suspends tool execution until an asynchronous state change (e.g., container reboot completed) settles. |
| `worker_start` | Global Read | `ai.workers.manage` | `role`, `task_prompt`, `context_ids` | Dispatches an isolated sub-worker agent with specialized instructions. |
| `worker_frage` | Global Read | `ai.workers.manage` | `worker_id`, `question` | Inquires about the status or intermediate findings of a running worker. |
| `worker_antwort` | Global Read | `ai.workers.manage` | `worker_id`, `answer` | Delivers requested guidance or clarifications to a sub-worker. |
| `worker_cancel` | Global Read | `ai.workers.manage` | `worker_id` | Terminates a sub-worker agent. |

#### 7.6.16 Administration, Users & Billing (12 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `list_users` | Global Read | `panel.users.view` | `query`, `role_filter` | Lists registered panel users, active statuses, and assigned role IDs. |
| `read_user_permissions` | Global Read | `panel.users.view` | `user_id` | Inspects effective permissions of a user across global, team, and server scopes. |
| `list_roles` | Global Read | `panel.roles.view` | *None* | Lists defined system roles, priority hierarchy, and associated permission sets. |
| `propose_role_set` | Global Write | `panel.roles.manage` | `role_id`, `name`, `permissions`, `rationale` | Creates or updates an RBAC role definition. |
| `propose_role_delete` | Global Write | `panel.roles.manage` | `role_id`, `rationale` | Removes a role definition. Enforces that assigned users must be remapped first. |
| `propose_user_roles` | Global Write | `panel.users.manage` | `user_id`, `role_ids`, `rationale` | Assigns or revokes roles from a user account. |
| `propose_user_server_permission` | Global Write | `server.permissions.manage` | `server_id`, `user_id`, `permission`, `grant`, `rationale` | Grants or revokes granular per-server permissions. |
| `propose_ai_tarif_role` | Global Write | `panel.settings.write` | `role_id`, `daily_tokens`, `monthly_tokens`, `rationale` | Configures quota tiers and token ceilings per role. |
| `read_hoster_setup` | Global Read | `panel.hoster.read` | *None* | Inspects WHMCS, FOSSBilling, or custom hoster billing integrations. |
| `read_hoster_integration_guide` | Global Read | `panel.hoster.read` | `billing_system` | Retrieves technical webhook integration instructions. |
| `propose_hoster_integration` | Global Write | `panel.hoster.manage` | `provider`, `api_url`, `api_key_encrypted`, `rationale` | Connects or updates automated billing webhooks and server provisioning bridges. |
| `propose_hoster_product` | Global Write | `panel.hoster.manage` | `product_id`, `blueprint_id`, `node_id`, `specs`, `rationale` | Links a commercial billing product with automated container blueprint deployment. |
| `read_audit_summary` | Global Read | `panel.audit.view` | `timeframe` | Compiles security audit metrics (failed logins, privilege escalations, deleted servers). |
| `search_audit_log` | Global Read | `panel.audit.view` | `query`, `user_id`, `action`, `limit` | Searches fine-grained immutable audit log records. |
| `read_ai_action_history` | Global Read | `panel.audit.view` | `server_id`, `project_id`, `limit` | Audits historical actions proposed and executed specifically by Singra. |

#### 7.6.17 Knowledge, Attachments & Dialog Control (5 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `search_docs` | Global Read | *None* | `query` | Searches MSM's internal technical documentation and knowledge base. |
| `read_docs` | Global Read | *None* | `doc_path` | Reads technical documentation pages directly from the repository docs corpus. |
| `search_chat_attachments` | Global Read | *None* | `query`, `mime_type` | Locates files uploaded into the conversation (screenshots, crash logs, blueprints). |
| `read_chat_attachment` | Global Read | *None* | `attachment_id` | Extracts text or parses image data from an attachment for multimodal inspection. |
| `ask_user` | Global Read | *None* | `question`, `options` | Explicitly requests clarification or multi-choice input when instructions are ambiguous. |

---

#### 7.6.18 Autonomous Server Guardian Watchdog & Self-Healing (5 Tools)

| Tool Name | Type | RBAC Permission | Primary Parameters | Purpose & Rationale |
|---|---|---|---|---|
| `read_guardian_incidents` | Server Read | `server.view` | `server_id`, `limit` | Reads past watchdog incident reports, crash detections, OOM events, and auto-repair logs. |
| `propose_guardian_tuning` | Server Write | `server.edit` | `server_id`, `tuning_payload`, `rationale` | Adjusts watchdog thresholds (crash loop limits, memory margin, restart backoff) specifically for a server. |
| `propose_server_repair` | Server Write | `server.power.control` | `server_id`, `repair_action`, `rationale` | Initiates automated repair routines (rebuilding container, resetting broken volume permissions, re-pulling image). |
| `propose_backup` | Server Write | `server.backups.create` | `server_id`, `name`, `rationale` | Enforces the mandatory emergency backup prerequisite before any mutating self-healing actions. |
| `read_server_logs` | Server Read | `server.logs.view` | `server_id`, `lines`, `tail` | Live log stream inspection for stack trace identification, error codes, and crash root-cause diagnosis. |

---

## 8. Model Context Protocol (MCP) Integration

### 8.1 Open Extensibility with MCP
Singra natively supports the open Model Context Protocol (MCP) (`backend/routers/ai_mcp.py`):
- **Scopes**: Global (server-wide), Team (shared workgroup), and User (personal tools).
- **Transports**: `http` / `sse` (remote MCP endpoints) and `stdio` (local subprocess execution via command + arguments).

### 8.2 Dynamic Tool Discovery & Schema Normalization
Upon connecting to an MCP endpoint:
1. Singra performs the MCP discovery handshake (`tools/list`).
2. Tools are normalized (`normalisiere_werkzeuge`), validated against strict schema rules, and registered dynamically in `ai_tool_registry`.
3. Singra invokes MCP tools seamlessly during chat and voice interactions, bound by RBAC and audit logging.

---

## 9. Hierarchical Long-Term Memory Graph & DIS Privacy Shield (Gedächtnis v2)

Singra implements a scalable long-term memory engine (`services/ai_gedaechtnis_schreiber.py`, `ai_gedaechtnis_abruf.py`, `ai_gedaechtnis_pflege.py`) capable of managing 100,000+ memories per scope without latency degradation.

### 9.1 Memory Entity Hierarchy
Organized into structured database entities (`backend/models/ai_memory.py`):
- **Topics (`AiMemoryTopic` / `ai_memory_themen`)**: Semantic subject categories (e.g. "Infrastructure Preferences", "Coding Style"). Name encrypted; uniqueness enforced via HMAC index (`name_index`).
- **Concepts (`AiMemoryBegriff` / `ai_memory_begriffe`)**: 64-bit HMAC word hashes linking lexical terms to memory records without exposing plaintext vocabulary in SQL.
- **Entries (`AiMemoryEntry` / `ai_memory_entries`)**: Core factual records. Stores encrypted value (`value_encrypted`), encrypted title (`titel_encrypted`), importance (1-5), presence half-life (`haltbarkeit_tage`), ranking (`kopf_rang`), and AES-GCM encrypted embedding bytes (`embedding_bytes`).
- **Evidence (`AiMemoryBeleg` / `ai_memory_belege`)**: Links synthetic conclusions (`art = 'schluss'`) to their supporting factual entries.
- **Maintenance & History (`AiMemoryPflege`, `AiMemoryVersion`)**: Tracks nightly maintenance sweeps and maintains an immutable version history for rollbacks.

### 9.2 The Two-Tier Retrieval Engine
Rather than executing slow full-table scans on every turn, Singra splits retrieval into two phases:
- **Phase 1: "Im Kopf" (In-Head Working Memory)**: Pinned memories and top-ranked entries (`kopf_rang = importance * presence`), calculated daily by nightly maintenance. Placed statically at the start of the prompt before chat history, preserving provider prompt cache hits.
- **Phase 2: "Passend zur Frage" (Dynamic Contextual Retrieval)**: Dual-track search for question-specific entries:
  1. *Semantic Vector Search*: In-memory cosine similarity matrix against 256/1536 float32 embeddings (`BEDEUTUNG_BODEN = 0.2`, `BEDEUTUNG_ABSTAND = 0.15`, `BEDEUTUNG_DECKEL = 0.5`).
  2. *Lexical Word Index*: Exact-match HMAC query word lookups via `ai_memory_begriffe`.  
  Only the top candidate rows (`KANDIDATEN = 60`) are loaded and decrypted via the DIS sidecar.

### 9.3 Zero-Knowledge Storage with DIS & Blind HMAC Indexing
User memories contain sensitive operational information. Singra secures memory storage via the Defensive Integration Shield (DIS):
- **Encrypted Content (`DisText`)**: All titles and text bodies are stored as AES-256-GCM ciphertexts wrapped in format envelopes (`msm-dis-v1:...`).
- **Scoped AAD Binding**: AAD is bound to entry ID and scope (`msm:ai:memory:value:{scope_identity}:{id}`), preventing cross-user ciphertext tampering.
- **Blind HMAC Indexing**: Search terms and lookup keys are hashed using keyed HMACs (`/blind-index`) bound to the user's isolated scope. Database dumps reveal zero plaintext memories or search terms.

---

## 10. Web Research & SearXNG Search Synthesis

### 10.1 Architecture & Self-Hosted Meta-Search
Singra integrates with an internal or dedicated SearXNG instance (`backend/services/ai_web_search_service.py`, `ai_search_summary_service.py`):
- Local SearXNG sidecar (`http://127.0.0.1:8888`) provides private meta-search across web, images, news, and Wikipedia knowledge graphs.
- Optional official API (Brave Search) can be configured with encrypted credentials.
- Governed by master toggle (`ai_web_search_enabled`) and RBAC permission (`ai.web_search.use`).

### 10.2 Query Reformulation & Co-Reference Resolution
Multi-turn conversational queries are analyzed by `UMSCHREIBEN_SYSTEM`:
- Resolves pronouns and co-references ("it", "that server", "the modpack").
- Decomposes multi-part questions into up to 3 standalone search queries (`suchanfragen`).
- Detects topic switches (`themenwechsel: true/false`), clearing stale search contexts when the topic changes.

### 10.3 In-Memory Scraping & Inline Citation Attribution
- Deep scraping of up to 2 target web pages (`SEITEN_MAX = 2`) when search snippets provide insufficient detail.
- Wikipedia knowledge graph parsing (up to 20,000 chars wikitext, infobox extraction).
- Strict citation attribution: statements derived from search results are attributed with inline numbers (`[1]`, `[2]`).
- Unverified claims are explicitly designated with "Ohne Quellenbeleg:".

### 10.4 Ephemeral Zero-Retention Privacy
Web search summaries operate under a strict zero-retention guarantee: **0 bytes persisted to disk or database**. Scraped pages are processed entirely in memory and discarded immediately upon run completion.

---

## 11. Singra Projects & Autonomous Agentic Development

### 11.1 Virtual Filesystem & In-Browser Preview Bundler
Singra Projects (`services/ai_project_service.py` and `frontend/src/components/ai/singra/`) is a full-stack web engineering environment:
- **Virtual Filesystem**: Multi-file project management stored in PostgreSQL, supporting atomic multi-file edits.
- **Client-Side Preview Bundler (`previewBundle.ts`)**: Directly compiles and bundles React 18, TypeScript, Tailwind 3 CSS, and HTML inside a secure, sandboxed browser iframe (`sandbox="allow-scripts"`). Delivers sub-200ms hot-reloads with zero host container overhead.

### 11.2 Automated Diagnostics, Testing & Visual Inspection
- **Runtime Error Interception (`PreviewDiagnostics.tsx`)**: Intercepts `console.error`, unhandled rejections, and DOM layout failures, feeding diagnostics back into Singra for self-healing code repair.
- **Visual Inspection Modal (`SingraVisualInspectionModal.tsx`)**: Multi-device viewport emulation (Desktop 1920x1080, Tablet 768x1024, Mobile 375x667).
- **Automated Test Runner (`SingraTestResults.tsx`)**: Executes Vitest unit tests inside the project sandbox.
- **Zero-Downtime Deployment Pipeline (`SingraDeploymentPanel.tsx`)**: 13-phase deployment pipeline with automatic revision archiving and one-click rollback.

### 11.3 Git Integration & Token Hygiene
Direct integration with GitHub and GitLab (`services/ai_project_git.py`):
- Automates branching, commits, pulls, pushes, and merge requests.
- **Token Hygiene**: Remote Git URLs are sanitized (`_clean_git_remote_url`). Authentication credentials are passed strictly via ephemeral environment variables (`GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*`) using `http.extraheader`. No plaintext tokens are written to `.git/config`.


### 11.4 The Fullstack Dev Sandbox (`services/singra/dev_env.py`)
Singra allows developing and testing web applications inside live, isolated environments:
- **Automatic Dev Containers:** Spins up paired containers: `<ProjectName> (Dev Backend)` and `<ProjectName> (Dev Frontend)`.
- **Dedicated Dev PostgreSQL Database:** Provisions a dedicated database with migrations and seeds (`seeds/*.sql`) pre-populated.
- **Dynamic Port Allocation:** Allocates non-colliding host ports via `allocate_ports()` and registers reverse proxy routing.
- **60-Minute Inactivity Auto-Suspend:** `services/singra/dev_idle_worker.py` monitors activity timestamps (`touch_dev_activity`). After 60 minutes of zero user interactions, dev containers are stopped to conserve host RAM and CPU, reactivating in under 3 seconds upon the next user request.

### 11.5 The 13-Phase Deployment Contract (`services/singra/runner.py`)
When a project is ready for production (`publish_production`), Singra's deployment engine executes a strict, 13-phase zero-downtime contract:

```
[1. Snapshot] ──> [2. Quality] ──> [3. Build Frontend] ──> [4. Build Backend]
      │
      ▼
[5. Database] ──> [6. Migrations] ──> [7. Start Backend] ──> [8. Verify Backend]
      │
      ▼
[9. Start Frontend] ──> [10. Proxy Update] ──> [11. Verify Frontend]
      │
      ▼
[12. Verify API] ──> [13. Verify DB] ──> [Done: Production Release Committed]
```

1. **`snapshot`:** Materializes virtual project files from PostgreSQL into an isolated staging directory and computes an immutable SHA-256 hash manifest for every file.
2. **`quality`:** Runs ESLint, TypeScript compilation check (`tsc --noEmit`), and Python Ruff linting. Any syntax error or broken import aborts the pipeline before containers are built.
3. **`build_frontend`:** Compiles production frontend assets (e.g., Vite/React build) with minification and tree-shaking into a static bundle.
4. **`build_backend`:** Generates production container images or runtime artifacts and prepares runtime environments (`server_runtime_env`).
5. **`database`:** Provisions the production PostgreSQL database instance, creates database users, and generates encrypted passwords stored with DIS Shield.
6. **`migrations`:** Applies database schema migrations and seed datasets.
7. **`start_backend`:** Launches the backend application container with injected production environment variables.
8. **`verify_backend`:** Performs repeated TCP ping checks against the backend container port until the process accepts connections (timeout 30s).
9. **`start_frontend`:** Launches the web frontend container or registers the static bundle directory with the web server.
10. **`proxy`:** Atomically updates Caddy reverse proxy routes (`caddy_service.py`), applying public domain bindings and issuing Let's Encrypt TLS certificates.
11. **`verify_frontend`:** Issues an HTTP probe against the public frontend URL, verifying a `200 OK` response.
12. **`verify_api`:** Issues an HTTP probe against the healthcheck route (`/api/health` or custom probe URL), verifying correct API status.
13. **`verify_db`:** Executes a lightweight query (`SELECT 1`) against the production database to confirm end-to-end database connectivity.
14. **`done`:** The deployment is marked `status="ready"`, committed to `singra_deployments`, and the release manifest is permanently sealed.

### 11.6 Automated Headless Browser Testing & Quality Gate (`services/singra/browser.py`)
To prevent broken user interfaces from reaching production, Singra integrates automated browser testing using Playwright:
- **Strict Origin-Guard:** Intercepts all browser network requests and blocks calls to external domains. This prevents data leakage during testing and complies with strict GDPR requirements.
- **Responsive Viewport Testing:** Tests both Desktop (1280x800) and Mobile (375x667) viewports.
- **Interactive Sequence Simulation:** Simulates user click sequences, menu navigation, keyboard inputs, and modal dismissals.
- **Negative Testing:** Submits invalid inputs into forms (e.g., invalid emails, empty passwords) to verify that UI error banners render correctly.
- **Visual Artifacts:** Takes full-page screenshots at each testing milestone, persisting traces in `SingraTestRun` for developer inspection.

---

---

## 12. Real-Time Multimodal Voice & Audio Processing

### 12.1 Dual-Transport Voice Architecture
Singra provides two real-time voice architectures (`routers/ai_voice.py`, `services/ai_voice_bridge.py`):
1. **WebRTC OpenAI Realtime Mode**: Direct peer-to-peer audio stream with sub-400ms latency. A sideband WebSocket signals MSM tool state and UI animations.
2. **WebSocket PCM Audio Mode**: Raw PCM audio streamed over authenticated WebSockets. Pipeline: VAD -> Whisper STT -> LLM -> ElevenLabs / Local TTS. Fully supports air-gapped on-premises setups.

### 12.2 Speculative UI Dispatching
To eliminate perceived latency, Singra implements **Speculative UI Dispatching**:
- The instant the backend detects the first tool call token (`tool_start`), it broadcasts a lightweight event to the frontend.
- Frontend animations (3D Globe camera flight, loading indicators) activate in under 300 ms, synchronizing visual feedback with the model's spoken response.

### 12.3 Conversational Etiquette & Verbal Bridging
Singra's voice prompt strictly forbids conversational fillers ("Let me check that for you..."). Tools execute silently in the background, and results are delivered directly. In spoken mode, code blocks are filtered by `ai_voice_bridge.Belegfilter` and rendered visually on screen rather than read aloud.

---

## 13. Maunting Smart System (MSS) Desktop Companion

### 13.1 Native Rust/Tauri Architecture
The Maunting Smart System (`smart-system/`) is a native desktop companion built with Tauri v2, Rust, and the shared React frontend.

### 13.2 Offline Wake-Word: "Singra"
- **Engine**: `rustpotter` running 100% locally on the host CPU. Zero audio is streamed to the cloud during idle listening.
- **Wake-Word**: **Singra**.
- **Calibration**: Personalized 6-recording calibration creating a local MFCC + Dynamic Time Warping (DTW) model (`wakeword.rpw`).
- **Triple-Gate Verification**: Voice Activity Detection (VAD), median scoring across training takes, and clamped sensitivity threshold (0.30 - 0.60).
- **Privacy Lock**: Audio streaming opens only after wake-word confirmation. Idle sessions close automatically after 20 seconds.

### 13.3 Click-Through Floating Particle Swarm Overlay
Features a floating particle visualizer with transparent click-through (`src-tauri/src/durchklick.rs`): clicks pass through the canvas directly to underlying desktop applications.

### 13.4 Cryptographic Device Pairing
Pairing requires neither passwords nor 2FA inputs. Authentication is established via a one-time 12-character pairing code redeemed against `/api/auth/devices/redeem`. Refresh tokens are stored in the Windows Credential Manager; access tokens reside exclusively in volatile memory.

---

## 14. Autonomous Background Workers, Tasks & Guardian Watchdog

### 14.1 Autonomous Task Engine (`AiTask`) & Skills (`AiSkill`)
- **`AiTask` Engine (`services/ai_task_service.py`)**: Schedules multi-step background missions, persisting logs and notifying users upon completion.
- **`AiSkill` Catalog (`services/ai_skill_service.py`)**: Dynamic catalog of reusable operational routines learned by Singra.

### 14.2 Guardian Watchdog & Self-Healing Repairs
Integrated autonomous infrastructure watchdog (`services/ai_guardian_service.py`):
- Continuously inspects container health, OOM kills, CPU/RAM anomalies, SSL expiry, and backup freshness.
- Generates `AiGuardianNotice` incident reports and `AiGuardianRepair` remediation plans.
- Non-destructive fixes execute under active autonomy grants; critical service restarts require one-click human confirmation.

---

## 15. Architectural Rationale: Why Singra is Built This Way

| Design Decision | Underlying Problem | Security & Operational Benefit |
|---|---|---|
| **Origin Boundaries (`herkunft_schnitt`)** | Web vulnerabilities could trigger desktop takeover. | Desktop takeover tools are restricted strictly to tokens issued via desktop device pairing. |
| **DIS Zero-Knowledge Memory** | Database leaks expose sensitive operational facts. | Memory content is encrypted with AES-256-GCM; search indexes use blind HMACs. Database dumps reveal zero plaintext. |
| **Strict JSON Schema Invariance** | Strict models reject loose or malformed tool schemas. | Mandatory `type: "object"` and explicit `properties` prevent `400 Bad Request` schema rejections across frontier models. |
| **Input Token Ceiling (44k tokens)** | Huge contexts cause reasoning degradation and high costs. | Clamps prompt payload to 44,000 tokens regardless of advertised context size, ensuring sharp reasoning and controlled budgets. |
| **Write Tool Proposal Cards** | Runaway models can damage infrastructure. | Mutating actions mandate `AiActionProposal` cards with human confirmation unless covered by an explicit autonomy grant. |
| **Client-Side Preview Bundler** | Server-Build-Container are slow and resource-heavy. | In-browser sandboxed bundling compiles React and Tailwind in under 200 ms with zero host container overhead. |
| **Offline Local Wake-Word ("Singra")** | Always-on cloud audio listening invades user privacy. | `rustpotter` runs 100% locally on CPU; audio channels open only after acoustic confirmation. |
| **Rolling Quota Windows** | Calendar-month limits cause end-of-month service cliffs. | 24h, 7d, and 30d rolling windows provide smooth, predictable resource distribution. |
| **Infinite Loop Protection (`MAX_GLEICHE_AUFRUFE = 4`)** | Models can get stuck repeating identical queries. | Terminates repetitive loops with an explanatory guidance prompt while allowing polling tools up to 8 iterations. |

---

*Singra AI Platform — Developed by MauntingStudios. Powered by Defensive Integration Shield (DIS).*
