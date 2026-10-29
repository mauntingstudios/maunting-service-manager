# ADR-0008: @msdis/shield Dependency-Bewertung und Exit-Strategie

Status: Accepted
Date: 2026-07-04

## Context
Für die sichere Verschlüsselung von Server-Credentials, Passwörtern, OAuth-Secrets und E-Mails führen wir das dezentrale Sicherheitsmodell DIS (Decentralized Identity & Security) ein. Die serverseitigen kryptographischen Operationen laufen im isolierten `dis-sidecar` (Node.js); das Frontend nutzt `@msdis/shield` direkt für die Zero-Knowledge-Tresor- und Messenger-Krypto.

## Entscheidung
Wir nutzen `@msdis/shield` in Version `0.4.0` (exakt gepinnt in `frontend/package.json`, `dis-sidecar/package.json` und `recovery/package.json`, gelockt über die jeweiligen `package-lock.json`).

## Security-Bewertung
- **Einstufung**: Hohes Risiko. Die Bibliothek verarbeitet Plaintext-Secrets (Passwörter, API-Keys, TOTP-Secrets) und führt sensible Krypto-Operationen (AES-256-GCM, Argon2id, TOTP) aus.
- **Zweck**: Bietet standardisierte, auditierte und performante Implementierung der DIS-Spezifikation (Verschlüsselung mit AAD-Bindung, robustes Passwort-Hashing und TOTP-Generierung/Validierung).
- **Notwendigkeit**: Eigene Implementierung von AES-256-GCM, Argon2id und TOTP in Node.js von Hand zu schreiben ist fehleranfällig und erhöht das Sicherheitsrisiko (KISS-Prinzip bzgl. kryptographischer Standards).
- **Maintainer & Advisories**: Aktiv gepflegt. Dependabot und `npm audit` beobachten die Version; der DIS-Audit vom 29.10.2026 hat Manifest-Authentifizierung, Präfix-Bindung, `randomInt`, PQ-Cleanup und ECDSA-Low-S adressiert.
- **Transitive Fläche**: Gering (`hash-wasm`, `otpauth`; `@noble/post-quantum` als optionales Peer).

## Nutzung im Projekt
- **Frontend**: `@msdis/shield` kommt aus der npm-Registry (kein vendorter Ordner). Tresor, Dateien, Messenger und Signaturen nutzen die veröffentlichten Subpath-Exports.
- **Sidecar**: Die Library wird im `dis-sidecar/server.mjs` geladen; die Python-Anwendung hat keinen direkten Zugriff und kommuniziert nur via REST-HTTP-Calls über die Kapselklasse `DisClient` (in `backend/services/dis_client.py`).
- **Tests**: Backend-Integrationstests (`backend/tests/`) decken die Ver- und Entschlüsselung inklusive AAD-Kontextprüfung ab; die Frontend- und Recovery-Suiten prüfen die Client-Pfade.
- **Install-Reproduzierbarkeit**: `install.sh` nutzt `npm ci --omit=dev` für den Sidecar und `npm install` plus Lockfile für das Frontend.

## Exit-Plan
Falls `@msdis/shield` kompromittiert, unmaintained oder ersetzt werden muss:
1. Da das API-Gateway des Sidecars (`/encrypt`, `/decrypt`, `/hash-password`, etc.) standardisierte HTTP-Endpunkte anbietet, kann die interne Implementierung des Sidecars vollständig ausgetauschen werden.
2. Der Python-Code bleibt unberührt, da er nur an der REST-Schnittstelle des Sidecars hängt.
3. Die Library kann durch direkten Aufruf von Node.js-eigenen `crypto`-APIs oder eine alternative DIS-Implementierung ersetzt werden, ohne das Backend anpassen zu müssen.
