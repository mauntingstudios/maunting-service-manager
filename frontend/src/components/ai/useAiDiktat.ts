import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { aiApi } from '@/api/ai'
import { duckingBelegen } from '@/lib/audioDucking'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'
import { starteAufnahme, type Aufnahme } from './voice/audioAufnahme'

export interface DictationQuota {
  monthly_limit_minutes: number | null
  used_seconds: number
  remaining_seconds: number | null
}

interface UseAiDiktatOptions {
  providerId: number | null
  canUseVoice: boolean
  input: string
  setInput: Dispatch<SetStateAction<string>>
  inputRef: RefObject<HTMLTextAreaElement | null>
  mountedRef: MutableRefObject<boolean>
}

export function useAiDiktat({
  providerId,
  canUseVoice,
  input,
  setInput,
  inputRef,
  mountedRef,
}: UseAiDiktatOptions) {
  const { t } = useTranslation()
  const [dictationAvailable, setDictationAvailable] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [dictationQuota, setDictationQuota] = useState<DictationQuota | null>(null)
  const [dictationElapsed, setDictationElapsed] = useState(0)
  const [dictationAudioLevel, setDictationAudioLevel] = useState(0)

  const dictationRef = useRef<Aufnahme | null>(null)
  const dictationDuckingRef = useRef<(() => void) | null>(null)
  const dictationChunksRef = useRef<ArrayBuffer[]>([])
  const dictationSelectionRef = useRef<{ start: number; end: number } | null>(null)

  const freigebenDiktatDucking = useCallback(() => {
    dictationDuckingRef.current?.()
    dictationDuckingRef.current = null
  }, [])

  useEffect(() => {
    let active = true
    if (!providerId || !canUseVoice) {
      setDictationAvailable(false)
      setDictationQuota(null)
      return
    }
    aiApi.getVoiceConfig(providerId)
      .then((config) => {
        if (active) {
          setDictationAvailable(Boolean(config.dictation_available))
          setDictationQuota({
            monthly_limit_minutes: config.dictation_monthly_limit_minutes ?? null,
            used_seconds: config.dictation_used_seconds ?? 0,
            remaining_seconds: config.dictation_remaining_seconds ?? null,
          })
        }
      })
      .catch(() => {
        if (active) {
          setDictationAvailable(false)
          setDictationQuota(null)
        }
      })
    return () => { active = false }
  }, [providerId, canUseVoice])

  const diktatAbbrechen = useCallback(() => {
    freigebenDiktatDucking()
    if (dictationRef.current) {
      dictationRef.current.beenden()
      dictationRef.current = null
    }
    dictationChunksRef.current = []
    setDictating(false)
    setDictationElapsed(0)
  }, [freigebenDiktatDucking])

  const diktatUmschalten = useCallback(async () => {
    if (!providerId || transcribing) return
    if (!dictationRef.current) {
      if (
        dictationQuota?.remaining_seconds !== null &&
        dictationQuota?.remaining_seconds !== undefined &&
        dictationQuota.remaining_seconds <= 0
      ) {
        toast.error(t('ai.chat.dictationQuotaExceeded'))
        return
      }
      const feld = inputRef.current
      const start = feld?.selectionStart ?? input.length
      const end = feld?.selectionEnd ?? start
      dictationSelectionRef.current = { start, end }
      dictationChunksRef.current = []
      try {
        const aufnahme = await starteAufnahme((chunk) => dictationChunksRef.current.push(chunk))
        if (!mountedRef.current) {
          aufnahme.beenden()
          return
        }
        dictationRef.current = aufnahme
        freigebenDiktatDucking()
        dictationDuckingRef.current = duckingBelegen('ai-dictation')
        setDictating(true)
        setDictationElapsed(0)
      } catch (err) {
        still(err, 'ai.dictation.start')
        freigebenDiktatDucking()
        toast.error(t('ai.chat.dictationError'))
      }
      return
    }

    freigebenDiktatDucking()
    dictationRef.current.beenden()
    dictationRef.current = null
    setDictating(false)
    setDictationElapsed(0)
    const chunks = dictationChunksRef.current
    dictationChunksRef.current = []
    const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    if (!bytes) return
    const pcm = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(new Uint8Array(chunk), offset)
      offset += chunk.byteLength
    }
    setTranscribing(true)
    try {
      const { text } = await aiApi.transcribeVoice(providerId, pcm.buffer)
      const sel = dictationSelectionRef.current
      dictationSelectionRef.current = null
      setInput((aktuelleEingabe) => {
        const start = sel?.start ?? (inputRef.current?.selectionStart ?? aktuelleEingabe.length)
        const end = sel?.end ?? (inputRef.current?.selectionEnd ?? start)
        const neu = `${aktuelleEingabe.slice(0, start)}${text}${aktuelleEingabe.slice(end)}`.slice(0, 16_000)
        requestAnimationFrame(() => {
          const cursor = Math.min(neu.length, start + text.length)
          inputRef.current?.setSelectionRange(cursor, cursor)
          inputRef.current?.focus()
        })
        return neu
      })
      aiApi.getVoiceConfig(providerId).then((config) => {
        setDictationQuota({
          monthly_limit_minutes: config.dictation_monthly_limit_minutes ?? null,
          used_seconds: config.dictation_used_seconds ?? 0,
          remaining_seconds: config.dictation_remaining_seconds ?? null,
        })
      }).catch((err) => still(err, 'ai.dictation.quota'))
    } catch (err) {
      still(err, 'ai.dictation.transcribe')
      toast.error(t('ai.chat.dictationError'))
    } finally {
      setTranscribing(false)
    }
  }, [dictationQuota, freigebenDiktatDucking, input, inputRef, mountedRef, providerId, setInput, t, transcribing])

  useEffect(() => {
    if (!dictating) {
      setDictationElapsed(0)
      setDictationAudioLevel(0)
      return
    }
    const timer = setInterval(() => {
      setDictationElapsed((prev) => {
        const next = prev + 1
        if (
          dictationQuota?.remaining_seconds !== null &&
          dictationQuota?.remaining_seconds !== undefined &&
          next >= dictationQuota.remaining_seconds
        ) {
          void diktatUmschalten()
        }
        return next
      })
    }, 1000)

    let animId = 0
    let running = true
    const pollLevel = () => {
      if (!running) return
      if (dictationRef.current) {
        setDictationAudioLevel(dictationRef.current.pegel())
      }
      animId = requestAnimationFrame(pollLevel)
    }
    animId = requestAnimationFrame(pollLevel)

    return () => {
      clearInterval(timer)
      running = false
      cancelAnimationFrame(animId)
    }
  }, [dictating, dictationQuota, diktatUmschalten])

  useEffect(() => () => {
    dictationRef.current?.beenden()
    freigebenDiktatDucking()
  }, [freigebenDiktatDucking])

  return {
    dictationAvailable,
    dictating,
    transcribing,
    dictationQuota,
    dictationElapsed,
    dictationAudioLevel,
    diktatAbbrechen,
    diktatUmschalten,
  }
}
