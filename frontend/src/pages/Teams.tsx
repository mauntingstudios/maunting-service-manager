import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Brain, Check, Crown, LogOut, Mail, Pencil, Plus, Server, Shield, ShieldCheck, Sparkles, Trash2, UserPlus, Users, UsersRound, X,
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
import { AiMemoryManager } from '@/components/ai/AiMemoryManager'
import { AiSkillManager } from '@/components/ai/AiSkillManager'
import { StatusDot } from '@/components/social/StatusIndicator'
import type { AiKnowledgeScope, AiSkillScope } from '@/components/ai/knowledgeScope'
import { TeamRoleForm } from '@/components/teams/TeamRoleForm'
import { mitServerSicht } from '@/components/teams/teamPermissionsCatalog'
import { TabBar, type TabDef } from '@/components/ui/TabBar'
import { TeamVaultView } from '@/desktop/vault/TeamVaultView'
import { Avatar, Button, Dropdown, Input, MultiSelect, RoleBadge, Switch } from '@/Singra/UI'
import { useHasPermission } from '@/hooks/useHasPermission'
import { useAuthStore } from '@/stores/authStore'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import { useTeamInvitationStore } from '@/stores/teamInvitationStore'
import { Spinner } from '@/components/ui/Spinner'

interface UserOption {
  id: number
  username: string
}

type TeamReiter = 'members' | 'servers' | 'roles' | 'knowledge' | 'vault'

function memoryScope(detail: TeamDetail): AiKnowledgeScope {
  return { kind: 'team', teamId: detail.id, canManage: detail.can_manage_memory }
}

function skillScope(detail: TeamDetail): AiSkillScope {
  return {
    kind: 'team',
    teamId: detail.id,
    personal: detail.is_personal,
    canManage: detail.can_manage_skills,
  }
}

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
  const canUseSkills = useHasPermission('ai.skills.use')
  const benutzerId = useAuthStore((state) => state.user?.id ?? null)

  const [reiter, setReiterState] = useState<TeamReiter>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_REITER) as TeamReiter
      if (['members', 'servers', 'roles', 'knowledge', 'vault'].includes(saved)) return saved
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
  const [newName, setNewName] = useState('')
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

  const createTeam = async () => {
    const name = newName.trim()
    if (!name) return
    await run(async () => {
      const created = await teamsApi.create(name)
      setNewName('')
      await reloadTeams()
      setSelectedId(created.id)
    }, 'teams.created')
  }

  const removeTeam = async (team: TeamDetail) => {
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
        : t('teams.memberSaved'))
    })
  }

  const removeMember = async (member: TeamMember) => {
    if (!detail) return
    await run(async () => {
      setDetail(await teamsApi.removeMember(detail.id, member.user_id))
      await reloadTeams()
    }, 'teams.memberRemoved')
  }

  const leaveTeam = async (team: TeamDetail) => {
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
    }, 'teams.memberSaved')
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

  const teamReiter: TabDef<TeamReiter>[] = [
    { id: 'members', labelKey: 'teams.members', icon: Users, badge: team?.members.length },
    ...(team?.is_owner
      ? [{ id: 'servers' as const, labelKey: 'teams.tabServers', icon: Server, badge: team.servers.length }]
      : []),
    { id: 'roles' as const, labelKey: 'teams.roles', icon: Shield, badge: team?.roles?.length ?? 0 },
    { id: 'knowledge', labelKey: 'teams.knowledge', icon: Brain },
    ...(inTauri ? [{ id: 'vault' as const, labelKey: 'teams.vault', icon: ShieldCheck }] : []),
  ]
  const aktiverReiter: TeamReiter = teamReiter.some((row) => row.id === reiter) ? reiter : 'members'
  const mitListe = echte.length > 0 || canCreate

  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden text-on-surface">
      {/* ── Executive Dashboard Header ─────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 bg-surface-container-low/70 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-sm">
            <UsersRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                {t('teams.eyebrow')}
              </span>
              {team?.is_owner && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-label-sm font-semibold text-primary">
                  <Crown className="h-3 w-3" />
                  {t('teams.founder')}
                </span>
              )}
            </div>
            <h1 className="font-headline text-lg sm:text-xl font-bold leading-tight text-on-surface">
              {team?.name ?? t('teams.title')}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {team && (
            <div className="flex items-center gap-1 sm:gap-2">
              {team.is_owner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void removeTeam(team)}
                  aria-label={t('teams.remove')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('teams.remove')}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void leaveTeam(team)}
                  aria-label={t('teams.leave')}
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('teams.leave')}</span>
                </Button>
              )}
            </div>
          )}
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
          {/* ── Left Rail: Organisations & Teams ───────────────────────── */}
          {mitListe && (
            <aside className="hidden w-72 shrink-0 flex-col border-r border-outline-variant/40 bg-surface-container-low/40 backdrop-blur-xl lg:flex">
              <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
                <h2
                  id="team-list"
                  className="font-label-md text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
                >
                  {t('teams.yourTeams')}
                </h2>
                <span className="msm-badge-info text-xs">{echte.length}</span>
              </div>

              {echte.length > 0 && (
                <ul
                  className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto p-3"
                  aria-labelledby="team-list"
                >
                  {echte.map((eintrag) => {
                    const ausgewaehlt = eintrag.id === selectedId
                    return (
                      <li key={eintrag.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(eintrag.id)}
                          disabled={busy}
                          aria-pressed={ausgewaehlt}
                          aria-current={ausgewaehlt ? 'true' : undefined}
                          className={`grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
                            ausgewaehlt
                              ? 'border-primary/40 bg-primary/10 text-primary shadow-sm font-semibold'
                              : 'border-transparent text-on-surface hover:border-outline-variant/50 hover:bg-surface-container-high/60'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`grid h-9 w-9 place-items-center rounded-lg border font-headline text-sm font-bold uppercase transition-colors ${
                              ausgewaehlt
                                ? 'border-primary/40 bg-primary text-on-primary'
                                : 'border-outline-variant/40 bg-surface-container-high text-on-surface'
                            }`}
                          >
                            {eintrag.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm leading-5">{eintrag.name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-on-surface-variant font-normal">
                              {t('teams.memberCount', { count: eintrag.member_count })}
                              {eintrag.is_owner && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <Crown className="h-3 w-3 text-primary" aria-hidden="true" />
                                  <span>{t('teams.founder')}</span>
                                </>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {canCreate && (
                <form
                  className="border-t border-outline-variant/40 bg-surface-container-low/70 p-4 backdrop-blur-xl space-y-2.5 shrink-0"
                  aria-labelledby="team-create"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void createTeam()
                  }}
                >
                  <h3
                    id="team-create"
                    className="font-label-md text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
                  >
                    {t('teams.create')}
                  </h3>
                  <Input
                    maxLength={64}
                    value={newName}
                    disabled={busy}
                    placeholder={t('teams.name')}
                    onChange={(event) => setNewName(event.target.value)}
                    aria-label={t('teams.name')}
                  />
                  <Button type="submit" size="sm" className="w-full" disabled={busy || newName.trim().length < 2}>
                    <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                    {t('teams.create')}
                  </Button>
                </form>
              )}
            </aside>
          )}

          {/* ── Main Workspace: KPI Strip & Tabbed Canvas ──────────────── */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {team ? (
              <>
                {/* Mobile / Narrow Dropdown Selector */}
                {echte.length > 1 && (
                  <div className="border-b border-outline-variant/40 bg-surface-container-low/70 p-3 backdrop-blur-xl lg:hidden">
                    <Dropdown
                      value={selectedId ? String(selectedId) : null}
                      onChange={(val) => {
                        if (val) setSelectedId(Number(val))
                      }}
                      options={echte.map((e) => ({ value: String(e.id), label: e.name }))}
                      placeholder={t('teams.chooseTeam')}
                      aria-label={t('teams.yourTeams')}
                    />
                  </div>
                )}

                {/* Organisation Executive Stats Grid */}
                <div className="grid grid-cols-2 gap-3 border-b border-outline-variant/40 bg-surface-container-low/30 p-3 sm:px-6 sm:py-4 md:grid-cols-4 shrink-0">
                  <div className="flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface p-3 shadow-sm">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-bold leading-none text-on-surface">{team.members.length}</div>
                      <div className="mt-1 truncate text-xs text-on-surface-variant">{t('teams.members')}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface p-3 shadow-sm">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary/10 text-secondary">
                      <Server className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-bold leading-none text-on-surface">{team.servers.length}</div>
                      <div className="mt-1 truncate text-xs text-on-surface-variant">{t('teams.tabServers')}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface p-3 shadow-sm">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-bold leading-none text-on-surface">{team.is_owner ? offeneBeitritte.length : 0}</div>
                      <div className="mt-1 truncate text-xs text-on-surface-variant">Ausstehend</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface p-3 shadow-sm">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-bold leading-none text-on-surface">
                        {team.servers.reduce((sum, s) => sum + s.permission_keys.length, 0)}
                      </div>
                      <div className="mt-1 truncate text-xs text-on-surface-variant">{t('teams.permissions')}</div>
                    </div>
                  </div>
                </div>

                {/* Modern Tab Bar */}
                <div className="border-b border-outline-variant/40 bg-surface/70 px-4 pt-3 backdrop-blur-xl sm:px-6 shrink-0">
                  <TabBar
                    tabs={teamReiter}
                    active={aktiverReiter}
                    onChange={(nextTab) => {
                      setReiter(nextTab)
                      closeRoleForm()
                    }}
                    ariaLabel={t('teams.sections')}
                    embedded
                  />
                </div>

                {/* Tabbed Canvas Area */}
                <div className={`flex-1 min-h-0 ${aktiverReiter === 'vault' ? 'p-0 overflow-hidden flex flex-col' : 'overflow-y-auto p-4 sm:p-6 lg:p-8'}`}>
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
                    <section className="space-y-4 max-w-4xl" aria-labelledby="team-servers">
                      <div>
                        <h3 id="team-servers" className="font-headline text-lg font-semibold text-on-surface">
                          {t('teams.servers')}
                        </h3>
                        <p className="mt-1 text-sm text-on-surface-variant">{t('teams.serversHint')}</p>
                      </div>

                      {team.is_owner && (
                        <div className="flex items-start justify-between gap-4 rounded-xl border border-outline-variant/40 bg-surface p-4">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-on-surface">{t('teams.serverRolesTitle')}</p>
                            <p className="mt-1 text-xs text-on-surface-variant">{t('teams.serverRolesHint')}</p>
                          </div>
                          <Switch
                            checked={team.server_roles_active ?? false}
                            disabled={busy}
                            onCheckedChange={(next) => void setServerRolesActive(next)}
                            aria-label={t('teams.serverRolesTitle')}
                          />
                        </div>
                      )}

                      {assignable.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-outline-variant/50 p-6 text-center text-sm text-on-surface-variant bg-surface-container-low/30">
                          {t('teams.noAssignableServers')}
                        </div>
                      ) : team.server_roles_active ? (
                        <ServerRollenListe
                          team={team}
                          assignable={assignable}
                          rollenWahl={rollenWahl}
                          busy={busy}
                          onRollenWahl={(serverId, roleId) => setRollenWahl((prev) => ({ ...prev, [serverId]: roleId }))}
                          onKeys={(serverId, roleId, keys) => void setRoleServerKeys(serverId, roleId, keys)}
                        />
                      ) : (
                        <ul className="divide-y divide-outline-variant/30 rounded-xl border border-outline-variant/40 bg-surface">
                          {assignable.map((server) => {
                            const current = team.servers.find((item) => item.server_id === server.server_id)
                            return (
                              <li
                                key={server.server_id}
                                className="grid items-center gap-3 p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-4"
                              >
                                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-on-surface">
                                  <Server className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                  <span className="truncate">{server.server_name}</span>
                                </span>
                                <div className="min-w-0">
                                  <MultiSelect
                                    options={server.permission_keys.map((key) => ({
                                      value: key,
                                      label: t(`permissionDetails.${key.replace(/\./g, '_')}.title`, { defaultValue: key }),
                                    }))}
                                    values={current?.permission_keys ?? []}
                                    onChange={(keys) => void setServerKeys(server.server_id, keys)}
                                    disabled={busy}
                                    placeholder={t('teams.noAccess')}
                                    aria-label={`${t('teams.permissions')}: ${server.server_name}`}
                                  />
                                  <p className="mt-1 text-xs text-on-surface-variant">{t('teams.serverSichtAuto')}</p>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </section>
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

                  {aktiverReiter === 'knowledge' && (
                    <section className="space-y-6 max-w-5xl" aria-labelledby="team-knowledge">
                      <div>
                        <h3 id="team-knowledge" className="font-headline text-lg font-semibold text-on-surface">
                          {t('teams.knowledge')}
                        </h3>
                        <p className="mt-1 text-sm text-on-surface-variant">{t('teams.knowledgeHint')}</p>
                      </div>
                      <div className="space-y-6">
                        <div className="msm-card p-6">
                          <AiMemoryManager scope={memoryScope(team)} />
                        </div>
                        {canUseSkills && (
                          <div className="msm-card p-6">
                            <AiSkillManager scope={skillScope(team)} />
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {aktiverReiter === 'vault' && (
                    <section className="flex-1 min-h-0 flex flex-col h-full w-full" aria-labelledby="team-vault">
                      <TeamVaultView team={team} />
                    </section>
                  )}
                </div>
              </>
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
    </div>
  )
}

/**
 * Server-Rechte je Rolle (Rollenmodus an).
 *
 * Pro Server: Rollenauswahl plus Rechte-Editor für die gewählte Rolle.
 * Administratoren stehen nicht zur Wahl — sie halten alles von selbst.
 * Team-Freigaben sind in diesem Modus pausiert und werden nicht gezeigt.
 */
function ServerRollenListe({
  team, assignable, rollenWahl, busy, onRollenWahl, onKeys,
}: {
  team: TeamDetail
  assignable: TeamServer[]
  rollenWahl: Record<number, number | null>
  busy: boolean
  onRollenWahl: (serverId: number, roleId: number | null) => void
  onKeys: (serverId: number, roleId: number, keys: string[]) => void
}) {
  const { t } = useTranslation()
  const rollen = (team.roles || []).filter((r) => !r.is_admin)

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-sm text-on-surface-variant">
        {t('teams.serverRollenHinweis')}
      </div>
      {rollen.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/50 p-6 text-center text-sm text-on-surface-variant bg-surface-container-low/30">
          {t('teams.keineRollenFuerServer')}
        </div>
      ) : (
        <ul className="divide-y divide-outline-variant/30 rounded-xl border border-outline-variant/40 bg-surface">
          {assignable.map((server) => {
            const gewaehlt = rollen.find((r) => r.id === rollenWahl[server.server_id]) ?? null
            const grant = gewaehlt?.server_grants?.find((g) => g.server_id === server.server_id)
            return (
              <li
                key={server.server_id}
                className="grid items-center gap-3 p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,12rem)_minmax(0,1fr)] md:gap-4"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-on-surface">
                  <Server className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">{server.server_name}</span>
                </span>
                <Dropdown
                  value={gewaehlt ? String(gewaehlt.id) : null}
                  onChange={(val) => onRollenWahl(server.server_id, val ? Number(val) : null)}
                  options={rollen.map((r) => ({ value: String(r.id), label: r.name }))}
                  placeholder={t('teams.rolleWaehlen')}
                  disabled={busy}
                  aria-label={`${t('teams.roles')}: ${server.server_name}`}
                />
                <div className="min-w-0">
                  {gewaehlt ? (
                    <>
                      <MultiSelect
                        options={server.permission_keys.map((key) => ({
                          value: key,
                          label: t(`permissionDetails.${key.replace(/\./g, '_')}.title`, { defaultValue: key }),
                        }))}
                        values={grant?.permission_keys ?? []}
                        onChange={(keys) => onKeys(server.server_id, gewaehlt.id, keys)}
                        disabled={busy}
                        placeholder={t('teams.noAccess')}
                        aria-label={`${t('teams.permissions')}: ${server.server_name}`}
                      />
                      <p className="mt-1 text-xs text-on-surface-variant">{t('teams.serverSichtAuto')}</p>
                    </>
                  ) : (
                    <span className="text-xs text-on-surface-variant/70 italic" aria-hidden="true">-</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
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
                    <StatusDot status={member.presence?.status || 'invisible'} size="sm" className="absolute bottom-0 right-0" />
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
                      aria-label={`${t('teams.deleteRoleTitle')}: ${role.name}`}
                      title={role.is_default ? 'Standardrolle kann nicht gelöscht werden' : undefined}
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
