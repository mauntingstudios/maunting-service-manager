// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { EMOJI_GRAFIK } from '@/assets/twemoji'

import { MIX_KATEGORIEN } from './stickerMixerTypen'

describe('Twemoji-Assets', () => {
  const palette = MIX_KATEGORIEN.flatMap((kategorie) => kategorie.emojis)

  it('deckt genau die Palette ab, ohne Lücke und ohne Überschuss', () => {
    expect(Object.keys(EMOJI_GRAFIK).sort()).toEqual([...palette].sort())
  })

  it('enthält nur erlaubtes Innenmarkup', () => {
    for (const [emoji, markup] of Object.entries(EMOJI_GRAFIK)) {
      expect(markup.length, emoji).toBeGreaterThan(0)
      expect(markup, emoji).not.toMatch(/<svg[\s>]/i)
      expect(markup, emoji).not.toMatch(/<use[\s>]/i)
      expect(markup, emoji).not.toMatch(/<image[\s>]/i)
      expect(markup, emoji).not.toMatch(/<style[\s>]/i)
      expect(markup, emoji).not.toMatch(/<script[\s>]/i)
      expect(markup, emoji).not.toMatch(/\sid\s*=/i)
      expect(markup, emoji).not.toMatch(/\son[a-z]+\s*=/i)
      expect(markup, emoji).not.toMatch(/(?:href|src)\s*=\s*["']?\s*(?:https?:|\/\/)/i)
    }
  })
})
