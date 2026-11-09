import { useTranslation } from 'react-i18next'
import { Info, Server } from 'lucide-react'
import type { TeamDetail, TeamServer } from '@/api/teams'
import { Dropdown, Switch } from '@maunting/ui'
import { TeamServerCard } from './TeamServerCard'

export interface TeamServerManagerProps {
  team: TeamDetail
  assignable: TeamServer[]
  busy: boolean
  onSetServerKeys: (serverId: number, keys: string[]) => void
  rollenWahl: Record<number, number | null>
  onRollenWahl: (serverId: number, roleId: number | null) => void
  onRoleKeys: (serverId: number, roleId: number, keys: string[]) => void
  onToggleServerRoles: (active: boolean) => void
}

/**
 * Moderner Server- und Berechtigungsmanager für Teams.
 *
 * Unterstützt sowohl teamweite Serverrechte als auch den rollenbasierten Modus
 * mit interaktiven Karten, 1-Klick Presets und klickbaren Chips.
 */
export function TeamServerManager({
  team,
  assignable,
  busy,
  onSetServerKeys,
  rollenWahl,
  onRollenWahl,
  onRoleKeys,
  onToggleServerRoles,
}: TeamServerManagerProps) {
  const { t } = useTranslation()
  const rollen = (team.roles || []).filter((r) => !r.is_admin)

  return (
    <section className="space-y-6 max-w-4xl" aria-labelledby="team-servers-heading">
      {/* Kopfbereich */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 id="team-servers-heading" className="font-headline text-lg sm:text-xl font-bold text-on-surface">
            {t('teams.servers')}
          </h3>
          <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-xl">
            {t('teams.serversHint')}
          </p>
        </div>
      </div>

      {/* Rollenmodus Umschalter für Teambesitzer */}
      {team.is_owner && (
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
        /* Rollenbasierter Modus */
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-xs sm:text-sm text-on-surface-variant">
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">{t('teams.serverRollenHinweis')}</p>
          </div>

          {rollen.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-outline-variant/50 p-8 text-center text-sm text-on-surface-variant bg-surface-container-low/30">
              {t('teams.keineRollenFuerServer')}
            </div>
          ) : (
            <div className="space-y-4">
              {assignable.map((server) => {
                const gewaehlt = rollen.find((r) => r.id === rollenWahl[server.server_id]) ?? null
                const grant = gewaehlt?.server_grants?.find((g) => g.server_id === server.server_id)

                return (
                  <div key={server.server_id} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-high/40 p-3 sm:px-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <Server className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                        <span className="font-semibold text-sm text-on-surface truncate">
                          {server.server_name}
                        </span>
                      </div>
                      <div className="w-60 max-w-full">
                        <Dropdown
                          value={gewaehlt ? String(gewaehlt.id) : null}
                          onChange={(val) => onRollenWahl(server.server_id, val ? Number(val) : null)}
                          options={rollen.map((r) => ({ value: String(r.id), label: r.name }))}
                          placeholder={t('teams.rolleWaehlen')}
                          disabled={busy}
                          aria-label={`${t('teams.roles')}: ${server.server_name}`}
                        />
                      </div>
                    </div>

                    {gewaehlt ? (
                      <TeamServerCard
                        server={server}
                        assignedKeys={grant?.permission_keys ?? []}
                        onChangeKeys={(keys) => onRoleKeys(server.server_id, gewaehlt.id, keys)}
                        disabled={busy}
                        roleName={gewaehlt.name}
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low/20 p-4 text-center text-xs text-on-surface-variant/70 italic">
                        Wähle oben eine Rolle, um die Rechte für diesen Server zu bearbeiten.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Standard-Modus: Teamweite Serverrechte */
        <div className="space-y-4">
          {assignable.map((server) => {
            const current = team.servers.find((item) => item.server_id === server.server_id)
            return (
              <TeamServerCard
                key={server.server_id}
                server={server}
                assignedKeys={current?.permission_keys ?? []}
                onChangeKeys={(keys) => onSetServerKeys(server.server_id, keys)}
                disabled={busy}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
