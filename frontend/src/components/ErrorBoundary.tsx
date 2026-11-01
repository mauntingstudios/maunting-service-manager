import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/Singra/UI'
import { errorReporter } from '@/lib/errorReporter'

/**
 * Auffangschale für Renderfehler. Ohne sie hängt React 18 bei einem
 * unbehandelten Fehler den kompletten Root aus — Sidebar, Topbar und Toasts
 * inklusive, sichtbar als völlig weiße Seite.
 */
function ErrorCard({ errorId, compact = false }: { errorId?: string | null; compact?: boolean }) {
  const { t } = useTranslation()
  const minHeightClass = compact ? 'min-h-[300px]' : 'min-h-screen'
  return (
    <div className={`flex ${minHeightClass} flex-1 items-center justify-center p-6`}>
      <div className="msm-card w-full max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-status-destructive" />
        <h1 className="font-headline text-body-lg text-on-surface mb-2">{t('errorBoundary.title')}</h1>
        <p className="font-body-md mb-2 text-sm text-on-surface-variant">{t('errorBoundary.hint')}</p>
        {errorId && (
          <p className="font-mono text-xs text-on-surface-variant/70 mb-6 select-all">
            ID: {errorId}
          </p>
        )}
        <Button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11"
        >
          {t('errorBoundary.reload')}
        </Button>
      </div>
    </div>
  )
}

export interface ErrorBoundaryProps {
  children: ReactNode
  compact?: boolean
  onError?: (error: Error, errorId: string) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  errorId: string | null
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorId: null, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const errorId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2, 10)
    return { hasError: true, errorId, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const errorId = this.state.errorId || 'unknown'
    this.props.onError?.(error, errorId)
    errorReporter.report(error, {
      errorId,
      componentStack: info.componentStack || undefined,
    })
  }

  render() {
    return this.state.hasError ? (
      <ErrorCard errorId={this.state.errorId} compact={this.props.compact} />
    ) : (
      this.props.children
    )
  }
}
