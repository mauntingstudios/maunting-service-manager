# MSM: Funktionsreferenz

Stand: 11. November 2026, Commit `34213740`, Release `v5.9.1`.

Dieses Dokument beschreibt, was der Maunting Service Manager (MSM) kann und wie die einzelnen
Teile umgesetzt sind. Jede Aussage über das Verhalten wurde am genannten Quellcode geprüft.
Kommentare, Docstrings, Patchnotes und ältere Dokumente dienten nur als Wegweiser zum Code, nie
als Beleg. Wo Code und Text auseinandergehen, gilt der Code; der Widerspruch steht in Kapitel 22.

Die Zahlen sind nachvollziehbar. Die Zählweise steht in Kapitel 23.

## Inhalt

1. [Was MSM ist und wo es steht](#1-was-msm-ist-und-wo-es-steht)
2. [Installation, Update und Umzug](#2-installation-update-und-umzug)
3. [Server anlegen und betreiben](#3-server-anlegen-und-betreiben)
4. [Die Reiter der Server-Detailseite](#4-die-reiter-der-server-detailseite)
5. [Blueprints](#5-blueprints)
6. [Modmanager](#6-modmanager)
7. [Dateimanager und Datenbank-Studios](#7-dateimanager-und-datenbank-studios)
8. [Backups](#8-backups)
9. [Mehrere Nodes](#9-mehrere-nodes)
10. [Rechte und Organisation](#10-rechte-und-organisation)
11. [Konten und Sicherheit](#11-konten-und-sicherheit)
12. [Einstellungen: alle 17 Reiter](#12-einstellungen-alle-17-reiter)
13. [KI: Singra](#13-ki-singra)
14. [Messenger](#14-messenger)
15. [Kalender und Notizen](#15-kalender-und-notizen)
16. [Dokumente](#16-dokumente)
17. [Tresor](#17-tresor)
18. [Browser Pontis](#18-browser-pontis)
19. [Desktop-App MSS und Recovery](#19-desktop-app-mss-und-recovery)
20. [Design-System und Qualitätsstand](#20-design-system-und-qualitätsstand)
21. [Vergleich mit anderen Open-Source-Projekten](#21-vergleich-mit-anderen-open-source-projekten)
22. [Lücken und Widersprüche](#22-lücken-und-widersprüche)
23. [Anhang: Zahlen, Glossar, Dateikarte](#23-anhang-zahlen-glossar-dateikarte)

## 1. Was MSM ist und wo es steht

MSM ist ein selbst gehostetes Verwaltungspanel für Game-Server, Container, Datenbanken und
Linux-Dienste. Es besteht aus zwei Hälften: dem **Panel**, einer FastAPI-Anwendung mit
React-Frontend, und einem oder mehreren **Nodes**, auf denen jeweils `msm-agent` auf einem
Linux-Host läuft. Die Arbeitslasten laufen als Docker-Container im rootless Docker-Daemon eines
unprivilegierten Benutzers, nicht direkt auf dem Host.

### 1.1 Zeitlinie und Größe

| Fakt | Wert | Beleg |
|---|---|---|
| Erster Commit | 19.05.2026, „Initial import: Conan Exiles Panel" | `git log --reverse` |
| Commits | 2481 | `git rev-list --count HEAD` |
| Release-Tags | `v0.9.0` bis `v5.9.1` | `git tag --sort=creatordate` |
| Aktuelles Release | `v5.9.1` | `git describe --tags --abbrev=0` |
| Router-Module | 57, dazu 12 Social-Router | `ls backend/routers`, `backend/routers/social` |
| HTTP-Routen | 740 | `grep -rhoE '@router\.(get\|post\|put\|patch\|delete\|websocket)\('` |
| Service-Module | 235 | `ls backend/services/*.py` |
| Datenbanktabellen | 131 | eindeutige `__tablename__` in `backend/models` |
| Rechte-Schlüssel | 91 | eindeutige `PermissionDef("…")` in `backend/services/permission_catalog.py` |
| KI-Werkzeuge | 125 | geprüft in `backend/tests/test_ai_tool_drift.py` |
| Blueprints | 32 nativ + 1 Community | `backend/blueprints/native/*.blueprint.json`, `blueprints/community/` |
| KI-Skill-Dateien | 9 | `backend/ai_skills/*.md` |
| Backend-Tests | 460 Dateien, 6592 Testfunktionen | `find backend/tests -name 'test_*.py'` |
| Frontend-Tests | 544 Dateien, 4531 Fälle | `find frontend/src -name '*.test.ts[x]'` |
| Rust-Testmarken | 425 | `#[test]` und `#[tokio::test]` in den drei Tauri-Crates |

Das Projekt begann im Mai 2026 als Panel für ein Spiel. Der aktuelle Baum enthält mehr als
Game-Hosting: Identität und Rechte, ein PostgreSQL-Studio, einen KI-Agenten, einen
Ende-zu-Ende-verschlüsselten Messenger, einen Zero-Knowledge-Tresor, einen Dokumenteneditor,
einen Browser und eine Desktop-App. Diese Breite erklärt die Länge des Dokuments.

### 1.2 Das Sicherheitsmodell in einem Absatz

Service-Container entstehen mit `cap_drop=ALL` und `security_opt=["no-new-privileges"]`
(`backend/services/docker_service.py:935`, `msm-agent/services/docker_service.py:297`). Der
Docker-Socket ist der rootless Socket des Dienstbenutzers, etwa `/run/user/<uid>/docker.sock`
(`docker_service.py:139`), nicht `/var/run/docker.sock`. Das Panel läuft als Benutzer `msm` mit
`ProtectSystem=strict` und einer kurzen Liste beschreibbarer Pfade (`msm.service.template`).
Autorisierung entscheidet das Backend, nie das Frontend. Das Frontend darf ein Bedienelement
ausblenden, die Route prüft trotzdem.

### 1.3 Was MSM nicht ist

- Kein Hosting-Anbieter. Die Linux-Hosts stellst du selbst. Die optionale Hoster-API (Kapitel 10)
  existiert für Anbieter, die Bereitstellung automatisieren wollen, schläft aber ohne
  Konfiguration.
- Kein reines Linux-Produkt auf Client-Seite. Panel und Node-Agenten laufen auf Linux; die
  Desktop-App MSS läuft auf Windows und Android und zeigt dieselbe Panel-Oberfläche.
- Nicht rootless während der einmaligen Installation. `install.sh` braucht einmal root. Danach
  laufen Panel, Agent und jeder Service-Container unprivilegiert.

## 2. Installation, Update und Umzug

### 2.1 Bootstrap

`scripts/bootstrap.sh` löst das neueste Release auf, lädt `SHA256SUMS` und das Panel-Archiv und
prüft das Archiv gegen diese Prüfsumme, bevor es `install.sh --simple --domain <Domain>` startet
(`scripts/bootstrap.sh:78-116`).

`install.sh` kennt `--simple`, `--domain` und `--resume-partial`. Es bricht ab, wenn bereits eine
PostgreSQL-Rolle oder Datenbank `msm` existiert, es sei denn, der vorige Lauf ist nachweislich
eine abgebrochene Erstinstallation (`install.sh:1115`). Diese Sperre verhindert, dass ein zweiter
Lauf eine laufende Installation überschreibt.

**Eingerichtet werden:** PostgreSQL, rootless Docker für den Dienstbenutzer, der DIS-Sidecar, der
Agent, Caddy für TLS und die systemd-Units. **Grenze:** Der Bootstrap erwartet eine Domain, die
auf den Host zeigt; der einfache Weg verlangt `--domain` (`install.sh:994`).

### 2.2 Updates

`update.sh` ist der Update-Weg auf einem Node. Es führt `git pull --ff-only` auf dem aktuellen
Branch aus (`update.sh:428`), repariert die Eigentümerschaft nach dem Pull als root, installiert
Abhängigkeiten neu und startet Panel und Sidecars neu (`update.sh:158-160`). `--check-only`
meldet, ohne etwas zu ändern (`update.sh:168`). `msm-update.timer` plant die Prüfung alle 24
Stunden (`OnUnitActiveSec=24h`).

**Grenze:** Ein gescheiterter Lauf lässt die bisherigen Dienste laufen. Das Skript meldet keinen
Erfolg, bevor die Dienste antworten; ein fehlgeschlagener Neustart wird gemeldet.

### 2.3 systemd und TLS

`msm.service.template` startet das Panel als `User=msm` mit `ProtectSystem=strict`,
`ReadWritePaths={{MSM_DIR}}` und ausdrücklichen UFW-Pfaden (`msm.service.template:9-35`). Caddy
beendet TLS; `Caddyfile.template` trägt die Sicherheitsköpfe, den API-Proxy, den
Dokumenten-Kollaborationsendpunkt und den LiveKit-Proxy.

**Grenze:** `NoNewPrivileges` ist bewusst nicht gesetzt, weil die Firewallverwaltung enge
sudo-Gates nutzt (Kommentar in `msm.service.template:24`). Das ist ein dokumentierter Kompromiss,
kein Versehen.

### 2.4 Sidecars

| Sidecar | Zweck | Bindung |
|---|---|---|
| `dis-sidecar` | Verschlüsselungsdienst für `DisText`, ALTCHA, Backup-Streaming | lokales HTTP |
| `docs-sidecar` | Yjs/Hocuspocus und Rendering | Ports 8100 und 8101 (`docs-sidecar/Dockerfile.dev:20`) |
| `searxng-sidecar` | Metasuche für Maunting Search und die KI-Websuche | `127.0.0.1:8888` (`searxng-sidecar/docker-compose.yml:7`) |
| `wetter-sidecar` | lokale Wetterdaten | lokal |
| `livekit-sidecar` | Anrufe | 7880 TCP lokal, 7881 TCP öffentlich, 7882 UDP öffentlich (`livekit-sidecar/README.md:27-29`) |

LiveKit braucht die öffentlichen Medienports, weil WebRTC-Medien nicht durch Caddy laufen. Die
Signalisierung bleibt lokal und wird als `wss://<Domain>/livekit` veröffentlicht.

### 2.5 Nur PostgreSQL

Das Backend lehnt SQLite ab, auch mit `MSM_TESTING` (`backend/database_policy.py`). Tests
verlangen `MSM_TEST_DATABASE_URL`; `scripts/test-postgres.sh` startet einen Wegwerf-Container.
Der Grund ist Verhalten: SQLite erzwingt weder die Längengrenzen noch die Booleschen Typen noch
das Migrationsverhalten, auf das sich der Betrieb verlässt.

### 2.6 Panel-Backup und Komponentenumzug

`panel_backups.py` und `panel_backup_service.py` erstellen ein Panel-Backup: Datenbankdump,
Konfiguration und Manifest. Drei Tabellen gehen ohne Zeilen in den Dump
(`PANEL_BACKUP_OHNE_DATEN`): `chat_media`, `device_pairings` und `login_challenges`. Ihr Schema
bleibt, damit ein Restore funktioniert, aber alte Chiffratblobs, offene Kopplungscodes und
abgelaufene Login-Challenges kommen nicht zurück.

`helper-scripts/migrate-panel-components.sh` verschiebt Komponenten zwischen Hosts: Frontend,
einzelne Gameserver oder die Control Plane. Es unterstützt einen Probelauf und einen atomaren
Schnitt mit Rollback. Der Umzug ist kein Copy-and-hope-Skript: Er stoppt Arbeitslasten, dumpt
Datenbanken und prüft, bevor er umschaltet.

### 2.7 Kubernetes

`deploy/kubernetes/` enthält Manifeste nur für die Control Plane. Gameserver bleiben
Docker-Arbeitslasten auf Nodes. Das Deployment ist als experimentell markiert und läuft mit einer
Replica; der DIS-Sidecar muss im selben Pod laufen. Kapitel 22 wiederholt diese Grenze.

## 3. Server anlegen und betreiben

### 3.1 Ein Server entsteht

Ein Server entsteht aus einem Blueprint. Die Anfrage nennt Blueprint, Node, Ressourcengrenzen,
Bind-IP und Ports. `server_provisioning_service.py` legt den Container an, erzeugt die vom
Blueprint genannten Verzeichnisse, schreibt Seed-Dateien und wendet Konfigurationspatches an.
Scheitert ein Schritt, rollt der Dienst das Angelegte zurück, statt einen halben Server
stehenzulassen.

**Umsetzung:** `routers/servers.py` bietet Anlegen, Start, Stop, Restart, Kill, Install,
Entsperren, Blueprint-Wechsel, Konsole und Exec. Die schwere Arbeit liegt in
`server_lifecycle_service.py` und `server_provisioning_service.py`. Vorgänge, die eine
HTTP-Anfrage überleben, werden zu persistenten Tasks (`routers/tasks.py`), damit die Oberfläche
Fortschritt zeigt statt eines Spinners, der lügt.

### 3.2 Start, Stop, Restart, Kill

Lifecycle-Aktionen laufen je Server über eine Warteschlange (`queue_lifecycle_operation`), nicht
parallel. Die Warteschlange ist nötig: Zwei gleichzeitige „Start"-Aufrufe würden sonst zwei
Container erzeugen oder den Portvergabezustand verletzen.

### 3.3 Automatische Neustarts

Automatische Neustarts sind eine Einstellung je Server mit zwei Modi:

- **Intervall:** alle N Stunden neu starten. Der nächste Lauf wird aus dem erfolgreichen Ende des
  vorigen geplant, nicht ab Anlagezeit, sodass ein Achtstundenintervall nicht Richtung 4 Uhr
  wandert (`scheduler_service.py:174-181`).
- **Cron:** Neustart zu einer festen `HH:MM` (`scheduler_service.py:240-273`).

Der Scheduler ist APScheduler und startet mit dem Panel. Jobs tragen bestimmte IDs
(`restart_server_<id>`, `restart_cron_server_<id>_<Zeit>`) und werden vor dem erneuten Anlegen
entfernt; eine geänderte Planung ersetzt die alte, statt Doppelgänger zu stapeln
(`scheduler_service.py:103`).

### 3.4 Neustarts durch die KI

Die KI setzt kein Datenbankfeld direkt. Sie erzeugt eine Vorschlagskarte mit der beabsichtigten
Änderung, und der Nutzer bestätigt (`backend/services/ai_proposals/server_proposals.py`). Der
Vorschlagsdienst prüft Zielserver und Recht des Aufrufers, schreibt über denselben Dienst wie die
Oberfläche und trägt das Ergebnis ins Audit-Log.

**Grenze:** Vorschläge, die den Betriebszustand oder die Planung ändern, gehören zur
Schreibklasse und verlangen Bestätigung, außer der Server liegt in einer Autonomiefreigabe, die
genau dieses Werkzeug erlaubt (Kapitel 13).

### 3.5 Guardian-Neustart

Ein eigener Wächter startet einen Server neu, wenn der Container verschwunden ist und der
Sollzustand weiterhin „läuft" heißt. Die Bedingungen in `guardian_restart_service.py` sind
bewusst eng:

- beobachteter Zustand ist genau `stopped`; `unhealthy` bleibt der Wiederherstellungsleiter des
  Agenten überlassen,
- die gewünschte Generation entspricht der angenommenen, damit ein frischer Auftrag nicht
  überrannt wird,
- der Sollzustand ist `running`,
- `auto_restart` ist am Server aktiv,
- höchstens ein Versuch alle 300 Sekunden (`_AUTO_RESTART_COOLDOWN_SECONDS`).

Fehlt eine Bedingung, startet Guardian nicht. Ein abstürzender Server wird dadurch nicht zu einer
Neustartschleife, die den Absturz verdeckt.

### 3.6 Konsole und Exec

Die Konsole hat zwei Wege mit unterschiedlichem Risiko:

- **STDIN-Konsole:** schreibt eine Zeile in die Standardeingabe des Containers, als wäre sie in
  der Spielkonsole getippt. Sie kann keinen Host-Befehl ausführen.
- **argv-Exec:** führt einen Befehl im Container aus, nur wenn der Blueprint `enableExec` setzt
  und der Nutzer das passende Recht hält.

Die Oberfläche zeigt einen Live-Strom über WebSocket mit Suche und Kopieren. Exec ist keine Shell
auf dem Node; es bleibt im Container und im Timeout des Blueprints (`execTimeoutSeconds`).

### 3.7 Metriken und Vorfälle

`routers/metrics.py` liefert Panel-Metriken. CPU, Speicher und Platte je Server kommen aus den
Docker-Statistiken über den Node-Client. Vorfälle (`routers/incidents.py`) erfassen Probleme mit
Zeitlinie; `change_timeline.py` erfasst Änderungen, die einen Server betrafen. Beides ist im
Panel und über KI-Werkzeuge mit den Rechten des Aufrufers lesbar.

## 4. Die Reiter der Server-Detailseite

Die Seite baut ihre Reiterleiste aus Blueprint und Rechten. Belegte Schlüssel in
`frontend/src/pages/ServerDetail.tsx` sind Dateien, Konsole, Exec, Mods, Neustarts, Backups,
Datenbanken, Webhooks, Wissen und Guardian. `exec` erscheint nur, wenn der Blueprint es erlaubt,
Mods nur bei modfähigen Blueprints, Datenbanken nur, wenn der Server welche hat.

| Reiter | Was der Nutzer kann | Backend |
|---|---|---|
| Dateien | Durchsuchen, bearbeiten, hochladen, umbenennen, verschieben, löschen, Archive entpacken, nach Name und Inhalt suchen | `routers/files.py` |
| Konsole | Ausgabe lesen, STDIN senden | `routers/servers.py` |
| Exec | Befehl im Container ausführen, wenn freigegeben | `routers/servers.py` |
| Mods | Installieren, aktualisieren, aktivieren, deaktivieren, sortieren, abbrechen | `routers/mods.py` |
| Neustarts | Automatischen Neustart einrichten, Intervall oder Cron | `services/scheduler_service.py` |
| Backups | Erstellen, wiederherstellen, löschen, planen, nach S3 hochladen | `routers/backups.py`, `backup_orchestrator.py` |
| Datenbanken | Datenbanken des Servers anlegen und verwalten | `routers/databases.py` |
| Webhooks | Ausgehende Meldungen für Serverereignisse einrichten | `routers/webhooks_outbound.py` |
| Wissen | Kuratierte Fakten, die die KI für diesen Server nutzen darf | `routers/ai_memory.py`, `ai_memory_service.py` |
| Autopilot | Guardian-Aktionen und automatische Reparaturen | `routers/guardian.py`, `ai_guardian_*` |

### 4.1 Reiter Wissen

Wissenseinträge liegen wie andere KI-Erinnerungen: verschlüsselt, mit Blind-Index für die Suche.
Der Reiter ist kein Wiki nur für Menschen; er speist den KI-Kontext dieses Servers. Deshalb sitzt
er am Server und nicht in einem globalen Notizbuch.

### 4.2 Reiter Autopilot

Autopilot zeigt, was Guardian beobachtet und getan hat: Proben, Wiederherstellungsversuche,
Quarantänezustand und Ausnahmen. Aktionen werden protokolliert; eine Quarantäne aufheben oder
eine Entscheidung überschreiben ist ein eigenes Recht (`routers/guardian.py`).

**Grenze:** Autopilot ist kein allgemeiner Skriptausführer. Er repariert innerhalb der Regeln, die
der Blueprint erklärt; alles außerhalb wird ein Vorfall, kein improvisierter Befehl.

## 5. Blueprints

Ein Blueprint ist der erklärende Vertrag zwischen Panel und Arbeitslast. Er beschreibt Image,
Startbefehl, Ports, Datenpfade, Gesundheitsprüfungen und Backupumfang. MSM liefert 32 native
Blueprints plus ein Community-Beispiel; 18 sind Steam-Spiele, 10 sind Nicht-Steam-Spiele (acht
Minecraft-Varianten, FiveM/RedM, Hytale), dazu Backends, eine Datenbank und ein statisches
Frontend.

### 5.1 Schema

`backend/blueprints/schema.py` definiert die akzeptierte Form. Die Hauptabschnitte:

| Abschnitt | Inhalt |
|---|---|
| `meta` | ID, Name, Kategorie, Autor, Beschreibung |
| `runtime` | Image, Arbeitsverzeichnis, numerischer Nicht-root-`user`, Env, Start-argv, Startprofile, Verzeichnisse, Seed-Dateien, Konfigurationspatches, Stop-Frist, Startprüfung, Exec-Schalter |
| `ports` | benannte Ports (Spiel, Query, RCON, Sprache, Web, Peer, Datenbank, eigener) mit TCP/UDP |
| `source` | wie Dateien ankommen: Steam, HTTPS-Archiv, GitHub, manueller Upload, nur Docker |
| `mods` | Workshop- oder CurseForge-Unterstützung, Injektionsart, Ziel der Modliste |
| `backup` | enthaltene Pfade als relative Globs, Ausschlüsse |
| `health` | Prozess-, Port-, Anwendungs- und Startprüfungen |
| `logs` | Logquellen und Maskierungsregeln |
| `diagnostics` | was bei einem Fehler gesammelt wird |
| `recovery` | Regeln für Neustart, Quarantäne und Prüfung |

Das Schema wird geprüft, nicht nur gelesen. Ein Blueprint mit Steam-Quelle, aber ohne
`source.steam`, wird abgelehnt. Ein fehlender `backup`-Block bedeutet Vollbackup; ein vorhandener
Block beschränkt das Backup auf die genannten Pfade.

### 5.2 Bewusste Grenzen

Blueprints enthalten **keine Shell- und keine Python-Hooks**. Das ist eine Entscheidung, kein
fehlendes Feature: Ein von Nutzern hochgeladener Blueprint darf keine beliebigen Befehle auf dem
Node ausführen. Alles, was ein Blueprint braucht, steht als Daten darin (argv, Env, Seed-Dateien,
Konfigurationspatches, Kopier- und Symlink-Operationen) und wird von Code ausgeführt, den der
Betreiber kontrolliert.

**Grenze:** Eine Arbeitslast, die ein eigenes Setup-Skript braucht, lässt sich deshalb nicht im
Blueprint ausdrücken. Das wird eine Aufgabe für das Container-Image.

### 5.3 Import und Prüfung

`routers/blueprints.py` listet, zeigt, importiert, ersetzt und löscht Blueprints. Ein Import
prüft das JSON gegen das Schema, bevor es auswählbar wird. Das Panel enthält einen Builder
(`frontend/src/features/blueprints/BlueprintBuilder.tsx`) mit Vertragstest.

### 5.4 In Arbeit

Das Blueprint-System ist der Kern des Produkts und wird weiter ausgebaut. Kapitel 22 nennt die
offenen Arbeiten, statt Vollständigkeit zu behaupten.

## 6. Modmanager

Der Modmanager installiert drei Arten von Inhalt: Steam-Workshop-Einträge, CurseForge-Mods und
CurseForge-Modpacks. Er hält genug Zustand, um sie zu aktualisieren, zu deaktivieren und zu
sortieren, ohne Dateien von Hand anzufassen.

### 6.1 Was der Nutzer kann

| Aktion | Route |
|---|---|
| Mods eines Servers auflisten | `GET /mods/{server_id}` |
| Mod-Eintrag anlegen | `POST /mods/{server_id}` |
| Auf Updates prüfen | `POST /mods/{server_id}/check-updates` |
| Einen Mod installieren oder neu installieren | `POST /mods/{server_id}/{mod_id}/install` |
| Alle neu installieren | `POST /mods/{server_id}/reinstall-all` |
| Laufende Installationen abbrechen | `POST /mods/{server_id}/abort-installs` |
| Aktivieren, deaktivieren, bearbeiten | `PATCH /mods/{server_id}/{mod_id}` |
| Entfernen | `DELETE /mods/{server_id}/{mod_id}` |
| Ladereihenfolge ändern | `POST /mods/{server_id}/reorder` |

### 6.2 Steam Workshop

Bei Blueprints mit `source.type=steam` und Workshop-Unterstützung lädt der Node den Eintrag mit
SteamCMD. Der Blueprint entscheidet, wie die Dateien ins Spiel kommen: ein zusätzliches
Startargument, eine Kopie oder ein Symlink in ein Zielverzeichnis, oder ein Eintrag in einer
Modlistendatei oder einem INI-Schlüssel. Der Inhalt der Modliste kann die Workshop-IDs oder die
installierten Verzeichnisnamen tragen (`BlueprintModListContent`).

Ein **Steam-Web-API-Schlüssel** (Einstellungen, Kapitel 12) dient der Update-Abfrage. Ein
**Steam-Konto** kann als Zugangsdatum gespeichert werden für Titel, die einen angemeldeten
SteamCMD-Download brauchen, etwa DayZ. Zugangsdaten liegen zentral und werden über einen Alias
referenziert; der Server bekommt nie eine Klartextkopie des Geheimnisses.

### 6.3 CurseForge

`routers/curseforge.py` und der CurseForge-Dienst suchen und auflösen Mods und Modpacks mit einem
Betreiber-API-Schlüssel. Der Blueprint trägt Spiel-ID und Klassen-ID; MSM verdrahtet keine
einzelnen Spiele fest. Das ist wichtig, damit ein neues Spiel ohne Codeänderung funktioniert.

### 6.4 Zustand und Updates

`backend/models/mod.py` speichert Abhängigkeiten, Ladereihenfolge, Auto-Update, Installationsstatus,
Fortschritt, Restzeit, Fehlertext und Update-Status. Die Installation läuft als Hintergrundtask mit
einer Sperre je Server, damit zwei Installationen nicht dasselbe Verzeichnis beschreiben. Eine
regelmäßige Updateprüfung läuft alle sechs Stunden im Scheduler; eine manuelle Prüfung ist immer
möglich.

**Grenze:** Es gibt keine Modrinth-Integration im Code. Ältere Prosa nennt sie; Kapitel 22 führt
das als Dokumentationsfehler, nicht als Feature.

## 7. Dateimanager und Datenbank-Studios

### 7.1 Dateimanager

`routers/files.py` liefert Baum, Lesen, Schreiben, Verzeichnisse, Umbenennen, Verschieben, Löschen,
Entpacken und Suche. Große Uploads laufen über einen Chunk-Weg: initialisieren, Chunks hochladen,
abschließen. Textdateien behalten eine Versionshistorie, damit ein versehentliches Überschreiben
nachvollziehbar und wiederherstellbar ist.

Der Editor (`FileEditorWorkspace.tsx`) speichert automatisch, öffnet mehrere Dateien gleichzeitig
und zeigt einen Konfliktdialog, wenn sich die Datei auf der Platte geändert hat. Der Arbeitsbereich
behandelt seine Tastenkürzel am Wurzelelement, damit Strg+S auch bei Fokus auf einem
Symbolleistenknopf wirkt, nicht nur im Textfeld (`FileEditorWorkspace.a11y.test.tsx`).

**Grenze:** Dateizugriff bleibt im Datenverzeichnis des Servers. Pfad-Traversal wird abgewiesen.

### 7.2 PostgreSQL-Studio

Das Studio ist eine Eigenentwicklung, kein Aufsatz auf pgAdmin. `routers/postgres_studio.py`
bietet 27 Routen: Katalog, Datenraster, Struktur, SQL, Explain, Vorschau und Ausführung, Dump,
Restore, Monitoring und Sicherheit. Die DDL-Engine liegt in `backend/services/postgres_ddl.py`.

Zwei Eigenschaften machen es für echte Arbeit brauchbar:

1. **Vorschau ist Ausführung.** Dieselbe `compile_operation` baut den Plan für die Vorschau und
   den echten Lauf. Die Vorschau kann deshalb nichts versprechen, was die Ausführung nicht tut.
2. **Identität zählt.** Operationen laufen als Datenbankeigentümer oder als Admin-Identität
   (`identity: "owner" | "admin"`); Sitzungen und Sperren verlangen `server.databases.admin`. Das
   Studio verbindet sich nie als Superuser.

`BLOCKED_PARAMETERS` und `BLOCKED_PARAMETER_PREFIXES` weisen Einstellungen ab, die die Instanz
eskalieren oder brechen würden. Freie SQL-Ausdrücke baut eine einzige Funktion, die sie als eine
Anweisung hält; die Engine hängt keinen Nutzertext an ein Skript.

### 7.3 SQLite-Studio

`routers/sqlite_studio.py` bietet denselben Ablauf für SQLite-Dateien in einem Server: Inspizieren,
Übersicht, Tabellen, Zeilen, Zeile einfügen/ändern/löschen, beliebiges SQL und Finden der
Datenbankdateien. Es ist eine eigene Umsetzung, weil SQLite andere Typen, Sperren und DDL hat;
das Bedienmodell entspricht dem PostgreSQL-Studio: durchsuchen, bearbeiten, abfragen.

**Grenze:** Das SQLite-Studio bearbeitet die Datei im Verzeichnis des Servers. Es bindet sie nicht
in den Panel-Prozess ein.

## 8. Backups

### 8.1 Inhalt eines Backups

Ein Backup folgt den `backup.includePaths` des Blueprints (relative Globs) und den Ausschlüssen.
Hat der Blueprint keinen Backup-Block, wird das gesamte Serververzeichnis erfasst. Archive sind
`tar.gz` mit einem Manifest, das den Inhalt festhält.

### 8.2 Lokal und entfernt

`backup_orchestrator.py` macht das lokale Archiv zum primären Artefakt. Es gibt zwei Modi:

- **Ohne Backup-Passwort:** Die lokale Datei bleibt `tar.gz`.
- **Mit Backup-Passwort:** Das Tar entsteht in einem privaten temporären Verzeichnis, wird über
  DIS zu `.enc` verschlüsselt, und die Klartextdatei wird entfernt (`backup_service.py:101-201`).
  Der Datensatz zeigt danach auf die `.enc`-Datei.

Ein S3-Upload ist nur möglich, wenn ein Backup-Passwort gesetzt ist
(`backup_orchestrator.py:74-87`). Das Panel streamt die lokale Datei durch den DIS-Sidecar
(`backup_crypto_service.py`) und lädt das Chiffrat hoch. Danach prüft es das Objekt mit
`head_object` und schreibt erst dann `s3_key`, `s3_bucket` und `encrypted=true` in den Datensatz
(`backup_orchestrator.py:12-25`). Ein Datensatz behauptet keine entfernte Kopie, die nicht
nachgesehen wurde.

Bei einem Server auf einem entfernten Node verschlüsselt und lädt der Agent selbst; das Panel
orchestriert nur und hält die S3-Zugangsdaten nicht länger als für den Aufruf.

### 8.3 Aufbewahrung, Planung und Restore

Backups entstehen manuell oder nach Plan (Intervall oder feste Zeit). Die Aufbewahrung ist eine
Zahl je Server (`Server.backup_retention_count`, Standard 5). Ein Restore stoppt den Container,
falls er läuft, schreibt die Daten und protokolliert den Vorgang
(`backup_restore_service.py`). Die Recovery-App (Kapitel 19) entschlüsselt ein `.enc`-Backup
offline, wenn das Panel nicht mehr da ist.

**Grenze:** Ein lokales `tar.gz` ohne Passwort ist nicht verschlüsselt. Das ist der dokumentierte
Standard, und die README wurde entsprechend korrigiert.

## 9. Mehrere Nodes

### 9.1 Der Agent

`msm-agent/` ist ein eigenes Python-Paket mit eigenen Routern, Diensten und Tests (30
Testdateien). Er erledigt Docker-Arbeit auf seinem Node und meldet Zustand an das Panel. Das
Panel öffnet nie direkt einen Docker-Socket auf einem entfernten Host.

### 9.2 Aufnahme eines Nodes

Ein Node kommt in drei Schritten dazu: Installationsbefehl im Panel erzeugen, auf dem Ziel
ausführen, Node freigeben. Das Token lebt 15 Minuten (`ENROLLMENT_TTL_MINUTES`), ist
ratenbegrenzt und liegt nur auf dem Ziel. Die Verbindung nutzt gegenseitiges TLS; der Agent pinnt
das Panel-Zertifikat (`node_enrollment_service.py`, `tls_pinning.py`). Ein Owner oder ein Nutzer
mit Node-Recht muss freigeben; ein Token allein reicht nicht.

**Warum die Freigabe getrennt ist:** Ein gestohlener Installationsbefehl soll keinen Node an ein
Panel hängen können. Die menschliche Freigabe ist der zweite Faktor.

### 9.3 Kapazität und Platzierung

Jeder Node meldet Kapazität: CPU, Speicher, Platte und Schnittstellen (`routers/nodes.py`). Beim
Anlegen zeigt das Panel die Restkapazität und verweigert eine Platzierung, die sie überschreitet.
Ein Server lässt sich auf einen anderen Node verschieben (`server_node_migration_service.py`); der
Umzug stoppt den Server, überträgt die Daten und startet ihn auf dem Ziel.

### 9.4 Firewall

`firewall_service.py` öffnet und schließt die Ports, die ein Server erklärt, über enge UFW-Pfade.
Ports vergibt MSM, damit zwei Server auf einem Node nicht denselben Port belegen.

**Grenze:** Die Firewallverwaltung ist der Grund, warum die systemd-Unit bestimmte UFW-Pfade
beschreibbar hält und `NoNewPrivileges` nicht setzt. Kapitel 2 hält diesen Kompromiss fest.

## 10. Rechte und Organisation

### 10.1 Rechte-Modell

`backend/services/permission_catalog.py` enthält 91 Rechte-Schlüssel, gruppiert nach Bereichen
(Server, Dateien, Backups, Datenbanken, Nodes, Teams, KI, Messenger, Tresor und weitere). Ein
Recht ist global oder servergebunden. Die Prüfreihenfolge in `permission_service.py` lautet:

1. der Owner umgeht die Prüfung,
2. die globale Rolle des Nutzers,
3. eine Freigabe je Server,
4. Teammitgliedschaft,
5. in einem Team deckelt das eigene Recht des Gründers, was eine Teamrolle vergeben kann.

Der letzte Punkt verhindert, dass eine Teamrolle mehr verteilt, als der Gründer hält. Die
Admin-Rolle wird beim Start gegen den Katalog abgeglichen, damit ein neuer Schlüssel nicht still
beim Admin fehlt.

### 10.2 Rollen

Rollen funktionieren wie bei Discord: Eine Rolle hat Namen, Rechtematrix und Mitglieder.
`routers/roles.py` und der Rolleneditor schreiben die Matrix. Eine Rolle ist global oder
teamgebunden. Server-Freigaben weisen eine Rolle auf einem Server zu; so kann ein Nutzer einen
Gameserver verwalten, ohne den Rest zu sehen.

**Grenze:** Rechte werden an Routen erzwungen, nicht durch Ausblenden von Knöpfen. Die Oberfläche
versteckt, was der Nutzer nicht darf, aber die Route ist die Instanz.

### 10.3 Teams

Ein Team hat Mitglieder, Einladungen, eigene Rollen, Server-Freigaben, geteiltes KI-Wissen und
einen Team-Tresor. `routers/teams.py` deckt Mitgliedschaft und Freigaben ab. Der Team-Tresor ist
eine eigene Schlüsselhierarchie: ein Datenschlüssel je Team, für jedes Mitglied verpackt, mit
einem Rotationsablauf (vorbereiten, bestätigen, abbrechen, zurückrollen). Ein Mitglied entfernen
ist deshalb nicht nur ein Datenbankfeld; es beendet den Zugriff auf den verpackten Schlüssel.

### 10.4 Benutzerverwaltung aus dem Messenger

Der Messenger ist ein Modul des Panels, kein eigenes Produkt. Ein Nutzer mit passender Rolle kann
deshalb von dort Benutzer und Rollen verwalten. Es gelten dieselben Routen und Rechte. Es gibt
keinen zweiten, schwächeren Admin-Weg im Messenger.

### 10.5 Audit-Log

`models/audit_log.py` und `services/audit_service.py` protokollieren verwaltungs- und
sicherheitsrelevante Aktionen mit Akteur, Aktion, Ziel, Ergebnis und Details. `routers/admin.py`
bietet Liste, Zusammenfassung und Export. Die KI hat Lesewerkzeuge für das Audit-Log
(`backend/services/ai_tools/audit_tools.py`), damit ein Betreiber im Chat fragen kann, was sich
geändert hat. Die Werkzeuge prüfen weiterhin das Recht des Aufrufers; die KI erhält keinen
breiteren Blick als der Nutzer.

### 10.6 Hoster- und Shop-API

`routers/hoster_admin.py` und `routers/hoster_api.py` bilden eine Sollzustands-API für
Hosting-Anbieter: Server anlegen, sperren, fortsetzen und beenden, idempotent, dazu signierte
Single-Sign-on-Übergaben für Kunden. Webhooks melden Zustandsänderungen an den Shop zurück. Das
Teilsystem ist optional und schläft ohne Konfiguration. Der Betreiber beschreibt es als frühe
Entwicklungsphase; Kapitel 22 wiederholt das.

## 11. Konten und Sicherheit

### 11.1 Registrierung und Anmeldung

Die Registrierung kann ein Captcha verlangen (Kapitel 12) und die E-Mail bestätigen. Die
Anmeldung kennt einen zweiten Schritt: Das Panel stellt eine Login-Challenge aus, und der Client
muss TOTP, einen Passkey oder einen Backup-Code vorlegen. Der zweite Faktor wird serverseitig
gegen gespeichertes Material geprüft, nie gegen ein Boolesches Feld in der Anfrage.
Sitzungscookies sind `HttpOnly`; zustandsändernde Anfragen verlangen ein CSRF-Token.

### 11.2 Zwei-Faktor-Authentifizierung

Drei Wege bestehen nebeneinander:

- **TOTP** gegen ein verschlüsseltes Geheimnis. Ein Code gilt einmal je Zeitschritt.
- **Passkeys (WebAuthn)** gegen einen gespeicherten öffentlichen Schlüssel, mit einer
  Einmal-Challenge je Zweck.
- **Backup-Codes**, jeder einmal verwendbar, gehasht gespeichert.

Ein Faktor verdrängt keinen anderen: Passkey und Authenticator-App können gleichzeitig aktiv
sein. 2FA abschalten entfernt Geheimnis, Passkeys und Backup-Codes zusammen.

### 11.3 Gerätekopplung und Sitzungen

`/auth/devices/*` koppelt einen nativen Client (MSS, Pontis) mit dem Konto. Die Kopplung erzeugt
eine Tokenfamilie mit Refresh-Rotation. Ein wiederverwendeter Refresh-Token nach dem Gnadenfenster
sperrt die ganze Familie; das ist die übliche Abwehr eines gestohlenen Tokens. Die
Refresh-Antwort lässt sich aus Datenbank und Servergeheimnis rekonstruieren, damit ein
Panel-Neustart einen Client nicht bricht, der eine Anfrage wiederholt.

### 11.4 Ratenbegrenzung und lokale Verbindungen

Zwei Grenzen sind im Sicherheitsreiter einstellbar: `rate_limit_auth` und `rate_limit_global`
(`frontend/src/pages/settings/SecurityTab.tsx`). Durchgesetzt werden sie in der
Backend-Middleware, nicht in der Oberfläche.

`allow_localhost_connections` erlaubt einem lokal installierten Client die Verbindung. Das
Einschalten verlangt einen frischen Nachweis (Passkey oder TOTP), weil es die Herkunftsfläche
vergrößert. Es ist kein Schalter, den ein gestohlenes Zugangstoken umlegen kann.

### 11.5 Kontolebenszyklus

Nutzer können Passwort und E-Mail ändern, ihre Daten exportieren und das Konto löschen. Das
Ändern der E-Mail oder das Setzen eines Passworts für ein Social-Login-Konto verlangt einen
frischen Nachweis; der Link geht an die bestätigte Adresse. Die Löschung läuft über einen
Vorbereitungsschritt, der Tresordaten, Dateien und Zugangsdaten entfernt, bevor die Zeile fällt.
So bleibt nichts verwaist.

**Grenze:** Die Löschung ist endgültig. Die Oberfläche nennt vorher, was entfernt wird.

## 12. Einstellungen: alle 17 Reiter

`frontend/src/pages/Settings.tsx` definiert 17 Reiter. Zwei sind rechtgebunden: Hoster
(Leserecht) und Backup (Schreibrecht für Einstellungen).

| # | Reiter | Steuert |
|---|---|---|
| 1 | Allgemein | Sprache, saisonale Effekte mit Zeitfenstern, Modulschalter |
| 2 | Impressum | Betreiberangaben und ein Link zum eigenen Impressum |
| 3 | Sicherheit | API-Ratenbegrenzung, lokale Verbindungen (mit frischem Nachweis) |
| 4 | Captcha | Anbieter für das Registrierungs-Captcha |
| 5 | Cloudflare | API-Token und Standardzone |
| 6 | OAuth | Anbieter für Social Login |
| 7 | Steam | Steam-Web-API-Schlüssel und Steam-Konto |
| 8 | CurseForge | API-Schlüssel für den Modmanager |
| 9 | Hoster | Zugangsdaten und Verhalten der Hoster-API (Leserecht) |
| 10 | E-Mail | SMTP oder Resend |
| 11 | Messenger | lokaler LiveKit-Sidecar oder externer Server |
| 12 | Suchmaschine | Maunting Search: SearXNG-Endpunkt und optionaler Brave-Search-API-Schlüssel |
| 13 | KI | Anbieter, Kostenrollen, Grenzen, Werkzeugverfügbarkeit |
| 14 | Tresorspeicher | Speicherkontingent je Rolle |
| 15 | Backup | S3-Endpunkt, Bucket, Passwort |
| 16 | Support-Widget | Singra-Bot, Crisp, Tawk oder eigener Anbieter |
| 17 | Popup | panelweite Ankündigungen |

### 12.1 Allgemein

Der Reiter Allgemein trägt die Modulschalter. Belegte Schalter in `GeneralTab.tsx` sind Kalender,
Notizen, Dokumente, Soziales (Messenger), Tresor, Cloudflare, Desktop-App-Download,
Browser-Download und Story-/Fabel-Download. Die Router erzwingen den Schalter: `calendar.py:87-89`,
`notes.py:27-29` und `docs.py:56-57` lesen die Einstellung und weisen Anfragen ab, wenn sie aus
ist. Ein abgeschaltetes Modul ist also nicht nur in der Navigation versteckt.

Saisonale Effekte haben einen eigenen Schalter und drei Zeitfenster: Geburtstag, Halloween und
Weihnachten, jeweils mit Start- und Enddatum (`GeneralTab.tsx:21-51`). Das ist Kosmetik und
ändert kein Verhalten.

### 12.2 Captcha

`backend/services/captcha_service.py` kennt vier Anbieter: `altcha` (Standard, lokale
Arbeitsnachweis-Prüfung über den DIS-Sidecar), `turnstile` (Cloudflare), `hcaptcha` und
`recaptcha`. Der lokale Anbieter braucht keinen externen Dienst und keinen API-Schlüssel. Die drei
Cloud-Anbieter prüfen gegen ihre offiziellen Endpunkte (`captcha_service.py:43-45`).

**Grenze:** ALTCHA ist Proof of Work, keine Bilderkennung. Es erhöht die Kosten automatisierter
Registrierung, stoppt aber keinen entschlossenen Angreifer.

### 12.3 Cloudflare

Der Cloudflare-Reiter speichert API-Token und Standardzone (`CloudflareTab.tsx`). Die KI hat
Netzwerkvorschläge für DNS: Einträge anlegen und löschen laufen über eine Vorschlagskarte und
werden von `services/cloudflare_service.py` ausgeführt
(`ai_proposals/network_proposals.py`). Das Token erreicht den Browser nie; das Panel nutzt es
serverseitig.

### 12.4 Social Login, Steam und CurseForge

OAuth-Presets existieren für Google, Discord und GitHub (`backend/services/oauth_presets.py`); der
OAuth-Reiter speichert Client-ID, Geheimnis und Callback. Steam und CurseForge sind
Betreiber-Zugangsdaten für den Modmanager, wie in Kapitel 6 beschrieben. Keines dieser Geheimnisse
wird nach dem Speichern an den Client zurückgegeben.

### 12.5 E-Mail

`backend/services/email_service.py` unterstützt SMTP und Resend. Resend wird genutzt, wenn
`resend_api_key` gesetzt ist; sonst gelten die SMTP-Einstellungen. Der Reiter hat eine Testaktion,
damit ein Betreiber die Zustellung prüfen kann, bevor er sich auf Passwort-Resets verlässt.

### 12.6 Medienserver des Messengers

Der Messenger nutzt den mitgelieferten LiveKit-Sidecar oder einen externen
LiveKit-kompatiblen Server. `MessengerTab.tsx` schaltet zwischen `lokal` und `extern`; der externe
Modus speichert URL, API-Schlüssel und Geheimnis und bietet einen Verbindungstest. Die
Signalisierung proxy't Caddy; die Medienports stehen in Kapitel 2.

### 12.7 Suche

Maunting Search wird an einer Stelle konfiguriert (`SearchEngineTab.tsx`):

- **SearXNG:** standardmäßig der mitgelieferte Sidecar unter `http://127.0.0.1:8888`, oder die
  URL einer eigenen Instanz. Ein Schalter steuert, ob externe API-Schlüssel bei einer eigenen
  Instanz genutzt werden dürfen, damit eine fremde Instanz nicht still das API-Guthaben des
  Betreibers verbraucht.
- **Brave Search API:** optionaler Schlüssel für Web-, Bild-, Video- und Nachrichtentreffer.

Dieselbe Konfiguration speist Maunting Search in Pontis und die KI-Websuche.

### 12.8 KI-Einstellungen

Der KI-Reiter konfiguriert Anbieter, Modelle, Kostenrollen und Grenzen. Die Mechanik steht in
Kapitel 13. Es ist kein Textfeld für einen Prompt: Prompts baut das Backend, der Reiter steuert
Verfügbarkeit und Budgets.

### 12.9 Tresorspeicher, Backup, Support-Widget, Popup

- **Tresorspeicher:** ein Kontingent in Bytes je Rolle (`RoleVaultQuota`). Das Kontingent eines
  Nutzers ist der höchste Wert seiner Rollen (`vault_blob_service.quote_fuer`). Ein Nutzer ohne
  Rolle mit Kontingent erhält 0 und kann nicht hochladen; vorhandene Dateien bleiben lesbar und
  löschbar. Der Owner ist unbegrenzt.
- **Backup:** S3-Endpunkt, Bucket und Backup-Passwort. Ein entfernter Upload verlangt das Passwort
  (Kapitel 8).
- **Support-Widget:** vier Modi: der eigene Singra-Support-Bot (in der Oberfläche „Singra
  (Discord-Bot)"), Crisp, Tawk oder ein eigener Anbieter mit eigenem Embed
  (`SupportWidgetTab.tsx`). Der Singra-Modus nutzt eine Install-ID, die aus dem Panel oder aus der
  Umgebung kommen kann.
- **Popup:** ein panelweites Ankündigungssystem, verwaltet mit dem Popup-Recht.

## 13. KI: Singra

Singra ist ein Agent im Panel. Das Modell spricht, aber jede Aktion läuft durch Backend-Code, der
das Recht des Aufrufers prüft. Der Prompt ist keine Sicherheitsgrenze.

### 13.1 Anbieter

`backend/services/ai_provider_registry/` enthält sechs Anbieter-Adapter: `openai`,
`azure_openai`, `azure_anthropic`, `google`, `openrouter` und `elevenlabs` (Sprache). Ein Eintrag
hält Endpunkt, Schlüssel, Modelle und die Rollen, die er bedienen darf. Schlüssel liegen
verschlüsselt und werden nie an den Client geschickt.

Modellpreise kommen aus `ai_model_price_service.py`; Verbrauch wird je Lauf gebucht
(`ai_usage_service.py`, `ai_kosten.py`). Der KI-Reiter zeigt die konfigurierten Anbieter und ihre
Rollen.

### 13.2 Kostenrollen und Grenzen

Fünf Rollen können auf verschiedene Modelle zeigen: Standard-Chat, Hintergrund-Worker,
Ethikprüfung, Gedächtnispflege und Suchzusammenfassung (`ai_provider_service.py:159-207`). Ein
Anbieter ist für eine Rolle geeignet, wenn die Rolle aktiv ist und ein Modell gesetzt ist.

Die Grenzen liegen je Rolle (`models/role_ai_limit.py`): Tages-, Wochen- und Monatsgrenze für
Token, dazu Monatsminuten für Realtime-Sprache und Diktat. Ein Lauf endet an der Grenze, statt
still mehr auszugeben.

### 13.3 Werkzeugkatalog

Es gibt 125 Werkzeuge. Die Zahl ist in `backend/tests/test_ai_tool_drift.py` festgeschrieben,
damit Katalog und Registry nicht auseinanderlaufen. Ein Werkzeug erklärt seine Art in
`services/ai_tool_spec.py`:

| Art | Verhalten |
|---|---|
| `server_read` | liest auf einem Server, je Aufruf aufgelöst und rechtgeprüft |
| `global_read` | liest ohne Serverbezug |
| `docs_write` | bearbeitet ein Dokument ohne Vorschlagskarte |
| `server_write` | erzeugt einen Bestätigungsvorschlag für einen Server |
| `global_write` | erzeugt einen Vorschlag ohne Server, etwa Serveranlage |
| `ask` | beendet den Zug und fragt den Menschen |
| `delegation` | läuft sofort im Handler |
| `voice_control` | ändert nur den Zustand der aktuellen Sprachsitzung |

Werkzeugdomänen im Baum (Modulnamen in `backend/services/ai_tools/`): Audit, Cloudflare,
CurseForge, Datenbank, Dokumente, Geo, Hoster, Panelübersicht, Persönliches (Kalender, Notizen,
Post), Projekte, Serverhistorie, Servernetz, Serverdateien, Servermods, Serverbetrieb,
Serverschreiben, System, Aufgaben und Benutzer.

Zwei Beispiele für enge Werkzeuge: `web_search` steht nur im Katalog, wenn ein Suchschlüssel
konfiguriert ist (`ai_action_service._global_tool_definitions`), und die Regionsanalyse fällt auf
ein schlüsselfreies Kartenbild zurück, wenn kein Copernicus-Zugang existiert, statt
Satellitendaten vorzutäuschen.

### 13.4 Vorschläge und Bestätigung

Eine Schreibaktion wird ein `AiActionProposal`: Ziel, Operation, Werte vorher und nachher und eine
lesbare Vorschau. Bestätigen führt denselben Dienst aus wie die Oberfläche. Ablehnen lässt das
System unberührt. Vorschläge liegen je Domäne in `ai_proposals/` (Server, Netz, Rollen, Benutzer,
Dokumente, Datenbank).

**Warum das existiert:** Ein Sprachmodell kann eine syntaktisch gültige, aber falsche Änderung
erzeugen. Die Karte ist die Stelle, an der ein Mensch Ziel und Unterschied sieht.

### 13.5 Autonomie

Autonome Ausführung verlangt vier Bedingungen zugleich
(`backend/services/ai_autonomy_service.py`):

1. Der Nutzer hat das Recht für das konkrete Werkzeug.
2. Der Nutzer hat Autonomie ausdrücklich erteilt (je Werkzeug, optional je Server).
3. Das Werkzeug ist für Autonomie zugelassen (`immer_bestaetigen` schließt sensible aus).
4. Das Stundenbudget hat noch Platz (`max_actions_per_hour`).

Fehlt eine Bedingung, wird die Aktion wieder ein Vorschlag. Eine Freigabe auf einem normalen
Server deckt einen sensiblen nicht automatisch ab (`hat_engere_server_freigabe`).

### 13.6 Gedächtnis

Gedächtnis v2 speichert Fakten mit lokalen Embeddings, einem Blind-HMAC-Index für die Suche und
Verschlüsselung im Ruhezustand (`ai_memory_service.py`, `ai_memory_vektor.py`,
`ai_memory_krypto.py`). Ein nächtlicher Lauf verdichtet und entdoppelt
(`ai_gedaechtnis_pflege.py`, `ai_compaction_service.py`). Die Suche nach Namen nutzt den
Blind-Index, nie eine Klartextspalte.

**Grenze:** Das Gedächtnis gehört einem Nutzer- oder Teambereich; ein Serverwissen gelangt nicht
in den Chat eines anderen Nutzers. Die KI liest nur, was der Aufrufer in der Oberfläche lesen
könnte.

### 13.7 Websuche

Die Suche geht über SearXNG (`ai_web_search_service.py`) und optional Brave Search. Eine
Folgefrage wird mit Blick auf den Verlauf in höchstens drei Anfragen umgeschrieben, danach laufen
höchstens zwei Nachsuchen, danach werden höchstens zwei Seiten für Details geöffnet
(`ai_search_summary_service.py`). Treffer tragen nummerierte Belege; eine Antwort ohne Quelle wird
als solche gekennzeichnet.

### 13.8 Sprache

Zwei Wege bestehen:

- **Klassisch:** Sprachaktivitätserkennung, Sprache zu Text, derselbe `AiRun` wie Text, dann Text
  zu Sprache (lokal oder ElevenLabs).
- **Realtime:** direktes OpenAI Realtime über WebRTC zwischen Client und Endpunkt. API-Schlüssel
  bleiben auf dem Server; der Client erhält sie nie.

Werkzeugaufrufe im Sprachmodus laufen durch dieselbe Registry und dieselben Rechte
(`ai_voice_bridge.py`). Die Brücke muss Werkzeugnutzlasten wie Geo-Ergebnisse im JSON an das
Frontend mitliefern; sonst hat die Sprachoberfläche nichts zu zeigen.

### 13.9 MCP, Skills und Worker

- **MCP:** `routers/ai_mcp.py` verwaltet Model-Context-Protocol-Server global, je Team und je
  Nutzer. Werkzeugbereiche werden je Aufruf geprüft.
- **Skills:** neun Markdown-Skilldateien in `backend/ai_skills/` werden als wiederverwendbare
  Anweisungen geladen; `ai_skill_service.py` entscheidet, welche gelten.
- **Worker:** Hintergrundagenten laufen eine begrenzte Schleife. `ai_worker_limits.py` setzt
  `MAX_RUNDEN = 48`; ein Worker kann nicht endlos laufen. Aufgaben haben persistenten Zustand
  (`routers/ai_tasks.py`).

### 13.10 Projekte und Coding-Sandbox

`routers/ai_projects.py` (33 Routen) gibt der KI einen Projektarbeitsbereich mit Dateien,
Befehlen, Git und Vorschau. Die Sandbox ist keine Shell: Befehle werden gegen eine Allowlist von
Entwicklerwerkzeugen geprüft, Pfade bleiben im Projektverzeichnis verankert
(`ai_project_service.py`), und Git-Zugangsdaten löst das System je Nutzer über `GIT_ASKPASS` auf,
statt sie in eine URL zu schreiben.

**Grenze:** Die Allowlist weist Rechteausweitung, Systemsteuerung, zerstörende Plattenoperationen,
Reverse Shells und Zugriffe auf Systempfade ab. Ein Projekt, das mehr braucht, wird nicht still
ausgeführt.

### 13.11 Computer-Use

Computer-Use läuft auf dem Desktop über MSS-Aufträge (`routers/desktop.py`,
`desktop_job_service.py`). Es ist standardmäßig aus. Maus- und Tastaturübernahme verlangen eine
ausdrückliche lokale Freigabe in MSS mit zehn Minuten Frist; Bildschirmfotos zeigen einen
sichtbaren Hinweis. Das Panel kann sich Desktop-Kontrolle nicht selbst geben.

### 13.12 Geo und Satellitenbilder

`ai_geo_service.py`, `ai_satellite_service.py`, `ai_geo_image_service.py` und
`ai_maptiler_service.py` liefern Geocoding, Wetter, ein 3D-Globus-Ziel und regionale Bilder. Mit
Copernicus-Zugang wird die neueste Sentinel-2-Szene genutzt, ohne ihn ein schlüsselfreies
ArcGIS-Mosaik. Die Oberfläche zeigt eine MapTiler-Karte und einen 3D-Globus; Kamerabefehle
blockieren keine Nutzerinteraktion.

### 13.13 Ethik und Maskierung

Eine Ethikprüfung (`ai_ethics_service.py`, `ai_ethics_trigger.py`) kann aus, automatisch, immer
oder nur bei kritischen Aktionen laufen. `ai_redaction.py` entfernt Geheimnisse aus
Werkzeugausgaben, bevor das Modell sie sieht. Der Kontextdeckel gilt je Rolle: Der Standard für
eine Anfrage liegt bei 44.000 Token, eine Rolle kann ihn bis zur Modellgrenze anheben
(`ai_context_window.py`, `ai_limit_service.py`).

## 14. Messenger

### 14.1 Was der Nutzer kann

Direktchats, Gruppen, Stories („Aktuelles"), eine Community-Ansicht, Filter nach
Alle/Gruppen/Freunde/Teams/Öffentlich, Suche, Einladungslinks, Archiv, Stummschalten, Blockieren,
Entwürfe, Tippanzeigen, Präsenz, Zustell- und Lesebestätigungen, Reaktionen, Antworten,
Weiterleiten, Kopieren, Auswahl, Bearbeiten, Löschen, Anheften (mit `can_pin_messages`),
verschwindende Nachrichten mit serverseitiger Frist, Anhänge (Kamera, Galerie, Datei, Notiz,
Kalendertermin), Sprachnotizen, runde Videonotizen, Sticker inklusive Mixer und
Foto-Sticker-Editor. Ein Umfrage-Feature gibt es im Code nicht.

Gruppenrollen kommen aus zwei Quellen: Teamrolle und Gruppenrolle; `services/gruppenRollen.ts`
leitet die wirksamen Rechte für das Gespräch ab. Gruppen haben Einladungslinks und verschlüsselte
Metadaten.

### 14.2 Verschlüsselte Formate

Das Backend akzeptiert für Nachrichteninhalt nur diese Umschläge: `sv-e2ee-dr-v1:`,
`sv-e2ee-group-v1:` und `sv-e2ee-hybrid-v1:` (`backend/schemas/social.py:167-169`). Ältere
Formate, die der Server ableiten könnte, werden beim Schreiben abgewiesen. Der Server speichert
Chiffrat, Routingmetadaten und Zeitstempel; den Klartext kann er nicht lesen.

### 14.3 Double Ratchet und Geräte

Jedes Gerät hat seine eigene Ratchet-Kette. Ein neues Gerät beginnt mit seiner eigenen Kette; ein
bestehendes Gerät kann Verlauf und Chatgeheimnis in signierten, versiegelten Paketen übergeben,
aber erst nach dem Vergleich der Sicherheitsnummer. Das Geräteverzeichnis
(`models/user_e2ee_device.py`) führt öffentliche Schlüssel und Freigabezustand.

Gruppeninhalt nutzt einen eigenen Gruppenschlüssel in verschlüsselten Blöcken mit
Schlüsselkennung, damit ein Gerät mehrere Generationen halten kann.

### 14.4 Zustellung

Der Transport trennt die geteilte Mailbox vom Gerätepostfach. Die Migrationen
`20261023_02_e2ee_zustellung.py` und `20261025_01_einheits_transport.py` definieren die
Zustelltabellen und die Folge für Gerätepostfach-Einträge. Ein Gerätepostfach-Eintrag hat seinen
eigenen ID-Raum; deshalb darf eine Quittung Umschlag-IDs und Postfach-IDs nicht mischen (die
Projektregeln halten den historischen Fehler fest).

Warteschlangen machen Offline-Arbeit dauerhaft: Wirkungen (Bearbeiten, Löschen, Reaktion, Anheften,
Verfall), Löschungen, Medienabrufe und Verlaufsübertragungen werden lokal gespeichert, mit
Rückzug wiederholt und nach einer endgültigen Ablehnung entfernt. Quittungen sind kumulative
Wasserstände, keine ID-Listen.

### 14.5 Anrufe

Anrufe nutzen LiveKit, entweder den mitgelieferten Sidecar oder einen externen Server
(Kapitel 12.6). `social_calls.py` hat 16 Routen für Räume, Teilnehmer und Admin-Aktionen.
Gruppenanrufe unterstützen Kamera, Bildschirmfreigabe mit Systemaudio, Qualität von 720p bis
2160p bei 30 oder 60 fps, Gerätewahl, Moderation und Übernahme zwischen Geräten.

### 14.6 Sperre, Benachrichtigungen und Verwaltung

Der Messenger hat eine PIN-Sperre mit automatischem Sperren bei Fokusverlust oder Reiterwechsel.
Push-Benachrichtigungen nutzen WebPush mit einer Anbieter-Allowlist (Google, Mozilla, Apple,
Microsoft) und kurzen Fristen, damit ein Tarpit die Worker nicht erschöpft. Glocke und
Benachrichtigungsdienst teilt er mit dem übrigen Panel.

Nutzer mit passender Rolle verwalten Benutzer und Rollen aus dem Messenger, wie in Kapitel 10.4
beschrieben; es gibt keine getrennte Admin-Oberfläche mit schwächeren Prüfungen.

## 15. Kalender und Notizen

### 15.1 Kalender

Der Kalender hält persönliche, Team-, Server- und Node-Termine. Der Nutzer filtert nach diesen
Bereichen. Termine wiederholen sich: `kalender_serie.py` breitet Serien mit Ausnahmen aus, und die
Ausbreitung ist begrenzt, damit eine lange Serie den Browser nicht einfriert. Jeder Termin lässt
sich exportieren; der Kalender liefert einen ICS-Feed und unterstützt CalDAV für externe Clients
(`routers/calendar.py`).

Termininhalt wird clientseitig verschlüsselt (`services/notesCalendarCrypto.ts`), wenn der
Eintrag persönlich ist. Geteilte Einträge folgen der Sichtbarkeitsregel: Ein Team- oder
Servertemin muss für die lesbar sein, die ihn sehen dürfen, und nutzt deshalb den geteilten Weg,
nicht den persönlichen Schlüssel.

Erinnerungen laufen im Panel und auf Android als geplante lokale Wecker. Der Wecker trägt einen
Titel, den das Telefon entschlüsseln kann; es gibt keinen Hintergrunddienst, der für Erinnerungen
ein Sitzungstoken hält.

**Grenze:** Einen nodeweiten Termin anlegen oder ändern verlangt `nodes.manage` oder
Owner-Status; sonst könnte ein normaler Nutzer in die Kalender aller Administratoren schreiben.

### 15.2 Notizen

Notizen unterstützen Kategorien, Farben, Anheften, Archiv, Team-Notizen, Suche und Vorschau. Der
Notizschlüssel gehört dem Konto, nicht dem Gerät: Geräte einigen sich über einen signierten
Eintrag auf dem Server (`/api/notes/kontoschluessel`), sodass eine Notiz von einem Gerät auf dem
anderen aufgeht.

Wird eine Notiz wieder persönlich, wird sie mit dem persönlichen Schlüssel neu verschlüsselt. Die
Oberfläche sagt, wenn eine Notiz geteilt ist und wer sie lesen kann; sie behauptet keine
Ende-zu-Ende-Verschlüsselung für eine Team-Notiz, die das Team lesen kann.

## 16. Dokumente

Das Dokumentenmodul ist ein gemeinsamer Editor auf Tiptap im Frontend und einem
Yjs/Hocuspocus-Sidecar (`docs-sidecar/`) für Echtzeit-Kollaboration. Es ist näher an einem kleinen
Google Docs als an einem Markdown-Kasten.

### 16.1 Was der Nutzer kann

- Ordnerbaum, Papierkorb, Duplizieren, Drag and Drop, Suche.
- Rich Text mit Überschriften, Listen, Tabellen, Code, Links, Bildern als Assets.
- Echtzeit-Kollaboration mit Präsenz und konfliktfreiem Zusammenführen.
- Kommentar-Threads mit „gelöst"-Zustand.
- Revisionen mit Wiederherstellung.
- Freigaben mit Rollen und Claim-Links.
- Outline, Slash-Menü und ein KI-Panel.
- Export nach HTML, Markdown, reinem Text und Druck.
- Offline-Bearbeitung mit IndexedDB und einer Warteschlange für ausstehende Änderungen.

### 16.2 Umsetzung

`routers/docs.py` und `routers/docs_internal.py` decken Ordner, Mitglieder, Kommentare,
Revisionen, Assets und ein Kollaborationstoken ab. Das Token ist ein kurzlebiges, vom Panel
signiertes JWT (`docs_collab_service.py`), sodass der Sidecar eine Verbindung nur für ein
Dokument annimmt, das der Nutzer öffnen darf. Dokumentzustand und Revisionen verschlüsselt das
Panel; der Sidecar sieht den Inhalt, an dem er zusammenarbeitet, deshalb läuft er auf demselben
Host und nur auf Loopback-Ports.

**Grenze:** Echtzeit-Kollaboration braucht den Sidecar. Ohne ihn funktioniert Bearbeitung lokal
und synchronisiert später, aber zwei Nutzer sehen den Cursor des anderen nicht.

## 17. Tresor

Der Tresor ist Zero-Knowledge: Das Master-Passwort leitet im Client einen Schlüssel ab, und der
Server speichert Chiffrat, das er nicht öffnen kann. Er dient als Passwortmanager und als private
Galerie und Dateiablage.

### 17.1 Speichermodell

- Der Bucket wird über einen HMAC der Kontonummer identifiziert, nicht über die Kontonummer
  (`konto_index`). Ein Datenbankdump ordnet Buckets deshalb keinen Personen zu.
- Dateien werden in 4 MiB große Klartext-Chunks geteilt (`CHUNK_KLARTEXT`), jeder mit 12-Byte-IV
  und 16-Byte-Tag; der Chiffrat-Chunk ist 28 Byte größer (`vault_blob_service.py:51-53`).
- Ein einzelner Blob kann bis 1 TiB groß werden (`MAX_BLOB_BYTES`), aber das Rollenkontingent ist
  die echte Grenze.
- Uploads prüfen die Größe gegen die Chunkzahl, bevor geschrieben wird, und halten 1 GiB
  Plattenreserve frei (`PLATTENRESERVE`).
- Das Kontingent ist der höchste Wert über die Rollen des Nutzers (`quote_fuer`); keine Rolle mit
  Kontingent bedeutet keine Uploads. Der Owner ist unbegrenzt.
- Löschen und Zurücksetzen hinterlassen Grabsteine. Ein zurückgesetzter Bucket antwortet mit 410
  und lässt sich von einem alten Gerät nicht zurückbeanspruchen; ein gelöschter Tresor kommt nicht
  wieder.

### 17.2 Funktionen

Passwörter, TOTP-Codes, Notizen, Dateien und Ordner, eine Galerie mit Miniaturen und Lichtbox,
Karten und IBANs, Import und Export, ein Passwortgenerator, eine Leck-Prüfung, ein
Sicherheitscheck, Papierkorb mit Resttagen, Archiv mit Rückgängig, Favoriten, Suche,
Mehrfachauswahl, ein Bildeditor und Offline-Sync. Entsperren geht mit Master-Passwort,
Windows Hello/Biometrie oder Passkey; ein QR-Ablauf autorisiert ein neues Gerät.

Der Team-Tresor ist eine eigene Schlüsselhierarchie: ein Datenschlüssel je Team, für jedes
Mitglied verpackt, mit einem Rotationsablauf. Ein Mitglied entfernen beendet den Zugriff auf den
verpackten Schlüssel.

### 17.3 Kamera-Sicherung und Autofill-Eingang

Auf Android kann MSS Kamerafotos in den Tresor sichern. Das Telefon verschlüsselt mit einem
Post-Quanten-Hybrid-Umschlag (ML-KEM-768 und RSA-4096-OAEP-SHA-256,
`smart-system/src-tauri/src/kamera_krypto.rs`) und schickt das Chiffrat über einen Eingang. Das
Panel sieht den Klartext nie. Ein Hintergrundjob lädt in Chunks hoch, und der Eintrag entsteht
erst, wenn alle Blobs vollständig sind.

Der Browser kann Zugangsdaten ausfüllen, während der Tresor gesperrt ist, über einen getrennten,
engen Eingang. Das ist nicht der Tresorschlüssel, sondern ein begrenzter Kanal, den der Nutzer
ausdrücklich freischaltet.

**Grenze:** Der Tresor ist nur so sicher wie das Master-Passwort. Ein vergessenes Passwort kann
der Betreiber nicht wiederherstellen; ein Zurücksetzen löscht die Daten, absichtlich.

## 18. Browser Pontis

Pontis ist ein Tauri-v2-Browser. Unter Windows nutzt er einen WebView2-Controller je Reiter, unter
Android die System-WebView über JNI. Beide Umsetzungen teilen Entscheidungen dort, wo eine
Abweichung ein Sicherheitsfehler wäre.

### 18.1 Reiter und Isolierung

Private Reiter, Sitzungswiederherstellung, ein Reiterraster mit Drag-to-Split, waagerechter und
senkrechter Split, eine senkrechte Reiterleiste und Arbeitsbereiche mit isolierten Profilen.
Schlafende Reiter geben Speicher frei und lassen sich wiederherstellen. Jeder Reiter ist ein
eigener Controller, kein Iframe im Panel.

### 18.2 Werbeblocker und Cookie-Hinweise

Die Filter-Engine ist adblock-rust. `schild/listen.rs` lädt EasyList, EasyList Germany, EasyPrivacy
und die EasyList Cookie List, alle vier Tage erneuert. Anfragen eines Reiters gehen zuerst durch
die Trackerliste, dann durch die Werbeliste.

Cookie-Hinweise lehnt autoconsent ab, statt sie zu verstecken. Der Unterschied zählt: Ein per CSS
versteckter Hinweis wäre für autoconsent unsichtbar und würde nicht abgelehnt. Die Cookie-Liste
trägt deshalb nur Netzwerkregeln bei; das Verdecken bis zur Ablehnung macht autoconsent selbst.

### 18.3 Jugendschutz

Fünf Kategorien (Erwachsene, Glücksspiel, Soziales, Spiele, Shopping) mit StevenBlack-Listen, bis
zu 500 eigene Sperren und Ausnahmen, SafeSearch und YouTube Restricted Mode. Eine Lockerung ist
ein Antrag: Sie wartet 24 Stunden bis 7 Tage, muss dann innerhalb einer Stunde bestätigt werden,
und ein abgebrochener oder verfallener Antrag sperrt einen neuen Antrag für einen Tag.
Verschärfen wirkt sofort. Die Zeit kommt aus einer Netzquelle; das Umstellen der Uhr verkürzt
keine Wartezeit.

### 18.4 Downloads

Downloads laufen durch Quarantäne, Windows-Defender-Prüfung und eine Herkunftsmarke, bevor sie ans
Ziel kommen. Der Verlauf hält 500 Einträge mit Suche, Filtern und Datumsgruppen. Grenzen je Reiter
und eine Plattenreserve verhindern, dass eine Seite die Platte füllt; ein gescheiterter Download
meldet, ob Speicher, Kontingent oder Dateityp die Ursache war.

### 18.5 Passwortmanager und Übersetzung

Der Browser füllt und erzeugt Zugangsdaten aus dem Tresor, einschließlich Zahlungskarten und IBANs.
Zahlungsdaten gehen nur über HTTPS, nur in sichtbare Felder und erst nach Windows Hello oder dem
Master-Passwort. Die Übersetzung läuft lokal mit Bergamot/WASM-Modellen
(`frontend/src/browser/uebersetzung/`); der Seitentext verlässt das Gerät nicht.

### 18.6 Das Übrige

Lesemodus, Seitensuche, Sprach- und Bildsuche, eine eigene Metasuche (`msm://suche`), Lesezeichen,
Verlauf, Bildschirmfotos (sichtbarer Bereich, Auswahl, ganze Seite), eine Startseite mit Widgets
(Wetter, Uhr, Termine, Notizen, zuletzt geöffnet, Nachrichten, Smartcard, Schild-Statistik),
Seiteneinstellungen mit Zurücksetzen, ein Berechtigungs-Popover, Standardbrowser-Registrierung,
Import aus Chrome, Firefox und Edge, Erweiterungen (Windows, CRX3-signaturgeprüft) und
Entwicklerwerkzeuge.

**Grenze:** Erweiterungen gibt es nur unter Windows. Ganzseiten-Screenshots sind nicht verfügbar,
solange die Gerätenachbildung aktiv ist, weil beide denselben Override nutzen.

## 19. Desktop-App MSS und Recovery

### 19.1 MSS

MSS zeigt dieselbe Panel-Oberfläche in einem Tauri-Fenster, mit eigener Integrationsschicht:

- **Kopplung statt Passwort:** Ein Kopplungscode verbindet die App mit dem Konto; das
  Refresh-Token liegt im Schlüsselspeicher des Betriebssystems.
- **Tray, Hotkeys und Wake-Word:** Tray-Zustandsfarben, zwei globale Tastenkürzel und ein
  Offline-Wake-Word auf Basis von rustpotter mit geklemmter Schwelle
  (`smart-system/src-tauri/src/konfig.rs`).
- **Overlay und Screenshot:** ein klickdurchlässiges Overlay und ein Screenshot-Werkzeug mit
  sichtbarem Hinweis.
- **Computer-Use:** Maus- und Tastaturübernahme erst nach lokaler Freigabe mit zehn Minuten Frist
  (`uebernahme.rs`, `durchklick.rs`).
- **Sandbox und Prüfung:** Dateiaufträge laufen in einer Sandbox mit Schreibzonen und
  Papierkorbregeln; Downloads werden mit `MpCmdRun` geprüft und in Quarantäne gelegt
  (`virenscan.rs`, `artefakt.rs`).
- **Lokale Anbindungen:** MCP über stdio (`mcp_stdio.rs`), Discord-RPC über eine lokale Named Pipe,
  Audio-Ducking über WASAPI, Geräteverwaltung für Mikrofon und Kamera.
- **Erinnerungen und Android:** lokale Terminwecker; unter Android ein Dienst in eigenem Prozess
  und bis zu 100 geplante Erinnerungen.
- **Updates und Deinstallation:** Velopack unter Windows, dreistufiges Update unter Android; die
  Deinstallation entfernt Wake-Word-Aufnahmen und lokale Artefakte.

**Grenze:** Der Debug-Bau hat eine eigene Anwendungskennung und aktualisiert nie die installierte
App. Diese Sperre existiert, weil ein früherer Debug-Bau genau das getan hat.

### 19.2 Recovery

Die Recovery-App entschlüsselt ein `.enc`-Backup offline mit dem Backup-Passwort (Argon2id und
AES-256-GCM über DIS). Sie entpackt das `tar.gz` in ein temporäres Verzeichnis, zeigt Dateibaum
und Vorschau und speichert die Auswahl. Das Passwort bleibt im Speicher; das temporäre Verzeichnis
wird aufgeräumt.

## 20. Design-System und Qualitätsstand

### 20.1 Gemeinsame Oberfläche

`frontend/packages/maunting-ui` (intern `@maunting/ui`) enthält 54 Komponenten für Panel,
Browser-Hülle und Desktop-App: Knöpfe, Dialoge, Dropdowns, Karten, Reiterleisten, Tabellen, Toasts,
Kurzinfos, Datumsauswahl, Farbwahl, Symbolwahl, Chat-Eingabeleiste, Fortschrittsbalken und mehr.
Tokens liegen in `tokens.css`/`tokens.ts`; das Paket liefert den WebGL-Sprachschwarm als eigenen
Einstiegspunkt.

Die Regel lautet Design-System zuerst. Ein natives `<select>` ist nicht akzeptabel, wenn ein
`Dropdown` existiert; eine native `title`-Kurzinfo nicht, wenn `Kurzinfo` existiert. Tests
erzwingen Teile davon, etwa `frontend/src/test/keinNativesTitle.test.ts` und der Test für
beschriftete Schalter.

### 20.2 Barrierefreiheit

Dialogstapel, Fokusrückgabe, Escape-Behandlung, 44-px-Ziele auf Touch-Geräten, ein Tab-Halt je
Raster, benannte Bedienelemente und ein sichtbarer Fokusring stecken in den Komponenten, nicht in
jeder Seite. Tests decken zwei offene Dialoge, ein Popover über einem Dialog und ein Raster, das
mit einem Tab erreichbar ist.

### 20.3 Sprachen

Die Oberfläche liefert Deutsch und Englisch. `frontend/src/locales/de.json` enthält 9731
Zeichenketten (gezählt durch Ablaufen des JSON). Keine Komponente darf einen festen deutschen oder
englischen Satz tragen: Vorgaben für Platzhalter, Suche und leere Liste kommen aus i18n.

### 20.4 Testdisziplin

- Backend-Tests verlangen PostgreSQL; SQLite wird abgelehnt (`database_policy.py`).
  Migrationstests laufen auf einer Wegwerfdatenbank hin und zurück.
- Ein Test zu einem Fix muss am Stand davor scheitern; sonst beweist er den Fix nicht.
- Der Krypto-Fassadentest (`test_krypto_fassade.py`) weist direkte Importe von Krypto-Bibliotheken
  außerhalb der freigegebenen Fassade ab. Jede Verschlüsselung geht über `DisClient`.
- Der Mojibake-Test (`test_quelltext_ohne_mojibake.py`) durchsucht jede verfolgte Quelldatei nach
  doppelt kodiertem Text, weil solcher Text für jedes Werkzeug gültig aussieht.
- Der Versionstest (`test_versionen_gleich.py`) hält Frontend, Tauri-Crates, Agent und
  Versionsendpunkt des Backends auf derselben Nummer.

### 20.5 Produkttext

Sichtbarer Text folgt den Projektregeln: keine formelhaften Einleitungen, keine künstlichen
Schlüsse, keine unbelegten Superlative, keine Emojis in der Oberfläche, keine erfundenen Quellen.
Eine Aussage über Verschlüsselung erscheint nur dort, wo der Code sie einhält, und die
Datenschutzseite ist mit Fassung und Datum versioniert und gegen ihre Tests geprüft.

## 21. Vergleich mit anderen Open-Source-Projekten

Alle Vergleiche stützen sich auf die offizielle Dokumentation der Projekte, abgerufen am 11.
November 2026. Wo die geprüfte Dokumentation eine Frage nicht beantwortet, steht „nicht geprüft"
statt einer Vermutung. MSM-Aussagen sind durch die Codebelege in Kapitel 1 bis 20 gedeckt.

### 21.1 Game-Server-Panels

| | MSM | Pterodactyl v1 | Pelican | AMP | Crafty Controller | LinuxGSM |
|---|---|---|---|---|---|---|
| Lizenz | AGPL-3.0 | MIT | AGPL-3.0 | kommerziell | GPLv3 | MIT |
| Form | Panel + eigener Agent je Node | Panel (PHP) + Wings (Go) | Panel + Wings + Eggs + Yolks | ADS + Instanzmanager | Python-Web-GUI | Shell-Skripte, kein Panel |
| Isolierung | Rootless Docker, `cap_drop=ALL` | Docker-Container je Instanz | Docker-Container je Instanz | Docker optional | nicht geprüft | keine (Host-Prozesse) |
| Arbeitslast | 32 native Blueprints, reine Daten | Eggs (Seite: 253 Spiele, 55 Apps) | Eggs und Yolks | Hersteller-Module | Minecraft-Jars/EXEs | 148 Spielskripte |
| Steam Workshop | nativ über SteamCMD | nicht als eingebaut geprüft | nicht als eingebaut geprüft | nicht geprüft | nein | über SteamCMD |
| Mehrere Nodes | ja, Aufnahme mit Freigabe | ja, Wings je Host | ja, Wings je Host | ADS-Instanzen | einzelne Installation | je Host |
| Rollen | 91 Rechte, global/Server/Team | Subuser mit feinen Rechten | Subuser | Editionsgrenzen | Benutzer/Rollen | OS-Benutzer |
| Selbstheilung | Guardian je Node | nein | nein | nicht geprüft | nein | Neustart bei Überwachung |

Was MSM anders macht: Das Panel ist nicht nur Game-Hosting. Dieselbe Installation trägt
Datenbanken, Dokumente, einen Messenger, einen Tresor, einen KI-Agenten und einen Browser-Client
mit einem Rechte-Modell über allem. Guardian prüft lokal und repariert innerhalb der
Blueprint-Regeln, sodass ein Panel-Ausfall die Wiederherstellung nicht stoppt. Blueprints sind
reine Daten; ein Nutzer kann kein Skript hochladen, das auf dem Node läuft.

Wo die anderen vorn sind: Der Egg-Katalog von Pterodactyl ist deutlich größer als MSMs 32
Blueprints, und das Ökosystem ist älter. LinuxGSM unterstützt 148 Spiele ohne Panel. Pelican ist
ein direkter Nachfolger von Pterodactyl mit demselben Denkmodell, was Umstieg erleichtert. AMP ist
ein kommerzielles Produkt mit Herstellersupport, kein Open-Source-Projekt; es steht als Kontext
dort, nicht als Lizenzvergleich.

### 21.2 Container-Plattformen

Portainer CE (zlib-Lizenz) verwaltet Docker, Swarm, Kubernetes und Podman mit einem Agent je Node.
Die Dokumentation nennt RBAC als Business-Edition-Feature, nicht als CE-Feature. Rancher
(Apache-2.0) ist eine Kubernetes-Management-Plattform.

MSM versucht kein allgemeines Container-IDE zu sein. Es betreibt einen festen Satz Arbeitslasten,
den Blueprints erklären, mit Ports, Backups und Gesundheitsprüfungen. Wer beliebige
Compose-Stacks und clusterweite Kubernetes-Regeln braucht, ist mit Portainer oder Rancher besser
bedient.

### 21.3 Messenger

| | MSM | Mattermost | Element / Matrix | Rocket.Chat |
|---|---|---|---|---|
| Lizenz | AGPL-3.0 | MIT-Binaries, AGPLv3-Quellcode | AGPL-3.0 | MIT außer `ee/` |
| Nachrichten-E2EE | ja, Double Ratchet je Gerät | nein; TLS und Plattenverschlüsselung | ja, Olm/Megolm | DMs und private Kanäle, nicht öffentlich |
| Föderation | nein | nein | ja | über Matrix, Premium |
| Anrufe | LiveKit, E2EE-Raumschlüssel | DTLS/SRTP über den Server | MatrixRTC mit LiveKit | hier nicht geprüft |

Mattermost dokumentiert, dass Anrufe nicht Ende-zu-Ende verschlüsselt sind und Medien über den
Server laufen. Matrix hat das reifste Föderations- und Cross-Signing-Modell, inklusive SAS und
QR-Prüfung. Rocket.Chats E2EE schließt öffentliche Kanäle aus, und verschlüsselter Inhalt ist nicht
durchsuchbar oder auditierbar; das ist ein bewusster Kompromiss.

MSMs Unterschied ist die Integration: Der Messenger teilt Konten, Rollen, Tresor und Panel mit dem
Rest. Der Preis ist derselbe: keine Föderation und ein kleineres Client-Ökosystem als Matrix.

### 21.4 Tresore

Vaultwarden (AGPL-3.0) ist ein inoffizieller Bitwarden-kompatibler Server in Rust; es unterstützt
Organisationen, Collections, Anhänge und 2FA. Die Dokumentation beschreibt die Zero-Knowledge-
Eigenschaft nicht ausdrücklich, deshalb behauptet dieses Dokument sie nicht für Vaultwarden; sie
ist eine Eigenschaft des Bitwarden-Clientmodells. Der Bitwarden-Server ist standardmäßig AGPLv3 mit
eigener Lizenz in `/bitwarden_license`; Send ist dokumentiert als Ende-zu-Ende verschlüsselt.

MSMs Tresor ist Zero-Knowledge durch Konstruktion: Der Server speichert Chunks, eine
HMAC-Bucket-ID und ein Kontingent, nie den Master-Schlüssel. Dazu kommen Galerie, Team-Tresore und eine
Kamera-Sicherung mit Post-Quanten-Hybrid-Umschlag. Bitwarden und Vaultwarden haben das größere
Client- und Browser-Erweiterungs-Ökosystem; MSMs Browser-Anbindung ist der eigene Pontis.

### 21.5 Suche

SearXNG (AGPL-3.0) ist die Metasuche, die MSM als Sidecar mitliefert. Die Dokumentation nennt
kein Nutzer-Tracking und kein Profiling sowie bis zu 260 Suchdienste. Whoogle (MIT) war eine
Alternative, die Google-Ergebnisse ohne JavaScript weiterreichte; das Projekt wurde am 24. Juli
2026 archiviert und liefert keine Ergebnisse mehr. Es ist heute keine sinnvolle Wahl.

MSM setzt zwei Dinge darauf: Brave Search als optionale API für strukturierte Treffertypen und
eine KI-Zusammenfassung mit Belegen über die zusammengeführten Ergebnisse. Die Datenschutzaussage
bleibt die von SearXNG: Die Anfrage geht an die lokale Instanz, nicht an den Browserhersteller.

### 21.6 KI-Oberflächen

Open WebUI nutzt die „Open WebUI License", eine BSD-artige Lizenz mit Branding-Klausel. Es
unterstützt Ollama, OpenAI und kompatible Endpunkte, Python-Werkzeuge, MCP über Streamable HTTP,
RAG mit Hybridsuche und mehreren Vektor-Datenbanken sowie RBAC und SSO. LibreChat (MIT)
unterstützt viele Anbieter, Agenten mit Subagenten, MCP-Server und eine Code-Interpreter-Sandbox,
dazu 2FA und Passkeys.

Beide sind als allgemeine Chat-Oberflächen stärker als MSM, besonders bei RAG-Breite und
Anbieterauswahl. MSMs KI ist andersartig: Ihre 125 Werkzeuge bedienen das Panel selbst (Server,
Dateien, Backups, Datenbanken, DNS, Audit, Dokumente), und jede Schreibaktion wird eine
Vorschlagskarte, gebunden an die Rechte des Aufrufers. Eine Chat-Oberfläche kann keinen Gameserver
neu starten; MSMs Agent kann es, im selben Rechte-Modell wie die Oberfläche.

### 21.7 Quellen

Alle abgerufen am 11. November 2026.

- Pterodactyl: https://pterodactyl.io/ und https://github.com/pterodactyl/panel/releases
- Pelican: https://pelican.dev/docs und https://github.com/pelican-dev/panel
- AMP: https://cubecoders.com/AMP, https://cubecoders.com/TermsOfSale/AMP
- Crafty: https://craftycontrol.com/ und https://docs.craftycontrol.com/
- LinuxGSM: https://linuxgsm.com/
- Portainer: https://docs.portainer.io/ und https://docs.portainer.io/admin/environments/add/docker/agent
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

Aus den Tabellen herausgehaltene Unsicherheiten: AMPs genauer Lizenztext und Spielzahl; ob
Pterodactyl oder Pelican Workshop nativ mitbringen; Craftys Container-Isolierung; der
Compose-Umfang von Portainer CE; Vaultwardens ausdrückliche Zero-Knowledge-Formulierung;
Rocket.Chats Schlüsselverwaltung; das Detail der Gruppenanruf-Verschlüsselung bei Element; das
Server-Log-Verhalten von SearXNG.

## 22. Lücken und Widersprüche

Dieses Kapitel nennt, was der Code **nicht** tut und wo älterer Text vom Code abweicht. Es existiert,
damit das Dokument als Referenz taugt, ohne Behauptungen zu wiederholen, die nicht halten.

### 22.1 Fehlende Funktionen, die manchmal angenommen werden

- **Modrinth ist nicht angebunden.** `docs/blueprints.md` nennt es; Schema und Dienste kennen nur
  Steam Workshop und CurseForge. Ein Modrinth-Mod lässt sich heute nicht über den Modmanager
  installieren.
- **Keine Command-Palette.** Das Panel hat keine globale Befehlspalette und keine panelweiten
  Tastenkürzel. Kürzel gibt es im Browser und im Dokumenteneditor.
- **Kubernetes ist experimentell.** `deploy/kubernetes/` deckt nur die Control Plane ab, mit einer
  Replica, und ist in der README als experimentell markiert.
- **Die Hoster-API ist früh.** Routen und Sollzustandsvertrag existieren, aber der Betreiber
  beschreibt das Teilsystem als noch in Entwicklung.
- **Blueprints werden weiter ausgebaut.** Das System ist der Kern des Produkts und hat offene
  Arbeiten, besonders am Katalog und an der Mod-Injektion für weitere Spiele.
- **Google Programmable Search ist nicht angebunden.** Sie wurde aus Backend, API-Schemas und dem
  Reiter Suchmaschine entfernt; Maunting Search nutzt SearXNG und optional Brave Search.
- **Umfragen gibt es im Messenger nicht.** Reaktionen, Antworten und Sticker ja; ein
  Umfrage-Feature nein.
- **Erweiterungen in Pontis gibt es nur unter Windows.** Der Android-Bau lädt keine.
- **Ganzseiten-Screenshots fehlen während der Gerätenachbildung.** Beide nutzen denselben
  WebView2-Override.

### 22.2 Wo älterer Text vom Code abweicht

| Ältere Aussage | Tatsächliches Verhalten |
|---|---|
| Backups sind immer clientseitig verschlüsselt, bevor sie die Infrastruktur verlassen | Das lokale Archiv ist standardmäßig `tar.gz`; mit Backup-Passwort wird es `.enc`. Der S3-Upload verlangt das Passwort und läuft verschlüsselt über DIS. |
| „Not a Hosting Provider" ohne Einschränkung | Eine Hoster-API existiert und ist optional. Die README sagt jetzt: self-hosted mit optionaler Hoster-Anbindung. |
| „Not a Windows Application" | Panel und Agent sind Linux; MSS ist ein Windows- und Android-Client. Die README trennt beides jetzt. |
| 125 KI-Werkzeuge sind eine Dokumentationsbehauptung | 125 ist in `backend/tests/test_ai_tool_drift.py` festgeschrieben; Registry und Katalog müssen übereinstimmen. |
| Modrinth-Unterstützung | Nicht umgesetzt (siehe 22.1). |

Die README wurde in derselben Änderung korrigiert, die dieses Dokument hinzufügt.

## 23. Anhang: Zahlen, Glossar, Dateikarte

### 23.1 Zählweise

| Zahl | Wert | Befehl oder Datei |
|---|---|---|
| Commits | 2481 | `git rev-list --count HEAD` |
| Erster Commit | 19.05.2026 | `git log --reverse --format='%ad %s' --date=short \| head -1` |
| Router-Module | 57 + 12 | `ls backend/routers/*.py`, `ls backend/routers/social/*.py` |
| Routen | 740 | `grep -rhoE '@router\.(get\|post\|put\|patch\|delete\|websocket)\(' backend/routers \| wc -l` |
| Service-Module | 235 | `ls backend/services/*.py \| wc -l` |
| Tabellen | 131 | eindeutige `__tablename__` in `backend/models` |
| Rechte-Schlüssel | 91 | eindeutige `PermissionDef("…")` |
| KI-Werkzeuge | 125 | `backend/tests/test_ai_tool_drift.py` |
| Blueprints | 32 + 1 | `backend/blueprints/native`, `blueprints/community` |
| Backend-Tests | 460 Dateien / 6592 | `find backend/tests -name 'test_*.py'`, `def test_` zählen |
| Frontend-Tests | 544 Dateien / 4531 | `find frontend/src -name '*.test.ts[x]'`, `it(`/`test(` zählen |
| Rust-Tests | 425 | `#[test]` und `#[tokio::test]` in den drei Tauri-Crates |
| Seiten | 84 | `find frontend/src/pages -name '*.tsx' ! -name '*.test.tsx'` |
| Komponenten | 229 | `find frontend/src/components -name '*.tsx' ! -name '*.test.tsx'` |
| UI-Komponenten | 54 | `find frontend/packages/maunting-ui/src -name '*.tsx' ! -name '*.test.tsx'` |
| Sprachschlüssel | 9731 | Ablaufen von `frontend/src/locales/de.json` |

Die Zahlen gelten für den Baum bei Commit `aad9d19e`. Ein späterer Commit kann sie ändern; dann
mit demselben Befehl neu zählen, statt die Zahl zu übernehmen.

### 23.2 Glossar

- **Blueprint:** erklärende Arbeitslastdefinition (Image, Ports, Dateien, Prüfungen, Backups). Das
  MSM-Gegenstück zum Egg, aber reine Daten und ohne Shell-Hooks.
- **Node:** ein Linux-Host mit `msm-agent`; das Panel verwaltet einen oder mehrere.
- **Guardian:** lokaler Aufseher auf einem Node, der Container prüft und innerhalb der
  Blueprint-Regeln repariert.
- **DIS:** die Verschlüsselungsbibliothek des Projekts (`@msdis/shield`), genutzt über einen
  Sidecar für Datenbankspalten, Backups, ALTCHA und Messaging-Formate.
- **Blind-Index:** HMAC eines Werts, neben dem Chiffrat gespeichert, damit eine Suche ohne
  Klartextspalte möglich ist.
- **AAD:** zusätzliche authentifizierte Daten; binden ein Chiffrat an seinen Kontext (Tabelle und
  Spalte oder Datei-ID), damit es nicht woandershin wandern kann.
- **Double Ratchet:** das E2EE-Protokoll je Gerät; es liefert Forward Secrecy und Erholung nach
  einer Kompromittierung.
- **Gerätepostfach:** Zustellwarteschlange je Gerät mit eigenem ID-Raum, getrennt von der
  geteilten Mailbox.
- **MSS:** Maunting Smart System, der Windows- und Android-Client.
- **MSB / Pontis:** der Browser; „MSB" steht im Code und in älteren Texten, „Pontis" ist der
  Produktname.
- **Hoster-API:** optionale Sollzustands-API für Hosting-Anbieter.

### 23.3 Dateikarte

| Bereich | Einstiegspunkte |
|---|---|
| Panel-API | `backend/main.py`, `backend/routers/` |
| Server | `routers/servers.py`, `services/server_lifecycle_service.py`, `server_provisioning_service.py` |
| Blueprints | `backend/blueprints/schema.py`, `routers/blueprints.py`, `backend/blueprints/native/` |
| Mods | `routers/mods.py`, `routers/curseforge.py`, `services/mod_update_service.py` |
| Backups | `services/backup_orchestrator.py`, `backup_service.py`, `backup_crypto_service.py` |
| Datenbanken | `services/postgres_ddl.py`, `routers/postgres_studio.py`, `routers/sqlite_studio.py` |
| Nodes | `msm-agent/`, `routers/nodes.py`, `services/node_enrollment_service.py` |
| Rechte | `services/permission_catalog.py`, `permission_service.py`, `routers/roles.py` |
| KI | `services/ai_*`, `routers/ai_*.py`, `backend/ai_skills/` |
| Messenger | `routers/social/`, `services/social/`, `frontend/src/components/social/` |
| Tresor | `routers/vault.py`, `services/vault_*.py`, `frontend/src/desktop/vault/` |
| Dokumente | `routers/docs.py`, `docs-sidecar/`, `frontend/src/docs/` |
| Browser | `browser/src-tauri/src/`, `frontend/src/browser/` |
| Desktop | `smart-system/src-tauri/src/`, `frontend/src/desktop/` |
| Design-System | `frontend/packages/maunting-ui/` |