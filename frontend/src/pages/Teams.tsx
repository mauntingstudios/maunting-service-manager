import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Check, Crown, LogOut, Mail, Pencil, Plus, Server, Shield, ShieldCheck, Sparkles, Trash2, UserPlus, Users, UsersRound, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { api, SanitizedApiError } from '@/api/client'
import {
  teamsApi,
  type Team,
  type TeamDetail,
  type TeamInvitation,
  type TeamMember,
  type TeamRole,
  type TeamServer,
} from '@/api/teams'
import { StatusDot } from '@/components/social/StatusIndicator'
import { TeamRoleForm } from '@/components/teams/TeamRoleForm'
import { mitServerSicht } from '@/components/teams/teamPermissionsCatalog'
import { TabBar, TabDef } from '@maunting/ui'
import { TeamVaultView } from '@/desktop/vault/TeamVaultView'
import { Avatar } from '@/components/app/Avatar'
import { Button, Dropdown, MultiSelect, RoleBadge, Switch } from '@maunting/ui'
import { useHasPermission } from '@/hooks/useHasPermission'
import { useAuthStore } from '@/stores/authStore'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import { useTeamInvitationStore } from '@/stores/teamInvitationStore'
import { Spinner } from '@maunting/ui'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { headerHintergrundWaehlen } from '@/lib/tageszeit'
import { TeamsOverview } from '@/components/teams/TeamsOverview'
import { TeamModal } from '@/components/teams/TeamModal'
import { TeamServerManager } from '@/components/teams/TeamServerManager'
import {
  getTeamMetadata,
  setTeamMetadata,
  toggleTeamArchived,
  TEAM_CATEGORIES,
  type TeamMetadata,
  type TeamCategoryKey,
} from '@/components/teams/teamMeta'

interface UserOption {
  id: number
  username: string
}

type TeamReiter = 'members' | 'servers' | 'roles' | 'vault'

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

  const stunde = useMemo(() => new Date().getHours(), [])
  const headerMotiv = useMemo(() => headerHintergrundWaehlen(stunde, undefined, 'teams'), [stunde])

  const [reiter, setReiterState] = useState<TeamReiter>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_REITER) as TeamReiter
      if (['members', 'servers', 'roles', 'vault'].includes(saved)) return saved
    }
    return 'members'
  })

  const setReiter = (next: TeamReiter) => {
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
  const [users, setUsers] = useState<UserOption[]>([])
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

  const [newMemberId, setNewMemberId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

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
      canReadUsers ? api<UserOption[]>('/admin/users').catch(() => [] as UserOption[])
        : Promise.resolve([] as UserOption[]),
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

  const removeTeam = async (team: { id: number; name: string }) => {
    if (!await confirm({
      title: t('teams.removeTitle'),
      message: t('teams.removeConfirm', { name: team.name }),
      confirmText: t('common.delete'),
      danger: true,
    })) return
    await run(async () => {
      await teamsApi.remove(team.id)
      setSelectedId(null)
      const rows = await reloadTeams()
      setSelectedId(rows.find((row) => !row.is_personal)?.id ?? null)
    }, 'teams.removed')
  }

  const handleOpenTeam = (id: number) => {
    setSelectedId(id)
    setView('workspace')
  }

  const handleCreateTeamSubmit = async (payload: {
    name: string
    category: TeamCategoryKey
    description: string
    coverImage: string
  }) => {
    await run(async () => {
      const created = await teamsApi.create(payload.name)
      setTeamMetadata(created.id, {
        category: payload.category,
        description: payload.description,
        coverImage: payload.coverImage,
      })
      await reloadTeams()
      setSelectedId(created.id)
      setView('workspace')
    }, 'teams.created')
  }

  const handleEditTeamSubmit = async (payload: {
    name: string
    category: TeamCategoryKey
    description: string
    coverImage: string
  }) => {
    if (!editingTeam) return
    await run(async () => {
      const nextName = payload.name.trim()
      if (nextName && nextName !== editingTeam.team.name) {
        await teamsApi.rename(editingTeam.team.id, nextName)
      }
      setTeamMetadata(editingTeam.team.id, {
        category: payload.category,
        description: payload.description,
        coverImage: payload.coverImage,
      })
      toast.success(t('common.saved', 'Änderungen gespeichert'))
      await reloadTeams()
      if (selectedId) {
        const refreshed = await teamsApi.get(selectedId)
        setDetail(refreshed)
      }
    }, 'teams.saved')
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
        can_manage_skills: false,
        can_manage_memory: false,
        can_access_vault: true,
      }))
      setNewMemberId(null)
    }, 'teams.memberInvited')
  }

  const acceptInvitation = async (invitation: TeamInvitation, anhebung: boolean) => {
    await run(async () => {
      const aktualisiert = await teamsApi.acceptInvitation(invitation.team_id)
      setEinladungen((rows) => rows.filter((row) => row.team_id !== invitation.team_id))
      await reloadTeams()
      setSelectedId(invitation.team_id)
      setDetail(aktualisiert)
      void useTeamInvitationStore.getState().laden()
    }, anhebung ? 'teams.upgradeAccepted' : 'teams.invitationAccepted')
  }

  const declineInvitation = async (invitation: TeamInvitation, anhebung: boolean) => {
    await run(async () => {
      await teamsApi.declineInvitation(invitation.team_id)
      setEinladungen((rows) => rows.filter((row) => row.team_id !== invitation.team_id))
      void useTeamInvitationStore.getState().laden()
    }, anhebung ? 'teams.upgradeDeclined' : 'teams.invitationDeclined')
  }

  const setMemberSwitches = async (
    member: TeamMember,
    next: { can_manage_skills: boolean; can_manage_memory: boolean; can_access_vault?: boolean },
  ) => {
    if (!detail) return
    await run(async () => {
      const aktualisiert = await teamsApi.updateMember(detail.id, member.user_id, next)
      setDetail(aktualisiert)
      const angefragt = aktualisiert.invitations.some((row) => row.user_id === member.user_id)
      toast.success(angefragt
        ? t('teams.memberConsentPending', { name: member.username })
        : t('common.saved'))
    })
  }

  const removeMember = async (member: TeamMember) => {
    if (!detail) return
    await run(async () => {
      setDetail(await teamsApi.removeMember(detail.id, member.user_id))
      await reloadTeams()
    }, 'teams.memberRemoved')
  }

  const leaveTeam = async (team: { id: number; name: string }) => {
    if (benutzerId === null) return
    if (!await confirm({
      title: t('teams.leaveTitle'),
      message: t('teams.leaveConfirm', { name: team.name }),
      confirmText: t('teams.leave'),
      danger: true,
    })) return
    await run(async () => {
      await teamsApi.removeMember(team.id, benutzerId)
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

  /** Rollenwahl je Server im Rollenmodus — nur Auswahl, kein Speichern. */
  const [rollenWahl, setRollenWahl] = useState<Record<number, number | null>>({})

  const setRoleServerKeys = async (serverId: number, roleId: number, keys: string[]) => {
    if (!detail) return
    const rolle = detail.roles?.find((r) => r.id === roleId)
    if (!rolle || rolle.is_admin) return
    const naechste = mitServerSicht(keys).keys
    await run(async () => {
      const grants = (rolle.server_grants || [])
        .filter((g) => g.server_id !== serverId)
        .map((g) => ({ server_id: g.server_id, permission_keys: g.permission_keys }))
      if (naechste.length > 0) {
        grants.push({ server_id: serverId, permission_keys: naechste })
      }
      // Nur Name (Pflicht) plus volle Grant-Liste: alles andere bleibt stehen.
      const gespeichert = await teamsApi.updateRole(detail.id, roleId, {
        name: rolle.name, server_grants: grants,
      })
      onRoleSaved(gespeichert)
    }, 'teams.serversSaved')
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

  const [editingRole, setEditingRole] = useState<TeamRole | null>(null)
  const [isCreatingRole, setIsCreatingRole] = useState(false)

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

  const istMitglied = (invitation: TeamInvitation) =>
    detail?.members.some((member) => member.user_id === invitation.user_id) ?? false
  const offeneBeitritte = detail?.invitations.filter((row) => !istMitglied(row)) ?? []
  const offeneAnhebungen = detail?.invitations.filter(istMitglied) ?? []

  const meinTeam = (invitation: TeamInvitation) =>
    teams.some((team) => team.id === invitation.team_id)
  const meineBeitritte = einladungen.filter((row) => !meinTeam(row))
  const meineAnhebungen = einladungen.filter(meinTeam)

  const team = detail && !detail.is_personal && detail.id === selectedId ? detail : null
  const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

  const activeMeta = team ? getTeamMetadata(team.id, team.name) : null
  const activeCat = activeMeta ? TEAM_CATEGORIES[activeMeta.category] : null

  const teamReiter: TabDef<TeamReiter>[] = [
    { id: 'members', labelKey: 'teams.members', icon: Users, badge: team?.members.length },
    ...(team?.is_owner
      ? [{ id: 'servers' as const, labelKey: 'teams.tabServers', icon: Server, badge: team.servers.length }]
      : []),
    { id: 'roles' as const, labelKey: 'teams.roles', icon: Shield, badge: team?.roles?.length ?? 0 },
    ...(inTauri ? [{ id: 'vault' as const, labelKey: 'teams.vault', icon: ShieldCheck }] : []),
  ]
  const aktiverReiter: TeamReiter = teamReiter.some((row) => row.id === reiter) ? reiter : 'members'

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
      ) : (
        <>
      {/* ── Executive Workspace Header & Centered Hero ─────────────────── */}
      <header className="relative isolate shrink-0 overflow-hidden border-b border-outline-variant/30">
        {/* Tageszeit-Hintergrund, der atmosphärisch hinter Profilbild und Buttons liegt und nach unten verwaschen ausläuft */}
        <TageszeitHintergrund
          motiv={headerMotiv}
          hoehe="h-[480px] sm:h-[540px] lg:h-[600px]"
          deckkraft="opacity-55"
          ebene="-z-10"
          verlauf="bg-gradient-to-b from-transparent via-surface/30 60% to-surface"
        />

        {/* Frei schwebende Navigations- & Aktionsleiste ohne trennenden Glas-Balken */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 sm:px-6 sm:pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setView('overview')}
            aria-label={t('teams.backToOverview', 'Zurück zur Übersicht')}
            className="gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-full px-3 py-1.5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs sm:text-sm font-medium">{t('teams.backToOverview', 'Zurück zur Übersicht')}</span>
          </Button>

          {team && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {team.is_owner ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setEditingTeam({ team, meta: activeMeta ?? getTeamMetadata(team.id, team.name) })}
                    aria-label={t('teams.editTeam', 'Team bearbeiten')}
                    className="h-9 w-9 p-0 rounded-full bg-surface-container-high/70 hover:bg-surface-container-high text-on-surface hover:text-primary border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void removeTeam(team)}
                    aria-label={t('teams.remove')}
                    className="h-9 w-9 p-0 rounded-full bg-surface-container-high/70 hover:bg-status-destructive/15 text-status-destructive border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void leaveTeam(team)}
                  aria-label={t('teams.leave')}
                  className="h-9 w-9 p-0 rounded-full bg-surface-container-high/70 hover:bg-status-destructive/15 text-status-destructive border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Centered Atmospheric Hero Section (Mittig!) */}
        <div className="relative px-3 pt-3 pb-5 text-center sm:px-6 sm:pt-4 sm:pb-6">
          {/* Ambient Glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-20 mx-auto h-48 w-80 sm:w-[420px] rounded-full blur-3xl opacity-25"
            style={{
              background: activeCat
                ? `radial-gradient(circle, ${activeCat.colorHex} 0%, transparent 70%)`
                : 'radial-gradient(circle, var(--color-primary) 0%, transparent 70%)',
            }}
          />

          <div className="relative mx-auto flex max-w-2xl flex-col items-center">
            {/* Großes zentriertes Titelbild / Profilbild */}
            <div className="group relative h-20 w-20 sm:h-28 sm:w-28 overflow-hidden rounded-3xl border-2 border-outline-variant/40 bg-surface-container shadow-2xl transition-transform hover:scale-105">
              {activeMeta?.coverImage ? (
                <img
                  src={activeMeta.coverImage}
                  alt={team?.name ?? ''}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center bg-primary/10 text-primary">
                  <UsersRound className="h-10 w-10 sm:h-12 sm:w-12" aria-hidden="true" />
                </div>
              )}
              {team?.is_owner && (
                <button
                  type="button"
                  onClick={() => setEditingTeam({ team, meta: activeMeta ?? getTeamMetadata(team.id, team.name) })}
                  className="absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  aria-label={t('teams.editTeam', 'Team bearbeiten')}
                >
                  <Pencil className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Badges Reihe (Zentriert) */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {activeCat && (
                <span
                  style={{
                    color: activeCat.colorHex,
                    backgroundColor: activeCat.bgHex,
                    borderColor: activeCat.borderHex,
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border shadow-sm backdrop-blur-md"
                >
                  <activeCat.icon className="h-3.5 w-3.5" />
                  <span>{activeCat.label}</span>
                </span>
              )}
              {team?.is_owner && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary border border-primary/25 shadow-sm backdrop-blur-md">
                  <Crown className="h-3.5 w-3.5" />
                  <span>{t('teams.founder')}</span>
                </span>
              )}
            </div>

            {/* Zentrierter Titel mit direktem Bearbeiten-Icon */}
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <h1 className="font-headline text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-on-surface">
                {team?.name ?? t('teams.title')}
              </h1>
              {team?.is_owner && (
                <button
                  type="button"
                  onClick={() => setEditingTeam({ team, meta: activeMeta ?? getTeamMetadata(team.id, team.name) })}
                  aria-label={t('teams.editTeam', 'Team bearbeiten')}
                  className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high/60 transition-colors"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Zentrierte Beschreibung */}
            {activeMeta?.description && (
              <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-lg leading-relaxed">
                {activeMeta.description}
              </p>
            )}

            {/* 4 Stat Cards Strip (Zentriert wie im Referenzbild) */}
            {team && (
              <div className="mt-4 grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">{team.members.length}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.members')}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-xl bg-secondary/15 text-secondary border border-secondary/25">
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">{team.servers.length}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.tabServers')}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">{(team.roles || []).length}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.roles')}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-xl bg-status-warning/15 text-status-warning border border-status-warning/25">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">{team.can_access_vault !== false ? 'Aktiv' : 'Gesperrt'}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.vault')}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tab-Leiste (Mittig vom Bildschirm, groß auf Desktop, umbruchsicher und wischfrei mobil) */}
        <div className="border-t border-outline-variant/30 bg-surface/85 px-3 py-2.5 backdrop-blur-xl sm:px-6 sm:py-3.5">
          <div className="mx-auto flex w-full max-w-4xl justify-center">
            <TabBar
              tabs={teamReiter}
              active={aktiverReiter}
              onChange={(nextTab) => {
                setReiter(nextTab)
                closeRoleForm()
              }}
              ariaLabel={t('teams.sections')}
              embedded
              className="w-full sm:w-auto flex flex-wrap justify-center gap-1 sm:gap-2 p-1 sm:p-1.5 rounded-2xl bg-surface-container-high/60 backdrop-blur-xl border border-outline-variant/30 shadow-sm"
            />
          </div>
        </div>
      </header>

      {/* ── Sub-Header & Einladungs-Alerts ──────────────────────────────── */}
      {(meineBeitritte.length > 0 || meineAnhebungen.length > 0) && (
        <div className="shrink-0 space-y-2 border-b border-outline-variant/40 bg-surface-container-low/40 p-3 sm:px-6">
          <AngebotsBlock
            kennung="team-my-invitations"
            titel={t('teams.myInvitations')}
            hinweis={t('teams.myInvitationsHint')}
            einladungen={meineBeitritte}
            busy={busy}
            onAnnehmen={(invitation) => void acceptInvitation(invitation, false)}
            onAblehnen={(invitation) => void declineInvitation(invitation, false)}
          />
          <AngebotsBlock
            kennung="team-my-upgrades"
            titel={t('teams.myUpgrades')}
            hinweis={t('teams.myUpgradesHint')}
            einladungen={meineAnhebungen}
            busy={busy}
            onAnnehmen={(invitation) => void acceptInvitation(invitation, true)}
            onAblehnen={(invitation) => void declineInvitation(invitation, true)}
          />
        </div>
      )}

      {/* ── Dashboard Canvas ───────────────────────────────────────────── */}
      <div
        className="flex flex-1 min-h-0 w-full overflow-hidden"
        data-testid="team-workspace"
      >
          {/* ── Main Workspace: KPI Strip & Tabbed Canvas ──────────────── */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {team ? (
              <div className={`flex-1 min-h-0 ${aktiverReiter === 'vault' ? 'p-0 overflow-hidden flex flex-col' : 'overflow-y-auto px-3 py-4 sm:px-6 sm:py-6'}`}>
                <div className={aktiverReiter === 'vault' ? 'h-full flex flex-col' : 'mx-auto w-full max-w-5xl space-y-6'}>
                  {aktiverReiter === 'members' && (
                    <MitgliederReiter
                      team={team}
                      benutzerId={benutzerId}
                      kandidaten={memberCandidates}
                      newMemberId={newMemberId}
                      busy={busy}
                      offeneBeitritte={offeneBeitritte}
                      offeneAnhebungen={offeneAnhebungen}
                      onKandidat={setNewMemberId}
                      onEinladen={() => void inviteMember()}
                      onSchalter={(member, next) => void setMemberSwitches(member, next)}
                      onSetMemberRoles={(member, roleIds) => void setMemberRoles(member, roleIds)}
                      onEntfernen={(member) => void removeMember(member)}
                    />
                  )}

                  {aktiverReiter === 'servers' && (
                    <TeamServerManager
                      team={team}
                      assignable={assignable}
                      busy={busy}
                      onSetServerKeys={(serverId, keys) => void setServerKeys(serverId, keys)}
                      rollenWahl={rollenWahl}
                      onRollenWahl={(serverId, roleId) => setRollenWahl((prev) => ({ ...prev, [serverId]: roleId }))}
                      onRoleKeys={(serverId, roleId, keys) => void setRoleServerKeys(serverId, roleId, keys)}
                      onToggleServerRoles={(next) => void setServerRolesActive(next)}
                    />
                  )}

                  {aktiverReiter === 'roles' && (
                    <RollenReiter
                      team={team}
                      assignable={assignable}
                      busy={busy}
                      isCreatingRole={isCreatingRole}
                      editingRole={editingRole}
                      onOpenCreateRole={openCreateRole}
                      onOpenEditRole={openEditRole}
                      onCloseRoleForm={closeRoleForm}
                      onRoleSaved={onRoleSaved}
                      onDeleteRole={(role) => void deleteRole(role)}
                    />
                  )}

                  {aktiverReiter === 'vault' && (
                    <section className="flex-1 min-h-0 flex flex-col h-full w-full" aria-labelledby="team-vault">
                      <TeamVaultView team={team} />
                    </section>
                  )}
                </div>
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
        </>
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
          initialName={editingTeam.team.name}
          initialMeta={editingTeam.meta}
          busy={busy}
          onClose={() => setEditingTeam(null)}
          onSubmit={async (payload) => {
            await handleEditTeamSubmit(payload)
            setEditingTeam(null)
          }}
        />
      )}
    </div>
  )
}



function MitgliederReiter({
  team, benutzerId, kandidaten, newMemberId, busy, offeneBeitritte, offeneAnhebungen,
  onKandidat, onEinladen, onSchalter, onSetMemberRoles, onEntfernen,
}: {
  team: TeamDetail
  benutzerId: number | null
  kandidaten: UserOption[]
  newMemberId: string | null
  busy: boolean
  offeneBeitritte: TeamInvitation[]
  offeneAnhebungen: TeamInvitation[]
  onKandidat: (id: string | null) => void
  onEinladen: () => void
  onSchalter: (member: TeamMember, next: { can_manage_skills: boolean; can_manage_memory: boolean; can_access_vault?: boolean }) => void
  onSetMemberRoles: (member: TeamMember, roleIds: number[]) => void
  onEntfernen: (member: TeamMember) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const spalten = 'md:grid-cols-[minmax(0,1.2fr)_12rem_7rem_7rem_7rem_2.75rem]'

  return (
    <section className="space-y-6 max-w-6xl" aria-labelledby="team-members">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 id="team-members" className="font-headline text-lg font-semibold text-on-surface">
            {t('teams.members')}
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant">
            Lege fest, wer geteilte Skills, Erinnerungen und den Tresor dieses Teams nutzen und verwalten darf.
          </p>
        </div>

        {team.is_owner && kandidaten.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="min-w-[12rem] flex-1 sm:w-60 sm:flex-none">
              <Dropdown
                value={newMemberId}
                onChange={onKandidat}
                options={kandidaten.map((user) => ({ value: String(user.id), label: user.username }))}
                placeholder={t('teams.selectUser')}
                disabled={busy}
                aria-label={t('teams.inviteMember')}
              />
            </div>
            <Button type="button" size="sm" disabled={busy || !newMemberId} onClick={onEinladen}>
              <UserPlus className="h-4 w-4 mr-1.5" aria-hidden="true" />
              {t('teams.inviteMember')}
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface shadow-sm">
        <div
          aria-hidden="true"
          className={`hidden gap-4 border-b border-outline-variant/40 bg-surface-container-low/40 px-4 py-3 font-label-md text-label-sm uppercase tracking-wider text-on-surface-variant md:grid ${spalten}`}
        >
          <span>{t('teams.member')}</span>
          <span>{t('teams.roles')}</span>
          <span>{t('teams.manageSkills')}</span>
          <span>{t('teams.manageMemory')}</span>
          <span>{t('teams.accessVault')}</span>
          <span />
        </div>
        <ul className="divide-y divide-outline-variant/30">
          {team.members.map((member) => {
            const ich = member.user_id === benutzerId
            const roleOptions = (team.roles || []).map((r) => ({ value: String(r.id), label: r.name }))
            const memberRoleValues = (
              member.roles?.map((r) => String(r.id)) ??
              (member.role_ids?.map(String) ?? (member.team_role_id ? [String(member.team_role_id)] : []))
            )

            return (
              <li
                key={member.user_id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 md:gap-4 ${spalten}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/user/${member.user_id}`)}
                    className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={t('teams.profilAnsehen', { name: member.username })}
                  >
                    <Avatar src={member.avatar_url} name={member.username} size="sm" />
                    <StatusDot status={member.presence?.status || 'invisible'} size="sm" className="absolute bottom-0 right-0" portal />
                  </button>
                  <span className="min-w-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/user/${member.user_id}`)}
                      className="block max-w-full truncate rounded text-sm font-semibold text-on-surface hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {member.username}
                    </button>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-on-surface-variant font-normal">
                      {member.role === 'owner' ? (
                        <span className="inline-flex items-center gap-1 text-primary font-medium">
                          <Crown className="h-3 w-3" aria-hidden="true" />
                          {t('teams.founder')}
                        </span>
                      ) : t('teams.member')}
                      {ich && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-primary font-medium">{t('teams.you')}</span>
                        </>
                      )}
                    </span>
                    {member.roles && member.roles.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {member.roles.map((r) => (
                          <RoleBadge
                            key={r.id}
                            name={r.name}
                            color={r.color}
                            icon={r.icon}
                            size="sm"
                          />
                        ))}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-end md:order-last">
                  {team.is_owner && !ich && member.role !== 'owner' && (
                    <Button
                      type="button" variant="ghost" size="sm" disabled={busy}
                      onClick={() => onEntfernen(member)}
                      aria-label={`${t('teams.removeMember')}: ${member.username}`}
                    >
                      <Trash2 className="h-4 w-4 text-status-destructive" aria-hidden="true" />
                    </Button>
                  )}
                </div>

                {/* Rollen-Zuweisung */}
                <div className="col-span-2 flex flex-col justify-center gap-1 md:col-span-1 min-w-[10rem]">
                  <span className="text-xs font-semibold text-on-surface-variant md:hidden">{t('teams.roles')}</span>
                  {team.is_owner && member.role !== 'owner' ? (
                    <MultiSelect
                      options={roleOptions}
                      values={memberRoleValues}
                      onChange={(selectedIds) => onSetMemberRoles(member, selectedIds.map(Number))}
                      disabled={busy}
                      placeholder={t('teams.assignRoles')}
                      aria-label={`${t('teams.roles')}: ${member.username}`}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(member.roles || []).map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-sm font-semibold text-white shadow-2xs"
                          style={{ backgroundColor: r.color || '#3b82f6' }}
                        >
                          {r.is_admin && <Crown className="h-2.5 w-2.5 text-status-warning" />}
                          {r.name}
                        </span>
                      ))}
                      {(!member.roles || member.roles.length === 0) && (
                        <span className="text-xs text-on-surface-variant/70 italic">-</span>
                      )}
                    </div>
                  )}
                </div>

                <label className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:justify-start">
                  <span className="text-xs text-on-surface-variant md:hidden">{t('teams.manageSkills')}</span>
                  <Switch
                    checked={member.can_manage_skills}
                    disabled={!team.is_owner || busy}
                    onCheckedChange={(next) => onSchalter(member, {
                      can_manage_skills: next, can_manage_memory: member.can_manage_memory,
                    })}
                    aria-label={`${t('teams.manageSkills')}: ${member.username}`}
                  />
                </label>
                <label className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:justify-start">
                  <span className="text-xs text-on-surface-variant md:hidden">{t('teams.manageMemory')}</span>
                  <Switch
                    checked={member.can_manage_memory}
                    disabled={!team.is_owner || busy}
                    onCheckedChange={(next) => onSchalter(member, {
                      can_manage_skills: member.can_manage_skills, can_manage_memory: next, can_access_vault: member.can_access_vault,
                    })}
                    aria-label={`${t('teams.manageMemory')}: ${member.username}`}
                  />
                </label>
                <label className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:justify-start">
                  <span className="text-xs text-on-surface-variant md:hidden">{t('teams.accessVault')}</span>
                  <Switch
                    checked={member.can_access_vault !== false}
                    disabled={!team.is_owner || busy || member.role === 'owner'}
                    onCheckedChange={(next) => onSchalter(member, {
                      can_manage_skills: member.can_manage_skills,
                      can_manage_memory: member.can_manage_memory,
                      can_access_vault: next,
                    })}
                    aria-label={`${t('teams.accessVault')}: ${member.username}`}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      {team.is_owner && (
        <div className="space-y-4 pt-2">
          <OffeneGruppe
            kennung="team-pending-invitations"
            titel={t('teams.pendingInvitations')}
            status={t('teams.invitationPending')}
            hinweis={t('teams.pendingInvitationsHint')}
            einladungen={offeneBeitritte}
          />
          <OffeneGruppe
            kennung="team-pending-upgrades"
            titel={t('teams.pendingUpgrades')}
            status={t('teams.upgradePending')}
            hinweis={t('teams.pendingUpgradesHint')}
            einladungen={offeneAnhebungen}
          />
        </div>
      )}
    </section>
  )
}

function RollenReiter({
  team,
  assignable,
  busy,
  isCreatingRole,
  editingRole,
  onOpenCreateRole,
  onOpenEditRole,
  onCloseRoleForm,
  onRoleSaved,
  onDeleteRole,
}: {
  team: TeamDetail
  assignable: TeamServer[]
  busy: boolean
  isCreatingRole: boolean
  editingRole: TeamRole | null
  onOpenCreateRole: () => void
  onOpenEditRole: (role: TeamRole) => void
  onCloseRoleForm: () => void
  onRoleSaved: (role: TeamRole) => void
  onDeleteRole: (role: TeamRole) => void
}) {
  const { t } = useTranslation()
  const roles = team.roles || []

  return (
    <section className="space-y-6 max-w-6xl" aria-labelledby="team-roles">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 id="team-roles" className="font-headline text-lg font-semibold text-on-surface">
            {t('teams.roles')}
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant">
            {t('teams.rolesHint')}
          </p>
        </div>

        {team.is_owner && !isCreatingRole && !editingRole && (
          <Button type="button" size="sm" disabled={busy} onClick={onOpenCreateRole}>
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {t('teams.createRole')}
          </Button>
        )}
      </div>

      {/* Inline Create Form */}
      {isCreatingRole && (
        <TeamRoleForm
          team={team}
          assignable={assignable}
          role={null}
          onSaved={onRoleSaved}
          onCancel={onCloseRoleForm}
        />
      )}

      {/* Inline Edit Form */}
      {editingRole && (
        <TeamRoleForm
          team={team}
          assignable={assignable}
          role={editingRole}
          onSaved={onRoleSaved}
          onCancel={onCloseRoleForm}
        />
      )}

      {roles.length === 0 && !isCreatingRole && !editingRole ? (
        <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low/30 p-8 text-center text-sm text-on-surface-variant">
          <Shield className="mx-auto h-8 w-8 text-on-surface-variant/60 mb-2" />
          <p className="font-medium">{t('teams.noRolesYet')}</p>
          {team.is_owner && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={busy}
              onClick={onOpenCreateRole}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t('teams.createRole')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {roles.map((role) => {
            const hasServerGrants = (role.server_grants?.length ?? 0) > 0

            return (
              <div
                key={role.id}
                className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface p-4 shadow-sm transition-all hover:border-outline-variant"
              >
                <div className="space-y-3">
                  {/* Header: RoleBadge & Badges */}
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="flex items-center gap-2.5 min-w-0">
                      <RoleBadge
                        name={role.name}
                        color={role.color}
                        icon={role.icon}
                        size="md"
                      />
                    </h4>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {role.is_admin && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/10 px-2 py-0.5 text-xs font-semibold text-status-warning border border-status-warning/20">
                          <Crown className="h-3 w-3" />
                          {t('teams.adminBadge')}
                        </span>
                      )}
                      {role.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary border border-primary/20">
                          <Sparkles className="h-3 w-3" />
                          {t('teams.defaultBadge')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  {role.description && (
                    <p className="text-xs text-on-surface-variant leading-relaxed">
                      {role.description}
                    </p>
                  )}

                  {/* Permission summary chips */}
                  <div className="space-y-2 pt-1 border-t border-outline-variant/30">
                    <div className="flex items-center gap-1.5 text-xs text-on-surface-variant font-medium">
                      <Users className="h-3.5 w-3.5" />
                      <span>{t('teams.roleMembersCount', { count: role.members_count })}</span>
                    </div>

                    {role.is_admin ? (
                      <div className="text-xs text-status-warning font-medium">
                        Volle Berechtigungen (Administrator)
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {role.permission_keys.map((key) => (
                          <span
                            key={key}
                            className="rounded-md bg-surface-container-high/80 px-2 py-0.5 text-label-sm text-on-surface-variant font-mono"
                          >
                            {t(`permissionDetails.${key.replace(/\./g, '_')}.title`, { defaultValue: key })}
                          </span>
                        ))}
                        {hasServerGrants && (
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-label-sm text-primary font-medium flex items-center gap-1">
                            <Server className="h-3 w-3" />
                            {role.server_grants.length} Server
                          </span>
                        )}
                        {role.permission_keys.length === 0 && !hasServerGrants && (
                          <span className="text-label-sm text-on-surface-variant/70 italic">
                            Keine Rechte zugewiesen
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions Footer */}
                {team.is_owner && (
                  <div className="flex items-center justify-end gap-1.5 pt-3 mt-3 border-t border-outline-variant/30">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onOpenEditRole(role)}
                      className="text-xs h-7 px-2"
                      aria-label={`${t('teams.editRole')}: ${role.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      {t('common.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || role.is_default}
                      onClick={() => onDeleteRole(role)}
                      className="text-xs h-7 px-2 text-status-destructive hover:bg-status-destructive/10"
                      aria-label={
                        role.is_default
                          ? `${t('teams.deleteRoleTitle')}: ${role.name} — ${t('teams.defaultRoleCannotBeDeleted')}`
                          : `${t('teams.deleteRoleTitle')}: ${role.name}`
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      {t('common.delete')}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AngeboteneSchalter({ invitation }: { invitation: TeamInvitation }) {
  const { t } = useTranslation()
  if (!invitation.can_manage_skills && !invitation.can_manage_memory) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {invitation.can_manage_skills && (
        <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs text-on-surface-variant">
          {t('teams.manageSkills')}
        </span>
      )}
      {invitation.can_manage_memory && (
        <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs text-on-surface-variant">
          {t('teams.manageMemory')}
        </span>
      )}
    </div>
  )
}

function AngebotsBlock({
  kennung, titel, hinweis, einladungen, busy, onAnnehmen, onAblehnen,
}: {
  kennung: string
  titel: string
  hinweis: string
  einladungen: TeamInvitation[]
  busy: boolean
  onAnnehmen: (invitation: TeamInvitation) => void
  onAblehnen: (invitation: TeamInvitation) => void
}) {
  const { t } = useTranslation()
  if (einladungen.length === 0) return null

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-labelledby={kennung}>
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 id={kennung} className="font-headline text-sm font-semibold text-on-surface">
          {titel}
        </h2>
      </div>
      <p className="mt-1 text-xs text-on-surface-variant">{hinweis}</p>

      <ul className="mt-3 space-y-2">
        {einladungen.map((invitation) => (
          <li
            key={invitation.team_id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant/40 bg-surface p-3"
          >
            <span className="min-w-[10rem] flex-1 text-sm text-on-surface">
              <span className="font-semibold">{invitation.team_name}</span>
              {invitation.invited_by_username && (
                <span className="ml-2 text-xs text-on-surface-variant">
                  {t('teams.invitedBy', { name: invitation.invited_by_username })}
                </span>
              )}
            </span>
            <AngeboteneSchalter invitation={invitation} />
            <div className="flex items-center gap-2">
              <Button
                type="button" size="sm" disabled={busy}
                onClick={() => onAnnehmen(invitation)}
                aria-label={`${t('teams.acceptInvitation')}: ${invitation.team_name}`}
              >
                <Check className="h-4 w-4 mr-1" aria-hidden="true" />
                {t('teams.acceptInvitation')}
              </Button>
              <Button
                type="button" variant="ghost" size="sm" disabled={busy}
                onClick={() => onAblehnen(invitation)}
                aria-label={`${t('teams.declineInvitation')}: ${invitation.team_name}`}
              >
                <X className="h-4 w-4 mr-1" aria-hidden="true" />
                {t('teams.declineInvitation')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function OffeneGruppe({
  kennung, titel, status, hinweis, einladungen,
}: {
  kennung: string
  titel: string
  status: string
  hinweis: string
  einladungen: TeamInvitation[]
}) {
  if (einladungen.length === 0) return null

  return (
    <div className="mt-4">
      <h3 id={kennung} className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {titel}
      </h3>
      <ul className="mt-2 space-y-2" aria-labelledby={kennung}>
        {einladungen.map((invitation) => (
          <li
            key={invitation.user_id}
            className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low/20 p-3.5"
          >
            <div className="flex min-w-[8rem] flex-1 items-center gap-3">
              <Avatar src={invitation.avatar_url} name={invitation.username} size="sm" />
              <span className="text-sm font-semibold text-on-surface">
                {invitation.username}
              </span>
            </div>
            <AngeboteneSchalter invitation={invitation} />
            <span className="text-xs text-on-surface-variant font-medium">{status}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-on-surface-variant">{hinweis}</p>
    </div>
  )
}
