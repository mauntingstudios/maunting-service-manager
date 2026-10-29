import { describe, expect, it } from 'vitest'

import { formatChatDateBadge, tagVonZeit, tagesSchluessel, tagesTrenner } from './ChatTimeline'

const t = (schluessel: string) => schluessel
const jetzt = new Date(2026, 10, 14, 12, 0, 0) // 14.11.2026, mittags

/** Ein Zeitpunkt am gewünschten Kalendertag, mittags (DST-fest). */
function am(jahr: number, monat: number, tag: number): string {
  return new Date(jahr, monat - 1, tag, 12, 0, 0).toISOString()
}

describe('Tagesschlüssel', () => {
  it('rechnet in Ortszeit, nicht in UTC', () => {
    // 23:30 UTC ist in Mitteleuropa schon der nächste Tag — der Trenner muss
    // dem Kalender des Nutzers folgen, nicht dem Server.
    const lokal = new Date(2026, 10, 14, 23, 30, 0)
    expect(tagesSchluessel(lokal.toISOString())).toBe('2026-11-14')
    expect(tagVonZeit(lokal.getTime())).toBe('2026-11-14')
  })

  it('gibt für Unbrauchbares einen leeren Schlüssel', () => {
    expect(tagesSchluessel('')).toBe('')
    expect(tagesSchluessel(null)).toBe('')
    expect(tagesSchluessel('kein-datum')).toBe('')
    expect(tagVonZeit(0)).toBe('')
  })
})

describe('Datumsbeschriftung', () => {
  it('nennt Heute und Gestern', () => {
    expect(formatChatDateBadge(am(2026, 11, 14), t, 'de', jetzt)).toBe('messenger.today')
    expect(formatChatDateBadge(am(2026, 11, 13), t, 'de', jetzt)).toBe('messenger.yesterday')
  })

  it('schreibt ältere Tage kurz und mit Jahr, wenn es ein anderes ist', () => {
    expect(formatChatDateBadge(am(2026, 11, 12), t, 'de', jetzt)).toBe('12.11.')
    expect(formatChatDateBadge(am(2025, 12, 31), t, 'de', jetzt)).toContain('2025')
  })

  it('bleibt für Unbrauchbares leer', () => {
    expect(formatChatDateBadge('kaputt', t, 'de', jetzt)).toBe('')
  })
})

describe('Tages-Trenner', () => {
  it('setzt einen Trenner je Wechsel, auch über eine Systemzeile', () => {
    const zeilen = [
      { createdAt: am(2026, 11, 13) },
      { createdAt: am(2026, 11, 13) },
      { createdAt: am(2026, 11, 14) },
      { createdAt: am(2026, 11, 14) },
    ]
    expect(tagesTrenner(zeilen)).toEqual(['2026-11-13', null, '2026-11-14', null])
  })

  it('lässt eine Zeile ohne Datum aus, ohne den Tag zu verbrauchen', () => {
    const zeilen = [
      { createdAt: am(2026, 11, 14) },
      { createdAt: 'kaputt' },
      { createdAt: am(2026, 11, 14) },
      { createdAt: am(2026, 11, 15) },
    ]
    expect(tagesTrenner(zeilen)).toEqual(['2026-11-14', null, null, '2026-11-15'])
  })
})
