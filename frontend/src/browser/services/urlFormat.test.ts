import { describe, expect, it } from 'vitest'

import { decodePunycodeHost, decodePunycodePart, formatiereAdresseZurAnzeige } from './urlFormat'

describe('urlFormat — Umlaute und Punycode dekodieren', () => {
  it('dekodiert einfache Punycode-Labels korrekt', () => {
    expect(decodePunycodePart('xn--mnchen-3ya')).toBe('münchen')
    expect(decodePunycodePart('xn--mller-kva')).toBe('müller')
    expect(decodePunycodePart('xn--bcher-kva')).toBe('bücher')
    expect(decodePunycodePart('standard')).toBe('standard')
  })

  it('dekodiert vollständige Hostnamen mit Punycode', () => {
    expect(decodePunycodeHost('xn--mnchen-3ya.de')).toBe('münchen.de')
    expect(decodePunycodeHost('sub.xn--mller-kva.de')).toBe('sub.müller.de')
    expect(decodePunycodeHost('example.com')).toBe('example.com')
  })

  it('formatiert Prozent-kodierte URLs mit Umlauten in lesbaren Text', () => {
    expect(formatiereAdresseZurAnzeige('https://de.wikipedia.org/wiki/M%C3%BCnchen')).toBe(
      'https://de.wikipedia.org/wiki/München',
    )
    expect(formatiereAdresseZurAnzeige('https://example.com/suche?q=%C3%B6%C3%A4%C3%BC%C3%96%C3%84%C3%9C')).toBe(
      'https://example.com/suche?q=öäüÖÄÜ',
    )
  })

  it('formatiert Punycode-Domains in der URL lesbar', () => {
    expect(formatiereAdresseZurAnzeige('https://xn--mnchen-3ya.de/katalog')).toBe(
      'https://münchen.de/katalog',
    )
  })

  it('lässt leere oder ungültige Strings sicher unverändert', () => {
    expect(formatiereAdresseZurAnzeige('')).toBe('')
    expect(formatiereAdresseZurAnzeige('keine-url')).toBe('keine-url')
  })

  it('erhaelt nicht-hierarchische Adressen wie about:blank oder mailto sauber', () => {
    expect(formatiereAdresseZurAnzeige('about:blank')).toBe('about:blank')
    expect(formatiereAdresseZurAnzeige('mailto:m%C3%BCller@example.com')).toBe('mailto:müller@example.com')
  })

  it('formatiert Punycode mit Port korrekt', () => {
    expect(formatiereAdresseZurAnzeige('https://xn--mnchen-3ya.de:8080/katalog')).toBe(
      'https://münchen.de:8080/katalog',
    )
  })
})
