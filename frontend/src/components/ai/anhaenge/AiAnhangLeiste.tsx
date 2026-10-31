import { File as DateiIcon, FileText, Image as BildIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiAttachment } from '@/api/ai'
import { anhangArt, lesbareGroesse } from '@/lib/aiAnhangTypen'

/**
 * Die ungesendeten Anhaenge ueber dem Eingabefeld.
 *
 * Bilder zeigen eine Vorschau der ausgewaehlten Datei, Text und Dokumente
 * ihren Namen und ihre Groesse. Entfernt wird einzeln per X — vor dem
 * Absenden, nicht erst in der Nachricht.
 */
export function AiAnhangLeiste({
  anhaenge, vorschauen, onRemove, disabled,
}: {
  anhaenge: AiAttachment[]
  vorschauen: Record<string, string>
  onRemove: (anhang: AiAttachment) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  if (anhaenge.length === 0) return null

  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('ai.attachments.list')}>
      {anhaenge.map((anhang) => {
        const art = anhangArt(anhang.media_type, anhang.original_name)
        const vorschau = art === 'image' ? vorschauen[anhang.id] : undefined
        return (
          <li
            key={anhang.id}
            className="inline-flex max-w-full items-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-high px-2 py-1.5 text-xs text-on-surface-variant"
          >
            {vorschau ? (
              <img
                src={vorschau}
                alt=""
                className="h-8 w-8 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-container-highest">
                {art === 'image' ? (
                  <BildIcon className="h-4 w-4" aria-hidden="true" />
                ) : art === 'text' ? (
                  <FileText className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <DateiIcon className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-on-surface">{anhang.original_name}</span>
              <span className="block text-label-sm text-on-surface-variant/80">
                {t(`ai.attachments.kind.${art}`)} · {lesbareGroesse(anhang.size_bytes)}
              </span>
            </span>
            <button
              type="button"
              className="shrink-0 rounded-sm p-0.5 hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={disabled}
              onClick={() => onRemove(anhang)}
              aria-label={`${t('ai.attachments.remove')}: ${anhang.original_name}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
