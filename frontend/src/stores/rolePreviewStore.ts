import { create } from 'zustand'
import type { TeamDetail, TeamRole } from '@/api/teams'
import type { MePermissions, Role } from '@/types/permissions'

export interface PanelRolePreview {
  kind: 'panel'
  roleId: number
  roleName: string
  isSystem: boolean
  color: string
  icon: string | null
  permissions: string[]
}

export interface TeamRolePreview {
  kind: 'team'
  teamId: number
  teamName: string
  roleId: number
  roleName: string
  isAdmin: boolean
  isDefault: boolean
  color: string
  icon: string | null
  permissionKeys: string[]
  serverRolesActive: boolean
  serverKeys: Record<string, string[]>
}

export type RolePreviewTarget = PanelRolePreview | TeamRolePreview

export interface TeamPreviewAccess {
  isFounder: boolean
  canInvite: boolean
  canKick: boolean
  canManageRoles: boolean
  canManageServers: boolean
  canManageAvatar: boolean
  canManageBanner: boolean
  canAccessVault: boolean
  canManageSkills: boolean
  canManageMemory: boolean
  isPreviewingThisTeam: boolean
}

interface RolePreviewState {
  preview: RolePreviewTarget | null
  returnPath: string | null
  startPanelRolePreview: (role: Role, returnPath?: string) => void
  startTeamRolePreview: (params: { team: TeamDetail; role: TeamRole; returnPath?: string }) => void
  stopPreview: () => void
}

/**
 * Berechnet die effektiven Server-Rechte einer Team-Rolle fuer die Vorschau.
 *
 * - Ist "Serverrechte nach Rollen" deaktiviert, erhaelt jedes Mitglied die
 *   teamweiten Server-Freigaben (`team.servers`).
 * - Im Rollenmodus erhaelt eine Admin-Rolle die Team-Server-Freigaben und
 *   eine normale Rolle ihre expliziten `server_grants`.
 */
export function buildTeamRoleServerKeys(team: TeamDetail, role: TeamRole): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  if (!team.server_roles_active || role.is_admin) {
    for (const server of team.servers) {
      if (server.permission_keys.length > 0) {
        result[String(server.server_id)] = [...server.permission_keys]
      }
    }
    return result
  }

  for (const grant of role.server_grants || []) {
    if (grant.permission_keys.length > 0) {
      result[String(grant.server_id)] = [...grant.permission_keys]
    }
  }
  return result
}

/**
 * Ueberschreibt `MePermissions` im Frontend, solange eine Rollenvorschau aktiv ist.
 */
export function resolveEffectivePermissions(
  me: MePermissions | null,
  preview: RolePreviewTarget | null,
): MePermissions | null {
  if (!preview) return me

  if (preview.kind === 'panel') {
    return {
      is_owner: false,
      role_id: preview.roleId,
      role_name: preview.roleName,
      role_ids: [preview.roleId],
      role_names: [preview.roleName],
      global_keys: [...preview.permissions],
      server_keys: {},
    }
  }

  const globalKeys: string[] = []
  if (
    preview.isAdmin ||
    preview.permissionKeys.includes('ai.skills.use') ||
    preview.permissionKeys.includes('ai.skills.manage')
  ) {
    globalKeys.push('ai.skills.use')
  }
  if (
    preview.isAdmin ||
    preview.permissionKeys.includes('ai.memory.read') ||
    preview.permissionKeys.includes('ai.memory.write')
  ) {
    globalKeys.push('ai.memory.use')
  }

  return {
    is_owner: false,
    role_id: null,
    role_name: null,
    role_ids: [],
    role_names: [],
    global_keys: globalKeys,
    server_keys: preview.serverKeys,
  }
}

/**
 * Filtert geladene Serverlisten fuer die aktive Rollenvorschau.
 */
export function filterVisibleServersInPreview<T extends { id: number; is_hoster_managed?: boolean }>(
  servers: T[],
  preview: RolePreviewTarget | null,
): T[] {
  if (!preview) return servers

  if (preview.kind === 'panel') {
    if (!preview.permissions.includes('server.view')) {
      return []
    }
    if (preview.permissions.includes('servers.hoster_customers.view')) {
      return servers
    }
    return servers.filter((s) => !s.is_hoster_managed)
  }

  return servers.filter((s) => (preview.serverKeys[String(s.id)] ?? []).includes('server.view'))
}

/**
 * Berechnet die sichtbaren Team-Rechte fuer die Team-Oberflaeche.
 */
export function resolveTeamPreviewAccess(
  team: TeamDetail,
  preview: RolePreviewTarget | null,
): TeamPreviewAccess {
  if (!preview) {
    return {
      isFounder: team.is_owner,
      canInvite: team.is_owner,
      canKick: team.is_owner,
      canManageRoles: team.is_owner,
      canManageServers: team.is_owner,
      canManageAvatar: team.is_owner || Boolean(team.can_manage_avatar),
      canManageBanner: team.is_owner || Boolean(team.can_manage_banner),
      canAccessVault: team.can_access_vault !== false,
      canManageSkills: team.can_manage_skills,
      canManageMemory: team.can_manage_memory,
      isPreviewingThisTeam: false,
    }
  }

  if (preview.kind === 'panel') {
    return {
      isFounder: false,
      canInvite: false,
      canKick: false,
      canManageRoles: false,
      canManageServers: false,
      canManageAvatar: false,
      canManageBanner: false,
      canAccessVault: team.can_access_vault !== false,
      canManageSkills: team.can_manage_skills,
      canManageMemory: team.can_manage_memory,
      isPreviewingThisTeam: false,
    }
  }

  if (preview.teamId !== team.id) {
    return {
      isFounder: false,
      canInvite: false,
      canKick: false,
      canManageRoles: false,
      canManageServers: false,
      canManageAvatar: false,
      canManageBanner: false,
      canAccessVault: false,
      canManageSkills: false,
      canManageMemory: false,
      isPreviewingThisTeam: false,
    }
  }

  const has = (key: string) => preview.isAdmin || preview.permissionKeys.includes(key)

  return {
    isFounder: false,
    canInvite: has('team.members.invite'),
    canKick: has('team.members.kick'),
    canManageRoles: has('team.roles.manage'),
    canManageServers: has('team.servers.manage'),
    canManageAvatar: has('team.avatar.manage'),
    canManageBanner: has('team.banner.manage'),
    canAccessVault: has('vault.read'),
    canManageSkills: has('ai.skills.manage'),
    canManageMemory: has('ai.memory.write'),
    isPreviewingThisTeam: true,
  }
}

export const useRolePreviewStore = create<RolePreviewState>((set) => ({
  preview: null,
  returnPath: null,

  startPanelRolePreview: (role, returnPath = '/roles') =>
    set({
      preview: {
        kind: 'panel',
        roleId: role.id,
        roleName: role.name,
        isSystem: role.is_system,
        color: role.color || '#3b82f6',
        icon: role.icon ?? null,
        permissions: [...role.permissions],
      },
      returnPath,
    }),

  startTeamRolePreview: ({ team, role, returnPath = '/teams' }) =>
    set({
      preview: {
        kind: 'team',
        teamId: team.id,
        teamName: team.name,
        roleId: role.id,
        roleName: role.name,
        isAdmin: Boolean(role.is_admin),
        isDefault: Boolean(role.is_default),
        color: role.color || '#3b82f6',
        icon: role.icon ?? null,
        permissionKeys: [...(role.permission_keys || [])],
        serverRolesActive: Boolean(team.server_roles_active),
        serverKeys: buildTeamRoleServerKeys(team, role),
      },
      returnPath,
    }),

  stopPreview: () => set({ preview: null, returnPath: null }),
}))
