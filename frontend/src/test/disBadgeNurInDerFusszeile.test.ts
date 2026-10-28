import { describe, expect, it } from 'vitest'

/**
 * „Powered by DIS“ steht genau einmal im Panel: in der Fußzeile.
 *
 * Bis 10/2026 trug jede zweite Ansicht eine eigene Pille (Messenger-Kopf,
 * Captcha, MSS-Tresor, Startbild). Das Projekt baut auf DIS auf; als
 * Herkunftszeichen reicht die Fußzeile, überall sonst war es Dekoration.
 */
describe('Powered by DIS', () => {
  it('wird nur von der Fußzeile eingebunden', () => {
    const quellen = import.meta.glob(['/src/**/*.tsx', '!/src/**/*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    const treffer = Object.entries(quellen)
      .filter(([pfad, inhalt]) => !pfad.endsWith('/DisBadge.tsx') && inhalt.includes('DisBadge'))
      .map(([pfad]) => pfad)
      .sort()

    expect(treffer).toEqual(['/src/components/LegalFooter.tsx'])
  })
})
