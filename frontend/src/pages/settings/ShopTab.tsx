import { useTranslation } from 'react-i18next'
import { Puzzle } from 'lucide-react'
import { Badge } from '@maunting/ui'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { ShopPlansEditor } from './ShopPlansEditor'
import { SellerDatenKarte } from './SellerDatenKarte'
import { StripeZahlungenKarte } from './StripeZahlungenKarte'
import { ShopBetriebKarten } from './ShopBetriebKarten'

export function ShopTab() {
  const { t } = useTranslation()
  const aktiv = usePublicSettingsStore((s) => s.shop_enabled)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">
            {t('settings.shop.titel')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
            {t('settings.shop.untertitel')}
          </p>
        </div>
        <Badge variant={aktiv ? 'success' : 'warning'}>
          {aktiv ? t('settings.shop.aktiv') : t('settings.shop.inaktiv')}
        </Badge>
      </div>

      <StripeZahlungenKarte />
      <SellerDatenKarte />

      <div className="border-t border-outline-variant/30 pt-6">
        <ShopPlansEditor />
      </div>

      <div className="border-t border-outline-variant/30 pt-6">
        <ShopBetriebKarten />
      </div>

      <section className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
              <Puzzle className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="font-headline text-base font-semibold text-on-surface">
              {t('settings.shop.addons.titel')}
            </h3>
          </div>
          <Badge variant="default">{t('settings.shop.phase3')}</Badge>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
          {t('settings.shop.addons.text')}
        </p>
      </section>
    </div>
  )
}
