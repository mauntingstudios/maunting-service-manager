import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { Badge, Dropdown, Spinner, Zustandsflaeche } from '@maunting/ui'
import { shopCatalogApi } from '@/api/shop'
import { still } from '@/lib/still'
import { SpielArtwork } from '../components/SpielArtwork'
import { Konfigurator } from '../components/Konfigurator'
import { PreisPanel } from '../components/PreisPanel'
import { formatEuro } from '../preis'
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
  const aktuelleKonfiguration =
    konfiguration ?? (ausgewaehlt ? standardKonfiguration(ausgewaehlt.spiel) : null)

  useEffect(() => {
    if (ausgewaehlt) {
      setKonfiguration(standardKonfiguration(ausgewaehlt.spiel))
      setKapazitaetFrei(null)
    }
  }, [ausgewaehlt?.plan.id])

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
    })
      .then((res) => {
        if (aktiv) setKapazitaetFrei(res.available)
      })
      .catch((err: unknown) => {
        still(err, 'shopSpiel.availability')
      })
    return () => {
      aktiv = false
    }
  }, [ausgewaehlt?.plan.id, aktuelleKonfiguration?.ramGb, aktuelleKonfiguration?.cpu])

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
            <SpielArtwork spiel={aktuellesSpiel} priority />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{aktuellesSpiel.category}</Badge>
              {aktuellesSpiel.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
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
          />
        </div>

        <PreisPanel
          spiel={aktuellesSpiel}
          konfiguration={aktuelleKonfiguration}
          verfuegbar={verfuegbar}
          onWeiter={weiter}
        />
      </div>
    </section>
  )
}
