# Maunting Server Manager & Singra KI — Dokumentations-Index

Willkommen im Dokumentationsverzeichnis von **Maunting Server Manager** und dem **Singra KI-Agentenharnisch**, entwickelt von MauntingStudios.

## Singra KI-Agentenharnisch Dokumentation

- 🇩🇪 **Gesamtdokumentation (Deutsche Version)**:  
  [singra-ki-komplette-dokumentation.md](file:///e:/Github-Projekte/maunting-server-manager/docs/de/singra-ki-komplette-dokumentation.md)  
  *(Ebenfalls verfügbar als [singra-ki-agentenharnisch.md](file:///e:/Github-Projekte/maunting-server-manager/docs/de/singra-ki-agentenharnisch.md))*  
  Umfassendes technisches Handbuch über das Gesamtsystem:
  - Kernidentität der KI Singra und Herkunft aus der Gravitationssingularität (Singularität des Schwarzen Lochs als Schwelle von deterministischer Programmierung zu emergenter agentischer Intelligenz),
  - Modularer Systemprompt (`backend/services/ai_prompt.py`) mit benannten Blöcken (`ROLLE`, `IDENTITAET`, `HALTUNG`, `FORMAT`, `ZEITANSAGE`, `EINZELCHAT`, `MITREDEN`, `BUENDELN`, `KEIN_STUMMER_ZUG`, `BELEGE`, `RUECKFRAGEN`, `ERMESSEN`, `PROAKTIV`, `AGENTIC_LOOP_SELF_HEALING`, `AUFTRAEGE`),
  - Rollen-Block-Matrizen (`ROLLEN_BLOECKE = {"voll": BLOECKE, "gehirn": GEHIRN_BLOECKE, "worker": WORKER_BLOECKE, "realtime": REALTIME_BLOECKE, "live": LIVE_BLOECKE}`),
  - Filtersets (`NUR_GETIPPT`) und Sprach-Suffixe (`GESPROCHEN`, `HINTER_DER_STIMME`),
  - GPU-Prompt-Caching und 10-%-Abrechnungsregel (`CACHE_ANRECHNUNG_PROZENT = 10`),
  - Mechanische Sicherheitsgrenzen (RBAC, `herkunft_schnitt`, `_resolve_server`, Bestätigungskarten `AiActionProposal`),
  - Kontextfenster-Steuerung (44.000-Token-Eingabedeckel), Denkstufen (`schnell`, `durchdacht`, `tiefgründig`, `benutzerdefiniert`),
  - Multi-Provider-Infrastruktur (OpenAI, Anthropic, Azure, Gemini, OpenRouter, ElevenLabs, lokale Inferenz via Ollama/vLLM),
  - Über 125 registrierte Werkzeuge, strikte JSON-Schema-Invarianz, Autonomie-Freigaben (`AiAutonomyGrant`) und Schleifenschutz (`MAX_GLEICHE_AUFRUFE = 4`),
  - Model Context Protocol (MCP) Integration über HTTP/SSE und Stdio,
  - Hierarchisches Langzeitgedächtnis (Gedächtnis v2 mit `AiMemoryTopic`, `AiMemoryBegriff`, `AiMemoryEntry`, `AiMemoryBeleg`, zweistufiger Abruf „Im Kopf" vs. „Passend zur Frage", DIS AES-256-GCM Verschlüsselung und Blind-HMAC-Indizes),
  - Private SearXNG-Webrecherche mit Frage-Umschreibung, Volltext-Auszügen und Zitatbelegen (`[1]`, `[2]`),
  - Singra Projects (browserseitiger React 18 / Tailwind Bundler, Laufzeitdiagnose, Vitest-Tests, Git),
  - Echtzeit-Sprachverarbeitung über WebRTC und WebSocket mit spekulativer Oberflächen-Signalisierung (<300 ms),
  - Maunting Smart System (MSS) Desktop-App mit lokalem Offline-„Singra"-Wake-Word (`rustpotter`),
  - Autonome Hintergrund-Worker und Guardian-Watchdog mit Selbstheilung.

- 🇬🇧 **Englische Master-Referenz**:  
  [../singra-ai-complete-documentation.md](file:///e:/Github-Projekte/maunting-server-manager/docs/singra-ai-complete-documentation.md)

---

## Weitere Systemdokumentation

- [ai-system-architecture.md](file:///e:/Github-Projekte/maunting-server-manager/docs/de-docs/ai-system-architecture.md): Streaming-Architektur und Agentenrollen im Detail.
- [mcp-integrationen.md](file:///e:/Github-Projekte/maunting-server-manager/docs/mcp-integrationen.md): MCP-Serverkonfiguration und Katalog.
- [maunting-search.md](file:///e:/Github-Projekte/maunting-server-manager/docs/de-docs/maunting-search.md): SearXNG-Webrecherche und quellenbasierte Zusammenfassungen.
- [self-hosting.md](file:///e:/Github-Projekte/maunting-server-manager/docs/de-docs/self-hosting.md): Betriebsanleitung, Docker Compose, Rootless-Setup und DIS-Sicherheitsarchitektur.
- [blueprints.md](file:///e:/Github-Projekte/maunting-server-manager/docs/de-docs/blueprints.md): Deklarative Servervorlagen und Multi-Game-Strukturen.
- [hoster-api.md](file:///e:/Github-Projekte/maunting-server-manager/docs/de-docs/hoster-api.md): Schnittstellendokumentation für Hoster und Drittanbieter.
