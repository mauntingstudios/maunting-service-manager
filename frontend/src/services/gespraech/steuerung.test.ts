import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  relayE2eeEnvelope: vi.fn(async () => { throw Object.assign(new Error('removed'), { status: 404 }) }),
  sendMessageQueue: vi.fn(async () => ({ status: 'ok', enqueued: 3 })),
}))
vi.mock('@/api/social', () => api)
vi.mock('@/services/e2eeCrypto', () => ({
  deriveUserDeviceMailboxId: vi.fn(async () => 'own-mailbox'),
  encryptE2eeHybrid: vi.fn(async (text: string, key: string) => `hybrid:${key}:${text}`),
}))
vi.mock('@/services/e2eeGeraet', () => ({
  eigenesGeraet: vi.fn(async () => ({ kennung: 'own-a' })),
  verlangeGeraeteVon: vi.fn(async (id: number) => id === 1
    ? [{ id: 10, device_id: 'own-a', public_key: 'own-a-key' }, { id: 11, device_id: 'own-b', public_key: 'own-b-key' }]
    : [{ id: 20, device_id: 'peer-a', public_key: 'peer-a-key' }]),
}))
vi.mock('@/services/gruppenSchluessel', () => ({
  dmZiele: vi.fn(async () => ({ senden: 'dm' })),
  verschluesseleFuerGruppe: vi.fn(async (ctx: unknown, text: string) => `group:${text}`),
}))
vi.mock('@/services/gruppen/gruppenVerteilung', () => ({
  frischeMitglieder: vi.fn(async () => [1, 2, 3]),
}))
vi.mock('@/services/nutzlastSignatur', () => ({
  signiereNutzlast: vi.fn(async (_mid: string, _id: number, text: unknown) => text),
}))

import { sendeSteuerpaket, type SteuerKontext } from './steuerung'

const kontext: SteuerKontext = {
  eigeneId: 1, mailbox: 'dm', drKontext: { eigeneId: 1, peerId: 2 }, gruppenKontext: null,
  identitaet: { sendPair: { publicKeyJwk: 'synthetic-public-key' } } as never,
}

beforeEach(() => vi.clearAllMocks())

describe('Steuerpakete über die FIFO-Queue', () => {
  it.each(['delete_message', 'edit_message', 'reaction'])('sendet %s samt eigener Gerätekopie ohne Relay', async (type) => {
    await expect(sendeSteuerpaket(kontext, { type }, 'control-uuid')).resolves.toBe('control-uuid')
    expect(api.relayE2eeEnvelope).not.toHaveBeenCalled()
    expect(api.sendMessageQueue).toHaveBeenCalledTimes(1)
    expect(api.sendMessageQueue).toHaveBeenCalledWith(expect.objectContaining({
      client_uuid: 'control-uuid', chat_type: 'direct', chat_id: '2', device_id: 'own-a',
      envelopes: [
        expect.objectContaining({ device_id: 'peer-a', encrypted_payload: expect.stringContaining('hybrid:peer-a-key:') }),
        expect.objectContaining({ device_id: 'own-b', encrypted_payload: expect.stringContaining('hybrid:own-b-key:') }),
      ],
    }))
  })

  it('adressiert Gruppenwirkungen an alle frischen Mitgliedsgeräte außer dem sendenden', async () => {
    await sendeSteuerpaket({
      ...kontext, drKontext: null,
      gruppenKontext: { groupId: 7, eigeneId: 1, blindMailboxId: 'group', mitglieder: [1, 2], istEigentuemer: true },
    }, { type: 'delete_message' }, 'group-control')
    expect(api.sendMessageQueue).toHaveBeenCalledWith(expect.objectContaining({
      chat_type: 'group', chat_id: '7',
      envelopes: [
        expect.objectContaining({ device_id: 'own-b', encrypted_payload: expect.stringContaining('group:') }),
        expect.objectContaining({ device_id: 'peer-a', encrypted_payload: expect.stringContaining('group:') }),
        expect.objectContaining({ device_id: 'peer-a', encrypted_payload: expect.stringContaining('group:') }),
      ],
    }))
  })
})
