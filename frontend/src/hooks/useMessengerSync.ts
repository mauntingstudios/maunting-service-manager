/**
 * Der Echtzeitstrom des Messengers: Anrufe, eintreffende Nachrichten, Tippen.
 *
 * Der Block stand bis 10/2026 mitten in `Messenger.tsx`. Herausgelöst ist er
 * unverändert — dieselben Ereignisse, dieselben Filter, dasselbe Aufräumen.
 *
 * Er ist die einzige Stelle, an der ein **eingehender** Umschlag ein Neuladen
 * auslöst. Der Echtzeitkanal haengt am Konto, und was hier
 * entschieden wird, entscheidet über die Latenz des ganzen Chats: die Nachricht
 * wird nicht beim nächsten Fünf-Sekunden-Takt sichtbar, sondern sofort.
 *
 * `msm:messages-updated` kommt aus der Warteschlange und lädt ebenfalls nach;
 * `msm:message-confirmed` **nicht** — die Bestätigung schreibt ihren Status
 * zuerst in die Ablage, und ein paralleles Neuladen läse den alten Stand.
 */

import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { ChatGroupItem, E2eeMessageItem } from '@/api/social'
import { useCallStore } from '@/stores/useCallStore'

type Aktivitaet = { status: 'typing' | 'recording'; username?: string } | null

export interface MessengerSyncOptionen {
  blindMailboxId: string
  /**
   * Alle Mailboxen dieses Gesprächs (Wiederholungen beider Kennungen).
   *
   * Ein Gespräch liest seit dem Umzug aus zwei: der Kennung aus dem
   * Chatgeheimnis und der alten, abgeleiteten. Kommt ein Umschlag in der neuen
   * an, trug er nicht die Kennung des Gesprächs — der Strom hielt sie für einen
   * fremden Chat und lud nicht nach. Die Nachricht erschien erst beim nächsten
   * Fünf-Sekunden-Takt.
   */
  leseMailboxen: readonly string[]
  currentUserId: number
  /** Nur für die Abhängigkeiten: eine geänderte Einstellung soll neu binden. */
  geraeteMeldungen: unknown
  loadMessages: (isInitial?: boolean) => Promise<void>
  /** Verarbeitet die geaenderte Zeile direkt statt eines Cursor-Abrufs. */
  beiNachrichtenEreignis?: (detail: { type?: string; message?: E2eeMessageItem }) => Promise<void>
  /** Verarbeitet eine Verfall-Aenderung des Gegenuebers. */
  beiEphemeral?: (detail: {
    chat_type?: string
    chat_id?: number
    ephemeral_ttl_seconds?: number
    ephemeral_enabled_by_user_id?: number | null
  }) => void
  chatType?: 'direct' | 'group' | null
  chatId?: number | null
  setGroups: Dispatch<SetStateAction<ChatGroupItem[]>>
  setActiveGroup: Dispatch<SetStateAction<ChatGroupItem | null>>
  setPartnerActivity: Dispatch<SetStateAction<Aktivitaet>>
  partnerActivityTimeoutRef: { current: ReturnType<typeof setTimeout> | null }
}

export function useMessengerSync(optionen: MessengerSyncOptionen): void {
  const {
    blindMailboxId,
    leseMailboxen,
    currentUserId,
    geraeteMeldungen,
    loadMessages,
    beiNachrichtenEreignis,
    beiEphemeral,
    chatType,
    chatId,
    setGroups,
    setActiveGroup,
    setPartnerActivity,
    partnerActivityTimeoutRef,
  } = optionen

  const loadRef = useRef(loadMessages)
  loadRef.current = loadMessages
  const ereignisRef = useRef(beiNachrichtenEreignis)
  ereignisRef.current = beiNachrichtenEreignis
  const ephemeralRef = useRef(beiEphemeral)
  ephemeralRef.current = beiEphemeral

  useEffect(() => {
    const handleSync = (e: Event) => {
      const ce = e as CustomEvent<any>
      const detail = ce.detail
      if (detail?.type === 'group_call_started') {
        if (!detail.group_id || !detail.room_token) return
        const groupId = Number(detail.group_id)
        const roomToken = String(detail.room_token)
        setGroups((prev) =>
          prev.map((group) =>
            group.id === groupId ? { ...group, room_token: roomToken } : group
          )
        )
        setActiveGroup((current) =>
          current?.id === groupId ? { ...current, room_token: roomToken } : current
        )
        useCallStore.getState().handleCallSyncEvent(detail)
      } else if (detail?.type === 'group_call_ended') {
        if (detail.group_id && detail.room_token) {
          const groupId = Number(detail.group_id)
          setGroups((prev) =>
            prev.map((group) =>
              group.id === groupId ? { ...group, room_token: null } : group
            )
          )
          setActiveGroup((current) =>
            current?.id === groupId ? { ...current, room_token: null } : current
          )
          useCallStore.getState().handleCallSyncEvent(detail)
        }
      } else if (
        detail?.type === 'direct_call_invitation' ||
        detail?.type === 'direct_call_rejected' ||
        detail?.type === 'direct_call_cancelled' ||
        detail?.type === 'call_key' ||
        detail?.type === 'user_call_state_changed' ||
        detail?.type === 'call_transferred' ||
        detail?.type === 'call_superseded' ||
        detail?.type === 'call_ended_remotely'
      ) {
        useCallStore.getState().handleCallSyncEvent(detail)
      } else if (
        detail?.type === 'message_created' ||
        detail?.type === 'message_updated' ||
        detail?.type === 'message_deleted' ||
        detail?.type === 'new_message'
      ) {
        if (
          (detail?.type === 'message_updated' || detail?.type === 'message_deleted') &&
          detail?.message &&
          ereignisRef.current &&
          chatType && chatId &&
          String(detail.chat_type ?? '') === chatType &&
          Number(detail.chat_id) === Number(chatId)
        ) {
          void ereignisRef.current(detail)
        } else {
          void loadRef.current(false)
        }
      } else if (detail?.type === 'chat_ephemeral') {
        if (
          ephemeralRef.current &&
          chatType && chatId &&
          String(detail.chat_type ?? '') === chatType &&
          Number(detail.chat_id) === Number(chatId)
        ) {
          ephemeralRef.current(detail)
        }
      } else if (detail?.type === 'delivery_receipt' || detail?.type === 'read_receipt' || detail?.type === 'chat_state') {
        // Der Wasserstand steht im Ereignis; der naechste Ladevorgang holt ihn
        // mit der Seite und rechnet die Haekchen neu.
        void loadRef.current(false)
      } else if (detail?.type === 'typing' || detail?.type === 'e2ee_typing_signal') {
        if (detail.sender_id === currentUserId) return
        if (
          !chatType ||
          !chatId ||
          String(detail.chat_type ?? '') !== chatType ||
          Number(detail.chat_id) !== Number(chatId)
        ) {
          return
        }
        if (partnerActivityTimeoutRef.current) {
          clearTimeout(partnerActivityTimeoutRef.current)
          partnerActivityTimeoutRef.current = null
        }
        if (detail.status === 'idle') {
          setPartnerActivity(null)
        } else if (detail.status === 'typing' || detail.status === 'recording') {
          setPartnerActivity({ status: detail.status, username: detail.sender_username })
          partnerActivityTimeoutRef.current = setTimeout(() => {
            setPartnerActivity(null)
          }, 4500)
        }
      }
    }

    const handleMessagesUpdated = () => {
      void loadRef.current(false)
    }

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void loadRef.current(false)
      }
    }

    window.addEventListener('msm:sync-event', handleSync)
    window.addEventListener('msm:messages-updated', handleMessagesUpdated)
    // `msm:message-confirmed` startet **kein** volles Neuladen mehr. Die
    // Bestätigung schreibt ihren Status zuerst in die Ablage; ein paralleles
    // `loadMessages` las vorher den alten Stand und setzte die Uhr zurück.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
    return () => {
      window.removeEventListener('msm:sync-event', handleSync)
      window.removeEventListener('msm:messages-updated', handleMessagesUpdated)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      if (partnerActivityTimeoutRef.current) {
        clearTimeout(partnerActivityTimeoutRef.current)
      }
    }
    // Die Liste selbst wechselt bei jedem Render die Referenz; ihre
    // zusammengesetzte Form nicht.
  }, [blindMailboxId, currentUserId, geraeteMeldungen, leseMailboxen.join('|'), chatType, chatId])
}
