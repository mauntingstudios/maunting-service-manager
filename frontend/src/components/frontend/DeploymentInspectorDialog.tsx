import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Hammer,
  Monitor,
  RefreshCw,
  Rocket,
  RotateCcw,
  Smartphone,
  User,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@maunting/ui'
import type { FrontendDeployment } from '@/api/frontend'
import { formatBuildDuration, formatRelativeTime, stripAnsiCodes } from '@/utils/frontendDeployTime'
import { toast } from '@/stores/toastStore'

interface DeploymentInspectorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deployment: FrontendDeployment | null
  initialView?: 'logs' | 'preview'
  logText: string
  logLoading?: boolean
  productionUrl?: string | null
  busy?: boolean
  onRefreshLog: (depId: number) => void
  onRebuild: (branch: string) => void
  onPromote: (dep: FrontendDeployment) => void
  onRollback: (dep: FrontendDeployment) => void
  onCancel: (dep: FrontendDeployment) => void
}

function statusBadgeVariant(
  status: FrontendDeployment['status'],
): 'success' | 'warning' | 'destructive' | 'default' {
  if (status === 'ready') return 'success'
  if (status === 'queued' || status === 'building') return 'warning'
  if (status === 'failed') return 'destructive'
  return 'default'
}

export function DeploymentInspectorDialog({
  open,
  onOpenChange,
  deployment,
  initialView = 'logs',
  logText,
  logLoading = false,
  productionUrl,
  busy = false,
  onRefreshLog,
  onRebuild,
  onPromote,
  onRollback,
  onCancel,
}: DeploymentInspectorDialogProps) {
  const { t, i18n } = useTranslation()
  const [viewMode, setViewMode] = useState<'logs' | 'preview'>(initialView)
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [previewKey, setPreviewKey] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const logPreRef = useRef<HTMLPreElement | null>(null)

  const isActive = deployment?.status === 'queued' || deployment?.status === 'building'

  useEffect(() => {
    if (!open || !isActive) return
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [open, isActive])

  useEffect(() => {
    if (open) {
      setViewMode(initialView)
    } else {
      setViewMode('logs')
    }
  }, [open, initialView, deployment?.id])

  useEffect(() => {
    if (open && viewMode === 'logs' && logPreRef.current) {
      logPreRef.current.scrollTop = logPreRef.current.scrollHeight
    }
  }, [open, viewMode, logText])

  const reachableUrl = useMemo(() => {
    if (!deployment) return null
    if (deployment.url) return deployment.url
    if (deployment.kind === 'production' && deployment.is_live && productionUrl) return productionUrl
    if (deployment.kind === 'preview' && deployment.is_live && deployment.port) {
      return `http://${window.location.hostname}:${deployment.port}`
    }
    return null
  }, [deployment, productionUrl])

  const cleanedLog = useMemo(() => stripAnsiCodes(logText), [logText])

  if (!deployment) return null

  const durationText = formatBuildDuration(
    deployment.started_at || deployment.created_at,
    deployment.finished_at,
    i18n.language,
    nowMs,
  )
  const relativeText = formatRelativeTime(
    deployment.finished_at || deployment.started_at || deployment.created_at,
    i18n.language,
    nowMs,
  )

  const sourceLabel = t(`frontendDeployments.sources.${deployment.source}`, {
    defaultValue: deployment.source,
  })
  const kindLabel =
    deployment.kind === 'production'
      ? t('frontendDeployments.production')
      : t('frontendDeployments.previewKind', { defaultValue: 'Vorschau' })

  const copyText = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val)
      toast.success(t('frontendDeployments.copied'))
    } catch {
      toast.error(t('frontendDeployments.copyError'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 px-6 py-5 pr-14">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <DialogTitle className="truncate">
                {deployment.branch} #{deployment.id}
              </DialogTitle>
              <Badge variant={statusBadgeVariant(deployment.status)}>
                {t(`frontendDeployments.statuses.${deployment.status}`, {
                  defaultValue: deployment.status,
                })}
              </Badge>
              <Badge variant="default">{kindLabel}</Badge>
              {deployment.is_live && (
                <Badge variant="success">Live</Badge>
              )}
            </div>
            {durationText && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container-low px-3 py-1.5 text-xs font-mono text-on-surface-variant tabular-nums">
                <Clock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {isActive
                  ? t('frontendDeployments.elapsedRunning', {
                      duration: durationText,
                      defaultValue: `Läuft seit ${durationText}`,
                    })
                  : durationText}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Metadaten-Übersicht */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                {t('frontendDeployments.commitMetaTitle', { defaultValue: 'Commit & Branch' })}
              </p>
              <div className="flex items-center gap-1.5 text-sm font-medium text-on-surface">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{deployment.branch}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <code className="font-mono">
                  {deployment.commit_sha ? deployment.commit_sha.slice(0, 7) : '—'}
                </code>
                {deployment.commit_author && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <User className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {deployment.commit_author}
                  </span>
                )}
              </div>
              {deployment.commit_message && (
                <p className="truncate text-xs text-on-surface-variant">
                  {deployment.commit_message}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                {t('frontendDeployments.timingSourceTitle', { defaultValue: 'Auslöser & Zeitpunkt' })}
              </p>
              <p className="text-sm font-medium text-on-surface">{sourceLabel}</p>
              <p className="text-xs text-on-surface-variant">
                {relativeText || t('frontendDeployments.justStarted', { defaultValue: 'Gerade gestartet' })}
              </p>
            </div>

            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3 space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                {t('frontendDeployments.reachableUrlTitle', { defaultValue: 'Adresse' })}
              </p>
              {reachableUrl ? (
                <>
                  <p className="truncate text-xs font-mono text-primary">
                    {reachableUrl}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => void copyText(reachableUrl)}>
                      <Copy className="mr-1 h-3 w-3" />
                      {t('frontendDeployments.copyUrl')}
                    </Button>
                    <a
                      href={reachableUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-outline-variant/50 px-2.5 text-xs font-medium text-on-surface hover:bg-surface-container-high"
                    >
                      {t('frontendDeployments.open')}
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-on-surface-variant">
                  {deployment.status === 'ready'
                    ? t('frontendDeployments.archivedDeploymentHint', {
                        defaultValue: 'Archiviertes Deployment (per Rollback wieder aktivierbar)',
                      })
                    : t('frontendDeployments.noUrlYet', {
                        defaultValue: 'Noch keine Live-Adresse zugewiesen',
                      })}
                </p>
              )}
            </div>
          </div>

          {/* Benachrichtigungs- / Ergebnis-Banner */}
          {deployment.status === 'ready' && deployment.is_live && (
            <div className="flex items-center gap-2.5 rounded-xl border border-status-success/40 bg-status-success/10 px-3.5 py-2.5 text-xs text-on-surface">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
              <span>
                {t('frontendDeployments.liveNotice', {
                  defaultValue: 'Deployment ist erfolgreich gebaut und wird aktiv ausgeliefert.',
                })}
              </span>
            </div>
          )}
          {deployment.status === 'failed' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-status-destructive/40 bg-status-destructive/10 px-3.5 py-2.5 text-xs text-on-surface">
              <XCircle className="h-4 w-4 shrink-0 text-status-destructive mt-0.5" aria-hidden="true" />
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-status-destructive">
                  {t('frontendDeployments.buildFailedNotice', {
                    defaultValue: 'Build fehlgeschlagen (vorherige Live-Version bleibt unverändert aktiv)',
                  })}
                </p>
                {deployment.error_summary && (
                  <p className="font-mono text-on-surface-variant whitespace-pre-wrap break-words">
                    {deployment.error_summary}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Umschalter Logs vs. Live-Vorschau */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/30 pb-2">
            <div className="flex items-center gap-1.5">
              <Button
                variant={viewMode === 'logs' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setViewMode('logs')}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                {t('frontendDeployments.log')}
                {isActive && <Spinner className="ml-1.5 h-3 w-3" />}
              </Button>
              {reachableUrl && (
                <Button
                  variant={viewMode === 'preview' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setViewMode('preview')}
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  {t('frontendDeployments.livePreviewTab', { defaultValue: 'Live-Vorschau' })}
                </Button>
              )}
            </div>

            {viewMode === 'logs' ? (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onRefreshLog(deployment.id)}
                  disabled={logLoading}
                >
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${logLoading ? 'animate-spin' : ''}`} />
                  {t('frontendDeployments.refreshLog', { defaultValue: 'Aktualisieren' })}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void copyText(cleanedLog)}
                  disabled={!cleanedLog}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {t('frontendDeployments.copyLog', { defaultValue: 'Log kopieren' })}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  variant={previewViewport === 'desktop' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setPreviewViewport('desktop')}
                  aria-label="Desktop"
                >
                  <Monitor className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant={previewViewport === 'mobile' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setPreviewViewport('mobile')}
                  aria-label="Mobil"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPreviewKey((k) => k + 1)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {viewMode === 'logs' ? (
            <pre
              ref={logPreRef}
              className="min-h-[300px] max-h-[54vh] overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-4 text-xs leading-relaxed font-mono text-on-surface whitespace-pre-wrap break-words"
            >
              {cleanedLog || t('frontendDeployments.emptyLog')}
            </pre>
          ) : (
            reachableUrl && (
              <div className="space-y-3">
                <div className="flex justify-center rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
                  <iframe
                    key={`${reachableUrl}-${previewKey}`}
                    src={reachableUrl}
                    loading="lazy"
                    title={`${deployment.branch} Vorschau`}
                    className={`h-[62vh] rounded-lg border border-outline-variant/30 bg-surface transition-all ${
                      previewViewport === 'mobile' ? 'w-[390px] max-w-full' : 'w-full'
                    }`}
                  />
                </div>
                <p className="text-xs text-on-surface-variant text-center">
                  {t('frontendDeployments.previewEmbedHint', {
                    defaultValue:
                      'Falls die Seite Einbettung blockiert, öffne sie direkt über „Öffnen“.',
                  })}
                </p>
              </div>
            )
          )}
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 flex-wrap justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {isActive && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onCancel(deployment)}
                disabled={busy}
              >
                <Ban className="mr-1.5 h-3.5 w-3.5" />
                {t('frontendDeployments.cancelBuild', { defaultValue: 'Abbrechen' })}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRebuild(deployment.branch)}
              disabled={busy}
            >
              <Hammer className="mr-1.5 h-3.5 w-3.5" />
              {t('frontendDeployments.redeploy', { defaultValue: 'Erneut deployen' })}
            </Button>
            {deployment.kind === 'preview' && deployment.status === 'ready' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onPromote(deployment)}
                disabled={busy}
              >
                <Rocket className="mr-1.5 h-3.5 w-3.5" />
                {t('frontendDeployments.promote')}
              </Button>
            )}
            {deployment.kind === 'production' &&
              deployment.status === 'ready' &&
              !deployment.is_live && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onRollback(deployment)}
                  disabled={busy}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  {t('frontendDeployments.rollback')}
                </Button>
              )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.close', { defaultValue: 'Schließen' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
