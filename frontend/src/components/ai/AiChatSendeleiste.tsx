import { AudioLines, ListPlus, Loader2, Mic, Send, Square, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiContextStatus } from '@/api/ai'
import { Kurzinfo } from '@maunting/ui'

import { AiContextMeter } from './AiContextMeter'

interface AiChatSendeleisteProps {
  hasVoiceTarget: boolean
  inlineVoiceActive: boolean
  onToggleVoice: () => void
  singraShell: boolean
  dictationAvailable: boolean
  transcribing: boolean
  uploading: boolean
  hasProvider: boolean
  onToggleDictation: () => void
  contextStatus: AiContextStatus | null
  streaming: boolean
  input: string
  hasAttachments: boolean
  editingMessage: boolean
  onStop: () => void
  onEnqueue: (text: string) => void
  onSendNowInterrupt: (text: string) => void
}

export function AiChatSendeleiste({
  hasVoiceTarget,
  inlineVoiceActive,
  onToggleVoice,
  singraShell,
  dictationAvailable,
  transcribing,
  uploading,
  hasProvider,
  onToggleDictation,
  contextStatus,
  streaming,
  input,
  hasAttachments,
  editingMessage,
  onStop,
  onEnqueue,
  onSendNowInterrupt,
}: AiChatSendeleisteProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
      {hasVoiceTarget && (
        <Kurzinfo text={inlineVoiceActive ? 'Realtime beenden' : 'Realtime Sprachmodus'} lage="oben">
          <button
            type="button"
            onClick={onToggleVoice}
            className={`grid h-8 w-8 place-items-center rounded-full transition-all active:scale-95 shrink-0 ${
              inlineVoiceActive
                ? 'bg-primary text-on-primary shadow-sm shadow-primary/30'
                : singraShell
                  ? 'border border-white/10 bg-white/5 text-primary hover:bg-white/15'
                  : 'border border-outline-variant/30 bg-surface-container-high/60 text-primary hover:bg-surface-container-high'
            }`}
            aria-label="Realtime Sprachmodus"
          >
            <AudioLines className={`h-4 w-4 ${inlineVoiceActive ? '' : 'animate-pulse'}`} aria-hidden="true" />
          </button>
        </Kurzinfo>
      )}

      {dictationAvailable && (
        <Kurzinfo text={t('ai.chat.dictationStart')} lage="oben">
          <button
            type="button"
            className={`grid h-8 w-8 place-items-center rounded-full transition-all active:scale-95 shrink-0 disabled:opacity-50 ${
              singraShell
                ? 'border border-white/10 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white'
                : 'border border-outline-variant/30 bg-surface-container-high/60 text-on-surface-variant hover:text-on-surface'
            }`}
            disabled={transcribing || uploading || !hasProvider}
            onClick={onToggleDictation}
            aria-label={t('ai.chat.dictationStart')}
          >
            {transcribing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </Kurzinfo>
      )}

      <AiContextMeter status={contextStatus} />

      {streaming ? (
        !input.trim() ? (
          <Kurzinfo text={t('ai.chat.stopRun')} lage="oben" seite="ende">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-full bg-status-destructive/15 text-status-destructive hover:bg-status-destructive/25 border border-status-destructive/30 transition-all active:scale-95 shrink-0"
              onClick={onStop}
              aria-label={t('ai.chat.stopRun')}
            >
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            </button>
          </Kurzinfo>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <Kurzinfo text={`${t('ai.chat.enqueue')} (Enter)`} lage="oben">
              <button
                type="button"
                className="flex h-8 items-center gap-1 px-2.5 rounded-full bg-primary text-on-primary hover:brightness-110 text-xs font-medium transition-all active:scale-95 shrink-0"
                onClick={() => onEnqueue(input)}
                aria-label={t('ai.chat.enqueue')}
              >
                <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t('ai.chat.enqueueShort', 'Einreihen')}</span>
              </button>
            </Kurzinfo>
            <Kurzinfo text={`${t('ai.chat.sendNowInterrupt')} (Alt+Enter)`} lage="oben" seite="ende">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full bg-status-destructive/20 text-status-destructive hover:bg-status-destructive/30 border border-status-destructive/40 transition-all active:scale-95 shrink-0"
                onClick={() => onSendNowInterrupt(input)}
                aria-label={t('ai.chat.sendNowInterrupt')}
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Kurzinfo>
          </div>
        )
      ) : (
        <Kurzinfo text={`${editingMessage ? t('ai.chat.editSend', { defaultValue: 'Neu senden' }) : t('ai.chat.send')} (Enter)`} lage="oben" seite="ende">
          <button
            type="submit"
            disabled={uploading || (!input.trim() && !hasAttachments) || !hasProvider}
            className={`grid h-8 w-8 place-items-center rounded-full bg-primary text-on-primary hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition-all active:scale-95 shrink-0 shadow-sm ${
              singraShell ? 'shadow-md' : ''
            }`}
            aria-label={editingMessage ? t('ai.chat.editSend', { defaultValue: 'Neu senden' }) : t('ai.chat.send')}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Kurzinfo>
      )}
    </div>
  )
}
