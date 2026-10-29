import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import { buttonClasses } from '@/Singra/UI'
import { useHasPermission } from '@/hooks/useHasPermission'
import { AI_ZUSTELLUNG_EVENT } from '@/lib/aiZustellung'
import { AiChat } from '@/components/ai/AiChat'
import { SprachAnsicht } from '@/components/ai/voice/SprachAnsicht'
import { aiApi, type AiVoiceConfig } from '@/api/ai'

interface DocsChatPanelProps {
  uid: string
  selection?: { quote: string; hash?: string } | null
  onChanged?: () => void
}

/**
 * Der Dokument-Chat ist der bestehende KI-Chat mit einem Dokument-Scope.
 *
 * Kein eigener Verlauf, keine eigene Anhang- oder Sprachlogik: dieselben
 * Bausteine, derselbe Lauf, nur ein anderes Fenster je Dokument.
 */
export function DocsChatPanel({ uid, selection, onChanged }: DocsChatPanelProps) {
  const { t } = useTranslation()
  const canUseAi = useHasPermission('ai.docs.use')
  const canChat = useHasPermission('ai.chat.use')
  const canVoice = useHasPermission('ai.voice.use')
  const [modus, setModus] = useState<'chat' | 'sprache'>('chat')
  const [providerId, setProviderId] = useState<number | null>(null)
  const [voiceKonfiguration, setVoiceKonfiguration] = useState<AiVoiceConfig | null>(null)

  const scope = useMemo(
    () => ({
      kind: 'docs' as const,
      documentUid: uid,
      selection: selection?.quote ? { quote: selection.quote, hash: selection.hash } : undefined,
    }),
    [uid, selection?.quote, selection?.hash],
  )

  useEffect(() => {
    if (modus !== 'sprache' || !canVoice) return
    let aktiv = true
    void aiApi
      .getVoiceConfig(providerId)
      .then((config) => {
        if (aktiv) setVoiceKonfiguration(config)
      })
      .catch(() => {
        if (aktiv) setVoiceKonfiguration(null)
      })
    return () => {
      aktiv = false
    }
  }, [canVoice, modus, providerId])

  useEffect(() => {
    if (!onChanged) return
    const melden = () => onChanged()
    window.addEventListener(AI_ZUSTELLUNG_EVENT, melden)
    return () => window.removeEventListener(AI_ZUSTELLUNG_EVENT, melden)
  }, [onChanged])

  if (!canUseAi || !canChat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="h-8 w-8 text-on-surface-variant" />
        <p className="text-sm font-semibold text-on-surface">{t('docs.singra.notAllowedTitle')}</p>
        <p className="text-xs text-on-surface-variant">{t('docs.singra.notAllowedText')}</p>
        <Link to="/ai" className={buttonClasses('secondary', 'sm')}>
          {t('docs.singra.openChat')}
        </Link>
      </div>
    )
  }

  if (modus === 'sprache') {
    return (
      <SprachAnsicht
        konfiguration={voiceKonfiguration}
        providerId={providerId}
        documentUid={uid}
        aufChat={() => setModus('chat')}
      />
    )
  }

  return (
    <AiChat
      key={uid}
      scope={scope}
      eingebettet
      showTasks={false}
      showGuardian={false}
      showWorkers={false}
      canTasks={false}
      hasVoice={canVoice}
      onProviderChange={setProviderId}
      onSwitchMode={(naechster) => {
        if (naechster === 'sprache' && canVoice) setModus('sprache')
      }}
    />
  )
}
