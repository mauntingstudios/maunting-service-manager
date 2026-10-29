import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  getFriendRequests: vi.fn(),
  acceptFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(),
}))

vi.mock('@/api/social', () => ({
  getFriendRequests: api.getFriendRequests,
  acceptFriendRequest: api.acceptFriendRequest,
  declineFriendRequest: api.declineFriendRequest,
}))

import { FreundschaftsanfragenKarte } from './FreundschaftsanfragenKarte'

const anfrage = {
  id: 21,
  user_id: 8,
  username: 'alice',
  avatar_url: null,
  status: 'pending' as const,
  is_requester: false,
  created_at: '2026-10-25T10:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] })
  api.acceptFriendRequest.mockResolvedValue({ ok: true, status: 'accepted', message: '' })
  api.declineFriendRequest.mockResolvedValue({ ok: true, message: '' })
})

describe('FreundschaftsanfragenKarte', () => {
  it('zeigt ohne offene Anfrage nichts', async () => {
    const { container } = render(<FreundschaftsanfragenKarte />)
    await waitFor(() => expect(api.getFriendRequests).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('zeigt eine eingehende Anfrage und nimmt sie an', async () => {
    api.getFriendRequests
      .mockResolvedValueOnce({ incoming: [anfrage], outgoing: [] })
      .mockResolvedValue({ incoming: [], outgoing: [] })
    render(<FreundschaftsanfragenKarte />)

    expect(await screen.findByText('alice')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `${i18n.t('social.contacts.accept')}: alice` }))

    await waitFor(() => expect(api.acceptFriendRequest).toHaveBeenCalledWith(21))
    await waitFor(() => expect(screen.queryByText('alice')).not.toBeInTheDocument())
  })

  it('lehnt eine Anfrage ab', async () => {
    api.getFriendRequests
      .mockResolvedValueOnce({ incoming: [anfrage], outgoing: [] })
      .mockResolvedValue({ incoming: [], outgoing: [] })
    render(<FreundschaftsanfragenKarte />)

    await screen.findByText('alice')
    fireEvent.click(screen.getByRole('button', { name: `${i18n.t('social.contacts.decline')}: alice` }))

    await waitFor(() => expect(api.declineFriendRequest).toHaveBeenCalledWith(21))
  })

  it('laedt nach einem Fehler neu, damit die Karte nicht haengt', async () => {
    api.getFriendRequests
      .mockResolvedValueOnce({ incoming: [anfrage], outgoing: [] })
      .mockResolvedValue({ incoming: [anfrage], outgoing: [] })
    api.acceptFriendRequest.mockRejectedValueOnce(new Error('weg'))
    render(<FreundschaftsanfragenKarte />)

    await screen.findByText('alice')
    fireEvent.click(screen.getByRole('button', { name: `${i18n.t('social.contacts.accept')}: alice` }))

    await waitFor(() => expect(api.getFriendRequests).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('alice')).toBeInTheDocument()
  })
})
