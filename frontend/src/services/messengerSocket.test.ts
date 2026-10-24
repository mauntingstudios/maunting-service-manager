import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messengerSocket } from './messengerSocket'
import * as socialApi from '@/api/social'
import * as localStore from './messengerLocalStore'

vi.mock('@/api/social', () => ({
  sendMessageQueue: vi.fn(async (payload) => ({
    status: 'ok',
    client_uuid: payload.client_uuid,
    enqueued: payload.envelopes?.length ?? 1,
  })),
  ackQueueMessages: vi.fn(async () => ({ status: 'ok', acknowledged: 1 })),
  sendReadReceipt: vi.fn(async () => ({ status: 'ok' })),
}))

vi.mock('./messengerLocalStore', () => ({
  updateDeliveryStatus: vi.fn(async () => {}),
}))

class MockWebSocket {
  public static instances: MockWebSocket[] = []
  public url: string
  public readyState = WebSocket.CONNECTING
  public onopen: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public onclose: (() => void) | null = null
  public onerror: (() => void) | null = null
  public sent: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      this.onopen?.()
    }, 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = WebSocket.CLOSED
    this.onclose?.()
  }
}

describe('messengerSocket', () => {
  const origWebSocket = global.WebSocket

  beforeEach(() => {
    MockWebSocket.instances = []
    global.WebSocket = MockWebSocket as any
    vi.clearAllMocks()
  })

  afterEach(() => {
    messengerSocket.disconnect()
    global.WebSocket = origWebSocket
  })

  it('baut Verbindung auf und sendet init mit deviceId', async () => {
    messengerSocket.connect('dev-123')
    await new Promise((r) => setTimeout(r, 10))

    const ws = MockWebSocket.instances[0]
    expect(ws).toBeDefined()
    expect(ws.url).toContain('device_id=dev-123')
    expect(ws.sent.some((m) => JSON.parse(m).type === 'init')).toBe(true)
  })

  it('sendet Nachricht über WebSocket und quittiert via message_sent', async () => {
    messengerSocket.connect('dev-123')
    await new Promise((r) => setTimeout(r, 10))
    const ws = MockWebSocket.instances[0]

    const sendPromise = messengerSocket.sendMessage({
      client_uuid: 'uuid-ws-1',
      chat_type: 'direct',
      chat_id: '42',
      envelopes: [{ device_id: 'target-1', encrypted_payload: 'cipher-1' }],
    })

    // Server antwortet mit message_sent
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message_sent',
        client_uuid: 'uuid-ws-1',
        status: 'ok',
        enqueued: 1,
      }),
    })

    const result = await sendPromise
    expect(result.status).toBe('ok')
    expect(result.client_uuid).toBe('uuid-ws-1')
    expect(ws.sent.some((m) => JSON.parse(m).type === 'send_message')).toBe(true)
  })

  it('fällt transparent auf HTTP-Queue zurück, wenn WebSocket nicht verbunden ist', async () => {
    messengerSocket.disconnect()

    const result = await messengerSocket.sendMessage({
      client_uuid: 'uuid-http-fallback',
      chat_type: 'direct',
      chat_id: '42',
      envelopes: [{ device_id: 'target-1', encrypted_payload: 'cipher-1' }],
    })

    expect(result.status).toBe('ok')
    expect(socialApi.sendMessageQueue).toHaveBeenCalledWith(expect.objectContaining({
      client_uuid: 'uuid-http-fallback',
    }))
  })

  it('verarbeitet delivery_receipt und ruft updateDeliveryStatus mit delivered auf', async () => {
    messengerSocket.connect('dev-123')
    await new Promise((r) => setTimeout(r, 10))
    const ws = MockWebSocket.instances[0]

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'delivery_receipt',
        client_uuid: 'uuid-receipt-1',
      }),
    })

    expect(localStore.updateDeliveryStatus).toHaveBeenCalledWith('uuid-receipt-1', 'delivered')
  })

  it('verarbeitet read_receipt und ruft updateDeliveryStatus mit read auf', async () => {
    messengerSocket.connect('dev-123')
    await new Promise((r) => setTimeout(r, 10))
    const ws = MockWebSocket.instances[0]

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'read_receipt',
        client_uuids: ['uuid-read-1', 'uuid-read-2'],
      }),
    })

    expect(localStore.updateDeliveryStatus).toHaveBeenCalledWith('uuid-read-1', 'read')
    expect(localStore.updateDeliveryStatus).toHaveBeenCalledWith('uuid-read-2', 'read')
  })

  it('sendet ACK über WebSocket wenn verbunden', async () => {
    messengerSocket.connect('dev-123')
    await new Promise((r) => setTimeout(r, 10))
    const ws = MockWebSocket.instances[0]

    await messengerSocket.ackMessages([101, 102], 'uuid-ack-1')

    const sentAck = ws.sent.find((m) => JSON.parse(m).type === 'ack_message')
    expect(sentAck).toBeDefined()
    const parsed = JSON.parse(sentAck!)
    expect(parsed.queue_ids).toEqual([101, 102])
  })
})
