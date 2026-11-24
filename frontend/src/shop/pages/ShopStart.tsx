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
import { HeroShowcase, type ShopDdosHighlight } from '../components/HeroShowcase'
import { KatalogSchiene } from '../components/KatalogSchiene'
import { ShopNewsTeaser } from '../components/ShopNewsTeaser'
import { SpielKarte } from '../components/SpielKarte'
import { StandortPingDeck } from '../components/StandortPingDeck'
import { TrustSection, type ShopDdosSummary } from '../components/TrustSection'
import { formatEuro } from '../preis'
import { useShopReveal } from '../useShopReveal'
import { useShopStandortStore } from '../shopStandortStore'
import { useShopKatalog } from '../useShopKatalog'

type KatalogFilter = 'alle' | 'verfuegbar' | 'mods'
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
  const [badges, setBadges] = useState<ShopPublicBadgePromo[]>([])
  const [nodeStatuses, setNodeStatuses] = useState<ShopPublicNodeStatusDto[]>([])
  const [publicPolicy, setPublicPolicy] = useState<ShopPublicPolicyDto | null>(null)
  const ausgewaehlteNodeId = useShopStandortStore((s) => s.ausgewaehlteNodeId)
  const setAusgewaehlteNodeId = useShopStandortStore((s) => s.setAusgewaehlteNodeId)
  const pingWerte = useShopStandortStore((s) => s.pingMsByNodeId)
  const setPingWerte = useShopStandortStore((s) => s.setPingWerte)
  const [pingBusy, setPingBusy] = useState(false)

  const pingTesten = async () => {
    const onlineNodes = nodeStatuses.filter((n) => n.status === 'online')
    if (onlineNodes.length === 0 || pingBusy) return
    setPingBusy(true)
    const gemessen: Record<number, { ms: number | null; direkt: boolean }> = {}
    await Promise.all(
      onlineNodes.map(async (node) => {
        if (node.public_ping_url) {
          const start = performance.now()
          try {
            await fetch(node.public_ping_url, { mode: 'no-cors', cache: 'no-store' })
            const ms = Math.max(1, Math.round(performance.now() - start))
            gemessen[node.id] = { ms, direkt: true }
            return
          } catch (err) {
            still(err, 'ShopStart.pingPublicUrl')
          }
        }
        if (shopCatalogApi.pingNode) {
          const start = performance.now()
          try {
            const res = await shopCatalogApi.pingNode(node.id)
            const elapsed = Math.max(1, Math.round(performance.now() - start))
            const ms =
              res.server_agent_rtt_ms != null && res.server_agent_rtt_ms > 0
                ? Math.round(res.server_agent_rtt_ms)
                : elapsed
            gemessen[node.id] = { ms, direkt: false }
            return
          } catch (err) {
            still(err, 'ShopStart.pingNode')
          }
        }
        gemessen[node.id] = { ms: null, direkt: false }
      }),
    )
    setPingWerte(gemessen)
    setPingBusy(false)
  }

  const { besterPingNodeId, bestPingMs } = useMemo(() => {
    let bestId: number | null = null
    let bestMs = Infinity
    for (const [idStr, eintrag] of Object.entries(pingWerte)) {
      if (eintrag.ms != null && eintrag.ms < bestMs) {
        bestMs = eintrag.ms
        bestId = Number(idStr)
      }
    }
    return {
      besterPingNodeId: bestId,
      bestPingMs: Number.isFinite(bestMs) ? bestMs : null,
    }
  }, [pingWerte])

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
    return spiele.filter((spiel) => {
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
  }, [suche, filter, plattformFilter, spiele])

  const renderAddonVorteile = (addon: ShopCatalogAddon) =>
    formatAddonBenefits(addon, t, sprache)

  const onlineNodesCount = nodeStatuses.filter((n) => n.status === 'online').length
  const gewaehlterStandort = nodeStatuses.find((n) => n.id === ausgewaehlteNodeId)
  const standortGewaehltName = gewaehlterStandort
    ? gewaehlterStandort.location_label || gewaehlterStandort.name
    : null

  const ddosSummary: ShopDdosSummary = useMemo(() => {
    const providers = new Set<string>()
    const profiles = new Set<string>()
    let gameAware = false
    for (const node of nodeStatuses) {
      if (node.ddos_game_aware) gameAware = true
      if (node.ddos_provider) providers.add(node.ddos_provider)
      if (node.ddos_profile) profiles.add(node.ddos_profile)
    }
    for (const spiel of spiele) {
      if (spiel.ddosGameAware) gameAware = true
      if (spiel.ddosProvider) providers.add(spiel.ddosProvider)
      if (spiel.ddosProfile) profiles.add(spiel.ddosProfile)
    }
    return {
      gameAware,
      providers: [...providers],
      profiles: [...profiles],
    }
  }, [nodeStatuses, spiele])

  const ddosHighlight: ShopDdosHighlight | null = useMemo(() => {
    if (!ddosSummary.gameAware && ddosSummary.providers.length === 0) return null
    return {
      gameAware: ddosSummary.gameAware,
      provider: ddosSummary.providers[0] ?? null,
      profile: ddosSummary.profiles[0] ?? null,
    }
  }, [ddosSummary])

  useShopReveal(`${spiele.length}-${nodeStatuses.length}-${addons.length}`)

  const filterTabs: Array<{ id: KatalogFilter; label: string }> = [
    { id: 'alle', label: t('shop.sammlung.alleSpiele') },
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
        standortGewaehltName={standortGewaehltName}
        onlineNodesCount={onlineNodesCount}
        ddosHighlight={ddosHighlight}
      />

      <TrustSection
        onlineNodesCount={onlineNodesCount}
        bestPingMs={bestPingMs}
        publicPolicy={publicPolicy}
        ddosSummary={ddosSummary}
      />

      <KatalogSchiene
        id="shop-meistgemietet"
        kicker={t('shop.katalog.meistgemietetKicker')}
        titel={t('shop.katalog.meistgemietetTitel')}
        beschreibung={t('shop.katalog.meistgemietetText')}
        spiele={bestsellerSpiele}
        rabattFuerSpiel={rabattFuerSpiel}
      />

      <KatalogSchiene
        id="shop-empfohlen"
        kicker={t('shop.katalog.empfohlenKicker')}
        titel={t('shop.katalog.empfohlenTitel')}
        beschreibung={t('shop.katalog.empfohlenText')}
        spiele={empfohleneSpiele}
        rabattFuerSpiel={rabattFuerSpiel}
      />

      <KatalogSchiene
        id="shop-neu"
        kicker={t('shop.katalog.neuKicker')}
        titel={t('shop.katalog.neuTitel')}
        beschreibung={t('shop.katalog.neuText')}
        spiele={neueSpiele}
        rabattFuerSpiel={rabattFuerSpiel}
      />

      <StandortPingDeck
        nodeStatuses={nodeStatuses}
        ausgewaehlteNodeId={ausgewaehlteNodeId}
        onSelectNode={(nodeId) => setAusgewaehlteNodeId(nodeId)}
        pingWerte={pingWerte}
        besterPingNodeId={besterPingNodeId}
        pingBusy={pingBusy}
        onRunPingTest={() => void pingTesten()}
      />

      <section
        id="shop-spiele"
        data-shop-reveal
        className="msm-shop-reveal msm-shop-reveal-fallback mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8"
      >
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

          {spiele.length > 0 && (
            <div
              className="mt-2.5 flex flex-wrap justify-center gap-1.5"
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
          </div>
        </section>
      )}
    </>
  )
}
