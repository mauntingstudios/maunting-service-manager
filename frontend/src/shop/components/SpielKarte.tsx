import { useId, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronDown } from 'lucide-react'
import type { ShopPublicPolicyDto } from '@/api/shop'
import { extractSupportedPlatforms, PLATTFORM_LABELS } from '../ddosSummary'
import { niedrigsterEinstiegsPreis } from '../preis'
import type { ShopSpiel } from '../typen'
import { PreisAuszeichnung } from './PreisAuszeichnung'
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

function PlattformOverlay({ plattformen }: { plattformen: string[] }) {
  const { t } = useTranslation()
  const [offen, setOffen] = useState(false)
  const popoverId = useId()

  if (plattformen.length === 0) return null

  const primaryKey = plattformen.includes('crossplay') ? 'crossplay' : plattformen[0]
  const primaryLabel = PLATTFORM_LABELS[primaryKey] ?? primaryKey

  if (plattformen.length === 1) {
    return (
      <span className="inline-flex items-center rounded-full border border-white/15 bg-background/80 px-2.5 py-1 text-label-sm font-semibold text-white backdrop-blur-md">
        {primaryLabel}
      </span>
    )
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOffen(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && offen) {
      event.preventDefault()
      event.stopPropagation()
      setOffen(false)
    }
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setOffen(true)}
      onMouseLeave={() => setOffen(false)}
      onFocus={() => setOffen(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-expanded={offen}
        aria-controls={popoverId}
        aria-label={t('shop.karte.plattformenLabel')}
        onClick={() => setOffen((alt) => !alt)}
        className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-background/85 px-2.5 py-1 text-label-sm font-semibold text-white shadow-md backdrop-blur-md transition-colors hover:border-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span>{primaryLabel}</span>
        <span className="text-white/75">+{plattformen.length - 1}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${offen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {offen && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            id={popoverId}
            role="tooltip"
            className="msm-platform-popover min-w-[9.5rem] rounded-xl border border-white/15 bg-surface-container-high/95 p-2 shadow-2xl backdrop-blur-xl"
          >
            <p className="px-2 py-1 text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('shop.karte.plattformenLabel')}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {plattformen.map((tag) => (
                <li
                  key={tag}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-on-surface"
                >
                  {PLATTFORM_LABELS[tag]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export function SpielKarte({
  spiel,
  rabattLabel,
  priority = false,
  shortDurationPolicy = null,
}: SpielKarteProps) {
  const { t } = useTranslation()
  const ausverkauft = spiel.verfuegbar === false
  const plattformen = extractSupportedPlatforms(spiel.platforms)
  const einstieg = niedrigsterEinstiegsPreis(spiel, shortDurationPolicy)
  const kurationKey = spiel.isBestseller
    ? 'shop.katalog.badgeBestseller'
    : spiel.isFeatured
      ? 'shop.katalog.badgeFeatured'
      : spiel.isNew
        ? 'shop.katalog.badgeNeu'
        : null

  const einheitLabel =
    einstieg.tage != null
      ? t('shop.karte.jeTage', { count: einstieg.tage })
      : t('shop.karte.jeMonat')

  return (
    <article className="msm-game-card msm-card msm-shop-card-lift group relative overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low shadow-xl hover:border-primary/50">
      <SpielArtwork
        spiel={spiel}
        variant="poster"
        priority={priority}
        className={`transition-transform duration-300 group-hover:scale-[1.03] ${
          ausverkauft ? 'opacity-70 grayscale-[25%]' : ''
        }`}
      />

      {/* Top-Left: Maximal 1 fokussiertes Status-/Aktions-Badge */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        {ausverkauft ? (
          <span className="inline-flex items-center rounded-full border border-status-warning/75 bg-background/95 px-2.5 py-1 text-label-sm font-bold text-status-warning shadow-md backdrop-blur-md">
            {t('shop.karte.ausverkauft')}
          </span>
        ) : rabattLabel ? (
          <span className="inline-flex items-center rounded-full border border-status-running/65 bg-background/95 px-2.5 py-1 text-label-sm font-bold text-status-running shadow-md backdrop-blur-md">
            {t('shop.karte.rabatt', { wert: rabattLabel })}
          </span>
        ) : spiel.promoHighlightText ? (
          <span className="inline-flex items-center rounded-full border border-primary/60 bg-background/92 px-2.5 py-1 text-label-sm font-bold text-primary shadow-md backdrop-blur-md">
            {spiel.promoHighlightText}
          </span>
        ) : (
          kurationKey && (
            <span className="inline-flex items-center rounded-full border border-white/20 bg-background/85 px-2.5 py-1 text-label-sm font-semibold text-white shadow-md backdrop-blur-md">
              {t(kurationKey)}
            </span>
          )
        )}
      </div>

      {/* Top-Right: Plattformen als kompaktes Hover/Focus-Popover (eigener Interactive Layer) */}
      <div className="absolute right-3 top-3 z-20">
        <PlattformOverlay plattformen={plattformen} />
      </div>

      {/* Bottom DVD Overlay: Titel, klare Preis-Typografie und gestreckter Kartenlink */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-5">
        <h3 className="font-headline text-lg font-extrabold leading-tight tracking-tight text-white drop-shadow-sm sm:text-xl">
          <Link
            to={`/shop/${spiel.id}`}
            className="after:absolute after:inset-0 after:z-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-primary"
          >
            {spiel.name}
          </Link>
        </h3>

        <div className="pointer-events-none mt-2.5 flex items-end justify-between gap-3">
          <PreisAuszeichnung
            variant="poster"
            cent={einstieg.cent}
            praefix={t('shop.karte.abPraefix')}
            einheit={einheitLabel}
          />
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/20 bg-background/70 text-white backdrop-blur-md transition-all group-hover:border-primary/70 group-hover:bg-primary group-hover:text-on-primary"
            aria-hidden="true"
          >
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </article>
  )
}
