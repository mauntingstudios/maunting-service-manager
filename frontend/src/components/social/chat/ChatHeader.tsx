import React from 'react'
import { useTranslation } from 'react-i18next'
import { BellOff, ChevronLeft, Search, UserPlus } from 'lucide-react'
import { Avatar, Blattknopf, Kurzinfo } from '@/Singra/UI'

interface ChatHeaderProps {
  /** Der Name des Gesprächs: Kontoname oder Gruppentitel. */
  titel: string
  /** Die freiwillige Info des Gegenübers; nur im Direktchat. */
  info?: string | null
  /** Profil- oder Gruppenbild; `null` zeigt die Initialen. */
  bild?: string | null
  stumm: boolean
  blockiert: boolean
  onZurueck: () => void
  /** Öffnet das Profil des Gegenübers; nur im Direktchat. */
  onProfil?: () => void
  /** Das Funken-Abzeichen neben dem Namen; nur bei Freunden. */
  funke?: React.ReactNode
  /** Freundschaftsanfrage an einen, der noch kein Freund ist. */
  onFreundschaftsanfrage?: () => void
  /** Danach verschwindet der Knopf — die Anfrage ist unterwegs. */
  anfrageGesendet?: boolean
  onSuche: () => void
  /** Der Inhalt des Chatmenüs; `schliessen` klappt das Blatt zu. */
  menue: (schliessen: () => void) => React.ReactNode
}

// Schlichte <button> statt der Button-Komponente: deren size="icon" setzt
// h-8 w-8 fest, und weil die Klassen nur aneinandergehängt werden, gewinnt im
// CSS die feste Größe gegen jede mitgegebene. Am Telefon braucht es 44 px.
const rundknopf =
  'flex items-center justify-center rounded-md h-11 w-11 sm:h-8 sm:w-8 bg-surface-container-high/85 hover:bg-surface-container-high backdrop-blur-md border border-outline-variant/30 shadow-sm'

/**
 * Die Kopfleiste des offenen Chats.
 *
 * Eine Leiste für Rechner und Telefon: Bild, Name und die drei Handlungen, die
 * man im Gespräch braucht. Anrufe, Augenblick und Sicherheitsnummer liegen im
 * Menü — mit sechs Knöpfen nebeneinander blieb am Telefon kein Platz für den
 * Namen (bis 27.10.2026).
 *
 * Der Zurück-Pfeil gehört dem Telefon: am Rechner steht die Liste daneben.
 * Die Leiste liegt im Fluss und trägt eine Trennlinie; der Verlauf beginnt
 * darunter, ohne Luftpolster für eine schwebende Kopfzeile.
 */
export function ChatHeader({
  titel,
  info,
  bild,
  stumm,
  blockiert,
  onZurueck,
  onProfil,
  funke,
  onFreundschaftsanfrage,
  anfrageGesendet = false,
  onSuche,
  menue,
}: ChatHeaderProps) {
  const { t } = useTranslation()

  return (
    <header className="relative z-30 flex min-h-14 shrink-0 items-center gap-2 border-b border-outline-variant/40 bg-surface-container/75 px-2 pt-[var(--msm-oben-sicher)] backdrop-blur-md sm:gap-2.5 sm:px-3">
      <Kurzinfo text={t('messenger.backToContacts')} seite="anfang" aussen="shrink-0 md:hidden">
        <button
          type="button"
          onClick={onZurueck}
          className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          aria-label={t('messenger.backToContacts')}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      </Kurzinfo>

      <Avatar src={bild} name={titel} size="md" className="shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex min-w-0 items-center gap-1.5">
        {onProfil ? (
          <Kurzinfo text={t('social.profile.open', { name: titel })} seite="anfang" aussen="min-w-0">
            <button
              type="button"
              onClick={onProfil}
              className="min-w-0 truncate text-sm font-semibold text-on-surface hover:underline"
              aria-description={t('social.profile.open', { name: titel })}
            >
              {titel}
            </button>
          </Kurzinfo>
        ) : (
          <span className="min-w-0 truncate text-sm font-semibold text-on-surface">{titel}</span>
        )}
        {funke}
        {stumm && (
          <Kurzinfo text={t('messenger.chatMuted')}>
            <span
              role="img"
              aria-label={t('messenger.chatMuted')}
              className="inline-flex shrink-0 items-center text-status-warning"
            >
              <BellOff className="w-3.5 h-3.5" />
            </span>
          </Kurzinfo>
        )}
        {blockiert && (
          <span className="shrink-0 rounded-md bg-status-destructive/15 px-1.5 py-0.2 text-label-sm font-semibold text-status-destructive">
            {t('social.contacts.blocked')}
          </span>
        )}
        </div>
        {info && (
          <p className="truncate text-label-sm text-on-surface-variant/80">{info}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onFreundschaftsanfrage && !anfrageGesendet && (
          <Kurzinfo text={t('messenger.sendFriendRequest')} seite="ende">
            <button
              type="button"
              onClick={onFreundschaftsanfrage}
              className={`${rundknopf} text-primary`}
              aria-label={t('messenger.sendFriendRequest')}
            >
              <UserPlus className="w-4 h-4" />
            </button>
          </Kurzinfo>
        )}

        <Kurzinfo text={t('messenger.searchInChat')} seite="ende">
          <button
            type="button"
            onClick={onSuche}
            className={`${rundknopf} text-on-surface-variant hover:text-primary`}
            aria-label={t('messenger.searchInChat')}
          >
            <Search className="w-4 h-4" />
          </button>
        </Kurzinfo>

        <Blattknopf
          variante="schwebend"
          label={t('messenger.moreChatSettings')}
          titel={titel || t('messenger.chat')}
          ueberschrift={titel || undefined}
        >
          {menue}
        </Blattknopf>
      </div>
    </header>
  )
}
