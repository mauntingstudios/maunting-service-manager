import { describe, expect, it } from 'vitest'

import { sanitizeSvg } from '@/lib/sanitizeSvg'

import { baueSticker } from './stickerMixer'
import { MIX_PRESETS } from './stickerMixerPresets'
import { MIX_KATEGORIEN, MIX_HINTERGRUENDE, type MixRezept } from './stickerMixerTypen'

const rezept = (teile: Partial<MixRezept> = {}): MixRezept => ({
  emojis: ['🔥'],
  hintergrund: 'ohne',
  funken: false,
  ...teile,
})

describe('stickerMixer', () => {
  it('baut aus einem Emoji ein selbsttragendes SVG ohne Hintergrundfläche', () => {
    const sticker = baueSticker(rezept())
    expect(sticker).not.toBeNull()
    expect(sticker!.mix).toBe(true)
    expect(sticker!.label).toBe('🔥')
    expect(sticker!.svg.startsWith('<svg')).toBe(true)
    expect(sticker!.svg).toContain('viewBox="0 0 128 128"')
    expect(sticker!.svg).not.toContain('<linearGradient')
    expect(sticker!.svg).not.toContain('<rect')
  })

  it('legt zwei und drei Emoji in feste, unterschiedliche Plätze', () => {
    const zwei = baueSticker(rezept({ emojis: ['🔥', '🐱'] }))!.svg
    const drei = baueSticker(rezept({ emojis: ['🔥', '🐱', '✨'] }))!.svg
    expect((zwei.match(/<g transform="rotate\(/g) ?? [])).toHaveLength(2)
    expect((drei.match(/<g transform="rotate\(/g) ?? [])).toHaveLength(3)
    expect(zwei).not.toBe(drei)
  })

  it('kappt auf drei Emoji und verwirft unbekannte', () => {
    const sticker = baueSticker(rezept({ emojis: ['🔥', '🐱', '✨', '😀'] }))
    expect(sticker!.label).toBe('🔥🐱✨')

    const mitUnbekanntem = baueSticker(rezept({ emojis: ['🔥', '🫠'] }))
    expect(mitUnbekanntem!.label).toBe('🔥')
  })

  it('fällt bei unbekanntem Hintergrund auf ohne zurück', () => {
    const sticker = baueSticker(rezept({ hintergrund: 'gibt-es-nicht' as MixRezept['hintergrund'] }))
    expect(sticker!.svg).not.toContain('<linearGradient')
  })

  it('liefert ohne gültiges Emoji nichts', () => {
    expect(baueSticker(rezept({ emojis: [] }))).toBeNull()
    expect(baueSticker(rezept({ emojis: ['🫠'] }))).toBeNull()
  })

  it('ist deterministisch und unterscheidet Funken', () => {
    const a = baueSticker(rezept({ emojis: ['🔥', '🐱'], hintergrund: 'sonne', funken: true }))
    const b = baueSticker(rezept({ emojis: ['🔥', '🐱'], hintergrund: 'sonne', funken: true }))
    const ohneFunken = baueSticker(rezept({ emojis: ['🔥', '🐱'], hintergrund: 'sonne', funken: false }))
    expect(a!.id).toBe(b!.id)
    expect(a!.svg).toBe(b!.svg)
    expect(a!.id).not.toBe(ohneFunken!.id)
  })

  it('teilt die Verlaufsdefinition je Hintergrund und trennt verschiedene', () => {
    const sonne = baueSticker(rezept({ emojis: ['🔥'], hintergrund: 'sonne' }))!.svg
    const sonneZwei = baueSticker(rezept({ emojis: ['🐱'], hintergrund: 'sonne' }))!.svg
    const nacht = baueSticker(rezept({ emojis: ['🔥'], hintergrund: 'nacht' }))!.svg
    expect(sonne).toContain('id="mx-bg-sonne"')
    expect(sonneZwei).toContain('id="mx-bg-sonne"')
    expect(nacht).toContain('id="mx-bg-nacht"')
    expect(nacht).not.toContain('mx-bg-sonne')
  })

  it('enthält keine verbotenen Elemente und bleibt unter dem Größenbudget', () => {
    for (const hintergrund of MIX_HINTERGRUENDE.map((eintrag) => eintrag.id)) {
      const svg = baueSticker(rezept({ emojis: ['🔥', '🐱', '✨'], hintergrund, funken: true }))!.svg
      expect(svg).not.toMatch(/<use[\s>]/i)
      expect(svg).not.toMatch(/<script[\s>]/i)
      expect(svg).not.toMatch(/<image[\s>]/i)
      expect(svg).not.toMatch(/\son[a-z]+\s*=/i)
      expect(svg).not.toMatch(/(?:href|src)\s*=\s*["']?\s*(?:https?:|\/\/)/i)
      expect(svg.length).toBeLessThan(40_000)
    }
  })

  it('macht jede Vorlage vollständig sendbar', () => {
    for (const preset of MIX_PRESETS) {
      const sticker = baueSticker(preset.rezept)
      expect(sticker, preset.id).not.toBeNull()
      // Ein Emoji, das nicht in der Palette steht, würde still wegfallen; der
      // Label-Vergleich fängt genau das ab.
      expect(sticker!.label, preset.id).toBe(preset.rezept.emojis.join(''))
      expect(sticker!.svg.length, preset.id).toBeLessThan(40_000)
    }
  })

  it('überlebt sanitizeSvg für jedes Emoji der Palette unverändert', () => {
    const alle = MIX_KATEGORIEN.flatMap((kategorie) => kategorie.emojis)
    expect(alle.length).toBeGreaterThan(100)
    for (const emoji of alle) {
      const sticker = baueSticker(rezept({ emojis: [emoji], hintergrund: 'beere', funken: true }))
      expect(sticker, emoji).not.toBeNull()
      const einmal = sanitizeSvg(sticker!.svg)
      expect(einmal.length, emoji).toBeGreaterThan(0)
      expect(einmal).toContain('mx-bg-beere')
      expect(sanitizeSvg(einmal), emoji).toBe(einmal)
    }
  })
})
