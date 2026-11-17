import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { api } from '@/api/client'
import { rbacApi } from '@/api/rbac'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { Button, Dropdown, Kurzinfo, Spinner } from '@maunting/ui'
import { Avatar } from '@/components/app/Avatar'
import type { User } from '@/types'
import type { PermissionCatalog, PermissionDef } from '@/types/permissions'
import { PermissionEditor } from '@/features/permissions/PermissionEditor'

interface Props {
  serverId: number
}

interface UserPermissionRow {
  user: User
  permissions: string[]
}

type PresetId = 'view_only' | 'observer' | 'operator' | 'full_access'

interface PermissionPreset {
  id: PresetId
  labelKey: string
  keys: string[]
}

function buildServerPresets(definitions: PermissionDef[]): PermissionPreset[] {
  const allKeys = definitions.map((d) => d.key)
  if (allKeys.length === 0) return []

  const viewOnlyKeys = allKeys.includes('server.view') ? ['server.view'] : allKeys.slice(0, 1)
  const observerKeys = allKeys.filter((k) =>
    ['server.view', 'server.console_read', 'server.logs'].some(
      (d) => k === d || k.includes(d) || k.endsWith('.view') || k.endsWith('.read'),
    ),
  )
  const operatorKeys = allKeys.filter((k) =>
    [
      'server.view',
      'server.start',
      'server.stop',
      'server.restart',
      'server.console_read',
      'server.console_send',
    ].some((d) => k === d || k.includes('start') || k.includes('stop') || k.includes('restart') || k.includes('console')),
  )

  const candidates: PermissionPreset[] = [
    { id: 'view_only', labelKey: 'serverPermissions.presetViewOnly', keys: viewOnlyKeys },
    { id: 'observer', labelKey: 'serverPermissions.presetObserver', keys: observerKeys },
    { id: 'operator', labelKey: 'serverPermissions.presetOperator', keys: operatorKeys },
    { id: 'full_access', labelKey: 'serverPermissions.presetFullAccess', keys: allKeys },
  ]

  // Doppelte Schlüsselmengen (z. B. bei kleinem Katalog) zusammenfassen, Vollzugriff und view_only behalten
  const seenSignatures = new Set<string>()
  const unique: PermissionPreset[] = []
  for (const preset of candidates) {
    if (preset.keys.length === 0) continue
    const sig = [...preset.keys].sort().join('|')
    if (preset.id !== 'full_access' && seenSignatures.has(sig)) continue
    if (preset.id === 'full_access' && seenSignatures.has(sig) && preset.keys.length === viewOnlyKeys.length) {
      continue
    }
    seenSignatures.add(sig)
    unique.push(preset)
  }
  return unique
}

function renderPresetIcon(id: PresetId) {
  switch (id) {
    case 'view_only':
    case 'observer':
      return <Eye className="h-3.5 w-3.5" aria-hidden="true" />
    case 'operator':
      return <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
    case 'full_access':
      return <Check className="h-3.5 w-3.5" aria-hidden="true" />
  }
}

/** Pro-Server-Delegation: zeigt pro Sub-User welche `server.*`-Rechte er hier hat,
 *  und erlaubt direktes Hinzufügen (mit Schnellvorlage), Editieren sowie komplettes Entfernen.
 *
 *  Auf der Server-Ebene gibt es bewusst KEIN `servers.delete` (PLAN-Entscheidung).
 */
export function ServerPermissionsPanel({ serverId }: Props) {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null)
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [rows, setRows] = useState<UserPermissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [addingUserId, setAddingUserId] = useState<number | ''>('')
  const [addPresetId, setAddPresetId] = useState<PresetId>('view_only')
  const [editing, setEditing] = useState<number | null>(null)
  const [editSelection, setEditSelection] = useState<Set<string>>(new Set())

  const refresh = async () => {
    try {
      const [cat, users] = await Promise.all([
        rbacApi.catalog(),
        api<User[]>('/admin/users'),
      ])
      setCatalog(cat)
      setAllUsers(users)

      // Für alle nicht-Owner-User schauen, ob es Permissions auf diesem Server gibt.
      const candidates = users.filter((u) => !u.is_owner)
      // Eine gescheiterte Abfrage darf nicht als "keine Rechte" durchgehen:
      // sonst verschwindet eine tatsächlich vergebene Delegation lautlos aus
      // der Liste. Wir sammeln die Fehlschläge und nennen sie beim Namen.
      const gescheitert: string[] = []
      const fetched = await Promise.all(
        candidates.map(async (u) => {
          try {
            const res = await rbacApi.getServerPermissions(u.id, serverId)
            return { user: u, permissions: res.permissions } as UserPermissionRow
          } catch {
            gescheitert.push(u.username)
            return null
          }
        }),
      )
      setRows(
        fetched
          .filter((r): r is UserPermissionRow => r !== null && r.permissions.length > 0)
          .sort((a, b) => a.user.username.localeCompare(b.user.username)),
      )
      if (gescheitert.length > 0) {
        toast.error(t('serverPermissions.loadFailed', { users: gescheitert.join(', ') }))
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [serverId])

  const usersWithoutDelegation = useMemo(() => {
    const taken = new Set(rows.map((r) => r.user.id))
    return allUsers.filter((u) => !u.is_owner && !taken.has(u.id))
  }, [allUsers, rows])

  const presets = useMemo(
    () => buildServerPresets(catalog?.server_permissions ?? []),
    [catalog],
  )

  const permissionLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const def of catalog?.server_permissions ?? []) {
      map.set(def.key, def.label)
    }
    return map
  }, [catalog])

  const formatPermissionTitle = (key: string) =>
    t(`permissionDetails.${key.replace(/\./g, '_')}.title`, {
      defaultValue: permissionLabelMap.get(key) ?? key,
    })

  const startEdit = (row: UserPermissionRow) => {
    setEditing(row.user.id)
    setEditSelection(new Set(row.permissions))
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditSelection(new Set())
  }

  const save = async (userId: number) => {
    try {
      await rbacApi.setServerPermissions(userId, serverId, Array.from(editSelection).sort())
      toast.success(t('serverPermissions.saved'))
      cancelEdit()
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const addUser = async () => {
    if (!addingUserId || typeof addingUserId !== 'number') return
    const chosenPreset = presets.find((p) => p.id === addPresetId)
    const initialKeys = chosenPreset?.keys.length ? [...chosenPreset.keys].sort() : ['server.view']
    try {
      await rbacApi.setServerPermissions(addingUserId, serverId, initialKeys)
      toast.success(t('serverPermissions.saved'))
      setAddingUserId('')
      setAddPresetId('view_only')
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const revoke = async (userId: number) => {
    if (!(await confirm({ message: t('serverPermissions.revokeConfirm'), danger: true }))) return
    try {
      await rbacApi.revokeServerPermissions(userId, serverId)
      toast.success(t('serverPermissions.saved'))
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading || !catalog) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" className="text-primary" />
      </div>
    )
  }

  const totalServerKeys = catalog.server_permissions.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-base text-primary">{t('serverPermissions.title')}</h3>
          <p className="mt-1 font-body-md text-sm text-on-surface-variant">
            {t('serverPermissions.subtitle')}
          </p>
          <p className="mt-1.5 font-body-md text-xs text-on-surface-variant">
            {t('serverPermissions.ownerHint')}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/35 bg-surface-container-high/55 px-3 py-1 font-label-md text-xs font-semibold text-on-surface-variant">
          <Users className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span>{t('serverPermissions.subUsersCount', { count: rows.length })}</span>
        </span>
      </div>

      {/* User hinzufügen mit optionaler Schnellvorlage (Standard: Nur ansehen) */}
      <div className="space-y-3 rounded-2xl border border-outline-variant/35 bg-surface-container-low/55 p-4 backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block font-label-md text-label-sm uppercase tracking-wider text-on-surface-variant">
              {t('serverPermissions.selectUser')}
            </label>
            <Dropdown
              value={addingUserId === '' ? null : String(addingUserId)}
              onChange={(value) => setAddingUserId(value ? Number(value) : '')}
              placeholder={t('serverPermissions.selectUser')}
              options={usersWithoutDelegation.map((u) => ({ value: String(u.id), label: u.username }))}
              buttonClassName="text-sm py-2"
              aria-label={t('serverPermissions.selectUser')}
            />
          </div>
          <Button
            type="button"
            onClick={addUser}
            disabled={!addingUserId}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('serverPermissions.addUser')}
          </Button>
        </div>

        {presets.length > 1 && usersWithoutDelegation.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-outline-variant/25 pt-3">
            <span className="mr-1 font-label-md text-label-sm uppercase tracking-wider text-on-surface-variant">
              {t('serverPermissions.initialAccess')}:
            </span>
            {presets.map((preset) => {
              const active = addPresetId === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setAddPresetId(preset.id)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-medium transition-all ${
                    active
                      ? 'border-primary/45 bg-primary/15 text-primary shadow-sm font-semibold'
                      : 'border-outline-variant/30 bg-surface-container-high/45 text-on-surface-variant hover:border-outline-variant/60 hover:text-on-surface'
                  }`}
                >
                  {renderPresetIcon(preset.id)}
                  <span>{t(preset.labelKey)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Bestehende Delegationen */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/45 bg-surface-container-low/30 px-4 py-10 text-center font-body-md text-sm text-on-surface-variant">
          {t('serverPermissions.noUsers')}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const isEditing = editing === row.user.id
            const visiblePermissions = row.permissions.slice(0, 4)
            const hiddenPermissionCount = row.permissions.length - visiblePermissions.length
            const isFullAccess =
              totalServerKeys > 0 && row.permissions.length >= totalServerKeys
            const isViewOnly =
              row.permissions.length === 1 && row.permissions[0] === 'server.view'

            return (
              <article
                key={row.user.id}
                className="overflow-hidden rounded-2xl border border-outline-variant/35 bg-surface-container-low/60 backdrop-blur-md shadow-sm transition-all hover:border-outline-variant/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={row.user.avatar_url} name={row.user.username} size="sm" />
                    <div className="min-w-0">
                      <strong className="block break-words font-body-md text-sm font-semibold text-on-surface">
                        {row.user.username}
                      </strong>
                      <span className="mt-0.5 block break-all text-xs text-on-surface-variant">
                        {row.user.email}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!isEditing && (
                      isFullAccess ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/15 px-3 py-1 text-xs font-semibold text-status-success">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{t('serverPermissions.fullAccessBadge')}</span>
                        </span>
                      ) : isViewOnly ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-secondary/30 bg-secondary/15 px-3 py-1 text-xs font-semibold text-secondary">
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{t('serverPermissions.viewOnlyBadge')}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                          <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {t('serverPermissions.activeFraction', {
                              active: row.permissions.length,
                              total: totalServerKeys,
                            })}
                          </span>
                        </span>
                      )
                    )}

                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => save(row.user.id)}
                            className="inline-flex min-h-9 items-center gap-1.5"
                          >
                            <Save className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('common.save')}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex min-h-9 items-center gap-1.5"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('common.cancel')}
                          </Button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 font-label-md text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('common.edit')}
                        </button>
                      )}
                      <Kurzinfo text={t('serverPermissions.revoke')} seite="ende">
                        <button
                          type="button"
                          onClick={() => revoke(row.user.id)}
                          className="grid h-9 w-9 place-items-center rounded-xl text-status-destructive transition-colors hover:bg-status-destructive/10 hover:text-status-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-destructive/60"
                          aria-label={`${t('serverPermissions.revoke')}: ${row.user.username}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </Kurzinfo>
                    </div>
                  </div>
                </div>

                {!isEditing ? (
                  <div className="border-t border-outline-variant/25 bg-surface-container-high/20 px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {visiblePermissions.map((permKey) => (
                        <span
                          key={permKey}
                          className="inline-flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/65 px-2.5 py-1 text-xs font-medium text-on-surface"
                        >
                          {formatPermissionTitle(permKey)}
                        </span>
                      ))}
                      {hiddenPermissionCount > 0 && (
                        <span className="inline-flex items-center rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                          {t('serverPermissions.moreCount', { count: hiddenPermissionCount })}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 border-t border-outline-variant/30 bg-surface-container-high/20 p-4 sm:p-5">
                    {presets.length > 0 && (
                      <div>
                        <span className="mb-2 block font-label-md text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                          {t('serverPermissions.quickPresets')}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {presets.map((preset) => {
                            const matches =
                              preset.keys.length === editSelection.size &&
                              preset.keys.every((k) => editSelection.has(k))
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => setEditSelection(new Set(preset.keys))}
                                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
                                  matches
                                    ? 'border-primary/45 bg-primary/20 text-primary shadow-sm font-semibold'
                                    : 'border-outline-variant/30 bg-surface-container-high/50 text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
                                }`}
                              >
                                {renderPresetIcon(preset.id)}
                                <span>{t(preset.labelKey)}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <PermissionEditor
                      permissions={catalog.server_permissions}
                      selected={editSelection}
                      onChange={setEditSelection}
                    />
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
