import { api } from '../client'
import {
  memoryFilter,
  memoryScopeQuery,
  type AiMemoryEntry,
  type AiMemoryFassung,
  type AiMemoryFilter,
  type AiMemoryImportItem,
  type AiMemoryImportPreview,
  type AiMemoryImportResult,
  type AiMemoryImportTarget,
  type AiMemoryPage,
  type AiMemoryPreference,
  type AiMemoryThema,
  type AiSkillManaged,
  type AiSkillSummary,
} from './memoryTypes'

export const memoryApi = {
  /**
   * Ein ganzer Bereich auf einmal. Die Oberfläche liest so nicht mehr — sie
   * nimmt `listScopeMemory`, seit ein Teambereich 5.000 Einträge fassen darf
   * und jede Zeile beim Öffnen eine Entschlüsselung kostet.
   */
  listMemory: (scope: AiMemoryEntry['scope'], serverId?: number, teamId?: number) => api<AiMemoryEntry[]>(
    `/ai/memory?${memoryScopeQuery(scope, serverId, teamId)}`,
  ),
  /**
   * Eine Seite eines Bereichs: Teamwissen, panelweites Wissen, das Wissen einer
   * Anlage.
   *
   * Gebraucht wird das Blättern heute nur vom Team — es hängt am Rollenlimit
   * seines Gründers und darf 5.000 Einträge fassen, während Panel und Anlage
   * bei hundert fest gedeckelt sind. Trotzdem gehen alle drei denselben Weg:
   * eine Ansicht mit zwei Leseroutinen ist eine Gelegenheit, sie auseinander
   * laufen zu lassen. Wo es nichts zu blättern gibt, meldet der Server eine
   * Seite und die Leiste bleibt weg.
   */
  listScopeMemory: (
    scope: AiMemoryEntry['scope'], serverId?: number, teamId?: number, offset = 0,
    filter: AiMemoryFilter = {},
  ) => api<AiMemoryPage>(
    `/ai/memory/page?${memoryScopeQuery(scope, serverId, teamId)}&offset=${offset}${memoryFilter(filter)}`,
  ),
  /**
   * Eine Seite von allem, was einem selbst gehört: persönlich **und**
   * serverbezogen.
   *
   * Ein eigener Aufruf neben `listScopeMemory` und nicht dessen Sonderfall:
   * diesen Bereich gibt es als Kennung nicht. Er spannt zwei (`user` und
   * `server`) und geht deshalb über den Besitzer — `listMemory('server', …)`
   * verlangt dagegen eine konkrete Server-ID, und wer alle seine Notizen sehen
   * wollte, hätte die Server raten müssen.
   *
   * Übergeben wird nur der Offset. Wie groß eine Seite ist, entscheidet der
   * Server und sagt es in `limit` — er bezahlt sie in Entschlüsselungen, und
   * eine Grenze, die der Client setzen darf, ist keine.
   */
  listPersonalMemory: (offset = 0, filter: AiMemoryFilter = {}) => api<AiMemoryPage>(
    `/ai/memory/personal?offset=${offset}${memoryFilter(filter)}`,
  ),
  /** Die Themen der eigenen Erinnerungen, allgemein und zu Servern. */
  listPersonalTopics: () => api<AiMemoryThema[]>('/ai/memory/personal/themen'),
  listScopeTopics: (scope: AiMemoryEntry['scope'], serverId?: number, teamId?: number) =>
    api<AiMemoryThema[]>(`/ai/memory/themen?${memoryScopeQuery(scope, serverId, teamId)}`),
  /** Legt eine Erinnerung an; das Kontingent des Bereichs gilt (409, wenn voll). */
  createMemory: (payload: {
    scope: AiMemoryEntry['scope']; server_id?: number; team_id?: number
    text: string; titel?: string | null; thema?: string | null
  }) => api<AiMemoryEntry>('/ai/memory', { method: 'POST', body: JSON.stringify(payload) }),
  /**
   * Ändert Text, Titel oder Thema. Was nicht im Aufruf steht, bleibt; `null`
   * bei Titel oder Thema entfernt es. Der Stand davor bleibt als Fassung.
   */
  updateMemory: (id: string, payload: {
    text?: string; titel?: string | null; thema?: string | null; fassung: number
  }) => api<AiMemoryEntry>(`/ai/memory/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  /** Eine Erinnerung, wie sie jetzt steht — nach einem 409 beim Speichern. */
  getMemory: (id: string) => api<AiMemoryEntry>(`/ai/memory/${id}`),
  /** Holt eine vergessene Erinnerung zurück; sie zählt dann wieder mit. */
  restoreMemory: (id: string) => api<AiMemoryEntry>(`/ai/memory/${id}/zurueckholen`, { method: 'POST' }),
  /** Heftet an oder löst — ohne neue Fassung, darum ohne `fassung`. */
  pinMemory: (id: string, angeheftet: boolean) => api<AiMemoryEntry>(
    `/ai/memory/${id}/anheften`, { method: 'POST', body: JSON.stringify({ angeheftet }) },
  ),
  listMemoryVersions: (id: string) => api<AiMemoryFassung[]>(`/ai/memory/${id}/fassungen`),
  restoreMemoryVersion: (id: string, fassungId: string, fassung: number) => api<AiMemoryEntry>(
    `/ai/memory/${id}/fassungen/${fassungId}/zurueckholen`,
    { method: 'POST', body: JSON.stringify({ fassung }) },
  ),
  /** Löscht endgültig, auch was die KI nur vergessen hat. */
  deleteMemory: (id: string) => api(`/ai/memory/${id}`, { method: 'DELETE' }),
  /**
   * Leert einen ganzen Bereich und meldet, wie viele Einträge das waren.
   *
   * `serverId` fehlte hier als einzigem der Memory-Aufrufe. Ohne ihn löst das
   * Backend `scope=server_shared` gar nicht erst auf und antwortet 404 — der
   * Knopf „alles löschen" wäre am Serverreiter tot gewesen.
   */
  clearMemory: (scope: AiMemoryEntry['scope'], teamId?: number, serverId?: number) => api<{ removed: number }>(
    `/ai/memory?scope=${scope}${teamId ? `&team_id=${teamId}` : ''}${serverId ? `&server_id=${serverId}` : ''}`,
    { method: 'DELETE' },
  ),
  getMemoryPreference: () => api<AiMemoryPreference>('/ai/memory/preference'),
  setMemoryPreference: (enabled: boolean) => api<AiMemoryPreference>('/ai/memory/preference', {
    method: 'PUT', body: JSON.stringify({ enabled }),
  }),
  /**
   * Antwort auf den Hinweis vor der ersten Nachricht. Bewusst getrennt von
   * `setMemoryPreference`: ein "Nein" ist hier keine Einstellung, sondern eine
   * Terminverschiebung — es setzt nur den Zeitpunkt, ab dem wieder gefragt wird.
   */
  answerMemoryNotice: (enable: boolean, hideFuture: boolean) => api<AiMemoryPreference>('/ai/memory/notice', {
    method: 'POST', body: JSON.stringify({ enable, hide_future: hideFuture }),
  }),
  /** Lässt den Text vom Gedächtnis-Modell lesen und gleicht ab — schreibt nichts.
   *  Ein langer Text geht in Teilen; das kann einige Sekunden dauern. */
  importMemoryPreview: (payload: AiMemoryImportTarget & { raw_text: string }) =>
    api<AiMemoryImportPreview>('/ai/memory/import/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 0,
    }),
  /** Übernimmt die ausgewählten Einträge; übersprungene kommen mit Grund zurück. */
  executeMemoryImport: (
    payload: AiMemoryImportTarget & {
      source_provider?: string
      items: AiMemoryImportItem[]
    },
  ) => api<AiMemoryImportResult>('/ai/memory/import', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 0,
  }),
  /** Das Verzeichnis ohne Texte — dasselbe, das auch die KI im Prompt sieht. */
  listSkills: () => api<AiSkillSummary[]>('/ai/skills'),
  listManagedSkills: () => api<AiSkillManaged[]>('/ai/skills/manage'),
  listPendingSkills: () => api<AiSkillManaged[]>('/ai/skills/pending'),
  saveSkill: (payload: {
    skill_key: string; name: string; description: string; body: string
    team_id: number | null; enabled: boolean; always_active?: boolean
  }) => api<AiSkillManaged>('/ai/skills', { method: 'PUT', body: JSON.stringify(payload) }),
  toggleSkill: (skillId: string, enabled: boolean) => api<AiSkillManaged>(`/ai/skills/${skillId}/enabled`, {
    method: 'PUT', body: JSON.stringify({ enabled }),
  }),
  toggleSkillAlwaysActive: (skillId: string, always_active: boolean) =>
    api<AiSkillManaged>(`/ai/skills/${skillId}/always-active`, {
      method: 'PUT', body: JSON.stringify({ always_active }),
    }),
  approveSkill: (skillId: string, fingerprint: string) => api<AiSkillManaged>(`/ai/skills/${skillId}/approve`, {
    method: 'POST', body: JSON.stringify({ fingerprint }),
  }),
  deleteSkill: (skillId: string) => api(`/ai/skills/${skillId}`, { method: 'DELETE' }),
}
