import React, { forwardRef, useRef, useImperativeHandle } from 'react'

export interface ChatInputBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (e?: React.FormEvent) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  maxHeight?: number
  minHeight?: number
  leftActions?: React.ReactNode
  rightActions?: React.ReactNode
  /**
   * Was ueber dem Eingabefeld steht: ein Zitatkopf beim Antworten, die
   * Vorschlagsliste beim Tippen von `@`, ein Entwurfshinweis.
   */
  topSlot?: React.ReactNode
  /**
   * Stilvariante der Eingabeleiste:
   * - 'glass': Dunkles, durchscheinendes Acrylglas (bg-black/55 backdrop-blur-xl),
   *   ideal fuer stimmungsvolle Chathintergruende (Singra AI Chat, Messenger).
   * - 'default': Solide Container-Oberflaeche (bg-surface-container-low).
   */
  variant?: 'glass' | 'default'
  className?: string
  textareaClassName?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  'aria-label'?: string
}

export interface ChatInputBarRef {
  textarea: HTMLTextAreaElement | null
  focus: () => void
  resetHeight: () => void
}

/**
 * ChatInputBar: Projektuebergreifende, modulare Input-Leiste (Design-DNA)
 * fuer Chat, Messenger und KI-Assistent.
 * Bietet dynamisch mitwachsende Textarea, dezente Oberflaechenverlaeufe, saubere Fokus-Zustaende,
 * Acrylglas-Blur ('glass') und Slots fuer Anhaenge, Sprachaufnahme und Sende-Buttons.
 */
export const ChatInputBar = forwardRef<ChatInputBarRef, ChatInputBarProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      placeholder = 'Nachricht schreiben …',
      disabled = false,
      maxLength = 16000,
      maxHeight = 160,
      minHeight = 36,
      leftActions,
      rightActions,
      topSlot,
      variant = 'glass',
      className = '',
      textareaClassName = '',
      onKeyDown,
      'aria-label': ariaLabel = 'Nachricht',
    },
    ref
  ) => {
    const internalTextareaRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => ({
      get textarea() {
        return internalTextareaRef.current
      },
      focus: () => {
        internalTextareaRef.current?.focus()
      },
      resetHeight: () => {
        if (internalTextareaRef.current) {
          internalTextareaRef.current.style.height = `${minHeight}px`
        }
      },
    }))

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
      const target = e.target
      target.style.height = 'auto'
      target.style.height = `${Math.min(Math.max(target.scrollHeight, minHeight), maxHeight)}px`
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onKeyDown) {
        onKeyDown(e)
        if (e.defaultPrevented) return
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        onSubmit(e)
      }
    }

    const isGlass = variant === 'glass'

    return (
      <div
        className={`${
          isGlass
            ? 'rounded-3xl border border-white/15 bg-black/55 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.45)] focus-within:border-primary/55 transition-colors'
            : 'rounded-2xl border border-outline-variant/50 bg-surface-container-low transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20'
        } ${disabled ? 'opacity-60 pointer-events-none' : ''} ${className}`}
      >
        {topSlot}
        <div className="flex items-end gap-2 p-2">
          {leftActions && (
            <div className="flex items-center gap-1 shrink-0">
              {leftActions}
            </div>
          )}

          <textarea
            ref={internalTextareaRef}
            value={value}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            aria-label={ariaLabel}
            rows={1}
            style={{ minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
            className={`flex-1 resize-none border-0 bg-transparent py-1.5 text-sm leading-6 focus:outline-none focus:ring-0 ${
              isGlass
                ? 'text-white placeholder:text-white/55 px-1'
                : 'text-on-surface placeholder:text-on-surface-variant/60'
            } ${textareaClassName}`}
          />

          {rightActions && (
            <div className="flex items-center gap-1 shrink-0">
              {rightActions}
            </div>
          )}
        </div>
      </div>
    )
  }
)

ChatInputBar.displayName = 'ChatInputBar'
