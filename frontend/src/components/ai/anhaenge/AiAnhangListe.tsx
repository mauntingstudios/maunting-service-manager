import { File as DateiIcon, FileText, Image as BildIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiAttachment } from '@/api/ai'
import { anhangArt, lesbareGroesse } from '@/lib/aiAnhangTypen'

/**
 * Die Anhaenge einer gesendeten Nachricht, unter ihrem Text.
 *
 * Zeigt auch, wenn beim Aufnehmen etwas unkenntlich gemacht wurde. Frueher
 * wurde eine Datei mit einem Tokenmuster komplett abgewiesen — bei echten
 * Serverlogs passiert das staendig. Jetzt wird redigiert, und der Hinweis ist
 * der Grund, warum niemand sich ueber ein `[REDACTED]` im eigenen Log wundern
 * muss.
 */
export function AiAnhangListe({ anhaenge }: { anhaenge: AiAttachment[] }) {
  const { t } = useTranslation()
  if (anhaenge.length === 0) return null

  return (
    <ul className="mt-2 space-y-1 border-t border-primary/20 pt-2">
      {anhaenge.map((anhang) => {
        const art = anhangArt(anhang.media_type, anhang.original_name)
        return (
          <li key={anhang.id} className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            {art === 'image' ? (
              <BildIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : art === 'text' ? (
              <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <DateiIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{anhang.original_name}</span>
            <span className="shrink-0 text-on-surface-variant/70">
              {lesbareGroesse(anhang.size_bytes)}
            </span>
            {anhang.redacted_spans ? (
              <span className="shrink-0 rounded-full border border-outline-variant/50 px-1.5 py-0.5 text-label-sm">
                {t('ai.attachments.redacted', { count: anhang.redacted_spans })}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
