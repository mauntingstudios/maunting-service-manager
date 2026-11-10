# Maunting Pontis („Pontis Browser“) — Technische Gesamtdokumentation
### Architektur, Sicherheitskonzepte, Speichermanagement und Systemintegration

---

## 1. Systemüberblick & Vision

Moderne Webbrowser basieren nahezu ausnahmslos auf einem von zwei Architekturmustern:

1. **Chromium-Monolithen (Google Chrome, Microsoft Edge, Brave):**  
   Sie bieten eine hohe Webkompatibilität, erzwingen jedoch massive Installationspakete (> 150–200 MB), riesige Build-Umgebungen und einen hohen Basisspeicherbedarf (häufig 1.500 bis 3.500 MB RAM bei moderater Tab-Nutzung). Zudem binden viele Derivate Telemetriedienste, Werbenetzwerke oder Cloud-Abhängigkeiten fest in den Binärkörper ein.
2. **Klassische Web-Wrapper (Electron):**  
   Sie bündeln für jede Anwendung eine eigene Node.js-Laufzeit und eine separate Chromium-Instanz. Das führt bereits im Leerlauf zu 300 bis 500 MB RAM-Last, erfordert manuelle Sicherheits-Updates bei V8-Schwachstellen und birgt durch unzureichende Prozess-Isolation strukturelle Angriffsflächen.

**Maunting Pontis** (im Quellcode als [`maunting-secure-browser`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/Cargo.toml#L1-L10), Version `5.8.0`, integriert in das Maunting Server Manager Ökosystem bis v5.9.1) wählt einen dritten Weg:
Pontis ist ein Multi-Webview-Desktop- und Mobil-Browser auf Basis von **Tauri v2** und **Rust**. Er nutzt die im Betriebssystem bereits vorhandenen Rendering-Engines (unter Windows: Microsoft Edge WebView2 Evergreen via Win32-COM; unter Android: `android.webkit.WebView` via JNI-Brücke) und steuert diese über einen speichersicheren Rust-Sicherheitskern.

### Primäre Leitprinzipien
* **Strikte Zero-Trust-Isolation:** Die Browser-Oberfläche und fremde Webseiten teilen sich weder Prozesse noch IPC-Kanäle. Externe Webseiten besitzen keinen Zugriff auf Host-APIs oder Tauri-Internals.
* **Deterministisches Speichermanagement:** Durch eine zweistufige Ruhe- und Entlademechanik bleibt der Arbeitsspeicher auch bei dutzenden Tabs im Bereich von 600 bis 1.000 MB.
* **Kompromisslose Datensouveränität:** 0 Byte Telemetrie. Microsoft SmartScreen und Cloud-Tracking sind auf Engine-Ebene hart deaktiviert. Übersetzung, Sprachsuche und Zugangsdatenverwaltung laufen vollständig lokal auf dem Endgerät.

---

## 2. Kernarchitektur: Warum es so ist, wie es ist

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Betriebssystem / Windows 11                        │
├─────────────────────────────────────────────────────────────────────────┤
│  Maunting Pontis Hauptprozess (Rust / Tauri v2 Core)                   │
│                                                                         │
│  ┌─────────────────────────┐       ┌─────────────────────────────────┐  │
│  │  Tauri Webview "main"   │       │  Win32 Child HWNDs              │  │
│  │  React 18 + Design-DNA  │       │  ICoreWebView2Controller        │  │
│  │  - Tab-Leiste & Chronik │       │  (Direkt via Win32 COM)         │  │
│  │  - URL-Bar & Lesezeichen│       │                                 │  │
│  │  - Lokales Bergamot KI  │       │  ┌──────────────┐ ┌───────────┐ │  │
│  │  - Lokales Whisper KI   │       │  │ Tab 1 (Web)  │ │ Tab 2...  │ │  │
│  │  - Exklusive IPC-Rechte │       │  │ Zero IPC     │ │ Zero IPC  │ │  │
│  └────────────┬────────────┘       │  └──────┬───────┘ └─────┬─────┘ │  │
│               │                    └─────────┼───────────────┼───────┘  │
│       Tauri IPC (81 Befehle)                 │               │          │
│               │                              │               │          │
│  ┌────────────▼──────────────────────────────▼───────────────▼───────┐  │
│  │  Rust-Steuerungsebene:                                            │  │
│  │  - Tab-Koordination (desktop.rs, weg.rs)                          │  │
│  │  - Brave-Adblock-Kern & Pre-Socket-Filter (schild/mod.rs)         │  │
│  │  - Speicher-Wächter & 2-Stufen-Ruhemodus (ruhe.rs, schlaf.rs)     │  │
│  │  - Airspace-Standbild-Pipeline (standbild.rs)                     │  │
│  │  - Download-Quarantäne & Antivirus-Integration (quarantaene.rs)   │  │
│  │  - CRX3 Chrome-Erweiterungs-Manager (erweiterungen/crx.rs)        │  │
│  │  - WASAPI Windows-Mixer Re-Branding (mixer.rs)                    │  │
│  │  - DWM Fenster-Komposition (crates/fensteroptik)                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### A. Tauri v2 und System-Webviews statt Chromium-Fork
1. **Wartung & Sicherheits-Patches:** Bei einem eigenen Chromium-Fork muss das Entwicklerteam jeden V8- und Blink-Sicherheits-Patch manuell mergen, neu kompilieren und verteilen. Bei Pontis übernimmt das Betriebssystem die Wartung der Render-Engine über Windows Update bzw. Google Play Systemdienste.
2. **Download- und Installationsgröße:** Da die Rendering-Engine bereits Teil des Betriebssystems ist, bleibt das Installationspaket unter 30 MB (gegenüber > 150 MB bei Chrome/Brave).
3. **Speichersicherheit im Vermittler:** Der gesamte sicherheitskritische Code (Netzwerk-Interzeption, Dateiquarantäne, Erweiterungs-Entpackung) ist in Rust formuliert.

### B. Eigene Win32-COM-Controller statt Tauris `WebviewBuilder`
Viele Tauri-Anwendungen erstellen zusätzliche Webviews über Tauris eingebauten `WebviewBuilder`. Im Kontext eines Browsers stellt dies ein gravierendes Sicherheitsrisiko dar. In [`browser/src-tauri/src/tabs/desktop.rs`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop.rs#L1-L16) ist die Rationale dokumentiert:

```rust
//! Bewusst nicht über Tauri. Jede Webview, die Tauri anlegt, bekommt die
//! IPC-Brücke (__TAURI_INTERNALS__) und die Skripte aller Plugins: in einer
//! fremden Seite gingen alert, confirm und Notification an Tauri statt
//! an den Browser, und jede Seite sah die Brücke. Die Befehle
//! scheiterten zwar an den Rechten, aber eine Seite soll die Brücke gar nicht
//! erst haben. Hier gibt es keine: kein Skript von Tauri, kein
//! `ipc:`-Protokoll.
```

* **Rechte-Monopol der UI:** Nur die React-Oberfläche läuft in der Tauri-Webview `main`. Ausschließlich dieses Fenster besitzt die in [`capabilities/oberflaeche.json`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/capabilities/oberflaeche.json) und [`permissions/oberflaeche.toml`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/permissions/oberflaeche.toml) definierten 81 IPC-Befehle.
* **Vollständige Isolierung der Tabs:** Jeder Webseiten-Tab wird direkt über Win32 COM (`webview2-com`) als `ICoreWebView2Controller` auf ein Child-HWND des Hauptfensters erzeugt ([`desktop.rs:276-299`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop.rs#L276-L299)).
* **Deaktivierung von Host-Objekten:** Auf jedem Tab-Controller wird `SetAreHostObjectsAllowed(false)` gesetzt ([`desktop.rs:408`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop.rs#L408)). Webseiten sehen weder COM-Brücken noch JavaScript-Objekte des Betriebssystems.
* **Schutz vor Rechte-Vererbung:** Die Funktion [`id_pruefen`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/weg.rs#L9-L15) erzwingt für alle Tabs das Namenspräfix `tab-`. Kein Tab kann den Bezeichner `main` einnehmen oder Berechtigungen der Oberfläche erben.
* **Bereinigung von Umgebungsvariablen:** Beim Programmstart bereinigt [`browser/src-tauri/src/main.rs:36-41`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/main.rs#L36-L41) im Release-Build alle Umgebungsvariablen, die mit `WEBVIEW2_` beginnen. Damit wird unterbunden, dass manipulierte Systemvariablen externe Debug-Ports öffnen oder Sicherheitsfeatures aushebeln.

---

## 3. Das Win32-Airspace-Problem & die Standbild-Lösung

### Das Problem
Im Windows-Fenstermanager liegen native Win32-Child-HWNDs hierarchisch stets oberhalb der Rendering-Fläche des Elternfensters. Würde die in HTML gerenderte React-Oberfläche ein Dropdown-Menü, die Adressleisten-Vorschläge oder ein Einstellungs-Modal öffnen, würde das native Webview-Fenster diese UI-Elemente überdecken („Airspace Issue“).

### Die Lösung: Intersection-Observer & Standbild-Pipeline
Pontis löst diesen Konflikt durch eine koordinierte Pipeline aus DOM-Überwachung, Snapshot-Generierung und Sichtbarkeitsumschaltung:

```
[DOM-Änderung in React]
        │
        ▼ (MutationObserver in useUeberdeckungBeobachten)
Prüfung: aria-modal="true", role="menu", role="listbox", data-msb-verdeckt
Schneidet die Bounding-Box des Overlays den Hauptinhalt (<main>)?
        │
        ├─► NEIN (z. B. Tooltip in der Seitenleiste): Webview bleibt sichtbar.
        │
        └─► JA (Overlay ragt über die Webview):
              1. Standbild anfordern: nativ.tabStandbild(id)
              2. Rust nimmt Snapshot via ICoreWebView2::CapturePreview(JPEG)
              3. React empfängt Bytes, erstellt URL.createObjectURL(blob)
              4. Warten auf zwei requestAnimationFrame (Standbild stabil im DOM)
              5. Erst jetzt: Rust schaltet Webview unsichtbar (tabsVerdecken(true))
              6. Overlay liegt nahtlos über dem Standbild (kein Flackern)
              │
              ▼ (Overlay schließt sich)
        tabsVerdecken(false) -> Native Webview wird wieder eingeblendet
        URL.revokeObjectURL(blob) -> Standbild-Speicher wird sofort freigegeben
```

#### Technische Details im Code
* **DOM-Beobachter:** [`frontend/src/browser/services/ueberdeckung.ts:162-217`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/browser/services/ueberdeckung.ts#L162-L217) scannt bei Mutationen gezielt nach Modal- und Menü-Attributen und vergleicht deren `getBoundingClientRect()` mit dem Inhaltsbereich.
* **Snapshot-Erzeugung:** [`browser/src-tauri/src/tabs/desktop/standbild.rs:31-84`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/standbild.rs#L31-L84) nutzt einen Win32 `IStream` (`CreateStreamOnHGlobal`) und erzeugt einen kompakten JPEG-Snapshot über `CapturePreview`.
* **Splitscreen & Panels:** Bei geteilter Ansicht oder geöffneter Seitenleisten-App erfasst [`ueberdeckung.ts:93-111`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/browser/services/ueberdeckung.ts#L93-L111) simultan die Standbilder aller sichtbaren Webviews.
* **Ganzseiten-Screenshots via Chrome DevTools Protocol:** Um scrollbare Webseiten vollständig abzulichten, meidet Pontis das fehleranfällige `captureBeyondViewport`. Stattdessen ruft [`standbild.rs:42-61`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/standbild.rs#L42-L61) `Page.getLayoutMetrics` ab, setzt temporär `Emulation.setDeviceMetricsOverride` auf die ermittelte CSS-Inhaltshöhe und erfasst das Bild präzise über `Page.captureScreenshot`.

---

## 4. Tab-Lebenszyklus & 2-stufiges Speichermanagement

Klassische Browser belassen inaktive Tabs im Arbeitsspeicher, wo Hintergrund-Timer, Garbage-Collection und offene WebSockets kontinuierlich CPU-Zyklen und RAM binden. Pontis implementiert eine deterministische Lebenszyklus-Kaskade:

```
[Tab im Vordergrund]
  └── Speicher-Ziel: COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        │
        ▼ (Tab verliert den Fokus)
[Stufe 0: Hintergrund-Drosselung]
  └── Speicher-Ziel: COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        │
        ▼ (Inaktivität > z. B. 30 Minuten)
[Stufe 1: Tab-Schlaf / Standby]
  └── Aufruf von TrySuspend() via ICoreWebView2_3
      - JavaScript-Ausführung stoppt vollständig (0 % CPU)
      - Arbeitsspeicher wird minimiert
      - Aufwachen erfolgt ohne Netzwerk-Reload über Resume()
        │
        ▼ (Inaktivität > 60 Minuten & Energiesparmodus aktiv)
[Stufe 2: Physisches Verwerfen / Entladen]
  └── Aufruf von controller.Close()
      - Nativer Controller wird vollständig aus dem RAM zerstört (0 MB RAM)
      - Metadaten (URL, Titel, Favicon, Scrollposition) bleiben im React-Zustand
      - Klick auf den Tab baut den Controller bei Bedarf transparent neu auf
```

### Quellcode-Nachweise & Schutzmechanismen
* **Hintergrund-Wächter:** [`browser/src-tauri/src/tabs/ruhe.rs:65-77`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/ruhe.rs#L65-L77) prüft im Intervall von 30 Sekunden (`PRUEFTAKT`), welche Tabs die konfigurierten Schwellenwerte überschritten haben.
* **Ausnahmen vom Schlafmodus (Immunität):**
  1. **Audio-Wiedergabe:** `IsDocumentPlayingAudio` meldet aktive Wiedergabe ([`schlaf.rs:99`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/schlaf.rs#L99)).
  2. **Aktive Downloads:** Ein Download läuft im Tab (`herunterladen::laeuft(id)`).
  3. **InPrivate-Tabs:** Werden **niemals** verworfen ([`ruhe.rs:99`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/ruhe.rs#L99)), da WebView2 InPrivate-Sitzungsdaten ausschließlich im flüchtigen RAM hält. Ein Schließen des Controllers würde Cookies und Formularzustände unwiederbringlich löschen.
  4. **Domain-Whitelist:** Einträge in der Host-Ausnahmeliste ([`ruhe.rs:110-115`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/ruhe.rs#L110-L115)) bleiben dauerhaft aktiv.

---

## 5. Datenschutz, Schild & Netzwerk-Interzeption (`schild`)

### A. Pre-Socket-Blockierung via Brave-Adblock-Kern
Pontis setzt in [`browser/src-tauri/src/schild/mod.rs`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/schild/mod.rs) auf die native Rust-Bibliothek von Brave (`adblock = 0.13`) mit getrennten Engines für Werbefilter (EasyList + EasyList Germany) und Trackingfilter (EasyPrivacy).

In [`browser/src-tauri/src/tabs/desktop/webview2.rs:175-224`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/webview2.rs#L175-L224) registriert Pontis den Filter über Win32 COM:

```rust
let alle = HSTRING::from("*");
match core.cast::<ICoreWebView2_22>() {
    Ok(core22) => core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
        &alle,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
    )?,
    Err(_) => core.AddWebResourceRequestedFilter(&alle, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?,
}
```

* **Vollständige Abdeckung:** Der Filter erfasst nicht nur Dokumente und Skripte, sondern auch **Iframes, Service-Worker und Shared-Worker**.
* **Synthetische Antworten ohne Netzwerk-Latenz:**
  * Geblockte Werbung und Tracker: Synthetisches **HTTP 403 Forbidden** („Blocked by MSB“). Es geht kein TCP-Paket ins Netz.
  * Pings und Beacons (`navigator.sendBeacon`, `<a ping>`): Synthetisches **HTTP 204 No Content** ([`schild/mod.rs:95-100`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/schild/mod.rs#L95-L100)), damit Skripte nicht in Endlosschleifen verfallen.
* **Kosmetisches Filtern:** Nach `DOMContentLoaded` injiziert Rust dynamisch CSS (`display: none !important`) für seitenspezifische und generische Selektoren ([`webview2.rs:382-401`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/webview2.rs#L382-L401)).
* **Link-Säuberung (`verfolgung.rs`):** Entfernt 48 bekannte Tracking- und Kampagnenparameter (`fbclid`, `gclid`, `utm_*`, `srsltid`, `si`, `igshid`, etc.) direkt aus dem Rohtext der Abfrage ([`verfolgung.rs:11-47`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/schild/verfolgung.rs#L11-L47)). Dadurch bleiben kryptographisch signierte Pfadsegmente unberührt.
* **Favicon-Leckschutz:** Favicons werden nicht über HTTP-Anfragen der Benutzeroberfläche geladen, da dies Tracking-Pings ermöglichen würde. Stattdessen liest [`webview2.rs:150-173`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/webview2.rs#L150-L173) die Bilddaten über `ICoreWebView2_15::GetFavicon` direkt aus dem internen Cache der Engine und übergibt sie als Base64-Data-URI an die Oberfläche.
* **Deaktivierung von Microsoft-Diensten:** Über den WebView2-Startparameter `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` ([`desktop.rs:87`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop.rs#L87)) werden Microsoft SmartScreen und Cloud-UI-Pings vollständig unterbunden.

### B. Jugendschutz & Inhaltsbeschränkung (`sperre.rs`)
* **Kategoriensperren:** Blockiert Domänen für nicht jugendfreie Inhalte, Glücksspiel und Suchtpotenzial über eine effiziente Baumsuche über Eltern-Domänen ([`sperre.rs:96-128`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/schild/sperre.rs#L96-L128)).
* **Erzwungenes SafeSearch:** Schreibt Suchmaschinen-Anfragen transparent um ([`sperre.rs:137-163`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/schild/sperre.rs#L137-L163)):
  * Google: Parameter `safe=active`
  * Bing: Parameter `adlt=strict`
  * DuckDuckGo: Parameter `kp=1`
  * Brave Search: Parameter `safesearch=strict`
  * YouTube: Injektion des HTTP-Headers `YouTube-Restrict: Strict`
* **IP-Adressen-Sperre:** Verhindert das Umgehen von Namensblocklisten durch direkte Eingabe öffentlicher IPv4/IPv6-Adressen ([`sperre.rs:77-93`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/schild/sperre.rs#L77-L93)). Private IP-Bereiche (Router, Heimnetzwerke) bleiben erreichbar.

---

## 6. Sandboxing, Vorab-Injektion & DOM-Sicherheit (`seite.js`)

Vor Ausführung von Seitenskripten injiziert WebView2 das Skript [`browser/src-tauri/src/seite.js`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/seite.js):

### A. Brücken-Entfernung & Schutz vor Prototype Poisoning
```javascript
// seite.js Zeilen 7-14:
const bruecke = (window.chrome && window.chrome.webview) || window.msbKanal;
try { delete window.chrome.webview; } catch (_) {}
try { delete window.msbKanal; } catch (_) {}
```
* **Unsichtbare Brücke:** Das Brückenobjekt wird direkt nach dem Erfassen aus dem globalen Kontext gelöscht. Webseiten können nicht erkennen, dass sie in einer eingebetteten Umgebung laufen.
* **Prototyp-Sicherung:** `seite.js` sichert native Funktionen (`Reflect.apply`, `Object.getOwnPropertyDescriptor`, `HTMLElement.prototype.getClientRects`, `checkVisibility`, `JSON.parse`), bevor Seitenskripte Prototypen manipulieren können.
* **Objekte ohne Prototyp:** Eingehende Nachrichten werden über einen Reviver mit `Object.setPrototypeOf(v, null)` geparst ([`seite.js:95`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/seite.js#L95)). Damit wird verhindert, dass fehlende Felder bösartige Getter auf `Object.prototype` triggern.

### B. DevTools Protocol statt `ExecuteScript` (`ohne_geste`)
In WebView2 simuliert ein reguläres `ExecuteScript` automatisch eine 5-sekündige Nutzeraktivierung (`hasBeenActive`). Bösartige Seiten konnten dies ausnutzen, um ohne Klick des Anwenders Popups zu öffnen, Audio abzuspielen oder in den Vollbildmodus zu wechseln.
* **Lösung:** In [`webview2.rs:408-423`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/webview2.rs#L408-L423) führt Pontis interne Skripte über das Chrome DevTools Protocol (`Runtime.evaluate`) mit `{ returnByValue: true, userGesture: false }` aus.

### C. Phishing-Schutz im Vollbildmodus
Um Webseiten daran zu hindern, die Taste `Escape` über `navigator.keyboard.lock()` abzufangen und gefälschte Browser-Adressleisten anzuzeigen, fängt [`webview2.rs:270-301`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop/webview2.rs#L270-L301) die Taste direkt auf Win32-Controller-Ebene (`add_AcceleratorKeyPressed`) ab. Dies beendet den Vollbildmodus zuverlässig am Seitencode vorbei.

---

## 7. Profile & Partitionierung

Pontis trennt Datenbereiche über isolierte WebView2-Profile ([`desktop.rs:248-295`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop.rs#L248-L295)):

| Profil-Typ | Profil-ID / Parameter | Persistenz | Isolation & Zweck |
|---|---|---|---|
| **Standard** | `seitenprofil` | Persistent | Reguläres Surfen (Cookies, Cache, LocalStorage). |
| **Workspaces** | `ws_{workspace_id}` | Persistent | Eigene Partition je Arbeitsbereich (z. B. getrennte Google- oder GitHub-Konten). |
| **InPrivate** | `SetIsInPrivateModeEnabled(true)` | Flüchtig (RAM) | Vollständige Isolation im RAM. Keine Festplattenspeicherung, kein Schlafabwurf. |
| **Seitenleisten-Panels** | `aussen_whatsapp`, `aussen_discord`, etc. | Persistent | Eigene Profile für Messenger-Web-Apps. Tracker dieser Dienste sehen normale Tabs nicht. |

* **User-Agent-Anpassung:** In [`desktop.rs:356-363, 395-403`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/desktop.rs#L395-L403) erhalten externe Panels einen Chrome-User-Agent, damit Web-Apps wie WhatsApp Web oder Discord reibungslos im Desktop-Chrome-Modus gerendert werden.

---

## 8. Download-Pipeline & Quarantäne-Sicherheit

Dateidownloads durchlaufen eine mehrstufige Sicherheitskette ([`quarantaene.rs`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/downloads/quarantaene.rs) und [`pruefung.rs`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/downloads/pruefung.rs)):

1. **Quarantäne-Speicherort:** Downloads landen zunächst in einem isolierten Pfad `app_local_data/quarantaene/<random_hash>/<name>.crdownload`. Vorab prüft Pontis den freien Speicherplatz mittels `GetDiskFreeSpaceExW`.
2. **Virenprüfung via Windows Attachment Execution Service:** Vor der Freigabe übergibt Pontis die Datei per Win32 COM an `IAttachmentExecute::Save` ([`pruefung.rs:37-57`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/downloads/pruefung.rs#L37-L57)). Microsoft Defender oder installierte Antivirenlösungen prüfen die Datei. Bei Schadcode schlägt `Save()` fehl und die Datei wird gelöscht.
3. **Mark of the Web (Zone.Identifier):** Die Zieldatei erhält einen NTFS Alternate Data Stream (`ZoneId=3` für Internet bzw. `ZoneId=4` für eingeschränkt).
4. **Schutz der Privatsphäre bei InPrivate:** Bei Downloads im InPrivate-Modus setzt [`pruefung.rs:20-34`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/downloads/pruefung.rs#L20-L34) als Herkunft die neutrale Adresse `about:internet`. Sensible Download-URLs landen dadurch nicht in den NTFS-Metadaten.
5. **Start-Bereinigung:** Bricht ein Download ab oder stürzt der Browser ab, löscht `quarantaene::beim_start()` temporäre Fragmente automatisch.

---

## 9. Chrome Web Store-Erweiterungen (CRX3) in reinem Rust

Pontis unterstützt Chrome Web Store-Erweiterungen unter Windows über eine eigene Rust-Implementierung ([`browser/src-tauri/src/erweiterungen/crx.rs`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/erweiterungen/crx.rs)):
* **Kryptographische Verifikation:** Validiert CRX3-Pakete mit der `ring`-Bibliothek gegen den offiziellen Google Web Store Publisher Key (`STORE_SCHLUESSEL`, [`crx.rs:18-21`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/erweiterungen/crx.rs#L18-L21)).
* **ZIP-Integritätsprüfung:** Erkennt ZIP-Endmarken im Header, um Manipulationsangriffe abzuwehren.
* **Schlüssel-Extraktion:** Extrahiert den `key` und trägt ihn ins Manifest ein, damit WebView2 dieselbe Erweiterungs-ID vergibt.
* **Registrierung:** Installiert die Erweiterung im nativen Profil über `ICoreWebView2Profile4::AddBrowserExtension`.

---

## 10. Lokale On-Device KI & Offline-Dienste

1. **Lokale Bergamot-Übersetzung:**
   * Quellcode: [`frontend/src/browser/uebersetzung/engine.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/browser/uebersetzung/engine.ts)
   * Portierung des Mozilla Bergamot-Projekts als WebAssembly in einem dedizierten Web Worker.
   * Lädt kompakte neuronale Übersetzungsmodelle lokal. Übersetzt Textknoten stückweise (maximal 100 Texte / 32 KiB) über `nodeValue` und Attribute ([`seite.js:370-461`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/seite.js#L370-L461)).
   * **XSS-Schutz:** Übersetzungen werden niemals über `innerHTML` eingefügt. Tags wie `<script>`, `<code>`, `<pre>`, `<svg>` werden komplett übersprungen. Kein Text verlässt das Endgerät.
2. **Lokales Whisper-Tiny für Sprachsuche:**
   * Quellcode: [`frontend/src/browser/services/lokalesWhisper.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/browser/services/lokalesWhisper.ts)
   * Nutzt `@huggingface/transformers` und ONNX Runtime Web (`onnx-community/whisper-tiny`, Q8 quantisiert, ~39 MB).
   * Hardwarebeschleunigte Inferenz primär über **WebGPU**, automatischer Fallback auf WebAssembly.
   * Optimiert durch Greedy Decoding (`num_beams: 1`), Token-Limit (`max_new_tokens: 48`) und VAD-Stille-Erkennung.
3. **Integrierte Privatsphäre-Suche:**
   * Quellcode: [`frontend/src/browser/services/searchEngines.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/browser/services/searchEngines.ts)
   * Keine Live-Vorschläge an Drittanbieter-Server beim Tippen in der Adressleiste.
   * Optionale Anbindung an den lokalen `searxng-sidecar`.

---

## 11. UI/UX, Design-DNA & Systemintegration

* **Interne Adressen (`pontis://`):**
  Seiten wie `pontis://einstellungen`, `pontis://suche`, `pontis://verlauf` oder `pontis://downloads` erzeugen keine native Webview, sondern werden als React-Komponenten in der Haupt-UI gerendert ([`Seitenflaeche.tsx:41-53`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/browser/seite/Seitenflaeche.tsx#L41-L53)). Rusts [`ziel_pruefen`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/tabs/weg.rs#L145-L151) unterbindet jeglichen externen Zugriff auf interne Schemata.
* **Splitscreen mit Snap-Assist:** Unterstützt horizontales und vertikales Teilen mit interaktivem Trenner und Windows Snap-Andocken per Drag & Drop ([`Seitenflaeche.tsx:168-200`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/browser/seite/Seitenflaeche.tsx#L168-L200)).
* **Windows 11 DWM-Optik (`fensteroptik`):**
  [`crates/fensteroptik/src/lib.rs`](file:///e:/Github-Projekte/maunting-server-manager/crates/fensteroptik/src/lib.rs) implementiert ein rahmenloses Fenster mit nativer DWM-Eckenrundung (`DWMWCP_ROUND`), Immersive Dark Mode und angepasster Rahmenfarbe (`0x0026_1A_1A`).
* **Windows-Lautstärkemixer-Integration (`mixer.rs`):**
  Standardmäßig meldet WebView2 Audio als „Microsoft Edge WebView2“. In [`browser/src-tauri/src/mixer.rs`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/mixer.rs) durchsucht Pontis Kindprozesse via Toolhelp32 und benennt die WASAPI-Audiositzung (`IAudioSessionControl2`) dynamisch in „Maunting Pontis“ mit eigenem Icon um.
* **Android-Implementierung:**
  * Native Android WebViews via [`TabsPlugin.kt`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/secure_browser/TabsPlugin.kt) und [`TabsBruecke.kt`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/secure_browser/TabsBruecke.kt).
  * JNI-Anbindung leitet Navigationen und Filteranfragen an dieselben Rust-Funktionen (`weg`, `vorab`, `schild::pruefen`).
  * Downloads aus Blobs und Data-URIs werden in 256-KiB-Stücken mit Quittungs-Backpressure an Android übergeben ([`seite.js:463-492`](file:///e:/Github-Projekte/maunting-server-manager/browser/src-tauri/src/seite.js#L463-L492)).

---

## 12. Gegenüberstellung: Warum Pontis so ist, wie es ist

| Design-Aspekt | Konventionelle Browser (Chrome / Edge / Brave) | Maunting Pontis | Rationale / Warum es so ist |
|---|---|---|---|
| **Laufzeit-Basis** | C++ Chromium-Monolith (> 150 MB Installer) | Tauri v2 + Rust + System-Webviews (< 30 MB) | Minimale Downloadgröße, native Systemintegration, automatische V8-Sicherheits-Patches über das Betriebssystem. |
| **Tab-Architektur** | Standard-Renderer mit IPC-Host-Anbindung | Strikte Trennung: Nur UI hat IPC-Rechte, Tabs haben 0 Rechte | Verhindert, dass fremde Webseiten über Sicherheitslücken in Host-APIs ausbrechen können. |
| **Airspace-Lösung** | Ein einzelner nativer Compositor | DOM-Intersection-Observer + Standbild-Pipeline (JPEG) | Ermöglicht moderne React-Menüs und Dialoge nahtlos über nativen Win32-Child-HWNDs ohne Z-Order-Konflikte. |
| **RAM-Verbrauch** | 1,5 – 3,5 GB bei 20–30 offenen Tabs | 600 – 1.000 MB durch zweistufigen Ruhemodus | Inaktive Tabs werden nach 30 Min eingefroren (`TrySuspend`), nach 60 Min physisch entladen (0 MB RAM). |
| **Werbeblocker** | WebExtensions (durch Manifest V3 beschränkt) | Brave `adblock` (v0.13) in Rust vor dem Socket | Blockiert Anfragen aus Dokument, Iframes und Workern mit synthetischen 403/204-Antworten vor dem Netzwerk-Stack. |
| **Telemetrie** | Synchronisation, Werbe-IDs, SmartScreen-Pings | 0 Byte Telemetrie, SmartScreen hart deaktiviert | Keine Übermittlung besuchter Adressen an Microsoft oder Werbenetzwerke. |
| **KI-Dienste** | Externe Cloud-APIs (Google Translate, Cloud Whisper) | On-Device Bergamot (WASM) & Whisper-Tiny (WebGPU) | Kein Text und kein Audiosignal verlässt das Endgerät. |
| **Audio-Präsenz** | Generischer Edge-Eintrag im Windows-Mixer | WASAPI Session Re-Branding in Rust (`mixer.rs`) | Echter Anwendungsname und Icon im Windows-Lautstärkemixer. |
