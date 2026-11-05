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

/** Ein Chat hat genau ein Fenster: den Dauerchat (optional mit bestimmter conversationId/projectId) oder ein Dokument. */
export type AiChatScope =
  | {
      kind: 'primary'
      conversationId?: string
      projectId?: string | null
    }
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
  getContextStatus: (providerId: number, model?: string | null) => Promise<AiContextStatus>
  listAttachments: () => Promise<AiAttachment[]>
  uploadAttachment: (file: File) => Promise<AiAttachment>
  deleteAttachment: (attachmentId: string) => Promise<void>
  clearHistory: () => Promise<void>
  editMessage: (messageId: string, content: string) => Promise<{ removed: number }>
  stopRun: () => Promise<{ ok: boolean; stopped: boolean }>
  typing: () => Promise<void>
  stream: (
    payload: {
      content: string
      provider_id: number
      model?: string | null
      request_id: string
      reasoning: boolean
      reasoning_effort?: string | null
      app_faehigkeiten?: {
        computer_use?: boolean | null
        artifact_install?: boolean | null
      }
    },
    onEvent: (event: AiStreamEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>
}

/**
 * Bindet die vorhandenen AI-Aufrufe an ein Fenster.
 *
 * Der Primärchat ruft exakt die bisherigen Funktionen ohne Zusatzargumente
 * auf, solange keine `conversationId` übergeben wurde — die bestehenden Tests
 * und das Verhalten bleiben unverändert.
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
      getContextStatus: (providerId, model) =>
        model ? aiApi.getContextStatus(providerId, uid, undefined, model) : aiApi.getContextStatus(providerId, uid),
      listAttachments: () => aiApi.listAttachments(uid),
      uploadAttachment: (file) => aiApi.uploadAttachment(file, uid),
      deleteAttachment: async (id) => {
        await aiApi.deleteAttachment(id)
      },
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

  const cid = scope.conversationId
  const pid = scope.projectId
  if (cid || pid) {
    return {
      scopeKey: `primary:${cid ?? 'default'}:${pid ?? ''}`,
      getConversation: (before) => aiApi.getConversation('primary', before, undefined, cid),
      listActions: () => aiApi.listActions('primary', undefined, cid),
      getActiveRun: (runConvId) => aiApi.getActiveRun('primary', runConvId ?? cid),
      getContextStatus: (providerId, model) =>
        aiApi.getContextStatus(providerId, undefined, cid, model),
      listAttachments: () => aiApi.listAttachments(undefined, cid),
      uploadAttachment: (file) => aiApi.uploadAttachment(file, undefined, cid),
      deleteAttachment: async (id) => {
        await aiApi.deleteAttachment(id)
      },
      clearHistory: async () => {
        await aiApi.clearHistory(undefined, cid)
      },
      editMessage: (messageId, content) =>
        aiApi.editMessage(messageId, content, undefined, cid),
      stopRun: () => aiApi.stopRun('primary', undefined, cid),
      typing: async () => {
        await aiApi.typing()
      },
      stream: (payload, onEvent, signal) =>
        streamAiMessage(
          {
            ...payload,
            ...(cid ? { conversation_id: cid } : {}),
            ...(pid ? { project_id: pid } : {}),
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
    getContextStatus: (providerId, model) =>
      model
        ? aiApi.getContextStatus(providerId, undefined, undefined, model)
        : aiApi.getContextStatus(providerId),
    listAttachments: () => aiApi.listAttachments(),
    uploadAttachment: (file) => aiApi.uploadAttachment(file),
    deleteAttachment: async (id) => {
      await aiApi.deleteAttachment(id)
    },
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
