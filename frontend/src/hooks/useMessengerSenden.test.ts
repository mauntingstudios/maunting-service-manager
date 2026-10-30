import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'

const speichern = vi.hoisted(() => ({
  saveLocalMessagesStrict: vi.fn(async () => {}),
  updateMessageInLocalStore: vi.fn(async () => {}),
}))
const zustellen = vi.hoisted(() => ({ stelleZu: vi.fn() }))
vi.mock('@/services/messengerLocalStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/messengerLocalStore')>(), ...speichern,
}))
vi.mock('@/services/nachrichtVersand', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/nachrichtVersand')>(),
  ladeAnhaengeHoch: vi.fn(async () => ({})),
  stelleZu: zustellen.stelleZu,
}))
vi.mock('@/services/nutzlastSignatur', () => ({ signiereNutzlast: vi.fn(async (_mid: string, _id: number, payload: unknown) => payload) }))
vi.mock('@/lib/errungenschaft', () => ({ meldeErrungenschaft: vi.fn() }))

import { ChatSchluesselFehltError } from '@/services/chatKrypto'
import { KontoSchluesselNichtUebertragenError } from '@/services/accountKeys'
import { NachrichtAbgewiesenError } from '@/services/nachrichtVersand'
import { toast } from '@/stores/toastStore'
import { useMessengerSenden } from './useMessengerSenden'

function optionenFuer(
  nachrichten: { current: ChatMessage[] },
  extra: Record<string, unknown> = {},
) {
  const identitaet = {
    state: 'ready',
    sendPair: { publicKeyJwk: 'synthetic-public' },
    decryptionKeys: ['synthetic-private'],
  }
  const konversation = {
    ensureChat: vi.fn(async () => ({ type: 'direct', id: 55 })),
    baueVersand: vi.fn(async (_payload: string, clientUuid: string) => [{
      blind_mailbox_id: 'dm',
      ciphertext_envelope: 'test-cipher',
      client_uuid: clientUuid,
      chat_type: 'direct',
      chat_id: '55',
      key_version: 1,
    }]),
    erneuereSchluessel: vi.fn(async () => {}),
    ...(extra.konversation as object | undefined),
  }
  return {
    t: (s: string) => s,
    currentUserId: 1,
    user: { username: 'test-sender' },
    activeContact: { userId: 2, username: 'test-peer' },
    activeGroup: null,
    groups: [],
    blindMailboxId: 'dm',
    darfSchreiben: true,
    darfAnhaengen: true,
    darfFremdeLoeschen: false,
    editingMessage: null,
    setEditingMessage: vi.fn(),
    inputText: 'test message',
    setInputText: vi.fn(),
    antwortAuf: null,
    setAntwortAuf: vi.fn(),
    setSelectedImage: vi.fn(),
    setStagedFile: vi.fn(),
    setErwaehnungsVorschlaege: vi.fn(),
    verfallSekunden: 0,
    setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => {
      nachrichten.current = fn(nachrichten.current)
    },
    setSending: vi.fn(),
    setIdentity: vi.fn(),
    identityRef: { current: identitaet },
    maxPartnerReadIdRef: { current: 0 },
    maxPartnerDeliveredIdRef: { current: 0 },
    justSentRef: { current: false },
    lastTypingSentRef: { current: 0 },
    sendeLaeuft: { current: false },
    entwuerfe: { verwirf: vi.fn() },
    konversation,
    loadMessages: vi.fn(async () => {}),
    sendeWirkung: vi.fn(),
    getOutbox: () => [],
    setOutbox: vi.fn(),
    ...extra,
  } as unknown as Parameters<typeof useMessengerSenden>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  zustellen.stelleZu
    .mockResolvedValueOnce({ niedrigsteId: 11, verbindungsfehler: false })
    .mockResolvedValueOnce({ niedrigsteId: 12, verbindungsfehler: false })
})

describe('Sendebestätigung im Einheits-Transport', () => {
  it('bestätigt zwei Nachrichten als sent, jede unter ihrer Serverkennung', async () => {
    const nachrichten: { current: ChatMessage[] } = { current: [] }
    const optionen = optionenFuer(nachrichten)
    const { handleSendMessage } = useMessengerSenden(optionen)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1792850000000).mockReturnValueOnce(1792850000001)
    await handleSendMessage()
    await handleSendMessage()
    const updates = speichern.updateMessageInLocalStore.mock.calls.map((call) => call[2]) as { id: number; status: string; viaInbox?: boolean }[]
    expect(updates).toHaveLength(2)
    expect(updates.every((patch) => patch.status === 'sent' && patch.viaInbox === undefined)).toBe(true)
    expect(updates.map((patch) => patch.id)).toEqual([11, 12])
    expect(nachrichten.current.every((message) => message.status === 'sent')).toBe(true)
  })

  it('gibt false zurück und lässt eine abgelehnte Nachricht als failed stehen', async () => {
    const nachrichten: { current: ChatMessage[] } = { current: [] }
    zustellen.stelleZu.mockReset().mockRejectedValueOnce(new NachrichtAbgewiesenError(403))
    const { handleSendMessage } = useMessengerSenden(optionenFuer(nachrichten))

    const angenommen = await handleSendMessage()

    expect(angenommen).toBe(false)
    expect(nachrichten.current).toHaveLength(1)
    expect(nachrichten.current[0].status).toBe('failed')
    expect(speichern.updateMessageInLocalStore).toHaveBeenLastCalledWith(
      'dm',
      expect.any(String),
      expect.objectContaining({ status: 'failed' }),
    )
  })

  it('gibt false zurück und entfernt die Zeile, wenn der Schlüssel fehlt', async () => {
    const nachrichten: { current: ChatMessage[] } = { current: [] }
    const fehler = vi.spyOn(toast, 'error').mockImplementation(() => {})
    const optionen = optionenFuer(nachrichten, {
      konversation: {
        ensureChat: vi.fn(async () => ({ type: 'direct', id: 55 })),
        baueVersand: vi.fn(async () => {
          throw new ChatSchluesselFehltError()
        }),
        erneuereSchluessel: vi.fn(async () => {}),
      },
    })
    const { handleSendMessage } = useMessengerSenden(optionen)

    const angenommen = await handleSendMessage()

    expect(angenommen).toBe(false)
    expect(nachrichten.current).toHaveLength(0)
    expect(fehler).toHaveBeenCalledWith('messenger.chatKeyMissing')
    fehler.mockRestore()
  })

  it('nennt den noch nicht übertragenen Kontoschlüssel beim Namen', async () => {
    const nachrichten: { current: ChatMessage[] } = { current: [] }
    const fehler = vi.spyOn(toast, 'error').mockImplementation(() => {})
    const optionen = optionenFuer(nachrichten, {
      konversation: {
        ensureChat: vi.fn(async () => ({ type: 'direct', id: 55 })),
        baueVersand: vi.fn(async () => {
          throw new KontoSchluesselNichtUebertragenError()
        }),
        erneuereSchluessel: vi.fn(async () => {}),
      },
    })
    const { handleSendMessage } = useMessengerSenden(optionen)

    const angenommen = await handleSendMessage()

    expect(angenommen).toBe(false)
    expect(fehler).toHaveBeenCalledWith('messenger.accountKeyMissing')
    fehler.mockRestore()
  })

  it('nennt einen nicht geöffneten Chat, wenn ensureChat leer bleibt', async () => {
    const nachrichten: { current: ChatMessage[] } = { current: [] }
    const fehler = vi.spyOn(toast, 'error').mockImplementation(() => {})
    const optionen = optionenFuer(nachrichten, {
      konversation: {
        ensureChat: vi.fn(async () => null),
        baueVersand: vi.fn(),
        erneuereSchluessel: vi.fn(async () => {}),
      },
    })
    const { handleSendMessage } = useMessengerSenden(optionen)

    const angenommen = await handleSendMessage()

    expect(angenommen).toBe(false)
    expect(fehler).toHaveBeenCalledWith('messenger.chatOpenFailed')
    fehler.mockRestore()
  })

  it('macht aus 429 eine queued-Zeile mit Outbox-Auftrag, nicht failed', async () => {
    const nachrichten: { current: ChatMessage[] } = { current: [] }
    zustellen.stelleZu.mockReset().mockResolvedValueOnce({
      niedrigsteId: 0,
      verbindungsfehler: true,
    })
    const { handleSendMessage } = useMessengerSenden(optionenFuer(nachrichten))

    const angenommen = await handleSendMessage()

    expect(angenommen).toBe(true)
    expect(nachrichten.current).toHaveLength(1)
    expect(nachrichten.current[0].status).toBe('queued')
  })

  it('nutzt bei einer Wiederholung dieselbe Zeile und dieselbe Kennung', async () => {
    const nachrichten: { current: ChatMessage[] } = {
      current: [{
        id: 77,
        clientUuid: 'u-fix',
        senderId: 1,
        senderName: 'test-sender',
        text: 'test message',
        createdAt: '2026-10-26T12:00:00.000Z',
        isSelf: true,
        status: 'failed',
      }],
    }
    zustellen.stelleZu.mockReset().mockResolvedValueOnce({
      niedrigsteId: 11,
      verbindungsfehler: false,
    })
    const { handleSendMessage } = useMessengerSenden(optionenFuer(nachrichten))

    const angenommen = await handleSendMessage({
      text: 'test message',
      wiederholung: { clientUuid: 'u-fix', id: 77 },
    })

    expect(angenommen).toBe(true)
    expect(nachrichten.current).toHaveLength(1)
    expect(nachrichten.current[0].clientUuid).toBe('u-fix')
    expect(nachrichten.current[0].status).toBe('sent')
  })
})
