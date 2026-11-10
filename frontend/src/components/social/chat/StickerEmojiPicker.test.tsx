import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const promptMock = vi.hoisted(() => vi.fn(async () => 'Neu'))
const confirmMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/services/appUmgebung', () => ({ istDesktopApp: () => true }))
vi.mock('@/stores/promptStore', () => ({ prompt: promptMock }))
vi.mock('@/stores/confirmStore', () => ({ confirm: confirmMock }))

vi.mock('@/services/messengerLocalStore', () => ({
  ladeStickerBestand: vi.fn(async () => ({ packs: [], sticker: [] })),
  erstelleStickerPack: vi.fn(async (name: string) => ({
    id: 'pack-1',
    name: name || 'Meine Mixes',
    coverId: null,
    createdAt: 1,
    updatedAt: 1,
  })),
  benenneStickerPack: vi.fn(async () => {}),
  ladeStickerBild: vi.fn(async () => null),
  loescheSticker: vi.fn(async () => {}),
  loescheStickerPack: vi.fn(async () => {}),
  speichereBildSticker: vi.fn(async (packId: string, daten: Record<string, unknown>) => ({
    id: 'bild-1',
    packId,
    art: 'bild',
    ...daten,
    createdAt: 1,
  })),
  speichereMixSticker: vi.fn(
    async (packId: string, rezept: Record<string, unknown>, miniatur: string) => ({
      id: 'mix-1',
      packId,
      art: 'mix',
      rezept,
      miniatur,
      createdAt: 1,
    }),
  ),
}))

import {
  benenneStickerPack,
  ladeStickerBestand,
  ladeStickerBild,
  loescheStickerPack,
} from '@/services/messengerLocalStore'
import { StickerEmojiPicker } from './StickerEmojiPicker'

const PACK = { id: 'pack-1', name: 'Urlaub', coverId: null, createdAt: 1, updatedAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ladeStickerBestand).mockResolvedValue({ packs: [], sticker: [] })
  vi.mocked(ladeStickerBild).mockResolvedValue(null)
  vi.mocked(promptMock).mockResolvedValue('Neu')
  vi.mocked(confirmMock).mockResolvedValue(true)
})

function zeige(reiter: 'stickers' | 'mixer' | 'foto' | 'emojis' = 'stickers') {
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
    expect(screen.getByRole('button', { name: 'Foto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emojis' })).toBeInTheDocument()
  })

  it('meldet den Reiterwechsel', () => {
    const { onReiter } = zeige('stickers')
    fireEvent.click(screen.getByRole('button', { name: 'Mixer' }))
    expect(onReiter).toHaveBeenCalledWith('mixer')
  })

  it('sendet einen System-Sticker mit seinem Namen', async () => {
    const { onSticker } = zeige('stickers')
    fireEvent.click(await screen.findByRole('button', { name: 'Winkende Hand' }))
    expect(onSticker).toHaveBeenCalledWith({ id: 'sys-emotes-hello-wave', label: 'Winkende Hand' })
  })

  it('sortiert die System-Sticker nach Thema', async () => {
    const { onSticker } = zeige('stickers')
    await screen.findByRole('button', { name: 'Winkende Hand' })
    fireEvent.click(screen.getByRole('button', { name: 'Essen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Burger' }))
    expect(onSticker).toHaveBeenCalledWith({ id: 'sys-food-burger', label: 'Burger' })
  })

  it('öffnet den Mixer, baut einen Sticker und sendet ihn', async () => {
    const { onSticker } = zeige('mixer')

    fireEvent.click(screen.getByRole('button', { name: 'Mixer öffnen' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sticker bauen' })

    fireEvent.click(within(dialog).getByRole('button', { name: '😀 hinzufügen' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))

    await waitFor(() =>
      expect(onSticker).toHaveBeenCalledWith(
        expect.objectContaining({ label: '😀', mix: true }),
      ),
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

  it('zeigt eigene Mixes und Foto-Sticker im Pack und sendet sie', async () => {
    const rezept = { emojis: ['🔥'], hintergrund: 'primary' as const, sterne: false }
    vi.mocked(ladeStickerBestand).mockResolvedValueOnce({
      packs: [PACK],
      sticker: [
        {
          id: 'mix-abc',
          packId: PACK.id,
          art: 'mix',
          rezept,
          miniatur: '<svg viewBox="0 0 128 128"><rect width="128" height="128"/></svg>',
          createdAt: 1,
        },
        {
          id: 'bild-1',
          packId: PACK.id,
          art: 'bild',
          text: 'Hallo',
          stil: 'fett',
          miniatur: 'data:image/webp;base64,MINI',
          createdAt: 2,
        },
      ],
    })
    const { onSticker } = zeige('stickers')

    fireEvent.click(await screen.findByRole('button', { name: '🔥' }))
    expect(onSticker).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mix-abc', svg: expect.stringContaining('<svg'), mix: true }),
    )

    vi.mocked(ladeStickerBild).mockResolvedValueOnce('data:image/webp;base64,VOLL')
    fireEvent.click(screen.getByRole('button', { name: 'Hallo' }))
    await waitFor(() =>
      expect(onSticker).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bild-1', bild: 'data:image/webp;base64,VOLL', mix: true }),
      ),
    )
  })

  it('benennt ein Pack um und löscht es nach Rückfrage', async () => {
    vi.mocked(ladeStickerBestand).mockResolvedValue({ packs: [PACK], sticker: [] })
    zeige('stickers')

    fireEvent.click(await screen.findByRole('button', { name: 'Umbenennen' }))
    await waitFor(() => expect(benenneStickerPack).toHaveBeenCalledWith(PACK.id, 'Neu'))

    fireEvent.click(screen.getByRole('button', { name: 'Pack löschen' }))
    await waitFor(() => expect(loescheStickerPack).toHaveBeenCalledWith(PACK.id))
  })

  it('bietet Kamera, lokale Galerie und Tresor im Foto-Editor an', async () => {
    zeige('foto')
    fireEvent.click(screen.getByRole('button', { name: 'Sticker aus Foto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sticker aus Foto' })

    expect(within(dialog).getByRole('button', { name: 'Kamera' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Galerie' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Tresor' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Speichern' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Senden' })).toBeDisabled()
  })
})
