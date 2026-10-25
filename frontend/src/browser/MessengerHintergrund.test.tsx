import { render, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identitaet = vi.hoisted(() => ({
  resolveIdentity: vi.fn(async () => ({ state: 'ready', decryptionKeys: ['k'] })),
}))
const geraet = vi.hoisted(() => ({
  eigenesGeraet: vi.fn(async () => ({ kennung: 'testgeraet', paar: null })),
}))
const socket = vi.hoisted(() => ({ connect: vi.fn() }))
const melden = vi.hoisted(() => ({ meldeChat: vi.fn() }))
const krypto = vi.hoisted(() => ({ entpackeChatNutzlast: vi.fn(async () => ({})) }))
const quittung = vi.hoisted(() => ({ ackChatMessages: vi.fn(async () => ({})) }))

vi.mock('@/services/e2eeIdentity', () => ({
  IDENTITY_LOADING: { state: 'loading' },
  ...identitaet,
}))
vi.mock('@/services/e2eeGeraet', () => geraet)
vi.mock('@/services/messengerSocket', () => ({ messengerSocket: socket }))
vi.mock('@/services/benachrichtigung/chatMeldung', () => melden)
vi.mock('@/services/chatKrypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/chatKrypto')>()),
  ...krypto,
}))
vi.mock('@/api/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/social')>()),
  ...quittung,
}))

import { useAuthStore } from '@/stores/authStore'
import { useMessengerSperre } from '@/services/messengerSperre'

import { MessengerHintergrund } from './MessengerHintergrund'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: 1, username: 'alpha' } as never,
  })
  useMessengerSperre.setState({ eingerichtet: false, entsperrt: true })
})

async function ereignis(detail: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('msm:sync-event', { detail }))
  })
}

describe('MessengerHintergrund', () => {
  it('löst die Identität und verbindet das eigene Gerät', async () => {
    render(<MessengerHintergrund />)

    await waitFor(() => expect(identitaet.resolveIdentity).toHaveBeenCalledWith(1))
    expect(geraet.eigenesGeraet).toHaveBeenCalled()
    expect(socket.connect).toHaveBeenCalledWith('testgeraet')
  })

  it('läuft nicht, solange der Messenger gesperrt ist', async () => {
    useMessengerSperre.setState({ eingerichtet: true, entsperrt: false })

    render(<MessengerHintergrund />)

    await act(async () => {})
    expect(identitaet.resolveIdentity).not.toHaveBeenCalled()
    expect(socket.connect).not.toHaveBeenCalled()
  })

  it('meldet eine neue Nachricht über die gemeinsame Meldestelle', async () => {
    render(<MessengerHintergrund />)
    await waitFor(() => expect(identitaet.resolveIdentity).toHaveBeenCalled())

    await ereignis({
      type: 'message_created',
      chat_type: 'direct',
      chat_id: 55,
      sender_user_id: 2,
      client_uuid: 'u-1',
    })

    expect(melden.meldeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox: 'direct:peer:2',
        clientUuid: 'u-1',
        senderId: 2,
        istGruppe: false,
      }),
    )
  })

  it('meldet die eigene Nachricht nicht', async () => {
    render(<MessengerHintergrund />)
    await waitFor(() => expect(identitaet.resolveIdentity).toHaveBeenCalled())

    await ereignis({
      type: 'message_created',
      chat_type: 'direct',
      chat_id: 55,
      sender_user_id: 1,
      client_uuid: 'u-2',
    })

    expect(melden.meldeChat).not.toHaveBeenCalled()
  })

  it('quittiert eine Nachricht, deren Chiffretext sich hier oeffnen laesst', async () => {
    render(<MessengerHintergrund />)
    await waitFor(() => expect(identitaet.resolveIdentity).toHaveBeenCalled())

    await ereignis({
      type: 'message_created',
      chat_type: 'direct',
      chat_id: 55,
      sender_user_id: 2,
      client_uuid: 'u-3',
      message: {
        id: 77,
        chat_id: 55,
        sender_user_id: 2,
        client_uuid: 'u-3',
        key_version: 1,
        encrypted_payload: 'chiffrat',
      },
    })

    await waitFor(() =>
      expect(quittung.ackChatMessages).toHaveBeenCalledWith('direct', 55, 77),
    )
  })

  it('quittiert nicht, was sich hier nicht oeffnen laesst', async () => {
    krypto.entpackeChatNutzlast.mockRejectedValueOnce(new Error('kein Schluessel'))
    render(<MessengerHintergrund />)
    await waitFor(() => expect(identitaet.resolveIdentity).toHaveBeenCalled())

    await ereignis({
      type: 'message_created',
      chat_type: 'direct',
      chat_id: 55,
      sender_user_id: 2,
      client_uuid: 'u-4',
      message: {
        id: 78,
        chat_id: 55,
        sender_user_id: 2,
        client_uuid: 'u-4',
        key_version: 1,
        encrypted_payload: 'chiffrat',
      },
    })

    await act(async () => {})
    expect(quittung.ackChatMessages).not.toHaveBeenCalled()
  })
})
