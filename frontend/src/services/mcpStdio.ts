/**
 * Lokale MCP-Programme (stdio) — nur in der Desktop-App.
 *
 * Das Panel spricht MCP ausschließlich über HTTPS. Ein Programm, das auf dem
 * Rechner des Benutzers läuft, kann nur dort gestartet werden; die
 * Desktop-App hat dafür den Befehl `mcp_stdio` (Rust, ohne Shell, mit Frist).
 * Die Werkzeugliste reicht sie anschließend an das Panel weiter, damit sie
 * wie die eines entfernten Servers angezeigt wird.
 */

import type { AiMcpWerkzeugMeldung } from '@/api/ai'

const HOECHSTENS_WERKZEUGE = 128
const HOECHSTENS_SCHEMA = 64 * 1024

interface StdioAntwort {
  antworten: Array<Record<string, unknown>>
}

export function stdioVerfuegbar(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) &&
    !(typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent))
  )
}

async function sitzung(
  command: string,
  args: string[],
  nachrichten: unknown[],
  env?: Record<string, string>,
): Promise<StdioAntwort> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<StdioAntwort>('mcp_stdio', {
    anfrage: { command, args, ...(env ? { env } : {}), nachrichten, frist_ms: 30_000 },
  })
}

function werkzeugAus(eintrag: unknown): AiMcpWerkzeugMeldung | null {
  if (typeof eintrag !== 'object' || eintrag === null) return null
  const roh = eintrag as Record<string, unknown>
  const name = typeof roh.name === 'string' ? roh.name.trim() : ''
  if (!name || name.length > 128) return null
  const schema =
    typeof roh.inputSchema === 'object' && roh.inputSchema !== null
      ? (roh.inputSchema as Record<string, unknown>)
      : { type: 'object', properties: {} }
  if (JSON.stringify(schema).length > HOECHSTENS_SCHEMA) return null
  const annotationen =
    typeof roh.annotations === 'object' && roh.annotations !== null
      ? (roh.annotations as Record<string, unknown>)
      : {}
  return {
    name,
    beschreibung: typeof roh.description === 'string' ? roh.description.slice(0, 2000) : '',
    nur_lesen: annotationen.readOnlyHint === true,
    schema,
  }
}

/** Startet das Programm einmal und liest seine Werkzeugliste. */
export async function entdeckeStdioWerkzeuge(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<AiMcpWerkzeugMeldung[]> {
  const { antworten } = await sitzung(
    command,
    args,
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'Maunting Service Manager', version: '1' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ],
    env,
  )
  const listeAntwort = antworten.find((eintrag) => eintrag.id === 2)
  const ergebnis = listeAntwort?.result
  const liste =
    typeof ergebnis === 'object' && ergebnis !== null
      ? (ergebnis as Record<string, unknown>).tools
      : null
  if (!Array.isArray(liste)) {
    throw new Error('Der MCP-Prozess hat keine Werkzeugliste geliefert.')
  }
  return liste
    .slice(0, HOECHSTENS_WERKZEUGE)
    .map(werkzeugAus)
    .filter((eintrag): eintrag is AiMcpWerkzeugMeldung => eintrag !== null)
}

/** Führt ein einzelnes Werkzeug eines lokalen `stdio`-MCP-Programms aus. */
export async function rufeStdioWerkzeug(
  command: string,
  args: string[],
  tool: string,
  toolArgs: Record<string, unknown>,
  env?: Record<string, string>,
): Promise<{ content: string; isError: boolean }> {
  const { antworten } = await sitzung(
    command,
    args,
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'Maunting Service Manager', version: '1' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: toolArgs } },
    ],
    env,
  )
  const antwort = antworten.find((eintrag) => eintrag.id === 2)
  if (!antwort) {
    throw new Error('Der MCP-Prozess hat keine Werkzeugantwort geliefert.')
  }
  if (typeof antwort.error === 'object' && antwort.error !== null) {
    const msg = (antwort.error as Record<string, unknown>).message
    throw new Error(typeof msg === 'string' && msg ? msg : 'MCP-Werkzeugaufruf fehlgeschlagen.')
  }
  const ergebnis =
    typeof antwort.result === 'object' && antwort.result !== null
      ? (antwort.result as Record<string, unknown>)
      : {}
  const contentList = Array.isArray(ergebnis.content) ? ergebnis.content : []
  const teile: string[] = []
  for (const eintrag of contentList) {
    if (typeof eintrag === 'object' && eintrag !== null) {
      const obj = eintrag as Record<string, unknown>
      if (obj.type === 'text' && typeof obj.text === 'string') {
        teile.push(obj.text)
      }
    }
  }
  return {
    content: teile.join('\n').slice(0, 16_000),
    isError: Boolean(ergebnis.isError),
  }
}
