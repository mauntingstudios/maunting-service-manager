import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/app/Avatar'

interface ChatEmptyWelcomeProps {
  name?: string
  avatarUrl?: string | null
  istGruppe?: boolean
  onSchnellNachricht?: (text: string) => void
}

export function ChatEmptyWelcome({
  name,
  avatarUrl,
  istGruppe = false,
  onSchnellNachricht,
}: ChatEmptyWelcomeProps) {
  const { t } = useTranslation()
  const vorschlaege = [
    'Hallo! 👋',
    'Wie geht es dir? 😊',
    'Moin! ✨',
  ]

  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center select-none">
      <div className="max-w-sm w-full p-6 rounded-3xl bg-surface-container/70 backdrop-blur-md border border-outline-variant/30 shadow-xl space-y-4 transition-all">
        <div className="relative inline-block mx-auto">
          <div className="w-16 h-16 rounded-full p-1 bg-gradient-to-tr from-primary to-accent ring-2 ring-primary/30 ring-offset-2 ring-offset-surface shadow-md shadow-primary/20 flex items-center justify-center">
            <Avatar src={avatarUrl} name={name || 'Chat'} size="lg" className="w-full h-full" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-sm border-2 border-surface">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
        </div>

        <div className="space-y-1">
          <h3 className="font-headline text-body-lg font-bold text-on-surface">
            {name || (istGruppe ? 'Gruppe' : 'Unterhaltung')}
          </h3>
          <p className="font-body text-xs text-on-surface-variant/80 max-w-xs mx-auto leading-relaxed">
            {istGruppe
              ? 'Noch keine Nachrichten in dieser Gruppe. Schreib die erste Nachricht und starte den Austausch!'
              : t('messenger.noMessagesYet')}
          </p>
        </div>

        {onSchnellNachricht && (
          <div className="pt-2 border-t border-outline-variant/20 flex flex-wrap gap-2 justify-center">
            {vorschlaege.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => onSchnellNachricht(text)}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-surface-container-high/80 hover:bg-primary hover:text-white border border-outline-variant/30 hover:border-primary/50 text-on-surface transition-all shadow-2xs hover:scale-105 active:scale-95"
              >
                {text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
