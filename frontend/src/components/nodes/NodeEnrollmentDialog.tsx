import { useCallback, useEffect, useId, useState } from 'react'
import { Check, Clipboard, Loader2, Server, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SanitizedApiError } from '@/api/client'
import {
  approveNodeEnrollment,
  getNodeInstallCommand,
  getPendingNodeEnrollments,
  type PendingNodeEnrollment,
} from '@/services/nodeEnrollmentService'
import { toast } from '@/stores/toastStore'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@maunting/ui'

interface NodeEnrollmentDialogProps {
  onClose: () => void
  onManualSetup: () => void
  onApproved: () => Promise<void>
}

const POLL_INTERVAL_MS = 4000

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof SanitizedApiError ? error.message : fallback
}

export function NodeEnrollmentDialog({
  onClose,
  onManualSetup,
  onApproved,
}: NodeEnrollmentDialogProps) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const [command, setCommand] = useState('')
  const [commandLoading, setCommandLoading] = useState(true)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingNodeEnrollment[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [approvingId, setApprovingId] = useState<number | null>(null)

  const loadCommand = useCallback(async () => {
    setCommandLoading(true)
    setCommandError(null)
    try {
      const result = await getNodeInstallCommand()
      setCommand(result.command)
    } catch (error: unknown) {
      setCommandError(safeErrorMessage(error, t('nodes.enrollment.commandFailed')))
    } finally {
      setCommandLoading(false)
    }
  }, [t])

  const loadPending = useCallback(async (showLoading = false) => {
    if (showLoading) setPendingLoading(true)
    try {
      const enrollments = await getPendingNodeEnrollments()
      setPending(enrollments)
      setPendingError(null)
    } catch (error: unknown) {
      setPendingError(safeErrorMessage(error, t('nodes.enrollment.pendingFailed')))
    } finally {
      setPendingLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadCommand()

    void loadPending(true)
    const interval = window.setInterval(() => void loadPending(), POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(interval)
    }
  }, [loadCommand, loadPending])

  const copyCommand = async () => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('nodes.enrollment.copyFailed'))
    }
  }

  const approve = async (enrollment: PendingNodeEnrollment) => {
    setApprovingId(enrollment.id)
    try {
      await approveNodeEnrollment(enrollment.id)
      setPending((items) => items.filter((item) => item.id !== enrollment.id))
      await onApproved()
      toast.success(t('nodes.enrollment.approved', { name: enrollment.name }))
    } catch (error: unknown) {
      toast.error(safeErrorMessage(error, t('nodes.enrollment.approveFailed')))
      await loadPending()
    } finally {
      setApprovingId(null)
    }
  }

  const formatExpiry = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))

  return (
    <Dialog open={true} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        aria-labelledby={titleId}
        className="w-full max-w-3xl overflow-hidden p-0"
      >
        <DialogHeader className="border-b border-outline-variant px-5 py-4 pr-14 sm:px-6">
          <DialogTitle id={titleId} className="font-headline text-body-lg text-primary">
            {t('nodes.enrollment.title')}
          </DialogTitle>
          <DialogDescription className="mt-1 max-w-2xl text-sm">
            {t('nodes.enrollment.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(100vh-9rem)] space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            {(['copy', 'run', 'confirm'] as const).map((step, index) => (
              <li key={step} className="flex gap-3 text-on-surface-variant">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-xs text-primary">
                  {index + 1}
                </span>
                <span>{t(`nodes.enrollment.steps.${step}`)}</span>
              </li>
            ))}
          </ol>

          <section aria-labelledby={`${titleId}-command`}>
            <div className="mb-2 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <h3 id={`${titleId}-command`} className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                {t('nodes.enrollment.commandLabel')}
              </h3>
            </div>
            <div className="flex min-h-20 items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-3 sm:p-4">
              {commandLoading ? (
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" aria-label={t('common.loading')} />
              ) : commandError ? (
                <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-status-destructive">{commandError}</p>
                  <Button variant="secondary"
                    type="button"
                    className="shrink-0"
                    onClick={() => void loadCommand()}
                  >
                    {t('common.retry')}
                  </Button>
                </div>
              ) : (
                <>
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm leading-6 text-on-surface">
                    {command}
                  </code>
                  <Button variant="secondary"
                    type="button"
                    className="inline-flex shrink-0 items-center gap-2"
                    aria-label={copied ? t('common.copied') : t('common.copy')}
                    onClick={() => void copyCommand()}
                  >
                    {copied ? <Check className="h-4 w-4 text-status-success" /> : <Clipboard className="h-4 w-4" />}
                    <span className="hidden sm:inline">
                      {copied ? t('common.copied') : t('common.copy')}
                    </span>
                  </Button>
                  <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {copied ? t('common.copied') : ''}
                  </span>
                </>
              )}
            </div>
          </section>

          <section aria-labelledby={`${titleId}-pending`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <h3 id={`${titleId}-pending`} className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                  {t('nodes.enrollment.pendingTitle')}
                </h3>
              </div>
              {!pendingLoading && !pendingError && (
                <span className="text-xs text-on-surface-variant">{t('nodes.enrollment.live')}</span>
              )}
            </div>

            <div className="divide-y divide-outline-variant overflow-hidden rounded-xl border border-outline-variant">
              {pendingLoading ? (
                <div className="flex min-h-24 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label={t('common.loading')} />
                </div>
              ) : pendingError ? (
                <div className="p-4 text-sm text-status-destructive">{pendingError}</div>
              ) : pending.length === 0 ? (
                <div className="p-5 text-center">
                  <p className="text-sm font-medium text-on-surface">{t('nodes.enrollment.pendingEmpty')}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">{t('nodes.enrollment.pendingEmptyHint')}</p>
                </div>
              ) : (
                pending.map((enrollment) => (
                  <div key={enrollment.id} className="flex flex-col gap-4 bg-surface-container-low p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-on-surface">{enrollment.name}</strong>
                        <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-sm font-semibold tracking-widest text-primary">
                          {enrollment.display_code}
                        </span>
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-on-surface-variant">{enrollment.host}</p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {t('nodes.enrollment.expiresAt', { time: formatExpiry(enrollment.expires_at) })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 sm:shrink-0"
                      disabled={approvingId !== null}
                      onClick={() => void approve(enrollment)}
                    >
                      {approvingId === enrollment.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t('nodes.enrollment.approve')}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="flex items-center justify-between gap-3 border-t border-outline-variant px-5 py-3 sm:px-6">
          <p className="hidden text-xs text-on-surface-variant sm:block">{t('nodes.enrollment.manualHint')}</p>
          <Button variant="secondary" type="button" className="ml-auto" onClick={onManualSetup}>
            {t('nodes.enrollment.manual')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
