import { describe, expect, it } from 'vitest'

import { SCHREIBWERKZEUGE } from '@/api/ai'

import de from './de.json'
import en from './en.json'

/**
 * Texte der KI-Aktionen: Name und Bestätigungssatz für jedes Schreibwerkzeug.
 *
 * Welche Werkzeuge es gibt, entscheidet allein `ai_tool_registry` im Backend.
 * `backend/tests/test_ai_tool_drift.py` gleicht die Registry gegen `api/ai.ts`
 * und beide Locale-Dateien ab — samt Schlüsselparität zwischen Deutsch und
 * Englisch. Hier steht nur, was ein Test aus dem Backend nicht sehen kann:
 * dass der Bestätigungstext für den Menschen lesbar ist und die roten
 * Werkzeuge ihr Versprechen im Satz tragen.
 */
const SPRACHEN = { de, en } as Record<string, typeof de>

describe('Texte der KI-Aktionen', () => {
  for (const [sprache, daten] of Object.entries(SPRACHEN)) {
    it(`${sprache}: jedes Schreibwerkzeug hat einen Namen und einen Bestätigungstext`, () => {
      const namen = daten.ai.actions.tools as Record<string, string>
      const bestaetigung = daten.ai.actions.confirm as Record<string, string>

      const ohneNamen = SCHREIBWERKZEUGE.filter((w) => !namen[w]?.trim())
      const ohneText = SCHREIBWERKZEUGE.filter((w) => !bestaetigung[w]?.trim())

      expect(ohneNamen, `ohne Namen in ${sprache}.json`).toEqual([])
      expect(ohneText, `ohne Bestätigungstext in ${sprache}.json`).toEqual([])
    })

    it(`${sprache}: kein Bestätigungstext ohne zugehöriges Werkzeug`, () => {
      // Die Gegenrichtung: ein Text für ein Werkzeug, das es nicht mehr gibt,
      // ist toter Ballast und verdeckt beim Suchen den echten Eintrag.
      const uebrig = Object.keys(daten.ai.actions.confirm).filter(
        (k) => !SCHREIBWERKZEUGE.includes(k as (typeof SCHREIBWERKZEUGE)[number]),
      )
      expect(uebrig).toEqual([])
    })
  }

  it('die unumkehrbaren Werkzeuge sagen im Text, dass es unumkehrbar ist', () => {
    // Kein Stilcheck: der Dialog färbt diese Werkzeuge rot, und die Farbe ohne
    // den passenden Satz ist eine Warnung ohne Grund.
    for (const werkzeug of ['propose_server_delete', 'propose_backup_restore'] as const) {
      const text = (de.ai.actions.confirm as Record<string, string>)[werkzeug]
      expect(text).toMatch(/rückgängig|überschrieben|weg\b|endgültig/i)
    }
  })
})
