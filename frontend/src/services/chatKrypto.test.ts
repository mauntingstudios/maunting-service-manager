import { bytesToBase64 } from '@msdis/shield/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Der Chat-Schluessel ist ein zustandsloses AES-256-GCM-Geheimnis je
 * Gespraech. Die Probe prueft, was eine Nachricht bindet: Gespraech,
 * Kennung und Absender. Etwas anderes darf sie nicht oeffnen.
 */

vi.mock('@/api/social', () => ({
  getE2eeChatKeys: vi.fn(async () => ({
    keys: [{ user_id: 1, key_version: 1, encrypted_chat_key: 'gepackt' }],
    latest_key_version: 1,
  })),
  putE2eeChatKeys: vi.fn(),
}))

vi.mock('./accountKeys', () => ({
  ensureAccountKeys: vi.fn(async () => ({
    kontoPaar: { publicKeyJwk: 'oeffentlich', privateKeyJwk: 'privat' },
    signaturPaar: { publicKeyJwk: 'sign-oeffentlich', privateKeyJwk: 'sign-privat' },
  })),
  kontoOeffentlichViele: vi.fn(async () => new Map()),
  signiereKonto: vi.fn(async () => 'signatur'),
  pruefeKonto: vi.fn(async () => true),
  KontoSchluesselFehltError: class extends Error {},
  KontoSchluesselNichtUebertragenError: class extends Error {},
}))

vi.mock('./e2eeCrypto', () => ({
  decryptE2eeHybrid: vi.fn(async () => bytesToBase64(new Uint8Array(32).fill(7))),
  encryptE2eeHybrid: vi.fn(async () => 'gepackt'),
}))

import { pruefeKonto } from './accountKeys'
import {
  ChatNutzlastUngueltigError,
  entpackeChatNutzlast,
  entpackeReaktion,
  leereChatSchluesselCache,
  verschluessleChatNutzlast,
  verschluessleReaktion,
} from './chatKrypto'

const ICH = 1

beforeEach(() => {
  leereChatSchluesselCache()
  vi.mocked(pruefeKonto).mockResolvedValue(true)
})

const FAELLE: Array<['direct' | 'group', number]> = [
  ['direct', 12],
  ['group', 3],
]

describe.each(FAELLE)('Chat-Nutzlast in %s', (typ, chatId) => {

  it('verschluesselt und entschluesselt im selben Gespraech', async () => {
    const verschluesselt = await verschluessleChatNutzlast(typ, chatId, 'u-1', ICH, 1, {
      text: 'hallo',
      timestamp: '2026-10-25T10:00:00.000Z',
    })
    expect(verschluesselt.key_version).toBe(1)
    expect(verschluesselt.encrypted_payload.startsWith('sv-e2ee-msg-v1:')).toBe(true)
    expect(verschluesselt.encrypted_payload).not.toContain('hallo')

    const roh = await entpackeChatNutzlast(
      typ,
      chatId,
      'u-1',
      ICH,
      1,
      verschluesselt.encrypted_payload,
    )
    expect(roh).toMatchObject({
      text: 'hallo',
      chat_type: typ,
      chat_id: chatId,
      client_uuid: 'u-1',
      sender_id: ICH,
      sig: 'signatur',
    })
  })

  it('oeffnet nicht unter einer anderen Nachrichtenkennung', async () => {
    const { encrypted_payload } = await verschluessleChatNutzlast(typ, chatId, 'u-1', ICH, 1, {
      text: 'hallo',
    })
    await expect(
      entpackeChatNutzlast(typ, chatId, 'u-2', ICH, 1, encrypted_payload),
    ).rejects.toBeInstanceOf(ChatNutzlastUngueltigError)
  })

  it('oeffnet nicht fuer einen anderen Absender', async () => {
    const { encrypted_payload } = await verschluessleChatNutzlast(typ, chatId, 'u-1', ICH, 1, {
      text: 'hallo',
    })
    await expect(
      entpackeChatNutzlast(typ, chatId, 'u-1', 99, 1, encrypted_payload),
    ).rejects.toBeInstanceOf(ChatNutzlastUngueltigError)
  })

  it('liest auch rohes Base64 aus der Zeit vor dem Praefix', async () => {
    const { encrypted_payload } = await verschluessleChatNutzlast(typ, chatId, 'u-1', ICH, 1, {
      text: 'alt',
    })
    const roh = encrypted_payload.replace('sv-e2ee-msg-v1:', '')
    const gelesen = await entpackeChatNutzlast(typ, chatId, 'u-1', ICH, 1, roh)
    expect(gelesen.text).toBe('alt')
  })

  it('verwirft ein gekipptes Chiffrat', async () => {
    const { encrypted_payload } = await verschluessleChatNutzlast(typ, chatId, 'u-1', ICH, 1, {
      text: 'hallo',
    })
    const gekippt = encrypted_payload.slice(0, -2) + 'AA'
    await expect(
      entpackeChatNutzlast(typ, chatId, 'u-1', ICH, 1, gekippt),
    ).rejects.toBeInstanceOf(ChatNutzlastUngueltigError)
  })

  it('verwirft eine Nachricht mit falscher Unterschrift', async () => {
    const { encrypted_payload } = await verschluessleChatNutzlast(typ, chatId, 'u-1', ICH, 1, {
      text: 'hallo',
    })
    vi.mocked(pruefeKonto).mockResolvedValue(false)
    await expect(
      entpackeChatNutzlast(typ, chatId, 'u-1', ICH, 1, encrypted_payload),
    ).rejects.toBeInstanceOf(ChatNutzlastUngueltigError)
  })

  it('bindet eine Reaktion an Nachricht und Nutzer', async () => {
    const emoji = await verschluessleReaktion(typ, chatId, 1, 77, ICH, '👍')
    expect(emoji.startsWith('sv-e2ee-react-v1:')).toBe(true)
    expect(await entpackeReaktion(typ, chatId, 1, 77, ICH, emoji)).toBe('👍')
    expect(await entpackeReaktion(typ, chatId, 1, 78, ICH, emoji)).toBeNull()
    expect(await entpackeReaktion(typ, chatId, 1, 77, 2, emoji)).toBeNull()
  })
})
