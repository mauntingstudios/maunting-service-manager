import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const anrufe = vi.hoisted(() => ({ handleCallSyncEvent: vi.fn() }))
vi.mock('@/stores/useCallStore', () => ({
  useCallStore: { getState: () => ({ handleCallSyncEvent: anrufe.handleCallSyncEvent }) },
}))

import { useMessengerSync } from './useMessengerSync'

function start(leseMailboxen = ['direct:peer:2']) {
  const loadMessages = vi.fn(async () => {})
  const setPartnerActivity = vi.fn()
  renderHook(() => useMessengerSync({
    blindMailboxId: 'direct:peer:2',
    leseMailboxen,
    currentUserId: 1,
    geraeteMeldungen: true,
    loadMessages,
    setGroups: vi.fn(),
    setActiveGroup: vi.fn(),
    setPartnerActivity,
    partnerActivityTimeoutRef: { current: null },
  }))
  return { loadMessages, setPartnerActivity }
}

async function sync(detail: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('msm:sync-event', { detail }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Ereignisse im Einheits-Transport', () => {
  it('lädt bei neuen, geänderten und gelöschten Nachrichten nach', async () => {
    const { loadMessages } = start()

    await sync({ type: 'message_created', chat_type: 'direct', chat_id: 55 })
    await sync({ type: 'message_updated', chat_type: 'direct', chat_id: 55 })
    await sync({ type: 'message_deleted', chat_type: 'direct', chat_id: 55 })

    expect(loadMessages).toHaveBeenCalledTimes(3)
    expect(loadMessages).toHaveBeenCalledWith(false)
  })

  it('lädt bei Quittungen nach, weil der Wasserstand in der Seite steht', async () => {
    const { loadMessages } = start()

    await sync({ type: 'delivery_receipt', chat_type: 'direct', chat_id: 55, up_to_id: 9 })
    await sync({ type: 'read_receipt', chat_type: 'direct', chat_id: 55, up_to_id: 9 })
    await sync({ type: 'chat_state', chat_type: 'direct', chat_id: 55, ephemeral_ttl_seconds: 0 })

    expect(loadMessages).toHaveBeenCalledTimes(3)
  })

  it('zeigt das Tippen des Gegenübers und blendet es nach der Frist aus', async () => {
    vi.useFakeTimers()
    try {
      const { setPartnerActivity } = start()

      await sync({ type: 'typing', sender_id: 2, sender_username: 'alice', status: 'typing' })
      expect(setPartnerActivity).toHaveBeenLastCalledWith({ status: 'typing', username: 'alice' })

      await sync({ type: 'typing', sender_id: 2, status: 'idle' })
      expect(setPartnerActivity).toHaveBeenLastCalledWith(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reicht Rufereignisse an den Anruf-Store weiter', async () => {
    start()
    await sync({ type: 'call_key', call_id: 7, key: 'x' })
    expect(anrufe.handleCallSyncEvent).toHaveBeenCalledWith({ type: 'call_key', call_id: 7, key: 'x' })
  })
})
