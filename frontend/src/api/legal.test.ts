import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicLegalSettings } from './legal'
import * as client from './client'

vi.mock('./client', () => ({ api: vi.fn() }))

/**
 * Die Fusszeile steht auf jeder Seite. Bis 10.11.2026 reichte diese Funktion die
 * Antwort ungeprueft weiter: ein leerer Body landete als `undefined` im
 * Legal-Store, und `legal.imprint_enabled` warf dann die ganze Huelle weg.
 * Der Typ wird hier hergestellt, nicht nur behauptet.
 */
describe('getPublicLegalSettings', () => {
  beforeEach(() => {
    vi.mocked(client.api).mockReset()
  })

  it.each([undefined, null, '', 'kaputt', 42, []])(
    'macht aus einer unzulaessigen Antwort (%s) sichere Vorgaben',
    async (antwort) => {
      vi.mocked(client.api).mockResolvedValue(antwort as never)

      await expect(getPublicLegalSettings()).resolves.toEqual({
        imprint_enabled: false,
        imprint_url: '',
      })
    },
  )

  it('uebernimmt nur ein echtes true und eine echte Zeichenkette', async () => {
    vi.mocked(client.api).mockResolvedValue({
      imprint_enabled: 'true',
      imprint_url: 7,
    } as never)

    await expect(getPublicLegalSettings()).resolves.toEqual({
      imprint_enabled: false,
      imprint_url: '',
    })
  })

  it('behält eine wohlgeformte Antwort', async () => {
    vi.mocked(client.api).mockResolvedValue({
      imprint_enabled: true,
      imprint_url: 'https://example.de/impressum',
    })

    await expect(getPublicLegalSettings()).resolves.toEqual({
      imprint_enabled: true,
      imprint_url: 'https://example.de/impressum',
    })
    expect(client.api).toHaveBeenCalledWith('/system/legal')
  })
})
