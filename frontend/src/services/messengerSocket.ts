/**
 * Schlanker Realtime-WebSocket für den E2EE-Messenger (Signal-Architektur).
 *
 * Vermittelt Nachrichten, Zustell- und Lesequittungen direkt über den WebSocket
 * (/api/social/ws) in Millisekunden. Fällt bei Verbindungsunterbrechung transparent
 * auf die HTTP-Queue-Endpunkte zurück.
 */

import { wsUrl } from '@/config/api'
import { sendChatMessage } from '@/api/social'
import { beiKontowechsel } from '@/lib/angemeldetesKonto'

export interface MessengerSocketConfig {
  deviceId?: string
  userId?: number
}

type MessageCallback = (data: any) => void
type PendingChat = {
  resolve: (val: { id: number; client_uuid: string }) => void
  reject: (err: any) => void
  fallback: () => void
  timer: any
}

/** Der Socket wurde absichtlich oder durch eine abgelaufene Sitzung beendet. */
export class SocketGetrenntError extends Error {
  readonly status = 400
  readonly code = 'socket_closed'

  constructor() {
    super('Die Verbindung wurde getrennt.')
    this.name = 'SocketGetrenntError'
  }
}

class MessengerSocketService {
  private ws: WebSocket | null = null
  private deviceId: string | null = null
  private connectedDeviceId: string | null = null
  private reconnectTimer: any = null
  private pingInterval: any = null
  private attempt = 0
  private manualClose = false
  private epoch = 0
  private pendingChat = new Map<string, PendingChat>()
  private listeners = new Set<MessageCallback>()

  /** Initialisiert den Socket mit der aktuellen Gerätekennung. */
  public connect(deviceId?: string): void {
    if (deviceId) this.deviceId = deviceId
    if (typeof window === 'undefined') return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (
        this.deviceId &&
        this.connectedDeviceId &&
        this.connectedDeviceId !== this.deviceId
      ) {
        // Ein anderes Konto/Gerät: die alte Verbindung darf nicht weiter
        // Nachrichten unter der alten Sitzung senden.
        const alt = this.ws
        this.ws = null
        this.connectedDeviceId = null
        this.epoch += 1
        try {
          alt.close()
        } catch {}
      } else {
        if (this.deviceId && this.ws.readyState === WebSocket.OPEN) {
          this.sendRaw({ type: 'init', device_id: this.deviceId })
        }
        return
      }
    }

    this.manualClose = false
    this.epoch += 1
    const epoch = this.epoch
    const url = wsUrl(this.deviceId ? `/api/social/ws?device_id=${encodeURIComponent(this.deviceId)}` : '/api/social/ws')

    let sock: WebSocket
    try {
      sock = new WebSocket(url)
      this.ws = sock
    } catch {
      this.scheduleReconnect()
      return
    }

    sock.onopen = () => {
      if (this.ws !== sock || this.epoch !== epoch) return
      this.attempt = 0
      this.connectedDeviceId = this.deviceId
      this.startHeartbeat()
      if (this.deviceId) {
        this.sendRaw({ type: 'init', device_id: this.deviceId })
      }
      window.dispatchEvent(
        new CustomEvent('msm:messenger-socket-status', { detail: { connected: true } }),
      )
    }

    sock.onmessage = (event) => {
      if (this.ws !== sock || this.epoch !== epoch) return
      try {
        const data = JSON.parse(event.data)
        this.handleIncoming(data)
      } catch {
        // Ignoriere ungültiges JSON oder Pong-Frames
      }
    }

    sock.onerror = () => {
      // Fehler führt zu close -> Reconnect
    }

    sock.onclose = (event) => {
      if (this.ws !== sock || this.epoch !== epoch) return
      this.stopHeartbeat()
      this.ws = null
      this.connectedDeviceId = null
      window.dispatchEvent(
        new CustomEvent('msm:messenger-socket-status', { detail: { connected: false } }),
      )
      if (this.manualClose) return
      if (event.code === 4401 || event.code === 4403) {
        this.manualClose = true
        this.rejectPending(new SocketGetrenntError())
        return
      }
      this.scheduleReconnect()
    }
  }

  public disconnect(): void {
    this.manualClose = true
    this.epoch += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    const sock = this.ws
    this.ws = null
    this.connectedDeviceId = null
    this.deviceId = null
    this.attempt = 0
    this.rejectPending(new SocketGetrenntError())
    if (sock) {
      try {
        sock.close()
      } catch {}
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('msm:messenger-socket-status', { detail: { connected: false } }),
      )
    }
  }

  private rejectPending(fehler: Error): void {
    for (const [id, pending] of this.pendingChat) {
      clearTimeout(pending.timer)
      pending.reject(fehler)
      this.pendingChat.delete(id)
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
        let timer: any
        const fallback = () => {
          if (!this.pendingChat.has(payload.client_uuid)) return
          this.pendingChat.delete(payload.client_uuid)
          clearTimeout(timer)
          void sendChatMessage(payload)
            .then((res) => resolve({ id: res.id, client_uuid: res.client_uuid }))
            .catch(reject)
        }
        timer = setTimeout(fallback, 3000)
        this.pendingChat.set(payload.client_uuid, {
          resolve: (val) => {
            clearTimeout(timer)
            resolve(val)
          },
          reject: (err) => {
            clearTimeout(timer)
            reject(err)
          },
          fallback,
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

    // Der Server hat den Versand abgelehnt. Kein HTTP-Fallback: der Fehler
    // ist ein Urteil, keine verlorene Verbindung.
    if (msgType === 'error' && data.client_uuid) {
      const pending = this.pendingChat.get(data.client_uuid)
      if (pending) {
        this.pendingChat.delete(data.client_uuid)
        clearTimeout(pending.timer)
        const fehler = Object.assign(new Error(String(data.detail || 'Der Versand ist fehlgeschlagen.')), {
          status: Number(data.status_code) || 0,
          code: typeof data.code === 'string' ? data.code : undefined,
        })
        pending.reject(fehler)
      }
      return
    }

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
    if (this.manualClose || this.reconnectTimer) return
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

// Ein Kontowechsel darf keine Verbindung des vorigen Kontos weiterführen.
beiKontowechsel(() => messengerSocket.disconnect())
