import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@maunting/ui'
import type { ShopSpiel } from '../typen'
import { SpielKarte } from './SpielKarte'

interface KatalogSchieneProps {
  id?: string
  kicker?: string
  titel: string
  beschreibung?: string
  spiele: ShopSpiel[]
  rabattFuerSpiel: (spielId: string) => string | null
}

export function KatalogSchiene({
  id,
  kicker,
  titel,
  beschreibung,
  spiele,
  rabattFuerSpiel,
}: KatalogSchieneProps) {
  const { t } = useTranslation()
  const railRef = useRef<HTMLDivElement>(null)
  const trackId = useId()
  const [statusMeldung, setStatusMeldung] = useState('')
  const scrollSchritt = useRef(0)

  if (spiele.length < 2) return null

  const scrolle = (richtung: -1 | 1) => {
    const container = railRef.current
    if (!container) return
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (typeof container.scrollBy === 'function') {
      container.scrollBy({
        left: richtung * 340,
        behavior: prefersReduced ? 'auto' : 'smooth',
      })
    } else {
      container.scrollLeft += richtung * 340
    }
    scrollSchritt.current += 1
    setStatusMeldung(`${t('shop.katalog.schieneStatus')} (${scrollSchritt.current})`)
  }

  return (
    <section
      id={id}
      role="region"
      aria-roledescription="carousel"
      aria-label={titel}
      data-shop-reveal
      className="msm-shop-reveal msm-shop-reveal-fallback mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8"
    >
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          {kicker && (
            <p className="text-label-sm font-semibold uppercase tracking-[0.18em] text-primary">
              {kicker}
            </p>
          )}
          <h2 className="mt-1 font-headline text-2xl font-bold text-on-surface">{titel}</h2>
          {beschreibung && (
            <p className="mt-1 text-sm text-on-surface-variant">{beschreibung}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-controls={trackId}
            aria-label={t('shop.katalog.schieneZurueck', { titel })}
            onClick={() => scrolle(-1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-controls={trackId}
            aria-label={t('shop.katalog.schieneWeiter', { titel })}
            onClick={() => scrolle(1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        id={trackId}
        ref={railRef}
        role="group"
        aria-label={titel}
        className="msm-shop-rail"
      >
        {spiele.map((spiel, index) => (
          <div
            key={spiel.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} / ${spiele.length}: ${spiel.name}`}
            className="min-w-0"
          >
            <SpielKarte spiel={spiel} rabattLabel={rabattFuerSpiel(spiel.id)} />
          </div>
        ))}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {statusMeldung}
      </p>
    </section>
  )
}
