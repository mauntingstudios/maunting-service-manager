import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { ChatComposerBanner } from '@maunting/ui'
import { Avatar } from '@/components/app/Avatar'
import type { AntwortBezug } from '@/components/social/ChatMessageBubble'
import type { Erwaehnungsvorschlag } from '@/services/erwaehnungen'

/**
 * Die Vorschlagsliste beim Tippen von `@`. Liegt unmittelbar über dem Feld
 * und damit über der Tastatur; jede Zeile ist 44 px hoch.
 */
export function MentionSuggestions({
  vorschlaege,
  onWaehlen,
}: {
  vorschlaege: Erwaehnungsvorschlag[]
  onWaehlen: (vorschlag: Erwaehnungsvorschlag) => void
}) {
  if (vorschlaege.length === 0) return null
  return (
    <div className="border-b border-outline-variant/20 max-h-56 overflow-y-auto">
      {vorschlaege.map((v) => (
        <button
          key={v.userId ?? 'alle'}
          type="button"
          // Das Feld behält den Fokus, sonst klappte die Tastatur zu.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onWaehlen(v)}
          className="w-full min-h-11 px-3 py-1.5 flex items-center gap-2.5 text-left hover:bg-surface-container-high transition-colors"
        >
          {v.istAlle ? (
            <span className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <Bell className="w-3.5 h-3.5 text-primary" />
            </span>
          ) : (
            <Avatar src={v.avatarUrl ?? null} name={v.name} size="sm" className="w-7 h-7 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-on-surface truncate">@{v.name}</span>
            {v.istAlle && (
              <span className="block text-label-sm text-on-surface-variant">
                Benachrichtigt alle in dieser Gruppe
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Der Zitatkopf beim Antworten. */
export function ChatReplyBar({ antwort, onVerwerfen }: { antwort: AntwortBezug; onVerwerfen: () => void }) {
  const { t } = useTranslation()
  return (
    <ChatComposerBanner
      mode="reply"
      title={`Antwort an ${antwort.absenderName || 'Nachricht'}`}
      text={antwort.auszug}
      onCancel={onVerwerfen}
      cancelLabel={t('messenger.discardReply')}
    />
  )
}
