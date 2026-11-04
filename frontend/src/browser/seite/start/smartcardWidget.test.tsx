import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve(null) }))
vi.mock('@/lib/offlineSync', () => ({
  kalenderVorkommenLokal: vi.fn(() => []),
  loadCalendarEventsOfflineFirst: vi.fn(async () => ({ events: [], isOffline: false })),
  getOfflineNotes: vi.fn(() => []),
  loadNotesOfflineFirst: vi.fn(async () => ({ notes: [], isOffline: false })),
}))
vi.mock('@/services/notesCalendarCrypto', () => ({ NOTE_CIPHERTEXT_PREFIX: 'sv-note-v1:', CALENDAR_CIPHERTEXT_PREFIX: 'sv-cal-v1:' }))

const handy = vi.hoisted(() => ({ an: true }))
vi.mock('@/lib/istAndroid', () => ({ istAndroid: () => handy.an }))

vi.mock('./walletEinstieg', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./walletEinstieg')>()
  return { ...orig, walletOeffnenAnfragen: vi.fn() }
})

const { Widgets } = await import('./Widgets')
const { walletOeffnenAnfragen } = await import('./walletEinstieg')
const { useEinstellungenStore } = await import('../../services/einstellungenStore')
const { useSitzung } = await import('../../services/sitzung')
const { useAuthStore } = await import('@/stores/authStore')
import type { User } from '@/types'

const NUR_SMARTCARD = ['wetter', 'uhr', 'termine', 'notizen', 'zuletzt', 'nachrichten'] as const

const zeigen = (privat = false) => render(<MemoryRouter><Widgets privat={privat} /></MemoryRouter>)

beforeEach(() => {
  handy.an = true
  vi.mocked(walletOeffnenAnfragen).mockReset()
  useEinstellungenStore.setState({ widgetOrdnung: [], widgetsAus: [...NUR_SMARTCARD] })
  useSitzung.setState({ stand: 'an' })
  useAuthStore.setState({
    // Ein data:-Bild rendert der Avatar direkt; ein Backend-Pfad läge hinter Anmeldung.
    user: { id: 1, username: 'MaikMobile', avatar_url: 'data:image/png;base64,AAA' } as User,
    isAuthenticated: true,
  })
})

describe('Smartcard-Widget', () => {
  it('zeigt Profilbild und Namen, aber keine Kartendaten', () => {
    zeigen()
    const karte = screen.getByRole('heading', { name: 'Smartcard' }).closest('section')!
    expect(karte).toHaveTextContent('MaikMobile')
    // Das Profilbild kommt live aus dem Speicher.
    expect(karte.querySelector('img')).toHaveAttribute('alt', 'MaikMobile')
    // Keine Kartennummer, kein Ablaufdatum, nichts Abfotografierbares.
    expect(karte.textContent).not.toMatch(/\d{4}/)
  })

  it('fragt beim Öffnen über den Wallet-Einstieg an', () => {
    zeigen()
    fireEvent.click(screen.getByRole('button', { name: 'Smartcard-Wallet öffnen' }))
    expect(walletOeffnenAnfragen).toHaveBeenCalledTimes(1)
  })

  it('bietet ohne Kopplung die Kopplung an', () => {
    useSitzung.setState({ stand: 'aus' })
    useAuthStore.setState({ user: null, isAuthenticated: false })
    zeigen()
    expect(screen.getByText('Das Wallet kommt über deine MSM-Instanz.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MSM koppeln' })).toBeInTheDocument()
  })

  it('bleibt im privaten Tab und auf dem Desktop verborgen', () => {
    const { unmount } = zeigen(true)
    expect(screen.queryByRole('heading', { name: 'Smartcard' })).not.toBeInTheDocument()
    unmount()
    handy.an = false
    zeigen()
    expect(screen.queryByRole('heading', { name: 'Smartcard' })).not.toBeInTheDocument()
  })

  it('lässt sich wie jedes Widget abschalten und ordnen', () => {
    useEinstellungenStore.setState({ widgetsAus: [...NUR_SMARTCARD, 'smartcard'] })
    const { unmount } = zeigen()
    expect(screen.queryByRole('heading', { name: 'Smartcard' })).not.toBeInTheDocument()
    unmount()
    // Ohne Kopplung lädt kein Widget nach; die Ordnung steht trotzdem.
    useSitzung.setState({ stand: 'aus' })
    useEinstellungenStore.setState({ widgetsAus: [], widgetOrdnung: ['smartcard'] })
    zeigen()
    expect(screen.getAllByRole('heading')[0]).toHaveTextContent('Smartcard')
  })
})
