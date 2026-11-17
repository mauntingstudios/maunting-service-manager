# Agenten-Regeln: Index (Pflichtlektüre-Routing)

Diese Datei ist der Index zu `AGENTS.md`. Alle Dateien in diesem Verzeichnis sind verbindlich. Welche Datei zu lesen ist, bestimmt der Kontext der Aufgabe – siehe Routing-Tabelle unten (identisch mit dem PFLICHT-ROUTING in `AGENTS.md`).

Regel: Erst die passende Datei VOLLSTÄNDIG lesen, dann arbeiten. Kein „kenne ich schon", keine Ausnahme.

## Routing: Welcher Kontext → welche Datei

| Kontext | Pflichtlektüre |
|---|---|
| Code schreiben oder ändern | `code-qualitaet.md`, `examples.md` |
| Architektur, Refactoring, Schichten | `architecture.md` |
| Sicherheit, Auth, Vault, Secrets, Backend | `security.md`, `daten-und-architektur.md` |
| Tests, Runtime-Prüfung | `testing-runtime.md` |
| Neue oder aktualisierte Dependency | `dependencies.md` |
| Sichtbare Texte, UI-Texte, Doku | `text-und-sprache.md` |
| Android-Build, APK, Tauri mobil | `android-build-notizen.md` |
| Bekannte Fehlermuster (Abschnitt 0) | Lektionen in `AGENTS.md` + `lektionen-*.md` (Liste unten) |

## Dateien im Überblick

Kernregeln (Pflichtlektüre je nach Kontext):

- `code-qualitaet.md` – Guter/schlechter Code mit Beispielen (aus `AGENTS.md` §6). Lesen bei JEDER Code-Änderung.
- `daten-und-architektur.md` – Kritische Daten, Invarianten, Architekturgrenzen (aus `AGENTS.md` §4 + §5). Lesen bei Backend-, Security- und Architektur-Arbeit.
- `text-und-sprache.md` – Natürlichkeit, KI-Stil, Textintegrität (aus `AGENTS.md` §11, HS-Erweiterung). Lesen bei JEDER Arbeit an sichtbaren Texten.
- `android-build-notizen.md` – Tauri-Android-Stolperfallen (ehemaliger Anhang aus `AGENTS.md`). Lesen bei Android-Build/APK-Arbeit.
- `security.md` – Security-Modell, Secrets, Krypto. Lesen bei Auth, Vault, Keys, Storage, Sync, Logging, produktionsnahen Daten.
- `architecture.md` – Schichten, Verantwortlichkeiten, Refactoring. Lesen bei UI-Struktur, Hooks, Services, Routing, Modularchitektur.
- `dependencies.md` – Supply-Chain, Dependency-Prüfung, ADR-Pflicht. Lesen bei neuen/aktualisierten Libraries und Build-Tooling.
- `testing-runtime.md` – Testpflicht, Runtime-Prüfung. Lesen bei Tests und Runtime-Pfaden.
- `examples.md` – Code-Beispiele gut/schlecht. Lesen bei Codequalität und Refactoring.

Architektur-Entscheidungen (lesen, wenn das Thema betroffen ist):

- `adr-0007-oauth-without-authlib.md` – OAuth/OIDC ohne `authlib` (Accepted).
- `adr-0008-msdis-shield.md` – `@msdis/shield`-Bewertung und Exit-Strategie (Accepted).
- `adr-0009-webauthn-ohne-bibliothek.md` – WebAuthn-Prüfung ohne `webauthn`-Lib (Accepted).
- `adr-0010-browser-isolation-und-vibecoding-qualitaet.md` – Browser-Webview-Isolation, Vibecoding-Standards (Accepted).
- `adr-0011-team-serverrechte-rollenmodus.md` – Serverrechte im Team: Rollenmodus oder Freigabe (Draft).

## Lektionen-Archiv (Abschnitt 0 aus `AGENTS.md`)

Die Lektionen 1–236 stehen unverändert und mit stabilen Nummern in diesen Dateien. Verweise wie „AGENTS.md Punkt N" in Code und Tests meinen die Lektion mit derselben Nummer hier. Die neuesten Lektionen (ab Nr. 237) stehen direkt in `AGENTS.md`, Abschnitt 0. Neue Lektionen gehören dorthin, nie ins Archiv.

- `lektionen-001-050.md` – Lektionen 1–50 (u. a. Design-DNA, Auth/Token/2FA, DB/Migrationen, DIS-Verschlüsselung, Release-Sync, WebPush, Kalender).
- `lektionen-051-100.md` – Lektionen 51–100 (u. a. Passkeys, CORS/Antwortköpfe, SQL-DDL, Refresh-Rotation, Tresor-Sync/Cache, Datei-Uploads, Android/IPC).
- `lektionen-101-150.md` – Lektionen 101–150 (u. a. A11y/i18n, Kamera-Sicherung vertieft, DB-Nullable/Indexe, MSB-Browser: Tabs, WebView2, Schild, Jugendschutz, Downloads).
- `lektionen-151-191.md` – Lektionen 151–191 (u. a. MSB-Vertiefung, Velopack-Updates, Suche, Messenger-Outbox/Transport, Dev-CORS/Logging; erste Nr. 191: Dokumentbilder).
- `lektionen-191-236.md` – Lektionen 191–236 (zweite Nr. 191: Kennungsräume; u. a. Messenger-Transport, Gruppen, Präsenz, Sandbox/Git, Krypto-Fassade, Blueprints).

Hinweis: Die Nummer 191 existiert zweimal (einmal „Dokumentbilder", einmal „Kennungsräume") – so aus `AGENTS.md` übernommen, nichts umnummeriert.

## Fortschreibung

- Neue Lektionen: immer ans Ende von Abschnitt 0 in `AGENTS.md` (Marker beachten), nie ins Archiv.
- Neue oder geänderte Regeln: als eigene Datei hierher, in `AGENTS.md` nur Routing + Verweis ergänzen.
- Archivierung: mehr als etwa 30 Lektionen in `AGENTS.md` → älteste unverändert in neue `lektionen-<von>-<bis>.md` verschieben, Nummern stabil halten, Verweise aktualisieren.
