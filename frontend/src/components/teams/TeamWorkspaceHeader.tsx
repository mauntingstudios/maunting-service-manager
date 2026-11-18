import { ArrowLeft, Crown, LogOut, Pencil, Server, ShieldCheck, Trash2, Users, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, TabBar, type TabDef } from '@maunting/ui'

import type { TeamDetail } from '@/api/teams'
import type { TeamPreviewAccess } from '@/stores/rolePreviewStore'
import { TEAM_CATEGORIES, type TeamMetadata } from './teamMeta'

export type TeamWorkspaceTab = 'members' | 'servers' | 'roles' | 'vault'

function TeamActionsButtons({
  team,
  access,
  busy,
  onEditTeam,
  onRemoveTeam,
  onLeaveTeam,
}: {
  team: TeamDetail | null
  access: TeamPreviewAccess | null
  busy: boolean
  onEditTeam: () => void
  onRemoveTeam: (team: TeamDetail) => void
  onLeaveTeam: (team: TeamDetail) => void
}) {
  const { t } = useTranslation()
  if (!team || !access) return null

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {access.isFounder ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onEditTeam}
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
            onClick={() => onRemoveTeam(team)}
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
          onClick={() => onLeaveTeam(team)}
          aria-label={t('teams.leave')}
          className="h-9 w-9 p-0 rounded-full bg-surface-container-high/70 hover:bg-status-destructive/15 text-status-destructive border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

function TeamTabStrip({
  tabs,
  activeTab,
  onSelectTab,
}: {
  tabs: TabDef<TeamWorkspaceTab>[]
  activeTab: TeamWorkspaceTab
  onSelectTab: (tab: TeamWorkspaceTab) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex w-full max-w-4xl justify-center">
      <TabBar
        tabs={tabs}
        active={activeTab}
        onChange={onSelectTab}
        ariaLabel={t('teams.sections')}
        embedded
        className="w-full sm:w-auto flex flex-wrap justify-center gap-1 sm:gap-2 p-1 sm:p-1.5 rounded-2xl bg-surface-container-high/60 backdrop-blur-xl border border-outline-variant/30 shadow-sm"
      />
    </div>
  )
}

/** Kompakte Kopfzeile für den Team-Tresor-Reiter, damit maximale Fläche für den Tresor bleibt. */
export function TeamVaultHeader({
  team,
  access,
  activeMeta,
  busy,
  tabs,
  activeTab,
  onBackToOverview,
  onSelectTab,
  onEditTeam,
  onRemoveTeam,
  onLeaveTeam,
}: {
  team: TeamDetail | null
  access: TeamPreviewAccess | null
  activeMeta: TeamMetadata | null
  busy: boolean
  tabs: TabDef<TeamWorkspaceTab>[]
  activeTab: TeamWorkspaceTab
  onBackToOverview: () => void
  onSelectTab: (tab: TeamWorkspaceTab) => void
  onEditTeam: () => void
  onRemoveTeam: (team: TeamDetail) => void
  onLeaveTeam: (team: TeamDetail) => void
}) {
  const { t } = useTranslation()

  return (
    <header className="shrink-0 border-b border-outline-variant/30 bg-surface/90 backdrop-blur-xl px-4 py-3 sm:px-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBackToOverview}
            aria-label={t('teams.backToOverview', 'Zurück zur Übersicht')}
            className="gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-full px-3 py-1.5 transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline text-xs sm:text-sm font-medium">
              {t('teams.backToOverview', 'Zurück zur Übersicht')}
            </span>
          </Button>
          {team && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container">
                {activeMeta?.coverImage ? (
                  <img src={activeMeta.coverImage} alt={team.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-primary/10 text-primary">
                    <UsersRound className="h-4 w-4" aria-hidden="true" />
                  </div>
                )}
              </div>
              <h1 className="font-headline text-base sm:text-lg font-bold truncate text-on-surface">
                {team.name}
              </h1>
            </div>
          )}
        </div>
        <TeamActionsButtons
          team={team}
          access={access}
          busy={busy}
          onEditTeam={onEditTeam}
          onRemoveTeam={onRemoveTeam}
          onLeaveTeam={onLeaveTeam}
        />
      </div>
      <TeamTabStrip tabs={tabs} activeTab={activeTab} onSelectTab={onSelectTab} />
    </header>
  )
}

/** Zentrierter Workspace-Hero inkl. klebriger Tab-Leiste für Mitglieder-, Server- und Rollen-Reiter. */
export function TeamWorkspaceHeroHeader({
  team,
  access,
  activeMeta,
  busy,
  tabs,
  activeTab,
  onBackToOverview,
  onSelectTab,
  onEditTeam,
  onRemoveTeam,
  onLeaveTeam,
}: {
  team: TeamDetail | null
  access: TeamPreviewAccess | null
  activeMeta: TeamMetadata | null
  busy: boolean
  tabs: TabDef<TeamWorkspaceTab>[]
  activeTab: TeamWorkspaceTab
  onBackToOverview: () => void
  onSelectTab: (tab: TeamWorkspaceTab) => void
  onEditTeam: () => void
  onRemoveTeam: (team: TeamDetail) => void
  onLeaveTeam: (team: TeamDetail) => void
}) {
  const { t } = useTranslation()
  const activeCat = activeMeta ? TEAM_CATEGORIES[activeMeta.category] : null

  return (
    <>
      <header className="relative z-10">
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 sm:px-6 sm:pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBackToOverview}
            aria-label={t('teams.backToOverview', 'Zurück zur Übersicht')}
            className="gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-full px-3 py-1.5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs sm:text-sm font-medium">
              {t('teams.backToOverview', 'Zurück zur Übersicht')}
            </span>
          </Button>

          <TeamActionsButtons
            team={team}
            access={access}
            busy={busy}
            onEditTeam={onEditTeam}
            onRemoveTeam={onRemoveTeam}
            onLeaveTeam={onLeaveTeam}
          />
        </div>

        <div className="relative px-3 pt-2 pb-4 text-center sm:px-6 sm:pt-3 sm:pb-5">
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
            <div className="group relative h-20 w-20 sm:h-24 sm:w-24 overflow-hidden rounded-3xl border-2 border-outline-variant/40 bg-surface-container shadow-2xl transition-transform hover:scale-105">
              {activeMeta?.coverImage ? (
                <img
                  src={activeMeta.coverImage}
                  alt={team?.name ?? ''}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center bg-primary/10 text-primary">
                  <UsersRound className="h-10 w-10 sm:h-11 sm:w-11" aria-hidden="true" />
                </div>
              )}
              {access?.isFounder && team && (
                <button
                  type="button"
                  onClick={onEditTeam}
                  className="absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  aria-label={t('teams.editTeam', 'Team bearbeiten')}
                >
                  <Pencil className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
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
              {access?.isFounder && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary border border-primary/25 shadow-sm backdrop-blur-md">
                  <Crown className="h-3.5 w-3.5" />
                  <span>{t('teams.founder')}</span>
                </span>
              )}
            </div>

            <div className="mt-2 flex items-center justify-center gap-2">
              <h1 className="font-headline text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface">
                {team?.name ?? t('teams.title')}
              </h1>
              {access?.isFounder && team && (
                <button
                  type="button"
                  onClick={onEditTeam}
                  aria-label={t('teams.editTeam', 'Team bearbeiten')}
                  className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high/60 transition-colors"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {activeMeta?.description && (
              <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-lg leading-relaxed">
                {activeMeta.description}
              </p>
            )}

            {team && (
              <div className="mt-3.5 grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">{team.members.length}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.members')}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-secondary/15 text-secondary border border-secondary/25">
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">{team.servers.length}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.tabServers')}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">{(team.roles || []).length}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.roles')}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/30 bg-surface-container/80 p-2.5 backdrop-blur-md shadow-sm">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-status-warning/15 text-status-warning border border-status-warning/25">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm sm:text-base font-bold leading-none text-on-surface">
                      {access?.canAccessVault !== false ? 'Aktiv' : 'Gesperrt'}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant font-medium">{t('teams.vault')}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="sticky top-0 z-20 border-y border-outline-variant/30 bg-surface/85 px-3 py-2.5 backdrop-blur-xl sm:px-6 sm:py-3">
        <TeamTabStrip tabs={tabs} activeTab={activeTab} onSelectTab={onSelectTab} />
      </div>
    </>
  )
}
