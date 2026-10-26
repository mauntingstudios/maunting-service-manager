/**
 * Nachrichten laden und anzeigen — ohne Mailbox, Queue oder Ratchet.
 *
 * Der Server liefert die neuesten 50 Nachrichten; der Client entschluesselt sie
 * mit dem Chat-Schluessel und prueft die Absendersignatur. Aeltere Seiten holt
 * `ladeAeltere` per `before_id`, neue per `after_id`. Die Wasserstaende fuer
 * die Haekchen kommen direkt aus derselben Antwort.
 */

import type { Dispatch, SetStateAction } from 'react'

import type { ChatGroupItem } from '@/api/social'
import { ackChatMessages, readChatMessages } from '@/api/social'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import type { ChatContact } from '@/components/social/sidebar/ConversationListItem'
import type { Konversation } from '@/hooks/useKonversation'
import type { E2eeIdentity } from '@/services/e2eeIdentity'
import { ereignisseAusNachrichten } from '@/services/funkenService'
import {
  merkePartnerQuittung,
  merkeQuittung,
} from '@/services/quittungsstand'
import { useFunkenStore } from '@/stores/funkenStore'
import {
  loadLocalMessages,
  mischeVerlauf,
  saveLocalMessagesStrict,
  sortMessagesChronologically,
} from '@/services/messengerLocalStore'

export interface NachrichtenLadenOptionen {
  blindMailboxId: string
  currentUserId: number
  activeContact: ChatContact | null
  activeGroup: ChatGroupItem | null
  gruppenrechteVon: (konto: number) => Set<string>
  t: (schluessel: string, werte?: Record<string, unknown>) => string
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  setLoadingMessages: Dispatch<SetStateAction<boolean>>
  setAngeheftet: Dispatch<SetStateAction<ChatMessage | null>>
  setVerfallSekunden: (sekunden: number) => void
  zeigeSystemzeile: (text: string, kennung?: string) => void
  markAsRead: (mailbox: string) => void
  isBlocked: (userId: number) => boolean
  readReceiptsEnabled: boolean
  konversation: Konversation
  identityRef: { current: E2eeIdentity | null }
  activeMailboxIdRef: { current: string }
  currentLoadSeqRef: { current: number }
  maxPartnerReadIdRef: { current: number }
  maxPartnerDeliveredIdRef: { current: number }
  highestIncomingIdDeliveredRef: { current: number }
  highestIncomingIdAcknowledgedRef: { current: number }
  sendE2eeControlMessage: (payload: Record<string, unknown>) => Promise<void>
}

export function useNachrichtenLaden(optionen: NachrichtenLadenOptionen) {
  const {
    blindMailboxId,
    currentUserId,
    activeContact,
    activeGroup,
    t,
    setMessages,
    setLoadingMessages,
    setAngeheftet,
    setVerfallSekunden,
    zeigeSystemzeile,
    markAsRead,
    isBlocked,
    readReceiptsEnabled,
    konversation,
    activeMailboxIdRef,
    currentLoadSeqRef,
    maxPartnerReadIdRef,
    maxPartnerDeliveredIdRef,
    highestIncomingIdDeliveredRef,
    highestIncomingIdAcknowledgedRef,
  } = optionen

  const art = activeGroup ? ('gruppe' as const) : ('direkt' as const)

  const quittiere = async (
    messages: ChatMessage[],
    chatType: 'direct' | 'group',
    chatId: number,
  ) => {
    if (!chatId) return
    const incoming = messages.filter((m) => !m.isSelf && m.id > 0)
    const maxIncomingId = incoming.reduce((max, m) => Math.max(max, m.id), 0)
    const istGruppe = Boolean(activeGroup)
    const isTargetBlocked = activeContact ? isBlocked(activeContact.userId) : false
    const sichtbar =
      typeof document === 'undefined' || document.visibilityState === 'visible'

    if (
      !istGruppe &&
      maxIncomingId > 0 &&
      maxIncomingId > highestIncomingIdDeliveredRef.current &&
      !isTargetBlocked
    ) {
      highestIncomingIdDeliveredRef.current = maxIncomingId
      merkeQuittung(blindMailboxId, 'zugestellt', maxIncomingId)
      await ackChatMessages(chatType, chatId, maxIncomingId).catch(() => null)
    }

    if (
      !istGruppe &&
      maxIncomingId > 0 &&
      maxIncomingId > highestIncomingIdAcknowledgedRef.current &&
      readReceiptsEnabled &&
      sichtbar &&
      !isTargetBlocked
    ) {
      highestIncomingIdAcknowledgedRef.current = maxIncomingId
      merkeQuittung(blindMailboxId, 'gelesen', maxIncomingId)
      merkeQuittung(blindMailboxId, 'zugestellt', maxIncomingId)
      await readChatMessages(chatType, chatId, maxIncomingId).catch(() => null)
    }
  }

  const loadMessages = async (isInitial = false) => {
    const currentMid = blindMailboxId
    if (!currentMid || !currentUserId) return
    if (activeMailboxIdRef.current !== currentMid) return
    const seq = ++currentLoadSeqRef.current
    if (isInitial) setLoadingMessages(true)
    try {
      const gelesen = await konversation.liesNachrichten()
      if (!gelesen) return
      if (
        activeMailboxIdRef.current !== currentMid ||
        currentLoadSeqRef.current !== seq ||
        gelesen.speicherId !== currentMid
      ) {
        return
      }

      const lokal = await loadLocalMessages(currentMid)
      const lokalMitHaken = lokal.map((m) =>
        m.isSelf && m.id > 0 && m.id < 1e11
          ? {
              ...m,
              isRead: m.isRead || m.id <= gelesen.page.partner_last_read_id,
              isDelivered:
                m.isDelivered ||
                m.isRead ||
                m.id <= gelesen.page.partner_last_delivered_id,
              status:
                m.isRead || m.id <= gelesen.page.partner_last_read_id
                  ? ('read' as const)
                  : m.isDelivered || m.id <= gelesen.page.partner_last_delivered_id
                    ? ('delivered' as const)
                    : m.status,
            }
          : m,
      )
      if (
        activeMailboxIdRef.current !== currentMid ||
        currentLoadSeqRef.current !== seq ||
        gelesen.speicherId !== currentMid
      ) {
        return
      }
      const gemischt = mischeVerlauf(lokalMitHaken.slice(-500), gelesen.messages, art)
      setMessages(gemischt)

      /*
       * Der offene Chat ist die zweite Quelle fuer Augenblicke. `FunkenWache`
       * ueberspringt ihn bewusst (`akte.partnerId === aktiverPartner`), weil
       * sonst jede Zeile doppelt gelesen wuerde. Ohne diese Uebergabe fiel die
       * eingehende Haelfte weg, solange der Chat offen war: der eigene Versand
       * zaehlt sich in `useMessengerSenden` selbst, die Gegenseite kam nie an.
       * Die Nachrichten sind hier bereits mit dem Chat-Schluessel geoeffnet
       * und ueber die Kontosignatur geprueft.
       */
      if (gelesen.chatType === 'direct' && activeContact) {
        const augenblicke = ereignisseAusNachrichten(
          gelesen.messages,
          currentUserId,
          activeContact.userId,
        )
        if (augenblicke.length) {
          void useFunkenStore.getState().nimmAuf(activeContact.userId, augenblicke)
        }
      }

      // Der Pin gehoert zum Serverzustand, nicht in einen lokalen zweiten
      // Speicher. Die Seite nennt die neueste Anheftung unabhaengig davon,
      // ob sie in den letzten 50 Zeilen liegt.
      if (gelesen.page.pinned_message) {
        const angeheftet = await konversation.verarbeiteEreignis(
          gelesen.page.pinned_message,
          'message_updated',
        )
        // Nach dem Entschluesseln kann das Gespraech gewechselt haben. Der Pin
        // der alten Seite gehoert dann nicht in die neue Leiste.
        if (
          activeMailboxIdRef.current !== currentMid ||
          currentLoadSeqRef.current !== seq ||
          gelesen.speicherId !== currentMid
        ) {
          return
        }
        setAngeheftet(angeheftet)
      } else {
        setAngeheftet(null)
      }

      await saveLocalMessagesStrict(currentMid, gelesen.messages, art)
      gelesen.uebernimm()

      maxPartnerReadIdRef.current = Math.max(
        maxPartnerReadIdRef.current,
        gelesen.page.partner_last_read_id,
      )
      maxPartnerDeliveredIdRef.current = Math.max(
        maxPartnerDeliveredIdRef.current,
        gelesen.page.partner_last_delivered_id,
      )
      merkePartnerQuittung(currentMid, 'gelesen', gelesen.page.partner_last_read_id)
      merkePartnerQuittung(currentMid, 'zugestellt', gelesen.page.partner_last_delivered_id)

      setVerfallSekunden(gelesen.page.ephemeral_ttl_seconds)

      markAsRead(currentMid)
      await quittiere(gelesen.messages, gelesen.chatType, gelesen.chatId)

      if (gelesen.unlesbar > 0) {
        zeigeSystemzeile(
          t('messenger.unreadableOlderMessages'),
          `unlesbar-${currentMid}`,
        )
      }
    } catch {
      // Der nächste Takt versucht es erneut. Kein stiller Zustand: die Seite
      // behält den lokalen Verlauf.
    } finally {
      if (isInitial) setLoadingMessages(false)
    }
  }

  const ladeAeltere = async (): Promise<void> => {
    const currentMid = blindMailboxId
    if (!currentMid) return
    const ids = optionen.messages.map((m) => m.id).filter((id) => id > 0)
    const minId = ids.length ? Math.min(...ids) : 0
    if (!minId) return
    try {
      const gelesen = await konversation.ladeAeltere(minId)
      if (!gelesen.messages.length) return
      const lokal = await loadLocalMessages(currentMid)
      const gemischt = sortMessagesChronologically(
        mischeVerlauf(lokal, gelesen.messages, art),
      )
      setMessages(gemischt)
      await saveLocalMessagesStrict(currentMid, gelesen.messages, art)
    } catch {
      // Siehe oben: die nächste Berührung versucht es erneut.
    }
  }

  return { loadMessages, ladeAeltere }
}
