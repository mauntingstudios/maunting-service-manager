import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useOutletContext } from 'react-router-dom'
import type { ShellOutletKontext } from '@/components/layout/Shell'
import { api } from '@/api/client'
import { Server, GameInfo, NodeCapacitySummary } from '@/types'
import { UpdateBanner } from '@/components/UpdateBanner'
import { useHasPermission } from '@/hooks/useHasPermission'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { filterVisibleServersInPreview, useRolePreviewStore } from '@/stores/rolePreviewStore'
import { sortServersByPriority, useServerPreferencesStore } from '@/stores/serverPreferencesStore'
import { sortNodesByPriority, useNodePreferencesStore } from '@/stores/nodePreferencesStore'
import { FavoriteButton, FAVORITE_CARD_HIGHLIGHT_CLASS } from '@/components/FavoriteButton'
import {
  Server as ServerIcon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Network,
  ArrowRight,
  ChevronDown,
  Gamepad2,
} from 'lucide-react'
import { ServerCard } from '@/components/server/ServerCard'
import {
  NodeStatusBlocks,
  ServerStatusBlocks,
  ServerStatusIcon,
  useLazySlice,
} from '@/components/server/ServerStatusBlocks'
import {
  NodeCapacityDetailsButton,
  NodeResourceRings,
  type NodeResourceMetrics,
} from '@/components/nodes/NodeResourceRings'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { begruessungSchluessel, tagesSeed, useTageszeitMotiv } from '@/lib/tageszeit'
import { Ankerfenster, Badge, Button, buttonClasses, Kurzinfo, Spinner } from '@maunting/ui'

interface ServiceStatus {
  status: 'ok' | 'degraded' | 'error'
  detail: string
}

interface HealthResponse {
  overall: 'ok' | 'degraded' | 'error'
  services: {
    docker: ServiceStatus
    caddy: ServiceStatus
    database: ServiceStatus
  }
  checked_in_ms: number
}

function ServiceDot({ status }: { status: 'ok' | 'degraded' | 'error' }) {
  if (status === 'ok') return <span className="inline-block w-2 h-2 rounded-full bg-status-success shrink-0" />
  if (status === 'degraded') return <span className="inline-block w-2 h-2 rounded-full bg-status-warning shrink-0" />
  return <span className="inline-block w-2 h-2 rounded-full bg-status-destructive shrink-0" />
}

function NodeCapacityCard() {
  const { t } = useTranslation()
  const canViewNodes = useHasPermission('nodes.read')
  const { favoriteIds: nodeFavoriteIds, toggleFavorite: toggleNodeFavorite } =
    useNodePreferencesStore()
  const [summary, setSummary] = useState<NodeCapacitySummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!canViewNodes) return
    setLoading(true)
    api<NodeCapacitySummary>('/nodes/capacity-summary?limit=25')
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [canViewNodes])

  const items = summary?.items ?? []
  const sortedItems = useMemo(
    () => sortNodesByPriority(items, nodeFavoriteIds),
    [items, nodeFavoriteIds],
  )
  const visibleItems = useMemo(() => {
    const favoriteSet = new Set(nodeFavoriteIds)
    const favoriteCount = sortedItems.filter((item) => favoriteSet.has(item.id)).length
    return sortedItems.slice(0, Math.max(5, favoriteCount))
  }, [sortedItems, nodeFavoriteIds])

  if (!canViewNodes) return null

  return (
    <section
      className="msm-card rounded-2xl border border-outline bg-surface-container-low/80 backdrop-blur-xl px-4 py-3.5 sm:px-5 sm:py-4 space-y-4"
      data-testid="dashboard-node-capacity"
      aria-label={t('dashboard.nodeCapacity')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-headline text-sm font-semibold text-on-surface uppercase tracking-wider">
              {t('dashboard.nodeCapacity')}
            </h2>
            {summary && (
              <span className="rounded-full border border-outline-variant/40 bg-surface-container-high/60 px-2 py-0.5 text-xs font-medium text-on-surface-variant tabular-nums">
                {t('nodes.capacitySubtitle', {
                  online: summary.online,
                  total: summary.total,
                })}
              </span>
            )}
            {sortedItems.length > 0 && (
              <NodeStatusBlocks nodes={sortedItems} testIdPrefix="dashboard-node-block" />
            )}
          </div>
          {!summary && (
            <p className="mt-0.5 font-body-md text-xs text-on-surface-variant">
              {t('dashboard.nodeCapacityHint')}
            </p>
          )}
        </div>

        <Link
          to="/admin/nodes"
          className="inline-flex min-h-[44px] md:min-h-[32px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-surface-container-high/60 transition-colors"
        >
          <span>{t('dashboard.manageNodes')}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-3 text-on-surface-variant">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex items-center gap-2 py-2 text-sm text-on-surface-variant">
          <Network className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('nodes.capacityEmpty')}</span>
        </div>
      )}

      {!loading && visibleItems.length > 0 && (
        <ul className="space-y-2.5">
          {visibleItems.map((item) => {
            const metrics: NodeResourceMetrics = {
              nodeId: item.id,
              nodeName: item.name,
              cpuPercent: item.cpu_percent ?? null,
              cpuCores: item.cpu_total ?? null,
              cpuModel: item.cpu_model ?? null,
              ramTotalMb: item.ram_total_mb ?? null,
              ramUsedMb: item.ram_used_mb ?? null,
              ramAllocatedMb: item.ram_allocated_mb ?? null,
              ramAllocatableMb: item.ram_allocatable_mb ?? null,
              diskTotalMb: item.disk_total_mb ?? null,
              diskUsedMb: item.disk_used_mb ?? null,
              diskPanelUsedMb: item.disk_panel_used_mb ?? null,
              diskAllocatedGb: item.disk_allocated_gb ?? null,
              diskAllocatableGb: item.disk_allocatable_gb ?? null,
            }
            const isOnline = item.status === 'online'
            const isOffline = item.status === 'offline'
            const isFavorite = nodeFavoriteIds.includes(item.id)

            return (
              <li
                key={item.id}
                data-testid={`dashboard-node-item-${item.id}`}
                data-favorite={isFavorite ? 'true' : 'false'}
                className={`min-w-0 rounded-xl border px-3 py-3 space-y-3 transition-[border-color,background-color,box-shadow] duration-200 ${
                  isFavorite
                    ? `${FAVORITE_CARD_HIGHLIGHT_CLASS} bg-surface-container/60`
                    : 'border-outline/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap min-w-0 items-center gap-2">
                    <ServerStatusIcon
                      status={item.status}
                      kind="node"
                      size="sm"
                      favorite={isFavorite}
                      data-testid={`dashboard-node-icon-${item.id}`}
                    />
                    <span className="truncate font-headline text-sm font-semibold text-on-surface">
                      {item.name}
                    </span>
                    <Badge
                      variant={
                        isOnline ? 'success' : isOffline ? 'destructive' : 'default'
                      }
                    >
                      {t(`nodes.status.${item.status}`, { defaultValue: item.status })}
                    </Badge>
                    <span className="text-xs text-on-surface-variant">
                      {t('nodes.serverCount', { count: item.server_count })}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <FavoriteButton
                      isFavorite={isFavorite}
                      onToggle={() => toggleNodeFavorite(item.id)}
                      tooltipText={
                        isFavorite ? t('nodes.unfavoriteAction') : t('nodes.favoriteAction')
                      }
                      ariaLabel={
                        isFavorite
                          ? t('nodes.unfavoriteNode', { name: item.name })
                          : t('nodes.favoriteNode', { name: item.name })
                      }
                      tooltipSide="mitte"
                      testId={`dashboard-node-favorite-${item.id}`}
                    />
                    <NodeCapacityDetailsButton metrics={metrics} testIdPrefix="dashboard-node" />
                  </div>
                </div>

                <NodeResourceRings metrics={metrics} testIdPrefix="dashboard-node" />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function SystemStatusSection({ showDetails = true }: { showDetails?: boolean }) {
  const { t } = useTranslation()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<HealthResponse>('/system/health')
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setLoading(false))
  }, [])

  const serviceNames: Record<string, string> = {
    docker: t('dashboard.systemServices.docker'),
    caddy: t('dashboard.systemServices.caddy'),
    database: t('dashboard.systemServices.database'),
  }

  const overallLabel = loading
    ? t('dashboard.systemChecking')
    : health === null
      ? t('dashboard.statusError')
      : health.overall === 'ok'
        ? t('dashboard.allSystemsOperational')
        : health.overall === 'degraded'
          ? t('dashboard.systemDegraded')
          : t('dashboard.systemError')

  const overallColor = loading || health === null
    ? 'text-on-surface-variant'
    : health.overall === 'ok'
      ? 'text-status-success'
      : health.overall === 'degraded'
        ? 'text-status-warning'
        : 'text-status-destructive'

  const OverallIcon = loading
    ? Loader2
    : health === null || health.overall === 'error'
      ? XCircle
      : health.overall === 'degraded'
        ? AlertTriangle
        : CheckCircle2

  const services = health?.services
    ? Object.entries(health.services).filter(
        ([key, svc]) => !(key === 'caddy' && svc.status === 'degraded'),
      )
    : []

  return (
    <div className="p-4 sm:p-5 flex flex-col justify-between gap-3 min-w-0">
      <div>
        <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
          {t('dashboard.system')}
        </p>
        <div className="mt-2 flex items-center gap-2 min-w-0">
          <OverallIcon className={`w-4 h-4 shrink-0 ${overallColor} ${loading ? 'animate-spin' : ''}`} />
          <span className={`font-headline text-sm font-semibold truncate ${overallColor}`}>
            {overallLabel}
          </span>
        </div>
      </div>

      {services.length > 0 && (
        <div className="space-y-1.5">
          {services.map(([key, svc]) => (
            <div key={key} className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <ServiceDot status={svc.status} />
                <span className="font-body-md text-xs text-on-surface-variant truncate">
                  {serviceNames[key] ?? key}
                </span>
              </div>
              {showDetails && svc.detail && (
                <Kurzinfo text={svc.detail} seite="ende" aussen="min-w-0 max-w-[140px]">
                  <span className="font-mono-sm text-xs text-on-surface-variant/70 truncate max-w-[140px]">
                    {svc.detail}
                  </span>
                </Kurzinfo>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && !health && (
        <p className="font-body-md text-xs text-status-destructive/80">
          {t('dashboard.systemError')}
        </p>
      )}
    </div>
  )
}

export function Dashboard({ ohneHintergrund = false }: { ohneHintergrund?: boolean } = {}) {
  const huelle = useOutletContext<ShellOutletKontext | null>()
  // Die Hülle trägt das Bild auf Dashboard-Routen; die Prop bleibt für die
  // MSS-App, die dieselbe Seite einbettet.
  const ohneEigenenHintergrund = ohneHintergrund || huelle?.ohneHintergrund === true
  const { t } = useTranslation()
  const canCreateServer = useHasPermission('servers.create')
  const canReadSettings = useHasPermission('panel.settings.read')
  const canManageBlueprints = useHasPermission('blueprints.manage')
  const canReadNodes = useHasPermission('nodes.read')
  const canReadHoster = useHasPermission('panel.hoster.read')
  const canReadShop = useHasPermission('shop.read')
  const canViewSystem = useHasPermission('system.view')
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const canViewOperatorInfo =
    canCreateServer ||
    canReadSettings ||
    canManageBlueprints ||
    canReadNodes ||
    canReadHoster ||
    canReadShop
  const [servers, setServers] = useState<Server[]>([])
  const [games, setGames] = useState<GameInfo[]>([])
  const [loading, setLoading] = useState(true)
  // Ohne dieses Flag wird aus einem fehlgeschlagenen Laden die Aussage
  // "Noch keine Server" — auf der ersten Seite nach dem Login.
  const [loadError, setLoadError] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)
  const gamesTriggerRef = useRef<HTMLButtonElement>(null)
  const gamesPopoverId = useId()

  useEffect(() => {
    Promise.all([
      api<Server[]>('/servers'),
      canViewOperatorInfo ? api<GameInfo[]>('/system/games') : Promise.resolve([] as GameInfo[]),
    ])
      .then(([srvs, gms]) => {
        setServers(srvs)
        setGames(gms)
        setLoadError(false)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [canViewOperatorInfo])

  const user = useAuthStore((state) => state.user)
  const stunde = useMemo(() => new Date().getHours(), [])
  const headerMotiv = useTageszeitMotiv('dashboard')
  const tagesZaehler = useMemo(() => tagesSeed(), [])
  const begruessung = user?.username
    ? t(begruessungSchluessel(stunde, false, tagesZaehler), { name: user.username })
    : t('common.begruessung.ohneName')

  const preview = useRolePreviewStore((s) => s.preview)
  const visibleServers = useMemo(
    () => filterVisibleServersInPreview(servers, preview),
    [servers, preview],
  )
  const runningCount = visibleServers.filter((s) => s.status === 'running').length
  const stoppedCount = Math.max(0, visibleServers.length - runningCount)
  const { favoriteIds, lastVisitedId } = useServerPreferencesStore()
  const sortedServers = useMemo(
    () => sortServersByPriority(visibleServers, favoriteIds, lastVisitedId),
    [visibleServers, favoriteIds, lastVisitedId],
  )
  const {
    visibleItems: visibleSortedServers,
    hasMore: hasMoreDashboardServers,
    remaining: remainingDashboardServers,
    loadMore: loadMoreDashboardServers,
    sentinelRef: dashboardServersSentinelRef,
  } = useLazySlice(sortedServers, 24)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="md" className="text-secondary" />
      </div>
    )
  }

  return (
    <div className="relative isolate flex flex-col h-full w-full min-h-0 overflow-y-auto text-on-surface scrollbar-thin">
      {!ohneEigenenHintergrund && (
        <TageszeitHintergrund
          motiv={headerMotiv}
          hoehe="h-[520px] sm:h-[580px] lg:h-[640px]"
          deckkraft="opacity-55"
          ebene="-z-10"
        />
      )}

      <main
        className={`relative z-10 mx-auto w-full max-w-7xl 2xl:max-w-[1600px] px-3.5 ${
          ohneEigenenHintergrund ? 'pt-2 sm:pt-3' : 'pt-4 sm:pt-6'
        } pb-12 sm:px-6 lg:px-8 space-y-6`}
      >
        <UpdateBanner />

        {/* Freischwebender Dashboard-Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <ServerIcon className="h-4 w-4" aria-hidden="true" />
              <span>{t('dashboard.title')}</span>
            </div>
            <h1 className="mt-1 font-headline text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface">
              {begruessung}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
              {t('dashboard.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md shadow-sm ${
                runningCount > 0
                  ? 'bg-status-success/15 border-status-success/30 text-status-success'
                  : 'bg-surface-container-high/80 border-outline-variant/30 text-on-surface-variant'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  runningCount > 0 ? 'bg-status-success animate-pulse' : 'bg-on-surface-variant/50'
                }`}
              />
              {runningCount} {t('dashboard.running')}
            </span>
          </div>
        </div>

        {/* Einheitliches Übersichts-Deck (Server, Unterstützte Spiele für Operatoren, Systemstatus) */}
        <section
          aria-label={t('dashboard.title')}
          className="msm-card rounded-2xl border border-outline bg-surface-container-low/80 backdrop-blur-xl"
        >
          <div
            className={`grid grid-cols-1 ${canViewOperatorInfo ? 'md:grid-cols-3' : 'md:grid-cols-2'} divide-y md:divide-y-0 md:divide-x divide-outline/40`}
          >
            {/* Tile 1: Server-Bestand */}
            <div className="p-4 sm:p-5 flex flex-col justify-between gap-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                  {t('dashboard.servers')}
                </p>
                <Link
                  to="/servers"
                  className="inline-flex min-h-[44px] md:min-h-[28px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-surface-container-high/60 transition-colors"
                >
                  <span>{t('dashboard.viewAllServers')}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>

              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="font-headline text-display-sm font-bold text-primary tabular-nums">
                  {visibleServers.length}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1.5 font-body-md text-xs px-2.5 py-0.5 rounded-full border ${
                      runningCount > 0
                        ? 'bg-status-success/10 border-status-success/30 text-status-success'
                        : 'bg-surface-container-highest border-outline text-on-surface-variant'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        runningCount > 0 ? 'bg-status-success animate-pulse' : 'bg-on-surface-variant/50'
                      }`}
                    />
                    {runningCount} {t('dashboard.running')}
                  </span>
                  {visibleServers.length > 0 && stoppedCount > 0 && (
                    <span className="font-body-md text-xs px-2.5 py-0.5 rounded-full border border-outline/70 bg-surface-container-highest/60 text-on-surface-variant">
                      {t('dashboard.stoppedCount', { count: stoppedCount })}
                    </span>
                  )}
                </div>
              </div>

              <ServerStatusBlocks
                servers={sortedServers}
                maxVisible={16}
                testIdPrefix="dashboard-server-block"
              />
            </div>

            {/* Tile 2: Unterstützte Spiele (nur für Betreiber / Operatoren) */}
            {canViewOperatorInfo && (
              <div className="p-4 sm:p-5 flex flex-col justify-between gap-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                    {t('dashboard.supportedGames')}
                  </p>
                  {games.length > 4 && (
                    <Button
                      ref={gamesTriggerRef}
                      type="button"
                      variant="ghost"
                      size="sm"
                      fingerziel
                      onClick={() => setGamesOpen((open) => !open)}
                      aria-expanded={gamesOpen}
                      aria-controls={gamesPopoverId}
                      className="h-7 px-2 text-xs text-primary"
                    >
                      <span>{t('dashboard.allGames')}</span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${gamesOpen ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-headline text-display-sm font-bold text-primary tabular-nums mr-1">
                    {games.length}
                  </span>
                  {games.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      {games.slice(0, 4).map((g) => (
                        <span
                          key={g.id}
                          className="font-mono-sm text-xs px-2 py-0.5 rounded-full border border-outline bg-surface-container-high/55 text-on-surface-variant truncate max-w-[10rem]"
                        >
                          {g.name}
                        </span>
                      ))}
                      {games.length > 4 && (
                        <button
                          type="button"
                          onClick={() => setGamesOpen(true)}
                          className="font-mono-sm text-xs px-2.5 py-0.5 rounded-full bg-surface-container-highest hover:bg-primary/15 hover:text-primary text-on-surface-variant transition-colors"
                        >
                          {t('dashboard.moreGames', { count: games.length - 4 })}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <Ankerfenster
                  offen={gamesOpen}
                  onSchliessen={() => setGamesOpen(false)}
                  anker={gamesTriggerRef}
                  label={t('dashboard.supportedGames')}
                  ausrichtung="ende"
                  maxHoehe="65dvh"
                  durchsichtig
                  className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-outline-variant/40 overscroll-contain space-y-3"
                >
                  <section id={gamesPopoverId} aria-label={t('dashboard.supportedGames')} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Gamepad2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-on-surface">
                        {t('dashboard.supportedGames')} ({games.length})
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {games.map((g) => (
                        <span
                          key={g.id}
                          className="font-mono-sm text-xs px-2.5 py-1 rounded-full border border-outline-variant/45 bg-surface-container/60 text-on-surface"
                        >
                          {g.name}
                        </span>
                      ))}
                    </div>
                  </section>
                </Ankerfenster>
              </div>
            )}

            {/* Tile 3: Systemstatus */}
            <SystemStatusSection showDetails={canViewSystem} />
          </div>
        </section>

        {/* Node capacity Top-N (nodes.read only) */}
        <NodeCapacityCard />

        {/* Ladefehler — nicht als Leerzustand ausgeben */}
        {loadError && (
          <div className="msm-card rounded-2xl border-dashed border-2 border-outline-variant bg-surface-container-low/80 backdrop-blur-xl p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-status-destructive mx-auto mb-4" aria-hidden="true" />
            <h3 className="font-headline text-body-lg text-on-surface mb-1">
              {t('dashboard.loadFailed')}
            </h3>
          </div>
        )}

        {/* Empty State */}
        {!loadError && visibleServers.length === 0 && (
          <div className="msm-card rounded-2xl border-dashed border-2 border-outline-variant bg-surface-container-low/80 backdrop-blur-xl p-12 text-center">
            <ServerIcon className="w-10 h-10 text-on-surface-variant mx-auto mb-4" aria-hidden="true" />
            <h3 className="font-headline text-body-lg text-on-surface mb-1">
              {t('dashboard.noServers')}
            </h3>
            <p className="font-body-md text-sm text-on-surface-variant mb-4">
              {!canCreateServer && shopEnabled
                ? t('dashboard.rentFirstServerHint')
                : t('dashboard.createFirstServer')}
            </p>
            {canCreateServer ? (
              <Link to="/servers" className={buttonClasses('primary')}>
                {t('dashboard.createServer')}
              </Link>
            ) : shopEnabled ? (
              <Link to="/" className={buttonClasses('primary')}>
                {t('dashboard.rentServer')}
              </Link>
            ) : null}
          </div>
        )}

        {/* Server Cards */}
        {visibleServers.length > 0 && (
          <section aria-label={t('dashboard.activeServersOverview')} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="font-headline text-sm font-semibold text-on-surface uppercase tracking-wider">
                  {t('dashboard.activeServersOverview')}
                </h2>
                <span className="rounded-full border border-outline-variant/40 bg-surface-container-high/60 px-2 py-0.5 text-xs font-medium text-on-surface-variant tabular-nums">
                  {visibleServers.length}
                </span>
              </div>
              <Link
                to="/servers"
                className="inline-flex min-h-[44px] md:min-h-[32px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-surface-container-high/60 transition-colors"
              >
                <span>{t('dashboard.viewAllServers')}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
              {visibleSortedServers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  gameLabel={games.find((g) => g.id === server.game_type)?.name || server.game_type}
                  variant="dashboard"
                />
              ))}
            </div>
            {hasMoreDashboardServers && (
              <div ref={dashboardServersSentinelRef} className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  fingerziel
                  onClick={loadMoreDashboardServers}
                  data-testid="dashboard-servers-load-more"
                >
                  {t('servers.loadMoreServers', { remaining: remainingDashboardServers })}
                </Button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
