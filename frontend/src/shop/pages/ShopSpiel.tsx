import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { Badge, Dropdown, Spinner, Zustandsflaeche } from '@maunting/ui'
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
import { formatEuro } from '../preis'
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
  const [nodeStatuses, setNodeStatuses] = useState<ShopPublicNodeStatusDto[]>([])
  const [nodeAvailability, setNodeAvailability] = useState<
    Record<number, ShopNodeAvailabilityItem>
  >({})
  const ausgewaehlteNodeId = useShopStandortStore((s) => s.ausgewaehlteNodeId)
  const setAusgewaehlteNodeId = useShopStandortStore((s) => s.setAusgewaehlteNodeId)
  const pingMsByNodeId = useShopStandortStore((s) => s.pingMsByNodeId)

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
      standortName: treffer.location_label || treffer.name,
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
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
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
            {aktuellesSpiel.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
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
            nodeStatuses={sichtbareNodes}
            nodeAvailabilityById={nodeAvailability}
            pingMsByNodeId={pingMsByNodeId}
            onSelectStandort={handleSelectStandort}
          />
        </div>

        <PreisPanel
          spiel={aktuellesSpiel}
          konfiguration={aktuelleKonfiguration}
          verfuegbar={verfuegbar}
          onWeiter={weiter}
          aboRabattProzent={publicPolicy?.subscription_discount_percent ?? 0}
          erstattungTage={publicPolicy?.refund_guarantee_days ?? 0}
          erstattungHinweis={publicPolicy?.refund_policy_note ?? ''}
        />
      </div>
    </section>
  )
}
