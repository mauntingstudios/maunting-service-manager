# Guter, schlechter und wartbarer Code

Unverändert verschoben aus `AGENTS.md` (§6) am 17.11.2026. Diese Datei ist verbindlich; je nach Kontext PFLICHTlektüre (Routing in `AGENTS.md`, Index: `docs/agent-rules/README.md`).

6. Guter, schlechter und wartbarer Code

Guter Code ist einfach. Schlechter Code ist in diesem Projekt ein Sicherheitsrisiko, nicht nur ein Stilproblem.

Schlechter Code hat unklare Verantwortlichkeiten, falschen Scope, lokale Security-Policies im UI-Code, unnötige Abstraktion, versteckte Seiteneffekte, any, unklare Namen, fehlende Tests, schwache Fehlerbehandlung oder Logs mit sensiblen Details.

Guter und wartbarer Code hat klare Verantwortlichkeit, passenden Scope, explizite Datenflüsse, starke Typen, kleine gut benannte Einheiten, sichere Defaults, minimale öffentliche APIs und einfache Kontrollflüsse.

Schlecht: Lokale UI-Policy statt zentraler Berechtigungsregel

function ServerRebootButton({ server }: { server: Server }) {
  // SCHLECHT: Policy wird im UI-Code erfunden und ignoriert Server-Locks/Maintenance-Modes
  const canReboot = server.status === "online" && server.userRole === "admin";

  return <button disabled={!canReboot}>Reboot Server</button>;
}


Warum schlecht: Versteckt die Berechtigungs-Logik in der UI, ignoriert mögliche Wartungsmodi (Maintenance) und verleitet dazu, diese Prüfung in anderen Komponenten abweichend zu implementieren.

Gut: Zentrale, testbare Policy

export function canExecuteDestructiveCommand(server: Server, userRole: Role): boolean {
  return server.status === "online"
      && !server.isMaintenanceMode
      && userRole === "admin";
}


Warum gut: Zentrale Entscheidung, einfach testbar, einheitliche Logik für das gesamte Frontend.

Schlecht: Quickfix mit implizitem Zustand und fehlender Fehlerbehandlung

export let currentSelectedServerId: string | null = null;

export async function executeTerminalCommand(cmd: any) {
  // SCHLECHT: Globaler State, any, keine Fehlerbehandlung
  if (!currentSelectedServerId) return;

  console.log("Executing command: ", cmd.script); // SCHLECHT: Leakt potenziell sensible Scripts

  await fetch(`/api/servers/${currentSelectedServerId}/exec`, {
    method: "POST",
    body: JSON.stringify(cmd)
  });
  return true;
}


Warum schlecht: Globaler veränderbarer State führt zu Race-Conditions (Befehl geht an falschen Server), any zerstört Typensicherheit, fehlschlagende Commands werden stillschweigend ignoriert, sensible Befehle landen in den Browser-Logs.

Gut: Typisierter Flow ohne globalen State

export async function executeTerminalCommand(
  serverId: string,
  input: CommandInput
): Promise<CommandResult> {
  // GUT: Eindeutige ID wird übergeben, Typisierung, Error-Handling
  try {
    const response = await apiClient.post(`/api/servers/${serverId}/exec`, input);
    return { ok: true, output: response.data };
  } catch (error) {
    return { ok: false, reason: "COMMAND_FAILED", details: error.message };
  }
}


Warum gut: Kein globaler State, klare Übergabeparameter, sauberes Fehler-Handling und das Ergebnis ist verlässlich typisiert.
