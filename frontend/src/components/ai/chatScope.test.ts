import { describe, expect, it, vi } from 'vitest'
import { chatScopeApi } from './chatScope'
import { aiApi, streamAiMessage } from '@/api/ai'

vi.mock('@/api/ai', () => ({
  aiApi: {
    getConversation: vi.fn(),
    listActions: vi.fn(),
    getActiveRun: vi.fn(),
    getContextStatus: vi.fn(),
    listAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    clearHistory: vi.fn(),
    editMessage: vi.fn(),
    stopRun: vi.fn(),
    typing: vi.fn(),
  },
  streamAiMessage: vi.fn(),
}))

describe('chatScopeApi - draft mode', () => {
  it('returns empty conversation without calling aiApi.getConversation when isDraft is true', async () => {
    const api = chatScopeApi({ kind: 'primary', isDraft: true, projectId: 'proj-1' })

    const conversation = await api.getConversation()
    expect(conversation).toEqual(
      expect.objectContaining({
        id: '',
        kind: 'primary',
        messages: [],
        has_more: false,
      }),
    )
    expect(aiApi.getConversation).not.toHaveBeenCalled()
  })

  it('streams without conversation_id in draft mode and forwards onConversationResolved', async () => {
    const onResolved = vi.fn()
    const api = chatScopeApi({ kind: 'primary', isDraft: true, projectId: 'proj-123' })

    await api.stream(
      {
        content: 'Hallo Neuer Chat',
        provider_id: 1,
        request_id: 'req-1',
        reasoning: false,
      },
      () => {},
      undefined,
      onResolved,
    )

    expect(streamAiMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Hallo Neuer Chat',
        project_id: 'proj-123',
      }),
      expect.any(Function),
      undefined,
      onResolved,
    )
    expect(streamAiMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: expect.anything(),
      }),
      expect.any(Function),
      undefined,
      onResolved,
    )
  })

  it('streams with conversation_id when conversationId is provided', async () => {
    const onResolved = vi.fn()
    const api = chatScopeApi({ kind: 'primary', conversationId: 'conv-existing' })

    await api.stream(
      {
        content: 'Weiterer Prompt',
        provider_id: 2,
        request_id: 'req-2',
        reasoning: false,
      },
      () => {},
      undefined,
      onResolved,
    )

    expect(streamAiMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-existing',
        content: 'Weiterer Prompt',
      }),
      expect.any(Function),
      undefined,
      onResolved,
    )
  })
})
