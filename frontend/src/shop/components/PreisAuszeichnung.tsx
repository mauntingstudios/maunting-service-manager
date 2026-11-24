import { zerlegeEuro } from '../preis'

type PreisVariante = 'poster' | 'hero' | 'panel' | 'card'

interface PreisAuszeichnungProps {
  cent: number
  praefix?: string
  einheit?: string
  variant?: PreisVariante
  className?: string
}

const VARIANTEN_KLASSEN: Record<
  PreisVariante,
  { euro: string; cent: string; praefix: string; einheit: string }
> = {
  poster: {
    euro: 'text-2xl sm:text-[1.65rem] text-white',
    cent: 'text-xs text-white/90',
    praefix: 'text-xs text-white/75',
    einheit: 'text-xs text-white/75',
  },
  hero: {
    euro: 'text-2xl sm:text-3xl text-white',
    cent: 'text-xs sm:text-sm text-white/90',
    praefix: 'text-xs text-white/75',
    einheit: 'text-xs sm:text-sm text-white/75',
  },
  panel: {
    euro: 'text-3xl text-primary',
    cent: 'text-sm text-primary/90',
    praefix: 'text-xs text-on-surface-variant',
    einheit: 'text-xs text-on-surface-variant',
  },
  card: {
    euro: 'text-xl text-primary',
    cent: 'text-xs text-primary/90',
    praefix: 'text-xs text-on-surface-variant',
    einheit: 'text-xs text-on-surface-variant',
  },
}

/**
 * Typografische Preisauszeichnung mit sauberem Euro-/Cent-Gewicht statt Monospace-Fliesstext.
 * Rendert Zahlen direkt zusammenhaengend (`2,50 €`), damit Screenreader und Textsuche stimmen.
 */
export function PreisAuszeichnung({
  cent,
  praefix,
  einheit,
  variant = 'card',
  className = '',
}: PreisAuszeichnungProps) {
  const { euro, cent: centText } = zerlegeEuro(cent)
  const stil = VARIANTEN_KLASSEN[variant]

  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums ${className}`}>
      {praefix && <span className={`font-medium ${stil.praefix}`}>{praefix}</span>}
      <span
        className="inline-flex items-start font-headline leading-none tracking-tight"
        aria-hidden="true"
      >
        <span className={`font-extrabold leading-none ${stil.euro}`}>{euro}</span>
        <span className={`mt-[0.12em] font-bold leading-none ${stil.cent}`}>,{centText} €</span>
      </span>
      <span className="sr-only">{`${euro},${centText} €`}</span>
      {einheit && <span className={`font-medium ${stil.einheit}`}>{einheit}</span>}
    </span>
  )
}
