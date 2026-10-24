/**
 * Schlanker Realtime-WebSocket für den E2EE-Messenger (Signal-Architektur).
 *
 * Vermittelt Nachrichten, Zustell- und Lesequittungen direkt über den WebSocket
 * (/api/social/ws) in Millisekunden. Fällt bei Verbindungsunterbrechung transparent
 * auf die HTTP-Queue-Endpunkte zurück.
 */

import { wsUrl } from '@/config/api'
import {
  ackQueueMessages,
  sendMessageQueue,
  sendReadReceipt as sendHttpReadReceipt,
  type QueueEnvelope,
} from '@/api/social'
import { updateDeliveryStatus } from './messengerLocalStore'

export interface MessengerSocketConfig {
  deviceId?: string
  userId?: number
}

type MessageCallback = (data: any) => void

class MessengerSocketService {
  private ws: WebSocket | null = null
  private deviceId: string | null = null
  private reconnectTimer: any = null
  private pingInterval: any = null
  private attempt = 0
  private pendingAcks = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: any }>()
  private listeners = new Set<MessageCallback>()

  /** Initialisiert den Socket mit der aktuellen Gerätekennung. */
  public connect(deviceId?: string): void {
    if (deviceId) this.deviceId = deviceId
    if (typeof window === 'undefined') return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.deviceId && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw({ type: 'init', device_id: this.deviceId })
      }
      return
    }

    const url = wsUrl(this.deviceId ? `/social/ws?device_id=${encodeURIComponent(this.deviceId)}` : '/social/ws')

    try {
      this.ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.attempt = 0
      this.startHeartbeat()
      if (this.deviceId) {
        this.sendRaw({ type: 'init', device_id: this.deviceId })
      }
      // UI über erfolgreichen Reconnect benachrichtigen
      window.dispatchEvent(new CustomEvent('msm:sync-status', { detail: { connected: true } }))
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.handleIncoming(data)
      } catch {
        // Ignoriere ungültiges JSON oder Pong-Frames
      }
    }

    this.ws.onerror = () => {
      // Fehler führt zu close -> Reconnect
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      this.ws = null
      window.dispatchEvent(new CustomEvent('msm:sync-status', { detail: { connected: false } }))
      this.scheduleReconnect()
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stopHeartbeat()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  public subscribe(cb: MessageCallback): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /**
   * Sendet eine verschlüsselte Nachricht für die Zielgeräte.
   * Bevorzugt direkten WebSocket-Push, fällt sonst auf HTTP-POST zurück.
   */
  public async sendMessage(payload: {
    client_uuid: string
    chat_type: 'direct' | 'group'
    chat_id: string
    envelopes: QueueEnvelope[]
    device_id?: string
  }): Promise<{ status: string; client_uuid: string; enqueued: number }> {
    const devId = payload.device_id || this.deviceId
    if (this.isConnected()) {
      return new Promise<{ status: string; client_uuid: string; enqueued: number }>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingAcks.delete(payload.client_uuid)
          // Fallback auf HTTP bei WebSocket-Timeout
          void sendMessageQueue({ ...payload, device_id: devId || undefined })
            .then(resolve)
            .catch(reject)
        }, 3000)

        this.pendingAcks.set(payload.client_uuid, {
          resolve: (val) => {
            clearTimeout(timer)
            resolve(val)
          },
          reject: () => {
            clearTimeout(timer)
            void sendMessageQueue({ ...payload, device_id: devId || undefined })
              .then(resolve)
              .catch(reject)
          },
          timer,
        })

        this.sendRaw({
          type: 'send_message',
          client_uuid: payload.client_uuid,
          chat_type: payload.chat_type,
          chat_id: payload.chat_id,
          envelopes: payload.envelopes,
          device_id: devId,
        })
      })
    }

    return sendMessageQueue({ ...payload, device_id: devId || undefined })
  }

  /**
   * Quittiert empfangene Chiffrate beim Server (löscht aus Queue & sendet Zustellquittung).
   */
  public async ackMessages(queueIds: number[], clientUuid?: string, deviceId?: string): Promise<void> {
    if (!queueIds || queueIds.length === 0) return
    const devId = deviceId || this.deviceId
    if (this.isConnected() && devId) {
      this.sendRaw({
        type: 'ack_message',
        queue_ids: queueIds,
        device_id: devId,
        client_uuid: clientUuid,
      })
      return
    }
    if (devId) {
      await ackQueueMessages(devId, queueIds).catch(() => {})
    }
  }

  /**
   * Meldet gelesene Nachrichten an den Absender (2 blaue Häkchen).
   */
  public async sendReadReceipt(payload: {
    chat_type: 'direct' | 'group'
    chat_id: string
    client_uuids: string[]
  }): Promise<void> {
    if (!payload.client_uuids || payload.client_uuids.length === 0) return
    if (this.isConnected()) {
      this.sendRaw({
        type: 'read_receipt',
        chat_type: payload.chat_type,
        chat_id: payload.chat_id,
        client_uuids: payload.client_uuids,
      })
      return
    }
    await sendHttpReadReceipt(payload).catch(() => {})
  }

  /**
   * Übermittelt ein Tipp-Signal in Echtzeit.
   */
  public sendTyping(chatType: 'direct' | 'group', chatId: string, status: 'typing' | 'idle'): void {
    if (this.isConnected()) {
      this.sendRaw({
        type: 'typing',
        chat_type: chatType,
        chat_id: chatId,
        status,
      })
    }
  }

  private sendRaw(data: Record<string, any>): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
      return true
    }
    return false
  }

  private async handleIncoming(data: any): Promise<void> {
    if (!data || typeof data !== 'object') return
    const msgType = data.type

    // 1. Quittung für selbst gesendete Nachricht
    if (msgType === 'message_sent' && data.client_uuid) {
      const pending = this.pendingAcks.get(data.client_uuid)
      if (pending) {
        this.pendingAcks.delete(data.client_uuid)
        clearTimeout(pending.timer)
        pending.resolve({
          status: 'ok',
          client_uuid: data.client_uuid,
          enqueued: data.enqueued ?? 1,
        })
      }
    }

    // 2. Zustellquittung (2 graue Häkchen)
    if (msgType === 'delivery_receipt') {
      const uuids: string[] = Array.isArray(data.client_uuids)
        ? data.client_uuids
        : data.client_uuid
        ? [data.client_uuid]
        : []
      await Promise.all(uuids.map((uid) => updateDeliveryStatus(uid, 'delivered')))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('msm:delivery-receipt', { detail: data }))
        window.dispatchEvent(new CustomEvent('msm:messages-updated', { detail: data }))
      }
    }

    // 3. Lesequittung (2 blaue Häkchen)
    if (msgType === 'read_receipt') {
      const uuids: string[] = Array.isArray(data.client_uuids)
        ? data.client_uuids
        : data.client_uuid
        ? [data.client_uuid]
        : []
      await Promise.all(uuids.map((uid) => updateDeliveryStatus(uid, 'read')))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('msm:read-receipt', { detail: data }))
        window.dispatchEvent(new CustomEvent('msm:messages-updated', { detail: data }))
      }
    }

    // 4. Eingehende Chiffrate (Direkt-Push vom Server)
    if (msgType === 'incoming_message' || msgType === 'incoming_messages') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('msm:incoming-message', { detail: data }))
        window.dispatchEvent(new CustomEvent('msm:sync-event', { detail: data }))
      }
    }

    // Listener & globales Sync-Event für Presence, Typing, Stories, etc.
    for (const cb of this.listeners) {
      try {
        cb(data)
      } catch {}
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('msm:sync-event', { detail: data }))
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.pingInterval = setInterval(() => {
      this.sendRaw({ type: 'ping' })
    }, 25_000)
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delays = [1000, 2000, 4000, 8000, 10000]
    const base = delays[Math.min(this.attempt, delays.length - 1)]
    const jitter = base * (0.85 + Math.random() * 0.3)
    this.attempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, jitter)
  }
}

export const messengerSocket = new MessengerSocketService()
