/**
 * Maunting Card — Datenmodell & Hilfsfunktionen.
 *
 * Die Maunting Card dient als visuelle und kryptographische Repräsentanz
 * der Zero-Knowledge-Identität des Benutzers. Sie leitet aus der Bucket-ID
 * eine formatierte Card-ID ab, berechnet das Ablaufdatum (24 Monate)
 * und liefert den aktuellen Sicherheitsstatus.
 */

export type CardStatus = 'uninitialized' | 'locked' | 'active' | 'rotation_due'

/**
 * Erzeugt aus einer Hex-Bucket-ID oder einem Fallback-Seed eine saubere,
 * formatierte Smartcard-ID im Format `MSM-XXXX-XXXX-XXXX`.
 */
export function formatCardNumber(bucketId: string | null | undefined, fallbackSeed = 1): string {
  if (!bucketId || bucketId.length < 12) {
    // Deterministischer Fallback für Test-/Neukonten
    const padded = String(fallbackSeed).padStart(12, '0')
    return `MSM-${padded.slice(0, 4)}-${padded.slice(4, 8)}-${padded.slice(8, 12)}`
  }

  // Großgeschriebene Hex-Blöcke
  const clean = bucketId.replace(/[^a-fA-F0-9]/g, '').toUpperCase()
  const p1 = clean.slice(0, 4).padEnd(4, '0')
  const p2 = clean.slice(4, 8).padEnd(4, '0')
  const p3 = clean.slice(8, 12).padEnd(4, '0')
  return `MSM-${p1}-${p2}-${p3}`
}

/**
 * Berechnet das Gültigkeitsdatum (Valid Thru) einer Karte.
 * Gültigkeit beträgt standardmäßig 24 Monate ab Erstellung bzw. letzter Rotation.
 */
export function calculateCardExpiry(
  basisDatum?: string | number | Date | null,
  lebensdauerMonate = 24
): {
  validThru: string
  expiryDate: Date
  isExpired: boolean
  isExpiringSoon: boolean
} {
  const start = basisDatum ? new Date(basisDatum) : new Date()
  const baseTime = isNaN(start.getTime()) ? new Date() : start

  const expiryDate = new Date(baseTime)
  expiryDate.setMonth(expiryDate.getMonth() + lebensdauerMonate)

  const now = new Date()
  const isExpired = now >= expiryDate

  // Bald fällig: innerhalb der letzten 30 Tage der Gültigkeit
  const dreissigTageMs = 30 * 24 * 60 * 60 * 1000
  const isExpiringSoon = !isExpired && expiryDate.getTime() - now.getTime() < dreissigTageMs

  const month = String(expiryDate.getMonth() + 1).padStart(2, '0')
  const year = String(expiryDate.getFullYear()).slice(-2)

  return {
    validThru: `${month}/${year}`,
    expiryDate,
    isExpired,
    isExpiringSoon,
  }
}

/**
 * Ermittelt den aktuellen Status der Maunting Card.
 */
export function getCardStatus(opts: {
  isInitialized: boolean
  isUnlocked: boolean
  isExpired?: boolean
  needsRotation?: boolean
}): CardStatus {
  if (!opts.isInitialized) {
    return 'uninitialized'
  }
  if (opts.isExpired || opts.needsRotation) {
    return 'rotation_due'
  }
  if (opts.isUnlocked) {
    return 'active'
  }
  return 'locked'
}

/**
 * Kürzt einen Fingerprint (z. B. Bucket-ID) für die Unterschriftenleiste.
 */
export function formatFingerprint(bucketId: string | null | undefined): string {
  if (!bucketId) return 'NO-CIPHER-SEED'
  const clean = bucketId.trim().toLowerCase()
  if (clean.length <= 16) return clean
  return `${clean.slice(0, 8)}...${clean.slice(-8)}`
}
