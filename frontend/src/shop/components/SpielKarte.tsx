import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@maunting/ui'
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

  return (
    <Link
      to={`/shop/${spiel.id}`}
      className="msm-card group relative flex overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low/90 shadow-lg transition-all hover:border-primary/45 hover:bg-surface-container-high/70 focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <article className="flex flex-1 flex-col">
        <div className="relative overflow-hidden">
          <SpielArtwork
            spiel={spiel}
            priority={priority}
            className="transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <div className="pointer-events-none absolute right-3 top-3 flex flex-wrap items-center justify-end gap-1.5">
            {rabattLabel && (
              <Badge variant="success">
                {t('shop.karte.rabatt', { wert: rabattLabel })}
              </Badge>
            )}
            <span className="rounded-full border border-white/15 bg-background/75 px-2.5 py-0.5 text-label-sm font-medium text-on-surface/85 backdrop-blur-md">
              {spiel.category}
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2.5 p-4 sm:p-5">
          <h3 className="font-headline text-base font-bold text-on-surface sm:text-lg">
            {spiel.name}
          </h3>
          <p className="line-clamp-2 text-xs leading-relaxed text-on-surface-variant sm:text-sm">
            {spiel.beschreibung[sprache]}
          </p>
          <footer className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 pt-3">
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
        </div>
      </article>
    </Link>
  )
}
