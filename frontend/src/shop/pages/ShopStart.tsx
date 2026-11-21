import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Search } from 'lucide-react'
import { Badge, buttonClasses, Zustandsflaeche } from '@maunting/ui'
import { shopCatalogApi, type ShopPublicBadgePromo } from '@/api/shop'
import { PANEL_HOME } from '@/lib/panelWege'
import { SpielKarte } from '../components/SpielKarte'
import { formatEuro } from '../preis'
import { useShopKatalog } from '../useShopKatalog'

export function ShopStart() {
  const { t } = useTranslation()
  const { spiele, tarifeFuer, quelle } = useShopKatalog()
  const [suche, setSuche] = useState('')
  const [badges, setBadges] = useState<ShopPublicBadgePromo[]>([])

  useEffect(() => {
    const fetchPromos = shopCatalogApi.getPromos
    if (!fetchPromos) return
    let aktiv = true
    void fetchPromos()
      .then((res) => {
        if (aktiv) setBadges(res?.badges ?? [])
      })
      .catch(() => {
        if (aktiv) setBadges([])
      })
    return () => {
      aktiv = false
    }
  }, [])

  const rabattFuerSpiel = (spielId: string): string | null => {
    if (badges.length === 0) return null
    const tarife = tarifeFuer(spielId)
    const planIds = new Set(tarife.map((tItem) => tItem.plan.id))
    const passend = badges.find((badge) => {
      if (badge.scope === 'addons') return false
      if (badge.target_plan_ids.length === 0) return true
      return badge.target_plan_ids.some((id) => planIds.has(id))
    })
    if (!passend) return null
    return passend.discount_type === 'percent'
      ? `${passend.discount_value} %`
      : formatEuro(passend.discount_value)
  }

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    if (!begriff) return spiele
    return spiele.filter((spiel) => {
      const text = [spiel.name, spiel.category, ...spiel.tags].join(' ').toLowerCase()
      return text.includes(begriff)
    })
  }, [suche, spiele])

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-outline-variant/30 bg-deep-grid">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          {quelle === 'mock' && <Badge variant="warning">{t('shop.demo.badge')}</Badge>}
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {t('shop.hero.kicker')}
          </p>
          <h1 className="mt-3 max-w-3xl font-headline text-4xl font-extrabold leading-tight tracking-tight text-on-surface sm:text-5xl lg:text-6xl">
            {t('shop.hero.titel')}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-on-surface-variant sm:text-lg">
            {t('shop.hero.untertitel')}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#shop-spiele" className={buttonClasses('primary', 'lg', 'gap-2')}>
              {t('shop.hero.ctaSammlung')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link to={PANEL_HOME} className={buttonClasses('secondary', 'lg')}>
              {t('shop.hero.ctaPanel')}
            </Link>
          </div>

          <dl className="mt-12 grid max-w-2xl grid-cols-3 gap-4 border-t border-outline-variant/30 pt-6">
            {[
              { wert: String(spiele.length), label: t('shop.hero.statSpiele') },
              { wert: '50+', label: t('shop.hero.statBlueprints') },
              { wert: '3', label: t('shop.hero.statSetup') },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="text-xs text-on-surface-variant">{stat.label}</dt>
                <dd className="font-headline text-2xl font-extrabold text-primary">{stat.wert}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="shop-spiele" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-headline text-2xl font-bold text-on-surface">
              {t('shop.sammlung.titel')}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {t('shop.sammlung.untertitel')}
            </p>
          </div>
          <label className="relative block w-full sm:w-80">
            <span className="sr-only">{t('shop.sammlung.suche')}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
              aria-hidden="true"
            />
            <input
              type="search"
              value={suche}
              onChange={(event) => setSuche(event.target.value)}
              placeholder={t('shop.sammlung.suche')}
              className="msm-input w-full pl-9"
            />
          </label>
        </div>

        <div className="mt-8">
          {gefiltert.length === 0 ? (
            <div className="msm-card rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low/60 p-8">
              <Zustandsflaeche
                art="leer"
                titel={t('shop.sammlung.leerTitel')}
                text={t('shop.sammlung.leerText')}
                ansagen
              />
            </div>
          ) : (
            <div className="msm-blueprint-grid">
              {gefiltert.map((spiel) => (
                <SpielKarte
                  key={spiel.id}
                  spiel={spiel}
                  rabattLabel={rabattFuerSpiel(spiel.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-outline-variant/30 bg-surface-container-low/40">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <h2 className="font-headline text-2xl font-bold text-on-surface">
            {t('shop.schritte.titel')}
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 font-headline text-sm font-bold text-primary">
                1
              </span>
              <h3 className="mt-4 font-headline text-base font-semibold text-on-surface">
                {t('shop.schritte.eins.titel')}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                {t('shop.schritte.eins.text')}
              </p>
            </div>
            <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 font-headline text-sm font-bold text-primary">
                2
              </span>
              <h3 className="mt-4 font-headline text-base font-semibold text-on-surface">
                {t('shop.schritte.zwei.titel')}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                {t('shop.schritte.zwei.text')}
              </p>
            </div>
            <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 font-headline text-sm font-bold text-primary">
                3
              </span>
              <h3 className="mt-4 font-headline text-base font-semibold text-on-surface">
                {t('shop.schritte.drei.titel')}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                {t('shop.schritte.drei.text')}
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
