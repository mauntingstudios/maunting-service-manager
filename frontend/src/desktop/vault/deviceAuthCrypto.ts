/**
 * Zero-Knowledge E2EE Kryptographie für Smartcard-Gerätefreigabe.
 *
 * Verwendet WebCrypto RSA-OAEP mit SHA-256 für den ephemeren Schlüsselaustausch
 * zwischen dem scannenden Smartphone und dem Zielgerät.
 */

import { importAesGcmKey } from '@msdis/shield/kdf'
import { fillRandom } from '@msdis/shield/random'
import { SecureBuffer } from '@msdis/shield/secure-memory'

/** Alter Code: der oeffentliche Schluessel steckt komplett im QR (503 Zeichen). */
export interface DeviceAuthQrPayloadV2 {
  v: 2
  sid: string
  pk: string
  p: 'authorize' | 'unlock'
  uid: number
  /** Aufloese-Token: belegt dem Server, dass der Code gescannt wurde. */
  rt: string
}

/**
 * Kurzer Code: `msm3:<sid>:<purpose>:<rt>:<fp>` (gut 60 Zeichen).
 *
 * Der Schluessel kommt erst nach dem Scan vom Server, der Fingerabdruck
 * bindet ihn an diesen Code. Allein die Laenge entscheidet, wie viele Module
 * der QR hat: 503 Zeichen ergaben 101x101 und brauchten Sekunden, 63 Zeichen
 * ergeben 45x45 wie beim Kopplungscode.
 */
export interface DeviceAuthQrPayloadV3 {
  v: 3
  sid: string
  p: 'authorize' | 'unlock'
  rt: string
  /** Erste 8 Zeichen (base64url) des SHA-256 ueber den Schluesseltext. */
  fp: string
}

export type DeviceAuthQrPayload = DeviceAuthQrPayloadV2 | DeviceAuthQrPayloadV3

/** Kennung des kurzen Codes; die Version steckt im Praefix. */
export const QR_PREFIX_V3 = 'msm3:'

/** Hybrider E2EE-Umschlag (RSA-OAEP-2048 + AES-256-GCM) fuer Schluesseluebertragung. */
export const DEVICE_AUTH_ENVELOPE_V2_PREFIX = 'sv-device-auth-v2:'

/**
 * Baut den kurzen Code `msm3:<sid>:<purpose>:<rt>:<fp>` (gut 60 Zeichen).
 *
 * Allein die Laenge entscheidet, wie viele Module der QR hat: 503 Zeichen
 * ergaben 101x101 und brauchten Sekunden, gut 60 ergeben einen groben Code
 * wie beim Koppeln, den die Kamera in Millisekunden liest.
 */
export function buildDeviceAuthQrValueV3(
  sessionId: string,
  purpose: 'authorize' | 'unlock',
  resolveToken: string,
  fingerprint: string,
): string {
  return `${QR_PREFIX_V3}${sessionId}:${purpose}:${resolveToken}:${fingerprint}`
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

  // Hybrider E2EE-Umschlag (RSA-OAEP-2048 + AES-256-GCM) gemäß Spezifikation:
  // Jede Freigabe-Payload (sowohl unlock als auch authorize) wird mit einem
  // ephemeren AES-256-GCM-Schlüssel verschlüsselt, der wiederum per RSA-OAEP
  // verpackt wird (`sv-device-auth-v2:`).
  const aesKeyBuf = new SecureBuffer(32)
  try {
    return await aesKeyBuf.useAsync(async (rawAesKey) => {
      fillRandom(rawAesKey)
      const iv = new Uint8Array(12)
      fillRandom(iv)

      const aesKey = await importAesGcmKey(rawAesKey)
      const aesCipherBuffer = await cryptoObj.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        dataBytes,
      )
      const wrappedKeyBuffer = await cryptoObj.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        rawAesKey as unknown as BufferSource,
      )

      const cipherBytes = new Uint8Array(aesCipherBuffer)
      const ivAndCipher = new Uint8Array(iv.byteLength + cipherBytes.byteLength)
      ivAndCipher.set(iv, 0)
      ivAndCipher.set(cipherBytes, iv.byteLength)

      return `${DEVICE_AUTH_ENVELOPE_V2_PREFIX}${arrayBufferToBase64(wrappedKeyBuffer)}.${arrayBufferToBase64(ivAndCipher.buffer)}`
    })
  } finally {
    aesKeyBuf.destroy()
  }

}

/**
 * Entschlüsselt auf dem Zielgerät die vom Smartphone eingereichte Chiffre
 * mit dem ephemeren privaten Schlüssel. Unterstützt sowohl v1 (direktes
 * RSA-OAEP) als auch `sv-device-auth-v2:` (RSA-OAEP + AES-256-GCM).
 */
export async function decryptAuthPayload(
  privateKey: CryptoKey,
  ciphertextBase64: string,
): Promise<Record<string, unknown>> {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto ist in dieser Umgebung nicht verfügbar.')
  }

  if (ciphertextBase64.startsWith(DEVICE_AUTH_ENVELOPE_V2_PREFIX)) {
    const rest = ciphertextBase64.slice(DEVICE_AUTH_ENVELOPE_V2_PREFIX.length)
    const parts = rest.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error('Ungültiges Format der Gerätefreigabe.')
    }
    const [wrappedKeyB64, ivAndCipherB64] = parts
    const wrappedKeyBuffer = base64ToArrayBuffer(wrappedKeyB64)
    const rawAesKeyBuffer = await cryptoObj.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      wrappedKeyBuffer,
    )
    const rawAesBytes = new Uint8Array(rawAesKeyBuffer)
    const aesKeyBuf = SecureBuffer.fromBytes(rawAesBytes)
    rawAesBytes.fill(0)

    try {
      return await aesKeyBuf.useAsync(async (keyBytes) => {
        const aesKey = await importAesGcmKey(keyBytes)
        const ivAndCipherBytes = new Uint8Array(base64ToArrayBuffer(ivAndCipherB64))
        if (ivAndCipherBytes.byteLength <= 12) {
          throw new Error('Ungültige Chiffre der Gerätefreigabe.')
        }
        const iv = ivAndCipherBytes.slice(0, 12)
        const cipherBytes = ivAndCipherBytes.slice(12)
        const decryptedBuffer = await cryptoObj.subtle.decrypt(
          { name: 'AES-GCM', iv },
          aesKey,
          cipherBytes,
        )
        const jsonStr = new TextDecoder().decode(decryptedBuffer)
        return JSON.parse(jsonStr) as Record<string, unknown>
      })
    } finally {
      aesKeyBuf.destroy()
    }
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
 * Fingerabdruck des oeffentlichen Schluessels, gebunden an den QR-Code.
 *
 * Der Server liefert den Schluessel erst nach dem Scan. Ohne diesen
 * Fingerabdruck koennte er einen eigenen unterschieben und die Chiffre
 * mitlesen.
 */
export async function fingerprintPublicKey(publicKeyBase64: string): Promise<string> {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto ist in dieser Umgebung nicht verfügbar.')
  }

  const digest = await cryptoObj.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(publicKeyBase64.trim()),
  )
  return arrayBufferToBase64(digest)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 8)
}

const SID_MUSTER = /^[0-9a-f]{8,64}$/i
const TOKEN_MUSTER = /^[A-Za-z0-9_-]{16,128}$/
const ABDRUCK_MUSTER = /^[A-Za-z0-9_-]{8,32}$/

/**
 * Parst und validiert den gescannten QR-Code-Inhalt.
 *
 * `msm3:` traegt nur Kennung, Zweck, Aufloese-Token und Fingerabdruck. Das
 * alte JSON-Format (v2) bleibt lesbar: es traegt den Schluessel selbst und
 * braucht keinen Abruf. Codes ohne Aufloese-Token (`rt`) lassen sich nicht
 * einloesen; Sessions leben ohnehin nur 180 Sekunden.
 */
export function parseDeviceAuthQrCode(rawText: string): DeviceAuthQrPayload | null {
  if (!rawText || typeof rawText !== 'string') return null
  const clean = rawText.trim()

  if (clean.startsWith(QR_PREFIX_V3)) {
    const teile = clean.slice(QR_PREFIX_V3.length).split(':')
    if (teile.length !== 4) return null
    const [sid, p, rt, fp] = teile
    if (
      !SID_MUSTER.test(sid) ||
      (p !== 'authorize' && p !== 'unlock') ||
      !TOKEN_MUSTER.test(rt) ||
      !ABDRUCK_MUSTER.test(fp)
    ) {
      return null
    }
    return { v: 3, sid, p, rt, fp }
  }

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
      return data as DeviceAuthQrPayloadV2
    }
    return null
  } catch {
    return null
  }
}
