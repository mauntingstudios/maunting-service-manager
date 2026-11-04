import { describe, expect, it } from 'vitest'
import { KATEGORIE_HINTERGRUENDE, STANDARD_KATEGORIEN, sammlungen } from './vaultKennzahlen'
import type { VaultItem } from './vaultEintrag'

describe('vaultKennzahlen Sammlungen & Kategorie-Bilder', () => {
  it('nutzt für KATEGORIE_HINTERGRUENDE und STANDARD_KATEGORIEN ausschließlich eigene Tresor-Motive (/tresor-kategorien/)', () => {
    expect(KATEGORIE_HINTERGRUENDE.length).toBeGreaterThanOrEqual(12)
    for (const motiv of KATEGORIE_HINTERGRUENDE) {
      expect(motiv.pfad.startsWith('/tresor-kategorien/')).toBe(true)
      expect(motiv.pfad.startsWith('/hintergruende/')).toBe(false)
    }
    for (const std of STANDARD_KATEGORIEN) {
      expect(std.standardBild.startsWith('/tresor-kategorien/')).toBe(true)
    }
  })

  it('weist neu angelegten eigenen Ordnern standardmäßig kein Hintergrundbild zu', () => {
    const items: VaultItem[] = [
      {
        id: 'ordner-1',
        service: 'Mein Projekt',
        username: '',
        password: '',
        category: 'ordner',
        updatedAt: 1000,
      },
      {
        id: 'ordner-2',
        service: 'Mit Bild',
        username: '',
        password: '',
        category: 'ordner',
        updatedAt: 2000,
        extra: { titelbild: '/tresor-kategorien/server.webp' },
      },
    ]

    const ergebnis = sammlungen(items, 3000)
    const ohneBild = ergebnis.find((s) => s.id === 'ordner-1')
    const mitBild = ergebnis.find((s) => s.id === 'ordner-2')

    expect(ohneBild?.titelbild).toBeUndefined()
    expect(mitBild?.titelbild).toBe('/tresor-kategorien/server.webp')
  })
})
