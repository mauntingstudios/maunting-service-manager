import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Palette, Plus } from 'lucide-react'
import { Button } from '@maunting/ui'

interface MessengerEmptyStateProps {
  onNeueGruppe: () => void
  onHintergrund: () => void
  onNeuerChat: () => void
}

function ermittleBegruessung(): string {
  const stunde = new Date().getHours()
  if (stunde >= 5 && stunde < 11) return 'Guten Morgen'
  if (stunde >= 11 && stunde < 18) return 'Guten Tag'
  return 'Guten Abend'
}

/**
 * Der Willkommens- und Leerzustand des Messengers auf dem Desktop,
 * wenn noch kein Chat geöffnet wurde.
 */
export function MessengerEmptyState({
  onNeueGruppe,
  onHintergrund,
  onNeuerChat,
}: MessengerEmptyStateProps) {
  const { t } = useTranslation()
  const begruessung = useMemo(() => ermittleBegruessung(), [])

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative z-10 select-none">
      <div className="max-w-md w-full p-8 rounded-3xl bg-surface-container/70 backdrop-blur-xl border border-outline-variant/30 shadow-2xl space-y-5 transition-all">
        <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr from-primary to-purple-500 text-white flex items-center justify-center shadow-lg shadow-primary/30">
          <MessageSquare className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <h2 className="font-headline text-headline-sm font-bold text-on-surface">
            {begruessung}!
          </h2>
          <p className="font-body text-xs text-on-surface-variant max-w-sm mx-auto leading-relaxed">
            {t('messenger.pickChatHint') || 'Wähle eine Unterhaltung aus der linken Seitenleiste oder starte ein neues Gespräch.'}
          </p>
        </div>

        <div className="pt-2 flex flex-wrap gap-2.5 justify-center">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onNeuerChat}
            className="rounded-xl gap-2 font-semibold shadow-sm"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Neuer Chat</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onNeueGruppe}
            className="rounded-xl gap-2 font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>{t('messenger.newGroup')}</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onHintergrund}
            className="rounded-xl gap-2 text-on-surface-variant hover:text-primary"
          >
            <Palette className="w-4 h-4" />
            <span>Hintergrund</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
