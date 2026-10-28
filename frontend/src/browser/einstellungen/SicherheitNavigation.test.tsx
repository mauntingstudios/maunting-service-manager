import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KATEGORIEN, sichtbareKategorien } from './kategorien'
import { EinstellungenSeite } from './EinstellungenSeite'
import { useSitzung } from '../services/sitzung'
import { useTabsStore } from '../services/tabsStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}))

vi.mock('./Allgemein', () => ({
  Allgemein: () => <div data-testid="mock-allgemein">Allgemein</div>,
}))

vi.mock('@/desktop/einstellungsreiter/SicherheitEinstellungen', () => ({
  SicherheitEinstellungen: ({ offline }: { offline?: boolean }) => (
    <div data-testid="sicherheit-einstellungen" data-offline={offline ? 'true' : 'false'}>
      <span>Sicherheit-Inhalt</span>
    </div>
  ),
}))

vi.mock('@/pages/profile/ProfilTab', () => ({
  ProfilTab: () => <div data-testid="profil-tab">Profil-Inhalt</div>,
}))
vi.mock('@/pages/profile/KontoTab', () => ({
  KontoTab: () => <div data-testid="konto-tab">Konto-Inhalt</div>,
}))
vi.mock('@/pages/profile/SocialTab', () => ({
  SocialTab: () => <div data-testid="soziales-tab">Soziales-Inhalt</div>,
}))

function Seite() {
  const url = useTabsStore((s) => s.tabs.find((t) => t.id === s.aktivId)?.url ?? '')
  return <EinstellungenSeite teil={url.split('/')[3] ?? null} />
}

const renderSeite = () =>
  render(
    <MemoryRouter>
      <Seite />
    </MemoryRouter>,
  )

describe('Sicherheit in den Browsereinstellungen', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    usePublicSettingsStore.setState({ social_enabled: true, vault_enabled: true })
    useTabsStore.setState({
      tabs: [{ id: 'tab-e', url: 'pontis://einstellungen/allgemein', titel: 'Einstellungen', privat: false, nativDa: true }],
      aktivId: 'tab-e',
    })
  })

  it('Metadaten: Profil, Konto, Sicherheit und Soziales sind Unterpunkte von MSM-Dienste', () => {
    const diensteIndex = KATEGORIEN.findIndex((k) => k.id === 'dienste')
    expect(KATEGORIEN.findIndex((k) => k.id === 'profil')).toBe(diensteIndex + 1)
    expect(KATEGORIEN.findIndex((k) => k.id === 'konto')).toBe(diensteIndex + 2)
    expect(KATEGORIEN.findIndex((k) => k.id === 'sicherheit')).toBe(diensteIndex + 3)
    expect(KATEGORIEN.findIndex((k) => k.id === 'soziales')).toBe(diensteIndex + 4)
    for (const id of ['profil', 'konto', 'sicherheit', 'soziales'] as const) {
      expect(KATEGORIEN.find((k) => k.id === id)?.unterpunkt).toBe(true)
    }
  })

  it('sichtbareKategorien filtert die MSM-Unterpunkte heraus, wenn nicht gekoppelt', () => {
    expect(sichtbareKategorien(false, false).some((k) => k.id === 'sicherheit')).toBe(false)
    expect(sichtbareKategorien(true, false).some((k) => k.id === 'sicherheit')).toBe(false)
    expect(sichtbareKategorien(false, true).some((k) => k.id === 'sicherheit')).toBe(true)
    expect(sichtbareKategorien(true, true).some((k) => k.id === 'sicherheit')).toBe(true)
    expect(sichtbareKategorien(true, true).some((k) => k.id === 'profil')).toBe(true)
    expect(sichtbareKategorien(true, true).some((k) => k.id === 'konto')).toBe(true)
    expect(sichtbareKategorien(true, false).some((k) => k.id === 'profil')).toBe(false)
    expect(sichtbareKategorien(true, false).some((k) => k.id === 'konto')).toBe(false)
  })

  it('Soziales erscheint nur mit Kopplung und eingeschaltetem Messenger', () => {
    expect(sichtbareKategorien(false, true, true).some((k) => k.id === 'soziales')).toBe(true)
    expect(sichtbareKategorien(false, true, false).some((k) => k.id === 'soziales')).toBe(false)
    expect(sichtbareKategorien(false, false, true).some((k) => k.id === 'soziales')).toBe(false)
  })

  it('Navigation: ungekoppelt zeigt weder Desktop noch Mobile die Sicherheitskategorie', () => {
    useSitzung.setState({ stand: 'aus' })
    renderSeite()
    const nav = screen.getByRole('navigation', { name: 'Einstellungen' })
    expect(within(nav).queryByRole('button', { name: 'Sicherheit' })).not.toBeInTheDocument()
    const tablist = screen.getByRole('tablist', { name: 'Einstellungen' })
    expect(within(tablist).queryByRole('tab', { name: /Sicherheit/i })).not.toBeInTheDocument()
  })

  it('Navigation: gekoppelt erscheint Sicherheit visuell eingerückt unter MSM-Dienste und in mobiler TabBar', async () => {
    useSitzung.setState({ stand: 'an' })
    renderSeite()
    const nav = screen.getByRole('navigation', { name: 'Einstellungen' })
    const knopf = within(nav).getByRole('button', { name: 'Sicherheit' })
    expect(knopf).toBeInTheDocument()
    expect(knopf.className).toContain('ml-3')

    const tablist = screen.getByRole('tablist', { name: 'Einstellungen' })
    const tab = within(tablist).getByRole('tab', { name: /Sicherheit/i })
    expect(tab).toBeInTheDocument()

    // Klick auf mobilen Tab öffnet Sicherheit
    await act(async () => {
      fireEvent.click(tab)
    })
    expect(useTabsStore.getState().tabs[0].url).toBe('pontis://einstellungen/sicherheit')
  })

  it('Inhalt: Profil, Konto und Soziales stehen gekoppelt unter MSM-Dienste', async () => {
    useSitzung.setState({ stand: 'an' })
    useTabsStore.getState().einstellungen('konto')
    renderSeite()
    await waitFor(() => {
      expect(screen.getByTestId('konto-tab')).toBeInTheDocument()
    })

    act(() => useTabsStore.getState().einstellungen('profil'))
    await waitFor(() => {
      expect(screen.getByTestId('profil-tab')).toBeInTheDocument()
    })

    act(() => useTabsStore.getState().einstellungen('soziales'))
    await waitFor(() => {
      expect(screen.getByTestId('soziales-tab')).toBeInTheDocument()
    })
  })

  it('Inhalt: Soziales fehlt ohne Messenger, auch als direkte Adresse', () => {
    usePublicSettingsStore.setState({ social_enabled: false, vault_enabled: true })
    useSitzung.setState({ stand: 'an' })
    useTabsStore.getState().einstellungen('soziales')
    renderSeite()

    expect(screen.queryByTestId('soziales-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-allgemein')).toBeInTheDocument()
  })

  it('Gating: direkte Adresse Profil ohne Kopplung zeigt den Kopplungshinweis', () => {
    useSitzung.setState({ stand: 'aus' })
    useTabsStore.getState().einstellungen('profil')
    renderSeite()

    expect(screen.queryByTestId('profil-tab')).not.toBeInTheDocument()
    expect(screen.getByText('Nicht mit MSM gekoppelt')).toBeInTheDocument()
  })

  it('Inhalt: gekoppelt-online lädt Sicherheitskarten', async () => {
    useSitzung.setState({ stand: 'an' })
    useTabsStore.getState().einstellungen('sicherheit')
    renderSeite()
    await waitFor(() => {
      expect(screen.getByTestId('sicherheit-einstellungen')).toBeInTheDocument()
    })
    expect(screen.getByTestId('sicherheit-einstellungen')).toHaveAttribute('data-offline', 'false')
  })

  it('Inhalt: gekoppelt-offline ist zugänglich und übergibt offline-Flag', async () => {
    useSitzung.setState({ stand: 'offline' })
    useTabsStore.getState().einstellungen('sicherheit')
    renderSeite()
    await waitFor(() => {
      expect(screen.getByTestId('sicherheit-einstellungen')).toBeInTheDocument()
    })
    expect(screen.getByTestId('sicherheit-einstellungen')).toHaveAttribute('data-offline', 'true')
  })

  it('Gating: beim Start mit stand="pruefen" wartet die Seite ohne Fehlermeldung', () => {
    useSitzung.setState({ stand: 'pruefen' })
    useTabsStore.getState().einstellungen('sicherheit')
    renderSeite()
    expect(screen.queryByTestId('sicherheit-einstellungen')).not.toBeInTheDocument()
    expect(screen.queryByText('Nicht mit MSM gekoppelt')).not.toBeInTheDocument()
  })

  it('Gating: direkte Adresse ungekoppelt zeigt Kopplungshinweis statt Karten und navigiert per Klick zu /koppeln', () => {
    useSitzung.setState({ stand: 'aus' })
    useTabsStore.getState().einstellungen('sicherheit')
    renderSeite()
    expect(screen.queryByTestId('sicherheit-einstellungen')).not.toBeInTheDocument()
    expect(screen.getByText('Nicht mit MSM gekoppelt')).toBeInTheDocument()
    const koppelnKnopf = screen.getByRole('button', { name: 'Koppeln' })
    expect(koppelnKnopf).toBeInTheDocument()
    fireEvent.click(koppelnKnopf)
    expect(mockNavigate).toHaveBeenCalledWith('/koppeln')
  })

  it('Gating: direkte Adresse abgelehnt zeigt Kopplungshinweis', () => {
    useSitzung.setState({ stand: 'abgelehnt' })
    useTabsStore.getState().einstellungen('sicherheit')
    renderSeite()
    expect(screen.queryByTestId('sicherheit-einstellungen')).not.toBeInTheDocument()
    expect(screen.getByText('Nicht mit MSM gekoppelt')).toBeInTheDocument()
  })

  it('Trennung: bei Abmeldung während offener Sicherheitsseite verschwinden die Karten sofort', async () => {
    useSitzung.setState({ stand: 'an' })
    useTabsStore.getState().einstellungen('sicherheit')
    renderSeite()
    await waitFor(() => {
      expect(screen.getByTestId('sicherheit-einstellungen')).toBeInTheDocument()
    })

    act(() => {
      useSitzung.setState({ stand: 'aus' })
    })

    expect(screen.queryByTestId('sicherheit-einstellungen')).not.toBeInTheDocument()
    expect(screen.getByText('Nicht mit MSM gekoppelt')).toBeInTheDocument()
  })
})
