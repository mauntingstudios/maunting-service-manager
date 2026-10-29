import {
  aiApi,
  streamAiMessage,
  type AiActionProposal,
  type AiAttachment,
  type AiContextStatus,
  type AiConversationDetail,
  type AiRunInfo,
  type AiStreamEvent,
} from '@/api/ai'

/** Ein Chat hat genau ein Fenster: den Dauerchat oder ein Dokument. */
export type AiChatScope =
  | { kind: 'primary' }
  | {
      kind: 'docs'
      documentUid: string
      selection?: { quote: string; hash?: string }
    }

export const PRIMARY_CHAT_SCOPE: AiChatScope = { kind: 'primary' }

export interface ChatScopeApi {
  scopeKey: string
  getConversation: (before?: string) => Promise<AiConversationDetail>
  listActions: () => Promise<AiActionProposal[]>
  getActiveRun: (conversationId?: string) => Promise<AiRunInfo | null>
  getContextStatus: (providerId: number) => Promise<AiContextStatus>
  listAttachments: () => Promise<AiAttachment[]>
  uploadAttachment: (file: File) => Promise<AiAttachment>
  clearHistory: () => Promise<void>
  editMessage: (messageId: string, content: string) => Promise<{ removed: number }>
  stopRun: () => Promise<{ ok: boolean; stopped: boolean }>
  typing: () => Promise<void>
  stream: (
    payload: {
      content: string
      provider_id: number
      request_id: string
      reasoning: boolean
      reasoning_effort?: string | null
    },
    onEvent: (event: AiStreamEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>
}

/**
 * Bindet die vorhandenen AI-Aufrufe an ein Fenster.
 *
 * Der Primärchat ruft exakt die bisherigen Funktionen ohne Zusatzargumente
 * auf — die bestehenden Tests und das Verhalten bleiben unverändert. Der
 * Dokumentchat ergänzt nur `document_uid`; Anhänge, Diktat, Provider und
 * Werkzeuge bleiben dieselben.
 */
export function chatScopeApi(
  scope: AiChatScope,
  selectionLieferant?: () => { quote: string; hash?: string } | undefined,
): ChatScopeApi {
  if (scope.kind === 'docs') {
    const uid = scope.documentUid
    return {
      scopeKey: `docs:${uid}`,
      getConversation: (before) => aiApi.getConversation('docs', before, uid),
      listActions: () => aiApi.listActions('docs', uid),
      getActiveRun: (conversationId) =>
        conversationId ? aiApi.getActiveRun(null, conversationId) : Promise.resolve(null),
      getContextStatus: (providerId) => aiApi.getContextStatus(providerId, uid),
      listAttachments: () => aiApi.listAttachments(uid),
      uploadAttachment: (file) => aiApi.uploadAttachment(file, uid),
      clearHistory: async () => {
        await aiApi.clearHistory(uid)
      },
      editMessage: (messageId, content) => aiApi.editMessage(messageId, content, uid),
      stopRun: () => aiApi.stopRun('docs', uid),
      typing: async () => {
        await aiApi.typing()
      },
      stream: (payload, onEvent, signal) =>
        streamAiMessage(
          {
            ...payload,
            document_uid: uid,
            selection: selectionLieferant?.() ?? scope.selection,
          },
          onEvent,
          signal,
        ),
    }
  }

  return {
    scopeKey: 'primary',
    getConversation: (before) =>
      before ? aiApi.getConversation('primary', before) : aiApi.getConversation(),
    listActions: () => aiApi.listActions(),
    getActiveRun: () => aiApi.getActiveRun(),
    getContextStatus: (providerId) => aiApi.getContextStatus(providerId),
    listAttachments: () => aiApi.listAttachments(),
    uploadAttachment: (file) => aiApi.uploadAttachment(file),
    clearHistory: async () => {
      await aiApi.clearHistory()
    },
    editMessage: (messageId, content) => aiApi.editMessage(messageId, content),
    stopRun: () => aiApi.stopRun('primary'),
    typing: async () => {
      await aiApi.typing()
    },
    stream: (payload, onEvent, signal) => streamAiMessage(payload, onEvent, signal),
  }
}

/** Der eine Primärchat — auch fuer Guardian und Worker als Rueckfall. */
export const primaryChatApi = chatScopeApi(PRIMARY_CHAT_SCOPE)
