import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Plug,
  ReceiptText,
  ShoppingBag,
  SlidersHorizontal,
  Store,
} from 'lucide-react'
import { Badge, TabBar, type TabDef } from '@maunting/ui'
import { shopAdminApi, shopSellerApi, shopStripeApi } from '@/api/shop'
import { still } from '@/lib/still'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { HosterTab } from './HosterTab'
import { SellerDatenKarte } from './SellerDatenKarte'
import { ShopAddonsEditor } from './ShopAddonsEditor'
import {
  ShopInvoicesSection,
  ShopOrdersSection,
  ShopOverviewSection,
  ShopWebhooksSection,
  useShopBetriebData,
  type ShopSectionId,
} from './ShopBetriebKarten'
import { ShopCouponsEditor } from './ShopCouponsEditor'
import { ShopLifecycleKarte } from './ShopLifecycleKarte'
import { ShopPlansEditor } from './ShopPlansEditor'
import { StripeZahlungenKarte } from './StripeZahlungenKarte'

type CatalogSubTabId = 'plans' | 'addons' | 'coupons'
export type ShopSubTabId = ShopSectionId | 'hoster'

export interface ShopTabProps {
  canReadHoster?: boolean
  canWriteHoster?: boolean
  initialTab?: ShopSubTabId
}

const CATALOG_TABS: TabDef<CatalogSubTabId>[] = [
  { id: 'plans', labelKey: 'settings.shop.catalogTabs.plans' },
  { id: 'addons', labelKey: 'settings.shop.catalogTabs.addons' },
  { id: 'coupons', labelKey: 'settings.shop.catalogTabs.coupons' },
]

export function ShopTab({ canReadHoster = false, canWriteHoster = false, initialTab }: ShopTabProps = {}) {
  const { t } = useTranslation()
  const aktiv = usePublicSettingsStore((s) => s.shop_enabled)
  const resolvedInitialTab: ShopSubTabId =
    initialTab === 'hoster' && !canReadHoster ? 'overview' : (initialTab ?? 'overview')
  const [activeTab, setActiveTab] = useState<ShopSubTabId>(resolvedInitialTab)
  const [catalogTab, setCatalogTab] = useState<CatalogSubTabId>('plans')
  const betrieb = useShopBetriebData()

  useEffect(() => {
    if (!initialTab) return
    setActiveTab(initialTab === 'hoster' && !canReadHoster ? 'overview' : initialTab)
  }, [initialTab, canReadHoster])

  useEffect(() => {
    if (activeTab === 'hoster' && !canReadHoster) {
      setActiveTab('overview')
    }
  }, [activeTab, canReadHoster])

  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null)
  const [sellerMissingCount, setSellerMissingCount] = useState<number | null>(null)
  const [activePlanCount, setActivePlanCount] = useState<number | null>(null)

  useEffect(() => {
    let montiert = true
    void shopStripeApi
      .status()
      .then((res) => {
        if (montiert && res && typeof res.configured === 'boolean') {
          setStripeConfigured(res.configured)
        }
      })
      .catch((err: unknown) => {
        still(err, 'ShopTab.stripeStatus')
        if (montiert) setStripeConfigured(false)
      })
    void shopSellerApi
      .get()
      .then((res) => {
        if (montiert && res && Array.isArray(res.missing_fields)) {
          setSellerMissingCount(res.missing_fields.length)
        }
      })
      .catch((err: unknown) => {
        still(err, 'ShopTab.sellerStatus')
        if (montiert) setSellerMissingCount(null)
      })
    void shopAdminApi
      .listPlans()
      .then((plans) => {
        if (montiert && Array.isArray(plans)) {
          setActivePlanCount(plans.filter((p) => p.active).length)
        }
      })
      .catch((err: unknown) => {
        still(err, 'ShopTab.planCount')
        if (montiert) setActivePlanCount(0)
      })
    return () => {
      montiert = false
    }
  }, [])

  const offeneBestellungen = useMemo(() => {
    return betrieb.orders.filter(
      (order) =>
        order.status === 'pending_payment' ||
        order.status === 'failed' ||
        order.entitlements.some((ent) => ent.provisioning_status === 'failed'),
    ).length
  }, [betrieb.orders])

  const hauptTabs = useMemo<TabDef<ShopSubTabId>[]>(
    () => [
      { id: 'overview', labelKey: 'settings.shop.tabs.overview', icon: LayoutDashboard },
      { id: 'catalog', labelKey: 'settings.shop.tabs.catalog', icon: Store },
      {
        id: 'orders',
        labelKey: 'settings.shop.tabs.orders',
        icon: ShoppingBag,
        ...(offeneBestellungen > 0 ? { badge: offeneBestellungen } : {}),
      },
      { id: 'accounting', labelKey: 'settings.shop.tabs.accounting', icon: ReceiptText },
      { id: 'setup', labelKey: 'settings.shop.tabs.setup', icon: SlidersHorizontal },
      ...(canReadHoster
        ? [{ id: 'hoster' as const, labelKey: 'settings.tabs.hoster', icon: Plug }]
        : []),
    ],
    [offeneBestellungen, canReadHoster],
  )

  const aktiverTabLabel =
    activeTab === 'hoster' ? t('settings.tabs.hoster') : t(`settings.shop.tabs.${activeTab}`)

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

      <div className="border-b border-outline-variant/25 pb-1">
        <TabBar
          tabs={hauptTabs}
          active={activeTab}
          onChange={setActiveTab}
          variante="underline"
          einzeilig
          ariaLabel={t('settings.shop.tabs.aria')}
        />
      </div>

      <div role="tabpanel" aria-label={aktiverTabLabel}>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <ShopOverviewSection
              data={betrieb}
              stripeConfigured={stripeConfigured}
              sellerMissingCount={sellerMissingCount}
              activePlanCount={activePlanCount}
              onNavigate={setActiveTab}
            />
            <p className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-4 py-2.5 text-xs text-on-surface-variant">
              {t('settings.shop.unifiedHint')}
            </p>
          </div>
        )}

        {activeTab === 'catalog' && (
          <div className="space-y-6">
            <div>
              <TabBar
                tabs={CATALOG_TABS}
                active={catalogTab}
                onChange={setCatalogTab}
                embedded
                kompakt
                einzeilig
                ariaLabel={t('settings.shop.catalogTabs.aria')}
              />
            </div>

            <div role="tabpanel" aria-label={t(`settings.shop.catalogTabs.${catalogTab}`)}>
              {catalogTab === 'plans' && (
                <ShopPlansEditor
                  onPlansLoaded={(plans) =>
                    setActivePlanCount(plans.filter((p) => p.active).length)
                  }
                />
              )}
              {catalogTab === 'addons' && <ShopAddonsEditor />}
              {catalogTab === 'coupons' && <ShopCouponsEditor />}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-6">
            <ShopOrdersSection data={betrieb} />
          </div>
        )}

        {activeTab === 'accounting' && (
          <div className="space-y-8">
            <ShopInvoicesSection data={betrieb} />
            <div className="border-t border-outline-variant/25 pt-6">
              <SellerDatenKarte
                flat
                onSaved={(daten) => setSellerMissingCount(daten.missing_fields.length)}
              />
            </div>
          </div>
        )}

        {activeTab === 'setup' && (
          <div className="space-y-8">
            <StripeZahlungenKarte
              flat
              onStatusChange={(status) => setStripeConfigured(status.configured)}
            />
            <div className="border-t border-outline-variant/25 pt-6">
              <ShopLifecycleKarte flat />
            </div>
            <div className="border-t border-outline-variant/25 pt-6">
              <ShopWebhooksSection data={betrieb} />
            </div>
          </div>
        )}

        {activeTab === 'hoster' && canReadHoster && (
          <HosterTab canWrite={canWriteHoster} />
        )}
      </div>
    </div>
  )
}
