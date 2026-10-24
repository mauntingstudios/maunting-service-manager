import { beforeEach, describe, expect, it, vi } from 'vitest'

const social = vi.hoisted(() => ({ sendReadReceipt: vi.fn(async () => ({ status: 'ok' })) }))
const uebernahme = vi.hoisted(() => ({
  uebernimmLesungen: vi.fn(), anzeigeVerlauf: vi.fn(() => []),
}))
vi.mock('@/api/social', () => social)
vi.mock('@/services/gespraech/uebernahme', () => uebernahme)
vi.mock('@/services/eigeneWirkungen', () => ({ vergissEigeneWirkungen: vi.fn(async () => {}) }))
vi.mock('@/services/nachrichtAnheftung', () => ({ anheftung: () => ({ clientUuid: null }) }))

import { useNachrichtenLaden, type NachrichtenLadenOptionen } from './useNachrichtenLaden'

const zeile = { id: -99, clientUuid: 'received', senderId: 2, isSelf: false, viaInbox: true }
function optionen(): NachrichtenLadenOptionen {
  return {
    blindMailboxId: 'dm', currentUserId: 1, activeContact: { userId: 2 }, activeGroup: null,
    gruppenrechteVon: () => new Set(), t: (s: string) => s, messages: [],
    setMessages: vi.fn(), setLoadingMessages: vi.fn(), setAngeheftet: vi.fn(), setVerfallSekunden: vi.fn(),
    zeigeSystemzeile: vi.fn(), markAsRead: vi.fn(), isBlocked: () => false, readReceiptsEnabled: true,
    konversation: { liesUmschlaege: async () => [], uebernimmLesestand: vi.fn() },
    identityRef: { current: { state: 'ready' } }, activeMailboxIdRef: { current: 'dm' },
    currentLoadSeqRef: { current: 0 }, maxPartnerReadIdRef: { current: 0 }, maxPartnerDeliveredIdRef: { current: 0 },
    highestIncomingIdDeliveredRef: { current: 0 }, highestIncomingIdAcknowledgedRef: { current: 0 },
    sendE2eeControlMessage: vi.fn(async () => {}),
  } as unknown as NachrichtenLadenOptionen
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  uebernahme.uebernimmLesungen.mockResolvedValue({
    processedList: [], lokalerVerlauf: [zeile], combined: [zeile], maxIncomingId: 0, unlesbar: 0,
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

describe('Lesebestätigung nach Hintergrundempfang', () => {
  it('quittiert beim Öffnen lokal gespeicherte UUIDs auch ohne neue Umschläge', async () => {
    const loadMessages = useNachrichtenLaden(optionen())
    await loadMessages()
    expect(social.sendReadReceipt).toHaveBeenCalledWith({ chat_type: 'direct', chat_id: '2', client_uuids: ['received'] })
    await loadMessages()
    expect(social.sendReadReceipt).toHaveBeenCalledTimes(1)
  })

  it('quittiert keinen unsichtbaren oder blockierten Chat als gelesen', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await useNachrichtenLaden(optionen())()
    expect(social.sendReadReceipt).not.toHaveBeenCalled()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await useNachrichtenLaden({ ...optionen(), isBlocked: () => true })()
    expect(social.sendReadReceipt).not.toHaveBeenCalled()
  })
})
