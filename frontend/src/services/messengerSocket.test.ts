import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messengerSocket } from './messengerSocket'
import * as socialApi from '@/api/social'

vi.mock('@/api/social', () => ({
  sendChatMessage: vi.fn(async (payload: { client_uuid: string }) => ({
    id: 4242,
    client_uuid: payload.client_uuid,
  })),
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

async function verbunden(): Promise<MockWebSocket> {
  messengerSocket.connect('dev-123')
  await new Promise((r) => setTimeout(r, 10))
  return MockWebSocket.instances[0]
}

describe('messengerSocket im Einheits-Transport', () => {
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
    const ws = await verbunden()
    expect(ws.url).toContain('device_id=dev-123')
    expect(ws.sent.some((m) => JSON.parse(m).type === 'init')).toBe(true)
  })

  it('sendet ein Chiffrat über den WebSocket und löst mit message_sent auf', async () => {
    const ws = await verbunden()

    const sendPromise = messengerSocket.sendChatMessage({
      chat_type: 'direct',
      chat_id: 55,
      client_uuid: 'uuid-ws-1',
      key_version: 1,
      encrypted_payload: 'cipher-1',
    })

    ws.onmessage?.({
      data: JSON.stringify({ type: 'message_sent', id: 88, client_uuid: 'uuid-ws-1' }),
    })

    await expect(sendPromise).resolves.toEqual({ id: 88, client_uuid: 'uuid-ws-1' })
    expect(ws.sent.some((m) => JSON.parse(m).type === 'send_message')).toBe(true)
    expect(socialApi.sendChatMessage).not.toHaveBeenCalled()
  })

  it('fällt ohne Verbindung auf den HTTP-Weg zurück', async () => {
    messengerSocket.disconnect()

    await expect(
      messengerSocket.sendChatMessage({
        chat_type: 'direct',
        chat_id: 55,
        client_uuid: 'uuid-http',
        key_version: 1,
        encrypted_payload: 'cipher-2',
      }),
    ).resolves.toEqual({ id: 4242, client_uuid: 'uuid-http' })

    expect(socialApi.sendChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chat_id: 55,
      client_uuid: 'uuid-http',
    }))
  })

  it('meldet neue, geänderte und gelöschte Nachrichten im Sync-Strom', async () => {
    const ws = await verbunden()
    const empfangen: any[] = []
    const hoeren = (e: Event) => empfangen.push((e as CustomEvent).detail)
    window.addEventListener('msm:sync-event', hoeren)
    try {
      for (const type of ['message_created', 'message_updated', 'message_deleted']) {
        ws.onmessage?.({ data: JSON.stringify({ type, chat_id: 55, client_uuid: 'u1' }) })
      }
    } finally {
      window.removeEventListener('msm:sync-event', hoeren)
    }
    expect(empfangen.map((e) => e.type)).toEqual([
      'message_created',
      'message_updated',
      'message_deleted',
    ])
  })

  it('verbindet nach disconnect nicht wieder', async () => {
    await verbunden()
    messengerSocket.disconnect()
    await new Promise((r) => setTimeout(r, 25))
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('behandelt einen Auth-Close als endgültig', async () => {
    const ws = await verbunden()
    const sendPromise = messengerSocket.sendChatMessage({
      chat_type: 'direct',
      chat_id: 55,
      client_uuid: 'uuid-auth-close',
      key_version: 1,
      encrypted_payload: 'cipher-auth',
    })
    ;(ws.onclose as unknown as ((event: { code: number }) => void) | null)?.({ code: 4401 })
    await expect(sendPromise).rejects.toThrow('Die Verbindung wurde getrennt.')
    await new Promise((r) => setTimeout(r, 25))
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(socialApi.sendChatMessage).not.toHaveBeenCalled()
  })

  it('lehnt einen Fehler-Frame ohne HTTP-Wiederholung ab', async () => {
    const ws = await verbunden()
    const sendPromise = messengerSocket.sendChatMessage({
      chat_type: 'direct',
      chat_id: 55,
      client_uuid: 'uuid-error-frame',
      key_version: 1,
      encrypted_payload: 'cipher-error',
    })
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'error',
        client_uuid: 'uuid-error-frame',
        status_code: 403,
        code: 'no_right',
        detail: 'Kein Zugriff.',
      }),
    })

    await expect(sendPromise).rejects.toMatchObject({ status: 403, code: 'no_right' })
    expect(socialApi.sendChatMessage).not.toHaveBeenCalled()
  })

  it('meldet Quittungen mit eigenem Ereignis und stößt das Nachladen an', async () => {
    const ws = await verbunden()
    const quittungen: string[] = []
    let aktualisierungen = 0
    const hoeren = (e: Event) => quittungen.push(e.type)
    const nachladen = () => { aktualisierungen += 1 }
    window.addEventListener('msm:delivery-receipt', hoeren)
    window.addEventListener('msm:read-receipt', hoeren)
    window.addEventListener('msm:messages-updated', nachladen)
    try {
      ws.onmessage?.({ data: JSON.stringify({ type: 'delivery_receipt', chat_id: 55, up_to_id: 9 }) })
      ws.onmessage?.({ data: JSON.stringify({ type: 'read_receipt', chat_id: 55, up_to_id: 9 }) })
    } finally {
      window.removeEventListener('msm:delivery-receipt', hoeren)
      window.removeEventListener('msm:read-receipt', hoeren)
      window.removeEventListener('msm:messages-updated', nachladen)
    }
    expect(quittungen).toEqual(['msm:delivery-receipt', 'msm:read-receipt'])
    expect(aktualisierungen).toBe(2)
  })
})
