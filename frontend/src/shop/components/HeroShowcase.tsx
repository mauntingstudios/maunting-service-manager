import { useEffect, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Check,
  Gamepad2,
  Pause,
  Play,
  Rocket,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { Badge, buttonClasses } from '@maunting/ui'
import type { ShopPublicBadgePromo } from '@/api/shop'
import type { HeaderHintergrundVariante } from '@/lib/tageszeit'
import { formatEuro } from '../preis'
import { motivFuer } from '../spielArtwork'
import type { ShopSpiel } from '../typen'

export interface ShopDdosHighlight {
  gameAware: boolean
  provider: string | null
  profile: string | null
}

interface HeroShowcaseProps {
  spiele: ShopSpiel[]
  badges: ShopPublicBadgePromo[]
  tarifIdsFuerSpiel: (spielId: string) => number[]
  headerMotiv: HeaderHintergrundVariante
  standortGewaehltName: string | null
  onlineNodesCount: number
  ddosHighlight?: ShopDdosHighlight | null
}

const PLATTFORM_LABELS: Record<string, string> = {
  pc: 'PC',
  ps5: 'PS5',
  xbox: 'Xbox',
  crossplay: 'Crossplay',
}

export function HeroShowcase({
  spiele,
  badges,
  tarifIdsFuerSpiel,
  headerMotiv,
  standortGewaehltName,
  onlineNodesCount,
  ddosHighlight,
}: HeroShowcaseProps) {
  const { t } = useTranslation()
  const [ausgewaehltesId, setAusgewaehltesId] = useState<string | null>(null)
  const [pausiert, setPausiert] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    return false
  })

  const topSpiele = (() => {
    if (spiele.length === 0) return []
    const verfuegbar = spiele.filter((s) => s.verfuegbar !== false)
    const pool = verfuegbar.length > 0 ? verfuegbar : spiele
    const sortiert = [...pool].sort((a, b) => {
      const aFeat = a.isFeatured ? 2 : a.bildUrl ? 1 : 0
      const bFeat = b.isFeatured ? 2 : b.bildUrl ? 1 : 0
      return bFeat - aFeat
    })
    return sortiert.slice(0, 5)
  })()

  const aktiverIndex = Math.max(
    0,
    ausgewaehltesId ? topSpiele.findIndex((s) => s.id === ausgewaehltesId) : 0,
  )
  const heroSpiel = topSpiele[aktiverIndex] ?? null

  useEffect(() => {
    if (pausiert || topSpiele.length <= 1) return
    const timer = window.setInterval(() => {
      setAusgewaehltesId((aktuell) => {
        const idx = aktuell ? topSpiele.findIndex((s) => s.id === aktuell) : 0
        const naechster = topSpiele[(idx + 1) % topSpiele.length]
        return naechster?.id ?? null
      })
    }, 7000)
    return () => window.clearInterval(timer)
  }, [pausiert, topSpiele])

  const rabattFuerSpiel = (spielId: string): string | null => {
    if (badges.length === 0) return null
    const ids = new Set(tarifIdsFuerSpiel(spielId))
    const passend = badges.find((badge) => {
      if (badge.scope === 'addons') return false
      if (badge.target_plan_ids.length === 0) return true
      return badge.target_plan_ids.some((id) => ids.has(id))
    })
    if (!passend) return null
    return passend.discount_type === 'percent'
      ? `${passend.discount_value} %`
      : formatEuro(passend.discount_value)
  }

  const handleSlideKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (topSpiele.length <= 1) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      const next = topSpiele[(index + 1) % topSpiele.length]
      if (next) setAusgewaehltesId(next.id)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = topSpiele[(index - 1 + topSpiele.length) % topSpiele.length]
      if (prev) setAusgewaehltesId(prev.id)
    }
  }

  const heroBildSrc = heroSpiel?.bildUrl || headerMotiv.pfad
  const trustHighlights = [
    t('shop.hero.trust.sofortAktiv'),
    t('shop.hero.trust.backups'),
    t('shop.hero.trust.kontrolle'),
    t('shop.hero.trust.preise'),
  ]
  const plattformen = (heroSpiel?.platforms ?? []).filter((p) => p in PLATTFORM_LABELS)
  const effectiveDdosGameAware = Boolean(heroSpiel?.ddosGameAware || ddosHighlight?.gameAware)
  const effectiveDdosProvider = heroSpiel?.ddosProvider || ddosHighlight?.provider || null
  const showDdosPill = effectiveDdosGameAware || Boolean(effectiveDdosProvider)

  return (
    <section className="relative isolate flex min-h-[540px] flex-col justify-between overflow-hidden border-b border-white/10 bg-background lg:min-h-[620px]">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <img
          key={heroBildSrc}
          src={heroBildSrc}
          alt=""
          width={1920}
          height={1080}
          {...({ fetchpriority: 'high' } as Record<string, string>)}
          style={heroSpiel?.bildUrl ? undefined : { objectPosition: headerMotiv.position }}
          className="msm-shop-hero-fade h-full w-full object-cover object-center"
        />
        {!heroSpiel?.bildUrl && (
          <div
            className="absolute inset-0"
            style={{ backgroundImage: headerMotiv.ueberlagerung }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/60 to-background/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-background/40" />
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pb-8 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pt-20">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/15 px-3 py-1 text-label-sm font-semibold uppercase tracking-[0.2em] text-primary backdrop-blur-md">
              {t('shop.hero.kicker')}
            </p>
            {onlineNodesCount > 0 && (
              <a
                href="#shop-standorte"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-background/70 px-3 py-1 text-label-sm font-semibold text-on-surface backdrop-blur-md transition-colors hover:border-status-running/45"
              >
                <span className="h-2 w-2 rounded-full bg-status-running" aria-hidden="true" />
                <span>{t('shop.hero.standorteOnline', { count: onlineNodesCount })}</span>
              </a>
            )}
            {standortGewaehltName && (
              <a
                href="#shop-standorte"
                className="inline-flex items-center gap-1.5 rounded-full border border-status-running/45 bg-status-running/15 px-3 py-1 text-label-sm font-semibold text-status-running backdrop-blur-md transition-colors hover:bg-status-running/25"
              >
                <Server className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{standortGewaehltName}</span>
              </a>
            )}
          </div>

          <h1 className="mt-5 font-headline text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {t('shop.hero.titel')}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
            {t('shop.hero.untertitel')}
          </p>

          {(heroSpiel || showDdosPill) && (
            <div className="mt-6 flex flex-wrap items-center gap-2.5 rounded-2xl border border-white/15 bg-background/75 px-4 py-3 backdrop-blur-xl">
              {heroSpiel && (
                <>
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-primary">
                    {t('shop.hero.fokusSpiel')}
                  </span>
                  <span className="font-headline text-sm font-bold text-white sm:text-base">
                    {heroSpiel.name}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-on-surface-variant">
                    {t('shop.karte.abPreis', { preis: formatEuro(heroSpiel.grundpreisCent) })}
                  </span>
                  {plattformen.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-white/15 bg-surface-container-high/80 px-2 py-0.5 text-label-sm font-medium text-on-surface"
                    >
                      {PLATTFORM_LABELS[tag]}
                    </span>
                  ))}
                </>
              )}

              {showDdosPill && (
                <span className="msm-shop-ddos-pill inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-status-running">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {effectiveDdosGameAware
                      ? effectiveDdosProvider
                        ? `${t('shop.nodeStatus.ddosGameAware')} · ${effectiveDdosProvider}`
                        : t('shop.nodeStatus.ddosGameAware')
                      : effectiveDdosProvider}
                  </span>
                </span>
              )}
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            {heroSpiel ? (
              <>
                <Link
                  to={`/shop/${heroSpiel.id}`}
                  className={buttonClasses('primary', 'lg', 'gap-2 shadow-lg')}
                >
                  <Rocket className="h-4 w-4" aria-hidden="true" />
                  <span>{t('shop.hero.ctaKonfigurieren', { name: heroSpiel.name })}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="#shop-spiele"
                  className={buttonClasses(
                    'secondary',
                    'lg',
                    'gap-2 border-white/15 bg-background/75 backdrop-blur-md hover:bg-surface-container-high/90',
                  )}
                >
                  <Gamepad2 className="h-4 w-4" aria-hidden="true" />
                  <span>{t('shop.hero.ctaSammlung')}</span>
                </a>
              </>
            ) : (
              <a href="#shop-spiele" className={buttonClasses('primary', 'lg', 'gap-2 shadow-lg')}>
                <Rocket className="h-4 w-4" aria-hidden="true" />
                <span>{t('shop.hero.ctaSammlung')}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
            {trustHighlights.map((punkt) => (
              <li key={punkt} className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>{punkt}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {topSpiele.length > 0 && (
        <div className="border-t border-white/10 bg-background/75 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 py-3.5 sm:px-6 lg:px-8">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-label-sm font-semibold uppercase tracking-[0.18em] text-primary">
                  {t('shop.hero.dockTitel')}
                </span>
                {spiele.length > 0 && (
                  <span className="rounded-full border border-white/15 bg-surface-container/80 px-2.5 py-0.5 text-label-sm font-semibold tabular-nums text-on-surface-variant">
                    {t('shop.hero.statSpieleBadge', { count: spiele.length })}
                  </span>
                )}
              </div>

              {topSpiele.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPausiert((alt) => !alt)}
                  aria-label={
                    pausiert
                      ? t('shop.hero.rotationFortsetzen')
                      : t('shop.hero.rotationPausieren')
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-surface-container/80 text-on-surface transition-colors hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {pausiert ? (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              {topSpiele.map((spiel, index) => {
                const aktiv = heroSpiel?.id === spiel.id
                const motiv = motivFuer(spiel.motiv)
                const Icon = motiv.icon
                const rabatt = rabattFuerSpiel(spiel.id)

                return (
                  <button
                    key={spiel.id}
                    type="button"
                    onClick={() => setAusgewaehltesId(spiel.id)}
                    onKeyDown={(e) => handleSlideKey(e, index)}
                    aria-pressed={aktiv}
                    className={`relative flex items-center gap-3 overflow-hidden rounded-xl border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 ${
                      aktiv
                        ? 'border-primary/60 bg-primary/15 text-white shadow-md'
                        : 'border-white/10 bg-surface-container/60 text-on-surface hover:border-white/25 hover:bg-surface-container-high/70'
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
                          <Icon className="h-5 w-5 text-white/55" aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate font-headline text-sm font-bold text-white">
                          {spiel.name}
                        </p>
                        {rabatt && spiel.verfuegbar !== false && (
                          <Badge variant="success" className="shrink-0">
                            -{rabatt}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs tabular-nums text-on-surface-variant">
                        {t('shop.karte.abPreis', { preis: formatEuro(spiel.grundpreisCent) })}
                      </p>
                    </div>

                    {aktiv && !pausiert && topSpiele.length > 1 && (
                      <span
                        key={`${spiel.id}-${aktiverIndex}`}
                        className="msm-shop-hero-progress absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                        aria-hidden="true"
                      />
                    )}
                    {aktiv && (pausiert || topSpiele.length <= 1) && (
                      <span
                        className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
