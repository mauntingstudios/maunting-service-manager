import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Bot,
  Check,
  Gamepad2,
  HardDrive,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Badge, buttonClasses, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  shopCatalogApi,
  type ShopAddonCategory,
  type ShopCatalogAddon,
  type ShopPublicBadgePromo,
  type ShopPublicNodeStatusDto,
  type ShopPublicPolicyDto,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { useTageszeitMotiv } from '@/lib/tageszeit'
import { formatAddonBenefits } from '../addonBenefits'
import { berechneDdosSummary } from '../ddosSummary'
import { HeroShowcase } from '../components/HeroShowcase'
import { PreisAuszeichnung } from '../components/PreisAuszeichnung'
import { ShopNewsTeaser } from '../components/ShopNewsTeaser'
import { SpielKarte } from '../components/SpielKarte'
import { TrustSection } from '../components/TrustSection'
import { formatEuro } from '../preis'
import { useShopReveal } from '../useShopReveal'
import { useShopKatalog } from '../useShopKatalog'

type KatalogFilter =
  | 'alle'
  | 'bestseller'
  | 'empfohlen'
  | 'neu'
  | 'verfuegbar'
  | 'mods'
type PlattformFilter = 'alle' | 'pc' | 'ps5' | 'xbox' | 'crossplay'

function addonKategorieLabelKey(category: ShopAddonCategory): string {
  switch (category) {
    case 'ai_quota':
      return 'settings.shop.addons.katAiQuota'
    case 'slots':
      return 'settings.shop.addons.katSlots'
    case 'backups':
      return 'settings.shop.addons.katBackups'
    case 'storage':
      return 'settings.shop.addons.katStorage'
    case 'role':
    default:
      return 'settings.shop.addons.katRole'
  }
}

export function ShopStart() {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const location = useLocation()
  const headerMotiv = useTageszeitMotiv('dashboard')
  const { spiele, addons, tarifeFuer, loading, fehler } = useShopKatalog()
  const canManageShop =
    useHasPermission('shop.write') || useHasPermission('panel.settings.write')
  const [suche, setSuche] = useState('')
  const [filter, setFilter] = useState<KatalogFilter>('alle')
  const [plattformFilter, setPlattformFilter] = useState<PlattformFilter>('alle')
  const [alleSpieleOffen, setAlleSpieleOffen] = useState(false)
  const [badges, setBadges] = useState<ShopPublicBadgePromo[]>([])
  const [nodeStatuses, setNodeStatuses] = useState<ShopPublicNodeStatusDto[]>([])
  const [publicPolicy, setPublicPolicy] = useState<ShopPublicPolicyDto | null>(null)

  useEffect(() => {
    let aktiv = true
    const fetchNodes = shopCatalogApi.getNodeStatus
    if (fetchNodes) {
      fetchNodes()
        .then((rows) => {
          if (aktiv && Array.isArray(rows)) setNodeStatuses(rows)
        })
        .catch((err) => {
          still(err, 'ShopStart.getNodeStatus')
        })
    }
    const fetchPolicy = shopCatalogApi.getPublicPolicy
    if (fetchPolicy) {
      fetchPolicy()
        .then((policy) => {
          if (aktiv && policy) setPublicPolicy(policy)
        })
        .catch((err) => {
          still(err, 'ShopStart.getPublicPolicy')
        })
    }
    return () => {
      aktiv = false
    }
  }, [])

  useEffect(() => {
    if (!location.hash) return
    const target = document.getElementById(location.hash.slice(1))
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' })
    }
  }, [location.hash])

  useEffect(() => {
    const fetchPromos = shopCatalogApi.getPromos
    if (!fetchPromos) return
    let aktiv = true
    void fetchPromos()
      .then((res) => {
        if (aktiv) setBadges(res?.badges ?? [])
      })
      .catch((err: unknown) => {
        still(err, 'shopStart.promos')
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

  const rabattFuerAddons = useMemo((): string | null => {
    const passend = badges.find(
      (badge) => badge.scope === 'all' || badge.scope === 'addons',
    )
    if (!passend) return null
    return passend.discount_type === 'percent'
      ? `${passend.discount_value} %`
      : formatEuro(passend.discount_value)
  }, [badges])

  const bestsellerSpiele = useMemo(() => {
    return [...spiele]
      .filter((s) => Boolean(s.isBestseller) || (s.recentOrderCount ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.recentOrderCount ?? 0) - (a.recentOrderCount ?? 0) ||
          Number(Boolean(b.isBestseller)) - Number(Boolean(a.isBestseller)),
      )
  }, [spiele])

  const empfohleneSpiele = useMemo(
    () => spiele.filter((s) => Boolean(s.isFeatured)),
    [spiele],
  )

  const neueSpiele = useMemo(
    () => spiele.filter((s) => Boolean(s.isNew)),
    [spiele],
  )

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    const treffer = spiele.filter((spiel) => {
      if (filter === 'bestseller' && !spiel.isBestseller && (spiel.recentOrderCount ?? 0) === 0) {
        return false
      }
      if (filter === 'empfohlen' && !spiel.isFeatured) return false
      if (filter === 'neu' && !spiel.isNew) return false
      if (filter === 'verfuegbar' && spiel.verfuegbar === false) return false
      if (filter === 'mods' && !spiel.unterstuetztMods && !spiel.unterstuetztWorkshop) {
        return false
      }
      if (
        plattformFilter !== 'alle' &&
        !(spiel.platforms ?? ['pc']).includes(plattformFilter)
      ) {
        return false
      }
      if (!begriff) return true
      const text = [spiel.name, ...spiel.tags].join(' ').toLowerCase()
      return text.includes(begriff)
    })

    if (filter === 'bestseller') {
      return [...treffer].sort(
        (a, b) =>
          (b.recentOrderCount ?? 0) - (a.recentOrderCount ?? 0) ||
          Number(Boolean(b.isBestseller)) - Number(Boolean(a.isBestseller)),
      )
    }
    return [...treffer].sort(
      (a, b) =>
        Number(Boolean(b.pinnedInHero)) - Number(Boolean(a.pinnedInHero)) ||
        (b.recentOrderCount ?? 0) - (a.recentOrderCount ?? 0) ||
        Number(Boolean(b.isBestseller)) - Number(Boolean(a.isBestseller)) ||
        Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured)) ||
        a.name.localeCompare(b.name),
    )
  }, [suche, filter, plattformFilter, spiele])

  const renderAddonVorteile = (addon: ShopCatalogAddon) =>
    formatAddonBenefits(addon, t, sprache)

  const onlineNodesCount = nodeStatuses.filter((n) => n.status === 'online').length
  const ddosSummary = useMemo(() => berechneDdosSummary(nodeStatuses), [nodeStatuses])

  const hatAktivenFilter =
    Boolean(suche.trim()) || filter !== 'alle' || plattformFilter !== 'alle'
  const sichtbareSpiele =
    hatAktivenFilter || alleSpieleOffen ? gefiltert : gefiltert.slice(0, 8)

  useShopReveal(`${spiele.length}-${nodeStatuses.length}-${addons.length}`)

  const filterTabs: Array<{ id: KatalogFilter; label: string }> = [
    { id: 'alle', label: t('shop.sammlung.alleSpiele') },
    ...(bestsellerSpiele.length > 0
      ? [{ id: 'bestseller' as const, label: t('shop.katalog.badgeBestseller') }]
      : []),
    ...(empfohleneSpiele.length > 0
      ? [{ id: 'empfohlen' as const, label: t('shop.katalog.badgeFeatured') }]
      : []),
    ...(neueSpiele.length > 0
      ? [{ id: 'neu' as const, label: t('shop.katalog.badgeNeu') }]
      : []),
    { id: 'verfuegbar', label: t('shop.sammlung.sofortVerfuegbar') },
    { id: 'mods', label: t('shop.sammlung.mitMods') },
  ]
  const plattformTabs: Array<{ id: PlattformFilter; label: string }> = [
    { id: 'alle', label: t('shop.sammlung.plattformAlle') },
    { id: 'pc', label: 'PC' },
    { id: 'ps5', label: 'PS5' },
    { id: 'xbox', label: 'Xbox' },
    { id: 'crossplay', label: 'Crossplay' },
  ]

  return (
    <>
      <HeroShowcase
        spiele={spiele}
        badges={badges}
        tarifIdsFuerSpiel={(id) => tarifeFuer(id).map((item) => item.plan.id)}
        headerMotiv={headerMotiv}
        onlineNodesCount={onlineNodesCount}
        ddosSummary={ddosSummary}
        heroMode={publicPolicy?.shop_hero_mode ?? 'auto_paid'}
        shortDurationPolicy={publicPolicy}
      />

      <TrustSection
        onlineNodesCount={onlineNodesCount}
        publicPolicy={publicPolicy}
        ddosSummary={ddosSummary}
      />

      <section
        id="shop-spiele"
        data-shop-reveal
        className="msm-shop-reveal msm-shop-reveal-fallback mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-status-running/35 bg-status-running/10 px-3 py-1 text-label-sm font-semibold text-status-running">
                <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('shop.sammlung.eyebrow')}</span>
              </div>
              <h2 className="mt-2.5 font-headline text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
                {t('shop.sammlung.titel')}
              </h2>
              <p className="mt-1 text-sm text-on-surface-variant sm:text-base">
                {t('shop.sammlung.untertitel')}
              </p>
            </div>

            <label className="relative block w-full lg:max-w-xs">
              <span className="sr-only">{t('shop.sammlung.suche')}</span>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                aria-hidden="true"
              />
              <input
                type="search"
                value={suche}
                onChange={(event) => setSuche(event.target.value)}
                placeholder={t('shop.sammlung.suche')}
                className="msm-input w-full pl-10"
              />
            </label>
          </div>

          {spiele.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-container-low/65 p-3.5 lg:flex-row lg:items-center lg:justify-between">
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={t('shop.sammlung.kategorien')}
              >
                {filterTabs.map((tab) => {
                  const aktiv = filter === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      aria-pressed={aktiv}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                        aktiv
                          ? 'border-primary/55 bg-primary/15 text-primary'
                          : 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {tab.label}
                    </button>
                  )
                })}
              </div>

              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={t('shop.sammlung.plattformFilter')}
              >
                {plattformTabs.map((ptab) => {
                  const aktiv = plattformFilter === ptab.id
                  return (
                    <button
                      key={ptab.id}
                      type="button"
                      onClick={() => setPlattformFilter(ptab.id)}
                      aria-pressed={aktiv}
                      className={`rounded-full border px-3 py-1 text-label-sm font-semibold transition-colors ${
                        aktiv
                          ? 'border-primary/55 bg-primary/15 text-primary'
                          : 'border-outline-variant/35 bg-surface-container-low/70 text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {ptab.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-sm text-on-surface-variant">
              <Spinner size="sm" />
              <span>{t('shop.spiel.laedt')}</span>
            </div>
          ) : gefiltert.length === 0 ? (
            <div className="msm-card rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low/60 p-8 text-center">
              <Zustandsflaeche
                art={fehler ? 'fehler' : 'leer'}
                titel={
                  fehler
                    ? t('shop.sammlung.fehlerTitel')
                    : spiele.length === 0
                      ? t('shop.sammlung.keineTarifeTitel')
                      : t('shop.sammlung.leerTitel')
                }
                text={
                  fehler
                    ? t('shop.sammlung.fehlerText')
                    : spiele.length === 0
                      ? t('shop.sammlung.keineTarifeText')
                      : t('shop.sammlung.leerText')
                }
                ansagen
              />
              {spiele.length === 0 && canManageShop && !fehler && (
                <div className="mt-4">
                  <Link
                    to="/settings?tab=shop"
                    className={buttonClasses('primary', 'sm')}
                  >
                    {t('shop.sammlung.tarifeEinrichten')}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="msm-shop-poster-grid">
                {sichtbareSpiele.map((spiel) => (
                  <SpielKarte
                    key={spiel.id}
                    spiel={spiel}
                    rabattLabel={rabattFuerSpiel(spiel.id)}
                    shortDurationPolicy={publicPolicy}
                  />
                ))}
              </div>
              {!hatAktivenFilter && gefiltert.length > 8 && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setAlleSpieleOffen((alt) => !alt)}
                    className={buttonClasses('secondary', 'md', 'gap-2')}
                  >
                    <span>
                      {alleSpieleOffen
                        ? t('shop.sammlung.wenigerAnzeigen')
                        : t('shop.sammlung.alleAnzeigen', { count: gefiltert.length })}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <ShopNewsTeaser />

      {addons.length > 0 && (
        <section
          id="shop-addons"
          data-shop-reveal
          className="msm-shop-reveal msm-shop-reveal-fallback msm-shop-deferred border-t border-white/10 bg-surface-container-low/30"
        >
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-headline text-2xl font-bold text-on-surface sm:text-3xl">
                  {t('shop.addons.titel')}
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {t('shop.addons.untertitel')}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {addons.map((addon) => {
                const vorteile = renderAddonVorteile(addon)
                return (
                  <article
                    key={addon.id}
                    className="msm-card msm-shop-card-lift flex flex-col rounded-2xl border border-white/10 bg-surface-container-low/85 p-5 shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                          {addon.category === 'ai_quota' ? (
                            <Bot className="h-4 w-4" aria-hidden="true" />
                          ) : addon.category === 'role' ? (
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                          ) : addon.category === 'slots' ? (
                            <Users className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <HardDrive className="h-4 w-4" aria-hidden="true" />
                          )}
                        </span>
                        <div>
                          <h3 className="font-headline text-base font-bold text-on-surface">
                            {addon.name}
                          </h3>
                          <p className="text-xs text-on-surface-variant">
                            {addon.role_benefits?.role_name ||
                              t(addonKategorieLabelKey(addon.category))}
                          </p>
                        </div>
                      </div>
                      {rabattFuerAddons && (
                        <Badge variant="success">
                          {t('shop.karte.rabatt', { wert: rabattFuerAddons })}
                        </Badge>
                      )}
                    </div>

                    {addon.description && (
                      <p className="mt-3 text-sm text-on-surface-variant">
                        {addon.description}
                      </p>
                    )}

                    {vorteile.length > 0 && (
                      <ul className="mt-3 space-y-1.5 text-xs text-on-surface">
                        {vorteile.map((zeile) => (
                          <li key={zeile} className="flex items-start gap-1.5">
                            <Check
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-running"
                              aria-hidden="true"
                            />
                            <span>{zeile}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <footer className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                      <PreisAuszeichnung
                        variant="card"
                        cent={addon.price_cents}
                        einheit={`/ ${t('shop.preis.proMonat')}`}
                      />
                      <Link
                        to={`/shop/addon/${addon.id}/kasse`}
                        className={buttonClasses('primary', 'sm', 'gap-1.5')}
                      >
                        {t('shop.addons.buchen')}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </footer>
                  </article>
                )
              })}
            </div>
          </div>
        </section>
      )}
    </>
  )
}
