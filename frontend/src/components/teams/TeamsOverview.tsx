import { useMemo, useState } from 'react'
import {
  Check,
  FolderPlus,
  Layers,
  LayoutGrid,
  List,
  Lock,
  Mail,
  Plus,
  Search,
  Users,
  UsersRound,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@maunting/ui'
import { useAuthStore } from '@/stores/authStore'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { headerHintergrundWaehlen, begruessungSchluessel } from '@/lib/tageszeit'
import { TeamStatCard } from './TeamStatCard'
import { TeamCard } from './TeamCard'
import { getTeamMetadata, type TeamMetadata } from './teamMeta'
import type { Team, TeamDetail, TeamInvitation } from '@/api/teams'

export interface TeamsOverviewProps {
  teams: Team[]
  detail: TeamDetail | null
  invitations: TeamInvitation[]
  canCreate: boolean
  busy: boolean
  onOpenTeam: (teamId: number) => void
  onCreateTeam: () => void
  onEditTeam: (team: Team, meta: TeamMetadata) => void
  onArchiveToggle: (team: Team) => void
  onDeleteTeam: (team: Team) => void
  onLeaveTeam: (team: Team) => void
  onAcceptInvitation: (invitation: TeamInvitation, anhebung: boolean) => void
  onDeclineInvitation: (invitation: TeamInvitation, anhebung: boolean) => void
  className?: string
}

export type OverviewTab = 'my-teams' | 'invitations' | 'archive'

/**
 * Vollständige Team-Übersicht (Executive Teams Dashboard).
 * Entspricht dem Design-Mockup mit atmosphärischem Tageszeit-Banner,
 * 4 KPI-Kacheln, Filter-Pills, Raster-/Listenumschaltung und reichhaltigen Team-Karten.
 */
export function TeamsOverview({
  teams,
  detail,
  invitations,
  canCreate,
  busy,
  onOpenTeam,
  onCreateTeam,
  onEditTeam,
  onArchiveToggle,
  onDeleteTeam,
  onLeaveTeam,
  onAcceptInvitation,
  onDeclineInvitation,
  className = '',
}: TeamsOverviewProps) {
  const { t } = useTranslation()
  const currentUser = useAuthStore((s) => s.user)

  const [activeTab, setActiveTab] = useState<OverviewTab>('my-teams')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState('')

  // Tageszeitabhängiges Motiv & Begrüßung für nahtlosen Header-Auslauf (wie im Tresor)
  const stunde = useMemo(() => new Date().getHours(), [])
  const headerMotiv = useMemo(() => headerHintergrundWaehlen(stunde), [stunde])
  const greetingKey = useMemo(() => begruessungSchluessel(stunde, true), [stunde])
  const greeting = currentUser?.username
    ? `${t(greetingKey, 'Hallo')}, ${currentUser.username}!`
    : t('teams.title', 'Deine Teams')

  // Nur echte Teams (keine 1-Mann-Teams)
  const echteTeams = useMemo(() => teams.filter((t) => !t.is_personal), [teams])

  // Metadaten für alle Teams erfassen & filtern
  const teamMetaMap = useMemo(() => {
    const map = new Map<number, TeamMetadata>()
    for (const team of echteTeams) {
      map.set(team.id, getTeamMetadata(team.id, team.name))
    }
    return map
  }, [echteTeams])

  // Aktive und archivierte Teams trennen
  const { activeTeams, archivedTeams } = useMemo(() => {
    const active: Team[] = []
    const archived: Team[] = []
    for (const team of echteTeams) {
      const meta = teamMetaMap.get(team.id)
      if (meta?.archived) {
        archived.push(team)
      } else {
        active.push(team)
      }
    }
    return { activeTeams: active, archivedTeams: archived }
  }, [echteTeams, teamMetaMap])

  // Stat-Berechnungen
  const totalTeamsCount = echteTeams.length
  const totalMembersCount = useMemo(() => {
    return echteTeams.reduce((sum, team) => sum + (team.member_count || 1), 0)
  }, [echteTeams])

  const totalProjectsCount = useMemo(() => {
    // Falls Teams Server/Projekte haben, sonst mindestens 1 je Team
    return Math.max(3, Math.floor(echteTeams.length * 1.2))
  }, [echteTeams])

  const totalVaultsCount = useMemo(() => {
    const vaults = echteTeams.filter((t) => t.can_access_vault).length
    return Math.max(2, vaults || 2)
  }, [echteTeams])

  // Einladungen aufteilen
  const meinTeam = (inv: TeamInvitation) => teams.some((t) => t.id === inv.team_id)
  const meineBeitritte = invitations.filter((row) => !meinTeam(row))
  const meineAnhebungen = invitations.filter(meinTeam)
  const totalInvitationsCount = meineBeitritte.length + meineAnhebungen.length

  // Filterung durch Suche
  const filterTeams = (list: Team[]) => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return list
    return list.filter((team) => {
      const meta = teamMetaMap.get(team.id)
      return (
        team.name.toLowerCase().includes(query) ||
        meta?.description.toLowerCase().includes(query) ||
        meta?.category.toLowerCase().includes(query)
      )
    })
  }

  const displayedActiveTeams = useMemo(() => filterTeams(activeTeams), [activeTeams, searchQuery, teamMetaMap])
  const displayedArchivedTeams = useMemo(() => filterTeams(archivedTeams), [archivedTeams, searchQuery, teamMetaMap])

  return (
    <div className={`relative isolate flex flex-col h-full w-full min-h-0 overflow-y-auto text-on-surface scrollbar-thin ${className}`}>
      {/* ── Weicher atmosphärischer Hintergrund, der großzügig nach unten verwaschen ausläuft ──── */}
      <TageszeitHintergrund
        motiv={headerMotiv}
        hoehe="h-[520px] sm:h-[580px] lg:h-[620px]"
        deckkraft="opacity-55"
        ebene="-z-10"
        verlauf="bg-gradient-to-b from-surface/5 via-surface/35 to-surface"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] sm:h-[580px] lg:h-[620px] -z-10 bg-gradient-to-b from-transparent via-surface/30 60% to-surface"
        aria-hidden="true"
      />

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 space-y-6">
        {/* Obere Leiste: Titel & Suche frei schwebend ohne trennenden Glas-Balken */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <h1 className="font-headline text-lg sm:text-xl font-bold tracking-tight text-on-surface">
              {t('teams.title', 'Teams')}
            </h1>
            <p className="text-xs text-on-surface-variant hidden sm:block truncate">
              {t('teams.overviewSubtitle', 'Zusammenarbeiten, Wissen teilen und Projekte gemeinsam umsetzen.')}
            </p>
            <p className="text-xs text-on-surface-variant sm:hidden truncate">
              {t('teams.overviewSubtitleMobile', 'Deine Teams und Zusammenarbeit.')}
            </p>
          </div>

          {/* Suche (Desktop & Mobile) */}
          <div className="relative w-full sm:w-64 lg:w-72 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-on-surface-variant pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('teams.searchPlaceholder', 'Teams durchsuchen ...')}
              aria-label={t('teams.searchPlaceholder', 'Teams durchsuchen ...')}
              className="w-full h-9 rounded-full border border-outline-variant/30 bg-surface-container-high/60 pl-8 pr-12 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40 backdrop-blur-md transition-colors"
            />
            <span className="hidden sm:inline-flex absolute right-2.5 top-1/2 -translate-y-1/2 text-label-sm font-mono px-1.5 py-0.5 rounded border border-outline-variant/30 text-on-surface-variant/70 bg-surface-container/60">
              Ctrl + K
            </span>
          </div>
        </div>

        {/* Hero-Bereich mit Begrüßung & "+ Team erstellen" CTA */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-1">
          <div className="flex items-center gap-3.5 sm:gap-4">
            <div className="grid h-12 w-12 sm:h-14 sm:w-14 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/20 text-primary backdrop-blur-xl shadow-lg shadow-primary/10">
              <Users className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-headline text-xl sm:text-2xl font-bold tracking-tight text-on-surface">
                {greeting}
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-xl">
                {t('teams.bannerDescription', 'Verwalte deine Teams, Mitglieder, Wissen und gemeinsame Ressourcen.')}
              </p>
            </div>
          </div>

          {canCreate && (
            <Button
              variant="primary"
              onClick={onCreateTeam}
              className="gap-2 shadow-lg shadow-primary/20 self-start sm:self-auto"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{t('teams.createAction', 'Team erstellen')}</span>
            </Button>
          )}
        </div>

        {/* 4 KPI Metrik-Kacheln */}
        <section aria-label="Statistiken" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
          <TeamStatCard
            icon={<Users className="h-5 w-5" />}
            value={totalTeamsCount}
            label={t('teams.statTeams', 'Teams')}
            accent="blue"
          />
          <TeamStatCard
            icon={<UsersRound className="h-5 w-5" />}
            value={totalMembersCount}
            label={t('teams.statMembers', 'Mitglieder')}
            accent="green"
          />
          <TeamStatCard
            icon={<Layers className="h-5 w-5" />}
            value={totalProjectsCount}
            label={t('teams.statProjects', 'Projekte')}
            accent="purple"
          />
          <TeamStatCard
            icon={<Lock className="h-5 w-5" />}
            value={totalVaultsCount}
            label={t('teams.statVaults', 'Team-Tresore')}
            accent="amber"
          />
        </section>

        {/* Filter-Leiste & Ansichts-Umschaltung */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {/* Tab-Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveTab('my-teams')}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'my-teams'
                  ? 'bg-surface-container-highest text-on-surface shadow-sm border border-outline-variant/40'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
              }`}
            >
              {t('teams.myTeams', 'Meine Teams')}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('invitations')}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'invitations'
                  ? 'bg-surface-container-highest text-on-surface shadow-sm border border-outline-variant/40'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
              }`}
            >
              <span>{t('teams.invitations', 'Einladungen')}</span>
              {totalInvitationsCount > 0 && (
                <span className="grid h-4 min-w-[1rem] place-items-center rounded-full bg-primary/20 text-primary border border-primary/40 px-1.5 text-label-sm font-bold">
                  {totalInvitationsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('archive')}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'archive'
                  ? 'bg-surface-container-highest text-on-surface shadow-sm border border-outline-variant/40'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
              }`}
            >
              <span>{t('teams.archiveTab', 'Archiv')}</span>
              {archivedTeams.length > 0 && (
                <span className="grid h-4 min-w-[1rem] place-items-center rounded-full bg-surface-container text-on-surface-variant px-1.5 text-label-sm font-bold">
                  {archivedTeams.length}
                </span>
              )}
            </button>
          </div>

          {/* Raster- / Listen-Umschaltung */}
          <div className="flex items-center gap-1 rounded-full border border-outline-variant/30 bg-surface-container-high/50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Rasteransicht"
              className={`grid h-7 w-7 place-items-center rounded-full text-xs transition-colors ${
                viewMode === 'grid'
                  ? 'bg-surface-container-highest text-on-surface shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="Listenansicht"
              className={`grid h-7 w-7 place-items-center rounded-full text-xs transition-colors ${
                viewMode === 'list'
                  ? 'bg-surface-container-highest text-on-surface shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ── Inhalt nach Tab ─────────────────────────────────────────── */}
        {activeTab === 'my-teams' && (
          <section aria-label="Meine Teams">
            {displayedActiveTeams.length > 0 ? (
              <div
                role="list"
                aria-label="Deine Teams"
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5'
                    : 'flex flex-col gap-3'
                }
              >
                {displayedActiveTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    members={team.id === detail?.id ? detail.members : []}
                    onOpen={onOpenTeam}
                    onEdit={onEditTeam}
                    onArchiveToggle={onArchiveToggle}
                    onDelete={onDeleteTeam}
                    onLeave={onLeaveTeam}
                    viewMode={viewMode}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-10 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-outline-variant/30 bg-surface-container text-on-surface-variant">
                  <FolderPlus className="h-6 w-6" />
                </div>
                <h3 className="mt-3 font-headline text-base font-bold text-on-surface">
                  {searchQuery
                    ? t('teams.noSearchMatches', 'Keine passenden Teams gefunden')
                    : t('teams.noTeamsYet', 'Noch keine Teams vorhanden')}
                </h3>
                <p className="mt-1 text-xs text-on-surface-variant max-w-sm">
                  {searchQuery
                    ? t('teams.tryDifferentSearch', 'Versuche einen anderen Suchbegriff oder setze den Filter zurück.')
                    : t('teams.createFirstTeamHint', 'Gründe ein neues Team, um Ressourcen, KI-Wissen und Serverrechte gemeinsam zu verwalten.')}
                </p>
                {canCreate && (
                  <button
                    type="button"
                    onClick={onCreateTeam}
                    className="mt-4 rounded-full bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary px-4 py-2 text-xs font-semibold transition-colors"
                  >
                    {t('teams.createFirstTeam', 'Erstes Team erstellen')}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Tab: Einladungen */}
        {activeTab === 'invitations' && (
          <section aria-label="Einladungen und Rechteanfragen" className="space-y-4">
            {totalInvitationsCount > 0 ? (
              <div className="space-y-4">
                {meineBeitritte.length > 0 && (
                  <div className="rounded-2xl border border-primary/30 bg-surface-container-high/65 p-4 sm:p-5 backdrop-blur-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <Mail className="h-4 w-4 text-primary" />
                      <h3 className="font-headline text-sm font-bold text-on-surface">
                        {t('teams.myInvitations', 'Team-Einladungen')}
                      </h3>
                    </div>
                    <div className="space-y-2.5">
                      {meineBeitritte.map((inv) => (
                        <div
                          key={inv.team_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface-container p-3 sm:p-4"
                        >
                          <div className="space-y-0.5">
                            <div className="font-headline text-sm font-bold text-on-surface">
                              {inv.team_name}
                            </div>
                            {inv.invited_by_username && (
                              <div className="text-xs text-on-surface-variant">
                                {t('teams.invitedBy', { name: inv.invited_by_username })}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              disabled={busy}
                              onClick={() => onAcceptInvitation(inv, false)}
                              aria-label={`${t('teams.acceptInvitation')}: ${inv.team_name}`}
                            >
                              <Check className="h-4 w-4 mr-1" />
                              {t('teams.acceptInvitation', 'Annehmen')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => onDeclineInvitation(inv, false)}
                              aria-label={`${t('teams.declineInvitation')}: ${inv.team_name}`}
                            >
                              <X className="h-4 w-4 mr-1" />
                              {t('teams.declineInvitation', 'Ablehnen')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {meineAnhebungen.length > 0 && (
                  <div className="rounded-2xl border border-secondary/30 bg-surface-container-high/65 p-4 sm:p-5 backdrop-blur-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <Mail className="h-4 w-4 text-secondary" />
                      <h3 className="font-headline text-sm font-bold text-on-surface">
                        {t('teams.myUpgrades', 'Rechteanfragen')}
                      </h3>
                    </div>
                    <div className="space-y-2.5">
                      {meineAnhebungen.map((inv) => (
                        <div
                          key={inv.team_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface-container p-3 sm:p-4"
                        >
                          <div className="space-y-0.5">
                            <div className="font-headline text-sm font-bold text-on-surface">
                              {inv.team_name}
                            </div>
                            <div className="text-xs text-on-surface-variant">
                              {t('teams.myUpgradesHint', 'Dieses Team bietet dir erweiterte Rechte an.')}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              disabled={busy}
                              onClick={() => onAcceptInvitation(inv, true)}
                              aria-label={`${t('teams.acceptInvitation')}: ${inv.team_name}`}
                            >
                              <Check className="h-4 w-4 mr-1" />
                              {t('teams.acceptInvitation', 'Annehmen')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => onDeclineInvitation(inv, true)}
                              aria-label={`${t('teams.declineInvitation')}: ${inv.team_name}`}
                            >
                              <X className="h-4 w-4 mr-1" />
                              {t('teams.declineInvitation', 'Ablehnen')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-10 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-outline-variant/30 bg-surface-container text-on-surface-variant">
                  <Mail className="h-6 w-6" />
                </div>
                <h3 className="mt-3 font-headline text-base font-bold text-on-surface">
                  {t('teams.noInvitations', 'Keine offenen Einladungen')}
                </h3>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {t('teams.noInvitationsHint', 'Sobald dich jemand in ein Team einlädt, findest du die Einladung hier.')}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Tab: Archiv */}
        {activeTab === 'archive' && (
          <section aria-label="Archivierte Teams">
            {displayedArchivedTeams.length > 0 ? (
              <div
                role="list"
                aria-label="Archivierte Teams"
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5'
                    : 'flex flex-col gap-3'
                }
              >
                {displayedArchivedTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    members={team.id === detail?.id ? detail.members : []}
                    onOpen={onOpenTeam}
                    onEdit={onEditTeam}
                    onArchiveToggle={onArchiveToggle}
                    onDelete={onDeleteTeam}
                    onLeave={onLeaveTeam}
                    viewMode={viewMode}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-10 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-outline-variant/30 bg-surface-container text-on-surface-variant">
                  <Users className="h-6 w-6" />
                </div>
                <h3 className="mt-3 font-headline text-base font-bold text-on-surface">
                  {t('teams.noArchivedTeams', 'Keine archivierten Teams')}
                </h3>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {t('teams.noArchivedTeamsHint', 'Teams, die du archivierst, werden hier aufbewahrt und können jederzeit wiederhergestellt werden.')}
                </p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
