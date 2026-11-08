import { describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import { begruessungSchluessel, headerHintergrundWaehlen } from './tageszeit'

describe('tageszeit', () => {
  it('liefert für jede Stunde, Variante und Kurzform einen vorhandenen Begrüßungstext', () => {
    for (const sprache of ['de', 'en']) {
      const t = i18n.getFixedT(sprache)
      for (let stunde = 0; stunde < 24; stunde++) {
        for (let zufall = 0; zufall < 5; zufall++) {
          for (const kurz of [false, true]) {
            const schluessel = begruessungSchluessel(stunde, kurz, zufall)
            const text = t(schluessel, { name: 'Maik' })
            expect(text, `${sprache}: ${schluessel}`).not.toBe(schluessel)
            expect(text).toContain('Maik')
          }
        }
      }
      expect(t('common.begruessung.ohneName')).not.toBe('common.begruessung.ohneName')
    }
  })

  it('wählt zu jeder Stunde eine Szene mit atmosphärischem Bild (ohne Browser-Hintergründe)', () => {
    for (let stunde = 0; stunde < 24; stunde++) {
      const standard = headerHintergrundWaehlen(stunde, 3)
      expect(standard.pfad).toMatch(/^\/assets\/(singra|teams)\//)
      expect(standard.pfad.startsWith('/hintergruende/')).toBe(false)

      const teams = headerHintergrundWaehlen(stunde, undefined, 'teams')
      expect(teams.pfad).toMatch(/^\/assets\/teams\/teams-bg-/)
      expect(teams.pfad.startsWith('/hintergruende/')).toBe(false)
    }
  })
})
