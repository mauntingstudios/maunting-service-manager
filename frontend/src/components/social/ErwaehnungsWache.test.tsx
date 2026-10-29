import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const konversation = vi.hoisted(() => ({
  blindMailboxId: 'group:3',
  liesUmschlaege: vi.fn(),
  uebernimmLesestand: vi.fn(),
}))
const ablage = vi.hoisted(() => ({
  saveLocalMessagesStrict: vi.fn(async () => {}),
}))

vi.mock('@/hooks/useKonversation', () => ({
  useKonversation: () => konversation,
}))
vi.mock('@/services/messengerLocalStore', () => ablage)
vi.mock('@/services/lokaleVersiegelung', () => ({
  siegelAktiv: () => false,
  istOffen: () => true,
}))

import { ErwaehnungsWache } from './ErwaehnungsWache'

const GRUPPE = {
  id: 3,
  name: 'Team',
  members: [
    { user_id: 1, username: 'ich', can_mention_everyone: false },
    { user_id: 2, username: 'bob', can_mention_everyone: false },
  ],
} as never

const nachricht = {
  id: 11,
  clientUuid: 'u-11',
  senderId: 2,
  senderName: 'bob',
  text: '@ich hilf mal',
  createdAt: '2026-10-26T10:00:00.000Z',
  isSelf: false,
  erwaehnungen: [1],
}

function lesung(erwaehnungen: number[] = [1]) {
  return {
    art: 'klartext' as const,
    env: {
      id: 11,
      blind_mailbox_id: 'group:3',
      ciphertext_envelope: '',
      client_uuid: 'u-11',
      created_at: nachricht.createdAt,
    },
    text: JSON.stringify({
      sender_id: 2,
      client_uuid: 'u-11',
      erwaehnungen,
    }),
    vonKonto: 2,
    nachricht: { ...nachricht, erwaehnungen },
  }
}

describe('ErwaehnungsWache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    konversation.liesUmschlaege.mockResolvedValue([lesung()])
    ablage.saveLocalMessagesStrict.mockResolvedValue(undefined)
  })

  it('legt eine Erwähnung lokal ab, damit der Filter sie ohne Öffnen der Gruppe findet', async () => {
    const onErwaehnung = vi.fn()
    render(
      <ErwaehnungsWache
        gruppen={[GRUPPE]}
        aktiveMailboxId={null}
        eigeneId={1}
        identitaetRef={{ current: { state: 'ready' } } as never}
        onErwaehnung={onErwaehnung}
        aktiv
      />,
    )

    await waitFor(() =>
      expect(ablage.saveLocalMessagesStrict).toHaveBeenCalledWith(
        'group:3',
        [expect.objectContaining({ id: 11, erwaehnungen: [1] })],
        'gruppe',
      ),
    )
    expect(onErwaehnung).toHaveBeenCalledWith('group:3')
  })

  it('legt auch eine Nachricht ohne Erwähnung lokal ab', async () => {
    konversation.liesUmschlaege.mockResolvedValue([lesung([])])
    const onErwaehnung = vi.fn()
    render(
      <ErwaehnungsWache
        gruppen={[GRUPPE]}
        aktiveMailboxId={null}
        eigeneId={1}
        identitaetRef={{ current: { state: 'ready' } } as never}
        onErwaehnung={onErwaehnung}
        aktiv
      />,
    )

    await waitFor(() =>
      expect(ablage.saveLocalMessagesStrict).toHaveBeenCalledWith(
        'group:3',
        [expect.objectContaining({ id: 11 })],
        'gruppe',
      ),
    )
    expect(onErwaehnung).not.toHaveBeenCalled()
  })

  it('legt Steuerzeilen und gelöschte Zeilen nicht ab', async () => {
    const steuer = lesung()
    steuer.text = JSON.stringify({ type: 'delete_message', sender_id: 2 })
    const geloescht = { art: 'still' as const, env: { id: 12 } }
    konversation.liesUmschlaege.mockResolvedValue([steuer, geloescht])
    render(
      <ErwaehnungsWache
        gruppen={[GRUPPE]}
        aktiveMailboxId={null}
        eigeneId={1}
        identitaetRef={{ current: { state: 'ready' } } as never}
        onErwaehnung={vi.fn()}
        aktiv
      />,
    )

    await waitFor(() => expect(konversation.liesUmschlaege).toHaveBeenCalled())
    expect(ablage.saveLocalMessagesStrict).not.toHaveBeenCalled()
  })

  it('legt auch die eigene Nachricht ab', async () => {
    const eigene = lesung([])
    eigene.nachricht = { ...eigene.nachricht, senderId: 1, isSelf: true }
    eigene.text = JSON.stringify({ sender_id: 1, client_uuid: 'u-11' })
    konversation.liesUmschlaege.mockResolvedValue([eigene])
    render(
      <ErwaehnungsWache
        gruppen={[GRUPPE]}
        aktiveMailboxId={null}
        eigeneId={1}
        identitaetRef={{ current: { state: 'ready' } } as never}
        onErwaehnung={vi.fn()}
        aktiv
      />,
    )

    await waitFor(() =>
      expect(ablage.saveLocalMessagesStrict).toHaveBeenCalledWith(
        'group:3',
        [expect.objectContaining({ isSelf: true })],
        'gruppe',
      ),
    )
  })

  it('setzt das Abzeichen auch dann, wenn das lokale Ablegen scheitert', async () => {
    ablage.saveLocalMessagesStrict.mockRejectedValueOnce(new Error('Ablage voll'))
    const onErwaehnung = vi.fn()
    render(
      <ErwaehnungsWache
        gruppen={[GRUPPE]}
        aktiveMailboxId={null}
        eigeneId={1}
        identitaetRef={{ current: { state: 'ready' } } as never}
        onErwaehnung={onErwaehnung}
        aktiv
      />,
    )

    await waitFor(() => expect(onErwaehnung).toHaveBeenCalledWith('group:3'))
  })
})
