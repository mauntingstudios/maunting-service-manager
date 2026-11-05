/**
 * Die Server-Verwaltung der App.
 *
 * Sie zeigt die Seiten des Panels und liest ihre Sichtbarkeit aus derselben
 * Navigation wie die Web-Seitenleiste. Geprüft wird beides: welche Reiter aus
 * den Rechten folgen, und dass unter jedem Pfad die erwartete Panel-Seite
 * erscheint.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import type { User } from '@/types'
import type { MePermissions } from '@/types/permissions'

const { rechte } = vi.hoisted(() => ({ rechte: new Set<string>() }))

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: (key: string) => rechte.has(key),
}))

vi.mock('@/pages/Dashboard', () => ({ Dashboard: () => <div data-testid="dashboard-seite" /> }))
vi.mock('@/pages/Servers', () => ({ Servers: () => <div data-testid="server-seite" /> }))
vi.mock('@/pages/ServerDetail', () => ({ ServerDetail: () => <div data-testid="server-detail-seite" /> }))
vi.mock('@/pages/Users', () => ({ Users: () => <div data-testid="benutzer-seite" /> }))
vi.mock('@/pages/Roles', () => ({ Roles: () => <div data-testid="rollen-seite" /> }))
vi.mock('@/pages/Blueprints', () => ({ Blueprints: () => <div data-testid="blueprints-seite" /> }))
vi.mock('@/pages/AdminNodes', () => ({ AdminNodes: () => <div data-testid="nodes-seite" /> }))
vi.mock('@/pages/AdminAudit', () => ({ AdminAudit: () => <div data-testid="audit-seite" /> }))
vi.mock('@/pages/Settings', () => ({ Settings: () => <div data-testid="panel-einstellungen-seite" /> }))
vi.mock('@/pages/settings/AiTab', () => ({ AiTab: () => <div data-testid="ai-settings-seite" /> }))
vi.mock('@/pages/PanelBackups', () => ({ PanelBackups: () => <div data-testid="panel-backups-seite" /> }))
vi.mock('@/pages/PanelDatabase', () => ({ PanelDatabase: () => <div data-testid="panel-datenbank-seite" /> }))

import { DashboardBereich } from './DashboardBereich'

const BETREIBER = { id: 1, username: 'tester', email: 't@example.com', is_owner: true } as unknown as User
const MITGLIED = { id: 2, username: 'mitglied', email: 'm@example.com', is_owner: false } as unknown as User

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
        <Route path="/*" element={<DashboardBereich />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DashboardBereich', () => {
  beforeEach(() => {
    rechte.clear()
    useAuthStore.setState({ user: MITGLIED, isAuthenticated: true, isLoading: false })
    rechteSetzen({})
  })

  it('zeigt dem Betreiber die Reiter der Panel-Navigation und die Verwaltung im Mehr-Menü', async () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige('/')

    // Reiter: Übersicht und die Infrastruktur der Panel-Navigation.
    expect(screen.getByRole('tab', { name: i18n.t('nav.dashboard') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.servers') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.nodes') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.aiProviders') })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.dashboard.mehr') }))
    for (const key of ['nav.users', 'nav.roles', 'nav.audit', 'mss.dashboard.panelEinstellungen', 'nav.blueprints', 'nav.panelBackups', 'nav.panelDatabase']) {
      expect(screen.getByRole('menuitem', { name: i18n.t(key) })).toBeInTheDocument()
    }
    expect(await screen.findByTestId('dashboard-seite')).toBeInTheDocument()
  })

  it('blendet Reiter ohne Recht aus — dieselben Regeln wie die Web-Seitenleiste', () => {
    rechte.add('nodes.read')
    rechteSetzen({ global_keys: ['nodes.read'] })
    zeige('/')

    expect(screen.getByRole('tab', { name: i18n.t('nav.dashboard') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.servers') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.nodes') })).toBeInTheDocument()
    // Administration und Panel brauchen Rechte, die hier fehlen.
    expect(screen.queryByRole('button', { name: i18n.t('mss.dashboard.mehr') })).not.toBeInTheDocument()
  })

  it('verweigert eine Route ohne Recht, auch wenn sie direkt angesprungen wird', () => {
    zeige('/users')
    expect(screen.getByText(i18n.t('routes.forbiddenTitle'))).toBeInTheDocument()
    expect(screen.queryByTestId('benutzer-seite')).not.toBeInTheDocument()
  })

  it.each([
    ['/servers', 'server-seite'],
    ['/servers/7', 'server-detail-seite'],
    ['/settings', 'panel-einstellungen-seite'],
    ['/blueprints', 'blueprints-seite'],
  ])('rendert %s mit der Panel-Seite %s', async (pfad, testid) => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige(pfad)
    expect(await screen.findByTestId(testid)).toBeInTheDocument()
  })

  it('führt einen unbekannten Pfad auf die Übersicht zurück', async () => {
    useAuthStore.setState({ user: BETREIBER, isAuthenticated: true, isLoading: false })
    rechteSetzen({ is_owner: true })
    zeige('/gibt-es-nicht')
    expect(await screen.findByTestId('dashboard-seite')).toBeInTheDocument()
  })
})
