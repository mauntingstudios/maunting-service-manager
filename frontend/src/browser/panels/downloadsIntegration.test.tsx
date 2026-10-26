import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gerufen, fehlerBeiLoeschen } = vi.hoisted(() => ({
  gerufen: [] as { befehl: string; args: Record<string, unknown> }[],
  fehlerBeiLoeschen: { aktiv: false },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (befehl: string, args: Record<string, unknown>) => {
    gerufen.push({ befehl, args })
    if (befehl === 'download_pruefen') {
      const pfad = (args?.pfad as string) || ''
      if (pfad.includes('fehlt') || pfad.includes('geloescht')) return Promise.resolve(false)
      return Promise.resolve(true)
    }
    if (befehl === 'download_loeschen' && fehlerBeiLoeschen.aktiv) {
      return Promise.reject(new Error('Zugriff verweigert (Datei durch anderen Prozess gesperrt)'))
    }
    return Promise.resolve(null)
  },
}))

const { useDownloadsStore } = await import('../services/downloadsStore')
const { DownloadsPanel } = await import('./Downloads')

const melde = (
  nr: number,
  stand: 'start' | 'pruefung' | 'fertig' | 'blockiert' | 'fehler' | 'speicher' | 'abgebrochen',
  datei: string | null,
  url = 'https://example.com/datei.pdf',
) => useDownloadsStore.getState().ereignis({ art: 'download', id: 'tab-1', nr, stand, url, datei })

describe('Downloads – Negativ-Tests (Fehler- und Ausnahmefälle)', () => {
  beforeEach(() => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    useDownloadsStore.setState({ downloads: [], neu: 0 })
    gerufen.length = 0
    fehlerBeiLoeschen.aktiv = false
  })

  it('fängt Fehler beim Löschen auf Dateisystemebene ab und bereinigt dennoch den Eintrag (Graceful Degradation)', async () => {
    melde(1, 'fertig', 'C:\\Downloads\\gesperrt.pdf')
    fehlerBeiLoeschen.aktiv = true

    render(<DownloadsPanel />)
    expect(screen.getByText('gesperrt.pdf')).toBeInTheDocument()

    // Klick auf "von der Festplatte löschen"
    fireEvent.click(screen.getByRole('button', { name: 'gesperrt.pdf von der Festplatte löschen' }))

    // Backend-Aufruf schlug fehl, aber die UI stürzt nicht ab und der Eintrag wird entfernt
    await waitFor(() => {
      expect(gerufen).toContainEqual({ befehl: 'download_loeschen', args: { pfad: 'C:\\Downloads\\gesperrt.pdf' } })
      expect(screen.queryByText('gesperrt.pdf')).toBeNull()
      expect(useDownloadsStore.getState().downloads).toHaveLength(0)
    })
  })

  it('behandelt fehlgeschlagene Downloads sauber ohne Öffnen-Aktionen', () => {
    melde(1, 'fehler', null, 'https://example.com/unbekannt.zip')

    render(<DownloadsPanel />)
    const zeile = screen.getByText('unbekannt.zip').closest('li')!

    expect(within(zeile).getByText('Fehlgeschlagen')).toBeInTheDocument()
    // Kein Öffnen-Button für fehlgeschlagene Downloads
    expect(within(zeile).queryByRole('button', { name: /öffnen/i })).toBeNull()
    expect(within(zeile).queryByRole('button', { name: /im Ordner zeigen/i })).toBeNull()

    // Kann aus der Liste entfernt werden
    fireEvent.click(within(zeile).getByRole('button', { name: 'unbekannt.zip aus der Liste entfernen' }))
    expect(useDownloadsStore.getState().downloads).toHaveLength(0)
  })

  it('erkennt extern gelöschte Dateien via downloadPruefen und blendet Öffnen-Buttons aus', async () => {
    melde(1, 'fertig', 'C:\\Downloads\\fehlt_auf_platte.pdf')

    render(<DownloadsPanel />)

    // download_pruefen liefert für "fehlt" false -> existiert: false
    await waitFor(() => {
      expect(screen.getByText('Datei nicht mehr vorhanden')).toBeInTheDocument()
    })

    const zeile = screen.getByText('fehlt_auf_platte.pdf').closest('li')!
    expect(within(zeile).queryByRole('button', { name: /öffnen/i })).toBeNull()
    expect(within(zeile).queryByRole('button', { name: /im Ordner zeigen/i })).toBeNull()
  })

  it('zeigt leere Zustandsfläche bei Suchanfragen ohne Treffer', () => {
    melde(1, 'fertig', 'C:\\Downloads\\dokument.pdf')

    render(<DownloadsPanel />)
    expect(screen.getByText('dokument.pdf')).toBeInTheDocument()

    const suchfeld = screen.getByRole('textbox', { name: /downloads durchsuchen/i })
    fireEvent.change(suchfeld, { target: { value: 'keintreffer12345' } })

    expect(screen.queryByText('dokument.pdf')).toBeNull()
    expect(screen.getByText(/keine downloads gefunden/i)).toBeInTheDocument()
  })

  it('zeigt leere Zustandsfläche bei Kategoriefilter ohne Treffer', () => {
    melde(1, 'fertig', 'C:\\Downloads\\rechnung.pdf') // Dokument

    render(<DownloadsPanel />)
    expect(screen.getByText('rechnung.pdf')).toBeInTheDocument()

    // Filter auf Bilder umstellen
    const filterDropdown = screen.getByRole('button', { name: 'Dateikategorie filtern' })
    fireEvent.click(filterDropdown)

    const bilderOption = screen.getByRole('option', { name: /^bilder/i })
    fireEvent.click(bilderOption)

    expect(screen.queryByText('rechnung.pdf')).toBeNull()
    expect(screen.getByText(/keine downloads gefunden/i)).toBeInTheDocument()
  })
})

describe('Downloads – Integrations-Tests (Lebenszyklus & Plattform)', () => {
  beforeEach(() => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    useDownloadsStore.setState({ downloads: [], neu: 0 })
    gerufen.length = 0
    fehlerBeiLoeschen.aktiv = false
  })

  it('durchläuft den gesamten Lebenszyklus eines Downloads von Start bis Fertigstellung', () => {
    const { rerender } = render(<DownloadsPanel />)
    expect(screen.getByText(/noch keine downloads vorhanden/i)).toBeInTheDocument()

    // 1. Download startet
    melde(1, 'start', 'bericht.pdf', 'https://beispiel.de/bericht.pdf')
    rerender(<DownloadsPanel />)
    expect(screen.getByText('bericht.pdf')).toBeInTheDocument()
    expect(screen.getByText('Wird geladen')).toBeInTheDocument()

    // 2. Fortschritt wird empfangen
    useDownloadsStore.getState().ereignis({
      art: 'download_fortschritt',
      id: 'tab-1',
      nr: 1,
      empfangen: 250000,
      gesamt: 500000,
      bytes_pro_sekunde: 50000,
      rest_sekunden: 5,
      ohne_daten_sekunden: 0,
    })
    rerender(<DownloadsPanel />)
    expect(screen.getByRole('progressbar', { name: 'Fortschritt von bericht.pdf' })).toBeInTheDocument()

    // 3. Download wird fertiggestellt
    melde(1, 'fertig', 'C:\\Downloads\\bericht.pdf', 'https://beispiel.de/bericht.pdf')
    rerender(<DownloadsPanel />)
    expect(screen.getByText('Fertig')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bericht.pdf' })).toBeInTheDocument()
  })

  it('führt „Liste leeren mit Dateien löschen“ im Dialog korrekt für alle fertigen Dateien aus', async () => {
    melde(1, 'fertig', 'C:\\Downloads\\datei1.pdf')
    melde(2, 'fertig', 'C:\\Downloads\\datei2.png')

    render(<DownloadsPanel />)

    // Öffne Leeren-Dialog
    fireEvent.click(screen.getByRole('button', { name: 'Liste leeren' }))
    expect(await screen.findByText('Download-Liste leeren?')).toBeInTheDocument()

    // Checkbox für Dateien ebenfalls löschen aktivieren
    const checkbox = screen.getByRole('checkbox', { name: /zugehörige dateien/i })
    fireEvent.click(checkbox)

    // Bestätigen (bei aktivierter Checkbox heißt der Knopf „Dateien & Liste löschen“)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /dateien & liste löschen/i }))

    await waitFor(() => {
      expect(gerufen).toContainEqual({ befehl: 'download_loeschen', args: { pfad: 'C:\\Downloads\\datei1.pdf' } })
      expect(gerufen).toContainEqual({ befehl: 'download_loeschen', args: { pfad: 'C:\\Downloads\\datei2.png' } })
      expect(useDownloadsStore.getState().downloads).toHaveLength(0)
    })
  })

  it('öffnet bei Ordner-Klick das System-Verzeichnis via downloadOrdnerOeffnen', () => {
    melde(1, 'fertig', 'C:\\Downloads\\foto.jpg')

    render(<DownloadsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Ordner öffnen' }))

    expect(gerufen).toContainEqual({ befehl: 'download_ordner_oeffnen', args: undefined })
  })
})
