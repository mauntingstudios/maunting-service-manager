import React from 'react'
import { MoreHorizontal, Pencil, Reply, Star, Timer, X } from 'lucide-react'
import { cx as cn } from './intern/cx'

export interface ChatBubbleSurfaceProps {
  /** Ob die Nachricht vom aktuellen Nutzer stammt (rechtsbündig, Primärfarbe). */
  isSelf: boolean
  /** Hervorgehoben (z. B. durch @-Erwähnung). */
  highlighted?: boolean
  /** Maximale Breite der Blase ('compact' für 85%/70%, 'wide' für ausführliche KI-Antworten bis 92%/82%). */
  size?: 'compact' | 'wide'
  children: React.ReactNode
  className?: string
}

/**
 * ChatBubbleSurface: Einheitliche Nachrichtenblase (Design-DNA) für Messenger und Singra KI-Chat.
 * - Eigene Nachrichten (`isSelf=true`): Primärfarbe (`bg-primary text-on-primary rounded-br-xs`).
 * - Eingehende / KI-Nachrichten (`isSelf=false`): Dunkles Acrylglas (`bg-surface-container-high/85 backdrop-blur-md rounded-bl-xs`).
 */
export function ChatBubbleSurface({
  isSelf,
  highlighted = false,
  size = 'compact',
  children,
  className,
}: ChatBubbleSurfaceProps) {
  return (
    <div
      className={cn(
        size === 'wide'
          ? 'max-w-[92%] md:max-w-[82%] px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-2xl text-sm break-words shadow-sm space-y-2'
          : 'max-w-[85%] md:max-w-[70%] px-3.5 py-2 rounded-2xl text-xs break-words shadow-sm space-y-2',
        isSelf
          ? 'bg-primary text-on-primary rounded-br-xs border border-primary-hover/30 shadow-md shadow-primary/20'
          : 'bg-surface-container-high/85 text-on-surface backdrop-blur-md rounded-bl-xs border border-outline-variant/30 shadow-sm',
        highlighted && 'ring-1 ring-primary/70 border-primary/40',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface ChatMessageMetaRowProps {
  /** Uhrzeit / Datum als formatierter Text. */
  timestamp?: string | null
  /** Ob die Nachricht mit einem Stern markiert ist. */
  isStarred?: boolean
  /** Barrierefreie Bezeichnung für den Stern. */
  starredLabel?: string
  /** Ob die Nachricht ein Verfallsdatum hat. */
  isEphemeral?: boolean
  /** Barrierefreie Bezeichnung für den Timer. */
  ephemeralLabel?: string
  /** Ob die Nachricht bearbeitet wurde. */
  isEdited?: boolean
  /** Text für „bearbeitet" (Standard: „bearbeitet"). */
  editedLabel?: string
  /** Klick-Handler für das Drei-Punkte-Menü (`MoreHorizontal`). */
  onOpenMenu?: () => void
  /** Barrierefreie Bezeichnung für den Menü-Button. */
  menuLabel?: string
  /** Zustell-/Lesestatus-Slot (z. B. `<NachrichtStatus />`). */
  statusSlot?: React.ReactNode
  /** Ausrichtung unter der Blase ('start' oder 'end'). */
  align?: 'start' | 'end'
  className?: string
}

/**
 * ChatMessageMetaRow: Einheitliche Metazeile unterhalb der Nachrichtenblase (Design-DNA).
 * Sitzt in einer dezenten dunklen Acrylglas-Pille, sodass Uhrzeit, Stern, „bearbeitet",
 * Lesebestätigungen und der `MoreHorizontal`-Trigger auf jedem Hintergrund (auch hellen
 * oder szenischen Wallpapern) gestochen scharf lesbar bleiben.
 */
export function ChatMessageMetaRow({
  timestamp,
  isStarred = false,
  starredLabel = 'Markiert',
  isEphemeral = false,
  ephemeralLabel = 'Verschwindet',
  isEdited = false,
  editedLabel = 'bearbeitet',
  onOpenMenu,
  menuLabel = 'Nachrichtenaktionen',
  statusSlot,
  align = 'end',
  className,
}: ChatMessageMetaRowProps) {
  if (!timestamp && !isStarred && !isEphemeral && !isEdited && !onOpenMenu && !statusSlot) {
    return null
  }

  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-1 px-1',
        align === 'end' ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      {onOpenMenu && (
        <div
          className="flex items-center opacity-0 transition-opacity [@media(hover:none)]:pointer-events-none group-hover:opacity-100 focus-within:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onOpenMenu}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/80 backdrop-blur-md transition-colors hover:bg-black/75 hover:text-primary"
            aria-label={menuLabel}
            title={menuLabel}
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/50 px-2 py-0.5 text-label-sm text-white/85 backdrop-blur-md shadow-xs">
        {isStarred && (
          <Star
            className="h-3 w-3 shrink-0 fill-status-warning text-status-warning"
            aria-label={starredLabel}
          />
        )}
        {isEphemeral && (
          <Timer className="h-3 w-3 shrink-0 opacity-80" aria-label={ephemeralLabel} />
        )}
        {isEdited && (
          <span className="inline-flex items-center gap-1 italic opacity-85">
            <Pencil className="h-2.5 w-2.5" aria-hidden="true" />
            <span>{editedLabel}</span>
          </span>
        )}
        {timestamp && <span className="tabular-nums">{timestamp}</span>}
        {statusSlot}
      </div>
    </div>
  )
}

export interface ChatQuoteBlockProps {
  /** Name des zitierten Absenders. */
  senderName: string
  /** Kurzer Textauszug der zitierten Nachricht. */
  excerpt: string
  /** Ob sich das Zitat innerhalb einer eigenen (`isSelf`) Blase befindet. */
  isSelf?: boolean
  /** Optionaler Klick-Handler, um zur zitierten Nachricht zu springen. */
  onClick?: () => void
  /** Barrierefreie Beschreibung für den Sprung. */
  jumpLabel?: string
  className?: string
}

/**
 * ChatQuoteBlock: Einheitlicher Zitatblock innerhalb einer Nachrichtenblase (Design-DNA).
 */
export function ChatQuoteBlock({
  senderName,
  excerpt,
  isSelf = false,
  onClick,
  jumpLabel,
  className,
}: ChatQuoteBlockProps) {
  const content = (
    <span className="min-w-0 flex-1 space-y-0.5">
      <span
        className={cn(
          'block truncate text-label-sm font-semibold',
          isSelf ? 'text-white' : 'text-primary',
        )}
      >
        {senderName}
      </span>
      <span className="block line-clamp-2 text-label-sm leading-snug opacity-85">
        {excerpt}
      </span>
    </span>
  )

  const baseClasses = cn(
    'w-full text-left flex gap-2 rounded-lg px-2.5 py-1.5 border-l-2 transition-colors',
    isSelf
      ? 'bg-black/25 border-white/60 hover:bg-black/35 text-white'
      : 'bg-surface-container-highest/90 border-primary/70 hover:bg-surface-container-highest text-on-surface',
    className,
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className={baseClasses}
        aria-description={jumpLabel}
      >
        {content}
      </button>
    )
  }

  return <div className={baseClasses}>{content}</div>
}

export interface ChatComposerBannerProps {
  /** Modus des Banners über der Eingabeleiste: 'edit' (Bearbeiten) oder 'reply' (Antworten). */
  mode: 'edit' | 'reply'
  /** Überschrift (z. B. „Nachricht bearbeiten" oder „Antwort an Singra"). */
  title: string
  /** Vorschautext der bearbeiteten oder zitierten Nachricht. */
  text: string
  /** Optionaler Zusatzhinweis (z. B. dass nachfolgende KI-Antworten neu generiert werden). */
  hint?: string
  /** Schließen-/Abbrechen-Handler. */
  onCancel: () => void
  /** Barrierefreies Label für den Schließen-Knopf. */
  cancelLabel?: string
  className?: string
}

/**
 * ChatComposerBanner: Hochkontrastreiches Acrylglas-Banner für „Nachricht bearbeiten"
 * oder „Antwort an …" direkt in oder über der `ChatInputBar` (Design-DNA).
 * Garantiert perfekte Lesbarkeit auf allen Chathintergründen.
 */
export function ChatComposerBanner({
  mode,
  title,
  text,
  hint,
  onCancel,
  cancelLabel = 'Abbrechen',
  className,
}: ChatComposerBannerProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2.5 border-b border-white/12 bg-surface-container-high/95 px-3 py-2 text-on-surface backdrop-blur-xl first:rounded-t-3xl',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
          {mode === 'edit' ? (
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Reply className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-xs font-semibold text-primary">{title}</span>
            {hint && (
              <span className="text-label-sm text-on-surface-variant/90">· {hint}</span>
            )}
          </div>
          <p className="line-clamp-1 text-label-sm text-on-surface/85">{text}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
        aria-label={cancelLabel}
        title={cancelLabel}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
