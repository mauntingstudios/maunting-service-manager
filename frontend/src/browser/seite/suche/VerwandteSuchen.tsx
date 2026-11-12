import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Verwandte Suchanfragen als ruhiges Kartenraster, themengefiltert. */
export function VerwandteSuchen({
  suchen,
  onSuchen,
}: {
  suchen: string[]
  onSuchen: (begriff: string) => void
}) {
  const { t } = useTranslation()
  if (suchen.length === 0) return null
  return (
    <section aria-label={t('browser.msmSuche.oftGesucht')} className="pt-1">
      <h2 className="mb-2.5 text-title-sm font-semibold text-on-surface">
        {t('browser.msmSuche.oftGesucht')}
      </h2>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {suchen.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onSuchen(v)}
            className="group flex items-center gap-2.5 rounded-xl border border-outline-variant/35 bg-surface-container/65 px-4 py-3 text-left text-body-sm font-medium text-on-surface backdrop-blur-sm shadow-hairline transition-all hover:border-primary/45 hover:bg-surface-container-high/85 hover:text-primary active:scale-[0.99]"
          >
            <Search
              className="h-3.5 w-3.5 shrink-0 text-on-surface-variant transition-colors group-hover:text-primary"
              aria-hidden="true"
            />
            <span className="truncate">{v}</span>
          </button>
        ))}
      </div>
    </section>
  )
}