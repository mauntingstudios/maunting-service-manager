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

vi.mock('@/services/e2eeIdentity', () => ({
  IDENTITY_LOADING: { state: 'loading' },
  ...identitaet,
}))
vi.mock('@/services/e2eeGeraet', () => geraet)
vi.mock('@/services/messengerSocket', () => ({ messengerSocket: socket }))
vi.mock('@/services/benachrichtigung/chatMeldung', () => melden)

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
})
