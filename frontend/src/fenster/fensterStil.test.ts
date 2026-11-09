import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FENSTER_STIL, fensterStilAnwenden } from './fensterStil'

/** Roh lesen: Vitest liefert CSS-Importe ohne Inhalt, wenn `css` aus ist. */
const quelltext = readFileSync(resolve(__dirname, 'fenster.css'), 'utf-8')

/**
 * Das Fenster-Experiment hängt an einer Marke im `<html>` und lebt in einer
 * eigenen CSS-Datei. Beides ist der Rückweg: fällt die Marke, bleibt die
 * Oberfläche wie zuvor (`fenster.css` erklärt es). Diese Tests halten den
 * Rückweg offen, damit er nicht still verloren geht.
 */
const quellen = import.meta.glob(
  ['/src/**/*.tsx', '!/src/**/*.test.tsx', '/packages/maunting-ui/src/Fensterleiste.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

/** Bauteil → Haken, den `fenster.css` anspricht. */
const HAKEN: [string, string][] = [
  ['/src/browser/kopf/Kopfleiste.tsx', 'mui-fensterkopf'],
  ['/src/browser/kopf/Kopfleiste.tsx', 'mui-fensterknopf'],
  ['/src/browser/kopf/Navigationsleiste.tsx', 'msb-adressleiste'],
  ['/src/browser/leiste/Panel.tsx', 'msb-panelkopf'],
  ['/packages/maunting-ui/src/Fensterleiste.tsx', 'mui-fensterkopf'],
  ['/packages/maunting-ui/src/Fensterleiste.tsx', 'mui-fensterknopf'],
  ['/src/browser/kopf/VertikaleTableiste.tsx', 'msb-randleiste-links'],
  ['/src/browser/leiste/Seitenleiste.tsx', 'msb-randleiste'],
  ['/src/browser/leiste/Panel.tsx', 'msb-modulpanel'],
]

describe('Fensterstil', () => {
  afterEach(() => {
    delete document.documentElement.dataset.fenster
    vi.restoreAllMocks()
  })

  it('setzt die Marke genau dann, wenn der Stil „einheit“ gewählt ist', () => {
    fensterStilAnwenden()
    if (FENSTER_STIL === 'einheit') {
      expect(document.documentElement.dataset.fenster).toBe('einheit')
    } else {
      expect(document.documentElement.dataset.fenster).toBeUndefined()
    }
  })

  it('bleibt auf Android bei der bisherigen Darstellung', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36')
    fensterStilAnwenden()
    expect(document.documentElement.dataset.fenster).toBeUndefined()
  })

  it('bindet jede Regel an die Marke, damit die Rückkehr ein Wert bleibt', () => {
    const selektoren = quelltext
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter(Boolean)
      .flatMap((kopf) => kopf.split(',').map((s) => s.trim()))

    expect(selektoren.length).toBeGreaterThan(0)
    expect(selektoren.filter((s) => !s.startsWith("html[data-fenster='einheit']"))).toEqual([])
  })

  it('gibt den Fensterbauteilen die Haken, die die Stil-Datei anspricht', () => {
    const fehlend = HAKEN.filter(([pfad, haken]) => !quellen[pfad]?.includes(haken)).map(([pfad, haken]) => `${pfad}: ${haken}`)
    expect(fehlend).toEqual([])
  })

  it('setzt die Marke in beiden Desktop-Einstiegen vor dem ersten Bild', () => {
    for (const pfad of ['/src/browser/start.tsx', '/src/desktop/start.tsx']) {
      expect(quellen[pfad], pfad).toContain('fensterStilAnwenden()')
      expect(quellen[pfad], pfad).toContain("'@/fenster/fenster.css'")
    }
  })
})
