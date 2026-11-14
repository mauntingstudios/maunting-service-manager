import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'

interface Optionen {
  blindMailboxId: string
  messages: ChatMessage[]
  ladeAeltere: () => Promise<void> | void
  hatMehrRef: MutableRefObject<boolean>
  laedtAeltereRef: MutableRefObject<boolean>
  unreadCounts: Record<string, number>
  markAsRead: (mid: string) => void
}

/**
 * Scroll-Steuerung, Nachladen älterer Nachrichten und „Neue Nachrichten“-Trenner
 * für den aktiven Chat-Verlauf.
 */
export function useMessengerScrollUndTrenner({
  blindMailboxId,
  messages,
  ladeAeltere,
  hatMehrRef,
  laedtAeltereRef,
  unreadCounts,
  markAsRead,
}: Optionen) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const justSentRef = useRef<boolean>(false)

  /**
   * Beim Öffnen eines Chats steht man unten, bei der letzten Nachricht.
   *
   * Deshalb wird nach einem Wechsel eine knappe Sekunde lang bei jedem Bild
   * hart ans Ende gesetzt — ohne Animation. Rührt der Nutzer das Rad oder den
   * Finger an, hört das sofort auf: ab da scrollt nur noch er.
   */
  const ansEndeRef = useRef(false)
  /** Scrollhöhe vor dem Nachladen älterer Nachrichten. */
  const seitenAnkerRef = useRef<{ hoehe: number; oben: number } | null>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !blindMailboxId) return

    ansEndeRef.current = true
    let abbruch = false
    const bis = Date.now() + 1200
    const ziehen = () => {
      if (abbruch || !ansEndeRef.current || !scrollContainerRef.current) return
      const c = scrollContainerRef.current
      c.scrollTop = c.scrollHeight
      if (Date.now() < bis) requestAnimationFrame(ziehen)
      else ansEndeRef.current = false
    }
    requestAnimationFrame(ziehen)

    // Eine echte Nutzergeste beendet das Nachziehen.
    const loslassen = () => {
      ansEndeRef.current = false
    }
    container.addEventListener('wheel', loslassen, { passive: true })
    container.addEventListener('touchstart', loslassen, { passive: true })

    return () => {
      abbruch = true
      container.removeEventListener('wheel', loslassen)
      container.removeEventListener('touchstart', loslassen)
    }
  }, [blindMailboxId])

  // Autoscroll bei neuen Nachrichten im offenen Chat.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (ansEndeRef.current) {
      container.scrollTop = container.scrollHeight
      return
    }
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120
    if (justSentRef.current || isNearBottom) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })
      justSentRef.current = false
    }
  }, [messages])

  /** Der Knopf „nach unten“ für weiter oben lesende Nutzer. */
  const [weitOben, setWeitOben] = useState(false)

  /** Die Trennlinie „Neue Nachrichten“. */
  const [trennerId, setTrennerId] = useState<number | null>(null)
  const ungelesenBeimOeffnen = useRef(0)
  const trennerGesetztFuer = useRef<string | null>(null)

  useEffect(() => {
    if (!blindMailboxId || !messages.length) return
    if (trennerGesetztFuer.current === blindMailboxId) return
    trennerGesetztFuer.current = blindMailboxId
    const offen = ungelesenBeimOeffnen.current
    ungelesenBeimOeffnen.current = 0
    if (!offen) {
      setTrennerId(null)
      return
    }
    const fremde = messages.filter((m) => !m.isSelf && !m.isSystem)
    const erste = fremde[Math.max(0, fremde.length - offen)]
    setTrennerId(erste ? erste.id : null)
  }, [blindMailboxId, messages])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const pruefe = () => {
      setWeitOben(container.scrollHeight - container.scrollTop - container.clientHeight > 400)
      if (
        container.scrollTop < 120 &&
        hatMehrRef.current &&
        !laedtAeltereRef.current &&
        !ansEndeRef.current
      ) {
        seitenAnkerRef.current = { hoehe: container.scrollHeight, oben: container.scrollTop }
        void ladeAeltere()
      }
    }
    pruefe()
    container.addEventListener('scroll', pruefe, { passive: true })
    return () => container.removeEventListener('scroll', pruefe)
  }, [blindMailboxId, ladeAeltere, hatMehrRef, laedtAeltereRef])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    const anker = seitenAnkerRef.current
    if (!container || !anker) return
    seitenAnkerRef.current = null
    container.scrollTop = anker.oben + (container.scrollHeight - anker.hoehe)
  }, [messages])

  /** Ein Chat aus der Liste geht auf: gelesen, und der Trenner merkt sich, wo man stand. */
  const oeffneAusListe = (mid: string | undefined) => {
    if (!mid) return
    ungelesenBeimOeffnen.current = unreadCounts[mid] || 0
    trennerGesetztFuer.current = null
    markAsRead(mid)
  }

  return {
    messagesEndRef,
    scrollContainerRef,
    justSentRef,
    weitOben,
    trennerId,
    oeffneAusListe,
  }
}
