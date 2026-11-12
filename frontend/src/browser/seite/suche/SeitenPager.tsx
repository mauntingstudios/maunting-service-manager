import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@maunting/ui'

interface Props {
  seite: number
  mehr: boolean
  laedt: boolean
  onSeite: (seite: number) => void
  onWeitere: () => void
}

/**
 * Weitere Ergebnisse und Seitenzahlen.
 *
 * „Weitere“ hängt an, die Zahlen ersetzen die Liste. Beides steht in der
 * Vorlage; der Anhängen-Knopf bleibt über der Leiste.
 */
export function SeitenPager({ seite, mehr, laedt, onSeite, onWeitere }: Props) {
  const { t } = useTranslation()
  if (!mehr && seite === 1) return null

  const bis = Math.max(5, Math.min(10, seite + 2))
  const von = Math.max(1, bis - 4)
  const seiten = Array.from({ length: bis - von + 1 }, (_, i) => von + i)

  return (
    <div className="space-y-4 border-t border-outline-variant/30 pt-5">
      {mehr && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onWeitere}
            disabled={laedt}
            className="rounded-full border-outline-variant/45 bg-surface-container/75 px-6 backdrop-blur-md hover:border-primary/45 hover:bg-surface-container-high"
          >
            {laedt && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{t('browser.msmSuche.weitere')}</span>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="flex justify-center">
        <nav
          className="inline-flex flex-wrap items-center justify-center gap-1 rounded-full border border-outline-variant/35 bg-surface-container-low/60 p-1 backdrop-blur-sm"
          aria-label={t('browser.msmSuche.pagerLabel')}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={laedt || seite <= 1}
            onClick={() => onSeite(seite - 1)}
            aria-label={t('common.back')}
            className="h-8 w-8 rounded-full p-0 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>

          {seiten.map((nr) => (
            <Button
              key={nr}
              type="button"
              variant={nr === seite ? 'primary' : 'ghost'}
              size="sm"
              disabled={laedt}
              aria-current={nr === seite ? 'page' : undefined}
              onClick={() => onSeite(nr)}
              className={`h-8 w-8 rounded-full p-0 tabular-nums [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${nr === seite ? 'shadow-primary-glow' : ''}`}
            >
              {nr}
            </Button>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={laedt || !mehr}
            onClick={() => onSeite(seite + 1)}
            aria-label={t('common.next')}
            className="h-8 w-8 rounded-full p-0 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>

          <span className="sr-only" aria-live="polite">
            {t('browser.msmSuche.pagerSeite', { seite })}
          </span>
        </nav>
      </div>
    </div>
  )
}
