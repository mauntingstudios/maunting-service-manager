import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dienste = vi.hoisted(() => ({
  ladeGruppenHintergrund: vi.fn(),
  aendereGruppenHintergrund: vi.fn(),
}))

vi.mock('@/services/gruppenInfo', () => dienste)
vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { ChatHintergrund } from './ChatHintergrund'
import { GruppenHintergrundFeld } from './GruppenHintergrundFeld'
import type { GruppenKontext } from '@/services/gruppenSchluessel'

const KONTEXT: GruppenKontext = {
  groupId: 7,
  blindMailboxId: 'gruppe-7',
  eigeneId: 1,
  mitglieder: [1, 2],
  istEigentuemer: true,
}

function hintergrund(preset: string | null, revision = 1) {
  return {
    art: 'hintergrund' as const,
    hintergrund: { v: 1, preset, dim: 30, bild: null },
    revision,
    vonKonto: 1,
  }
}

describe('Geteilter Gruppenhintergrund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dienste.ladeGruppenHintergrund.mockResolvedValue(hintergrund('midnight'))
    dienste.aendereGruppenHintergrund.mockResolvedValue({ art: 'gespeichert', revision: 2 })
  })

  it('zeigt den geteilten Hintergrund der Gruppe', async () => {
    const { container } = render(
      <ChatHintergrund bereich="messenger" gruppe={KONTEXT} />,
    )

    await waitFor(() =>
      expect(container.querySelector('[data-chat-hintergrund="midnight"]')).not.toBeNull(),
    )
    expect(container.querySelector('[data-chat-hintergrund-abdunkeln="30"]')).not.toBeNull()
  })

  it('lädt bei einem Echtzeit-Ereignis der Gruppe neu', async () => {
    const { container } = render(
      <ChatHintergrund bereich="messenger" gruppe={KONTEXT} />,
    )
    await waitFor(() =>
      expect(container.querySelector('[data-chat-hintergrund="midnight"]')).not.toBeNull(),
    )

    dienste.ladeGruppenHintergrund.mockResolvedValue(hintergrund('minimal', 2))
    window.dispatchEvent(
      new CustomEvent('msm:sync-event', {
        detail: { type: 'chat_group_background_updated', group_id: 7, revision: 2 },
      }),
    )

    await waitFor(() =>
      expect(container.querySelector('[data-chat-hintergrund="minimal"]')).not.toBeNull(),
    )
  })

  it('speichert eine Vorlage und die Abdunkelung', async () => {
    render(<GruppenHintergrundFeld kontext={KONTEXT} kannAendern />)
    await screen.findByText('Mitternacht')

    fireEvent.click(screen.getByText('Mitternacht'))
    fireEvent.click(screen.getByRole('button', { name: /Hintergrund speichern/ }))

    await waitFor(() =>
      expect(dienste.aendereGruppenHintergrund).toHaveBeenCalledWith(
        KONTEXT,
        expect.any(Function),
        expect.any(Function),
        null,
      ),
    )
    const aendere = dienste.aendereGruppenHintergrund.mock.calls[0][2] as (v: unknown) => unknown
    expect(aendere({})).toMatchObject({ preset: 'midnight', dim: 30, bild: null })
  })

  it('sperrt die Auswahl ohne Berechtigung', async () => {
    render(<GruppenHintergrundFeld kontext={KONTEXT} kannAendern={false} />)
    await screen.findByText('Mitternacht')

    const speichern = screen.queryByRole('button', { name: /Hintergrund speichern/ })
    expect(speichern).toBeNull()
    expect(screen.getByText('Mitternacht').closest('button')).toBeDisabled()
  })
})
