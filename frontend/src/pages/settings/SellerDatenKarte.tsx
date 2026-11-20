import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2 } from 'lucide-react'
import { Badge, Button, Dropdown, Input, Spinner, Switch } from '@maunting/ui'
import { SanitizedApiError } from '@/api/client'
import { shopSellerApi, type ShopSellerSettingsDto } from '@/api/shop'
import { toast } from '@/stores/toastStore'

const LAND_OPTIONEN = [
  { value: 'DE', label: 'Deutschland' },
  { value: 'AT', label: 'Österreich' },
  { value: 'CH', label: 'Schweiz' },
]

export function SellerDatenKarte() {
  const { t } = useTranslation()
  const [daten, setDaten] = useState<ShopSellerSettingsDto | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let aktiv = true
    void shopSellerApi
      .get()
      .then((werte) => {
        if (aktiv) {
          setDaten(werte)
          setLaedt(false)
        }
      })
      .catch(() => {
        if (aktiv) setLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [])

  const setze = <K extends keyof ShopSellerSettingsDto>(feld: K, wert: ShopSellerSettingsDto[K]) => {
    setDaten((alt) => (alt ? { ...alt, [feld]: wert } : alt))
  }

  const speichern = async () => {
    if (busy || !daten) return
    setBusy(true)
    try {
      const { missing_fields: _ignored, ...payload } = daten
      const neu = await shopSellerApi.set(payload)
      setDaten(neu)
      toast.success(t('settings.shop.seller.gespeichert'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.seller.fehler'),
      )
    } finally {
      setBusy(false)
    }
  }

  const fehlt = daten?.missing_fields.length ?? 0

  return (
    <section className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="font-headline text-base font-semibold text-on-surface">
            {t('settings.shop.seller.titel')}
          </h3>
        </div>
        {laedt ? (
          <Spinner size="sm" />
        ) : (
          <Badge variant={fehlt ? 'warning' : 'success'}>
            {fehlt
              ? t('settings.shop.seller.unvollstaendig')
              : t('settings.shop.seller.vollstaendig')}
          </Badge>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
        {t('settings.shop.seller.text')}
      </p>
      {fehlt > 0 && daten && (
        <p className="mt-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-on-surface-variant">
          {t('settings.shop.seller.fehlend', { felder: daten.missing_fields.join(', ') })}
        </p>
      )}

      {daten && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.name')}
              </span>
              <Input value={daten.name} onChange={(e) => setze('name', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.strasse')}
              </span>
              <Input value={daten.street} onChange={(e) => setze('street', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.plz')}
              </span>
              <Input value={daten.postal_code} onChange={(e) => setze('postal_code', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.stadt')}
              </span>
              <Input value={daten.city} onChange={(e) => setze('city', e.target.value)} />
            </label>
            <div className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.land')}
              </span>
              <Dropdown
                value={daten.country}
                onChange={(wert) => setze('country', wert)}
                aria-label={t('settings.shop.seller.land')}
                options={LAND_OPTIONEN}
              />
            </div>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.email')}
              </span>
              <Input value={daten.email} onChange={(e) => setze('email', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.telefon')}
              </span>
              <Input value={daten.phone} onChange={(e) => setze('phone', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.ustId')}
              </span>
              <Input value={daten.vat_id} onChange={(e) => setze('vat_id', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.steuernummer')}
              </span>
              <Input value={daten.tax_number} onChange={(e) => setze('tax_number', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.iban')}
              </span>
              <Input value={daten.iban} onChange={(e) => setze('iban', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.bic')}
              </span>
              <Input value={daten.bic} onChange={(e) => setze('bic', e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.zahlungsziel')}
              </span>
              <Input
                type="number"
                min={0}
                max={365}
                value={String(daten.payment_terms_days)}
                onChange={(e) => setze('payment_terms_days', Number(e.target.value) || 0)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.seller.praefix')}
              </span>
              <Input
                value={daten.invoice_prefix}
                onChange={(e) => setze('invoice_prefix', e.target.value.toUpperCase())}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Switch
              checked={daten.small_business}
              onCheckedChange={(wert) => setze('small_business', wert)}
              aria-label={t('settings.shop.seller.kleinunternehmer')}
            />
            <span className="text-sm text-on-surface-variant">
              {t('settings.shop.seller.kleinunternehmer')}
            </span>
          </div>

          <div className="mt-4">
            <Button variant="primary" onClick={speichern} disabled={busy}>
              {t('settings.shop.seller.speichern')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
