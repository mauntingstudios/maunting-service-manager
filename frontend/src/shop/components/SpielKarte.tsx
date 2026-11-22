import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { formatEuro } from '../preis'
import type { ShopSpiel } from '../typen'
import { SpielArtwork } from './SpielArtwork'

interface SpielKarteProps {
  spiel: ShopSpiel
  rabattLabel?: string | null
  priority?: boolean
}

export function SpielKarte({ spiel, rabattLabel, priority = false }: SpielKarteProps) {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const ausverkauft = spiel.verfuegbar === false

  return (
    <Link
      to={`/shop/${spiel.id}`}
      className="msm-card group relative flex overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low/90 shadow-lg transition-all hover:border-primary/45 hover:bg-surface-container-high/70 focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <article className="msm-game-card flex flex-1 flex-col">
        <div className="relative overflow-hidden">
          <SpielArtwork
            spiel={spiel}
            priority={priority}
            className={`transition-transform duration-300 group-hover:scale-[1.03] ${ausverkauft ? 'opacity-70 grayscale-[25%]' : ''}`}
          />
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
        </header>

        <p className="flex-1 px-4 pt-2 line-clamp-2 text-xs leading-relaxed text-on-surface-variant sm:px-5 sm:text-sm">
          {spiel.beschreibung[sprache]}
        </p>

        <footer className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3.5 sm:px-5">
          <div>
            <p className="font-headline text-sm font-bold text-primary">
              {t('shop.karte.abPreis', { preis: formatEuro(spiel.grundpreisCent) })}
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
