import { ArrowUpRight, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Fragen zum Thema, wie man sie von großen Suchmaschinen kennt: jede Zeile
 * startet eine neue Suche. Die Fragen sind themengefiltert (`fragen.ts`);
 * eine Antwort wird nicht mehr aus einem beliebigen Treffer danebengelegt.
 */
export function WeitereFragen({
  fragen,
  onFrage,
}: {
  fragen: string[]
  onFrage: (frage: string) => void
}) {
  const { t } = useTranslation()
  if (fragen.length === 0) return null
  return (
    <section aria-label={t('browser.msmSuche.weitereFragen')} className="border-t border-outline-variant/25 pt-5">
      <h2 className="mb-2 text-title-sm font-semibold text-on-surface">
        {t('browser.msmSuche.weitereFragen')}
      </h2>
      <div className="divide-y divide-outline-variant/25">
        {fragen.map((frage) => (
          <button
            key={frage}
            type="button"
            onClick={() => onFrage(frage)}
            className="group -mx-3 flex w-[calc(100%+1.5rem)] items-center justify-between gap-3 rounded-xl px-3 py-3.5 text-left transition-colors hover:bg-surface-container-low/45 [@media(pointer:coarse)]:py-4"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Search className="h-4 w-4 shrink-0 text-on-surface-variant transition-colors group-hover:text-primary" aria-hidden="true" />
              <span className="truncate text-body-md text-on-surface">{frage}</span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-on-surface-variant/60 transition-colors group-hover:text-primary" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}