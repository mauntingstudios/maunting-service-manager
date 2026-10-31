import { describe, expect, it } from 'vitest'

import { bereiteAiAnhangAuf } from './aiAnhangAufbereitung'

describe('bereiteAiAnhangAuf', () => {
  it('laesst kleine Nicht-Bilder unveraendert', async () => {
    const datei = new File(['# Einkauf\n- Milch'], 'einkauf.md', { type: 'text/markdown' })
    expect(await bereiteAiAnhangAuf(datei)).toBe(datei)
  })

  it('weist Dateien ueber 32 MB mit einer verstaendlichen Meldung ab', async () => {
    const datei = new File(['x'], 'gross.bin', { type: 'application/octet-stream' })
    Object.defineProperty(datei, 'size', { value: 32 * 1024 * 1024 + 1 })
    await expect(bereiteAiAnhangAuf(datei)).rejects.toThrow(/32 MB/)
  })

  it('laesst grosse Textdateien unveraendert durch', async () => {
    // Text wird im Browser nicht beschnitten. Die Extraktion und die Kuerzung
    // auf das Kontextbudget passieren auf dem Server.
    const datei = new File(['# Log\n'], 'gross.log', { type: 'text/plain' })
    Object.defineProperty(datei, 'size', { value: 8 * 1024 * 1024 })
    expect(await bereiteAiAnhangAuf(datei)).toBe(datei)
  })
})
