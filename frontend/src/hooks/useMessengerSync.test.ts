import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ablage = vi.hoisted(() => ({ updateMessageInLocalStore: vi.fn(async () => {}) }))
vi.mock('@/services/messengerLocalStore', () => ablage)
vi.mock('@/services/e2eeCrypto', () => ({
  deriveBlindMailboxId: vi.fn(async (a: number, b: number) => `dm-${Math.min(a, b)}-${Math.max(a, b)}`),
  deriveGroupBlindMailboxId: vi.fn(async (id: number) => `group-${id}`),
}))
vi.mock('@/stores/useCallStore', () => ({ useCallStore: { getState: () => ({ handleCallSyncEvent: vi.fn() }) } }))

import { useMessengerSync } from './useMessengerSync'
import { partnerKennungen } from '@/services/quittungsstand'
import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'

function start(mailbox = 'dm-1-2') {
  const loadMessages = vi.fn(async () => {})
  renderHook(() => useMessengerSync({
    blindMailboxId: mailbox, leseMailboxen: [mailbox], currentUserId: 1, geraeteMeldungen: true,
    loadMessages, setGroups: vi.fn(), setActiveGroup: vi.fn(), setPartnerActivity: vi.fn(),
    partnerActivityTimeoutRef: { current: null },
  }))
  return loadMessages
}
async function sync(detail: Record<string, unknown>) {
  await act(async () => { window.dispatchEvent(new CustomEvent('msm:sync-event', { detail })) })
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setzeAngemeldetesKonto(1)
  ablage.updateMessageInLocalStore.mockResolvedValue()
})

describe('Queue-Quittungen im Messenger', () => {
  it('lädt den Verlauf erst nach dem lokalen Commit der Zustellquittung neu', async () => {
    let fertig!: () => void
    ablage.updateMessageInLocalStore.mockReturnValueOnce(new Promise((resolve) => { fertig = resolve }))
    const laden = start()
    await sync({ type: 'delivery_receipt', chat_type: 'direct', chat_id: '2', recipient_id: 2, client_uuid: 'u#devA' })
    expect(laden).not.toHaveBeenCalled()
    await act(async () => { fertig() })
    expect(ablage.updateMessageInLocalStore).toHaveBeenCalledWith('dm-1-2', 'u', expect.objectContaining({ status: 'delivered', isDelivered: true }))
    expect(laden).toHaveBeenCalledTimes(1)
  })

  it('ordnet eine Quittung dem richtigen Gespräch statt dem geöffneten zu', async () => {
    start('dm-1-3')
    await sync({ type: 'delivery_receipt', chat_type: 'direct', chat_id: '2', recipient_id: 2, client_uuids: ['u#devA', 'u#devB'] })
    expect(ablage.updateMessageInLocalStore).toHaveBeenCalledTimes(1)
    expect(ablage.updateMessageInLocalStore).toHaveBeenCalledWith('dm-1-2', 'u', expect.objectContaining({ status: 'delivered' }))
    expect(partnerKennungen('dm-1-2').zugestellt.has('u')).toBe(true)
    expect(partnerKennungen('dm-1-3').zugestellt.size).toBe(0)
  })

  it('nimmt eine verspätete Zustellquittung nicht als Rückschritt von gelesen', async () => {
    start()
    await sync({ type: 'read_receipt', chat_type: 'direct', chat_id: '2', reader_id: 2, client_uuids: ['u'] })
    await sync({ type: 'delivery_receipt', chat_type: 'direct', chat_id: '2', recipient_id: 2, client_uuids: ['u'] })
    expect(ablage.updateMessageInLocalStore.mock.calls.at(-1)).toEqual(['dm-1-2', 'u', { status: 'read', isRead: true, isDelivered: true }])
  })

  it('nimmt fremde Gruppenquittungen nicht als Direktchat-Quittung', async () => {
    start()
    await sync({ type: 'delivery_receipt', chat_type: 'group', chat_id: '7', recipient_id: 2, client_uuids: ['u'] })
    expect(ablage.updateMessageInLocalStore).not.toHaveBeenCalled()
  })
})
