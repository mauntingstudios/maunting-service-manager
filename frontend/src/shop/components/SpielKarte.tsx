import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import type { ShopPublicPolicyDto } from '@/api/shop'
import { formatEuro, niedrigsterEinstiegsPreis } from '../preis'
import type { ShopSpiel } from '../typen'
import { SpielArtwork } from './SpielArtwork'

interface SpielKarteProps {
  spiel: ShopSpiel
  rabattLabel?: string | null
  priority?: boolean
  shortDurationPolicy?: Pick<
    ShopPublicPolicyDto,
    'shop_short_durations_enabled' | 'shop_short_duration_tiers'
  > | null
}

const PLATTFORM_LABELS: Record<string, string> = {
  pc: 'PC',
  ps5: 'PS5',
  xbox: 'Xbox',
  crossplay: 'Crossplay',
}

export function SpielKarte({
  spiel,
  rabattLabel,
  priority = false,
  shortDurationPolicy = null,
}: SpielKarteProps) {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const ausverkauft = spiel.verfuegbar === false
  const plattformen = (spiel.platforms ?? []).filter((p) => p in PLATTFORM_LABELS)
  const einstieg = niedrigsterEinstiegsPreis(spiel, shortDurationPolicy)
  const kurationKey = spiel.isBestseller
    ? 'shop.katalog.badgeBestseller'
    : spiel.isFeatured
      ? 'shop.katalog.badgeFeatured'
      : spiel.isNew
        ? 'shop.katalog.badgeNeu'
        : null

  return (
    <Link
      to={`/shop/${spiel.id}`}
      className="msm-card msm-shop-card-lift group relative flex overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low/90 shadow-lg hover:border-primary/45 hover:bg-surface-container-high/70 focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <article className="msm-game-card flex flex-1 flex-col">
        <div className="relative overflow-hidden">
          <SpielArtwork
            spiel={spiel}
            priority={priority}
            className={`transition-transform duration-300 group-hover:scale-[1.03] ${ausverkauft ? 'opacity-70 grayscale-[25%]' : ''}`}
          />
          {(spiel.promoHighlightText || kurationKey) && !ausverkauft && (
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
              {spiel.promoHighlightText && (
                <span className="inline-flex items-center rounded-full border border-primary/60 bg-background/92 px-2.5 py-1 text-label-sm font-bold text-primary shadow-md backdrop-blur-md">
                  {spiel.promoHighlightText}
                </span>
              )}
              {kurationKey && !spiel.promoHighlightText && (
                <span className="inline-flex items-center rounded-full border border-primary/45 bg-background/90 px-2.5 py-1 text-label-sm font-semibold text-primary shadow-md backdrop-blur-md">
                  {t(kurationKey)}
                </span>
              )}
            </div>
          )}
          {(ausverkauft || rabattLabel) && (
            <div className="pointer-events-none absolute right-3 top-3 flex flex-wrap items-center justify-end gap-1.5">
              {ausverkauft && (
                <span className="inline-flex items-center rounded-full border border-status-warning/75 bg-background/95 px-2.5 py-1 text-label-sm font-bold text-status-warning shadow-md backdrop-blur-md">
                  {t('shop.karte.ausverkauft')}
                </span>
              )}
              {rabattLabel && !ausverkauft && (
                <span className="inline-flex items-center rounded-full border border-status-running/65 bg-background/95 px-2.5 py-1 text-label-sm font-bold text-status-running shadow-md backdrop-blur-md">
                  {t('shop.karte.rabatt', { wert: rabattLabel })}
                </span>
              )}
            </div>
          )}
        </div>

        <header className="px-4 pt-4 sm:px-5 sm:pt-5">
          <h3 className="font-headline text-base font-bold text-on-surface sm:text-lg">
            {spiel.name}
          </h3>
          {(plattformen.length > 0 || spiel.ddosGameAware || spiel.ddosProvider) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {plattformen.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-md border border-outline-variant/40 bg-surface-container px-2 py-0.5 text-label-sm font-medium text-on-surface-variant"
                >
                  {PLATTFORM_LABELS[tag]}
                </span>
              ))}
              {(spiel.ddosGameAware || spiel.ddosProvider) && (
                <span className="msm-shop-ddos-pill inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-label-sm font-semibold text-status-running">
                  <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>
                    {spiel.ddosGameAware
                      ? spiel.ddosProvider
                        ? `${t('shop.nodeStatus.ddosGameAware')} · ${spiel.ddosProvider}`
                        : t('shop.nodeStatus.ddosGameAware')
                      : spiel.ddosProvider}
                  </span>
                </span>
              )}
            </div>
          )}
        </header>

        <p className="flex-1 px-4 pt-2 line-clamp-2 text-xs leading-relaxed text-on-surface-variant sm:px-5 sm:text-sm">
          {spiel.beschreibung[sprache]}
        </p>

        <footer className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3.5 sm:px-5">
          <div>
            <p className="font-headline text-sm font-bold text-primary">
              {einstieg.tage != null
                ? t('shop.karte.abPreisTage', {
                    preis: formatEuro(einstieg.cent),
                    count: einstieg.tage,
                  })
                : t('shop.karte.abPreis', { preis: formatEuro(einstieg.cent) })}
            </p>
            <p className="text-xs text-on-surface-variant">
              {t('shop.karte.slots', { count: spiel.standardSlots })}
            </p>
          </div>
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-on-surface-variant transition-all group-hover:border-primary/60 group-hover:bg-primary group-hover:text-on-primary"
            aria-hidden="true"
          >
            <ArrowRight className="h-4 w-4" />
          </span>
        </footer>
      </article>
    </Link>
  )
}
