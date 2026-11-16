import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  Copy,
  FileText,
  GitBranch,
  Hammer,
  RotateCcw,
  Rocket,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Spinner,
  type DropdownOption,
} from '@maunting/ui'
import {
  frontendApi,
  type FrontendDeployment,
  type FrontendOverview,
} from '@/api/frontend'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'

interface DeploymentsPanelProps {
  serverId: number
  overview?: FrontendOverview | null
  onRefreshOverview?: () => void
}

function statusVariant(status: FrontendDeployment['status']): 'success' | 'warning' | 'destructive' | 'default' {
  if (status === 'ready') return 'success'
  if (status === 'queued' || status === 'building') return 'warning'
  if (status === 'failed') return 'destructive'
  return 'default'
}

export function DeploymentsPanel({ serverId, overview: externalOverview, onRefreshOverview }: DeploymentsPanelProps) {
  const { t } = useTranslation()
  const [overview, setOverview] = useState<FrontendOverview | null>(externalOverview ?? null)
  const [deployments, setDeployments] = useState<FrontendDeployment[]>([])
  const [branchFilter, setBranchFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [logDialog, setLogDialog] = useState<{
    open: boolean
    deploymentId?: number
    title: string
    status?: FrontendDeployment['status']
    log: string
  }>({
    open: false,
    title: '',
    log: '',
  })
  const logPreRef = useRef<HTMLPreElement | null>(null)

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
  const logIsStreaming =
    logDialog.open &&
    Boolean(logDialog.deploymentId) &&
    (logDialog.status === 'queued' || logDialog.status === 'building' || hasActiveBuild)

  useEffect(() => {
    if (!hasActiveBuild && !logIsStreaming) return
    const intervalMs = logIsStreaming ? 2000 : 3000
    const timer = window.setInterval(() => {
      void loadAll()
      if (logDialog.open && logDialog.deploymentId) {
        void frontendApi
          .getDeploymentLog(serverId, logDialog.deploymentId)
          .then((res) => {
            setLogDialog((prev) =>
              prev.open && prev.deploymentId === logDialog.deploymentId
                ? {
                    ...prev,
                    status: (res.status as FrontendDeployment['status']) || prev.status,
                    log: res.log || prev.log,
                  }
                : prev,
            )
            if (res.status !== 'queued' && res.status !== 'building') {
              onRefreshOverview?.()
            }
          })
          .catch(() => {})
      }
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [hasActiveBuild, logIsStreaming, loadAll, logDialog.open, logDialog.deploymentId, serverId, onRefreshOverview])

  useEffect(() => {
    if (logDialog.open && logPreRef.current) {
      logPreRef.current.scrollTop = logPreRef.current.scrollHeight
    }
  }, [logDialog.open, logDialog.log])

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

  const handleBuild = async (branch?: string) => {
    try {
      await frontendApi.triggerBuild(serverId, branch)
      toast.success(t('frontendDeployments.buildQueued'))
      await loadAll()
      onRefreshOverview?.()
    } catch {
      toast.error(t('frontendDeployments.buildError'))
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

  const openLog = async (dep: FrontendDeployment) => {
    try {
      const res = await frontendApi.getDeploymentLog(serverId, dep.id)
      setLogDialog({
        open: true,
        deploymentId: dep.id,
        title: `${dep.branch} (#${dep.id})`,
        status: (res.status as FrontendDeployment['status']) || dep.status,
        log: res.log || t('frontendDeployments.emptyLog'),
      })
    } catch {
      toast.error(t('frontendDeployments.loadError'))
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

  return (
    <div className="space-y-6">
      {activeBuilds.length > 0 && (
        <section className="rounded-xl border border-status-warning/40 bg-status-warning/10 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Spinner />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                {t('frontendDeployments.buildRunningTitle', {
                  defaultValue: 'Build wird ausgefuehrt',
                })}
              </p>
              <p className="text-xs text-on-surface-variant truncate">
                {activeBuilds.map((b) => `${b.branch} (#${b.id})`).join(', ')}
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void openLog(activeBuilds[0])}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            {t('frontendDeployments.openLiveLog', { defaultValue: 'Live-Log oeffnen' })}
          </Button>
        </section>
      )}

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
          <Button variant="secondary" size="sm" onClick={() => void openLog(latestFailed)}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            {t('frontendDeployments.log')}
          </Button>
        </section>
      )}
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
              {t('frontendDeployments.production')}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={overview?.online ? 'success' : 'default'}>
                {overview?.online ? t('frontendDeployments.online') : t('frontendDeployments.offline')}
              </Badge>
              <span className="inline-flex items-center gap-1 text-sm text-on-surface-variant">
                <GitBranch className="h-3.5 w-3.5" />
                {overview?.production_branch ?? 'main'}
              </span>
              {prod?.commit_sha && (
                <code className="rounded bg-surface-container-high px-1.5 py-0.5 text-xs">
                  {prod.commit_sha.slice(0, 7)}
                </code>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {prodUrl && (
              <>
                <Button variant="secondary" size="sm" onClick={() => copyUrl(prodUrl)}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {t('frontendDeployments.copyUrl')}
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
            <Button size="sm" onClick={() => handleBuild(overview?.production_branch)}>
              <Hammer className="mr-1.5 h-3.5 w-3.5" />
              {t('frontendDeployments.buildNow')}
            </Button>
          </div>
        </div>
        {prodUrl && (
          <p className="truncate text-sm font-mono text-primary">{prodUrl}</p>
        )}
      </section>

      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-3">
        <h3 className="text-sm font-semibold text-on-surface">
          {t('frontendDeployments.previews')}
        </h3>
        {!overview?.previews?.length ? (
          <p className="text-sm text-on-surface-variant">
            {t('frontendDeployments.noPreviews')}
          </p>
        ) : (
          <div className="space-y-2">
            {overview.previews.map((pv) => {
              const previewAddr = pv.url || (pv.port ? `http://${window.location.hostname}:${pv.port}` : '')
              return (
                <div
                  key={pv.id}
                  className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-on-surface truncate">{pv.branch}</span>
                      <Badge variant={statusVariant(pv.status)}>{pv.status}</Badge>
                    </div>
                    {previewAddr && (
                      <p className="truncate text-xs font-mono text-on-surface-variant">{previewAddr}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {previewAddr && (
                      <Button variant="secondary" size="sm" onClick={() => copyUrl(previewAddr)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => handleBuild(pv.branch)} disabled={busyId === pv.id}>
                      <Hammer className="mr-1 h-3.5 w-3.5" />
                      {t('frontendDeployments.rebuild')}
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => handlePromote(pv)} disabled={busyId === pv.id}>
                      <Rocket className="mr-1 h-3.5 w-3.5" />
                      {t('frontendDeployments.promote')}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeletePreview(pv)} disabled={busyId === pv.id}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-on-surface">
            {t('frontendDeployments.history')}
          </h3>
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
            {deployments.map((dep) => (
              <div
                key={dep.id}
                className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(dep.status)}>{dep.status}</Badge>
                    <span className="text-sm font-medium text-on-surface">{dep.branch}</span>
                    {dep.is_live && <Badge variant="success">Live</Badge>}
                    {dep.commit_sha && (
                      <code className="text-xs text-on-surface-variant">{dep.commit_sha.slice(0, 7)}</code>
                    )}
                  </div>
                  {dep.commit_message && (
                    <p className="truncate text-xs text-on-surface-variant">{dep.commit_message}</p>
                  )}
                  {dep.error_summary && (
                    <p className="truncate text-xs text-error">{dep.error_summary}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => openLog(dep)}>
                    <FileText className="mr-1 h-3.5 w-3.5" />
                    {t('frontendDeployments.log')}
                  </Button>
                  {dep.kind === 'production' && dep.status === 'ready' && !dep.is_live && (
                    <Button variant="secondary" size="sm" onClick={() => handleRollback(dep)} disabled={busyId === dep.id}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      {t('frontendDeployments.rollback')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={logDialog.open} onOpenChange={(open) => setLogDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
              <DialogTitle>{logDialog.title}</DialogTitle>
              {logDialog.status && (
                <Badge variant={statusVariant(logDialog.status)}>
                  {logDialog.status === 'queued' || logDialog.status === 'building'
                    ? t('frontendDeployments.liveBadge', { defaultValue: 'Live' })
                    : logDialog.status}
                </Badge>
              )}
            </div>
          </DialogHeader>
          <pre
            ref={logPreRef}
            className="max-h-[60vh] overflow-auto rounded-lg bg-surface-container-lowest p-3 text-xs font-mono text-on-surface whitespace-pre-wrap break-words"
          >
            {logDialog.log}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
