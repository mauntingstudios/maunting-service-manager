import { useTranslation } from 'react-i18next'
import { MessageSquare, Sparkles, UsersRound } from 'lucide-react'

export type MessengerModus = 'chats' | 'updates' | 'community'

interface MessengerModeNavProps {
  modus: MessengerModus
  onModus: (modus: MessengerModus) => void
}

/** Die Moduswahl oben in der Seitenleiste, nur auf breiten Bildschirmen. */
export function MessengerModeNav({
  modus,
  onModus,
  hatStories,
}: MessengerModeNavProps & { hatStories: boolean }) {
  const { t } = useTranslation()
  const klasse = (aktiv: boolean) =>
    `flex-1 py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
      aktiv
        ? 'bg-primary text-on-primary shadow-sm font-semibold'
        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
    }`

  return (
    <div className="hidden md:flex px-2.5 pt-2 pb-1 border-b border-outline-variant/15 items-center gap-1 bg-surface-container/60">
      <button
        type="button"
        onClick={() => onModus('chats')}
        className={klasse(modus === 'chats')}
        aria-label={t('messenger.nav.chats')}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        <span>{t('messenger.nav.chats')}</span>
      </button>
      <button
        type="button"
        onClick={() => onModus('updates')}
        className={`${klasse(modus === 'updates')} relative`}
        aria-label={t('messenger.nav.updates')}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>{t('messenger.nav.updates')}</span>
        {hatStories && (
          <span className={`w-2 h-2 rounded-full ${modus === 'updates' ? 'bg-white' : 'bg-status-success animate-pulse'}`} />
        )}
      </button>
      <button
        type="button"
        onClick={() => onModus('community')}
        className={klasse(modus === 'community')}
        aria-label={t('messenger.nav.community')}
      >
        <UsersRound className="w-3.5 h-3.5" />
        <span>{t('messenger.nav.community')}</span>
      </button>
    </div>
  )
}

import { Zap } from 'lucide-react'

/** Dieselbe Wahl als Leiste am unteren Rand, nur auf schmalen Bildschirmen. */
export function MessengerBottomNav({
  modus,
  onModus,
  onFunke,
}: MessengerModeNavProps & { onFunke?: () => void }) {
  const { t } = useTranslation()

  return (
    <nav className="md:hidden shrink-0 h-16 box-content pb-[var(--msm-unten-sicher)] border-t border-outline-variant/20 bg-surface-container/95 backdrop-blur-md flex items-center justify-around px-2 z-10">
      <button
        type="button"
        onClick={() => onModus('chats')}
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
          modus === 'chats' ? 'text-primary font-bold' : 'text-on-surface-variant/70 hover:text-on-surface'
        }`}
        aria-label={t('messenger.nav.chats')}
      >
        <div className={`p-1.5 rounded-full ${modus === 'chats' ? 'bg-primary/15' : ''}`}>
          <MessageSquare className="w-5 h-5" />
        </div>
        <span className="text-label-sm mt-0.5">{t('messenger.nav.chats')}</span>
      </button>

      <button
        type="button"
        onClick={() => onModus('community')}
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
          modus === 'community' ? 'text-primary font-bold' : 'text-on-surface-variant/70 hover:text-on-surface'
        }`}
        aria-label={t('messenger.nav.community')}
      >
        <div className={`p-1.5 rounded-full ${modus === 'community' ? 'bg-primary/15' : ''}`}>
          <UsersRound className="w-5 h-5" />
        </div>
        <span className="text-label-sm mt-0.5">{t('messenger.nav.community')}</span>
      </button>

      {/* Prominenter, erhoehter Funke-Aktionsknopf in der Mitte (wie in der Referenz) */}
      <div className="flex flex-col items-center justify-center px-1 -translate-y-3">
        <button
          type="button"
          onClick={onFunke || (() => onModus('chats'))}
          className="w-12 h-12 rounded-full bg-primary text-on-primary shadow-lg shadow-primary/40 flex items-center justify-center border-2 border-surface active:scale-95 transition-transform"
          aria-label="Funke"
        >
          <Zap className="w-6 h-6 fill-white" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onModus('updates')}
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
          modus === 'updates' ? 'text-primary font-bold' : 'text-on-surface-variant/70 hover:text-on-surface'
        }`}
        aria-label={t('messenger.nav.updates')}
      >
        <div className={`p-1.5 rounded-full ${modus === 'updates' ? 'bg-primary/15' : ''}`}>
          <Sparkles className="w-5 h-5" />
        </div>
        <span className="text-label-sm mt-0.5">{t('messenger.nav.updates')}</span>
      </button>
    </nav>
  )
}
