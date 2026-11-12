import { Newspaper } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Treffer } from '../MsmSuche'
import { FormatierterText } from './FormatierterText'
import { datumText, host } from './helfer'

/**
 * Nachrichten zum Suchbegriff, aus der News-Kategorie der eigenen Metasuche.
 * `null` heißt: die Abfrage läuft noch; eine leere Liste blendet den Block aus,
 * statt unrelated Schlagzeilen zu zeigen.
 */
export function NachrichtenSpalte({
  news,
  sprache,
  onOeffnen,
}: {
  news: Treffer[] | null
  sprache: string
  onOeffnen: (url: string, neuerTab?: boolean) => void
}) {
  const { t } = useTranslation()
  if (news !== null && news.length === 0) return null

  return (
    <div
      className="rounded-2xl border border-outline-variant/40 bg-surface-container/75 p-5 backdrop-blur-xl shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06),var(--mui-shadow-panel)]"
      aria-label={t('browser.msmSuche.nachrichtenZumThema')}
    >
      <div className="mb-3 flex items-center gap-2 border-b border-outline-variant/25 pb-2.5">
        <Newspaper className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-title-sm font-semibold text-on-surface">
          {t('browser.msmSuche.nachrichtenZumThema')}
        </h2>
      </div>
      {news === null ? (
        <div className="animate-pulse motion-reduce:animate-none space-y-3" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-2.5 w-24 rounded-full bg-surface-container-high/70" />
              <div className="h-3 w-full rounded-full bg-surface-container-high/50" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {news.slice(0, 5).map((item, idx) => {
            const domain = host(item.url)
            const datum = datumText(item.published, sprache)
            return (
              <div key={`${item.url}-${idx}`} className="border-b border-outline-variant/20 pb-2.5 last:border-b-0 last:pb-0">
                <button
                  type="button"
                  onClick={(ev) => onOeffnen(item.url, ev.ctrlKey || ev.metaKey)}
                  className="group -mx-2 flex w-[calc(100%+1rem)] flex-col rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-container-high/50"
                >
                  <span className="mb-0.5 block truncate text-label-sm text-on-surface-variant">
                    {domain}
                    {datum ? ` · ${datum}` : ''}
                  </span>
                  <span className="line-clamp-2 text-body-sm font-medium leading-snug text-on-surface decoration-primary/60 underline-offset-4 group-hover:text-primary group-hover:underline">
                    <FormatierterText text={item.titel || domain} />
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}