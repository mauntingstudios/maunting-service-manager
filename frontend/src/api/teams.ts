import { api } from './client'
import type { PresenceItem } from './social'

/**
 * Teams: geteiltes KI-Wissen und gebündelte Serverrechte.
 *
 * Jeder Benutzer hat ein persönliches Ein-Mann-Team (`is_personal`), damit die
 * KI immer einen Ort zum Lernen hat. Ein echtes Team gründet, wer `teams.create`
 * besitzt.
 */
export interface TeamMember {
  user_id: number
  username: string
  avatar_url?: string | null
  role: 'owner' | 'member'
  can_manage_skills: boolean
  can_manage_memory: boolean
  can_access_vault?: boolean
  team_role_id?: number | null
  role_ids?: number[]
  roles?: TeamRole[]
  joined_at: string
  /** Was dieses Mitglied gerade tut — Teammitglieder sehen mindestens den Indikator. */
  presence?: Omit<PresenceItem, 'user_id' | 'username'> | null
}

/**
 * Eine ausgesprochene, noch nicht angenommene Einladung.
 *
 * Dieselbe Zeile aus zwei Blickwinkeln: der Gründer sieht in seiner Teamansicht,
 * wen er angeschrieben hat, der Eingeladene in seiner eigenen Liste, wer ihn
 * haben will und was ihm dabei angeboten wird. Ein Eingeladener ist **kein**
 * Mitglied — Wissen und Serverrechte des Teams erreichen ihn erst mit der
 * Annahme.
 */
export interface TeamInvitation {
  team_id: number
  team_name: string
  user_id: number
  username: string
  avatar_url?: string | null
  invited_by_username: string | null
  can_manage_skills: boolean
  can_manage_memory: boolean
  can_access_vault?: boolean
  team_role_id?: number | null
  invited_at: string
}

export interface TeamServer {
  server_id: number
  server_name: string
  permission_keys: string[]
}

export interface Team {
  id: number
  name: string
  is_personal: boolean
  owner_user_id: number
  /** Ob der Abrufende dieses Team verwalten darf — spart eine zweite Abfrage. */
  is_owner: boolean
  can_manage_skills: boolean
  can_manage_memory: boolean
  can_access_vault?: boolean
  /** Ob Serverrechte nach Rollen gelten; Standard aus. */
  server_roles_active?: boolean
  member_count: number
  created_at: string
}

export interface TeamRoleServerGrant {
  server_id: number
  server_name: string
  permission_keys: string[]
}

export interface TeamRole {
  id: number
  team_id: number
  name: string
  description?: string | null
  color: string
  icon?: string | null
  can_access_vault: boolean
  can_manage_skills: boolean
  can_manage_memory: boolean
  is_default: boolean
  is_admin: boolean
  created_at: string
  permission_keys: string[]
  server_grants: TeamRoleServerGrant[]
  members_count: number
}

export interface TeamRoleWritePayload {
  name: string
  description?: string | null
  color?: string
  icon?: string | null
  can_access_vault?: boolean
  can_manage_skills?: boolean
  can_manage_memory?: boolean
  is_default?: boolean
  is_admin?: boolean
  permission_keys?: string[]
  server_grants?: { server_id: number; permission_keys: string[] }[]
}

export interface TeamDetail extends Team {
  members: TeamMember[]
  servers: TeamServer[]
  /** Offene Einladungen dieses Teams — das Backend füllt sie nur für den Gründer. */
  invitations: TeamInvitation[]
  roles?: TeamRole[]
}

export interface TeamVaultStatusResponse {
  is_setup: boolean
  bucket_id: string | null
  key_version: number | null
  needs_rotation: boolean
  is_owner: boolean
  can_access_vault?: boolean
  rotation_state?: string | null
  pending_bucket_id?: string | null
}

export interface TeamVaultKeyslot {
  user_id: number
  wrapped_dek: string
}

export interface TeamVaultKeyslotResponse {
  key_version: number
  wrapped_dek: string
}

export interface TeamVaultMutationItem {
  id: string
  ciphertext: string
  revision: number
  is_deleted?: boolean
  expected_revision?: number
}

export interface TeamVaultSyncPayload {
  bucket_id: string
  since_revision: number
  mutations?: TeamVaultMutationItem[]
  client_format?: number
}

export interface TeamVaultSyncResult {
  server_revision: number
  entries: {
    id: string
    ciphertext: string
    revision: number
    is_deleted: boolean
    updated_at: string
  }[]
  has_more: boolean
  /** IDs, deren Mutation an `expected_revision` gescheitert ist (Backend: Liste von Strings). */
  conflicts?: string[]
}

export const teamsApi = {
  list: () => api<Team[]>('/teams'),
  get: (teamId: number) => api<TeamDetail>(`/teams/${teamId}`),
  create: (name: string) => api<Team>('/teams', {
    method: 'POST', body: JSON.stringify({ name }),
  }),
  rename: (teamId: number, name: string) => api<Team>(`/teams/${teamId}`, {
    method: 'PUT', body: JSON.stringify({ name }),
  }),
  remove: (teamId: number) => api(`/teams/${teamId}`, { method: 'DELETE' }),
  /**
   * Lädt einen Benutzer ein. Mitglied wird er erst, wenn er annimmt — die
   * Antwort führt ihn deshalb unter `invitations` und nicht unter `members`.
   * Der Name sagt das absichtlich: bis eben hieß dieser Aufruf `addMember`,
   * und die Oberfläche meldete danach eine Aufnahme, die nie stattfand.
   */
  inviteMember: (teamId: number, payload: {
    user_id: number
    can_manage_skills: boolean
    can_manage_memory: boolean
    can_access_vault?: boolean
    team_role_id?: number | null
    role_ids?: number[]
  }) => api<TeamDetail>(`/teams/${teamId}/members`, {
    method: 'POST', body: JSON.stringify(payload),
  }),
  updateMember: (teamId: number, userId: number, payload: {
    can_manage_skills: boolean
    can_manage_memory: boolean
    can_access_vault?: boolean
    team_role_id?: number | null
    role_ids?: number[]
  }) => api<TeamDetail>(`/teams/${teamId}/members/${userId}`, {
    method: 'PUT', body: JSON.stringify(payload),
  }),
  removeMember: (teamId: number, userId: number) => api<TeamDetail>(
    `/teams/${teamId}/members/${userId}`, { method: 'DELETE' },
  ),
  setServerGrants: (teamId: number, payload: {
    server_id: number; permission_keys: string[]
  }) => api<TeamDetail>(`/teams/${teamId}/servers`, {
    method: 'PUT', body: JSON.stringify(payload),
  }),
  setServerRolesActive: (teamId: number, active: boolean) =>
    api<TeamDetail>(`/teams/${teamId}/server-roles`, {
      method: 'PUT', body: JSON.stringify({ active }),
    }),
  listRoles: (teamId: number) => api<TeamRole[]>(`/teams/${teamId}/roles`),
  createRole: (teamId: number, payload: TeamRoleWritePayload) =>
    api<TeamRole>(`/teams/${teamId}/roles`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRole: (teamId: number, roleId: number, payload: Partial<TeamRoleWritePayload>) =>
    api<TeamRole>(`/teams/${teamId}/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteRole: (teamId: number, roleId: number) =>
    api(`/teams/${teamId}/roles/${roleId}`, { method: 'DELETE' }),
  setMemberRoles: (teamId: number, userId: number, roleIds: number[]) =>
    api<TeamMember>(`/teams/${teamId}/members/${userId}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ role_ids: roleIds }),
    }),
  /**
   * Was der Gründer dem Team überhaupt geben könnte — nur, was er **direkt**
   * selbst hält. Damit zeigt die Oberfläche dieselbe Obergrenze, die das
   * Backend später durchsetzt, statt sie erst beim Speichern als Fehler zu
   * offenbaren.
   */
  assignableServers: (teamId: number) => api<TeamServer[]>(`/teams/${teamId}/assignable-servers`),
  /** Die eigenen offenen Einladungen — über sie entscheidet nur der Eingeladene. */
  invitations: () => api<TeamInvitation[]>('/teams/invitations'),
  /** Beitreten. Erst hier entsteht die Mitgliedschaft. */
  acceptInvitation: (teamId: number) => api<TeamDetail>(
    `/teams/invitations/${teamId}/accept`, { method: 'POST' },
  ),
  declineInvitation: (teamId: number) => api(
    `/teams/invitations/${teamId}`, { method: 'DELETE' },
  ),
  getVaultStatus: (teamId: number) => api<TeamVaultStatusResponse>(`/teams/${teamId}/vault/status`),
  setupVault: (teamId: number, payload: { bucket_id: string }) =>
    api<{ status: string }>(`/teams/${teamId}/vault/setup`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  uploadKeyslots: (teamId: number, payload: { key_version: number; slots: TeamVaultKeyslot[] }) =>
    api<{ status: string; count: number }>(`/teams/${teamId}/vault/keyslots`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getOwnKeyslot: (teamId: number) =>
    api<TeamVaultKeyslotResponse>(`/teams/${teamId}/vault/keyslot`),
  rotationPrepare: (teamId: number, payload: { bucket_id: string }) =>
    api<{ status: string }>(`/teams/${teamId}/vault/rotation/prepare`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  rotationCommit: (teamId: number) =>
    api<{ status: string }>(`/teams/${teamId}/vault/rotation/commit`, {
      method: 'POST',
    }),
  rotationAbort: (teamId: number) =>
    api<{ status: string }>(`/teams/${teamId}/vault/rotation/abort`, { method: 'POST' }),
  rotationRollback: (teamId: number) =>
    api<{ status: string }>(`/teams/${teamId}/vault/rotation/rollback`, { method: 'POST' }),
  syncVault: (teamId: number, payload: TeamVaultSyncPayload) =>
    api<TeamVaultSyncResult>(`/teams/${teamId}/vault/sync`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resetVault: (teamId: number, payload: {
    confirmation: string
    password?: string | null
    otp_code?: string
    passkey?: Record<string, unknown>
  }) =>
    api<{ status: string }>(`/teams/${teamId}/vault/reset`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
