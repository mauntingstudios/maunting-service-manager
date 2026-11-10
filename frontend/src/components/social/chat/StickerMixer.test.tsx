import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rezeptId, STANDARD_REZEPT, type MixRezept, type MixSticker } from '@/services/stickerMixerTypen'

vi.mock('@/services/stickerMixerAblage', () => ({
  ladeMixSammlung: vi.fn(async () => []),
  merkeMix: vi.fn(async () => {}),
  leereMixSammlung: vi.fn(async () => {}),
}))

import { ladeMixSammlung, leereMixSammlung, merkeMix } from '@/services/stickerMixerAblage'
import { StickerMixer } from './StickerMixer'

function Pruefstand({
  onSticker,
  onOpenChange,
}: {
  onSticker: (sticker: MixSticker) => void
  onOpenChange: (offen: boolean) => void
}) {
  const [rezept, setRezept] = useState<MixRezept>({ ...STANDARD_REZEPT })
  return (
    <StickerMixer
      open
      onOpenChange={onOpenChange}
      rezept={rezept}
      onRezept={setRezept}
      onSticker={onSticker}
    />
  )
}

/** Rendert und wartet die Sammlung ab, damit kein spätes `setState` aus `act` fällt. */
async function zeige(
  onSticker: (sticker: MixSticker) => void,
  onOpenChange: (offen: boolean) => void = vi.fn(),
) {
  render(<Pruefstand onSticker={onSticker} onOpenChange={onOpenChange} />)
  await act(async () => {})
  return { onOpenChange }
}

describe('StickerMixer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ladeMixSammlung).mockResolvedValue([])
    vi.mocked(merkeMix).mockResolvedValue()
    vi.mocked(leereMixSammlung).mockResolvedValue()
  })

  it('öffnet einen benannten Dialog mit Beschreibung', async () => {
    await zeige(vi.fn())
    const dialog = await screen.findByRole('dialog', { name: 'Sticker bauen' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Wähle bis zu drei Emoji, einen Hintergrund und schicke deinen Sticker.')).toBeInTheDocument()
  })

  it('nimmt ein Emoji in die Vorschau und wieder heraus', async () => {
    await zeige(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))

    expect(screen.getByRole('img', { name: '😀' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '😀 entfernen' }))
    expect(screen.queryByRole('img', { name: '😀' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled()
  })

  it('zeigt in der Palette echte SVG-Grafiken statt nackter Pfade', async () => {
    await zeige(vi.fn())
    const knopf = screen.getByRole('button', { name: '😀 hinzufügen' })
    // Die Asset-Module tragen nur den Innenraum; ohne Hülle bliebe die Kachel leer.
    expect(knopf.querySelector('svg')).not.toBeNull()
    expect(knopf.querySelector('svg path, svg g')).not.toBeNull()
  })

  it('lässt höchstens drei Emoji zu und sagt es', async () => {
    await zeige(vi.fn())
    for (const emoji of ['😀', '😃', '😄']) {
      fireEvent.click(screen.getByRole('button', { name: `${emoji} hinzufügen` }))
    }

    expect(screen.getByText('Höchstens drei Emoji.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '😁 hinzufügen' })).toBeDisabled()
  })

  it('wechselt den Hintergrund und zeigt ihn in der Vorschau', async () => {
    await zeige(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))
    expect(screen.getByRole('button', { name: 'Ohne' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Blau' }))

    const vorschau = screen.getByRole('img', { name: '😀' })
    expect(vorschau.querySelector('[id="mx-bg-primary"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Blau' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ohne' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('schaltet Sternchen über einen benannten Schalter', async () => {
    await zeige(vi.fn())
    const schalter = screen.getByRole('switch', { name: 'Sternchen' })
    expect(schalter).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(schalter)

    expect(schalter).toHaveAttribute('aria-checked', 'true')
  })

  it('setzt alles auf den Standard zurück', async () => {
    await zeige(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blau' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Sternchen' }))

    fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }))

    expect(screen.queryByRole('img', { name: '😀' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ohne' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('switch', { name: 'Sternchen' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled()
  })

  it('sendet den gebauten Sticker und merkt das Rezept', async () => {
    const onSticker = vi.fn()
    const { onOpenChange } = await zeige(onSticker)

    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    expect(merkeMix).toHaveBeenCalledWith({ emojis: ['😀'], hintergrund: 'ohne', sterne: false })
    expect(onSticker).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringMatching(/^mix-/), label: '😀', mix: true }),
    )
    expect(onSticker.mock.calls[0][0].svg).toContain('<svg')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sendet eine Vorlage beim Antippen', async () => {
    const onSticker = vi.fn()
    await zeige(onSticker)

    fireEvent.click(screen.getByRole('button', { name: 'Feuerkatze senden' }))

    expect(onSticker).toHaveBeenCalledWith(expect.objectContaining({ label: '🔥🐱', mix: true }))
    expect(merkeMix).toHaveBeenCalledWith({
      emojis: ['🔥', '🐱'],
      hintergrund: 'amber',
      sterne: true,
    })
  })

  it('bietet die gesendete Sammlung an und leert sie', async () => {
    const rezept: MixRezept = { emojis: ['🦄'], hintergrund: 'rose', sterne: false }
    vi.mocked(ladeMixSammlung).mockResolvedValueOnce([
      { id: rezeptId(rezept), rezept, zuletzt: 1 },
    ])
    const onSticker = vi.fn()
    await zeige(onSticker)

    const kachel = await screen.findByRole('button', { name: '🦄 senden' })
    fireEvent.click(kachel)
    expect(onSticker).toHaveBeenCalledWith(expect.objectContaining({ label: '🦄' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung leeren' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '🦄 senden' })).toBeNull())
    expect(leereMixSammlung).toHaveBeenCalled()
  })

  it('zeigt einen leeren Zustand ohne Sammlung', async () => {
    await zeige(vi.fn())
    expect(await screen.findByText('Gesendete Mixes erscheinen hier.')).toBeInTheDocument()
  })

  it('setzt kein natives title und nennt die Herkunft der Grafiken', async () => {
    await zeige(vi.fn())
    await screen.findByRole('dialog', { name: 'Sticker bauen' })

    expect(document.querySelectorAll('[title]')).toHaveLength(0)
    const herkunft = screen.getByRole('link', { name: /Twemoji/ })
    expect(herkunft).toHaveAttribute('href', 'https://github.com/jdecked/twemoji')
    expect(herkunft).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
