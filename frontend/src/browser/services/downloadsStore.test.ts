import { beforeEach, describe, expect, it } from 'vitest'

import { DOWNLOADS_MAX, useDownloadsStore } from './downloadsStore'

const melden = (nr: number, stand: 'start' | 'pruefung' | 'fertig' | 'fehler' | 'abgebrochen', datei: string | null = null) =>
  useDownloadsStore.getState().ereignis({ art: 'download', id: 'tab-a', nr, url: `https://a.example/${nr}`, datei, stand })

describe('Downloads', () => {
  beforeEach(() => useDownloadsStore.setState({ downloads: [], neu: 0 }))

  it('führt jeden Schritt unter derselben Nummer und zählt nur neue', () => {
    melden(1, 'start')
    melden(1, 'pruefung')
    melden(1, 'fertig', 'D:/Downloads/a.pdf')
    melden(2, 'start')
    const { downloads, neu } = useDownloadsStore.getState()
    expect(neu).toBe(2)
    expect(downloads.map((d) => [d.nr, d.stand, d.datei])).toEqual([
      [2, 'start', null],
      [1, 'fertig', 'D:/Downloads/a.pdf'],
    ])
  })

  it('behält die Datei, wenn ein späterer Schritt keine nennt', () => {
    melden(1, 'fertig', 'D:/Downloads/a.pdf')
    melden(1, 'fehler')
    expect(useDownloadsStore.getState().downloads[0].datei).toBe('D:/Downloads/a.pdf')
  })

  it('leert nur, was nicht mehr läuft', () => {
    melden(1, 'fertig', 'a')
    melden(2, 'start')
    melden(3, 'pruefung')
    melden(4, 'fehler')
    useDownloadsStore.getState().leeren()
    expect(useDownloadsStore.getState().downloads.map((d) => d.nr)).toEqual([3, 2])
  })

  it('löscht einen einzelnen Download anhand seiner Nummer', () => {
    melden(1, 'fertig', 'a')
    melden(2, 'start')
    useDownloadsStore.getState().loeschen(1)
    expect(useDownloadsStore.getState().downloads.map((d) => d.nr)).toEqual([2])
  })

  it('erkennt Dateikategorien automatisch', () => {
    melden(1, 'fertig', 'C:/Users/Test/test.pdf')
    melden(2, 'fertig', 'C:/Users/Test/bild.png')
    melden(3, 'fertig', 'C:/Users/Test/setup.exe')
    melden(4, 'fertig', 'C:/Users/Test/archiv.zip')
    const { downloads } = useDownloadsStore.getState()
    expect(downloads.find((d) => d.nr === 1)?.kategorie).toBe('dokumente')
    expect(downloads.find((d) => d.nr === 2)?.kategorie).toBe('bilder')
    expect(downloads.find((d) => d.nr === 3)?.kategorie).toBe('programme')
    expect(downloads.find((d) => d.nr === 4)?.kategorie).toBe('archive')
  })

  it('begrenzt die Historie auf DOWNLOADS_MAX (500) Einträge', () => {
    for (let i = 1; i <= DOWNLOADS_MAX + 20; i++) {
      melden(i, 'fertig', `file-${i}.txt`)
    }
    const { downloads } = useDownloadsStore.getState()
    expect(downloads.length).toBe(DOWNLOADS_MAX)
    // Neueste Einträge zuerst
    expect(downloads[0].nr).toBe(DOWNLOADS_MAX + 20)
  })

  it('erlaubt das Setzen der Dateiexistenz und liefert fertige Dateien', () => {
    melden(1, 'fertig', 'C:/Downloads/gut.pdf')
    melden(2, 'start', null)
    const store = useDownloadsStore.getState()
    expect(store.fertigeDateien()).toEqual(['C:/Downloads/gut.pdf'])

    store.existenzSetzen(1, false)
    expect(useDownloadsStore.getState().downloads.find((d) => d.nr === 1)?.existiert).toBe(false)
  })
})

describe('Download-Fortschritt', () => {
  beforeEach(() => useDownloadsStore.setState({ downloads: [], neu: 0 }))

  const fortschritt = (nr: number, empfangen: number, gesamt: number | null = 1000) =>
    useDownloadsStore.getState().ereignis({
      art: 'download_fortschritt',
      id: 'tab-a',
      nr,
      empfangen,
      gesamt,
      bytes_pro_sekunde: 500,
      rest_sekunden: 1,
      ohne_daten_sekunden: 0,
    })

  it('trägt Bytes, Rate und ETA nur auf einen bekannten, laufenden Eintrag ein', () => {
    melden(1, 'start')
    fortschritt(1, 400, 1000)
    const eintrag = useDownloadsStore.getState().downloads[0]
    expect(eintrag.empfangen).toBe(400)
    expect(eintrag.gesamt).toBe(1000)
    expect(eintrag.bytesProSekunde).toBe(500)
    expect(eintrag.restSekunden).toBe(1)
    expect(eintrag.letzteBytesZeit).toEqual(expect.any(Number))
  })

  it('erzeugt keinen Geistereintrag für eine unbekannte Nummer', () => {
    fortschritt(9, 400, 1000)
    expect(useDownloadsStore.getState().downloads).toEqual([])
    expect(useDownloadsStore.getState().neu).toBe(0)
  })

  it('überschreibt keinen abgeschlossenen Stand durch verspätete Messungen', () => {
    melden(1, 'start')
    fortschritt(1, 400, 1000)
    melden(1, 'fertig', 'D:/Downloads/a.pdf')
    fortschritt(1, 900, 1000)
    const eintrag = useDownloadsStore.getState().downloads[0]
    expect(eintrag.stand).toBe('fertig')
    expect(eintrag.empfangen).toBe(400)
  })

  it('kennt den Abbruch als Abschluss und leert ihn mit', () => {
    melden(1, 'start')
    melden(1, 'abgebrochen')
    melden(2, 'start')
    useDownloadsStore.getState().leeren()
    expect(useDownloadsStore.getState().downloads.map((d) => d.nr)).toEqual([2])
  })
})
