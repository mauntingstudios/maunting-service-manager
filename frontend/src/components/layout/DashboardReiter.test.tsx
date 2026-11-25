import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { useDashboardPreferencesStore } from '@/stores/dashboardPreferencesStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import type { User } from '@/types'
import type { MePermissions } from '@/types/permissions'

const { rechte } = vi.hoisted(() => ({ rechte: new Set<string>() }))

vi.mock('@/hooks/useHasPermission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useHasPermission')>()
  // Nur die Schlüsselprüfung ist gestellt; useIsOwner liest den echten Store.
  return { ...actual, useHasPermission: (key: string) => rechte.has(key) }
})

import { DashboardReiter } from './DashboardReiter'

const BETREIBER = { id: 1, username: 'tester', email: 't@example.invalid', is_owner: true } as unknown as User
const MITGLIED = { id: 2, username: 'mitglied', email: 'm@example.invalid', is_owner: false } as unknown as User

function rechteSetzen(me: Partial<MePermissions>) {
  usePermissionsStore.setState({
    me: {
      is_owner: false,
      role_id: null,
      role_name: null,
      global_keys: [],
      server_keys: {},
      ...me,
    },
    isLoading: false,
    error: null,
  })
}

function zeige(pfad: string) {
  return render(
    <MemoryRouter initialEntries={[pfad]}>
      <Routes>
        <Route path="*" element={<DashboardReiter />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DashboardReiter', () => {
  beforeEach(() => {
    rechte.clear()
    useDashboardPreferencesStore.getState().resetForTests()
    useAuthStore.setState({ user: MITGLIED, isAuthenticated: true, isLoading: false })
    rechteSetzen({})
  })

  it('zeigt dem Betreiber die vier Reiter und die Verwaltung im Mehr-Menü', () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige('/')

    expect(screen.getByRole('tab', { name: i18n.t('nav.dashboard') })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: i18n.t('nav.servers') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.nodes') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.aiProviders') })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.dashboard.mehr') }))
    for (const key of ['nav.users', 'nav.roles', 'nav.audit', 'mss.dashboard.panelEinstellungen', 'nav.blueprints', 'nav.panelBackups', 'nav.panelDatabase']) {
      expect(screen.getByRole('menuitem', { name: i18n.t(key) })).toBeInTheDocument()
    }
  })

  it('zeigt dem Mitglied ohne Rechte nur Dashboard und Server, ohne Mehr-Menü', () => {
    zeige('/')

    expect(screen.getByRole('tab', { name: i18n.t('nav.dashboard') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.servers') })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: i18n.t('nav.nodes') })).toBeNull()
    expect(screen.queryByRole('button', { name: i18n.t('mss.dashboard.mehr') })).toBeNull()
  })

  it('trägt keinen eigenen Balken, sondern schwebt frei wie in der MSS-App', () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige('/')

    const zeile = screen.getByRole('tablist', { name: i18n.t('mss.dashboard.bereiche') }).closest('div')
      ?.parentElement
    expect(zeile?.className).not.toMatch(/bg-|border-b|sticky|backdrop-blur/)
  })

  it('markiert auf Unterseiten den übergeordneten Reiter', () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige('/servers/abc')

    expect(screen.getByRole('tab', { name: i18n.t('nav.servers') })).toHaveAttribute('aria-selected', 'true')
  })

  it('navigiert beim Reiterklick in den Bereich', () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige('/')

    fireEvent.click(screen.getByRole('tab', { name: i18n.t('nav.nodes') }))
    expect(screen.getByRole('tab', { name: i18n.t('nav.nodes') })).toHaveAttribute('aria-selected', 'true')
  })

  it('lässt Panel-Einstellungen anpinnen, verschiebt abgepinnte Bereiche nach Mehr und setzt zurück', () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige('/')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.dashboard.anpassen') }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('customize-pin-/admin/nodes'))
    fireEvent.click(screen.getByTestId('customize-pin-/settings?tab=shop'))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dashboard.customize.done') }))

    expect(screen.queryByRole('tab', { name: i18n.t('nav.nodes') })).toBeNull()
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.shopAndHoster') })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.dashboard.mehr') }))
    expect(screen.getByRole('menuitem', { name: i18n.t('nav.nodes') })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.dashboard.anpassen') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dashboard.customize.reset') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dashboard.customize.done') }))

    expect(screen.getByRole('tab', { name: i18n.t('nav.nodes') })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: i18n.t('settings.tabs.shopAndHoster') })).toBeNull()
  })

  it('markiert angepinnte Einstellungs-Reiter auch bei historischen Deep-Links wie ?tab=hoster aktiv', () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    useDashboardPreferencesStore.getState().togglePinnedTab('/settings?tab=shop')
    zeige('/settings?tab=hoster')

    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.shopAndHoster') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
})
