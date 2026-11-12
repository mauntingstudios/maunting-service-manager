import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { schutz, api } = vi.hoisted(() => ({
  schutz: { stand: null as unknown, wirft: false },
  api: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (befehl: string) => {
    if (befehl !== 'schutz_stand') return Promise.resolve(null)
    return schutz.wirft ? Promise.reject(new Error('kaputt')) : Promise.resolve(schutz.stand)
  },
}))

vi.mock('@/api/client', async (original) => ({ ...(await original<object>()), api }))

const { SanitizedApiError } = await import('@/api/client')
const { MsmSuche, gemerktLeeren, sichereSuche } = await import('./MsmSuche')
const { kontextFragen } = await import('./suche/fragen')
const { useEinstellungenStore } = await import('../services/einstellungenStore')
const { useSitzung } = await import('../services/sitzung')
const { useTabsStore } = await import('../services/tabsStore')
const { msmSucheAdresse } = await import('../services/intern')

const ADRESSE = msmSucheAdresse('Wetter Köln')

function tab() {
  return { ...useTabsStore.getState().tabs[0], id: 'tab-s', url: ADRESSE, nativDa: false }
}

function schutzMit(aktiv: boolean, kategorien: string[], beschaedigt = false) {
  return { regeln: { aktiv, kategorien }, beschaedigt }
}

const treffer = (n: number, von = 0) =>
  Array.from({ length: n }, (_, i) => ({ titel: `Titel ${von + i}`, url: `https://seite${von + i}.example/pfad`, inhalt: `Text ${von + i}` }))

/**
 * Die Anfragen laufen über Pfade: Suche, Wissen, Autocomplete. Der Test liest
 * deshalb gezielt den Pfad aus, statt sich auf die Reihenfolge der Aufrufe zu
 * verlassen — das Wissens-Panel fragt nach, ohne dass die Suche davon wüsste.
 */
const suchAufrufe: Record<string, unknown>[] = []
/** Was ein Treffer-Aufruf zurückgibt; je Test gesetzt. */
let suchAntwort: (koerper: Record<string, unknown>, aufrufe: number) => Promise<Record<string, unknown>> =
  () => Promise.resolve({ treffer: [], vorschlaege: [] })

const webAufrufe = () => suchAufrufe.filter((a) => a.kategorie !== 'news')

function koerper(aufruf = 0) {
  return webAufrufe()[aufruf]
}

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  gemerktLeeren()
  api.mockReset()
  suchAufrufe.length = 0
  suchAntwort = () => Promise.resolve({ treffer: [], vorschlaege: [] })
  schutz.stand = schutzMit(false, [])
  schutz.wirft = false
  useEinstellungenStore.setState({ suchRegion: null })
  useSitzung.setState({ stand: 'aus' })
  useTabsStore.setState({ tabs: [tab()], aktivId: 'tab-s', geschlossen: [] })

  api.mockImplementation((pfad: string, optionen?: { body?: string }) => {
    if (pfad === '/browser/suche/autocomplete') return Promise.resolve({ vorschlaege: [] })
    if (pfad === '/browser/suche/wissen') return Promise.resolve({ wissen: null })
    if (pfad === '/browser/suche') {
      const daten = JSON.parse(optionen?.body ?? '{}') as Record<string, unknown>
      suchAufrufe.push(daten)
      return suchAntwort(daten, suchAufrufe.length - 1)
    }
    return Promise.resolve({})
  })
})

describe('MSM-Suche', () => {
  it('zeigt Host, Titel und Text und schickt den Begriff in seiner Schreibweise', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(2), vorschlaege: [] })
    render(<MsmSuche tab={tab()} />)
    expect(await screen.findByText('Titel 0')).toBeInTheDocument()
    expect(screen.getByText('seite0.example')).toBeInTheDocument()
    expect(screen.getByText('Text 1')).toBeInTheDocument()
    expect(api).toHaveBeenCalledWith('/browser/suche', expect.objectContaining({ method: 'POST' }))
    expect(koerper()).toEqual({ q: 'Wetter Köln', seite: 1, sicher: false, sprache: 'de' })
  })

  it('öffnet einen Treffer im selben Tab, mit Strg in einem neuen', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(2), vorschlaege: [] })
    render(<MsmSuche tab={tab()} />)
    fireEvent.click(await screen.findByText('Titel 1'), { ctrlKey: true })
    expect(useTabsStore.getState().tabs.map((t) => t.url)).toEqual([ADRESSE, 'https://seite1.example/pfad'])
    expect(useTabsStore.getState().aktivId).toBe('tab-s')
    fireEvent.click(screen.getByText('Titel 0'))
    expect(useTabsStore.getState().tabs[0]).toMatchObject({ url: 'https://seite0.example/pfad', vorher: ADRESSE })
  })

  it('hängt weitere Ergebnisse an, ohne doppelte', async () => {
    let aufrufe = 0
    suchAntwort = (daten) => {
      if (daten.kategorie === 'news') return Promise.resolve({ treffer: [] })
      aufrufe += 1
      if (aufrufe === 1) return Promise.resolve({ treffer: treffer(10), vorschlaege: [] })
      return Promise.resolve({ treffer: [...treffer(1, 9), ...treffer(3, 10)], vorschlaege: [] })
    }
    render(<MsmSuche tab={tab()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Weitere Ergebnisse' }))
    expect(await screen.findByText('Titel 12')).toBeInTheDocument()
    expect(koerper(1).seite).toBe(2)
    expect(screen.getAllByText('Titel 9')).toHaveLength(1)
    // 13 Treffer: 1 Top-Ergebnis vor der Liste + 12 Treffer in der Liste
    expect(
      within(screen.getByRole('list', { name: /Treffer für/ })).getAllByRole('listitem'),
    ).toHaveLength(12)
  })

  it('blättert über die Seitennavigation zu einer bestimmten Seite', async () => {
    let aufrufe = 0
    suchAntwort = (daten) => {
      if (daten.kategorie === 'news') return Promise.resolve({ treffer: [] })
      aufrufe += 1
      if (aufrufe === 1) return Promise.resolve({ treffer: treffer(10), vorschlaege: [] })
      return Promise.resolve({ treffer: treffer(4, 20), vorschlaege: [] })
    }
    render(<MsmSuche tab={tab()} />)
    fireEvent.click(await screen.findByRole('button', { name: '3' }))
    expect(await screen.findByText('Titel 22')).toBeInTheDocument()
    expect(koerper(1)).toMatchObject({ q: 'Wetter Köln', seite: 3 })
  })

  it('sucht nach Zurück nicht noch einmal', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    const { unmount } = render(<MsmSuche tab={tab()} />)
    await screen.findByText('Titel 0')
    const vorherLaenge = webAufrufe().length
    unmount()
    render(<MsmSuche tab={tab()} />)
    expect(screen.getByText('Titel 0')).toBeInTheDocument()
    expect(webAufrufe()).toHaveLength(vorherLaenge)
  })

  it.each([
    ['Erwachsenen-Inhalte gesperrt', () => (schutz.stand = schutzMit(true, ['erwachsene'])), true],
    ['Schutzdatei unlesbar', () => (schutz.stand = { ...schutzMit(false, []), beschaedigt: true }), true],
    ['Stand nicht zu lesen', () => (schutz.wirft = true), true],
    ['nur Glücksspiel gesperrt', () => (schutz.stand = schutzMit(true, ['gluecksspiel'])), false],
    ['Schutz aus', () => (schutz.stand = schutzMit(false, ['erwachsene'])), false],
  ])('verlangt die sichere Suche: %s', async (_name, vorbereiten, sicher) => {
    vorbereiten()
    suchAntwort = () => Promise.resolve({ treffer: [], vorschlaege: [] })
    render(<MsmSuche tab={tab()} />)
    await waitFor(() => expect(suchAufrufe.length).toBe(1))
    expect(koerper().sicher).toBe(sicher)
  })

  it('nimmt ohne Schutzstand die sichere Suche', () => {
    expect(sichereSuche(null)).toBe(true)
  })

  it('bietet ohne eingerichtete Suche DuckDuckGo an', async () => {
    api.mockImplementation((pfad: string) => {
      if (pfad === '/browser/suche') {
        return Promise.reject(new SanitizedApiError('x', { status: 503, code: 'BROWSER_SUCHE_NICHT_EINGERICHTET' }))
      }
      return Promise.resolve({ wissen: null, vorschlaege: [] })
    })
    render(<MsmSuche tab={tab()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mit DuckDuckGo suchen' }))
    expect(useTabsStore.getState().tabs[0].url).toBe('https://duckduckgo.com/?q=Wetter%20K%C3%B6ln')
  })

  it('hält eine Instanz, die nicht antwortet, nicht für fehlendes Netz', async () => {
    let aufrufe = 0
    api.mockImplementation((pfad: string) => {
      if (pfad === '/browser/suche') {
        aufrufe += 1
        if (aufrufe === 1) {
          return Promise.reject(new SanitizedApiError('x', { status: 502, code: 'BROWSER_SUCHE_NICHT_ERREICHBAR' }))
        }
        suchAufrufe.push({ q: 'Wetter Köln', seite: 1 })
        return Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
      }
      return Promise.resolve({ wissen: null, vorschlaege: [] })
    })
    render(<MsmSuche tab={tab()} />)
    expect(await screen.findByText('Suche fehlgeschlagen')).toBeInTheDocument()
    expect(screen.queryByText('Keine Verbindung')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(await screen.findByText('Titel 0')).toBeInTheDocument()
  })

  it('sagt, wenn zu viel gesucht wurde', async () => {
    api.mockImplementation((pfad: string) => {
      if (pfad === '/browser/suche') {
        return Promise.reject(new SanitizedApiError('x', { status: 429, code: 'BROWSER_SUCHE_ZU_VIELE' }))
      }
      return Promise.resolve({ wissen: null, vorschlaege: [] })
    })
    render(<MsmSuche tab={tab()} />)
    expect(await screen.findByText(/In einer Minute geht es weiter/)).toBeInTheDocument()
  })

  it('sucht ohne Netz weiter, sobald es zurück ist', async () => {
    let aufrufe = 0
    api.mockImplementation((pfad: string) => {
      if (pfad === '/browser/suche') {
        aufrufe += 1
        if (aufrufe === 1) return Promise.reject(new TypeError('Failed to fetch'))
        suchAufrufe.push({ q: 'Wetter Köln', seite: 1 })
        return Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
      }
      return Promise.resolve({ wissen: null, vorschlaege: [] })
    })
    render(<MsmSuche tab={tab()} />)
    expect(await screen.findByText('Keine Verbindung')).toBeInTheDocument()
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('Titel 0')).toBeInTheDocument()
  })

  it('sagt, wenn es nichts gibt', async () => {
    suchAntwort = () => Promise.resolve({ treffer: [], vorschlaege: [] })
    render(<MsmSuche tab={tab()} />)
    expect(await screen.findByText('Keine Treffer für „Wetter Köln“')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Weitere Ergebnisse' })).not.toBeInTheDocument()
  })

  it('zeigt das Impressum im Footer nur mit eingerichtetem Link', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    api.mockImplementation((pfad: string, optionen?: { body?: string }) => {
      if (pfad === '/system/legal') {
        return Promise.resolve({ imprint_enabled: true, imprint_url: 'https://example.org/impressum' })
      }
      if (pfad === '/browser/suche') {
        const daten = JSON.parse(optionen?.body ?? '{}') as Record<string, unknown>
        suchAufrufe.push(daten)
        return suchAntwort(daten, suchAufrufe.length - 1)
      }
      return Promise.resolve({ wissen: null, vorschlaege: [] })
    })
    render(<MsmSuche tab={tab()} />)
    const link = await screen.findByRole('link', { name: 'Impressum' })
    expect(link).toHaveAttribute('href', 'https://example.org/impressum')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('zeigt keinen Impressum-Eintrag ohne Link', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    render(<MsmSuche tab={tab()} />)
    await screen.findByText('Titel 0')
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Impressum' })).not.toBeInTheDocument(),
    )
  })

  it('zeigt keine Wissenskarte, wenn der Server keinen passenden Eintrag liefert', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    render(<MsmSuche tab={tab()} />)
    await screen.findByText('Titel 0')
    await waitFor(() =>
      expect(screen.queryByText('Quelle: Wikipedia')).not.toBeInTheDocument(),
    )
  })

  it('zeigt in der Bildvorschau Auflösung und Originaladresse', async () => {
    suchAntwort = () =>
      Promise.resolve({
        treffer: [
          {
            titel: 'Sonnenuntergang',
            url: 'https://bild.example/seite',
            inhalt: 'Ein Bild',
            bild: 'https://bild.example/klein.jpg',
            bildOriginal: 'https://bild.example/gross.jpg',
            bildBreite: 480,
            bildHoehe: 270,
            quelle: 'bild.example',
          },
        ],
        vorschlaege: [],
      })
    render(<MsmSuche tab={tab()} />)
    await screen.findByText('Sonnenuntergang')
    fireEvent.click(screen.getByRole('tab', { name: 'Bilder' }))
    fireEvent.click(await screen.findByRole('button', { name: /Sonnenuntergang/ }))
    expect(await screen.findByText('480 × 270')).toBeInTheDocument()
    expect(screen.getByText('JPEG')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://bild.example/gross.jpg' })).toBeInTheDocument()
  })
})

describe('Kategorien von Maunting Search', () => {
  it('schickt Bilder, Videos und News als Kategorie an die Suche', async () => {
    suchAntwort = (koerper) => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    const { unmount } = render(<MsmSuche tab={tab()} />)
    await screen.findByText('Titel 0')

    fireEvent.click(screen.getByRole('tab', { name: 'Bilder' }))
    await waitFor(() => expect(suchAufrufe.at(-1)).toMatchObject({ kategorie: 'images' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Videos' }))
    await waitFor(() => expect(suchAufrufe.at(-1)).toMatchObject({ kategorie: 'videos' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Nachrichten' }))
    await waitFor(() => expect(suchAufrufe.at(-1)).toMatchObject({ kategorie: 'news' }))

    unmount()
  })

  it('wechselt die Region über die Sprachauswahl', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    const { unmount } = render(<MsmSuche tab={tab()} />)
    await screen.findByText('Titel 0')

    fireEvent.click(screen.getByRole('button', { name: 'Region und Sprache' }))
    fireEvent.click(await screen.findByRole('option', { name: 'International (Englisch)' }))
    await waitFor(() => expect(suchAufrufe.at(-1)).toMatchObject({ sprache: 'en' }))

    unmount()
  })

  it('zeigt Top-Ergebnis vor Weiteren Fragen und startet bei Klick auf eine Frage eine neue Suche', async () => {
    suchAntwort = () =>
      Promise.resolve({
        treffer: treffer(2),
        vorschlaege: ['Wetter Köln 7 Tage', 'Wetter Köln morgen'],
      })
    render(<MsmSuche tab={tab()} />)
    expect(await screen.findByText('Top-Ergebnis')).toBeInTheDocument()

    const topErgebnis = screen.getByText('Top-Ergebnis')
    const weitereFragen = screen.getByRole('region', { name: 'Weitere Fragen zum Thema' })
    const frageBtn = within(weitereFragen).getByRole('button', { name: /Wetter Köln 7 Tage/i })
    expect(
      topErgebnis.compareDocumentPosition(frageBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(frageBtn)
    expect(useTabsStore.getState().tabs[0].url).toBe(msmSucheAdresse('Wetter Köln 7 Tage'))
  })

  it('zeigt in der Wissenskarte keinen leeren Initialen-Platzhalter und macht Verwandte Themen klickbar', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    api.mockImplementation((pfad: string) => {
      if (pfad === '/browser/suche') {
        return Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
      }
      if (pfad === '/browser/suche/wissen') {
        return Promise.resolve({
          wissen: {
            titel: 'Grand Theft Auto VI',
            inhalt: 'Action-Adventure-Videospiel von Rockstar Games.',
            verwandte: ['Rockstar Games', 'Vice City'],
          },
        })
      }
      return Promise.resolve({ vorschlaege: [] })
    })

    render(<MsmSuche tab={tab()} />)
    const titel = await screen.findAllByText('Grand Theft Auto VI')
    expect(titel.length).toBeGreaterThan(0)
    // Ohne Bild erscheint kein großer Einzelbuchstaben-Platzhalter („G“)
    expect(screen.queryByText('G')).not.toBeInTheDocument()

    const themaKnopf = screen.getAllByRole('button', { name: 'Vice City' })[0]
    fireEvent.click(themaKnopf)
    expect(useTabsStore.getState().tabs[0].url).toBe(msmSucheAdresse('Vice City'))
  })

  it('verzichtet auf Konto-Knopf, Einstellungslinks, Slogan und AGPLv3-Hinweis im Footer und bindet Tageszeit-Kulisse ein', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    const { container } = render(<MsmSuche tab={tab()} />)
    await screen.findByText('Titel 0')

    expect(screen.queryByRole('button', { name: 'Konto & Einstellungen' })).not.toBeInTheDocument()
    expect(screen.queryByText(/AGPLv3/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Suchen\. Verstehen\. Entdecken\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/Ein Dienst von Maunting Studios/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Jugendschutz' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('contentinfo')).getByText('Deutschland (Deutsch)')).toBeInTheDocument()

    expect(container.querySelector('.msm-suche-kopf-huelle')).not.toBeNull()
    expect(container.querySelector('.msm-suche-kopf')).not.toBeNull()
    expect(container.querySelector('.msm-tageszeit-verlauf')).not.toBeNull()
  })

  it('verwirft veraltete Paginierungs-Antworten nach einem Suchwechsel', async () => {
    let resolveSeite2!: (val: Record<string, unknown>) => void
    let seite2Signal: AbortSignal | undefined

    api.mockImplementation((pfad: string, optionen?: { body?: string; signal?: AbortSignal }) => {
      if (pfad === '/browser/suche/autocomplete' || pfad === '/browser/suche/wissen') {
        return Promise.resolve({ vorschlaege: [], wissen: null })
      }
      if (pfad === '/browser/suche') {
        const daten = JSON.parse(optionen?.body ?? '{}') as { q: string; seite: number; kategorie?: string }
        suchAufrufe.push(daten)
        if (daten.kategorie === 'news') {
          return Promise.resolve({ treffer: [] })
        }
        if (daten.q === 'Wetter Köln' && daten.seite === 1) {
          return Promise.resolve({ treffer: treffer(10), vorschlaege: [] })
        }
        if (daten.q === 'Wetter Köln' && daten.seite === 2) {
          seite2Signal = optionen?.signal
          return new Promise((resolve) => {
            resolveSeite2 = resolve
          })
        }
        return Promise.resolve({ treffer: [{ titel: 'Neuer Suchtreffer', url: 'https://neu.example', inhalt: 'Frisch' }], vorschlaege: [] })
      }
      return Promise.resolve({})
    })

    const { rerender } = render(<MsmSuche tab={tab()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Weitere Ergebnisse' }))
    await waitFor(() => expect(resolveSeite2).toBeTypeOf('function'))

    rerender(<MsmSuche tab={{ ...tab(), url: msmSucheAdresse('Berlin') }} />)
    expect(await screen.findByText('Neuer Suchtreffer')).toBeInTheDocument()
    expect(seite2Signal?.aborted).toBe(true)

    resolveSeite2({ treffer: [{ titel: 'Veraltete Seite 2', url: 'https://alt2.example', inhalt: 'Alt' }], vorschlaege: [] })
    await waitFor(() => expect(screen.getByText('Neuer Suchtreffer')).toBeInTheDocument())
    expect(screen.queryByText('Veraltete Seite 2')).not.toBeInTheDocument()
  })

  it('zeigt Meintest du bei Korrekturen und startet bei Klick die korrigierte Suche', async () => {
    suchAntwort = () =>
      Promise.resolve({
        treffer: treffer(1),
        vorschlaege: [],
        korrekturen: ['Wetter Bonn'],
      })
    render(<MsmSuche tab={tab()} />)
    const btn = await screen.findByRole('button', { name: 'Wetter Bonn' })
    expect(screen.getByText(/Meintest du:/)).toBeInTheDocument()
    fireEvent.click(btn)
    expect(useTabsStore.getState().tabs[0].url).toBe(msmSucheAdresse('Wetter Bonn'))
  })

  it('fragt Nachrichten mit kategorie: news ab und blendet die Spalte bei 0 Treffern aus', async () => {
    suchAntwort = (koerper) => {
      if (koerper.kategorie === 'news') {
        return Promise.resolve({
          kategorie: 'news',
          treffer: [{ titel: 'Unwetterwarnung für Köln', url: 'https://news.example/1', inhalt: 'Sturm zieht auf' }],
        })
      }
      return Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    }
    const { unmount } = render(<MsmSuche tab={tab()} />)
    expect(await screen.findByText('Unwetterwarnung für Köln')).toBeInTheDocument()
    expect(suchAufrufe.some((a) => a.kategorie === 'news')).toBe(true)
    unmount()

    // Bei 0 Nachrichten ausgeblendet
    suchAntwort = (koerper) => {
      if (koerper.kategorie === 'news') return Promise.resolve({ kategorie: 'news', treffer: [] })
      return Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    }
    render(<MsmSuche tab={tab()} />)
    await screen.findByText('Titel 0')
    expect(screen.queryByText('Nachrichten zum Thema')).not.toBeInTheDocument()
  })

  it('öffnet über den Datenschutz-Link im Footer die Datenschutzerklärung', async () => {
    suchAntwort = () => Promise.resolve({ treffer: treffer(1), vorschlaege: [] })
    const einstellungenSpy = vi.spyOn(useTabsStore.getState(), 'einstellungen')
    render(<MsmSuche tab={tab()} />)
    const dsBtn = await screen.findByRole('button', { name: 'Datenschutz' })
    fireEvent.click(dsBtn)
    expect(einstellungenSpy).toHaveBeenCalledWith('datenschutzerklaerung')
    einstellungenSpy.mockRestore()
  })
})

describe('Kontextbezogene Fragen', () => {
  it('zeigt Fragen auch bei kurzen und einzelnen Suchbegriffen', () => {
    expect(kontextFragen('hallo', ['hallo bedeutung duden'], [])[0]).toBe('Hallo bedeutung duden')
    expect(kontextFragen('hi', ['hi gadget 2026'], [])[0]).toBe('Hi gadget 2026')
    expect(kontextFragen('', ['leere suche hinweis'], [])[0]).toBe('Leere suche hinweis')
  })

  it('nimmt echte Suchvorschläge statt Satz-Schablonen', () => {
    const frageliste = kontextFragen('spacex', [
      'spacex starship nächster testflug',
      'spacex aktie kurs',
      'spacex starship nächster testflug',
    ], [])
    expect(frageliste).toHaveLength(2)
    expect(frageliste[0]).toBe('Spacex starship nächster testflug')
    expect(frageliste.some((f) => /Was sind die wichtigsten Details/.test(f))).toBe(false)
  })

  it('fällt ohne Vorschläge auf die Titel der Treffer zurück', () => {
    const frageliste = kontextFragen(
      'tauri update fehler',
      [],
      [
        {
          titel: 'Tauri Update schlägt fehl – Windows Signatur prüfen',
        },
      ],
    )
    expect(frageliste).toHaveLength(1)
    expect(frageliste[0]).toBe('Tauri Update schlägt fehl')
  })
})
