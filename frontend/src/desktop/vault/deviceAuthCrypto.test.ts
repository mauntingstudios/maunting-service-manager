import { describe, expect, it } from 'vitest'
import {
  buildDeviceAuthQrValueV3,
  decryptAuthPayload,
  encryptAuthPayload,
  fingerprintPublicKey,
  generateEphemeralAuthKeyPair,
  parseDeviceAuthQrCode,
  QR_PREFIX_V3,
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

  it('baut einen kurzen v3-Code, der sich wieder parsen laesst', () => {
    // 503 Zeichen ergaben 101x101 Module und brauchten Sekunden; gut 60
    // ergeben einen groben Code wie beim Koppeln.
    const wert = buildDeviceAuthQrValueV3(
      'a1b2c3d4e5f67890',
      'unlock',
      'aufloese-token-aus-dem-qr-code',
      'fp123456',
    )
    expect(wert.startsWith(QR_PREFIX_V3)).toBe(true)
    expect(wert.length).toBeLessThan(80)

    const parsed = parseDeviceAuthQrCode(wert)
    expect(parsed).toEqual({
      v: 3,
      sid: 'a1b2c3d4e5f67890',
      p: 'unlock',
      rt: 'aufloese-token-aus-dem-qr-code',
      fp: 'fp123456',
    })
  })

  it('verwirft verkuerzte oder manipulierte v3-Codes', () => {
    expect(parseDeviceAuthQrCode('msm3:nur-drei:teile')).toBeNull()
    expect(parseDeviceAuthQrCode('msm3:zu-kurz:authorize:aufloese-token-aus-dem-code:fp123456')).toBeNull()
    expect(parseDeviceAuthQrCode('msm3:a1b2c3d4e5f67890:loeschen:aufloese-token-aus-dem-code:fp123456')).toBeNull()
    expect(parseDeviceAuthQrCode('msm3:a1b2c3d4e5f67890:authorize:kurs:fp123456')).toBeNull()
    expect(parseDeviceAuthQrCode('msm3:a1b2c3d4e5f67890:authorize:aufloese-token-aus-dem-code:!!')).toBeNull()
  })

  it('bildet stabile 8-Zeichen-Fingerabdruecke je Schluessel', async () => {
    const { publicKeyBase64 } = await generateEphemeralAuthKeyPair()
    const erster = await fingerprintPublicKey(publicKeyBase64)
    expect(erster).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect(await fingerprintPublicKey(publicKeyBase64)).toBe(erster)
    expect(await fingerprintPublicKey(`${publicKeyBase64}x`)).not.toBe(erster)
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
