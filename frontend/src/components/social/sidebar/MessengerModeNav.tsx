import { useTranslation } from 'react-i18next'
import { Flame, MessageSquare, Sparkles, User, UsersRound } from 'lucide-react'

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

export interface MessengerBottomNavProps {
  modus: MessengerModus
  onModus: (modus: MessengerModus) => void
  onFunke?: () => void
  ungelesenChats?: number
  ungelesenCommunity?: number
  hatStories?: boolean
  onProfil?: () => void
}

/** Dieselbe Wahl als Leiste am unteren Rand auf Mobilgeräten mit Snapchat-Style Funke-Aktion. */
export function MessengerBottomNav({
  modus,
  onModus,
  onFunke,
  ungelesenChats = 0,
  ungelesenCommunity = 0,
  hatStories = false,
  onProfil,
}: MessengerBottomNavProps) {
  const { t } = useTranslation()

  return (
    <nav className="md:hidden shrink-0 h-16 box-content pb-[var(--msm-unten-sicher)] border-t border-outline-variant/30 bg-surface-container-high/95 backdrop-blur-2xl flex items-center justify-around px-2 z-10 select-none text-on-surface shadow-2xl">
      <button
        type="button"
        onClick={() => onModus('chats')}
        className={`relative flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
          modus === 'chats' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
        }`}
        aria-label={t('messenger.nav.chats')}
      >
        <div className={`relative p-1.5 rounded-full ${modus === 'chats' ? 'bg-primary/20 text-primary' : ''}`}>
          <MessageSquare className="w-5 h-5" />
          {ungelesenChats > 0 && modus !== 'chats' && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-on-primary text-label-sm font-bold flex items-center justify-center ring-1 ring-surface-container-high">
              {ungelesenChats > 99 ? '99+' : ungelesenChats}
            </span>
          )}
        </div>
        <span className="text-label-sm mt-0.5">{t('messenger.nav.chats')}</span>
      </button>

      <button
        type="button"
        onClick={() => onModus('community')}
        className={`relative flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
          modus === 'community' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
        }`}
        aria-label={t('messenger.nav.community')}
      >
        <div className={`relative p-1.5 rounded-full ${modus === 'community' ? 'bg-primary/20 text-primary' : ''}`}>
          <UsersRound className="w-5 h-5" />
          {ungelesenCommunity > 0 && modus !== 'community' && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-on-primary text-label-sm font-bold flex items-center justify-center ring-1 ring-surface-container-high">
              {ungelesenCommunity > 99 ? '99+' : ungelesenCommunity}
            </span>
          )}
        </div>
        <span className="text-label-sm mt-0.5">{t('messenger.nav.community')}</span>
      </button>

      {/* Prominenter, erhoehter Funke-Aktionsknopf in der Mitte (wie Snapchat Flammen) */}
      <div className="flex flex-col items-center justify-center px-1 -translate-y-4">
        <button
          type="button"
          onClick={onFunke || (() => onModus('chats'))}
          className="w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 via-primary to-accent text-on-primary shadow-[0_8px_20px_rgba(245,158,11,0.35)] flex items-center justify-center border-2 border-surface-container-high/90 active:scale-90 hover:scale-105 hover:shadow-[0_10px_25px_rgba(245,158,11,0.5)] transition-all"
          aria-label="Funken aufnehmen"
        >
          <Flame className="w-7 h-7 fill-white text-white drop-shadow-sm" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onModus('updates')}
        className={`relative flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
          modus === 'updates' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
        }`}
        aria-label={t('messenger.nav.updates')}
      >
        <div className={`relative p-1.5 rounded-full ${modus === 'updates' ? 'bg-primary/20 text-primary' : ''}`}>
          <Sparkles className="w-5 h-5" />
          {hatStories && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-status-success ring-1 ring-surface-container-high animate-pulse" />
          )}
        </div>
        <span className="text-label-sm mt-0.5">{t('messenger.nav.updates')}</span>
      </button>

      <button
        type="button"
        onClick={onProfil}
        className="flex flex-col items-center justify-center flex-1 py-1 text-on-surface-variant hover:text-on-surface transition-colors"
        aria-label="Profil und Einstellungen"
      >
        <div className="p-1.5 rounded-full">
          <User className="w-5 h-5" />
        </div>
        <span className="text-label-sm mt-0.5">Profil</span>
      </button>
    </nav>
  )
}
