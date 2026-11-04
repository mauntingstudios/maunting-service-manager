import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, SanitizedApiError } from '@/api/client'
import { Logo } from '@/components/Logo'
import { VersionFooter } from '@/components/VersionFooter'
import { ErrorMessage } from '@maunting/ui'
import { Shield, Check, X, ArrowRight } from 'lucide-react'
import { Button, buttonClasses } from '@maunting/ui'
import { Spinner } from '@maunting/ui'

/**
 * Bestätigt die Localhost-Freigabe per Einmal-Link (Befund 46).
 *
 * Konten ohne Passwort und ohne 2FA beweisen hier ihr Postfach; die Sitzung
 * belegt weiter den Admin — erst beides zusammen stellt den Schalter um.
 */
export function LocalhostFreigabe() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')

    if (!token) {
      setStatus('error')
      setMessage(t('localhostFreigabe.noToken'))
      return
    }

    setStatus('submitting')

    try {
      await api('/settings/localhost-connections/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
      setStatus('success')
      setMessage(t('localhostFreigabe.success'))
    } catch (err: unknown) {
      setStatus('error')
      if (err instanceof SanitizedApiError && err.status === 401) {
        setMessage(t('localhostFreigabe.loginRequired'))
      } else {
        setMessage(err instanceof Error && err.message ? err.message : t('localhostFreigabe.error'))
      }
    }
  }

  return (
    <div className="min-h-screen bg-background text-on-surface flex items-center justify-center p-margin-mobile md:p-margin-desktop relative overflow-hidden">
      <div className="absolute inset-0 msm-deep-grid opacity-50" />

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Logo size="md" />
          <div>
            <h1 className="font-headline text-body-lg font-extrabold text-primary leading-tight">
              MSM
            </h1>
          </div>
        </div>

        <div className="msm-card p-8">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center mx-auto mb-4">
              <Shield className="w-6 h-6 text-secondary" />
            </div>
            <h2 className="font-headline text-headline-md text-primary mb-1">
              {t('localhostFreigabe.title')}
            </h2>
            <p className="font-body-md text-sm text-on-surface-variant">
              {t('localhostFreigabe.description')}
            </p>
          </div>

          {status === 'success' && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-status-success/10 border border-status-success/30 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-status-success" />
              </div>
              <p className="font-body-md text-base text-on-surface">{message}</p>
              <Link
                to="/settings"
                className={buttonClasses('primary', 'lg', 'w-full')}
              >
                {t('localhostFreigabe.backToSettings')}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-status-destructive/10 border border-status-destructive/30 flex items-center justify-center mx-auto">
                <X className="w-8 h-8 text-status-destructive" />
              </div>
              <p className="font-body-md text-base text-status-destructive">{message}</p>
              <Link
                to="/settings"
                className={buttonClasses('secondary', 'lg', 'w-full')}
              >
                {t('localhostFreigabe.backToSettings')}
              </Link>
            </div>
          )}

          {(status === 'idle' || status === 'submitting') && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <ErrorMessage message={message} className="text-sm" />

              <Button size="lg"
                type="submit"
                disabled={status === 'submitting'}
                className="w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {status === 'submitting' ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    {t('common.loading')}
                  </span>
                ) : (
                  <>
                    {t('localhostFreigabe.confirm')}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>
          )}
        </div>

        <VersionFooter />
      </div>
    </div>
  )
}
