/**
 * Der Messenger im Einheits-Transport.
 *
 * Die Krypto selbst pruefen `chatKrypto.test.ts` und `nachrichtVersand.test.ts`.
 * Hier zaehlt, was ein Nutzer sieht: ein entschluesseltes Gespraech, genau ein
 * Versand je Nachricht, eine nachgezogene Bearbeitung und eine abgewiesene
 * Frist, die sichtbar zurueckgenommen wird.
 */

import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/i18n'

import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import type { E2eeMessagePage } from '@/api/social'
import { stufenDativ } from '@/services/nachrichtVerfall'

// ---- Stellvertreter fuer Ablage, Server und Geraet ------------------------

const ablage = vi.hoisted(() => ({
  nachrichten: new Map<string, ChatMessage[]>(),
}))

function leereAblage() {
  ablage.nachrichten.clear()
}

function fuegeLokal(mid: string, msgs: ChatMessage[]) {
  const vorhanden = ablage.nachrichten.get(mid) ?? []
  const nachher = [...vorhanden]
  for (const m of msgs) {
    const stelle = nachher.findIndex(
      (v) => (m.clientUuid && v.clientUuid === m.clientUuid) || v.id === m.id,
    )
    if (stelle >= 0) nachher[stelle] = m
    else nachher.push(m)
  }
  ablage.nachrichten.set(mid, nachher)
}

vi.mock('@/services/messengerLocalStore', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/services/messengerLocalStore')>()
  return {
    ...echt,
    loadLocalMessages: vi.fn(async (mid: string) => ablage.nachrichten.get(mid) ?? []),
    saveLocalMessages: vi.fn(async (mid: string, msgs: ChatMessage[]) => fuegeLokal(mid, msgs)),
    saveLocalMessagesStrict: vi.fn(async (mid: string, msgs: ChatMessage[]) => fuegeLokal(mid, msgs)),
    updateMessageInLocalStore: vi.fn(async (mid: string, kennung: string | number, patch: Partial<ChatMessage>) => {
      const liste = ablage.nachrichten.get(mid) ?? []
      ablage.nachrichten.set(
        mid,
        liste.map((m) => (m.clientUuid === kennung || m.id === kennung ? { ...m, ...patch } : m)),
      )
    }),
    entferneLokaleNachricht: vi.fn(async (mid: string, kennung: { clientUuid?: string; id?: number }) => {
      const liste = ablage.nachrichten.get(mid) ?? []
      ablage.nachrichten.set(
        mid,
        liste.filter(
          (m) =>
            !(
              (kennung.clientUuid !== undefined && m.clientUuid === kennung.clientUuid) ||
              (typeof kennung.id === 'number' && m.id === kennung.id)
            ),
        ),
      )
    }),
    leereMailboxLokal: vi.fn(async (mid: string) => {
      ablage.nachrichten.delete(mid)
    }),
    ladeEntwurf: vi.fn(async () => null),
    sichereDauerhafteAblage: vi.fn(async () => {}),
    clearLocalMessengerStore: vi.fn(async () => leereAblage()),
  }
})

const serverStand = vi.hoisted(() => ({
  nachrichten: [] as ChatMessage[],
  seite: null as E2eeMessagePage | null,
}))

function setzeServer(messages: ChatMessage[]) {
  serverStand.nachrichten = messages
  serverStand.seite = {
    messages: [],
    pinned_message: null,
    has_more: false,
    my_last_delivered_id: 0,
    my_last_read_id: 0,
    partner_last_delivered_id: 0,
    partner_last_read_id: 0,
    ephemeral_ttl_seconds: 0,
    ephemeral_enabled_by_user_id: null,
  }
}

const conversation = vi.hoisted(() => {
  const objekt = {
    blindMailboxId: 'direct:peer:2',
    leseMailboxen: ['direct:peer:2'],
    chatType: 'direct' as const,
    chatId: 55,
    ensureChat: vi.fn(async () => ({ type: 'direct' as const, id: 55 })),
    liesUmschlaege: vi.fn(async () => null),
    liesNachrichten: vi.fn(async () => ({
      messages: serverStand.nachrichten,
      page: serverStand.seite,
      speicherId: 'direct:peer:2',
      chatType: 'direct',
      chatId: 55,
      hasMore: false,
      unlesbar: 0,
      uebernimm: () => {},
    })),
    ladeAeltere: vi.fn(async () => ({ messages: [], hasMore: false })),
    uebernimmLesestand: vi.fn(),
    verarbeiteEreignis: vi.fn(async (raw: { client_uuid?: string; chat_type?: string; chat_id?: number }, typ: string) => {
      if (raw.chat_type !== 'direct' || Number(raw.chat_id) !== 55) return null
      const vorhanden = serverStand.nachrichten.find(
        (m) => m.clientUuid === raw.client_uuid,
      )
      if (!vorhanden) return null
      if (typ === 'message_deleted') {
        return { ...vorhanden, isDeleted: true, text: '', deletedAt: '2026-10-25T10:00:01.000Z' }
      }
      return vorhanden
    }),
    baueVersand: vi.fn(async (payload: string, clientUuid: string) => [
      {
        blind_mailbox_id: 'direct:peer:2',
        ciphertext_envelope: `chiffrat:${payload}`,
        client_uuid: clientUuid,
        chat_type: 'direct' as const,
        chat_id: '55',
        key_version: 1,
      },
    ]),
    sendeWirkung: vi.fn(async () => 'gesendet' as const),
  }
  return objekt
})

vi.mock('@/hooks/useKonversation', () => ({
  useKonversation: () => conversation,
  baueVersandFuer: vi.fn(async () => []),
}))

const socket = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  isConnected: vi.fn(() => false),
  sendChatMessage: vi.fn(async (payload: { client_uuid: string }) => ({
    id: 900,
    client_uuid: payload.client_uuid,
  })),
  sendTyping: vi.fn(),
}))

vi.mock('@/services/messengerSocket', () => ({ messengerSocket: socket }))

const api = vi.hoisted(() => ({
  getFriends: vi.fn(),
  getGroups: vi.fn(),
  getStories: vi.fn(),
  getPublicProfiles: vi.fn(),
  startDirectChat: vi.fn(async () => ({ id: 55, other_user_id: 2 })),
  getChatEphemeral: vi.fn(async () => ({
    chat_type: 'direct',
    chat_id: 55,
    ephemeral_ttl_seconds: 0,
    ephemeral_enabled_by_user_id: null,
  })),
  setChatEphemeral: vi.fn(async (_typ: string, _id: number, sekunden: number) => ({
    chat_type: 'direct',
    chat_id: 55,
    ephemeral_ttl_seconds: sekunden,
    ephemeral_enabled_by_user_id: 1,
  })),
  sendTypingSignal: vi.fn(async () => ({ ok: true })),
  getFriendRequests: vi.fn(async () => ({ incoming: [], outgoing: [] })),
  acceptFriendRequest: vi.fn(async () => ({ ok: true, status: 'accepted', message: '' })),
  declineFriendRequest: vi.fn(async () => ({ ok: true, message: '' })),
}))

vi.mock('@/api/social', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/social')>()
  return { ...echt, ...api }
})

vi.mock('@/api/teams', () => ({
  teamsApi: { list: vi.fn(async () => []), get: vi.fn(async () => null) },
}))

vi.mock('@/services/e2eeIdentity', () => ({
  IDENTITY_LOADING: { state: 'loading', sendPair: null, decryptionKeys: [] },
  resolveIdentity: vi.fn(async () => ({
    state: 'ready',
    sendPair: { publicKeyJwk: '{}', privateKeyJwk: '{}' },
    decryptionKeys: ['{}'],
  })),
  getRecipientPublicKey: vi.fn(async () => '{}'),
  requireRecipientPublicKey: vi.fn(async () => '{}'),
  forgetRecipientPublicKey: vi.fn(),
  clearIdentityMemory: vi.fn(),
  E2eeRecipientKeyMissingError: class extends Error {},
  E2eeLockedError: class extends Error {},
}))

vi.mock('@/services/e2eeGeraet', () => ({
  eigenesGeraet: vi.fn(async () => null),
  eigenesGeraetFreigegeben: vi.fn(() => true),
  onEigeneFreigabe: vi.fn(() => () => {}),
  onSchluesselWarnung: vi.fn(() => () => {}),
  geraeteVon: vi.fn(async () => []),
  sicherheitsnummer: vi.fn(async () => ''),
  vergessenGeraete: vi.fn(),
  clearGeraeteMemory: vi.fn(),
}))

vi.mock('@/services/e2eeCrypto', () => ({
  scrubPlaintextStorage: vi.fn(),
  clearMemoryKeyStore: vi.fn(),
  decryptE2eeHybridWithKeyring: vi.fn(async () => ''),
}))

vi.mock('@/services/medienNachholen', () => ({ holeOffeneMedien: vi.fn(async () => {}) }))

vi.mock('@/lib/offlineSync', () => ({
  loadNotesOfflineFirst: vi.fn(async () => ({ notes: [] })),
  loadCalendarEventsOfflineFirst: vi.fn(async () => ({ events: [] })),
  saveNoteOffline: vi.fn(async () => ({ id: 1, title: 'Mock' })),
  saveCalendarEventOffline: vi.fn(async () => ({ id: 1, title: 'Mock' })),
  enqueueMessageMutation: vi.fn(() => ({ id: 'mock-mutation' })),
  getOutbox: vi.fn(() => []),
  setOutbox: vi.fn(),
  replayOutbox: vi.fn(async () => ({ processed: 0, failed: 0, remaining: 0 })),
}))

import { Messenger } from './Messenger'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { leereGespraeche } from '@/services/gespraechsListe'
import { leereKlartextSpeicher } from '@/services/klartextSpeicher'

beforeAll(async () => {
  await i18n.changeLanguage('de')
})

function nachricht(zusatz: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 5,
    clientUuid: 'eingehend-1',
    senderId: 2,
    senderName: 'alice',
    text: 'Hallo von Alice',
    createdAt: '2026-10-24T10:00:00.000Z',
    isSelf: false,
    status: 'sent',
    ...zusatz,
  }
}

async function oeffneChat() {
  render(
    <MemoryRouter>
      <Messenger />
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByText('alice'))
}

beforeEach(() => {
  vi.clearAllMocks()
  leereAblage()
  leereGespraeche()
  leereKlartextSpeicher()
  useToastStore.getState().clearAll()
  sessionStorage.clear()
  localStorage.clear()
  setzeServer([nachricht()])
  conversation.sendeWirkung.mockResolvedValue('gesendet')

  useAuthStore.setState({
    user: {
      id: 1,
      username: 'me',
      email: 'me@example.test',
      is_owner: false,
      is_active: true,
      email_verified: true,
      two_factor_enabled: false,
      email_notifications: false,
      ai_notifications: false,
      device_notifications: false,
      role_id: null,
      created_at: '2026-08-28T00:00:00Z',
    },
    isAuthenticated: true,
  })

  api.getFriends.mockResolvedValue([
    {
      id: 101,
      user_id: 2,
      username: 'alice',
      avatar_url: null,
      status: 'accepted',
      is_requester: false,
      created_at: '2026-09-01T00:00:00Z',
      presence: { status: 'online', device_type: 'web', activity_label: null, activity_detail: null },
    },
  ])
  api.getGroups.mockResolvedValue([])
  api.getStories.mockResolvedValue([])
  api.getPublicProfiles.mockResolvedValue([])
})

describe('Messenger im Einheits-Transport', () => {
  it('zeigt eine entschluesselte eingehende Nachricht im Direktchat', async () => {
    await oeffneChat()
    expect(await screen.findByText('Hallo von Alice')).toBeInTheDocument()
  })

  it('geht mit Zurück aus dem Chat in die Liste, statt die App zu verlassen', async () => {
    // Unter Android geht Zurück im WebView einen Verlaufsschritt zurück; ohne
    // Eintrag beendet sie die App. Bis 27.10.2026 legte der offene Chat keinen
    // an, und die Systemgeste warf den Nutzer aus der App.
    await oeffneChat()
    const feld = await screen.findByPlaceholderText('Nachricht schreiben …')
    await waitFor(() => expect(window.history.state?.msmTiefe ?? 0).toBeGreaterThan(0))

    act(() => window.history.back())

    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Nachricht schreiben …')).not.toBeInTheDocument(),
    )
    expect(feld).not.toBeInTheDocument()
  })

  it('sendet einen Text genau einmal und zeigt die eigene Zeile', async () => {
    await oeffneChat()
    const feld = await screen.findByPlaceholderText('Nachricht schreiben …')
    await waitFor(() => expect(feld).not.toBeDisabled())
    fireEvent.change(feld, { target: { value: 'Bis spaeter' } })
    fireEvent.keyDown(feld, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(socket.sendChatMessage).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Bis spaeter')).toBeInTheDocument()
    expect(socket.sendChatMessage.mock.calls[0][0]).toMatchObject({
      chat_type: 'direct',
      chat_id: 55,
      key_version: 1,
      encrypted_payload: expect.stringContaining('Bis spaeter'),
    })
  })

  it('zieht den Text einer Bearbeitung nach, wenn message_updated eintrifft', async () => {
    await oeffneChat()
    expect(await screen.findByText('Hallo von Alice')).toBeInTheDocument()

    const berichtigt = nachricht({ text: 'Hallo, berichtigt', isEdited: true })
    setzeServer([berichtigt])
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('msm:sync-event', {
          detail: {
            type: 'message_updated',
            chat_type: 'direct',
            chat_id: 55,
            message: {
              ...berichtigt,
              client_uuid: 'eingehend-1',
              chat_type: 'direct',
              chat_id: 55,
              encrypted_payload: 'chiffrat',
              key_version: 1,
              sender_user_id: 2,
            },
          },
        }),
      )
    })

    expect(await screen.findByText('Hallo, berichtigt')).toBeInTheDocument()
    expect(screen.queryByText('Hallo von Alice')).not.toBeInTheDocument()
  })

  it('setzt bei einer Quittung sofort den gelesen-Haken', async () => {
    setzeServer([
      nachricht(),
      {
        ...nachricht(),
        id: 90,
        clientUuid: 'eigen-1',
        senderId: 1,
        senderName: 'me',
        isSelf: true,
        text: 'Meine Nachricht',
        status: 'sent',
      },
    ])
    await oeffneChat()
    expect(await screen.findByText('Meine Nachricht')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('msm:read-receipt', {
          detail: {
            type: 'read_receipt',
            chat_type: 'direct',
            chat_id: 55,
            up_to_id: 90,
          },
        }),
      )
    })

    expect(await screen.findByLabelText(i18n.t('messenger.stateRead'))).toBeInTheDocument()
  })

  it('nimmt eine Loeschung aus message_deleted sofort aus dem Verlauf', async () => {
    await oeffneChat()
    expect(await screen.findByText('Hallo von Alice')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('msm:sync-event', {
          detail: {
            type: 'message_deleted',
            chat_type: 'direct',
            chat_id: 55,
            message: {
              ...nachricht(),
              client_uuid: 'eingehend-1',
              chat_type: 'direct',
              chat_id: 55,
              encrypted_payload: '',
              key_version: 1,
              sender_user_id: 2,
              is_deleted: true,
            },
          },
        }),
      )
    })

    expect(await screen.findByText(i18n.t('messenger.messageWasDeleted'))).toBeInTheDocument()
    expect(screen.queryByText('Hallo von Alice')).not.toBeInTheDocument()
  })

  it('zeigt eine live angeheftete Nachricht in der Leiste', async () => {
    await oeffneChat()
    expect(await screen.findByText('Hallo von Alice')).toBeInTheDocument()

    const angeheftet = nachricht({ isPinned: true, pinnedAt: '2026-10-24T11:00:00.000Z' })
    setzeServer([angeheftet])
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('msm:sync-event', {
          detail: {
            type: 'message_updated',
            chat_type: 'direct',
            chat_id: 55,
            message: {
              ...angeheftet,
              client_uuid: 'eingehend-1',
              chat_type: 'direct',
              chat_id: 55,
              encrypted_payload: 'chiffrat',
              key_version: 1,
              sender_user_id: 2,
              is_pinned: true,
            },
          },
        }),
      )
    })

    expect(await screen.findByText('Angeheftet')).toBeInTheDocument()
  })

  it('zeigt einen Verfall-Wechsel einmal, auch wenn das eigene Ereignis zurueckkommt', async () => {
    await oeffneChat()
    expect(await screen.findByText('Hallo von Alice')).toBeInTheDocument()
    const zeile = i18n.t('messenger.retentionSetOther', {
      name: i18n.t('messenger.retentionYou'),
      frist: stufenDativ(3600, i18n.t),
    })
    const ereignis = {
      type: 'chat_ephemeral',
      chat_type: 'direct',
      chat_id: 55,
      ephemeral_ttl_seconds: 3600,
      ephemeral_enabled_by_user_id: 1,
    }

    await act(async () => {
      window.dispatchEvent(new CustomEvent('msm:sync-event', { detail: ereignis }))
    })
    expect(await screen.findByText(zeile)).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new CustomEvent('msm:sync-event', { detail: ereignis }))
    })
    expect(screen.getAllByText(zeile)).toHaveLength(1)
  })

  it('setzt die Verfallsfrist beim Server, damit sie allen Mitgliedern gilt', async () => {
    await oeffneChat()

    fireEvent.click(await screen.findByLabelText(i18n.t('messenger.moreChatSettings')))
    fireEvent.click(await screen.findByText(i18n.t('messenger.disappearingMessages')))
    fireEvent.click(await screen.findByText(i18n.t('messenger.retention.h24')))

    await waitFor(() =>
      expect(api.setChatEphemeral).toHaveBeenCalledWith('direct', 55, 86400),
    )
  })

  it('nimmt eine mit 403 abgewiesene Verfallsfrist zurueck und sagt es', async () => {
    api.setChatEphemeral.mockRejectedValueOnce({ status: 403 })
    conversation.sendeWirkung.mockRejectedValueOnce({ status: 403 })
    await oeffneChat()

    fireEvent.click(await screen.findByLabelText(i18n.t('messenger.moreChatSettings')))
    fireEvent.click(await screen.findByText(i18n.t('messenger.disappearingMessages')))
    fireEvent.click(await screen.findByText(i18n.t('messenger.retention.h24')))

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        i18n.t('messenger.actionRejected'),
      ),
    )

    fireEvent.click(await screen.findByLabelText(i18n.t('messenger.moreChatSettings')))
    const eintrag = await screen.findByRole('button', {
      name: new RegExp(i18n.t('messenger.disappearingMessages')),
    })
    expect(within(eintrag).getByText(i18n.t('messenger.retention.off'))).toBeInTheDocument()
    // Der Server hat abgelehnt; eine Wirkung zusätzlich zu schicken wäre
    // zwecklos — sie würde denselben Fehler nur an die Gegenseite weitergeben.
    expect(conversation.sendeWirkung).not.toHaveBeenCalled()
  })
})
