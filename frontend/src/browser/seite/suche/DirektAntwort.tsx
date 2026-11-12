import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@maunting/ui'

/** Direktantworten der Metasuche (Rechner, Einheiten, Hashes). */
export function DirektAntwort({ antworten }: { antworten: string[] }) {
  const { t } = useTranslation()
  if (antworten.length === 0) return null
  return (
    <section
      data-testid="searxng-direktantwort"
      aria-label={t('browser.msmSuche.direktAntwortBadge')}
      className="rounded-2xl border border-primary/35 bg-surface-container/80 p-5 backdrop-blur-xl shadow-[inset_0_1px_0_hsl(var(--mui-focus)/0.2),var(--mui-shadow-panel)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <Badge variant="info">{t('browser.msmSuche.direktAntwortBadge')}</Badge>
      </div>
      <div className="space-y-1.5">
        {antworten.map((antw, aIdx) => (
          <p key={aIdx} className="font-mono text-title-md font-semibold text-on-surface">
            {antw}
          </p>
        ))}
      </div>
    </section>
  )
}