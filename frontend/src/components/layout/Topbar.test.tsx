import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { Topbar } from './Topbar'
import { useAuthStore } from '@/stores/authStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, api: vi.fn() }
})

const BETREIBER = { id: 1, username: 'owner', email: 'owner@example.invalid', is_owner: true } as never

function zeige(pfad = '/servers') {
  return render(
    <MemoryRouter initialEntries={[pfad]}>
      <Routes>
        <Route path="*" element={<><Topbar /><StandortAnzeige /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

function StandortAnzeige() {
  const standort = useLocation()
  return <div data-testid="standort">{standort.pathname}</div>
}

describe('Topbar', () => {
  beforeEach(() => {
    i18n.changeLanguage('de')
    vi.mocked(api).mockReset().mockResolvedValue({})
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    usePermissionsStore.setState({ me: { is_owner: true, role_id: null, role_name: null, global_keys: [], server_keys: {} }, isLoading: false, error: null })
  })

  it('zeigt die Bereiche als Reiter und markiert den offenen', () => {
    zeige('/servers')

    expect(screen.getByRole('button', { name: i18n.t('nav.dashboard') })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: i18n.t('nav.ai') })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: i18n.t('nav.chat') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('nav.teams') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('nav.docs') })).toBeInTheDocument()
  })

  it('nennt in der Kopfzeile den offenen Dashboard-Bereich', () => {
    zeige('/servers')
    expect(screen.getByRole('heading', { name: i18n.t('nav.servers') })).toBeInTheDocument()
  })

  it('trägt die deckende Fläche wie der Tauri-Fensterrahmen und die Seitenleisten', () => {
    zeige('/servers')
    // Exakt `surface-2` (`bg-surface-container`) ohne Transparenz/Blur, damit
    // kein helles Dashboard-Panorama durchscheint und Seitenleisten nahtlos anschließen.
    const klassen = screen.getByRole('banner').className
    expect(klassen).toMatch(/\bbg-surface-container\b/)
    expect(klassen).not.toMatch(/bg-surface-container\/|backdrop-blur|bg-surface-container-low|bg-background/)
  })

  it('navigiert beim Reiterklick in den Bereich', () => {
    zeige('/servers')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('nav.teams') }))
    expect(screen.getByTestId('standort')).toHaveTextContent('/teams')
  })

  it('bietet auf Unterseiten einen Zurück-Pfeil in die Liste', () => {
    zeige('/servers/abc')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(screen.getByTestId('standort')).toHaveTextContent('/servers')
  })

  it('hält den Tresor aus der Web-Navigation heraus (MSS-only)', () => {
    zeige('/servers')
    expect(screen.queryByRole('button', { name: i18n.t('mss.app.tresor') })).toBeNull()
  })

  it('öffnet das Profilmenü mit Profil und Abmelden', () => {
    zeige('/servers')

    fireEvent.click(screen.getByRole('button', { name: /benutzermenü|user menu/i }))
    expect(screen.getByRole('menuitem', { name: i18n.t('profile.title') })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: i18n.t('nav.logout') })).toBeInTheDocument()
  })

  it('öffnet das Menü-Blatt mit allen Bereichen und schließt per Escape', async () => {
    zeige('/servers')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.app.menueOeffnen') }))
    const blatt = screen.getByRole('dialog', { name: i18n.t('shell.mainNavigation') })
    expect(blatt).toBeInTheDocument()
    expect(blatt).toHaveTextContent(i18n.t('nav.dashboard'))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('shell.mainNavigation') })).toBeNull())
  })

  it('zeigt im Blatt die Downloads und meldet ab', async () => {
    zeige('/servers')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.app.menueOeffnen') }))
    const blatt = screen.getByRole('dialog', { name: i18n.t('shell.mainNavigation') })
    // Die Kopfleiste trägt dieselben Downloads als Knöpfe — gesucht wird im Blatt.
    expect(await within(blatt).findByText('Maunting Pontis')).toBeInTheDocument()
    expect(within(blatt).getByText('MSS Desktop')).toBeInTheDocument()

    fireEvent.click(within(blatt).getByRole('button', { name: i18n.t('nav.logout') }))
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
  })
})
