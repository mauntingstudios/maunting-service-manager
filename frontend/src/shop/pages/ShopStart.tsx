import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Bot,
  Check,
  Cpu,
  Gamepad2,
  HardDrive,
  Layers,
  Receipt,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'
import { Badge, buttonClasses, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  shopCatalogApi,
  type ShopAddonCategory,
  type ShopCatalogAddon,
  type ShopPublicBadgePromo,
  type ShopPublicNodeStatusDto,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { useTageszeitMotiv } from '@/lib/tageszeit'
import { formatAddonBenefits } from '../addonBenefits'
import { SpielKarte } from '../components/SpielKarte'
import { formatEuro } from '../preis'
import { motivFuer } from '../spielArtwork'
import { useShopKatalog } from '../useShopKatalog'

type KatalogFilter = 'alle' | 'verfuegbar' | 'mods'

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
  const [badges, setBadges] = useState<ShopPublicBadgePromo[]>([])
  const [ausgewaehltesHeroId, setAusgewaehltesHeroId] = useState<string | null>(null)
  const [nodeStatuses, setNodeStatuses] = useState<ShopPublicNodeStatusDto[]>([])

  useEffect(() => {
    let aktiv = true
    const fetchNodes = shopCatalogApi.getNodeStatus
    if (!fetchNodes) return
    fetchNodes()
      .then((rows) => {
        if (aktiv && Array.isArray(rows)) setNodeStatuses(rows)
      })
      .catch((err) => {
        still(err, 'ShopStart.getNodeStatus')
      })
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

  const featuredSpiele = useMemo(() => {
    if (spiele.length === 0) return []
    const verfuegbar = spiele.filter((s) => s.verfuegbar !== false)
    const pool = verfuegbar.length > 0 ? verfuegbar : spiele
    const mitBild = pool.filter((s) => Boolean(s.bildUrl))
    const ohneBild = pool.filter((s) => !s.bildUrl)
    return [...mitBild, ...ohneBild].slice(0, 5)
  }, [spiele])

  const heroSpiel = useMemo(() => {
    if (featuredSpiele.length === 0) return null
    return (
      featuredSpiele.find((s) => s.id === ausgewaehltesHeroId) ?? featuredSpiele[0]
    )
  }, [featuredSpiele, ausgewaehltesHeroId])

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

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    return spiele.filter((spiel) => {
      if (filter === 'verfuegbar' && spiel.verfuegbar === false) return false
      if (filter === 'mods' && !spiel.unterstuetztMods && !spiel.unterstuetztWorkshop) {
        return false
      }
      if (!begriff) return true
      const text = [spiel.name, ...spiel.tags].join(' ').toLowerCase()
      return text.includes(begriff)
    })
  }, [suche, filter, spiele])

  const renderAddonVorteile = (addon: ShopCatalogAddon) =>
    formatAddonBenefits(addon, t, sprache)

  const trustHighlights = [
    t('shop.hero.trust.sofortAktiv'),
    t('shop.hero.trust.backups'),
    t('shop.hero.trust.kontrolle'),
    t('shop.hero.trust.preise'),
  ]

  const heroBildSrc = heroSpiel?.bildUrl || headerMotiv.pfad
  const filterTabs: Array<{ id: KatalogFilter; label: string }> = [
    { id: 'alle', label: t('shop.sammlung.alleSpiele') },
    { id: 'verfuegbar', label: t('shop.sammlung.sofortVerfuegbar') },
    { id: 'mods', label: t('shop.sammlung.mitMods') },
  ]

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-white/10 bg-background">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <img
            src={heroBildSrc}
            alt=""
            width={1920}
            height={1080}
            {...({ fetchpriority: 'high' } as Record<string, string>)}
            style={heroSpiel?.bildUrl ? undefined : { objectPosition: headerMotiv.position }}
            className="h-full w-full object-cover opacity-50 transition-opacity duration-300"
          />
          {!heroSpiel?.bildUrl && (
            <div
              className="absolute inset-0"
              style={{ backgroundImage: headerMotiv.ueberlagerung }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/45" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-background/40" />
        </div>

        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <div className="grid items-center gap-8 lg:grid-cols-12">
            <div className="lg:col-span-7 xl:col-span-8">
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/15 px-3 py-1 text-label-sm font-semibold uppercase tracking-[0.2em] text-primary backdrop-blur-md">
                {t('shop.hero.kicker')}
              </p>
              <h1 className="mt-4 max-w-3xl font-headline text-4xl font-extrabold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-6xl">
                {t('shop.hero.titel')}
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
                {t('shop.hero.untertitel')}
              </p>

              {heroSpiel && (
                <div className="mt-6 inline-flex flex-wrap items-center gap-3 rounded-2xl border border-white/15 bg-surface-container-high/75 px-4 py-2.5 backdrop-blur-xl">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-primary">
                    {t('shop.hero.fokusSpiel')}
                  </span>
                  <span className="font-headline text-sm font-bold text-white">
                    {heroSpiel.name}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-on-surface-variant">
                    {t('shop.karte.abPreis', { preis: formatEuro(heroSpiel.grundpreisCent) })}
                  </span>
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                {heroSpiel ? (
                  <Link
                    to={`/shop/${heroSpiel.id}`}
                    className={buttonClasses('primary', 'lg', 'gap-2 shadow-lg')}
                  >
                    <Rocket className="h-4 w-4" aria-hidden="true" />
                    {t('shop.hero.ctaKonfigurieren', { name: heroSpiel.name })}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <a
                    href="#shop-spiele"
                    className={buttonClasses('primary', 'lg', 'gap-2 shadow-lg')}
                  >
                    <Rocket className="h-4 w-4" aria-hidden="true" />
                    {t('shop.hero.ctaSammlung')}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                )}
                <a
                  href="#shop-spiele"
                  className={buttonClasses(
                    'secondary',
                    'lg',
                    'gap-2 border-white/15 bg-surface-container-high/70 backdrop-blur-md hover:bg-surface-container-high/90',
                  )}
                >
                  <Gamepad2 className="h-4 w-4" aria-hidden="true" />
                  {t('shop.hero.ctaSammlung')}
                </a>
                <a
                  href="#shop-addons"
                  className={buttonClasses(
                    'ghost',
                    'lg',
                    'gap-2 border border-white/10 bg-white/5 text-white/90 backdrop-blur-md hover:bg-white/10',
                  )}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {t('shop.hero.ctaAddons')}
                </a>
              </div>

              <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-white/80">
                {trustHighlights.map((punkt) => (
                  <li key={punkt} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span>{punkt}</span>
                  </li>
                ))}
              </ul>
            </div>

            <aside className="w-full lg:col-span-5 xl:col-span-4">
              <div className="w-full overflow-hidden rounded-2xl border border-white/15 bg-surface-container-high/75 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-status-running/15">
                      <span
                        className="h-2 w-2 rounded-full bg-status-running"
                        aria-hidden="true"
                      />
                    </span>
                    <div>
                      <p className="font-headline text-sm font-bold text-white">
                        {t('shop.hero.statusTitel')}
                      </p>
                      <p className="text-label-sm text-status-running">
                        {t('shop.hero.statusBereit')}
                      </p>
                    </div>
                  </div>
                  {spiele.length > 0 && (
                    <span className="rounded-full border border-white/15 bg-background/80 px-2.5 py-0.5 text-label-sm font-semibold tabular-nums text-on-surface">
                      {t('shop.hero.statSpieleBadge', { count: spiele.length })}
                    </span>
                  )}
                </div>

                {featuredSpiele.length > 0 ? (
                  <div className="divide-y divide-white/10 p-2">
                    {featuredSpiele.map((spiel) => {
                      const aktiv = heroSpiel?.id === spiel.id
                      const motiv = motivFuer(spiel.motiv)
                      const Icon = motiv.icon
                      const rabatt = rabattFuerSpiel(spiel.id)
                      return (
                        <button
                          key={spiel.id}
                          type="button"
                          onClick={() => setAusgewaehltesHeroId(spiel.id)}
                          aria-pressed={aktiv}
                          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 ${
                            aktiv
                              ? 'bg-primary/15 text-white ring-1 ring-primary/45'
                              : 'text-on-surface hover:bg-white/5'
                          }`}
                        >
                          <div
                            className={`h-11 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br ${motiv.klassen}`}
                          >
                            {spiel.bildUrl ? (
                              <img
                                src={spiel.bildUrl}
                                alt=""
                                width={128}
                                height={72}
                                loading="lazy"
                                {...({ fetchpriority: 'low' } as Record<string, string>)}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Icon className="h-5 w-5 text-white/50" aria-hidden="true" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-headline text-sm font-bold text-white">
                              {spiel.name}
                            </p>
                            <p className="text-xs tabular-nums text-on-surface-variant">
                              {t('shop.karte.abPreis', {
                                preis: formatEuro(spiel.grundpreisCent),
                              })}
                            </p>
                          </div>
                          {rabatt && spiel.verfuegbar !== false && (
                            <Badge variant="success">-{rabatt}</Badge>
                          )}
                          {spiel.verfuegbar === false && (
                            <span className="rounded-full border border-status-warning/60 bg-background/90 px-2 py-0.5 text-label-sm font-semibold text-status-warning">
                              {t('shop.karte.ausverkauft')}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <dl className="divide-y divide-white/10 px-5 pb-4">
                    <div className="flex items-center gap-3 py-3.5">
                      <Gamepad2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <dt className="text-xs text-on-surface-variant">
                          {t('shop.hero.statSpiele')}
                        </dt>
                        <dd className="font-headline text-xl font-extrabold tabular-nums text-white">
                          {spiele.length}
                        </dd>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 py-3.5">
                      <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <dt className="text-xs text-on-surface-variant">
                          {t('shop.hero.statAddons')}
                        </dt>
                        <dd className="font-headline text-xl font-extrabold tabular-nums text-white">
                          {addons.length}
                        </dd>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-3.5">
                      <Zap className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <dt className="text-xs text-on-surface-variant">
                          {t('shop.hero.statBereitstellung')}
                        </dt>
                        <dd className="font-headline text-base font-bold text-white">
                          {t('shop.hero.statSofortWert')}
                        </dd>
                      </div>
                    </div>
                  </dl>
                )}
              </div>
            </aside>
          </div>
        </div>
      </section>

      {nodeStatuses.length > 0 && (
        <section
          aria-label={t('shop.nodeStatus.titel')}
          className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8"
        >
          <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-headline text-base font-bold text-on-surface">
                  {t('shop.nodeStatus.titel')}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {t('shop.nodeStatus.untertitel')}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nodeStatuses.map((node) => {
                const isOffline = node.load_level === 'offline' || node.status !== 'online'
                const isFull = !isOffline && (node.load_level === 'full' || node.load_level === 'high' || !node.accepting_orders)
                const badgeVariant = isOffline ? 'destructive' : isFull ? 'warning' : 'success'
                const badgeLabel = isOffline
                  ? t('shop.nodeStatus.offline')
                  : isFull
                    ? t('shop.nodeStatus.belegt')
                    : t('shop.nodeStatus.frei')
                return (
                  <div
                    key={node.id}
                    className="flex flex-col justify-between gap-2 rounded-xl border border-outline-variant/30 bg-surface-container p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-on-surface">
                          {node.location_label || node.name}
                        </p>
                        {node.location_label && node.location_label !== node.name && (
                          <p className="truncate text-xs text-on-surface-variant">{node.name}</p>
                        )}
                      </div>
                      <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                      {node.cpu_model && <span>{node.cpu_model}</span>}
                      {node.ram_type && <span>{node.ram_type}</span>}
                      {node.storage_type && <span>{node.storage_type}</span>}
                      {node.ram_free_percent != null && (
                        <span className="font-medium text-on-surface">
                          {t('shop.nodeStatus.ramFreiProzent', { percent: Math.round(node.ram_free_percent) })}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <section id="shop-spiele" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-status-running/35 bg-status-running/10 px-3 py-1 text-label-sm font-semibold text-status-running">
            <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('shop.sammlung.eyebrow')}</span>
          </div>
          <h2 className="mt-3 font-headline text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
            {t('shop.sammlung.titel')}
          </h2>
          <p className="mt-2 text-sm text-on-surface-variant sm:text-base">
            {t('shop.sammlung.untertitel')}
          </p>

          <label className="relative mx-auto mt-6 block max-w-lg">
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

          {spiele.length > 0 && (
            <div
              className="mt-4 flex flex-wrap justify-center gap-2"
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
          )}
        </div>

        <div className="mt-10">
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

      <section className="msm-shop-deferred border-t border-white/10 bg-surface-container-low/25">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-6">
            <p className="text-label-sm font-semibold uppercase tracking-[0.18em] text-primary">
              {t('shop.infra.kicker')}
            </p>
            <h2 className="mt-2 font-headline text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
              {t('shop.infra.titel')}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-on-surface-variant sm:text-base">
              {t('shop.infra.untertitel')}
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/10 bg-surface-container-low/80 p-3.5">
                <p className="font-headline text-xl font-extrabold tabular-nums text-primary">
                  {spiele.length}
                </p>
                <p className="mt-0.5 text-xs text-on-surface-variant">
                  {t('shop.hero.statSpiele')}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-surface-container-low/80 p-3.5">
                <p className="font-headline text-base font-bold text-on-surface">
                  {t('shop.infra.multiNodeWert')}
                </p>
                <p className="mt-0.5 text-xs text-on-surface-variant">
                  {t('shop.infra.multiNodeLabel')}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-surface-container-low/80 p-3.5">
                <p className="font-headline text-base font-bold text-on-surface">
                  Stripe
                </p>
                <p className="mt-0.5 text-xs text-on-surface-variant">
                  {t('shop.infra.abrechnungLabel')}
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="msm-card grid gap-3 rounded-2xl border border-white/10 bg-surface-container-low/85 p-5 shadow-xl sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-surface-container/60 p-4">
                <Server className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-2.5 font-headline text-sm font-bold text-on-surface">
                  {t('shop.infra.karten.nodesTitel')}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.infra.karten.nodesText')}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-surface-container/60 p-4">
                <Cpu className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-2.5 font-headline text-sm font-bold text-on-surface">
                  {t('shop.infra.karten.ressourcenTitel')}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.infra.karten.ressourcenText')}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-surface-container/60 p-4">
                <Wrench className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-2.5 font-headline text-sm font-bold text-on-surface">
                  {t('shop.infra.karten.modsTitel')}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.infra.karten.modsText')}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-surface-container/60 p-4">
                <Receipt className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-2.5 font-headline text-sm font-bold text-on-surface">
                  {t('shop.infra.karten.rechnungTitel')}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.infra.karten.rechnungText')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {spiele.length > 0 && (
        <section className="msm-shop-deferred border-t border-white/10 bg-surface-container/45">
          <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6 lg:px-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-label-sm font-semibold text-primary">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('shop.katalogBand.badge')}</span>
            </div>
            <h2 className="mt-3 font-headline text-2xl font-extrabold text-on-surface sm:text-3xl">
              {t('shop.katalogBand.titel', { count: spiele.length })}
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              {t('shop.katalogBand.text')}
            </p>
            <div className="mt-6">
              <a
                href="#shop-spiele"
                className={buttonClasses('secondary', 'md', 'gap-2')}
              >
                {t('shop.katalogBand.cta')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      )}

      <section
        id="shop-addons"
        className="msm-shop-deferred border-t border-white/10 bg-surface-container-low/30"
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

          {addons.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low/50 p-6 text-sm text-on-surface-variant">
              {t('shop.addons.leerText')}
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {addons.map((addon) => {
                const vorteile = renderAddonVorteile(addon)
                return (
                  <article
                    key={addon.id}
                    className="msm-card flex flex-col rounded-2xl border border-white/10 bg-surface-container-low/85 p-5 shadow-md"
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
                      <div>
                        <p className="font-headline text-lg font-extrabold tabular-nums text-primary">
                          {formatEuro(addon.price_cents)}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {t('shop.preis.proMonat')}
                        </p>
                      </div>
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
          )}

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <a
              href="#shop-spiele"
              className="group flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-surface-container-low/80 p-4 transition-all hover:border-primary/40 hover:bg-surface-container-high/60"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Gamepad2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-headline text-sm font-bold text-on-surface">
                    {t('shop.shortcuts.gameserver.titel')}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {t('shop.shortcuts.gameserver.text')}
                  </p>
                </div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </a>

            <a
              href="#shop-addons"
              className="group flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-surface-container-low/80 p-4 transition-all hover:border-primary/40 hover:bg-surface-container-high/60"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Bot className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-headline text-sm font-bold text-on-surface">
                    {t('shop.shortcuts.addons.titel')}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {t('shop.shortcuts.addons.text')}
                  </p>
                </div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </a>

            <Link
              to="/konto"
              className="group flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-surface-container-low/80 p-4 transition-all hover:border-primary/40 hover:bg-surface-container-high/60"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                  <User className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-headline text-sm font-bold text-on-surface">
                    {t('shop.shortcuts.konto.titel')}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {t('shop.shortcuts.konto.text')}
                  </p>
                </div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </section>

      <section className="msm-shop-deferred relative isolate overflow-hidden border-t border-white/10 bg-background">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <img
            src={headerMotiv.pfad}
            alt=""
            width={1920}
            height={1080}
            loading="lazy"
            style={{ objectPosition: headerMotiv.position }}
            className="h-full w-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/70" />
        </div>
        <div className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6 lg:px-8">
          <h2 className="font-headline text-2xl font-extrabold text-white sm:text-3xl">
            {t('shop.abschluss.titel')}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/80 sm:text-base">
            {t('shop.abschluss.text')}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href="#shop-spiele" className={buttonClasses('primary', 'lg', 'gap-2 shadow-lg')}>
              {t('shop.abschluss.cta')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link
              to="/konto"
              className={buttonClasses(
                'secondary',
                'lg',
                'border-white/15 bg-surface-container-high/75 backdrop-blur-md',
              )}
            >
              {t('shop.shortcuts.konto.titel')}
            </Link>
          </div>
        </div>
      </section>

      <section
        aria-label={t('shop.trustLeiste.titel')}
        className="msm-shop-deferred border-t border-white/10 bg-background/90"
      >
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-start gap-3">
              <Zap className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h3 className="font-headline text-sm font-bold text-on-surface">
                  {t('shop.trustLeiste.einrichtungTitel')}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.trustLeiste.einrichtungText')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h3 className="font-headline text-sm font-bold text-on-surface">
                  {t('shop.trustLeiste.backupsTitel')}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.trustLeiste.backupsText')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <SlidersHorizontal className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h3 className="font-headline text-sm font-bold text-on-surface">
                  {t('shop.trustLeiste.kontrolleTitel')}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.trustLeiste.kontrolleText')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h3 className="font-headline text-sm font-bold text-on-surface">
                  {t('shop.trustLeiste.preiseTitel')}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">
                  {t('shop.trustLeiste.preiseText')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
