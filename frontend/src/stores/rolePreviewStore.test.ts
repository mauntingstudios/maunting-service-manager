import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildTeamRoleServerKeys,
  filterVisibleServersInPreview,
  resolveEffectivePermissions,
  resolveTeamPreviewAccess,
  useRolePreviewStore,
} from './rolePreviewStore'
import type { TeamDetail, TeamRole } from '@/api/teams'
import type { MePermissions, Role } from '@/types/permissions'

const ownerMe: MePermissions = {
  is_owner: true,
  role_id: 1,
  role_name: 'admin',
  global_keys: ['users.manage', 'roles.manage', 'server.view'],
  server_keys: {},
}

const panelModerator: Role = {
  id: 7,
  name: 'moderator',
  description: 'Moderation',
  color: '#10b981',
  icon: 'shield',
  is_system: false,
  permissions: ['server.view', 'server.start', 'users.read'],
  created_at: '2026-10-01T00:00:00Z',
}

const teamRoleMember: TeamRole = {
  id: 20,
  team_id: 5,
  name: 'Helfer',
  description: 'Nur Valheim starten',
  color: '#f59e0b',
  icon: null,
  can_access_vault: false,
  can_manage_skills: false,
  can_manage_memory: false,
  is_default: true,
  is_admin: false,
  created_at: '2026-10-01T00:00:00Z',
  permission_keys: ['ai.skills.use'],
  server_grants: [
    { server_id: 7, server_name: 'Valheim', permission_keys: ['server.view', 'server.start'] },
  ],
  members_count: 2,
}

const teamRoleAdmin: TeamRole = {
  id: 21,
  team_id: 5,
  name: 'Team-Admin',
  description: 'Alle Teamrechte',
  color: '#3b82f6',
  icon: 'crown',
  can_access_vault: true,
  can_manage_skills: true,
  can_manage_memory: true,
  is_default: false,
  is_admin: true,
  created_at: '2026-10-01T00:00:00Z',
  permission_keys: [],
  server_grants: [],
  members_count: 1,
}

const sampleTeam: TeamDetail = {
  id: 5,
  name: 'Betrieb',
  is_personal: false,
  owner_user_id: 1,
  is_owner: true,
  can_manage_skills: true,
  can_manage_memory: true,
  can_access_vault: true,
  server_roles_active: true,
  member_count: 3,
  created_at: '2026-10-01T00:00:00Z',
  members: [],
  servers: [
    { server_id: 7, server_name: 'Valheim', permission_keys: ['server.view', 'server.start', 'server.stop'] },
    { server_id: 8, server_name: 'Rust', permission_keys: ['server.view'] },
  ],
  invitations: [],
  roles: [teamRoleAdmin, teamRoleMember],
}

describe('rolePreviewStore', () => {
  beforeEach(() => {
    useRolePreviewStore.getState().stopPreview()
  })

  it('ueberschreibt Owner-Rechte bei einer Panel-Rollenvorschau vollstaendig', () => {
    useRolePreviewStore.getState().startPanelRolePreview(panelModerator, '/roles')
    const preview = useRolePreviewStore.getState().preview

    const effective = resolveEffectivePermissions(ownerMe, preview)
    expect(effective).toEqual({
      is_owner: false,
      role_id: 7,
      role_name: 'moderator',
      role_ids: [7],
      role_names: ['moderator'],
      global_keys: ['server.view', 'server.start', 'users.read'],
      server_keys: {},
    })
  })

  it('filtert Serverlisten in der Panel-Rollenvorschau inklusive Kundenservern', () => {
    const serverListe = [
      { id: 1, name: 'Eigen', is_hoster_managed: false },
      { id: 2, name: 'Kunde', is_hoster_managed: true },
    ]

    useRolePreviewStore.getState().startPanelRolePreview(panelModerator)
    expect(filterVisibleServersInPreview(serverListe, useRolePreviewStore.getState().preview)).toEqual([
      { id: 1, name: 'Eigen', is_hoster_managed: false },
    ])

    useRolePreviewStore.getState().startPanelRolePreview({
      ...panelModerator,
      permissions: ['server.view', 'servers.hoster_customers.view'],
    })
    expect(filterVisibleServersInPreview(serverListe, useRolePreviewStore.getState().preview)).toHaveLength(2)

    useRolePreviewStore.getState().startPanelRolePreview({
      ...panelModerator,
      permissions: ['users.read'],
    })
    expect(filterVisibleServersInPreview(serverListe, useRolePreviewStore.getState().preview)).toEqual([])
  })

  it('berechnet Server-Rechte einer Team-Rolle je nach server_roles_active', () => {
    expect(buildTeamRoleServerKeys(sampleTeam, teamRoleMember)).toEqual({
      '7': ['server.view', 'server.start'],
    })

    expect(buildTeamRoleServerKeys(sampleTeam, teamRoleAdmin)).toEqual({
      '7': ['server.view', 'server.start', 'server.stop'],
      '8': ['server.view'],
    })

    expect(buildTeamRoleServerKeys({ ...sampleTeam, server_roles_active: false }, teamRoleMember)).toEqual({
      '7': ['server.view', 'server.start', 'server.stop'],
      '8': ['server.view'],
    })
  })

  it('wertet Team-Vorschaurechte im Panel und im Team einheitlich aus', () => {
    useRolePreviewStore.getState().startTeamRolePreview({
      team: sampleTeam,
      role: teamRoleMember,
    })
    const preview = useRolePreviewStore.getState().preview

    const effective = resolveEffectivePermissions(ownerMe, preview)
    expect(effective?.is_owner).toBe(false)
    expect(effective?.server_keys).toEqual({ '7': ['server.view', 'server.start'] })
    expect(effective?.global_keys).toContain('ai.skills.use')

    const visibleServers = filterVisibleServersInPreview(
      [{ id: 7 }, { id: 8 }, { id: 9 }],
      preview,
    )
    expect(visibleServers).toEqual([{ id: 7 }])

    const teamAccess = resolveTeamPreviewAccess(sampleTeam, preview)
    expect(teamAccess).toEqual({
      isFounder: false,
      canInvite: false,
      canKick: false,
      canManageRoles: false,
      canManageServers: false,
      canAccessVault: false,
      canManageSkills: false,
      canManageMemory: false,
      isPreviewingThisTeam: true,
    })
  })

  it('gibt einer Team-Admin-Rolle in der Vorschau Verwaltungsrechte ohne Gruenderstatus', () => {
    useRolePreviewStore.getState().startTeamRolePreview({
      team: sampleTeam,
      role: teamRoleAdmin,
    })
    const teamAccess = resolveTeamPreviewAccess(sampleTeam, useRolePreviewStore.getState().preview)
    expect(teamAccess.isFounder).toBe(false)
    expect(teamAccess.canInvite).toBe(true)
    expect(teamAccess.canKick).toBe(true)
    expect(teamAccess.canManageRoles).toBe(true)
    expect(teamAccess.canManageServers).toBe(true)
    expect(teamAccess.canAccessVault).toBe(true)
  })
})
