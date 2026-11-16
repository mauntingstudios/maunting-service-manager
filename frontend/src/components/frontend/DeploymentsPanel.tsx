import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  Ban,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Hammer,
  RotateCcw,
  Rocket,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
  Dropdown,
  Spinner,
  type DropdownOption,
} from '@maunting/ui'
import {
  frontendApi,
  type FrontendDeployment,
  type FrontendOverview,
} from '@/api/frontend'
import { DeploymentInspectorDialog } from '@/components/frontend/DeploymentInspectorDialog'
import { formatBuildDuration, formatRelativeTime } from '@/utils/frontendDeployTime'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'

interface DeploymentsPanelProps {
  serverId: number
  overview?: FrontendOverview | null
  onRefreshOverview?: () => void
}

function statusVariant(
  status: FrontendDeployment['status'],
): 'success' | 'warning' | 'destructive' | 'default' {
  if (status === 'ready') return 'success'
  if (status === 'queued' || status === 'building') return 'warning'
  if (status === 'failed') return 'destructive'
  return 'default'
}

function statusDotClasses(status: FrontendDeployment['status']): string {
  if (status === 'ready') return 'bg-status-success'
  if (status === 'queued' || status === 'building') return 'bg-status-warning animate-pulse'
  if (status === 'failed') return 'bg-status-destructive'
  return 'bg-on-surface-variant/50'
}

export function DeploymentsPanel({
  serverId,
  overview: externalOverview,
  onRefreshOverview,
}: DeploymentsPanelProps) {
  const { t, i18n } = useTranslation()
  const [overview, setOverview] = useState<FrontendOverview | null>(externalOverview ?? null)
  const [deployments, setDeployments] = useState<FrontendDeployment[]>([])
  const [branchFilter, setBranchFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [showHeroPreview, setShowHeroPreview] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [inspector, setInspector] = useState<{
    open: boolean
    deploymentId?: number
    log: string
    logLoading: boolean
  }>({
    open: false,
    log: '',
    logLoading: false,
  })

  const loadAll = useCallback(async () => {
    try {
      const [ov, deps] = await Promise.all([
        frontendApi.getOverview(serverId),
        frontendApi.listDeployments(serverId, branchFilter || undefined),
      ])
      setOverview(ov)
      setDeployments(deps)
    } catch {
      toast.error(t('frontendDeployments.loadError'))
    } finally {
      setLoading(false)
    }
  }, [serverId, branchFilter, t])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (externalOverview) setOverview(externalOverview)
  }, [externalOverview])

  const activeBuilds = useMemo(
    () => deployments.filter((d) => d.status === 'queued' || d.status === 'building'),
    [deployments],
  )
  const hasActiveBuild = activeBuilds.length > 0

  const inspectedDeployment = useMemo(
    () => deployments.find((d) => d.id === inspector.deploymentId) ?? null,
    [deployments, inspector.deploymentId],
  )

  const inspectedIsActive =
    inspectedDeployment?.status === 'queued' || inspectedDeployment?.status === 'building'

  // Live-Sekundentakt fuer laufende Builds (Dauer-Anzeige & relative Zeiten)
  useEffect(() => {
    const intervalMs = hasActiveBuild ? 1000 : 30_000
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [hasActiveBuild])

  // Schnelles Log- & Status-Polling (1.5s solange ein Build laeuft oder inspiziert wird)
  useEffect(() => {
    if (!hasActiveBuild && !(inspector.open && inspectedIsActive)) return
    const timer = window.setInterval(() => {
      void loadAll()
      if (inspector.open && inspector.deploymentId) {
        void frontendApi
          .getDeploymentLog(serverId, inspector.deploymentId)
          .then((res) => {
            setInspector((prev) =>
              prev.open && prev.deploymentId === inspector.deploymentId
                ? { ...prev, log: res.log || prev.log }
                : prev,
            )
            if (res.status !== 'queued' && res.status !== 'building') {
              onRefreshOverview?.()
            }
          })
          .catch(() => {})
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [
    hasActiveBuild,
    inspectedIsActive,
    inspector.open,
    inspector.deploymentId,
    loadAll,
    serverId,
    onRefreshOverview,
  ])

  const branchOptions: DropdownOption[] = useMemo(() => {
    const names = Array.from(new Set(deployments.map((d) => d.branch)))
    return [
      { value: '', label: t('frontendDeployments.allBranches') },
      ...names.map((b) => ({ value: b, label: b })),
    ]
  }, [deployments, t])

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('frontendDeployments.copied'))
    } catch {
      toast.error(t('frontendDeployments.copyError'))
    }
  }

  const refreshLog = async (depId: number) => {
    setInspector((prev) => ({ ...prev, logLoading: true }))
    try {
      const res = await frontendApi.getDeploymentLog(serverId, depId)
      setInspector((prev) =>
        prev.deploymentId === depId ? { ...prev, log: res.log || '', logLoading: false } : prev,
      )
    } catch {
      setInspector((prev) => ({ ...prev, logLoading: false }))
    }
  }

  const openInspector = async (dep: FrontendDeployment) => {
    setInspector({
      open: true,
      deploymentId: dep.id,
      log: '',
      logLoading: true,
    })
    try {
      const res = await frontendApi.getDeploymentLog(serverId, dep.id)
      setInspector({
        open: true,
        deploymentId: dep.id,
        log: res.log || t('frontendDeployments.emptyLog'),
        logLoading: false,
      })
    } catch {
      setInspector((prev) => ({ ...prev, logLoading: false }))
      toast.error(t('frontendDeployments.loadError'))
    }
  }

  const handleBuild = async (branch?: string) => {
    try {
      const created = await frontendApi.triggerBuild(serverId, branch)
      toast.success(t('frontendDeployments.buildQueued'))
      await loadAll()
      onRefreshOverview?.()
      if (created?.id) {
        await openInspector(created)
      }
    } catch {
      toast.error(t('frontendDeployments.buildError'))
    }
  }

  const handleCancel = async (dep: FrontendDeployment) => {
    setBusyId(dep.id)
    try {
      await frontendApi.cancelDeployment(serverId, dep.id)
      toast.success(t('frontendDeployments.buildCanceled', { defaultValue: 'Build abgebrochen' }))
      await loadAll()
      onRefreshOverview?.()
    } catch {
      toast.error(t('frontendDeployments.actionError'))
    } finally {
      setBusyId(null)
    }
  }

  const handlePromote = async (dep: FrontendDeployment) => {
    setBusyId(dep.id)
    try {
      await frontendApi.promoteDeployment(serverId, dep.id)
      toast.success(t('frontendDeployments.promoted'))
      await loadAll()
      onRefreshOverview?.()
    } catch {
      toast.error(t('frontendDeployments.actionError'))
    } finally {
      setBusyId(null)
    }
  }

  const handleRollback = async (dep: FrontendDeployment) => {
    setBusyId(dep.id)
    try {
      await frontendApi.rollbackDeployment(serverId, dep.id)
      toast.success(t('frontendDeployments.rolledBack'))
      await loadAll()
      onRefreshOverview?.()
    } catch {
      toast.error(t('frontendDeployments.actionError'))
    } finally {
      setBusyId(null)
    }
  }

  const handleDeletePreview = async (dep: FrontendDeployment) => {
    const ok = await confirm({
      title: t('frontendDeployments.deletePreviewTitle'),
      message: t('frontendDeployments.deletePreviewConfirm', { branch: dep.branch }),
    })
    if (!ok) return
    setBusyId(dep.id)
    try {
      await frontendApi.deletePreview(serverId, dep.branch_slug)
      toast.success(t('frontendDeployments.previewDeleted'))
      await loadAll()
      onRefreshOverview?.()
    } catch {
      toast.error(t('frontendDeployments.actionError'))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  const prod = overview?.production_deployment
  const prodUrl = overview?.production_url
  const latestDeployment = deployments[0]
  const latestFailed = latestDeployment?.status === 'failed' ? latestDeployment : null
  const prodRelative = prod
    ? formatRelativeTime(prod.finished_at || prod.started_at || prod.created_at, i18n.language, nowMs)
    : null

  return (
    <div className="space-y-6">
      {/* Aktive Builds (Echtzeit-Banner) */}
      {activeBuilds.length > 0 && (
        <section
          aria-live="polite"
          className="rounded-xl border border-status-warning/40 bg-status-warning/10 p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Spinner />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                {t('frontendDeployments.buildRunningTitle', {
                  defaultValue: 'Build läuft gerade',
                })}
              </p>
              <p className="text-xs text-on-surface-variant truncate tabular-nums">
                {activeBuilds
                  .map((b) => {
                    const dur = formatBuildDuration(b.started_at || b.created_at, null, i18n.language, nowMs)
                    return dur ? `${b.branch} (#${b.id}, ${dur})` : `${b.branch} (#${b.id})`
                  })
                  .join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void openInspector(activeBuilds[0])}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {t('frontendDeployments.openLiveLog', { defaultValue: 'Live-Log öffnen' })}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleCancel(activeBuilds[0])}
              disabled={busyId === activeBuilds[0].id}
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" />
              {t('frontendDeployments.cancelBuild', { defaultValue: 'Abbrechen' })}
            </Button>
          </div>
        </section>
      )}

      {/* Hinweis bei letztem fehlgeschlagenem Build */}
      {latestFailed && (
        <section className="rounded-xl border border-status-destructive/40 bg-status-destructive/5 p-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1 flex-1">
            <p className="text-sm font-semibold text-status-destructive">
              {t('frontendDeployments.latestFailedTitle', {
                branch: latestFailed.branch,
                id: latestFailed.id,
                defaultValue: `Letzter Build #${latestFailed.id} (${latestFailed.branch}) fehlgeschlagen`,
              })}
            </p>
            {latestFailed.error_summary && (
              <p className="text-xs font-mono text-on-surface-variant whitespace-pre-wrap break-words">
                {latestFailed.error_summary}
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => void openInspector(latestFailed)}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            {t('frontendDeployments.log')}
          </Button>
        </section>
      )}

      {/* Produktions-Hero-Karte */}
      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {t('frontendDeployments.production')}
              </span>
              <Badge variant={overview?.online ? 'success' : 'default'}>
                {overview?.online ? t('frontendDeployments.online') : t('frontendDeployments.offline')}
              </Badge>
              {overview?.domain && overview?.domain_verified && (
                <Badge variant="info">
                  <Globe className="mr-1 h-3 w-3" />
                  {overview.domain}
                </Badge>
              )}
            </div>

            {prodUrl && (
              <div className="flex items-center gap-2 min-w-0">
                <a
                  href={prodUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-base sm:text-lg font-semibold text-primary hover:underline"
                >
                  {prodUrl}
                </a>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
              <span className="inline-flex items-center gap-1 font-medium text-on-surface">
                <GitBranch className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {prod?.branch ?? overview?.production_branch ?? 'main'}
              </span>
              {prod?.commit_sha && (
                <span className="inline-flex items-center gap-1">
                  <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono">
                    {prod.commit_sha.slice(0, 7)}
                  </code>
                </span>
              )}
              {prod?.commit_message && (
                <span className="truncate max-w-md" title={prod.commit_message}>
                  {prod.commit_message}
                </span>
              )}
              {prodRelative && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {prodRelative}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {prodUrl && (
              <>
                <Button variant="secondary" size="sm" onClick={() => void copyUrl(prodUrl)}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {t('frontendDeployments.copyUrl')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowHeroPreview((v) => !v)}
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  {t('frontendDeployments.livePreviewTab', { defaultValue: 'Live-Vorschau' })}
                  {showHeroPreview ? (
                    <ChevronUp className="ml-1 h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  )}
                </Button>
                <a
                  href={prodUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-outline-variant/50 px-3 text-sm font-medium text-on-surface hover:bg-surface-container-high"
                >
                  {t('frontendDeployments.open')}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </>
            )}
            <Button size="sm" onClick={() => void handleBuild(overview?.production_branch)}>
              <Hammer className="mr-1.5 h-3.5 w-3.5" />
              {t('frontendDeployments.buildNow')}
            </Button>
          </div>
        </div>

        {/* Lazy geladene Live-Vorschau der Produktionsseite */}
        {showHeroPreview && prodUrl && (
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-2 space-y-1.5">
            <iframe
              src={prodUrl}
              loading="lazy"
              title="Produktions-Vorschau"
              className="h-[360px] w-full rounded-lg border border-outline-variant/30 bg-surface"
            />
            <p className="text-xs text-on-surface-variant text-center">
              {t('frontendDeployments.previewEmbedHint', {
                defaultValue:
                  'Falls die Seite Einbettung per X-Frame-Options blockiert, öffne sie direkt über „Öffnen“.',
              })}
            </p>
          </div>
        )}
      </section>

      {/* Branch-Previews */}
      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">
              {t('frontendDeployments.previews')}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {t('frontendDeployments.previewsHint', {
                defaultValue: 'Eigene Vorschau-Umgebungen je Git-Branch, mit einem Klick als Produktion aktivierbar.',
              })}
            </p>
          </div>
        </div>

        {!overview?.previews?.length ? (
          <p className="text-sm text-on-surface-variant">
            {t('frontendDeployments.noPreviews')}
          </p>
        ) : (
          <div className="space-y-2">
            {overview.previews.map((pv) => {
              const previewAddr =
                pv.url || (pv.port ? `http://${window.location.hostname}:${pv.port}` : '')
              const rel = formatRelativeTime(pv.finished_at || pv.created_at, i18n.language, nowMs)
              return (
                <div
                  key={pv.id}
                  className="flex flex-col gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${statusDotClasses(pv.status)}`} />
                      <span className="font-medium text-sm text-on-surface truncate">{pv.branch}</span>
                      <Badge variant={statusVariant(pv.status)}>
                        {t(`frontendDeployments.statuses.${pv.status}`, { defaultValue: pv.status })}
                      </Badge>
                      {pv.commit_sha && (
                        <code className="rounded bg-surface-container-high px-1.5 py-0.5 text-xs font-mono text-on-surface-variant">
                          {pv.commit_sha.slice(0, 7)}
                        </code>
                      )}
                      {rel && <span className="text-xs text-on-surface-variant">{rel}</span>}
                    </div>
                    {previewAddr && (
                      <p className="truncate text-xs font-mono text-on-surface-variant">{previewAddr}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {previewAddr && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => void copyUrl(previewAddr)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <a
                          href={previewAddr}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-outline-variant/50 px-2.5 text-xs font-medium text-on-surface hover:bg-surface-container-high"
                        >
                          {t('frontendDeployments.open')}
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      </>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void openInspector(pv)}
                    >
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      {t('frontendDeployments.details', { defaultValue: 'Details' })}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleBuild(pv.branch)}
                      disabled={busyId === pv.id}
                    >
                      <Hammer className="mr-1 h-3.5 w-3.5" />
                      {t('frontendDeployments.rebuild')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handlePromote(pv)}
                      disabled={busyId === pv.id}
                    >
                      <Rocket className="mr-1 h-3.5 w-3.5" />
                      {t('frontendDeployments.promote')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDeletePreview(pv)}
                      disabled={busyId === pv.id}
                      aria-label={t('frontendDeployments.deletePreviewTitle')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Deployment-Verlauf (klickbare Rows + content-visibility fuer lange Verlaeufe) */}
      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">
              {t('frontendDeployments.history')}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {t('frontendDeployments.historyHint', {
                defaultValue: 'Klicke auf einen Eintrag für Live-Logs, Laufzeit, Adressen und Vorschau.',
              })}
            </p>
          </div>
          <div className="w-full sm:w-56">
            <Dropdown
              options={branchOptions}
              value={branchFilter}
              onChange={(val) => setBranchFilter(String(val))}
            />
          </div>
        </div>

        {deployments.length === 0 ? (
          <p className="text-sm text-on-surface-variant">{t('frontendDeployments.noDeployments')}</p>
        ) : (
          <div className="space-y-2">
            {deployments.map((dep, index) => {
              const rel = formatRelativeTime(
                dep.finished_at || dep.started_at || dep.created_at,
                i18n.language,
                nowMs,
              )
              const dur = formatBuildDuration(
                dep.started_at || dep.created_at,
                dep.finished_at,
                i18n.language,
                nowMs,
              )
              const deferClass = index >= 6 ? 'msm-deferred-card' : ''
              const isDepActive = dep.status === 'queued' || dep.status === 'building'
              return (
                <div
                  key={dep.id}
                  onClick={() => void openInspector(dep)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void openInspector(dep)
                    }
                  }}
                  className={`${deferClass} cursor-pointer flex flex-col gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3.5 hover:border-primary/40 hover:bg-surface-container-high/40 transition-colors sm:flex-row sm:items-center sm:justify-between`}
                >
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusDotClasses(dep.status)}`} />
                      <span className="text-sm font-semibold text-on-surface">{dep.branch}</span>
                      <span className="text-xs font-mono text-on-surface-variant">#{dep.id}</span>
                      <Badge variant={statusVariant(dep.status)}>
                        {t(`frontendDeployments.statuses.${dep.status}`, { defaultValue: dep.status })}
                      </Badge>
                      <Badge variant="default">
                        {dep.kind === 'production'
                          ? t('frontendDeployments.production')
                          : t('frontendDeployments.previewKind', { defaultValue: 'Vorschau' })}
                      </Badge>
                      {dep.is_live && <Badge variant="success">Live</Badge>}
                      {dep.commit_sha && (
                        <code className="rounded bg-surface-container-high px-1.5 py-0.5 text-xs font-mono text-on-surface-variant">
                          {dep.commit_sha.slice(0, 7)}
                        </code>
                      )}
                      {rel && (
                        <span className="text-xs text-on-surface-variant tabular-nums">{rel}</span>
                      )}
                      {dur && (
                        <span className="inline-flex items-center gap-1 text-xs font-mono text-on-surface-variant tabular-nums">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {dur}
                        </span>
                      )}
                    </div>
                    {dep.commit_message && (
                      <p className="truncate text-xs text-on-surface-variant">
                        {dep.commit_message}
                        {dep.commit_author ? ` · ${dep.commit_author}` : ''}
                      </p>
                    )}
                    {dep.error_summary && (
                      <p className="truncate text-xs text-status-destructive">{dep.error_summary}</p>
                    )}
                  </div>

                  <div
                    className="flex flex-wrap items-center gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button variant="secondary" size="sm" onClick={() => void openInspector(dep)}>
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      {t('frontendDeployments.details', { defaultValue: 'Details' })}
                    </Button>
                    {!isDepActive && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleBuild(dep.branch)}
                        disabled={busyId === dep.id}
                      >
                        <Hammer className="mr-1 h-3.5 w-3.5" />
                        {t('frontendDeployments.redeploy', { defaultValue: 'Erneut' })}
                      </Button>
                    )}
                    {dep.kind === 'preview' && dep.status === 'ready' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handlePromote(dep)}
                        disabled={busyId === dep.id}
                      >
                        <Rocket className="mr-1 h-3.5 w-3.5" />
                        {t('frontendDeployments.promote')}
                      </Button>
                    )}
                    {dep.kind === 'production' && dep.status === 'ready' && !dep.is_live && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleRollback(dep)}
                        disabled={busyId === dep.id}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        {t('frontendDeployments.rollback')}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <DeploymentInspectorDialog
        open={inspector.open}
        onOpenChange={(open) => setInspector((prev) => ({ ...prev, open }))}
        deployment={inspectedDeployment}
        logText={inspector.log}
        logLoading={inspector.logLoading}
        productionUrl={prodUrl}
        busy={inspectedDeployment ? busyId === inspectedDeployment.id : false}
        onRefreshLog={(id) => void refreshLog(id)}
        onRebuild={(branch) => void handleBuild(branch)}
        onPromote={(dep) => void handlePromote(dep)}
        onRollback={(dep) => void handleRollback(dep)}
        onCancel={(dep) => void handleCancel(dep)}
      />
    </div>
  )
}
