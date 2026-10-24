import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'

const speichern = vi.hoisted(() => ({ saveLocalMessagesStrict: vi.fn(async () => {}), updateMessageInLocalStore: vi.fn(async () => {}) }))
vi.mock('@/services/messengerLocalStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/messengerLocalStore')>(), ...speichern,
}))
vi.mock('@/services/nachrichtVersand', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/nachrichtVersand')>(),
  ladeAnhaengeHoch: vi.fn(async () => ({})),
  stelleZu: vi.fn(async () => ({ niedrigsteId: 1, verbindungsfehler: false, ueberInbox: true })),
}))
vi.mock('@/services/nutzlastSignatur', () => ({ signiereNutzlast: vi.fn(async (_mid: string, _id: number, payload: unknown) => payload) }))
vi.mock('@/lib/errungenschaft', () => ({ meldeErrungenschaft: vi.fn() }))

import { useMessengerSenden } from './useMessengerSenden'

beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

describe('Queue-Sendebestätigung', () => {
  it('bestätigt zwei Nachrichten sofort als sent, ohne beide unter ID 1 abzulegen', async () => {
    let messages: ChatMessage[] = []
    const identitaet = { state: 'ready', sendPair: { publicKeyJwk: 'synthetic-public' }, decryptionKeys: ['synthetic-private'] }
    const optionen = {
      t: (s: string) => s, currentUserId: 1, user: { username: 'test-sender' },
      activeContact: { userId: 2, username: 'test-peer' }, activeGroup: null, groups: [],
      blindMailboxId: 'dm', darfSchreiben: true, darfAnhaengen: true, darfFremdeLoeschen: false,
      editingMessage: null, setEditingMessage: vi.fn(), inputText: 'test message', setInputText: vi.fn(),
      antwortAuf: null, setAntwortAuf: vi.fn(), setSelectedImage: vi.fn(), setStagedFile: vi.fn(),
      setErwaehnungsVorschlaege: vi.fn(), verfallSekunden: 0,
      setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => { messages = fn(messages) },
      setSending: vi.fn(), setIdentity: vi.fn(), identityRef: { current: identitaet },
      maxPartnerReadIdRef: { current: 0 }, maxPartnerDeliveredIdRef: { current: 0 }, justSentRef: { current: false },
      lastTypingSentRef: { current: 0 }, sendeLaeuft: { current: false }, entwuerfe: { verwirf: vi.fn() },
      konversation: { baueVersand: vi.fn(async () => [{ ciphertext_envelope: 'test-cipher' }]) },
      loadMessages: vi.fn(async () => {}), sendeWirkung: vi.fn(), getOutbox: () => [], setOutbox: vi.fn(),
    } as unknown as Parameters<typeof useMessengerSenden>[0]
    const { handleSendMessage } = useMessengerSenden(optionen)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1792850000000).mockReturnValueOnce(1792850000001)
    await handleSendMessage()
    await handleSendMessage()
    const updates = speichern.updateMessageInLocalStore.mock.calls.map((call) => call[2]) as { id: number; status: string; viaInbox: boolean }[]
    expect(updates).toHaveLength(2)
    expect(updates.every((patch) => patch.status === 'sent' && patch.viaInbox && patch.id > 1)).toBe(true)
    expect(new Set(updates.map((patch) => patch.id)).size).toBe(2)
    expect(messages.every((message) => message.status === 'sent')).toBe(true)
  })
})
