/**
 * Team-Tresor-Schlüssel (DEK): erzeugen, verpacken, auspacken.
 *
 * Seit 11/2026 gibt es kein geteiltes Team-Passwort mehr. Pro Team existiert
 * ein zufälliger 256-Bit-Schlüssel (DEK); die Bucket-Kennung ist sein
 * SHA-256-Hash (blind: der Server sieht sie, kommt aber nicht an den
 * Schlüssel). Jedes Mitglied bekommt den DEK in einer eigenen Hülle, verpackt
 * gegen seine E2EE-Konto-Identität (`encryptE2eeHybrid`, Muster Chat-Keys).
 * Entsperren heißt: eigene Hülle holen, mit dem Konto-Schlüssel öffnen.
 */

import { importAesGcmKey } from '@msdis/shield/kdf'
import { sha256Hex } from '@msdis/shield/integrity'
import { fillRandom } from '@msdis/shield/random'
import { base64ToBytes, bytesToBase64 } from '@msdis/shield/core'

import { decryptE2eeHybrid, encryptE2eeHybrid } from '@/services/e2eeCrypto'

export interface TeamSchluessel {
  /** Die 32 rohen Schlüssel-Bytes (nur zum Verpacken/Weiterreichen). */
  dek: Uint8Array
  /** Derselbe Schlüssel als AES-GCM CryptoKey für Ein-/Auspacken der Einträge. */
  schluessel: CryptoKey
  /** Blinde Bucket-Kennung: SHA-256-Hex des DEK. */
  bucketId: string
}

/** Format der Hüllen-Nutzlast. Versioniert, damit ein Nachfolger lesbar bleibt. */
const HUELLE_VERSION = 1

interface HuellenNutzlast {
  v: number
  dek: string
}

function istHuellenNutzlast(wert: unknown): wert is HuellenNutzlast {
  if (typeof wert !== 'object' || wert === null) return false
  const { v, dek } = wert as Record<string, unknown>
  return v === HUELLE_VERSION && typeof dek === 'string'
}

/**
 * Erzeugt einen frischen Team-Schlüssel: 32 Zufalls-Bytes, daraus der
 * AES-GCM-Schlüssel und die blinde Bucket-Kennung.
 */
export async function erzeugeTeamSchluessel(): Promise<TeamSchluessel> {
  const dek = new Uint8Array(32)
  fillRandom(dek)
  const schluessel = await importAesGcmKey(dek)
  const bucketId = await sha256Hex(dek)
  return { dek, schluessel, bucketId }
}

/**
 * Verpackt den DEK für ein Mitglied gegen dessen öffentliche
 * E2EE-Konto-Identität. Der Umschlag trägt das Hybrid-Präfix, das der Server
 * beim Hinterlegen prüft.
 */
export async function teamSchluesselVerpacken(
  dek: Uint8Array,
  publicKeyJwk: string,
): Promise<string> {
  const nutzlast: HuellenNutzlast = { v: HUELLE_VERSION, dek: bytesToBase64(dek) }
  return encryptE2eeHybrid(JSON.stringify(nutzlast), publicKeyJwk)
}

/**
 * Öffnet die eigene Hülle mit dem privaten Konto-Schlüssel und baut daraus
 * Schlüssel und Bucket-Kennung. Der Aufrufer vergleicht die Kennung mit dem
 * Serverstand: Stimmt sie nicht, gehört die Hülle nicht zu diesem Tresor.
 */
export async function teamSchluesselAuspacken(
  wrapped: string,
  privateKeyJwk: string,
): Promise<TeamSchluessel> {
  let klar: string
  try {
    klar = await decryptE2eeHybrid(wrapped, privateKeyJwk)
  } catch {
    throw new Error('Schlüsselhülle lässt sich nicht öffnen.')
  }
  let nutzlast: unknown
  try {
    nutzlast = JSON.parse(klar)
  } catch {
    throw new Error('Schlüsselhülle ist beschädigt.')
  }
  if (!istHuellenNutzlast(nutzlast)) {
    throw new Error('Schlüsselhülle hat ein unbekanntes Format.')
  }
  const dek = base64ToBytes(nutzlast.dek)
  if (dek.length !== 32) {
    dek.fill(0)
    throw new Error('Schlüsselhülle ist beschädigt.')
  }
  const schluessel = await importAesGcmKey(dek)
  const bucketId = await sha256Hex(dek)
  return { dek, schluessel, bucketId }
}
