import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react'
import { Button } from './Button'
import { Kurzinfo } from './Kurzinfo'

export type NachrichtZustand = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

export interface NachrichtStatusProps {
  /** Der aktuelle Zustell- und Lesestatus der Nachricht. */
  status: NachrichtZustand
  /**
   * Expliziter Tooltip- und Screenreader-Text.
   * Überschreibt die automatische Textgenerierung.
   */
  label?: string
  /**
   * Optional: Name des Empfängers oder der KI (z. B. "Singra") für lesbare
   * Standardtexte, wenn kein explizites `label` übergeben wird.
   */
  empfaengerName?: string
  /**
   * Optionaler Klick-Handler zum Wiederholen, falls der Status 'failed' ist.
   * Rendert einen barrierefreien Button statt eines reinen Spans.
   */
  onErneutSenden?: () => void
  /**
   * Barrierefreie Beschriftung für den Wiederhol-Knopf (Standard: "Erneut senden").
   */
  erneutSendenLabel?: string
  /**
   * Ausrichtung des Tooltips relativ zum Statussymbol.
   * Standard: 'ende' (rechtsbündig).
   */
  seite?: 'mitte' | 'anfang' | 'ende'
  /**
   * Platzierung des Tooltips.
   * Standard: 'oben'.
   */
  lage?: 'unten' | 'oben' | 'rechts' | 'links'
  /** Zusätzliche Klassen für das Wurzel-Element. */
  className?: string
  /** Zusätzliche Klassen für die Icons (Standard: 'w-3.5 h-3.5'). */
  iconClassName?: string
}

/**
 * Standardtext für den jeweiligen Zustand ermitteln.
 */
function standardLabel(status: NachrichtZustand, empfaengerName?: string): string {
  switch (status) {
    case 'queued':
      return 'Wird gesendet...'
    case 'sent':
      return 'Gesendet'
    case 'delivered':
      return empfaengerName ? `An ${empfaengerName} übergeben` : 'Zugestellt'
    case 'read':
      return empfaengerName ? `Von ${empfaengerName} gelesen` : 'Gelesen'
    case 'failed':
      return 'Fehlgeschlagen'
  }
}

/**
 * Universelle Zustell- und Lesestatusanzeige für Chatnachrichten (Messenger & KI-Chat).
 *
 * Folgt dem etablierten WhatsApp-Muster:
 * - 'queued': Pulsierende Uhr (Nachricht in Warteschlange / wird gesendet)
 * - 'sent': Ein Haken (Vom Server empfangen)
 * - 'delivered': Zwei graue Haken (Zugestellt bzw. an KI-Lauf übergeben)
 * - 'read': Zwei blaue Haken (Gelesen bzw. KI hat mit Antworten begonnen)
 * - 'failed': Rotes Ausrufezeichen (Fehlgeschlagen, optional mit Wiederhol-Aktion)
 */
export function NachrichtStatus({
  status,
  label,
  empfaengerName,
  onErneutSenden,
  erneutSendenLabel,
  seite = 'ende',
  lage = 'oben',
  className = '',
  iconClassName = 'w-3.5 h-3.5',
}: NachrichtStatusProps) {
  const text = label ?? standardLabel(status, empfaengerName)

  return (
    <Kurzinfo text={text} seite={seite} lage={lage} aussen={className}>
      {status === 'failed' ? (
        onErneutSenden ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            fingerziel
            onClick={onErneutSenden}
            aria-label={erneutSendenLabel ?? text}
            className="text-status-destructive hover:opacity-70"
          >
            <AlertCircle className={iconClassName} aria-hidden="true" />
          </Button>
        ) : (
          <span
            role="img"
            aria-label={text}
            className="inline-flex items-center text-status-destructive"
          >
            <AlertCircle className={iconClassName} />
          </span>
        )
      ) : status === 'queued' ? (
        <span role="img" aria-label={text} className="inline-flex items-center">
          <Clock className={`${iconClassName} opacity-60 animate-pulse`} />
        </span>
      ) : status === 'read' ? (
        <span role="img" aria-label={text} className="inline-flex items-center">
          <CheckCheck className={`${iconClassName} text-primary`} />
        </span>
      ) : status === 'delivered' ? (
        <span role="img" aria-label={text} className="inline-flex items-center">
          <CheckCheck className={`${iconClassName} opacity-60`} />
        </span>
      ) : (
        <span role="img" aria-label={text} className="inline-flex items-center">
          <Check className={`${iconClassName} opacity-60`} />
        </span>
      )}
    </Kurzinfo>
  )
}
