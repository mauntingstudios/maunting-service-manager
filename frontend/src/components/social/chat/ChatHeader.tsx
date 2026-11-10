import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BellOff, ChevronLeft, ChevronRight, MoreHorizontal, Phone, Pin, Search, UserPlus, Video } from 'lucide-react'
import { Avatar } from '@/components/app/Avatar'
import { Blattmenue, Kurzinfo } from '@maunting/ui'

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
  /** Schnellauswahl fuer Audioanruf am Desktop */
  onSprachanruf?: () => void
  /** Schnellauswahl fuer Videoanruf am Desktop */
  onVideoanruf?: () => void
  /** Schnellauswahl fuer Anheften am Desktop */
  onAnheften?: () => void
  angeheftet?: boolean
  online?: boolean
  /** Seitenleiste auf dem Desktop einklappen / ausklappen */
  onSeitenleisteUmschalten?: () => void
  seitenleisteEingeklappt?: boolean
}

// Runder Button mit Design-DNA / KI-Chat Ästhetik für Desktop und Mobilgeräte
const rundknopf =
  'flex items-center justify-center rounded-full h-10 w-10 sm:h-9 sm:w-9 bg-surface-container-high/85 hover:bg-surface-container-high text-on-surface hover:text-primary border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95'

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
  onSprachanruf,
  onVideoanruf,
  onAnheften,
  angeheftet = false,
  online,
  onSeitenleisteUmschalten,
  seitenleisteEingeklappt = false,
}: ChatHeaderProps) {
  const { t } = useTranslation()
  const [menueOffen, setMenueOffen] = useState(false)

  return (
    <header className="relative z-30 flex shrink-0 items-center gap-2 border-b border-outline-variant/30 bg-surface-container px-3 pt-[calc(var(--msm-oben-sicher,0px)+0.5rem)] pb-2.5 sm:pt-[calc(var(--msm-oben-sicher,0px)+0.625rem)] sm:pb-3 backdrop-blur-xl sm:gap-3 sm:px-4">
      {onSeitenleisteUmschalten && (
        <Kurzinfo
          text={seitenleisteEingeklappt ? 'Seitenleiste einblenden' : 'Seitenleiste einklappen'}
          seite="anfang"
          portal
          aussen="shrink-0 hidden md:inline-flex"
        >
          <button
            type="button"
            onClick={onSeitenleisteUmschalten}
            className={rundknopf}
            aria-label={seitenleisteEingeklappt ? 'Seitenleiste einblenden' : 'Seitenleiste einklappen'}
          >
            {seitenleisteEingeklappt ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </Kurzinfo>
      )}

      <Kurzinfo text={t('messenger.backToContacts')} seite="anfang" aussen="shrink-0 md:hidden">
        <button
          type="button"
          onClick={onZurueck}
          className={rundknopf}
          aria-label={t('messenger.backToContacts')}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      </Kurzinfo>

      <div className="relative shrink-0">
        <Avatar src={bild} name={titel} size="md" />
        {online && (
          <span
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-status-success ring-2 ring-surface shadow-sm"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex min-w-0 items-center gap-1.5">
        {onProfil ? (
          <Kurzinfo text={t('social.profile.open', { name: titel })} seite="anfang" aussen="min-w-0">
            <button
              type="button"
              onClick={onProfil}
              className="min-w-0 truncate text-base sm:text-lg font-semibold text-on-surface tracking-tight hover:text-primary transition-colors"
              aria-description={t('social.profile.open', { name: titel })}
            >
              {titel}
            </button>
          </Kurzinfo>
        ) : (
          <span className="min-w-0 truncate text-base sm:text-lg font-semibold text-on-surface tracking-tight">{titel}</span>
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
          <span className="shrink-0 rounded-md bg-status-destructive/20 border border-status-destructive/40 px-1.5 py-0.2 text-label-sm font-semibold text-status-destructive">
            {t('social.contacts.blocked')}
          </span>
        )}
        </div>
        {(info || online) && (
          <p className="truncate text-xs text-on-surface-variant flex items-center gap-1.5 font-normal">
            {online && <span className="w-1.5 h-1.5 rounded-full bg-status-success shrink-0" />}
            <span>{online ? 'Online' : info}</span>
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Kurzinfo text={t('messenger.searchInChat')} seite="ende">
          <button
            type="button"
            onClick={onSuche}
            className={rundknopf}
            aria-label={t('messenger.searchInChat')}
          >
            <Search className="w-4 h-4" />
          </button>
        </Kurzinfo>

        {onSprachanruf && (
          <Kurzinfo text="Sprachanruf" seite="ende" aussen="hidden md:inline-flex">
            <button
              type="button"
              onClick={onSprachanruf}
              className={rundknopf}
              aria-label="Sprachanruf"
            >
              <Phone className="w-4 h-4" />
            </button>
          </Kurzinfo>
        )}

        {onVideoanruf && (
          <Kurzinfo text="Videoanruf" seite="ende" aussen="hidden md:inline-flex">
            <button
              type="button"
              onClick={onVideoanruf}
              className={rundknopf}
              aria-label="Videoanruf"
            >
              <Video className="w-4 h-4" />
            </button>
          </Kurzinfo>
        )}

        {onAnheften && (
          <Kurzinfo text={angeheftet ? 'Chat lösen' : 'Chat anheften'} seite="ende" aussen="hidden md:inline-flex">
            <button
              type="button"
              onClick={onAnheften}
              className={`${rundknopf} ${angeheftet ? '!bg-primary/25 !text-primary !border-primary/50' : ''}`}
              aria-label={angeheftet ? 'Chat lösen' : 'Chat anheften'}
            >
              <Pin className="w-4 h-4" />
            </button>
          </Kurzinfo>
        )}

        {onFreundschaftsanfrage && !anfrageGesendet && (
          <Kurzinfo text={t('messenger.sendFriendRequest')} seite="ende">
            <button
              type="button"
              onClick={onFreundschaftsanfrage}
              className={`${rundknopf} !text-primary !bg-primary/10 !border-primary/30`}
              aria-label={t('messenger.sendFriendRequest')}
            >
              <UserPlus className="w-4 h-4" />
            </button>
          </Kurzinfo>
        )}

        <Kurzinfo text={t('messenger.moreChatSettings')} seite="ende" portal>
          <button
            type="button"
            onClick={() => setMenueOffen(true)}
            className={rundknopf}
            aria-haspopup="dialog"
            aria-expanded={menueOffen}
            aria-label={t('messenger.moreChatSettings')}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </Kurzinfo>

        <Blattmenue
          offen={menueOffen}
          onSchliessen={() => setMenueOffen(false)}
          titel={titel || t('messenger.chat')}
          className="bg-surface-container-high/95 backdrop-blur-2xl border border-outline-variant/30 text-on-surface shadow-2xl"
        >
          {titel && (
            <div className="px-4 pt-3 pb-2 text-xs font-semibold text-on-surface-variant truncate border-b border-outline-variant/20">
              {titel}
            </div>
          )}
          <div className="py-1">
            {menue(() => setMenueOffen(false))}
          </div>
        </Blattmenue>
      </div>
    </header>
  )
}
