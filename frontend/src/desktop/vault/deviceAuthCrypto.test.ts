import { describe, expect, it } from 'vitest'
import {
  buildDeviceAuthQrValueV3,
  decryptAuthPayload,
  DEVICE_AUTH_ENVELOPE_V2_PREFIX,
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

  it('verschlüsselt und entschlüsselt große Unlock-Payloads mit keyBase64 hybrid über sv-device-auth-v2:', async () => {
    const { publicKeyBase64, privateKey } = await generateEphemeralAuthKeyPair()

    const unlockPayload = {
      action: 'unlock',
      bucketId: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      bucketAuthToken: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      keyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      authorizedBy: 'MaikMobile',
      timestamp: Date.now(),
    }

    const ciphertext = await encryptAuthPayload(publicKeyBase64, unlockPayload)
    expect(ciphertext.startsWith(DEVICE_AUTH_ENVELOPE_V2_PREFIX)).toBe(true)

    const decrypted = await decryptAuthPayload(privateKey, ciphertext)
    expect(decrypted).toEqual(unlockPayload)
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
