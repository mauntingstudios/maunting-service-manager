import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { RolePreviewBanner } from './RolePreviewBanner'
import { RequirePermission } from './RequirePermission'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { useRolePreviewStore } from '@/stores/rolePreviewStore'
import i18n from '@/i18n'
import type { Role } from '@/types/permissions'
import type { TeamDetail, TeamRole } from '@/api/teams'

const customRole: Role = {
  id: 3,
  name: 'Moderator',
  description: 'Nur Server ansehen',
  color: '#10b981',
  icon: 'shield',
  is_system: false,
  permissions: ['server.view', 'users.read'],
  created_at: '2026-10-01T00:00:00Z',
}

const teamRole: TeamRole = {
  id: 12,
  team_id: 2,
  name: 'Supporter',
  description: null,
  color: '#8b5cf6',
  icon: null,
  can_access_vault: false,
  can_manage_skills: false,
  can_manage_memory: false,
  is_default: false,
  is_admin: false,
  created_at: '2026-10-01T00:00:00Z',
  permission_keys: ['ai.skills.use'],
  server_grants: [{ server_id: 7, server_name: 'Valheim', permission_keys: ['server.view'] }],
  members_count: 1,
}

const teamDetail: TeamDetail = {
  id: 2,
  name: 'Betrieb',
  is_personal: false,
  owner_user_id: 1,
  is_owner: true,
  can_manage_skills: true,
  can_manage_memory: true,
  can_access_vault: true,
  server_roles_active: true,
  member_count: 2,
  created_at: '2026-10-01T00:00:00Z',
  members: [],
  servers: [{ server_id: 7, server_name: 'Valheim', permission_keys: ['server.view'] }],
  invitations: [],
  roles: [teamRole],
}

describe('RolePreviewBanner & RequirePermission', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    useRolePreviewStore.getState().stopPreview()
    usePermissionsStore.setState({
      me: {
        is_owner: true,
        role_id: 1,
        role_name: 'admin',
        global_keys: ['roles.manage', 'users.manage'],
        server_keys: {},
      },
      isLoading: false,
      error: null,
    })
  })

  it('rendert nichts ohne aktive Vorschau', () => {
    render(
      <MemoryRouter>
        <RolePreviewBanner />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('role-preview-banner')).not.toBeInTheDocument()
  })

  it('zeigt Panel-Rollenvorschau, sperrt nicht erlaubte Routen fuer Owner und beendet per Klick', () => {
    useRolePreviewStore.getState().startPanelRolePreview(customRole, '/roles')

    render(
      <MemoryRouter initialEntries={['/roles']}>
        <RolePreviewBanner />
        <Routes>
          <Route
            path="/roles"
            element={
              <RequirePermission routeKey="roles">
                <div>Rollen-Verwaltung</div>
              </RequirePermission>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    const banner = screen.getByTestId('role-preview-banner')
    expect(banner).toHaveTextContent('Moderator')
    expect(banner).toHaveTextContent('2 Rechte')
    // Obwohl der Nutzer selbst Owner ist, greift waehrend der Vorschau die Sperre der Rolle
    expect(screen.queryByText('Rollen-Verwaltung')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('routes.forbiddenTitle'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('rolePreview.exit') }))
    expect(screen.queryByTestId('role-preview-banner')).not.toBeInTheDocument()
    expect(screen.getByText('Rollen-Verwaltung')).toBeInTheDocument()
  })

  it('zeigt Team-Kontext und navigiert bei Zurueck & beenden zur Ausgangsseite', () => {
    useRolePreviewStore.getState().startTeamRolePreview({
      team: teamDetail,
      role: teamRole,
      returnPath: '/teams',
    })

    render(
      <MemoryRouter initialEntries={['/servers/7']}>
        <RolePreviewBanner />
        <Routes>
          <Route path="/servers/7" element={<div>Server-Detail</div>} />
          <Route path="/teams" element={<div>Teams-Seite</div>} />
        </Routes>
      </MemoryRouter>,
    )

    const banner = screen.getByTestId('role-preview-banner')
    expect(banner).toHaveTextContent('Supporter')
    expect(banner).toHaveTextContent('Team: Betrieb')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('rolePreview.backToSource') }))
    expect(screen.queryByTestId('role-preview-banner')).not.toBeInTheDocument()
    expect(screen.getByText('Teams-Seite')).toBeInTheDocument()
  })
})
