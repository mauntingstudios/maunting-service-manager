import { useTranslation } from 'react-i18next'
import {
  AtSign,
  Bookmark,
  MessageSquare,
  Palette,
  Sparkles,
  UsersRound,
  Zap,
} from 'lucide-react'
import { Kurzinfo } from '@maunting/ui'
import type { MessengerModus } from './MessengerModeNav'

interface MessengerRailProps {
  modus: MessengerModus
  onModus: (modus: MessengerModus) => void
  hatStories: boolean
  ungelesenGesamt?: number
  ungelesenChats?: number
  ungelesenCommunity?: number
  funkeZahl?: number
  onMarkierteNachrichten: () => void
  onAntwortenAnMich?: () => void
  onFunke?: () => void
  onHintergrund: () => void
}

/**
 * Die kompakte Symbolleiste ganz links am Desktop.
 * Orientiert sich an modernen Desktop-Messengern (Discord/Slack/Telegram)
 * und schafft eine klare funktionale Trennung zwischen Modus, Aktionen und Chatliste.
 */
export function MessengerRail({
  modus,
  onModus,
  hatStories,
  ungelesenGesamt = 0,
  ungelesenChats,
  ungelesenCommunity = 0,
  funkeZahl = 0,
  onMarkierteNachrichten,
  onAntwortenAnMich,
  onFunke,
  onHintergrund,
}: MessengerRailProps) {
  const { t } = useTranslation()
  const ungelesenChatsZahl = ungelesenChats ?? ungelesenGesamt

  const buttonKlasse = (aktiv: boolean) =>
    `relative flex items-center justify-center w-11 h-11 rounded-2xl transition-all ${
      aktiv
        ? 'bg-primary text-on-primary shadow-md shadow-primary/30 scale-105'
        : 'text-white/70 hover:text-white hover:bg-white/10'
    }`

  return (
    <aside
      className="hidden md:flex flex-col items-center justify-between py-3 px-2 w-16 shrink-0 bg-transparent border-r border-white/5 z-20 select-none"
      aria-label="Messenger Navigation"
    >
      {/* Oben: Haupt-Modi */}
      <div className="flex flex-col items-center gap-3 w-full">
        <Kurzinfo text={t('messenger.nav.chats')} lage="rechts">
          <button
            type="button"
            onClick={() => onModus('chats')}
            className={buttonKlasse(modus === 'chats')}
            aria-label={t('messenger.nav.chats')}
          >
            <MessageSquare className="w-5 h-5" />
            {ungelesenChatsZahl > 0 && modus !== 'chats' && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-label-sm font-bold flex items-center justify-center ring-2 ring-black">
                {ungelesenChatsZahl > 99 ? '99+' : ungelesenChatsZahl}
              </span>
            )}
          </button>
        </Kurzinfo>

        <Kurzinfo text={t('messenger.nav.community')} lage="rechts">
          <button
            type="button"
            onClick={() => onModus('community')}
            className={buttonKlasse(modus === 'community')}
            aria-label={t('messenger.nav.community')}
          >
            <UsersRound className="w-5 h-5" />
            {ungelesenCommunity > 0 && modus !== 'community' && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-label-sm font-bold flex items-center justify-center ring-2 ring-black">
                {ungelesenCommunity > 99 ? '99+' : ungelesenCommunity}
              </span>
            )}
          </button>
        </Kurzinfo>

        <Kurzinfo text={t('messenger.nav.updates')} lage="rechts">
          <button
            type="button"
            onClick={() => onModus('updates')}
            className={buttonKlasse(modus === 'updates')}
            aria-label={t('messenger.nav.updates')}
          >
            <Sparkles className="w-5 h-5" />
            {hatStories && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-status-success ring-2 ring-surface" />
            )}
          </button>
        </Kurzinfo>

        <Kurzinfo text={t('messenger.markedMessages')} lage="rechts">
          <button
            type="button"
            onClick={onMarkierteNachrichten}
            className={buttonKlasse(false)}
            aria-label={t('messenger.markedMessages')}
          >
            <Bookmark className="w-5 h-5" />
          </button>
        </Kurzinfo>

        {onAntwortenAnMich && (
          <Kurzinfo text={t('messenger.mentionsAndReplies')} lage="rechts">
            <button
              type="button"
              onClick={onAntwortenAnMich}
              className={buttonKlasse(false)}
              aria-label={t('messenger.mentionsAndReplies')}
            >
              <AtSign className="w-5 h-5" />
            </button>
          </Kurzinfo>
        )}
      </div>

      {/* Unten: Funke, Wallpaper & Einstellungen */}
      <div className="flex flex-col items-center gap-2.5 w-full">
        {funkeZahl > 0 ? (
          <Kurzinfo text={`Funken: ${funkeZahl} (Klicken zum Chat)`} lage="rechts">
            <button
              type="button"
              onClick={onFunke}
              className="flex items-center justify-center w-11 h-11 rounded-2xl bg-status-warning/15 text-status-warning border border-status-warning/30 hover:bg-status-warning/25 hover:scale-105 active:scale-95 transition-all shadow-sm"
              aria-label={`Funken: ${funkeZahl}`}
            >
              <Zap className="w-5 h-5 fill-status-warning" />
            </button>
          </Kurzinfo>
        ) : (
          <Kurzinfo text="Funken mit Freunden" lage="rechts">
            <button
              type="button"
              onClick={onFunke}
              className="flex items-center justify-center w-11 h-11 rounded-2xl text-on-surface-variant hover:text-status-warning hover:bg-surface-container-high/70 hover:scale-105 active:scale-95 transition-all"
              aria-label="Funken mit Freunden"
            >
              <Zap className="w-5 h-5" />
            </button>
          </Kurzinfo>
        )}

        <Kurzinfo text="Chat-Hintergrund" lage="rechts">
          <button
            type="button"
            onClick={onHintergrund}
            className={buttonKlasse(false)}
            aria-label="Chat-Hintergrund"
          >
            <Palette className="w-5 h-5" />
          </button>
        </Kurzinfo>
      </div>
    </aside>
  )
}
