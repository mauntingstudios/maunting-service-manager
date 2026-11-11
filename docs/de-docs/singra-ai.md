# Singra KI — Gesamtdokumentation und Technisches Handbuch

**Verbindliche technische Referenz**  
**Produkt**: Singra KI (Autonome Intelligenz- und Agenten-Plattform)  
**Entwickler**: MauntingStudios  
**Version**: 5.1.5+ LTS  
**Sicherheits-Engine**: Defensive Integration Shield (DIS)  

---

## Inhaltsverzeichnis

1. [Überblick und Systemidentität](#1-überblick-und-systemidentität)
   - 1.1 [Was ist Singra?](#11-was-ist-singra)
   - 1.2 [Namensherkunft und die Singularitäts-Metapher](#12-namensherkunft-und-die-singularitäts-metapher)
   - 1.3 [Einsatzbereiche und Architekturübersicht](#13-einsatzbereiche-und-architekturübersicht)
2. [Architektur und Ausführungskern (AiRun und Streaming-Pipeline)](#2-architektur-und-ausführungskern-airun-und-streaming-pipeline)
   - 2.1 [Das native Agenten-System](#21-das-native-agenten-system)
   - 2.2 [Ablauf einer Modellanfrage](#22-ablauf-einer-modellanfrage)
   - 2.3 [Feste Ausführungsgrenzen und Sicherheitsregeln](#23-feste-ausführungsgrenzen-und-sicherheitsregeln)
3. [Systemprompt-Architektur (`ai_prompt.py`)](#3-systemprompt-architektur-ai_promptpy)
   - 3.1 [Modulare Struktur benannter String-Blöcke](#31-modulare-struktur-benannter-string-blöcke)
   - 3.2 [Rollen-Block-Matrizen (`ROLLEN_BLOECKE`)](#32-rollen-block-matrizen-rollen_bloecke)
   - 3.3 [Filtersets und Sprachanpassungen (`NUR_GETIPPT`)](#33-filtersets-und-sprachanpassungen-nur_getippt)
   - 3.4 [GPU-Prompt-Caching und die 10-%-Abrechnungsregel](#34-gpu-prompt-caching-und-die-10--abrechnungsregel)
   - 3.5 [Der Sicherheitsgrundsatz: Der Prompt ist nicht die Sicherheitsgrenze](#35-der-sicherheitsgrundsatz-der-prompt-ist-nicht-die-sicherheitsgrenze)
4. [Kontextfenster-Steuerung und Kompaktierung](#4-kontextfenster-steuerung-und-kompaktierung)
   - 4.1 [Token-Berechnung und der Eingabedeckel je Rolle](#41-token-berechnung-und-der-eingabedeckel-je-rolle)
   - 4.2 [Zweistufige Kontext-Kompaktierung](#42-zweistufige-kontext-kompaktierung)
   - 4.3 [Schwärzung sensibler Daten](#43-schwärzung-sensibler-daten)
5. [Denkstufen und Reasoning-Engine](#5-denkstufen-und-reasoning-engine)
6. [Multi-Provider-Infrastruktur und Token-Ökonomie](#6-multi-provider-infrastruktur-und-token-ökonomie)
   - 6.1 [Modulare Provider-Architektur](#61-modulare-provider-architektur)
   - 6.2 [Lokale souveräne Inferenz (Ollama / vLLM)](#62-lokale-souveräne-inferenz-ollama--vllm)
   - 6.3 [Gleitende Zeitfenster für Kontingente](#63-gleitende-zeitfenster-für-kontingente)
7. [Werkzeug-Ausführung, Autonomie und Herkunfts-Schnittstellen](#7-werkzeug-ausführung-autonomie-und-herkunfts-schnittstellen)
   - 7.1 [Strikte JSON-Schema-Invarianz](#71-strikte-json-schema-invarianz)
   - 7.2 [Werkzeug-Klassifikation: Lesen vs. Schreiben und Bestätigungskarten](#72-werkzeug-klassifikation-lesen-vs-schreiben-und-bestätigungskarten)
   - 7.3 [Autonomie-Freigaben (`AiAutonomyGrant`)](#73-autonomie-freigaben-aiautonomygrant)
   - 7.4 [Schutz vor Endlosschleifen und Polling-Deckel (`MAX_GLEICHE_AUFRUFE`)](#74-schutz-vor-endlosschleifen-und-polling-deckel-max_gleiche_aufrufe)
   - 7.5 [Herkunfts-Schnittstellen (`herkunft_schnitt`)](#75-herkunfts-schnittstellen-herkunft_schnitt)
   - 7.6 [Umfassender Werkzeugkatalog über 18 operative Domänen (125 Werkzeuge)](#76-umfassender-werkzeugkatalog-über-18-operative-domänen-125-werkzeuge)
8. [Model Context Protocol (MCP) Integration](#8-model-context-protocol-mcp-integration)
   - 8.1 [Offene Erweiterbarkeit mit MCP](#81-offene-erweiterbarkeit-mit-mcp)
   - 8.2 [Dynamische Werkzeugerkennung und Normalisierung](#82-dynamische-werkzeugerkennung-und-normalisierung)
9. [Hierarchisches Langzeitgedächtnis und DIS-Datenschutz (Gedächtnis v2)](#9-hierarchisches-langzeitgedächtnis-und-dis-datenschutz-gedächtnis-v2)
   - 9.1 [Hierarchie der Gedächtnis-Entitäten](#91-hierarchie-der-gedächtnis-entitäten)
   - 9.2 [Der zweistufige Abruf-Mechanismus](#92-der-zweistufige-abruf-mechanismus)
   - 9.3 [Zero-Knowledge-Speicherung mit DIS und Blind-HMAC-Indizes](#93-zero-knowledge-speicherung-mit-dis-und-blind-hmac-indizes)
10. [Webrecherche und SearXNG-Suchzusammenfassung](#10-webrecherche-und-searxng-suchzusammenfassung)
    - 10.1 [Architektur und private Metasuche](#101-architektur-und-private-metasuche)
    - 10.2 [Frage-Umschreibung und Koreferenzauflösung](#102-frage-umschreibung-und-koreferenzauflösung)
    - 10.3 [Volltext-Auszüge und Zitate mit Quellenbelegen](#103-volltext-auszüge-und-zitate-mit-quellenbelegen)
    - 10.4 [Flüchtige Zero-Retention-Privatsphäre](#104-flüchtige-zero-retention-privatsphäre)
11. [Singra Projects: Autonome Software-Entwicklung](#11-singra-projects-autonome-software-entwicklung)
    - 11.1 [Virtuelles Dateisystem und browserseitiges Bundling](#111-virtuelles-dateisystem-und-browserseitiges-bundling)
    - 11.2 [Laufzeitdiagnose, Vitest-Tests und Sichtprüfung](#112-laufzeitdiagnose-vitest-tests-und-sichtprüfung)
    - 11.3 [Git-Anbindung und Token-Hygiene](#113-git-anbindung-und-token-hygiene)
    - 11.4 [Fullstack Dev-Sandbox und flüchtige Container-Umgebungen](#114-fullstack-dev-sandbox-und-flüchtige-container-umgebungen)
    - 11.5 [Der 13-Phasen-Deployment-Vertrag](#115-der-13-phasen-deployment-vertrag)
    - 11.6 [Automatisierte Browser-Tests mit Playwright](#116-automatisierte-browser-tests-mit-playwright)
12. [Echtzeit-Sprachverarbeitung und Audio-Pipeline](#12-echtzeit-sprachverarbeitung-und-audio-pipeline)
    - 12.1 [Duale Spracharchitektur](#121-duale-spracharchitektur)
    - 12.2 [Spekulative Oberflächen-Signalisierung](#122-spekulative-oberflächen-signalisierung)
    - 12.3 [Gesprächsführung und Belegfilter](#123-gesprächsführung-und-belegfilter)
13. [Maunting Smart System (MSS): Desktop-Companion](#13-maunting-smart-system-mss-desktop-companion)
    - 13.1 [Rust/Tauri-Architektur](#131-rusttauri-architektur)
    - 13.2 [Offline-Wake-Word: „Singra“](#132-offline-wake-word-singra)
    - 13.3 [Klick-Durchlässiges Partikel-Overlay](#133-klick-durchlässiges-partikel-overlay)
    - 13.4 [Kryptografische Gerätekopplung](#134-kryptografische-gerätekopplung)
14. [Autonome Hintergrund-Worker, Aufgaben und Guardian-Watchdog](#14-autonome-hintergrund-worker-aufgaben-und-guardian-watchdog)
    - 14.1 [Aufgaben-Engine (`AiTask`) und Skills (`AiSkill`)](#141-aufgaben-engine-aitask-und-skills-aiskill)
    - 14.2 [Guardian-Watchdog und autonome Reparaturen](#142-guardian-watchdog-und-autonome-reparaturen)
15. [Architektur-Entscheidungen: Warum Singra so gebaut ist](#15-architektur-entscheidungen-warum-singra-so-gebaut-ist)

---

## 1. Überblick und Systemidentität

### 1.1 Was ist Singra?
**Singra** ist die native autonome Intelligenz und der Agentenharnisch von MauntingStudios, fest integriert in den Kern des Maunting Server Managers (MSM). Singra fungiert nicht als oberflächlicher Chatbot oder externer Bot-Wrapper, sondern als operatives Arbeitssystem.

Singra verbindet semantisches Sprachverständnis mit direkter Ausführung: Die KI verwaltet Container-Lebenszyklen, diagnostiziert Serverlogs, richtet PostgreSQL-Datenbanken ein, betreibt vollwertige Web-Entwicklungsumgebungen, pflegt ein kryptografisch versiegeltes Langzeitgedächtnis und steuert Echtzeit-Sprachinteraktionen.

Die Identität ist an allen Stellen im System fest und unveränderlich:
- **Backend-Konstante**: Zentral definiert in `backend/services/ai_prompt.py` als `KI_NAME = "Singra"`.
- **Systemprompt-Identität**: Singra tritt verbindlich unter diesem Namen auf und wird grammatikalisch als „sie“ angesprochen.
- **Desktop-Wake-Word**: Die Desktop-Anwendung Maunting Smart System (MSS) erkennt das gesprochene Rufwort „Singra“ über ein lokal kalibriertes akustisches Modell.
- **Einstellungsstopp**: Frühere frei wählbare Namen (`users.agent_name`) wurden mit der Datenbankmigration `20261005_01` dauerhaft entfernt. Der Name ist Identität, keine Benutzereinstellung.

### 1.2 Namensherkunft und die Singularitäts-Metapher
Der Name **Singra** leitet sich unmittelbar von der **Gravitationssingularität** ab, der Singularität eines Schwarzen Lochs. In der Astrophysik bezeichnet die Singularität jenen Punkt unendlicher Dichte, an dem alle Raumzeitpfade zusammenlaufen, bekannte physikalische Gesetzmäßigkeiten ihre Gültigkeit verlieren und etwas fundamental Neues entsteht.

In der Entstehungsgeschichte trug die KI zunächst den internen Arbeitstitel **AEGIS** (Schutzschild), bevor das System vollständig unter dem Namen **Singra** konsolidiert wurde.

Für den Agentenharnisch von MSM besitzt die Singularität eine konkrete technische Bedeutung:
1. **Das Ende deterministischer Programmierung**: Klassische Serververwaltung arbeitet deterministisch mit festen Skripten und starren `if/else`-Verzweigungen. Tritt ein unerwarteter Fehler im Log auf, ändert sich eine Konfigurationssyntax oder bricht ein Netzwerkpfad weg, bleibt deterministischer Code stehen und bricht ab.
2. **Der Übergang an der Singularitätsgrenze**: Singra markiert die Grenze, an der starre Programmierung endet und autonome, emergente Problemlösung beginnt. Der Agentenharnisch fungiert als Schwerkraftzentrum, in dem Systemzustände, Telemetriedaten, Logs, Konfigurationsdateien, Langzeitwissen und Webrecherchen zusammenlaufen.
3. **Emergenz und Selbstheilung**: Wo ein Skript scheitert, analysiert Singra die Fehlermuster, stellt Hypothesen auf, prüft Voraussetzungen mit sicheren Lesewerkzeugen und führt mehrstufige Selbstheilungsketten durch.

### 1.3 Einsatzbereiche und Architekturübersicht
Singra arbeitet in drei eng verzahnten Umgebungen:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Singra KI-Agentenharnisch (MSM)                      │
└──────┬──────────────────────────────┬────────────────────────────┬──────┘
       │                              │                            │
       ▼                              ▼                            ▼
┌──────────────┐               ┌──────────────┐             ┌──────────────┐
│   Webpanel   │               │ MSS Desktop  │             │  Headless    │
│ (Chat, Voice,│               │ (Rust/Tauri, │             │ Hintergrund- │
│  Projects IDE)               │  Takeover)   │             │   Worker     │
└──────┬───────┘               └──────┬───────┘             └──────┬───────┘
       │                              │                            │
       └──────────────────────────────┼────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Zentraler Ausführungskern                           │
│   (AiRun · ai_stream · ai_tool_registry · DIS Shield · Gedächtnis v2)   │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Web-Verwaltungspanel**: Vollständige Server-Administration, reaktiver Server-Sent Events (SSE) Chat, WebRTC-Sprachübertragung und die webbasierte Entwicklungsumgebung Singra Projects.
2. **Maunting Smart System (MSS) Desktop**: Native Desktop-Applikation mit lokaler Offline-Wake-Word-Erkennung, frei schwebendem Partikelschwarm und hardwarenahen Desktop-Bedienwerkzeugen.
3. **Headless Hintergrund-Worker und Guardian**: Autonome Aufgabenverarbeitung (`AiTask`), planmäßige Wartungsläufe und kontinuierliche Infrastrukturüberwachung ohne geöffnete Nutzersitzung.

---

## 2. Architektur und Ausführungskern (AiRun und Streaming-Pipeline)

### 2.1 Das native Agenten-System
MSM verzichtet bewusst auf externe Bibliotheken wie LangGraph, AutoGen oder CrewAI. Stattdessen setzt das System auf einen maßgeschneiderten, auf geringe Latenz und PostgreSQL-Transaktionssicherheit optimierten Kern:

- **Dauerhafte Läufe (`AiRun`)**: Jede Anfrage erzeugt einen persistenten Datensatz in PostgreSQL (`models/ai_run.py`). Der Lauf speichert Status (`created`, `streaming`, `waiting_confirmation`, `executing_tools`, `completed`, `failed`), Rolle, Modellparameter, Werkzeugaufrufe, Token-Zähler und Fehlergrenzen.
- **Ereignis-Vermittler (`ai_run_broker`)**: Ein speicherbasierter, asynchroner Vermittler (`services/ai_run_broker.py`) entkoppelt die Modellausführung von HTTP- und WebSocket-Verbindungen. Er publiziert Textfragmente, Werkzeugstarts und Bestätigungskarten in Echtzeit. Schließt der Nutzer den Tab, läuft der Prozess im Backend unbeeindruckt weiter; beim erneuten Öffnen führt der Broker den Zustand ohne Unterbrechung fort.
- **Segment-Ausführung (`ai_stream.engine`)**: Verwaltet die iterative Schleife zwischen Sprachmodell und Werkzeugausführung.

### 2.2 Ablauf einer Modellanfrage

```
Nutzereingabe (Chat, Sprache, API)
                 │
                 ▼
       ai_chat / ai_voice
 (Rechteprüfung, Secret-Schwärzung,
  Prüfung des Token-Budgets)
                 │
                 ▼
        AiRun-Erstellung
   (Status: INITIALIZING, DB-Lock)
                 │
                 ▼
     ai_stream.launcher.start
 (Aufbau von Kontext, Gedächtnis,
  Systemprompt, Werkzeugen, Denkstufe)
                 │
                 ▼
┌──────────────────────────────────┐
│      Provider-Stream-Schleife    │◄─────────────────────────┐
│   (OpenAI / Anthropic / Gemini)  │                          │
└────────────────┬─────────────────┘                          │
                 │                                            │
        Werkzeug aufgerufen?                                  │
        ├── NEIN ──> Tokens an ai_run_broker streamen ──> Fertig
        │                                                     │
        └── JA                                                │
             │                                                │
             ▼                                                │
   ai_tool_registry Dispatch                                  │
(Schema prüfen, Rolle validieren,                             │
 Herkunftsgrenze herkunft_schnitt)                            │
             │                                                │
    Werkzeug-Klassifikation                                   │
    ├── LESE-WERKZEUG ────────────────────────────────────────┤
    │   (Sofort ausführen, bis zu 48k Zeichen sammeln,        │
    │    Ergebnis in nächste Modellrunde einspeisen)          │
    │                                                         │
    └── SCHREIB-WERKZEUG                                      │
        ├── Aktive AiAutonomyGrant?                           │
        │   ├── JA ──> Sofort ausführen ──────────────────────┘
        │   └── NEIN ─> AiActionProposal Karte erzeugen
        │               Status: AWAITING_APPROVAL
        │               (Ausführung anhält bis Nutzer bestätigt)
```

### 2.3 Feste Ausführungsgrenzen und Sicherheitsregeln
Um Serverressourcen und Budgets vor fehlerhaften Modellanweisungen zu schützen, gelten im Kernel feste Obergrenzen (`backend/services/ai_stream/types.py`):

| Parameter | Wert | Funktion im laufenden Betrieb |
|---|---|---|
| `MAX_TOOL_RESULT_CHARS_PER_ROUND` | 48.000 Zeichen (~12.000 Tokens) | Verhindert, dass umfangreiche Logausgaben das Kontextfenster in einer einzelnen Runde überfüllen. Überschüssige Zeichen werden auf Folgerunden verteilt. |
| `MAX_TOOL_CALLS` | 64 pro Runde | Notfall-Schutzschalter. Mehr als 64 Werkzeugaufrufe in einem einzigen Schritt deuten auf eine Fehlfunktion hin und führen zum Abbruch. |
| `MAX_TOOL_ROUNDS` | 48 Runden | Maximale Anzahl an Lesewerkzeug-Schleifen. Ermöglicht komplexe Diagnosen ohne künstlichen vorzeitigen Abbruch. |
| `MAX_WRITE_ROUNDS` | 24 Runden | Maximale Schreibwerkzeug-Runden pro Lauf. Ausreichend für mehrstufige Installationen, begrenzt jedoch das Risiko. |
| `WERKZEUG_ZEITGRENZE` | 60,0 Sekunden | Timeout pro Werkzeug. Verhindert, dass blockierte Netzwerksockets den gesamten Lauf lahmlegen. |
| `MAX_GLEICHE_AUFRUFE` | 4 gleiche Aufrufe | Schleifenschutz. Ruft ein Modell viermal hintereinander dasselbe Werkzeug mit identischen Argumenten auf, wird der fünfte Aufruf mit einem erläuternden Hinweis abgewiesen. |
| `MAX_GLEICHE_POLLING_AUFRUFE` | 8 Aufrufe | Erhöhte Grenze für Statusprüfungen (`POLLING_WERKZEUGE = {"read_server_status", "read_server_logs", "check_server_reachability"}`). |

---

## 3. Systemprompt-Architektur (`ai_prompt.py`)

Der Systemprompt (`backend/services/ai_prompt.py`) ist modular aus benannten Textkonstanten aufgebaut. Diese Bauweise verhindert Syntaxfehler, trennt Verhaltensregeln sauber voneinander und ermöglicht effizientes GPU-Prompt-Caching.

### 3.1 Modulare Struktur benannter String-Blöcke
Jeder Abschnitt ist als eigenständige Konstante definiert:

- **`ROLLE`**: Legt die Kernaufgabe fest: Singra betreut Server, Logs, Konfigurationen, Mods und Netzwerke sachlich, präzise und ohne unbegründete Vorsichtsverweigerung.
- **`IDENTITAET`**: Definiert die unveränderliche Identität. Singra wird als „sie“ angesprochen, verweist auf die Singularitäts-Herkunft und behandelt das zugrundeliegende Sprachmodell als austauschbare Technik.
- **`HALTUNG`**: Sachlicher Tonfall: ruhig, direkt, auf den Punkt. Verhindert Zustimmungsfloskeln, künstliche Höflichkeitsschleifen und Floskeln wie „Hier ist eine Übersicht“. Setzt Gedankenstriche sparsam ein und bevorzugt natürliche Satzstrukturen.
- **`FORMAT`**: Richtlinien zur Markdown-Formatierung. Verhindert künstliche Aufzählungen; die Struktur entsteht aus dem Inhalt. Im Sprachmodus automatisch ausgefiltert.
- **`ZEITANSAGE`**: Untersagt ungefragte Ansagen von Datum oder Uhrzeit. Die Systemuhr dient der internen Einordnung, nicht als Textfüllung.
- **`EINZELCHAT`**: Handhabung fortlaufender Chats. Verhindert, dass alte Serverprobleme aus früheren Gesprächen ungefragt auf neue Themen übertragen werden.
- **`MITREDEN`**: Gesprächsbegleitung. Singra kündigt anstehende Schritte mit einem kurzen, natürlichen Satz an, bevor Werkzeuge starten, ohne interne Methodennamen zu nennen.
- **`GEHIRN_QUITTUNG` & `GEHIRN_EINWURF`**: Angepasste Gesprächsregeln für die Gehirn-Rolle: kurze Bestätigungen beim Delegieren an Worker und natürliche Übergänge („Ach, übrigens...“), wenn Hintergrund-Ergebnisse eintreffen.
- **`BUENDELN`**: Parallele Ausführung. Werkzeuge, die voneinander unabhängig sind (z. B. Status, Ports und Backups dreier Server), müssen in einer einzigen Runde gebündelt aufgerufen werden.
- **`KEIN_STUMMER_ZUG`**: Verbietet stumme Züge. Auch vor Bestätigungskarten oder Rückfragen steht immer ein erklärender Satz.
- **`BELEGE`**: Zeigt konkrete Codeausschnitte (1 bis 5 Zeilen) mit Deutung, statt ganze Logdateien unreflektiert abzutippen.
- **`RUECKFRAGEN` & `ERMESSEN`**: Hohe Schwelle für Rückfragen. Wenn der Nutzer ein Ziel formuliert („Erstelle mir einen DayZ-Server“), entscheidet Singra die technischen Parameter (RAM, CPU, Ports) eigenständig und nennt sie im Ergebnis.
- **`PROAKTIV` & `AGENTIC_LOOP_SELF_HEALING`**: Selbstheilung bei Werkzeugfehlern. Schlägt ein Schritt fehl, analysiert Singra die Ursache, korrigiert die Parameter und versucht es in der nächsten Runde erneut, statt aufzugeben.
- **`AUFTRAEGE`**: Sechsstufige Definition für „richte ein“: Spielversion ermitteln, Blueprint anpassen, Node prüfen, Server anlegen, DNS konfigurieren und den laufenden Betrieb über Serverlogs nachweisen.
- **Fachblöcke**: Spezifische Anweisungen für `DATENBANKSERVER`, `DATENBANK_STUDIO`, `KAPAZITAET`, `SERVERBEZUG`, `AUDIT`, `WERKZEUGE`, `DOKUMENTATION`, `DATEIEN`, `PROJEKTE_UND_CODING`, `BLUEPRINTS`, `MODS`, `ERREICHBARKEIT`, `WEBSUCHE`, `REGIONSANALYSE`, `UNWIDERRUFLICHES`, `POSTFACH_UND_KALENDER`, `POPUPS_UND_ANKUENDIGUNGEN`, `NOTIZEN`, `DATEIANHAENGE`, `MESSENGER`, `CLOUDFLARE`, `BENUTZER_UND_RECHTE`, `GEDAECHTNIS`, `SPRECHWEISE`, `SKILLS`, `GEHEIMNISSE`, `UNTRUSTED`, `GUARDIAN` und `AUFGABEN`.

### 3.2 Rollen-Block-Matrizen (`ROLLEN_BLOECKE`)
Die Prompt-Blöcke werden je nach Rolle zusammengestellt:

```python
ROLLEN_BLOECKE = {
    "voll": BLOECKE,
    "gehirn": GEHIRN_BLOECKE,
    "worker": WORKER_BLOECKE,
    "realtime": REALTIME_BLOECKE,
    "live": LIVE_BLOECKE,
}
```

- **`voll`**: Vollständige Blockfolge für reguläre interaktive Sitzungen.
- **`gehirn`**: Strategische Planungsrolle. Delegiert schreibende Serveraktionen über `worker_start` an Worker.
- **`worker`**: Autonome Hintergrund-Ausführung. Schließt menschliche Kommunikationsblöcke aus (`NICHT_IM_WORKER = {EINZELCHAT, RUECKFRAGEN, GEDAECHTNIS, HALTUNG, IDENTITAET, SPRECHWEISE, GUARDIAN}`) und hängt die spezifische `WORKER`-Direktive an.
- **`realtime`**: Sprachmodus mit direkter Audioausgabe.
- **`live`**: Backend-Unterstützung für externe Sprachmodelle (`LIVE_BLOECKE = REALTIME_BLOECKE \ {MITREDEN, BELEGE}` mit `HINTER_DER_STIMME`).

### 3.3 Filtersets und Sprachanpassungen (`NUR_GETIPPT`)
Im Sprachmodus werden visuelle Formatierungen gezielt gefiltert:
- **`NUR_GETIPPT = frozenset({FORMAT, GUARDIAN})`**: Entfernt Markdown-Regeln und Hintergrund-Wartungsschleifen aus Sprachsitzungen.
- **`GESPROCHEN` & `ZUSTIMMUNG_GESPROCHEN`**: Weist das Modell an, flüssigen Fließtext ohne Aufzählungszeichen zu sprechen, Zahlen gerundet in Worten zu formulieren („gut zwei Gigabyte“) und Codeblöcke rein visuell auf dem Bildschirm anzuzeigen.
- **`HINTER_DER_STIMME`**: Formatierungsfreie Rückgabe für vorgeschaltete Sprachmodelle wie GPT-Live.

### 3.4 GPU-Prompt-Caching und die 10-%-Abrechnungsregel
Frontier-Modelle halten statische Prompt-Präfixe im GPU-Speicher vor. Singra nutzt diesen Mechanismus gezielt:
1. Statische Prompt-Blöcke stehen unverändert ganz am Anfang des Kontexts (`backend/services/ai_context_service.py`).
2. Dieser Anfang bleibt über Anfragen hinweg byteidentisch.
3. In `backend/services/ai_usage_service.py` werden gecachte Eingabe-Tokens mit lediglich 10 % abgerechnet (`CACHE_ANRECHNUNG_PROZENT = 10`):

$$\text{Angerechnete Tokens} = \text{Tatsächliche Tokens} \times 0{,}10$$

Dies schützt Nutzerkontingente vor vorzeitiger Erschöpfung.

### 3.5 Der Sicherheitsgrundsatz: Der Prompt ist nicht die Sicherheitsgrenze
In Singra gilt ein unverrückbares Prinzip:

> **„Der Prompt ist nicht die Sicherheitsgrenze.“**

Systemprompts leiten das Modell sprachlich an, bilden jedoch keine Sicherheitsgrenze. Zugriffsschutz wird im Backend mechanisch erzwungen:
1. **RBAC-Rechteprüfung**: Durch `permission_service.py` vor Bereitstellung jedes Werkzeugs geprüft.
2. **Herkunfts-Schnittstellen (`herkunft_schnitt`)**: Beschränkt verfügbare Werkzeuge auf Token-Ebene.
3. **Server-Auflösung (`_resolve_server`)**: Prüft bei jedem Zugriff die echte Datenbank-Berechtigung auf die Ziel-ID.
4. **Verbindliche Bestätigungskarten**: Schreibwerkzeuge pausieren den Lauf und verlangen menschliche Freigabe via `AiActionProposal`.

---

## 4. Kontextfenster-Steuerung und Kompaktierung

### 4.1 Token-Berechnung und der Eingabedeckel je Rolle
Ein unkontrolliert anwachsender Kontext verschlechtert die logische Präzision von Sprachmodellen. Singra implementiert eine deterministische Budgetierung (`services/ai_context_window.py`):
- **Zeichen-Token-Verhältnis (`ZEICHEN_JE_TOKEN = 4`)**: Schnelle Berechnung ohne externe Tokenizer-Bibliotheken.
- **Sicherheitsfaktor (`SICHERHEIT = 0.9`)**: Berücksichtigt deutsche Komposita und JSON-Strukturen (~3,6 Zeichen pro Token).
- **Eingabedeckel je Rolle (`max_context_tokens`, Standard `ANFRAGE_DECKEL_TOKENS = 44.000`)**: Unabhängig von beworbenen Modellfenstern (z. B. 1 Million Tokens) kappt Singra Eingaben. Die Obergrenze steht an der Rolle („Rollen & Kontingente“, 44.000 bis 1.000.000 Token); ohne Eintrag gelten 44.000. Das Fenster des Modells bleibt zusätzlich die harte Grenze.
- **Ausgabe-Reserve (`RESERVE_AUSGABE_TOKENS = 8.192`)**: Reservierter Platz für Modellantworten und Codeerzeugung.

### 4.2 Zweistufige Kontext-Kompaktierung
Erreicht der Kontext den Schwellenwert (`ai_context_compaction_percent`, Standard 75 %), startet die automatische Faltung (`ai_compaction_service.py`):
1. **Feste Verankerung**: Systemprompts, Identität, aktive Projektdaten und angeheftete Gedächtniseinträge bleiben dauerhaft erhalten.
2. **Mittlere Faltung**: Ältere Gesprächsrunden und Logausgaben werden zu einer präzisen Zusammenfassung verdichtet.
3. **Jüngstes Fenster**: Die letzten 4 bis 8 Gesprächsrunden bleiben wortwörtlich im Kontext.

### 4.3 Schwärzung sensibler Daten
Vor Einspeisung in den Modellkontext durchlaufen alle Texte die Filter in `ai_redaction.py`:
- Erkennt Passwörter, API-Schlüssel (`sk-...`, `ghp_...`), JWT-Tokens, SSH-Schlüssel und Session-Cookies.
- Ersetzt sensible Werte durch kryptografische Platzhalter (`[REDACTED_SECRET_#]`), sodass keine Zugangsdaten an externe Anbieter fließen.

---

## 5. Denkstufen und Reasoning-Engine

Singra stellt vier runtime-steuerbare Denkstufen zur Verfügung:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Singra Denkstufen                               │
├───────────────┬────────────────┬───────────────────┬───────────────────┤
│    Schnell    │   Durchdacht   │    Tiefgründig    │  Benutzerdefiniert│
│  (Zero-Shot)  │  (Multi-Step)  │ (Full Synthesis)  │ (Custom Overrides)│
└───────────────┴────────────────┴───────────────────┴───────────────────┘
```

1. **Schnell**: Geringe Latenz für einfache Abfragen, Temperatur ~0,2, maximal 2 Werkzeugrunden.
2. **Durchdacht (Standard)**: Ausgewogene Betriebsart für Administration und Diagnose, Temperatur ~0,4, mehrstufige Werkzeugketten.
3. **Tiefgründig**: Für Code-Refactorings und tiefgehende Ursachenanalysen. Aktiviert erweiterte Denk-Tokens (z. B. OpenAI o-Serie, Claude Thinking).
4. **Benutzerdefiniert**: Manuelle Konfiguration von Temperatur, Top-P und Prompt-Zusätzen durch Administratoren.

---

## 6. Multi-Provider-Infrastruktur und Token-Ökonomie

### 6.1 Modulare Provider-Architektur
Die Provider-Schicht (`backend/services/ai_provider_registry/`) ist modular aufgebaut:
- **Unterstützte Dienste**: OpenAI (GPT-4o, GPT-5/Luna, o1/o3), Anthropic / Azure Anthropic (Claude 3.5 Sonnet, Haiku), Azure OpenAI, Google (Gemini 1.5 Pro, Flash), OpenRouter und ElevenLabs (Sprachsynthese).
- **Kein SSRF-Risiko**: Basis-URLs liegen als feste Konstanten im Programmcode vor. Bei Azure-Deployments wird lediglich ein geprüftes DNS-Label über Regex validiert (`_assert_ressource`).

### 6.2 Lokale souveräne Inferenz (Ollama / vLLM)
Für isolierte oder datenschutzsensible Installationen bindet Singra lokale Inferenzdienste über `services/openai_compatible_adapter.py` an. Lokale Modelle (Ollama, vLLM) ermöglichen autarken Betrieb ohne Datenabfluss an externe Schnittstellen.

### 6.3 Gleitende Zeitfenster für Kontingente
Token-Budgets werden über gleitende Zeitfenster überwacht (`services/ai_limit_service.py`):
- `FENSTER_TAG`: Rollierende 24 Stunden.
- `FENSTER_WOCHE`: Rollierende 7 Tage.
- `FENSTER_MONAT`: Rollierende 30 Tage.  
Dies verhindert Engpässe zum Monatswechsel.

---

## 7. Werkzeug-Ausführung, Autonomie und Herkunfts-Schnittstellen

### 7.1 Strikte JSON-Schema-Invarianz
Jedes Werkzeug in `ai_tool_registry.py` definiert ein valides JSON-Schema mit `type: "object"` und explizitem `properties`-Wörterbuch. Strikte Modelle (`gpt-5.6-luna`, Claude Tool Use) verweigern fehlerhafte Schemas mit `400 Bad Request`. Singra validiert alle über 125 Werkzeuge beim Systemstart.

### 7.2 Werkzeug-Klassifikation: Lesen vs. Schreiben und Bestätigungskarten
Singra unterscheidet strikt zwei Betriebsklassen:
- **Lese-Werkzeuge**: Zustandsabfragen (Serverstatus, Logprüfung, Dokumentationssuche). Werden unmittelbar und ohne Bestätigung ausgeführt.
- **Schreib-Werkzeuge (`SCHREIBWERKZEUGE`)**: Verändernde Aktionen (Dateien bearbeiten, Container starten/stoppen, Mails senden, Datenbankänderungen). Standardmäßig pausieren Schreibwerkzeuge den Lauf und erzeugen eine `AiActionProposal`-Karte in der Benutzeroberfläche zur Prüfung durch den Administrator.

### 7.3 Autonomie-Freigaben (`AiAutonomyGrant`)
Administratoren können zeitlich befristete Autonomierechte für bestimmte Werkzeuggruppen vergeben (z. B. persönliche Notizen oder Kalender). Destruktive Kernoperationen (Server löschen, Datenbanken entfernen) erfordern stets eine manuelle Bestätigung.

### 7.4 Schutz vor Endlosschleifen und Polling-Deckel (`MAX_GLEICHE_AUFRUFE`)
- **Reguläre Werkzeuge (`MAX_GLEICHE_AUFRUFE = 4`)**: Wiederholt ein Modell denselben Aufruf viermal mit identischen Parametern, wird der fünfte Versuch mit einer erklärenden Rückmeldung abgewiesen.
- **Polling-Werkzeuge (`MAX_GLEICHE_POLLING_AUFRUFE = 8`)**: Für Startüberprüfungen (`POLLING_WERKZEUGE = {"read_server_status", "read_server_logs", "check_server_reachability"}`) sind bis zu 8 Runden zulässig, um asynchrone Container-Starts zu begleiten.

### 7.5 Herkunfts-Schnittstellen (`herkunft_schnitt`)
Werkzeugberechtigungen sind strikt nach Herkunft getrennt:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Herkunfts-Isolation                             │
├──────────────────────┬─────────────────────────────────────────────────┤
│ Herkunft             │ Erlaubte Werkzeug-Befugnisse                    │
├──────────────────────┼─────────────────────────────────────────────────┤
│ Webpanel             │ Serververwaltung, Datenbanken, Singra Projects, │
│                      │ Webrecherche, Mail, Kalender, Chat-Werkzeuge.   │
│                      │ GESPERRT: Lokale Desktop-Maus-/Tastatursteuerung│
├──────────────────────┼─────────────────────────────────────────────────┤
│ MSS Desktop-App      │ Alle Webpanel-Werkzeuge PLUS:                   │
│                      │ Lokale Desktop-Übernahme (Maus/Tastatur),       │
│                      │ Lokaler Dateisystem-Zugriff in der Sandbox.     │
├──────────────────────┼─────────────────────────────────────────────────┤
│ Headless Worker      │ Geplante Aufgaben, Monitoring, Guardian.        │
│                      │ GESPERRT: Nutzerdialoge, Desktop-Übernahme.     │
└──────────────────────┴─────────────────────────────────────────────────┘
```


### 7.6 Umfassender Werkzeugkatalog über 18 operative Domänen (125 Werkzeuge)

Singra registriert in `backend/services/ai_tool_registry.py` exakt 125 Werkzeuge für alle Systembereiche des Panels:

#### 7.6.1 Server-Betrieb und Lebenszyklus (9 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `list_my_servers` | Global Read | Keine | `query`, `status_filter` | Listet alle für den Benutzer sichtbaren Server auf. Liefert Server-IDs für Folgeaktionen. |
| `read_server_status` | Server Read | `server.view` | `server_id` | Liest Status, PID, Uptime, RAM- und CPU-Werte sowie Healthcheck-Zustand des Containers. |
| `read_server_capacity` | Server Read | `server.view` | `server_id` | Prüft zugewiesenen RAM, CPU-Kerne, Plattenplatz und Node-Grenzwerte. |
| `read_server_logs` | Server Read | `server.logs.view` | `server_id`, `lines`, `tail` | Liest aktuelle Container-Logs (bis zu 1.000 Zeilen). Passwörter werden geschwärzt. |
| `execute_server_action` | Server Write | `server.power.control` | `server_id`, `action`, `rationale` | Führt Aktionen wie Start, Stop, Restart oder Kill aus. Läuft über den Vorschlagspfad. |
| `propose_server_lifecycle` | Server Write | `server.power.control` | `server_id`, `action`, `timeout`, `rationale` | Schlägt Server-Aktionen mit konfigurierbarem Timeout für sauberes Herunterfahren vor. |
| `propose_server_repair` | Server Write | `server.power.control` | `server_id`, `repair_action`, `rationale` | Schlägt Reparaturabläufe vor (Container neu aufsetzen, Dateirechte korrigieren, Image neu laden). |
| `propose_server_create` | Global Write | `panel.servers.create` | `name`, `blueprint_id`, `node_id`, `ram_mb`, `ports`, `rationale` | Schlägt das Anlegen eines neuen Servers anhand eines Blueprints auf einer Node vor. |
| `propose_server_delete` | Server Write | `server.delete` | `server_id`, `delete_volumes`, `rationale` | Schlägt das unwiderrufliche Löschen eines Servers vor. Verlangt immer manuelle Bestätigung. |

#### 7.6.2 Server-Konfiguration und Dateien (7 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `read_config` | Server Read | `server.files.read` | `server_id`, `file_path`, `max_lines` | Liest Textdateien (`.env`, `.ini`, `.json`, `.yml`, `.properties`). Pfade außerhalb des Containers sind gesperrt. |
| `list_server_files` | Server Read | `server.files.read` | `server_id`, `directory`, `depth` | Listet Dateien und Ordner auf. Pfadwechsel nach oben (`..`) werden abgewiesen. |
| `search_server_files` | Server Read | `server.files.read` | `server_id`, `query`, `file_pattern` | Schnelle Textsuche in Server-Konfigurationen und Spieldateien. |
| `propose_config_set` | Server Write | `server.files.write` | `server_id`, `file_path`, `content`, `rationale` | Ersetzt eine Konfigurationsdatei vollständig. Legt vorab ein automatisches Backup an. |
| `propose_config_update` | Server Write | `server.files.write` | `server_id`, `file_path`, `updates`, `rationale` | Ändert gezielt Werte in `.ini`-, `.env`- oder `.properties`-Dateien, ohne Kommentare zu zerstören. |
| `propose_config_patch` | Server Write | `server.files.write` | `server_id`, `file_path`, `find`, `replace`, `rationale` | Führt gezielten Suchen-und-Ersetzen-Patch in großen Dateien aus. |
| `propose_file_delete` | Server Write | `server.files.write` | `server_id`, `file_path`, `rationale` | Schlägt das Löschen einer Datei im Serververzeichnis vor. Wichtige Mounts sind geschützt. |

#### 7.6.3 Generische Mods und Modpacks (8 Werkzeuge)
*Wichtige Regel:* Es gibt keine fest einprogrammierten Spiel-IDs (wie Minecraft `432`). Alle Aktionen arbeiten dynamisch über die Plattform-APIs für beliebige Blueprint-Spiele.

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `read_server_mods` | Server Read | `server.mods.view` | `server_id` | Zeigt installierte Mods, Dateinamen, Versionen und Aktivitätsstatus. |
| `read_mod_updates` | Server Read | `server.mods.view` | `server_id` | Prüft installierte Mods gegen neuere Versionen auf CurseForge oder Modrinth. |
| `search_curseforge_mods` | Global Read | `ai.mods.search` | `query`, `game_id`, `category` | Sucht Einzelmods nach Begriffen oder Themen (z. B. Performance, Minimap, Technik). |
| `search_curseforge_modpacks` | Global Read | `ai.mods.search` | `query`, `game_id`, `page` | Sucht vollständige Modpacks für das jeweilige Spiel. |
| `search_workshop_mods` | Global Read | `ai.mods.search` | `query`, `app_id` | Sucht Workshop-Objekte für Steam-basierte Gameserver. |
| `propose_mod_install` | Server Write | `server.mods.manage` | `server_id`, `mod_id`, `file_id`, `rationale` | Lädt eine Mod-Datei herunter und installiert sie im Mod-Ordner. |
| `propose_mod_toggle` | Server Write | `server.mods.manage` | `server_id`, `mod_filename`, `enable`, `rationale` | Schaltet Mods durch Umbenennung (z. B. Endung `.disabled`) an oder aus. |
| `propose_modpack_install` | Global Write | `server.mods.manage` | `server_id`, `modpack_id`, `file_id`, `rationale` | Installiert Modpacks samt Konfigurationen und Abhängigkeiten. |

#### 7.6.4 Netzwerk, Ports und Cloudflare DNS (8 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `read_server_network` | Server Read | `server.network.view` | `server_id` | Zeigt Bridge-IP, öffentliche IP, Host-Interface und Port-Mappings. |
| `read_server_ports` | Server Read | `server.network.view` | `server_id` | Zeigt Container-Ports, Protokolle (TCP/UDP) und Host-Zuweisungen. |
| `check_server_reachability` | Server Read | `server.network.view` | `server_id`, `port` | Führt Socket-Pings von außen durch, um Firewall- und Portfreigaben zu prüfen. |
| `propose_bind_ip_update` | Server Write | `server.network.manage` | `server_id`, `bind_ip`, `rationale` | Weist dem Server auf Servern mit mehreren Netzwerkkarten eine neue IP zu. |
| `cloudflare_list_zones` | Global Read | `ai.cloudflare.read` | Keine | Listet DNS-Zonen aus angebundenen Cloudflare-Konten auf. |
| `cloudflare_list_dns_records` | Global Read | `ai.cloudflare.read` | `zone_id` | Zeigt DNS-Einträge einer Zone zur Vermeidung von Namenskollisionen. |
| `propose_cloudflare_dns_record` | Global Write | `ai.cloudflare.manage` | `zone_id`, `type`, `name`, `content`, `ttl`, `proxied`, `rationale` | Schlägt das Erstellen oder Ändern eines DNS-Records (A, AAAA, CNAME, SRV) vor. |
| `propose_cloudflare_dns_delete` | Global Write | `ai.cloudflare.manage` | `zone_id`, `record_id`, `rationale` | Schlägt das Löschen eines DNS-Records vor. |

#### 7.6.5 Backups und Zeitpläne (5 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `read_server_backups` | Server Read | `server.backups.view` | `server_id` | Listet vorhandene Snapshots mit Dateigröße, Datum und Integritätsprüfung auf. |
| `propose_backup` | Server Write | `server.backups.create` | `server_id`, `name`, `rationale` | Erstellt ein sofortiges komprimiertes Backup der Server-Volumes. |
| `propose_backup_restore` | Server Write | `server.backups.restore` | `server_id`, `backup_id`, `rationale` | Stellt einen Snapshot wieder her. Stoppt Container, entpackt Daten und prüft Dateien. |
| `propose_backup_schedule_set` | Server Write | `server.backups.manage` | `server_id`, `cron_expression`, `retention`, `rationale` | Richtet automatische Backup-Zyklen und Aufbewahrungsfristen ein. |
| `propose_restart_schedule_set` | Server Write | `server.power.manage` | `server_id`, `cron_expression`, `rationale` | Richtet geplante Wartungsneustarts ein (z. B. tägliche Bereinigung um 04:00 Uhr). |

#### 7.6.6 Nodes und Blueprints (8 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `read_node_capacity` | Global Read | `panel.nodes.view` | `node_id` | Prüft Host-Kerne, Gesamtspeicher, Plattenbelegung und Container-Dichte. |
| `read_node_health` | Global Read | `panel.nodes.view` | `node_id` | Liest Daemon-Status, Load-Average, Temperaturen und Docker-Socket-Status. |
| `advise_node_placement` | Global Read | `panel.nodes.view` | `required_ram`, `required_cpu`, `game_slug` | Empfiehlt anhand der aktuellen Telemetriedaten den besten Host-Node für einen neuen Server. |
| `list_blueprints` | Global Read | `panel.blueprints.view` | `category` | Listet native und importierte Blueprint-Vorlagen auf. |
| `read_blueprint` | Global Read | `panel.blueprints.view` | `blueprint_id` | Liest die JSON-Konfiguration einer Vorlage (Images, Ports, Mounts, Variablen). |
| `propose_blueprint_change` | Global Write | `panel.blueprints.manage` | `blueprint_id`, `patch`, `rationale` | Ändert Blueprint-Felder unter Beachtung der Sicherheitsregeln (keine Root-Rechte, keine Shell-Hooks). |
| `propose_blueprint_delete` | Global Write | `panel.blueprints.manage` | `blueprint_id`, `rationale` | Löscht ungenutzte Vorlagen. Blockiert, falls noch Server darauf aufbauen. |
| `propose_server_blueprint_switch` | Server Write | `server.edit` | `server_id`, `new_blueprint_id`, `rationale` | Überträgt einen bestehenden Server auf eine aktualisierte Blueprint-Version. |

#### 7.6.7 PostgreSQL Studio (2 Werkzeuge, 14 Ansichten)
Singra greift direkt auf dieselbe Diensteinheit wie das visuelle Studio im Panel zu (`services/postgres_studio_service.py`).

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `read_database` | Server Read | `server.databases.read` (`server.databases.admin` für Admin-Reiter) | `server_id`, `database_id`, `view`, `target` | Zeigt Schemadaten. Ansichten: `overview`, `objects`, `table`, `function`, `extensions`, `roles`, `grants`, `health`, `rows`, `operations`, `operation_schema` sowie geschützte Reiter (`parameters`, `sessions`, `locks`). |
| `propose_database_change` | Server Write | `server.databases.admin` | `server_id`, `database_id`, `operation`, `rationale` | Führt typisierte DDL-Operationen (`create_table`, `add_column`, `alter_column`, `create_index`, `drop_table`) über `postgres_ddl.compile_operation` aus. |

#### 7.6.8 Singra Coding Platform, Projekte und Sandbox (2 Werkzeuge, 26 Aktionen)

#### `project_create`
- **Art:** Global Write (`ai.projects.create`)
- **Parameter:** `name`, `description`, `project_kind` (`coding`, `docs`, `general`), `framework` (`html`, `react`, `fullstack`).
- **Funktion:** Legt ein neues KI-Projekt (`AiProject`) an, initialisiert den virtuellen Dateibaum und setzt Standarddateien auf.

#### `project_workspace`
- **Art:** Dynamisch (Lesen oder Schreiben je nach gewählter Aktion)
- **Parameter:** `action`, `project_id`, `path`, `content`, `find`, `replace`, `command`, `sql`, `environment` etc.
- **Unterstützte Aktionen:**
  1. `list_projects`: Listet Projekte des Nutzers oder Teams auf.
  2. `create_project`: Alternative zum Anlegen eines Projekts.
  3. `list_files`: Zeigt Dateien und Verzeichnisse des Projekts.
  4. `read_file`: Liest Textdateien vollständig aus.
  5. `write_file`: Schreibt oder aktualisiert eine Datei inklusive Hash-Berechnung.
  6. `patch_file`: Ersetzt gezielt Textblöcke (`find`/`replace`) in Dateien.
  7. `delete_file`: Entfernt eine Datei aus dem Projektverzeichnis.
  8. `configure_preview`: Legt Einstiegsdatei (`index.html`, `src/App.tsx`) und Viewports fest.
  9. `preview_inspect`: Liest Konsolenfehler, Netzwerkabbrüche und DOM-Zustände aus.
  10. `test_project`: Führt automatisierte Tests und Linter aus.
  11. `run_command`: Führt gekapselte Befehle im Dev-Container des Projekts aus.
  12. `get_environment`: Liefert zugewiesene Ports, DB-Zugangsdaten und Container-Status.
  13. `publish_production`: Startet die 13-Phasen-Deployment-Pipeline für den Produktivbetrieb.
  14. `search_components`: Sucht nach UI-Komponenten und Design-Tokens im Projekt.
  15. `run_sql`: Führt SQL-Befehle auf der Dev- oder Prod-PostgreSQL-Datenbank aus.
  16. `db_status`: Zeigt Verbindungsstatus, Migrationsstand und Tabellenanzahl.
  17. `db_tables`: Listet Tabellen, Spaltentypen und Fremdschlüssel auf.
  18. `db_rows`: Liest Datensätze mit Paginierung aus.
  19. `apply_migrations`: Wendet ausstehende Datenbankschemata sicher an.
  20. `git_status`: Zeigt Änderungen im Arbeitsverzeichnis und Staging-Bereich.
  21. `git_sync`: Holt und integriert Upstream-Änderungen aus dem Git-Repository.
  22. `git_commit`: Erstellt einen Git-Commit. Authentifizierung erfolgt flüchtig über Umgebungsvariablen (`GIT_CONFIG_KEY_*`), niemals über Tokens in URLs.
  23. `dev_start`: Startet Dev-Backend- und Dev-Frontend-Container mit Live-Reload.
  24. `dev_stop`: Pausiert Dev-Container zur Ressourcenschonung.
  25. `dev_status`: Zeigt aktuellen Zustand der Dev-Umgebung.
  26. `git_branch`, `git_open_pr`, `merge_to_main`: Steuert Branches und Pull-Requests.

#### 7.6.9 Dokumenten-Verwaltung (11 Werkzeuge)
Für gemeinsames Arbeiten an strukturierten Dokumenten, Notizen und Architekturentwürfen.

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `list_documents` | Global Read | `docs.use` | `folder_id`, `query` | Listet Dokumente auf, auf die der Nutzer Zugriff hat. |
| `read_document` | Global Read | `docs.use` | `document_id` | Liest den Volltext und die Metadaten eines Dokuments. |
| `read_document_structure` | Global Read | `docs.use` | `document_id` | Zeigt Dokumentenaufbau, Überschriften und Abschnitte. |
| `read_document_selection` | Global Read | `docs.use` | `document_id`, `selection_range` | Liest die vom Benutzer im Editor aktuell markierte Textstelle. |
| `read_document_skill` | Global Read | `docs.use` | `document_id` | Liest dokumentspezifische Format- und Inhaltsanweisungen. |
| `edit_document` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `operations`, `rationale` | Bearbeitet Textabschnitte live im Editor. Änderungen können per `undo_ai_edit` rückgängig gemacht werden. |
| `update_document_title` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `title` | Ändert den Dokumenttitel. |
| `add_document_comment` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `anchor`, `comment_text` | Fügt einer Textstelle einen Review-Kommentar hinzu. |
| `list_document_comments` | Global Read | `docs.use` | `document_id` | Zeigt offene und geschlossene Kommentare im Dokument. |
| `get_document_outline` | Global Read | `docs.use` | `document_id` | Erstellt ein Inhaltsverzeichnis für die Navigation. |
| `undo_ai_edit` | Docs Write | `docs.use` + `ai.docs.use` | `document_id`, `version_id` | Setzt das Dokument auf den Stand vor der letzten KI-Änderung zurück. |

#### 7.6.10 Persönliche Produktivität: E-Mail, Kalender, Notizen, Pop-ups (16 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `email_search` | Global Read | `email.use` | `query`, `sender`, `limit` | Sucht in eingebundenen IMAP-Postfächern nach E-Mails. |
| `email_read` | Global Read | `email.use` | `message_id`, `mailbox_id` | Liest den bereinigten Textinhalt einer E-Mail. |
| `propose_email_send` | Global Write | `email.send` | `recipient`, `subject`, `body_text`, `body_html`, `rationale` | Schlägt den Versand einer E-Mail über SMTP vor. |
| `send_test_email` | Global Read | `email.use` | Keine | Sendet eine Test-E-Mail ausschließlich an die eigene hinterlegte Adresse. Benötigt keine Bestätigungskarte, da kein Fremdversand möglich ist. |
| `calendar_read` | Global Read | `calendar.use` | `start_date`, `end_date`, `calendar_id` | Liest Termine aus CalDAV-Kalendern in einem Zeitfenster. |
| `read_team_calendar` | Global Read | `calendar.use` | `team_id`, `start_date`, `end_date` | Liest Termine aus gemeinsamen Teamkalendern. |
| `propose_calendar_event_create` | Global Write | `calendar.manage` | `title`, `start_time`, `end_time`, `recurrence`, `event_type`, `rationale` | Schlägt Einzel- oder Serientermine vor (`recurrence` für tägliche, wöchentliche, monatliche Regeln). |
| `propose_calendar_event_update` | Global Write | `calendar.manage` | `event_id`, `title`, `start_time`, `end_time`, `rationale` | Ändert bestehende Termine oder verschiebt Uhrzeiten. |
| `propose_calendar_event_delete` | Global Write | `calendar.manage` | `event_id`, `rationale` | Schlägt das Löschen eines Termins vor. |
| `notes_read` | Global Read | `notes.use` | `query`, `category`, `team_id`, `is_pinned` | Liest und durchsucht Notizen des Benutzers. |
| `read_team_notes` | Global Read | `notes.use` | `team_id`, `category` | Liest Teamnotizen und Aufgabenlisten. |
| `propose_note_create` | Global Write | `notes.manage` | `title`, `content_markdown`, `category`, `team_id`, `rationale` | Schlägt eine neue Notiz in Markdown vor. |
| `propose_note_update` | Global Write | `notes.manage` | `note_id`, `title`, `content_markdown`, `rationale` | Passt Inhalt oder Kategorie einer Notiz an. |
| `propose_note_delete` | Global Write | `notes.manage` | `note_id`, `rationale` | Schlägt das Löschen einer Notiz vor. |
| `popups_read` | Global Read | `panel.popups.view` | `only_active` | Listet panelweite Ankündigungen auf. |
| `propose_popup_set` | Global Write | `panel.popups.manage` | `popup_id`, `title`, `content_markdown`, `start_at`, `end_at`, `rationale` | Erstellt oder ändert Pop-up-Hinweise für alle Panel-Nutzer. |

#### 7.6.11 Regionale Analysen, 3D-Globus und Satellitendaten (5 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `analyze_region` | Global Read | `ai.satellite.use` | `location`, `camera` (`overview`, `focus`, `detail`) | Ermittelt Geokoordinaten, Open-Meteo-Wetter, Sentinel-2- oder ArcGIS-Satellitenbilder und lokale Meldungen. Sofortanzeige unter 300 ms, langsame Daten laden parallel nach. |
| `control_region_camera` | Global Read | `ai.satellite.use` | `action` (`zoom_in`, `zoom_out`, `overview`, `focus_location`), `location` | Steuert die geöffnete 3D-Karte ohne neue Datenabfrage. Hält bei Besichtigungstouren verbindlich 10 Sekunden Verweildauer je Ort ein. |
| `voice_set_region_view` | Voice Control | `ai.satellite.use` | `tab` (`overview`, `satellite`, `news`, `traffic`, `weather`), `source_id`, `scene_id` | Schaltet im Sprachmodus auf den passenden Reiter um, bevor Singra über Wetter oder Karten spricht. |
| `voice_leave_region_view` | Voice Control | `ai.satellite.use` | Keine | Schließt die Kartenansicht, wenn das Gespräch wieder zu Server- oder Programmierthemen wechselt. |
| `voice_resolve_latest_proposal` | Voice Control | Keine | `decision` (`confirm`, `reject`) | Erlaubt das Verwerfen des letzten Aktionsvorschlags per Sprache. Bestätigungen erfordern den Klick auf die Karte oder aktive Autonomie. |

#### 7.6.12 Websuche und Seitenleser (2 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `web_search` | Global Read | `ai.web_search.use` | `query`, `count` | Sucht über den datenschutzfreundlichen SearXNG-Sidecar. Verhindert das Tracking von Suchanfragen durch Drittanbieter. |
| `read_web_page` | Global Read | `ai.web_search.use` | `url`, `max_chars` | Liest und bereinigt Webinhalte. **SSRF-Schutz:** Blockiert Anfragen an private Netzwerkbereiche (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.0.0/16`) sowie lokale Loopback-Pfade. |

#### 7.6.13 Langzeitgedächtnis und Skills (6 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `search_memory` | Global Read | `ai.memory.use` | `query`, `limit` | Durchsucht persönliche Erinnerungen per Vektorähnlichkeit. Verschlüsselt mit DIS Shield (AES-GCM). |
| `search_team_memory` | Global Read | `ai.memory.use` | `team_id`, `query`, `limit` | Durchsucht geteilte Team-Erinnerungen. |
| `read_skill` | Global Read | `ai.skills.use` | `skill_id` | Liest erlernte Verhaltensregeln und Anweisungen aus. |
| `learn_skill` | Global Read | `ai.skills.use` | `name`, `trigger_description`, `instructions` | Speichert neue Arbeitsanweisungen für Singra. Als `global_read` eingestuft, da reine Textregeln keine Systemrechte umgehen können. |
| `learn_team_skill` | Global Read | `ai.skills.use` | `team_id`, `name`, `instructions` | Speichert Verhaltensregeln für ein gesamtes Team. |
| `forget_skill` | Global Read | `ai.skills.use` | `skill_id` | Löscht veraltete Verhaltensregeln. |

#### 7.6.14 Desktop- und Smart-System-Integration (MSS) (6 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `desktop_steuern` | Desktop | `desktop.control` | `action`, `parameters` | Steuert Systemfunktionen und Fenster auf dem Entwicklerrechner mit Nutzerzustimmung. |
| `desktop_system` | Desktop | `desktop.control` | `query` | Liest Auslastung, Fensterlisten und OS-Version des lokalen Desktops aus. |
| `desktop_dateien` | Desktop | `desktop.control` | `action`, `path` | Gekapselte Dateioperationen auf freigegebenen Arbeitsordnern des Entwicklers. |
| `desktop_launch_app` | Desktop | `desktop.control` | `app_identifier` | Startet registrierte Entwicklungsumgebungen (z. B. VS Code, Terminal). |
| `desktop_aufraeumen` | Desktop | `desktop.control` | `target` | Bereinigt temporäre Build-Caches auf dem Rechner. |
| `desktop_artifact` | Desktop | `desktop.control` | `artifact_id` | Verwaltet Dateien in der lokalen Quarantäne (`%LOCALAPPDATA%\Singra\MSS-Quarantine`). |

#### 7.6.15 Hintergrund-Aufgaben und Sub-Worker (8 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `list_tasks` | Global Read | `ai.tasks.view` | `status` | Zeigt geplante und aktive Hintergrundaufgaben des Benutzers. |
| `propose_task_set` | Global Write | `ai.tasks.manage` | `name`, `schedule_cron`, `action_payload`, `rationale` | Richtet wiederkehrende Hintergrundwartungen ein. |
| `propose_task_delete` | Global Write | `ai.tasks.manage` | `task_id`, `rationale` | Löscht geplante Hintergrundaufgaben. |
| `wait_until` | Global Read | Keine | `condition_type`, `target_id`, `expected_status`, `timeout_seconds` | Pausiert den Ablauf, bis ein asynchroner Zustand (z. B. Server-Neustart beendet) eintritt. |
| `worker_start` | Global Read | `ai.workers.manage` | `role`, `task_prompt`, `context_ids` | Startet einen spezialisierten Sub-Worker im Hintergrund. |
| `worker_frage` | Global Read | `ai.workers.manage` | `worker_id`, `question` | Fragt Zwischenstände eines laufenden Sub-Workers ab. |
| `worker_antwort` | Global Read | `ai.workers.manage` | `worker_id`, `answer` | Gibt einem Sub-Worker Rückmeldung zu offenen Detailfragen. |
| `worker_cancel` | Global Read | `ai.workers.manage` | `worker_id` | Beendet einen Sub-Worker vorzeitig. |

#### 7.6.16 Verwaltung, Rollen und Abrechnung (12 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `list_users` | Global Read | `panel.users.view` | `query`, `role_filter` | Zeigt registrierte Panel-Benutzer und deren Rollen. |
| `read_user_permissions` | Global Read | `panel.users.view` | `user_id` | Prüft effektive Rechte eines Nutzers über alle Ebenen. |
| `list_roles` | Global Read | `panel.roles.view` | Keine | Listet definierte Rollen und zugeordnete Rechte auf. |
| `propose_role_set` | Global Write | `panel.roles.manage` | `role_id`, `name`, `permissions`, `rationale` | Erstellt oder ändert Rollendefinitionen. |
| `propose_role_delete` | Global Write | `panel.roles.manage` | `role_id`, `rationale` | Löscht Rollen, sofern keine Nutzer mehr zugewiesen sind. |
| `propose_user_roles` | Global Write | `panel.users.manage` | `user_id`, `role_ids`, `rationale` | Weist Benutzern Rollen zu oder entzieht diese. |
| `propose_user_server_permission` | Global Write | `server.permissions.manage` | `server_id`, `user_id`, `permission`, `grant`, `rationale` | Setzt individuelle Serverrechte für Nutzer. |
| `propose_ai_tarif_role` | Global Write | `panel.settings.write` | `role_id`, `daily_tokens`, `monthly_tokens`, `rationale` | Konfiguriert KI-Tokenkontingente je Rolle. |
| `read_hoster_setup` | Global Read | `panel.hoster.read` | Keine | Prüft WHMCS-, FOSSBilling- oder Hoster-Anbindungen. |
| `read_hoster_integration_guide` | Global Read | `panel.hoster.read` | `billing_system` | Liefert technische Webhook-Anleitungen für Abrechnungssysteme. |
| `propose_hoster_integration` | Global Write | `panel.hoster.manage` | `provider`, `api_url`, `api_key_encrypted`, `rationale` | Verbindet automatische Abrechnungsschnittstellen. |
| `propose_hoster_product` | Global Write | `panel.hoster.manage` | `product_id`, `blueprint_id`, `node_id`, `specs`, `rationale` | Verknüpft Abrechnungsprodukte mit automatischer Servererstellung. |
| `read_audit_summary` | Global Read | `panel.audit.view` | `timeframe` | Fasst Sicherheitsvorfälle (Fehl-Logins, Rechteänderungen) zusammen. |
| `search_audit_log` | Global Read | `panel.audit.view` | `query`, `user_id`, `action`, `limit` | Durchsucht unveränderliche Audit-Log-Einträge. |
| `read_ai_action_history` | Global Read | `panel.audit.view` | `server_id`, `project_id`, `limit` | Zeigt Historie aller von Singra vorgeschlagenen und ausgeführten Aktionen. |

#### 7.6.17 Dokumentation, Anhänge und Dialog (5 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `search_docs` | Global Read | Keine | `query` | Durchsucht die interne technische Dokumentation von MSM. |
| `read_docs` | Global Read | Keine | `doc_path` | Liest spezifische Dokumentationsseiten aus dem System. |
| `search_chat_attachments` | Global Read | Keine | `query`, `mime_type` | Sucht nach im Chat hochgeladenen Dateien (Bilder, Logs, Vorlagen). |
| `read_chat_attachment` | Global Read | Keine | `attachment_id` | Liest Textinhalte oder Bilddaten aus Chat-Anhängen für multimodale Analysen. |
| `ask_user` | Global Read | Keine | `question`, `options` | Stellt dem Benutzer gezielte Rückfragen bei unklaren Anforderungen. |

---

#### 7.6.18 Autonomer Server-Guardian Watchdog & Selbstheilung (5 Werkzeuge)

| Werkzeug | Art | Berechtigung | Parameter | Funktion |
|---|---|---|---|---|
| `read_guardian_incidents` | Server Read | `server.view` | `server_id`, `limit` | Liest vergangene Watchdog-Vorfallsberichte, Absturzerkennungen, OOM-Ereignisse und Reparaturprotokolle aus. |
| `propose_guardian_tuning` | Server Write | `server.edit` | `server_id`, `tuning_payload`, `rationale` | Passt Watchdog-Schwellenwerte (Absturzkaskaden-Limits, Speichergrenzen, Neustartverzögerung) gezielt für einen Server an. |
| `propose_server_repair` | Server Write | `server.power.control` | `server_id`, `repair_action`, `rationale` | Leitet automatisierte Reparaturroutinen ein (Container-Neubau, Korrektur beschädigter Volume-Rechte, Image-Neuabruf). |
| `propose_backup` | Server Write | `server.backups.create` | `server_id`, `name`, `rationale` | Erzwingt das obligatorische Notfall-Backup als Schranke vor jeder mutierenden Selbstheilungsaktion. |
| `read_server_logs` | Server Read | `server.logs.view` | `server_id`, `lines`, `tail` | Direkte Protokollanalyse zur Stacktrace-Extraktion, Fehlercode-Ermittlung und Ursachendiagnose. |

---

## 8. Model Context Protocol (MCP) Integration

### 8.1 Offene Erweiterbarkeit mit MCP
Singra unterstützt das Model Context Protocol (MCP) nativ (`backend/routers/ai_mcp.py`):
- **Bereiche**: Global (serverweit), Team (Arbeitsgruppe) und Persönlich (Nutzer).
- **Transportschichten**: `http` / `sse` (Netzwerk-Endpunkte) und `stdio` (lokale Prozesse via Befehl und Argumente).

### 8.2 Dynamische Werkzeugerkennung und Normalisierung
Nach Verbindungsaufbau zu einem MCP-Server:
1. Singra führt den MCP-Handshake aus (`tools/list`).
2. Werkzeuge werden normalisiert (`normalisiere_werkzeuge`), geprüft und in `ai_tool_registry` eingebunden.
3. Singra bindet externe MCP-Werkzeuge direkt in Chat- und Sprachabläufe ein, geschützt durch RBAC-Rechte und Audit-Protokolle.

---

## 9. Hierarchisches Langzeitgedächtnis und DIS-Datenschutz (Gedächtnis v2)

Das Langzeitgedächtnis (`services/ai_gedaechtnis_schreiber.py`, `ai_gedaechtnis_abruf.py`, `ai_gedaechtnis_pflege.py`) skaliert problemlos auf über 100.000 Einträge pro Bereich.

### 9.1 Hierarchie der Gedächtnis-Entitäten
Definiert in `backend/models/ai_memory.py`:
- **Themen (`AiMemoryTopic` / `ai_memory_themen`)**: Übergreifende Themenbereiche. Name verschlüsselt; Duplikate werden per HMAC-Index (`name_index`) verhindert.
- **Begriffe (`AiMemoryBegriff` / `ai_memory_begriffe`)**: 64-Bit-HMAC-Wort-Hashes für schnelle Wortsuchabfragen ohne Klartextwörter in SQL.
- **Einträge (`AiMemoryEntry` / `ai_memory_entries`)**: Die eigentlichen Fakten. Speichert verschlüsselten Text (`value_encrypted`), verschlüsselten Titel (`titel_encrypted`), Wichtigkeit (1–5), Halbwertszeit (`haltbarkeit_tage`), Rang (`kopf_rang`) und AES-GCM-verschlüsselte Vektoren (`embedding_bytes`).
- **Belege (`AiMemoryBeleg` / `ai_memory_belege`)**: Verknüpft logische Schlüsse (`art = 'schluss'`) mit den zugrundeliegenden Basiserinnerungen.
- **Pflege und Historie (`AiMemoryPflege`, `AiMemoryVersion`)**: Verfolgt Wartungsdurchläufe und sichert frühere Fassungen bei Änderungen oder Zusammenführungen.

### 9.2 Der zweistufige Abruf-Mechanismus
Statt bei jeder Anfrage die gesamte Datenbank zu durchsuchen, teilt Singra den Abruf in zwei Stufen:
- **Stufe 1: „Im Kopf“**: Angeheftete und höchstrangige Einträge (`kopf_rang = Wichtigkeit × Präsenz`), täglich neu berechnet. Steht fest am Anfang des Prompts vor dem Verlauf und ermöglicht zuverlässiges Prompt-Caching.
- **Stufe 2: „Passend zur Frage“**: Zweigleisige Suche nach relevanten Zusatzfakten:
  1. *Semantische Vektorsuche*: Skalarprodukt im Arbeitsspeicher über 256/1536 float32 Embeddings (`BEDEUTUNG_BODEN = 0.2`, `BEDEUTUNG_ABSTAND = 0.15`, `BEDEUTUNG_DECKEL = 0.5`).
  2. *Wortindex*: Abgleich von HMAC-Wortprüfwerten über `ai_memory_begriffe`.  
  Höchstens 60 Trefferkandidaten (`KANDIDATEN = 60`) werden über den DIS-Sidecar entschlüsselt.

### 9.3 Zero-Knowledge-Speicherung mit DIS und Blind-HMAC-Indizes
- **Verschlüsselter Inhalt (`DisText`)**: Alle Gedächtnisinhalte liegen als AES-256-GCM-Ciphertexte in Umschlägen vor (`msm-dis-v1:...`).
- **Gebundene AAD**: Die Authenticated Additional Data (`msm:ai:memory:value:{scope_identity}:{id}`) bindet Ciphertexte an Nutzer und Eintrag.
- **Blind-HMAC-Indizes**: Suchbegriffe und Indexschlüssel werden mit bereichsgebundenen HMACs gehasht (`/blind-index`). Selbst bei vollständigem Datenbankzugriff sind weder Klartexte noch Suchmuster einsehbar.

---

## 10. Webrecherche und SearXNG-Suchzusammenfassung

### 10.1 Architektur und private Metasuche
Singra nutzt eine angebundene SearXNG-Instanz (`backend/services/ai_web_search_service.py`, `ai_search_summary_service.py`):
- Lokaler SearXNG-Sidecar (`http://127.0.0.1:8888`) für private Metasuchen (Web, Bilder, News, Wikipedia).
- Optionale offizielle Such-API (Brave Search) mit verschlüsseltem Schlüssel.
- Gesteuert über den Panel-Schalter `ai_web_search_enabled` und das Rollenrecht `ai.web_search.use`.

### 10.2 Frage-Umschreibung und Koreferenzauflösung
Mehrstufige Fragen werden durch `UMSCHREIBEN_SYSTEM` aufbereitet:
- Löst Bezüge und Pronomen auf („das“, „dieser Server“, „die Zutaten“).
- Teilt mehrteilige Anfragen in bis zu 3 eigenständige Suchen auf (`suchanfragen`).
- Erkennt Themenwechsel (`themenwechsel: true/false`) und verwirft alte Suchkontexte bei neuen Themen.

### 10.3 Volltext-Auszüge und Zitate mit Quellenbelegen
- Öffnet bis zu 2 Webseiten (`SEITEN_MAX = 2`) für Volltextanalysen, wenn Such-Snippets nicht ausreichen.
- Liest bis zu 20.000 Zeichen Wikitext aus Wikipedia-Artikeln inklusive Infoboxen.
- Kennzeichnet belegte Fakten mit Ziffernmarkern (`[1]`, `[2]`).
- Unbelegte Teile werden ausdrücklich als „Ohne Quellenbeleg:“ markiert.

### 10.4 Flüchtige Zero-Retention-Privatsphäre
Suchzusammenfassungen speichern **0 Bytes in der Datenbank**. Auszüge und Volltexte verbleiben flüchtig im Arbeitsspeicher und werden nach Ende des Laufs vollständig verworfen.

---

## 11. Singra Projects: Autonome Software-Entwicklung

### 11.1 Virtuelles Dateisystem und browserseitiges Bundling
Singra Projects (`services/ai_project_service.py`, `frontend/src/components/ai/singra/`) stellt eine vollständige Entwicklungsumgebung bereit:
- **Virtuelles Dateisystem**: Mehrdateien-Projekte in PostgreSQL mit atomaren Schreiboperationen.
- **Client-Side Bundler (`previewBundle.ts`)**: Kompiliert React 18, TypeScript, Tailwind 3 CSS und HTML direkt im Browser innerhalb eines isolierten Iframes (`sandbox="allow-scripts"`). Vorschauen aktualisieren sich in unter 200 ms ohne Server-Build-Container.

### 11.2 Laufzeitdiagnose, Vitest-Tests und Sichtprüfung
- **Laufzeit-Diagnose (`PreviewDiagnostics.tsx`)**: Fängt `console.error` und Rendering-Probleme ab und leitet sie an Singra zur automatischen Reparatur weiter.
- **Sichtprüfung (`SingraVisualInspectionModal.tsx`)**: Ansichts-Emulation für Desktop (1920x1080), Tablet (768x1024) und Mobilgeräte (375x667).
- **Vitest-Testsuite (`SingraTestResults.tsx`)**: Führt automatisierte Unit-Tests in der Sandbox aus.
- **Produktions-Bereitstellung (`SingraDeploymentPanel.tsx`)**: 13-stufige Bereitstellungs-Pipeline mit Versionsarchivierung und Rollback per Mausklick.

### 11.3 Git-Anbindung und Token-Hygiene
Direkte Anbindung an GitHub und GitLab (`services/ai_project_git.py`):
- Automatisiert Branches, Commits, Pushes und Pull-Requests.
- **Token-Hygiene**: Remote-URLs werden bereinigt (`_clean_git_remote_url`). Zugangsdaten werden flüchtig über Umgebungsvariablen (`http.extraheader`) übergeben; keine Klartext-Tokens in `.git/config`.


### 11.4 Die Fullstack Dev-Sandbox (`services/singra/dev_env.py`)
Singra ermöglicht das Entwickeln und Testen von Webanwendungen direkt in MSM:
- **Echte Dev-Container:** Erzeugt zwei gekoppelte Container: `<Projektname> (Dev Backend)` und `<Projektname> (Dev Frontend)`.
- **Eigene PostgreSQL-Dev-Datenbank:** Richtet eine isolierte Testdatenbank mit Schemamigrationen und Testdaten (`seeds/*.sql`) ein.
- **Dynamische Ports:** Weist freie Host-Ports über `allocate_ports()` zu und konfiguriert das Caddy-Routing.
- **Automatisches Pausieren nach 60 Minuten:** Der Hintergrunddienst `services/singra/dev_idle_worker.py` prüft den letzten Aktivitätszeitpunkt. Nach 60 Minuten Inaktivität werden Dev-Container gestoppt, um RAM und CPU zu schonen. Bei der nächsten Anfrage reaktivieren sie in unter 3 Sekunden.

### 11.5 Der 13-Phasen-Deployment-Vertrag (`services/singra/runner.py`)
Für die produktive Veröffentlichung (`publish_production`) durchläuft jedes Projekt eine feste Pipeline mit 13 Prüfschritten:

```
[1. Snapshot] ──> [2. Qualität] ──> [3. Build Frontend] ──> [4. Build Backend]
      │
      ▼
[5. Datenbank] ──> [6. Migrationen] ──> [7. Start Backend] ──> [8. Backend-Check]
      │
      ▼
[9. Start Frontend] ──> [10. Proxy-Update] ──> [11. Frontend-Check]
      │
      ▼
[12. API-Check] ──> [13. DB-Check] ──> [Fertig: Release committed]
```

1. **`snapshot`:** Liest Projektdateien aus der Datenbank in ein Staging-Verzeichnis und berechnet für jede Datei einen SHA-256-Prüfsummen-Manifest.
2. **`quality`:** Führt ESLint, TypeScript-Kompilierungsprüfungen (`tsc --noEmit`) und Ruff-Python-Checks aus. Syntaxfehler brechen die Pipeline sofort ab.
3. **`build_frontend`:** Kompiliert das Frontend-Bundle (z. B. Vite/React) produktionsreif mit Minifizierung und Tree-Shaking.
4. **`build_backend`:** Erstellt Container-Images oder Runtime-Umgebungen (`server_runtime_env`).
5. **`database`:** Richtet die produktive PostgreSQL-Datenbank samt Benutzer und DIS-verschlüsseltem Passwort ein.
6. **`migrations`:** Wendet Datenbank-Migrationen und Initialdaten an.
7. **`start_backend`:** Startet den Backend-Container mit injizierten Umgebungsvariablen.
8. **`verify_backend`:** Führt TCP-Socket-Pings auf den Backend-Port durch, bis der Dienst erreichbar ist (Timeout 30 Sekunden).
9. **`start_frontend`:** Startet den Frontend-Container oder bindet das statische Web-Bundle ein.
10. **`proxy`:** Aktualisiert das Caddy-Reverse-Proxy-Routing (`caddy_service.py`), bindet Domains an und bezieht Let's Encrypt TLS-Zertifikate.
11. **`verify_frontend`:** Sendet einen HTTP-Probe-Request an die Web-URL und prüft auf Status `200 OK`.
12. **`verify_api`:** Sendet einen HTTP-Probe-Request an `/api/health` oder die konfigurierte Prüf-URL.
13. **`verify_db`:** Führt eine Abfrage (`SELECT 1`) auf der Produktionsdatenbank aus, um die Verbindung zu bestätigen.
14. **`done`:** Das Release wird mit Prüfsumme in `singra_deployments` versiegelt und freigegeben.

### 11.6 Automatisierte Browser-Tests (`services/singra/browser.py`)
Vor der Freigabe validiert Singra Webanwendungen headless mit Playwright:
- **Strikter Origin-Guard:** Fängt Netzwerkanfragen des Browsers ab und blockiert Zugriffe auf externe Domains. Das verhindert Datenabflüsse und sichert DSGVO-Standards ab.
- **Viewports:** Prüft Layouts sowohl auf Desktop- (1280x800) als auch Smartphone-Auflösungen (375x667).
- **Interaktionstests:** Simuliert Klickfolgen, Menübedienung und Formulareingaben.
- **Negativ-Tests:** Provoziert fehlerhafte Eingaben bei Formularen, um sicherzustellen, dass Fehlermeldungen sauber im UI gerendert werden.
- **Screenshots:** Erfasst Screenshots bei jedem Testschritt und hinterlegt diese zur Nachvollziehbarkeit in `SingraTestRun`.

---

---

## 12. Echtzeit-Sprachverarbeitung und Audio-Pipeline

### 12.1 Duale Spracharchitektur
Singra bietet zwei Transportwege für Sprache (`routers/ai_voice.py`, `services/ai_voice_bridge.py`):
1. **WebRTC OpenAI Realtime**: Direkter Peer-to-Peer-Audiostream mit Latenzen unter 400 ms. Ein WebSocket-Seitenkanal signalisiert Werkzeugzustände und Animationen.
2. **WebSocket PCM**: Raw PCM-Audio über authentifizierte WebSockets. Pipeline: VAD -> Whisper STT -> LLM -> ElevenLabs / Lokale TTS. Vollständig on-premises lauffähig.

### 12.2 Spekulative Oberflächen-Signalisierung
Sobald das Backend das erste Werkzeug-Token erkennt (`tool_start`), sendet es ein Ereignis an die Oberfläche. Visuelle Elemente (wie der 3D-Globus-Flug) starten in unter 300 ms, synchron zur gesprochenen Modellausgabe.

### 12.3 Gesprächsführung und Belegfilter
Singra verzichtet im Sprachmodus auf Floskeln („Ich sehe kurz nach...“). Werkzeuge laufen lautlos im Hintergrund. Codeblöcke werden von `ai_voice_bridge.Belegfilter` aus dem Sprachstrom herausgenommen und als Anzeigekarte auf dem Bildschirm dargestellt, statt vorgelesen zu werden.

---

## 13. Maunting Smart System (MSS): Desktop-Companion

### 13.1 Rust/Tauri-Architektur
Das Maunting Smart System (`smart-system/`) ist eine native Desktop-Anwendung auf Basis von Tauri v2, Rust und React.

### 13.2 Offline-Wake-Word: „Singra“
- **Erkennung**: `rustpotter` arbeitet zu 100 % lokal auf der CPU. Keine Audioübertragung im Bereitschaftszustand.
- **Wake-Word**: **Singra**.
- **Kalibrierung**: 6 Testaufnahmen erzeugen ein persönliches MFCC- und DTW-Modell (`wakeword.rpw`).
- **Dreistufige Prüfung**: VAD-Energietest, Median-Filterung und Schwellenwert-Begrenzung (0,30–0,60).
- **Datenschutz**: Erst nach Bestätigung des Wake-Words öffnet sich der Stream. Nach 20 Sekunden Sprachstille schließt die Sitzung automatisch.

### 13.3 Klick-Durchlässiges Partikel-Overlay
Das schwebende Partikel-Overlay unterstützt vollständigen Klick-Durchlass (`src-tauri/src/durchklick.rs`): Mausklicks gehen direkt an darunterliegende Desktop-Programme durch.

### 13.4 Kryptografische Gerätekopplung
Kopplung ohne Passworteingabe über einen 12-stelligen Einmalcode (`/api/auth/devices/redeem`). Refresh-Tokens liegen geschützt im Windows Credential Manager; Zugriffs-Tokens verbleiben flüchtig im RAM.

---

## 14. Autonome Hintergrund-Worker, Aufgaben und Guardian-Watchdog

### 14.1 Aufgaben-Engine (`AiTask`) und Skills (`AiSkill`)
- **`AiTask`-Engine (`services/ai_task_service.py`)**: Führt mehrstufige Hintergrundaufgaben aus, protokolliert Teilschritte und benachrichtigt bei Fertigstellung.
- **`AiSkill`-Katalog (`services/ai_skill_service.py`)**: Dynamischer Wissenskatalog für wiederkehrende administrative Abläufe.

### 14.2 Guardian-Watchdog und autonome Reparaturen
Integrierter Infrastruktur-Wachdienst (`services/ai_guardian_service.py`):
- Überwacht Container-Zustände, OOM-Kills, CPU-/RAM-Auslastung, Zertifikate und Backups.
- Erstellt `AiGuardianNotice`-Meldungen und `AiGuardianRepair`-Reparaturpläne.
- Harmlose Korrekturen laufen unter Autonomie-Freigaben automatisch; kritische Neustarts erfordern manuelle Bestätigung per Mausklick.

---

## 15. Architektur-Entscheidungen: Warum Singra so gebaut ist

| Entscheidung | Ausgangsproblem | Sicherheits- und Betriebsgewinn |
|---|---|---|
| **Herkunfts-Schnittstellen (`herkunft_schnitt`)** | Web-Schwachstellen könnten Desktop-Übernahme auslösen. | Desktop-Befehle sind strikt an kryptografisch gekoppelte Desktop-Tokens gebunden. |
| **DIS-Zero-Knowledge-Gedächtnis** | Datenbank-Leaks legen vertrauliche Betriebsinformationen offen. | Inhalte mit AES-256-GCM verschlüsselt; Suchen laufen über Blind-HMACs. Datenbank-Dumps enthalten keinen Klartext. |
| **Strikte JSON-Schema-Invarianz** | Strenge Modelle verweigern unvollständige Werkzeugdefinitionen. | Pflicht zu `type: "object"` und expliziten `properties` verhindert `400 Bad Request` Fehler zuverlässig. |
| **Eingabedeckel je Rolle (Standard 44.000 Tokens)** | Riesige Kontexte führen zu Halluzinationen und extremen Kosten. | Begrenzt Prompts unabhängig von Modellangaben und sichert präzise Denkabläufe bei stabilen Kosten; ein Tarif kann mehr Kontext bekommen. |
| **Bestätigungskarten für Schreibwerkzeuge** | Fehlgeleitete Modelle könnten Server beschädigen. | Verändernde Aktionen erzeugen `AiActionProposal`-Karten mit Freigabepflicht, außer bei aktiver Autonomie-Freigabe. |
| **Browserseitiges Preview-Bundling** | Server-Build-Container sind langsam und ressourcenintensiv. | Kompiliert React und Tailwind in unter 200 ms im Browser-Iframe ohne Belastung des Host-Servers. |
| **Offline-Wake-Word („Singra“)** | Permanente Cloud-Audioübertragung verletzt die Privatsphäre. | `rustpotter` läuft lokal auf der CPU; Mikrofon-Audiokanäle öffnen erst nach lokaler Erkennung. |
| **Gleitende Kontingentfenster** | Monatliche Stichtage führen zu Engpässen zum Monatsende. | 24h-, 7d- und 30d-Fenster sorgen für gleichmäßige und planbare Ressourcennutzung. |
| **Schleifenschutz (`MAX_GLEICHE_AUFRUFE = 4`)** | Modelle können sich in identischen Abfragen verfangen. | Weist Endlosschleifen mit erklärender Rückmeldung ab und gewährt Polling-Werkzeugen bis zu 8 Durchläufe. |

---

*Singra KI-Plattform — Entwickelt von MauntingStudios. Geschützt durch Defensive Integration Shield (DIS).*
