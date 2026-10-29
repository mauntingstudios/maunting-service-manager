import React from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Mic, Shield, Sparkles } from 'lucide-react'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import { parseMessageTimestamp } from '@/services/messengerLocalStore'

export interface PartnerAktivitaet {
  status: 'typing' | 'recording'
  username?: string
}

interface ChatTimelineProps {
  scrollRef: React.RefObject<HTMLDivElement>
  endeRef: React.RefObject<HTMLDivElement>
  nachrichten: ChatMessage[]
  laedt: boolean
  /** Vor dieser Nachricht steht „Neue Nachrichten". */
  trennerId: number | null
  aktivitaet: PartnerAktivitaet | null
  istGruppe: boolean
  /** Die Sprechblase selbst; ihre vielen Angaben kennt nur die Seite. */
  zeichneNachricht: (msg: ChatMessage) => React.ReactNode
}

/**
 * Der Tag eines Zeitpunkts in **Ortszeit**, als `YYYY-MM-DD`; `''` heißt
 * „kein brauchbares Datum".
 *
 * Die Zeit kommt aus `parseMessageTimestamp` — derselben Normalisierung, nach
 * der auch sortiert wird. Vorher parste das Label mit `new Date(iso)` und die
 * Sortierung mit angehängtem `Z`; bei UTC+1/+2 konnten dadurch Tags in anderer
 * Reihenfolge stehen, als die Trenner behaupteten.
 */
export function tagVonZeit(zeit: number): string {
  if (!Number.isFinite(zeit) || zeit <= 0) return ''
  const d = new Date(zeit)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function tagesSchluessel(iso: string | null | undefined): string {
  return tagVonZeit(parseMessageTimestamp(iso))
}

/** „Heute", „Gestern" oder das Datum in der Sprache der Oberfläche. */
export function formatChatDateBadge(
  isoDateString: string,
  t: (schluessel: string) => string,
  sprache: string,
  jetzt: Date = new Date(),
): string {
  const zeit = parseMessageTimestamp(isoDateString)
  const tag = tagVonZeit(zeit)
  if (!tag) return ''

  if (tag === tagVonZeit(jetzt.getTime())) return t('messenger.today')

  // Kalendertag, nicht „minus 24 Stunden": sonst fällt der Vortag an einer
  // Zeitumstellung aus.
  const gestern = new Date(jetzt.getTime())
  gestern.setDate(gestern.getDate() - 1)
  if (tag === tagVonZeit(gestern.getTime())) return t('messenger.yesterday')

  const d = new Date(zeit)
  const isSameYear = d.getFullYear() === jetzt.getFullYear()
  // Kurz wie in der Vorschau: „14.11." statt „14. November". Im Englischen
  // entscheidet die Sprache über die Reihenfolge.
  return new Intl.DateTimeFormat(sprache, {
    day: '2-digit',
    month: '2-digit',
    ...(isSameYear ? {} : { year: 'numeric' }),
  }).format(d)
}

/**
 * Welche Zeile einen Tagestrenner trägt, in der Reihenfolge des Verlaufs.
 *
 * `null` heißt „kein Trenner". Gezählt wird jede Zeile mit brauchbarem Datum —
 * auch eine System- oder Funkenzeile. Vorher hing der Vergleich an der
 * vorherigen Nachricht: begann ein Tag mit einer Systemzeile, blieb er ganz
 * ohne Datum.
 */
export function tagesTrenner(nachrichten: readonly { createdAt?: string | null }[]): (string | null)[] {
  let letzter: string | null = null
  return nachrichten.map((msg) => {
    const tag = tagesSchluessel(msg.createdAt)
    if (!tag) return null
    const wechsel = tag !== letzter
    letzter = tag
    return wechsel ? tag : null
  })
}

/** Ein Tagesabschnitt: dünne Linie, Datum als Pille in der Mitte. */
function TagesTrenner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-outline-variant/30" />
      <span className="px-3.5 py-1 rounded-full text-label-sm font-semibold bg-surface-container/90 text-on-surface-variant backdrop-blur-md border border-outline-variant/30 shadow-sm">
        {text}
      </span>
      <span className="h-px flex-1 bg-outline-variant/30" />
    </div>
  )
}

/** Der Nachrichtenverlauf des offenen Chats. */
export function ChatTimeline({
  scrollRef,
  endeRef,
  nachrichten,
  laedt,
  trennerId,
  aktivitaet,
  istGruppe,
  zeichneNachricht,
}: ChatTimelineProps) {
  const { t, i18n } = useTranslation()
  // Ein Durchgang für alle Tage; die Zeile selbst weiß dann nur noch, ob sie
  // einen Trenner trägt.
  const tagesFolge = tagesTrenner(nachrichten)

  return (
    <div
      ref={scrollRef}
      // Die Kopfleiste liegt jetzt im Fluss; der Verlauf beginnt direkt
      // darunter. Das frühere `pt-16 sm:pt-12` hielt eine schwebende Kopfzeile
      // frei und ließ am Telefon einen leeren Streifen stehen.
      className="flex-1 overflow-y-auto p-4 space-y-3 relative"
    >
      <div className="py-1 text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high/60 border border-outline-variant/30 text-label-sm text-on-surface-variant shadow-2xs">
          <Lock className="w-3 h-3 text-status-success" />
          <span>{t('messenger.e2eeBanner')}</span>
        </div>
      </div>

      {laedt && nachrichten.length === 0 && (
        <div role="status" aria-live="polite" className="space-y-3 py-4">
          <span className="sr-only">{t('common.loading')}</span>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              aria-hidden="true"
              className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`h-9 rounded-2xl bg-surface-container-high/70 animate-pulse ${
                  i === 0 ? 'w-40' : i === 1 ? 'w-56' : 'w-32'
                }`}
              />
            </div>
          ))}
        </div>
      )}

      {nachrichten.length === 0 && !laedt && (
        <div className="py-16 text-center text-xs text-on-surface-variant/70">
          {t('messenger.noMessagesYet')}
        </div>
      )}

      {nachrichten.map((msg, idx) => {
        const tagesText = tagesFolge[idx]
          ? formatChatDateBadge(msg.createdAt, t, i18n.language)
          : null

        // Eine Systemzeile ist keine Nachricht: sie hat keinen Absender, keine
        // Quittung und kein Kontextmenü. In der Sprechblase gerendert sah sie
        // aus, als hätte das Gegenüber sie geschrieben — bei einer Meldung über
        // die Sicherheit dieses Gesprächs die denkbar schlechteste Verwechslung.
        if (msg.isSystem) {
          return (
            <React.Fragment key={msg.id}>
              {tagesText && <TagesTrenner text={tagesText} />}
              <div className="py-1 text-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high/60 border border-outline-variant/30 text-label-sm text-on-surface-variant shadow-2xs">
                  <Shield className="w-3 h-3 text-status-warning shrink-0" />
                  <span>{msg.text}</span>
                </div>
              </div>
            </React.Fragment>
          )
        }

        // Eine Wiederherstellung des Funkens reist als Nachricht, damit sie
        // alle Geräte beider Seiten erreicht. Im Verlauf ist sie eine Meldung
        // über den Funken, keine Sprechblase.
        if (msg.funkenRettung) {
          const count = msg.funkenRettung.verloren
          return (
            <React.Fragment key={msg.id}>
              {tagesText && <TagesTrenner text={tagesText} />}
              <div className="py-1 text-center" data-funken-rettung="">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-status-warning/10 border border-status-warning/30 text-label-sm text-on-surface-variant shadow-2xs">
                  <Sparkles className="w-3 h-3 text-status-warning shrink-0" />
                  <span>
                    {msg.isSelf
                      ? t('messenger.streak.restoredSelf', { count })
                      : t('messenger.streak.restoredOther', { count, name: msg.senderName || '' })}
                  </span>
                </div>
              </div>
            </React.Fragment>
          )
        }

        return (
          <React.Fragment key={msg.id}>
            {tagesText && <TagesTrenner text={tagesText} />}

            {trennerId !== null && msg.id === trennerId && (
              <div className="flex items-center gap-2 my-3">
                <span className="h-px flex-1 bg-primary/30" />
                <span className="text-label-sm font-semibold text-primary uppercase tracking-wide">
                  {t('messenger.newMessages')}
                </span>
                <span className="h-px flex-1 bg-primary/30" />
              </div>
            )}

            {zeichneNachricht(msg)}
          </React.Fragment>
        )
      })}

      {aktivitaet && (
        <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-full bg-surface-container-high/90 border border-outline-variant/30 text-on-surface w-fit shadow-sm animate-slide-up">
          {aktivitaet.status === 'recording' ? (
            <>
              <Mic className="w-3.5 h-3.5 text-status-destructive animate-pulse" />
              <span className="text-label-sm text-status-destructive font-medium">
                {istGruppe
                  ? t('messenger.someoneRecording', { name: aktivitaet.username || t('messenger.someone') })
                  : t('messenger.recordingVoice')}
              </span>
            </>
          ) : (
            <>
              <span className="flex gap-1 items-center px-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
              </span>
              <span className="text-label-sm text-primary font-medium">
                {istGruppe ? `${aktivitaet.username || 'Jemand'} schreibt …` : t('messenger.typing')}
              </span>
            </>
          )}
        </div>
      )}
      <div ref={endeRef} />
    </div>
  )
}
