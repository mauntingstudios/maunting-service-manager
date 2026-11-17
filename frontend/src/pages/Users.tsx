import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle,
  Crown,
  Mail,
  Plus,
  Search,
  Server as ServerIcon,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users as UsersIcon,
  XCircle,
} from 'lucide-react'
import { api } from '@/api/client'
import { rbacApi } from '@/api/rbac'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { useHasPermission } from '@/hooks/useHasPermission'
import { useAuthStore } from '@/stores/authStore'
import { ServerPermissionsPanel } from '@/components/ServerPermissionsPanel'
import { StatCard } from '@/components/app/StatCard'
import {
  Button,
  Dropdown,
  Input,
  Kurzinfo,
  MultiSelect,
  PageHeader,
  PasswordInput,
  RoleBadge,
  Spinner,
  Switch,
} from '@maunting/ui'
import { Avatar } from '@/components/app/Avatar'
import { benutzernameFehler } from '@/lib/benutzername'
import type { Server, User } from '@/types'
import type { Role } from '@/types/permissions'

export function Users() {
  const { t } = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const canManageUsers = useHasPermission('users.manage')
  const canManagePermissions = useHasPermission('users.permissions.manage')

  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [permServerId, setPermServerId] = useState<number | ''>('')
  const [serverSearch, setServerSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('__all__')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    password: '',
    is_owner: false,
    auto_verify: false,
  })
  const [creating, setCreating] = useState(false)
  const [savingRoleUserId, setSavingRoleUserId] = useState<number | null>(null)

  const filteredServers = useMemo(() => {
    const query = serverSearch.trim().toLocaleLowerCase()
    if (!query) return servers
    return servers.filter((server) => server.name.toLocaleLowerCase().includes(query))
  }, [serverSearch, servers])

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === permServerId),
    [permServerId, servers],
  )

  const userStats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.is_active).length,
    verified: users.filter((u) => u.email_verified).length,
    owners: users.filter((u) => u.is_owner).length,
  }), [users])

  const getUserRoleIds = (user: User): number[] => {
    if (user.role_ids?.length) return user.role_ids
    return user.role_id != null ? [user.role_id] : []
  }

  const formatRoleName = (role: Role) => (
    role.is_system
      ? t(`roles.systemNames.${role.name}`, { defaultValue: role.name })
      : role.name
  )

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLocaleLowerCase()
    return users.filter((user) => {
      if (query) {
        const matchesName = user.username.toLocaleLowerCase().includes(query)
        const matchesEmail = user.email.toLocaleLowerCase().includes(query)
        if (!matchesName && !matchesEmail) return false
      }
      if (roleFilter === '__owner__') return user.is_owner
      if (roleFilter === '__none__') return !user.is_owner && getUserRoleIds(user).length === 0
      if (roleFilter !== '__all__') {
        const targetRoleId = Number(roleFilter)
        return getUserRoleIds(user).includes(targetRoleId)
      }
      return true
    })
  }, [users, userSearch, roleFilter])

  const roleFilterOptions = useMemo(() => [
    { value: '__all__', label: t('users.filterAllRoles') },
    { value: '__owner__', label: t('users.filterOwners') },
    { value: '__none__', label: t('users.filterNoRole') },
    ...roles.map((role) => ({
      value: String(role.id),
      label: formatRoleName(role),
    })),
  ], [roles, t])

  const fetchAll = async () => {
    try {
      const [u, r, s] = await Promise.all([
        api<User[]>('/admin/users'),
        rbacApi.listRoles().catch(() => [] as Role[]),
        canManagePermissions ? api<Server[]>('/servers').catch(() => [] as Server[]) : Promise.resolve([] as Server[]),
      ])
      setUsers(u)
      setRoles(r)
      setServers(s)
      if (canManagePermissions && s.length > 0 && permServerId === '') {
        setPermServerId(s[0].id)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchAll()
  }, [])

  /** Speichert das vollständige Rollen-Set atomar und verhindert parallele Updates pro Ansicht. */
  const assignRoles = async (user: User, roleIds: number[]) => {
    if (savingRoleUserId !== null) return
    setSavingRoleUserId(user.id)
    try {
      const updated = await rbacApi.assignRoles(user.id, roleIds)
      setUsers((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
      toast.success(t('users.roleSaved'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingRoleUserId(null)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const namensfehler = benutzernameFehler(createForm.username)
    if (namensfehler) {
      toast.error(t(namensfehler.schluessel, namensfehler))
      return
    }
    setCreating(true)
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify(createForm),
      })
      setShowCreate(false)
      setCreateForm({ username: '', email: '', password: '', is_owner: false, auto_verify: false })
      await fetchAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (userId: number) => {
    if (!(await confirm({ message: t('users.confirmDelete'), danger: true, confirmText: t('common.delete') }))) return
    try {
      await api(`/admin/users/${userId}`, { method: 'DELETE' })
      await fetchAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  return (
    <div className="msm-page">
      <PageHeader
        eyebrow={t('pageContext.administration')}
        title={t('nav.users')}
        description={t('users.subtitle')}
        status={<span className="msm-badge-info">{users.length} {t('nav.users')}</span>}
        actions={canManageUsers ? (
          <Button
            onClick={() => setShowCreate(!showCreate)}
            className="inline-flex min-h-11 items-center gap-2 shadow-lg shadow-primary/15"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('users.createUser')}
          </Button>
        ) : undefined}
      />

      {/* Einheitliche KPI-Kacheln (identisch zur Teamübersicht) */}
      <section aria-label={t('users.registeredTitle')} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
        <StatCard
          icon={<UsersIcon className="h-5 w-5" aria-hidden="true" />}
          value={userStats.total}
          label={t('users.stats.total')}
          accent="blue"
        />
        <StatCard
          icon={<UserCheck className="h-5 w-5" aria-hidden="true" />}
          value={userStats.active}
          label={t('users.stats.active')}
          accent="green"
        />
        <StatCard
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          value={userStats.verified}
          label={t('users.stats.verified')}
          accent="purple"
        />
        <StatCard
          icon={<Crown className="h-5 w-5" aria-hidden="true" />}
          value={userStats.owners}
          label={t('users.stats.owners')}
          accent="amber"
        />
      </section>

      {/* Benutzer anlegen */}
      {showCreate && (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-high/65 p-5 shadow-lg backdrop-blur-xl sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/15 text-primary shadow-sm">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-headline text-base font-bold text-on-surface">
                {t('users.createUser')}
              </h3>
              <p className="mt-0.5 font-body-md text-xs sm:text-sm text-on-surface-variant">
                {t('users.createSubtitle')}
              </p>
            </div>
          </div>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label={t('auth.username')}
              type="text"
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              required
              minLength={3}
              maxLength={12}
            />
            <Input
              label={t('auth.email')}
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              required
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-user-password" className="text-sm font-medium text-foreground">
                {t('common.password')}
              </label>
              <PasswordInput
                id="create-user-password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div className="flex flex-wrap items-end gap-6 pb-1">
              {/* Owner-Accounts darf ausschließlich der Owner selbst anlegen.
                  Backend lehnt is_owner=true für Non-Owner mit 403 ab; das UI
                  spiegelt diese Invariante, damit Admins die Option nicht
                  sehen und nicht versehentlich versuchen. */}
              {currentUser?.is_owner && (
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="create-user-owner"
                    checked={createForm.is_owner}
                    onCheckedChange={(checked) => setCreateForm({ ...createForm, is_owner: checked })}
                    aria-label={t('users.isOwner')}
                  />
                  <label htmlFor="create-user-owner" className="cursor-pointer font-body-md text-sm text-on-surface">
                    {t('users.isOwner')}
                  </label>
                </div>
              )}
              <div className="flex items-center gap-2.5">
                <Switch
                  id="create-user-verify"
                  checked={createForm.auto_verify}
                  onCheckedChange={(checked) => setCreateForm({ ...createForm, auto_verify: checked })}
                  aria-label={t('users.autoVerify')}
                />
                <label htmlFor="create-user-verify" className="cursor-pointer font-body-md text-sm text-on-surface">
                  {t('users.autoVerify')}
                </label>
              </div>
            </div>
            <div className="flex gap-3 pt-2 md:col-span-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="disabled:opacity-50"
              >
                {creating ? t('common.loading') : t('users.createUser')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Registrierte Benutzer & Rollenzuweisung */}
      <section aria-labelledby="registered-users-title" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/15 text-primary backdrop-blur-md shadow-sm">
              <UsersIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="registered-users-title" className="font-headline text-base sm:text-lg font-bold text-on-surface">
                {t('users.registeredTitle')}
              </h2>
              <p className="font-body-md text-xs sm:text-sm text-on-surface-variant">
                {t('users.registeredSubtitle')}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
              />
              <Input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={t('users.searchPlaceholder')}
                aria-label={t('users.searchLabel')}
                className="pl-9 text-sm"
              />
            </div>
            <div className="w-full sm:w-48">
              <Dropdown
                value={roleFilter}
                onChange={(val) => setRoleFilter(val ?? '__all__')}
                options={roleFilterOptions}
                placeholder={t('users.filterRole')}
                aria-label={t('users.filterRole')}
                buttonClassName="text-sm h-10"
              />
            </div>
          </div>
        </div>

        <div
          className="min-w-0 rounded-2xl border border-outline-variant/30 bg-surface-container-high/55 shadow-sm backdrop-blur-xl"
          data-testid="user-directory"
        >
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.25fr)_7.5rem_minmax(13rem,1.15fr)_3rem] gap-4 rounded-t-2xl border-b border-outline-variant/30 bg-surface-container-high/45 px-5 py-3 font-label-md text-label-sm uppercase tracking-wider text-on-surface-variant md:grid"
          >
            <span>{t('auth.username')}</span>
            <span>{t('auth.email')}</span>
            <span>Status</span>
            <span>{t('users.role')}</span>
            <span />
          </div>

          {filteredUsers.length === 0 ? (
            <div className="px-5 py-10 text-center font-body-md text-sm text-on-surface-variant">
              {t('users.noMatchingUsers')}
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/25">
              {filteredUsers.map((user) => {
                const assignedRoleIds = getUserRoleIds(user)
                const assignedRoles = roles.filter((candidate) => assignedRoleIds.includes(candidate.id))
                const canEditRoles = !user.is_owner && canManagePermissions && user.id !== currentUser?.id

                return (
                  <article
                    key={user.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 px-4 py-4 transition-colors last:rounded-b-2xl hover:bg-surface-container-high/45 md:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.25fr)_7.5rem_minmax(13rem,1.15fr)_3rem] md:items-center md:gap-4 md:px-5"
                  >
                    {/* Identität */}
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        src={user.avatar_url}
                        name={user.username}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {user.is_owner && (
                            <Crown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-status-warning" />
                          )}
                          <span className="break-words font-body-md text-sm font-semibold text-on-surface">
                            {user.username}
                          </span>
                          {user.id === currentUser?.id && (
                            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-label-sm font-semibold text-primary">
                              {t('users.currentUser')}
                            </span>
                          )}
                        </div>
                        {canEditRoles && assignedRoles.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {assignedRoles.map((role) => (
                              <RoleBadge
                                key={role.id}
                                name={formatRoleName(role)}
                                color={role.color}
                                icon={role.icon}
                                isAdmin={role.name === 'admin'}
                                variant="subtle"
                                size="sm"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* E-Mail & Verifizierung */}
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <Mail aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
                        <span className="min-w-0 break-all font-body-md text-sm text-on-surface-variant">
                          {user.email}
                        </span>
                      </div>
                      <span
                        className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                          user.email_verified
                            ? 'border-status-success/30 bg-status-success/10 text-status-success'
                            : 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                        }`}
                      >
                        {user.email_verified ? (
                          <CheckCircle aria-hidden="true" className="h-3 w-3" />
                        ) : (
                          <XCircle aria-hidden="true" className="h-3 w-3" />
                        )}
                        {user.email_verified ? t('users.emailVerified') : t('users.emailNotVerified')}
                      </span>
                    </div>

                    {/* Kontostatus */}
                    <div className="col-start-1 md:col-auto">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                          user.is_active
                            ? 'border-status-success/25 bg-status-success/10 text-status-success'
                            : 'border-outline-variant/40 bg-surface-container-high/50 text-on-surface-variant'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${
                            user.is_active ? 'bg-status-success' : 'bg-on-surface-variant/45'
                          }`}
                        />
                        {user.is_active ? t('common.active') : t('users.inactive')}
                      </span>
                    </div>

                    {/* Globale Rollenzuweisung */}
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      {user.is_owner ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/35 bg-status-warning/15 px-2.5 py-1 font-mono text-xs font-semibold text-status-warning">
                          <Crown className="h-3 w-3" aria-hidden="true" />
                          owner
                        </span>
                      ) : canEditRoles ? (
                        <MultiSelect
                          values={assignedRoleIds.map(String)}
                          onChange={(values) => void assignRoles(user, values.map(Number))}
                          placeholder={t('users.noRole')}
                          options={roles.map((candidate) => ({
                            value: String(candidate.id),
                            label: formatRoleName(candidate),
                            disabled: candidate.name === 'admin' && !currentUser?.is_owner,
                          }))}
                          disabled={savingRoleUserId !== null}
                          aria-label={`${t('users.assignRole')}: ${user.username}`}
                        />
                      ) : assignedRoles.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {assignedRoles.map((role) => (
                            <RoleBadge
                              key={role.id}
                              name={formatRoleName(role)}
                              color={role.color}
                              icon={role.icon}
                              isAdmin={role.name === 'admin'}
                              variant="subtle"
                              size="sm"
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="font-mono-sm text-mono-sm text-on-surface-variant">{t('users.noRole')}</span>
                      )}
                    </div>

                    {/* Löschen */}
                    <div className="col-start-2 row-start-1 flex justify-end md:col-auto md:row-auto">
                      {canManageUsers && user.id !== currentUser?.id && (!user.is_owner || currentUser?.is_owner) && (
                        <Kurzinfo text={t('common.delete')} seite="ende">
                          <button
                            type="button"
                            onClick={() => handleDelete(user.id)}
                            className="grid h-10 w-10 place-items-center rounded-xl text-status-destructive transition-colors hover:bg-status-destructive/10 hover:text-status-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-destructive/60"
                            aria-label={`${t('common.delete')}: ${user.username}`}
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </Kurzinfo>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Server-Berechtigungen verwalten (Direktdelegation pro Server & Sub-User).
          Quelle der Wahrheit bleibt das Backend; UI ist nur Convenience. */}
      {canManagePermissions && servers.length > 0 && (
        <section aria-labelledby="server-access-title" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-secondary/25 bg-secondary/15 text-secondary backdrop-blur-md shadow-sm">
              <Shield className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="server-access-title" className="font-headline text-base sm:text-lg font-bold text-on-surface">
                {t('serverPermissions.adminTitle')}
              </h2>
              <p className="font-body-md text-xs sm:text-sm text-on-surface-variant">
                {t('serverPermissions.adminSubtitle')}
              </p>
            </div>
          </div>

          <div
            className="grid min-w-0 overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high/55 shadow-sm backdrop-blur-xl lg:grid-cols-[20rem_minmax(0,1fr)]"
            data-testid="server-access-workspace"
          >
            <aside className="min-w-0 border-b border-outline-variant/30 bg-surface-container/40 p-4 lg:border-b-0 lg:border-r">
              <label
                htmlFor="server-access-search"
                className="mb-2 block font-label-md text-xs uppercase tracking-wider text-on-surface-variant"
              >
                {t('serverPermissions.selectServer')}
              </label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                />
                <Input
                  id="server-access-search"
                  type="search"
                  value={serverSearch}
                  onChange={(event) => setServerSearch(event.target.value)}
                  placeholder={t('serverPermissions.searchServer')}
                  className="pl-9 text-sm"
                />
              </div>

              <div
                className="mt-3 flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1 lg:max-h-[34rem]"
                aria-label={t('serverPermissions.selectServer')}
              >
                {filteredServers.length > 0 ? (
                  filteredServers.map((server) => {
                    const isSelected = server.id === permServerId
                    return (
                      <button
                        key={server.id}
                        type="button"
                        onClick={() => setPermServerId(server.id)}
                        aria-pressed={isSelected}
                        aria-current={isSelected ? 'true' : undefined}
                        className={`grid min-h-14 w-full grid-cols-[1rem_minmax(0,1fr)] gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
                          isSelected
                            ? 'border-primary/40 bg-primary/15 text-primary shadow-sm'
                            : 'border-transparent text-on-surface hover:border-outline-variant/45 hover:bg-surface-container-high/55'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-2 w-2 rounded-full ${
                            server.status === 'running' ? 'bg-status-success shadow-2xs' : 'bg-on-surface-variant/45'
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="block break-words font-body-md text-sm font-semibold leading-5">
                            {server.name}
                          </span>
                          <span className="mt-1 inline-flex items-center rounded-md border border-outline-variant/25 bg-surface-container-high/45 px-1.5 py-0.5 font-mono text-label-sm uppercase tracking-wide text-on-surface-variant">
                            {server.game_type}
                          </span>
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <p className="px-3 py-6 text-center font-body-md text-sm text-on-surface-variant">
                    {t('serverPermissions.noServersFound')}
                  </p>
                )}
              </div>
            </aside>

            <div className="min-w-0">
              {selectedServer && typeof permServerId === 'number' ? (
                <>
                  <header className="flex min-w-0 items-center justify-between gap-3 border-b border-outline-variant/30 bg-surface-container-high/35 px-4 py-4 sm:px-6">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/15 text-primary shadow-sm">
                        <ServerIcon aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-label-md text-label-sm uppercase tracking-wider text-on-surface-variant">
                          {t('serverPermissions.selectedServer')}
                        </p>
                        <h3 className="mt-0.5 break-words font-headline text-base leading-6 text-on-surface">
                          {selectedServer.name}
                        </h3>
                      </div>
                    </div>
                    <span className="hidden shrink-0 items-center rounded-full border border-outline-variant/35 bg-surface-container-high/55 px-2.5 py-1 font-mono text-label-sm uppercase tracking-wide text-on-surface-variant sm:inline-flex">
                      {selectedServer.game_type}
                    </span>
                  </header>
                  <div className="p-4 sm:p-6">
                    <ServerPermissionsPanel serverId={permServerId} />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
