import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { STANDARD_REZEPT, type MixRezept } from '@/services/stickerMixerTypen'
import type { StickerPack } from '@/services/stickerPacks'
import { StickerMixer } from './StickerMixer'

const PACK: StickerPack = {
  id: 'pack-1',
  name: 'Meine Mixes',
  coverId: null,
  createdAt: 1,
  updatedAt: 1,
}
const PACK2: StickerPack = {
  id: 'pack-2',
  name: 'Urlaub',
  coverId: null,
  createdAt: 2,
  updatedAt: 2,
}

function Pruefstand({
  onMixFertig,
  onOpenChange = vi.fn(),
  onZielPack = vi.fn(),
  onNeuesPack = vi.fn(async () => PACK2.id),
}: {
  onMixFertig: (rezept: MixRezept, miniatur: string, senden: boolean) => Promise<void>
  onOpenChange?: (offen: boolean) => void
  onZielPack?: (id: string) => void
  onNeuesPack?: () => Promise<string | null>
}) {
  const [rezept, setRezept] = useState<MixRezept>({ ...STANDARD_REZEPT })
  return (
    <StickerMixer
      open
      onOpenChange={onOpenChange}
      rezept={rezept}
      onRezept={setRezept}
      packs={[PACK, PACK2]}
      zielPackId={PACK.id}
      onZielPack={onZielPack}
      onNeuesPack={onNeuesPack}
      onMixFertig={onMixFertig}
    />
  )
}

function zeige(onMixFertig = vi.fn(async () => {}), optionen: {
  onOpenChange?: (offen: boolean) => void
  onZielPack?: (id: string) => void
  onNeuesPack?: () => Promise<string | null>
} = {}) {
  render(<Pruefstand onMixFertig={onMixFertig} {...optionen} />)
  return onMixFertig
}

describe('StickerMixer', () => {
  it('öffnet einen benannten Dialog mit Beschreibung', async () => {
    zeige()
    const dialog = await screen.findByRole('dialog', { name: 'Sticker bauen' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Wähle bis zu drei Emoji, einen Hintergrund und schicke deinen Sticker.')).toBeInTheDocument()
  })

  it('nimmt ein Emoji in die Vorschau und wieder heraus', async () => {
    zeige()
    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))

    expect(screen.getByRole('img', { name: '😀' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '😀 entfernen' }))
    expect(screen.queryByRole('img', { name: '😀' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled()
  })

  it('zeigt in der Palette echte SVG-Grafiken statt nackter Pfade', async () => {
    zeige()
    const knopf = screen.getByRole('button', { name: '😀 hinzufügen' })
    expect(knopf.querySelector('svg')).not.toBeNull()
    expect(knopf.querySelector('svg path, svg g')).not.toBeNull()
  })

  it('lässt höchstens drei Emoji zu und sagt es', async () => {
    zeige()
    for (const emoji of ['😀', '😃', '😄']) {
      fireEvent.click(screen.getByRole('button', { name: `${emoji} hinzufügen` }))
    }

    expect(screen.getByText('Höchstens drei Emoji.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '😁 hinzufügen' })).toBeDisabled()
  })

  it('wechselt den Hintergrund und zeigt ihn in der Vorschau', async () => {
    zeige()
    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))
    expect(screen.getByRole('button', { name: 'Ohne' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Blau' }))

    const vorschau = screen.getByRole('img', { name: '😀' })
    expect(vorschau.querySelector('[id="mx-bg-primary"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Blau' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ohne' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('schaltet Sternchen über einen benannten Schalter', async () => {
    zeige()
    const schalter = screen.getByRole('switch', { name: 'Sternchen' })
    expect(schalter).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(schalter)

    expect(schalter).toHaveAttribute('aria-checked', 'true')
  })

  it('setzt alles auf den Standard zurück', async () => {
    zeige()
    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blau' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Sternchen' }))

    fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }))

    expect(screen.queryByRole('img', { name: '😀' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ohne' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('switch', { name: 'Sternchen' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled()
  })

  it('sendet den gebauten Sticker und schließt den Dialog', async () => {
    const onMixFertig = vi.fn(async () => {})
    const onOpenChange = vi.fn()
    zeige(onMixFertig, { onOpenChange })

    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    expect(onMixFertig).toHaveBeenCalledWith(
      { emojis: ['😀'], hintergrund: 'ohne', sterne: false },
      expect.stringContaining('<svg'),
      true,
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    await act(async () => {})
  })

  it('speichert den Mix ohne zu senden', async () => {
    const onMixFertig = vi.fn(async () => {})
    zeige(onMixFertig)

    fireEvent.click(screen.getByRole('button', { name: '😀 hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(onMixFertig).toHaveBeenCalledWith(
      expect.objectContaining({ emojis: ['😀'] }),
      expect.stringContaining('<svg'),
      false,
    )
    await act(async () => {})
  })

  it('sendet eine Vorlage beim Antippen', async () => {
    const onMixFertig = vi.fn(async () => {})
    zeige(onMixFertig)

    fireEvent.click(screen.getByRole('button', { name: 'Feuerkatze senden' }))

    expect(onMixFertig).toHaveBeenCalledWith(
      { emojis: ['🔥', '🐱'], hintergrund: 'amber', sterne: true },
      expect.stringContaining('<svg'),
      true,
    )
    await act(async () => {})
  })

  it('bietet die Ziel-Packs an', async () => {
    const onZielPack = vi.fn()
    zeige(vi.fn(async () => {}), { onZielPack })

    fireEvent.click(screen.getByRole('button', { name: 'Ablage' }))
    fireEvent.click(screen.getByRole('option', { name: 'Urlaub' }))

    expect(onZielPack).toHaveBeenCalledWith('pack-2')
  })

  it('setzt kein natives title und nennt die Herkunft der Grafiken', async () => {
    zeige()
    await screen.findByRole('dialog', { name: 'Sticker bauen' })

    expect(document.querySelectorAll('[title]')).toHaveLength(0)
    const herkunft = screen.getByRole('link', { name: /Twemoji/ })
    expect(herkunft).toHaveAttribute('href', 'https://github.com/jdecked/twemoji')
    expect(herkunft).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
