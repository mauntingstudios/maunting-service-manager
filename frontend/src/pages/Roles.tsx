import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Pencil, X } from 'lucide-react'
import { rbacApi } from '@/api/rbac'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { useHasPermission } from '@/hooks/useHasPermission'
import type { PermissionCatalog, Role } from '@/types/permissions'
import { PermissionEditor } from '@/Singra/UI/PermissionEditor'
import { PageHeader } from '@/Singra/UI/PageHeader'
import { Button, ColorPicker, IconPicker, Kurzinfo, RoleBadge, renderRoleIcon } from '@/Singra/UI'

import { Spinner } from '@/components/ui/Spinner'
/**
 * Erlaubte Rollennamen — dieselbe Sprache wie `backend/schemas/role.py`.
 *
 * Der Bindestrich ist hier **maskiert**, im Backend steht er unmaskiert
 * (`^[a-zA-Z0-9_-]+$`). Beide beschreiben dieselbe Menge; der Unterschied ist
 * nur die Schreibweise, die der jeweilige Regex-Dialekt verlangt.
 *
 * Chrome uebersetzt das `pattern`-Attribut mit dem `v`-Flag, und dort ist ein
 * unmaskierter Bindestrich in einer Zeichenklasse reserviert. Die Folge war
 * kein stiller Fehler, sondern ein harter, gemeldet am 18.08.2026:
 *
 *   Pattern attribute value ^[a-zA-Z0-9_-]+$ is not a valid regular
 *   expression: Invalid character in character class
 *
 * Ein `pattern`, das der Browser nicht uebersetzen kann, wird nicht
 * grosszuegig ausgelegt — es faellt ganz aus. Die Maske nahm damit Namen an,
 * die das Backend danach mit 422 abwies, und der Betreiber sah nur, dass
 * Speichern nicht geht.
 *
 * Als Konstante und nicht als Literal im Attribut: `Roles.test.tsx` prueft
 * damit beide Richtungen — dass der Browser den Ausdruck uebersetzen kann und
 * dass er dieselben Namen annimmt wie das Backend.
 */
export const ROLLENNAME_MUSTER = '^[a-zA-Z0-9_\\-]+$'

interface RoleFormProps {
  catalog: PermissionCatalog
  initial: Role | null
  onSubmit: (
    name: string,
    description: string | null,
    permissions: string[],
    color?: string,
    icon?: string | null,
  ) => Promise<void>
  onCancel: () => void
}

function RoleForm({ catalog, initial, onSubmit, onCancel }: RoleFormProps) {
  const { t } = useTranslation()
  const isAdminRole = initial?.is_system && initial?.name === 'admin'
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [color, setColor] = useState(initial?.color || '#3b82f6')
  const [icon, setIcon] = useState<string | null>(initial?.icon || null)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initial?.permissions ?? []),
  )
  const [saving, setSaving] = useState(false)

  const allPerms = useMemo(() => [
    ...catalog.global_permissions,
    ...catalog.server_permissions,
  ], [catalog])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit(
        name.trim(),
        description.trim() || null,
        Array.from(selected).sort(),
        color,
        icon || null,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-outline-variant/35 bg-surface-container/60 p-5 sm:p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div className="flex items-center gap-3">
          <div
            className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-sm"
            style={{ backgroundColor: color }}
          >
            {renderRoleIcon(icon, 'h-4 w-4 text-white')}
          </div>
          <div>
            <h3 className="font-headline text-body-md font-bold text-primary">
              {initial ? `${t('common.edit')}: ${initial.name}` : t('roles.create')}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {t('roles.subtitle')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          aria-label={t('common.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isAdminRole && (
        <div className="msm-alert-warning text-sm">{t('roles.adminLocked')}</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
            {t('roles.name')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('roles.namePlaceholder')}
            className="msm-input"
            disabled={!!initial?.is_system}
            required
            minLength={2}
            maxLength={64}
            pattern={ROLLENNAME_MUSTER}
          />
        </div>
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
            Farbe
          </label>
          <ColorPicker
            value={color}
            onChange={setColor}
            disabled={saving}
          />
        </div>
      </div>

      <div>
        <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
          Rollen-Icon
        </label>
        <IconPicker
          value={icon}
          onChange={setIcon}
          disabled={saving}
        />
      </div>

      <div>
        <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
          {t('roles.description')}
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('roles.descriptionPlaceholder')}
          className="msm-input"
          maxLength={255}
        />
      </div>

      <div className="space-y-2">
        <span className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
          {t('roles.permissions')} ({selected.size})
        </span>
        <PermissionEditor
          permissions={allPerms}
          selected={selected}
          onChange={setSelected}
          disabled={isAdminRole}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" type="button" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={saving || isAdminRole}
          className="disabled:opacity-50"
        >
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}

export function Roles() {
  const { t } = useTranslation()
  const canManage = useHasPermission('roles.manage')
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = async () => {
    try {
      const [cat, list] = await Promise.all([rbacApi.catalog(), rbacApi.listRoles()])
      setCatalog(cat)
      setRoles(list)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const handleCreate = async (
    name: string,
    description: string | null,
    permissions: string[],
    color?: string,
    icon?: string | null,
  ) => {
    try {
      await rbacApi.createRole({ name, description, permissions, color, icon })
      toast.success(t('roles.created'))
      setCreating(false)
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUpdate = async (
    role: Role,
    name: string,
    description: string | null,
    permissions: string[],
    color?: string,
    icon?: string | null,
  ) => {
    try {
      await rbacApi.updateRole(role.id, {
        name: role.is_system ? null : name,
        description,
        permissions,
        color,
        icon,
      })
      toast.success(t('roles.updated'))
      setEditing(null)
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (role: Role) => {
    if (!(await confirm({ message: t('roles.confirmDelete'), danger: true, confirmText: t('common.delete') }))) return
    try {
      await rbacApi.deleteRole(role.id)
      toast.success(t('roles.deleted'))
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => Number(b.is_system) - Number(a.is_system) || a.name.localeCompare(b.name)),
    [roles],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  if (!catalog) {
    return null
  }

  return (
    <div className="msm-page">
      <PageHeader eyebrow={t('pageContext.administration')} title={t('roles.title')} description={t('roles.subtitle')} status={<span className="msm-badge-info">{roles.length} {t('roles.title')}</span>} actions={canManage ? (
          <Button
            onClick={() => {
              setEditing(null)
              setCreating(true)
            }}
            className="min-h-11 inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('roles.create')}
          </Button>) : undefined} />

      {creating && (
        <RoleForm
          catalog={catalog}
          initial={null}
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="msm-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-outline-variant/50">
              <th className="text-left font-label-md text-label-md text-on-surface-variant p-4 uppercase tracking-wider">
                {t('roles.name')}
              </th>
              <th className="text-left font-label-md text-label-md text-on-surface-variant p-4 uppercase tracking-wider">
                {t('roles.description')}
              </th>
              <th className="text-left font-label-md text-label-md text-on-surface-variant p-4 uppercase tracking-wider">
                {t('roles.permissions')}
              </th>
              <th className="text-right font-label-md text-label-md text-on-surface-variant p-4 uppercase tracking-wider">
                {t('users.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRoles.map((role) => (
              <tr key={role.id} className="border-b border-outline-variant/30 hover:bg-surface-container-high/50 transition-colors">
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <RoleBadge
                      name={role.is_system ? t(`roles.systemNames.${role.name}`, { defaultValue: role.name }) : role.name}
                      color={role.color}
                      icon={role.icon}
                      size="sm"
                    />
                    {role.is_system ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning border border-status-warning/30">
                        {t('roles.system')}
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                        {t('roles.custom')}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-4 text-on-surface-variant font-body-md text-sm">
                  {role.description || '—'}
                </td>
                <td className="p-4 font-mono-sm text-mono-sm text-on-surface-variant">
                  {role.permissions.length}
                </td>
                <td className="p-4 text-right space-x-3">
                  {canManage && (
                    <Kurzinfo text={t('common.edit')} seite="ende">
                      <button
                        onClick={() => {
                          setCreating(false)
                          setEditing(role)
                        }}
                        className="text-primary hover:text-primary/80 transition-colors inline-flex items-center"
                        aria-label={t('common.edit')}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </Kurzinfo>
                  )}
                  {canManage && !role.is_system && (
                    <Kurzinfo text={t('common.delete')} seite="ende">
                      <button
                        onClick={() => handleDelete(role)}
                        className="text-status-destructive hover:text-status-destructive/80 transition-colors inline-flex items-center"
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Kurzinfo>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RoleForm
          catalog={catalog}
          initial={editing}
          onSubmit={(n, d, p, c, i) => handleUpdate(editing, n, d, p, c, i)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
