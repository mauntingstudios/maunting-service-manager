import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard } from 'lucide-react'
import { Badge, Button, Input, Spinner } from '@maunting/ui'
import { apiUrl } from '@/config/api'
import { SanitizedApiError } from '@/api/client'
import { shopStripeApi, type ShopStripeStatusDto } from '@/api/shop'
import { toast } from '@/stores/toastStore'

function modusKey(mode: ShopStripeStatusDto['mode']): string {
  if (mode === 'test') return 'settings.shop.stripe.modusTest'
  if (mode === 'live') return 'settings.shop.stripe.modusLive'
  return 'settings.shop.stripe.modusUnbekannt'
}

export interface StripeZahlungenKarteProps {
  flat?: boolean
  onStatusChange?: (status: ShopStripeStatusDto) => void
}

export function StripeZahlungenKarte({ flat = false, onStatusChange }: StripeZahlungenKarteProps = {}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ShopStripeStatusDto | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [secretKey, setSecretKey] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [publishableKey, setPublishableKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let aktiv = true
    void shopStripeApi
      .status()
      .then((daten) => {
        if (!aktiv) return
        setStatus(daten)
        onStatusChange?.(daten)
        setPublishableKey(daten.publishable_key ?? '')
        setLaedt(false)
      })
      .catch(() => {
        if (aktiv) setLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [])

  const speichern = async () => {
    if (busy) return
    setBusy(true)
    try {
      const neu = await shopStripeApi.setKeys({
        ...(secretKey.trim() ? { secret_key: secretKey.trim() } : {}),
        ...(webhookSecret.trim() ? { webhook_secret: webhookSecret.trim() } : {}),
        ...(publishableKey.trim() ? { publishable_key: publishableKey.trim() } : {}),
      })
      setStatus(neu)
      onStatusChange?.(neu)
      setSecretKey('')
      setWebhookSecret('')
      setPublishableKey(neu.publishable_key ?? '')
      toast.success(t('settings.shop.stripe.gespeichert'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.stripe.fehler'),
      )
    } finally {
      setBusy(false)
    }
  }

  const konfiguriert = status?.configured === true

  return (
    <section
      className={
        flat
          ? 'space-y-4'
          : 'msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="font-headline text-base font-semibold text-on-surface">
            {t('settings.shop.zahlungen.titel')}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {laedt ? (
            <Spinner size="sm" />
          ) : (
            <Badge variant={konfiguriert ? 'success' : 'warning'}>
              {konfiguriert
                ? t('settings.shop.stripe.konfiguriert')
                : t('settings.shop.stripe.nichtKonfiguriert')}
            </Badge>
          )}
          {konfiguriert && (
            <Badge variant="info">{t(modusKey(status?.mode ?? 'unknown'))}</Badge>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
        {t('settings.shop.stripe.text')}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="stripe-secret" className="block text-sm font-semibold text-on-surface">
            {t('settings.shop.stripe.secretKey')}
          </label>
          <Input
            id="stripe-secret"
            type="password"
            autoComplete="off"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            placeholder={t('settings.shop.stripe.secretKeyHinweis')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="stripe-webhook" className="block text-sm font-semibold text-on-surface">
            {t('settings.shop.stripe.webhookSecret')}
          </label>
          <Input
            id="stripe-webhook"
            type="password"
            autoComplete="off"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
            placeholder={t('settings.shop.stripe.webhookSecretHinweis')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="stripe-publishable" className="block text-sm font-semibold text-on-surface">
            {t('settings.shop.stripe.publishableKey')}
          </label>
          <Input
            id="stripe-publishable"
            autoComplete="off"
            value={publishableKey}
            onChange={(event) => setPublishableKey(event.target.value)}
            placeholder="pk_"
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold text-on-surface">
            {t('settings.shop.stripe.webhookUrl')}
          </span>
          <code className="block overflow-x-auto rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
            {apiUrl('/api/shop/stripe/webhook')}
          </code>
          <p className="text-label-sm text-on-surface-variant">
            {t('settings.shop.stripe.webhookUrlHinweis')}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Button variant="primary" onClick={speichern} disabled={busy}>
          {t('settings.shop.stripe.speichern')}
        </Button>
      </div>
    </section>
  )
}
