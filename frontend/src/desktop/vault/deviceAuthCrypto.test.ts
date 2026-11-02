import { describe, expect, it } from 'vitest'
import {
  decryptAuthPayload,
  encryptAuthPayload,
  generateEphemeralAuthKeyPair,
  parseDeviceAuthQrCode,
} from './deviceAuthCrypto'

describe('deviceAuthCrypto', () => {
  it('erzeugt Schlüsselpaar und verschlüsselt/entschlüsselt Payload Ende-zu-Ende', async () => {
    const { publicKeyBase64, privateKey } = await generateEphemeralAuthKeyPair()
    expect(publicKeyBase64).toBeTruthy()
    expect(privateKey).toBeTruthy()

    const payload = {
      action: 'authorize',
      bucketId: 'abc1234567890123456789012345678901234567890123456789012345678901234',
      userKeyBase64: 'kdf-user-key-bytes',
      timestamp: Date.now(),
    }

    const ciphertext = await encryptAuthPayload(publicKeyBase64, payload)
    expect(ciphertext).toBeTruthy()
    expect(ciphertext).not.toBe(JSON.stringify(payload))

    const decrypted = await decryptAuthPayload(privateKey, ciphertext)
    expect(decrypted).toEqual(payload)
  })

  it('parst und validiert gültige QR-Code-Payloads', () => {
    const valid = JSON.stringify({
      v: 2,
      sid: 'a1b2c3d4e5f67890',
      pk: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890',
      p: 'authorize',
      uid: 42,
      rt: 'aufloese-token-aus-dem-qr-code',
    })

    const parsed = parseDeviceAuthQrCode(valid)
    expect(parsed).not.toBeNull()
    expect(parsed?.sid).toBe('a1b2c3d4e5f67890')
    expect(parsed?.p).toBe('authorize')
    expect(parsed?.uid).toBe(42)
    expect(parsed?.rt).toBe('aufloese-token-aus-dem-qr-code')
  })

  it('verwirft ungültige oder manipulierte Payloads', () => {
    expect(parseDeviceAuthQrCode('')).toBeNull()
    expect(parseDeviceAuthQrCode('not-json')).toBeNull()
    expect(parseDeviceAuthQrCode('{"v": 2}')).toBeNull()
    expect(parseDeviceAuthQrCode('{"v": 2, "sid": "short"}')).toBeNull()
    expect(parseDeviceAuthQrCode(JSON.stringify({ v: 2, sid: '12345678', pk: 'key', p: 'invalid', uid: 1, rt: 'rt-rt-rt-rt-rt-rt' }))).toBeNull()
  })

  it('verwirft Codes ohne Aufloese-Token', () => {
    // v1 kannte kein rt; v2 ohne rt ist manipuliert. Beide lösen nichts aus.
    const v1 = JSON.stringify({
      v: 1,
      sid: 'a1b2c3d4e5f67890',
      pk: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890',
      p: 'authorize',
      uid: 42,
    })
    expect(parseDeviceAuthQrCode(v1)).toBeNull()

    const ohneRt = JSON.stringify({
      v: 2,
      sid: 'a1b2c3d4e5f67890',
      pk: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890',
      p: 'authorize',
      uid: 42,
    })
    expect(parseDeviceAuthQrCode(ohneRt)).toBeNull()

    const kurzesRt = JSON.stringify({
      v: 2,
      sid: 'a1b2c3d4e5f67890',
      pk: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890',
      p: 'authorize',
      uid: 42,
      rt: 'kurz',
    })
    expect(parseDeviceAuthQrCode(kurzesRt)).toBeNull()
  })
})
