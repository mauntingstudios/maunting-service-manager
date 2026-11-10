import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/stickerMixerAblage', () => ({
  ladeMixSammlung: vi.fn(async () => []),
  merkeMix: vi.fn(async () => {}),
  leereMixSammlung: vi.fn(async () => {}),
}))

import { StickerEmojiPicker } from './StickerEmojiPicker'

function zeige(reiter: 'stickers' | 'mixer' | 'emojis' = 'mixer') {
  const onSticker = vi.fn()
  const onReiter = vi.fn()
  const onEmoji = vi.fn()
  const onSchliessen = vi.fn()
  render(
    <StickerEmojiPicker
      reiter={reiter}
      onReiter={onReiter}
      onSticker={onSticker}
      onEmoji={onEmoji}
      onSchliessen={onSchliessen}
    />,
  )
  return { onSticker, onReiter, onEmoji, onSchliessen }
}

describe('StickerEmojiPicker', () => {
  it('nennt die Reiter in der App-Sprache', () => {
    zeige('stickers')
    expect(screen.getByRole('button', { name: 'Sticker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mixer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emojis' })).toBeInTheDocument()
  })

  it('meldet den Reiterwechsel', () => {
    const { onReiter } = zeige('stickers')
    fireEvent.click(screen.getByRole('button', { name: 'Mixer' }))
    expect(onReiter).toHaveBeenCalledWith('mixer')
  })

  it('sendet einen System-Sticker nur mit seiner Kennung', () => {
    const { onSticker } = zeige('stickers')
    fireEvent.click(screen.getByRole('button', { name: 'Emotes 1' }))
    expect(onSticker).toHaveBeenCalledWith({ id: 'sys-emotes-hello-wave', label: 'Emotes' })
  })

  it('sortiert die System-Sticker nach Thema', () => {
    const { onSticker } = zeige('stickers')
    fireEvent.click(screen.getByRole('button', { name: 'Essen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Essen 1' }))
    expect(onSticker).toHaveBeenCalledWith({ id: 'sys-food-burger', label: 'Essen' })
  })

  it('öffnet den Mixer, baut einen Sticker und sendet ihn', async () => {
    const { onSticker } = zeige('mixer')

    fireEvent.click(screen.getByRole('button', { name: 'Mixer öffnen' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sticker bauen' })

    fireEvent.click(within(dialog).getByRole('button', { name: '😀 hinzufügen' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))

    expect(onSticker).toHaveBeenCalledWith(
      expect.objectContaining({ label: '😀', mix: true }),
    )
  })

  it('schließt mit Escape nur den Dialog, nicht die Auswahl', async () => {
    zeige('mixer')
    fireEvent.click(screen.getByRole('button', { name: 'Mixer öffnen' }))
    await screen.findByRole('dialog', { name: 'Sticker bauen' })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sticker bauen' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Mixer öffnen' })).toBeInTheDocument()
  })
})
