import { useTranslation } from 'react-i18next'
import {
  ImagePlus,
  Package,
  Puzzle,
  ReceiptText,
  ShoppingBag,
  SlidersHorizontal,
  Webhook,
} from 'lucide-react'
import { Badge } from '@maunting/ui'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { ShopPlansEditor } from './ShopPlansEditor'
import { StripeZahlungenKarte } from './StripeZahlungenKarte'

const KARTEN = [
  {
    titelKey: 'settings.shop.allgemein.titel',
    textKey: 'settings.shop.allgemein.text',
    icon: SlidersHorizontal,
  },
  {
    titelKey: 'settings.shop.rechnungen.titel',
    textKey: 'settings.shop.rechnungen.text',
    icon: ReceiptText,
  },
  {
    titelKey: 'settings.shop.produkte.titel',
    textKey: 'settings.shop.produkte.text',
    icon: Package,
  },
  {
    titelKey: 'settings.shop.bilder.titel',
    textKey: 'settings.shop.bilder.text',
    icon: ImagePlus,
  },
  {
    titelKey: 'settings.shop.addons.titel',
    textKey: 'settings.shop.addons.text',
    icon: Puzzle,
  },
  {
    titelKey: 'settings.shop.bestellungen.titel',
    textKey: 'settings.shop.bestellungen.text',
    icon: ShoppingBag,
  },
  {
    titelKey: 'settings.shop.webhooks.titel',
    textKey: 'settings.shop.webhooks.text',
    icon: Webhook,
  },
]

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
        <div className="flex flex-wrap gap-2">
          <Badge variant={aktiv ? 'success' : 'warning'}>
            {aktiv ? t('settings.shop.aktiv') : t('settings.shop.inaktiv')}
          </Badge>
          <Badge variant="warning">{t('settings.shop.demo')}</Badge>
        </div>
      </div>

      <StripeZahlungenKarte />

      <div className="border-t border-outline-variant/30 pt-6">
        <ShopPlansEditor />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {KARTEN.map(({ titelKey, textKey, icon: Icon }) => (
          <section
            key={titelKey}
            className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="font-headline text-base font-semibold text-on-surface">
                  {t(titelKey)}
                </h3>
              </div>
              <Badge variant="warning">{t('settings.shop.phase2')}</Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
              {t(textKey)}
            </p>
          </section>
        ))}
      </div>
    </div>
  )
}
