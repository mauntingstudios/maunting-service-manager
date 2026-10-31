import { describe, expect, it } from 'vitest'

import { bereiteAiAnhangAuf } from './aiAnhangAufbereitung'

describe('bereiteAiAnhangAuf', () => {
  it('laesst kleine Nicht-Bilder unveraendert', async () => {
    const datei = new File(['# Einkauf\n- Milch'], 'einkauf.md', { type: 'text/markdown' })
    expect(await bereiteAiAnhangAuf(datei)).toBe(datei)
  })

  it('weist Dateien ueber 20 MB mit einer verstaendlichen Meldung ab', async () => {
    const datei = new File(['x'], 'gross.bin', { type: 'application/octet-stream' })
    Object.defineProperty(datei, 'size', { value: 20 * 1024 * 1024 + 1 })
    await expect(bereiteAiAnhangAuf(datei)).rejects.toThrow(/20 MB/)
  })
})
