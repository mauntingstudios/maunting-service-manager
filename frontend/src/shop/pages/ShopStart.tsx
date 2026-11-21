import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Bot,
  Check,
  Gamepad2,
  HardDrive,
  Receipt,
  Rocket,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  Zap,
} from 'lucide-react'
import { Badge, buttonClasses, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  shopCatalogApi,
  type ShopAddonCategory,
  type ShopCatalogAddon,
  type ShopPublicBadgePromo,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { useTageszeitMotiv } from '@/lib/tageszeit'
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
  const headerMotiv = useTageszeitMotiv('dashboard')
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

  const trustHighlights = [
    t('shop.hero.trust.sofortAktiv'),
    t('shop.hero.trust.backups'),
    t('shop.hero.trust.kontrolle'),
    t('shop.hero.trust.preise'),
  ]

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-white/10 bg-background">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <img
            src={headerMotiv.pfad}
            alt=""
            width={1920}
            height={1080}
            {...({ fetchpriority: 'high' } as Record<string, string>)}
            style={{ objectPosition: headerMotiv.position }}
            className="h-full w-full object-cover opacity-55"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundImage: headerMotiv.ueberlagerung }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/75 to-background/35" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-background/35" />
        </div>

        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7 xl:col-span-8">
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-label-sm font-semibold uppercase tracking-[0.2em] text-primary backdrop-blur-md">
                {t('shop.hero.kicker')}
              </p>
              <h1 className="mt-4 max-w-3xl font-headline text-4xl font-extrabold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-6xl">
                {t('shop.hero.titel')}
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
                {t('shop.hero.untertitel')}
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <a href="#shop-spiele" className={buttonClasses('primary', 'lg', 'gap-2 shadow-lg')}>
                  <Rocket className="h-4 w-4" aria-hidden="true" />
                  {t('shop.hero.ctaSammlung')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <a
                  href="#shop-addons"
                  className={buttonClasses(
                    'secondary',
                    'lg',
                    'gap-2 border-white/15 bg-surface-container-high/65 backdrop-blur-md hover:bg-surface-container-high/85',
                  )}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {t('shop.hero.ctaAddons')}
                </a>
              </div>

              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-white/80">
                {trustHighlights.map((punkt) => (
                  <li key={punkt} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span>{punkt}</span>
                  </li>
                ))}
              </ul>
            </div>

            <aside className="lg:col-span-5 xl:col-span-4 lg:justify-self-end w-full">
              <div className="w-full rounded-2xl border border-white/15 bg-surface-container-high/65 p-5 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3 pb-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-status-running/15">
                    <span className="h-2.5 w-2.5 rounded-full bg-status-running" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-headline text-sm font-bold text-white">
                      {t('shop.hero.statusTitel')}
                    </p>
                    <p className="text-xs text-status-running">
                      {t('shop.hero.statusBereit')}
                    </p>
                  </div>
                </div>

                <dl className="divide-y divide-white/10 border-t border-white/10">
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
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section id="shop-spiele" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <Gamepad2 className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-headline text-2xl font-bold text-on-surface">
                {t('shop.sammlung.titel')}
              </h2>
            </div>
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
            <ArrowRight className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
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
            <ArrowRight className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
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
            <ArrowRight className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section
        id="shop-addons"
        className="border-t border-white/10 bg-surface-container-low/30"
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
                    className="msm-card flex flex-col rounded-2xl border border-white/10 bg-surface-container-low/85 p-5 shadow-md"
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
        </div>
      </section>

      <section
        aria-label={t('shop.trustLeiste.titel')}
        className="border-t border-white/10 bg-background/80"
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
