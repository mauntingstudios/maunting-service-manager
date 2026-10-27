// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const quellen = import.meta.glob(['/src/**/*.{ts,tsx,css}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const browserCss = readFileSync(resolve(__dirname, '../browser/browser.css'), 'utf-8')

/**
 * Der Dialog der Gruppeneinstellungen füllt die Fläche über `size="voll"`.
 *
 * Bis 27.10.2026 stand dafür `msm-dialog-vollbild` in `@layer components`. Dort
 * verliert `max-width: none` gegen `max-w-lg` aus den Utilities: der Dialog war
 * im Web und in MSS ein 32 rem breiter Streifen über die volle Höhe. Pontis sah
 * nur zufällig richtig aus, weil dort Container-Einheiten und `!important`
 * greifen. Die Maße gehören deshalb an den Baustein, nicht in eine Schicht.
 */
describe('Dialog mit voller Fläche', () => {
  it('kennt die alte Klasse nirgends mehr', () => {
    const funde = Object.entries(quellen)
      .filter(([, text]) => text.includes('msm-dialog-vollbild'))
      .map(([pfad]) => pfad)
    expect(funde).toEqual([])
  })

  it('nimmt die Vollkarte von der Pontis-Deckelung aus', () => {
    // Die Regel mit `calc(100% - 1rem) !important` gewinnt sonst gegen jede
    // Utility und macht aus dem Vollbild wieder einen Kasten.
    const deckel = browserCss.indexOf('max-width: calc(100% - 1rem) !important')
    const ausnahme = browserCss.indexOf('.msb-bereich .msm-modal-overlay > .msm-card[data-dialog-voll]')
    expect(deckel).toBeGreaterThan(-1)
    expect(ausnahme).toBeGreaterThan(deckel)
    expect(browserCss.slice(ausnahme)).toMatch(/max-width:\s*100%\s*!important/)
    expect(browserCss.slice(ausnahme)).toMatch(/max-height:\s*100%\s*!important/)
  })
})
