import { Crown, Eye, Pencil, Plus, Server, Shield, Sparkles, Trash2, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Kurzinfo, RoleBadge } from '@maunting/ui'

import type { TeamDetail, TeamRole, TeamServer } from '@/api/teams'
import { TeamRoleForm } from './TeamRoleForm'

export interface TeamRolesTabProps {
  team: TeamDetail
  assignable: TeamServer[]
  busy: boolean
  canManageRoles: boolean
  activePreviewRoleId: number | null
  isCreatingRole: boolean
  editingRole: TeamRole | null
  onOpenCreateRole: () => void
  onOpenEditRole: (role: TeamRole) => void
  onCloseRoleForm: () => void
  onRoleSaved: (role: TeamRole) => void
  onDeleteRole: (role: TeamRole) => void
  onPreviewRole: (role: TeamRole) => void
}

/**
 * Rollen-Reiter des Team-Arbeitsbereichs (Rollenliste, Inline-Erstellung/-Bearbeitung und Rollenvorschau).
 */
export function TeamRolesTab({
  team,
  assignable,
  busy,
  canManageRoles,
  activePreviewRoleId,
  isCreatingRole,
  editingRole,
  onOpenCreateRole,
  onOpenEditRole,
  onCloseRoleForm,
  onRoleSaved,
  onDeleteRole,
  onPreviewRole,
}: TeamRolesTabProps) {
  const { t } = useTranslation()
  const roles = team.roles || []

  return (
    <section className="space-y-6 w-full" aria-labelledby="team-roles">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 id="team-roles" className="font-headline text-lg font-semibold text-on-surface">
            {t('teams.roles')}
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant">
            {t('teams.rolesHint')}
          </p>
        </div>

        {canManageRoles && !isCreatingRole && !editingRole && (
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
          {canManageRoles && (
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
            const hasServerGrants = (role.server_grants?.length ?? 0) > 0
            const isPreviewActive = activePreviewRoleId === role.id

            return (
              <div
                key={role.id}
                className={`flex flex-col justify-between rounded-xl border bg-surface p-4 shadow-sm transition-all ${
                  isPreviewActive
                    ? 'border-primary/60 ring-1 ring-primary/30'
                    : 'border-outline-variant/40 hover:border-outline-variant'
                }`}
              >
                <div className="space-y-3">
                  {/* Header: RoleBadge & Badges */}
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="flex items-center gap-2.5 min-w-0">
                      <Kurzinfo text={t('rolePreview.previewAction')} seite="anfang">
                        <button
                          type="button"
                          onClick={() => onPreviewRole(role)}
                          className="group inline-flex items-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`${t('rolePreview.previewAction')}: ${role.name}`}
                        >
                          <RoleBadge
                            name={role.name}
                            color={role.color}
                            icon={role.icon}
                            isAdmin={role.is_admin}
                            size="md"
                          />
                          <Eye
                            className={`h-3.5 w-3.5 text-on-surface-variant transition-opacity ${
                              isPreviewActive
                                ? 'opacity-100 text-primary'
                                : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </Kurzinfo>
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
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-3 mt-3 border-t border-outline-variant/30">
                  <Button
                    type="button"
                    variant={isPreviewActive ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => onPreviewRole(role)}
                    className="text-xs h-7 px-2"
                    aria-label={`${t('rolePreview.previewAction')} (${role.name})`}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                    {isPreviewActive ? t('rolePreview.previewActive') : t('rolePreview.previewAction')}
                  </Button>

                  {canManageRoles && (
                    <div className="flex items-center gap-1.5">
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
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
