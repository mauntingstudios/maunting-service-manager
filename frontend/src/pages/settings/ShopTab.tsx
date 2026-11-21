import { useTranslation } from 'react-i18next'
import { Badge } from '@maunting/ui'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { ShopAddonsEditor } from './ShopAddonsEditor'
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
        <ShopAddonsEditor />
      </div>

      <div className="border-t border-outline-variant/30 pt-6">
        <ShopBetriebKarten />
      </div>
    </div>
  )
}
