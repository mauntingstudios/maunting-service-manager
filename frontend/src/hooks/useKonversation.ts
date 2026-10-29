/**
 * Ein Gespraech im neuen Einheits-Transport.
 *
 * Es gibt keine Mailbox, keinen Ratchet und keine Steuerumschlaege mehr. Ein
 * Direktchat und eine Gruppe sind Container fuer `e2ee_messages`; jede
 * Nachricht wird einmal mit dem `chat_key` verschluesselt und signiert.
 * Dieser Hook uebersetzt zwischen Serverzeilen und der Anzeige.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchChatMessages,
  getE2eeChatKeys,
  pinChatMessage,
  reactToChatMessage,
  deleteChatMessage,
  setChatEphemeral,
  startDirectChat,
  updateChatMessage,
  type E2eeMessageItem,
  type E2eeMessagePage,
} from '@/api/social'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import type { E2eeIdentity } from '@/services/e2eeIdentity'
import {
  ChatSchluesselFehltError,
  ChatNutzlastUngueltigError,
  entpackeChatNutzlast,
  entpackeReaktion,
  erzeugeChatSchluessel,
  verschluessleChatNutzlast,
  verschluessleReaktion,
} from '@/services/chatKrypto'
import { leseAugenblickMarke, leseRettungsMarke } from '@/services/funkenService'
import { verfallAusUmschlag } from '@/services/nachrichtVerfall'
import {
  legeOffeneNachrichtAb,
  ladeOffeneNachrichten,
  loescheOffeneNachricht,
  saveLocalMessagesStrict,
  schreibeOffeneNachricht,
} from '@/services/messengerLocalStore'
import { sendeWirkungMitOutbox, type Wirkungsziel } from '@/services/steuerOutbox'
import { SteuerAbgewiesenError, type SteuerAusgang, type SteuerEintrag } from '@/services/wirkungTypen'

export type GespraechsZiel =
  | { art: 'direkt'; peerId: number }
  | {
      art: 'gruppe'
      groupId: number
      mitglieder: readonly number[]
      istEigentuemer: boolean
    }
  | { art: 'keins' }

export type Lesung =
  | {
      art: 'klartext'
      env: {
        id: number
        blind_mailbox_id: string
        ciphertext_envelope: string
        client_uuid: string
        created_at: string
      }
      text: string
      vonKonto?: number
      /** Die bereits entschlüsselte und geprüfte Anzeigezeile. */
      nachricht?: ChatMessage
    }
  | { art: 'still'; env: { id: number } }

export interface Versandauftrag {
  blind_mailbox_id: string
  ciphertext_envelope: string
  client_uuid: string
  chat_type?: 'direct' | 'group'
  chat_id?: string
  key_version?: number
  is_control?: boolean
  control_type?: string
}

export interface GruppenKontext {
  groupId: number
  blindMailboxId?: string
  eigeneId: number
  mitglieder: readonly number[]
  istEigentuemer?: boolean
}

export interface DrKontext {
  eigeneId: number
  peerId: number
}

/**
 * Baut den Versand fuer ein anderes Ziel als das gerade offene Gespraech.
 * Wird beim Weiterleiten gebraucht.
 */
export async function baueVersandFuer(
  gruppenKontext: GruppenKontext | null,
  drKontext: DrKontext | null,
  blindMailboxId: string,
  payload: string,
  clientUuid: string,
): Promise<Versandauftrag[]> {
  const { baueChatVersand } = await import('@/services/chatVersand')
  if (gruppenKontext) {
    return baueChatVersand(
      {
        chatType: 'group',
        chatId: gruppenKontext.groupId,
        speicherId: blindMailboxId || `group:${gruppenKontext.groupId}`,
        memberIds: [...new Set([...gruppenKontext.mitglieder.map(Number), gruppenKontext.eigeneId])],
        senderId: gruppenKontext.eigeneId,
      },
      payload,
      clientUuid,
    )
  }
  if (drKontext) {
    const { startDirectChat } = await import('@/api/social')
    const chat = await startDirectChat(drKontext.peerId)
    return baueChatVersand(
      {
        chatType: 'direct',
        chatId: chat.id,
        speicherId: blindMailboxId || `direct:peer:${drKontext.peerId}`,
        memberIds: [drKontext.eigeneId, drKontext.peerId],
        senderId: drKontext.eigeneId,
      },
      payload,
      clientUuid,
    )
  }
  return []
}

export interface KonversationOptionen {
  ziel: GespraechsZiel
  eigeneId: number
  identitaetRef: { current: E2eeIdentity }
}

export interface NachrichtenLesung {
  messages: ChatMessage[]
  page: E2eeMessagePage
  hasMore: boolean
  unlesbar: number
  /** Umschlaege, die auf einen Schluessel warten; der Cursor darf weiterlaufen. */
  offen: number
  /** Die Kennungen, unter denen diese Seite wirklich geholt wurde. */
  speicherId: string
  chatType: 'direct' | 'group'
  chatId: number
  uebernimm: () => void
}

export interface Konversation {
  blindMailboxId: string
  leseMailboxen: string[]
  chatType: 'direct' | 'group' | null
  chatId: number | null
  ensureChat: () => Promise<{ type: 'direct' | 'group'; id: number } | null>
  /** Erzwingt eine neue Chat-Schlüsselversion für alle aktuellen Mitglieder. */
  erneuereSchluessel: () => Promise<void>
  /** Versucht aufgeschobene Umschlaege erneut zu oeffnen. */
  verarbeiteOffene: () => Promise<number>
  liesUmschlaege: () => Promise<Lesung[] | null>
  liesNachrichten: (nachId?: number) => Promise<NachrichtenLesung | null>
  ladeAeltere: (beforeId: number) => Promise<{ messages: ChatMessage[]; hasMore: boolean }>
  uebernimmLesestand: (lesung: Lesung[]) => void
  /** Verarbeitet ein einzelnes Live-Ereignis aus dem Echtzeitkanal. */
  verarbeiteEreignis: (
    message: E2eeMessageItem,
    typ: 'message_created' | 'message_updated' | 'message_deleted',
  ) => Promise<ChatMessage | null>
  baueVersand: (payload: string, clientUuid: string) => Promise<Versandauftrag[]>
  sendeWirkung: (eintrag: SteuerEintrag) => Promise<SteuerAusgang>
  /** Eine Wirkung für ein ausdrückliches Ziel (auch aus der Outbox). */
  sendeWirkungFuerZiel: (ziel: Wirkungsziel, eintrag: SteuerEintrag) => Promise<void>
}

interface ChatZiel {
  speicherId: string
  chatType: 'direct' | 'group' | null
  chatId: number | null
}

const direkteChats = new Map<string, number>()

function direkterSchluessel(konto: number, peer: number): string {
  return `${konto}:${peer}`
}

function useChatZiel(ziel: GespraechsZiel, eigeneId: number): ChatZiel {
  const speicherId =
    ziel.art === 'gruppe'
      ? `group:${ziel.groupId}`
      : ziel.art === 'direkt'
        ? `direct:peer:${ziel.peerId}`
        : ''
  const [zustand, setZustand] = useState<{ speicherId: string; id: number | null }>(() => ({
    speicherId,
    id: ziel.art === 'gruppe' ? ziel.groupId : null,
  }))

  useEffect(() => {
    if (ziel.art === 'gruppe') {
      setZustand({ speicherId, id: ziel.groupId })
      return
    }
    if (ziel.art !== 'direkt' || !eigeneId) {
      setZustand({ speicherId, id: null })
      return
    }
    const cached = direkteChats.get(direkterSchluessel(eigeneId, ziel.peerId))
    if (cached) {
      setZustand({ speicherId, id: cached })
      return
    }
    let aktiv = true
    void startDirectChat(ziel.peerId)
      .then((chat) => {
        direkteChats.set(direkterSchluessel(eigeneId, ziel.peerId), chat.id)
        if (aktiv) setZustand({ speicherId, id: chat.id })
      })
      .catch(() => {
        if (aktiv) setZustand({ speicherId, id: null })
      })
    return () => {
      aktiv = false
    }
  }, [speicherId, ziel.art, ziel.art === 'gruppe' ? ziel.groupId : ziel.art === 'direkt' ? ziel.peerId : 0, eigeneId])

  // Der Zustand des vorigen Gespraechs gilt hier nie. Vor dem Effekt ist die
  // chatId deshalb leer, nicht die des Vorgaengers.
  const chatId = zustand.speicherId === speicherId ? zustand.id : null
  return {
    speicherId,
    chatType: ziel.art === 'gruppe' ? 'group' : ziel.art === 'direkt' ? 'direct' : null,
    chatId,
  }
}

function alsAnhang(wert: unknown): any {
  return wert && typeof wert === 'object' ? wert : undefined
}

export function useKonversation({
  ziel,
  eigeneId,
}: KonversationOptionen): Konversation {
  const chat = useChatZiel(ziel, eigeneId)
  const chatRef = useRef(chat)
  chatRef.current = chat
  const cursorRef = useRef(0)
  const payloadCache = useRef(new Map<number, Record<string, unknown>>())
  const uebernimmCache = useRef(new WeakMap<Lesung[], () => void>())

  useEffect(() => {
    cursorRef.current = 0
    payloadCache.current.clear()
    uebernimmCache.current = new WeakMap()
  }, [chat.speicherId])

  const ensureChat = useCallback(async (): Promise<{ type: 'direct' | 'group'; id: number } | null> => {
    const aktuell = chatRef.current
    if (aktuell.speicherId !== chat.speicherId) return null
    if (aktuell.chatType === 'group' && aktuell.chatId) {
      return { type: 'group', id: aktuell.chatId }
    }
    if (aktuell.chatType !== 'direct' || ziel.art !== 'direkt' || !eigeneId) return null
    if (aktuell.chatId) return { type: 'direct', id: aktuell.chatId }
    const vorhanden = direkteChats.get(direkterSchluessel(eigeneId, ziel.peerId))
    if (vorhanden) return { type: 'direct', id: vorhanden }
    const erstellt = await startDirectChat(ziel.peerId)
    direkteChats.set(direkterSchluessel(eigeneId, ziel.peerId), erstellt.id)
    return { type: 'direct', id: erstellt.id }
  }, [eigeneId, ziel])

  const mitglieder = useCallback((): number[] => {
    if (ziel.art === 'gruppe') {
      return [...new Set([...ziel.mitglieder.map(Number), eigeneId].filter((id) => id > 0))]
    }
    if (ziel.art === 'direkt') return [eigeneId, ziel.peerId]
    return [eigeneId]
  }, [ziel, eigeneId])

  const ensureKeyVersionFuer = useCallback(async (
    chatType: 'direct' | 'group',
    chatId: number,
    memberIds: number[],
  ): Promise<number> => {
    const { keys, latest_key_version } = await getE2eeChatKeys(chatType, chatId)
    const eigeneVersionen = keys.map((k) => k.key_version)
    if (latest_key_version > 0 && eigeneVersionen.includes(latest_key_version)) {
      return latest_key_version
    }
    const version = latest_key_version > 0 ? latest_key_version + 1 : 1
    await erzeugeChatSchluessel(chatType, chatId, memberIds, version)
    const nachher = await getE2eeChatKeys(chatType, chatId)
    if (!nachher.keys.some((k) => k.key_version === version)) {
      throw new ChatSchluesselFehltError()
    }
    return version
  }, [])

  const ensureKeyVersion = useCallback(async (chatZiel: { type: 'direct' | 'group'; id: number }): Promise<number> => {
    return ensureKeyVersionFuer(chatZiel.type, chatZiel.id, mitglieder())
  }, [ensureKeyVersionFuer, mitglieder])

  const erneuereSchluessel = useCallback(async (): Promise<void> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) throw new ChatSchluesselFehltError()
    const { latest_key_version } = await getE2eeChatKeys(chatZiel.type, chatZiel.id)
    const version = latest_key_version > 0 ? latest_key_version + 1 : 1
    await erzeugeChatSchluessel(chatZiel.type, chatZiel.id, mitglieder(), version)
    const nachher = await getE2eeChatKeys(chatZiel.type, chatZiel.id)
    if (!nachher.keys.some((k) => k.key_version === version)) {
      throw new ChatSchluesselFehltError()
    }
  }, [ensureChat, mitglieder])

  const entschluessle = useCallback(async (
    chatZiel: { type: 'direct' | 'group'; id: number },
    message: E2eeMessageItem,
    page: E2eeMessagePage,
  ): Promise<ChatMessage | null> => {
    if (message.is_deleted) {
      return {
        id: message.id,
        clientUuid: message.client_uuid,
        senderId: message.sender_user_id,
        senderName: '',
        text: '',
        createdAt: message.created_at,
        isSelf: Number(message.sender_user_id) === Number(eigeneId),
        isDeleted: true,
        deletedAt: message.deleted_at || message.created_at,
        status: 'sent',
      }
    }

    // `holeChatSchluessel` holt die angefragte Version vom Server. Fehlt sie
    // wirklich, ist diese Nachricht unlesbar; eine neue Version hilft ihr
    // nicht und wuerde nur den Schluesselbestand aufblaehen.
    const payload = await entpackeChatNutzlast(
      chatZiel.type,
      chatZiel.id,
      message.client_uuid,
      message.sender_user_id,
      message.key_version,
      message.encrypted_payload,
    )

    payloadCache.current.set(message.id, payload)
    const senderId = Number(message.sender_user_id)
    const isSelf = senderId === Number(eigeneId)
    const reaktionen: Record<string, number[]> = {}
    for (const reaktion of message.reactions) {
      const emoji = await entpackeReaktion(
        chatZiel.type,
        chatZiel.id,
        message.key_version,
        message.id,
        reaktion.user_id,
        reaktion.encrypted_reaction,
      )
      if (emoji) (reaktionen[emoji] ||= []).push(reaktion.user_id)
    }

    const isRead = isSelf && message.id <= page.partner_last_read_id
    const isDelivered = isSelf && message.id <= page.partner_last_delivered_id
    const status: ChatMessage['status'] = isRead
      ? 'read'
      : isDelivered
        ? 'delivered'
        : 'sent'

    return {
      id: message.id,
      clientUuid: message.client_uuid,
      senderId,
      senderName: String(payload.sender_name || payload.sender_username || ''),
      text: String(payload.text || ''),
      createdAt: message.created_at,
      isSelf,
      isDelivered,
      isRead,
      isEdited: Boolean(message.edited_at),
      editedAt: message.edited_at || undefined,
      chatType: chatZiel.type,
      chatId: Number(chatZiel.id),
      isPinned: Boolean(message.is_pinned),
      pinnedAt: message.pinned_at || undefined,
      isDeleted: false,
      noteAttachment: alsAnhang(payload.note_attachment),
      calendarAttachment: alsAnhang(payload.calendar_attachment),
      imageAttachment: payload.image_attachment as ChatMessage['imageAttachment'],
      audioAttachment: payload.audio_attachment as ChatMessage['audioAttachment'],
      fileAttachment: payload.file_attachment as ChatMessage['fileAttachment'],
      stickerAttachment: payload.sticker_attachment as ChatMessage['stickerAttachment'],
      storyReply: payload.story_reply as ChatMessage['storyReply'],
      videoNoteAttachment: payload.video_note_attachment as ChatMessage['videoNoteAttachment'],
      antwortAuf: payload.antwort_auf as ChatMessage['antwortAuf'],
      weitergeleitet: Boolean(payload.weitergeleitet) || undefined,
      erwaehnungen: Array.isArray(payload.erwaehnungen) ? (payload.erwaehnungen as number[]) : undefined,
      erwaehntAlle: Boolean(payload.erwaehnt_alle) || undefined,
      /*
       * Der Serverstempel ist die Wahrheit; die signierte Nutzlast ist die
       * zweite Quelle. Sie trägt die Frist auch dann, wenn der Umschlag ohne
       * `expires_at` ankommt — etwa aus der offenen Ablage, die vor dem
       * Nachtragen des Feldes geschrieben wurde.
       */
      verfaelltAm: verfallAusUmschlag(message.expires_at, payload.verfaellt_am),
      augenblick:
        chatZiel.type === 'direct' ? leseAugenblickMarke(payload.augenblick) : undefined,
      funkenRettung:
        chatZiel.type === 'direct' ? leseRettungsMarke(payload.funken_rettung) : undefined,
      reaktionen: Object.keys(reaktionen).length ? reaktionen : undefined,
      status,
    }
  }, [eigeneId])

  const holeSeite = useCallback(async (
    chatZiel: { type: 'direct' | 'group'; id: number },
    beforeId?: number,
    nachId?: number,
  ): Promise<{
    page: E2eeMessagePage
    messages: ChatMessage[]
    unlesbar: number
    offen: number
  }> => {
    const afterId = beforeId
      ? undefined
      : nachId && nachId > 0
        ? Math.max(nachId, cursorRef.current)
        : cursorRef.current > 0
          ? cursorRef.current
          : undefined
    const page = await fetchChatMessages(chatZiel.type, chatZiel.id, {
      limit: beforeId ? 50 : afterId ? 100 : 50,
      ...(beforeId ? { beforeId } : afterId ? { afterId } : {}),
    })
    const messages: ChatMessage[] = []
    let unlesbar = 0
    let offen = 0
    const ergebnisse: (ChatMessage | null)[] = new Array(page.messages.length).fill(null)
    let naechste = 0

    /*
     * Begrenzt parallel, nicht nacheinander. Fünfzig Umschlaege einzeln zu
     * oeffnen kostete beim Oeffnen eines Chats Sekunden; jeder braucht nur den
     * Chat-Schluessel und die Kontosignatur, keinen gemeinsamen Zustand. Vier
     * gleichzeitig halten den Bildschirm frei und den Server ruhig.
     */
    const arbeiter = async () => {
      for (;;) {
        const index = naechste++
        if (index >= page.messages.length) return
        const message = page.messages[index]
        try {
          const fertig = await entschluessle(chatZiel, message, page)
          if (fertig) ergebnisse[index] = fertig
        } catch (fehler) {
          if (fehler instanceof ChatNutzlastUngueltigError) {
            unlesbar += 1
            continue
          }
          if (!message.client_uuid || !message.encrypted_payload) {
            unlesbar += 1
            continue
          }
          // Kein Urteil, sondern ein Aufschub. Der Cursor darf weiterlaufen;
          // der Umschlag bleibt fuer den naechsten Schluessel liegen.
          await legeOffeneNachrichtAb({
            id: `${chatZiel.type}:${chatZiel.id}:${message.client_uuid}`,
            chatType: chatZiel.type,
            chatId: chatZiel.id,
            clientUuid: message.client_uuid,
            senderId: Number(message.sender_user_id),
            keyVersion: Number(message.key_version),
            encryptedPayload: message.encrypted_payload,
            createdAt: message.created_at,
            expiresAt: message.expires_at || undefined,
          })
          offen += 1
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(4, page.messages.length) }, () => arbeiter()),
    )
    for (const fertig of ergebnisse) {
      if (fertig) messages.push(fertig)
    }
    return { page, messages, unlesbar, offen }
  }, [entschluessle])

  const liesNachrichten = useCallback(async (nachId?: number): Promise<NachrichtenLesung | null> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) return null
    const { page, messages, unlesbar, offen } = await holeSeite(chatZiel, undefined, nachId)
    const uebernimm = () => {
      const hoechste = page.messages.reduce((max, m) => Math.max(max, m.id), 0)
      if (hoechste > cursorRef.current) cursorRef.current = hoechste
    }
    return {
      messages,
      page,
      hasMore: page.has_more,
      unlesbar,
      offen,
      speicherId: chatRef.current.speicherId,
      chatType: chatZiel.type,
      chatId: chatZiel.id,
      uebernimm,
    }
  }, [ensureChat, holeSeite])

  const verarbeiteOffene = useCallback(async (): Promise<number> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) return 0
    const speicherId = chatRef.current.speicherId
    if (!speicherId) return 0
    const leer: E2eeMessagePage = {
      messages: [],
      pinned_message: null,
      has_more: false,
      my_last_delivered_id: 0,
      my_last_read_id: 0,
      partner_last_delivered_id: 0,
      partner_last_read_id: 0,
      ephemeral_ttl_seconds: 0,
      ephemeral_enabled_by_user_id: null,
    }
    const jetzt = Date.now()
    let verarbeitet = 0
    for (const auftrag of await ladeOffeneNachrichten()) {
      if (auftrag.chatType !== chatZiel.type || Number(auftrag.chatId) !== Number(chatZiel.id)) {
        continue
      }
      if (auftrag.naechsterVersuch > jetzt) continue
      const message: E2eeMessageItem = {
        id: 0,
        client_uuid: auftrag.clientUuid,
        chat_type: auftrag.chatType,
        chat_id: auftrag.chatId,
        sender_user_id: auftrag.senderId,
        key_version: auftrag.keyVersion,
        encrypted_payload: auftrag.encryptedPayload,
        is_deleted: false,
        edited_at: null,
        deleted_at: null,
        expires_at: auftrag.expiresAt ?? null,
        is_pinned: false,
        pinned_at: null,
        pinned_by_user_id: null,
        created_at: auftrag.createdAt,
        reactions: [],
      }
      try {
        const fertig = await entschluessle(chatZiel, message, leer)
        if (fertig) {
          await saveLocalMessagesStrict(
            speicherId,
            [fertig],
            chatZiel.type === 'group' ? 'gruppe' : 'direkt',
          )
          await loescheOffeneNachricht(auftrag.id)
          verarbeitet += 1
        }
      } catch (fehler) {
        if (fehler instanceof ChatNutzlastUngueltigError) {
          await loescheOffeneNachricht(auftrag.id).catch(() => {})
          continue
        }
        const versuche = auftrag.versuche + 1
        const rueckzug = [30_000, 120_000, 600_000, 3_600_000]
        await schreibeOffeneNachricht({
          ...auftrag,
          versuche,
          naechsterVersuch: jetzt + rueckzug[Math.min(versuche - 1, rueckzug.length - 1)],
        }).catch(() => {})
      }
    }
    return verarbeitet
  }, [ensureChat, entschluessle])

  const ladeAeltere = useCallback(async (beforeId: number) => {
    const chatZiel = await ensureChat()
    if (!chatZiel) return { messages: [], hasMore: false }
    const { page, messages } = await holeSeite(chatZiel, beforeId)
    return { messages, hasMore: page.has_more }
  }, [ensureChat, holeSeite])

  const liesUmschlaege = useCallback(async (): Promise<Lesung[] | null> => {
    const gelesen = await liesNachrichten()
    if (!gelesen) return null
    const lesungen: Lesung[] = []
    for (const message of gelesen.messages) {
      if (message.isDeleted || !message.clientUuid) {
        lesungen.push({ art: 'still', env: { id: message.id } })
        continue
      }
      const payload = payloadCache.current.get(message.id)
      if (!payload) {
        lesungen.push({ art: 'still', env: { id: message.id } })
        continue
      }
      lesungen.push({
        art: 'klartext',
        env: {
          id: message.id,
          blind_mailbox_id: chatRef.current.speicherId,
          ciphertext_envelope: '',
          client_uuid: message.clientUuid,
          created_at: message.createdAt,
        },
        text: JSON.stringify(payload),
        vonKonto: message.senderId,
        nachricht: message,
      })
    }
    uebernimmCache.current.set(lesungen, gelesen.uebernimm)
    return lesungen
  }, [liesNachrichten])

  const uebernimmLesestand = useCallback((lesung: Lesung[]) => {
    const uebernimm = uebernimmCache.current.get(lesung)
    if (uebernimm) {
      uebernimm()
      uebernimmCache.current.delete(lesung)
      return
    }
    const hoechste = lesung.reduce((max, l) => Math.max(max, l.env.id), 0)
    if (hoechste > cursorRef.current) cursorRef.current = hoechste
  }, [])

  /**
   * Ein einzelnes Live-Ereignis (Bearbeiten, Loeschen, Anheften) in die
   * Anzeigeform bringen. Die Serverzeile wird dabei erneut entschluesselt;
   * nur so erfaehrt der offene Chat die neue Fassung, ohne auf den Cursor zu
   * warten, der aeltere Zeilen nie mehr zurueckgibt.
   */
  const verarbeiteEreignis = useCallback(async (
    message: E2eeMessageItem,
    _typ: 'message_created' | 'message_updated' | 'message_deleted',
  ): Promise<ChatMessage | null> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) return null
    if (chatZiel.type !== message.chat_type || Number(chatZiel.id) !== Number(message.chat_id)) return null
    const leer: E2eeMessagePage = {
      messages: [message],
      pinned_message: null,
      has_more: false,
      my_last_delivered_id: 0,
      my_last_read_id: 0,
      partner_last_delivered_id: 0,
      partner_last_read_id: 0,
      ephemeral_ttl_seconds: 0,
      ephemeral_enabled_by_user_id: null,
    }
    try {
      return await entschluessle(chatZiel, message, leer)
    } catch {
      return null
    }
  }, [ensureChat, entschluessle])

  const baueVersand = useCallback(async (payload: string, clientUuid: string): Promise<Versandauftrag[]> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) throw new ChatSchluesselFehltError()
    const version = await ensureKeyVersion(chatZiel)
    const nutzlast = JSON.parse(payload) as Record<string, unknown>
    const verschluesselt = await verschluessleChatNutzlast(
      chatZiel.type,
      chatZiel.id,
      clientUuid,
      eigeneId,
      version,
      nutzlast,
    )
    return [{
      blind_mailbox_id: chatRef.current.speicherId,
      ciphertext_envelope: verschluesselt.encrypted_payload,
      client_uuid: clientUuid,
      chat_type: chatZiel.type,
      chat_id: String(chatZiel.id),
      key_version: version,
    }]
  }, [eigeneId, ensureChat, ensureKeyVersion])

  const sendeWirkungFuerZiel = useCallback(async (
    ziel: Wirkungsziel,
    eintrag: SteuerEintrag,
  ): Promise<void> => {
    const zielUuid = eintrag.ziel || String(eintrag.felder.target_client_uuid || '')
    switch (eintrag.typ) {
      case 'edit_message': {
        const version = await ensureKeyVersionFuer(ziel.chatType, ziel.chatId, ziel.mitglieder)
        const text = String(eintrag.felder.new_text || '')
        const verschluesselt = await verschluessleChatNutzlast(
          ziel.chatType,
          ziel.chatId,
          zielUuid,
          eigeneId,
          version,
          {
            text,
            sender_id: eigeneId,
            sender_name: '',
            timestamp: String(eintrag.felder.edited_at || new Date().toISOString()),
            edited_at: String(eintrag.felder.edited_at || new Date().toISOString()),
          },
        )
        await updateChatMessage(zielUuid, {
          encrypted_payload: verschluesselt.encrypted_payload,
          key_version: version,
        })
        return
      }
      case 'delete_message':
        // Altbestand: neue Löschungen laufen über `loesch_auftraege`.
        await deleteChatMessage(zielUuid)
        return
      case 'reaction': {
        const version = await ensureKeyVersionFuer(ziel.chatType, ziel.chatId, ziel.mitglieder)
        const emoji = String(eintrag.felder.emoji || '')
        const nehmen = eintrag.felder.aktion === 'nehmen'
        const messageId = Number(eintrag.felder.target_id || eintrag.zielId || 0)
        if (!emoji || !messageId) throw new SteuerAbgewiesenError(400)
        const verschluesselt = await verschluessleReaktion(
          ziel.chatType,
          ziel.chatId,
          version,
          messageId,
          eigeneId,
          emoji,
        )
        await reactToChatMessage(zielUuid, nehmen ? null : verschluesselt)
        return
      }
      case 'pin_message':
        await pinChatMessage(zielUuid, eintrag.felder.aktion !== 'loesen')
        return
      case 'verfall':
      case 'retention':
        await setChatEphemeral(ziel.chatType, ziel.chatId, Number(eintrag.felder.sekunden || 0))
        return
      default:
        throw new SteuerAbgewiesenError(null)
    }
  }, [eigeneId, ensureKeyVersionFuer])

  const sendeWirkung = useCallback(async (eintrag: SteuerEintrag): Promise<SteuerAusgang> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) throw new ChatSchluesselFehltError()
    const mailbox = chatRef.current.speicherId
    if (!mailbox) throw new ChatSchluesselFehltError()
    const wirkungsziel: Wirkungsziel = {
      mailbox,
      chatType: chatZiel.type,
      chatId: chatZiel.id,
      peerId: ziel.art === 'direkt' ? ziel.peerId : null,
      groupId: ziel.art === 'gruppe' ? ziel.groupId : null,
      mitglieder: mitglieder(),
      istEigentuemer: ziel.art === 'gruppe' ? Boolean(ziel.istEigentuemer) : false,
    }
    return sendeWirkungMitOutbox(wirkungsziel, eintrag, sendeWirkungFuerZiel)
  }, [ensureChat, mitglieder, sendeWirkungFuerZiel, ziel])

  const leseMailboxen = useMemo(
    () => (chat.speicherId ? [chat.speicherId] : []),
    [chat.speicherId],
  )

  return {
    blindMailboxId: chat.speicherId,
    leseMailboxen,
    chatType: chat.chatType,
    chatId: chat.chatId,
    ensureChat,
    erneuereSchluessel,
    verarbeiteOffene,
    liesUmschlaege,
    liesNachrichten,
    ladeAeltere,
    uebernimmLesestand,
    verarbeiteEreignis,
    baueVersand,
    sendeWirkung,
    sendeWirkungFuerZiel,
  }
}
