import { Brain, ChevronDown, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiProviderAvailable } from '@/api/ai'
import { Kurzinfo } from '@maunting/ui'

import type { Denkwahl } from './AiModellBlatt'

interface AiChatModellPilleProps {
  provider: AiProviderAvailable | null
  providerMitModell: AiProviderAvailable | null
  selectedModel: string | null
  denken: Denkwahl
  busy: boolean
  singraShell: boolean
  onOpen: () => void
}

export function AiChatModellPille({
  provider,
  providerMitModell,
  selectedModel,
  denken,
  busy,
  singraShell,
  onOpen,
}: AiChatModellPilleProps) {
  const { t } = useTranslation()
  const label = t('ai.chat.modelSwitch')

  return (
    <Kurzinfo text={label} lage="oben">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-xs font-medium transition-all active:scale-95 cursor-pointer max-w-[180px] sm:max-w-[260px] shrink-0 ${
          singraShell
            ? 'border-white/15 bg-white/5 hover:bg-white/10 text-white shadow-sm'
            : 'border-outline-variant/30 bg-surface-container-high/60 hover:bg-surface-container-high text-on-surface'
        }`}
        aria-label={label}
      >
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
        <div className="flex items-center gap-1 min-w-0 text-xs">
          <span className="text-white/60 text-label-sm truncate hidden sm:inline max-w-[70px]">
            {provider?.name || 'KI'}
          </span>
          <span className="text-white/30 shrink-0 hidden sm:inline">·</span>
          <span className="truncate font-medium">
            {selectedModel || provider?.default_model || 'Modell'}
          </span>
        </div>
        {providerMitModell?.reasoning && denken.an && (
          <span className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-label-sm font-medium shrink-0">
            <Brain className="h-2.5 w-2.5" aria-hidden="true" />
            <span className="truncate max-w-[50px]">
              {denken.stufe ? t(`ai.reasoning.levels.${denken.stufe}`, { defaultValue: denken.stufe }) : 'Aktiv'}
            </span>
          </span>
        )}
        <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
      </button>
    </Kurzinfo>
  )
}
