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
import type { SteuerAusgang, SteuerEintrag } from '@/services/wirkungTypen'

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
  uebernimm: () => void
}

export interface Konversation {
  blindMailboxId: string
  leseMailboxen: string[]
  chatType: 'direct' | 'group' | null
  chatId: number | null
  ensureChat: () => Promise<{ type: 'direct' | 'group'; id: number } | null>
  liesUmschlaege: () => Promise<Lesung[] | null>
  liesNachrichten: () => Promise<NachrichtenLesung | null>
  ladeAeltere: (beforeId: number) => Promise<{ messages: ChatMessage[]; hasMore: boolean }>
  uebernimmLesestand: (lesung: Lesung[]) => void
  baueVersand: (payload: string, clientUuid: string) => Promise<Versandauftrag[]>
  baueSteuerversand: (payload: string, clientUuid: string, typ: string) => Promise<Versandauftrag[]>
  sendeSteuerpaket: (payloadObj: Record<string, unknown>) => Promise<string | null>
  sendeWirkung: (eintrag: SteuerEintrag) => Promise<SteuerAusgang>
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
  const [chatId, setChatId] = useState<number | null>(
    ziel.art === 'gruppe' ? ziel.groupId : null,
  )

  useEffect(() => {
    if (ziel.art === 'gruppe') {
      setChatId(ziel.groupId)
      return
    }
    if (ziel.art !== 'direkt' || !eigeneId) {
      setChatId(null)
      return
    }
    const cached = direkteChats.get(direkterSchluessel(eigeneId, ziel.peerId))
    if (cached) {
      setChatId(cached)
      return
    }
    let aktiv = true
    void startDirectChat(ziel.peerId)
      .then((chat) => {
        direkteChats.set(direkterSchluessel(eigeneId, ziel.peerId), chat.id)
        if (aktiv) setChatId(chat.id)
      })
      .catch(() => {
        if (aktiv) setChatId(null)
      })
    return () => {
      aktiv = false
    }
  }, [ziel.art, ziel.art === 'gruppe' ? ziel.groupId : ziel.art === 'direkt' ? ziel.peerId : 0, eigeneId])

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

  const ensureKeyVersion = useCallback(async (chatZiel: { type: 'direct' | 'group'; id: number }): Promise<number> => {
    const { keys, latest_key_version } = await getE2eeChatKeys(chatZiel.type, chatZiel.id)
    const eigeneVersionen = keys.map((k) => k.key_version)
    if (latest_key_version > 0 && eigeneVersionen.includes(latest_key_version)) {
      return latest_key_version
    }
    const version = latest_key_version > 0 ? latest_key_version + 1 : 1
    await erzeugeChatSchluessel(chatZiel.type, chatZiel.id, mitglieder(), version)
    const nachher = await getE2eeChatKeys(chatZiel.type, chatZiel.id)
    if (!nachher.keys.some((k) => k.key_version === version)) {
      throw new ChatSchluesselFehltError()
    }
    return version
  }, [mitglieder])

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
      verfaelltAm: message.expires_at || undefined,
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
  ): Promise<{ page: E2eeMessagePage; messages: ChatMessage[]; unlesbar: number }> => {
    const page = await fetchChatMessages(chatZiel.type, chatZiel.id, {
      limit: beforeId ? 50 : cursorRef.current > 0 ? 100 : 50,
      ...(beforeId ? { beforeId } : cursorRef.current > 0 ? { afterId: cursorRef.current } : {}),
    })
    const messages: ChatMessage[] = []
    let unlesbar = 0
    for (const message of page.messages) {
      try {
        const fertig = await entschluessle(chatZiel, message, page)
        if (fertig) messages.push(fertig)
      } catch (fehler) {
        if (fehler instanceof ChatNutzlastUngueltigError) {
          unlesbar += 1
          continue
        }
        unlesbar += 1
      }
    }
    return { page, messages, unlesbar }
  }, [entschluessle])

  const liesNachrichten = useCallback(async (): Promise<NachrichtenLesung | null> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) return null
    const { page, messages, unlesbar } = await holeSeite(chatZiel)
    const uebernimm = () => {
      const hoechste = page.messages.reduce((max, m) => Math.max(max, m.id), 0)
      if (hoechste > cursorRef.current) cursorRef.current = hoechste
    }
    return { messages, page, hasMore: page.has_more, unlesbar, uebernimm }
  }, [ensureChat, holeSeite])

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

  const baueSteuerversand = useCallback(async (): Promise<Versandauftrag[]> => [], [])

  const sendeWirkung = useCallback(async (eintrag: SteuerEintrag): Promise<SteuerAusgang> => {
    const chatZiel = await ensureChat()
    if (!chatZiel) throw new ChatSchluesselFehltError()
    const zielUuid = eintrag.ziel || String(eintrag.felder.target_client_uuid || '')
    switch (eintrag.typ) {
      case 'edit_message': {
        const version = await ensureKeyVersion(chatZiel)
        const text = String(eintrag.felder.new_text || '')
        const verschluesselt = await verschluessleChatNutzlast(
          chatZiel.type,
          chatZiel.id,
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
        return 'gesendet'
      }
      case 'delete_message':
        await deleteChatMessage(zielUuid)
        return 'gesendet'
      case 'reaction': {
        const version = await ensureKeyVersion(chatZiel)
        const emoji = String(eintrag.felder.emoji || '')
        const nehmen = eintrag.felder.aktion === 'nehmen'
        const messageId = Number(eintrag.felder.target_id || eintrag.zielId || 0)
        if (!emoji || !messageId) return 'gesendet'
        const verschluesselt = await verschluessleReaktion(
          chatZiel.type,
          chatZiel.id,
          version,
          messageId,
          eigeneId,
          emoji,
        )
        await reactToChatMessage(zielUuid, nehmen ? null : verschluesselt)
        return 'gesendet'
      }
      case 'pin_message':
        await pinChatMessage(zielUuid, eintrag.felder.aktion !== 'loesen')
        return 'gesendet'
      case 'verfall':
      case 'retention':
        await setChatEphemeral(
          chatZiel.type,
          chatZiel.id,
          Number(eintrag.felder.sekunden || 0),
        )
        return 'gesendet'
      default:
        return 'gesendet'
    }
  }, [eigeneId, ensureChat, ensureKeyVersion])

  const sendeSteuerpaket = useCallback(async (payloadObj: Record<string, unknown>): Promise<string | null> => {
    const typ = String(payloadObj.type || '')
    if (!typ) return null
    const clientUuid = String(payloadObj.client_uuid || crypto.randomUUID())
    const eintrag: SteuerEintrag = {
      typ,
      felder: { ...payloadObj, target_client_uuid: payloadObj.client_uuid },
      ziel: typeof payloadObj.client_uuid === 'string' ? payloadObj.client_uuid : null,
    }
    await sendeWirkung(eintrag)
    return clientUuid
  }, [sendeWirkung])

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
    liesUmschlaege,
    liesNachrichten,
    ladeAeltere,
    uebernimmLesestand,
    baueVersand,
    baueSteuerversand,
    sendeSteuerpaket,
    sendeWirkung,
  }
}
