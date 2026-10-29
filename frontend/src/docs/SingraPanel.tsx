import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { Button, Dropdown, Textarea } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { api } from '@/api/client'
import { useHasPermission } from '@/hooks/useHasPermission'
import {
  aiApi,
  streamAiMessage,
  type AiConversationDetail,
  type AiProviderAvailable,
  type AiStreamEvent,
} from '@/api/ai'

interface SingraPanelProps {
  uid: string
  canEdit: boolean
  selection?: { quote: string; hash?: string } | null
  onChanged?: () => void
}

type Eintrag = { role: 'user' | 'ai'; text: string }

/**
 * Der Dokument-Chat laeuft ueber denselben Lauf wie der KI-Bereich, nur mit
 * `document_uid`. Der Server schneidet den Werkzeugkatalog auf Dokumente.
 */
export function SingraPanel({ uid, canEdit, selection, onChanged }: SingraPanelProps) {
  const { t } = useTranslation()
  const canUseAi = useHasPermission('ai.docs.use')
  const canChat = useHasPermission('ai.chat.use')
  const [providers, setProviders] = useState<AiProviderAvailable[]>([])
  const [providerId, setProviderId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [verlauf, setVerlauf] = useState<Eintrag[]>([])
  const [streaming, setStreaming] = useState(false)
  const [werkzeug, setWerkzeug] = useState<string | null>(null)
  const laufRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!canUseAi || !canChat) return
    void aiApi
      .listProviders()
      .then((liste) => {
        const nutzbar = liste.filter((eintrag) => eintrag.available)
        setProviders(nutzbar)
        setProviderId((alt) => alt ?? nutzbar[0]?.id ?? null)
      })
      .catch(() => setProviders([]))
  }, [canChat, canUseAi])

  useEffect(() => () => laufRef.current?.abort(), [])

  useEffect(() => {
    if (!canUseAi || !canChat) return
    let aktiv = true
    void api<AiConversationDetail>(
      `/ai/conversation?kind=docs&document_uid=${encodeURIComponent(uid)}`,
    )
      .then((daten) => {
        if (!aktiv) return
        setVerlauf(
          daten.messages
            .filter((nachricht) => nachricht.role === 'user' || nachricht.role === 'assistant')
            .map((nachricht) => ({
              role: nachricht.role === 'user' ? ('user' as const) : ('ai' as const),
              text: nachricht.content,
            })),
        )
      })
      .catch(() => {
        /* Ohne Verlauf bleibt das Panel benutzbar; der naechste Senden-Ruf legt ihn an. */
      })
    return () => {
      aktiv = false
    }
  }, [canChat, canUseAi, uid])

  if (!canUseAi || !canChat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="h-8 w-8 text-on-surface-variant" />
        <p className="text-sm font-semibold text-on-surface">{t('docs.singra.notAllowedTitle')}</p>
        <p className="text-xs text-on-surface-variant">{t('docs.singra.notAllowedText')}</p>
      </div>
    )
  }

  const senden = async () => {
    const frage = text.trim()
    if (!frage || !providerId || streaming) return
    setText('')
    setVerlauf((alt) => [...alt, { role: 'user', text: frage }, { role: 'ai', text: '' }])
    setStreaming(true)
    setWerkzeug(null)
    const controller = new AbortController()
    laufRef.current = controller
    const anhaengen = (stueck: string) =>
      setVerlauf((alt) => {
        const kopie = [...alt]
        const letzter = kopie[kopie.length - 1]
        if (letzter?.role === 'ai') kopie[kopie.length - 1] = { ...letzter, text: letzter.text + stueck }
        return kopie
      })
    const onEvent = (event: AiStreamEvent) => {
      if (event.event === 'delta') anhaengen(event.data.content)
      else if (event.event === 'tool') setWerkzeug(event.data.tool_name)
      else if (event.event === 'error') {
        toast.error(t('docs.singra.error'))
        anhaengen(t('docs.singra.error'))
      }
    }
    try {
      await streamAiMessage(
        {
          content: frage,
          provider_id: providerId,
          request_id: crypto.randomUUID(),
          reasoning: false,
          document_uid: uid,
          selection: selection?.quote ? selection : undefined,
        },
        onEvent,
        controller.signal,
      )
      onChanged?.()
    } catch {
      toast.error(t('docs.singra.error'))
    } finally {
      setStreaming(false)
      setWerkzeug(null)
      laufRef.current = null
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-outline-variant/40 p-3">
        <Dropdown
          aria-label={t('docs.singra.provider')}
          value={providerId === null ? '' : String(providerId)}
          onChange={(wert) => setProviderId(Number(wert))}
          options={providers.map((eintrag) => ({ value: String(eintrag.id), label: eintrag.name }))}
          placeholder={t('docs.singra.noProvider')}
          disabled={providers.length === 0 || streaming}
          buttonClassName="w-full"
        />
        <p className="mt-2 text-label-sm text-on-surface-variant">{t('docs.singra.privacy')}</p>
        {!canEdit && <p className="mt-1 text-label-sm text-on-surface-variant">{t('docs.singra.readOnlyHint')}</p>}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {verlauf.length === 0 && (
          <p className="py-6 text-center text-xs text-on-surface-variant">{t('docs.singra.empty')}</p>
        )}
        {verlauf.map((eintrag, index) => (
          <div
            key={`${eintrag.role}-${index}`}
            className={`rounded-xl px-3 py-2 text-sm ${
              eintrag.role === 'user'
                ? 'ml-auto max-w-[90%] bg-primary/15 text-on-surface'
                : 'max-w-[95%] bg-surface-container text-on-surface'
            }`}
          >
            <p className="whitespace-pre-wrap">{eintrag.text}</p>
          </div>
        ))}
        {werkzeug && (
          <p role="status" className="text-label-sm text-on-surface-variant">
            {t('docs.singra.toolRunning', { name: werkzeug })}
          </p>
        )}
      </div>

      <div className="border-t border-outline-variant/40 p-3">
        <Textarea
          aria-label={t('docs.singra.placeholder')}
          placeholder={t('docs.singra.placeholder')}
          value={text}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void senden()
            }
          }}
        />
        <Button
          className="mt-2 w-full"
          size="sm"
          disabled={streaming || !text.trim() || providerId === null}
          onClick={() => void senden()}
        >
          {streaming ? t('docs.singra.running') : t('docs.singra.send')}
        </Button>
      </div>
    </div>
  )
}
