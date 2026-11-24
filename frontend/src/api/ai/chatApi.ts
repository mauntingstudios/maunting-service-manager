import { api, apiStream } from '../client'
import {
  STREAM_EVENTS,
  type AiActionProposal,
  type AiAttachment,
  type AiAutonomyGrant,
  type AiConversationDetail,
  type AiConversationKind,
  type AiConversationSummary,
  type AiRunInfo,
  type AiStreamEvent,
  type AiTaskEntry,
  type AiTaskScope,
  type AiTaskWrite,
  type AiWorkerInfo,
} from './chatTypes'
import type { AiContextStatus } from './memoryTypes'

export const chatApi = {
  /**
   * Eine Unterhaltung. Wird beim ersten Aufruf serverseitig angelegt.
   *
   * Ohne `kind` der Dauerchat — so fragt der Chat, und so hat er immer
   * gefragt. `before` ist die Kennung der ältesten bereits geladenen
   * Nachricht und liefert die Seite davor.
   */
  getConversation: (
    kind: AiConversationKind = 'primary',
    before?: string,
    documentUid?: string,
    conversationId?: string,
  ) => {
    const suche = new URLSearchParams({ kind })
    if (before) suche.set('before', before)
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    return api<AiConversationDetail>(`/ai/conversation?${suche.toString()}`)
  },
  listConversations: (projectId?: string) =>
    api<AiConversationSummary[]>(
      projectId
        ? `/ai/conversation/list?project_id=${encodeURIComponent(projectId)}`
        : '/ai/conversation/list',
    ),
  createConversation: (
    payload: { title?: string; project_id?: string | null } = {},
  ) =>
    api<AiConversationSummary>('/ai/conversation/new', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateConversation: (
    conversationId: string,
    payload: { title?: string; pinned?: boolean; project_id?: string | null },
  ) =>
    api<AiConversationSummary>(
      `/ai/conversation/item/${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    ),
  deleteConversation: (conversationId: string) =>
    api<{ deleted: boolean }>(
      `/ai/conversation/item/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' },
    ),
  /** Bricht den aktiven Lauf der Unterhaltung serverseitig kontrolliert ab. */
  stopRun: (
    kind: AiConversationKind = 'primary',
    documentUid?: string,
    conversationId?: string,
  ) => {
    const suche = new URLSearchParams({ kind })
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    return api<{ ok: boolean; stopped: boolean }>(`/ai/conversation/stop?${suche.toString()}`, {
      method: 'POST',
    })
  },
  clearHistory: (documentUid?: string, conversationId?: string) => {
    const suche = new URLSearchParams()
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    const rest = suche.toString()
    return api(`/ai/conversation/messages${rest ? `?${rest}` : ''}`, {
      method: 'DELETE',
    })
  },
  /**
   * Nimmt eine eigene Nachricht zurück: sie und alles Spätere verschwinden.
   * Gesendet wird **nicht** — das übernimmt danach der gewohnte Streamweg.
   * Zwei Schritte, weil das Senden Kontingent, Anbieterwahl und Stream braucht.
   */
  editMessage: (
    messageId: string,
    content: string,
    documentUid?: string,
    conversationId?: string,
  ) => {
    const suche = new URLSearchParams()
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    const rest = suche.toString()
    return api<{ removed: number }>(
      `/ai/conversation/messages/${messageId}${rest ? `?${rest}` : ''}`,
      { method: 'PUT', body: JSON.stringify({ content }) },
    )
  },
  /**
   * Die Vorschläge eines Fensters. Ohne `kind` die des Dauerchats.
   *
   * Ein Reparaturlauf, der auf eine Bestätigung wartet, legt seine Vorschläge
   * unter **seiner** Unterhaltung an — ohne `kind` bekäme man sie nie zu
   * sehen, und die Karte, auf deren Klick der Lauf wartet, wäre im ganzen
   * Panel nirgends.
   */
  listActions: (
    kind: AiConversationKind = 'primary',
    documentUid?: string,
    conversationId?: string,
  ) => {
    const suche = new URLSearchParams({ kind })
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    return api<AiActionProposal[]>(`/ai/conversation/actions?${suche.toString()}`)
  },
  /**
   * Nur die Karten, auf deren Klick gerade jemand wartet — eigene und die
   * lebender Worker. Die Liste der Sprachansicht: bestätigt wird seit dem
   * 25.09.2026 nur per Klick, und die Karte steht dort, wo man gerade ist.
   */
  listOpenActions: () =>
    api<AiActionProposal[]>('/ai/conversation/actions?kind=primary&offen=true'),
  /**
   * Die Vorschläge eines Worker-Fensters — über die Kennung, denn
   * `kind=worker` ist mehrdeutig: es gibt je Auftrag ein Fenster.
   */
  listWorkerActions: (conversationId: string) =>
    api<AiActionProposal[]>(
      `/ai/conversation/actions?conversation_id=${encodeURIComponent(conversationId)}`,
    ),
  /**
   * Die lebenden Hintergrund-Aufträge — die Worker-Leiste des Chats.
   * Beendete fallen beim nächsten Blick heraus („räumt sich auf");
   * ihre Unterhaltung bleibt über `getWorkerConversation` lesbar.
   */
  listWorkers: () => api<AiWorkerInfo[]>('/ai/conversation/workers'),
  /** Ein Worker-Fenster, nur lesend. Fremde und Unbekannte sind dasselbe 404. */
  getWorkerConversation: (conversationId: string, before?: string) => {
    const suche = new URLSearchParams()
    if (before) suche.set('before', before)
    const rest = suche.toString()
    return api<AiConversationDetail>(
      `/ai/conversation/worker/${encodeURIComponent(conversationId)}${rest ? `?${rest}` : ''}`,
    )
  },
  /** Der aktive Lauf eines bestimmten Fensters — der Weg der Worker-Ansicht. */
  getWorkerRun: (conversationId: string) =>
    api<AiRunInfo | null>(
      `/ai/conversation/run?conversation_id=${encodeURIComponent(conversationId)}`,
    ),
  /**
   * Die Aufgabenliste — dieselben Dienstfunktionen, durch die auch die
   * Chat-Werkzeuge gehen. Alles, was die KI kann, kann der Benutzer hier auch;
   * alle vier verlangen `ai.tasks.manage`.
   */
  listTasks: (params?: { scope?: AiTaskScope; team_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.scope) {
      query.set('scope', params.scope)
    }
    if (params?.team_id !== undefined) {
      query.set('team_id', String(params.team_id))
    }
    const qs = query.toString()
    return api<AiTaskEntry[]>(qs ? `/ai/tasks?${qs}` : '/ai/tasks')
  },
  createTask: (payload: AiTaskWrite) =>
    api<AiTaskEntry>('/ai/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (taskId: string, payload: AiTaskWrite) =>
    api<AiTaskEntry>(`/ai/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteTask: (taskId: string) =>
    api<{ deleted: boolean; title: string }>(`/ai/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    }),
  /**
   * Das Tipp-Signal der Ruhe-Regel: „der Mensch schreibt gerade".
   * Übertragen wird nur der Zeitpunkt — nie Text und nicht einmal seine Länge.
   */
  typing: () => api('/ai/conversation/typing', { method: 'POST' }),
  getAction: (proposalId: string) => api<AiActionProposal>(`/ai/actions/${proposalId}`),
  confirmAction: (proposalId: string) => api<{ proposal_id: string; confirmation_token: string; expires_at: string }>(`/ai/actions/${proposalId}/confirm`, {
    method: 'POST',
  }),
  rejectAction: (proposalId: string) => api<AiActionProposal>(`/ai/actions/${proposalId}/reject`, {
    method: 'POST',
  }),
  executeAction: (proposalId: string, confirmationToken: string) => api<{ proposal: AiActionProposal; result: Record<string, unknown> }>(`/ai/actions/${proposalId}/execute`, {
    method: 'POST',
    body: JSON.stringify({ confirmation_token: confirmationToken }),
    timeoutMs: 0,
  }),
  listAutonomyGrants: () => api<AiAutonomyGrant[]>('/ai/autonomy'),
  /**
   * Freigabe anlegen oder ändern. Es gibt bewusst kein Löschen: abgeschaltet
   * wird über `enabled: false` (AiAutonomyButton), damit die einmal erteilte
   * Freigabe samt Stundenlimit sichtbar bleibt, statt spurlos zu verschwinden.
   */
  saveAutonomyGrant: (payload: {
    server_id?: number | null
    project_id?: string | null
    enabled: boolean
    max_actions_per_hour: number
  }) =>
    api<AiAutonomyGrant>('/ai/autonomy', { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAutonomyGrant: (params: { server_id?: number | null; project_id?: string | null }) => {
    const q = new URLSearchParams()
    if (params.server_id !== undefined && params.server_id !== null) q.set('server_id', String(params.server_id))
    if (params.project_id) q.set('project_id', params.project_id)
    return api<void>(`/ai/autonomy?${q.toString()}`, { method: 'DELETE' })
  },
  /**
   * Der Provider steht im Query, weil die Frage schon vor der ersten Nachricht
   * beantwortet sein muss — und weil ein Modellwechsel die Antwort sofort
   * ändert, ohne dass jemand etwas gesendet hätte.
   */
  getContextStatus: (
    providerId: number,
    documentUid?: string,
    conversationId?: string,
    model?: string | null,
  ) => {
    const suche = new URLSearchParams({ provider_id: String(providerId) })
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    if (model) suche.set('model', model)
    return api<AiContextStatus>(`/ai/conversation/context?${suche.toString()}`)
  },
  listAttachments: (documentUid?: string, conversationId?: string) => {
    const suche = new URLSearchParams()
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    const rest = suche.toString()
    return api<AiAttachment[]>(
      `/ai/conversation/attachments${rest ? `?${rest}` : ''}`,
    )
  },
  uploadAttachment: (file: File, documentUid?: string, conversationId?: string) => {
    const body = new FormData()
    body.append('file', file)
    const suche = new URLSearchParams()
    if (documentUid) suche.set('document_uid', documentUid)
    if (conversationId) suche.set('conversation_id', conversationId)
    const rest = suche.toString()
    return api<AiAttachment>(
      `/ai/conversation/attachments${rest ? `?${rest}` : ''}`,
      { method: 'POST', body },
    )
  },
  deleteAttachment: (id: string) => api(`/ai/attachments/${id}`, { method: 'DELETE' }),
  attachmentContentUrl: (id: string) => `/api/ai/attachments/${encodeURIComponent(id)}/content`,
  /**
   * Laeuft gerade noch etwas von vorhin? `null`, wenn nicht.
   *
   * `kind` grenzt auf ein Fenster ein. `null` fragt über alle — das tut die
   * Glocke, die nur wissen will, ob überhaupt etwas läuft, und danach über
   * `AiRunInfo.kind` entscheidet, wohin sie zeigt.
   */
  getActiveRun: (
    kind: AiConversationKind | null = 'primary',
    conversationId?: string,
  ) => {
    if (conversationId) {
      return api<AiRunInfo | null>(
        `/ai/conversation/run?conversation_id=${encodeURIComponent(conversationId)}`,
      )
    }
    return api<AiRunInfo | null>(`/ai/conversation/run?kind=${kind ?? ''}`)
  },
  /**
   * Ein Mensch übernimmt: die laufenden Reparaturen dieses Menschen enden.
   *
   * Beendet wird der **Auftrag**, nicht nur der Lauf. Nur den Lauf abzubrechen
   * hieße, dass der Takt neunzig Sekunden später den nächsten startet.
   */
  takeOverGuardian: () => api<{ aborted: number }>(
    '/ai/conversation/guardian/takeover', { method: 'POST' },
  ),
}

/** Liest einen fragmentierten SSE-Stream, ohne unbekannte Providerdaten auszugeben. */
export async function streamAiMessage(
  payload: {
    content: string
    provider_id: number
    model?: string | null
    conversation_id?: string | null
    project_id?: string | null
    request_id: string
    reasoning: boolean
    /** Die gewuenschte Denkstufe. Der Server klemmt sie auf Modell und Rolle. */
    reasoning_effort?: string | null
    /** Dokument-Chat: bindet den Lauf an ein Dokument, nie an Modelltext. */
    document_uid?: string
    selection?: { quote: string; hash?: string }
    /** Nur die App: verkleinert das Werkzeugangebot, oeffnet keine Rechte. */
    app_faehigkeiten?: {
      computer_use?: boolean | null
      artifact_install?: boolean | null
    }
  },
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
  onConversationResolved?: (conversationId: string) => void,
): Promise<void> {
  const response = await apiStream('/ai/conversation/messages/stream', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
  const resolvedConvId = response.headers.get('x-conversation-id')
  if (resolvedConvId) {
    onConversationResolved?.(resolvedConvId)
  }
  await leseStrom(response, onEvent)
}

/**
 * Haengt sich an einen bereits laufenden Lauf an.
 *
 * Der Gegenpart zu "der Lauf haengt an nichts": wer die Seite verlassen hat
 * oder den Browser neu gestartet hat, findet die Arbeit hier wieder. Der Lauf
 * schickt zuerst einen `snapshot` mit allem, was bisher passiert ist, und
 * danach die Fortsetzung live.
 */
export async function attachAiRun(
  runId: string,
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await apiStream(`/ai/conversation/run/${runId}/stream`, {
    method: 'GET',
    signal,
  })
  await leseStrom(response, onEvent)
}

async function leseStrom(
  response: Response,
  onEvent: (event: AiStreamEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error('AI_STREAM_UNAVAILABLE')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeBlock = (block: string) => {
    let eventName = ''
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!eventName || dataLines.length === 0) return
    let data: unknown
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      throw new Error('AI_STREAM_INVALID')
    }
    if (!data || typeof data !== 'object') throw new Error('AI_STREAM_INVALID')
    // Ein unbekannter Ereignisname ist kein kaputter Strom, sondern ein
    // Bündel, das älter ist als das Backend. Übergehen statt werfen: sonst
    // reißt ein neu eingeführtes Ereignis die halb geschriebene Antwort ab
    // und markiert sie als fehlgeschlagen, während der Lauf weiterläuft.
    if (!(STREAM_EVENTS as readonly string[]).includes(eventName)) return
    onEvent({ event: eventName, data } as AiStreamEvent)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        consumeBlock(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
      if (done) break
    }
    if (buffer.trim()) consumeBlock(buffer)
  } finally {
    reader.releaseLock()
  }
}
