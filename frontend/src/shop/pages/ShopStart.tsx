import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bot, HardDrive, Search, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { Badge, buttonClasses, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  shopCatalogApi,
  type ShopAddonCategory,
  type ShopCatalogAddon,
  type ShopPublicBadgePromo,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { PANEL_HOME } from '@/lib/panelWege'
import { still } from '@/lib/still'
import { SpielKarte } from '../components/SpielKarte'
import { formatEuro } from '../preis'
import { useShopKatalog } from '../useShopKatalog'

function addonKategorieLabelKey(category: ShopAddonCategory): string {
  switch (category) {
    case 'ai_quota':
      return 'settings.shop.addons.kategorie.ai_quota'
    case 'slots':
      return 'settings.shop.addons.kategorie.slots'
    case 'backups':
      return 'settings.shop.addons.kategorie.backups'
    case 'storage':
      return 'settings.shop.addons.kategorie.storage'
    case 'role':
    default:
      return 'settings.shop.addons.kategorie.role'
  }
}

export function ShopStart() {
  const { t } = useTranslation()
  const location = useLocation()
  const { spiele, addons, tarifeFuer, loading, fehler } = useShopKatalog()
  const canManageShop =
    useHasPermission('shop.write') || useHasPermission('panel.settings.write')
  const [suche, setSuche] = useState('')
  const [kategorie, setKategorie] = useState<string>('alle')
  const [badges, setBadges] = useState<ShopPublicBadgePromo[]>([])

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

  const kategorien = useMemo(() => {
    const werte = Array.from(new Set(spiele.map((s) => s.category).filter(Boolean)))
    werte.sort((a, b) => a.localeCompare(b))
    return werte
  }, [spiele])

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
      if (kategorie !== 'alle' && spiel.category !== kategorie) return false
      if (!begriff) return true
      const text = [spiel.name, spiel.category, ...spiel.tags].join(' ').toLowerCase()
      return text.includes(begriff)
    })
  }, [suche, kategorie, spiele])

  const renderAddonVorteile = (addon: ShopCatalogAddon) => {
    const zeilen: string[] = []
    if (addon.extra_ai_tokens) {
      zeilen.push(t('shop.addons.aiTokens', { wert: addon.extra_ai_tokens.toLocaleString('de-DE') }))
    }
    if (addon.extra_slots) {
      zeilen.push(t('shop.addons.extraSlots', { count: addon.extra_slots }))
    }
    if (addon.extra_backups) {
      zeilen.push(t('shop.addons.extraBackups', { count: addon.extra_backups }))
    }
    if (addon.extra_storage_mb) {
      const gb = Math.max(1, Math.round(addon.extra_storage_mb / 1024))
      zeilen.push(t('shop.addons.extraStorage', { gb }))
    }
    if (addon.grants_role) {
      zeilen.push(t('shop.addons.grantsRole'))
    }
    return zeilen
  }

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-outline-variant/30 bg-deep-grid">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
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
            <a href="#shop-addons" className={buttonClasses('secondary', 'lg', 'gap-2')}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t('shop.hero.ctaAddons')}
            </a>
            <Link to={PANEL_HOME} className={buttonClasses('ghost', 'lg')}>
              {t('shop.hero.ctaPanel')}
            </Link>
          </div>

          <dl className="mt-12 grid max-w-2xl grid-cols-3 gap-4 border-t border-outline-variant/30 pt-6">
            {[
              { wert: String(spiele.length), label: t('shop.hero.statSpiele') },
              { wert: String(addons.length), label: t('shop.hero.statAddons') },
              { wert: '3', label: t('shop.hero.statSetup') },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="text-xs text-on-surface-variant">{stat.label}</dt>
                <dd className="font-headline text-2xl font-extrabold tabular-nums text-primary">
                  {stat.wert}
                </dd>
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

        {kategorien.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('shop.sammlung.kategorien')}>
            <button
              type="button"
              onClick={() => setKategorie('alle')}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                kategorie === 'alle'
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {t('shop.sammlung.alleKategorien')}
            </button>
            {kategorien.map((kat) => (
              <button
                key={kat}
                type="button"
                onClick={() => setKategorie(kat)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  kategorie === kat
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {kat}
              </button>
            ))}
          </div>
        )}

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
            <div className="msm-blueprint-grid">
              {gefiltert.map((spiel, index) => (
                <SpielKarte
                  key={spiel.id}
                  spiel={spiel}
                  priority={index < 2}
                  rabattLabel={rabattFuerSpiel(spiel.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section
        id="shop-addons"
        className="border-t border-outline-variant/30 bg-surface-container-low/30"
      >
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-headline text-2xl font-bold text-on-surface">
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
                    className="msm-card flex flex-col rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
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
                            {t(addonKategorieLabelKey(addon.category))}
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
                      <ul className="mt-3 space-y-1 text-xs text-on-surface">
                        {vorteile.map((zeile) => (
                          <li key={zeile}>· {zeile}</li>
                        ))}
                      </ul>
                    )}

                    <footer className="mt-auto flex items-center justify-between gap-3 border-t border-outline-variant/25 pt-4">
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
