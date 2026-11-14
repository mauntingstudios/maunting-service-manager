import { useCallback, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'

import type { AiMessage } from '@/api/ai'
import { useMehrfachauswahl } from '@maunting/ui'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'
import type { Entry } from './useAiLauf'

interface UseAiNachrichtenAktionenOptions {
  entries: Entry[]
  inputRef: RefObject<HTMLTextAreaElement | null>
  setEditingMessage: Dispatch<SetStateAction<AiMessage | null>>
  setReplyingTo: Dispatch<SetStateAction<AiMessage | null>>
  setInput: Dispatch<SetStateAction<string>>
  setActionMenuMessage: Dispatch<SetStateAction<AiMessage | null>>
  setForwardMessages: Dispatch<SetStateAction<AiMessage[] | null>>
}

export function useAiNachrichtenAktionen({
  entries,
  inputRef,
  setEditingMessage,
  setReplyingTo,
  setInput,
  setActionMenuMessage,
  setForwardMessages,
}: UseAiNachrichtenAktionenOptions) {
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('msm:ai_starred_messages')
      if (raw) return new Set(JSON.parse(raw))
    } catch (err) {
      still(err, 'ai.starred.read')
    }
    return new Set()
  })

  const messageKeys = useMemo(
    () => entries.filter((e) => e.kind === 'message').map((e) => e.id),
    [entries],
  )
  const wahl = useMehrfachauswahl(messageKeys)
  const auswahlModus = wahl.auswahl !== null

  const gewaehlteNachrichten = useMemo(() => {
    if (!wahl.auswahl) return [] as AiMessage[]
    const set = wahl.auswahl
    return entries
      .filter((e): e is Extract<Entry, { kind: 'message' }> => e.kind === 'message' && set.has(e.id))
      .map((e) => e.message)
  }, [entries, wahl.auswahl])

  const handleToggleStar = useCallback((msg: AiMessage) => {
    setStarredIds((prev) => {
      const next = new Set(prev)
      if (next.has(msg.id)) {
        next.delete(msg.id)
      } else {
        next.add(msg.id)
      }
      try {
        localStorage.setItem('msm:ai_starred_messages', JSON.stringify(Array.from(next)))
      } catch (err) {
        still(err, 'ai.starred.write')
      }
      return next
    })
  }, [])

  const handleCopyMessage = useCallback((msg: AiMessage) => {
    if (!msg.content) return
    void navigator.clipboard.writeText(msg.content).then(
      () => toast.success('Text kopiert.'),
      () => toast.error('Konnte nicht kopiert werden.'),
    )
  }, [])

  const handleOpenMessageMenu = useCallback((msg: AiMessage) => {
    setActionMenuMessage(msg)
  }, [setActionMenuMessage])

  const handleToggleSelectMessage = useCallback(
    (msg: AiMessage) => {
      wahl.umschalten(msg.id)
    },
    [wahl],
  )

  const handleReplyToMessage = useCallback((msg: AiMessage) => {
    setEditingMessage(null)
    setReplyingTo(msg)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [inputRef, setEditingMessage, setReplyingTo])

  const handleEditMessage = useCallback((msg: AiMessage) => {
    if (msg.role !== 'user') return
    setReplyingTo(null)
    setEditingMessage(msg)
    setInput(msg.content)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`
      }
    })
  }, [inputRef, setEditingMessage, setInput, setReplyingTo])

  const handleBulkCopy = useCallback(() => {
    if (gewaehlteNachrichten.length === 0) return
    const text = gewaehlteNachrichten
      .map((m) => `${m.role === 'assistant' ? 'Singra' : 'Ich'}: ${m.content.trim()}`)
      .join('\n\n')
    void navigator.clipboard.writeText(text).then(
      () => {
        toast.success(`${gewaehlteNachrichten.length} Nachrichten kopiert.`)
        wahl.leeren()
      },
      () => toast.error('Konnte nicht kopiert werden.'),
    )
  }, [gewaehlteNachrichten, wahl])

  const handleBulkForward = useCallback(() => {
    if (gewaehlteNachrichten.length === 0) return
    setForwardMessages(gewaehlteNachrichten)
    wahl.leeren()
  }, [gewaehlteNachrichten, setForwardMessages, wahl])

  const handleBulkStar = useCallback(() => {
    if (gewaehlteNachrichten.length === 0) return
    setStarredIds((prev) => {
      const next = new Set(prev)
      const allStarred = gewaehlteNachrichten.every((m) => next.has(m.id))
      for (const m of gewaehlteNachrichten) {
        if (allStarred) next.delete(m.id)
        else next.add(m.id)
      }
      try {
        localStorage.setItem('msm:ai_starred_messages', JSON.stringify(Array.from(next)))
      } catch (err) {
        still(err, 'ai.starred.write')
      }
      return next
    })
    toast.success('Markierung aktualisiert.')
    wahl.leeren()
  }, [gewaehlteNachrichten, wahl])

  return {
    starredIds,
    wahl,
    auswahlModus,
    gewaehlteNachrichten,
    handleToggleStar,
    handleCopyMessage,
    handleOpenMessageMenu,
    handleToggleSelectMessage,
    handleReplyToMessage,
    handleEditMessage,
    handleBulkCopy,
    handleBulkForward,
    handleBulkStar,
  }
}
