import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '@/api/client'
import { AuthRahmen } from '@/components/auth/AuthRahmen'
import { ErrorMessage, Input } from '@maunting/ui'
import { CaptchaWidget } from '@/components/app/CaptchaWidget'
import { Shield, Mail, ArrowRight, ArrowLeft } from 'lucide-react'
import { Button, buttonClasses } from '@maunting/ui'
import { Spinner } from '@maunting/ui'
export function ForgotPassword() {
  const { t } = useTranslation()
  const feld = useId()
  const [email, setEmail] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setStatus('submitting')

    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email, captcha_token: captchaToken }),
      })
      setStatus('sent')
    } catch (err: any) {
      setError(err.message || t('forgotPassword.error'))
      setStatus('idle')
      setCaptchaToken(null)
      setCaptchaResetKey((k) => k + 1)
    }
  }

  return (
    <AuthRahmen>
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center mx-auto mb-4">
          <Shield className="w-6 h-6 text-secondary" />
        </div>
        <h2 className="font-headline text-headline-md text-primary mb-1">
          {t('forgotPassword.title')}
        </h2>
        <p className="font-body-md text-sm text-on-surface-variant">
          {t('forgotPassword.description')}
        </p>
      </div>

      {status === 'sent' ? (
        <div className="text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-status-success/10 border border-status-success/30 flex items-center justify-center mx-auto">
            <Mail className="w-8 h-8 text-status-success" />
          </div>
          <p className="font-body-md text-base text-on-surface">{t('forgotPassword.sent')}</p>
          <Link
            to="/login"
            className={buttonClasses('primary', 'lg', 'w-full')}
          >
            {t('auth.goToLogin')}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor={feld} className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
              {t('auth.email')}
            </label>
            <Input
              id={feld}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>

          <CaptchaWidget onVerify={setCaptchaToken} resetKey={captchaResetKey} />

          <ErrorMessage message={error} className="text-sm" />

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
                {t('forgotPassword.sendLink')}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </form>
      )}

      <div className="mt-6 text-center">
        <Link
          to="/login"
          className="font-body-md text-sm text-secondary hover:text-mint-accent transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('auth.hasAccount')}
        </Link>
      </div>
    </AuthRahmen>
  )
}
