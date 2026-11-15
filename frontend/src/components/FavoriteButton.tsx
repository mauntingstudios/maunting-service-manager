import { Star } from 'lucide-react'
import { Kurzinfo } from '@maunting/ui'

/** Einheitliche goldene Hervorhebung für favorisierte Server- und Node-Karten. */
export const FAVORITE_CARD_HIGHLIGHT_CLASS =
  'border-status-warning/80 ring-1 ring-status-warning/35 hover:border-status-warning shadow-[0_0_24px_-8px_hsl(var(--mui-warning)/0.38)]'

export interface FavoriteButtonProps {
  isFavorite: boolean
  onToggle: () => void
  tooltipText: string
  ariaLabel: string
  testId: string
  tooltipSide?: 'anfang' | 'mitte' | 'ende'
}

/**
 * Einheitlicher Stern-Favoriten-Schalter für Server und Nodes mit goldener Markierung.
 */
export function FavoriteButton({
  isFavorite,
  onToggle,
  tooltipText,
  ariaLabel,
  testId,
  tooltipSide = 'ende',
}: FavoriteButtonProps) {
  return (
    <Kurzinfo text={tooltipText} seite={tooltipSide} aussen="relative z-10 shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isFavorite}
        aria-label={ariaLabel}
        data-testid={testId}
        className={`inline-flex h-8 w-8 max-md:h-11 max-md:w-11 items-center justify-center rounded-full border transition-colors ${
          isFavorite
            ? 'border-status-warning/60 bg-status-warning/15 text-status-warning hover:bg-status-warning/25'
            : 'border-transparent text-on-surface-variant hover:bg-surface-container-highest/70 hover:text-status-warning'
        }`}
      >
        <Star
          className={`h-3.5 w-3.5 ${isFavorite ? 'fill-status-warning text-status-warning' : ''}`}
          aria-hidden="true"
        />
      </button>
    </Kurzinfo>
  )
}
