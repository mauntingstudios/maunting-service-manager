import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, MicOff, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button, buttonClasses } from '@/Singra/UI'
import { useHasPermission } from '@/hooks/useHasPermission'
import { AI_ZUSTELLUNG_EVENT } from '@/lib/aiZustellung'
import { AiChat } from '@/components/ai/AiChat'
import { SprachAnsicht } from '@/components/ai/voice/SprachAnsicht'
import { aiApi, type AiVoiceConfig } from '@/api/ai'

const DOCS_BEISPIELE = ['zusammenfassen', 'pruefen', 'gliedern'] as const

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
  const [voiceLaedt, setVoiceLaedt] = useState(false)
  const [voiceFehler, setVoiceFehler] = useState<'unavailable' | 'connection' | null>(null)
  const [voiceVersuch, setVoiceVersuch] = useState(0)

  const scope = useMemo(
    () => ({
      kind: 'docs' as const,
      documentUid: uid,
      selection: selection?.quote ? { quote: selection.quote, hash: selection.hash } : undefined,
    }),
    [uid, selection?.quote, selection?.hash],
  )

  useEffect(() => {
    if (!canVoice) {
      setVoiceKonfiguration(null)
      setVoiceLaedt(false)
      setVoiceFehler(null)
      return
    }
    let aktiv = true
    // Keine alte Konfiguration weiterreichen: Provider- oder Retry-Wechsel
    // sollen keine Sitzung mit dem vorherigen Modus starten.
    setVoiceKonfiguration(null)
    setVoiceLaedt(true)
    setVoiceFehler(null)
    // Wie im normalen KI-Bereich: Konfiguration vor dem ersten Start laden.
    // Sonst mountet `SprachAnsicht` mit `legacy`, bevor der echte Modus
    // bekannt ist; ein späterer Moduswechsel baut den Socket nicht neu auf.
    void aiApi
      .getVoiceConfig(providerId ?? undefined)
      .then((config) => {
        if (!aktiv) return
        if (config.available) {
          setVoiceKonfiguration(config)
          return
        }
        setVoiceKonfiguration(null)
        setVoiceFehler('unavailable')
      })
      .catch(() => {
        if (!aktiv) return
        setVoiceKonfiguration(null)
        setVoiceFehler('connection')
      })
      .finally(() => {
        if (aktiv) setVoiceLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [canVoice, providerId, voiceVersuch])

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
    if (voiceLaedt) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-xs text-on-surface-variant">{t('common.loading')}</p>
        </div>
      )
    }
    if (!voiceKonfiguration) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <MicOff className="h-8 w-8 text-on-surface-variant" aria-hidden="true" />
          <p className="text-sm font-semibold text-on-surface">
            {t(voiceFehler === 'unavailable' ? 'docs.singra.voiceUnavailable' : 'ai.voice.errors.connection')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" onClick={() => setVoiceVersuch((wert) => wert + 1)}>
              {t('common.retry')}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setModus('chat')}>
              {t('ai.voice.toTextMode')}
            </Button>
          </div>
        </div>
      )
    }
    return (
      <SprachAnsicht
        key={`${providerId ?? 'auto'}:${voiceKonfiguration.mode}:${uid}`}
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
      hasVoice={canVoice && Boolean(voiceKonfiguration)}
      beispielSchluessel={DOCS_BEISPIELE}
      onProviderChange={setProviderId}
      onSwitchMode={(naechster) => {
        if (naechster === 'sprache' && canVoice && voiceKonfiguration) setModus('sprache')
      }}
    />
  )
}
