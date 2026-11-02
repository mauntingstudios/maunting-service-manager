/**
 * Zero-Knowledge E2EE Kryptographie für Smartcard-Gerätefreigabe.
 *
 * Verwendet WebCrypto RSA-OAEP mit SHA-256 für den ephemeren Schlüsselaustausch
 * zwischen dem scannenden Smartphone und dem Zielgerät.
 */

export interface DeviceAuthQrPayload {
  /** Format-Version, aktuell immer 2 (v1 kannte kein Aufloese-Token). */
  v: 2
  sid: string
  pk: string
  p: 'authorize' | 'unlock'
  uid: number
  /** Aufloese-Token: belegt dem Server, dass der Code gescannt wurde. */
  rt: string
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Erzeugt auf dem Zielgerät (Desktop) ein ephemeres RSA-OAEP 2048-Bit-Schlüsselpaar.
 * Der öffentliche Schlüssel wird als SPKI Base64 exportiert und in den QR-Code eingebettet.
 */
export async function generateEphemeralAuthKeyPair(): Promise<{
  publicKeyBase64: string
  privateKey: CryptoKey
}> {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto ist in dieser Umgebung nicht verfügbar.')
  }

  const keyPair = await cryptoObj.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )

  const spkiBuffer = await cryptoObj.subtle.exportKey('spki', keyPair.publicKey)
  const publicKeyBase64 = arrayBufferToBase64(spkiBuffer)

  return {
    publicKeyBase64,
    privateKey: keyPair.privateKey,
  }
}

/**
 * Verschlüsselt auf dem Smartphone eine Freigabe-Payload mit dem öffentlichen
 * Schlüssel des Zielgeräts.
 */
export async function encryptAuthPayload(
  publicKeyBase64: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto ist in dieser Umgebung nicht verfügbar.')
  }

  const spkiBuffer = base64ToArrayBuffer(publicKeyBase64)
  const publicKey = await cryptoObj.subtle.importKey(
    'spki',
    spkiBuffer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['encrypt'],
  )

  const encoder = new TextEncoder()
  const dataBytes = encoder.encode(JSON.stringify(payload))

  const encryptedBuffer = await cryptoObj.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    dataBytes,
  )

  return arrayBufferToBase64(encryptedBuffer)
}

/**
 * Entschlüsselt auf dem Zielgerät die vom Smartphone eingereichte Chiffre
 * mit dem ephemeren privaten Schlüssel.
 */
export async function decryptAuthPayload(
  privateKey: CryptoKey,
  ciphertextBase64: string,
): Promise<Record<string, unknown>> {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto ist in dieser Umgebung nicht verfügbar.')
  }

  const encryptedBuffer = base64ToArrayBuffer(ciphertextBase64)
  const decryptedBuffer = await cryptoObj.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedBuffer,
  )

  const decoder = new TextDecoder()
  const jsonStr = decoder.decode(decryptedBuffer)
  return JSON.parse(jsonStr) as Record<string, unknown>
}

/**
 * Parst und validiert den gescannten QR-Code-Inhalt.
 *
 * Codes ohne Aufloese-Token (`rt`) stammen von vor dem Fix und lassen sich
 * nicht mehr einloesen; Sessions leben ohnehin nur 180 Sekunden.
 */
export function parseDeviceAuthQrCode(rawText: string): DeviceAuthQrPayload | null {
  if (!rawText || typeof rawText !== 'string') return null
  const clean = rawText.trim()
  if (!clean.startsWith('{') || !clean.endsWith('}')) return null

  try {
    const data = JSON.parse(clean)
    if (
      data &&
      data.v === 2 &&
      typeof data.sid === 'string' &&
      data.sid.length >= 8 &&
      typeof data.pk === 'string' &&
      data.pk.length >= 32 &&
      (data.p === 'authorize' || data.p === 'unlock') &&
      typeof data.uid === 'number' &&
      typeof data.rt === 'string' &&
      data.rt.length >= 16
    ) {
      return data as DeviceAuthQrPayload
    }
    return null
  } catch {
    return null
  }
}
