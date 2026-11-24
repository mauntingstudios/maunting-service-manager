import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Clock,
  Newspaper,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Badge, Button, Dropdown, Spinner, Zustandsflaeche } from '@maunting/ui'
import { newsApi, type NewsPostPublic } from '@/api/news'
import {
  shopCatalogApi,
  type ShopNodeAvailabilityItem,
  type ShopPublicNodeStatusDto,
  type ShopPublicPolicyDto,
} from '@/api/shop'
import { still } from '@/lib/still'
import { SpielGalerie } from '../components/SpielGalerie'
import { Konfigurator } from '../components/Konfigurator'
import { PreisPanel } from '../components/PreisPanel'
import { berechneDdosSummary, extractSupportedPlatforms, PLATTFORM_LABELS } from '../ddosSummary'
import { messeNodePings } from '../pingNodes'
import { formatEuro } from '../preis'
import { standortAnzeigeName } from '../standortName'
import { useShopStandortStore } from '../shopStandortStore'
import { standardKonfiguration } from '../typen'
import type { KassenEntwurf, Konfiguration } from '../typen'
import { useShopKatalog } from '../useShopKatalog'

export function ShopSpiel() {
  const { spielId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { tarifeFuer, loading } = useShopKatalog()
  const tarife = spielId ? tarifeFuer(spielId) : []
  const [tarifId, setTarifId] = useState<number | null>(null)
  const ausgewaehlt = tarife.find((tarif) => tarif.plan.id === tarifId) ?? tarife[0]
  const spiel = ausgewaehlt?.spiel ?? null
  const [konfiguration, setKonfiguration] = useState<Konfiguration | null>(() =>
    spiel ? standardKonfiguration(spiel) : null,
  )
  const [kapazitaetFrei, setKapazitaetFrei] = useState<boolean | null>(null)
  const [publicPolicy, setPublicPolicy] = useState<ShopPublicPolicyDto | null>(null)
  const [gameNews, setGameNews] = useState<NewsPostPublic[]>([])
  const [nodeStatuses, setNodeStatuses] = useState<ShopPublicNodeStatusDto[]>([])
  const [nodeAvailability, setNodeAvailability] = useState<
    Record<number, ShopNodeAvailabilityItem>
  >({})
  const ausgewaehlteNodeId = useShopStandortStore((s) => s.ausgewaehlteNodeId)
  const setAusgewaehlteNodeId = useShopStandortStore((s) => s.setAusgewaehlteNodeId)
  const pingMsByNodeId = useShopStandortStore((s) => s.pingMsByNodeId)
  const setPingWerte = useShopStandortStore((s) => s.setPingWerte)
  const [pingBusy, setPingBusy] = useState(false)

  const runPingTest = async () => {
    const onlineNodes = nodeStatuses.filter((n) => n.status === 'online')
    if (onlineNodes.length === 0 || pingBusy) return
    setPingBusy(true)
    const gemessen = await messeNodePings(nodeStatuses, 'ShopSpiel')
    setPingWerte(gemessen)
    setPingBusy(false)
  }

  useEffect(() => {
    let aktiv = true
    const fetchPolicy = shopCatalogApi.getPublicPolicy
    if (!fetchPolicy) return
    fetchPolicy()
      .then((policy) => {
        if (aktiv) setPublicPolicy(policy)
      })
      .catch((err) => {
        still(err, 'ShopSpiel.getPublicPolicy')
      })
    return () => {
      aktiv = false
    }
  }, [])

  useEffect(() => {
    if (!spiel?.id || typeof newsApi?.listPublic !== 'function') {
      setGameNews([])
      return
    }
    let aktiv = true
    newsApi
      .listPublic({ game_type: spiel.id, limit: 3 })
      .then((res) => {
        if (aktiv) setGameNews(Array.isArray(res?.items) ? res.items : [])
      })
      .catch((err) => {
        still(err, 'ShopSpiel.getGameNews')
        if (aktiv) setGameNews([])
      })
    return () => {
      aktiv = false
    }
  }, [spiel?.id])

  useEffect(() => {
    let aktiv = true
    const fetchNodes = shopCatalogApi.getNodeStatus
    if (!fetchNodes) return
    fetchNodes()
      .then((rows) => {
        if (aktiv && Array.isArray(rows)) setNodeStatuses(rows)
      })
      .catch((err) => {
        still(err, 'ShopSpiel.getNodeStatus')
      })
    return () => {
      aktiv = false
    }
  }, [])

  const aktuelleKonfiguration =
    konfiguration ?? (ausgewaehlt ? standardKonfiguration(ausgewaehlt.spiel) : null)

  const standortFelder = (nodeId: number | null) => {
    if (nodeId == null) {
      return {
        preferredNodeId: null,
        standortName: null,
        standortAufpreisCent: 0,
      }
    }
    const treffer = nodeStatuses.find((n) => n.id === nodeId)
    if (!treffer) {
      return {
        preferredNodeId: null,
        standortName: null,
        standortAufpreisCent: 0,
      }
    }
    return {
      preferredNodeId: treffer.id,
      standortName: standortAnzeigeName(treffer, t('shop.nodeStatus.standardStandort')),
      standortAufpreisCent: Math.max(0, treffer.shop_surcharge_cents ?? 0),
    }
  }

  useEffect(() => {
    if (!ausgewaehlt) return
    const erlaubt =
      ausgewaehlteNodeId != null &&
      (Object.keys(nodeAvailability).length === 0 ||
        Boolean(nodeAvailability[ausgewaehlteNodeId]))
    const felder = standortFelder(erlaubt ? ausgewaehlteNodeId : null)
    setKonfiguration({
      ...standardKonfiguration(ausgewaehlt.spiel),
      ...felder,
    })
    setKapazitaetFrei(null)
  }, [ausgewaehlt?.plan.id])

  useEffect(() => {
    if (!ausgewaehlt) return
    const erlaubt =
      ausgewaehlteNodeId != null &&
      (Object.keys(nodeAvailability).length === 0 ||
        Boolean(nodeAvailability[ausgewaehlteNodeId]))
    const felder = standortFelder(erlaubt ? ausgewaehlteNodeId : null)
    setKonfiguration((prev) => {
      const basis = prev ?? standardKonfiguration(ausgewaehlt.spiel)
      if (
        basis.preferredNodeId === felder.preferredNodeId &&
        basis.standortName === felder.standortName &&
        (basis.standortAufpreisCent ?? 0) === felder.standortAufpreisCent
      ) {
        return prev
      }
      return { ...basis, ...felder }
    })
  }, [ausgewaehlteNodeId, nodeStatuses, nodeAvailability, ausgewaehlt?.plan.id])

  useEffect(() => {
    if (!ausgewaehlt || !aktuelleKonfiguration) return
    const checkFn = shopCatalogApi.checkAvailability
    if (!checkFn) {
      setKapazitaetFrei(ausgewaehlt.plan.available !== false)
      return
    }
    let aktiv = true
    void checkFn({
      plan_id: ausgewaehlt.plan.id,
      ram_mb: aktuelleKonfiguration.ramGb * 1024,
      cpu: aktuelleKonfiguration.cpu,
      ...(aktuelleKonfiguration.preferredNodeId != null
        ? { preferred_node_id: aktuelleKonfiguration.preferredNodeId }
        : {}),
    })
      .then((res) => {
        if (!aktiv) return
        setKapazitaetFrei(res.available)
        if (Array.isArray(res.nodes)) {
          const map: Record<number, ShopNodeAvailabilityItem> = {}
          for (const item of res.nodes) {
            map[item.node_id] = item
          }
          setNodeAvailability(map)
        }
      })
      .catch((err: unknown) => {
        still(err, 'shopSpiel.availability')
      })
    return () => {
      aktiv = false
    }
  }, [
    ausgewaehlt?.plan.id,
    aktuelleKonfiguration?.ramGb,
    aktuelleKonfiguration?.cpu,
    aktuelleKonfiguration?.preferredNodeId,
  ])

  const sichtbareNodes = useMemo(() => {
    if (Object.keys(nodeAvailability).length === 0) return nodeStatuses
    return nodeStatuses.filter((n) => Boolean(nodeAvailability[n.id]))
  }, [nodeStatuses, nodeAvailability])

  const handleSelectStandort = (nodeId: number | null) => {
    setAusgewaehlteNodeId(nodeId)
    const felder = standortFelder(nodeId)
    setKonfiguration((prev) => {
      const basis =
        prev ?? (ausgewaehlt ? standardKonfiguration(ausgewaehlt.spiel) : null)
      return basis ? { ...basis, ...felder } : basis
    })
  }

  if (!ausgewaehlt || !aktuelleKonfiguration) {
    if (loading) {
      return (
        <section className="mx-auto flex max-w-3xl items-center justify-center gap-3 px-4 py-20 text-sm text-on-surface-variant">
          <Spinner size="sm" />
          {t('shop.spiel.laedt')}
        </section>
      )
    }
    return (
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <Zustandsflaeche
          art="fehler"
          titel={t('shop.spiel.nichtGefundenTitel')}
          text={t('shop.spiel.nichtGefundenText')}
        />
        <div className="mt-6 text-center">
          <Link to="/" className="text-sm font-semibold text-primary hover:underline">
            {t('shop.spiel.zurueck')}
          </Link>
        </div>
      </section>
    )
  }

  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const aktuellesSpiel = ausgewaehlt.spiel
  const verfuegbar = kapazitaetFrei ?? (ausgewaehlt.plan.available !== false)
  const plattformen = extractSupportedPlatforms(aktuellesSpiel.platforms)
  const gewaehlterNode = nodeStatuses.find((n) => n.id === aktuelleKonfiguration.preferredNodeId)
  const storyText = aktuellesSpiel.story?.[sprache] || aktuellesSpiel.beschreibung[sprache]
  const setupMinuten = Math.max(1, Math.round((aktuellesSpiel.geschaetzteSetupSekunden ?? 120) / 60))
  const nodesDdosSummary = berechneDdosSummary(sichtbareNodes)
  const ddosHighlightLabel = (() => {
    const formatNodeDdos = (gameAware: boolean, provider: string | null) => {
      if (!gameAware && !provider) return null
      if (gameAware) {
        return provider
          ? t('shop.spiel.inklusiveDdosMitAnbieter', { provider })
          : t('shop.spiel.inklusiveDdosGameAware')
      }
      return provider
        ? t('shop.spiel.inklusiveDdosProvider', { provider })
        : t('shop.spiel.inklusiveDdos')
    }
    if (gewaehlterNode) {
      return formatNodeDdos(
        Boolean(gewaehlterNode.ddos_game_aware),
        gewaehlterNode.ddos_provider || null,
      )
    }
    if (sichtbareNodes.length > 0) {
      if (nodesDdosSummary.coverage === 'none') return null
      if (nodesDdosSummary.coverage === 'partial') return t('shop.spiel.inklusiveDdosTeilweise')
      if (nodesDdosSummary.coverage === 'mixed') {
        return t('shop.spiel.inklusiveDdosJeStandort', {
          providers: nodesDdosSummary.providers.join(' · '),
        })
      }
      return formatNodeDdos(nodesDdosSummary.allGameAware, nodesDdosSummary.providers[0] ?? null)
    }
    return formatNodeDdos(
      Boolean(aktuellesSpiel.ddosGameAware),
      aktuellesSpiel.ddosProvider || null,
    )
  })()

  const weiter = () => {
    if (!verfuegbar) return
    const entwurf: KassenEntwurf = {
      spielId: aktuellesSpiel.id,
      tarifId: ausgewaehlt.plan.id,
      konfiguration: aktuelleKonfiguration,
    }
    const qs = new URLSearchParams()
    const coupon = searchParams.get('coupon')
    const appReturn = searchParams.get('app_return')
    if (coupon) qs.set('coupon', coupon)
    if (appReturn) qs.set('app_return', appReturn)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    navigate(`/shop/${aktuellesSpiel.id}/kasse${suffix}`, { state: entwurf })
  }

  return (
    <section id="shop-spiel-kopf" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Link
        to="/"
        className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-on-surface-variant hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('shop.spiel.zurueck')}
      </Link>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <div className="overflow-hidden rounded-2xl border border-outline-variant/30">
            <SpielGalerie spiel={aktuellesSpiel} priority />
          </div>

          <div>
            {(aktuellesSpiel.promoHighlightText ||
              plattformen.length > 0 ||
              aktuellesSpiel.tags.length > 0) && (
              <div className="flex flex-wrap items-center gap-2">
                {aktuellesSpiel.promoHighlightText && (
                  <Badge variant="success" className="gap-1">
                    <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{aktuellesSpiel.promoHighlightText}</span>
                  </Badge>
                )}
                {plattformen.map((tag) => (
                  <Badge key={tag} variant="default">
                    {PLATTFORM_LABELS[tag]}
                  </Badge>
                ))}
                {aktuellesSpiel.tags.map((tag) => (
                  <Badge key={tag} variant="info">
                    {tag === 'Mods'
                      ? t('shop.spiel.modsInklusive')
                      : tag === 'Workshop'
                        ? t('shop.spiel.workshopInklusive')
                        : tag}
                  </Badge>
                ))}
              </div>
            )}
            <h1 className="mt-4 font-headline text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
              {aktuellesSpiel.name}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-on-surface-variant">
              {aktuellesSpiel.beschreibung[sprache]}
            </p>

            {tarife.length > 1 && (
              <label className="mt-5 block max-w-sm space-y-1.5">
                <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                  {t('shop.spiel.tarif')}
                </span>
                <Dropdown
                  value={String(ausgewaehlt.plan.id)}
                  onChange={(wert) => setTarifId(Number(wert))}
                  options={tarife.map((tarif) => ({
                    value: String(tarif.plan.id),
                    label: `${tarif.plan.name} · ${formatEuro(tarif.plan.price_cents)}`,
                  }))}
                  aria-label={t('shop.spiel.tarif')}
                />
              </label>
            )}
          </div>

          <Konfigurator
            spiel={aktuellesSpiel}
            konfiguration={aktuelleKonfiguration}
            onChange={setKonfiguration}
            aboRabattProzent={publicPolicy?.subscription_discount_percent ?? 0}
            shortDurationTiers={
              publicPolicy?.shop_short_durations_enabled
                ? (publicPolicy.shop_short_duration_tiers ?? [])
                : []
            }
            nodeStatuses={sichtbareNodes}
            nodeAvailabilityById={nodeAvailability}
            pingMsByNodeId={pingMsByNodeId}
            onSelectStandort={handleSelectStandort}
            pingBusy={pingBusy}
            onRunPingTest={
              nodeStatuses.some((n) => n.status === 'online')
                ? () => void runPingTest()
                : undefined
            }
          />
        </div>

        <PreisPanel
          spiel={aktuellesSpiel}
          konfiguration={aktuelleKonfiguration}
          verfuegbar={verfuegbar}
          onWeiter={weiter}
          aboRabattProzent={publicPolicy?.subscription_discount_percent ?? 0}
          shortDurationTiers={
            publicPolicy?.shop_short_durations_enabled
              ? (publicPolicy.shop_short_duration_tiers ?? [])
              : []
          }
          erstattungTage={publicPolicy?.refund_guarantee_days ?? 0}
          erstattungHinweis={publicPolicy?.refund_policy_note ?? ''}
        />
      </div>

      <article className="relative isolate mt-10 overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low shadow-2xl">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          {aktuellesSpiel.bildUrl && (
            <img
              src={aktuellesSpiel.bildUrl}
              alt=""
              width={1600}
              height={640}
              loading="lazy"
              className="h-full w-full object-cover object-center opacity-30"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/88 to-background/70" />
          <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-transparent to-background/60" />
        </div>

        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:p-10">
          <div className="space-y-4">
            <p className="text-label-sm font-semibold uppercase tracking-[0.18em] text-primary">
              {t('shop.spiel.ueberSpielEyebrow')}
            </p>
            <h2 className="font-headline text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {t('shop.spiel.ueberSpielTitel', { name: aktuellesSpiel.name })}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-on-surface sm:text-base">
              {storyText}
            </p>

            {(aktuellesSpiel.genres?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {aktuellesSpiel.genres?.map((genre) => (
                  <Badge key={genre} variant="default">
                    {genre}
                  </Badge>
                ))}
              </div>
            )}

            <div className="pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('shop.spiel.zurueckZumKonfigurator')}</span>
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-background/75 p-4 backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-status-running">
                {t('shop.spiel.hostingHighlightsTitel')}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-on-surface sm:text-sm">
                {ddosHighlightLabel && (
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-status-running" aria-hidden="true" />
                    <span>{ddosHighlightLabel}</span>
                  </li>
                )}
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{t('shop.spiel.inklusiveBackups')}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{t('shop.spiel.setupDauer', { minuten: setupMinuten })}</span>
                </li>
              </ul>
            </div>

            {gameNews.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-background/75 p-4 backdrop-blur-xl">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                    <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t('shop.spiel.passendeNews')}</span>
                  </p>
                  <Link
                    to="/news"
                    className="inline-flex items-center gap-1 text-xs font-medium text-on-surface-variant hover:text-primary"
                  >
                    <span>{t('news.alleAnsehen')}</span>
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </div>
                <ul className="mt-2.5 space-y-1.5">
                  {gameNews.map((item) => (
                    <li key={item.slug}>
                      <Link
                        to={`/news/${item.slug}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-xs text-on-surface transition-colors hover:bg-surface-container-high hover:text-primary sm:text-sm"
                      >
                        <span className="truncate font-medium">{item.title}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </article>
    </section>
  )
}
