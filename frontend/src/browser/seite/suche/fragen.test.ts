import { describe, expect, it } from 'vitest'

import { kontextFragen, passtZumThema, themaworte, verwandteSuchen } from './fragen'

describe('Themenfilter der Suche', () => {
  it('nimmt Inhaltswörter und Ziffern, keine Fragewörter', () => {
    expect(themaworte('Wann kommt GTA 6?')).toEqual(['gta', '6'])
    expect(themaworte('wie koche ich gulasch')).toEqual(['gulasch'])
    expect(themaworte('was ist das')).toEqual([])
  })

  it('lehnt Vorschläge zum bloßen Fragewort ab', () => {
    const worte = themaworte('wann kommt gta 6')
    expect(passtZumThema('Wann – Rechtschreibung, Bedeutung, Definition und Herkunft', worte)).toBe(false)
    expect(passtZumThema('gta 6 release datum', worte)).toBe(true)
  })

  it('zeigt keine Duden-Frage bei einer Frage nach GTA 6', () => {
    const fragen = kontextFragen(
      'wann kommt gta 6',
      ['Wann – Rechtschreibung, Bedeutung, Definition und Herkunft', 'gta 6 release datum', 'gta 6 plattformen'],
      [],
    )
    expect(fragen).toEqual(['Gta 6 release datum', 'Gta 6 plattformen'])
  })

  it('nimmt echte Fragen auch bei kurzen und einzelnen Suchbegriffen', () => {
    expect(kontextFragen('hallo', ['hallo bedeutung duden'], [])[0]).toBe('Hallo bedeutung duden')
    expect(kontextFragen('hi', ['hi gadget 2026'], [])[0]).toBe('Hi gadget 2026')
    expect(kontextFragen('', ['leere suche hinweis'], [])[0]).toBe('Leere suche hinweis')
  })

  it('dedupliziert und begrenzt auf vier Fragen', () => {
    const fragen = kontextFragen(
      'spacex',
      [
        'spacex starship nächster testflug',
        'spacex aktie kurs',
        'spacex starship nächster testflug',
        'spacex mitarbeiterzahl',
        'spacex hauptsitz',
        'spacex gründung',
      ],
      [],
    )
    expect(fragen).toHaveLength(4)
    expect(fragen[0]).toBe('Spacex starship nächster testflug')
  })

  it('fällt ohne Vorschläge auf die Titel der Treffer zurück', () => {
    const fragen = kontextFragen('tauri update fehler', [], [
      { titel: 'Tauri Update schlägt fehl – Windows Signatur prüfen' },
      { titel: 'Ganz anderes Thema ohne Bezug' },
    ])
    expect(fragen).toEqual(['Tauri Update schlägt fehl'])
  })

  it('filtert verwandte Suchanfragen auf das Thema', () => {
    const liste = verwandteSuchen('wann kommt gta 6', [
      'wann rechtschreibung',
      'gta 6 trailer',
      'gta 6 preis',
      'gta 6 trailer',
    ])
    expect(liste).toEqual(['gta 6 trailer', 'gta 6 preis'])
  })
})