import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rezeptId, type MixRezept } from './stickerMixerTypen'

const speicher = vi.hoisted(() => ({
  zeilen: new Map<string, Record<string, unknown>>(),
}))

vi.mock('./messengerLocalStore', () => ({
  ladeHintergrundZeile: vi.fn(async (schluessel: string) => speicher.zeilen.get(schluessel) ?? null),
  speichereHintergrundZeile: vi.fn(async (schluessel: string, wert: Record<string, unknown>) => {
    speicher.zeilen.set(schluessel, { ...wert, schluessel })
  }),
  loescheHintergrundZeile: vi.fn(async (schluessel: string) => {
    speicher.zeilen.delete(schluessel)
  }),
}))

import {
  MIX_SAMMLUNG_MAX,
  ladeMixSammlung,
  leereMixSammlung,
  merkeMix,
} from './stickerMixerAblage'
import { ladeHintergrundZeile, speichereHintergrundZeile } from './messengerLocalStore'

const rezept = (teile: Partial<MixRezept> = {}): MixRezept => ({
  emojis: ['🔥'],
  hintergrund: 'amber',
  sterne: true,
  ...teile,
})

describe('stickerMixerAblage', () => {
  beforeEach(() => {
    speicher.zeilen.clear()
    vi.clearAllMocks()
  })

  it('liefert ohne Eintrag eine leere Sammlung', async () => {
    expect(await ladeMixSammlung()).toEqual([])
  })

  it('merkt ein Rezept und lädt es wieder', async () => {
    const eintrag = rezept({ emojis: ['🔥', '🐱'] })
    await merkeMix(eintrag)

    const geladen = await ladeMixSammlung()
    expect(geladen).toHaveLength(1)
    expect(geladen[0].id).toBe(rezeptId(eintrag))
    expect(geladen[0].rezept).toEqual(eintrag)
    expect(geladen[0].zuletzt).toBeGreaterThan(0)
  })

  it('stellt den zuletzt gesendeten Mix nach oben', async () => {
    await merkeMix(rezept({ emojis: ['🔥'] }))
    await merkeMix(rezept({ emojis: ['🐱'] }))

    const geladen = await ladeMixSammlung()
    expect(geladen.map((eintrag) => eintrag.rezept.emojis[0])).toEqual(['🐱', '🔥'])
  })

  it('führt dasselbe Rezept zusammen, statt es zu doppeln', async () => {
    await merkeMix(rezept({ emojis: ['🔥', '🐱'] }))
    await merkeMix(rezept({ emojis: ['🔥', '🐱'] }))

    expect(await ladeMixSammlung()).toHaveLength(1)
  })

  it(`behält höchstens ${MIX_SAMMLUNG_MAX} Einträge`, async () => {
    const alle = ['🔥', '🐱', '✨', '😀', '🎉', '🚀', '💀', '❤️', '👍', '🐶', '🍕', '🎮', '🌟', '👑']
    for (const emoji of alle) {
      await merkeMix(rezept({ emojis: [emoji] }))
    }

    const geladen = await ladeMixSammlung()
    expect(geladen).toHaveLength(MIX_SAMMLUNG_MAX)
    expect(geladen[0].rezept.emojis[0]).toBe('👑')
  })

  it('schreibt ohne gültiges Emoji nichts', async () => {
    await merkeMix(rezept({ emojis: [] }))
    expect(speichereHintergrundZeile).not.toHaveBeenCalled()
    expect(await ladeMixSammlung()).toEqual([])
  })

  it('normalisiert alte Einträge und verwirft unbrauchbare', async () => {
    speicher.zeilen.set('mix:sammlung', {
      schluessel: 'mix:sammlung',
      eintraege: [
        { rezept: { emojis: ['🔥', '🫠'], hintergrund: 'gibt-es-nicht', sterne: 1 }, zuletzt: 5 },
        { rezept: { emojis: [], hintergrund: 'amber', sterne: false }, zuletzt: 9 },
        'kaputt',
      ],
    })

    const geladen = await ladeMixSammlung()
    expect(geladen).toHaveLength(1)
    expect(geladen[0].rezept).toEqual({ emojis: ['🔥'], hintergrund: 'ohne', sterne: true })
  })

  it('leert die Sammlung', async () => {
    await merkeMix(rezept())
    await leereMixSammlung()
    expect(await ladeMixSammlung()).toEqual([])
  })

  it('bleibt still, wenn der Speicher gesperrt ist', async () => {
    vi.mocked(ladeHintergrundZeile).mockRejectedValueOnce(new Error('gesperrt'))
    expect(await ladeMixSammlung()).toEqual([])

    vi.mocked(speichereHintergrundZeile).mockRejectedValueOnce(new Error('gesperrt'))
    await expect(merkeMix(rezept())).resolves.toBeUndefined()
  })
})
