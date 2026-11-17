# Kritische Daten, Invarianten und Architekturgrenzen

Unverändert verschoben aus `AGENTS.md` (§4 + §5) am 17.11.2026. Diese Datei ist verbindlich; je nach Kontext PFLICHTlektüre (Routing in `AGENTS.md`, Index: `docs/agent-rules/README.md`).

4. Kritische Daten und Invarianten

Immer kritisch:

SSH-Keys, API-Tokens, Webhook-Secrets, Datenbank-Credentials der Server.

Admin-Sessions und Rollenzuweisungen.

Ausgeführte Remote-Befehle und deren Output (kann sensible Daten enthalten).

Regeln:

Kritische Daten niemals loggen, in URLs schreiben, in Toasts zeigen oder in Analytics senden.

Nach einem Logout muss der gesamte lokale Authentifizierungs- und Server-State aus dem Speicher gelöscht sein.

Fehlermeldungen von Servern (z. B. bei fehlerhaften SSH-Logins) dürfen im Frontend keine internen Pfade oder Stacktraces des Zielservers leaken.

Harte Invarianten:

Keine Ausführung von Remote-Befehlen ohne vorherige Autorisierungsprüfung im Backend.

Das Frontend darf niemals blind entscheiden, ob ein User Root-Rechte auf einem Server hat – die Wahrheit liegt allein im Backend.

5. Architekturgrenzen

Schichten:

UI-Komponenten: Anzeige, Nutzerinteraktion, einfache UI-Zustände (z. B. Lade-Spinner).

Hooks: UI-nahe Orchestrierung, Lifecycle, Polling von Server-States.

Contexts/Stores: Öffentliche Fassade und State-Gateway für Server-Listen, keine Fachlogik-Monolithen.

Services: Fachliche Operationen, API-Aufrufe, Token-Management.

Tests: Invarianten, Regressionen, Runtime-kritische Pfade.

Store/Context-Regel:

Das globale Server-State-Management bleibt eine reine Fassade zur Datenhaltung.

Verbindungsaufbau, Befehlsausführung und Key-Management gehören in isolierte Services oder fokussierte Hooks.

Keine doppelten Importpfade für dieselbe Core-Datei.
