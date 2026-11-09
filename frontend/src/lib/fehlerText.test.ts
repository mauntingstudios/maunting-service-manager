import { describe, expect, it } from 'vitest'

import { fehlerText } from './fehlerText'

describe('fehlerText', () => {
  it('nimmt die Meldung eines Error-Objekts', () => {
    expect(fehlerText(new Error('Netzwerk weg'), 'Fehler')).toBe('Netzwerk weg')
  })

  it('nimmt einen bloßen String, wie ihn ein Tauri-Befehl ablehnt', () => {
    expect(fehlerText('Command oeffne_browser not found', 'Fehler')).toBe(
      'Command oeffne_browser not found',
    )
  })

  it('fällt zurück, wenn kein Text da ist', () => {
    expect(fehlerText(undefined, 'Fehler')).toBe('Fehler')
    expect(fehlerText(new Error('   '), 'Fehler')).toBe('Fehler')
    expect(fehlerText({ status: 500 }, 'Fehler')).toBe('Fehler')
  })
})
