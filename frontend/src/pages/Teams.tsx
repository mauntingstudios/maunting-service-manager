import { useCallback, useEffect, useMemo, useState } from 'react'
import { Server, Shield, ShieldCheck, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Spinner, type TabDef } from '@maunting/ui'

import { api, SanitizedApiError } from '@/api/client'
import {
  teamsApi,
  type Team,
  type TeamDetail,
  type TeamInvitation,
  type TeamMediaKind,
  type TeamMember,
  type TeamRole,
  type TeamServer,
} from '@/api/teams'
import { mitServerSicht } from '@/components/teams/teamPermissionsCatalog'
import { TeamVaultView } from '@/desktop/vault/TeamVaultView'
import { useHasPermission } from '@/hooks/useHasPermission'
import { useAuthStore } from '@/stores/authStore'
import { resolveTeamPreviewAccess, useRolePreviewStore } from '@/stores/rolePreviewStore'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import { useTeamInvitationStore } from '@/stores/teamInvitationStore'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { useTageszeitMotiv } from '@/lib/tageszeit'
import { TeamsOverview } from '@/components/teams/TeamsOverview'
import { TeamMediaDialog } from '@/components/teams/TeamMediaDialog'
import { TeamModal, type TeamModalSubmitPayload } from '@/components/teams/TeamModal'
import { TeamServerManager } from '@/components/teams/TeamServerManager'
import { TeamInvitationsBanner } from '@/components/teams/TeamInvitationsSection'
import { TeamMembersTab, type MemberCandidateOption } from '@/components/teams/TeamMembersTab'
import { TeamRolesTab } from '@/components/teams/TeamRolesTab'
import {
  TeamVaultHeader,
  TeamWorkspaceHeroHeader,
  type TeamWorkspaceTab,
} from '@/components/teams/TeamWorkspaceHeader'
import {
  getTeamMetadata,
  toggleTeamArchived,
  type TeamMetadata,
} from '@/components/teams/teamMeta'

/**
 * Modernes Organisation- & Team-Dashboard (Vollbild / Full-Page).
 *
 * Verwaltet Mitglieder, Berechtigungen, Server-Freigaben, geteiltes KI-Wissen
 * sowie den Ende-zu-Ende verschlüsselten Team-Tresor kollaborativer Teams.
 * Persönliche Skills und Gedächtniseinträge liegen im Benutzerprofil.
 */
const STORAGE_KEY_TEAM_ID = 'msm_teams_last_id'
const STORAGE_KEY_REITER = 'msm_teams_last_reiter'

export function Teams() {
  const { t } = useTranslation()
  const canCreate = useHasPermission('teams.create')
  const canReadUsers = useHasPermission('users.read')
  const benutzerId = useAuthStore((state) => state.user?.id ?? null)

  const headerMotiv = useTageszeitMotiv('teams')

  const [reiter, setReiterState] = useState<TeamWorkspaceTab>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_REITER) as TeamWorkspaceTab
      if (['members', 'servers', 'roles', 'vault'].includes(saved)) return saved
    }
    return 'members'
  })

  const setReiter = (next: TeamWorkspaceTab) => {
    setReiterState(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_REITER, next)
    }
  }

  const [teams, setTeams] = useState<Team[]>([])
  const [selectedId, setSelectedIdState] = useState<number | null>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_TEAM_ID)
      if (saved) {
        const num = Number(saved)
        if (!isNaN(num)) return num
      }
    }
    return null
  })

  const setSelectedId = (idOrUpdater: number | null | ((prev: number | null) => number | null)) => {
    setSelectedIdState((prev) => {
      const next = typeof idOrUpdater === 'function' ? idOrUpdater(prev) : idOrUpdater
      if (typeof localStorage !== 'undefined') {
        if (next !== null) {
          localStorage.setItem(STORAGE_KEY_TEAM_ID, String(next))
        } else {
          localStorage.removeItem(STORAGE_KEY_TEAM_ID)
        }
      }
      return next
    })
  }
  const [detail, setDetail] = useState<TeamDetail | null>(null)
  const [assignable, setAssignable] = useState<TeamServer[]>([])
  const [users, setUsers] = useState<MemberCandidateOption[]>([])
  const [einladungen, setEinladungen] = useState<TeamInvitation[]>([])
  const [view, setViewState] = useState<'overview' | 'workspace'>(() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') {
      return 'workspace'
    }
    return 'overview'
  })
  const setView = (next: 'overview' | 'workspace') => {
    setViewState(next)
  }

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<{ team: Team; meta: TeamMetadata } | null>(null)
  const [headerMediaKind, setHeaderMediaKind] = useState<TeamMediaKind | null>(null)
  const [newMemberId, setNewMemberId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editingRole, setEditingRole] = useState<TeamRole | null>(null)
  const [isCreatingRole, setIsCreatingRole] = useState(false)

  const echte = useMemo(() => teams.filter((team) => !team.is_personal), [teams])

  const reloadTeams = useCallback(async () => {
    const rows = await teamsApi.list()
    setTeams(rows)
    setSelectedId((current) =>
      current && rows.some((row) => !row.is_personal && row.id === current)
        ? current
        : (rows.find((row) => !row.is_personal)?.id ?? null),
    )
    return rows
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      teamsApi.list(),
      canReadUsers ? api<MemberCandidateOption[]>('/admin/users').catch(() => [] as MemberCandidateOption[])
        : Promise.resolve([] as MemberCandidateOption[]),
      teamsApi.invitations(),
    ])
      .then(([rows, userRows, invitationRows]) => {
        if (!active) return
        setTeams(rows)
        setSelectedId((current) =>
          current && rows.some((row) => !row.is_personal && row.id === current)
            ? current
            : (rows.find((row) => !row.is_personal)?.id ?? null),
        )
        setUsers(userRows.map((row) => ({ id: row.id, username: row.username })))
        setEinladungen(invitationRows)
      })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof SanitizedApiError ? error.message : t('teams.errors.load'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [canReadUsers, t])

  useEffect(() => {
    const onSyncEvent = (evt: Event) => {
      const payload = (evt as CustomEvent<{ type?: string; team_id?: number; scope?: string }>).detail
      if (!payload || payload.type !== 'team_updated') return
      void reloadTeams()
      void teamsApi.invitations().then(setEinladungen).catch(() => undefined)
      if (selectedId !== null && (!payload.team_id || payload.team_id === selectedId)) {
        if (payload.scope === 'deleted') {
          setDetail(null)
        } else {
          void teamsApi.get(selectedId).then((row) => {
            setDetail(row)
            setEditingTeam((prev) =>
              prev && prev.team.id === row.id ? { team: row, meta: getTeamMetadata(row) } : prev,
            )
          }).catch(() => undefined)
        }
      }
    }
    window.addEventListener('msm:sync-event', onSyncEvent)
    return () => window.removeEventListener('msm:sync-event', onSyncEvent)
  }, [reloadTeams, selectedId])

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null)
      return
    }
    let active = true
    teamsApi.get(selectedId)
      .then((row) => {
        if (!active) return
        setDetail(row)
        if (row.is_owner && !row.is_personal) {
          teamsApi.assignableServers(row.id)
            .then((rows) => { if (active) setAssignable(rows) })
            .catch(() => { if (active) setAssignable([]) })
        } else {
          setAssignable([])
        }
      })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof SanitizedApiError ? error.message : t('teams.errors.load'))
      })
    return () => { active = false }
  }, [selectedId, t])

  const run = async (action: () => Promise<unknown>, successKey?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      if (successKey) toast.success(t(successKey))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('teams.errors.save'))
    } finally {
      setBusy(false)
    }
  }

  const removeTeam = async (tm: { id: number; name: string }) => {
    if (!await confirm({
      title: t('teams.removeTitle'),
      message: t('teams.removeConfirm', { name: tm.name }),
      confirmText: t('common.delete'),
      danger: true,
    })) return
    await run(async () => {
      await teamsApi.remove(tm.id)
      setSelectedId(null)
      const rows = await reloadTeams()
      setSelectedId(rows.find((row) => !row.is_personal)?.id ?? null)
    }, 'teams.removed')
  }

  const handleOpenTeam = (id: number) => {
    setSelectedId(id)
    setView('workspace')
  }

  const handleCreateTeamSubmit = async (payload: TeamModalSubmitPayload) => {
    await run(async () => {
      const created = await teamsApi.create({
        name: payload.name,
        category: payload.category,
        description: payload.description || null,
        avatar_preset: payload.stagedAvatarFile ? null : payload.avatarPreset,
        banner_preset: payload.stagedBannerFile ? null : payload.bannerPreset,
      })
      if (payload.stagedAvatarFile) {
        await teamsApi.uploadMedia(created.id, 'avatar', payload.stagedAvatarFile)
      }
      if (payload.stagedBannerFile) {
        await teamsApi.uploadMedia(created.id, 'banner', payload.stagedBannerFile)
      }
      await reloadTeams()
      setSelectedId(created.id)
      setDetail(await teamsApi.get(created.id))
      setView('workspace')
    }, 'teams.created')
  }

  const handleEditTeamSubmit = async (payload: TeamModalSubmitPayload) => {
    if (!editingTeam) return
    await run(async () => {
      const nextName = payload.name.trim() || editingTeam.team.name
      await teamsApi.rename(editingTeam.team.id, {
        name: nextName,
        category: payload.category,
        description: payload.description || null,
      })
      await reloadTeams()
      if (selectedId) {
        setDetail(await teamsApi.get(selectedId))
      }
    }, 'teams.saved')
  }

  const refreshAfterMediaChange = async () => {
    const rows = await reloadTeams()
    if (selectedId) {
      const freshDetail = await teamsApi.get(selectedId)
      setDetail(freshDetail)
      setEditingTeam((prev) =>
        prev && prev.team.id === freshDetail.id ? { team: freshDetail, meta: getTeamMetadata(freshDetail) } : prev,
      )
    } else if (editingTeam) {
      const freshTeam = rows.find((r) => r.id === editingTeam.team.id)
      if (freshTeam) {
        setEditingTeam({ team: freshTeam, meta: getTeamMetadata(freshTeam) })
      }
    }
  }

  const handleArchiveToggle = (tm: Team) => {
    const next = toggleTeamArchived(tm.id, tm.name)
    toast.success(
      next
        ? t('teams.teamArchived', 'Team wurde ins Archiv verschoben')
        : t('teams.teamRestored', 'Team wurde wiederhergestellt'),
    )
    void reloadTeams()
  }

  const inviteMember = async () => {
    if (!detail || !newMemberId) return
    await run(async () => {
      setDetail(await teamsApi.inviteMember(detail.id, {
        user_id: Number(newMemberId),
      }))
      setNewMemberId(null)
    }, 'teams.memberInvited')
  }

  const acceptInvitation = async (invitation: TeamInvitation) => {
    await run(async () => {
      const aktualisiert = await teamsApi.acceptInvitation(invitation.team_id)
      setEinladungen((rows) => rows.filter((row) => row.team_id !== invitation.team_id))
      await reloadTeams()
      setSelectedId(invitation.team_id)
      setDetail(aktualisiert)
      void useTeamInvitationStore.getState().laden()
    }, 'teams.invitationAccepted')
  }

  const declineInvitation = async (invitation: TeamInvitation) => {
    await run(async () => {
      await teamsApi.declineInvitation(invitation.team_id)
      setEinladungen((rows) => rows.filter((row) => row.team_id !== invitation.team_id))
      void useTeamInvitationStore.getState().laden()
    }, 'teams.invitationDeclined')
  }

  const removeMember = async (member: TeamMember) => {
    if (!detail) return
    await run(async () => {
      setDetail(await teamsApi.removeMember(detail.id, member.user_id))
      await reloadTeams()
    }, 'teams.memberRemoved')
  }

  const leaveTeam = async (tm: { id: number; name: string }) => {
    if (benutzerId === null) return
    if (!await confirm({
      title: t('teams.leaveTitle'),
      message: t('teams.leaveConfirm', { name: tm.name }),
      confirmText: t('teams.leave'),
      danger: true,
    })) return
    await run(async () => {
      await teamsApi.removeMember(tm.id, benutzerId)
      setSelectedId(null)
      const rows = await reloadTeams()
      setSelectedId(rows.find((row) => !row.is_personal)?.id ?? null)
    }, 'teams.leftTeam')
  }

  const setServerKeys = async (serverId: number, keys: string[]) => {
    if (!detail) return
    await run(async () => {
      setDetail(await teamsApi.setServerGrants(detail.id, {
        server_id: serverId, permission_keys: mitServerSicht(keys).keys,
      }))
    }, 'teams.serversSaved')
  }

  const openCreateRole = () => {
    setEditingRole(null)
    setIsCreatingRole(true)
  }

  const openEditRole = (role: TeamRole) => {
    setIsCreatingRole(false)
    setEditingRole(role)
  }

  const closeRoleForm = () => {
    setIsCreatingRole(false)
    setEditingRole(null)
  }

  const onRoleSaved = (savedRole: TeamRole) => {
    setDetail((prev) => {
      if (!prev) return null
      const existing = prev.roles || []
      const found = existing.some((r) => r.id === savedRole.id)
      const nextRoles = found
        ? existing.map((r) => (r.id === savedRole.id ? savedRole : r))
        : [...existing, savedRole]
      return { ...prev, roles: nextRoles }
    })
    closeRoleForm()
  }

  const confirmSyncOverwrite = async (
    sourceServerId: number,
    targetGrants: { server_id: number; permission_keys: string[] }[],
    existingByServer: (serverId: number) => string[],
  ): Promise<boolean> => {
    const hasOverwrite = assignable.some((server) => {
      if (server.server_id === sourceServerId) return false
      const existing = existingByServer(server.server_id)
      if (existing.length === 0) return false
      const nextKeys = targetGrants.find((g) => g.server_id === server.server_id)?.permission_keys ?? []
      const nextSet = new Set(nextKeys)
      return existing.length !== nextKeys.length || existing.some((k) => !nextSet.has(k))
    })
    if (!hasOverwrite) return true
    return await confirm({
      title: t('teams.syncPermissionsConfirmTitle'),
      message: t('teams.syncPermissionsConfirmText'),
      confirmText: t('teams.syncPermissionsConfirmAction'),
    })
  }

  const syncServerKeysToAll = async (sourceServerId: number, keys: string[]) => {
    if (!detail) return
    const targetGrants = assignable.map((server) => ({
      server_id: server.server_id,
      permission_keys: mitServerSicht(keys.filter((k) => server.permission_keys.includes(k))).keys,
    }))
    const ok = await confirmSyncOverwrite(
      sourceServerId,
      targetGrants,
      (sid) => detail.servers.find((s) => s.server_id === sid)?.permission_keys ?? [],
    )
    if (!ok) return

    await run(async () => {
      setDetail(await teamsApi.setServerGrantsBatch(detail.id, { grants: targetGrants }))
    }, 'teams.serversSynced')
  }

  const setServerRolesActive = async (aktiv: boolean) => {
    if (!detail) return
    if (aktiv) {
      const weiter = await confirm({
        title: t('teams.serverRolesEnableTitle'),
        message: t('teams.serverRolesEnableText'),
        confirmText: t('teams.serverRolesEnableConfirm'),
      })
      if (!weiter) return
    }
    await run(async () => {
      setDetail(await teamsApi.setServerRolesActive(detail.id, aktiv))
    }, aktiv ? 'teams.serverRolesOn' : 'teams.serverRolesOff')
  }

  const deleteRole = async (role: TeamRole) => {
    if (!detail) return
    if (!await confirm({
      title: t('teams.deleteRoleTitle'),
      message: t('teams.deleteRoleConfirm', { name: role.name }),
      confirmText: t('common.delete'),
      danger: true,
    })) return

    await run(async () => {
      await teamsApi.deleteRole(detail.id, role.id)
      setDetail((prev) => prev ? {
        ...prev,
        roles: (prev.roles || []).filter((r) => r.id !== role.id),
      } : null)
    }, 'teams.roleDeleted')
  }

  const setMemberRoles = async (member: TeamMember, roleIds: number[]) => {
    if (!detail) return
    await run(async () => {
      const updatedMember = await teamsApi.setMemberRoles(detail.id, member.user_id, roleIds)
      setDetail((prev) => {
        if (!prev) return null
        return {
          ...prev,
          members: prev.members.map((m) => (m.user_id === member.user_id ? { ...m, ...updatedMember } : m)),
        }
      })
    }, 'common.saved')
  }

  const team = detail && !detail.is_personal && detail.id === selectedId ? detail : null
  const preview = useRolePreviewStore((s) => s.preview)
  const startTeamRolePreview = useRolePreviewStore((s) => s.startTeamRolePreview)
  const access = useMemo(
    () => (team ? resolveTeamPreviewAccess(team, preview) : null),
    [team, preview],
  )

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8" aria-label={t('common.loading')}>
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  const memberCandidates = users.filter(
    (user) => !detail?.members.some((member) => member.user_id === user.id)
      && !detail?.invitations.some((invitation) => invitation.user_id === user.id),
  )

  const offeneBeitritte = detail?.invitations ?? []

  const meinTeam = (invitation: TeamInvitation) =>
    teams.some((row) => row.id === invitation.team_id)
  const meineBeitritte = einladungen.filter((row) => !meinTeam(row))

  const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  const activePreviewRoleId =
    preview?.kind === 'team' && team && preview.teamId === team.id ? preview.roleId : null

  const handlePreviewTeamRole = (role: TeamRole) => {
    if (!team) return
    startTeamRolePreview({ team, role, returnPath: '/teams' })
    toast.success(t('rolePreview.started', { name: role.name }))
  }

  const activeMeta = team ? getTeamMetadata(team) : null

  const teamReiter: TabDef<TeamWorkspaceTab>[] = [
    { id: 'members', labelKey: 'teams.members', icon: Users, badge: team?.members.length },
    ...((access?.isFounder || access?.canManageServers) && team
      ? [{ id: 'servers' as const, labelKey: 'teams.tabServers', icon: Server, badge: team.servers.length }]
      : []),
    { id: 'roles' as const, labelKey: 'teams.roles', icon: Shield, badge: team?.roles?.length ?? 0 },
    ...(inTauri ? [{ id: 'vault' as const, labelKey: 'teams.vault', icon: ShieldCheck }] : []),
  ]
  const aktiverReiter: TeamWorkspaceTab = teamReiter.some((row) => row.id === reiter) ? reiter : 'members'

  const openEditCurrentTeam = () => {
    if (!team) return
    setEditingTeam({ team, meta: activeMeta ?? getTeamMetadata(team) })
  }

  const handleSelectTab = (nextTab: TeamWorkspaceTab) => {
    setReiter(nextTab)
    closeRoleForm()
  }

  const invitationsNode = (
    <TeamInvitationsBanner
      meineBeitritte={meineBeitritte}
      busy={busy}
      onAcceptInvitation={(inv) => void acceptInvitation(inv)}
      onDeclineInvitation={(inv) => void declineInvitation(inv)}
    />
  )

  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden text-on-surface">
      {view === 'overview' ? (
        <TeamsOverview
          teams={teams}
          detail={detail}
          invitations={einladungen}
          canCreate={canCreate}
          busy={busy}
          onOpenTeam={handleOpenTeam}
          onCreateTeam={() => setIsCreateModalOpen(true)}
          onEditTeam={(tm, meta) => setEditingTeam({ team: tm, meta })}
          onArchiveToggle={handleArchiveToggle}
          onDeleteTeam={(tm) => void removeTeam(tm)}
          onLeaveTeam={(tm) => void leaveTeam(tm)}
          onAcceptInvitation={acceptInvitation}
          onDeclineInvitation={declineInvitation}
        />
      ) : aktiverReiter === 'vault' ? (
        <>
          <TeamVaultHeader
            team={team}
            access={access}
            activeMeta={activeMeta}
            busy={busy}
            tabs={teamReiter}
            activeTab={aktiverReiter}
            onBackToOverview={() => setView('overview')}
            onSelectTab={handleSelectTab}
            onEditTeam={openEditCurrentTeam}
            onOpenMedia={setHeaderMediaKind}
            onRemoveTeam={(tm) => void removeTeam(tm)}
            onLeaveTeam={(tm) => void leaveTeam(tm)}
          />
          {invitationsNode}
          <div className="flex flex-1 min-h-0 w-full overflow-hidden" data-testid="team-workspace">
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {team && (
                <section className="flex-1 min-h-0 flex flex-col h-full w-full" aria-labelledby="team-vault">
                  <TeamVaultView
                    team={access ? { ...team, is_owner: access.isFounder, can_access_vault: access.canAccessVault } : team}
                  />
                </section>
              )}
            </main>
          </div>
        </>
      ) : (
        <div className="relative isolate flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <TageszeitHintergrund
            motiv={headerMotiv}
            hoehe="h-[460px] sm:h-[520px] lg:h-[560px]"
            deckkraft="opacity-55"
            ebene="-z-10"
          />

          <TeamWorkspaceHeroHeader
            team={team}
            access={access}
            activeMeta={activeMeta}
            busy={busy}
            tabs={teamReiter}
            activeTab={aktiverReiter}
            onBackToOverview={() => setView('overview')}
            onSelectTab={handleSelectTab}
            onEditTeam={openEditCurrentTeam}
            onOpenMedia={setHeaderMediaKind}
            onRemoveTeam={(tm) => void removeTeam(tm)}
            onLeaveTeam={(tm) => void leaveTeam(tm)}
          />

          {invitationsNode}

          <main
            className="relative z-10 mx-auto w-full max-w-7xl px-3.5 py-5 sm:px-6 sm:py-6 lg:px-8 pb-12"
            data-testid="team-workspace"
          >
            {team ? (
              <div className="w-full space-y-6">
                {aktiverReiter === 'members' && access && (
                  <TeamMembersTab
                    team={team}
                    access={access}
                    benutzerId={benutzerId}
                    kandidaten={memberCandidates}
                    newMemberId={newMemberId}
                    busy={busy}
                    offeneBeitritte={offeneBeitritte}
                    onKandidat={setNewMemberId}
                    onEinladen={() => void inviteMember()}
                    onSetMemberRoles={(member, roleIds) => void setMemberRoles(member, roleIds)}
                    onEntfernen={(member) => void removeMember(member)}
                  />
                )}

                {aktiverReiter === 'servers' && access && (
                  <TeamServerManager
                    team={team}
                    assignable={assignable}
                    busy={busy}
                    canToggleServerRoles={access.isFounder}
                    canManageRoles={access.canManageRoles}
                    onSetServerKeys={(serverId, keys) => void setServerKeys(serverId, keys)}
                    onToggleServerRoles={(next) => void setServerRolesActive(next)}
                    onSyncServerKeysToAll={(serverId, keys) => void syncServerKeysToAll(serverId, keys)}
                    onOpenRoleInRolesTab={(role) => {
                      setReiter('roles')
                      if (role) openEditRole(role)
                      else closeRoleForm()
                    }}
                  />
                )}

                {aktiverReiter === 'roles' && access && (
                  <TeamRolesTab
                    team={team}
                    assignable={assignable}
                    busy={busy}
                    canManageRoles={access.canManageRoles}
                    activePreviewRoleId={activePreviewRoleId}
                    isCreatingRole={isCreatingRole}
                    editingRole={editingRole}
                    onOpenCreateRole={openCreateRole}
                    onOpenEditRole={openEditRole}
                    onCloseRoleForm={closeRoleForm}
                    onRoleSaved={onRoleSaved}
                    onDeleteRole={(role) => void deleteRole(role)}
                    onPreviewRole={handlePreviewTeamRole}
                  />
                )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sm text-on-surface-variant">
                <div className="grid h-16 w-16 place-items-center rounded-2xl border border-outline-variant/40 bg-surface-container-high/60 text-on-surface-variant mb-4">
                  <Users className="h-8 w-8" aria-hidden="true" />
                </div>
                <h3 className="font-headline text-base font-semibold text-on-surface">
                  {echte.length === 0 ? t('teams.noTeams') : t('teams.chooseTeam')}
                </h3>
                <p className="mt-1 max-w-sm text-xs text-on-surface-variant">
                  {canCreate ? 'Gründe ein neues Team oder wähle ein bestehendes aus.' : 'Warte auf eine Einladung oder wähle ein Team aus.'}
                </p>
              </div>
            )}
          </main>
        </div>
      )}

      <TeamModal
        isOpen={isCreateModalOpen}
        mode="create"
        busy={busy}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={async (payload) => {
          await handleCreateTeamSubmit(payload)
          setIsCreateModalOpen(false)
        }}
      />

      {editingTeam && (
        <TeamModal
          isOpen={true}
          mode="edit"
          team={editingTeam.team}
          initialName={editingTeam.team.name}
          initialMeta={editingTeam.meta}
          busy={busy}
          onClose={() => setEditingTeam(null)}
          onMediaChanged={refreshAfterMediaChange}
          onSubmit={async (payload) => {
            await handleEditTeamSubmit(payload)
            setEditingTeam(null)
          }}
        />
      )}

      {team && headerMediaKind && (
        <TeamMediaDialog
          open={true}
          onClose={() => setHeaderMediaKind(null)}
          teamId={team.id}
          kind={headerMediaKind}
          activePreset={headerMediaKind === 'avatar' ? team.avatar_preset : team.banner_preset}
          hasCustomMedia={
            headerMediaKind === 'avatar'
              ? team.avatar_source === 'custom'
              : team.banner_source === 'custom'
          }
          onChanged={refreshAfterMediaChange}
        />
      )}
    </div>
  )
}
