import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
      className="msm-card group flex overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 transition-all hover:border-primary/40 hover:bg-surface-container-high/50 focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <article className="flex flex-1 flex-col">
        <SpielArtwork spiel={spiel} priority={priority} />
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-headline text-lg font-bold text-on-surface">{spiel.name}</h3>
              <p className="text-xs uppercase tracking-wider text-on-surface-variant">
                {spiel.category}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {rabattLabel && (
                <Badge variant="success">
                  {t('shop.karte.rabatt', { wert: rabattLabel })}
                </Badge>
              )}
              <Badge variant="info">{t('shop.karte.blueprint')}</Badge>
            </div>
          </div>
          <p className="line-clamp-2 text-sm text-on-surface-variant">
            {spiel.beschreibung[sprache]}
          </p>
          <footer className="mt-auto flex items-end justify-between gap-3 pt-2">
            <div>
              <p className="text-xs text-on-surface-variant">
                {t('shop.karte.abPreis', { preis: formatEuro(spiel.grundpreisCent) })}
              </p>
              <p className="font-headline text-sm font-semibold text-primary">
                {t('shop.karte.slots', { count: spiel.standardSlots })}
              </p>
            </div>
            <span className="text-sm font-semibold text-primary transition-transform group-hover:translate-x-0.5">
              {t('shop.karte.konfigurieren')} →
            </span>
          </footer>
        </div>
      </article>
    </Link>
  )
}
