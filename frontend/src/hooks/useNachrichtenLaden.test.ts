import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

/**
 * Laden, Haekchen und Cursor im Einheits-Transport.
 *
 * Der Server liefert die Wasserstaende mit der Seite. Diese Probe haelt fest,
 * dass sie auf die eigenen Zeilen wirken, dass Quittungen erst nach dem
 * Speichern hinausgehen und dass ein blockierter oder unsichtbarer Chat
 * nichts als gelesen meldet.
 */

const api = vi.hoisted(() => ({
  ackChatMessages: vi.fn(async () => ({ ok: true, last_delivered_message_id: 0 })),
  readChatMessages: vi.fn(async () => ({ ok: true, last_read_message_id: 0 })),
}))

const ablage = vi.hoisted(() => ({
  loadLocalMessages: vi.fn(async () => [] as unknown[]),
  saveLocalMessagesStrict: vi.fn(async () => {}),
  mischeVerlauf: vi.fn((a: unknown[], b: unknown[]) => [...a, ...b]),
  sortMessagesChronologically: vi.fn((liste: unknown[]) => liste),
}))

const funken = vi.hoisted(() => ({ nimmAuf: vi.fn(async () => {}) }))

const medien = vi.hoisted(() => ({
  sichereAnhaenge: vi.fn(async () => ({ gesichert: 0, offen: 0 })),
}))
const medienNachholen = vi.hoisted(() => ({ holeOffeneMedien: vi.fn(async () => {}) }))

vi.mock('@/api/social', () => api)
vi.mock('@/services/messengerLocalStore', () => ablage)
vi.mock('@/services/medienSicherung', () => medien)
vi.mock('@/services/medienNachholen', () => medienNachholen)
vi.mock('@/services/quittungsstand', () => ({
  merkePartnerQuittung: vi.fn(),
  merkeQuittung: vi.fn(),
}))
vi.mock('@/stores/funkenStore', () => ({
  useFunkenStore: { getState: () => funken },
}))

import { sessionChatCache } from '@/services/klartextSpeicher'
import { useNachrichtenLaden, type NachrichtenLadenOptionen } from './useNachrichtenLaden'

function zeile(id: number, isSelf: boolean) {
  return {
    id,
    clientUuid: `u-${id}`,
    senderId: isSelf ? 1 : 2,
    text: '',
    createdAt: '2026-10-25T10:00:00.000Z',
    isSelf,
  }
}

type Seite = {
  messages: ReturnType<typeof zeile>[]
  page: {
    messages: unknown[]
    pinned_message?: unknown
    has_more: boolean
    my_last_delivered_id: number
    my_last_read_id: number
    partner_last_delivered_id: number
    partner_last_read_id: number
    ephemeral_ttl_seconds: number
    ephemeral_enabled_by_user_id: number | null
  }
  speicherId: string
  chatType: 'direct' | 'group'
  chatId: number
  hasMore: boolean
  unlesbar: number
  offen: number
  uebernimm: () => void
}

function seite(
  messages: ReturnType<typeof zeile>[],
  partnerGelesen = 0,
  partnerZugestellt = 0,
): Seite {
  return {
    messages,
    page: {
      messages,
      pinned_message: null,
      has_more: false,
      my_last_delivered_id: 0,
      my_last_read_id: 0,
      partner_last_delivered_id: partnerZugestellt,
      partner_last_read_id: partnerGelesen,
      ephemeral_ttl_seconds: 0,
      ephemeral_enabled_by_user_id: null,
    },
    speicherId: 'direct:peer:2',
    chatType: 'direct',
    chatId: 2,
    hasMore: false,
    unlesbar: 0,
    offen: 0,
    uebernimm: vi.fn(),
  }
}

function optionen(over: Partial<NachrichtenLadenOptionen> = {}): NachrichtenLadenOptionen {
  const gelesen = seite([zeile(9, false)], 0, 0)
  const nachrichten = over.messages ?? []
  return {
    blindMailboxId: 'direct:peer:2',
    currentUserId: 1,
    activeContact: { userId: 2 } as never,
    activeGroup: null,
    gruppenrechteVon: () => new Set(),
    t: (s: string) => s,
    messages: nachrichten,
    messagesRef: { current: nachrichten },
    hatMehrRef: { current: true },
    laedtAeltereRef: { current: false },
    setMessages: vi.fn(),
    setLoadingMessages: vi.fn(),
    setAngeheftet: vi.fn(),
    setVerfallSekunden: vi.fn(),
    zeigeSystemzeile: vi.fn(),
    markAsRead: vi.fn(),
    isBlocked: () => false,
    readReceiptsEnabled: true,
    konversation: {
      chatType: 'direct',
      chatId: 2,
      liesNachrichten: vi.fn(async () => gelesen),
      ladeAeltere: vi.fn(async () => seite([])),
    } as never,
    identityRef: { current: null },
    activeMailboxIdRef: { current: 'direct:peer:2' },
    currentLoadSeqRef: { current: 0 },
    maxPartnerReadIdRef: { current: 0 },
    maxPartnerDeliveredIdRef: { current: 0 },
    highestIncomingIdDeliveredRef: { current: 0 },
    highestIncomingIdAcknowledgedRef: { current: 0 },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.mocked(ablage.loadLocalMessages).mockResolvedValue([])
})

describe('Chat-Identitaet', () => {
  it('verwirft eine Seite, die zu einer anderen speicherId gehoert', async () => {
    const opts = optionen()
    const fremd = seite([zeile(9, false)])
    fremd.speicherId = 'direct:peer:3'
    vi.mocked(opts.konversation.liesNachrichten).mockResolvedValue(fremd)

    await useNachrichtenLaden(opts).loadMessages(true)

    expect(ablage.saveLocalMessagesStrict).not.toHaveBeenCalled()
    expect(api.ackChatMessages).not.toHaveBeenCalled()
  })

  it('quittiert mit der chatId, die die Seite wirklich geholt hat', async () => {
    const opts = optionen()
    const gelesen = seite([zeile(9, false)])
    gelesen.chatId = 77
    vi.mocked(opts.konversation.liesNachrichten).mockResolvedValue(gelesen)
    opts.konversation.chatId = null

    await useNachrichtenLaden(opts).loadMessages(true)

    expect(api.ackChatMessages).toHaveBeenCalledWith('direct', 77, 9)
    expect(api.readChatMessages).toHaveBeenCalledWith('direct', 77, 9)
  })
})

describe('Quittungen im Einheits-Transport', () => {
  it('legt den geladenen Verlauf in den Sitzungscache', async () => {
    sessionChatCache.clear()
    const opts = optionen()

    await useNachrichtenLaden(opts).loadMessages(true)

    expect(sessionChatCache.get('direct:peer:2')?.some((m) => m.id === 9)).toBe(true)
  })

  it('speichert, dann quittiert es Zustellung und Lesen', async () => {
    const opts = optionen()
    await useNachrichtenLaden(opts).loadMessages(true)

    expect(ablage.saveLocalMessagesStrict).toHaveBeenCalled()
    expect(api.ackChatMessages).toHaveBeenCalledWith('direct', 2, 9)
    expect(api.readChatMessages).toHaveBeenCalledWith('direct', 2, 9)
    expect(opts.markAsRead).toHaveBeenCalledWith('direct:peer:2')
  })

  it('sichert empfangene Anhänge erst nach dem lokalen Commit', async () => {
    const opts = optionen()
    await useNachrichtenLaden(opts).loadMessages(true)

    await waitFor(() => {
      expect(medien.sichereAnhaenge).toHaveBeenCalledWith(expect.any(Array), 'direct:peer:2')
      expect(medienNachholen.holeOffeneMedien).toHaveBeenCalled()
    })
    expect(medien.sichereAnhaenge.mock.invocationCallOrder[0]).toBeGreaterThan(
      ablage.saveLocalMessagesStrict.mock.invocationCallOrder[0],
    )
  })

  it('quittiert keine zweite Runde fuer dieselbe Kennung', async () => {
    const opts = optionen()
    const laden = useNachrichtenLaden(opts)
    await laden.loadMessages()
    await laden.loadMessages()
    expect(api.ackChatMessages).toHaveBeenCalledTimes(1)
    expect(api.readChatMessages).toHaveBeenCalledTimes(1)
  })

  it('meldet im unsichtbaren Chat nichts als gelesen', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const opts = optionen()
    await useNachrichtenLaden(opts).loadMessages()
    expect(api.ackChatMessages).toHaveBeenCalled()
    expect(api.readChatMessages).not.toHaveBeenCalled()
  })

  it('quittiert bei einem blockierten Gegenueber gar nichts', async () => {
    const opts = optionen({ isBlocked: () => true })
    await useNachrichtenLaden(opts).loadMessages()
    expect(api.ackChatMessages).not.toHaveBeenCalled()
    expect(api.readChatMessages).not.toHaveBeenCalled()
  })

  it('laesst in Gruppen jede Zustell- und Lesequittung aus', async () => {
    const opts = optionen({
      activeGroup: { id: 3, members: [] } as never,
      konversation: {
        chatType: 'group',
        chatId: 3,
        liesNachrichten: vi.fn(async () => seite([zeile(9, false)])),
        ladeAeltere: vi.fn(async () => seite([])),
      } as never,
    })
    await useNachrichtenLaden(opts).loadMessages()
    expect(api.ackChatMessages).not.toHaveBeenCalled()
    expect(api.readChatMessages).not.toHaveBeenCalled()
  })
})

describe('Haekchen aus den Wasserstaenden', () => {
  it('macht aus gesendet Zugestellt und Gelesen, ohne zurueckzufallen', async () => {
    vi.mocked(ablage.loadLocalMessages).mockResolvedValue([
      { ...zeile(5, true), status: 'sent' },
      { ...zeile(6, true), status: 'sent' },
    ])
    const opts = optionen({
      konversation: {
        chatType: 'direct',
        chatId: 2,
        liesNachrichten: vi.fn(async () => seite([zeile(9, false)], 5, 6)),
        ladeAeltere: vi.fn(async () => seite([])),
      } as never,
    })
    await useNachrichtenLaden(opts).loadMessages()
    const gesetzt = vi.mocked(opts.setMessages).mock.calls.at(-1)![0] as never as (
      | { id: number; status?: string; isRead?: boolean; isDelivered?: boolean }[]
    )
    const nachId = new Map(gesetzt.map((m) => [m.id, m]))
    expect(nachId.get(5)).toMatchObject({ status: 'read', isRead: true, isDelivered: true })
    expect(nachId.get(6)).toMatchObject({ status: 'delivered', isDelivered: true })
  })

  it('holt den Stand nach, der waehrend einer Offline-Zeit entstanden ist', async () => {
    vi.mocked(ablage.loadLocalMessages).mockResolvedValue([{ ...zeile(5, true), status: 'sent' }])
    const lies = vi
      .fn()
      .mockResolvedValueOnce(seite([], 0, 0))
      .mockResolvedValueOnce(seite([], 5, 5))
    const opts = optionen({
      konversation: {
        chatType: 'direct',
        chatId: 2,
        liesNachrichten: lies,
        ladeAeltere: vi.fn(async () => seite([])),
      } as never,
    })
    const laden = useNachrichtenLaden(opts)
    await laden.loadMessages()
    await laden.loadMessages()
    const gesetzt = vi.mocked(opts.setMessages).mock.calls.at(-1)![0] as never as {
      id: number
      status?: string
    }[]
    expect(gesetzt.find((m) => m.id === 5)?.status).toBe('read')
  })
})

describe('Augenblicke im offenen Chat', () => {
  it('gibt einen eingehenden Augenblick an den Funken-Store, auch wenn der Chat offen ist', async () => {
    const opts = optionen()
    const eingehend = {
      ...zeile(9, false),
      augenblick: { zeitpunkt: '2026-10-25T10:00:00.000Z' },
    }
    vi.mocked(opts.konversation.liesNachrichten).mockResolvedValue(seite([eingehend]) as never)

    await useNachrichtenLaden(opts).loadMessages()

    await waitFor(() =>
      expect(funken.nimmAuf).toHaveBeenCalledWith(2, [
        expect.objectContaining({ art: 'augenblick', von: 2, kennung: '2:u-9' }),
      ]),
    )
  })
})

describe('Cursor', () => {
  it('setzt nach einem Chatwechsel während des Speicherns keinen Cursor', async () => {
    let speichernFertig: (() => void) | undefined
    ablage.saveLocalMessagesStrict.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        speichernFertig = resolve
      }),
    )
    const gelesen = seite([zeile(9, false)])
    const opts = optionen({
      konversation: {
        chatType: 'direct',
        chatId: 2,
        liesNachrichten: vi.fn(async () => gelesen),
        ladeAeltere: vi.fn(async () => seite([])),
      } as never,
    })
    const { loadMessages } = useNachrichtenLaden(opts)
    const lauf = loadMessages()

    await waitFor(() => expect(ablage.saveLocalMessagesStrict).toHaveBeenCalledOnce())
    opts.activeMailboxIdRef.current = 'direct:peer:3'
    opts.currentLoadSeqRef.current += 1
    speichernFertig?.()
    await lauf

    expect(gelesen.uebernimm).not.toHaveBeenCalled()
  })

  it('laedt aeltere Nachrichten vor der aeltesten bekannten Kennung', async () => {
    const ladeAeltere = vi.fn(async () => seite([zeile(1, false)]))
    const opts = optionen({
      messages: [zeile(50, false), zeile(51, false)] as never,
      konversation: {
        chatType: 'direct',
        chatId: 2,
        liesNachrichten: vi.fn(async () => seite([])),
        ladeAeltere,
      } as never,
    })
    await useNachrichtenLaden(opts).ladeAeltere()
    expect(ladeAeltere).toHaveBeenCalledWith(50)
  })
})
