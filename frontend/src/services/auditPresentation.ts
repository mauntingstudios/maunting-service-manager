/**
 * Reine Hilfsfunktionen fuer die Audit-UI.
 *
 * Keine API-Calls, keine Secrets. Die Einordnung (Kategorie, Ergebnis) kommt
 * aus dem Backend; die Funktionen hier sind der Rueckfall fuer aeltere
 * Antworten und die gemeinsame Quelle fuer Beschriftung und Zeitformat.
 */

export type AuditKategorie =
  | 'server'
  | 'configuration'
  | 'user'
  | 'role'
  | 'team'
  | 'backup'
  | 'security'
  | 'ai'
  | 'docs'
  | 'billing'
  | 'system'

export type AuditErgebnis = 'success' | 'failed'

export interface AuditLogRow {
  id: number
  user_id: number | null
  username?: string | null
  action: string
  category?: AuditKategorie
  result?: AuditErgebnis
  target_type: string | null
  target_id: string | null
  target_label?: string | null
  origin: 'direct' | 'ai' | 'external' | 'system'
  correlation_id: string | null
  details: string | null
  created_at: string | null
}

export interface AuditSeite {
  items: AuditLogRow[]
  total: number
}

export interface AuditKennzahlen {
  total: number
  users: number
  security: number
  failed: number
}

export interface AuditUebersicht {
  range_days: number
  start: string
  end: string
  current: AuditKennzahlen
  previous: AuditKennzahlen
  by_category: { category: string; count: number }[]
  top_actions: { action: string; category: string; count: number }[]
}

export const AUDIT_KATEGORIEN: readonly AuditKategorie[] = [
  'server',
  'configuration',
  'user',
  'role',
  'team',
  'backup',
  'security',
  'ai',
  'docs',
  'billing',
  'system',
]

const SECRET_ASSIGN = /(password|passwd|token|secret|authorization)\s*[:=]\s*\S+/gi

/** Prueft, ob ein Text secret-aehnliche Fragmente enthaelt (Test/Anzeige-Schutz). */
export function containsSecretFragment(text: string | null | undefined): boolean {
  if (!text) return false
  return /(password|passwd|token|secret|authorization)\s*[:=]/i.test(text)
}

/** Reihenfolge wie im Backend: die erste passende Regel gewinnt. */
const KATEGORIE_REGELN: readonly {
  kategorie: AuditKategorie
  praefixe: readonly string[]
  ausschluesse?: readonly string[]
}[] = [
  { kategorie: 'backup', praefixe: ['server.backups.', 'panel.backup', 'backup.'] },
  {
    kategorie: 'security',
    praefixe: [
      'auth.',
      'credential.',
      'server.credential.',
      'vault.',
      'team.vault.',
      'guardian.',
      'nodes.token.',
      'nodes.enrollment.',
      'postgres.admin.',
      'panel.settings.',
      'panel.livekit.',
      'social.call.',
    ],
  },
  {
    kategorie: 'role',
    praefixe: [
      'roles.',
      'user.roles.',
      'team.role.',
      'team.member.roles.',
      'team.server.',
      'team.server_roles.',
    ],
  },
  { kategorie: 'user', praefixe: ['user.', 'users.'], ausschluesse: ['user.roles.'] },
  {
    kategorie: 'team',
    praefixe: ['team.'],
    ausschluesse: [
      'team.role.',
      'team.member.roles.',
      'team.server.',
      'team.server_roles.',
      'team.vault.',
    ],
  },
  { kategorie: 'ai', praefixe: ['ai.'] },
  { kategorie: 'docs', praefixe: ['docs.', 'document.'] },
  { kategorie: 'billing', praefixe: ['hoster.'] },
  {
    kategorie: 'configuration',
    praefixe: ['blueprints.', 'server.firewall', 'server.config', 'panel.popup'],
  },
  {
    kategorie: 'server',
    praefixe: ['server.'],
    ausschluesse: ['server.backups.', 'server.credential.', 'server.firewall', 'server.config'],
  },
]

export function auditKategorie(action: string | null | undefined): AuditKategorie {
  const text = (action ?? '').trim().toLowerCase()
  for (const regel of KATEGORIE_REGELN) {
    if (!regel.praefixe.some((praefix) => text.startsWith(praefix))) continue
    if (regel.ausschluesse?.some((ausschluss) => text.startsWith(ausschluss))) continue
    return regel.kategorie
  }
  return 'system'
}

export function auditErgebnis(action: string | null | undefined, details: string | null | undefined): AuditErgebnis {
  const text = (action ?? '').trim().toLowerCase()
  if (text.endsWith('.failed') || text.endsWith('.fehlgeschlagen')) return 'failed'
  if (!details) return 'success'
  try {
    const daten = JSON.parse(details) as unknown
    if (!daten || typeof daten !== 'object' || Array.isArray(daten)) return 'success'
    const objekt = daten as Record<string, unknown>
    if (objekt.error_code != null && objekt.error_code !== '') return 'failed'
    if (objekt.success === false) return 'failed'
    const status = String(objekt.status ?? '').trim().toLowerCase()
    if (status === 'failed' || status === 'error' || status === 'fehlgeschlagen') return 'failed'
  } catch {
    return 'success'
  }
  return 'success'
}

/** Formatiert Zieltyp + ID fuer die Tabelle (z. B. "server #12"). */
export function formatAuditTarget(row: Pick<AuditLogRow, 'target_type' | 'target_id'>): string {
  if (!row.target_type && row.target_id == null) return '—'
  if (row.target_type && row.target_id != null) return `${row.target_type} #${row.target_id}`
  if (row.target_type) return row.target_type
  return `#${row.target_id}`
}

/** Formatiert den Zeitstempel lesbar; leere/ungueltige Werte bleiben klar markiert. */
export function formatAuditTime(iso: string | null | undefined, locale = 'de-DE'): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function tagesschluessel(datum: Date): string {
  return `${datum.getFullYear()}-${datum.getMonth() + 1}-${datum.getDate()}`
}

/**
 * Kurzform fuer die Liste: „Heute, 21:08“, „Gestern, 09:14“ oder das Datum.
 * Verglichen wird der Kalendertag in Ortszeit, nicht ein 24-Stunden-Abstand —
 * sonst faellt der Vortag an der Zeitumstellung aus.
 */
export function formatAuditZeitKurz(
  iso: string | null | undefined,
  locale: string,
  labels: { heute: string; gestern: string },
  jetzt: Date = new Date(),
): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const zeit = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const gestern = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - 1)
  if (tagesschluessel(d) === tagesschluessel(jetzt)) return `${labels.heute}, ${zeit}`
  if (tagesschluessel(d) === tagesschluessel(gestern)) return `${labels.gestern}, ${zeit}`
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Mappt unbekannte API-Antworten auf typsichere Zeilen; ungueltige Eintraege werden verworfen. */
export function mapAuditApiRows(payload: unknown): AuditLogRow[] {
  if (!Array.isArray(payload)) return []
  const rows: AuditLogRow[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = Number(raw.id)
    if (!Number.isFinite(id)) continue
    const action = typeof raw.action === 'string' ? raw.action : ''
    if (!action) continue
    const details = typeof raw.details === 'string' ? raw.details : raw.details == null ? null : String(raw.details)
    const kategorie = AUDIT_KATEGORIEN.includes(raw.category as AuditKategorie)
      ? (raw.category as AuditKategorie)
      : auditKategorie(action)
    const ergebnis = raw.result === 'failed' || raw.result === 'success'
      ? raw.result
      : auditErgebnis(action, details)
    rows.push({
      id,
      user_id: raw.user_id == null ? null : Number(raw.user_id),
      username: typeof raw.username === 'string' ? raw.username : null,
      action,
      category: kategorie,
      result: ergebnis,
      target_type: typeof raw.target_type === 'string' ? raw.target_type : null,
      target_id: raw.target_id == null ? null : String(raw.target_id),
      target_label: typeof raw.target_label === 'string' ? raw.target_label : null,
      origin: raw.origin === 'ai' || raw.origin === 'external' || raw.origin === 'system'
        ? raw.origin
        : 'direct',
      correlation_id: typeof raw.correlation_id === 'string' ? raw.correlation_id : null,
      details,
      created_at: typeof raw.created_at === 'string' ? raw.created_at : null,
    })
  }
  return rows
}

/** Liest die paginierte Antwort; eine blosse Liste bleibt als eine Seite lesbar. */
export function mapAuditSeite(payload: unknown): AuditSeite {
  if (Array.isArray(payload)) {
    const items = mapAuditApiRows(payload)
    return { items, total: items.length }
  }
  if (!payload || typeof payload !== 'object') return { items: [], total: 0 }
  const raw = payload as Record<string, unknown>
  const items = mapAuditApiRows(raw.items)
  const total = Number(raw.total)
  return { items, total: Number.isFinite(total) ? Math.max(total, items.length) : items.length }
}

/** Kuerzt Details fuer die Tabelle und maskiert offensichtliche Secret-Fragmente. */
export function safeAuditDetails(details: string | null | undefined, maxLen = 160): string {
  if (!details) return '—'
  let text = details.replace(SECRET_ASSIGN, '$1=[redacted]')
  if (text.length > maxLen) text = `${text.slice(0, maxLen)}…`
  return text
}

export function parseAuditDetails(details: string | null | undefined): Record<string, unknown> | null {
  if (!details) return null
  try {
    const daten = JSON.parse(details) as unknown
    if (!daten || typeof daten !== 'object' || Array.isArray(daten)) return null
    return daten as Record<string, unknown>
  } catch {
    return null
  }
}

/** Die Vorgangsart steckt in den Details, nicht im Aktionsnamen. */
export function auditOperation(details: string | null | undefined): string | null {
  const daten = parseAuditDetails(details)
  const wert = daten?.operation
  return typeof wert === 'string' && wert.trim() ? wert.trim().toLowerCase() : null
}

type Uebersetzen = (key: string, options?: Record<string, unknown>) => string

/**
 * Beschriftet eine Aktion in der App-Sprache.
 *
 * Drei Stufen, in dieser Reihenfolge:
 * 1. ein bekannter Name fuer den konkreten Fall (`EXAKT`),
 * 2. Server-Lebenszyklus mit der Vorgangsart aus den Details,
 * 3. „Subjekt + Verb“ aus den Segmenten des Aktionsnamens.
 * Bleibt selbst das leer, steht der rohe Aktionsname da — ehrlicher als eine
 * erfundene Beschriftung.
 */
export function auditAktionText(
  t: Uebersetzen,
  action: string,
  details: string | null | undefined,
): string {
  const name = (action ?? '').trim()
  const exakt = EXAKT[name]
  if (exakt) return t(exakt)

  const lebenszyklus = /^server\.lifecycle\.(requested|completed|failed)$/.exec(name)
  if (lebenszyklus) {
    const phase = lebenszyklus[1]
    const operation = auditOperation(details)
    if (operation && OPERATIONEN.has(operation)) {
      return t(`audit.action.lifecycle.${phase}.${operation}`)
    }
    return t(`audit.action.phase.${phase}`)
  }

  const segments = name.split('.').filter(Boolean)
  const subjectKey = SUBJEKTE.find(([praefix]) => name.startsWith(praefix))?.[1]
  const verbKey = VERBEN[segments[segments.length - 1] ?? ''] ?? 'audit.verb.action'
  if (!subjectKey) return name
  return t('audit.action.generic', { subject: t(subjectKey), verb: t(verbKey) })
}

const OPERATIONEN = new Set(['start', 'stop', 'restart', 'kill'])

const EXAKT: Record<string, string> = {
  'server.deleted': 'audit.action.serverDeleted',
  'server.credential.bound': 'audit.action.credentialBound',
  'server.firewall_opened': 'audit.action.firewallOpened',
  'server.firewall_closed': 'audit.action.firewallClosed',
  'server.provision.requested': 'audit.action.provisionRequested',
  'server.provision.completed': 'audit.action.provisionCompleted',
  'server.provision.failed': 'audit.action.provisionFailed',
  'server.backups.create': 'audit.action.backupCreated',
  'server.backups.delete': 'audit.action.backupDeleted',
  'server.backups.restore': 'audit.action.backupRestored',
  'server.backups.settings.update': 'audit.action.backupSettingsChanged',
  'server.backups.upload_cloud': 'audit.action.backupUploaded',
  'roles.create': 'audit.action.roleCreated',
  'roles.update': 'audit.action.roleUpdated',
  'roles.delete': 'audit.action.roleDeleted',
  'user.roles.updated': 'audit.action.userRolesUpdated',
  'team.role.created': 'audit.action.teamRoleCreated',
  'team.role.updated': 'audit.action.teamRoleUpdated',
  'team.role.deleted': 'audit.action.teamRoleDeleted',
  'team.member.roles.set': 'audit.action.teamMemberRolesSet',
  'team.member.updated': 'audit.action.teamMemberUpdated',
  'team.member.removed': 'audit.action.teamMemberRemoved',
  'team.server.grants.set': 'audit.action.teamGrantsSet',
  'team.server_roles.set': 'audit.action.teamServerRolesSet',
  'team.vault.reset': 'audit.action.teamVaultReset',
  'team.vault.rotation.prepare': 'audit.action.teamVaultRotationPrepare',
  'team.vault.rotation.commit': 'audit.action.teamVaultRotationCommit',
  'team.vault.rotation.abort': 'audit.action.teamVaultRotationAbort',
  'team.vault.rotation.rollback': 'audit.action.teamVaultRotationRollback',
  'vault.reset': 'audit.action.vaultReset',
  'vault.role_quota.updated': 'audit.action.vaultQuotaUpdated',
  'vault.rotation.prepare': 'audit.action.vaultRotationPrepare',
  'vault.rotation.commit': 'audit.action.vaultRotationCommit',
  'vault.rotation.abort': 'audit.action.vaultRotationAbort',
  'vault.rotation.rollback': 'audit.action.vaultRotationRollback',
  'auth.password.change': 'audit.action.passwordChanged',
  'auth.username.change': 'audit.action.usernameChanged',
  'auth.data_export': 'audit.action.dataExported',
  'admin.user.2fa.disable': 'audit.action.adminDisable2fa',
  'credential.saved': 'audit.action.credentialSaved',
  'credential.deleted': 'audit.action.credentialDeleted',
  'credential.policy.updated': 'audit.action.credentialPolicyUpdated',
  'nodes.token.update': 'audit.action.nodeTokenUpdated',
  'nodes.enrollment.approve': 'audit.action.nodeEnrollmentApproved',
  'postgres.admin.rotate': 'audit.action.postgresAdminRotated',
  'panel.settings.update': 'audit.action.panelSettingsUpdated',
  'panel.settings.localhost.confirm': 'audit.action.localhostConfirmed',
  'panel.livekit.update': 'audit.action.livekitUpdated',
  'blueprints.import': 'audit.action.blueprintImported',
  'blueprints.delete': 'audit.action.blueprintDeleted',
  'auto_restart': 'audit.action.autoRestart',
  'disk_limit_stop': 'audit.action.diskLimitStop',
  'guardian.overrides.set': 'audit.action.guardianOverridesSet',
  'guardian.overrides.reset': 'audit.action.guardianOverridesReset',
  'guardian.quarantine.clear': 'audit.action.guardianQuarantineCleared',
  'docs.document.moved': 'audit.action.documentMoved',
  'social.call.kick': 'audit.action.callKicked',
  'social.call.mute': 'audit.action.callMuted',
  'social.call.unmute': 'audit.action.callUnmuted',
  'ai.action.rejected': 'audit.action.aiActionRejected',
  'ai.tool.read': 'audit.action.aiToolRead',
}

const SUBJEKTE: readonly [string, string][] = [
  ['server.backups', 'audit.subject.backups'],
  ['server.console', 'audit.subject.console'],
  ['server.logs', 'audit.subject.logs'],
  ['server.files', 'audit.subject.files'],
  ['server.lifecycle', 'audit.subject.server'],
  ['server.provision', 'audit.subject.server'],
  ['panel.settings', 'audit.subject.panelSettings'],
  ['panel.livekit', 'audit.subject.panel'],
  ['team.member', 'audit.subject.teamMember'],
  ['team.role', 'audit.subject.teamRole'],
  ['team.server', 'audit.subject.teamPermissions'],
  ['team.server_roles', 'audit.subject.teamPermissions'],
  ['team.vault', 'audit.subject.teamVault'],
  ['team', 'audit.subject.team'],
  ['vault.rotation', 'audit.subject.vaultRotation'],
  ['vault.role_quota', 'audit.subject.vaultQuota'],
  ['vault', 'audit.subject.vault'],
  ['credential.policy', 'audit.subject.credentialPolicy'],
  ['credential', 'audit.subject.credentials'],
  ['ai.memory_search', 'audit.subject.aiMemorySearch'],
  ['ai.memory', 'audit.subject.aiMemory'],
  ['ai.web_search', 'audit.subject.aiSearch'],
  ['ai.maptiler', 'audit.subject.aiMap'],
  ['ai.tomtom', 'audit.subject.aiMap'],
  ['ai.satellite', 'audit.subject.aiSatellite'],
  ['ai.desktop', 'audit.subject.aiDesktop'],
  ['ai.provider', 'audit.subject.aiProvider'],
  ['ai.worker', 'audit.subject.aiWorker'],
  ['ai.skill', 'audit.subject.aiSkill'],
  ['ai.action', 'audit.subject.aiAction'],
  ['ai.role_limits', 'audit.subject.aiLimits'],
  ['ai.cost', 'audit.subject.aiCost'],
  ['ai.context', 'audit.subject.aiContext'],
  ['ai.learning', 'audit.subject.aiLearning'],
  ['ai.guardian', 'audit.subject.guardian'],
  ['ai.attachment', 'audit.subject.aiAttachment'],
  ['ai.tool', 'audit.subject.aiTool'],
  ['ai', 'audit.subject.ai'],
  ['guardian.overrides', 'audit.subject.guardian'],
  ['guardian.quarantine', 'audit.subject.guardian'],
  ['guardian', 'audit.subject.guardian'],
  ['hoster.integration', 'audit.subject.hosterIntegration'],
  ['hoster.handoff', 'audit.subject.hosterHandoff'],
  ['hoster.product', 'audit.subject.hosterProduct'],
  ['hoster.sandbox', 'audit.subject.hosterSandbox'],
  ['hoster', 'audit.subject.hoster'],
  ['nodes.enrollment', 'audit.subject.nodes'],
  ['nodes.token', 'audit.subject.nodes'],
  ['nodes', 'audit.subject.nodes'],
  ['postgres.admin', 'audit.subject.postgres'],
  ['postgres', 'audit.subject.postgres'],
  ['docs.document', 'audit.subject.document'],
  ['docs', 'audit.subject.docs'],
  ['blueprints', 'audit.subject.blueprints'],
  ['roles', 'audit.subject.role'],
  ['user.roles', 'audit.subject.userRoles'],
  ['admin.user', 'audit.subject.user'],
  ['user', 'audit.subject.user'],
  ['auth', 'audit.subject.account'],
  ['server', 'audit.subject.server'],
  ['social.call', 'audit.subject.call'],
  ['panel', 'audit.subject.panel'],
]

const VERBEN: Record<string, string> = {
  create: 'audit.verb.created',
  created: 'audit.verb.created',
  update: 'audit.verb.updated',
  updated: 'audit.verb.updated',
  delete: 'audit.verb.deleted',
  deleted: 'audit.verb.deleted',
  remove: 'audit.verb.removed',
  removed: 'audit.verb.removed',
  invite: 'audit.verb.invited',
  invited: 'audit.verb.invited',
  join: 'audit.verb.joined',
  joined: 'audit.verb.joined',
  set: 'audit.verb.set',
  reset: 'audit.verb.reset',
  restore: 'audit.verb.restored',
  import: 'audit.verb.imported',
  imported: 'audit.verb.imported',
  export: 'audit.verb.exported',
  data_export: 'audit.verb.exported',
  upload_cloud: 'audit.verb.uploaded',
  save: 'audit.verb.saved',
  saved: 'audit.verb.saved',
  bind: 'audit.verb.bound',
  bound: 'audit.verb.bound',
  open: 'audit.verb.opened',
  opened: 'audit.verb.opened',
  close: 'audit.verb.closed',
  closed: 'audit.verb.closed',
  rotate: 'audit.verb.rotated',
  rotated: 'audit.verb.rotated',
  test: 'audit.verb.tested',
  tested: 'audit.verb.tested',
  disable: 'audit.verb.disabled',
  disabled: 'audit.verb.disabled',
  enable: 'audit.verb.enabled',
  enabled: 'audit.verb.enabled',
  toggle: 'audit.verb.toggled',
  toggled: 'audit.verb.toggled',
  clear: 'audit.verb.cleared',
  cleared: 'audit.verb.cleared',
  reject: 'audit.verb.rejected',
  rejected: 'audit.verb.rejected',
  approve: 'audit.verb.approved',
  approved: 'audit.verb.approved',
  confirm: 'audit.verb.confirmed',
  confirmed: 'audit.verb.confirmed',
  execute: 'audit.verb.executed',
  executed: 'audit.verb.executed',
  propose: 'audit.verb.proposed',
  proposed: 'audit.verb.proposed',
  prepare: 'audit.verb.prepared',
  commit: 'audit.verb.committed',
  abort: 'audit.verb.aborted',
  rollback: 'audit.verb.rolledBack',
  kick: 'audit.verb.kicked',
  mute: 'audit.verb.muted',
  unmute: 'audit.verb.unmuted',
  read: 'audit.verb.read',
  moved: 'audit.verb.moved',
  evaluated: 'audit.verb.evaluated',
  accepted: 'audit.verb.accepted',
  simulated: 'audit.verb.simulated',
  cleaned: 'audit.verb.cleaned',
  redeemed: 'audit.verb.redeemed',
  requested: 'audit.verb.requested',
  completed: 'audit.verb.completed',
  failed: 'audit.verb.failed',
  forgotten: 'audit.verb.deleted',
}
