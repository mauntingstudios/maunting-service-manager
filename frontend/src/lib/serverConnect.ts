import type { Server } from '@/types'
import { portRoleBase } from '@/utils/portRoles'

export interface ServerEndpoint {
  role: string
  baseRole: string
  port: number
  protocol: string
  address: string | null
}

export interface ResolvedServerConnect {
  host: string | null
  primary: ServerEndpoint | null
  endpoints: ServerEndpoint[]
  hasMultipleUserPorts: boolean
}

const ROLE_PRIORITY: Record<string, number> = {
  database: 0,
  web: 1,
  game: 2,
  voice: 3,
  query: 4,
  peer: 5,
  custom: 6,
  rcon: 99,
}

export function normalizeConnectHost(rawIp: string | null | undefined): string | null {
  const trimmed = rawIp?.trim()
  if (!trimmed || trimmed === '0.0.0.0' || trimmed === '::') {
    return null
  }
  return trimmed
}

export function formatHostPort(host: string | null, port: number): string | null {
  if (!host) return null
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]:${port}`
  }
  return `${host}:${port}`
}

function getRolePriority(role: string): number {
  const base = portRoleBase(role.toLowerCase())
  return ROLE_PRIORITY[base] ?? 50
}

const PORT_ROLE_I18N_KEYS: Record<string, string> = {
  database: 'serverDetail.portRoles.database',
  web: 'serverDetail.portRoles.web',
  game: 'serverDetail.portRoles.game',
  voice: 'serverDetail.portRoles.voice',
  query: 'serverDetail.portRoles.query',
  peer: 'serverDetail.portRoles.peer',
  rcon: 'serverDetail.portRoles.rcon',
  custom: 'serverDetail.portRoles.custom',
}

/**
 * Liefert eine einheitliche Bezeichnung für eine Port-Rolle (z. B. game_2 -> Game-Port).
 */
export function formatPortRoleLabel(
  role: string,
  translate: (key: string, options?: { defaultValue?: string }) => string,
): string {
  const base = portRoleBase(role.toLowerCase())
  const i18nKey = PORT_ROLE_I18N_KEYS[base]
  if (i18nKey) {
    const resolved = translate(i18nKey)
    if (resolved !== i18nKey) return resolved
  }
  return role.replace(/_/g, ' ').toUpperCase()
}

/**
 * Formatiert eine Speichergröße in Megabyte kompakt als MB oder GB.
 */
export function formatMb(mb: number | null | undefined): string {
  if (mb == null) return '-'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

/**
 * Einheitliche Status-Farbklassen für Server-Pills across Dashboard, Liste und Detail.
 */
export function serverStatusClasses(status: string | undefined): string {
  switch (status) {
    case 'running':
      return 'bg-status-success/10 border-status-success/30 text-status-success'
    case 'stopped':
      return 'bg-surface-container-highest border-outline text-on-surface-variant'
    case 'starting':
    case 'stopping':
    case 'restarting':
    case 'queued':
    case 'installing':
    case 'updating':
    case 'awaiting_files':
      return 'bg-status-warning/10 border-status-warning/30 text-status-warning'
    default:
      return 'bg-status-destructive/10 border-status-destructive/30 text-status-destructive'
  }
}

/**
 * Löst aus den Server-Ports die primäre Verbindungsadresse und alle weiteren Ports auf.
 * Admin-Ports (RCON) werden nie als primärer Spieler-/Client-Endpunkt gewählt, solange
 * ein nutzerseitiger Port (database, web, game, voice, query, peer, custom) vorhanden ist.
 */
export function resolveServerConnect(
  server: Pick<Server, 'public_bind_ip' | 'ports' | 'game_port' | 'query_port' | 'rcon_port'>,
): ResolvedServerConnect {
  const host = normalizeConnectHost(server.public_bind_ip)
  const rawPorts: Array<{ role: string; port: number; protocol: string }> = []
  const seen = new Set<string>()

  const pushPort = (role: string, port: number | null | undefined, protocol: string) => {
    if (typeof port !== 'number' || !Number.isFinite(port) || port <= 0) return
    const normalizedRole = role.trim().toLowerCase() || 'custom'
    const normalizedProtocol = protocol.trim().toLowerCase() || 'tcp'
    const key = `${normalizedRole}:${port}:${normalizedProtocol}`
    if (seen.has(key)) return
    seen.add(key)
    rawPorts.push({ role: normalizedRole, port, protocol: normalizedProtocol })
  }

  if (Array.isArray(server.ports) && server.ports.length > 0) {
    for (const entry of server.ports) {
      pushPort(entry.role, entry.port, entry.protocol)
    }
  } else {
    pushPort('game', server.game_port, 'udp')
    pushPort('query', server.query_port, 'udp')
    pushPort('rcon', server.rcon_port, 'tcp')
  }

  rawPorts.sort((a, b) => {
    const prioDiff = getRolePriority(a.role) - getRolePriority(b.role)
    if (prioDiff !== 0) return prioDiff
    return a.port - b.port
  })

  const endpoints: ServerEndpoint[] = rawPorts.map((entry) => ({
    ...entry,
    baseRole: portRoleBase(entry.role),
    address: formatHostPort(host, entry.port),
  }))

  const primary = endpoints[0] ?? null
  const userFacingCount = endpoints.filter((entry) => entry.baseRole !== 'rcon').length

  return {
    host,
    primary,
    endpoints,
    hasMultipleUserPorts: userFacingCount > 1,
  }
}
