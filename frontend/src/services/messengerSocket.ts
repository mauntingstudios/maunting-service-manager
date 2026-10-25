/**
 * Schlanker Realtime-WebSocket für den E2EE-Messenger (Signal-Architektur).
 *
 * Vermittelt Nachrichten, Zustell- und Lesequittungen direkt über den WebSocket
 * (/api/social/ws) in Millisekunden. Fällt bei Verbindungsunterbrechung transparent
 * auf die HTTP-Queue-Endpunkte zurück.
 */

import { wsUrl } from '@/config/api'
import { sendChatMessage } from '@/api/social'

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
  private pendingChat = new Map<string, { resolve: (val: { id: number; client_uuid: string }) => void; reject: (err: any) => void; timer: any }>()
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

    const url = wsUrl(this.deviceId ? `/api/social/ws?device_id=${encodeURIComponent(this.deviceId)}` : '/api/social/ws')

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
   * Sendet eine verschluesselte Chat-Nachricht. Bevorzugt WebSocket, faellt
   * nach drei Sekunden auf HTTP zurueck.
   */
  public async sendChatMessage(payload: {
    chat_type: 'direct' | 'group'
    chat_id: number
    client_uuid: string
    key_version: number
    encrypted_payload: string
  }): Promise<{ id: number; client_uuid: string }> {
    if (this.isConnected()) {
      return new Promise<{ id: number; client_uuid: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingChat.delete(payload.client_uuid)
          void sendChatMessage(payload)
            .then((res) => resolve({ id: res.id, client_uuid: res.client_uuid }))
            .catch(reject)
        }, 3000)
        this.pendingChat.set(payload.client_uuid, {
          resolve: (val) => {
            clearTimeout(timer)
            resolve(val)
          },
          reject: () => {
            clearTimeout(timer)
            void sendChatMessage(payload)
              .then((res) => resolve({ id: res.id, client_uuid: res.client_uuid }))
              .catch(reject)
          },
          timer,
        })
        this.sendRaw({
          type: 'send_message',
          chat_type: payload.chat_type,
          chat_id: payload.chat_id,
          client_uuid: payload.client_uuid,
          key_version: payload.key_version,
          encrypted_payload: payload.encrypted_payload,
          device_id: this.deviceId,
        })
      })
    }
    const res = await sendChatMessage(payload)
    return { id: res.id, client_uuid: res.client_uuid }
  }

  /**
   * Sendet eine verschluesselte Nachricht für die Zielgeräte.
   * Bevorzugt direkten WebSocket-Push, fällt sonst auf HTTP-POST zurück.
   */
  public async sendMessage(_payload: {
    client_uuid: string
    chat_type: 'direct' | 'group'
    chat_id: string
    envelopes: Array<{ target_device_id?: number; device_id?: string; encrypted_payload: string; client_uuid?: string }>
    device_id?: string
  }): Promise<{ status: string; client_uuid: string; enqueued: number }> {
    // Altweg. Der Einheits-Transport ruft `sendChatMessage` auf.
    throw new Error('Der alte Umschlag-Transport ist entfernt.')
  }

  public async ackMessages(): Promise<void> {
    // Der Einheits-Transport quittiert ueber `ackChatMessages` mit up_to_id.
  }

  /**
   * Meldet gelesene Nachrichten an den Absender (2 blaue Häkchen).
   */
  public async sendReadReceipt(): Promise<void> {
    // Der Einheits-Transport quittiert ueber `readChatMessages` mit up_to_id.
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
      const pending = this.pendingChat.get(data.client_uuid)
      if (pending) {
        this.pendingChat.delete(data.client_uuid)
        clearTimeout(pending.timer)
        pending.resolve({
          id: Number(data.id || 0),
          client_uuid: data.client_uuid,
        })
      }
    }

    // 2. Zustell- und Lesequittungen tragen jetzt den Wasserstand des Chats.
    if (msgType === 'delivery_receipt' || msgType === 'read_receipt' || msgType === 'chat_state') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(msgType === 'read_receipt' ? 'msm:read-receipt' : 'msm:delivery-receipt', {
            detail: data,
          }),
        )
        window.dispatchEvent(new CustomEvent('msm:messages-updated', { detail: data }))
      }
    }

    // 3. Neue, geänderte oder gelöschte Nachricht.
    if (
      msgType === 'message_created' ||
      msgType === 'message_updated' ||
      msgType === 'message_deleted'
    ) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('msm:message-event', { detail: data }))
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
