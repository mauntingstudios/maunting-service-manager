/**
 * Globales Error-Reporting für das MSM-Frontend (Hardening WP2.6).
 *
 * Fängt unbehandelte Fehler und Promise-Rejections ab, bereinigt sensitive
 * Daten (Tokens, Cookies, URLs mit Query-Strings, Passwörter) und leitet sie
 * an Sentry/GlitchTip weiter, falls VITE_SENTRY_DSN konfiguriert ist.
 */

export interface ErrorReportContext {
  errorId?: string
  requestId?: string
  componentStack?: string
  path?: string
  [key: string]: unknown
}

export function scrubMessage(msg: string): string {
  if (!msg) return ''
  return msg
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/(token|secret|password|key)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/[a-f0-9]{32,64}/gi, '[HASH]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, '[EMAIL]')
}

export function scrubUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr, window.location.origin)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return scrubMessage(urlStr)
  }
}

class ErrorReporter {
  private initialized = false
  private dsn = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SENTRY_DSN
  private sentryClient: any = null

  init(): void {
    if (this.initialized) return
    this.initialized = true

    if (typeof window === 'undefined') return

    window.addEventListener('error', (event) => {
      this.report(event.error || new Error(event.message), {
        filename: event.filename ? scrubUrl(event.filename) : undefined,
        lineno: event.lineno,
        colno: event.colno,
      })
    })

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.report(error, { unhandledRejection: true })
    })

    if (this.dsn) {
      this.initSentry(this.dsn)
    }
  }

  private async initSentry(dsn: string): Promise<void> {
    try {
      const sentryPkg = '@sentry/react'
      const sentryModule = await import(/* @vite-ignore */ sentryPkg).catch(() => null)
      if (sentryModule && sentryModule.init) {
        this.sentryClient = sentryModule
        sentryModule.init({
          dsn,
          beforeSend(event: any) {
            if (event.request) {
              if (event.request.url) event.request.url = scrubUrl(event.request.url)
              if (event.request.headers) {
                delete event.request.headers.cookie
                delete event.request.headers.authorization
                delete event.request.headers['x-csrf-token']
                delete event.request.headers['x-mailbox-token']
              }
              delete event.request.cookies
              delete event.request.data
            }
            if (event.message) {
              event.message = scrubMessage(event.message)
            }
            return event
          },
        })
      }
    } catch (err) {
      console.warn('[ErrorReporter] Sentry konnte nicht initialisiert werden:', err)
    }
  }

  report(error: unknown, context: ErrorReportContext = {}): void {
    const errorObj = error instanceof Error ? error : new Error(String(error))
    const cleanMsg = scrubMessage(errorObj.message)

    console.error('[ErrorReporter]', cleanMsg, {
      ...context,
      errorId: context.errorId,
      requestId: context.requestId,
    })

    const Sentry = this.sentryClient || (typeof window !== 'undefined' ? (window as any).Sentry : null)
    if (this.dsn && Sentry) {
      try {
        Sentry.withScope((scope: any) => {
          if (context.errorId) scope.setTag('error_id', context.errorId)
          if (context.requestId) scope.setTag('request_id', context.requestId)
          if (context.componentStack) scope.setExtra('componentStack', context.componentStack)
          Sentry.captureException(errorObj)
        })
      } catch {}
    }
  }
}

export const errorReporter = new ErrorReporter()
