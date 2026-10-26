import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/authStore'

const hub = vi.hoisted(() => ({ melde: vi.fn(async () => ({ plan: {}, system: null, doppelt: false })) }))
vi.mock('@/services/benachrichtigung/hub', () => hub)

import { FreundschaftsWache } from './FreundschaftsWache'

function zeichne() {
  return render(
    <MemoryRouter initialEntries={['/ai']}>
      <FreundschaftsWache />
      <Routes>
        <Route path="/ai" element={<div>AI</div>} />
        <Route path="/chat" element={<div>CHAT</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function ereignis(detail: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('msm:sync-event', { detail }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: 6, username: 'ich', device_notifications: true } as never,
  })
})

describe('FreundschaftsWache', () => {
  it('meldet eine Anfrage des gewaehlten Clients mit Aktion', async () => {
    zeichne()
    await ereignis({
      type: 'friend_request_received',
      request_id: 21,
      from_user_id: 8,
      from_username: 'alice',
      ereignis: 'friend-request:21',
      melden: true,
    })

    await waitFor(() => expect(hub.melde).toHaveBeenCalledTimes(1))
    const [, text] = hub.melde.mock.calls[0] as unknown as [unknown, { schluessel: string; aktion: { ausfuehren: () => void } }]
    expect(text.schluessel).toBe('friend-request:21')
    act(() => text.aktion.ausfuehren())
    expect(screen.getByText('CHAT')).toBeInTheDocument()
  })

  it('bleibt still, wenn ein anderer Client meldet', async () => {
    zeichne()
    await ereignis({
      type: 'friend_request_received',
      request_id: 22,
      from_username: 'bob',
      melden: false,
    })
    expect(hub.melde).not.toHaveBeenCalled()
  })

  it('meldet eine Annahme nur dem gewaehlten Client', async () => {
    zeichne()
    await ereignis({
      type: 'friend_request_accepted',
      request_id: 23,
      friend_id: 8,
      friend_username: 'alice',
      melden: true,
    })
    await waitFor(() => expect(hub.melde).toHaveBeenCalledTimes(1))

    vi.clearAllMocks()
    await ereignis({
      type: 'friend_request_accepted',
      request_id: 24,
      friend_id: 9,
      friend_username: 'bob',
      melden: false,
    })
    expect(hub.melde).not.toHaveBeenCalled()
  })
})
