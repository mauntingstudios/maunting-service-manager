import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ChevronDown, Info, Lock, Server, Shield } from 'lucide-react'
import type { TeamDetail, TeamRole, TeamServer } from '@/api/teams'
import { Button, RoleBadge, Switch } from '@maunting/ui'
import { TeamServerCard } from './TeamServerCard'

export interface TeamServerManagerProps {
  team: TeamDetail
  assignable: TeamServer[]
  busy: boolean
  canToggleServerRoles?: boolean
  canManageRoles?: boolean
  onSetServerKeys: (serverId: number, keys: string[]) => void
  onToggleServerRoles: (active: boolean) => void
  onSyncServerKeysToAll?: (sourceServerId: number, keys: string[]) => void
  onOpenRoleInRolesTab?: (role: TeamRole | null) => void
}

/**
 * Server-Verwaltung eines Teams.
 *
 * - Standardmodus (`server_roles_active = false`): teamweite Serverrechte werden hier je Server gepflegt.
 * - Rollenmodus (`server_roles_active = true`): reiner Überblick je Server (Single Source of Truth ist „Rollen & Rechte“).
 */
export function TeamServerManager({
  team,
  assignable,
  busy,
  canToggleServerRoles = team.is_owner,
  canManageRoles = false,
  onSetServerKeys,
  onToggleServerRoles,
  onSyncServerKeysToAll,
  onOpenRoleInRolesTab,
}: TeamServerManagerProps) {
  const { t } = useTranslation()
  const rollen = (team.roles || []).filter((r) => !r.is_admin)
  const [expandedByServer, setExpandedByServer] = useState<Record<number, number | null>>({})

  const toggleRoleInspection = (serverId: number, roleId: number) => {
    setExpandedByServer((prev) => ({
      ...prev,
      [serverId]: prev[serverId] === roleId ? null : roleId,
    }))
  }

  const serverGridClass =
    assignable.length > 1
      ? 'grid grid-cols-1 xl:grid-cols-2 gap-4 items-start'
      : 'space-y-4'

  return (
    <section className="space-y-6 w-full" aria-labelledby="team-servers-heading">
      {/* Kopfbereich */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 id="team-servers-heading" className="font-headline text-lg sm:text-xl font-bold text-on-surface">
            {t('teams.servers')}
          </h3>
          <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-2xl">
            {t('teams.serversHint')}
          </p>
        </div>
      </div>

      {/* Rollenmodus Umschalter für Teambesitzer */}
      {canToggleServerRoles && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/60 p-4 sm:p-5 backdrop-blur-md shadow-sm">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">{t('teams.serverRolesTitle')}</p>
            <p className="mt-1 text-xs text-on-surface-variant leading-relaxed max-w-xl">
              {t('teams.serverRolesHint')}
            </p>
          </div>
          <Switch
            checked={team.server_roles_active ?? false}
            disabled={busy}
            onCheckedChange={onToggleServerRoles}
            aria-label={t('teams.serverRolesTitle')}
          />
        </div>
      )}

      {/* Keine Server zuweisbar */}
      {assignable.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/50 p-8 text-center text-sm text-on-surface-variant bg-surface-container-low/30">
          <Server className="h-8 w-8 mx-auto mb-2 text-on-surface-variant/60" aria-hidden="true" />
          <p>{t('teams.noAssignableServers')}</p>
        </div>
      ) : team.server_roles_active ? (
        /* Rollenbasierter Modus: Kompakter Read-Only-Überblick je Server */
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-xs sm:text-sm text-on-surface-variant">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">{t('teams.serverRollenHinweis')}</p>
            </div>
            {canManageRoles && onOpenRoleInRolesTab && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onOpenRoleInRolesTab(null)}
              >
                {t('teams.openInRolesTab')}
                <ArrowUpRight className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
              </Button>
            )}
          </div>

          {rollen.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-outline-variant/50 p-8 text-center text-sm text-on-surface-variant bg-surface-container-low/30">
              {t('teams.keineRollenFuerServer')}
            </div>
          ) : (
            <div className={serverGridClass}>
              {assignable.map((server) => {
                const activeRoleGrants = rollen
                  .map((r) => ({
                    role: r,
                    keys: r.server_grants?.find((g) => g.server_id === server.server_id)?.permission_keys ?? [],
                  }))
                  .filter((entry) => entry.keys.length > 0)

                const expandedRoleId = expandedByServer[server.server_id] ?? null
                const expandedEntry =
                  expandedRoleId !== null
                    ? activeRoleGrants.find((entry) => entry.role.id === expandedRoleId) ?? null
                    : null

                return (
                  <article
                    key={server.server_id}
                    className="overflow-hidden rounded-2xl border border-outline-variant/35 bg-surface-container-low/60 backdrop-blur-md shadow-sm"
                  >
                    {/* Kompakter Server-Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 bg-surface-container-high/35 px-4 py-3 sm:px-5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25 shadow-sm">
                          <Server className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-headline text-sm sm:text-base font-bold text-on-surface truncate">
                            {server.server_name}
                          </h4>
                          <p className="text-xs text-on-surface-variant font-mono">
                            ID #{server.server_id}
                          </p>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high border border-outline-variant/30 px-3 py-1 text-xs font-medium text-on-surface-variant">
                        <Shield className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>
                          {t('teams.rolesAssignedCount', { count: activeRoleGrants.length })}
                        </span>
                      </span>
                    </div>

                    {/* Zugewiesene Rollen als kompakte, klickbare Pills (standardmäßig eingeklappt) */}
                    <div className="p-4 sm:p-5 space-y-3">
                      {activeRoleGrants.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {activeRoleGrants.map(({ role, keys }) => {
                            const isExpanded = expandedEntry?.role.id === role.id
                            return (
                              <button
                                key={role.id}
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => toggleRoleInspection(server.server_id, role.id)}
                                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all border ${
                                  isExpanded
                                    ? 'border-primary bg-primary/15 text-primary font-semibold shadow-sm'
                                    : 'border-outline-variant/35 bg-surface-container-low/80 text-on-surface-variant hover:border-primary/45 hover:text-on-surface'
                                }`}
                              >
                                <RoleBadge
                                  name={role.name}
                                  color={role.color}
                                  icon={role.icon}
                                  size="sm"
                                />
                                <span className="text-label-sm opacity-85">
                                  {t('teams.roleGrantCount', { count: keys.length })}
                                </span>
                                <ChevronDown
                                  className={`h-3.5 w-3.5 transition-transform ${
                                    isExpanded ? 'rotate-180 text-primary' : 'opacity-65'
                                  }`}
                                  aria-hidden="true"
                                />
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-on-surface-variant/80">
                          {t('teams.noRoleGrantsForServerOverview')}
                        </p>
                      )}

                      {/* Aufgeklappte Schreibgeschützt-Ansicht der gewählten Rolle */}
                      {expandedEntry && (
                        <div className="rounded-xl border border-outline-variant/30 bg-surface-container/50 p-3.5 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 pb-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <RoleBadge
                                name={expandedEntry.role.name}
                                color={expandedEntry.role.color}
                                icon={expandedEntry.role.icon}
                                size="sm"
                              />
                              <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
                                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                                {t('teams.rolePermissionsReadOnlyHint')}
                              </span>
                            </div>

                            {canManageRoles && onOpenRoleInRolesTab && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-primary"
                                onClick={() => onOpenRoleInRolesTab(expandedEntry.role)}
                              >
                                {t('teams.editRoleInRolesTab')}
                                <ArrowUpRight className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
                              </Button>
                            )}
                          </div>

                          <div
                            className="flex flex-wrap gap-1.5"
                            aria-label={`${t('teams.permissions')}: ${server.server_name} (${expandedEntry.role.name})`}
                          >
                            {expandedEntry.keys.map((key) => (
                              <span
                                key={key}
                                className="inline-flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/70 px-2.5 py-1 text-xs font-medium text-on-surface"
                              >
                                {t(`permissionDetails.${key.replace(/\./g, '_')}.title`, { defaultValue: key })}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Standard-Modus: Teamweite globale Serverrechte unabhängig von Rollen */
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50 p-3.5 text-xs text-on-surface-variant">
            <Info className="h-4 w-4 text-on-surface-variant shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">
              {t('teams.globalServerGrantsNotice')}
            </p>
          </div>
          <div className={serverGridClass}>
            {assignable.map((server) => {
              const current = team.servers.find((item) => item.server_id === server.server_id)
              return (
                <TeamServerCard
                  key={server.server_id}
                  server={server}
                  assignedKeys={current?.permission_keys ?? []}
                  onChangeKeys={(keys) => onSetServerKeys(server.server_id, keys)}
                  disabled={busy}
                  onSyncToAllServers={
                    assignable.length > 1 && onSyncServerKeysToAll
                      ? () => onSyncServerKeysToAll(server.server_id, current?.permission_keys ?? [])
                      : undefined
                  }
                />
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
