import { create } from 'zustand'

export type ConversationGenerationStatus = 'generating' | 'completed' | 'error'

export interface GenerationInfo {
  status: ConversationGenerationStatus
  runId?: string
  startedAt: number
  completedAt?: number
}

interface AiGenerationState {
  generations: Record<string, GenerationInfo>
  startGeneration: (conversationId: string, runId?: string) => void
  finishGeneration: (conversationId: string, success: boolean) => void
  markConversationSeen: (conversationId: string) => void
  clearGeneration: (conversationId: string) => void
}

export const useAiGenerationStore = create<AiGenerationState>((set) => ({
  generations: {},
  startGeneration: (conversationId, runId) => {
    if (!conversationId) return
    set((state) => ({
      generations: {
        ...state.generations,
        [conversationId]: {
          status: 'generating',
          runId,
          startedAt: Date.now(),
        },
      },
    }))
  },
  finishGeneration: (conversationId, success) => {
    if (!conversationId) return
    set((state) => ({
      generations: {
        ...state.generations,
        [conversationId]: {
          status: success ? 'completed' : 'error',
          runId: state.generations[conversationId]?.runId,
          startedAt: state.generations[conversationId]?.startedAt || Date.now(),
          completedAt: Date.now(),
        },
      },
    }))
  },
  markConversationSeen: (conversationId) => {
    if (!conversationId) return
    set((state) => {
      const cur = state.generations[conversationId]
      // Wenn der Lauf noch aktiv generiert, lassen wir den Zustand bestehen.
      // Nur abgeschlossene oder fehlgeschlagene Meldungen werden als gesehen geräumt.
      if (!cur || cur.status === 'generating') return state
      const next = { ...state.generations }
      delete next[conversationId]
      return { generations: next }
    })
  },
  clearGeneration: (conversationId) => {
    if (!conversationId) return
    set((state) => {
      const next = { ...state.generations }
      delete next[conversationId]
      return { generations: next }
    })
  },
}))
